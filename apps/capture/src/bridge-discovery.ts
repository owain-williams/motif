import * as ServiceDiscovery from "@inthepocket/react-native-service-discovery";
import { SYNC_PROTOCOL_VERSION } from "@motif/shared";
import type {
  DiscoveredBridge,
  StopBridgeDiscovery,
} from "./bridge-discovery-types";

export type { DiscoveredBridge, StopBridgeDiscovery } from "./bridge-discovery-types";

/** DNS-SD service advertised by Motif Bridge. */
const BRIDGE_SERVICE_TYPE = "motif-bridge";

/**
 * Browses for Bridge instances on the local network until the returned cleanup
 * function is called. This is a native shell adapter; pairing still happens
 * through the existing HTTP handshake after the user confirms Bridge's code.
 */
export async function startBridgeDiscovery(
  onFound: (bridge: DiscoveredBridge) => void,
): Promise<StopBridgeDiscovery> {
  const subscription = ServiceDiscovery.addEventListener("serviceFound", (service) => {
    if (service.txt.protocolVersion !== String(SYNC_PROTOCOL_VERSION)) return;

    // Prefer IPv4 because the current sync client's URL builder accepts an IPv4
    // address or hostname directly. The resolved Bonjour hostname is a safe
    // fallback on IPv6-only networks.
    const host =
      service.addresses.find(
        (address) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) && address !== "0.0.0.0",
      ) ?? service.hostName;

    if (host && service.port > 0) {
      onFound({ name: service.name, host, port: service.port });
    }
  });

  try {
    await ServiceDiscovery.startSearch(BRIDGE_SERVICE_TYPE);
  } catch (error) {
    subscription.remove();
    throw error;
  }

  return () => {
    subscription.remove();
    void ServiceDiscovery.stopSearch(BRIDGE_SERVICE_TYPE).catch(() => {
      // Discovery cleanup is best-effort when the native app is backgrounding.
    });
  };
}
