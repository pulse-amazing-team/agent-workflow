---
description: Verify a ticket's artifacts and actually run the configured gates
allowed-tools: Bash, Read
---

Run the real pre-PR check for a ticket.

The ticket key is `$ARGUMENTS`. If it is empty, look at the current branch name and the paths this branch touched under the configured `docsDir`, propose the key you infer, and confirm it with the user before running anything.

## Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/delivery.js" check <ticket>
```

## Report honestly

This command's output is evidence. Paste what it actually printed.

- If an artifact is missing, name it and say which stage produces it.
- If a gate failed, quote the failure. Do not summarise it as "some tests failed".
- If it printed `no gates configured`, say exactly that. Nothing was verified, and nothing may be claimed.
- If `decision pending: test-cases.md` appears, the tests question has not been asked yet for this ticket. Ask it now, and record the answer in `plan.md`.

Never report the check as passing on the strength of anything other than a zero exit code.
