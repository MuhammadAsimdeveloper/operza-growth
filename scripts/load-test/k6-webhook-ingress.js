import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Operza Omnichannel High-Throughput Webhook Ingress Benchmark
 * Evaluates inbound throughput from Stripe, Twilio SMS, and WhatsApp webhooks.
 */

export const options = {
  stages: [
    { duration: '20s', target: 25 },
    { duration: '40s', target: 100 },
    { duration: '20s', target: 200 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<250'], // 95% of webhooks processed within 250ms
    http_req_failed: ['rate<0.005'],  // Less than 0.5% failure under high load
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:4000';

export default function () {
  const eventId = `evt_k6_${__VU}_${__ITER}_${Date.now()}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-request-id': `k6-webhook-${eventId}`,
  };

  // 1. Stripe payment webhook ingress
  const stripePayload = JSON.stringify({
    id: eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_bench_${Date.now()}`,
        amount: 49700,
        currency: 'usd',
      },
    },
  });

  const stripeRes = http.post(`${BASE_URL}/api/webhooks/stripe`, stripePayload, { headers });
  check(stripeRes, {
    'stripe webhook ingested': (r) => r.status === 200,
    'stripe received flag true': (r) => JSON.parse(r.body).received === true,
  });

  // 2. Twilio inbound SMS webhook ingress
  const twilioPayload = `MessageSid=SM_k6_${__VU}_${__ITER}&From=%2B15550001&To=%2B18005550100&Body=Interested+in+enterprise+tier`;
  const twilioHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-request-id': `k6-twilio-${eventId}`,
  };

  const twilioRes = http.post(`${BASE_URL}/api/webhooks/twilio`, twilioPayload, { headers: twilioHeaders });
  check(twilioRes, {
    'twilio webhook returns 200': (r) => r.status === 200,
  });

  sleep(0.5);
}
