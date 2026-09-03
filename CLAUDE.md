# nestri

Open-source cloud gaming: a control plane and the guest components that run
inside a box. **This repository is public.** That is the single most important
fact about it and most of the rules below follow from it.

## Layout

Split by *what a thing is*, not by what language it is written in.

```
apps/       what runs        api, auth (TS) · nescope, neswire, nescapture, neshub (Rust, guest-side)
                            nesdoctor (Rust, runs on the user's own machine)
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

## Three rules that are not style preferences

### 1. THIS REPO IS PUBLIC. Write nothing that only makes sense to us.

**Read this before writing a single comment, docstring or commit message.** It
has been violated twice, both times by someone who knew the repo was public,
both times about ten occurrences deep before anyone noticed. Being careful is
demonstrably not enough, so the rules below are mechanical.

**Never, anywhere in this repo:**

| ✗ | why |
|---|---|
| **Any relative path that escapes this tree** into an internal repo, or the filename of an internal document | A filename plus a title tells a reader exactly what to ask for |
| A quotation from an internal document, even one phrase | Restate the requirement in this repo's own words |
| The name of a component with no public surface | It discloses the shape of the system, which is the part deliberately kept |
| Anything of the above in a **commit message** | History is permanent here and is deliberately never rewritten — a message cannot be fixed by a later commit |
| Anything of the above in **published output** — an OpenAPI `description`, an error message, CLI text, a README | A docstring that becomes an API description reaches people who never open the source. Check where a string *goes*, not what file it is in |

**The one sanctioned exception**, and the only way to cite internal reasoning:

```ts
// A size tier sets vCPU, RAM and the output geometry. ref(d-0021)
```

`ref(d-NNNN)` · `todo(d-NNNN)` · `fixme(d-NNNN)`, in **source comments only**.
Note `d-NNNN` and never `d/NNNN` — a slash reads as a path.

**The test that makes it decidable — apply it to every sentence:**

> Delete the marker. Does the comment still say something true and useful about
> *this* code?

If yes, it belongs. If the sentence collapses without the reference, it was
describing our topology rather than this component, and the fix is to state the
**requirement** instead of who set it. In practice a category noun does it —
*the caller*, *the host agent*, *an orchestrator*, *the control plane* — and the
result is a better sentence, because it says what is needed rather than who
happens to satisfy it. Every single case fixed so far got shorter and clearer.

**A name a user types is not a leak.** `nessh` appears throughout this repo on
purpose: the product *is* `ssh nestri.io`, so hiding it would mean hiding what
we sell. The test narrows to: does this name appear because a **user**
encounters it, or because a **component** does?

If you are unsure whether a name is internal, do not guess and do not grep for
permission — write the category noun. It is never wrong.

### 2. Nothing closed may enter this repo.

Not source, not a dependency, not a directory that "looked convenient". Before
adding a top-level directory, know which component it is and that the component
is open. This has already been caught once, in a commit that was never pushed.

### 3. Versions are pinned once, centrally.

A Cargo member writes `tokio.workspace = true` and never a version; a TS package
uses the root `catalog`. Two packages in one tree must not disagree about a
dependency.

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

**Most Rust components are guest-side**: they run inside a virtual machine, not
on the control plane. `nescope` composites, `nescapture` captures and encodes
frames from inside the workload's own process, `neswire` handles audio, and
`neshub` muxes all of it into one connection to the client. `nesprotocol` is
the wire format they share. None of them talk to the API.

**`nesdoctor` is the exception to all of the above.** It runs on a stranger's
own machine, on Linux, Windows and macOS, and is the only thing here that a
person outside the project can operate. Two consequences that do not apply
anywhere else in the tree: its dependency list is part of its interface,
because it is handed to people and asked to be trusted — everything doable with
`std` is done with `std`; and **it cannot be tested on the development
machine alone.** Both bugs it has shipped were Windows-only, found by users, in
code paths Linux never executes. Prefer a property test that runs everywhere
over a platform check that runs nowhere, and read what the Windows and macOS CI
runners print.

**None of the guest components depend on what they are running.** The box starts a payload that
the open components are not allowed to understand, so no code here may branch on
which one it is. `nescope` does mention Steam and Proton in comments — it
implements public Wayland and Vulkan protocols that gamescope also implements,
and those comments say which real case motivated a workaround. That is the
allowed kind: a name in prose, never a dependency in code.

## Conventions

Conventional commits. Explain *why* in the body — the diff already shows what.
Comments earn their place by saying something the code cannot; a comment
restating the line below it is noise.

**A commit message here is public and permanent.** No internal component names,
no decision numbers, no `ref(d-…)` markers — those are for source comments,
where a later commit can fix a mistake. Describe the change in this repo's own
terms: what changed, and why it is better. See rule 1.
