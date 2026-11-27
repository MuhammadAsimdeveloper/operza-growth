# Sites 2.0 — CRM & Engagement Integration

- **Lead Capture & Forms:** Public form submissions (`forms.mjs`) and funnel opt-ins (`funnels.mjs`) resolve agency/location strictly from server-side slug/site ownership—never trusting client-supplied tenant IDs—and record consent, apply tags, and trigger Workflow Engine 2.0.
- **Booking:** `booking_form` blocks link to Calendar V2 (`/api/calendars/book/:slug`) enforcing timezone, availability, and double-booking exclusion.
