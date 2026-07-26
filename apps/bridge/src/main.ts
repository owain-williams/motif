import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/instrument-serif/400.css";

import {
  normalizeIdeaName,
  normalizeMultiValue,
  normalizeTempo,
} from "@motif/shared";
import type {
  IdeaFacetKind,
  IdeaMetadata,
  IdeaMetadataEdit,
} from "@motif/shared";
import {
  bridge,
  convertFileSrc,
  revealItemInDir,
  startNativeDrag,
} from "./bridge-api.js";
import { need } from "./dom.js";
import { renderInspector, renderProgress } from "./inspector-view.js";
import { renderRows, renderSidebar } from "./library-view.js";
import { PAIRING_STEPS, renderPairing } from "./pairing-view.js";
import { createState, selectedIdea } from "./state.js";
import type { Actions, AppState, ComposerField, LibraryFilter } from "./state.js";
import { hasOnboarded, loadStarred, markOnboarded, saveStarred } from "./starred.js";

/**
 * Bridge's window: state, the render pass, and the wiring between the two.
 *
 * The Rust core is authoritative — it holds the Library, the pairing and the
 * deletions, and it is polled rather than pushed to. Everything here is a view
 * of that, plus the transient bits a window owns: what is selected, what is
 * playing, and what the user is part-way through typing.
 */

const REFRESH_MS = 3000;
const PAIRING_TICK_MS = 1000;
const STATUS_CLEAR_MS = 4000;
const DRAG_RESET_MS = 2500;
const COGNITO_URL = "https://cognito-idp.eu-west-2.amazonaws.com/";
const CLIENT_ID = "158crbvjn6ss89plph8p8ivo96";
const API_URL = "https://to8jymiybd.execute-api.eu-west-2.amazonaws.com";
const DRAG_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAKUlEQVR4nO3OMQEAAAgDINc/9K3hHFQgE1mZmZmZmZmZmZmZmZmZmZk9uwFmhQJBsT+YVAAAAABJRU5ErkJggg==";

const state: AppState = createState(loadStarred());
let statusTimer: number | undefined;
let dragTimer: number | undefined;

function player(): HTMLAudioElement {
  return need<HTMLAudioElement>("#player");
}

function render(): void {
  need<HTMLElement>("#pair").hidden = state.screen !== "pair";
  need<HTMLElement>("#app").hidden = state.screen !== "app";
  if (state.screen === "pair") {
    renderPairing(state);
    return;
  }
  renderSidebar(state, actions);
  renderRows(state, actions);
  renderInspector(state, actions);
}

function setStatus(message: string, isError = false): void {
  const status = need<HTMLElement>("#status");
  status.textContent = message;
  status.classList.toggle("error", isError);
  window.clearTimeout(statusTimer);
  if (message.length === 0) return;
  statusTimer = window.setTimeout(() => {
    status.textContent = "";
    status.classList.remove("error");
  }, STATUS_CLEAR_MS);
}

/* Loading ------------------------------------------------------------------ */

/**
 * Pulls the Library and deletions from the core. A selected or playing Idea that
 * has left the Library — deleted here, or on the phone and merged in since —
 * stops being either, so the window never holds on to something that is gone.
 */
async function refreshLibrary(): Promise<void> {
  try {
    const [library, deleted] = await Promise.all([
      bridge.library(),
      bridge.recentlyDeleted(),
    ]);
    state.library = library;
    state.deleted = deleted;

    const held = new Set(library.map((idea) => idea.id));
    if (state.selectedId !== null && !held.has(state.selectedId)) {
      state.selectedId = null;
      state.deleteArmed = false;
      state.composerField = null;
    }
    if (state.playingId !== null && !held.has(state.playingId)) stopPlayback();
    render();
  } catch {
    // A transient command failure just means the last render stands.
  }
}

