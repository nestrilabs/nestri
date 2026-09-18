# nescapture Capture-Path Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the CPU, memory-bandwidth and scheduler-latency cost the capture path imposes on a CPU-starved game, without changing what the stream carries.

**Architecture:** Four independent changes to the capture path, each landing on its own. Two attack memory traffic (the capture ring is allocated in host-coherent memory with linear tiling, so every frame crosses the bus twice in the worst layout available); one removes per-frame command recording from the game's own present thread; one removes a thread hop and a channel from the per-frame chain. Nothing here touches pixelforge, which is deliberately deferred.

**Tech Stack:** Rust, `ash` (Vulkan bindings, rev `f4c2ca3e`), Vulkan implicit layer, `VK_EXT_image_drm_format_modifier`, `VK_EXT_external_memory_dma_buf`.

**Spec:** This document. It comes out of a read of the capture path on branch `feat/fps-paced-by-the-layer` after Cyberpunk 2077 on 4 vCPU held ~45 fps against a 60 fps target, and the measurements described under "Gate" below.

## Global Constraints

- **The present hook must never block.** It runs on the game's own thread. Every change here either removes work from it or leaves it unchanged; nothing may add a wait to it.
- **A frame that cannot be captured is dropped, never waited for.** The slot ring is the backpressure; `SlotPool::try_acquire` returns `None` and the frame is skipped.
- **Every new path needs a fallback.** Hosts are customer-supplied and heterogeneous. A driver that refuses a tiled export, a device-local exportable memory type, or a modifier must fall back to what works today, with one log line saying so.
- **No dropped encoded frames.** An encoded frame that is thrown away breaks the H.264 reference chain and corrupts until the next IDR. Backpressure belongs before the encoder, never after it.
- **Capture correctness is gated by the dump, not by eye.** The measurable gate for every task is the per-second rate line added in `cbb163b`.
- `CAPTURE_SLOTS = 4` (`apps/nescapture/src/state.rs:18`) stays 4 unless a task says otherwise.

## Gate

Every task is checked the same way. Run the game, read the line the stats thread logs once a second:

```
present 60/s, admitted 60/s, encoded 60/s, starved 0, dropped 0, capture 3.2ms, encode 6.1ms
```

- `present` is the game's own rate. If this is the number that is short, the task did not help the game.
- `starved` is presents the gate admitted and the ring had no slot for. Falling `starved` is the ring keeping up.
- `capture` is present → encoder-accepted, in ms. It is the latency the thread hops contribute to.

Record the line before and after each task. A task that moves none of these numbers should be reverted, not kept for tidiness.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `apps/nescapture/src/capture.rs` | Ring allocation, memory type choice, blit recording | 1, 2, 4 |
| `apps/nescapture/src/memory.rs` | **New.** Pure memory-type selection, unit tested | 1 |
| `apps/nescapture/src/modifiers.rs` | **New.** Pure DRM modifier selection, unit tested | 4 |
| `apps/nescapture/src/state.rs` | `CaptureRing` / `CaptureSlot` shape | 2, 4 |
| `apps/nescapture/src/present.rs` | Present hook, capture worker (removed in Task 3) | 2, 3 |
| `apps/nescapture/src/encode.rs` | Encoder thread, which absorbs the worker in Task 3 | 3 |
| `apps/nescapture/src/swapchain.rs` | Invalidating pre-recorded blits on recreate | 2 |
| `apps/nescapture/src/device.rs` | Injected device extensions | 4 |
| `apps/nescapture/src/dispatch.rs` | `NextDeviceFn` entries for new entry points | 4 |

---

## Task 1: The capture ring stops living in host-coherent memory

The exportable capture image is allocated through `find_host_coherent_mt`, which takes the first memory type carrying `HOST_VISIBLE | HOST_COHERENT` and never looks at `DEVICE_LOCAL`. On a discrete GPU — the Arc A310 this was measured on is discrete — that puts the capture target in system RAM. The blit writes a full frame across PCIe and pixelforge reads it back across PCIe, every frame.

