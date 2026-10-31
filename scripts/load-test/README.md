# Operza Performance & Load Testing Suite

This directory contains automated k6 stress and performance verification scripts for the Operza Unified Operating System.

## Prerequisites

Install [k6](https://k6.io/docs/get-started/installation/):
```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows (winget or chocolatey)
winget install k6 --source winget
```

## Test Profiles

### 1. Funnel Checkout & Order Bump Flow (`k6-checkout-flow.js`)
Simulates realistic prospective leads hitting public funnels, rendering checkout components, and submitting 1-click order bumps under 20–100 concurrent virtual users (VUs).

```bash
k6 run scripts/load-test/k6-checkout-flow.js
```

### 2. High-Throughput Omnichannel Webhook Ingress (`k6-webhook-ingress.js`)
Tests inbound burst traffic from payment providers (Stripe) and telephony/messaging carriers (Twilio, WhatsApp), evaluating signature processing, replay deduplication, and queue absorption under up to 200 concurrent requests.

```bash
k6 run scripts/load-test/k6-webhook-ingress.js
```

### 3. Multi-Tier Concurrency Ramp (`k6-concurrency-ramp.js`)
Evaluates system degradation boundaries with staged scaling from 50 to 100 to 500 simultaneous virtual users.

```bash
k6 run scripts/load-test/k6-concurrency-ramp.js
```

## Configuration

Pass custom target endpoints via the `API_URL` environment variable:
```bash
API_URL=http://prod-api.operza.io:4000 k6 run scripts/load-test/k6-checkout-flow.js
```
