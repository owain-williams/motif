import type {
  DeviceIdentity,
  IdeaMetadata,
  IdeaSyncAck,
  IdeaSyncOffer,
  PairingRequest,
  PairingResponse,
} from "@motif/shared";
import { ideasToOffer } from "./core/sync-engine";
import type { BridgeEndpoint } from "./core/sync-engine";
import { frameOffer } from "./core/sync-wire";
import { MOTIF_API_URL } from "./account-client";

/**
 * Capture-side transport for Free-tier local-network sync (motif-6fu.6) — the
 * thin `fetch` shell that carries the decisions made by the tested sync engine
 * (`src/core/sync-engine`) to Bridge's HTTP receiver. Audio reading is injected
 * so this module stays free of `expo-file-system` and its one bit of real
 * logic — the wire framing that must match Bridge's Rust parser — is unit
 * testable.
 *
 * Sync is copy semantics: offering an Idea never alters the local Library.
 */

function endpointUrl(endpoint: BridgeEndpoint, path: string): string {
  return `http://${endpoint.host}:${endpoint.port}${path}`;
}

/** Asks a Bridge to pair, using the code the user read off Bridge's screen. */
export async function requestPairing(
  endpoint: BridgeEndpoint,
  request: PairingRequest,
): Promise<PairingResponse> {
  const response = await fetch(endpointUrl(endpoint, "/motif/pair"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Pairing failed (${response.status})`);
  }
  return (await response.json()) as PairingResponse;
}

/** Fetches the ids Bridge already holds, so Capture offers only the rest. */
export async function fetchManifest(endpoint: BridgeEndpoint): Promise<string[]> {
  const response = await fetch(endpointUrl(endpoint, "/motif/manifest"));
  if (!response.ok) {
    throw new Error(`Manifest fetch failed (${response.status})`);
  }
  const manifest = (await response.json()) as { have?: string[] };
  return manifest.have ?? [];
}

/** Offers one Idea and its audio to Bridge, returning Bridge's ack. */
export async function offerIdea(
  endpoint: BridgeEndpoint,
  offer: IdeaSyncOffer,
  audio: Uint8Array,
): Promise<IdeaSyncAck> {
  const response = await fetch(endpointUrl(endpoint, "/motif/ideas"), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Blob([frameOffer(offer, audio)]),
  });
  if (!response.ok) {
    throw new Error(`Idea offer failed (${response.status})`);
  }
  return (await response.json()) as IdeaSyncAck;
}

export interface SyncPlan {
  readonly endpoint: BridgeEndpoint;
  /** This Capture's identity, stamped on every offer. */
  readonly capture: DeviceIdentity;
  readonly library: readonly IdeaMetadata[];
  /** Reads an Idea's on-device audio bytes to upload. */
  readonly readAudio: (idea: IdeaMetadata) => Promise<Uint8Array>;
}

/**
 * Offers every Idea Bridge is missing, one at a time, and returns the ids
 * Bridge accepted. Diffs against Bridge's live manifest (via the tested
 * engine), so it's safe to call repeatedly — already-synced Ideas are skipped.
 */
export async function syncPendingIdeas(plan: SyncPlan): Promise<string[]> {
  const have = await fetchManifest(plan.endpoint);
  const pending = ideasToOffer(plan.library, have);
  const synced: string[] = [];
  for (const idea of pending) {
    const audio = await plan.readAudio(idea);
    const offer: IdeaSyncOffer = {
      kind: "idea-sync-offer",
      from: plan.capture,
      idea,
      audioByteLength: audio.length,
    };
    const ack = await offerIdea(plan.endpoint, offer, audio);
    if (ack.accepted) {
      synced.push(ack.ideaId);
    }
  }
  return synced;
}

export interface CloudSyncPlan {
  readonly idToken: string;
  readonly capture: DeviceIdentity;
  readonly library: readonly IdeaMetadata[];
  readonly readAudio: (idea: IdeaMetadata) => Promise<Uint8Array>;
}

async function fetchCloudManifest(idToken: string): Promise<string[]> {
  const response = await fetch(`${MOTIF_API_URL}/relay/manifest`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error(`Cloud manifest fetch failed (${response.status})`);
  }
  const manifest = (await response.json()) as { have?: string[] };
  return manifest.have ?? [];
}

/** Uploads one Idea and publishes it only after the cloud has all audio bytes. */
async function uploadCloudIdea(
  idToken: string,
  capture: DeviceIdentity,
  idea: IdeaMetadata,
  audio: Uint8Array,
): Promise<boolean> {
  const headers = { Authorization: `Bearer ${idToken}` };
  const offer: IdeaSyncOffer = {
    kind: "idea-sync-offer",
    from: capture,
    idea,
    audioByteLength: audio.length,
  };
  // API Gateway request bodies are capped at 10MB, while Pro WAV Ideas can be
  // much larger. Transfer audio directly through an account-scoped S3 URL.
  const initiation = await fetch(`${MOTIF_API_URL}/relay/ideas`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(offer),
  });
  if (!initiation.ok) {
    throw new Error(`Cloud Idea offer failed (${initiation.status})`);
  }
  const { uploadUrl } = (await initiation.json()) as { uploadUrl: string };
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(audio),
  });
  if (!upload.ok) throw new Error(`Cloud audio upload failed (${upload.status})`);

  const completion = await fetch(
    `${MOTIF_API_URL}/relay/ideas/${encodeURIComponent(idea.id)}/complete`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(offer),
    },
  );
  if (!completion.ok) {
    throw new Error(`Cloud Idea completion failed (${completion.status})`);
  }
  const ack = (await completion.json()) as IdeaSyncAck;
  return ack.accepted;
}

/**
 * Ensures one Idea is safely present in cloud storage before an explicit
 * offload may remove its on-device audio. Already-uploaded Ideas are untouched.
 */
export async function ensureIdeaInCloud(
  plan: Omit<CloudSyncPlan, "library" | "readAudio"> & {
    readonly idea: IdeaMetadata;
    readonly audio: Uint8Array;
  },
): Promise<void> {
  const have = await fetchCloudManifest(plan.idToken);
  if (have.includes(plan.idea.id)) return;
  if (!(await uploadCloudIdea(plan.idToken, plan.capture, plan.idea, plan.audio))) {
    throw new Error("Cloud did not accept the Idea.");
  }
}

/** Downloads an offloaded Idea's audio bytes through its short-lived URL. */
export async function downloadCloudIdea(
  idToken: string,
  ideaId: string,
): Promise<Uint8Array> {
  const descriptor = await fetch(
    `${MOTIF_API_URL}/relay/ideas/${encodeURIComponent(ideaId)}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!descriptor.ok) {
    throw new Error(`Cloud Idea download failed (${descriptor.status})`);
  }
  const { downloadUrl } = (await descriptor.json()) as { downloadUrl?: string };
  if (!downloadUrl) throw new Error("Cloud Idea download URL is missing.");
  const audio = await fetch(downloadUrl);
  if (!audio.ok) throw new Error(`Cloud audio download failed (${audio.status})`);
  return new Uint8Array(await audio.arrayBuffer());
}

/**
 * Copies pending Ideas into the authenticated relay. The backend independently
 * enforces Basic/Pro, so a Free token cannot open this transport even if a
 * caller is buggy. Capture keeps every local audio file after upload.
 */
export async function syncPendingCloudIdeas(plan: CloudSyncPlan): Promise<string[]> {
  const pending = ideasToOffer(plan.library, await fetchCloudManifest(plan.idToken));
  const synced: string[] = [];
  for (const idea of pending) {
    const accepted = await uploadCloudIdea(
      plan.idToken,
      plan.capture,
      idea,
      await plan.readAudio(idea),
    );
    if (accepted) synced.push(idea.id);
  }
  return synced;
}
