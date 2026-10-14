// Decides what to keep from a raw take, given word timestamps (and optionally loudness).
// Pure and synchronous so it can be unit tested without models or ffmpeg.

export const DEFAULTS = {
  maxGap: 0.3, // pauses longer than this between kept words become cuts
  phraseGap: 0.45, // a pause this long also ends a phrase for retake detection
  padIn: 0.06, // breathing room kept before a word
  padOut: 0.12, // and after it
  retakeLookahead: 3, // how many phrases ahead to look for a re-delivery
  retakeSimilarity: 0.6,
  minSegment: 0.25,
  removeFillers: true,
  removeRetakes: true,
};

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'hmm', 'mm', 'ah', 'ahh']);

export const norm = (t) => t.toLowerCase().replace(/[^a-z0-9']/g, '');
const endsSentence = (t) => /[.?!]["')\]]*$/.test(t.trim());

export function splitPhrases(words, phraseGap) {
  const phrases = [];
  let cur = [];
  words.forEach((w, i) => {
    if (cur.length && w.start - words[i - 1].end > phraseGap) {
      phrases.push(cur);
      cur = [];
    }
    cur.push(i);
    if (endsSentence(w.text)) {
      phrases.push(cur);
      cur = [];
    }
  });
  if (cur.length) phrases.push(cur);
  return phrases;
}

function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

// How strongly does `later` look like a re-delivery of `earlier`? Compares earlier against
// the opening of later, so "They dry" -> "They dry super quick." scores 1.
export function retakeScore(earlier, later) {
  const a = earlier.filter(Boolean);
  const b = later.filter(Boolean);
  // A single word ("So.", "And") repeating is normal speech, not a retake.
  if (a.length < 2 || !b.length) return 0;
  return lcs(a, b.slice(0, a.length + 1)) / a.length;
}

const RESTART_MIN_MATCH = 3; // words that must repeat for a restart to count
const RESTART_MAX_FLUB = 3; // extra words allowed in the abandoned attempt ("…they dry super, uh, hm")
const RESTART_WINDOW = 30; // seconds to look ahead for the redo

/**
 * Finds abandoned attempts: a run of words that the speaker then starts again from the top.
 * "they dry super they dry super quick" → drops the first "they dry super". Scanning on from the
 * redo means a line said three or more times keeps only the last delivery.
 * Returns the word indexes to drop.
 */
export function findRestarts(words, drop = new Map()) {
  const idx = words.map((_, i) => i).filter((i) => !drop.has(i) && norm(words[i].text));
  const tok = idx.map((i) => norm(words[i].text));
  const out = [];
  let a = 0;
  while (a < idx.length) {
    let found = null;
    for (let b = a + RESTART_MIN_MATCH; b < idx.length; b++) {
      if (words[idx[b]].start - words[idx[a]].start > RESTART_WINDOW) break;
      if (tok[b] !== tok[a]) continue;
      let len = 0;
      while (a + len < b && b + len < idx.length && tok[a + len] === tok[b + len]) len++;
      const flub = b - a - len;
      if (len < RESTART_MIN_MATCH || flub > RESTART_MAX_FLUB) continue;
      // If the unmatched tail finished a sentence, it was a different line, not a redo
      // ("Check them out. They're nice. Check them out below.").
      if (flub > 1 && idx.slice(a + len, b).some((i) => endsSentence(words[i].text))) continue;
      found = b;
      break;
    }
    if (found === null) {
      a++;
      continue;
    }
    for (let k = a; k < found; k++) out.push(idx[k]);
    a = found;
  }
  return out;
}

export function planCuts(words, opts = {}, level = null) {
  const o = { ...DEFAULTS, ...opts };
  const drop = new Map(); // word index -> reason

  if (o.removeFillers)
    words.forEach((w, i) => FILLERS.has(norm(w.text)) && drop.set(i, 'filler'));

  // Stutters: "the the", "I- I".
  for (let i = 0; i + 1 < words.length; i++) {
    const a = norm(words[i].text);
    if (a && a === norm(words[i + 1].text) && words[i + 1].start - words[i].end < 0.6) drop.set(i, 'stutter');
  }

  // Restarts anywhere in the word stream, even when Whisper ran both attempts into one line.
  if (o.removeRetakes) for (const i of findRestarts(words, drop)) drop.set(i, 'retake');

  // Retakes: when a phrase is said again shortly after, keep the last delivery.
  const phrases = o.removeRetakes ? splitPhrases(words, o.phraseGap) : [];
  const tokens = phrases.map((p) => p.filter((i) => !drop.has(i)).map((i) => norm(words[i].text)));
  for (let p = 0; p < phrases.length; p++) {
    for (let q = p + 1; q <= Math.min(phrases.length - 1, p + o.retakeLookahead); q++) {
      if (tokens[p].length && retakeScore(tokens[p], tokens[q]) >= o.retakeSimilarity) {
        phrases[p].forEach((i) => drop.has(i) || drop.set(i, 'retake'));
        break;
      }
    }
  }

  // Group kept words into continuous segments, splitting on long pauses.
  const kept = words.map((w, i) => ({ ...w, i })).filter((w) => !drop.has(w.i));
  const raw = [];
  for (const w of kept) {
    const last = raw.at(-1);
    if (last && w.start - last.end <= o.maxGap && w.i === last.lastIndex + 1) {
      last.end = w.end;
      last.lastIndex = w.i;
    } else {
      raw.push({ start: w.start, end: w.end, firstIndex: w.i, lastIndex: w.i });
    }
  }

  const duration = words.length ? words.at(-1).end : 0;
  const segments = raw.map((s, k) => {
    const prevEnd = k ? raw[k - 1].end : 0;
    const nextStart = k + 1 < raw.length ? raw[k + 1].start : Infinity;
    let start = Math.max(0, s.start - o.padIn, (prevEnd + s.start) / 2);
    let end = Math.min(s.end + o.padOut, (s.end + nextStart) / 2);
    if (level) [start, end] = snapToAudio(level, start, end, s, o);
    // Never reach into a neighbouring word that's being cut (an "um" right after, say), or past the audio.
    const before = words[s.firstIndex - 1];
    const after = words[s.lastIndex + 1];
    if (before) start = Math.max(start, (before.end + s.start) / 2);
    if (after) end = Math.min(end, (s.end + after.start) / 2);
    if (level) end = Math.min(end, level.db.length * level.frameSec);
    return { start, end, words: words.slice(s.firstIndex, s.lastIndex + 1).filter((_, j) => !drop.has(s.firstIndex + j)) };
  }).filter((s) => s.end - s.start >= o.minSegment);

  // Merge segments that now touch or overlap after padding.
  const merged = [];
  for (const s of segments) {
    const last = merged.at(-1);
    if (last && s.start - last.end < 0.02) {
      last.end = Math.max(last.end, s.end);
      last.words.push(...s.words);
    } else merged.push({ ...s, words: [...s.words] });
  }

  // Whisper sometimes stretches a word across a pause ("and" lasting 4 s), which hides the
  // silence from the word-gap check above. The audio is the truth: cut long quiet runs inside
  // kept speech too, and trim quiet tails at the edges.
  const final = level ? splitOnSilence(merged, level, o) : merged;

  const cuts = describeCuts(words, drop, final, Math.max(duration, level ? level.db.length * level.frameSec : 0));
  return { segments: final, cuts, dropped: drop, words: level ? clampWords(words, final) : words };
}

// Quiet runs in [start, end): frames at or below the noise floor, ignoring loud blips under
// 40 ms (clicks, a tap on the mic) so they don't break a pause in two.
function quietRuns({ db, frameSec, floor }, start, end) {
  const f0 = Math.max(0, Math.floor(start / frameSec));
  const f1 = Math.min(db.length, Math.ceil(end / frameSec));
  const quiet = [];
  for (let f = f0; f < f1; f++) quiet.push(db[f] <= floor);
  for (let i = 0; i < quiet.length; ) {
    if (quiet[i]) { i++; continue; }
    let j = i;
    while (j < quiet.length && !quiet[j]) j++;
    if (j - i < 4 && i > 0 && j < quiet.length) for (let k = i; k < j; k++) quiet[k] = true;
    i = j;
  }
  const runs = [];
  for (let i = 0; i < quiet.length; ) {
    if (!quiet[i]) { i++; continue; }
    let j = i;
    while (j < quiet.length && quiet[j]) j++;
    runs.push([(f0 + i) * frameSec, Math.min(end, (f0 + j) * frameSec)]);
    i = j;
  }
  return runs;
}

export function splitOnSilence(segments, level, o) {
  const out = [];
  for (const seg of segments) {
    const pieces = [];
    let cursor = seg.start;
    // Quiet stretches, but never inside a word: soft syllables can dip as low as the room.
    for (const [a, b] of outsideWords(quietRuns(level, seg.start, seg.end), seg.words)) {
      const atStart = a <= seg.start + level.frameSec;
      const atEnd = b >= seg.end - level.frameSec;
      if (atStart && atEnd) break; // all quiet: more likely soft speech than silence, keep it
      if (atStart) {
        if (b - a > o.padIn) cursor = b - o.padIn;
      } else if (atEnd) {
        if (b - a > o.padOut) { pieces.push([cursor, a + o.padOut]); cursor = seg.end; }
      } else if (b - a > o.maxGap + o.padIn) {
        pieces.push([cursor, a + o.padOut]);
        cursor = b - o.padIn;
      }
    }
    if (cursor < seg.end - 0.01) pieces.push([cursor, seg.end]);
    for (const [start, end] of pieces) {
      if (end - start < 0.12) continue;
      out.push({ start, end, words: seg.words.filter((w) => w.end > start && w.start < end) });
    }
  }
  return out;
}

// Pull word timings inside the pieces they're kept in, so captions don't hang over a cut.
function clampWords(words, segments) {
  return words.map((w) => {
    const seg = segments.find((s) => w.end > s.start && w.start < s.end);
    if (!seg) return w;
    return { ...w, start: Math.max(w.start, seg.start), end: Math.min(w.end, seg.end) };
  });
}

// Whisper word boundaries are often a little early on the tail. Extend a segment's edges
// while the audio is still loud, but never more than a short distance.
function snapToAudio({ db, frameSec, floor }, start, end, s, o) {
  const thresh = floor;
  const loud = (t) => db[Math.max(0, Math.min(db.length - 1, Math.floor(t / frameSec)))] > thresh;
  let e = end;
  const maxE = s.end + o.padOut + 0.25;
  while (e < maxE && loud(e)) e += frameSec;
  let st = start;
  const minS = Math.max(0, s.start - o.padIn - 0.15);
  while (st > minS && loud(st - frameSec)) st -= frameSec;
  return [st, e];
}

// Whisper sometimes stretches a word over a pause ("and" lasting 4 s). Words longer than this
// are treated as hiding silence: they don't vouch for the audio under them.
const MAX_WORD = 1.2;

/**
 * The level at or below which the audio counts as silence. With `words` it sits between the room's
 * background (the audio between words) and the speech (each word's peak), 40% of the way up but no
 * more than 12 dB over the background. In a noisy room, over music or with a quiet voice the two
 * are close, and a floor taken from the quietest audio alone would call soft speech silence.
 */
export function noiseFloor(db, words = [], frameSec = 0.01) {
  const sorted = Float32Array.from(db).sort();
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? -60;
  const simple = Math.max(p10 + 12, -48);
  const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const inWord = new Uint8Array(db.length);
  const peaks = [];
  for (const w of words) {
    if (w.end - w.start > MAX_WORD) continue;
    const f0 = Math.max(0, Math.floor(w.start / frameSec));
    const f1 = Math.min(db.length, Math.ceil(w.end / frameSec));
    if (f1 <= f0) continue;
    inWord.fill(1, f0, f1);
    const frames = Array.from(db.subarray(f0, f1)).sort((a, b) => a - b);
    peaks.push(frames[Math.floor(frames.length * 0.9)]); // the word's loud part
  }
  if (peaks.length < 3) return simple;
  const speech = median(peaks);
  const between = Array.from(db).filter((_, f) => !inWord[f]);
  if (between.length < 30) return Math.min(simple, speech - 15); // no pauses to measure the room from
  const noise = median(between);
  return noise + Math.min(12, Math.max(3, (speech - noise) * 0.4));
}

/**
 * `runs` with the start of each recognized word taken out, so a soft syllable is never cut. Only
 * the first PROTECT_WORD seconds: Whisper often runs a sentence's last word on into the pause after
 * it, and that tail should still be trimmed.
 */
const PROTECT_WORD = 0.35;
function outsideWords(runs, words) {
  let out = runs;
  for (const w of words) {
    if (w.end - w.start > MAX_WORD) continue;
    const end = Math.min(w.end, w.start + PROTECT_WORD);
    out = out.flatMap(([a, b]) => (end <= a || w.start >= b ? [[a, b]] : [[a, w.start], [end, b]].filter(([x, y]) => y - x > 0.005)));
  }
  return out;
}

function describeCuts(words, drop, segments, duration) {
  const cuts = [];
  let t = 0;
  for (const s of segments) {
    if (s.start - t > 0.01) cuts.push(cutBetween(words, drop, t, s.start));
    t = s.end;
  }
  if (duration - t > 0.01) cuts.push(cutBetween(words, drop, t, duration));
  return cuts;
}

function cutBetween(words, drop, start, end) {
  const inside = words.map((w, i) => ({ w, i })).filter(({ w }) => w.start >= start - 0.05 && w.end <= end + 0.05);
  const reasons = new Set(inside.map(({ i }) => drop.get(i)).filter(Boolean));
  const reason = reasons.has('retake') ? 'retake' : reasons.has('stutter') ? 'stutter' : reasons.has('filler') ? 'filler' : 'dead air';
  return { start: +start.toFixed(3), end: +end.toFixed(3), reason, text: inside.map(({ w }) => w.text).join(' ') };
}
