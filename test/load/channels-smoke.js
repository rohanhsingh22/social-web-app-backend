// k6 load-test starter: guest channel read path (no auth needed).
// Requires the k6 binary: https://k6.io/docs/get-started/installation/
// Run:  k6 run --vus 100 --duration 60s test/load/channels-smoke.js
// Scale toward the Launch 1 target (5k concurrent sockets) gradually and
// watch API latency, DB CPU, and Redis memory while ramping.
//
// Authenticated socket/message scenarios need a valid access token:
// export API_TOKEN=... and extend the script with socket.io or ws calls.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '60s', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

export function setup() {
  const channels = http.get(`${BASE_URL}/channels`).json();
  const list = channels?.data?.channels ?? [];
  if (list.length === 0) {
    throw new Error('no public channels seeded; run prisma seed first');
  }
  return { slugs: list.map((channel) => channel.slug) };
}

export default function (data) {
  const slug = data.slugs[Math.floor(Math.random() * data.slugs.length)];

  const messages = http.get(
    `${BASE_URL}/channels/${slug}/messages?limit=50`,
  );
  check(messages, {
    'messages 200': (res) => res.status === 200,
    'messages has page': (res) => {
      try {
        const body = res.json();
        return Array.isArray(body?.data?.messages);
      } catch {
        return false;
      }
    },
  });

  sleep(Math.random() * 2 + 1);
}

export function teardown() {}
