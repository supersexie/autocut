import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { column, theme } from '../lib/theme';

/**
 * A card that slides up from the bottom over a dimmed screen, sized to what's in it. Tap outside
 * to close. `onDismissed` runs once it has fully gone (open a picker from there, not before).
 */
export function Sheet({ visible, onClose, onDismissed, children }: { visible: boolean; onClose: () => void; onDismissed?: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismissed}>
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.card, { paddingBottom: insets.bottom + 16 }]}>
          <View style={column()}>
            <View style={styles.grabber} />
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: theme.line, marginBottom: 14 },
});
