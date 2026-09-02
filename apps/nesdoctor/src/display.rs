//! What the client's display and decoder can actually accept.
//!
//! This is the readable half of the capability probe our build order specifies
//! — *GPU, decoder, display* — and its stated purpose is **attribution**. Told
//! only that a stream "looks bad", the cheapest available explanation is that
//! our reconstruction ratio was too aggressive; so without this we would lower
//! the ratio and pay density for somebody else's window manager.
//!
//! It also answers the colour question directly. Whether to send BT.709 or
//! BT.2020, limited or full range, 8-bit or 10-bit, 4:2:0 or 4:4:4 is decided
//! by what is on the other end — and until now we had no way to know, so every
//! choice was made against the one panel in this room.
//!
//! # What is readable here, and what is not
//!
//! | | |
//! |---|---|
//! | session type, compositor, desktop | environment, exactly what a client sees |
//! | native resolution, refresh, bit depth | EDID |
//! | HDR transfer functions, BT.2020, 4:2:0 | EDID CTA-861 extension blocks |
//! | hardware decode profiles | `vulkaninfo` / `vainfo` |
//! | **present mode, tearing, fractional scale** | **needs a real surface — not here** |
//!
//! The last row is the honest gap: those require a window and a swapchain, so
//! they belong in the client and are reported as unknown rather than guessed.
//!
//! EDID is untrusted binary from a device node. Every read here is
//! bounds-checked and every field is optional; a monitor that reports nonsense
//! costs one field.

use std::fs;

use serde::Serialize;

use crate::sys::{self};

#[derive(Debug, Serialize, Default)]
pub struct DisplayReport {
    /// `wayland`, `x11`, `windows`, `macos`, or none if headless.
    pub session: Option<String>,
    pub compositor: Option<String>,
    pub desktop: Option<String>,
    /// True when the session is X11 while a Wayland socket also exists —
    /// meaning the client is running under XWayland, which is its own
    /// presentation path and was the exact challenge raised against our A/B
    /// rounds.
    pub xwayland: bool,
    pub outputs: Vec<Output>,
    pub decode: Decode,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct Output {
    pub name: Option<String>,
    /// Native (preferred) mode from the first detailed timing descriptor.
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub refresh_hz: Option<f64>,
    /// Bits per colour channel, as the panel declares it. 8 or 10 is the
    /// question that decides whether sending 10-bit is worth anything.
    pub bit_depth: Option<u8>,
    /// Transfer functions the panel accepts: `sdr`, `hdr-traditional`, `pq`,
    /// `hlg`. Empty means SDR only, or an EDID too old to say.
    pub eotf: Vec<&'static str>,
    /// BT.2020 colorimetry, in the forms CTA-861 distinguishes.
    pub bt2020: Vec<&'static str>,
    /// The panel accepts 4:2:0 chroma, which is what we encode.
    pub ycbcr420: bool,
    pub ycbcr444: bool,
}

#[derive(Debug, Serialize, Default)]
pub struct Decode {
    /// Vulkan Video decode, which is what the client would prefer.
    pub vulkan: Vec<&'static str>,
    /// VA-API profiles, the fallback that is far more widely present.
    pub vaapi: Vec<&'static str>,
}

pub fn probe() -> DisplayReport {
    let mut r = DisplayReport {
        session: session_type(),
        compositor: std::env::var("XDG_SESSION_DESKTOP").ok(),
        desktop: std::env::var("XDG_CURRENT_DESKTOP").ok(),
        xwayland: std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("x11"),
        outputs: outputs(),
        decode: decode(),
    };
    // A compositor name is more useful than the generic desktop string, and on
    // a bare window manager neither is set — so fall back to what is running.
    if r.compositor.is_none() {
        r.compositor = wm_hint();
    }
    r
}

fn session_type() -> Option<String> {
    if cfg!(windows) {
        return Some("windows".into());
    }
    if cfg!(target_os = "macos") {
        return Some("macos".into());
    }
    if let Ok(t) = std::env::var("XDG_SESSION_TYPE")
        && !t.is_empty()
    {
        return Some(t);
    }
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return Some("wayland".into());
    }
    if std::env::var_os("DISPLAY").is_some() {
        return Some("x11".into());
    }
    None
}

