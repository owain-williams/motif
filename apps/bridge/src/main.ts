import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  distinctFieldValues,
  formatDuration,
  ideaMetadataLabels,
  normalizeMultiValue,
  normalizeTempo,
  searchLibrary,
} from "@motif/shared";
import type {
  IdeaMetadata,
  IdeaMetadataEdit,
  MultiValueIdeaField,
} from "@motif/shared";

/**
 * Bridge frontend shell. Renders synced Ideas, previews their received audio,
 * and asks the Rust core for a DAW-ready file when one is dragged out. Native
 * drag/drop is delegated to tauri-plugin-drag so another desktop app receives
 * an actual file rather than browser drag data.
 */

interface PairingInfo {
  readonly code: string;
  readonly expiresAt: number;
  readonly lockedUntil: number | null;
}

const REFRESH_MS = 3000;
const COGNITO_URL = "https://cognito-idp.eu-west-2.amazonaws.com/";
const CLIENT_ID = "158crbvjn6ss89plph8p8ivo96";
const API_URL = "https://to8jymiybd.execute-api.eu-west-2.amazonaws.com";
const DRAG_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAKUlEQVR4nO3OMQEAAAgDINc/9K3hHFQgE1mZmZmZmZmZmZmZmZmZmZk9uwFmhQJBsT+YVAAAAABJRU5ErkJggg==";
let selectedIdeaId: string | null = null;
let loadedLibrary: IdeaMetadata[] = [];
let searchQuery = "";
// The Idea whose metadata is open in the editor, or null when it's closed.
let metadataTargetId: string | null = null;

async function loadPairingInfo(): Promise<void> {
  const el = document.querySelector<HTMLParagraphElement>("#pairing");
  if (!el) return;
  try {
    const info = await invoke<PairingInfo>("pairing_info");
    const now = Math.floor(Date.now() / 1000);
    if (info.lockedUntil !== null && info.lockedUntil > now) {
      el.textContent = `Pairing locked · try again in ${info.lockedUntil - now}s`;
      return;
    }
    const remaining = Math.max(0, info.expiresAt - now);
    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, "0");
    el.textContent = `Pair a phone · code ${info.code} · refreshes in ${minutes}:${seconds}`;
  } catch {
    el.textContent = "Sync receiver unavailable";
  }
}

async function previewIdea(idea: IdeaMetadata): Promise<void> {
  const preview = document.querySelector<HTMLElement>("#preview");
  const name = document.querySelector<HTMLElement>("#preview-name");
  const player = document.querySelector<HTMLAudioElement>("#player");
  if (!preview || !name || !player) return;

  try {
    const path = await invoke<string>("preview_audio_path", { id: idea.id });
    selectedIdeaId = idea.id;
    name.textContent = idea.name;
    player.src = convertFileSrc(path);
    preview.hidden = false;
    player.load();
    void player.play().catch(() => {
      // Controls remain available when the webview declines autoplay.
    });
    document.querySelector(`[data-idea-id="${CSS.escape(idea.id)}"]`)?.classList.add("selected");
  } catch {
    setHandoffStatus("That Idea's audio could not be previewed.", true);
  }
}

