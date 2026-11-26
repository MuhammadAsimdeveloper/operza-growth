# Phase 6 — Calendar V2 Architecture

**Repository:** `packages/db/lib/scheduling-repository.mjs` (PostgreSQL GiST exclusion in Migration 015)
**Availability Engine:** `packages/platform-core/src/scheduling/availability-v2.mjs`
**Rules Table:** `calendar_availability_rules` (Migration `038_phase6_sites_domains_ssl.sql`)

- **Timezone & DST Handling:** `computeAvailableSlots()` resolves local wall-clock availability windows in the calendar's IANA timezone via `Intl.DateTimeFormat`, returning UTC ISO timestamps without shifting stored appointments.
- **Booking Rules:** Enforces `bufferBeforeMin`, `bufferAfterMin`, `minNoticeMin`, `maxFutureDays`, `dailyLimit`, `weeklyWindows`, and `timeOffBlocks`.
- **Database Integrity:** PostgreSQL `EXCLUDE USING gist` remains the authoritative double-booking prevention boundary.
