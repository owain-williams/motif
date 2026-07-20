import { File, Paths } from "expo-file-system";

/**
 * On-device persistence for Capture's user settings — currently just the opt-in
 * location tagging toggle (motif-kka.3). A tiny JSON file beside the Library manifest,
 * following the same thin-filesystem-shell pattern as `idea-storage`.
 *
 * Location tagging is off by default: no location is ever captured until the user
 * explicitly turns it on.
 */
export interface CaptureSettings {
  /** Whether new recordings are location-tagged with the device's last-known place. */
  readonly locationTaggingEnabled: boolean;
}

export const DEFAULT_SETTINGS: CaptureSettings = { locationTaggingEnabled: false };

function settingsFile(): File {
  return new File(Paths.document, "settings.json");
}

/** Reads persisted settings, falling back to the safe defaults (location tag off). */
export async function loadSettings(): Promise<CaptureSettings> {
  const file = settingsFile();
  if (!file.exists) return { ...DEFAULT_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(await file.text());
    const locationTaggingEnabled =
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { locationTaggingEnabled?: unknown }).locationTaggingEnabled === true;
    return { locationTaggingEnabled };
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
