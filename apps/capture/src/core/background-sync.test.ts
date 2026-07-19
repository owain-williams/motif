import { describe, expect, it, vi } from "vitest";
import { runBackgroundSyncJob } from "./background-sync";

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
