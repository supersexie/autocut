import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { DEFAULT_CAPTIONS, makeClip, totalDuration, type Edit } from './edit';

export type CutReason = 'dead air' | 'filler' | 'stutter' | 'retake';
export type Cut = { start: number; end: number; reason: CutReason; text: string };
export type Word = { text: string; start: number; end: number };
/** A kept [start, end] range of the source video, in play order. */
export type Clip = [number, number];

export type CutStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export type CutRecord = {
  id: string;
  serverId?: string;
  createdAt: string;
  title: string;
  status: CutStatus;
  stage?: string;
  /** When the server is due to cut it (ms since 1970), for an edit scheduled in a batch. */
  scheduledFor?: number;
  progress: number; // 0–1 for the current status
  error?: string;
  takes: number;
  /** First raw take on this phone, for the thumbnail while cutting. */
  previewUri?: string;
  /** The raw preview is a mirrored selfie take; show it flipped until the server's version arrives. */
  previewFlip?: boolean;
  /** The take on this phone, when it's the very file the server cuts (one take, not flipped). */
  localSource?: string;
  /** The folder it's filed in; none = the main Cuts page. */
  folderId?: string;
  /** The source's loudness for the timeline's waveform: 0–100, `rate` points a second. */
  waveform?: { rate: number; peaks: number[] };
  /** What was sent, so a failed cut can be tried again. */
  retry?: { takes: { uri: string; mime: string; duration: number; flip?: boolean }[]; language: string; blend?: boolean; batch?: boolean; at?: number };
  duration: number;
  words: Word[];
  cuts: Cut[]; // what Autocut removed originally
  clips: Clip[]; // what Autocut kept originally (source ranges)
  edit?: Edit; // the user's edit; created from `clips` the first time the editor opens
  source?: string; // file name of the downloaded source video in the cuts folder
  exports: number;
};

export type Settings = {
  maxGap: number;
  removeFillers: boolean;
  removeRetakes: boolean;
  captions: boolean;
  /** New cuts blend each clip's sound into the next (Pro and Ultimate). */
  overlapAudio: boolean;
  /** Keep iOS's default of flipping front-camera videos like a mirror. */
  /** Keep selfie (front camera) videos mirrored, like the camera preview. Off = as others see you. */
  mirrorSelfie: boolean;
  tourDone: boolean;
  /** The tour of the main sections (record, import, Cuts, Batch, You) has been seen. */
  cameraTourDone: boolean;
  ratingAsked: boolean;
  serverUrl: string; // empty = use the Mac running the dev server
  /** Folder new cuts are filed in, chosen on the camera; empty = the main Cuts page. */
  saveFolder: string;
};

export type Folder = { id: string; name: string; createdAt: string };

const DEFAULT_SETTINGS: Settings = { maxGap: 0.3, removeFillers: true, removeRetakes: true, captions: true, overlapAudio: true, mirrorSelfie: false, tourDone: false, cameraTourDone: false, ratingAsked: false, serverUrl: '', saveFolder: '' };

export const cutsDir = new Directory(Paths.document, 'cuts');
/** The editor's stitched previews (see previewOf in api.ts), named `<cut id>-<key>.mp4`. */
export const previewsDir = new Directory(Paths.cache, 'previews');

const thumbnailsDir = new Directory(Paths.cache, 'VideoThumbnails'); // where expo-video-thumbnails writes

/** Bytes used by things Autocut can make again: editor previews and thumbnails. */
export function cacheBytes() {
  let bytes = 0;
  for (const dir of [previewsDir, thumbnailsDir]) {
    if (dir.exists) for (const f of dir.list()) if (f instanceof File) bytes += f.size ?? 0;
  }
  return bytes;
}

export function clearCache() {
  for (const dir of [previewsDir, thumbnailsDir]) if (dir.exists) dir.delete();
}

