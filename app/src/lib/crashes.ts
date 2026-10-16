import * as Sentry from '@sentry/react-native';

// Crash and error reports (Sentry), so problems on people's phones get seen and fixed. Off until
// EXPO_PUBLIC_SENTRY_DSN is set (Sentry → project → Client Keys). No personal details are sent:
// no IP addresses, no user names or emails, and no screenshots or video.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    attachScreenshot: false,
    tracesSampleRate: 0.1,
    enabled: !__DEV__,
  });
}

/** The account a report came from (its id only), so a person's reports can be found if they ask. */
export const reportAs = (id: string | null) => dsn && Sentry.setUser(id ? { id } : null);

/** Wraps the root component so render errors are reported too. */
export const withCrashReports = (Root: React.ComponentType<Record<string, unknown>>) => (dsn ? Sentry.wrap(Root) : Root);

/** Reports an error that was caught and handled (the app kept going), with what was happening. */
export function reportError(error: unknown, context: string) {
  if (dsn) Sentry.captureException(error, { tags: { context } });
}
