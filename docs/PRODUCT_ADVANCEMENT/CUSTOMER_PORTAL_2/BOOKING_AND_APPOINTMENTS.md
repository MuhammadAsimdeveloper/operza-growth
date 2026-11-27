# Customer Portal 2.0 — Booking & Appointments

- **Calendar V2 Integration:** Portal appointment views and booking requests use Calendar V2 (`calendar_availability_rules`, IANA timezone, buffers, min notice, max future window, time-off blocks, and PostgreSQL concurrency exclusion).
- **Self-Service Changes:** Customers can request reschedules or cancellations via `customer_portal_requests` (`booking_change`), subject to agency cancellation policies and server-side availability revalidation.