/// Name a bare window manager, which sets none of the XDG variables.
///
/// Worth the ugliness: the challenge to our own measurements was specifically
/// *"a 1080p panel under bspwm and Xorg"*, and a report that cannot name bspwm
/// cannot answer it.
fn wm_hint() -> Option<String> {
    const WMS: [&str; 14] = [
        "bspwm",
        "i3",
        "sway",
        "hyprland",
        "river",
        "dwm",
        "awesome",
        "xmonad",
        "openbox",
        "qtile",
        "herbstluftwm",
        "spectrwm",
        "leftwm",
        "niri",
    ];
    let out = sys::sh("ps", &["-eo", "comm="])?;
    let running: Vec<&str> = out.lines().map(str::trim).collect();
    WMS.iter()
        .find(|w| running.iter().any(|p| p == *w))
        .map(|w| (*w).to_string())
}

// -------------------------------------------------------------------- EDID ---

fn outputs() -> Vec<Output> {
    #[cfg(target_os = "linux")]
    {
        let mut out = Vec::new();
        let Ok(entries) = fs::read_dir("/sys/class/drm") else {
            return out;
        };
        let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        for p in paths {
            // Connectors are `cardN-<CONNECTOR>`; a connected one has an EDID.
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if !name.contains('-') {
                continue;
            }
            let status = fs::read_to_string(p.join("status")).unwrap_or_default();
            if status.trim() != "connected" {
                continue;
            }
            let Ok(edid) = fs::read(p.join("edid")) else {
                continue;
            };
            if let Some(mut o) = parse_edid(&edid) {
                // The connector name (`card0-DP-1`) is more useful than nothing
                // when the panel declares no product name.
                o.name = o
                    .name
                    .or_else(|| name.split_once('-').map(|(_, c)| c.to_string()));
                out.push(o);
            }
        }
        out
    }
    #[cfg(windows)]
    {
        // WMI exposes raw EDID, which is the same bytes and the same parser.
        let raw = sys::ps(
            "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorRawEEdidV1Block \
             -ErrorAction SilentlyContinue | ForEach-Object { ($_.BlockContent -join ',') }",
        )
        .unwrap_or_default();
        raw.lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| {
                let bytes: Vec<u8> = l
                    .split(',')
                    .filter_map(|n| n.trim().parse::<u8>().ok())
                    .collect();
                parse_edid(&bytes)
            })
            .collect()
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    Vec::new()
}

/// Parse the parts of an EDID that decide how we should encode.
///
/// Deliberately partial. Everything is bounds-checked and optional because this
/// is untrusted binary from a device node: monitors ship broken EDIDs, docks
/// and KVM switches synthesise worse ones, and one bad panel must cost a field
/// rather than the run.
fn parse_edid(b: &[u8]) -> Option<Output> {
    // Header, which is how we know this is an EDID at all.
    if b.len() < 128 || b[0..8] != [0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00] {
        return None;
    }
    let mut o = Output::default();

    // Byte 0x14: video input definition. Bit 7 set means digital, and then
    // bits 4-6 carry the bit depth -- the field that decides whether sending
    // 10-bit buys anything at all.
    if b[0x14] & 0x80 != 0 {
        o.bit_depth = match (b[0x14] >> 4) & 0x07 {
            1 => Some(6),
            2 => Some(8),
            3 => Some(10),
            4 => Some(12),
            5 => Some(14),
            6 => Some(16),
            _ => None, // 0 is "undefined", 7 is reserved
        };
    }

    // The four 18-byte descriptors at 0x36. The first is the preferred timing;
    // a descriptor whose first two bytes are zero is a text block instead.
    for i in 0..4 {
        let d = &b[0x36 + i * 18..0x36 + i * 18 + 18];
        if d[0] == 0 && d[1] == 0 {
            // 0xFC is the monitor's product name.
            if d[3] == 0xFC {
                let s: String = d[5..18]
                    .iter()
                    .take_while(|&&c| c != 0x0A)
                    .map(|&c| c as char)
                    .collect();
                let s = s.trim().to_string();
                if !s.is_empty() {
                    o.name = Some(s);
                }
            }
            continue;
        }
        if o.width.is_some() {
            continue; // first detailed timing only
        }
        let clock_khz = (d[0] as u32 | ((d[1] as u32) << 8)) * 10;
        let h_active = d[2] as u32 | (((d[4] as u32) & 0xF0) << 4);
        let h_blank = d[3] as u32 | (((d[4] as u32) & 0x0F) << 8);
        let v_active = d[5] as u32 | (((d[7] as u32) & 0xF0) << 4);
        let v_blank = d[6] as u32 | (((d[7] as u32) & 0x0F) << 8);
        let total = (h_active + h_blank) as u64 * (v_active + v_blank) as u64;
        if h_active > 0 && v_active > 0 {
            o.width = Some(h_active);
            o.height = Some(v_active);
            if total > 0 && clock_khz > 0 {
                o.refresh_hz = Some((clock_khz as f64 * 1000.0) / total as f64);
            }
        }
    }

    // CTA-861 extension blocks carry the colour capabilities: HDR transfer
    // functions, BT.2020, and 4:2:0 chroma. Base EDID says nothing about any
    // of them.
    let ext_count = b[0x7E] as usize;
    for n in 0..ext_count {
        let start = 128 * (n + 1);
        if b.len() < start + 128 {
            break;
        }
        parse_cta(&b[start..start + 128], &mut o);
    }
    Some(o)
}