Host-visible memory is only needed by `read_frame_pixels`, the CPU-readback fallback, which runs only for slots whose DMA-BUF export failed (`dmabuf_fd < 0`). The exported path never maps the memory.

**Files:**
- Create: `apps/nescapture/src/memory.rs`
- Modify: `apps/nescapture/src/capture.rs:54-67` (`find_host_coherent_mt`), `apps/nescapture/src/capture.rs:161-200` (`alloc_image`)
- Modify: `apps/nescapture/src/lib.rs` (add `mod memory;`)

**Interfaces:**
- Produces: `pub fn pick_memory_type(types: &[MemoryType], bits: u32, want: Want) -> Option<u32>`, `pub enum Want { DeviceLocal, HostCoherent }`, `pub struct MemoryType { pub flags: vk::MemoryPropertyFlags }`

- [ ] **Step 1: Write the failing test**

Create `apps/nescapture/src/memory.rs`:

```rust
// ─────────────────────────────────────────────────────────────────────────────
//  memory.rs — choosing a memory type for a capture slot
//
//  Split out and made pure so the choice can be tested. It was a one-line
//  "first type with HOST_VISIBLE | HOST_COHERENT" inside capture.rs, which put
//  every exported capture buffer in system RAM on a discrete GPU — a full frame
//  across the bus on the write and again on the encoder's read.
// ─────────────────────────────────────────────────────────────────────────────

use ash::vk;

/// One entry of `VkPhysicalDeviceMemoryProperties::memoryTypes`.
#[derive(Clone, Copy, Debug)]
pub struct MemoryType {
    pub flags: vk::MemoryPropertyFlags,
}

/// What the caller intends to do with the allocation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Want {
    /// The GPU writes it and another device imports it. Nothing maps it.
    DeviceLocal,
    /// The CPU reads it back. `read_frame_pixels` needs this.
    HostCoherent,
}

/// Pick a memory type index from `types`, restricted to those set in `bits`.
///
/// `DeviceLocal` prefers device-local and falls back to anything allowed,
/// because a device with no device-local type the image can use must still get
/// an allocation. `HostCoherent` is a hard requirement: memory that is not
/// mappable cannot serve the readback path at all, so there is no fallback.
pub fn pick_memory_type(types: &[MemoryType], bits: u32, want: Want) -> Option<u32> {
    let allowed = |i: usize| bits & (1 << i) != 0;

    match want {
        Want::DeviceLocal => (0..types.len())
            .find(|&i| allowed(i) && types[i].flags.contains(vk::MemoryPropertyFlags::DEVICE_LOCAL))
            .or_else(|| (0..types.len()).find(|&i| allowed(i)))
            .map(|i| i as u32),
        Want::HostCoherent => (0..types.len())
            .find(|&i| {
                allowed(i)
                    && types[i].flags.contains(
                        vk::MemoryPropertyFlags::HOST_VISIBLE
                            | vk::MemoryPropertyFlags::HOST_COHERENT,
                    )
            })
            .map(|i| i as u32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ash::vk::MemoryPropertyFlags as F;

    fn t(flags: F) -> MemoryType {
        MemoryType { flags }
    }

    /// The layout of a discrete GPU: system RAM first, VRAM second. The old
    /// code took index 0 and put every capture frame across the bus.
    #[test]
    fn device_local_is_preferred_over_an_earlier_host_type() {
        let types = [
            t(F::HOST_VISIBLE | F::HOST_COHERENT),
            t(F::DEVICE_LOCAL),
        ];
        assert_eq!(pick_memory_type(&types, 0b11, Want::DeviceLocal), Some(1));
    }

    /// A type the image's `memoryTypeBits` excludes may not be chosen, however
    /// well it matches.
    #[test]
    fn a_type_the_image_forbids_is_never_chosen() {
        let types = [
            t(F::HOST_VISIBLE | F::HOST_COHERENT),
            t(F::DEVICE_LOCAL),
        ];
        assert_eq!(pick_memory_type(&types, 0b01, Want::DeviceLocal), Some(0));
    }

    /// No device-local type the image can use is not a failure: the allocation
    /// still has to happen, just without the preference.
    #[test]
    fn device_local_falls_back_to_whatever_is_allowed() {
        let types = [t(F::HOST_VISIBLE | F::HOST_COHERENT)];
        assert_eq!(pick_memory_type(&types, 0b1, Want::DeviceLocal), Some(0));
    }

    /// Readback has no fallback. Handing it unmappable memory would fault on
    /// the first `vkMapMemory`, which is worse than not allocating.
    #[test]
    fn host_coherent_has_no_fallback() {
        let types = [t(F::DEVICE_LOCAL)];
        assert_eq!(pick_memory_type(&types, 0b1, Want::HostCoherent), None);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p nescapture memory::`
