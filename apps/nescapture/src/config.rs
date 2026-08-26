// ─────────────────────────────────────────────────────────────────────────────
//  config.rs — Phase 3: per-game shader hash configuration
//
//  Loads a TOML config file that maps game executables to sets of shader hashes:
//    hud_fragment_shaders  — fragment shaders used for HUD/UI elements
//    hud_vertex_shaders    — vertex shaders used for HUD/UI elements
//    skip_fragment_shaders — fragment shaders to silently drop (motion blur, etc.)
//
//  Environment variables:
//    HUDLESS_CONFIG=/path/to/config.toml  — explicit config path
//    HUDLESS_GAME_NAME=Game.exe           — override game name detection
//
//  Config format:
//    [game."Control_DX11.exe"]
//    hud_fragment_shaders  = ["0xaabbccddeeff0011"]
//    hud_vertex_shaders    = ["0x1a2b3c4d5e6f7890"]
//    skip_fragment_shaders = ["0x1122334455667788"]
// ─────────────────────────────────────────────────────────────────────────────

use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

/// Parsed shader hash sets for a single game.
#[derive(Clone, Debug, Default)]
pub struct ShaderHashSet {
    pub hud_fragment_shaders: HashSet<u64>,
    pub hud_vertex_shaders: HashSet<u64>,
    pub skip_fragment_shaders: HashSet<u64>,
}

impl ShaderHashSet {
    /// Check if the given vert/frag hash pair matches a HUD shader.
    ///
    /// A HUD match occurs when:
    ///   - frag_hash is in hud_fragment_shaders, OR
    ///   - vert_hash is in hud_vertex_shaders (if frag not set)
    pub fn is_hud_shader(&self, vert_hash: Option<u64>, frag_hash: Option<u64>) -> bool {
        match frag_hash {
            Some(fh) => self.hud_fragment_shaders.contains(&fh),
            None => vert_hash.is_some_and(|vh| self.hud_vertex_shaders.contains(&vh)),
        }
    }

    /// Check if the given frag_hash matches a skip shader.
    pub fn is_skip_shader(&self, frag_hash: Option<u64>) -> bool {
        if let Some(fh) = frag_hash {
            return self.skip_fragment_shaders.contains(&fh);
        }
        false
    }
}

/// TOML deserialization structure.
#[derive(Deserialize)]
struct ConfigFile {
    game: Option<std::collections::HashMap<String, GameConfig>>,
}

#[derive(Deserialize)]
struct GameConfig {
    hud_fragment_shaders: Option<Vec<String>>,
    hud_vertex_shaders: Option<Vec<String>>,
    skip_fragment_shaders: Option<Vec<String>>,
}

/// Parse a hex string like "0xaabbccddeeff0011" into a u64.
fn parse_hex(s: &str) -> Option<u64> {
    let trimmed = s.trim().trim_start_matches("0x").trim_start_matches("0X");
    u64::from_str_radix(trimmed, 16).ok()
}

/// Load the config from the given path and return the ShaderHashSet for the
/// current game.
pub fn load_config(path: &Path) -> Option<ShaderHashSet> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("failed to read config {:?}: {}", path, e);
            return None;
        }
    };

    let config: ConfigFile = match toml::from_str(&content) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("failed to parse config {:?}: {}", path, e);
            return None;
        }
    };

    let game_name = std::env::var("NESCAPTURE_GAME_NAME").ok()?;
    let games = config.game.as_ref()?;
    let game_config = games.get(&game_name)?;

    let mut set = ShaderHashSet::default();

    if let Some(hashes) = &game_config.hud_fragment_shaders {
        for h in hashes {
            if let Some(v) = parse_hex(h) {
                set.hud_fragment_shaders.insert(v);
            }
        }
    }

    if let Some(hashes) = &game_config.hud_vertex_shaders {
        for h in hashes {
            if let Some(v) = parse_hex(h) {
                set.hud_vertex_shaders.insert(v);
            }
        }
    }

    if let Some(hashes) = &game_config.skip_fragment_shaders {
        for h in hashes {
            if let Some(v) = parse_hex(h) {
                set.skip_fragment_shaders.insert(v);
            }
        }
    }

    log::info!(
        "loaded config for '{}' — {} hud_frag, {} hud_vert, {} skip_frag",
        game_name,
        set.hud_fragment_shaders.len(),
        set.hud_vertex_shaders.len(),
        set.skip_fragment_shaders.len(),
    );

    Some(set)
}

/// Resolve the config file path from HUDLESS_CONFIG env var, or fall back to
/// a default location relative to the game executable.
pub fn resolve_config_path() -> Option<std::path::PathBuf> {
    if let Ok(path) = std::env::var("NESCAPTURE_CONFIG") {
        return Some(std::path::PathBuf::from(path));
    }
    None
}