/** Deletes a cut's previews, except `keep`. */
export function deletePreviews(cutId: string, keep?: string) {
  if (!previewsDir.exists) return;
  for (const f of previewsDir.list()) if (f instanceof File && f.name.startsWith(`${cutId}-`) && f.name !== keep) f.delete();
}
const indexFile = new File(cutsDir, 'index-v2.json');
const settingsFile = new File(Paths.document, 'settings.json');
const foldersFile = new File(Paths.document, 'folders.json');

function readJson<T>(file: File, fallback: T): T {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as T) : fallback;
  } catch {
    return fallback;
  }
}

cutsDir.create({ intermediates: true, idempotent: true });

let state = {
  cuts: readJson<CutRecord[]>(indexFile, []),
  settings: { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(settingsFile, {}) },
  folders: readJson<Folder[]>(foldersFile, []),
};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const emit = () => listeners.forEach((l) => l());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Progress ticks arrive often; write the index at most twice a second.
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => indexFile.write(JSON.stringify(state.cuts)), 500);
};

export const cutFile = (name: string) => new File(cutsDir, name);
export const getCut = (id: string) => state.cuts.find((c) => c.id === id);
export const getCuts = () => state.cuts;

export function addCut(record: CutRecord) {
  state = { ...state, cuts: [record, ...state.cuts.filter((c) => c.id !== record.id)] };
  persist();
  emit();
}

export function updateCut(id: string, patch: Partial<CutRecord>) {
  state = { ...state, cuts: state.cuts.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
  persist();
  emit();
}

/** The cut's last export, if it has one on this phone. */
export const exportFile = (cut: CutRecord) => cutFile(`${cut.id}-export.mp4`);

/** A copy of a finished cut with its own copy of the video, to try a different edit. Returns its id. */
export function duplicateCut(id: string) {
  const cut = getCut(id);
  if (!cut?.source || cut.status !== 'ready') return;
  const copyId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const source = `${copyId}-source.mp4`;
  cutFile(cut.source).copy(cutFile(source));
  // Its own copies of the song and overlay files, so deleting one cut never breaks the other.
  const own = (name: string) => {
    const copy = name.replace(cut.id, copyId);
    if (cutFile(name).exists && !cutFile(copy).exists) cutFile(name).copy(cutFile(copy));
    return copy;
  };
  const edit: Edit | undefined = cut.edit && JSON.parse(JSON.stringify(cut.edit));
  if (edit?.music) edit.music.file = own(edit.music.file);
  edit?.overlays?.forEach((o) => (o.file = own(o.file)));
  addCut({
    ...cut,
    id: copyId,
    createdAt: new Date().toISOString(),
    title: `${cut.title} (copy)`,
    source,
    exports: 0,
    edit,
  });
  return copyId;
}

/** A cut's source video and its last export. */
function removeFiles(cut: CutRecord) {
  for (const file of [cut.source && cutFile(cut.source), exportFile(cut)]) if (file && file.exists) file.delete();
}

export function deleteCut(id: string) {
  const record = getCut(id);
  if (record) removeFiles(record);
  deletePreviews(id);
  // Songs and overlays added in the editor (every one kept, so undo can bring an earlier one back).
  if (cutsDir.exists)
    for (const f of cutsDir.list()) if (f instanceof File && (f.name.startsWith(`${id}-music-`) || f.name.startsWith(`${id}-overlay-`))) f.delete();
  state = { ...state, cuts: state.cuts.filter((c) => c.id !== id) };
  persist();
  emit();
}

/** Removes every cut and its videos from this phone. */
export function clearCuts() {
  for (const c of state.cuts) {
    removeFiles(c);
    deletePreviews(c.id);
  }
  state = { ...state, cuts: [], folders: [] };
  indexFile.write('[]');
  foldersFile.write('[]');
  emit();
}

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  settingsFile.write(JSON.stringify(state.settings));
  emit();
}

export const getSettings = () => state.settings;

