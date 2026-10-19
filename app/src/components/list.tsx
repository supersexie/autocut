import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../lib/theme';
import { PressableScale, type SymbolName } from './ui';
import { UI_FONT } from '../lib/fonts';

// Grouped-list pieces for the You, Plan and Settings screens: white cards on the grey page.

/** A round white button with a symbol, like the gear on You and the back arrow on Settings. */
export function RoundButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} hitSlop={8} accessibilityLabel={label} scaleTo={0.92} style={styles.round}>
      <SymbolView name={icon} tintColor={theme.ink} size={17} weight="semibold" />
    </PressableScale>
  );
}

/** A pushed screen's top bar: back button and a centred title. */
export function PageHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <RoundButton icon="chevron.left" label="Back" onPress={() => router.back()} />
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Footnote({ children, center }: { children: ReactNode; center?: boolean }) {
  return <Text style={[styles.foot, center && { textAlign: 'center' }]}>{children}</Text>;
}

type RowProps = {
  icon?: SymbolName;
  label: string;
  detail?: string;
  /** Shown on the right, before the chevron. */
  value?: string;
  /** A ⌃⌄ instead of a chevron: the row picks from a few options. */
  picker?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  muted?: boolean;
};

/** One line of a card: icon, label (and a smaller line under it), then a value and chevron. */
export function Row({ icon, label, detail, value, picker, right, onPress, last, muted }: RowProps) {
  const body = (
    <>
      {icon && (
        <View style={styles.rowIcon}>
          <SymbolView name={icon} tintColor={theme.blue} size={16} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, muted && { color: theme.faint }]}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {right}
      {onPress && !right && <SymbolView name={picker ? 'chevron.up.chevron.down' : 'chevron.right'} tintColor={theme.faint} size={12} weight="semibold" />}
    </>
  );
  const style = [styles.row, !last && styles.rowLine];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: theme.card }]}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

/** The thin bar under "2 of 300 edits used". */
export function Meter({ fraction }: { fraction: number }) {
  return (
    <View style={styles.meter}>
      <View style={[styles.meterFill, { width: `${Math.max(1.5, Math.min(100, fraction * 100))}%` }]} />
    </View>
  );
}

export const listStyles = StyleSheet.create({
  /** Initials in an outlined circle. */
  avatar: { borderRadius: 999, borderWidth: 1.5, borderColor: theme.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...UI_FONT.bold, color: theme.ink, letterSpacing: 0.5 },
});

const styles = StyleSheet.create({
  round: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  headerTitle: { fontSize: 17, ...UI_FONT.semibold, color: theme.ink },
  card: {
    backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
  },
  label: { fontSize: 13, color: theme.muted, ...UI_FONT.semibold, marginTop: 22, marginBottom: 8, marginLeft: 4 },
  foot: { fontSize: 12, ...UI_FONT.semibold, color: theme.muted, marginTop: 8, marginHorizontal: 4, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, minHeight: 52 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: theme.blueTile, alignItems: 'center', justifyContent: 'center' },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  rowLabel: { fontSize: 16, ...UI_FONT.semibold, color: theme.ink },
  rowDetail: { fontSize: 12, ...UI_FONT.semibold, color: theme.muted, marginTop: 2 },
  rowValue: { fontSize: 15, ...UI_FONT.semibold, color: theme.muted },
  meter: { height: 4, borderRadius: 2, backgroundColor: theme.line, overflow: 'hidden', marginTop: 10 },
  meterFill: { height: 4, borderRadius: 2, backgroundColor: theme.ink },
});
