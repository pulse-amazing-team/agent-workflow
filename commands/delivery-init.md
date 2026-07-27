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
- which gates were NOT detected - these are real gaps, not defaults. If the repo has them under other script names, the user should say so now.
- that `stages.tests` is `"ask"`, meaning the agent will stop after implementation and ask whether tests are in scope

Ask whether to write it as-is or adjust anything first.

## Step 4: Write it

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/delivery.js" init --write
```

If the user asked for changes, write the file yourself with those changes instead of running the command.

## Step 5: Point at the next step

Tell the user the config is committed-ready and that from here on, starting a ticket means invoking the `delivery-workflow` skill. Do not commit for them unless they ask.