Expected: FAIL — `memory.rs` is not yet a module, so compilation fails with `file not found for module` or the tests do not run.

- [ ] **Step 3: Register the module**

Add to `apps/nescapture/src/lib.rs`, next to the other `mod` lines:

```rust
mod memory;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p nescapture memory::`
Expected: PASS, 4 tests.

- [ ] **Step 5: Use it from `alloc_image`**

In `apps/nescapture/src/capture.rs`, replace `find_host_coherent_mt` with a wrapper that reads the device's memory properties and delegates. Note the `Want` follows whether the allocation is exported:

```rust
unsafe fn find_memory_type(
    ds: &crate::state::DeviceState,
    bits: u32,
    want: crate::memory::Want,
) -> u32 {
    let mut mp = vk::PhysicalDeviceMemoryProperties::default();
    let k = unsafe { crate::dispatch_key(ds.physical_device.as_raw() as *const std::ffi::c_void) };
    if let Some(i) = crate::state::INSTANCE_STATE.get(&k) {
        unsafe { (i.get_physical_device_memory_properties)(ds.physical_device, &mut mp) };
    }
    let types: Vec<crate::memory::MemoryType> = mp.memory_types[..mp.memory_type_count as usize]
        .iter()
        .map(|t| crate::memory::MemoryType { flags: t.property_flags })
        .collect();
    crate::memory::pick_memory_type(&types, bits, want).unwrap_or(0)
}
```

Then in `alloc_image`, choose by intent rather than always host-coherent:

```rust
    // An exported image is written by this device's GPU and read by
    // pixelforge's. Nothing maps it, so host-visible memory buys nothing and
    // on a discrete GPU costs a full frame across the bus each way.
    let want = match export {
        Some(_) => crate::memory::Want::DeviceLocal,
        None => crate::memory::Want::HostCoherent,
    };
    let mt = unsafe { find_memory_type(ds, mr.memory_type_bits, want) };
```

- [ ] **Step 6: Build and run the whole suite**

Run: `cargo build --release -p nescapture && cargo test --release -p nescapture`
Expected: build clean, all tests pass (19 existing + 4 new = 23).

- [ ] **Step 7: Verify against a game**

Run the game. Confirm the log does **not** contain `no DMA-BUF export, falling back to CPU readback`. If it does, the device-local type the driver picked is not exportable — revert to `Want::HostCoherent` for the export path and record that on this driver the ring must stay in host memory.

Record the rate line before and after.

- [ ] **Step 8: Commit**

```bash
git add apps/nescapture/src/memory.rs apps/nescapture/src/capture.rs apps/nescapture/src/lib.rs
git commit -m "perf(nescapture): the capture ring lives on the GPU, not across the bus"
```

---

## Task 2: The blit is recorded once, not every frame

`capture_present_frame` resets, begins, records three barriers and a copy, and ends a command buffer on the game's own thread, every captured frame. The recorded content depends only on which swapchain image is the source and which slot is the destination — both fixed sets. There are `swapchain_images × CAPTURE_SLOTS` distinct command buffers, typically 12 to 16, and each can be recorded once and re-submitted.

