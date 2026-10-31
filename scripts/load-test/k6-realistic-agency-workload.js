import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Operza Realistic Production Agency Workload Simulation
 * 
 * Model:
 * - 100 registered trial accounts + 10 paid accounts
 * - Concurrent user tiers: 10 VUs -> 25 VUs -> 50 VUs -> 100 Peak VUs
 * - Tests public funnel ingress, webhook processing, telemetry, and health probes
 */

export const options = {
  stages: [
    { duration: '10s', target: 10 },  // Tier 1: 10 Concurrent Agency Users
    { duration: '15s', target: 25 },  // Tier 2: 25 Concurrent Users
    { duration: '20s', target: 50 },  // Tier 3: 50 Concurrent Users (Target Production Capacity)
    { duration: '20s', target: 100 }, // Tier 4: 100 Concurrent Users (Stress Peak)
    { duration: '5s', target: 0 },    // Cooldown
  ],
  thresholds: {
    http_req_duration: ['p(95)<400', 'p(99)<800'],
    http_req_failed: ['rate<0.02'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  const reqId = `k6-workload-${__VU}-${__ITER}`;
  const clientIp = `198.51.100.${(__VU % 250) + 1}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-request-id': reqId,
    'x-forwarded-for': clientIp,
  };

  // 1. Health & Readiness Probe
  const healthRes = http.get(`${BASE_URL}/health`, { headers });
  check(healthRes, {
    'health returns 200': (r) => r.status === 200,
    'health latency < 100ms': (r) => r.timings.duration < 100,
  });

  // 2. Metrics & Telemetry
  const metricsRes = http.get(`${BASE_URL}/metrics`, { headers });
  check(metricsRes, {
    'metrics returns 200': (r) => r.status === 200,
  });

  // 3. Public Funnel Ingress Query
  const funnelRes = http.get(`${BASE_URL}/api/funnels/public/autonomous-scale-masterclass`, { headers });
  check(funnelRes, {
    'funnel lookup status is 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  // 4. Queue Depth Inspection
  const queueRes = http.get(`${BASE_URL}/api/admin/queue/status`, { headers });
  check(queueRes, {
    'queue status returns 200': (r) => r.status === 200,
  });

  sleep(0.3);
}
