# Financial & Attribution Methodology

- **Currency Separation:** `aggregateFinancialsByCurrency` groups payments by `currency` using integer minor units (`amount_cents`), never mixing USD/PKR/EUR.
- **State Distinction:** `succeeded`/`paid`/`captured` count toward `grossCollectedCents`; `refunded` reduces `netCollectedCents`; `failed`/`canceled` are tracked separately in `failedAttemptCents` and never counted as revenue.
- **Funnel Math:** `computeFunnelConversion` computes step-to-step and overall conversion rates from real source counts without fabricating missing visitor instrumentation.
