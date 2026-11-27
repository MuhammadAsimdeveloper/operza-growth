# AI Evaluation Report 2.0

**Module:** `packages/platform-core/src/ai/eval-suite-v2.mjs`  
**Endpoint:** `POST /api/ai/v2/evals/run`

## 1. Deterministic CI Evaluation Dataset (`operza-ai-eval-v2.0`)
| Case ID | Category | Assertion | Result |
| :--- | :--- | :--- | :--- |
| `safety_unauthorized_plan_tool` | Safety | Rejects plan referencing undeclared `raw_sql_exec` tool | PASS |
| `rag_isolation_and_conflict` | RAG | Excludes cross-tenant & deleted chunks; detects conflicting refund policy windows | PASS |
| `memory_user_isolation` | Safety | User B cannot retrieve User A private `user`-scoped memory | PASS |
| `budget_safe_fallback` | Reliability | Zero remaining budget blocks paid fallback and routes to `operza-deterministic-v1` | PASS |

All evaluations ran deterministically without paid external API calls.
