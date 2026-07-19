import { describe, expect, it } from "vitest";
import type { DeviceIdentity, IdeaMetadata, IdeaSyncOffer } from "@motif/shared";
import { frameOffer } from "./sync-wire";

/**
 * The wire framing that must decode byte-for-byte with `bridge-core`'s server
 * parser (motif-6fu.6): `[4-byte big-endian JSON length][offer JSON][audio
 * bytes]`. The `fetch` orchestration around it is the untested device shell.
 */

const CAPTURE: DeviceIdentity = {
  deviceId: "cap-1",
  displayName: "Pixel",
  role: "capture",
};

function offer(idea: IdeaMetadata, audioByteLength: number): IdeaSyncOffer {
  return { kind: "idea-sync-offer", from: CAPTURE, idea, audioByteLength };
}

const IDEA: IdeaMetadata = {
  id: "song",
  name: "Idea",
  capturedAt: 1_700_000_000_000,
  durationMs: 4200,
  audioFormat: "aac",
  channels: 1,
  storageState: "on-device",
};

describe("frameOffer", () => {
  it("prefixes the JSON length as a 4-byte big-endian integer", () => {
    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const framed = frameOffer(offer(IDEA, audio.length), audio);

    const jsonLength = new DataView(
      framed.buffer,
      framed.byteOffset,
      framed.byteLength,
    ).getUint32(0, false);

    const json = new TextDecoder().decode(framed.slice(4, 4 + jsonLength));
    const decoded = JSON.parse(json) as IdeaSyncOffer;
    expect(decoded.kind).toBe("idea-sync-offer");
    expect(decoded.idea.id).toBe("song");
  });

  it("appends the audio bytes verbatim after the JSON", () => {
    const audio = new Uint8Array([9, 8, 7, 6]);
    const framed = frameOffer(offer(IDEA, audio.length), audio);

    const jsonLength = new DataView(
      framed.buffer,
      framed.byteOffset,
      framed.byteLength,
    ).getUint32(0, false);

    const tail = framed.slice(4 + jsonLength);
    expect(Array.from(tail)).toEqual(Array.from(audio));
  });

  it("produces a body sized exactly 4 + JSON + audio", () => {
    const audio = new Uint8Array([0, 0, 0]);
    const built = offer(IDEA, audio.length);
    const framed = frameOffer(built, audio);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(built)).length;
    expect(framed.byteLength).toBe(4 + jsonBytes + audio.length);
  });
});