async function refreshPairing(): Promise<void> {
  try {
    state.pairing = await bridge.pairingInfo();
  } catch {
    state.pairing = null;
  }
  try {
    state.device = await bridge.pairedDevice();
  } catch {
    state.device = null;
  }
  render();
}

/* Playback ----------------------------------------------------------------- */

function stopPlayback(): void {
  const audio = player();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  state.playingId = null;
  state.progress = 0;
}

async function togglePlay(id: string): Promise<void> {
  if (state.playingId === id) {
    stopPlayback();
    render();
    return;
  }
  state.selectedId = id;
  state.deleteArmed = false;
  try {
    const path = await bridge.audioPath(id);
    const audio = player();
    audio.src = convertFileSrc(path);
    audio.load();
    state.playingId = id;
    state.progress = 0;
    render();
    await audio.play();
  } catch {
    stopPlayback();
    render();
    setStatus("That Idea's audio could not be played.", true);
  }
}

/* Editing ------------------------------------------------------------------ */

/** Applies an edit to the selected Idea and re-reads the Library it changed. */
async function applyEdit(id: string, edit: IdeaMetadataEdit): Promise<void> {
  try {
    await bridge.editIdea(id, edit);
    await refreshLibrary();
  } catch (error) {
    setStatus(`Could not save that change: ${String(error)}`, true);
  }
}

function withoutValue(
  values: readonly string[],
  value: string,
): string[] {
  const dropped = value.toLocaleLowerCase();
  return values.filter(
    (candidate) => candidate.toLocaleLowerCase() !== dropped,
  );
}

function removeMetadata(
  idea: IdeaMetadata,
  kind: IdeaFacetKind,
  value: string,
): IdeaMetadataEdit {
  if (kind === "tempo") return { tempo: null };
  if (kind === "location") return { location: null };
  return { [kind]: withoutValue(idea[kind], value) };
}

function addMetadata(
  idea: IdeaMetadata,
  field: ComposerField,
  raw: string,
): IdeaMetadataEdit | null {
  if (field === "tempo") {
    const tempo = normalizeTempo(raw);
    return tempo === null ? null : { tempo };
  }
  const values = normalizeMultiValue([...idea[field], raw]);
  return values.length === idea[field].length ? null : { [field]: values };
}

/* Actions ------------------------------------------------------------------ */

const actions: Actions = {
  selectIdea(id) {
    if (state.selectedId === id) return;
    state.selectedId = id;
    state.deleteArmed = false;
    state.dragDone = false;
    state.composerField = null;
    render();
  },
  togglePlay(id) {
    void togglePlay(id);
  },
  toggleStar(id) {
    if (state.starred.has(id)) state.starred.delete(id);
    else state.starred.add(id);
    saveStarred(state.starred);
    render();
  },
  restoreIdea(id) {
    void (async () => {
      try {
        await bridge.restoreIdea(id);
        await refreshLibrary();
        setStatus("Restored to the Library.");
      } catch (error) {
        setStatus(`Could not restore that Idea: ${String(error)}`, true);
      }
    })();
  },
  setFilter(filter: LibraryFilter) {
    state.filter = filter;
    render();
  },
  clearFilters() {
    state.query = "";
    state.filter = { kind: "all" };
    need<HTMLInputElement>("#search").value = "";
    render();
  },
  removeMetadata(kind, value) {
    const idea = selectedIdea(state);
    if (idea === null) return;
    void applyEdit(idea.id, removeMetadata(idea, kind, value));
  },
  openComposer(field) {
    state.composerField = field;
    render();
    const input = need<HTMLInputElement>("#composer-input");
    input.value = "";
    input.focus();
  },
  closeComposer() {
    state.composerField = null;
    render();
  },
  addMetadata(value) {
    const idea = selectedIdea(state);
    const field = state.composerField;
    if (idea === null || field === null) return;
    const edit = addMetadata(idea, field, value);
    need<HTMLInputElement>("#composer-input").value = "";
    if (edit === null) return;
    void applyEdit(idea.id, edit);
  },
};

