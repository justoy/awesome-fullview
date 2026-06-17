(function () {
  const ENDPOINT = "/ftgw/pna/customer/planning/cashflow-api/v1/summary";
  const STATE_KEY = "__fullViewSpendingLastSummaryRequest";
  const APP_HEADER_NAMES = ["fid-originating-app-id", "fid-client-app-id"];

  if (window.__fullViewSpendingHookInstalled) return;
  window.__fullViewSpendingHookInstalled = true;

  function endpointUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input === "object" && "url" in input) return input.url;
    return "";
  }

  function appHeaders(headers) {
    const captured = {};
    if (!headers) return captured;

    try {
      const normalized = new Headers(headers);
      for (const name of APP_HEADER_NAMES) {
        const value = normalized.get(name);
        if (value) captured[name] = value;
      }
    } catch {}
    return captured;
  }

  function capture(url, body, headers) {
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
      appHeaders: appHeaders(headers),
      url,
    };

    window.postMessage(
      {
        source: "full-view-spending-hook",
        type: "SUMMARY_REQUEST_CAPTURED",
        at: window[STATE_KEY].at,
        hasBody: Boolean(parsedBody),
        appHeaders: window[STATE_KEY].appHeaders,
      },
      window.location.origin,
    );
  }

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(input, init = {}) {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }
    capture(endpointUrl(input), init?.body, headers);
    return originalFetch.apply(this, arguments);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__fullViewSpendingUrl = String(url || "");
    this.__fullViewSpendingHeaders = {};
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
    const normalizedName = String(name || "").toLowerCase();
    if (APP_HEADER_NAMES.includes(normalizedName)) {
      this.__fullViewSpendingHeaders[normalizedName] = String(value);
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    capture(this.__fullViewSpendingUrl, body, this.__fullViewSpendingHeaders);
    return originalSend.apply(this, arguments);
  };
})();
