// PID 1 inside a box.
//
// A microVM has no init unless something is it, and three of the jobs are
// nobody else's: reaping whatever the workload orphans, turning a signal into
// an ordered shutdown, and being the guest end of the one channel out.
//
// It does not know what it is running. It is handed a set of shares, and then
// commands naming what to run and what an exit means, and it carries those out;
// a field that only makes sense for one kind of workload cannot reach it.
// ref(d-0033)
//
// It is also the box's only init: there is no service manager in the image, so
// the box's own services come up from a table in this binary. ref(d-0063)

pub mod filesystems;
pub mod payload;
pub mod reap;
pub mod services;
pub mod session;
pub mod shutdown;
pub mod system;
pub mod ticket;
pub mod workload;
