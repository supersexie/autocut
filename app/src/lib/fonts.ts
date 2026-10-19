// The caption/text fonts, registered under the same family names the server's ASS styles use.
export const CAPTION_FONTS = {
  'TikTok Sans Bold': require('../../assets/fonts/TikTokSans-Bold.ttf'), // earlier projects
  'TikTok Sans SemiBold': require('../../assets/fonts/TikTokSans-SemiBold.ttf'), // the default, as in CutAI
  Inter: require('../../assets/fonts/Inter-Bold.ttf'),
  'Inter ExtraBold': require('../../assets/fonts/Inter-ExtraBold.ttf'),
  'Inter Black': require('../../assets/fonts/Inter-Black.ttf'),
  'Montserrat ExtraBold': require('../../assets/fonts/Montserrat-ExtraBold.ttf'),
  'Montserrat Black': require('../../assets/fonts/Montserrat-Black.ttf'),
  Anton: require('../../assets/fonts/Anton-Regular.ttf'),
  Bangers: require('../../assets/fonts/Bangers-Regular.ttf'),
  'Lilita One': require('../../assets/fonts/LilitaOne-Regular.ttf'),
  Shrikhand: require('../../assets/fonts/Shrikhand-Regular.ttf'),
  'Playfair Display': require('../../assets/fonts/PlayfairDisplay-BoldItalic.ttf'),
  Poppins: require('../../assets/fonts/Poppins-Bold.ttf'),
  // CutAI's caption fonts (registered by each file's full name, which the server's libass matches).
  'Roboto Condensed Bold': require('../../assets/fonts/RobotoCondensed-Bold.ttf'),
  'Luckiest Guy': require('../../assets/fonts/LuckiestGuy-Regular.ttf'),
  'Fredoka SemiBold': require('../../assets/fonts/Fredoka-SemiBold.ttf'),
  Abel: require('../../assets/fonts/Abel-Regular.ttf'),
  'Zilla Slab Bold Italic': require('../../assets/fonts/ZillaSlab-BoldItalic.ttf'),
  'Playfair Display Regular': require('../../assets/fonts/PlayfairDisplay-Regular.ttf'),
};

/** The "Autocut" wordmark's typeface (Bricolage Grotesque ExtraBold), next to the logo in headers. */
export const BRAND_FONT = 'Bricolage Grotesque ExtraBold';

/**
 * The app's typeface: Apple's SF Pro (the system font), spread into a text style. iOS switches to
 * SF Pro Display at 20pt and up and SF Pro Text below, as in Apple's own apps.
 */
export const UI_FONT = {
  medium: { fontFamily: 'System', fontWeight: '500' },
  semibold: { fontFamily: 'System', fontWeight: '600' },
  bold: { fontFamily: 'System', fontWeight: '700' },
  extrabold: { fontFamily: 'System', fontWeight: '800' },
} as const;

/** Everything loaded at launch: the caption fonts and the wordmark's. */
export const APP_FONTS = {
  ...CAPTION_FONTS,
  [BRAND_FONT]: require('../../assets/fonts/BricolageGrotesque-ExtraBold.ttf'),
};

/** Fonts offered for text overlays (the A button in the text editor). */
export const TEXT_FONTS = ['TikTok Sans SemiBold', 'Playfair Display Regular', 'Abel', 'Zilla Slab Bold Italic', 'Luckiest Guy', 'Fredoka SemiBold', 'Roboto Condensed Bold', 'Montserrat Black', 'Anton'];
