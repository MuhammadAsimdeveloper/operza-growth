# Commerce 2.0 — Invoice & Tax Localization Design

- **Invoice Lifecycle (`canTransitionInvoice`):** `draft` -> `open` -> `partially_paid` | `paid` | `overdue` | `void`. Paid and void invoices are immutable.
- **Server-Side Minor-Unit Totals (`calculateOrderTotals`):** Computes `subtotalCents`, `discountCents` (percentage or currency-matched fixed coupon), `taxCents` (explicitly configured integer minor units), and `totalCents` without floating-point arithmetic.
- **Tax Boundary:** `commerce_products.tax_metadata` stores tax jurisdiction/category/source metadata; Operza does not fabricate legal tax rates or claim automated tax compliance without an approved tax calculation engine.
- **Multi-Currency:** Currencies are validated via ISO-4217 (`^[A-Z]{3}$`) and never implicitly mixed or converted with hardcoded rates.
