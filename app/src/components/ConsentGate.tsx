import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { syncConsent, takeAgreement, TERMS_VERSION } from '../lib/consent';
import { theme } from '../lib/theme';
import { agreed, ConsentChecks, type Agreement } from './ConsentChecks';
import { Button, ErrorText } from './ui';

/**
 * Makes sure every signed-in account has agreed to the current terms. Agreements made at sign-up
 * are copied to the server; accounts from before these terms (or with Apple/Google sign-ins that
 * skipped sign-up) are asked once, and can't use the app until they agree or sign out.
 */
export function ConsentGate() {
  const { account, updateProfile, signOut } = useAuth();
  const [agreement, setAgreement] = useState<Agreement>({ terms: false, ai: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = account?.profile;
  const current = profile?.termsVersion === TERMS_VERSION;

  useEffect(() => {
    if (!account) return;
    if (current) return syncConsent(account.id, profile?.termsVersion, profile?.aiConsent);
    // Ticked on the sign-up screen just before an Apple or Google sign-in created the account.
    const held = takeAgreement();
    if (held) updateProfile(held).catch(() => {});
  }, [account, current, profile?.termsVersion, profile?.aiConsent, updateProfile]);

  if (!account || current) return null;

  const agree = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ termsVersion: TERMS_VERSION, aiConsent: agreement.ai });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.dim}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{profile?.termsVersion ? 'We’ve updated our terms' : 'One more thing'}</Text>
          <Text style={styles.body}>
            Autocut now keeps your videos until you delete your account, so they’re there whenever you want to edit again. Please review and agree to keep going.
          </Text>
          <ConsentChecks value={agreement} onChange={setAgreement} />
          <ErrorText>{error}</ErrorText>
          <Button title="Agree and continue" onPress={agree} disabled={!agreed(agreement)} loading={saving} />
          <Button kind="text" title="Sign out" onPress={signOut} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40, gap: 16 },
  title: { fontSize: 22, fontWeight: '800', color: theme.ink, letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 21, color: theme.muted },
});
