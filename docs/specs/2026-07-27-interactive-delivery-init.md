# Interactive `/delivery-init`

Status: approved, not implemented.
Date: 2026-07-27.

## Problem

`/delivery-init` detects the repo's gates, prints one proposal, asks a single yes/no question, and writes the file.
Everything else is decided for the user by a default they never see.

Two separate gaps sit behind that.

The schema already carries knobs nobody is ever asked about: `stages.tests`, `git.worktree`, `git.squash`, `docsDir`, `language`.
A repo that wants `stages.tests: true` has to learn that the key exists and hand-edit JSON to get it.

And there is a class of preference the config cannot express at all: how the agent should behave while writing code.
Comments in the code is the concrete ask that started this.
Today `SKILL.md` delegates that kind of thing to the repo's own `AGENTS.md` or `CLAUDE.md`, which means it is unvalidated, invisible to the CLI, and absent in repos that have no memory file.

## Decision

Extend `/delivery-init` into an opt-in wizard, and add a `style` section to the config for agent-behaviour preferences.

Rejected: writing a generated block into the repo's `CLAUDE.md`.
It works without the plugin and for any agent, but it is unvalidated, unreadable by the CLI and the hook, and it makes `init` write into a file it does not own.

Rejected: a readline wizard inside `bin/delivery.js`.
`/delivery-init` is a markdown prompt executed by an agent, and the agent's Bash tool gives the process no interactive stdin, so a prompting CLI would hang rather than ask.
The agent asks the questions; the CLI stays non-interactive.

## The `style` section

```json
"style": {
  "comments": "why-only",
  "commits": "per-stage",
  "checkpoints": "plan"
}
```

| Key | Values | Meaning |
| --- | --- | --- |
| `comments` | `none` / `why-only` / `generous` | `none`: comment only where the code is unreadable without it. `why-only`: explain why, never what. `generous`: `why-only` plus doc blocks on public APIs. |
| `commits` | `atomic` / `per-stage` / `single` | Commit granularity inside a ticket. Orthogonal to `git.squash`, which governs the merge. |
| `checkpoints` | `intake` / `plan` / `every` | What the agent stops for beyond the intake stop. See the rule below. |

The section is optional in full and key by key, and it merges key by key like `tracker`, `stages` and `git` do, so setting one key keeps its siblings.

### Defaults reproduce today's behaviour, and that is a deliberate exception

`lib/config.js` states that every unspecified key falls back to a strict default, so a repo that forgets to configure something gets a stricter process rather than a looser one.
That rule is unambiguous for gates and stages.
It does not translate to style: there is no reading under which `generous` is stricter than `none`.

So these defaults are chosen on a different rule, and the difference has to be recorded or the next reader of `config.js` will file it as an oversight.
`checkpoints: "plan"` is literally what `SKILL.md` does today, so an existing config that gains no `style` key keeps behaving exactly as it did before the upgrade.
`comments: "why-only"` and `commits: "per-stage"` are the conventions this repo already follows in `lib/`.
`per-stage` over `atomic` because `git.squash` defaults to true, and per-commit discipline inside a branch that gets squashed buys nothing.

## CLI

```bash
node bin/delivery.js init --write \
  --set stages.tests=true \
  --set style.comments=none \
  --set gates.e2e="pnpm run e2e" \
  --unset gates.lint
```

`--set <dotted.key>=<value>` is repeatable and splits on the **first** `=`, so a command containing an equals sign survives intact.

`--unset <dotted.key>` is repeatable.
It exists for gates: when detection finds a `lint` script that is dead in practice, an absent key is the only way to say the gate does not exist, since the config treats absence as non-existence.

Overrides apply to the proposal before it is printed, so a run without `--write` shows the human exactly what a run with `--write` would store.

Any error - an unrecognised key, a value outside its enum, a `--set` without `=` - prints every error found, exits 1, and leaves the file untouched.
There is no partially applied config.

