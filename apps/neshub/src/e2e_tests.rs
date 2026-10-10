//! PyroWave through the hub for real: IPC messages into the video listener,
//! out of the datagram writer, over an iroh connection, into a collector.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use bytes::Bytes;
use iroh::endpoint::{Connection, presets};
use tokio::net::UnixDatagram;

use nesprotocol::pyrowave::{
    CollectedFrame, FLAG_DUPLICATE, FrameMeta, PyroCollector, PyroDatagramHeader, PyroFrame,
    chunk_frame, decode_pyro_datagram,
};
use nesprotocol::{ALPN_VIDEO, Carrier};

use crate::control::{Controller, Limits};
use crate::session::SessionManager;

/// A frame of synthetic packets, each filled with bytes particular to it, so
/// a packet delivered into the wrong place or the wrong frame shows. Packet 0
/// stands in for the sequence header; one in every fifty is an oversized
/// block that has to travel in pieces.
pub(crate) fn synthetic_frame(id: u32, bytes: usize, packet: usize) -> PyroFrame {
    let mut data = Vec::with_capacity(bytes);
    let mut packets = Vec::new();
    let mut i = 0usize;
    while data.len() < bytes {
        let len = match i {
            0 => 8,
            _ if i.is_multiple_of(50) => nesprotocol::pyrowave::LARGEST_BLOCK_BYTES,
            _ => packet - (i * 13) % 200,
        };
        let start = data.len();
        let seed = (id as usize).wrapping_mul(7919) ^ i;
        data.extend((0..len).map(|k| (seed.wrapping_mul(31).wrapping_add(k) % 251) as u8));
        packets.push(start..data.len());
        i += 1;
    }
    PyroFrame {
        frame: id,
        meta: FrameMeta {
            ts_ms: id * 16,
            width: 1920,
            height: 1080,
        },
        critical: 3,
        data,
        packets,
    }
}

struct Rig {
    socket_path: PathBuf,
    sender: UnixDatagram,
    client: Connection,
    mgr: Arc<SessionManager>,
    _hub: iroh::Endpoint,
    _client_ep: iroh::Endpoint,
}

