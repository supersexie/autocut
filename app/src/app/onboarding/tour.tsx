import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Backdrop, Button, StepHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { theme } from '../../lib/theme';
import { onboarding as shared } from '../../components/onboarding';

const TIPS = [
  { icon: 'record.circle', title: 'Record', body: 'Talk to the camera. Flub a line? Just say it again.' },
  { icon: 'paperplane.fill', title: 'Send', body: 'Autocut keeps your best take and drops the dead air.' },
  { icon: 'square.and.arrow.down', title: 'Save', body: 'Get the tight cut with captions, ready to post.' },
] as const;

export default function TourStep() {
  const { updateProfile } = useAuth();
  const [saving, setSaving] = useState<'tour' | 'skip' | null>(null);

  async function choose(tour: boolean) {
    setSaving(tour ? 'tour' : 'skip');
    try {
      await updateProfile({ tour });
    } finally {
      setSaving(null);
      router.push('/onboarding/plan');
    }
  }

  return (
    <Backdrop
      footer={
        <>
          <Button kind="text" title="I'll explore on my own" onPress={() => choose(false)} loading={saving === 'skip'} />
          <Button title="Show me around" onPress={() => choose(true)} loading={saving === 'tour'} />
        </>
      }
    >
      <StepHeader step={3} of={3} />
      <Text style={shared.title}>Want a hand with your first cut?</Text>
      <Text style={shared.subtitle}>Quick tips appear right where you need them while you record, send, and edit.</Text>
      <View style={styles.tips}>
        {TIPS.map((t) => (
          <View key={t.title} style={styles.tip}>
            <View style={styles.icon}>
              <SymbolView name={t.icon} tintColor={theme.accent} size={20} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.tipTitle}>{t.title}</Text>
              <Text style={styles.tipBody}>{t.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  tips: { marginTop: 32, gap: 12 },
  tip: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 16, padding: 14 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(61,133,245,0.12)', alignItems: 'center', justifyContent: 'center' },
  tipTitle: { fontSize: 15, fontWeight: '700', color: theme.ink },
  tipBody: { fontSize: 14, color: theme.muted, lineHeight: 19 },
});
