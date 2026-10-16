import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { openLegal } from '../lib/api';
import { AI_CONSENT_REQUIRED } from '../lib/consent';
import { theme } from '../lib/theme';

export type Agreement = { terms: boolean; ai: boolean };

/** Whether the boxes ticked are enough to go on. */
export const agreed = (a: Agreement) => a.terms && (a.ai || !AI_CONSENT_REQUIRED);

/** The two boxes at sign-up (and when the terms change): the terms and privacy policy, and AI use. */
export function ConsentChecks({ value, onChange }: { value: Agreement; onChange: (a: Agreement) => void }) {
  const flip = (k: keyof Agreement) => {
    Haptics.selectionAsync();
    onChange({ ...value, [k]: !value[k] });
  };
  return (
    <View style={styles.wrap}>
      <Check on={value.terms} onPress={() => flip('terms')} label="Agree to the Terms of Service and Privacy Policy">
        I agree to the{' '}
        <Text style={styles.link} onPress={() => openLegal('terms')}>
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text style={styles.link} onPress={() => openLegal('privacy')}>
          Privacy Policy
        </Text>
        , including that my videos are kept until I delete my account.
      </Check>
      <Check on={value.ai} onPress={() => flip('ai')} label="Let Autocut use my videos to improve the app and its AI">
        Autocut can use my videos to improve the app and its AI{AI_CONSENT_REQUIRED ? '.' : ' (optional, change it anytime in Settings).'}
      </Check>
    </View>
  );
}

function Check({ on, onPress, label, children }: { on: boolean; onPress: () => void; label: string; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={styles.row} hitSlop={6} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <View style={[styles.box, on && styles.boxOn]}>{on && <SymbolView name="checkmark" tintColor="#fff" size={13} weight="bold" />}</View>
      <Text style={styles.text}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: theme.faint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  text: { flex: 1, fontSize: 13.5, lineHeight: 19, color: theme.muted },
  link: { color: theme.ink, fontWeight: '700' },
});
