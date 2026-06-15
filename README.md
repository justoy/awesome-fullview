# Full View Spending

Local Fidelity Full View spending visualizer.

## Run

```sh
python3 -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

The app loads `Transactions_Jun-15-2026 at 2.24.02 PM.csv` by default when served from this directory. You can also import another Fidelity CSV with the `Import CSV` button.

## What It Shows

- Net YTD spend, average monthly spend, highest month, and top category.
- Category or subcategory spend by month.
- Monthly spend trend.
- Category drilldown by subcategory and top descriptions.
- Filterable transaction table.

The parser skips the Fidelity title row, stops at the `DATA GLOSSARY:` footer, and treats charges as positive spend by using `spend = -Amount`. Positive expense amounts therefore reduce spend as refunds or credits.
