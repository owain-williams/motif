//! Zero-configuration discovery for Bridge's local sync receiver.
//!
//! The runtime shell starts an advertisement after binding [`crate::server`]
//! and retains the returned handle for as long as Bridge is running.

use mdns_sd::{ServiceDaemon, ServiceInfo};

use crate::{sync_protocol_version, DeviceIdentity};

const BRIDGE_SERVICE_TYPE: &str = "_motif-bridge._tcp.local.";

/// A live DNS-SD advertisement. Dropping it stops the backing mDNS daemon.
pub struct BridgeAdvertisement {
    _daemon: ServiceDaemon,
}

impl BridgeAdvertisement {
    /// Advertises a Bridge identity and its sync receiver's actual bound port.
    /// Address auto-detection publishes every usable network interface rather
    /// than guessing one primary LAN interface.
    pub fn start(identity: &DeviceIdentity, port: u16) -> Result<Self, mdns_sd::Error> {
        let daemon = ServiceDaemon::new()?;
        let host_name = format!("{}.local.", identity.device_id);
        let id_suffix: String = identity
            .device_id
            .chars()
            .rev()
            .take(6)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let instance_name = format!("{} {id_suffix}", identity.display_name);
        let protocol_version = sync_protocol_version().to_string();
        let properties = [
            ("deviceId", identity.device_id.as_str()),
            ("protocolVersion", protocol_version.as_str()),
        ];
        let service = ServiceInfo::new(
            BRIDGE_SERVICE_TYPE,
            &instance_name,
            &host_name,
            "",
            port,
            &properties[..],
        )?
        .enable_addr_auto();
        daemon.register(service)?;
        Ok(Self { _daemon: daemon })
    }
}
