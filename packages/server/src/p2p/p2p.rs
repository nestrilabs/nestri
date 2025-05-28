use futures_util::StreamExt;
use libp2p::multiaddr::Protocol;
use libp2p::{
    Multiaddr, PeerId, Swarm, identify, noise, ping,
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux,
};
use std::error::Error;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct NestriConnection {
    pub peer_id: PeerId,
    pub control: libp2p_stream::Control,
}

#[derive(NetworkBehaviour)]
struct NestriBehaviour {
    identify: identify::Behaviour,
    ping: ping::Behaviour,
    stream: libp2p_stream::Behaviour,
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
                .with_behaviour(|key| {
                    let identify_behaviour = identify::Behaviour::new(identify::Config::new(
                        "/ipfs/id/1.0.0".to_string(),
                        key.public(),
                    ));
                    let ping_behaviour = ping::Behaviour::default();
                    let stream_behaviour = libp2p_stream::Behaviour::default();

                    Ok(NestriBehaviour {
                        identify: identify_behaviour,
                        ping: ping_behaviour,
                        stream: stream_behaviour,
                    })
                })?
                .build(),
        ));

        // Spawn the swarm event loop
        let swarm_clone = swarm.clone();
        tokio::spawn(swarm_loop(swarm_clone));

        {
            let mut swarm_lock = swarm.lock().await;
            swarm_lock.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?; // IPv4 - TCP Raw
            swarm_lock.listen_on("/ip6/::/tcp/0".parse()?)?; // IPv6 - TCP Raw
        }

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
            _ => {}
        }
    }
}
