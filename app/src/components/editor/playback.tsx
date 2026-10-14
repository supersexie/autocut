import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { CompositionPlayer, hasCompositionPlayer, type CompositionPlayerHandle } from '../../../modules/autocut-player';
import { previewOf } from '../../lib/api';
import { clipOffset, locate, totalDuration, type ClipEdit } from '../../lib/edit';

/** What the editor needs from a player, whichever one is underneath. Times are output times. */
export type Playback = {
  time: number;
  playing: boolean;
  toggle: () => void;
  pause: () => void;
  /** Jump to `t`. Pass `list` when the clips have just changed and haven't rendered yet. */
  seek: (t: number, list?: ClipEdit[]) => void;
  /** While the timeline is being dragged, the player doesn't move the playhead. */
  setScrubbing: (on: boolean) => void;
  /** The video itself, to fill the preview frame. */
  video: ReactNode;
};

type Options = { cutId: string; sourceUri: string; clips: ClipEdit[]; muted: boolean };

/**
 * App builds have Autocut's native player, which stitches the clips on the phone: smooth through
 * every cut, instantly after every edit. Expo Go can't load it, so there the server stitches a
 * preview of the edit and the editor plays that (see useExpoGoPlayback).
 */
export const usePlayback: (o: Options) => Playback = hasCompositionPlayer ? useCompositionPlayback : useExpoGoPlayback;

// ---- Native: one AVPlayer over an AVMutableComposition of the clips.

function useCompositionPlayback({ sourceUri, clips, muted }: Options): Playback {
  const player = useRef<CompositionPlayerHandle>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const scrubbing = useRef(false);
  const native = useMemo(() => clips.map(({ start, end, speed, volume }) => ({ start, end, speed, volume })), [clips]);
  const total = totalDuration(clips);

  const seek = (t: number, list: ClipEdit[] = clips) => {
    const clamped = Math.max(0, Math.min(t, totalDuration(list) - 0.01));
    player.current?.seek(clamped);
    setTime(clamped);
  };
  const pause = () => {
    player.current?.pause();
  };
  const toggle = () => {
    if (playing) return pause();
    scrubbing.current = false;
    if (time >= total - 0.05) seek(0);
    player.current?.play();
  };

  const Player = CompositionPlayer!;
  const video = (
    <Player
      ref={player}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      source={sourceUri}
      clips={native}
      muted={muted}
      onTime={(e) => {
        if (!scrubbing.current) setTime(e.nativeEvent.time);
      }}
      onPlayingChange={(e) => setPlaying(e.nativeEvent.playing)}
      onEnd={() => setTime(0)}
    />
  );
  return { time, playing, toggle, pause, seek, setScrubbing: (on) => (scrubbing.current = on), video };
}

// ---- Expo Go: the server's stitched preview, with two players in relay until it arrives.

/**
 * Plays the server's preview of the edit when there's one for the current clips: one file, so no
 * hitch at the cuts. After an edit the relay takes over at the same spot until the new preview is
 * ready a few seconds later (or for good, if the server can't make one).
 */
function useExpoGoPlayback(o: Options): Playback {
  const relay = useRelayPlayback(o);
  const preview = usePreviewPlayback(o);
  const onPreview = preview.ready;
  const [shown, setShown] = useState(false); // the preview's video is on top

  // Hand over between the two at the same time, carrying on playing if it was.
  const latest = useRef({ relay, preview });
  useEffect(() => {
    latest.current = { relay, preview };
  });
  // A seek that came with new clips already put the relay in the right place.
  const relayPlaced = useRef(false);
  useEffect(() => {
    const { relay: r, preview: p } = latest.current;
    if (onPreview) {
      const wasPlaying = r.playing;
      r.pause();
      p.seek(r.time);
      if (wasPlaying) p.play();
      relayPlaced.current = false;
    } else {
      const wasPlaying = p.playing;
      p.pause();
      if (!relayPlaced.current) r.seek(p.time);
      relayPlaced.current = false;
      if (wasPlaying) r.toggle();
    }
    // Swap what's on screen a frame later, once the incoming player has jumped to the spot.
    const frame = requestAnimationFrame(() => setShown(onPreview));
    return () => cancelAnimationFrame(frame);
  }, [onPreview]);

  const active = shown ? preview : relay;
  return {
    time: active.time,
    playing: active.playing,
    toggle: active.toggle,
    pause: () => {
      relay.pause();
      preview.pause();
    },
    seek: (t, list) => {
      if (shown && preview.matches(list ?? o.clips)) return preview.seek(t);
      relayPlaced.current = true;
      relay.seek(t, list);
    },
    setScrubbing: (on) => {
      relay.setScrubbing(on);
      preview.setScrubbing(on);
    },
    video: (
      <>
        {relay.video}
        <View style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }]} pointerEvents="none">
          {preview.video}
        </View>
      </>
    ),
  };
}

