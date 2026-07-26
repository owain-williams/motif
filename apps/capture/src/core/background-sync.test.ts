import { describe, expect, it, vi } from "vitest";
import type { IdeaMetadata } from "@motif/shared";
import { createMetadataCommit, runBackgroundSyncJob } from "./background-sync";

describe("background sync job", () => {
  it("succeeds without waking a transport when Capture has nothing configured", async () => {
    await expect(runBackgroundSyncJob([])).resolves.toBe("success");
  });

  it("runs every configured transport so one failure cannot block another", async () => {
    const local = vi.fn().mockRejectedValue(new Error("Bridge offline"));
    const cloud = vi.fn().mockResolvedValue(undefined);

    await expect(runBackgroundSyncJob([local, cloud])).resolves.toBe("failed");
    expect(local).toHaveBeenCalledOnce();
    expect(cloud).toHaveBeenCalledOnce();
  });

  it("succeeds after every configured transport completes", async () => {
    const local = vi.fn().mockResolvedValue(undefined);
    const cloud = vi.fn().mockResolvedValue(undefined);

    await expect(runBackgroundSyncJob([local, cloud])).resolves.toBe("success");
  });
});

describe("metadata commit — persisting a headless pass", () => {
  function idea(overrides: Partial<IdeaMetadata> = {}): IdeaMetadata {
    return {
      id: "a",
      name: "Idea a",
      capturedAt: 1,
      durationMs: 3000,
      audioFormat: "aac",
      channels: 1,
      storageState: "on-device",
      tags: [],
      instrument: [],
      style: [],
      tempo: null,
      location: null,
      fieldUpdatedAt: {
        name: 1,
        tags: 0,
        instrument: 0,
        style: 0,
        tempo: 0,
        location: 0,
      },
      ...overrides,
    };
  }

  /** A stand-in for Capture's on-disk Library manifest. */
  function storage(initial: readonly IdeaMetadata[]) {
    let stored: readonly IdeaMetadata[] = initial;
    return {
      load: vi.fn(async () => [...stored]),
      save: vi.fn((library: readonly IdeaMetadata[]) => {
        stored = library;
      }),
      get current() {
        return stored;
      },
    };
  }

  /** An Idea whose tags were last edited at `at`. */
  const tagged = (tags: string[], at: number) =>
    idea({ tags, fieldUpdatedAt: { ...idea().fieldUpdatedAt, tags: at } });

  it("persists a peer's edit the pass brought back", async () => {
    const disk = storage([tagged([], 0)]);
    await createMetadataCommit(disk)([tagged(["from-bridge"], 200)]);
    expect(disk.current[0].tags).toEqual(["from-bridge"]);
  });

  it("re-reads the Library, so an edit made during the pass is not clobbered", async () => {
    const disk = storage([tagged([], 0)]);
    const commit = createMetadataCommit(disk);
    // The pass merged against the Library as it was; the user has since typed.
    disk.save([tagged(["typed-since"], 500)]);
    await commit([tagged(["from-bridge"], 200)]);
    expect(disk.current[0].tags).toEqual(["typed-since"]);
  });

  it("serializes commits, so concurrent transports cannot lose each other's edits", async () => {
    const base = idea({ fieldUpdatedAt: { ...idea().fieldUpdatedAt } });
    const disk = storage([base]);
    const commit = createMetadataCommit(disk);
    const fromBridge = idea({
      tags: ["from-bridge"],
      fieldUpdatedAt: { ...base.fieldUpdatedAt, tags: 200 },
    });
    const fromCloud = idea({
      style: ["from-cloud"],
      fieldUpdatedAt: { ...base.fieldUpdatedAt, style: 300 },
    });

    await Promise.all([commit([fromBridge]), commit([fromCloud])]);

    expect(disk.current[0].tags).toEqual(["from-bridge"]);
    expect(disk.current[0].style).toEqual(["from-cloud"]);
  });

  it("does not rewrite the manifest when the pass brought nothing new", async () => {
    const disk = storage([tagged(["settled"], 100)]);
    await createMetadataCommit(disk)([tagged(["settled"], 100)]);
    expect(disk.save).not.toHaveBeenCalled();
  });

  it("reports a failed read so the OS retries, and still accepts later commits", async () => {
    const disk = storage([tagged([], 0)]);
    const commit = createMetadataCommit(disk);
    disk.load.mockRejectedValueOnce(new Error("manifest unreadable"));

    await expect(commit([tagged(["lost"], 200)])).rejects.toThrow(
      "manifest unreadable",
    );
    expect(disk.save).not.toHaveBeenCalled();

    await commit([tagged(["later"], 300)]);
    expect(disk.current[0].tags).toEqual(["later"]);
  });
});
