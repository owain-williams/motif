import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { formatDuration } from "@motif/shared";
import type { IdeaMetadata } from "@motif/shared";

/**
 * Bridge frontend shell. Renders synced Ideas, previews their received audio,
 * and asks the Rust core for a DAW-ready file when one is dragged out. Native
 * drag/drop is delegated to tauri-plugin-drag so another desktop app receives
 * an actual file rather than browser drag data.
 */

interface PairingInfo {
  readonly code: string;
  readonly host: string | null;
  readonly port: number;
}

const REFRESH_MS = 3000;
const DRAG_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAKUlEQVR4nO3OMQEAAAgDINc/9K3hHFQgE1mZmZmZmZmZmZmZmZmZmZk9uwFmhQJBsT+YVAAAAABJRU5ErkJggg==";
let selectedIdeaId: string | null = null;

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
      row.append(name, duration, drag);
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
