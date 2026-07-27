---
name: delivery-workflow
description: Use when starting or implementing any ticket - the staged delivery process. Invoke BEFORE writing code, so scope, product and plan land before implementation.
---

# Delivery workflow

Every ticket ships through the same stages, each leaving a real artifact, so any developer or agent can pick the ticket up from its docs alone.

## First: read the repo's config

```bash
cat .claude/delivery.json
```

If it does not exist, say so and offer `/delivery-init`. Do not guess the repo's commands.

Everything below is shaped by that file. Three rules:

- **An absent `gates` key means the gate does not exist.** Never invent a command to fill the hole, and never report a gate you did not run.
- **Anything unspecified is on and mandatory.** Strictness is the default.
- **`language` selects the hard rules.** `ts` forbids `any`, non-null `!` and `as T` (`as const` is fine). Conventional Commits and "never hand-edit generated files" apply regardless.

The repo's own `AGENTS.md` or `CLAUDE.md` carries stack, layout and domain conventions. Read it. This skill owns the process, not the project.

## The ticket key

`tracker.mode` is `link`: the human pastes a ticket URL or names a key. Read it for context, take the key, and write nothing back to the tracker - no moves, no labels, no comments.

The key names the artifact directory exactly as given: `<docsDir>/<ticket>/`. `ticketDir()` and the check command use it verbatim, with no case normalization - use the same spelling every time, since a filesystem that is case-sensitive will treat `M-1` and `m-1` as different directories.

## The rule

**Do NOT jump to code.** Work the stages below in order, top to bottom, and create a todo per stage before you start so that skipping one is visible rather than silent.

The first stage is the one most often skipped, and skipping it is what produces work nobody asked for. Do not treat it as paperwork to be filled in after the fact.

## Stages

**0. Intake** (`intake.md`) - skip ONLY if `stages.intake` is false in the config.
Capture the raw ask and your assumptions. Then **STOP** and groom: ask the human your clarifying questions in ONE batch - scope, flow, edge cases, acceptance, data - and **WAIT for the answers before writing anything else**. Do not proceed to stage 1 on assumptions you could have checked in a sentence.

Record the questions, the answers, and the decisions in `intake.md`. Note a default only where a question went unanswered.

If the ask is genuinely unambiguous, say so in one line and move on - do not invent busywork questions. But "I think I understand it" is not the same as unambiguous, and the cost of one batch of questions is far below the cost of building the wrong thing.

**1. Scope** (`scope.md`) - what is in, what is out, affected surfaces, dependencies, explicit non-goals.

**2. Product** (`product.md`) - intent, user stories, acceptance criteria.

**3. Plan** (`plan.md`) - approach, data model, endpoints, files, migration steps, risks. Reconcile the ticket against the current code here and flag anything stale in it.

Then post a **planning checkpoint** to the human: what you are building, what you are NOT building, the decisions you made, the open questions, and where the risk is. WAIT for approval before writing code if anything is product-ambiguous.

**4. Implementation** - the code. It must match `plan.md`; fold any deviation back into the plan so the document never lies.

**The tests decision.** Read `stages.tests`:

- `"ask"` - STOP. Ask the human whether tests are in scope for this ticket. On yes, run a short session: what is worth covering, where the unit/e2e boundary sits, which cases are genuinely risky rather than merely enumerable. Record the decision and its reasoning in `plan.md`, then continue to stage 5. On no, record that too and skip to the self-check.
- `true` - continue to stage 5 without asking.
- `false` - stages 5 to 7 do not exist for this repo. Skip to the self-check.

Ask once per ticket. The answer lives in `plan.md` so a later session does not re-open it.

**5. Test cases** (`test-cases.md`) - enumerate happy, edge and failure cases, each mapped to a concrete test.

**6. Unit tests** - write business logic test-first: red, green, refactor. Cover logic - branches, edge cases, calculations, error paths, state transitions. Do NOT assert data shape; the type system owns shape, and a shape-only test breaks on refactors while proving nothing.

**7. Integration and e2e** - only if `gates.e2e` exists. Keep it thin: the happy path plus the one negative case that matters. Exhaustive branch coverage belongs in unit tests. For a backend-only ticket there is no UI flow - say so in `test-cases.md` rather than inventing a hollow one.

## Before you call it done

Run the real check:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/delivery.js" check <ticket>
```

If that fails with a module error, `${CLAUDE_PLUGIN_ROOT}` was not set in this
context. Find the CLI under `~/.claude/plugins/cache/` - it is
`agent-workflow/delivery-workflow/*/bin/delivery.js` - and run it by full path.
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

## Ticket intake

When you create a ticket rather than receive one, it is incomplete without:

1. A **type** - Bug, Feature, Refactor, Chore or Infra. Exactly one.
2. A **priority** - P0 now, P1 next, P2 later. If you genuinely cannot judge it, say so rather than guessing.

Before creating one, search the existing tickets and the code: the thing may already be tracked or already shipped.

## Templates

Copy from `${CLAUDE_PLUGIN_ROOT}/skills/delivery-workflow/templates/`.
