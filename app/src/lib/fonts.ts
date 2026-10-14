// The caption/text fonts, registered under the same family names the server's ASS styles use.
export const CAPTION_FONTS = {
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
};

/** The "Autocut" wordmark's typeface (Bricolage Grotesque ExtraBold), next to the logo in headers. */
export const BRAND_FONT = 'Bricolage Grotesque ExtraBold';

/** Everything loaded at launch: the caption fonts and the wordmark's. */
export const APP_FONTS = { ...CAPTION_FONTS, [BRAND_FONT]: require('../../assets/fonts/BricolageGrotesque-ExtraBold.ttf') };

/** Fonts offered for text overlays (the A button in the text editor). */
export const TEXT_FONTS = ['Inter ExtraBold', 'Montserrat Black', 'Anton', 'Bangers', 'Lilita One', 'Shrikhand', 'Playfair Display', 'Poppins'];
