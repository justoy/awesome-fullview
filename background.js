importScripts("lib/db.js", "lib/normalization.js");

const SPENDING_URL = "https://digital.fidelity.com/ftgw/pna/customer/planning/spending/";
let pendingRefresh = null;

function dashboardUrl() {
  return chrome.runtime.getURL("index.html");
}

async function findTabByUrl(prefix) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url?.startsWith(prefix)) || null;
}

async function openOrFocusSpendingTab() {
  const existing = await findTabByUrl(SPENDING_URL);
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
  const existing = await findTabByUrl(url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    return existing;
  }
  return chrome.tabs.create({ url, active: true });
}

async function fetchSummaryInPage(tabId, range) {
  const fallbackBody = globalThis.financeNormalization.buildFidelitySummaryRequest(range);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [fallbackBody],
    func: async (fallbackRequestBody) => {
      const captured = window.__fullViewSpendingLastSummaryRequest;
      const requestBody = captured?.body || fallbackRequestBody;
      const bodySource = captured?.body ? `captured ${captured.at}` : "fallback";
      await fetch("/ftgw/pna/customer/planning/cashflow-api/status", {
        method: "GET",
        credentials: "include",
        headers: {
          "fid-originating-app-id": "AP146978",
          "fid-client-app-id": "AP146978",
        },
      }).catch(() => {});
      const response = await fetch("/ftgw/pna/customer/planning/cashflow-api/v1/summary", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "fid-originating-app-id": "AP146978",
          "fid-client-app-id": "AP146978",
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
  return payload.json;
}

async function collectFromTab(tabId, range) {
  let raw;
  try {
    raw = await fetchSummaryInPage(tabId, range);
  } catch (error) {
    const response = await chrome.tabs.sendMessage(tabId, { type: "COLLECT_FIDELITY", range });
    if (!response?.ok) throw error;
    if (!response.transactions?.length) {
      throw new Error(response.debug || "Fidelity returned no recognizable transactions.");
    }
    const syncRun = await globalThis.financeDb.replaceTransactions(response.transactions, { range });
    await openDashboard();
    return syncRun;
  }

  const transactions = globalThis.financeNormalization.normalizeFidelitySummaryResponse(raw);
  if (!transactions.length) {
    throw new Error(`Fidelity returned no recognizable transactions. Response keys: ${Object.keys(raw || {}).slice(0, 12).join(", ")}`);
  }

  const syncRun = await globalThis.financeDb.replaceTransactions(transactions, { range });
  await openDashboard();
  return syncRun;
}

async function startRefresh(range) {
  const tab = await openOrFocusSpendingTab();
  pendingRefresh = { tabId: tab.id, range: range || { mode: "ytd" }, startedAt: Date.now() };
  try {
    return await collectFromTab(tab.id, pendingRefresh.range);
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("Receiving end does not exist")) {
      return { status: "waiting", message: "Reload the Fidelity Spending tab, then click Refresh Fidelity again." };
    }
    await globalThis.financeDb.recordSyncFailure(error, { range: pendingRefresh.range });
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_REFRESH") {
    startRefresh(message.range)
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
      collectFromTab(sender.tab.id, pendingRefresh.range).catch(() => {});
    }
  }

  return false;
});
