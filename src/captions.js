// Builds short, punchy caption lines (UGC style) on the *output* timeline.

export function remapWords(segments) {
  const out = [];
  let offset = 0;
  for (const s of segments) {
    for (const w of s.words) {
      out.push({ text: w.text, start: offset + Math.max(0, w.start - s.start), end: offset + Math.min(s.end, w.end) - s.start });
    }
    offset += s.end - s.start;
  }
  return out;
}

export function toSrt(words, { maxWords = 4, maxChars = 22 } = {}) {
  const lines = [];
  let cur = [];
  const flush = () => cur.length && (lines.push(cur), (cur = []));
  for (const w of words) {
    const text = [...cur, w].map((x) => x.text).join(' ');
    if (cur.length >= maxWords || text.length > maxChars) flush();
    cur.push(w);
    if (/[.?!,]$/.test(w.text)) flush();
  }
  flush();
  const ts = (t) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
  };
  return lines
    .map((l, i) => {
      const end = i + 1 < lines.length ? Math.min(l.at(-1).end + 0.3, lines[i + 1][0].start) : l.at(-1).end + 0.3;
      return `${i + 1}\n${ts(l[0].start)} --> ${ts(end)}\n${l.map((w) => w.text).join(' ')}\n`;
    })
    .join('\n');
}
