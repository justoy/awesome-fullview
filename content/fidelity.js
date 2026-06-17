(function () {
  const SUMMARY_URL = "https://digital.fidelity.com/ftgw/pna/customer/planning/cashflow-api/v1/summary";
  let capturedSummaryRequest = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source === "full-view-spending-hook" && event.data?.type === "SUMMARY_REQUEST_CAPTURED") {
      capturedSummaryRequest = event.data;
    }
  });

  function isSpendingPageReady() {
    return location.href.includes("/ftgw/pna/customer/planning/spending/");
  }

  async function waitForReady() {
    const started = Date.now();
    while (Date.now() - started < 30000) {
      if (isSpendingPageReady() && document.readyState !== "loading") return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Fidelity Spending page did not finish loading.");
  }

  async function collect(range) {
    await waitForReady();
    const appHeaders = capturedSummaryRequest?.appHeaders;
    if (!appHeaders?.["fid-originating-app-id"] || !appHeaders?.["fid-client-app-id"]) {
      throw new Error("Fidelity's application headers were not captured. Reload the Fidelity Spending tab and select the date range again.");
    }
    const body = window.financeNormalization.buildFidelitySummaryRequest(range);
    const response = await fetch(SUMMARY_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...appHeaders,
        reset: "false",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Fidelity summary request failed with HTTP ${response.status}.`);
    }

    const raw = await response.json();
    const transactions = window.financeNormalization.normalizeFidelitySummaryResponse(raw);
    return {
      transactions,
      rawCount: transactions.length,
      debug: transactions.length
        ? ""
        : `No transactions found in Fidelity response keys: ${Object.keys(raw || {}).slice(0, 12).join(", ")}. Captured page request: ${capturedSummaryRequest?.at || "none"}`,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "COLLECT_FIDELITY") return false;
    collect(message.range)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  waitForReady()
    .then(() => chrome.runtime.sendMessage({ type: "FIDELITY_PAGE_READY" }))
    .catch(() => {});
})();