/** One player over the server's stitched preview of the clips (once it's downloaded and loaded). */
function usePreviewPlayback({ cutId, clips, muted }: Options) {
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1 / 30;
    p.loop = false;
  });
  const [file, setFile] = useState<{ clips: ClipEdit[]; uri: string } | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const scrubbing = useRef(false);
  const total = totalDuration(clips);

  // Ask for a preview of the clips once they've settled for a moment.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      previewOf(cutId, clips, () => alive)
        .then((uri) => alive && uri && setFile({ clips, uri }))
        .catch(() => {}); // no preview: the relay carries on
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [cutId, clips]);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    player
      .replaceAsync(file.uri)
      .then(() => alive && setLoaded(file.uri))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file, player]);

  useEffect(() => setMuted(player, muted), [player, muted]);

  useEffect(() => {
    const subs = [
      player.addListener('playingChange', (e) => setPlaying(e.isPlaying)),
      player.addListener('timeUpdate', ({ currentTime }) => {
        if (!scrubbing.current) setTime(currentTime);
      }),
      player.addListener('playToEnd', () => {
        player.pause();
        seekTo(player, 0);
        setTime(0);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  const ready = !!file && file.clips === clips && loaded === file.uri;
  const seek = (t: number) => {
    const clamped = Math.max(0, Math.min(t, total - 0.01));
    seekTo(player, clamped);
    setTime(clamped);
  };
  const play = () => {
    scrubbing.current = false;
    if (time >= total - 0.05) seek(0);
    player.play();
  };
  const pause = () => player.pause();
  return {
    ready,
    matches: (list: ClipEdit[]) => ready && file?.clips === list,
    time,
    playing,
    play,
    pause,
    seek,
    toggle: () => (playing ? pause() : play()),
    setScrubbing: (on: boolean) => {
      scrubbing.current = on;
    },
    video: <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />,
  };
}

// ---- Two expo-video players in relay.

// expo-video is driven by setting properties on the player.
const seekTo = (p: VideoPlayer, t: number) => {
  p.currentTime = t;
};
const setMuted = (p: VideoPlayer, muted: boolean) => {
  p.muted = muted;
};
const setVolume = (p: VideoPlayer, volume: number) => {
  p.volume = Math.min(1, volume);
};
// On iOS, setting playbackRate also sets the native player's rate, which starts playback.
// So speed is only ever set on a player that is (about to be) playing, never on a paused one.
const setSpeed = (p: VideoPlayer, rate: number) => {
  if (p.playbackRate !== rate) p.playbackRate = rate;
};
const start = (p: VideoPlayer, rate: number, volume: number) => {
  setVolume(p, volume);
  p.play();
  setSpeed(p, rate);
};
// Just before a cut the waiting player creeps forward at the slowest rate AVPlayer allows, silent
// and hidden, so at the cut it's already running and only has to speed up.
const WARM_UP = 0.4; // seconds before the cut
const creep = (p: VideoPlayer) => {
  p.volume = 0;
  p.playbackRate = 1 / 32; // always assigned: it's the assignment that starts the player
};

/**
 * Two players over the same video: the front one plays the current clip while the other waits at
 * the start of the next, and at the cut they swap. Clips shorter than a player needs to seek and
 * start (about a third of a second) still hitch; the native player doesn't have that limit.
 */
function useRelayPlayback({ sourceUri, clips, muted }: Options): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = totalDuration(clips);

  const setup = (p: VideoPlayer) => {
    p.timeUpdateEventInterval = 1 / 30;
    p.loop = false;
    p.preservesPitch = true;
  };
  const playerA = useVideoPlayer(sourceUri, setup);
  const playerB = useVideoPlayer(sourceUri, setup);
  const players = useMemo(() => [playerA, playerB] as [VideoPlayer, VideoPlayer], [playerA, playerB]);
  // Which player is on screen. A shared value, so the swap happens on the UI thread at once
  // instead of waiting for a React render (which showed the old player's frozen frame).
  const front = useSharedValue<0 | 1>(0);

  // State that event handlers read. `playing` is what we asked for; the player's own flag lags.
  const live = useRef({ clips, muted, index: 0, scrubbing: false, front: 0 as 0 | 1, playing: false, warm: false });

  // Stable helpers (they only touch the players and the `live` ref).
  const relay = useMemo(() => {
    const active = () => players[live.current.front];
    const standby = () => players[live.current.front === 0 ? 1 : 0];
    const volumeOf = (c: ClipEdit) => (live.current.muted ? 0 : c.volume);
    /** Park the standby player, silent and paused, at the start of clip `i`. */
    const prime = (i: number) => {
      const c = live.current.clips[i];
      const p = standby();
      live.current.warm = false;
      p.pause();
      if (!c) return;
      seekTo(p, c.start);
      setVolume(p, 0);
    };
    return { active, volumeOf, prime };
  }, [players]);
  const { active: activePlayer, volumeOf, prime } = relay;

  // Edits that keep the playhead (volume, mute) apply to the clip that's playing.
  useEffect(() => {
    live.current.clips = clips;
    live.current.muted = muted;
    const c = clips[live.current.index];
    const p = activePlayer();
    if (!c) return;
    setVolume(p, volumeOf(c));
    if (live.current.playing) setSpeed(p, c.speed);
  }, [clips, muted, activePlayer, volumeOf]);

  useEffect(() => {
    const subs = players.flatMap((pl, which) => [
      pl.addListener('playingChange', (e) => {
        if (which !== live.current.front) return;
        setPlaying(e.isPlaying);
        if (!e.isPlaying) live.current.playing = false; // e.g. a phone call paused it
      }),
      pl.addListener('timeUpdate', ({ currentTime }) => {
        const { clips: list, index, scrubbing, front: f } = live.current;
        if (which !== f || scrubbing) return;
        const i = Math.min(index, list.length - 1);
        const c = list[i];
        if (!c) return;
        if (currentTime >= c.end - 0.04) {
          const next = list[i + 1];
          if (!next) {
            live.current.playing = false;
            pl.pause();
            live.current.index = 0;
            seekTo(pl, list[0].start);
            setVolume(pl, volumeOf(list[0]));
            setTime(0);
            prime(1);
            return;
          }
          // Hand over to the waiting player, then park this one at the clip after next.
          const incoming = players[f === 0 ? 1 : 0];
          live.current.front = f === 0 ? 1 : 0;
          live.current.index = i + 1;
          if (live.current.warm) {
            setVolume(incoming, volumeOf(next));
            setSpeed(incoming, next.speed);
          } else start(incoming, next.speed, volumeOf(next));
          live.current.warm = false;
          front.set(live.current.front);
          setVolume(pl, 0);
          pl.pause();
          setTime(clipOffset(list, i + 1));
          prime(i + 2);
          return;
        }
        if (currentTime < c.start - 0.3) seekTo(pl, c.start);
        if (!live.current.warm && live.current.playing && list[i + 1] && (c.end - currentTime) / c.speed <= WARM_UP) {
          live.current.warm = true;
          creep(players[f === 0 ? 1 : 0]);
        }
        setTime(clipOffset(list, i) + Math.max(0, currentTime - c.start) / c.speed);
      }),
      pl.addListener('statusChange', ({ status }) => {
        if (status !== 'readyToPlay') return;
        const list = live.current.clips;
        if (which === live.current.front) {
          const first = list[0];
          if (first && pl.currentTime < first.start) {
            seekTo(pl, first.start);
            setVolume(pl, volumeOf(first));
          }
        } else prime(live.current.index + 1);
      }),
    ]);
    return () => subs.forEach((s) => s.remove());
  }, [players, prime, volumeOf, front]);

  function pause() {
    live.current.playing = false;
    live.current.warm = false;
    players.forEach((p) => p.pause());
  }

  function seek(t: number, list: ClipEdit[] = clips) {
    live.current.clips = list;
    const clamped = Math.max(0, Math.min(t, totalDuration(list) - 0.01));
    const [i, source] = locate(list, clamped);
    live.current.index = i;
    const p = activePlayer();
    seekTo(p, source);
    const c = list[i];
    if (c) {
      setVolume(p, volumeOf(c));
      if (live.current.playing) setSpeed(p, c.speed);
    }
    setTime(clamped);
    prime(i + 1);
  }

  function toggle() {
    if (playing) return pause();
    live.current.scrubbing = false;
    if (time >= total - 0.05) seek(0);
    const c = live.current.clips[live.current.index];
    if (!c) return;
    live.current.playing = true;
    start(activePlayer(), c.speed, volumeOf(c));
  }

  const video = players.map((pl, i) => <RelayVideo key={i} player={pl} index={i} front={front} />);
  return { time, playing, toggle, pause, seek, setScrubbing: (on) => (live.current.scrubbing = on), video };
}

/** One of the two relay players; shown only while it's the front one (switched on the UI thread). */
function RelayVideo({ player, index, front }: { player: VideoPlayer; index: number; front: SharedValue<0 | 1> }) {
  const shown = useAnimatedStyle(() => ({ opacity: front.get() === index ? 1 : 0 }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, shown]} pointerEvents="none">
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
    </Animated.View>
  );
}
