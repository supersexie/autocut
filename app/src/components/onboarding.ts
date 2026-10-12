import { StyleSheet } from 'react-native';
import { theme } from '../lib/theme';

export const onboarding = StyleSheet.create({
  title: { fontSize: 32, fontWeight: '800', color: theme.ink, letterSpacing: -0.5, lineHeight: 38 },
  subtitle: { fontSize: 15, color: theme.muted, marginTop: 8, lineHeight: 21 },
  form: { gap: 16, marginTop: 28 },
  label: { fontSize: 13, color: theme.muted, fontWeight: '500' },
  small: { fontSize: 13, color: theme.muted },
  link: { color: theme.accent, fontWeight: '600' },
  hint: { fontSize: 12, color: theme.faint, textAlign: 'center' },
});
