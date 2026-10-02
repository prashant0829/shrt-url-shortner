/**
 * Load test for the two hot paths, using autocannon.
 *
 *   npm run loadtest                       # redirects (the read path)
 *   SCENARIO=create npm run loadtest       # link creation (needs RATE_LIMIT_ENABLED=false on the server)
 *
 * Tunables: BASE_URL, DURATION (seconds), CONNECTIONS.
 * Redirects are counted as "non-2xx" by autocannon because 302 is not a 2xx; see the status table.
 */
import autocannon from 'autocannon';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
const duration = Number(process.env.DURATION ?? 10);
const connections = Number(process.env.CONNECTIONS ?? 100);
const scenario = process.env.SCENARIO ?? 'redirect';

const json = { 'content-type': 'application/json' };
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function createTarget() {
  const response = await fetch(`${base}/api/v1/links`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ url: 'https://example.com/load-test' }),
  });
  if (!response.ok) throw new Error(`Could not create a link to test: HTTP ${response.status}`);
  return (await response.json()).code;
}

function options() {
  if (scenario === 'create') {
    return {
      url: `${base}/api/v1/links`,
      method: 'POST',
      headers: json,
      // A fresh URL per request keeps every insert unique.
      setupClient: (client) => {
        let n = 0;
        client.setBody(JSON.stringify({ url: `https://example.com/load-test/${Date.now()}` }));
        client.on('response', () => {
          client.setBody(
            JSON.stringify({ url: `https://example.com/load-test/${Date.now()}-${++n}` }),
          );
        });
      },
    };
  }
  return {
    url: `${base}/${scenario === 'redirect' ? target : scenario}`,
    headers: { 'user-agent': BROWSER_UA },
  };
}

let target;
if (scenario === 'redirect') target = await createTarget();

console.log(`Scenario "${scenario}": ${connections} connections for ${duration}s against ${base}`);
const result = await autocannon({ ...options(), connections, duration });

const ms = (value) => `${value} ms`;
console.log('\nThroughput');
console.log(`  requests/sec (avg): ${Math.round(result.requests.average).toLocaleString()}`);
console.log(`  total requests    : ${result.requests.total.toLocaleString()}`);
console.log('Latency');
console.log(
  `  p50 ${ms(result.latency.p50)}   p97.5 ${ms(result.latency.p97_5)}   p99 ${ms(result.latency.p99)}   max ${ms(result.latency.max)}`,
);
console.log('Status codes');
for (const [code, count] of Object.entries(result.statusCodeStats)) {
  console.log(`  ${code}: ${count.count.toLocaleString()}`);
}
console.log(`Errors: ${result.errors}   Timeouts: ${result.timeouts}`);
if (result.statusCodeStats['429']) {
  console.log(
    '\nNote: 429s mean rate limiting rejected requests; start the server with RATE_LIMIT_ENABLED=false to measure raw throughput.',
  );
}