fn parse_cta(e: &[u8], o: &mut Output) {
    if e[0] != 0x02 {
        return; // not a CTA-861 block
    }
    // Byte 3 flags: bit 5 = YCbCr 4:2:2, bit 4 = YCbCr 4:4:4.
    o.ycbcr444 |= e[3] & 0x20 != 0;

    // The data block collection runs from byte 4 to the DTD offset in byte 2.
    let end = (e[2] as usize).clamp(4, 128);
    let mut i = 4usize;
    while i < end {
        let tag = e[i] >> 5;
        let len = (e[i] & 0x1F) as usize;
        if len == 0 || i + len >= 128 {
            break;
        }
        let body = &e[i + 1..i + 1 + len];
        if tag == 7 && !body.is_empty() {
            match body[0] {
                // Colorimetry data block.
                5 if body.len() >= 2 => {
                    let f = body[1];
                    for (bit, name) in [(5, "bt2020-cycc"), (6, "bt2020-ycc"), (7, "bt2020-rgb")] {
                        if f & (1 << bit) != 0 {
                            o.bt2020.push(name);
                        }
                    }
                }
                // HDR static metadata: which transfer functions the panel takes.
                6 if body.len() >= 2 => {
                    let f = body[1];
                    for (bit, name) in [(0, "sdr"), (1, "hdr-traditional"), (2, "pq"), (3, "hlg")] {
                        if f & (1 << bit) != 0 {
                            o.eotf.push(name);
                        }
                    }
                }
                // Either 4:2:0 block means the panel accepts 4:2:0 chroma,
                // which is what we encode.
                14 | 15 => o.ycbcr420 = true,
                _ => {}
            }
        }
        i += 1 + len;
    }
}

// ------------------------------------------------------------------ decode ---

