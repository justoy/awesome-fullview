# Development Notes

## Project Overview

This project is a Chrome extension for local Fidelity Full View spending analysis.

The original dashboard UI lives in `index.html`, `app.js`, and `styles.css`. The current product flow is the Chrome extension refresh path, which pulls data from the user's already-authenticated Fidelity browser session and stores normalized transactions locally.

The extension must not collect Fidelity credentials, MFA codes, cookies, or session tokens. Login and MFA stay entirely inside the normal Fidelity tab.

## Main Files

- `manifest.json`: Manifest V3 extension definition.
- `background.js`: Service worker. Opens/focuses Fidelity, calls the summary API from the Fidelity page context, stores normalized data, and opens the dashboard.
- `content/fidelity.js`: Content script for page-ready messages and legacy collection fallback.
- `content/page-hook.js`: Main-world page hook intended to capture Fidelity's own summary request body.
- `lib/normalization.js`: Fidelity API response normalization and legacy fallback request-body construction.
- `lib/db.js`: IndexedDB storage layer.
- `popup.html`, `popup.js`, `popup.css`: Extension popup and refresh controls.
- `index.html`, `app.js`, `styles.css`: Dashboard UI. In extension mode, it reads IndexedDB first. Local mode is only a UI/manual-import fallback.

## User Flow

1. User loads this directory as an unpacked Chrome extension.
2. User opens or is already logged into Fidelity.
3. User selects the desired date range in Fidelity Full View Spending.
4. User clicks `Refresh from Fidelity` in the popup or `Refresh Fidelity` in the dashboard.
5. The background worker opens/focuses:

   ```text
   https://digital.fidelity.com/ftgw/pna/customer/planning/spending/
   ```

6. The user completes Fidelity login/MFA if needed.
7. The extension reuses Fidelity's captured summary request body from the page hook and runs it from the Fidelity page context.
8. The response is normalized and stored in IndexedDB.
9. The extension dashboard reads IndexedDB and renders expense-only spending analysis.

## Fidelity Data Access

Fidelity Full View Spending uses:

```text
POST /ftgw/pna/customer/planning/cashflow-api/v1/summary
```

The request must run in the authenticated Fidelity tab with:

```text
credentials: include
Content-Type: application/json
reset: false
fid-originating-app-id: AP146978
fid-client-app-id: AP146978
```

Fidelity's Angular app also primes the API before summary calls:

```text
GET /ftgw/pna/customer/planning/cashflow-api/status
```

The extension mirrors this in `background.js` before posting to `/v1/summary`.

## Request Body

The active refresh path reuses Fidelity's own captured request body from `content/page-hook.js`. Users select MTD, YTD, or custom dates in Fidelity, Fidelity issues the matching summary request, and the extension posts that same body again from the authenticated page context.

If no request has been captured yet, the refresh fails with an instruction to select the date range in Fidelity first. `buildFidelitySummaryRequest()` remains in `lib/normalization.js` only for the legacy content-script collection path.

The legacy YTD body includes:

```json
{
  "includeTxnSplit": false,
  "includeCustomSubcategory": true,
  "categorizedDeltaFrequency": "MONTHLY",
  "cashflowCalculators": [
    { "calculator": "cashflow" },
    { "calculator": "cashflowovertime", "calculatorFrequency": "YTD" },
    { "calculator": "transactions" },
    { "calculator": "spendbycategory" },
    { "calculator": "spendbycategorydetail" },
    { "calculator": "discspendbychildcategory" },
    { "calculator": "discspendbycategory" },
    { "calculator": "spendbycategorydelta", "calculatorFrequency": "YTD" }
  ]
}
```

Each calculator also receives `fromdate` and `todate`. Fidelity uses a wider overtime range for `cashflow` and `cashflowovertime`, and the selected range for transaction/detail calculators.

If Fidelity returns HTTP 400, check whether the required app headers and `/status` priming request are still present. The popup/dashboard status surfaces the HTTP status and response prefix.

## Fidelity API Shape

The API response is not identical to the CSV export.

Observed transaction fields include:

