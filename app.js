const IS_EXTENSION = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const REQUIRED_COLUMNS = [
  "Date",
  "Description",
  "Amount (in $)",
  "Account Name",
  "Transaction Type",
  "Category",
  "Subcategory",
  "Hidden Transaction",
];

const palette = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#9333ea",
  "#ca8a04",
  "#0284c7",
  "#be123c",
  "#475569",
];

const state = {
  allTransactions: [],
  filtered: [],
  selectedCategory: "",
  quality: {},
  showAllTransactions: false,
  showAllMerchants: false,
  categoryColors: new Map(),
  tableSorts: {
    categories: { key: "value", direction: "desc" },
    recurring: { key: "confidence", direction: "desc" },
    transactions: { key: "date", direction: "desc" },
  },
};

const els = {
  fileInput: document.querySelector("#fileInput"),
  dashboard: document.querySelector("#dashboard"),
  emptyUpload: document.querySelector("#emptyUpload"),
  sourceLabel: document.querySelector("#sourceLabel"),
  refreshFidelity: document.querySelector("#refreshFidelity"),
  monthFilter: document.querySelector("#monthFilter"),
  accountFilter: document.querySelector("#accountFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  searchInput: document.querySelector("#searchInput"),
  refundToggle: document.querySelector("#refundToggle"),
  clearFilters: document.querySelector("#clearFilters"),
  stackMode: document.querySelector("#stackMode"),
  qualityList: document.querySelector("#qualityList"),
  kpiSpend: document.querySelector("#kpiSpend"),
  kpiAverage: document.querySelector("#kpiAverage"),
  kpiHighMonth: document.querySelector("#kpiHighMonth"),
  kpiTopCategory: document.querySelector("#kpiTopCategory"),
  kpiRecurring: document.querySelector("#kpiRecurring"),
  stackedChart: document.querySelector("#stackedChart"),
  legend: document.querySelector("#legend"),
  trendChart: document.querySelector("#trendChart"),
  recurringSummary: document.querySelector("#recurringSummary"),
  recurringRows: document.querySelector("#recurringRows"),
  categoryRows: document.querySelector("#categoryRows"),
  detailTitle: document.querySelector("#detailTitle"),
  detailSubtitle: document.querySelector("#detailSubtitle"),
  detailBars: document.querySelector("#detailBars"),
  merchantList: document.querySelector("#merchantList"),
  merchantToggle: document.querySelector("#merchantToggle"),
  transactionRows: document.querySelector("#transactionRows"),
  transactionSummary: document.querySelector("#transactionSummary"),
  transactionToggle: document.querySelector("#transactionToggle"),
  emptyState: document.querySelector("#emptyState"),
  chartTooltip: document.querySelector("#chartTooltip"),
  sortButtons: document.querySelectorAll("[data-sort-table][data-sort-key]"),
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencyExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function csvParse(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }

  return rows;
}

function parseDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const match = value.match(/^([A-Za-z]{3})-(\d{1,2})-(\d{4})$/);
  if (!match) throw new Error(`Unsupported date: ${value}`);
  const months = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const month = months[match[1]];
  if (month === undefined) throw new Error(`Unsupported month: ${value}`);
  return new Date(Number(match[3]), month, Number(match[2]));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  });
}

function displayDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Math.round(days));
  return next;
}

function addMonthsClamped(date, months) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, maxDay));
  return next;
}

function normalizeAccount(name) {
  const clean = name.trim();
  return clean.toLowerCase() === "credit card" ? "Credit Card" : clean;
}