**Files:**
- Modify: `apps/nescapture/src/state.rs:40-65` (`CaptureRing`)
- Modify: `apps/nescapture/src/capture.rs:329-410` (`create_capture_ring`), `apps/nescapture/src/capture.rs:627-800` (`capture_present_frame`)
- Modify: `apps/nescapture/src/swapchain.rs` (invalidate on recreate)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `CaptureRing::blit_for(&mut self, image_index: usize, slot: usize) -> Option<vk::CommandBuffer>` — returns a command buffer already recorded for that pair, recording it on first use.

- [ ] **Step 1: Write the failing test**

The recording itself needs a device, so the test covers the indexing, which is where an off-by-one would silently blit the wrong slot. Add to `apps/nescapture/src/state.rs`:

```rust
/// Index of the command buffer that blits swapchain image `image_index` into
/// ring slot `slot`.
///
/// Flat rather than nested so the ring owns one `Vec` and one allocation from
/// the command pool. `None` when either index is out of range, which is a
/// swapchain that grew under us rather than a caller mistake.
pub fn blit_index(image_index: usize, slot: usize, image_count: usize) -> Option<usize> {
    if image_index >= image_count || slot >= CAPTURE_SLOTS {
        return None;
    }
    Some(image_index * CAPTURE_SLOTS + slot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_image_and_slot_pair_has_its_own_index() {
        let mut seen = std::collections::HashSet::new();
        for image in 0..3 {
            for slot in 0..CAPTURE_SLOTS {
                let i = blit_index(image, slot, 3).expect("in range");
                assert!(seen.insert(i), "image {image} slot {slot} collided at {i}");
            }
        }
        assert_eq!(seen.len(), 3 * CAPTURE_SLOTS);
    }

    #[test]
    fn an_out_of_range_image_has_no_index() {
        // A swapchain recreated with more images than the ring was built for.
        // Blitting from a stale image is a read of freed memory; refusing is
        // the only safe answer.
        assert_eq!(blit_index(3, 0, 3), None);
        assert_eq!(blit_index(0, CAPTURE_SLOTS, 3), None);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p nescapture state::`
Expected: FAIL — `blit_index` not defined.

- [ ] **Step 3: Add the fields the ring needs**

In `apps/nescapture/src/state.rs`, add to `CaptureRing`:

```rust
    /// One command buffer per (swapchain image, slot) pair, recorded on first
    /// use and re-submitted afterwards. The blit's contents depend on nothing
    /// else, so re-recording it every frame was work done on the game's own
    /// thread for a result that never changed.
    pub blits: Vec<vk::CommandBuffer>,
    /// Which entries of `blits` have been recorded. Cleared wholesale when the
    /// swapchain is recreated: the recorded buffers name specific `VkImage`
    /// handles, and a recreated swapchain's images are different objects.
    pub blits_recorded: Vec<bool>,
    /// How many images the swapchain had when the ring was built.
    pub image_count: usize,
```

`CaptureSlot::command_buffer` is removed — the per-pair buffers replace it.

- [ ] **Step 4: Allocate the pairs in `create_capture_ring`**

`create_capture_ring` gains an `image_count: usize` parameter, passed from `capture_present_frame` via `ds.swapchain_images.lock()`. Change the allocate call:

```rust
    let blit_count = image_count * CAPTURE_SLOTS;
    let ai = vk::CommandBufferAllocateInfo {
        s_type: vk::StructureType::COMMAND_BUFFER_ALLOCATE_INFO,
        p_next: std::ptr::null(),
        command_pool,
        level: vk::CommandBufferLevel::PRIMARY,
        command_buffer_count: blit_count as u32,
        _marker: std::marker::PhantomData,
    };
    let mut blits = vec![vk::CommandBuffer::null(); blit_count];
    if unsafe { (ds.fp.allocate_command_buffers)(ds.raw, &ai, blits.as_mut_ptr()) }
        != vk::Result::SUCCESS
    {
        unsafe { (ds.fp.destroy_command_pool)(ds.raw, command_pool, std::ptr::null()) };
        return None;
    }
```

