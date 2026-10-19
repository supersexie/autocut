// Monochrome: white surfaces, near-black type and buttons, light grey cards.
export const theme = {
  accent: '#111114', // primary actions and selection
  ink: '#111114',
  muted: '#6B6B73',
  faint: '#A1A1A8',
  line: '#EDEDF0',
  bg: '#FFFFFF',
  page: '#F4F4F6', // behind cards on the You, Cuts and Settings screens
  card: '#F5F5F7',
  tint: 'rgba(17,17,20,0.06)', // soft fill behind icons and selected tracks
  disabled: '#C7C7CC',
  cut: '#F2545B',
  blue: '#3D6BFF', // highlights: charts, the ring, sliders, icons, a word in a title (the website's blue)
  blueTile: 'rgba(61,107,255,0.1)', // the pale tile behind a blue icon
  blueTileOn: 'rgba(61,107,255,0.16)', // …when its card is picked
  blueLine: 'rgba(61,107,255,0.4)', // the thin line round a picked card
  ok: '#2FB463',
  danger: '#D93B3B',
};

export const formatTime = (t: number) => {
  const s = Math.round(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Widest a column of text and controls gets on iPad, so lines stay readable. iPhones are narrower. */
export const COLUMN = 560;
/** Wider column for grids of thumbnails. */
export const WIDE_COLUMN = 760;
/** Centres a screen's content in a column on iPad; on iPhone it just fills the width. */
export const column = (maxWidth = COLUMN) => ({ width: '100%' as const, maxWidth, alignSelf: 'center' as const });

/**
 * A label in the middle of a sentence: "Product videos" → "product videos", but words in capitals
 * and names in mixed case stay as they are ("UGC for brands", "TikTok", "Unlimited AI edits" → "unlimited AI edits").
 */
export const midSentence = (text: string) => text.replace(/\b(\p{Lu})(\p{Ll}+)\b/gu, (_, a: string, b: string) => a.toLowerCase() + b);
