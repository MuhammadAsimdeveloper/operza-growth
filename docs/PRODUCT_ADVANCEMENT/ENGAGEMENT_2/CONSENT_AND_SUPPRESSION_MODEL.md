# Engagement 2.0 — Consent, Suppression & Frequency Model

- **Boundary:** `evaluateRecipientEligibility` checks:
  1. Centralized `engagement_suppression_list` (`channel` or `'all'`).
  2. Latest `communication_consents` record (missing marketing consent fails closed; later `revoked` overrides earlier `granted`; expired consent fails closed).
  3. Per-contact frequency cap (`recentSendCount >= maxSendsPerWindow`).
  4. Agency-timezone quiet hours (`isWithinQuietHours` using `Intl.DateTimeFormat` with IANA timezone).
- **Legal Review Note:** Regional compliance regimes (TCPA, GDPR, CAN-SPAM, CASL, A2P 10DLC) require legal review by the agency operator before enabling live messaging; Operza does not claim automatic legal certification.