function parseFidelityCsv(text) {
  const rows = csvParse(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV does not contain a Fidelity transaction table.");

  const headerIndex = rows.findIndex((row) => REQUIRED_COLUMNS.every((column) => row.includes(column)));
  if (headerIndex < 0) throw new Error("Could not find the Fidelity transaction header row.");

  const header = rows[headerIndex];
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);

  const transactions = [];
  let footerRows = 0;
  let skippedRows = 0;
  let refundCount = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    if (row[0] === "DATA GLOSSARY:") {
      footerRows += 1;
      break;
    }
    if (row.length < header.length || !row[0]) {
      skippedRows += 1;
      continue;
    }

    const record = Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""]));
    const amount = Number(record["Amount (in $)"]);
    if (!Number.isFinite(amount)) {
      skippedRows += 1;
      continue;
    }

    const date = parseDate(record.Date);
    const spend = -amount;
    if (record["Transaction Type"] === "Expenses" && amount > 0) refundCount += 1;

    transactions.push({
      date,
      dateText: record.Date,
      description: record.Description.trim(),
      amount,
      spend,
      account: normalizeAccount(record["Account Name"]),
      type: record["Transaction Type"],
      category: record.Category.trim() || "Unknown",
      subcategory: record.Subcategory.trim() || "Unknown",
      hidden: record["Hidden Transaction"],
      month: monthKey(date),
    });
  }

  transactions.sort((a, b) => b.date - a.date);

  return {
    transactions,
    quality: {
      imported: transactions.length,
      skippedRows,
      footerRows,
      refunds: refundCount,
      unknown: transactions.filter((row) => row.category === "Unknown" || row.subcategory === "Unknown").length,
    },
  };
}

function dashboardRowsFromStored(transactions) {
  return transactions
    .filter((record) => {
      const type = record.transactionType || "Expense";
      return type === "Expense" || type === "Expenses";
    })
    .map((record) => {
      const date = parseDate(record.date);
      const amount = Number(record.amount) || 0;
      const type = record.transactionType || "Expense";
      const spend = -amount;
      return {
        date,
        dateText: displayDate(date),
        description: record.description || "",
        amount,
        spend,
        account: normalizeAccount(record.accountName || "Unknown"),
        type,
        category: record.category || "Unknown",
        subcategory: record.subcategory || "Unknown",
        hidden: record.hidden ? "Yes" : "No",
        month: monthKey(date),
      };
    })
    .sort((a, b) => b.date - a.date);
}

async function loadStoredTransactions() {
  const rows = await window.financeDb.getAllTransactions();
  const lastSync = await window.financeDb.getLastSync();
  if (!rows.length) return false;

  state.allTransactions = dashboardRowsFromStored(rows);
  state.quality = {
    imported: state.allTransactions.length,
    skippedRows: 0,
    footerRows: 0,
    refunds: state.allTransactions.filter((row) => row.type === "Expense" && row.spend < 0).length,
    unknown: state.allTransactions.filter((row) => row.category === "Unknown" || row.subcategory === "Unknown").length,
  };
  state.selectedCategory = "";
  state.showAllTransactions = false;
  state.showAllMerchants = false;
  assignCategoryColors();
  setupFilters();
  render();
  els.sourceLabel.textContent = lastSync
    ? `Fidelity synced ${new Date(lastSync.createdAt).toLocaleString()}`
    : "Fidelity data loaded";
  return true;
}

async function loadExtensionStatus() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (!response.ok) throw new Error(response.error || "Could not read extension status.");
  return response;
}

function sumBy(rows, keyFn, valueFn = (row) => row.spend) {
  const totals = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    totals.set(key, (totals.get(key) || 0) + valueFn(row));
  });
  return totals;
}

function sortTotals(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function compareValues(a, b) {
  if (a instanceof Date && b instanceof Date) return a - b;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortRows(rows, sort, valueForKey) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const result = compareValues(valueForKey(a, sort.key), valueForKey(b, sort.key));
    return result * direction;
  });
}

function setTableSort(table, key, defaultDirection = "asc") {
  const current = state.tableSorts[table];
  const direction = current?.key === key ? (current.direction === "asc" ? "desc" : "asc") : defaultDirection;
  state.tableSorts[table] = { key, direction };
  if (table === "transactions") state.showAllTransactions = false;
  render();
}

