// What the kernel under this box actually chose, said once, at debug.
//
// Several of the settings that decide a box's latency are not decided by the
// image. The clocksource is picked at boot and can be demoted by a watchdog,
// the idle driver loads only when the host or the command line asks for it,
// and the preemption model is a boot parameter. None of them is visible from
// outside, and a box has no shell to ask with, so this reads them from sysfs
// and procfs and logs them. Enable with `RUST_LOG=nesinit=debug` on the kernel
// command line.

use std::path::Path;

/// Clocksources a vDSO can read without entering the kernel.
///
/// Anything else makes every `clock_gettime` a syscall, and in a guest an
/// emulated one: `hpet` is an MMIO read the host has to trap. A Windows game
/// polls its performance counter constantly, so that is a cost paid thousands
/// of times a frame, and nothing reports it.
const VDSO_CLOCKSOURCES: &[&str] = &["tsc", "kvm-clock"];

/// Log the kernel's timing and idle choices. Needs `/proc` and `/sys`.
pub fn describe() {
    let clocksource = read("/sys/devices/system/clocksource/clocksource0/current_clocksource");
    let cmdline = read("/proc/cmdline").unwrap_or_default();

    tracing::debug!(
        clocksource = clocksource.as_deref().unwrap_or("unknown"),
        available = read("/sys/devices/system/clocksource/clocksource0/available_clocksource")
            .as_deref()
            .unwrap_or("unknown"),
        idle_driver = read("/sys/devices/system/cpu/cpuidle/current_driver")
            .as_deref()
            .unwrap_or("none"),
        idle_governor = read("/sys/devices/system/cpu/cpuidle/current_governor_ro")
            .as_deref()
            .unwrap_or("none"),
        // Present only while the haltpoll governor is built in, and only
        // meaningful while it is the governor in use.
        halt_poll_ns = read("/sys/module/haltpoll/parameters/guest_halt_poll_ns")
            .as_deref()
            .unwrap_or("n/a"),
        // The build's default when absent. The mode actually in effect is only
        // readable through debugfs, which this kernel does not have.
        preempt = kernel_parameter(&cmdline, "preempt").unwrap_or("default"),
        cpus = std::thread::available_parallelism().map_or(0, usize::from),
        kernel = read("/proc/sys/kernel/version")
            .as_deref()
            .unwrap_or("unknown"),
        "platform"
    );

    if let Some(source) = clocksource.as_deref()
        && !VDSO_CLOCKSOURCES.contains(&source)
    {
        tracing::warn!(
            clocksource = source,
            "every clock read in this box is a syscall; the kernel did not trust a faster clock"
        );
    }
}

/// Log how much of this box's CPU time the host took back. Call once, at the
/// end of a session: the counters are cumulative since boot.
pub fn report_steal() {
    let Some(stat) = read("/proc/stat") else {
        return;
    };
    let Some((steal, total)) = steal_of(&stat) else {
        return;
    };
    // Parts per thousand, so the log carries an integer and no float
    // formatting decides how small a number reads as zero.
    let permille = (steal * 1000).checked_div(total).unwrap_or(0);
    tracing::debug!(
        steal_ticks = steal,
        total_ticks = total,
        permille,
        "cpu time stolen by the host"
    );
}

/// Steal and total ticks from the aggregate `cpu` line of `/proc/stat`.
///
/// Columns are user, nice, system, idle, iowait, irq, softirq, steal, and then
/// guest time, which the kernel already counts inside user and nice. Summing
/// past steal would count it twice.
fn steal_of(stat: &str) -> Option<(u64, u64)> {
    let line = stat.lines().find(|l| l.starts_with("cpu "))?;
    let fields: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .take(8)
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    let steal = *fields.get(7)?;
    Some((steal, fields.iter().sum()))
}

/// The value of one bare `name=value` kernel parameter.
fn kernel_parameter<'a>(cmdline: &'a str, name: &str) -> Option<&'a str> {
    cmdline
        .split_whitespace()
        .find_map(|word| word.strip_prefix(name)?.strip_prefix('='))
        .filter(|value| !value.is_empty())
}

fn read(path: impl AsRef<Path>) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_parameter_is_found_by_its_whole_name() {
        let cmdline = "cpuidle_haltpoll.force=1 console=hvc0 preempt=full ro";
        assert_eq!(kernel_parameter(cmdline, "preempt"), Some("full"));
        assert_eq!(
            kernel_parameter(cmdline, "cpuidle_haltpoll.force"),
            Some("1")
        );
    }

    /// `preempt` must not match `preempt_foo=`, which is a different parameter.
    #[test]
    fn a_longer_name_sharing_the_prefix_is_not_a_match() {
        assert_eq!(kernel_parameter("preempt_foo=x", "preempt"), None);
        assert_eq!(kernel_parameter("console=hvc0", "preempt"), None);
    }

    #[test]
    fn steal_is_the_eighth_column_and_guest_time_is_not_counted_twice() {
        // user nice system idle iowait irq softirq steal guest guest_nice
        let stat = "cpu  100 0 50 800 10 5 5 30 999 999\ncpu0 1 2 3 4 5 6 7 8 9 10\n";
        assert_eq!(steal_of(stat), Some((30, 1000)));
    }

    #[test]
    fn a_stat_without_a_cpu_line_reports_nothing() {
        assert_eq!(steal_of("intr 1 2 3\n"), None);
        assert_eq!(steal_of("cpu  1 2 3\n"), None);
    }
}
