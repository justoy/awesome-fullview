# Full View Spending

Chrome extension for local Fidelity Full View spending analysis.

## Chrome Extension

Load this directory as an unpacked Chrome extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose `Load unpacked`.
4. Select this repo directory.

Select the desired date range in Fidelity Full View Spending first, then use the extension popup to refresh from Fidelity's currently selected view. Pulled transactions are normalized and stored locally in IndexedDB, then shown in the extension dashboard.

The extension does not handle Fidelity credentials.

### Dashboard Overview

![Spending dashboard with filters, summary metrics, monthly charts, and recurring spend](docs/screenshots/screenshot0.png)

*Filter transactions by month, account, category, or merchant, then review headline metrics, monthly trends, and detected recurring charges.*

## Local Fallback

The dashboard can still be served locally for UI work:

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

Local mode does not auto-load sample data. Use the extension for Fidelity sync, or import a CSV manually only as a fallback.

## What It Shows

- Net YTD spend, average monthly spend, highest month, and top category.
- Category or subcategory spend by month.
- Monthly spend trend.
- Auto-detected recurring spend with cadence, next estimated charge, and confidence.
- Category drilldown by subcategory and top descriptions.
- Sortable category, recurring spend, and transaction tables.
- CSV export of the currently filtered transactions, using Fidelity-compatible columns for re-import.

### Category and Transaction Details

![Category breakdown, selected category details, and transaction table](docs/screenshots/screenshot1.png)

*Select a category to see its share of spending, top descriptions, and the matching transactions.*

Extension-loaded dashboard data is stored in IndexedDB. Expense amounts are converted to positive spend with `spend = -amount`; refunds/credits therefore reduce spend.
