export interface DiscoveredBridge {
  readonly name: string;
  readonly host: string;
  readonly port: number;
}

export type StopBridgeDiscovery = () => void;
