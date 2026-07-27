# Portable delivery workflow · Design

Date: 2026-07-27
Status: approved, ready for planning

## Problem

Delivery discipline - staged artifacts, a planning checkpoint, verification gates, a pre-PR self-check - is easy enough to build once, inside a single repository.
It tends to end up spread across that repo's own instructions file and a handful of ad hoc docs, with universal process tangled together with facts that are true only of that one project.

Three consequences:

1. A second repo gets none of it without copy-paste, and the copies drift.
2. Nothing can be turned off per repo, so a repo that does not need e2e tests, or does not use a particular tracker, either follows rules that do not apply or abandons the process entirely.
3. It cannot be handed to another person. There is no install step, only "read these files and imitate them".

## Decisions

| Question | Decision | Why |
|---|---|---|
| Packaging | Claude Code plugin, distributed as a marketplace git repo | Same mechanism already used for caveman / superpowers / claude-hud. Install, update and uninstall are one command each and leave nothing behind. |
| Repo | `pulse-amazing-team/agent-workflow` | Owner already has the org. |
| Artifact location | Always `docs/features/<TICKET>/`, committed | Considered scratchpad / PR body / tracker comments. Rejected: the artifacts are the thing that lets a second person pick a ticket up from its docs alone, which is the point of the process. |
| Tracker | `link` mode only in v1 | Agent reads a pasted ticket URL for the key and context, and writes nothing back. Tracker automation stays repo-local, in that project's own instructions. |
| Tests | Conditional, gated on an explicit question | New requirement. Not every repo warrants tests, and an agent that writes them unasked produces noise. |
| Enforcement | Soft reminder hook, non-blocking | A blocking gate on `gh pr create` was considered and rejected: it breaks hotfixes and would be the first thing a new user disables. |
| Other agents | Claude Code only | The plugin format and hook mechanism this design relies on are specific to Claude Code. Other agents keep following whatever process discipline already lives in the repo's own instructions file. |

## Architecture: three layers

The plugin knows no fact about any specific project.
Everything project-specific lives in one of the two lower layers.
That separation is what makes it portable, and it is the constraint to hold onto during implementation.

**Layer 1 - the plugin (global, identical everywhere).**
Process only: the stage model, artifact templates, the self-check, intake rules, commit and PR conventions.
No stack, no paths, no commands.

**Layer 2 - `.claude/delivery.json` (machine-readable, committed per repo).**
The facts the plugin must know exactly rather than guess: gate commands, which stages are on, language, git conventions.
Committed, so it is identical for every person and every agent working in that repo, and visible on review when it changes.

**Layer 3 - the repo's `AGENTS.md` (prose).**
Stack, layout, domain conventions, gotchas, and any tracker automation the project relies on.
The plugin reads this as context but does not own it.

## Distribution

```
/plugin marketplace add pulse-amazing-team/agent-workflow
/plugin install delivery-workflow
```

Then, once per project:

```
/delivery-init
```

`/delivery-init` inspects the repo - package manager, scripts in `package.json`, language, default branch - proposes a `.claude/delivery.json`, and writes it after the user confirms.
It never invents a command it could not find.
A gate it cannot detect is left out, and it says which ones it left out and why.

Updating is `/plugin update`. Removing is `/plugin uninstall`.

## Config

`.claude/delivery.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/pulse-amazing-team/agent-workflow/main/schema.json",
  "language": "ts",
  "docsDir": "docs/features",
  "tracker": { "mode": "link" },
  "stages": { "intake": true, "tests": "ask" },
  "gates": {
    "lint": "pnpm lint",
    "typecheck": "pnpm typecheck",
    "test": "pnpm test",
    "e2e": "pnpm turbo run e2e",
    "build": "pnpm build"
  },
  "git": { "base": "main", "worktree": true, "squash": true }
}
```

Four rules govern how it is read.

**An absent key means the stage does not exist.**
`gates` without `e2e` means there is no e2e gate, not that the agent should infer a command.
This removes the most common failure: an agent reporting that it ran gates when it ran nothing.

**Defaults are strict.**
Anything unspecified is on and mandatory.
Relaxing a rule requires an explicit line in a file that lives in git and shows up in review.
Forgetting to configure something yields a stricter process, never a looser one.

**`language` selects the hard-rule set.**
`ts` forbids `any`, non-null `!` and `as T` casts (`as const` stays legal).
`py`, `go` and `none` carry their own or none.
Language-independent rules - Conventional Commits and never hand-edit generated files - always apply.

**A key it does not recognize is an error.**
`applyDefaults` builds the resolved config key by key, so an unrecognized key would otherwise vanish without trace and read identically to "absent" - which would let a typo quietly relax the process.
`loadConfig` reports it instead.

### Keys