function setHandoffStatus(message: string, isError = false): void {
  const status = document.querySelector<HTMLParagraphElement>("#handoff-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function startIdeaDrag(idea: IdeaMetadata): Promise<void> {
  setHandoffStatus(
    idea.audioFormat === "aac" ? "Preparing WAV for drag…" : "Preparing drag…",
  );
  try {
    const path = await invoke<string>("prepare_handoff", { id: idea.id });
    const onEvent = new Channel<unknown>();
    onEvent.onmessage = () => setHandoffStatus("");
    await invoke("plugin:drag|start_drag", {
      item: [path],
      image: DRAG_ICON,
      options: { mode: "copy" },
      onEvent,
    });
  } catch (error) {
    setHandoffStatus(`Could not prepare this Idea for drag: ${String(error)}`, true);
  }
}

function renderLibrary(ideas: readonly IdeaMetadata[]): void {
  const list = document.querySelector<HTMLUListElement>("#library");
  const empty = document.querySelector<HTMLParagraphElement>("#empty");
  if (!list || !empty) return;
  empty.hidden = ideas.length > 0;
  empty.textContent =
    loadedLibrary.length > 0 && searchQuery.trim().length > 0
      ? "No Ideas match your search."
      : "Waiting for an Idea to sync from your phone…";
  list.replaceChildren(
    ...ideas.map((idea) => {
      const row = document.createElement("li");
      row.className = "library-row";
      row.dataset.ideaId = idea.id;
      row.classList.toggle("selected", idea.id === selectedIdeaId);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Preview ${idea.name}`);

      const name = document.createElement("span");
      name.className = "idea-name";
      name.textContent = idea.name;

      const duration = document.createElement("span");
      duration.className = "idea-duration";
      duration.textContent = formatDuration(idea.durationMs);

      const edit = document.createElement("button");
      edit.className = "edit-handle";
      edit.type = "button";
      edit.title = "Edit tags, instrument, style, tempo";
      edit.setAttribute("aria-label", `Edit metadata for ${idea.name}`);
      edit.textContent = "Edit";
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        openMetadataEditor(idea.id);
      });

      const drag = document.createElement("button");
      drag.className = "drag-handle";
      drag.type = "button";
      drag.title = "Drag WAV to your DAW";
      drag.setAttribute("aria-label", `Drag ${idea.name} to another app`);
      drag.textContent = "Drag WAV";
      drag.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        void startIdeaDrag(idea);
      });
      drag.addEventListener("click", (event) => event.stopPropagation());

      row.addEventListener("click", () => void previewIdea(idea));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void previewIdea(idea);
        }
      });
      row.append(name, duration, edit, drag);

      const chips = metadataChips(idea);
      if (chips) row.append(chips);
      return row;
    }),
  );
}

const MULTI_FIELDS: readonly MultiValueIdeaField[] = [
  "tags",
  "instrument",
  "style",
];

/** A compact summary of an Idea's searchable metadata, or null when it has none. */
function metadataChips(idea: IdeaMetadata): HTMLElement | null {
  const labels = ideaMetadataLabels(idea);
  if (labels.length === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "library-chips";
  wrap.append(
    ...labels.map((label) => {
      const chip = document.createElement("span");
      chip.className = "library-chip";
      chip.textContent = label;
      return chip;
    }),
  );
  return wrap;
}

function fieldInput(field: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`#edit-${field}`);
}

function readMultiValueInput(field: MultiValueIdeaField): string[] {
  return normalizeMultiValue((fieldInput(field)?.value ?? "").split(","));
}

/**
 * Renders the distinct values already used across the Library as clickable
 * suggestions for one field, hiding ones already entered — the same
 * autocomplete-from-distinct-values approach Capture uses (CONTEXT.md).
 */
function renderFieldSuggestions(field: MultiValueIdeaField): void {
  const container = document.querySelector<HTMLDivElement>(
    `#edit-${field}-suggestions`,
  );
  const input = fieldInput(field);
  if (!container || !input) return;
  const chosen = new Set(
    readMultiValueInput(field).map((value) => value.toLocaleLowerCase()),
  );
  const suggestions = distinctFieldValues(loadedLibrary, field).filter(
    (value) => !chosen.has(value.toLocaleLowerCase()),
  );
  container.replaceChildren(
    ...suggestions.map((value) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "metadata-suggestion";
      chip.textContent = value;
      chip.addEventListener("click", () => {
        input.value = normalizeMultiValue([
          ...readMultiValueInput(field),
          value,
        ]).join(", ");
        renderFieldSuggestions(field);
      });
      return chip;
    }),
  );
}

function openMetadataEditor(id: string): void {
  const idea = loadedLibrary.find((entry) => entry.id === id);
  const backdrop = document.querySelector<HTMLDivElement>("#metadata-backdrop");
  if (!idea || !backdrop) return;
  metadataTargetId = id;
  const nameEl = document.querySelector<HTMLElement>("#metadata-idea-name");
  if (nameEl) nameEl.textContent = idea.name;
  const values: Record<string, string> = {
    tags: idea.tags.join(", "),
    instrument: idea.instrument.join(", "),
    style: idea.style.join(", "),
    tempo: idea.tempo === null ? "" : String(idea.tempo),
  };
  for (const [field, value] of Object.entries(values)) {
    const input = fieldInput(field);
    if (input) input.value = value;
  }
  MULTI_FIELDS.forEach(renderFieldSuggestions);
  backdrop.hidden = false;
  fieldInput("tags")?.focus();
}

function closeMetadataEditor(): void {
  metadataTargetId = null;
  const backdrop = document.querySelector<HTMLDivElement>("#metadata-backdrop");
  if (backdrop) backdrop.hidden = true;
}

async function submitMetadataEditor(): Promise<void> {
  const id = metadataTargetId;
  const idea = loadedLibrary.find((entry) => entry.id === id);
  if (!id || !idea) {
    closeMetadataEditor();
    return;
  }
  const edit: IdeaMetadataEdit = {
    // Name isn't edited on Bridge; send the current value so it never re-stamps.
    name: idea.name,
    tags: readMultiValueInput("tags"),
    instrument: readMultiValueInput("instrument"),
    style: readMultiValueInput("style"),
    tempo: normalizeTempo(fieldInput("tempo")?.value ?? ""),
  };
  closeMetadataEditor();
  try {
    await invoke("edit_idea", { id, edit });
    // Reflect the edit locally right away; Capture picks it up on its next sync.
    await refreshLibrary();
  } catch (error) {
    setHandoffStatus(`Could not save that Idea's metadata: ${String(error)}`, true);
  }
}

async function loginForCloud(email: string, password: string): Promise<void> {
  const status = document.querySelector<HTMLParagraphElement>("#cloud-status");
  const form = document.querySelector<HTMLFormElement>("#cloud-login");
  const logout = document.querySelector<HTMLButtonElement>("#cloud-logout");
  if (!status || !form || !logout) return;
  status.textContent = "Logging in…";

  try {
    const response = await fetch(COGNITO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        ClientId: CLIENT_ID,
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: {
          USERNAME: email.trim().toLowerCase(),
          PASSWORD: password,
        },
      }),
    });
    const result = (await response.json()) as {
      AuthenticationResult?: { IdToken?: string };
      message?: string;
    };
    const idToken = result.AuthenticationResult?.IdToken;
    if (!response.ok || !idToken) throw new Error(result.message ?? "Login failed");

    const profileResponse = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const profile = (await profileResponse.json()) as { tier?: string };
    if (!profileResponse.ok || (profile.tier !== "basic" && profile.tier !== "pro")) {
      throw new Error("Cloud relay requires a Basic or Pro account.");
    }

    await invoke("enable_cloud_sync", { idToken });
    status.textContent = `${profile.tier === "pro" ? "Pro" : "Basic"} cloud relay connected`;
    form.hidden = true;
    logout.hidden = false;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Cloud login failed";
  }
}