```json
{
  "txnDate": "2026-05-30T05:00:00.000+00:00",
  "description": "SAFEWAY BOZEMAN MT",
  "txnId": "string",
  "amount": -79.33,
  "accountInfo": {
    "accountName": "string",
    "accountId": "string",
    "status": "SUCCESS"
  },
  "category": "Expense",
  "subCategory": "Food",
  "isExcluded": false
}
```

Important mapping notes:

- `accountInfo.accountName` is the account label. It is nested, unlike CSV `Account Name`.
- `category` can be a transaction type such as `Expense`, `Income`, or `Transfer`.
- `subCategory` often contains the user-facing spending category such as `Food`, `Travel & vacation`, or `Auto & transport`.
- Income, saving, and transfers can appear in the transaction response but should not be included in spending dashboard totals.
- The dashboard currently filters extension-loaded rows to `Expense`/`Expenses` before rendering spending metrics.

## Normalized Transaction

Stored transactions use this shape:

```json
{
  "id": "string",
  "date": "YYYY-MM-DD",
  "description": "string",
  "amount": -79.33,
  "accountName": "string",
  "transactionType": "Expense",
  "category": "Food",
  "subcategory": "Food",
  "hidden": false,
  "source": "fidelity-full-view",
  "raw": {}
}
```

Identity uses Fidelity's transaction id when available, otherwise:

```text
hash(date + description + amount + accountName + category + subcategory)
```

The dashboard converts expense `amount` to positive spend with:

```text
spend = -amount
```

Refunds/credits are therefore negative spend.

## Recurring Spend Detection

Recurring spend is a dashboard-only derived analysis in `app.js`; it is not persisted in IndexedDB. The detector groups positive-spend expense rows by normalized description, account, and category, then looks for repeated charges whose median spacing matches a known cadence:

- Weekly: about 7 days.
- Biweekly: about 14 days.
- Monthly: about 30 days.
- Quarterly: about 91 days.
- Annual: about 365 days.

The recurring panel displays the detected merchant, cadence, last charge, estimated next charge, typical amount, and a confidence score. The recurring KPI is the estimated monthly amount, with weekly, biweekly, quarterly, and annual charges prorated to a monthly estimate. Refunds and credits are excluded from recurring candidates because their `spend` value is negative.

## Table Sorting

Dashboard tables are sorted client-side in `app.js`. Sort state lives in `state.tableSorts`, keyed by table name. Sortable table headers use `data-sort-table`, `data-sort-key`, and optional `data-sort-default` attributes in `index.html`; `updateSortButtons()` keeps the visual direction indicator and accessibility labels in sync.

## Storage

`lib/db.js` uses IndexedDB database:

```text
full-view-spending
```

Stores:

- `transactions`: normalized transaction rows, keyed by `id`.
- `sync_runs`: sync history.
- `settings`: `lastSync` and `lastSyncError`.

Current refresh behavior replaces the full transaction store with the latest normalized response.

## Local Development

Run the dashboard without the extension for UI work:

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

Local mode does not auto-load sample data. Use the Chrome extension for Fidelity sync, or manually import a CSV only as a fallback.

## Extension Development

Load as an unpacked extension from this repo directory:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this repo directory.

After changing extension files:

1. Reload the extension in `chrome://extensions`.
2. Reload the Fidelity Spending tab so content scripts update.
3. Refresh from the popup or dashboard.

For JavaScript syntax checks:

```sh
node --check app.js
node --check background.js
node --check content/fidelity.js
node --check content/page-hook.js
node --check lib/db.js
node --check lib/normalization.js
node --check popup.js
```

## Known Limitations And Next Steps

- The dashboard is spending-focused. Income/saving/transfers are stored but currently excluded from dashboard rendering.
- The active request body is captured from Fidelity's own page request. If Fidelity changes its app, update `content/page-hook.js` and response normalization first.
- `content/page-hook.js` must be injected before Fidelity makes the summary request, so extension reloads should be followed by a Fidelity Spending tab reload.
- There is no historical merge yet; each sync replaces stored transactions.
- Future useful features: account filters from normalized data, separate cashflow/income views, sync history UI, data export, and category cleanup rules.
