#!/usr/bin/env node
// The CLI behind /delivery-init and /delivery-check, and the brain of the
// pre-PR hook.
//
// It exists so that "the gates pass" is a command that really ran and printed
// its output, not a claim. Every subcommand exits non-zero when the repo does
// not satisfy its own config.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONFIG_PATH, loadConfig } from '../lib/config.js';
import { proposeConfig, undetectedGates } from '../lib/detect.js';
import {
  conditionalArtifacts,
  missingArtifacts,
  requiredArtifacts,
  ticketDir,
} from '../lib/status.js';

const SCHEMA_URL =
  'https://raw.githubusercontent.com/pulse-amazing-team/agent-workflow/main/schema.json';

const cwd = process.cwd();
const [command, ...rest] = process.argv.slice(2);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function gitDefaultBranch() {
  try {
    const ref = execSync('git symbolic-ref --quiet --short refs/remotes/origin/HEAD', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return ref.replace(/^origin\//, '') || 'main';
  } catch {
    return 'main';
  }
}

function init() {
  const pkg = readJson(join(cwd, 'package.json')) ?? {};
  const files = readdirSync(cwd);
  const config = proposeConfig({
    files,
    scripts: pkg.scripts ?? {},
    defaultBranch: gitDefaultBranch(),
  });
  const undetected = undetectedGates(config.gates);

  console.log(JSON.stringify({ $schema: SCHEMA_URL, ...config }, null, 2));
  if (undetected.length > 0) {
    // Naming the gap is the point: a config that claims a gate it cannot run is
    // worse than one that admits the gate is missing.
    console.log(`\ngates not detected: ${undetected.join(', ')}`);
    console.log('Add them by hand if the repo has them under other script names.');
  }

  if (!rest.includes('--write')) return 0;

  const target = join(cwd, CONFIG_PATH);
  if (existsSync(target)) {
    console.log(`\n${CONFIG_PATH} already exists - not overwriting. Edit it by hand.`);
    return 1;
  }
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ $schema: SCHEMA_URL, ...config }, null, 2)}\n`);
  console.log(`\nwrote ${CONFIG_PATH}`);
  return 0;
}

function resolveConfig() {
  const { config, errors, exists } = loadConfig(cwd);
  if (errors.length > 0) {
    for (const error of errors) console.log(`config error: ${error}`);
    return null;
  }
  if (!exists) console.log(`no ${CONFIG_PATH} - using strict defaults. Run /delivery-init.`);
  return config;
}

function artifactReport(config, ticket) {
  const dir = join(cwd, ticketDir(config, ticket));
  const present = existsSync(dir) ? readdirSync(dir) : [];
  const missing = missingArtifacts(config, present);
  const pending = conditionalArtifacts(config).filter((a) => !present.includes(a));

  console.log(`ticket ${ticket} (${ticketDir(config, ticket)})`);
  console.log(`  required: ${requiredArtifacts(config).join(', ')}`);
  if (missing.length > 0) console.log(`  missing: ${missing.join(', ')}`);
  else console.log('  all required artifacts present');
  if (pending.length > 0) {
    console.log(`  decision pending: ${pending.join(', ')} - ask unless plan.md already records the answer`);
  }
  return missing.length === 0;
}

function status() {
  const config = resolveConfig();
  if (config === null) return 1;
  const ticket = rest[0];
  if (!ticket) {
    console.log('usage: delivery status <ticket>');
    return 1;
  }
  return artifactReport(config, ticket) ? 0 : 1;
}

function check() {
  const config = resolveConfig();
  if (config === null) return 1;
  const ticket = rest[0];
  if (!ticket) {
    console.log('usage: delivery check <ticket>');
    return 1;
  }
  let ok = artifactReport(config, ticket);

  const gates = Object.entries(config.gates);
  if (gates.length === 0) {
    console.log('\nno gates configured - nothing was run, and nothing may be claimed');
  }
  for (const [name, command] of gates) {
    console.log(`\n--- gate ${name}: ${command}`);
    try {
      execSync(command, { cwd, stdio: 'inherit' });
      console.log(`gate ${name} passed`);
    } catch (error) {
      console.log(`gate ${name} FAILED (exit ${error.status})`);
      ok = false;
    }
  }
  return ok ? 0 : 1;
}

const commands = { init, status, check };
let exitCode;
if (!commands[command]) {
  console.log('usage: delivery <init|status|check> [args]');
  exitCode = 1;
} else {
  exitCode = commands[command]();
}
// exitCode rather than process.exit(): an abrupt exit can drop unflushed stdout,
// and this command's output is its evidence. It also segfaults intermittently on
// some Node builds.
process.exitCode = exitCode;