function updateSortButtons() {
  els.sortButtons.forEach((button) => {
    const sort = state.tableSorts[button.dataset.sortTable];
    const active = sort?.key === button.dataset.sortKey;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? sort.direction : "";
    button.setAttribute("aria-sort", active ? (sort.direction === "asc" ? "ascending" : "descending") : "none");
    button.setAttribute(
      "aria-label",
      `${button.textContent.trim()}, ${active ? `sorted ${sort.direction === "asc" ? "ascending" : "descending"}` : "not sorted"}`,
    );
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeMerchantKey(description) {
  return description
    .toLowerCase()
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\b(pos|debit|card|purchase|payment|autopay|online|web|inc|llc|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cadenceFromInterval(days) {
  const cadences = [
    { name: "Weekly", days: 7, tolerance: 2, monthlyEstimate: 52 / 12 },
    { name: "Biweekly", days: 14, tolerance: 3, monthlyEstimate: 26 / 12 },
    { name: "Monthly", days: 30, tolerance: 6, monthlyEstimate: 1 },
    { name: "Quarterly", days: 91, tolerance: 14, monthlyEstimate: 1 / 3 },
    { name: "Annual", days: 365, tolerance: 35, monthlyEstimate: 1 / 12 },
  ];
  return cadences.find((cadence) => Math.abs(days - cadence.days) <= cadence.tolerance) || null;
}

function displayMerchantName(rows) {
  const names = new Map();
  rows.forEach((row) => names.set(row.description, (names.get(row.description) || 0) + 1));
  return [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Unknown";
}

function estimateNextDate(lastDate, cadence) {
  if (cadence.name === "Monthly") return addMonthsClamped(lastDate, 1);
  if (cadence.name === "Quarterly") return addMonthsClamped(lastDate, 3);
  if (cadence.name === "Annual") return addMonthsClamped(lastDate, 12);
  return addDays(lastDate, cadence.days);
}

function detectRecurringSpend(rows) {
  const groups = new Map();
  rows
    .filter((row) => row.spend > 0)
    .forEach((row) => {
      const merchantKey = normalizeMerchantKey(row.description);
      if (!merchantKey || merchantKey.length < 3) return;
      const key = [merchantKey, row.account, row.category].join("|");
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    });

  const recurring = [];

  groups.forEach((group) => {
    if (group.length < 2) return;
    const sorted = [...group].sort((a, b) => a.date - b.date);
    const intervals = sorted.slice(1).map((row, index) => (row.date - sorted[index].date) / 86400000);
    const cadence = cadenceFromInterval(median(intervals));
    if (!cadence) return;

    const intervalDeviation = average(intervals.map((days) => Math.abs(days - cadence.days)));
    if (intervals.length > 1 && intervalDeviation > cadence.tolerance) return;

    const amounts = sorted.map((row) => row.spend);
    const typical = median(amounts);
    const amountDeviation = average(amounts.map((amount) => Math.abs(amount - typical)));
    const amountVariation = typical ? amountDeviation / typical : 0;
    const confidence = Math.max(
      0.52,
      Math.min(0.98, 1 - amountVariation * 0.65 - (intervalDeviation / cadence.tolerance) * 0.18 + Math.min(group.length - 2, 4) * 0.04),
    );
    const last = sorted.at(-1);

    recurring.push({
      merchant: displayMerchantName(sorted),
      account: last.account,
      category: last.category,
      cadence: cadence.name,
      occurrences: group.length,
      typical,
      monthlyEstimate: typical * cadence.monthlyEstimate,
      lastDate: last.date,
      nextDate: estimateNextDate(last.date, cadence),
      confidence,
      variableAmount: amountVariation > 0.12,
    });
  });

  return recurring.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate || b.confidence - a.confidence);
}

function assignCategoryColors() {
  state.categoryColors = new Map();
  const categories = [...new Set(state.allTransactions.map((row) => row.category))].sort((a, b) => a.localeCompare(b));
  categories.forEach((category, index) => {
    state.categoryColors.set(category, palette[index % palette.length]);
  });
}

function filteredTransactions() {
  const month = els.monthFilter.value;
  const account = els.accountFilter.value;
  const category = els.categoryFilter.value;
  const search = els.searchInput.value.trim().toLowerCase();
  const includeRefunds = els.refundToggle.checked;

  return state.allTransactions.filter((row) => {
    if (month !== "all" && row.month !== month) return false;
    if (account !== "all" && row.account !== account) return false;
    if (category !== "all" && row.category !== category) return false;
    if (!includeRefunds && row.spend < 0) return false;
    if (search && !row.description.toLowerCase().includes(search)) return false;
    return true;
  });
}

function fillSelect(select, values, allLabel) {
  const current = select.value || "all";
  select.innerHTML = "";
  select.append(new Option(allLabel, "all"));
  values.forEach((value) => select.append(new Option(value, value)));
  select.value = values.includes(current) ? current : "all";
}

function setupFilters() {
  const months = [...new Set(state.allTransactions.map((row) => row.month))].sort();
  const accounts = [...new Set(state.allTransactions.map((row) => row.account))].sort((a, b) => a.localeCompare(b));
  const categories = [...new Set(state.allTransactions.map((row) => row.category))].sort((a, b) => a.localeCompare(b));

  fillSelect(els.monthFilter, months.map((key) => `${key} ${monthLabel(key)}`), "All months");
  [...els.monthFilter.options].forEach((option) => {
    if (option.value !== "all") option.value = option.value.slice(0, 7);
  });
  fillSelect(els.accountFilter, accounts, "All accounts");
  fillSelect(els.categoryFilter, categories, "All categories");
}

function renderQuality() {
  if (!state.allTransactions.length) {
    els.qualityList.innerHTML = `<dt>Rows</dt><dd>0</dd><dt>Status</dt><dd>Waiting</dd>`;
    return;
  }
  const dateRange = state.allTransactions.length
    ? `${state.allTransactions.at(-1).dateText} to ${state.allTransactions[0].dateText}`
    : "-";
  const items = [
    ["Rows", state.quality.imported],
    ["Date range", dateRange],
    ["Footer found", state.quality.footerRows ? "Yes" : "No"],
    ["Skipped", state.quality.skippedRows],
    ["Refunds", state.quality.refunds],
    ["Unknown", state.quality.unknown],
  ];
  els.qualityList.innerHTML = items.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
}

function renderKpis(rows) {
  const total = rows.reduce((sum, row) => sum + row.spend, 0);
  const monthly = sumBy(rows, (row) => row.month);
  const categories = sortTotals(sumBy(rows, (row) => row.category));
  const highMonth = sortTotals(monthly)[0];

  els.kpiSpend.textContent = currencyExact.format(total);
  els.kpiAverage.textContent = currencyExact.format(monthly.size ? total / monthly.size : 0);
  els.kpiHighMonth.textContent = highMonth ? `${monthLabel(highMonth[0])} ${currency.format(highMonth[1])}` : "-";
  els.kpiTopCategory.textContent = categories[0] ? categories[0][0] : "-";
}

function renderRecurring(rows) {
  const recurring = detectRecurringSpend(rows);
  const estimatedMonthly = recurring.reduce((sum, item) => sum + item.monthlyEstimate, 0);
  const sortedRecurring = sortRows(recurring, state.tableSorts.recurring, (item, key) => item[key]);
  const displayRows = sortedRecurring.slice(0, 12);

  els.kpiRecurring.textContent = currencyExact.format(estimatedMonthly);
  els.recurringSummary.textContent = recurring.length
    ? `${recurring.length} recurring pattern${recurring.length === 1 ? "" : "s"} detected. Showing ${displayRows.length}. Estimate is monthly.`
    : "No recurring spend detected in the current data.";
  els.recurringRows.innerHTML =
    displayRows
      .map(
        (item) => `<tr>
          <td>
            <span class="recurring-merchant">${escapeHtml(item.merchant)}</span>
            <span class="recurring-meta">${escapeHtml(item.category)} · ${escapeHtml(item.account)} · ${item.occurrences} charges</span>
          </td>
          <td>${escapeHtml(item.cadence)}</td>
          <td>${escapeHtml(displayDate(item.lastDate))}</td>
          <td>${escapeHtml(displayDate(item.nextDate))}</td>
          <td class="num">${currencyExact.format(item.typical)}${item.variableAmount ? '<span class="recurring-variable">Variable</span>' : ""}</td>
          <td class="num">${Math.round(item.confidence * 100)}%</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="6">${emptyHtml()}</td></tr>`;
}

function colorFor(index) {
  return palette[index % palette.length];
}

function colorForCategory(category, fallbackIndex = 0) {
  return state.categoryColors.get(category) || colorFor(fallbackIndex);
}

function renderStackedChart(rows) {
  const mode = els.stackMode.value;
  const months = [...new Set(state.allTransactions.map((row) => row.month))].sort();
  const keyFn = mode === "subcategory" ? (row) => row.subcategory : (row) => row.category;
  const seriesTotals = sortTotals(sumBy(rows, keyFn)).filter(([, total]) => total > 0);
  const topSeries = seriesTotals.slice(0, 10).map(([key]) => key);
  const monthTotals = sumBy(rows, (row) => row.month);
  const maxMonth = Math.max(1, ...months.map((month) => Math.max(0, monthTotals.get(month) || 0)));
  const lookup = new Map();
  const seriesCategories = new Map();

  rows.forEach((row) => {
    const key = keyFn(row);
    const bucket = topSeries.includes(key) ? key : "Other";
    const lookupKey = `${row.month}|${bucket}`;
    lookup.set(lookupKey, (lookup.get(lookupKey) || 0) + row.spend);
    if (bucket !== "Other") {
      const categoryTotals = seriesCategories.get(bucket) || new Map();
      categoryTotals.set(row.category, (categoryTotals.get(row.category) || 0) + row.spend);
      seriesCategories.set(bucket, categoryTotals);
    }
  });

  const displaySeries = topSeries.concat(seriesTotals.length > topSeries.length ? ["Other"] : []);
  els.stackedChart.style.setProperty("--month-count", months.length);
  els.stackedChart.innerHTML = `<div class="axis-label" aria-hidden="true"></div>`;

  months.forEach((month) => {
    const monthSpend = Math.max(0, monthTotals.get(month) || 0);
    const height = Math.max(8, ((monthSpend / maxMonth) * 160));
    const segments = displaySeries
      .map((series, index) => {
        const value = Math.max(0, lookup.get(`${month}|${series}`) || 0);
        const pct = monthTotals.get(month) ? (value / Math.max(1, monthTotals.get(month))) * 100 : 0;
        const category = mode === "category" ? series : topCategoryForSeries(series, seriesCategories);
        const clickable = value > 0 && category && series !== "Other";
        const tooltip = `${series}|${monthLabel(month)}|${currencyExact.format(value)}|${pct.toFixed(1)}% of ${monthLabel(month)} spend`;
        const segmentColor = series === "Other" ? "#94a3b8" : colorForCategory(category, index);
        return `<div class="segment ${clickable ? "clickable" : ""}"
          aria-label="${escapeHtml(`${series} ${monthLabel(month)} ${currencyExact.format(value)}`)}"
          style="height:${pct}%;background:${segmentColor}"
          data-tooltip="${escapeHtml(tooltip)}"
          data-tooltip-label="${escapeHtml(`${series} · ${monthLabel(month)} · ${currencyExact.format(value)} · ${pct.toFixed(1)}%`)}"
          ${clickable ? `role="button" tabindex="0" data-month="${month}" data-category="${escapeHtml(category)}"` : ""}
        ></div>`;
      })
      .join("");

    els.stackedChart.insertAdjacentHTML(
      "beforeend",
      `<div class="stack-column">
        <div class="month-total">${currency.format(monthSpend)}</div>
        <div class="stack" style="height:${height}px">${segments}</div>
        <div class="month-label">${monthLabel(month)}</div>
      </div>`,
    );
  });

  els.legend.innerHTML = displaySeries
    .map((series, index) => {
      const category = mode === "category" ? series : topCategoryForSeries(series, seriesCategories);
      const clickable = category && series !== "Other";
      const legendColor = series === "Other" ? "#94a3b8" : colorForCategory(category, index);
      return `<span class="legend-item ${clickable ? "clickable" : ""}"
        ${clickable ? `role="button" tabindex="0" data-category="${escapeHtml(category)}"` : ""}
        title="${clickable ? `Filter to ${escapeHtml(category)}` : ""}">
        <span class="swatch" style="background:${legendColor}"></span>${escapeHtml(series)}
      </span>`;
    })
    .join("");

  els.stackedChart.querySelectorAll("[data-category]").forEach((target) => {
    target.addEventListener("click", () => applyChartSelection(target.dataset.category));
    target.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        applyChartSelection(target.dataset.category);
      }
    });
  });

  els.legend.querySelectorAll("[data-category]").forEach((target) => {
    target.addEventListener("click", () => applyChartSelection(target.dataset.category));
    target.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        applyChartSelection(target.dataset.category);
      }
    });
  });

  bindTooltips(els.stackedChart.querySelectorAll("[data-tooltip]"));
}

