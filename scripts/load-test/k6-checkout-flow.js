import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Operza High-Concurrency Checkout Flow Load Test
 * Simulates concurrent prospective buyers discovering a public funnel,
 * reviewing products/order-bumps, and executing high-velocity checkouts.
 */

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp up to 20 users
    { duration: '1m', target: 50 },   // Sustained load at 50 users
    { duration: '30s', target: 100 }, // Peak burst to 100 users
    { duration: '30s', target: 0 },   // Graceful ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'], // 95% of requests must complete below 400ms
    http_req_failed: ['rate<0.01'],    // Error rate must remain under 1%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'x-request-id': `k6-bench-${__VU}-${__ITER}-${Date.now()}`
  };

  // 1. Health check & latency baseline
  const healthRes = http.get(`${BASE_URL}/health`, { headers });
  check(healthRes, {
    'health returns 200': (r) => r.status === 200,
    'health indicates healthy': (r) => JSON.parse(r.body).status === 'healthy',
  });

  // 2. Discover public funnel
  const funnelLookup = http.get(`${BASE_URL}/api/funnels/public/scale-masterclass`, { headers });
  check(funnelLookup, {
    'funnel lookup returns 200': (r) => r.status === 200,
  });

  // 3. Submit lead opt-in with order bump
  const leadPayload = JSON.stringify({
    firstName: `Buyer_${__VU}`,
    lastName: `Iteration_${__ITER}`,
    email: `loadbuyer_${__VU}_${__ITER}_${Date.now()}@operza-bench.io`,
    phone: `+1555${String(__VU).padStart(3, '0')}${String(__ITER % 1000).padStart(4, '0')}`,
    bumpAccepted: true,
  });

  const optinRes = http.post(`${BASE_URL}/api/funnels/optin/scale-masterclass`, leadPayload, { headers });
  check(optinRes, {
    'optin returns 201': (r) => r.status === 201,
    'order created': (r) => JSON.parse(r.body).order !== undefined,
  });

  sleep(1);
}
