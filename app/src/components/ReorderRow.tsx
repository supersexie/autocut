import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';

type Props<T> = {
  items: T[];
  keyOf: (item: T, index: number) => string;
  /** Each tile's size, and the space between tiles. */
  width: number;
  height: number;
  gap: number;
  /** Moves the item at `from` to `to`. */
  onMove: (from: number, to: number) => void;
  render: (item: T, index: number) => ReactNode;
  tileStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Shown after the tiles (an add button). */
  trailing?: ReactNode;
};

/**
 * A sideways row of tiles you put in order by holding one and dragging it along the row; the
 * others slide aside to show where it'll land.
 */
export function ReorderRow<T>({ items, keyOf, width, height, gap, onMove, render, tileStyle, contentStyle, trailing }: Props<T>) {
  const [drag, setDrag] = useState<{ from: number; dx: number } | null>(null);
  const step = width + gap;
  const clampTo = (i: number) => Math.max(0, Math.min(items.length - 1, i));
  const target = drag ? clampTo(drag.from + Math.round(drag.dx / step)) : -1;

  const drop = (from: number, dx: number) => {
    const to = clampTo(from + Math.round(dx / step));
    if (to !== from) {
      Haptics.selectionAsync();
      onMove(from, to);
    }
    setDrag(null);
  };
  const shift = (k: number) => {
    if (!drag || k === drag.from) return 0;
    if (drag.from < k && k <= target) return -step;
    if (target <= k && k < drag.from) return step;
    return 0;
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!drag} contentContainerStyle={[{ gap }, contentStyle]} style={{ flexGrow: 0 }}>
      {items.map((item, i) => (
        <Tile
          key={keyOf(item, i)}
          dx={drag?.from === i ? drag.dx : null}
          shift={shift(i)}
          onDrag={(dx) => setDrag({ from: i, dx })}
          onDrop={(dx) => drop(i, dx)}
          style={[{ width, height }, tileStyle]}
        >
          {render(item, i)}
        </Tile>
      ))}
      {trailing}
    </ScrollView>
  );
}

type TileProps = {
  /** How far it's being dragged, or null when it isn't. */
  dx: number | null;
  /** How far it slides aside for the one being dragged. */
  shift: number;
  onDrag: (dx: number) => void;
  onDrop: (dx: number) => void;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** One tile. Hold it, then drag it along the row to move it. */
function Tile({ dx, shift, onDrag, onDrop, style, children }: TileProps) {
  const latest = useRef({ onDrag, onDrop });
  const active = useRef(false);
  useEffect(() => {
    latest.current = { onDrag, onDrop };
  });
  // Made once: a gesture rebuilt on every render (and this re-renders as the finger moves) would
  // be re-attached, and the drag cancelled, mid-way. The handlers read the latest callbacks from a ref.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    Gesture.Pan()
      .activateAfterLongPress(220)
      .runOnJS(true)
      .onStart(() => {
        active.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        latest.current.onDrag(0);
      })
      .onUpdate((e) => latest.current.onDrag(e.translationX))
      .onEnd((e) => {
        active.current = false;
        latest.current.onDrop(e.translationX);
      })
      // Cancelled part-way (a call, the screen closing): put it back where it was.
      .onFinalize(() => {
        if (!active.current) return;
        active.current = false;
        latest.current.onDrop(0);
      })
  );
  return (
    <GestureDetector gesture={pan}>
      <View
        style={[
          style,
          { shadowColor: '#000', shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
          dx !== null ? { transform: [{ translateX: dx }, { scale: 1.06 }], zIndex: 2, shadowOpacity: 0.25 } : { transform: [{ translateX: shift }], shadowOpacity: 0 },
        ]}
      >
        {children}
      </View>
    </GestureDetector>
  );
}
