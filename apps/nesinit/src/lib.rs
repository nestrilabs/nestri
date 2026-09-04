// PID 1 inside a box.
//
// A microVM has no init unless something is it, and three of the jobs are
// nobody else's: reaping whatever the workload orphans, turning a signal into
// an ordered shutdown, and being the guest end of the one channel out.
//
// It does not know what it is running. It is handed a command, a set of shares
// and what an exit means, and it carries that out; a field that only makes
// sense for one kind of workload cannot reach it. ref(d-0033)

pub mod reap;
pub mod session;
pub mod shutdown;
pub mod workload;
