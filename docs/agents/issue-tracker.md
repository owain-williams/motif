# Issue tracker: bd (beads)

Issues, specs, and tickets for this repo live in the local **bd (beads)** database (`.beads/`), not in an external tracker. Use the `bd` CLI for all operations. Run `bd prime` for full workflow context.

## Conventions

- **Create an issue**: `bd create --title="..." --description="..." --type=task|bug|feature|chore|epic|spike|story --priority=<0-4>`
- **Read an issue**: `bd show <id>`
- **List issues**: `bd list --status=open`, `bd ready` (open + unblocked), `bd search "<query>"`
- **Comment on an issue**: `bd comment <id> "..."`
- **Apply / remove labels**: `bd label add <id> <label>` / `bd label remove <id> <label>`
- **Assign**: `bd assign <id> <name>`
- **Close**: `bd close <id> --reason="..."`

There is no `git remote` configured for this repo, so bd runs in local-only mode — nothing syncs off-machine. If a remote is added later, re-check `bd doctor` for sync setup.

## Pull requests as a triage surface

Not applicable — no git remote, no PRs.

## When a skill says "publish to the issue tracker"

Run `bd create --title="..." --description="..." --type=...`.

## When a skill says "fetch the relevant ticket"

Run `bd show <id>`. The user will normally pass the id directly (e.g. `bd-42`).

## Wayfinding operations

Used by `/wayfinder`. The **map** is an epic issue; **children** are its dependents.

- **Map**: `bd create --title="<effort>" --type=epic --description="<Notes / Decisions-so-far / Fog body>"`.
- **Child ticket**: `bd create --title="..." --parent=<map-id> --labels=<type>` where `<type>` is `research`/`prototype`/`grilling`/`task`.
- **Blocking**: `bd dep add <child> <blocker>` (child depends on blocker). A ticket is unblocked when every blocker is closed.
- **Frontier**: `bd ready`, scoped to the map's children — first by creation order wins.
- **Claim**: `bd update <id> --claim`.
- **Resolve**: `bd comment <id> "<answer>"`, then `bd close <id>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
