// Ordered shutdown: the second job that is nobody else's.
//
// The order is the whole content of this module. The workload goes first and
// alone, because it is the only process whose exit anyone is waiting to hear
// about; everything else goes after, so a service is never killed while the
// workload still needs it. Then the disks are flushed and the machine is
// powered off, because a guest whose init returns is a guest that hangs.

use std::time::Duration;

/// What an ordered shutdown does to the machine, behind a trait so the order
/// can be asserted without a VM and without root.
pub trait Machine {
    /// Ask the workload to stop.
    fn signal_workload(&mut self);
    /// Wait up to `grace` for the workload to leave. `true` if it did.
    fn await_workload(&mut self, grace: Duration) -> bool;
    /// Stop waiting.
    fn kill_workload(&mut self);
    /// Ask every remaining process to stop, then wait up to `grace`.
    fn signal_rest(&mut self, grace: Duration);
    /// Stop waiting for the rest.
    fn kill_rest(&mut self);
    fn flush_disks(&mut self);
    fn power_off(&mut self);
}

/// Run the shutdown, in order, and do not return.
///
/// A workload that leaves inside its grace period is never killed: an exit
/// code that says "asked to stop" is worth more to whoever reads the report
/// than one that says "killed", and some workloads only save on the way out.
pub fn ordered<M: Machine>(machine: &mut M, grace: Duration) {
    machine.signal_workload();
    if !machine.await_workload(grace) {
        machine.kill_workload();
    }
    machine.signal_rest(grace);
    machine.kill_rest();
    machine.flush_disks();
    machine.power_off();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Recorder {
        steps: Vec<&'static str>,
        workload_leaves: bool,
    }

    impl Machine for Recorder {
        fn signal_workload(&mut self) {
            self.steps.push("signal_workload");
        }
        fn await_workload(&mut self, _grace: Duration) -> bool {
            self.steps.push("await_workload");
            self.workload_leaves
        }
        fn kill_workload(&mut self) {
            self.steps.push("kill_workload");
        }
        fn signal_rest(&mut self, _grace: Duration) {
            self.steps.push("signal_rest");
        }
        fn kill_rest(&mut self) {
            self.steps.push("kill_rest");
        }
        fn flush_disks(&mut self) {
            self.steps.push("flush_disks");
        }
        fn power_off(&mut self) {
            self.steps.push("power_off");
        }
    }

    #[test]
    fn the_workload_stops_before_anything_else_and_the_disks_flush_before_power() {
        let mut machine = Recorder {
            workload_leaves: true,
            ..Default::default()
        };
        ordered(&mut machine, Duration::from_secs(5));

        assert_eq!(
            machine.steps,
            vec![
                "signal_workload",
                "await_workload",
                "signal_rest",
                "kill_rest",
                "flush_disks",
                "power_off",
            ],
        );
    }

    #[test]
    fn a_workload_that_leaves_in_time_is_not_killed() {
        let mut machine = Recorder {
            workload_leaves: true,
            ..Default::default()
        };
        ordered(&mut machine, Duration::from_secs(5));
        assert!(!machine.steps.contains(&"kill_workload"));
    }

    #[test]
    fn a_workload_that_overstays_its_grace_is_killed_and_shutdown_still_finishes() {
        let mut machine = Recorder {
            workload_leaves: false,
            ..Default::default()
        };
        ordered(&mut machine, Duration::from_secs(5));

        let killed = machine
            .steps
            .iter()
            .position(|s| *s == "kill_workload")
            .unwrap();
        let rest = machine
            .steps
            .iter()
            .position(|s| *s == "signal_rest")
            .unwrap();
        assert!(
            killed < rest,
            "the rest of the guest outlives the workload: {:?}",
            machine.steps
        );
        assert_eq!(machine.steps.last(), Some(&"power_off"));
    }
}