The existing refusal to overwrite an existing `.claude/delivery.json` stays as it is.

### Coercion follows the schema, not the shape of the string

`"true"` becomes a boolean only for keys declared boolean: `git.worktree`, `git.squash`, `stages.intake`.
`stages.tests` is tri-state: `true` and `false` coerce, `ask` stays a string.
Everything under `gates.*` stays a string unconditionally.
A gate named `true` is unlikely, but a gate that silently became a boolean would break `check` at runtime, and the guard costs one line.

### Placement

Two pure functions in `lib/config.js`: `parseOverrides(argv)` returning `{overrides, errors}`, and `applyOverrides(config, overrides)` returning `{config, errors}`.
Filesystem access stays in `bin/`, matching the existing split, so override parsing is unit-testable without fixture directories.

`KNOWN_KEYS` gains a `style` section and `validate()` gains the enum checks, and override validation goes through both.
The rules live in one place or they will drift.

## Command flow

`commands/delivery-init.md` step 3 becomes a fork rather than a single yes/no.

"Write as proposed" is the current behaviour with no extra turns.
"Customise" runs three batches, each followed by an offer to stop and write what has been decided so far.

1. **Gates.** Show the detected commands.
   One question listing the undetected gates: which of these does the repo actually have.
   Ask for the commands of the ones selected.
   Offer to drop a false positive via `--unset`.
2. **Process.** One batch of three: `stages.tests`, `git.worktree`, `git.squash`.
   `docsDir` and `language` are visible in the printed proposal and can be corrected in a reply.
   A dedicated question for each would add friction for a case that almost never arises.
3. **Style.** `comments`, `commits`, `checkpoints`.

Step 4 is a single `init --write` call carrying every `--set` and `--unset`.
Step 5 is unchanged.

## SKILL.md

A fourth rule joins the three under "read the repo's config": `style` is optional, absent means the defaults above, and those defaults are "as today" rather than "stricter".

A new section gives each value its operational meaning.
Without it, `generous` is a word each agent interprets differently, which defeats the point of configuring it.

### The intake stop is not negotiable

Commit `2232700` restored the stop after intake on purpose.
`checkpoints` therefore governs only what happens **beyond** that stop, which every level keeps:

- `intake` - no further waiting, except the existing product-ambiguity rule, which stands at every level.
- `plan` - additionally wait for approval of the plan. Today's behaviour.
- `every` - additionally stop after each stage.

Stated any less explicitly, `checkpoints: "intake"` reads as permission to skip grooming, which is the exact regression that commit fixed.

## Tests

`applyDefaults` gets `style` in `SECTIONS` so it merges key by key; `KNOWN_KEYS.style` catches typos; `validate` covers the three enums.

A dedicated file for `parseOverrides` and `applyOverrides`: split on the first `=`, `--unset`, unknown key, out-of-enum value, schema-driven coercion, and above all that a failed run leaves the config unmutated.

`cli.test.js`: `--set` changes the printed proposal; an invalid override exits 1 and writes no file; `--write` with overrides writes them.

`detect.test.js`: `proposeConfig` emits the style defaults.

## Compatibility

An old `lib/config.js` reading a config that has a `style` key reports `unknown key style`, and `unknownKeys` output goes into `errors`, which makes `resolveConfig` return `null` and takes `check` out entirely.
A new config against a plugin that was not updated is a broken `check`, not a degraded one.

So the scope includes a version bump in `.claude-plugin/plugin.json` and a line in the README naming the minimum version for `style`.

Relaxing `unknownKeys` to ignore unrecognised sections is rejected: catching a typo that would silently loosen the process is worth more than forward compatibility with a plugin the user can update.

## Out of scope

`style.docsLang` - the language of the artifacts.
Raised and dropped during design.

Any change to how `git.squash` or the merge itself works.

Reading `style` from the pre-PR hook.
It loads the config already and the new section is harmless to it, but nothing in the hook acts on style.
