# Full View Spending

Local Fidelity Full View spending visualizer and Chrome extension prototype.

## Run

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

The app loads `Transactions_Jun-15-2026 at 2.24.02 PM.csv` by default when served from this directory. You can also import another Fidelity CSV with the `Import CSV` button.

## Chrome Extension MVP

Load this directory as an unpacked extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose `Load unpacked`.
4. Select this repo directory.

The extension popup can open the Fidelity Full View Spending page and request MTD, YTD, or custom date ranges after you complete Fidelity login/MFA in the normal Fidelity tab. Pulled transactions are normalized and stored locally in IndexedDB, then shown in the same dashboard at the extension `index.html` page.

The extension does not handle Fidelity credentials.

## What It Shows

- Net YTD spend, average monthly spend, highest month, and top category.
- Category or subcategory spend by month.
- Monthly spend trend.
- Category drilldown by subcategory and top descriptions.
- Filterable transaction table.

The parser skips the Fidelity title row, stops at the `DATA GLOSSARY:` footer, and treats charges as positive spend by using `spend = -Amount`. Positive expense amounts therefore reduce spend as refunds or credits.