| Key | Type | Default | Meaning |
|---|---|---|---|
| `language` | `"ts" \| "py" \| "go" \| "none"` | `"none"` | Which hard-rule set applies. |
| `docsDir` | string | `"docs/features"` | Where per-ticket artifacts live. |
| `tracker.mode` | `"link"` | `"link"` | v1 has one mode: read a pasted URL, write nothing back. |
| `stages.intake` | boolean | `true` | Whether stage 0 grooming runs. |
| `stages.tests` | `"ask" \| true \| false` | `"ask"` | See the stage model below. |
| `gates.*` | string | absent | Shell command per gate. Absent means the gate does not exist. |
| `git.base` | string | `"main"` | PR target branch. |
| `git.worktree` | boolean | `true` | Whether each ticket gets its own git worktree. |
| `git.squash` | boolean | `true` | Whether PRs squash-merge. |

## Stage model

```
0 intake      grooming; questions in ONE batch; wait for answers
1 scope       in/out, affected surfaces, dependencies, non-goals
2 product     intent, user stories, acceptance criteria
3 plan        approach, data model, files, migration steps, risks
              -> planning checkpoint to the human; wait for approval
4 implement   code matches plan.md; deviations folded back into it
--- GATE: "do we write tests?" -----------------
5 test-cases  only if yes
6 unit        only if yes
7 e2e         only if yes AND gates.e2e exists
------------------------------------------------
  self-check  then PR
```

The gate after stage 4 is driven by `stages.tests`:

- `"ask"` (default) - the agent stops and asks whether to write tests.
  On yes, it runs a short question session: what is worth covering, where the unit/e2e boundary sits, which cases are genuinely risky.
  The answers become `test-cases.md`, and stages 5-7 proceed.
- `true` - stages 5-7 always run, no question.
- `false` - stages 5-7 do not exist, and the test-related items drop out of the self-check so there is nothing to misreport.

The question is asked **once per ticket** and the answer is recorded in `plan.md`.
Without that, a multi-session ticket re-asks every session and collects inconsistent answers.

## Plugin contents

```
pulse-amazing-team/agent-workflow          the plugin IS the repo root
├── .claude-plugin/
│   ├── marketplace.json                   source: "./"
│   └── plugin.json                        manifest + hook registration
├── skills/delivery-workflow/
│   ├── SKILL.md                           orchestrator: reads config, drives stages
│   └── templates/                         intake / scope / product / plan / test-cases
├── commands/
│   ├── delivery-init.md                   inspect repo -> propose delivery.json
│   └── delivery-check.md                  run self-check + gates, show real output
├── hooks/pre-pr-reminder.js               soft pre-PR reminder
├── lib/                                   config, detection and status logic (unit-tested)
├── bin/delivery.js                        CLI the commands and hook call
├── test/                                  node --test
├── schema.json                            JSON Schema for delivery.json
└── README.md                              install in three commands
```

A single-plugin marketplace does not need a plugins/ subdirectory, so the plugin is the repository root and marketplace.json points at "./".

`schema.json` gives editor completion and error highlighting, so the config stops being guesswork.

## Enforcement

A non-blocking hook fires before `gh pr create` and injects a list of what is missing against the repo's config: absent artifacts, gates with no recorded output, self-check items not met.
It does not block.
A blocking gate was considered and rejected - it breaks legitimate hotfixes, and a tool that gets in the way is a tool people disable.

`/delivery-check` runs the same evaluation on demand and prints real command output rather than a claim.

## Adopting an existing repository

A repository that already has its own delivery discipline written into its instructions file is not starting from zero - it moves that discipline into the plugin and keeps whatever is genuinely specific to the project.

Moves out of the repo's own instructions and into the plugin:

- the stage list
- the pre-PR self-check
- the ticket intake rules (the discipline itself is universal; any tracker-specific mechanics are not)

Stays in the repo's own instructions:

- stack, layout, setup, local conventions
- domain conventions, gotchas, "where things live"
- any tracker automation: boards, columns, labels, and the like

Added: `.claude/delivery.json`, configured with that project's own gates and stage settings.

## Out of scope for v1

- Tracker adapters beyond `link` (Trello, Jira, GitHub Issues).
  The config already carries `tracker.mode`, so adding one later is additive.
- Serving Codex or other non-Claude-Code agents.
- Blocking enforcement.
- Publishing to npm.

## Risks

- **Config drift from reality.** A repo's `gates.test` can name a script that was later renamed. `/delivery-check` surfaces this the first time it runs, because the command fails loudly rather than being skipped.
- **The plugin absorbing project facts.** The one rule that makes this portable is that layer 1 knows nothing specific. Every future addition to `SKILL.md` should be checked against it.
- **`"ask"` becoming a rubber stamp.** If the question is asked at a point where the human is not paying attention, the answer will always be "yes, whatever". It is asked right after implementation, when the diff is fresh and the human has context to answer well.
