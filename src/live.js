import { WebSocketServer } from 'ws';

// Live progress over a WebSocket at /live, so phones don't have to ask every second or two.
//   phone → { type: 'auth', token }                    (its Supabase access token)
//   phone → { type: 'watch', ids: [cutId, …] }         (its own cuts only)
//   server → { type: 'cut', id, stage?, progress?, render? }   whenever a watched cut changes
// Workers publish each cut's changes on its own channel (queue.js); an API server listens to the
// cuts its phones are watching and passes changes on, so this works with any number of API servers
// behind a load balancer, and each change goes only to the server(s) that need it.
export function attachLive(server, { queue, db, accountFrom, log = console.log }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const watchers = new Map(); // cutId → Set<socket>

  queue.subscribe((event) => {
    const set = watchers.get(event.id);
    if (!set) return;
    const msg = JSON.stringify({ type: 'cut', ...event });
    for (const ws of set) if (ws.readyState === 1) ws.send(msg);
  });

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/live') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    let userId = null;
    const mine = new Set();
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    const authTimer = setTimeout(() => !userId && ws.close(4401, 'auth required'), 10_000);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'auth' && typeof msg.token === 'string') {
        const account = await accountFrom({ headers: { authorization: `Bearer ${msg.token}` } }).catch(() => null);
        if (!account?.id) return ws.close(4401, 'bad token');
        userId = account.id;
        clearTimeout(authTimer);
        ws.send(JSON.stringify({ type: 'ready' }));
      } else if (msg.type === 'watch' && userId && Array.isArray(msg.ids)) {
        for (const id of msg.ids.slice(0, 100)) {
          if (typeof id !== 'string' || mine.has(id)) continue;
          const cut = await db.getCut(id).catch(() => null);
          if (!cut || cut.user_id !== userId) continue; // only your own cuts
          mine.add(id);
          if (!watchers.has(id)) {
            watchers.set(id, new Set());
            queue.watch(id);
          }
          watchers.get(id).add(ws);
        }
      } else if (msg.type === 'unwatch' && Array.isArray(msg.ids)) {
        for (const id of msg.ids) drop(id);
      }
    });

    const drop = (id) => {
      mine.delete(id);
      const set = watchers.get(id);
      set?.delete(ws);
      if (set && !set.size) {
        watchers.delete(id);
        queue.unwatch(id);
      }
    };
    ws.on('close', () => {
      clearTimeout(authTimer);
      for (const id of [...mine]) drop(id);
    });
  });

  // Drop connections that stopped answering (phone locked, network gone).
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25_000);
  ping.unref?.();
  log('Live progress on /live');
  return { connections: () => wss.clients.size, close: () => (clearInterval(ping), wss.close()) };
}