// ---- Folders: a way to group cuts (one product, one brand…). They live on this phone.

function saveFolders(folders: Folder[]) {
  state = { ...state, folders };
  foldersFile.write(JSON.stringify(folders));
  emit();
}

export const useFolders = () => useSyncExternalStore(subscribe, () => state.folders);
export const getFolders = () => state.folders;
export const folderName = (id?: string) => state.folders.find((f) => f.id === id)?.name;

/** Makes a folder (or returns the one that already has this name) and gives back its id. */
export function createFolder(name: string) {
  const clean = name.trim().slice(0, 40);
  const existing = state.folders.find((f) => f.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.id;
  const folder: Folder = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, createdAt: new Date().toISOString() };
  saveFolders([...state.folders, folder]);
  return folder.id;
}

export function renameFolder(id: string, name: string) {
  if (name.trim()) saveFolders(state.folders.map((f) => (f.id === id ? { ...f, name: name.trim().slice(0, 40) } : f)));
}

/** Removes the folder; its cuts go back to the main Cuts page. */
export function deleteFolder(id: string) {
  moveCuts(state.cuts.filter((c) => c.folderId === id).map((c) => c.id), undefined);
  if (state.settings.saveFolder === id) updateSettings({ saveFolder: '' });
  saveFolders(state.folders.filter((f) => f.id !== id));
}

export function moveCuts(ids: string[], folderId: string | undefined) {
  state = { ...state, cuts: state.cuts.map((c) => (ids.includes(c.id) ? { ...c, folderId } : c)) };
  persist();
  emit();
}
export const useCuts = () => useSyncExternalStore(subscribe, () => state.cuts);
export const useCut = (id: string) => useSyncExternalStore(subscribe, () => getCut(id));
export const useSettings = () => useSyncExternalStore(subscribe, () => state.settings);

export const clipsDuration = (clips: Clip[]) => clips.reduce((t, [s, e]) => t + e - s, 0);

/** The cut's edit, or a fresh one built from what Autocut kept. */
export const editOf = (c: CutRecord): Edit =>
  c.edit ?? {
    clips: c.clips.map(([s, e]) => makeClip(s, e)),
    muted: false,
    captions: { ...DEFAULT_CAPTIONS, enabled: state.settings.captions },
    overlapAudio: state.settings.overlapAudio !== false,
    texts: [],
  };

/** One line on where a cut is: "Uploading 40%", "Cutting 70%", "Ready to edit", "Exported"… */
/** "Today, 9:00 PM", "Tomorrow, 8:30 AM", "Sat 18 Oct, 9:00 PM". */
export function whenText(at: number) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

export function cutStatus(cut: CutRecord) {
  if (cut.status === 'ready') return cut.exports > 0 ? 'Exported' : 'Ready to edit';
  if (cut.status === 'failed') return cut.error ?? "The edit didn't finish.";
  if (cut.stage === 'reconnecting') return 'Connection lost, retrying…';
  if (cut.status === 'uploading') return cut.stage === 'waiting' ? 'Waiting to upload' : `Uploading ${Math.round(cut.progress * 100)}%`;
  if (cut.stage === 'scheduled' && cut.scheduledFor) return `Scheduled for ${whenText(cut.scheduledFor)}`;
  if (cut.stage === 'queued') return 'Waiting in line';
  return `Cutting ${Math.round(25 + 75 * cut.progress)}%`;
}

/** 0–1 across the whole job: upload is the first quarter, cutting the rest. */
export const cutProgress = (cut: CutRecord) =>
  cut.status === 'ready' ? 1 : cut.status === 'uploading' ? cut.progress * 0.25 : cut.status === 'processing' ? 0.25 + 0.75 * cut.progress : 0;

/** Length of the cut as the user will export it. */
export const editedDuration = (c: CutRecord) => totalDuration(editOf(c).clips);

export function saveEdit(id: string, edit: Edit) {
  updateCut(id, { edit });
}
