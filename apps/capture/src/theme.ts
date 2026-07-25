/**
 * Capture's design tokens — the Motif Mobile design system expressed once so
 * screens never hard-code a hex or a font name.
 *
 * The palette is a near-black canvas with a warm off-white for text, one signal
 * colour for recording, and one for anything that has reached another device.
 * Greys step from raised surfaces through borders to progressively fainter
 * text; nothing outside this file should invent a shade in between.
 */

export const colors = {
  /** The screen behind everything. */
  canvas: "#0A0A0B",
  /** A card or sheet lifted off the canvas. */
  surface: "#101013",
  /** Inputs, pills and the row play button — one step brighter than a card. */
  surfaceRaised: "#121214",
  /** Pressed/selected fills and secondary buttons. */
  surfaceActive: "#18181C",
  /** The row that is currently playing. */
  surfaceHighlight: "#0F0F12",
  /** Toast and other floating chrome. */
  surfaceFloating: "#1C1C21",

  /** Hairlines between list rows and above the tab bar. */
  hairline: "#17171B",
  /** Divider inside a card. */
  divider: "#1F1F24",
  /** The default 1px border on inputs, pills and cards. */
  border: "#26262A",
  /** A border that needs to read slightly stronger than {@link border}. */
  borderStrong: "#2E2E34",

  /** Primary text and icons. */
  text: "#F5F2EC",
  /** Body text inside lists — a shade quieter than {@link text}. */
  textSecondary: "#C9C6BF",
  /** Supporting labels. */
  textMuted: "#9B9BA3",
  /** Metadata and timestamps. */
  textDim: "#8B8B93",
  /** Captions, mono eyebrows, and anything deliberately recessive. */
  textFaint: "#5C5C63",
  /** An inactive tab. */
  textInactive: "#4E4E56",
  /** Idle glyphs: the stopped clock, an unset icon outline. */
  textIdle: "#2E2E34",

  /** The signal colour: recording, playing, live level. */
  signal: "#FF4D2E",
  /** Signal at card-fill strength. */
  signalSoft: "rgba(255,77,46,0.10)",
  /** Signal behind the armed record button. */
  signalFaint: "rgba(255,77,46,0.08)",

  /** Reached another device: synced, paired, live. */
  relay: "#7FD4C1",
  /** Relay at card-fill strength. */
  relaySoft: "rgba(127,212,193,0.10)",

  /** Destructive actions. */
  danger: "#FF4D2E",
  /** The idle level meter's bars. */
  meterIdle: "#212126",
} as const;

/**
 * Font families, one per weight — custom fonts don't synthesize weight on
 * either platform, so a bold Geist has to be asked for by name rather than via
 * `fontWeight`. Loaded by `src/fonts.ts`; these are the names it registers.
 */
export const fonts = {
  sans: "Geist_400Regular",
  sansMedium: "Geist_500Medium",
  sansSemiBold: "Geist_600SemiBold",
  /** Numerals, codes, and eyebrow labels. */
  mono: "GeistMono_400Regular",
  monoMedium: "GeistMono_500Medium",
  /** Onboarding headlines only. */
  serif: "InstrumentSerif_400Regular",
} as const;

export const radii = {
  /** Chips, pills, dots and the record button. */
  pill: 999,
  card: 18,
  control: 14,
  field: 12,
  tag: 6,
} as const;

/** Height of the persistent Record/Library tab bar, including its safe inset. */
export const TAB_BAR_HEIGHT = 84;

/** Top inset for a screen's own header, clear of the status bar and notch. */
export const SCREEN_TOP_INSET = 56;
