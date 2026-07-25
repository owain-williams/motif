import { File, Paths } from "expo-file-system";
import {
  DEFAULT_CAPTURE_SETTINGS,
  parseCaptureSettings,
} from "./core/capture-settings";
import type { CaptureSettings } from "./core/capture-settings";

export type { CaptureSettings } from "./core/capture-settings";
export const DEFAULT_SETTINGS = DEFAULT_CAPTURE_SETTINGS;

/**
 * On-device persistence for Capture's user settings. A tiny JSON file beside
 * the Library manifest, following the same thin-filesystem-shell pattern as
 * `idea-storage`.
 */

function settingsFile(): File {
  return new File(Paths.document, "settings.json");
}

/** Reads persisted settings, falling back to safe AAC-mono defaults. */
export async function loadSettings(): Promise<CaptureSettings> {
  const file = settingsFile();
  if (!file.exists) return { ...DEFAULT_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return parseCaptureSettings(parsed);
  } catch {
    // A missing/corrupt settings file just means defaults.
    return { ...DEFAULT_SETTINGS };
  }
}

/** Overwrites the persisted settings file. */
export function saveSettings(settings: CaptureSettings): void {
  const file = settingsFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(settings));
}
