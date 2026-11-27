# AI Support Governance

- `POST /api/support/v2/conversations/:id/ai-suggest` delegates to `buildAiSupportSuggestion` (`unified-inbox-2-0.mjs`).
- Redacts sensitive fields (`redactSensitivePayload`) and bounds message context before sending to any model adapter.
- Enforces `suggestionOnly: true`, `autoSend: false`, and `requiresHumanApproval: true` — AI never auto-sends customer messages.
- When no live AI provider credentials are configured (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`), it returns `aiAvailable: false` (`NO_LIVE_AI_PROVIDER_CONFIGURED`) instead of fabricating static AI responses.
