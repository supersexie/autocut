/** Floating pill tab bar, like the camera-first apps creators already use. */
export const TAB_BAR_HEIGHT = 64;
export const tabBarStyle = {
  position: 'absolute' as const,
  bottom: 22,
  marginHorizontal: 16,
  height: TAB_BAR_HEIGHT,
  borderRadius: 32,
  paddingTop: 8,
  paddingBottom: 8,
  backgroundColor: 'rgba(255,255,255,0.94)',
  borderTopWidth: 0,
  shadowColor: '#14284f',
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 6 },
};

