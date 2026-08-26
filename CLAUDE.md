# nestri

Open-source cloud gaming: a control plane and the guest components that run
inside a box. **This repository is public.** That is the single most important
fact about it and most of the rules below follow from it.

## Layout

Split by *what a thing is*, not by what language it is written in.

```
apps/       what runs        api, auth (TS) · nescope, neswire, nescapture (Rust)
crates/     shared Rust      nesprotocol
packages/   shared TS        core, auth
docs/       long-form        alchemy.md
```

Both toolchains live at the root: `package.json` is the Bun workspace,
`Cargo.toml` the Cargo one.

| | |
|---|---|
| `bun install` | dependencies |
| `bun dev` | local Cloudflare dev via Alchemy |
| `cargo build --workspace` · `cargo test --workspace` | the Rust half |
| `bun run deploy:sandbox` | deploy a stage |

## Two rules that are not style preferences

**Nothing closed may enter this repo.** Not source, not a dependency, not a
directory that "looked convenient". Before adding a top-level directory, know
which component it is and that the component is open. This has already been
caught once, in a commit that was never pushed.

**Versions are pinned once, centrally.** A Cargo member writes
`tokio.workspace = true` and never a version; a TS package uses the root
`catalog`. Two packages in one tree must not disagree about a dependency.

## Where the detail is

These load automatically when you work in the directory they describe — read
them there rather than duplicating them here.

- [`packages/core/CLAUDE.md`](packages/core/CLAUDE.md) — domain modules: the
  `.sql.ts` / `index.ts` pair, `fn()`, the serialization boundary, ids, the
  actor model, the error type, auth flow.
- [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md) — route modules, registration,
  `.meta()` vs `.openapi()`, error flow.
- [`docs/alchemy.md`](docs/alchemy.md) — infrastructure: stages, bindings,
  secrets, service bindings, the CLI.

## Things worth knowing before you start

**This tree is mid-rewrite.** The Rust components arrived recently, one commit
each, imported as trees rather than as history — so `git log` on them starts at
the import and their own past is not here. Docs for that half are thin and
being written.

**The TypeScript half predates the Rust half**, so the guides above describe it
in much more depth. That is a gap in the writing, not a statement about which
half matters.

**Rust components are guest-side**: they run inside a virtual machine, not on
the control plane. `nescope` composites, `nescapture` captures and encodes
frames from inside the workload's own process, `neswire` handles audio, and
`nesprotocol` is the wire format all three share. None of them talk to the API.

## Conventions

Conventional commits. Explain *why* in the body — the diff already shows what.
Comments earn their place by saying something the code cannot; a comment
restating the line below it is noise.
