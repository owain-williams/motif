import { activeIdeas, mergeIdea, sameEditableMetadata } from "@motif/shared";
import type {
  IdeaDeletion,
  IdeaMetadata,
  SyncTransportKind,
  Tier,
} from "@motif/shared";

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
export type IdeaStorageAction = "offload" | "redownload";

/**
 * The explicit cloud-storage action Capture should offer for an Idea. Cloud
 * actions are available only while the account has Basic/Pro cloud access;
 * Free can neither offload nor fetch cloud-only audio.
 */
export function ideaStorageAction(
  tier: Tier,
  idea: IdeaMetadata,
): IdeaStorageAction | null {
  if (tier === "free") return null;
  return idea.storageState === "offloaded" ? "redownload" : "offload";
}

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
 * isn't on the device to send — and so are deleted ones, since offering an Idea
 * this device has deleted would resurrect it on Bridge (ADR 0005). `deletions`
 * defaults to none, the state of a device that has never deleted anything.
 * Returns a new array; the input Library is left untouched (copy semantics).
 */
export function ideasToOffer(
  library: readonly IdeaMetadata[],
  remoteHave: Iterable<string>,
  deletions: readonly IdeaDeletion[] = [],
): IdeaMetadata[] {
  const have = new Set(remoteHave);
  return activeIdeas(library, deletions)
    .filter((idea) => idea.storageState === "on-device" && !have.has(idea.id))
    .sort((a, b) => a.capturedAt - b.capturedAt);
}

/** The outcome of reconciling local metadata against a peer's Library. */
export interface MetadataReconciliation {
  /** The local Library with each shared Idea merged per-field (ADR 0006). */
  readonly merged: IdeaMetadata[];
  /** Merged Ideas whose local metadata is newer than the peer's, to push back. */
  readonly toPush: IdeaMetadata[];
}

/**
 * Reconciles this device's metadata with a paired peer's Library snapshot,
 * making metadata sync bidirectional. Every Idea both sides hold is merged by
 * per-field last-write-wins, so the peer's newer edits land locally; any Idea
 * whose local copy still carries a field newer than the peer's is collected in
 * `toPush` so the caller can send it back. Ideas the peer doesn't have (not yet
 * offered, or offloaded) are passed through unchanged — the audio-carrying offer
 * path owns those. Pure: the inputs are never mutated.
 */
export function reconcileMetadata(
  local: readonly IdeaMetadata[],
  remote: readonly IdeaMetadata[],
): MetadataReconciliation {
  const remoteById = new Map(remote.map((idea) => [idea.id, idea]));
  const merged: IdeaMetadata[] = [];
  const toPush: IdeaMetadata[] = [];
  for (const idea of local) {
    const peer = remoteById.get(idea.id);
    if (!peer) {
      merged.push(idea);
      continue;
    }
    const result = mergeIdea(idea, peer);
    merged.push(result);
    // If the merge left the peer behind on any field, the peer's copy is stale.
    if (!sameEditableMetadata(result, peer)) {
      toPush.push(result);
    }
  }
  return { merged, toPush };
}
