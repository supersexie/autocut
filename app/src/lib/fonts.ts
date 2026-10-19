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

/** Plus Jakarta Sans, the onboarding's typeface (CutAI's): welcome, setup questions, results and plans. */
export const JAKARTA = {
  medium: 'Plus Jakarta Sans Medium',
  semibold: 'Plus Jakarta Sans SemiBold',
  bold: 'Plus Jakarta Sans Bold',
  extrabold: 'Plus Jakarta Sans ExtraBold',
};

/** Everything loaded at launch: the caption fonts, the wordmark's and the onboarding's. */
export const APP_FONTS = {
  ...CAPTION_FONTS,
  [BRAND_FONT]: require('../../assets/fonts/BricolageGrotesque-ExtraBold.ttf'),
  [JAKARTA.medium]: require('../../assets/fonts/PlusJakartaSans-Medium.ttf'),
  [JAKARTA.semibold]: require('../../assets/fonts/PlusJakartaSans-SemiBold.ttf'),
  [JAKARTA.bold]: require('../../assets/fonts/PlusJakartaSans-Bold.ttf'),
  [JAKARTA.extrabold]: require('../../assets/fonts/PlusJakartaSans-ExtraBold.ttf'),
};

/** Fonts offered for text overlays (the A button in the text editor). */
export const TEXT_FONTS = ['TikTok Sans SemiBold', 'Playfair Display Regular', 'Abel', 'Zilla Slab Bold Italic', 'Luckiest Guy', 'Fredoka SemiBold', 'Roboto Condensed Bold', 'Montserrat Black', 'Anton'];