impl Drop for Rig {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// `client_buffer` sizes the client's datagram receive buffer; `None` is the
/// client's real one.
async fn rig_with(client_buffer: Option<usize>) -> Rig {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let socket_path = std::env::temp_dir().join(format!(
        "neshub-e2e-{}-{}.sock",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mgr = Arc::new(SessionManager::new(300_000));
    tokio::spawn({
        let mgr = mgr.clone();
        let path = socket_path.clone();
        let controller = Arc::new(tokio::sync::Mutex::new(crate::control::Controller::new(
            crate::control::Limits::new(8000),
        )));
        // Commands go nowhere here: no client in these tests states codecs.
        let (cmd_tx, _cmd_rx) = tokio::sync::mpsc::unbounded_channel();
        async move {
            let _cmd_rx = _cmd_rx;
            crate::ipc_listener::run_video_listener(path, mgr, controller, cmd_tx).await
        }
    });

    let hub = iroh::Endpoint::builder(presets::N0)
        .alpns(vec![ALPN_VIDEO.to_vec()])
        .relay_mode(iroh::endpoint::RelayMode::Disabled)
        .transport_config(crate::dgram::media_transport_config())
        .bind()
        .await
        .expect("hub endpoint");
    let client_transport = match client_buffer {
        Some(bytes) => iroh::endpoint::QuicTransportConfig::builder()
            .datagram_send_buffer_size(nesprotocol::datagram::DGRAM_BUFFER_BYTES)
            .datagram_receive_buffer_size(Some(bytes))
            .build(),
        None => crate::dgram::media_transport_config(),
    };
    let client_ep = iroh::Endpoint::builder(presets::N0)
        .relay_mode(iroh::endpoint::RelayMode::Disabled)
        .transport_config(client_transport)
        .bind()
        .await
        .expect("client endpoint");

    let accept = tokio::spawn({
        let hub = hub.clone();
        let mgr = mgr.clone();
        async move {
            let conn = hub.accept().await.expect("incoming").await.expect("conn");
            let (input, _) = tokio::sync::broadcast::channel(4);
            let (cmd, _cmd_rx) = tokio::sync::mpsc::unbounded_channel();
            let controller = Arc::new(tokio::sync::Mutex::new(Controller::new(Limits::new(4_000))));
            mgr.attach(
                conn.remote_id(),
                Carrier::Video,
                conn,
                input,
                cmd,
                controller,
            )
            .await;
        }
    });
    let client = client_ep
        .connect(hub.addr(), ALPN_VIDEO)
        .await
        .expect("dial the hub");
    accept.await.expect("accept");

    // The listener binds on its own task; wait for the socket to exist.
    let sender = UnixDatagram::unbound().expect("unbound socket");
    for _ in 0..200 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    sender
        .connect(&socket_path)
        .expect("connect to the listener");

    Rig {
        socket_path,
        sender,
        client,
        mgr,
        _hub: hub,
        _client_ep: client_ep,
    }
}

async fn rig() -> Rig {
    rig_with(None).await
}

async fn send_frame(sender: &UnixDatagram, f: &PyroFrame) {
    for m in chunk_frame(f.frame, f.meta, &f.data, &f.packets, f.critical).expect("chunks") {
        sender.send(&m).await.expect("ipc send");
    }
}

/// Read datagrams until `want` frames have come out of the collector or the
/// line goes quiet. `drop_datagram` decides, by arrival order and header,
/// which ones the "network" loses.
async fn collect(
    conn: &Connection,
    want: usize,
    mut drop_datagram: impl FnMut(usize, &PyroDatagramHeader) -> bool,
) -> Vec<CollectedFrame<Bytes>> {
    let start = Instant::now();
    let now = || start.elapsed().as_micros() as u64;
    let mut collector = PyroCollector::new();
    let mut frames = Vec::new();
    let mut arrivals = 0usize;
    while frames.len() < want {
        let datagram =
            match tokio::time::timeout(Duration::from_millis(500), conn.read_datagram()).await {
                Ok(Ok(d)) => d,
                Ok(Err(e)) => panic!("connection failed: {e}"),
                Err(_) => break,
            };
        arrivals += 1;
        let (h, payload) = decode_pyro_datagram(&datagram).expect("a PyroWave datagram");
        if drop_datagram(arrivals, &h) {
            continue;
        }
        let at = datagram.len() - payload.len();
        frames.extend(collector.push(h, datagram.slice(at..), now()));
    }
    // Whatever is still in flight leaves at its deadline.
    frames.extend(collector.poll(u64::MAX));
    frames
}

fn packets(f: &CollectedFrame<Bytes>) -> Vec<Vec<u8>> {
    f.packets.iter().map(|p| p.as_ref().to_vec()).collect()
}

fn originals(f: &PyroFrame) -> Vec<Vec<u8>> {
    (0..f.packets.len()).map(|i| f.packet(i).to_vec()).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn frames_cross_the_hub_byte_for_byte() {
    let rig = rig().await;
    let sent: Vec<_> = (0..20).map(|i| synthetic_frame(i, 120_000, 1188)).collect();
    let reader = tokio::spawn({
        let conn = rig.client.clone();
        async move { collect(&conn, 20, |_, _| false).await }
    });
    for f in &sent {
        send_frame(&rig.sender, f).await;
        // About 60 Mbit/s: this is about the bytes, not about how fast they
        // go, and an unoptimised build's QUIC cannot carry much more. The
        // bench is where rates are measured.
        tokio::time::sleep(Duration::from_millis(16)).await;
    }
    let got = reader.await.expect("reader");

    assert_eq!(
        rig.mgr.take_pyro_skipped().await,
        0,
        "a quiet path skipped frames"
    );
    assert_eq!(got.len(), sent.len());
    for (i, (g, s)) in got.iter().zip(&sent).enumerate() {
        assert!(g.is_whole(), "frame {i}: {}/{}", g.received, g.total);
        assert_eq!(g.seq, i as u16);
        assert_eq!(g.ts_ms, s.meta.ts_ms);
        assert_eq!(packets(g), originals(s), "frame {i} changed in transit");
    }
}

/// With datagrams lost, what arrives is still exactly what was sent, minus
/// the lost packets — never a packet stitched from two, never one from
/// another frame — and the critical copies stand in for lost originals.
#[tokio::test(flavor = "multi_thread")]
async fn a_lossy_path_loses_packets_and_nothing_else() {
    let rig = rig().await;
    let sent: Vec<_> = (0..20).map(|i| synthetic_frame(i, 120_000, 1188)).collect();
    let reader = tokio::spawn({
        let conn = rig.client.clone();
        // One in 37: about 4% loss, landing on every position in turn, the
        // critical datagrams at the head of a frame included. Copies are
        // spared, so that a lost critical original is always covered and the
        // assertion below can be exact.
        async move {
            collect(&conn, 20, |n, h| {
                h.flags & FLAG_DUPLICATE == 0 && n.is_multiple_of(37)
            })
            .await
        }
    });
    for f in &sent {
        send_frame(&rig.sender, f).await;
        tokio::time::sleep(Duration::from_millis(16)).await;
    }
    let got = reader.await.expect("reader");
    assert_eq!(got.len(), sent.len());

    let mut partial = 0;
    for (g, s) in got.iter().zip(&sent) {
        let all = originals(s);
        let got = packets(g);
        // Every critical packet arrives: the copies cover a single loss.
        assert_eq!(&got[..s.critical], &all[..s.critical], "frame {}", s.frame);
        // And what arrived is an ordered subset of what was sent.
        let mut rest = all.iter();
        for p in &got {
            assert!(
                rest.any(|o| o == p),
                "frame {}: a packet arrived that was never sent",
                s.frame
            );
        }
        partial += usize::from(!g.is_whole());
    }
    assert!(partial > 0, "the loss never reached the collector");
}

/// Handed frames faster than the path drains them, the hub skips whole
/// frames rather than letting QUIC evict pieces of two.
///
/// The client's receive buffer is made larger than the whole burst, so a
/// torn frame here can only be the sender's doing: a client too slow to read
/// tears frames too, by its own buffer's eviction, and that is not what this
/// is about.
#[tokio::test(flavor = "multi_thread")]
async fn a_burst_is_skipped_whole_not_torn() {
    let rig = rig_with(Some(64 << 20)).await;
    let n = 30u32;
    let reader = tokio::spawn({
        let conn = rig.client.clone();
        async move { collect(&conn, n as usize, |_, _| false).await }
    });
    for i in 0..n {
        send_frame(&rig.sender, &synthetic_frame(i, 1_500_000, 1188)).await;
    }
    let got = reader.await.expect("reader");
    let skipped = rig.mgr.take_pyro_skipped().await as usize;

    let torn = got.iter().filter(|f| !f.is_whole()).count();
    assert_eq!(torn, 0, "{torn} frames arrived damaged ({skipped} skipped)");
    assert_eq!(
        got.len() + skipped,
        n as usize,
        "frames went missing unaccounted"
    );
}