function topCategoryForSeries(series, seriesCategories) {
  const categories = seriesCategories.get(series);
  if (!categories) return "";
  return sortTotals(categories)[0]?.[0] || "";
}

function applyChartSelection(category) {
  if (!category) return;
  if ([...els.categoryFilter.options].some((option) => option.value === category)) {
    els.categoryFilter.value = category;
  }
  els.searchInput.value = "";
  state.selectedCategory = category;
  state.showAllTransactions = false;
  state.showAllMerchants = false;
  render();
}

function clearFilters() {
  els.monthFilter.value = "all";
  els.accountFilter.value = "all";
  els.categoryFilter.value = "all";
  els.searchInput.value = "";
  els.refundToggle.checked = true;
  state.selectedCategory = "";
  state.showAllTransactions = false;
  state.showAllMerchants = false;
  render();
}

function bindTooltips(targets) {
  targets.forEach((target) => {
    target.addEventListener("pointerenter", showTooltip);
    target.addEventListener("pointermove", moveTooltip);
    target.addEventListener("pointerleave", hideTooltip);
    target.addEventListener("mouseenter", showTooltip);
    target.addEventListener("mousemove", moveTooltip);
    target.addEventListener("mouseleave", hideTooltip);
    target.addEventListener("focus", showTooltip);
    target.addEventListener("blur", hideTooltip);
  });
}

