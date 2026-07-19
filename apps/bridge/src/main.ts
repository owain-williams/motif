import { invoke } from "@tauri-apps/api/core";
import { formatDuration } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";

/**
 * Bridge frontend shell. Renders the Library of Ideas synced from Capture and
 * the pairing details a phone needs to connect (motif-6fu.6). It owns no sync
 * logic: the Rust `bridge-core` receiver accepts Ideas over the LAN, and these
 * commands (`library`, `pairing_info`) just read its state across the Tauri
 * boundary. The Library is polled so a freshly synced Idea appears on its own,
 * with no manual refresh.
 */

interface PairingInfo {
  readonly code: string;
  readonly host: string | null;
  readonly port: number;
}

const REFRESH_MS = 3000;

async function loadPairingInfo(): Promise<void> {
  const el = document.querySelector<HTMLParagraphElement>("#pairing");
  if (!el) return;
  try {
    const info = await invoke<PairingInfo>("pairing_info");
    const address = info.host ? `${info.host}:${info.port}` : `port ${info.port}`;
    el.textContent = `Pair a phone · ${address} · code ${info.code}`;
  } catch {
    el.textContent = "Sync receiver unavailable";
  }
}

function renderLibrary(ideas: readonly IdeaMetadata[]): void {
  const list = document.querySelector<HTMLUListElement>("#library");
  const empty = document.querySelector<HTMLParagraphElement>("#empty");
  if (!list || !empty) return;
  empty.hidden = ideas.length > 0;
  list.replaceChildren(
    ...ideas.map((idea) => {
      const row = document.createElement("li");
      row.className = "library-row";

      const name = document.createElement("span");
      name.className = "idea-name";
      name.textContent = idea.name;

      const duration = document.createElement("span");
      duration.className = "idea-duration";
      duration.textContent = formatDuration(idea.durationMs);

      row.append(name, duration);
      return row;
    }),
  );
}

async function refreshLibrary(): Promise<void> {
  try {
    const ideas = await invoke<IdeaMetadata[]>("library");
    renderLibrary(ideas);
  } catch {
    // A transient command failure just means we keep the last render.
  }
}

window.addEventListener("DOMContentLoaded", () => {
  void loadPairingInfo();
  void refreshLibrary();
  setInterval(() => void refreshLibrary(), REFRESH_MS);
});
