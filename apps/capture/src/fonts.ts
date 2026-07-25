import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from "@expo-google-fonts/geist";
import {
  GeistMono_400Regular,
  GeistMono_500Medium,
} from "@expo-google-fonts/geist-mono";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";

/**
 * The typefaces the design system asks for, keyed by the family names in
 * `src/theme.ts`. Only the weights actually used are listed — Metro bundles the
 * font files these keys reference, so an unused weight is dead app size.
 *
 * Kept apart from `theme.ts` so the token module stays a plain-data import that
 * the Node test runner (and anything else off the Metro asset pipeline) can
 * read without resolving `.ttf` files.
 */
export const MOTIF_FONTS = {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  GeistMono_400Regular,
  GeistMono_500Medium,
  InstrumentSerif_400Regular,
};
