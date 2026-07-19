import type { IdeaMetadata, SyncTransportKind, Tier } from "@motif/shared";

/**
 * Capture-side sync engine — the device-free brain behind Free-tier
 * local-network sync (motif-6fu.6). It holds which Bridge this Capture is
 * paired with (and where to reach it) and computes which Ideas still need to be
 * offered. The wire transport (HTTP, filesystem) is the thin shell in
 * `src/idea-sync.ts` / `src/sync-storage.ts`; keeping these decisions here makes
 * them testable without a device or a network.
 *
 * Sync is always copy semantics: computing offers never deletes, offloads, or
 * reorders the caller's Library (CONTEXT.md, epic Implementation Decisions).
 */

/** A Bridge reachable on the LAN. Pure data — no transport dependency. */
export interface BridgeEndpoint {
  readonly host: string;
  readonly port: number;
}

/** The single Bridge a Free-tier Capture is paired with. */
export interface PairedBridge {
  readonly deviceId: string;
  readonly displayName: string;
  readonly endpoint: BridgeEndpoint;
}

export interface SyncEngineState {
  /** The paired Bridge, or `null` when this Capture isn't paired with one. */
  readonly pairedBridge: PairedBridge | null;
}

/** The resting state: not paired with any Bridge. */
export const UNPAIRED: SyncEngineState = { pairedBridge: null };

export function isPaired(state: SyncEngineState): boolean {
  return state.pairedBridge !== null;
}

/**
 * Pairs this Capture with `bridge`. Free tier is a single Capture ↔ single
 * Bridge relationship (CONTEXT.md), so pairing again simply replaces the peer
 * rather than accumulating a list.
 */
export function pairWithBridge(
  _state: SyncEngineState,
  bridge: PairedBridge,
): SyncEngineState {
  return { pairedBridge: bridge };
}

/** Forgets the paired Bridge, returning the resting state. */
export function unpair(_state: SyncEngineState): SyncEngineState {
  return UNPAIRED;
}

/**
 * Active sync paths for this tier. Local-network remains first/preferred when
 * a Bridge is reachable; paid tiers additionally relay through the account.
 * Free never receives a cloud path.
 */
export function syncTransports(
  tier: Tier,
  localBridgeAvailable: boolean,
): SyncTransportKind[] {
  const transports: SyncTransportKind[] = [];
  if (localBridgeAvailable) transports.push("local-network");
  if (tier === "basic" || tier === "pro") transports.push("cloud-relay");
  return transports;
}

/**
 * The Ideas Capture should offer Bridge: every on-device Idea whose id Bridge
 * doesn't already report having, oldest first so a freshly paired Bridge fills
 * its Library in chronological order. Offloaded Ideas are skipped — their audio
 * isn't on the device to send. Returns a new array; the input Library is left
 * untouched (copy semantics).
 */
export function ideasToOffer(
  library: readonly IdeaMetadata[],
  remoteHave: Iterable<string>,
): IdeaMetadata[] {
  const have = new Set(remoteHave);
  return library
    .filter((idea) => idea.storageState === "on-device" && !have.has(idea.id))
    .sort((a, b) => a.capturedAt - b.capturedAt);
}
