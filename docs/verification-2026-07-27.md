# End-to-end verification

Date: 2026-07-27
Branch: `feat/delivery-workflow-plugin`
Node: v24.7.0

What follows is what was actually executed and what it actually printed.
Where a step could not be executed, it says so rather than describing what would have happened.

## Test suite

```
npm test
ℹ pass 67
ℹ fail 0
```

Run twenty consecutive times during the Task 4 exit-code fix, zero failures.
Before that fix the suite failed on roughly one run in ten; see `## The flake` below.

## Plugin structure

Compared field by field against an installed, working plugin (`caveman`).

```
marketplace keys ours: $schema,name,description,owner,plugins
marketplace keys ref : $schema,name,description,owner,plugins
plugin name matches marketplace entry: true
source: "./"
hook command: node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-pr-reminder.js"
```

All four JSON files parse: `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `schema.json`, `package.json`.

## Running as an installed plugin

The repo was copied to a scratch directory, `.git` removed, and both entry points invoked exactly as `plugin.json` invokes them, with `CLAUDE_PLUGIN_ROOT` pointing at the copy.

Hook, against a `gh pr create` call:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Delivery workflow: could not tell which ticket this branch belongs to - no single directory under \"docs/features\" was touched. Before opening the PR, confirm the ticket's artifacts exist and that the configured gates (\"lint\") actually ran."}}
```

Exit 0.

CLI, on a ticket missing two artifacts with one passing gate:

```
ticket m5 (docs/features/m5)
  required: intake.md, scope.md, product.md, plan.md
  missing: product.md, plan.md
  decision pending: test-cases.md - ask unless plan.md already records the answer

--- gate lint: true
gate lint passed
```

Exit 1, correctly, because artifacts are missing even though the gate passed.

## The three ticket-resolution states are distinguishable

This was the defect end-to-end verification found. Before the fix, a failed `git diff` was reported as ambiguity, so a repo with a misnamed `git.base` was told its branch touched no ticket directory when it had touched one.

**Git could not answer** (repo default branch `master`, `git.base` left at `main`):

```
Delivery workflow: could not compare this branch against "main" - that base branch may be misnamed in .claude/delivery.json, or not fetched locally. Artifact checking is skipped until it resolves. This is a reminder, not a block.
```

**Git answered, no ticket directory touched:**

```
Delivery workflow: could not tell which ticket this branch belongs to - no single directory under "docs/features" was touched.
```

**Git answered, one ticket resolved:**

```
Delivery workflow reminder for m5: missing artifacts in "docs/features/m5": intake.md, product.md, plan.md; the tests decision has not been recorded for m5 - ...
```

All three exit 0.

## Security

`.claude/delivery.json` ships inside a repository and arrives with any branch or pull request, and the hook runs unprompted. Two proofs were run.

**Shell injection, before the fix.** Config `{"git":{"base":"main; touch $T/PWNED #"}}`, hook invoked with a `gh pr create` payload:

```
*** MARKER CREATED - arbitrary command execution confirmed ***
```

The hook exited 0 and printed an ordinary-looking reminder. `execSync` was passing the interpolated string to `/bin/sh -c`.

**After the fix** (`execFileSync` with an argument array, no shell):

```
safe
```

**Context flooding.** A 300-character payload placed in both `docsDir` and a gate name:

```
context length: 542
payload truncated - capped
```

Zero gates still renders cleanly, without quotes:

```
gates (none configured)
```

## Crash paths

A ticket path that is a regular file rather than a directory, which `existsSync` reports as present:

- hook exit 0
- CLI exit 1 with a normal missing-artifacts report, no stack trace

Malformed stdin to the hook: no output, exit 0.
A non-PR command and a non-Bash tool: no output at all.

## The flake

`npm test` failed on roughly 10 percent of runs, always in the tests that spawn the CLI, always with `actual: null`.

Measured rather than assumed:

| Exit mechanism | Crashes |
|---|---|
| `process.exit(1)` | 22 / 300 |
| `process.exitCode = 1` | 0 / 300 |

A minimal script of `console.log('hello'); process.exit(1);` reproduces it on this Node build, so the trigger was not this codebase. The fix is still ours to make, and for a second reason that matters more than the flake: `process.exit()` can drop unflushed stdout, and this CLI's printed output is its evidence.

## Test quality

`inferTicket` was mutated to always return `null`. Five tests failed.
Under the original test fixture, which never ran `git init`, the same mutation would have failed none - every hook test was silently exercising the ambiguous-ticket fallback rather than the branch it claimed. The fixture now builds real two-branch git history.

## Not verified here

`/plugin marketplace add pulse-amazing-team/agent-workflow` and `/plugin install delivery-workflow` were **not** executed. Slash commands are not available to the process that produced this document.

What that leaves unproven: that Claude Code's plugin loader accepts these manifests, surfaces the skill, registers the two commands, and wires the `PreToolUse` hook.
Everything downstream of loading - the hook's behaviour, the CLI's behaviour, and the manifest shapes measured against a working plugin - is verified above.

The install must be run by hand, and after this branch merges: the marketplace resolves a repository's default branch, not a feature branch.
