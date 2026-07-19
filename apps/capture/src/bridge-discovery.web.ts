import type {
  DiscoveredBridge,
  StopBridgeDiscovery,
} from "./bridge-discovery-types";

export type { DiscoveredBridge, StopBridgeDiscovery } from "./bridge-discovery-types";

/** Bonjour discovery requires the native Capture development build. */
export async function startBridgeDiscovery(
  _onFound: (bridge: DiscoveredBridge) => void,
): Promise<StopBridgeDiscovery> {
  throw new Error("Bridge discovery is unavailable on the web");
}
