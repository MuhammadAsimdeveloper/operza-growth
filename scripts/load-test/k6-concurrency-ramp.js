import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Operza Multi-Tier Concurrency Stress Test
 * Stress tests API server under 50, 100, and 500 Virtual Users (VUs).
 */

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Tier 1: 50 Concurrent VUs
    { duration: '1m', target: 50 },
    { duration: '30s', target: 100 }, // Tier 2: 100 Concurrent VUs
    { duration: '1m', target: 100 },
    { duration: '30s', target: 500 }, // Tier 3: 500 Peak Concurrent VUs
    { duration: '1m', target: 500 },
    { duration: '30s', target: 0 },   // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<600'], // Under heavy 500 VU load, p95 under 600ms
    http_req_failed: ['rate<0.02'],   // Less than 2% drop rate at absolute saturation
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'x-request-id': `k6-ramp-${__VU}-${__ITER}`,
  };

  // Mixed read & write telemetry workloads
  const endpoints = [
    { url: `${BASE_URL}/health`, method: 'GET' },
    { url: `${BASE_URL}/ready`, method: 'GET' },
    { url: `${BASE_URL}/metrics`, method: 'GET' },
    { url: `${BASE_URL}/api/admin/queue/status`, method: 'GET' },
  ];

  const target = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(target.url, { headers });

  check(res, {
    'request succeeded with 200': (r) => r.status === 200,
    'latency under 500ms': (r) => r.timings.duration < 500,
  });

  sleep(0.2);
}