function showTooltip(event) {
  const parts = event.currentTarget.dataset.tooltip?.split("|") || [];
  if (!parts.length) return;
  const [title, context, amount, detail] = parts;
  els.chartTooltip.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(context)} · ${escapeHtml(amount)}</span><br><span>${escapeHtml(detail)}</span>`;
  els.chartTooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  if (els.chartTooltip.hidden) return;
  const point = event.touches?.[0] || event;
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const baseX = Number.isFinite(point.clientX) ? point.clientX : rect?.left || 12;
  const baseY = Number.isFinite(point.clientY) ? point.clientY : rect?.top || 12;
  const x = Math.min(window.innerWidth - 260, Math.max(12, baseX + 14));
  const y = Math.min(window.innerHeight - 90, Math.max(12, baseY + 14));
  els.chartTooltip.style.left = `${x}px`;
  els.chartTooltip.style.top = `${y}px`;
}

function hideTooltip() {
  els.chartTooltip.hidden = true;
}

function renderTrend(rows) {
  const months = [...new Set(state.allTransactions.map((row) => row.month))].sort();
  const monthly = sumBy(rows, (row) => row.month);
  const values = months.map((month) => Math.max(0, monthly.get(month) || 0));
  const maxValue = Math.max(1, ...values);
  const width = 520;
  const height = 236;
  const pad = { top: 24, right: 24, bottom: 36, left: 58 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const step = months.length > 1 ? innerW / (months.length - 1) : innerW;
  const points = values.map((value, index) => {
    const x = pad.left + index * step;
    const y = pad.top + innerH - (value / maxValue) * innerH;
    return [x, y, value, months[index]];
  });
  const path = points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ");
  const area = `${path} L ${pad.left + (points.length - 1) * step} ${pad.top + innerH} L ${pad.left} ${pad.top + innerH} Z`;

  els.trendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly spend trend">
      <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${width - pad.right}" y2="${pad.top + innerH}" stroke="#d9dfda" />
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerH}" stroke="#d9dfda" />
      <text x="${pad.left - 8}" y="${pad.top + innerH}" text-anchor="end" font-size="12" fill="#66716d">$0</text>
      <path d="${area}" fill="rgba(29, 111, 95, 0.13)"></path>
      <path d="${path}" fill="none" stroke="#1d6f5f" stroke-width="3"></path>
      ${points
        .map(
          ([x, y, value, month]) => {
            const label = currency.format(value);
            const labelWidth = Math.max(42, label.length * 7 + 12);
            const labelX = Math.min(width - pad.right - labelWidth / 2, Math.max(pad.left + labelWidth / 2, x));
            const placeBelow = y < pad.top + 28;
            const labelY = placeBelow ? y + 24 : y - 16;
            const rectY = labelY - 13;
            return `
            <rect x="${labelX - labelWidth / 2}" y="${rectY}" width="${labelWidth}" height="17" rx="5" fill="#ffffff" opacity="0.88"></rect>
            <text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="12" font-weight="800" fill="#6b7280">${label}</text>
            <circle class="trend-point" cx="${x}" cy="${y}" r="4" fill="#2563eb"
              data-tooltip="${escapeHtml(`Monthly Trend|${monthLabel(month)}|${currencyExact.format(value)}|Filtered total`)}"></circle>
            <text x="${x}" y="${height - 14}" text-anchor="middle" font-size="12" fill="#66716d">${monthLabel(month)}</text>`;
          },
        )
        .join("")}
    </svg>`;
  bindTooltips(els.trendChart.querySelectorAll("[data-tooltip]"));
}

