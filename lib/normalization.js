(function (global) {
  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function toIsoDate(value) {
    if (!value) return "";
    if (typeof value === "string") {
      const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return iso[0];
      const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slash) return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
      const short = value.match(/^([A-Za-z]{3})-(\d{1,2})-(\d{4})$/);
      if (short) {
        const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
        return `${short[3]}-${months[short[1]] || "01"}-${short[2].padStart(2, "0")}`;
      }
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  function pick(record, names) {
    for (const name of names) {
      if (record && record[name] !== undefined && record[name] !== null) return record[name];
    }
    return "";
  }

  function pickDeep(record, names) {
    for (const name of names) {
      const parts = name.split(".");
      let current = record;
      for (const part of parts) {
        current = current?.[part];
      }
      if (current !== undefined && current !== null && current !== "") return current;
    }
    return "";
  }

  function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const number = Number(String(value || "").replace(/[$,]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeType(value) {
    const type = String(value || "").trim();
    if (/expense/i.test(type)) return "Expense";
    if (/income/i.test(type)) return "Income";
    if (/transfer/i.test(type)) return "Transfers";
    if (/saving/i.test(type)) return "Saving";
    if (/invest/i.test(type)) return "Investing";
    return type || "Expense";
  }

  function isTransactionType(value) {
    return /^(expense|expenses|income|transfer|transfers|saving|savings|investing)$/i.test(String(value || "").trim());
  }

  function findTransactionsData(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return [];
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.some((item) => item && typeof item === "object" && (pick(item, ["date", "txnDate", "transactionDate", "postedDate"]) || pick(item, ["description", "merchantName", "name"])))) {
        return value;
      }
      for (const item of value) {
        const nested = findTransactionsData(item, seen);
        if (nested.length) return nested;
      }
      return [];
    }

    for (const key of ["transactionsData", "transactions", "transactionData"]) {
      if (Array.isArray(value[key])) return value[key];
    }

    for (const nested of Object.values(value)) {
      const found = findTransactionsData(nested, seen);
      if (found.length) return found;
    }

    return [];
  }

  function normalizeFidelityTransaction(record) {
    const date = toIsoDate(pickDeep(record, ["date", "txnDate", "transactionDate", "postedDate", "transactionDateText"]));
    const description = String(pickDeep(record, ["description", "merchantName", "merchant", "name", "transactionDescription"])).trim();
    const amount = toNumber(pickDeep(record, ["amount", "transactionAmount", "txnAmount", "value"]));
    const accountName = String(pickDeep(record, [
      "accountName",
      "acctName",
      "displayAccountName",
      "accountInfo.accountName",
      "accountInfo.displayAccountName",
      "account.accountName",
      "account.displayAccountName",
      "account.name",
    ])).trim() || "Unknown";
    const rawCategory = String(pickDeep(record, ["category"])).trim();
    const transactionType = normalizeType(pickDeep(record, ["transactionType", "type", "cashflowType", "transactionCategory", "categoryType"]) || (isTransactionType(rawCategory) ? rawCategory : ""));
    const parentCategory = String(pickDeep(record, [
      "categoryName",
      "parentCategoryName",
      "parentCategory",
      "spendingCategory",
      "primaryCategoryName",
    ])).trim();
    const childCategory = String(pickDeep(record, [
      "subcategory",
      "subCategory",
      "subcategoryName",
      "subCategoryName",
      "childCategoryName",
      "childCategory",
    ])).trim();
    const category = parentCategory || (rawCategory && !isTransactionType(rawCategory) ? rawCategory : "") || childCategory || "Unknown";
    const subcategory = childCategory || category;
    const hiddenValue = pickDeep(record, ["hidden", "hiddenTransaction", "isHidden", "Hidden Transaction", "isExcluded"]);
    const id = String(pickDeep(record, ["fidelity_transaction_id", "transactionId", "txnId", "id"])).trim()
      || `fv-${stableHash([date, description, amount, accountName, category, subcategory].join("|"))}`;

    return {
      id,
      date,
      description,
      amount,
      accountName,
      transactionType,
      category,
      subcategory,
      hidden: hiddenValue === true || String(hiddenValue).toLowerCase() === "true" || String(hiddenValue).toLowerCase() === "yes",
      source: "fidelity-full-view",
      raw: record,
    };
  }

  function normalizeFidelitySummaryResponse(response) {
    return findTransactionsData(response)
      .map(normalizeFidelityTransaction)
      .filter((transaction) => transaction.date && transaction.description);
  }

  function buildFidelitySummaryRequest(range = { mode: "ytd" }) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const year = now.getFullYear();
    const mode = range.mode || "ytd";
    const fromdate = mode === "mtd"
      ? `${year}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
      : mode === "custom" && range.fromdate
        ? range.fromdate
        : `${year}-01-01`;
    const todate = mode === "custom" && range.todate ? range.todate : today;
    const previousYearStart = `${year - 1}-01-01`;

    return {
      includeTxnSplit: false,
      includeCustomSubcategory: true,
      categorizedDeltaFrequency: "MONTHLY",
      cashflowCalculators: [
        { calculator: "cashflow", fromdate: previousYearStart, todate },
        { calculator: "cashflowovertime", fromdate: previousYearStart, todate, calculatorFrequency: "YTD" },
        { calculator: "transactions", fromdate, todate },
        { calculator: "spendbycategory", fromdate, todate },
        { calculator: "spendbycategorydetail", fromdate, todate },
        { calculator: "discspendbychildcategory", fromdate, todate },
        { calculator: "discspendbycategory", fromdate, todate },
        { calculator: "spendbycategorydelta", fromdate, todate, calculatorFrequency: "YTD" },
      ],
    };
  }

  global.financeNormalization = {
    buildFidelitySummaryRequest,
    normalizeFidelitySummaryResponse,
  };
})(globalThis);
