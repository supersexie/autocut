// How the progress border and percentage move between the updates that come in every second or so.

export type Smooth = { shown: number; goal: number; speed: number; last: number; at: number };

export const startSmooth = (value: number): Smooth => ({ shown: value, goal: value, speed: 0, last: value, at: -1 });

/** A new value arrived at `now` (seconds): learn how fast the work is going. */
export function setGoal(s: Smooth, goal: number, now: number): Smooth {
  // Starting over (a retry, or the server taking over an export): go back with it.
  if (goal < s.shown - 0.15) return { shown: goal, goal, speed: 0, last: goal, at: now };
  if (s.at < 0) return { ...s, goal, last: goal, at: now };
  if (goal > s.last) {
    const seen = (goal - s.last) / Math.max(0.2, now - s.at);
    return { ...s, goal, speed: s.speed ? s.speed * 0.5 + seen * 0.5 : seen, last: goal, at: now };
  }
  return { ...s, goal };
}

/**
 * One frame, `dt` seconds on. It keeps the pace the work has been going at, catches up gently
 * when behind (never faster than a quarter of the way a second, so a big jump still glides), runs
 * only a little ahead of the latest value, never steps back, and finishes quickly at the end.
 */
export function step(s: Smooth, dt: number): Smooth {
  const g = s.goal;
  let v = s.shown;
  if (g >= 1) v += (1 - v) * Math.min(1, dt * 5);
  else {
    const behind = Math.max(0, g - v);
    v += Math.min(0.25, s.speed + behind * 1.2) * dt;
    v = Math.min(v, Math.min(0.99, g + Math.max(0.02, Math.min(0.08, s.speed * 1.5))));
  }
  v = Math.max(s.shown, Math.min(1, v));
  if (g >= 1 && 1 - v < 0.0005) v = 1;
  return { ...s, shown: v };
}
