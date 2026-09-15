// ─────────────────────────────────────────────────────────────────────────────
//  modifiers.rs — choosing a DRM format modifier for the capture ring
//
//  The importer has always been able to take a tiled buffer: `dmabuf_import.rs`
//  builds `VkImageDrmFormatModifierExplicitCreateInfoEXT` with per-plane
//  layouts and creates the image with `DRM_FORMAT_MODIFIER_EXT` tiling. Only
//  the producer was linear — hard-coded `ImageTiling::LINEAR` and a `modifier`
//  of zero passed down with every frame — so every capture detiled a full frame
//  on the write and the encoder sampled a linear image on the read.
//
//  Picking the modifier is the whole of the decision and it is pure, so it is
//  here and tested rather than buried in an unsafe block.
// ─────────────────────────────────────────────────────────────────────────────

/// One entry of `VkDrmFormatModifierPropertiesListEXT`, already filtered to
/// modifiers whose tiling features cover both our write and the encoder's read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModifierProps {
    pub modifier: u64,
    pub plane_count: u32,
}

/// `DRM_FORMAT_MOD_LINEAR`.
pub const LINEAR: u64 = 0;

/// `DRM_FORMAT_MOD_INVALID`, which a driver may list and which means "let the
/// driver choose" — not something to ask for explicitly.
pub const INVALID: u64 = 0x00ff_ffff_ffff_ffff;

/// Pick the modifier to allocate the capture ring with.
///
/// Single-plane only, and deliberately so. A multi-plane modifier needs an
/// offset and a stride per plane on the import side, and the export path hands
/// out one fd with one stride — so accepting one would produce an image the far
/// side reads at the wrong offsets, which arrives at the right size and frame
/// rate carrying nonsense. Prefer any real tiled modifier; fall back to linear,
/// which is what the ring used before this existed and always works.
pub fn pick_modifier(candidates: &[ModifierProps]) -> Option<ModifierProps> {
    let usable = |m: &&ModifierProps| m.plane_count == 1 && m.modifier != INVALID;
    candidates
        .iter()
        .filter(usable)
        .find(|m| m.modifier != LINEAR)
        .or_else(|| candidates.iter().filter(usable).find(|m| m.modifier == LINEAR))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TILED: u64 = 0x0200_0000_0000_0001;

    #[test]
    fn a_tiled_modifier_beats_linear() {
        let c = [
            ModifierProps { modifier: LINEAR, plane_count: 1 },
            ModifierProps { modifier: TILED, plane_count: 1 },
        ];
        assert_eq!(pick_modifier(&c).unwrap().modifier, TILED);
    }

    /// Order must not decide it — the driver lists them in its own order.
    #[test]
    fn a_tiled_modifier_wins_from_either_position() {
        let c = [
            ModifierProps { modifier: TILED, plane_count: 1 },
            ModifierProps { modifier: LINEAR, plane_count: 1 },
        ];
        assert_eq!(pick_modifier(&c).unwrap().modifier, TILED);
    }

    /// A multi-plane modifier with one exported fd would be imported at the
    /// wrong plane offsets and produce a corrupt frame rather than an error.
    #[test]
    fn multi_plane_modifiers_are_refused() {
        let c = [
            ModifierProps { modifier: 0x0200_0000_0000_0002, plane_count: 2 },
            ModifierProps { modifier: LINEAR, plane_count: 1 },
        ];
        assert_eq!(pick_modifier(&c).unwrap().modifier, LINEAR);
    }

    /// A multi-plane tiled modifier must not beat a single-plane linear one
    /// just for being tiled.
    #[test]
    fn tiling_does_not_excuse_a_plane_count_we_cannot_export() {
        let c = [
            ModifierProps { modifier: TILED, plane_count: 4 },
            ModifierProps { modifier: LINEAR, plane_count: 1 },
        ];
        assert_eq!(pick_modifier(&c).unwrap().modifier, LINEAR);
    }

    /// `DRM_FORMAT_MOD_INVALID` is not a modifier to ask for.
    #[test]
    fn the_invalid_modifier_is_never_chosen() {
        let c = [ModifierProps { modifier: INVALID, plane_count: 1 }];
        assert_eq!(pick_modifier(&c), None);
    }

    #[test]
    fn nothing_usable_is_none() {
        let c = [ModifierProps { modifier: TILED, plane_count: 4 }];
        assert_eq!(pick_modifier(&c), None);
    }

    #[test]
    fn an_empty_list_is_none() {
        assert_eq!(pick_modifier(&[]), None);
    }
}
