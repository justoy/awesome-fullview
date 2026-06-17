(function (global) {
  const DB_NAME = "full-view-spending";
  const DB_VERSION = 1;
  const STORE_TRANSACTIONS = "transactions";
  const STORE_SYNC_RUNS = "sync_runs";
  const STORE_SETTINGS = "settings";

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_TRANSACTIONS)) {
          const transactions = db.createObjectStore(STORE_TRANSACTIONS, { keyPath: "id" });
          transactions.createIndex("date", "date");
          transactions.createIndex("accountName", "accountName");
          transactions.createIndex("category", "category");
          transactions.createIndex("transactionType", "transactionType");
        }

        if (!db.objectStoreNames.contains(STORE_SYNC_RUNS)) {
          db.createObjectStore(STORE_SYNC_RUNS, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function replaceTransactions(transactions, meta = {}) {
    const db = await openDb();
    const tx = db.transaction([STORE_TRANSACTIONS, STORE_SYNC_RUNS, STORE_SETTINGS], "readwrite");
    const transactionStore = tx.objectStore(STORE_TRANSACTIONS);
    const syncStore = tx.objectStore(STORE_SYNC_RUNS);
    const settingsStore = tx.objectStore(STORE_SETTINGS);
    const now = new Date().toISOString();
    const syncRun = {
      id: now,
      source: "fidelity-full-view",
      status: "success",
      imported: transactions.length,
      range: meta.range || null,
      createdAt: now,
    };

    transactionStore.clear();
    transactions.forEach((transaction) => transactionStore.put(transaction));
    syncStore.put(syncRun);
    settingsStore.put({ key: "lastSync", value: syncRun });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    db.close();
    return syncRun;
  }

  async function recordSyncFailure(error, meta = {}) {
    const db = await openDb();
    const tx = db.transaction([STORE_SYNC_RUNS, STORE_SETTINGS], "readwrite");
    const now = new Date().toISOString();
    const syncRun = {
      id: now,
      source: "fidelity-full-view",
      status: "error",
      error: String(error?.message || error || "Unknown sync error"),
      range: meta.range || null,
      createdAt: now,
    };

    tx.objectStore(STORE_SYNC_RUNS).put(syncRun);
    tx.objectStore(STORE_SETTINGS).put({ key: "lastSyncError", value: syncRun });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    db.close();
    return syncRun;
  }

  async function getAllTransactions() {
    const db = await openDb();
    const tx = db.transaction(STORE_TRANSACTIONS, "readonly");
    const rows = await requestToPromise(tx.objectStore(STORE_TRANSACTIONS).getAll());
    db.close();
    return rows;
  }

  async function getLastSync() {
    const db = await openDb();
    const tx = db.transaction(STORE_SETTINGS, "readonly");
    const setting = await requestToPromise(tx.objectStore(STORE_SETTINGS).get("lastSync"));
    db.close();
    return setting?.value || null;
  }

  async function getLastSyncError() {
    const db = await openDb();
    const tx = db.transaction(STORE_SETTINGS, "readonly");
    const setting = await requestToPromise(tx.objectStore(STORE_SETTINGS).get("lastSyncError"));
    db.close();
    return setting?.value || null;
  }

  global.financeDb = {
    getAllTransactions,
    getLastSync,
    getLastSyncError,
    recordSyncFailure,
    replaceTransactions,
  };
})(globalThis);
