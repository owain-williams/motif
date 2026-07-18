# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Agent skills

### Issue tracker

Issues live in the local bd (beads) database, not an external tracker. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), applied as bd labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (root `CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.

## Build & Test

pnpm workspaces + Turborepo. See `README.md` for full details.

```bash
pnpm install                               # install all workspaces
pnpm build                                 # turbo: shared → app frontends
pnpm typecheck                             # tsc --noEmit across all packages
pnpm test                                  # JS/TS tests (Vitest in @motif/shared)
cd apps/bridge && cargo test --workspace   # Rust tests (bridge-core)
cd apps/bridge && cargo check --workspace  # compile Tauri shell + core
```

Per-app dev/launch commands (`expo start`, `tauri dev`, etc.) are in `README.md`.

## Architecture Overview

Two apps plus a shared package (ADR 0003):

- `apps/capture` — Expo/React Native/TypeScript mobile app (Capture).
- `apps/bridge` — Tauri desktop app (Bridge): TypeScript/Vite frontend in `src/`,
  Rust domain logic in `core/` (`bridge-core`), thin Tauri adapter in `src-tauri/`.
- `packages/shared` (`@motif/shared`) — Idea metadata schema + sync protocol
  types, consumed by both apps' frontends; Bridge's Rust core mirrors them.

Domain vocabulary is in `CONTEXT.md`; decisions in `docs/adr/`.

## Conventions & Patterns

- **Test seams**: domain logic lives in framework-agnostic cores testable without
  a device/window — plain-TypeScript modules (Vitest) and `bridge-core` (`cargo
  test`). UI/runtime shells stay thin. Follow this pattern rather than adding new
  seams.
- Tests assert external behavior, not internal call shape.
- The shared package must be built (`pnpm build`) before consumers typecheck;
  Turbo handles this via `^build` dependencies.