Set `blits_recorded: vec![false; blit_count]` and `image_count` on the returned ring.

- [ ] **Step 5: Move the recording behind first use**

Extract the existing body of `capture_present_frame` between `begin_command_buffer` and `end_command_buffer` into:

```rust
/// Record the blit for one (swapchain image, slot) pair. Called once per pair.
///
/// No `ONE_TIME_SUBMIT`: this buffer is submitted many times. It is never
/// submitted twice concurrently, because the slot it writes is held by a
/// `SlotGuard` for the whole life of the frame, so the previous submission has
/// completed before the slot is handed out again.
unsafe fn record_blit(
    ds: &crate::state::DeviceState,
    cb: vk::CommandBuffer,
    si: vk::Image,
    fi: vk::Image,
    ext: vk::Extent2D,
) -> bool
```

with `flags: vk::CommandBufferUsageFlags::empty()` in the begin info. In `capture_present_frame`, replace the reset/begin/record/end block with a lookup:

```rust
    let Some(bi) = crate::state::blit_index(image_index, guard.index(), ring.image_count) else {
        return None;
    };
    let cb = *ring.blits.get(bi)?;
    if !ring.blits_recorded[bi] {
        if !unsafe { record_blit(ds, cb, si, fi, ext) } {
            return None;
        }
        ring.blits_recorded[bi] = true;
    }
```

The `wait_for_fences` / `reset_fences` pair above it stays: the fence is still what the encoder side waits on, and it still has to be reset before re-signalling.

- [ ] **Step 6: Invalidate on swapchain recreation**

In `apps/nescapture/src/swapchain.rs`, where `retire_all_present_semaphores` is already called on (re)create, also clear the recordings. A recreated swapchain's images are new handles; a command buffer naming the old ones reads freed memory.

```rust
    if let Ok(mut ring) = ds.capture_ring.lock() {
        if let Some(r) = ring.as_mut() {
            // The recorded blits name the old swapchain's images by handle.
            r.blits_recorded.iter_mut().for_each(|r| *r = false);
        }
    }
```

If the new swapchain has a different image count, `blit_index` returns `None` for the extra images and those frames are skipped until the ring is rebuilt — acceptable, and safe, which the alternative is not.

- [ ] **Step 7: Run the tests**

Run: `cargo build --release -p nescapture && cargo test --release -p nescapture`
Expected: build clean, all tests pass.

- [ ] **Step 8: Verify against a game**

Run the game. Confirm the stream is correct — a wrong blit index shows as a frozen or torn stream, not as an error. Alt-tab or change resolution once to exercise swapchain recreation. Record the rate line.

- [ ] **Step 9: Commit**

```bash
git add apps/nescapture/src/state.rs apps/nescapture/src/capture.rs apps/nescapture/src/swapchain.rs
git commit -m "perf(nescapture): the blit is recorded once per image and slot"
```

---

## Task 3: The capture worker and the encoder become one thread

A captured frame currently crosses four threads: the game's present thread, `nescapture-capture`, `nescapture-encoder`, `nescapture-ipc`. The middle hop earns nothing. `nescapture-capture` waits a fence, dups an fd and forwards — work the encoder thread can do at the top of its own loop, because it has nothing else to overlap it with: the blit for frame N+1 was submitted a whole frame before the encoder finishes N, so the wait is already satisfied when it is reached.

The encoder → IPC hop stays. That one overlaps bitstream readback and the socket write with the next frame's encode, which is real.

**Files:**
- Modify: `apps/nescapture/src/present.rs:10-23` (`CaptureJob`), `:183-304` (worker removed)
- Modify: `apps/nescapture/src/encode.rs` (`CapturedFrame`, `push_frame`, `encoder_thread`)

