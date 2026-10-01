//! Ordering nespyro's GPU work against the caller's, without the CPU.

use std::sync::{Arc, Mutex, MutexGuard};

use ash::vk;

/// A point on a timeline semaphore: reached once the semaphore's value is at
/// least `value`. The same shape as pixelforge's, so a caller moving a frame
/// from its own rendering into nespyro and out again chains points the way it
/// does for pixelforge.
///
/// The semaphore must be a timeline semaphore on the same device as the
/// [`Context`](crate::Context).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimelinePoint {
    pub semaphore: vk::Semaphore,
    pub value: u64,
}

impl TimelinePoint {
    pub fn new(semaphore: vk::Semaphore, value: u64) -> Self {
        Self { semaphore, value }
    }

    /// A wait that holds back every stage of the submission.
    ///
    /// nespyro's submissions open with layout transitions whose stages the
    /// caller cannot know, so a narrower mask could let one of them run
    /// before the caller's work is done.
    pub(crate) fn wait_info(&self) -> vk::SemaphoreSubmitInfo<'static> {
        vk::SemaphoreSubmitInfo::default()
            .semaphore(self.semaphore)
            .value(self.value)
            .stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)
    }
}

/// Serialises submissions to a queue shared with other threads.
///
/// A `VkQueue` must not be submitted to from two threads at once. When
/// nespyro has a queue to itself, or the queue was created internally
/// synchronized, pass [`QueueLock::none`]. When it shares a queue with the
/// caller's own submissions, both sides lock the same `QueueLock` around every
/// `vkQueueSubmit2` and `vkQueuePresentKHR`.
#[derive(Debug, Clone)]
pub struct QueueLock(Option<Arc<Mutex<()>>>);

impl QueueLock {
    /// A lock for a queue shared with the caller; clone it to the other side.
    pub fn shared() -> Self {
        Self(Some(Arc::new(Mutex::new(()))))
    }

    /// No locking: the queue is nespyro's alone, or the driver synchronises it.
    pub fn none() -> Self {
        Self(None)
    }

    /// Holds the queue until the guard drops.
    pub fn lock(&self) -> Option<MutexGuard<'_, ()>> {
        // A panic while holding the lock poisons it, but the queue itself is
        // no worse for it, so the lock is still usable.
        self.0
            .as_ref()
            .map(|m| m.lock().unwrap_or_else(|p| p.into_inner()))
    }
}
