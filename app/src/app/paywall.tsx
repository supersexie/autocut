import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { PlanPicker } from '../components/PlanPicker';
import { Button, ErrorText } from '../components/ui';
import { useAuth } from '../lib/auth';
import { clearDraft, getDraft, profileFromDraft } from '../lib/draft';
import { theme } from '../lib/theme';

/**
 * Signed in, not set up yet. A plan picked during setup is saved with the answers straight away
 * (payments aren't connected yet); otherwise, e.g. signing in to an account that never picked one,
 * the plans are shown here.
 */
export default function Paywall() {
  const [picked] = useState(() => getDraft().plan);
  return picked ? <FinishSetup /> : <PlanPicker mode="onboarding" />;
}

function FinishSetup() {
  const { updateProfile } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Once per try: updateProfile changes identity when the account does, which would save again.
  const tried = useRef(-1);
  useEffect(() => {
    if (tried.current === attempt) return;
    tried.current = attempt;
    const d = getDraft();
    updateProfile({ ...profileFromDraft(d), plan: d.plan, billing: d.billing ?? 'yearly', onboarded: true })
      .then(() => clearDraft())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [updateProfile, attempt]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, padding: 22, gap: 14 }}>
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          <Button
            title="Try again"
            onPress={() => {
              setError(null);
              setAttempt((a) => a + 1);
            }}
          />
        </>
      ) : (
        <ActivityIndicator color={theme.ink} />
      )}
    </View>
  );
}