**Interfaces:**
- Consumes: `crate::state::blit_index` is untouched by this task; `SlotGuard` as-is.
- Produces: `CapturedFrame` gains `ds_key: usize`, `fence: vk::Fence`, `dmabuf_fd: c_int`, `stride: u32`, `image: vk::Image`, `memory: vk::DeviceMemory`, and loses `source`. The encoder thread resolves `source` itself via a new `fn resolve_source(frame: &CapturedFrame) -> Option<FrameSource>`.

- [ ] **Step 1: Move the resolve step into a function**

In `apps/nescapture/src/present.rs`, lift the body of the worker loop between the fence wait and `push_frame` into:

```rust
/// Wait for the blit and turn a slot into something the encoder can read.
///
/// The fence wait is the CPU handover the two devices need: pixelforge's
/// VkDevice shares no timeline with the game's, so a semaphore cannot bridge
/// them. It runs on the encoder thread, where it costs nothing — the blit it
/// waits for was submitted a frame earlier and has long since completed.
pub fn resolve_source(ds: &crate::state::DeviceState, frame: &CapturedFrame) -> Option<FrameSource>
```

- [ ] **Step 2: Delete the worker thread and send straight to the encoder**

In `queue_for_encode`, replace the `capture_tx` channel and `start_capture_worker` with a direct `PipelineHandle::push_frame`. The lazy encoder init moves here, still behind `ds.encoder.lock()`. Delete `start_capture_worker`, `CaptureJob` and `DeviceState::capture_tx`.

`push_frame` is already `try_send` and non-blocking, so this is safe to call from the present hook. A refused send drops the frame and returns the slot when the `CapturedFrame` drops, which is the behaviour the ring already assumes.

- [ ] **Step 3: Resolve at the top of the encoder loop**

In `encoder_thread`, immediately after `frame_rx.recv_timeout` succeeds:

```rust
        let Some(ds) = crate::state::DEVICE_STATE.get(&raw.ds_key).map(|s| s.clone()) else {
            continue;
        };
        let Some(source) = crate::present::resolve_source(&ds, &raw) else {
            continue;
        };
```

and use `source` where `raw.source` was read.

- [ ] **Step 4: Cut the channel depth to 1**

`mpsc::sync_channel::<CapturedFrame>(2)` becomes `(1)`. With the resolve step moved into the consumer, a queued frame is now an unwaited blit rather than an exported buffer, and the ring's four slots are the backpressure. Two layers of queue depth on top of it only adds latency.

- [ ] **Step 5: Run the tests**

Run: `cargo build --release -p nescapture && cargo test --release -p nescapture`
Expected: build clean, all tests pass.

- [ ] **Step 6: Verify against a game**

Run the game. Confirm `nescapture-capture` no longer appears in `ps -T`. Compare `capture` in the rate line before and after: this task targets that number specifically, and it should fall.

- [ ] **Step 7: Commit**

```bash
git add apps/nescapture/src/present.rs apps/nescapture/src/encode.rs apps/nescapture/src/state.rs
git commit -m "perf(nescapture): one thread fewer between the blit and the encoder"
```

---

## Task 4: The capture image is tiled, not linear

`allocate_dmabuf_image` hard-codes `tiling: vk::ImageTiling::LINEAR`, and `present.rs` passes `modifier: 0` (`DRM_FORMAT_MOD_LINEAR`) to the importer. So every capture detiles a full frame on the write and the encoder samples a linear image on the read — the worst layout available on both ends.

The import side is already ready: `apps/nescapture/src/dmabuf_import.rs:119-154` builds `VkImageDrmFormatModifierExplicitCreateInfoEXT` with per-plane layouts and creates the image with `DRM_FORMAT_MODIFIER_EXT` tiling. Only the producer is linear.

Do this task last. It is the largest and the one most likely to need a per-driver fallback.

