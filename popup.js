const els = {
  status: document.querySelector("#status"),
  refresh: document.querySelector("#refresh"),
  dashboard: document.querySelector("#dashboard"),
};

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

els.refresh.addEventListener("click", async () => {
  els.status.textContent = "Opening Fidelity...";
  const response = await sendMessage({ type: "START_REFRESH" });
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
