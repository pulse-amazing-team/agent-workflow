# agent-workflow

A delivery process for coding agents, distributed as a Claude Code plugin.

Install it once, run one command per repository, and every ticket from then on goes through the same stages - with the parts that differ between projects living in a small file you commit alongside your code.

## The problem it solves

Hand an agent a ticket and, left alone, it will usually start typing code. What you get back is a diff with no record of what was decided or rejected, tests that may or may not exist, and a claim that everything passes. Ask a second person - or a second agent, next week - to pick the work up, and there is nothing to pick up from.

The usual fix is a long list of rules in a `CLAUDE.md` or `AGENTS.md`. That works until you have a second repository. Then the rules are copied, the copies drift, and nothing can be switched off for the project that genuinely does not need it.

This plugin separates the two halves. The process is the same everywhere and lives here. The facts that differ - what your gates actually are, which branch you target, what language you write - live in `.claude/delivery.json` in your repo, in git, visible on review.

## What you get

**Staged work with artifacts that outlive the session.** Intake, scope, product, plan, implementation, then a decision about tests. Each stage leaves a file under `docs/features/<ticket>/`. A month later the reasoning is still there.

**A planning checkpoint.** The agent presents what it is building, what it is deliberately not building, and where the risk is - and waits, before writing code, when anything is product-ambiguous.

**Gates that actually ran.** `/delivery-check` executes the commands you configured, prints their real output, and exits non-zero when one fails. A gate is a command with an exit code, not a line in a summary. One caveat worth knowing: a repository that has configured no gates has nothing to fail, so `check` says so plainly and still exits zero. An unconfigured repo is not a verified one, and the message says as much - but do not wire a merge gate to the exit code alone until you have configured at least one.

**An explicit decision about tests.** Not every change is worth a test, and an agent that writes them unasked produces noise. After implementation it stops and asks - once per ticket - and records the answer.

## Install

```
/plugin marketplace add pulse-amazing-team/agent-workflow
/plugin install delivery-workflow
```

Then once per repository:

```
/delivery-init
```

It reads your repo - package manager, scripts, language, default branch - and proposes a config. It never invents a command it could not find: gates it cannot detect are listed by name so you can add them yourself. Take the proposal as-is, or answer three short batches of questions - gates, then process, then style - and stop after any of them. Review it, then commit it.

## Configuration

`.claude/delivery.json`, committed to your repo:

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
    "test": "pnpm test"
  },
  "git": { "base": "main", "worktree": true, "squash": true },
  "style": { "comments": "why-only", "commits": "per-stage", "checkpoints": "plan" }
}
```

Four rules govern how it is read.

**An absent `gates` key means the gate does not exist.** It does not mean "guess the command". Nothing is inferred, so nothing can be reported as run when it was not.

**Defaults are strict.** Anything you leave out is on and mandatory. Relaxing a rule takes an explicit line in a file that lives in git and shows up in review. Forgetting to configure something gives you a stricter process, never a looser one. One section is deliberately outside this rule: `style` describes agent behaviour, where no value is meaningfully stricter than another, so its defaults reproduce what the skill already did rather than picking a strictest option. A config written before `style` existed behaves identically after the upgrade.

**A key it does not recognise is an error.** A typo like `gate` for `gates` would otherwise vanish silently and read exactly like "absent", which is the same failure the first rule exists to prevent.

**`language` selects the hard-rule set.** `ts` forbids `any`, non-null `!` and `as T` casts. Only `ts` currently carries a rule set; `py`, `go` and `none` reserve the slot for one, not yet defined. Rules that do not depend on language - Conventional Commits, never hand-editing generated files - always apply.

Every key is documented in [schema.json](schema.json). Point your editor at it through the `$schema` line and you get completion and inline errors instead of guesswork.

### Keys

| Key | Values | Default | Meaning |
|---|---|---|---|
| `language` | `ts` `py` `go` `none` | `none` | Which hard-rule set applies |
| `docsDir` | path | `docs/features` | Where per-ticket artifacts live |
| `tracker.mode` | `link` | `link` | Read a pasted ticket URL, write nothing back |
| `stages.intake` | boolean | `true` | Whether the grooming stage runs |
| `stages.tests` | `ask` `true` `false` | `ask` | See below |
| `gates.*` | shell command | absent | One per gate. Absent means the gate does not exist |
| `git.base` | branch | `main` | What PRs target |
| `git.worktree` | boolean | `true` | Whether each ticket gets its own worktree |
| `git.squash` | boolean | `true` | Whether PRs squash-merge |
| `style.comments` | `none` `why-only` `generous` | `why-only` | How much commentary the code carries |
| `style.commits` | `atomic` `per-stage` `single` | `per-stage` | Commit granularity inside a ticket |
| `style.checkpoints` | `intake` `plan` `every` | `plan` | What the agent stops for, beyond the mandatory intake stop |

## The tests decision

`stages.tests` defaults to `"ask"`. After implementation the agent stops and asks whether tests are in scope. If yes, it runs a short exchange - what is worth covering, where the unit and end-to-end boundary sits, which cases are genuinely risky rather than merely enumerable - and the answers become `test-cases.md`.

It asks once per ticket and records the answer in `plan.md`, so a ticket spanning several sessions does not re-open the question and collect different answers.

Set it to `true` to always write tests. Set it to `false` and the test stages stop existing for that repo - and the test items drop out of the pre-PR check too, so there is nothing left to misreport.

## Style

`style` covers how the agent works rather than what it builds: how much it comments, how it commits, and where it stops to ask.

`checkpoints` deserves one clarification. The stop after intake is mandatory at every level and this key cannot switch it off. `intake` means nothing beyond it, `plan` adds waiting for approval of the plan, and `every` adds a stop after each stage.

The section requires plugin version 0.2.0 or later. An older plugin treats `style` as an unrecognised key, which is an error by design, and `/delivery-check` will refuse to run until you update.

## Commands

| Command | What it does |
|---|---|
| `/delivery-init` | Read the repo, propose a config, write it after you approve |
| `/delivery-check <ticket>` | Verify the ticket's artifacts, then actually run the gates and print their output |

A non-blocking reminder also fires before `gh pr create`, listing anything the repo's own config says is missing. It never blocks: a gate you cannot get past is a gate people disable.

## What it deliberately does not do

**It does not manage your issue tracker.** `tracker.mode` is `link`: you paste a ticket URL, the agent reads it for context and takes the key, and writes nothing back. No moves, no labels, no comments. Tracker automation belongs to your repo, not to a shared process.

**It does not block anything.** Every check reports; none refuse. Enforcement that gets in the way during an incident is enforcement that gets uninstalled.

**It does not know anything about your project.** No stack, no paths, no commands. If you find project-specific knowledge creeping into this repo, that is a bug - the whole design rests on that separation.

## How it fits together

Three layers, and the boundaries matter more than the contents:

| Layer | Lives in | Holds |
|---|---|---|
| Process | this plugin | The stages, the templates, the self-check. Identical everywhere |
| Configuration | `.claude/delivery.json` | Gate commands, which stages are on, language, git conventions |
| Project knowledge | your `AGENTS.md` | Stack, layout, domain conventions, gotchas |

[docs/design.md](docs/design.md) records why it is shaped this way, including the alternatives that were rejected.

## Development

```
npm test
```

No dependencies. Tests are `node --test`, which auto-discovers `test/*.test.js`.

## License

MIT
