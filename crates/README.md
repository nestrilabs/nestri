# `crates/`

Shared Rust: a library another crate in this repo depends on. A binary someone
runs goes in [`apps/`](../apps); shared JS/TS goes in
[`packages/`](../packages). The split is by *what a thing is*, not by what
language it is written in — same rule on both sides of the repo.

Empty today. Components move here one at a time as they are opened.

## Two rules

**Every version is pinned in the root `Cargo.toml`.** A member writes
`tokio.workspace = true` and never a version, so two crates in this tree cannot
disagree about a dependency.

**Nothing here may depend on anything closed, or name it.** This repo is
public. A crate that needs a private component is in the wrong repo, and a
comment explaining *who calls this* wants a category noun — "the caller", "a
supervising agent" — rather than a name. The requirement is the interesting
part; who currently satisfies it is not.
