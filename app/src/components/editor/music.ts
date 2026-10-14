import { createAudioPlayer, setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useRef } from 'react';
import type { Music } from '../../lib/edit';
import { cutFile } from '../../lib/store';
import { sleep } from '../../lib/theme';

// expo-audio is driven by setting properties on the player.
const setVolume = (p: AudioPlayer, volume: number) => {
  p.volume = volume;
};

/** Where the song should be at output time `t`: it loops under a long video. */
const songTime = (music: Music, t: number) => (music.duration > 0 ? t % music.duration : 0);

/**
 * Plays the edit's song in step with the video: starts and stops with it, jumps when the playhead
 * jumps, and nudges itself back if it drifts.
 */
export function useMusic(music: Music | undefined, time: number, playing: boolean) {
  const player = useAudioPlayer(music ? cutFile(music.file).uri : null);
  const at = useRef(0);
  useEffect(() => {
    at.current = music ? songTime(music, time) : 0;
  });

  // Sound even with the silent switch on, like the video.
  useEffect(() => {
    if (music) setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, [music]);

  useEffect(() => {
    if (music) setVolume(player, music.volume);
  }, [player, music]);

  useEffect(() => {
    if (!music) return;
    if (playing) {
      player.seekTo(at.current).then(() => player.play()).catch(() => {});
    } else player.pause();
  }, [player, music, playing]);

  // While playing, follow the video if the two drift apart (a hitch at a cut, a seek).
  useEffect(() => {
    if (!music || !playing || !player.isLoaded) return;
    const expected = songTime(music, time);
    const drift = Math.abs(player.currentTime - expected);
    if (drift > 0.3 && drift < music.duration - 0.3) player.seekTo(expected).catch(() => {});
  }, [player, music, playing, time]);
}

/** Lets the user pick a song from Files, copies it in next to the cut, and reads its length. */
export async function pickSong(cutId: string, volume = 0.5): Promise<Music | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const ext = (asset.name.split('.').pop() ?? 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '') || 'm4a';
  const file = `${cutId}-music-${Date.now().toString(36)}.${ext}`;
  new File(asset.uri).copy(cutFile(file));

  // The picker doesn't say how long the song is, so load it briefly to find out.
  const probe = createAudioPlayer(cutFile(file).uri);
  let duration = 0;
  for (let i = 0; i < 40 && !duration; i++) {
    await sleep(100);
    if (probe.isLoaded && probe.duration > 0) duration = probe.duration;
  }
  probe.remove();
  if (!duration) {
    cutFile(file).delete();
    throw new Error('That file couldn’t be played. Try an MP3 or M4A song.');
  }
  const name = asset.name.replace(/\.[^.]+$/, '');
  return { file, name, mime: asset.mimeType ?? 'audio/mpeg', duration, volume };
}