**Files:**
- Create: `apps/nescapture/src/modifiers.rs`
- Modify: `apps/nescapture/src/capture.rs:105-160` (`allocate_dmabuf_image`), `:392` (`query_stride`)
- Modify: `apps/nescapture/src/state.rs` (`CaptureSlot` gains `modifier: u64`)
- Modify: `apps/nescapture/src/device.rs:75-83` (injected extensions)
- Modify: `apps/nescapture/src/dispatch.rs` (new entry points)
- Modify: `apps/nescapture/src/present.rs` (pass the real modifier)

**Interfaces:**
- Produces: `pub fn pick_modifier(candidates: &[ModifierProps]) -> Option<ModifierProps>`, `pub struct ModifierProps { pub modifier: u64, pub plane_count: u32 }`

- [ ] **Step 1: Write the failing test**

Create `apps/nescapture/src/modifiers.rs`:

```rust
// ─────────────────────────────────────────────────────────────────────────────
//  modifiers.rs — choosing a DRM format modifier for the capture ring
//
//  The importer has always been able to take a tiled buffer; the producer just
//  never offered one. Picking the modifier is the whole of the decision, and it
//  is pure, so it is here and tested rather than inline in an unsafe block.
// ─────────────────────────────────────────────────────────────────────────────

/// One entry of `VkDrmFormatModifierPropertiesListEXT`, already filtered to
/// modifiers the driver reports as usable for both our write and the
/// encoder's read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModifierProps {
    pub modifier: u64,
    pub plane_count: u32,
}

/// `DRM_FORMAT_MOD_LINEAR`.
pub const LINEAR: u64 = 0;

/// Pick the modifier to allocate the capture ring with.
///
/// Single-plane only. A multi-plane modifier means the importer must describe
/// every plane's offset and stride, and the export path hands out one fd — so
/// taking one would produce an image the far side reads wrongly, silently.
/// Prefer any tiled single-plane modifier over linear; fall back to linear,
/// which is what the ring used before this existed and always works.
pub fn pick_modifier(candidates: &[ModifierProps]) -> Option<ModifierProps> {
    candidates
        .iter()
        .find(|m| m.plane_count == 1 && m.modifier != LINEAR)
        .or_else(|| candidates.iter().find(|m| m.plane_count == 1))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tiled_modifier_beats_linear() {
        let c = [
            ModifierProps { modifier: LINEAR, plane_count: 1 },
            ModifierProps { modifier: 0x0200_0000_0000_0001, plane_count: 1 },
        ];
        assert_eq!(pick_modifier(&c).unwrap().modifier, 0x0200_0000_0000_0001);
    }

    /// A multi-plane modifier with one exported fd would be imported with the
    /// wrong plane offsets and produce a corrupt frame rather than an error.
    #[test]
    fn multi_plane_modifiers_are_refused() {
        let c = [
            ModifierProps { modifier: 0x0200_0000_0000_0002, plane_count: 2 },
            ModifierProps { modifier: LINEAR, plane_count: 1 },
        ];
        assert_eq!(pick_modifier(&c).unwrap().modifier, LINEAR);
    }

    #[test]
    fn nothing_usable_is_none() {
        let c = [ModifierProps { modifier: 0x99, plane_count: 4 }];
        assert_eq!(pick_modifier(&c), None);
    }

    #[test]
    fn an_empty_list_is_none() {
        assert_eq!(pick_modifier(&[]), None);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p nescapture modifiers::`
Expected: FAIL — module not registered.

- [ ] **Step 3: Register and pass**

Add `mod modifiers;` to `apps/nescapture/src/lib.rs`.
Run: `cargo test -p nescapture modifiers::`
Expected: PASS, 4 tests.

- [ ] **Step 4: Inject the extension**

In `apps/nescapture/src/device.rs`, add alongside the three existing constants:

```rust
    const EXT_IMAGE_DRM_FORMAT_MODIFIER: &[u8] = b"VK_EXT_image_drm_format_modifier\0";
```

and add it to `needed`. The existing retry-without-extensions fallback already covers a driver that refuses it: capture then stays on the linear path.

- [ ] **Step 5: Add the entry points**

