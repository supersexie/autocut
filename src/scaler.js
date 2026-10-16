// Adds and removes worker copies (Railway replicas) to match the job list, following Railway's
// "autoscale horizontally" guide: size each pool by its waiting + running jobs, scale up at once,
// scale down one copy at a time after a quiet spell, and never act on a failed reading.
//
// Environment (on the api service):
//   RAILWAY_API_TOKEN   a Railway project token (Project → Settings → Tokens)
//   SCALE_POOLS         one entry per worker service, comma-separated:
//                         <name>=<serviceId>:<jobs per copy>:<min copies>:<max copies>
//                       name "cut" sizes by cut jobs, "render" by exports and previews, "all" by every kind.
//                       e.g. cut=svc_123:16:1:10,render=svc_456:6:1:40
//   RAILWAY_ENVIRONMENT_ID  set by Railway itself
const API = 'https://backboard.railway.com/graphql/v2';
export const POOL_KINDS = { cut: ['cut'], render: ['render', 'preview'], all: ['cut', 'render', 'preview'] };
const POLL_MS = 30_000;
const SCALE_DOWN_COOLDOWN_MS = 5 * 60_000;

/** "cut=svc:16:1:10,render=svc2:6:1:40" as pool settings. */
export function parsePools(text = process.env.SCALE_POOLS ?? '') {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, rest = ''] = entry.split('=');
      const [serviceId, per, min, max] = rest.split(':');
      return { name, kinds: POOL_KINDS[name], serviceId, per: Math.max(1, Number(per) || 1), min: Math.max(1, Number(min) || 1), max: Math.max(1, Number(max) || 1) };
    })
    .filter((p) => p.kinds && p.serviceId);
}

/** How many copies a pool wants for this much work, within its limits. */
export const desiredCopies = ({ queued, running }, pool) => Math.max(pool.min, Math.min(pool.max, Math.ceil((queued + running) / pool.per)));

/**
 * One step for one pool: up straight away, down by one at most and only after the cooldown.
 * Returns the count to set, or null to leave it.
 */
export function nextCopies(current, desired, lastDownAt, now = Date.now()) {
  if (desired > current) return desired;
  if (desired < current && now - lastDownAt >= SCALE_DOWN_COOLDOWN_MS) return current - 1;
  return null;
}

async function gql(token, query, variables, fetchImpl = fetch) {
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'Project-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body).slice(0, 300));
  return body.data;
}

export function startScaler({ db, env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const token = env.RAILWAY_API_TOKEN;
  const environmentId = env.RAILWAY_ENVIRONMENT_ID;
  const pools = parsePools(env.SCALE_POOLS);
  if (!token || !environmentId || !pools.length) return null;
  const lastDown = new Map();
  // What /health shows: each pool's copies as last seen, and the last problem (if any).
  const status = { pools: Object.fromEntries(pools.map((p) => [p.name, { min: p.min, max: p.max }])) };

  async function step(pool) {
    const load = await db.load(pool.kinds);
    const vars = { serviceId: pool.serviceId, environmentId };
    const data = await gql(token, `query ($serviceId: String!, $environmentId: String!) { serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { numReplicas } }`, vars, fetchImpl);
    const current = data.serviceInstance?.numReplicas ?? 1;
    const next = nextCopies(current, desiredCopies(load, pool), lastDown.get(pool.name) ?? 0);
    Object.assign(status.pools[pool.name], { copies: current, ...load, checkedAt: new Date().toISOString() });
    if (next === null || next === current) return;
    await gql(
      token,
      `mutation ($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`,
      { ...vars, input: { numReplicas: next } },
      fetchImpl
    );
    if (next < current) lastDown.set(pool.name, Date.now());
    status.pools[pool.name].copies = next;
    log(`[scaler] ${pool.name}: ${current} → ${next} copies (${load.queued} waiting, ${load.running} running)`);
  }

  const tick = () => {
    for (const pool of pools)
      step(pool).then(
        () => delete status.error,
        (err) => {
          status.error = `${pool.name}: ${err.message}`;
          console.error(`[scaler] ${status.error}`);
        }
      );
  };
  const timer = setInterval(tick, POLL_MS);
  setTimeout(tick, 5000).unref?.(); // a first look soon after starting
  timer.unref?.();
  log(`[scaler] watching ${pools.map((p) => `${p.name} (${p.min}–${p.max} copies, ${p.per} jobs each)`).join(', ')}`);
  return { stop: () => clearInterval(timer), step, status };
}
