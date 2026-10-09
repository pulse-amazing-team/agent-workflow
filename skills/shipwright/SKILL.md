---
name: shipwright
description: Use when starting or implementing any ticket - the staged delivery process. Invoke BEFORE writing code, so scope, product and plan land before implementation.
---

# Shipwright

Every ticket ships through the same stages, each leaving a real artifact, so any developer or agent can pick the ticket up from its docs alone.

## First: read the repo's config

```bash
cat .claude/shipwright.json
```

If it does not exist, say so and offer `/shipwright-init`. Do not guess the repo's commands.

Everything below is shaped by that file. Three rules:

- **An absent `gates` key means the gate does not exist.** Never invent a command to fill the hole, and never report a gate you did not run.
- **Anything unspecified is on and mandatory.** Strictness is the default.
- **`language` selects the hard rules.** `ts` forbids `any`, non-null `!` and `as T` (`as const` is fine). Conventional Commits and "never hand-edit generated files" apply regardless.
- **`style` is optional, and its defaults are "as today", not "stricter".** Absent means `comments: why-only`, `commits: per-stage`, `checkpoints: plan` - exactly what this skill did before the section existed, so upgrading the plugin never changes a repo's process behind its back.

The repo's own `AGENTS.md` or `CLAUDE.md` carries stack, layout and domain conventions. Read it. This skill owns the process, not the project.

## The ticket key

`tracker.mode` is `link`: the human pastes a ticket URL or names a key. Read it for context, take the key, and write nothing back to the tracker - no moves, no labels, no comments.

The key names the artifact directory exactly as given: `<docsDir>/<ticket>/`. `ticketDir()` and the check command use it verbatim, with no case normalization - use the same spelling every time, since a filesystem that is case-sensitive will treat `M-1` and `m-1` as different directories.

## The rule

**Do NOT jump to code.** Work the stages below in order, top to bottom, and create a todo per stage before you start so that skipping one is visible rather than silent.

The first stage is the one most often skipped, and skipping it is what produces work nobody asked for. Do not treat it as paperwork to be filled in after the fact.

## Style

`style` says how to work, not what to build. Read all three keys before stage 4.

**`comments`** - how much commentary the code carries.

- `none` - comment only where the code is genuinely unreadable without it.
- `why-only` - explain why a thing is done, never what the line does. The default.
- `generous` - `why-only` plus a doc block on every exported function, type and module.

**`commits`** - granularity inside the ticket.

- `atomic` - one commit per logical change, tests and implementation together.
- `per-stage` - one commit per stage that produced files. The default.
- `single` - one commit for the whole ticket.

Conventional Commits applies at every setting. `git.squash` governs the merge and is a separate decision.

**`checkpoints`** - what you stop for.

The stop after intake is mandatory at every level and is never governed by this key. So is the rule to wait before writing code when anything is product-ambiguous. `checkpoints` only adds to those:

- `intake` - nothing beyond them.
- `plan` - also post the planning checkpoint and wait for approval before stage 4. The default.
- `every` - also stop after each stage and wait before starting the next.

## Stages

**0. Intake** (`intake.md`) - skip ONLY if `stages.intake` is false in the config.
Capture the raw ask and your assumptions. Then **STOP** and groom: ask the human your clarifying questions in ONE batch - scope, flow, edge cases, acceptance, data - and **WAIT for the answers before writing anything else**. Do not proceed to stage 1 on assumptions you could have checked in a sentence.

Record the questions, the answers, and the decisions in `intake.md`. Note a default only where a question went unanswered.

If the ask is genuinely unambiguous, say so in one line and move on - do not invent busywork questions. But "I think I understand it" is not the same as unambiguous, and the cost of one batch of questions is far below the cost of building the wrong thing.

**1. Scope** (`scope.md`) - what is in, what is out, affected surfaces, dependencies, explicit non-goals.

**2. Product** (`product.md`) - intent, user stories, acceptance criteria.

**3. Plan** (`plan.md`) - approach, data model, endpoints, files, migration steps, risks. Reconcile the ticket against the current code here and flag anything stale in it.

Then post a **planning checkpoint** to the human: what you are building, what you are NOT building, the decisions you made, the open questions, and where the risk is. Unless `style.checkpoints` is `intake`, WAIT for approval before writing code. At `intake` you still post it and may continue without waiting - except when anything is product-ambiguous, where waiting is required at every level.

**4. Implementation** - the code. It must match `plan.md`; fold any deviation back into the plan so the document never lies.

**The tests decision.** Read `stages.tests`:

- `"ask"` - STOP. Ask the human whether tests are in scope for this ticket. On yes, run a short session: what is worth covering, where the unit/e2e boundary sits, which cases are genuinely risky rather than merely enumerable. Record the decision and its reasoning in `plan.md`, then continue to stage 5. On no, record that too and skip to the self-check.
- `true` - continue to stage 5 without asking.
- `false` - stages 5 to 7 do not exist for this repo. Skip to the self-check.

