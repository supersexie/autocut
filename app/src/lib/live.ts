import { serverUrl } from './api';
import { supabase } from './supabase';

/**
 * Live progress from the server (a WebSocket at /live): instead of asking about each cut every
 * second or so, screens wait here and wake the moment the server says something changed. If the
 * connection is down they still wake on a short timer, so nothing depends on it.
 */
export type LiveEvent = { id: string; stage?: string; progress?: number; render?: { id: string; stage: string; progress: number } };

let socket: WebSocket | null = null;
let ready = false;
let retry = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const watched = new Map<string, Set<(e: LiveEvent) => void>>();

const send = (msg: object) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
};

async function connect() {
  if (socket || !watched.size) return;
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : 'local';
  if (!token) return;
  const ws = new WebSocket(serverUrl().replace(/^http/, 'ws') + '/live');
  socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = (m) => {
    let msg: { type: string } & LiveEvent;
    try {
      msg = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      ready = true;
      retry = 0;
      send({ type: 'watch', ids: [...watched.keys()] });
    } else if (msg.type === 'cut') watched.get(msg.id)?.forEach((fn) => fn(msg));
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    ready = false;
    if (!watched.size) return;
    // Back off: 1 s, 2 s, 4 s … up to 30 s (a server without /live just keeps the timers working).
    reconnectTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
  };
  ws.onerror = () => ws.close();
}

/** Calls `fn` with each change to cut `id` until the returned function is called. */
export function watchCut(id: string, fn: (e: LiveEvent) => void) {
  if (!watched.has(id)) {
    watched.set(id, new Set());
    send({ type: 'watch', ids: [id] });
  }
  watched.get(id)!.add(fn);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  connect();
  return () => {
    const set = watched.get(id);
    set?.delete(fn);
    if (set && !set.size) {
      watched.delete(id);
      send({ type: 'unwatch', ids: [id] });
    }
    // Nothing watched any more: keep the connection a little while (screens re-watch between checks),
    // then close it.
    if (!watched.size && !idleTimer) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (watched.size) return;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        socket?.close();
      }, 30_000);
    }
  };
}

/** Whether pushes are arriving right now (screens then check far less often). */
export const isLive = () => ready;

/**
 * Waits until cut `id` changes or `ms` passes (much longer when live: the push wakes it), and
 * resolves with the change, if any.
 */
export function nextChange(id: string, ms: number): Promise<LiveEvent | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (e: LiveEvent | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(e);
    };
    const stop = watchCut(id, finish);
    const timer = setTimeout(() => finish(null), isLive() ? Math.max(ms, 15_000) : ms);
  });
}
