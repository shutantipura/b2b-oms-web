
// Phase 1: deliberately safe HTTP-only load test of public Next.js page responses.
// NO authentication, database writes, orders, image uploads, or Supabase secrets.
// This does not execute browser JavaScript or measure database RPCs.

import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET = (__ENV.OMS_TARGET_URL || '').replace(/\/$/, '');
const PROFILE = __ENV.OMS_TEST_PROFILE || 'smoke';

// Only allow the known OMS domain. Change intentionally for an approved staging domain.
if (TARGET !== 'https://b2b-oms-web.vercel.app') {
  throw new Error('Unsafe or missing OMS_TARGET_URL. This script is restricted to the OMS website.');
}

if (PROFILE !== 'smoke' && PROFILE !== 'twenty_users') {
  throw new Error('OMS_TEST_PROFILE must be smoke or twenty_users.');
}

const ROUTES = [
  '/login',
  '/miniapp',
  '/tasks',
  '/orders',
  '/kpi',
  '/catalog',
];

export const options = {
  discardResponseBodies: true,
  noConnectionReuse: false,
  userAgent: 'Lotus-B2B-OMS-ReadOnly-LoadTest/1.0',

  scenarios: PROFILE === 'twenty_users'
    ? {
        website_20_users: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '30s', target: 5 },
            { duration: '30s', target: 20 },
            { duration: '2m', target: 20 },
            { duration: '30s', target: 0 },
          ],
          gracefulRampDown: '5s',
        },
      }
    : {
        quick_smoke: {
          executor: 'shared-iterations',
          vus: 2,
          iterations: 8,
          maxDuration: '90s',
        },
      },

  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const route = ROUTES[Math.floor(Math.random() * ROUTES.length)];

  const response = http.get(`${TARGET}${route}`, {
    timeout: '15s',

    // Prevent tests from unintentionally following future redirects to LINE.
    redirects: 0,

    headers: {
      Accept: 'text/html',
    },

    tags: {
      page: route,
    },
  });

  check(response, {
    'page returns HTTP 200': (r) => r.status === 200,
  });

  // Slow down virtual users to resemble normal human navigation.
  sleep(4 + Math.random() * 3);
}
