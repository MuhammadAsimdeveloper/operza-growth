# Commerce 2.0 — Financial Ledger Design

- **Append-Only Hash Chain:** `billing_ledger_accounts` & `billing_ledger_entries` (Migrations `013`, `033`) store integer minor units (`amount_cents`, `running_balance_cents`) and SHA-256 `checksum` linked to the previous entry (`GENESIS` -> entry N).
- **Cryptographic Verification:** `verifyLedgerEntriesChain` and `commerce2Repo.verifyLedgerIntegrity(tx)` recompute running balances and SHA-256 checksums sequentially to detect tampering or drift.
- **Non-Destructive Reversals:** Refunds and adjustments never delete or mutate historical entries; `requestRefund` posts a `debit` reversal entry (`reference_type = 'refund_reversal'`, `idempotency_key = 'ledger_' + key`).
- **Disclaimer:** Formal accounting-system certification requires qualified external accounting review.
