use libp2p::futures::StreamExt;
use libp2p::multiaddr::Protocol;
use libp2p::{
    Multiaddr, PeerId, Swarm, identity,
    swarm::{NetworkBehaviour, SwarmEvent},
};
use libp2p_autonat as autonat;
use libp2p_identify as identify;
use libp2p_noise as noise;
use libp2p_ping as ping;
use libp2p_stream as stream;
use libp2p_tcp as tcp;
use libp2p_yamux as yamux;
use std::error::Error;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct NestriConnection {
    pub peer_id: PeerId,
    pub control: stream::Control,
}

#[derive(NetworkBehaviour)]
struct NestriBehaviour {
    identify: identify::Behaviour,
    ping: ping::Behaviour,
    stream: stream::Behaviour,
    autonatv2: autonat::v2::client::Behaviour,
}
impl NestriBehaviour {
    fn new(key: identity::PublicKey) -> Self {
        Self {
            identify: identify::Behaviour::new(identify::Config::new(
                "/ipfs/id/1.0.0".to_string(),
                key,
            )),
            ping: ping::Behaviour::default(),
            stream: stream::Behaviour::default(),
            autonatv2: autonat::v2::client::Behaviour::default(),
        }
    }
}

pub struct NestriP2P {
    swarm: Arc<Mutex<Swarm<NestriBehaviour>>>,
}
impl NestriP2P {
    pub async fn new() -> Result<Self, Box<dyn Error>> {
        let swarm = Arc::new(Mutex::new(
            libp2p::SwarmBuilder::with_new_identity()
                .with_tokio()
                .with_tcp(
                    tcp::Config::default(),
                    noise::Config::new,
                    yamux::Config::default,
                )?
                .with_dns()?
                .with_websocket(noise::Config::new, yamux::Config::default)
                .await?
                .with_behaviour(|key| NestriBehaviour::new(key.public()))?
                .build(),
        ));

        // Spawn the swarm event loop
        let swarm_clone = swarm.clone();
        tokio::spawn(swarm_loop(swarm_clone));

        Ok(NestriP2P { swarm })
    }

    pub async fn connect(&self, conn_url: &str) -> Result<NestriConnection, Box<dyn Error>> {
        let conn_addr: Multiaddr = conn_url.parse()?;

        let mut swarm_lock = self.swarm.lock().await;
        swarm_lock.dial(conn_addr.clone())?;

        let Some(Protocol::P2p(peer_id)) = conn_addr.clone().iter().last() else {
            return Err("Invalid connection URL: missing peer ID".into());
        };

        Ok(NestriConnection {
            peer_id,
            control: swarm_lock.behaviour().stream.new_control(),
        })
    }
}

async fn swarm_loop(swarm: Arc<Mutex<Swarm<NestriBehaviour>>>) {
    loop {
        let event = {
            let mut swarm_lock = swarm.lock().await;
            swarm_lock.select_next_some().await
        };
        match event {
            /* Ping Events */
            SwarmEvent::Behaviour(NestriBehaviourEvent::Ping(ping::Event {
                peer,
                connection,
                result,
            })) => {
                if let Ok(latency) = result {
                    tracing::debug!(
                        "Ping event - peer: {}, connection: {:?}, latency: {} us",
                        peer,
                        connection,
                        latency.as_micros()
                    );
                } else if let Err(err) = result {
                    tracing::warn!(
                        "Ping event - peer: {}, connection: {:?}, error: {:?}",
                        peer,
                        connection,
                        err
                    );
                }
            }
            /* Autonat (v2) Events */
            SwarmEvent::Behaviour(NestriBehaviourEvent::Autonatv2(
                autonat::v2::client::Event {
                    server,
                    tested_addr,
                    bytes_sent,
                    result,
                },
            )) => {
                if let Ok(()) = result {
                    tracing::debug!(
                        "AutonatV2 event - test server '{}' verified address '{}' with {} bytes sent",
                        server,
                        tested_addr,
                        bytes_sent
                    );
                } else if let Err(err) = result {
                    tracing::warn!(
                        "AutonatV2 event - test server '{}' failed to verify address '{}' with {} bytes sent: {:?}",
                        server,
                        tested_addr,
                        bytes_sent,
                        err
                    );
                }
            }
            /* Swarm Events */
            SwarmEvent::NewListenAddr { address, .. } => {
                tracing::info!("Listening on: '{}'", address);
            }
            SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                tracing::info!("Connection established with peer: {}", peer_id);
            }
            SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
                if let Some(err) = cause {
                    tracing::error!(
                        "Connection with peer {} closed due to error: {}",
                        peer_id,
                        err
                    );
                } else {
                    tracing::info!("Connection with peer {} closed", peer_id);
                }
            }
            SwarmEvent::IncomingConnection {
                local_addr,
                send_back_addr,
                ..
            } => {
                tracing::info!(
                    "Incoming connection from: {} (send back to: {})",
                    local_addr,
                    send_back_addr
                );
            }
            SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
                if let Some(peer_id) = peer_id {
                    tracing::error!("Failed to connect to peer {}: {}", peer_id, error);
                } else {
                    tracing::error!("Failed to connect: {}", error);
                }
            }
            SwarmEvent::ExternalAddrConfirmed { address } => {
                tracing::info!("Confirmed external address: {}", address);
            }
            /* Unhandled Events */
            SwarmEvent::Behaviour(event) => {
                tracing::warn!("Unhandled Behaviour event: {:?}", event);
            }
            _ => {}
        }
    }
}
