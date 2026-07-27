#!/usr/bin/env node
// A soft reminder before a PR is opened.
//
// It NEVER blocks. A blocking gate breaks legitimate hotfixes and is the first
// thing a new user disables, so this only injects what is missing and lets the
// agent decide. Silence is the normal case: no config, no PR command, or a
// complete ticket all produce no output at all.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig } from '../lib/config.js';
import {
  conditionalArtifacts,
  inferTicket,
  missingArtifacts,
  ticketDir,
} from '../lib/status.js';

const PR_COMMAND = /\bgh\s+pr\s+create\b/;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function changedPaths(cwd, base) {
  try {
    return execSync(`git diff --name-only ${base}...HEAD`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
    }),
  );
}

function main() {
  const payload = readStdin();
  if (payload === null) return;
  if (payload.tool_name !== 'Bash') return;
  if (!PR_COMMAND.test(payload.tool_input?.command ?? '')) return;

  const cwd = process.cwd();
  const { exists, config, errors } = loadConfig(cwd);
  // No config means this repo has not opted in. Say nothing.
  if (!exists) return;
  if (errors.length > 0) {
    emit(`.claude/delivery.json is invalid: ${errors.join('; ')}. Fix it before opening the PR.`);
    return;
  }

  const ticket = inferTicket(changedPaths(cwd, config.git.base), config.docsDir);
  if (ticket === null) {
    emit(
      `Delivery workflow: could not tell which ticket this branch belongs to - no single directory under ${config.docsDir} was touched. ` +
        `Before opening the PR, confirm the ticket's artifacts exist and that the configured gates (${Object.keys(config.gates).join(', ') || 'none configured'}) actually ran.`,
    );
    return;
  }

  const dir = join(cwd, ticketDir(config, ticket));
  const present = existsSync(dir) ? readdirSync(dir) : [];
  const missing = missingArtifacts(config, present);
  const pending = conditionalArtifacts(config).filter((artifact) => !present.includes(artifact));

  const notes = [];
  if (missing.length > 0) {
    notes.push(`missing artifacts in ${ticketDir(config, ticket)}: ${missing.join(', ')}`);
  }
  if (pending.length > 0) {
    notes.push(`the tests decision has not been recorded for ${ticket} - ask, then write it into plan.md`);
  }
  if (Object.keys(config.gates).length === 0) {
    notes.push('this repo has configured no gates, so nothing will be verified by running them');
  }
  if (notes.length === 0) return;

  emit(
    `Delivery workflow reminder for ${ticket}: ${notes.join('; ')}. ` +
      `Run /delivery-check ${ticket} for the full picture. This is a reminder, not a block.`,
  );
}

main();