Ask once per ticket. The answer lives in `plan.md` so a later session does not re-open it.

**No useless tests.** Whatever the decision, test only the logic this ticket adds or changes.
Do not add tests for untouched code, for framework or library behaviour, for trivial getters and pass-throughs, or to raise a coverage number.
Every test must fail if the new logic were removed or broken; a test that would still pass is noise, so delete it.

**5. Test cases** (`test-cases.md`) - enumerate happy, edge and failure cases, each mapped to a concrete test.

**6. Unit tests** - write business logic test-first: red, green, refactor. Cover logic - branches, edge cases, calculations, error paths, state transitions. Do NOT assert data shape; the type system owns shape, and a shape-only test breaks on refactors while proving nothing.

**7. Integration and e2e** - only if `gates.e2e` exists. Keep it thin: the happy path plus the one negative case that matters. Exhaustive branch coverage belongs in unit tests. For a backend-only ticket there is no UI flow - say so in `test-cases.md` rather than inventing a hollow one.

## Before you call it done

Run the real check:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/shipwright.js" check <ticket>
```

If that fails with a module error, `${CLAUDE_PLUGIN_ROOT}` was not set in this
context. Find the CLI under `~/.claude/plugins/cache/` - it is
`agent-workflow/shipwright/*/bin/shipwright.js` - and run it by full path.
Do not skip the check and do not describe its result from memory: without the
command's real output there is nothing to report.

It verifies the artifacts and actually runs the configured gates. Paste its output. If a gate fails, quote the failure - never claim green blind.

One line needs interpreting rather than obeying. `decision pending: test-cases.md`
only means the file is absent; the check cannot read a decision. If `plan.md`
already records the tests decision, that record governs and the nudge is expected
noise - do not re-ask the human. Ask only when `plan.md` has no answer in it.

Then confirm by hand:

- Code matches `plan.md`, with deviations folded back into it.
- Every case in `test-cases.md` maps to a real, passing test (or the tests decision is recorded as "no").
- Manual QA steps exist for any UI, external-provider or device flow.
- No forbidden constructs for the configured `language`.
- No generated file hand-edited.

## Code review

Once coding is finished and the check is green, **ASK** the human: "Coding is finished. Do you want to start the code review?"
**WAIT** for the answer. Never start the review on your own.

On yes, run the review in a separate session that knows nothing about the ticket or this conversation:

```bash
claude -p "/code-review high <branch>" --permission-mode plan
```

Pass only the branch.
Do not add the ticket, the plan or your own summary: a reviewer that shares your framing shares your blind spots.
`--permission-mode plan` keeps the reviewer read-only.

Show the human the findings verbatim.
For each one, either fix it or say why it does not apply; never drop a finding silently.
After fixes, re-run the check.

On no, record that the review was skipped by the human and continue.

## Proof

Green gates are not proof.
Prove the feature works, or the bug is gone, by exercising it the way a user would.

- UI change - a screenshot of the result. For a bug, a screenshot before the fix and one after.
- API or backend change - the real request and response, or the log line, that shows the new behaviour.
- CLI or script - the command and its real output.
- Anything else - the closest observable evidence, and one line on why it proves the change.

Save screenshots and captured output under `<docsDir>/<ticket>/proof/`.
If proof is genuinely impossible (no environment, no credentials), say so and name what is missing.
Never claim done without proof or that explicit statement.

## Brief

After proof, write `brief.md` from the template and post a short version of it in chat:

- **Task** - what we needed to do, in one or two sentences.
- **Fix** - how it was done: the approach, not a diff walkthrough.
- **Manual check** - numbered steps a human can follow, with the expected result at each step.
- **Test coverage** - which tests cover the new logic, or the recorded "no tests" decision.
- **Code review** - each finding and what was done about it, or "skipped by the human".
- **Proof** - the screenshot or captured output from `proof/`.

## Merge request

Do not open, push or publish an MR on your own.
After the brief, **ASK** the human whether to publish the MR and **WAIT** for an explicit yes.
Approval to publish is not approval to merge.

The title follows Conventional Commits.
The body has exactly these sections, in this order:

```markdown
## What changed

<the change and why, in a few lines>

## How to test

1. <step> - <expected result>

## Useful code paths

- `path/to/file.ts` - <what to look at there>

## Proof

<screenshot or captured output>
```

## Ticket intake

When you create a ticket rather than receive one, it is incomplete without:

1. A **type** - Bug, Feature, Refactor, Chore or Infra. Exactly one.
2. A **priority** - P0 now, P1 next, P2 later. If you genuinely cannot judge it, say so rather than guessing.

Before creating one, search the existing tickets and the code: the thing may already be tracked or already shipped.

## Templates

Copy from `${CLAUDE_PLUGIN_ROOT}/skills/shipwright/templates/`.