/* Cloud relay -------------------------------------------------------------- */

/**
 * Signs in for the Pro cloud relay. The relay is additive to LAN sync — it is
 * what lets an Idea arrive when the phone is nowhere near this network — so a
 * failed sign-in leaves Bridge working exactly as it did.
 */
async function signIn(email: string, password: string): Promise<void> {
  const error = need<HTMLElement>("#signin-error");
  const submit = need<HTMLButtonElement>("#signin-submit");
  error.hidden = true;
  submit.disabled = true;
  submit.textContent = "Signing in…";

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
    if (!response.ok || !idToken) throw new Error(result.message ?? "Sign-in failed");

    const profileResponse = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const profile = (await profileResponse.json()) as { tier?: string };
    if (!profileResponse.ok || profile.tier !== "pro") {
      throw new Error("Cloud relay requires a Pro account.");
    }

    await bridge.enableCloudSync(idToken);
    state.relayEmail = email.trim().toLowerCase();
    closeSignIn();
    render();
    setStatus("Cloud relay connected.");
  } catch (caught) {
    error.textContent =
      caught instanceof Error ? caught.message : "Cloud sign-in failed";
    error.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
}

function openSignIn(): void {
  need<HTMLElement>("#signin-backdrop").hidden = false;
  need<HTMLElement>("#signin-error").hidden = true;
  need<HTMLInputElement>("#signin-email").focus();
}

function closeSignIn(): void {
  need<HTMLElement>("#signin-backdrop").hidden = true;
  need<HTMLFormElement>("#signin-form").reset();
}

/** Signs in when local-only, signs out when connected. */
function toggleRelay(): void {
  if (state.relayEmail === null) {
    openSignIn();
    return;
  }
  void bridge.disableCloudSync();
  state.relayEmail = null;
  render();
  setStatus("Cloud relay disconnected. Local sync is unaffected.");
}

/* Handoff ------------------------------------------------------------------ */

/**
 * Prepares the selected Idea for a DAW and hands it to the OS as a native drag.
 * An AAC Idea is decoded to WAV first, which is why this starts on mousedown —
 * the file has to exist before the drag does.
 */
async function startDrag(idea: IdeaMetadata): Promise<void> {
  setStatus(
    idea.audioFormat === "aac" ? "Preparing WAV…" : "Preparing drag…",
  );
  try {
    const path = await bridge.prepareHandoff(idea.id);
    setStatus("");
    await startNativeDrag(path, DRAG_ICON, () => {
      state.dragDone = true;
      render();
      window.clearTimeout(dragTimer);
      dragTimer = window.setTimeout(() => {
        state.dragDone = false;
        render();
      }, DRAG_RESET_MS);
    });
  } catch (error) {
    setStatus(`Could not prepare this Idea for drag: ${String(error)}`, true);
  }
}

async function reveal(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch {
    setStatus("Could not open that folder.", true);
  }
}

/* Wiring ------------------------------------------------------------------- */

function goToApp(): void {
  markOnboarded();
  state.screen = "app";
  render();
}

function wirePairing(): void {
  need("#pair-next").addEventListener("click", () => {
    if (state.step < PAIRING_STEPS.length - 1) {
      state.step += 1;
      render();
      return;
    }
    goToApp();
  });
  need("#pair-skip").addEventListener("click", goToApp);
  need("#ideas-dir-reveal").addEventListener("click", () => {
    void reveal(state.ideasDir);
  });
  need("#pair-relay").addEventListener("click", toggleRelay);
  need("#pair-another").addEventListener("click", () => {
    // Straight to the code: the phone is already set up, this is a second one.
    state.screen = "pair";
    state.step = 1;
    render();
  });
}

