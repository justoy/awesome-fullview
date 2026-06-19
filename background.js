importScripts("lib/db.js", "lib/normalization.js");

const SPENDING_URL = "https://digital.fidelity.com/ftgw/pna/customer/planning/spending/";
let pendingRefresh = null;

function dashboardUrl() {
  return chrome.runtime.getURL("index.html");
}

async function findSpendingTab() {
  const urlPattern = `${SPENDING_URL}*`;
  const [tab] = await chrome.tabs.query({ url: urlPattern });
  return tab || null;
}

async function findDashboardTabId() {
  const [context] = await chrome.runtime.getContexts({
    contextTypes: ["TAB"],
    documentUrls: [dashboardUrl()],
  });
  return context?.tabId >= 0 ? context.tabId : null;
}

async function openOrFocusSpendingTab() {
  const existing = await findSpendingTab();
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== chrome.windows.WINDOW_ID_NONE) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return existing;
  }
  return chrome.tabs.create({ url: SPENDING_URL, active: true });
}

async function openDashboard() {
  const url = dashboardUrl();
  const existingTabId = await findDashboardTabId();
  if (existingTabId !== null) {
    return chrome.tabs.update(existingTabId, { active: true });
  }
  return chrome.tabs.create({ url, active: true });
}

async function fetchSummaryInPage(tabId) {
  const [captureResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const captured = window.__fullViewSpendingLastSummaryRequest;
      return captured?.body
        ? { at: captured.at, body: captured.body, appHeaders: captured.appHeaders, url: captured.url }
        : null;
    },
  });
  const captured = captureResult?.result;
  if (!captured?.body) {
    throw new Error("Select the date range in Fidelity first, then refresh again after the Fidelity page updates. If the extension was just reloaded, reload the Fidelity Spending tab first.");
  }
  if (!captured.appHeaders?.["fid-originating-app-id"] || !captured.appHeaders?.["fid-client-app-id"]) {
    throw new Error("Fidelity's application headers were not captured. Reload the Fidelity Spending tab, select the date range again, then refresh.");
  }

  const requestBody = captured.body;
  const bodySource = `captured ${captured.at}`;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [requestBody, captured.appHeaders, bodySource],
    func: async (requestBody, appHeaders, bodySource) => {
      await fetch("/ftgw/pna/customer/planning/cashflow-api/status", {
        method: "GET",
        credentials: "include",
        headers: appHeaders,
      }).catch(() => {});
      const response = await fetch("/ftgw/pna/customer/planning/cashflow-api/v1/summary", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...appHeaders,
          reset: "false",
        },
        body: JSON.stringify(requestBody),
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        textPrefix: text.slice(0, 240),
        bodySource: `${bodySource}; app headers`,
        json,
      };
    },
  });

  const payload = result?.result;
  if (!payload) throw new Error("Fidelity page request did not return a response.");
  if (!payload.ok) {
    const detail = payload.textPrefix ? ` ${payload.textPrefix}` : "";
    throw new Error(`Fidelity summary request failed with HTTP ${payload.status} using ${payload.bodySource}.${detail}`);
  }
  return { json: payload.json, capturedAt: captured.at };
}

async function collectFromTab(tabId) {
  const raw = await fetchSummaryInPage(tabId);
  const transactions = globalThis.financeNormalization.normalizeFidelitySummaryResponse(raw.json);
  if (!transactions.length) {
    throw new Error(`Fidelity returned no recognizable transactions. Response keys: ${Object.keys(raw.json || {}).slice(0, 12).join(", ")}`);
  }

  const syncRun = await globalThis.financeDb.replaceTransactions(transactions, {
    range: { mode: "fidelity-selected", capturedAt: raw.capturedAt },
  });
  await openDashboard();
  return syncRun;
}

async function startRefresh() {
  const tab = await openOrFocusSpendingTab();
  pendingRefresh = { tabId: tab.id, startedAt: Date.now() };
  try {
    return await collectFromTab(tab.id);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("Receiving end does not exist")) {
      return { status: "waiting", message: "Reload the Fidelity Spending tab, then click Refresh Fidelity again." };
    }
    await globalThis.financeDb.recordSyncFailure(error, { range: { mode: "fidelity-selected" } });
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_REFRESH") {
    startRefresh()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OPEN_DASHBOARD") {
    openDashboard()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_STATUS") {
    Promise.all([
      globalThis.financeDb.getAllTransactions(),
      globalThis.financeDb.getLastSync(),
      globalThis.financeDb.getLastSyncError(),
    ])
      .then(([transactions, lastSync, lastSyncError]) => sendResponse({ ok: true, count: transactions.length, lastSync, lastSyncError }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "FIDELITY_PAGE_READY" && sender.tab?.id) {
    if (pendingRefresh && pendingRefresh.tabId === sender.tab.id) {
      collectFromTab(sender.tab.id).catch(() => {});
    }
  }

  return false;
});