function renderCategoryTable(rows) {
  const total = rows.reduce((sum, row) => sum + row.spend, 0);
  const categories = sortTotals(sumBy(rows, (row) => row.category))
    .filter(([, value]) => Math.abs(value) > 0.005)
    .map(([category, value]) => ({
      category,
      value,
      share: total ? value / total : 0,
    }));
  const sortedCategories = sortRows(categories, state.tableSorts.categories, (item, key) => item[key]);
  if (!state.selectedCategory || !categories.some((item) => item.category === state.selectedCategory)) {
    state.selectedCategory = sortedCategories[0]?.category || "";
  }

  els.categoryRows.innerHTML =
    sortedCategories
      .map(({ category, value, share }) => {
        return `<tr class="selectable ${category === state.selectedCategory ? "selected" : ""}" data-category="${escapeHtml(category)}">
          <td><span class="category-name"><span class="category-dot" style="background:${colorForCategory(category)}"></span>${escapeHtml(category)}</span></td>
          <td class="num">${currencyExact.format(value)}</td>
          <td class="num">${Math.round(share * 100)}%</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="3" class="muted">No categories found.</td></tr>`;

  els.categoryRows.querySelectorAll("tr[data-category]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedCategory = row.dataset.category;
      render();
    });
  });
}

function renderDetail(rows) {
  const category = state.selectedCategory;
  const categoryRows = rows.filter((row) => row.category === category);
  const total = categoryRows.reduce((sum, row) => sum + row.spend, 0);
  const subcategories = sortTotals(sumBy(categoryRows, (row) => row.subcategory)).slice(0, 8);
  const maxSubcategory = Math.max(1, ...subcategories.map(([, value]) => value));
  const merchantsAll = sortTotals(sumBy(categoryRows, (row) => row.description));
  const merchants = state.showAllMerchants ? merchantsAll : merchantsAll.slice(0, 5);
  const detailColor = colorForCategory(category);

  els.detailTitle.textContent = category || "Category Detail";
  els.detailSubtitle.textContent = category ? `${currencyExact.format(total)} across ${categoryRows.length} transactions` : "Select a category to drill in.";
  els.merchantToggle.hidden = merchantsAll.length <= 5;
  els.merchantToggle.textContent = state.showAllMerchants ? "Show Less" : "View All";
  els.detailBars.innerHTML =
    subcategories
      .map(
        ([name, value]) => `<div class="bar-row">
          <span class="bar-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, (value / maxSubcategory) * 100)}%;background:${detailColor}"></span></span>
          <strong class="num">${currency.format(value)}</strong>
        </div>`,
      )
      .join("") || emptyHtml();

  els.merchantList.innerHTML =
    merchants.length
      ? `<h3>Top Descriptions</h3>${merchants
          .map(([name, value]) => `<div class="merchant"><span>${escapeHtml(name)}</span><strong>${currencyExact.format(value)}</strong></div>`)
          .join("")}`
      : "";
}

