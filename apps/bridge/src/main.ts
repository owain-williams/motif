import { SYNC_PROTOCOL_VERSION } from "@motif/shared";

/**
 * Bridge frontend shell (scaffold). Renders a placeholder window and imports
 * a value from @motif/shared to prove the shared package resolves in the
 * Tauri webview. Click-to-preview and DAW drag-and-drop land in a later
 * ticket; those call into the Rust `bridge-core` crate via Tauri commands.
 */
window.addEventListener("DOMContentLoaded", () => {
  const status = document.querySelector<HTMLParagraphElement>("#status");
  if (status) {
    status.textContent = `sync protocol v${SYNC_PROTOCOL_VERSION}`;
  }
});
