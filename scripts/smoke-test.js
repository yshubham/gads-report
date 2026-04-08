/* eslint-disable no-console */
const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const USERNAME = process.env.SMOKE_USERNAME || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';

function parseSetCookie(headers) {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return '';
  return setCookie.split(';')[0];
}

async function jsonFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function run() {
  const failures = [];

  const meNoAuth = await jsonFetch('/api/me', { method: 'GET' });
  if (meNoAuth.res.status !== 200 || meNoAuth.data.authenticated !== false) {
    failures.push('Expected unauthenticated /api/me before login');
  }

  const protectedNoAuth = await jsonFetch('/api/brands', { method: 'GET' });
  if (protectedNoAuth.res.status !== 401) {
    failures.push('Expected /api/brands to return 401 without auth');
  }

  if (USERNAME && PASSWORD) {
    const login = await jsonFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    if (!login.res.ok || !login.data.success) {
      failures.push('Login failed with provided smoke credentials');
    } else {
      const cookie = parseSetCookie(login.res.headers);
      const meAuth = await jsonFetch('/api/me', {
        method: 'GET',
        headers: cookie ? { Cookie: cookie } : {},
      });
      if (meAuth.data.authenticated !== true) {
        failures.push('Expected authenticated /api/me after login');
      }
    }
  } else {
    console.log('Skipping login smoke checks (set SMOKE_USERNAME and SMOKE_PASSWORD).');
  }

  if (failures.length) {
    failures.forEach((f) => console.error(`FAIL: ${f}`));
    process.exit(1);
  }
  console.log('Smoke tests passed.');
}

run().catch((e) => {
  console.error('Smoke test error:', e && e.message ? e.message : e);
  process.exit(1);
});
