/**
 * Device-free outcome policy for a headless sync pass. Each function is one
 * independently available transport (LAN or cloud). Running all transports
 * prevents an offline Bridge from blocking cloud relay, and a failed result
 * asks the OS scheduler to try the incomplete work again later.
 */
export type BackgroundSyncTransport = () => Promise<void>;
export type BackgroundSyncOutcome = "success" | "failed";

export async function runBackgroundSyncJob(
  transports: readonly BackgroundSyncTransport[],
): Promise<BackgroundSyncOutcome> {
  const results = await Promise.allSettled(transports.map((sync) => sync()));
  return results.every((result) => result.status === "fulfilled")
    ? "success"
    : "failed";
}