function renderTransactions(rows) {
  const sortedRows = sortRows(rows, state.tableSorts.transactions, (row, key) => row[key]);
  const visibleLimit = state.showAllTransactions ? sortedRows.length : 50;
  const visibleRows = sortedRows.slice(0, visibleLimit);
  els.transactionToggle.hidden = rows.length <= 50;
  els.transactionToggle.textContent = state.showAllTransactions ? "Show Less" : "View All";
  els.transactionSummary.textContent = `Showing ${visibleRows.length} of ${sortedRows.length} filtered transactions.`;
  els.transactionRows.innerHTML =
    visibleRows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.dateText)}</td>
          <td>${escapeHtml(row.description)}</td>
          <td>${escapeHtml(row.account)}</td>
          <td>${escapeHtml(row.category)}</td>
          <td>${escapeHtml(row.subcategory)}</td>
          <td class="num">${currencyExact.format(row.spend)}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="6">${emptyHtml()}</td></tr>`;
}

function emptyHtml() {
  return els.emptyState.innerHTML;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  els.dashboard.hidden = !state.allTransactions.length;
  els.emptyUpload.hidden = Boolean(state.allTransactions.length);
  updateSortButtons();
  if (!state.allTransactions.length) {
    renderQuality();
    return;
  }
  state.filtered = filteredTransactions();
  renderQuality();
  renderKpis(state.filtered);
  renderStackedChart(state.filtered);
  renderTrend(state.filtered);
  renderRecurring(state.filtered);
  renderCategoryTable(state.filtered);
  renderDetail(state.filtered);
  renderTransactions(state.filtered);
}

async function loadCsvText(name, text) {
  try {
    const parsed = parseFidelityCsv(text);
    state.allTransactions = parsed.transactions;
    state.quality = parsed.quality;
    state.selectedCategory = "";
    state.showAllTransactions = false;
    state.showAllMerchants = false;
    assignCategoryColors();
    setupFilters();
    render();
    els.sourceLabel.textContent = `${name} loaded`;
  } catch (error) {
    els.dashboard.hidden = false;
    els.emptyUpload.hidden = true;
    els.dashboard.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    els.sourceLabel.textContent = "Import failed";
  }
}

async function loadInitialData() {
  if (IS_EXTENSION) {
    els.refreshFidelity.hidden = false;
    const hasStoredData = await loadStoredTransactions();
    if (!hasStoredData) {
      const status = await loadExtensionStatus().catch(() => null);
      els.sourceLabel.textContent = status?.lastSyncError?.error || "Refresh Fidelity to load dashboard data.";
      setupFilters();
      render();
    }
    return;
  }

  els.sourceLabel.textContent = "Load as a Chrome extension, or import a CSV for local fallback.";
  setupFilters();
  render();
}

[
  els.monthFilter,
  els.accountFilter,
  els.categoryFilter,
  els.searchInput,
  els.refundToggle,
  els.stackMode,
].forEach((control) => control.addEventListener("input", render));

els.sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setTableSort(button.dataset.sortTable, button.dataset.sortKey, button.dataset.sortDefault || "asc");
  });
});

els.transactionToggle.addEventListener("click", () => {
  state.showAllTransactions = !state.showAllTransactions;
  renderTransactions(state.filtered);
});

els.merchantToggle.addEventListener("click", () => {
  state.showAllMerchants = !state.showAllMerchants;
  renderDetail(state.filtered);
});

els.clearFilters.addEventListener("click", clearFilters);

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await loadCsvText(file.name, await file.text());
});

els.refreshFidelity.addEventListener("click", async () => {
  if (!IS_EXTENSION) return;
  els.sourceLabel.textContent = "Opening Fidelity...";
  const response = await chrome.runtime.sendMessage({ type: "START_REFRESH", range: { mode: "ytd" } });
  if (!response.ok) {
    els.sourceLabel.textContent = response.error || "Refresh failed.";
    return;
  }
  if (response.result?.status === "waiting") {
    els.sourceLabel.textContent = response.result.message;
    return;
  }
  const loaded = await loadStoredTransactions();
  els.sourceLabel.textContent = loaded
    ? `${response.result.imported} Fidelity transactions synced`
    : "Refresh completed, but no transactions were stored.";
});

loadInitialData();
