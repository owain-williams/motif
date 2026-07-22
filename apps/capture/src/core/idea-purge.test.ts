import { describe, expect, it } from "vitest";
import { markIdeaDeleted, markIdeaRestored, RECENTLY_DELETED_RETENTION_MS } from "@motif/shared";
import type { IdeaDeletion, IdeaMetadata } from "@motif/shared";
import { purgeExpiredIdeas } from "./idea-purge";
import type { PurgeIo } from "./idea-purge";

/**
 * The purge sweep (motif-kka.8): once an Idea's 30-day Recently Deleted window
 * elapses it goes for good — audio, waveform, cloud copy, Library entry. Its
 * delete record stays, since that is what still has to reach a device offline
 * since before the window (ADR 0005). There is no server to run this, so it
 * happens on the device; the file and cloud calls are injected so the decisions
 * around them are testable without a device or a network.
 */

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;
const AFTER_WINDOW = T0 + RECENTLY_DELETED_RETENTION_MS;

function idea(id: string, overrides: Partial<IdeaMetadata> = {}): IdeaMetadata {
  return {
    id,
    name: `Idea ${id}`,
    capturedAt: T0,
    durationMs: 4200,
    audioFormat: "aac",
    channels: 1,
    storageState: "on-device",
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    location: null,
    fieldUpdatedAt: { name: T0, tags: 0, instrument: 0, style: 0, tempo: 0, location: 0 },
    ...overrides,
  };
}

/** Records what the sweep asked the device and the cloud to delete. */
function recordingIo(overrides: Partial<PurgeIo> = {}) {
  const localDeletes: string[] = [];
  const cloudDeletes: string[] = [];
  const io: PurgeIo = {
    deleteLocalCopy: (target) => {
      localDeletes.push(target.id);
    },
    deleteCloudCopy: async (target) => {
      cloudDeletes.push(target.id);
    },
    ...overrides,
  };
  return { io, localDeletes, cloudDeletes };
}

async function sweep(
  library: readonly IdeaMetadata[],
  deletions: readonly IdeaDeletion[],
  now: number,
  io: PurgeIo,
) {
  return purgeExpiredIdeas({ library, deletions, now, io });
}

describe("purgeExpiredIdeas", () => {
  it("holds an Idea for its whole window", async () => {
    const { io, localDeletes, cloudDeletes } = recordingIo();
    const deletions = markIdeaDeleted([], "a", T0);

    const result = await sweep([idea("a")], deletions, AFTER_WINDOW - 1, io);

    expect(localDeletes).toEqual([]);
    expect(cloudDeletes).toEqual([]);
    expect(result.purged).toEqual([]);
    expect(result.library.map((i) => i.id)).toEqual(["a"]);
  });

  it("purges an Idea once its window elapses", async () => {
    const { io, localDeletes, cloudDeletes } = recordingIo();
    const deletions = markIdeaDeleted([], "a", T0);

    const result = await sweep([idea("a"), idea("b")], deletions, AFTER_WINDOW, io);

    expect(localDeletes).toEqual(["a"]);
    expect(cloudDeletes).toEqual(["a"]);
    expect(result.purged).toEqual(["a"]);
    expect(result.library.map((i) => i.id)).toEqual(["b"]);
  });

  it("never purges a restored Idea, however old the deletion", async () => {
    const { io, localDeletes } = recordingIo();
    const deletions = markIdeaRestored(markIdeaDeleted([], "a", T0), "a", T0 + DAY);

    const result = await sweep([idea("a")], deletions, T0 + 365 * DAY, io);

    expect(localDeletes).toEqual([]);
    expect(result.library.map((i) => i.id)).toEqual(["a"]);
  });

  it("has nothing to delete for an Idea an earlier launch already purged", async () => {
    const { io, localDeletes, cloudDeletes } = recordingIo();

    const result = await sweep([], markIdeaDeleted([], "gone", T0), AFTER_WINDOW, io);

    expect(localDeletes).toEqual([]);
    expect(cloudDeletes).toEqual([]);
    expect(result.purged).toEqual([]);
  });

  it("does nothing on the next launch once a device has purged", async () => {
    const { io } = recordingIo();
    const first = await sweep([idea("a")], markIdeaDeleted([], "a", T0), AFTER_WINDOW, io);

    const { io: secondIo, localDeletes, cloudDeletes } = recordingIo();
    const deletions = markIdeaDeleted([], "a", T0);
    const second = await sweep(first.library, deletions, AFTER_WINDOW, secondIo);

    expect(localDeletes).toEqual([]);
    expect(cloudDeletes).toEqual([]);
    expect(second.purged).toEqual([]);
  });

  it("skips the cloud call for an account with no cloud storage", async () => {
    const { io, localDeletes } = recordingIo({ deleteCloudCopy: null });

    const result = await sweep([idea("a")], markIdeaDeleted([], "a", T0), AFTER_WINDOW, io);

    expect(localDeletes).toEqual(["a"]);
    expect(result.purged).toEqual(["a"]);
  });

  it("keeps an Idea whose cloud copy could not be deleted, to retry next launch", async () => {
    // Forgetting it locally would strand the cloud copy in the account's quota
    // with nothing left to name it.
    const { io, localDeletes } = recordingIo({
      deleteCloudCopy: async () => {
        throw new Error("offline");
      },
    });
    const deletions = markIdeaDeleted([], "a", T0);

    const result = await sweep([idea("a")], deletions, AFTER_WINDOW, io);

    expect(localDeletes).toEqual([]);
    expect(result.purged).toEqual([]);
    expect(result.library.map((i) => i.id)).toEqual(["a"]);
  });

  it("purges the Ideas it can when another one's cloud copy fails", async () => {
    const { io, localDeletes } = recordingIo({
      deleteCloudCopy: async (target) => {
        if (target.id === "stuck") throw new Error("offline");
      },
    });
    const deletions = markIdeaDeleted(markIdeaDeleted([], "stuck", T0), "fine", T0);

    const result = await sweep(
      [idea("stuck"), idea("fine")],
      deletions,
      AFTER_WINDOW,
      io,
    );

    expect(localDeletes).toEqual(["fine"]);
    expect(result.purged).toEqual(["fine"]);
    expect(result.library.map((i) => i.id)).toEqual(["stuck"]);
  });

  it("purges an offloaded Idea, whose audio only exists in the cloud", async () => {
    const { io, localDeletes, cloudDeletes } = recordingIo();

    const result = await sweep(
      [idea("a", { storageState: "offloaded" })],
      markIdeaDeleted([], "a", T0),
      AFTER_WINDOW,
      io,
    );

    // The local delete still runs: the waveform sidecar outlives an offload.
    expect(localDeletes).toEqual(["a"]);
    expect(cloudDeletes).toEqual(["a"]);
    expect(result.library).toEqual([]);
  });

  it("leaves the caller's Library and records untouched", async () => {
    const { io } = recordingIo();
    const library = [idea("a")];
    const deletions = markIdeaDeleted([], "a", T0);

    await sweep(library, deletions, AFTER_WINDOW, io);

    expect(library.map((i) => i.id)).toEqual(["a"]);
    expect(deletions).toHaveLength(1);
  });
});
