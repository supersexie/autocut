import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { openLegal } from '../lib/api';
import { AI_CONSENT_REQUIRED } from '../lib/consent';
import { theme } from '../lib/theme';

export type Agreement = { terms: boolean; ai: boolean };

/** Whether the box is ticked (enough to go on). */
export const agreed = (a: Agreement) => a.terms;

/**
 * One line under the sign-up button (and on the "updated terms" sheet): a tick box and "I agree to
 * the Terms of Service and Privacy Policy". AI use isn't asked here: it's off until turned on in
 * Settings, unless AI_CONSENT_REQUIRED makes it part of this same agreement.
 */
/** `highlight`: outlines the box in red, after a Continue button was tapped before agreeing. */
export function ConsentChecks({ value, onChange, highlight = false }: { value: Agreement; onChange: (a: Agreement) => void; highlight?: boolean }) {
  const flip = () => {
    Haptics.selectionAsync();
    const terms = !value.terms;
    onChange({ terms, ai: AI_CONSENT_REQUIRED ? terms : value.ai });
  };
  return (
    <Pressable onPress={flip} style={styles.row} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: value.terms }} accessibilityLabel="Agree to the Terms of Service and Privacy Policy">
      <View style={[styles.box, highlight && styles.boxNudge, value.terms && styles.boxOn]}>{value.terms && <SymbolView name="checkmark" tintColor="#fff" size={12} weight="bold" />}</View>
      <Text style={styles.text}>
        I agree to the{' '}
        <Text style={styles.link} onPress={() => openLegal('terms')}>
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text style={styles.link} onPress={() => openLegal('privacy')}>
          Privacy Policy
        </Text>
        {AI_CONSENT_REQUIRED ? ', including Autocut using my videos to improve the app and its AI.' : '.'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', alignSelf: 'center' },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: theme.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  boxNudge: { borderColor: theme.danger, borderWidth: 2 },
  text: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: theme.muted },
  link: { color: theme.ink, fontWeight: '700' },
});
