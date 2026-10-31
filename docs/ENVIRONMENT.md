# Operza Environment Configuration Reference

This document provides an exhaustive inventory of all environment variables supported across the Operza application, API, worker queue, and database services.

## 1. Core Runtime Variables

| Variable | Required in Prod | Default | Description |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Yes | `development` | Runtime environment (`development`, `test`, `production`). In `production`, fail-closed rules activate. |
| `PORT` | No | `4000` | Port for the Operza Unified API server to bind to. |
| `ALLOWED_ORIGINS` | Yes | `http://localhost:5173` | Comma-delimited list of allowed CORS origins. |
| `SESSION_SECRET` | Yes | *(None)* | High-entropy 64-char hex secret used for signing session cookies. Fails closed in production. |
| `JWT_SECRET` | Yes | *(None)* | High-entropy 64-char hex secret used for token generation. Fails closed in production. |

---

## 2. Database & Storage Configuration

| Variable | Required in Prod | Default | Description |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | Yes | `postgres://operza_app:operza_app_secret@localhost:5432/operza_db` | Connection string for unprivileged application runtime role (`operza_app`). |
| `MIGRATION_DATABASE_URL` | Yes | `postgres://operza_migrator:operza_migrator_secret@localhost:5432/operza_db` | Connection string for DDL schema migrator role (`operza_migrator`). |
| `PGSSLMODE` | No | `prefer` | SSL negotiation mode for PostgreSQL (`disable`, `prefer`, `require`). |
| `DATA_FILE` | No | `./data/store.json` | Path to atomic JSON store used in zero-config dev/test environments. |

---

## 3. Distributed Redis Queue & Worker Configuration

| Variable | Required in Prod | Default | Description |
| :--- | :---: | :--- | :--- |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Connection string for Redis instance powering BullMQ distributed queues. |
| `WORKER_CONCURRENCY` | No | `5` | Maximum number of concurrent jobs processed by the worker daemon. |

---

## 4. Tiered Plan Limits & Quota Enforcement

All limits are configurable via environment variables without requiring code changes:

| Variable | Default (Trial) | Default (Paid) | Description |
| :--- | :---: | :---: | :--- |
| `PLAN_TRIAL_MAX_CONTACTS` | `500` | — | Maximum contacts allowed per trial account. |
| `PLAN_TRIAL_MAX_TEAM_MEMBERS` | `2` | — | Maximum team member seats allowed per trial account. |
| `PLAN_TRIAL_MAX_ACTIVE_WORKFLOWS` | `3` | — | Maximum active/published workflows allowed on trial. |
| `PLAN_TRIAL_MAX_MONTHLY_EXECUTIONS` | `500` | — | Monthly workflow execution quota for trial accounts. |
| `PLAN_TRIAL_MAX_STORAGE_MB` | `250` | — | Total media/document storage quota in MB for trial accounts. |
| `PLAN_PAID_MAX_CONTACTS` | — | `5000` | Maximum contacts allowed per paid account. |
| `PLAN_PAID_MAX_TEAM_MEMBERS` | — | `5` | Maximum team member seats allowed per paid account. |
| `PLAN_PAID_MAX_ACTIVE_WORKFLOWS` | — | `20` | Maximum active/published workflows allowed on paid. |
| `PLAN_PAID_MAX_MONTHLY_EXECUTIONS` | — | `5000` | Monthly workflow execution quota for paid accounts. |
| `PLAN_PAID_MAX_STORAGE_MB` | — | `2048` | Total media/document storage quota in MB (2 GB) for paid accounts. |

---

## 5. Third-Party Integrations & Webhook Secrets

| Variable | Required in Prod | Description |
| :--- | :---: | :--- |
| `STRIPE_SECRET_KEY` | Optional | Stripe API secret key for payment processing and checkout session creation. |
| `STRIPE_WEBHOOK_SECRET` | Required with Stripe | Secret used to verify `Stripe-Signature` headers on incoming payment events. |
| `WHATSAPP_VERIFY_TOKEN` | Required with WhatsApp | Handshake verification token for Meta WhatsApp Cloud API webhooks. |
| `META_VERIFY_TOKEN` | Required with Meta | Handshake verification token for Meta Messenger webhooks. |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account SID for SMS and voice dispatching. |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio authentication token for carrier message delivery. |
