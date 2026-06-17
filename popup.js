const els = {
  status: document.querySelector("#status"),
  rangeMode: document.querySelector("#rangeMode"),
  customDates: document.querySelector("#customDates"),
  fromdate: document.querySelector("#fromdate"),
  todate: document.querySelector("#todate"),
  refresh: document.querySelector("#refresh"),
  dashboard: document.querySelector("#dashboard"),
};

function rangeFromControls() {
  const mode = els.rangeMode.value;
  if (mode !== "custom") return { mode };
  return {
    mode,
    fromdate: els.fromdate.value,
    todate: els.todate.value,
  };
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function formatSync(sync) {
  if (!sync) return "No local transaction data yet.";
  const date = new Date(sync.createdAt);
  return `${sync.imported} transactions synced ${date.toLocaleString()}.`;
}

async function loadStatus() {
  const response = await sendMessage({ type: "GET_STATUS" });
  if (!response.ok) {
    els.status.textContent = response.error;
    return;
  }
  els.status.textContent = response.count
    ? formatSync(response.lastSync)
    : response.lastSyncError?.error || "No local transaction data yet.";
}

els.rangeMode.addEventListener("input", () => {
  els.customDates.hidden = els.rangeMode.value !== "custom";
});

els.refresh.addEventListener("click", async () => {
  els.status.textContent = "Opening Fidelity...";
  const response = await sendMessage({ type: "START_REFRESH", range: rangeFromControls() });
  els.status.textContent = response.ok
    ? response.result?.message || formatSync(response.result)
    : response.error || "Refresh failed.";
});

els.dashboard.addEventListener("click", () => {
  sendMessage({ type: "OPEN_DASHBOARD" });
});

loadStatus().catch((error) => {
  els.status.textContent = error.message;
});
