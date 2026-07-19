import type { IdeaSyncOffer } from "@motif/shared";

/**
 * The on-the-wire framing for a Free-tier sync upload (motif-6fu.6). Pure and
 * device-free so it can be pinned down against Bridge's Rust parser without a
 * network: an offer's metadata and its binary audio ride in one request body as
 * `[4-byte big-endian JSON length][offer JSON][audio bytes]`. The `fetch` that
 * carries this body lives in the `src/idea-sync` shell.
 */
export function frameOffer(
  offer: IdeaSyncOffer,
  audio: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(offer));
  const framed = new Uint8Array(4 + json.length + audio.length);
  new DataView(framed.buffer).setUint32(0, json.length, false); // big-endian
  framed.set(json, 4);
  framed.set(audio, 4 + json.length);
  return framed;
}
