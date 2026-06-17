(function () {
  const ENDPOINT = "/ftgw/pna/customer/planning/cashflow-api/v1/summary";
  const STATE_KEY = "__fullViewSpendingLastSummaryRequest";

  if (window.__fullViewSpendingHookInstalled) return;
  window.__fullViewSpendingHookInstalled = true;

  function endpointUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input === "object" && "url" in input) return input.url;
    return "";
  }

  function capture(url, body) {
    if (!url || !url.includes(ENDPOINT) || !body) return;
    const bodyText = typeof body === "string" ? body : "";
    let parsedBody = null;
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : null;
    } catch {}

    window[STATE_KEY] = {
      at: new Date().toISOString(),
      body: parsedBody,
      bodyText,
      url,
    };

    window.postMessage(
      {
        source: "full-view-spending-hook",
        type: "SUMMARY_REQUEST_CAPTURED",
        at: window[STATE_KEY].at,
        hasBody: Boolean(parsedBody),
      },
      window.location.origin,
    );
  }

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(input, init = {}) {
    capture(endpointUrl(input), init?.body);
    return originalFetch.apply(this, arguments);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__fullViewSpendingUrl = String(url || "");
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    capture(this.__fullViewSpendingUrl, body);
    return originalSend.apply(this, arguments);
  };
})();