async function refreshLibrary(): Promise<void> {
  try {
    loadedLibrary = await invoke<IdeaMetadata[]>("library");
    renderLibrary(searchLibrary(loadedLibrary, searchQuery));
  } catch {
    // A transient command failure just means we keep the last render.
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.querySelector<HTMLInputElement>("#library-search")?.addEventListener("input", (event) => {
    searchQuery = (event.currentTarget as HTMLInputElement).value;
    renderLibrary(searchLibrary(loadedLibrary, searchQuery));
  });
  document.querySelector<HTMLFormElement>("#cloud-login")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = document.querySelector<HTMLInputElement>("#cloud-email")?.value ?? "";
    const password = document.querySelector<HTMLInputElement>("#cloud-password")?.value ?? "";
    void loginForCloud(email, password);
  });
  document.querySelector<HTMLFormElement>("#metadata-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitMetadataEditor();
  });
  document
    .querySelector<HTMLButtonElement>("#metadata-cancel")
    ?.addEventListener("click", () => closeMetadataEditor());
  document
    .querySelector<HTMLDivElement>("#metadata-backdrop")
    ?.addEventListener("click", (event) => {
      // A click on the backdrop itself (not the form) dismisses the editor.
      if (event.target === event.currentTarget) closeMetadataEditor();
    });
  for (const field of MULTI_FIELDS) {
    fieldInput(field)?.addEventListener("input", () =>
      renderFieldSuggestions(field),
    );
  }
  document.querySelector<HTMLButtonElement>("#cloud-logout")?.addEventListener("click", () => {
    void invoke("disable_cloud_sync");
    const form = document.querySelector<HTMLFormElement>("#cloud-login");
    const logout = document.querySelector<HTMLButtonElement>("#cloud-logout");
    const status = document.querySelector<HTMLParagraphElement>("#cloud-status");
    if (form) form.hidden = false;
    if (logout) logout.hidden = true;
    if (status) status.textContent = "Log in to sync Basic/Pro Ideas from anywhere.";
  });
  void loadPairingInfo();
  void refreshLibrary();
  setInterval(() => void refreshLibrary(), REFRESH_MS);
  setInterval(() => void loadPairingInfo(), REFRESH_MS);
});
