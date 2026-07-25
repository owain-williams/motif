import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "../theme";

/**
 * The design system's icon set. Line icons share a 1.6px stroke with round caps
 * so they sit at the same visual weight as Geist's text next to them; solid
 * icons (record, play, pause) carry meaning by fill instead.
 *
 * Every icon takes its colour from the caller — an icon never decides whether
 * it is active.
 */

interface IconProps {
  readonly size?: number;
  readonly color?: string;
}

/** Record: the filled dot that also names the tab. */
export function RecordIcon({ size = 20, color = colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Circle cx={10} cy={10} r={6.2} fill={color} />
    </Svg>
  );
}

/** Library: a flat list, deliberately without folders. */
export function LibraryIcon({ size = 20, color = colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path
        d="M3 5h14M3 10h14M3 15h9"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SearchIcon({ size = 16, color = colors.textFaint }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Circle
        cx={7}
        cy={7}
        r={4.5}
        stroke={color}
        strokeWidth={1.6}
        fill="none"
      />
      <Path
        d="M10.5 10.5L14 14"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function CloseIcon({ size = 15, color = colors.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15">
      <Path
        d="M4 4l7 7M11 4l-7 7"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function BackIcon({ size = 18, color = colors.text }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path
        d="M11 3.5L5.5 9l5.5 5.5"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function PlayIcon({ size = 12, color = colors.textSecondary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path d="M3 1.6l7 4.4-7 4.4z" fill={color} />
    </Svg>
  );
}

export function PauseIcon({ size = 12, color = colors.signal }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Rect x={2} y={1.5} width={3} height={9} rx={1} fill={color} />
      <Rect x={7} y={1.5} width={3} height={9} rx={1} fill={color} />
    </Svg>
  );
}

/** Cloud: an Idea whose audio has been offloaded off this device. */
export function CloudIcon({ size = 14, color = colors.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path
        d="M4.6 12.5a3.1 3.1 0 01-.3-6.19 4 4 0 017.62-.98A2.9 2.9 0 0111.6 12.5z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** More: the row's actions, kept behind one glyph so rows stay scannable. */
export function MoreIcon({ size = 17, color = colors.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 17 17">
      <Circle cx={3.5} cy={8.5} r={1.5} fill={color} />
      <Circle cx={8.5} cy={8.5} r={1.5} fill={color} />
      <Circle cx={13.5} cy={8.5} r={1.5} fill={color} />
    </Svg>
  );
}

/** Queued: this Idea is still waiting to reach another device. */
export function QueuedIcon({ size = 12, color = colors.relay }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path
        d="M6 10V2.5M2.8 5.6L6 2.4l3.2 3.2"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** The desktop Bridge, as drawn on the Sync screen's paired-device card. */
export function DesktopIcon({ size = 26, color = colors.textMuted }: IconProps) {
  return (
    <Svg width={size} height={(size * 17) / 26} viewBox="0 0 26 17">
      <Rect
        x={0.75}
        y={0.75}
        width={24.5}
        height={13}
        rx={1.5}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
      />
      <Path
        d="M0 15.5h26"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </Svg>
  );
}
