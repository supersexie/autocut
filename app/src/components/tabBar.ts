/** Floating pill tab bar, like the camera-first apps creators already use. */
export const TAB_BAR_HEIGHT = 64;
const TAB_BAR_MAX = 420;

/** The bar for a window this wide: edge to edge on iPhone, a centred pill on iPad. */
export const tabBarStyle = (width: number) => ({
  position: 'absolute' as const,
  bottom: 22,
  marginHorizontal: Math.max(16, (width - TAB_BAR_MAX) / 2),
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
});
