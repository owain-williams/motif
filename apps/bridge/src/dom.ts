import { syntheticWaveform } from "@motif/shared";

/**
 * Small DOM helpers shared by the three panes. Nothing app-specific lives here —
 * just element construction, the icon set, and the waveform bars, so the views
 * read as layout rather than as `createElement` bookkeeping.
 */

interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: readonly (Node | null | undefined)[];
  readonly onClick?: (event: MouseEvent) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(name, value);
  }
  for (const child of options.children ?? []) {
    if (child) node.append(child);
  }
  const onClick = options.onClick;
  if (onClick) {
    node.addEventListener("click", (event) => onClick(event as MouseEvent));
  }
  return node;
}

/** Requires an element the shell is expected to contain; a missing one is a bug. */
export function need<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Bridge shell is missing ${selector}`);
  return node;
}

/** Builds an icon from trusted, static markup — no user data reaches this. */
function svg(markup: string): SVGElement {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  return holder.firstElementChild as SVGElement;
}

export function playIcon(size = 11): SVGElement {
  return svg(
    `<svg width="${size}" height="${size}" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1.6l7 4.4-7 4.4z"/></svg>`,
  );
}

export function pauseIcon(size = 11): SVGElement {
  return svg(
    `<svg width="${size}" height="${size}" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>`,
  );
}

export function starIcon(filled: boolean): SVGElement {
  return svg(
    `<svg width="15" height="15" viewBox="0 0 17 17" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 1.8l2.06 4.3 4.64.63-3.4 3.25.86 4.62L8.5 12.4l-4.16 2.2.86-4.62L1.8 6.73l4.64-.63z"/></svg>`,
  );
}

/**
 * Fills `container` with the bars of an Idea's waveform. Heights come from
 * `@motif/shared`, which synthesizes them deterministically from the Idea id, so
 * the same Idea draws the same shape here, on a re-render, and in Capture.
 */
export function renderWaveform(
  container: HTMLElement,
  id: string,
  barCount: number,
  minPx: number,
  maxPx: number,
): void {
  container.dataset.waveFor = id;
  container.replaceChildren(
    ...syntheticWaveform(id, barCount).map((value) => {
      const bar = document.createElement("span");
      bar.style.height = `${Math.round(minPx + value * (maxPx - minPx))}px`;
      return bar;
    }),
  );
}

/** Marks the bars up to `ratio` (0–1) as played, leaving the rest unfilled. */
export function paintWaveform(container: HTMLElement, ratio: number): void {
  const bars = container.children;
  const played = ratio * bars.length;
  for (let index = 0; index < bars.length; index += 1) {
    bars[index]!.classList.toggle("played", index < played);
  }
}