function wireLibrary(): void {
  const search = need<HTMLInputElement>("#search");
  search.addEventListener("input", () => {
    state.query = search.value;
    render();
  });
  need("#search-clear").addEventListener("click", () => {
    state.query = "";
    search.value = "";
    search.focus();
    render();
  });
  need("#sort").addEventListener("click", () => {
    state.sort = state.sort === "newest" ? "longest" : "newest";
    render();
  });
  need("#empty-clear").addEventListener("click", () => actions.clearFilters());
  need("#relay-action").addEventListener("click", toggleRelay);
}

function wireInspector(): void {
  const name = need<HTMLInputElement>("#name");
  name.addEventListener("change", () => {
    const idea = selectedIdea(state);
    if (idea === null) return;
    const renamed = normalizeIdeaName(name.value);
    // A blank name is not a rename; put the existing one back.
    if (renamed === null || renamed === idea.name) {
      name.value = idea.name;
      return;
    }
    void applyEdit(idea.id, { name: renamed });
  });
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") name.blur();
    if (event.key === "Escape") {
      name.value = selectedIdea(state)?.name ?? "";
      name.blur();
    }
  });

  need("#play").addEventListener("click", () => {
    if (state.selectedId !== null) void togglePlay(state.selectedId);
  });

  const composerInput = need<HTMLInputElement>("#composer-input");
  composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      actions.closeComposer();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = composerInput.value.trim();
    if (value.length > 0) actions.addMetadata(value);
  });

  need("#drag").addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    const idea = selectedIdea(state);
    if (idea !== null) void startDrag(idea);
  });

  need("#reveal").addEventListener("click", () => {
    const id = state.selectedId;
    if (id === null) return;
    void (async () => {
      try {
        await reveal(await bridge.audioPath(id));
      } catch {
        setStatus("That Idea's audio is missing.", true);
      }
    })();
  });

  need("#delete").addEventListener("click", () => {
    const idea = selectedIdea(state);
    if (idea === null) return;
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      render();
      return;
    }
    state.deleteArmed = false;
    void (async () => {
      try {
        await bridge.deleteIdea(idea.id);
        await refreshLibrary();
        setStatus("Moved to Recently Deleted.");
      } catch (error) {
        setStatus(`Could not delete that Idea: ${String(error)}`, true);
      }
    })();
  });
}

function wireSignIn(): void {
  need<HTMLFormElement>("#signin-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void signIn(
      need<HTMLInputElement>("#signin-email").value,
      need<HTMLInputElement>("#signin-password").value,
    );
  });
  need("#signin-cancel").addEventListener("click", closeSignIn);
  need("#signin-backdrop").addEventListener("click", (event) => {
    // A click on the backdrop itself, not the dialog, dismisses it.
    if (event.target === event.currentTarget) closeSignIn();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!need<HTMLElement>("#signin-backdrop").hidden) closeSignIn();
  });
}

function wirePlayer(): void {
  const audio = player();
  audio.addEventListener("timeupdate", () => {
    if (state.playingId === null) return;
    const total = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : (selectedIdea(state)?.durationMs ?? 0) / 1000;
    state.progress = total > 0 ? Math.min(1, audio.currentTime / total) : 0;
    renderProgress(state);
  });
  audio.addEventListener("ended", () => {
    stopPlayback();
    render();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  wirePairing();
  wireLibrary();
  wireInspector();
  wireSignIn();
  wirePlayer();

  // A Bridge that has never been walked through starts at the walkthrough.
  state.screen = hasOnboarded() ? "app" : "pair";
  render();

  void bridge
    .ideasDir()
    .then((dir) => {
      state.ideasDir = dir;
      render();
    })
    .catch(() => undefined);
  void refreshLibrary();
  void refreshPairing();

  window.setInterval(() => void refreshLibrary(), REFRESH_MS);
  window.setInterval(() => void refreshPairing(), REFRESH_MS);
  // The pairing countdown is the only thing that changes every second, and only
  // while it is on screen.
  window.setInterval(() => {
    if (state.screen === "pair") renderPairing(state);
  }, PAIRING_TICK_MS);
});
