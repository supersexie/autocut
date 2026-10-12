export const theme = {
  accent: '#3D85F5',
  cut: '#F95B5B',
  ok: '#34C759',
  ink: '#18202E',
  muted: '#6A7486',
  faint: '#8A94A6',
  line: '#EEF1F5',
  bg: '#F2F6FD',
  bgTop: '#E9F1FF',
  card: '#FFFFFF',
};

export const formatTime = (t: number) => {
  const s = Math.round(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
