import type { IdeaMetadata } from "./idea.js";

/**
 * Sync protocol types — the wire vocabulary Capture and Bridge share.
 *
 * Free-tier local-network sync (motif-6fu.6): one Capture pairs directly with
 * one Bridge on the same LAN, with no account. After pairing, Capture offers
 * Bridge any Idea it doesn't already have. Sync is always copy semantics — the
 * Capture-side Idea is never deleted or offloaded as a side effect (see the
 * epic's Implementation Decisions). Bridge's Rust core mirrors these types, so
 * the `kind` discriminants and field names below are a shared contract.
 */

export type SyncTransportKind = "local-network" | "cloud-relay";

/** A device announcing itself for pairing / discovery. */
export interface DeviceIdentity {
  readonly deviceId: string;
  readonly displayName: string;
  readonly role: "capture" | "bridge";
}

/**
 * Capture asking a Bridge to pair. Free tier has no account, so trust is
 * established by a short numeric code Bridge displays and the user types into
 * Capture — proving the two devices are the same person's.
 */
export interface PairingRequest {
  readonly kind: "pairing-request";
  readonly protocolVersion: number;
  readonly from: DeviceIdentity;
  readonly pairingCode: string;
}

/** Bridge's answer to a {@link PairingRequest}. */
export interface PairingResponse {
  readonly kind: "pairing-response";
  readonly protocolVersion: number;
  readonly accepted: boolean;
  /** The Bridge that answered, so Capture can remember its paired peer. */
  readonly bridge: DeviceIdentity;
}

/**
 * Bridge telling Capture which Ideas it already holds, so Capture offers only
 * the missing ones. The source of truth for what still needs syncing.
 */
export interface SyncManifest {
  readonly kind: "sync-manifest";
  readonly from: DeviceIdentity;
  /** Ids of Ideas Bridge already has. */
  readonly have: readonly string[];
}

/** Envelope announcing an Idea available to be synced. */
export interface IdeaSyncOffer {
  readonly kind: "idea-sync-offer";
  readonly from: DeviceIdentity;
  readonly idea: IdeaMetadata;
  /** Size of the audio payload in bytes. */
  readonly audioByteLength: number;
}

/** Receiver's response to an offer. */
export interface IdeaSyncAck {
  readonly kind: "idea-sync-ack";
  readonly ideaId: string;
  /** False when the receiver already has the Idea, or isn't paired. */
  readonly accepted: boolean;
}

/**
 * A metadata-only edit propagated to a paired peer. Unlike an offer this carries
 * no audio — only the full updated {@link IdeaMetadata} (with its per-field
 * timestamps) — and it flows in either direction: sync became bidirectional once
 * Bridge could edit metadata too (ADR 0006). The receiver merges it into the
 * Idea it already holds by per-field last-write-wins; an update for an Idea the
 * receiver doesn't have is ignored (its audio never arrived).
 */
export interface IdeaMetadataUpdate {
  readonly kind: "idea-metadata-update";
  readonly from: DeviceIdentity;
  readonly idea: IdeaMetadata;
}

/** Receiver's response to an {@link IdeaMetadataUpdate}. */
export interface IdeaUpdateAck {
  readonly kind: "idea-update-ack";
  readonly ideaId: string;
  /** True when the update was merged (the Idea was known and the peer trusted). */
  readonly accepted: boolean;
}

export type SyncMessage =
  | PairingRequest
  | PairingResponse
  | SyncManifest
  | IdeaSyncOffer
  | IdeaSyncAck
  | IdeaMetadataUpdate
  | IdeaUpdateAck;

/** Current protocol version negotiated between Capture and Bridge. */
export const SYNC_PROTOCOL_VERSION = 1 as const;

/**
 * Whether a peer advertising `peerVersion` speaks a protocol this build can
 * sync with. A single supported version for now; kept a function so version
 * negotiation can widen (e.g. a supported range) without changing callers.
 */
export function isSyncProtocolCompatible(peerVersion: number): boolean {
  return peerVersion === SYNC_PROTOCOL_VERSION;
}

/** Number of digits in a pairing code Bridge displays for the user to type. */
export const PAIRING_CODE_LENGTH = 6;

/** Whether `code` is a well-formed pairing code (exactly N digits, 0-9). */
export function isValidPairingCode(code: string): boolean {
  return new RegExp(`^\\d{${PAIRING_CODE_LENGTH}}$`).test(code);
}