In `apps/nescapture/src/dispatch.rs`, define and load, following the existing `PFN_vkGetImageSubresourceLayout` pattern:

- `PFN_vkGetPhysicalDeviceFormatProperties2` (instance-level, add to `NextInstanceFn`) — to enumerate modifiers.
- `PFN_vkGetImageDrmFormatModifierPropertiesEXT` (device-level, `try_load!`) — to read back which modifier the driver actually gave the image.

Both are `Option<...>` in the struct; absence means fall back to linear.

- [ ] **Step 6: Allocate tiled**

In `allocate_dmabuf_image`: enumerate modifiers for `fmt` via `vkGetPhysicalDeviceFormatProperties2` with `VkDrmFormatModifierPropertiesListEXT` chained, filter to those whose `drmFormatModifierTilingFeatures` supports `TRANSFER_DST` and `SAMPLED_IMAGE`, map to `ModifierProps`, and call `pick_modifier`. On `Some(m)` where `m.modifier != LINEAR`, create the image with `tiling: DRM_FORMAT_MODIFIER_EXT` and `VkImageDrmFormatModifierListCreateInfoEXT` naming just that modifier. On `None`, or on any failure, fall through to the existing linear path with one `log::warn!`.

- [ ] **Step 7: Carry the modifier through**

`query_stride` must read the layout with `VK_IMAGE_ASPECT_MEMORY_PLANE_0_BIT_EXT` for a modifier image rather than `COLOR`. Store the chosen modifier on `CaptureSlot`, and in `present.rs` replace the hard-coded `modifier: 0` in `FrameSource::DmaBuf` with `slot.modifier`.

- [ ] **Step 8: Run the tests**

Run: `cargo build --release -p nescapture && cargo test --release -p nescapture`
Expected: build clean, all tests pass.

- [ ] **Step 9: Verify against a game**

This is the task most able to produce a stream that is the right size and frame rate and carries garbage. Check the picture, not just the rate line — a wrong modifier or stride shows as diagonal tearing or a sheared image. Confirm the log names the chosen modifier. Record the rate line.

- [ ] **Step 10: Commit**

```bash
git add apps/nescapture/src/modifiers.rs apps/nescapture/src/capture.rs apps/nescapture/src/state.rs apps/nescapture/src/device.rs apps/nescapture/src/dispatch.rs apps/nescapture/src/present.rs apps/nescapture/src/lib.rs
git commit -m "perf(nescapture): the capture ring is tiled, as the importer always allowed"
```

---

## Deliberately not in this plan

**Timeline semaphores in place of the per-slot fence.** It would remove `vkResetFences` and a `vkWaitForFences` from the present hook — two driver calls on an already-signalled object, a few microseconds. Paying for that needs the layer to inject the `timelineSemaphore` feature into the application's `VkDeviceCreateInfo`, which means walking the app's `pNext` chain and either flipping a bit in an existing `VkPhysicalDeviceVulkan12Features`, flipping one in an existing `VkPhysicalDeviceTimelineSemaphoreFeatures`, or appending a new struct — the three cases are mutually exclusive and getting it wrong is an invalid chain. The cost is real and the benefit is not measurable next to the other four items.

**A dedicated transfer queue for the blit.** The semaphore interposition means the blit no longer needs to be on the presenting queue for ordering, so it could move to a transfer queue and stop serialising against the game's own submissions. It needs a queue the layer does not have: the queue-count bump that would have provided one was removed in `1fbdc13` because a family may have no spare queue. Worth revisiting after the four tasks above, with the rate line to say whether the remaining submit still costs anything.

**`ColorConverter::convert`'s CPU wait.** `queue_submit` then `wait_for_fences(&[fence], true, u64::MAX)` before `Encoder::encode` submits, at `pixelforge/src/converter/mod.rs:558`. Convert and encode never overlap and the gap between them is a scheduler wakeup on a box where the scheduler is oversubscribed. This is almost certainly the largest single item on the whole path, and it is pixelforge's to fix.
