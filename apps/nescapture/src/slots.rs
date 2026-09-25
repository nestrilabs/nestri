// ─────────────────────────────────────────────────────────────────────────────
//  slots.rs — ownership of the capture ring's destination buffers
//
//  A captured frame travels from the present hook, through the capture worker,
//  into the encoder thread, and its image must not be written again until the
//  encoder has finished reading it. Tracking that by hand across three threads
//  is how the single-buffer version got it wrong. Instead the slot index is
//  carried by a guard that returns it to the pool when it drops, wherever that
//  happens to be — including on the error paths that abandon a frame.
// ─────────────────────────────────────────────────────────────────────────────

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// Presents that were admitted by the frame gate and then found no free slot.
///
/// Diagnostic only, and global rather than per-device because the stats thread
/// has no route to a `DeviceState`. It answers the one question the existing
/// counters cannot: a frame missing between `capture_attempts` and the encoder
/// was either never captured because the encoder still held every slot, or was
/// captured and lost further down. Those have opposite fixes.
pub static SLOT_STARVED: AtomicU32 = AtomicU32::new(0);

pub struct SlotPool {
    free: Mutex<Vec<usize>>,
    count: usize,
}

impl SlotPool {
    pub fn new(count: usize) -> Arc<Self> {
        Arc::new(Self {
            free: Mutex::new((0..count).collect()),
            count,
        })
    }

    /// Take a slot, or `None` if every one is still downstream.
    ///
    /// Never blocks. This is called from `vkQueuePresentKHR`, on the game's own
    /// thread, where waiting for the encoder to catch up would be a stutter the
    /// player can feel. A frame with no slot is simply not captured.
    pub fn try_acquire(self: &Arc<Self>) -> Option<SlotGuard> {
        let index = match self.free.lock().ok().and_then(|mut f| f.pop()) {
            Some(i) => i,
            None => {
                SLOT_STARVED.fetch_add(1, Ordering::Relaxed);
                return None;
            }
        };
        Some(SlotGuard {
            pool: Arc::clone(self),
            index,
        })
    }

    /// How many slots are not currently downstream.
    pub fn available(&self) -> usize {
        self.free.lock().map(|f| f.len()).unwrap_or(0)
    }

    /// True when nothing is in flight — the only safe moment to tear the ring
    /// down or rebuild it at a new resolution.
    pub fn all_free(&self) -> bool {
        self.available() == self.count
    }
}

pub struct SlotGuard {
    pool: Arc<SlotPool>,
    index: usize,
}

impl SlotGuard {
    pub fn index(&self) -> usize {
        self.index
    }
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        if let Ok(mut free) = self.pool.free.lock() {
            free.push(self.index);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pool_hands_out_every_slot_once() {
        let pool = SlotPool::new(4);
        let held: Vec<_> = (0..4).map(|_| pool.try_acquire().unwrap()).collect();
        assert!(pool.try_acquire().is_none(), "handed out a fifth slot");
        let mut indices: Vec<_> = held.iter().map(|g| g.index()).collect();
        indices.sort_unstable();
        assert_eq!(indices, vec![0, 1, 2, 3]);
    }

    #[test]
    fn dropping_a_guard_returns_its_slot() {
        let pool = SlotPool::new(2);
        let a = pool.try_acquire().unwrap();
        let b = pool.try_acquire().unwrap();
        assert!(pool.try_acquire().is_none());
        assert!(!pool.all_free());

        drop(a);
        assert_eq!(pool.available(), 1);
        assert!(pool.try_acquire().is_some());

        drop(b);
        assert!(pool.all_free());
    }
}
