import Slider from '@react-native-community/slider';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { updateSettings, useSettings } from '../lib/store';
import { theme } from '../lib/theme';
import { Card, Footnote, Row } from './list';
import { UI_FONT } from '../lib/fonts';

/** How Autocut cuts new takes: in Settings, and in "More options" before sending a take. */
export function CuttingSettings() {
  const settings = useSettings();
  return (
    <>
      <Card>
        <View style={styles.slider}>
          <View style={styles.between}>
            <Text style={styles.text}>Longest pause to keep</Text>
            <Text style={styles.value}>{settings.maxGap.toFixed(2)}s</Text>
          </View>
          <Slider
            minimumValue={0.15}
            maximumValue={0.8}
            step={0.05}
            value={settings.maxGap}
            onSlidingComplete={(v) => updateSettings({ maxGap: Math.round(v * 100) / 100 })}
            minimumTrackTintColor={theme.blue}
          />
        </View>
        <SwitchRow label="Remove ums and uhs" value={settings.removeFillers} onChange={(removeFillers) => updateSettings({ removeFillers })} />
        <SwitchRow label="Remove retakes" value={settings.removeRetakes} onChange={(removeRetakes) => updateSettings({ removeRetakes })} />
        <SwitchRow label="Captions on new cuts" value={settings.captions} onChange={(captions) => updateSettings({ captions })} last />
      </Card>
      <Footnote>Lower pause = snappier edit. With retakes on, when you say a line again Autocut keeps your last take.</Footnote>
    </>
  );
}

export function SwitchRow({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return <Row label={label} right={<Switch value={value} onValueChange={onChange} trackColor={{ true: theme.blue }} />} last={last} />;
}

const styles = StyleSheet.create({
  slider: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  text: { fontSize: 16, ...UI_FONT.semibold, color: theme.ink },
  value: { fontSize: 15, ...UI_FONT.semibold, color: theme.muted, fontVariant: ['tabular-nums'] },
});
