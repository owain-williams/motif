import type { IdeaMetadata } from "./idea.js";

/**
 * Sync protocol types — the wire vocabulary Capture and Bridge share.
 *
 * Placeholder for the scaffold. Sync is always copy semantics: the
 * Capture-side copy is never deleted or offloaded as a side effect of
 * syncing (see the epic's Implementation Decisions). Bridge's Rust core
 * maintains its own equivalent types.
 */

export type SyncTransportKind = "local-network" | "cloud-relay";

/** A device announcing itself for pairing / discovery. */
export interface DeviceIdentity {
  readonly deviceId: string;
  readonly displayName: string;
  readonly role: "capture" | "bridge";
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
  readonly accepted: boolean;
}

export type SyncMessage = IdeaSyncOffer | IdeaSyncAck;

/** Current protocol version negotiated between Capture and Bridge. */
export const SYNC_PROTOCOL_VERSION = 1 as const;
