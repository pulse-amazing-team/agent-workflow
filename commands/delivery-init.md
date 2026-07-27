---
description: Inspect this repo and propose a .claude/delivery.json
allowed-tools: Bash, Read, Write, Edit
---

Set up the delivery workflow for this repository.

## Step 1: Look at what is already there

```bash
cat .claude/delivery.json 2>/dev/null || echo "no config yet"
```

If a config already exists, show it, say the repo is already set up, and stop unless the user asks to change something specific.

## Step 2: Propose a config

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/delivery.js" init
```

## Step 3: Show it and get a decision

Show the proposal. Then say, in your own words:

- which gates were detected, and from which scripts
- which gates were NOT detected - these are real gaps, not defaults
- that `stages.tests` is `"ask"`, meaning the agent will stop after implementation and ask whether tests are in scope
- that `style` is included with its defaults, which reproduce current behaviour

Then offer two paths and STOP until the user answers:

1. **Write it as proposed** - go to Step 4 with no overrides.
2. **Customise it** - go to Step 3a.

Do not run Step 4 before the user has replied. Writing a config they have not seen is how a repo ends up with gates nobody chose.

## Step 3a: The three batches

Ask each batch as one grouped set of questions, not one message per key. After each batch, offer to stop and write what has been decided so far. Collect the answers as `--set` and `--unset` arguments; write nothing until Step 4.

**Batch 1 - gates.** Ask which of the undetected gates the repo actually has, and for each one named, ask for the command. Ask whether any detected gate is wrong or dead.

- a real gate: `--set gates.<name>=<command>`
- a wrong detection: `--unset gates.<name>`

Never invent a command. A gate the user cannot name a command for does not exist.

**Batch 2 - process.** Three questions together:

- `stages.tests` - `ask`, `true` or `false`
- `git.worktree` - does each ticket get its own worktree
- `git.squash` - do PRs squash-merge

`docsDir` and `language` are visible in the proposal and can be corrected in a reply. Do not make them their own questions.

**Batch 3 - style.** Three questions together. Give the meaning of each value, not just its name:

- `style.comments` - `none`, `why-only`, `generous`
- `style.commits` - `atomic`, `per-stage`, `single`
- `style.checkpoints` - `intake`, `plan`, `every`. The stop after intake happens at all three; this only sets what is added on top.

## Step 4: Write it

One command carrying every answer:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/delivery.js" init --write --set <key>=<value> --unset <key>
```

Drop the flags the user did not change. With no answers at all this is the plain `init --write`.

If it exits non-zero it wrote nothing and printed every problem it found. Fix the flags and run it again. Do not fall back to writing the JSON by hand: the command is what validates the file.

## Step 5: Point at the next step

Tell the user the config is committed-ready and that from here on, starting a ticket means invoking the `delivery-workflow` skill. Do not commit for them unless they ask.