fn decode() -> Decode {
    let mut d = Decode::default();

    // Vulkan Video decode. Same caveat as the encode check on the host side:
    // an advertised extension is necessary and not sufficient.
    if let Some(vk) = sys::sh("vulkaninfo", &[]) {
        for (needle, name) in [
            ("VK_KHR_video_decode_h264", "h264"),
            ("VK_KHR_video_decode_h265", "h265"),
            ("VK_KHR_video_decode_av1", "av1"),
        ] {
            if vk.contains(needle) {
                d.vulkan.push(name);
            }
        }
    }

    // VA-API, which is far more widely present than Vulkan Video and is what a
    // client would actually fall back to.
    if let Some(va) = sys::sh("vainfo", &[]) {
        for (needle, name) in [
            ("VAProfileH264", "h264"),
            ("VAProfileHEVC", "h265"),
            ("VAProfileAV1", "av1"),
            ("VAProfileVP9", "vp9"),
        ] {
            if va.contains(needle) && va.contains("VLD") {
                d.vaapi.push(name);
            }
        }
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic EDID 1.4: digital input, 10 bits per channel, one detailed
    /// timing for 2560x1440 at ~60 Hz, and a CTA block declaring PQ, HLG,
    /// BT.2020 RGB and 4:2:0.
    fn synthetic() -> Vec<u8> {
        let mut b = vec![0u8; 256];
        b[0..8].copy_from_slice(&[0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00]);
        b[0x14] = 0x80 | (3 << 4); // digital, 10 bpc
        b[0x7E] = 1; // one extension

        // 2560x1440: pixel clock 241.5 MHz, htotal 2720, vtotal 1481.
        let d = 0x36;
        let clock = 24_150u32; // in 10 kHz units
        b[d] = (clock & 0xFF) as u8;
        b[d + 1] = (clock >> 8) as u8;
        b[d + 2] = (2560 & 0xFF) as u8;
        b[d + 3] = (160 & 0xFF) as u8; // hblank 160 -> htotal 2720
        // High nibbles of h_active and h_blank. Written out rather than
        // `| (160 >> 8)`, which is zero here and which clippy is right to
        // object to -- the shape of the field is the documentation.
        b[d + 4] = ((2560u32 >> 8) << 4) as u8;
        b[d + 5] = (1440 & 0xFF) as u8;
        b[d + 6] = 41; // vblank 41 -> vtotal 1481
        b[d + 7] = ((1440u32 >> 8) << 4) as u8;

        // CTA-861 extension.
        let e = 128;
        b[e] = 0x02;
        b[e + 1] = 3;
        b[e + 3] = 0x20; // YCbCr 4:4:4
        let mut i = e + 4;
        // Colorimetry: BT.2020 RGB (bit 7). Relative to the tag byte the
        // layout is [ext tag, colorimetry flags, metadata profiles] -- getting
        // that off by one is what made this test fail the first time, which is
        // a good argument for the test existing.
        b[i] = (7 << 5) | 3;
        b[i + 1] = 5;
        b[i + 2] = 1 << 7;
        b[i + 3] = 0;
        i += 4;
        // HDR static metadata: SDR + PQ + HLG.
        b[i] = (7 << 5) | 3;
        b[i + 1] = 6;
        b[i + 2] = 0b0000_1101;
        i += 4;
        // 4:2:0 capability map.
        b[i] = (7 << 5) | 2;
        b[i + 1] = 15;
        b[i + 2] = 0;
        i += 3;
        b[e + 2] = (i - e) as u8; // DTD offset ends the data block collection
        b
    }

    #[test]
    fn reads_depth_geometry_and_colour() {
        let o = parse_edid(&synthetic()).expect("should parse");
        assert_eq!(o.bit_depth, Some(10));
        assert_eq!((o.width, o.height), (Some(2560), Some(1440)));
        let hz = o.refresh_hz.expect("refresh");
        assert!((hz - 59.95).abs() < 0.5, "refresh was {hz}");
        assert!(o.eotf.contains(&"pq"), "eotf: {:?}", o.eotf);
        assert!(o.eotf.contains(&"hlg"));
        assert!(o.bt2020.contains(&"bt2020-rgb"), "bt2020: {:?}", o.bt2020);
        assert!(o.ycbcr420);
        assert!(o.ycbcr444);
    }

    /// Garbage must cost a field, never the run.
    #[test]
    fn rejects_non_edid() {
        assert!(parse_edid(&[]).is_none());
        assert!(parse_edid(&[0u8; 128]).is_none());
        assert!(parse_edid(&vec![0xABu8; 300]).is_none());
    }

    #[test]
    fn truncated_extension_is_survivable() {
        let mut b = synthetic();
        b.truncate(200); // claims an extension it does not have in full
        let o = parse_edid(&b).expect("base block still parses");
        assert_eq!(o.bit_depth, Some(10));
        assert!(o.eotf.is_empty(), "no colour data should be invented");
    }
}
