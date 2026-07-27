# Delivery Workflow Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `pulse-amazing-team/agent-workflow` as an installable Claude Code plugin that carries the delivery process, configured per repository through `.claude/delivery.json`, and migrate `pulse` onto it.

**Architecture:** Three layers - the plugin owns process only, `.claude/delivery.json` owns machine-readable per-repo facts, the repo's `AGENTS.md` owns prose specifics. The decision logic (config loading, repo detection, artifact status) lives in dependency-free ES modules under `lib/`, so it is unit-tested rather than left to prose an agent may or may not follow. The skill, commands and hook are thin consumers of those modules.

**Tech Stack:** Node 22+ ESM, `node:test` + `node:assert/strict` (no dependencies), JSON Schema draft-07, Claude Code plugin format.

## Global Constraints

- Layer 1 rule: **the plugin knows no fact about any specific project.** Every addition to `SKILL.md`, commands or `lib/` must be checkable against this. Stack, paths, commands and board names belong in layers 2 and 3.
- **An absent `gates` key means the gate does not exist.** Never default, infer or invent a gate command.
- **Defaults are strict.** Every unspecified key resolves to the stricter behaviour. Relaxing requires an explicit line in the committed config.
- Zero runtime dependencies. `package.json` has no `dependencies`; tests use `node --test` only.
- No em dash anywhere. Use a plain dash.
- Conventional Commits for every commit subject: `type(scope): summary`.
- Never add a co-author trailer.
- Repository layout deviates from the sketch in `docs/design.md`: the plugin lives at the **repo root** with `"source": "./"`, not under `plugins/delivery-workflow/`. A single-plugin marketplace does not need the nesting. Task 1 folds this back into the design doc.

---

### Task 1: Repo scaffolding and the config loader

**Files:**
- Create: `package.json`
- Create: `schema.json`
- Create: `lib/config.js`
- Create: `test/config.test.js`
- Create: `.gitignore`
- Modify: `docs/design.md` (fold back the root-layout deviation)

**Interfaces:**
- Consumes: nothing.
- Produces: `CONFIG_PATH: string`, `DEFAULTS: object`, `LANGUAGES: string[]`, `TRACKER_MODES: string[]`, `TESTS_MODES: (boolean|string)[]`, `applyDefaults(raw?: object): Config`, `validate(config: Config): string[]`, `loadConfig(repoRoot: string): { exists: boolean, path: string, config: Config, errors: string[] }`.
  `Config` is `{ language, docsDir, tracker: { mode }, stages: { intake, tests }, gates: Record<string,string>, git: { base, worktree, squash } }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@pulse-amazing-team/agent-workflow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Portable delivery workflow for coding agents",
  "license": "MIT",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 3: Write the failing test**

Create `test/config.test.js`:

```js
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDefaults, loadConfig, validate } from '../lib/config.js';

function repoWith(contents) {
  const root = mkdtempSync(join(tmpdir(), 'delivery-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/delivery.json'), contents);
  return root;
}

test('an empty config resolves to the strict defaults', () => {
  assert.deepEqual(applyDefaults({}), {
    language: 'none',
    docsDir: 'docs/features',
    tracker: { mode: 'link' },
    stages: { intake: true, tests: 'ask' },
    gates: {},
    git: { base: 'main', worktree: true, squash: true },
  });
});

test('a partial section override keeps its unmentioned siblings', () => {
  const config = applyDefaults({ git: { base: 'develop' } });
  assert.equal(config.git.base, 'develop');
  assert.equal(config.git.worktree, true);
  assert.equal(config.git.squash, true);
});

test('gates are never defaulted - an absent gate does not exist', () => {
  const config = applyDefaults({ gates: { test: 'pnpm test' } });
  assert.deepEqual(config.gates, { test: 'pnpm test' });
  assert.equal('e2e' in config.gates, false);
});

test('the $schema key is not carried into the resolved config', () => {
  const config = applyDefaults({ $schema: 'https://example.com/schema.json' });
  assert.equal('$schema' in config, false);
});

test('an unknown language is an error', () => {
  const errors = validate(applyDefaults({ language: 'rust' }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /language must be one of/);
});

test('stages.tests accepts true, false and "ask" and nothing else', () => {
  for (const value of [true, false, 'ask']) {
    assert.deepEqual(validate(applyDefaults({ stages: { tests: value } })), []);
  }
  const errors = validate(applyDefaults({ stages: { tests: 'yes' } }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /stages\.tests/);
});

test('an empty gate command is an error, because it would silently run nothing', () => {
  const errors = validate(applyDefaults({ gates: { lint: '   ' } }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /gates\.lint/);
});

test('a missing config file yields defaults and is reported as absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'delivery-'));
  const result = loadConfig(root);
  assert.equal(result.exists, false);
  assert.deepEqual(result.errors, []);
  assert.equal(result.config.stages.tests, 'ask');
});

test('malformed JSON is an error, not a silent fallback to defaults', () => {
  const result = loadConfig(repoWith('{ not json'));
  assert.equal(result.exists, true);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /not valid JSON/);
});

test('a real config file is loaded and merged over the defaults', () => {
  const root = repoWith(JSON.stringify({ language: 'ts', gates: { test: 'pnpm test' } }));
  const result = loadConfig(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.config.language, 'ts');
  assert.equal(result.config.docsDir, 'docs/features');
  assert.deepEqual(result.config.gates, { test: 'pnpm test' });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - `Cannot find module '../lib/config.js'`

- [ ] **Step 5: Write `lib/config.js`**

```js
// Loading and validating .claude/delivery.json.
//
// Two rules from the design drive everything here:
//   - an absent `gates` key means the gate does not exist, so gates are never
//     defaulted or inferred - inventing one is how an agent ends up reporting a
//     gate it never ran;
//   - every other unspecified key falls back to a STRICT default, so a repo that
//     forgets to configure something gets a stricter process, never a looser one.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_PATH = '.claude/delivery.json';

export const LANGUAGES = ['ts', 'py', 'go', 'none'];
export const TRACKER_MODES = ['link'];
export const TESTS_MODES = [true, false, 'ask'];

export const DEFAULTS = Object.freeze({
  language: 'none',
  docsDir: 'docs/features',
  tracker: { mode: 'link' },
  stages: { intake: true, tests: 'ask' },
  gates: {},
  git: { base: 'main', worktree: true, squash: true },
});

// Sections merged key-by-key, so overriding one key keeps its siblings.
const SECTIONS = ['tracker', 'stages', 'git'];

export function applyDefaults(raw = {}) {
  const config = {
    language: raw.language ?? DEFAULTS.language,
    docsDir: raw.docsDir ?? DEFAULTS.docsDir,
    gates: { ...(raw.gates ?? {}) },
  };
  for (const section of SECTIONS) {
    config[section] = { ...DEFAULTS[section], ...(raw[section] ?? {}) };
  }
  return config;
}

export function validate(config) {
  const errors = [];
  if (!LANGUAGES.includes(config.language)) {
    errors.push(`language must be one of ${LANGUAGES.join(', ')} (got ${JSON.stringify(config.language)})`);
  }
  if (typeof config.docsDir !== 'string' || config.docsDir.trim() === '') {
    errors.push('docsDir must be a non-empty string');
  }
  if (!TRACKER_MODES.includes(config.tracker.mode)) {
    errors.push(`tracker.mode must be one of ${TRACKER_MODES.join(', ')} (got ${JSON.stringify(config.tracker.mode)})`);
  }
  if (typeof config.stages.intake !== 'boolean') {
    errors.push('stages.intake must be a boolean');
  }
  if (!TESTS_MODES.includes(config.stages.tests)) {
    errors.push(`stages.tests must be true, false or "ask" (got ${JSON.stringify(config.stages.tests)})`);
  }
  for (const [gate, command] of Object.entries(config.gates)) {
    if (typeof command !== 'string' || command.trim() === '') {
      errors.push(`gates.${gate} must be a non-empty command string`);
    }
  }
  if (typeof config.git.base !== 'string' || config.git.base.trim() === '') {
    errors.push('git.base must be a non-empty string');
  }
  for (const key of ['worktree', 'squash']) {
    if (typeof config.git[key] !== 'boolean') errors.push(`git.${key} must be a boolean`);
  }
  return errors;
}

export function loadConfig(repoRoot) {
  const path = join(repoRoot, CONFIG_PATH);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { exists: false, path, config: applyDefaults({}), errors: [] };
    }
    return {
      exists: true,
      path,
      config: applyDefaults({}),
      errors: [`${CONFIG_PATH} is not valid JSON: ${error.message}`],
    };
  }
  const config = applyDefaults(raw);
  return { exists: true, path, config, errors: validate(config) };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 10 tests

- [ ] **Step 7: Create `schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/pulse-amazing-team/agent-workflow/main/schema.json",
  "title": "Delivery workflow configuration",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "language": {
      "enum": ["ts", "py", "go", "none"],
      "default": "none",
      "description": "Which hard-rule set applies. ts forbids any, non-null ! and as T casts."
    },
    "docsDir": {
      "type": "string",
      "minLength": 1,
      "default": "docs/features",
      "description": "Where per-ticket artifacts live."
    },
    "tracker": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "mode": {
          "enum": ["link"],
          "default": "link",
          "description": "link: read a pasted ticket URL, write nothing back."
        }
      }
    },
    "stages": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "intake": { "type": "boolean", "default": true },
        "tests": {
          "oneOf": [{ "type": "boolean" }, { "const": "ask" }],
          "default": "ask",
          "description": "ask: stop after implementation and ask the human whether to write tests."
        }
      }
    },
    "gates": {
      "type": "object",
      "additionalProperties": { "type": "string", "minLength": 1 },
      "description": "Shell command per gate. An absent key means the gate does not exist.",
      "properties": {
        "lint": { "type": "string", "minLength": 1 },
        "typecheck": { "type": "string", "minLength": 1 },
        "test": { "type": "string", "minLength": 1 },
        "e2e": { "type": "string", "minLength": 1 },
        "build": { "type": "string", "minLength": 1 }
      }
    },
    "git": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "base": { "type": "string", "minLength": 1, "default": "main" },
        "worktree": { "type": "boolean", "default": true },
        "squash": { "type": "boolean", "default": true }
      }
    }
  }
}
```

- [ ] **Step 8: Fold the layout deviation back into the design doc**

In `docs/design.md`, replace the `## Plugin contents` tree with:

```
pulse-amazing-team/agent-workflow          the plugin IS the repo root
├── .claude-plugin/
│   ├── marketplace.json                   source: "./"
│   └── plugin.json                        manifest + hook registration
├── skills/delivery-workflow/
│   ├── SKILL.md                           orchestrator: reads config, drives stages
│   └── templates/                         intake / scope / product / plan / test-cases
├── commands/
│   ├── delivery-init.md                   inspect repo -> propose delivery.json
│   └── delivery-check.md                  run self-check + gates, show real output
├── hooks/pre-pr-reminder.js               soft pre-PR reminder
├── lib/                                   config, detection and status logic (unit-tested)
├── bin/delivery.js                        CLI the commands and hook call
├── test/                                  node --test
├── schema.json                            JSON Schema for delivery.json
└── README.md                              install in three commands
```

Add one sentence under it: `A single-plugin marketplace does not need a plugins/ subdirectory, so the plugin is the repository root and marketplace.json points at "./".`

- [ ] **Step 9: Commit**

```bash
git add package.json .gitignore schema.json lib/config.js test/config.test.js docs/design.md
git commit -m "feat(config): load and validate .claude/delivery.json"
```

---

### Task 2: Repo detection for `/delivery-init`

**Files:**
- Create: `lib/detect.js`
- Create: `test/detect.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 (deliberately pure - takes data, touches no filesystem, so it is testable without fixtures).
- Produces: `detectPackageManager(files: string[]): string`, `detectLanguage(files: string[]): string`, `detectGates(scripts: object, packageManager: string): Record<string,string>`, `proposeConfig({ files, scripts, defaultBranch }): Config`, `undetectedGates(gates: object): string[]`, `GATE_SCRIPTS: Record<string,string[]>`.

- [ ] **Step 1: Write the failing test**

Create `test/detect.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectGates,
  detectLanguage,
  detectPackageManager,
  proposeConfig,
  undetectedGates,
} from '../lib/detect.js';

test('the lockfile picks the package manager', () => {
  assert.equal(detectPackageManager(['pnpm-lock.yaml']), 'pnpm');
  assert.equal(detectPackageManager(['yarn.lock']), 'yarn');
  assert.equal(detectPackageManager(['bun.lockb']), 'bun');
  assert.equal(detectPackageManager(['package-lock.json']), 'npm');
});

test('no lockfile falls back to npm', () => {
  assert.equal(detectPackageManager(['package.json']), 'npm');
});

test('pnpm wins when several lockfiles are present', () => {
  assert.equal(detectPackageManager(['package-lock.json', 'pnpm-lock.yaml']), 'pnpm');
});

test('the language comes from the marker file', () => {
  assert.equal(detectLanguage(['tsconfig.json']), 'ts');
  assert.equal(detectLanguage(['pyproject.toml']), 'py');
  assert.equal(detectLanguage(['setup.py']), 'py');
  assert.equal(detectLanguage(['go.mod']), 'go');
  assert.equal(detectLanguage(['package.json']), 'none');
});

test('a gate exists only when a script implements it', () => {
  const gates = detectGates({ lint: 'eslint .', test: 'vitest run' }, 'pnpm');
  assert.deepEqual(gates, { lint: 'pnpm run lint', test: 'pnpm run test' });
});

test('an empty script body does not create a gate', () => {
  assert.deepEqual(detectGates({ lint: '   ' }, 'pnpm'), {});
});

test('e2e is found under either of its conventional script names', () => {
  assert.deepEqual(detectGates({ e2e: 'playwright test' }, 'npm'), { e2e: 'npm run e2e' });
  assert.deepEqual(detectGates({ 'test:e2e': 'playwright test' }, 'npm'), { e2e: 'npm run test:e2e' });
});

test('undetectedGates names what was left out, so init can say so out loud', () => {
  assert.deepEqual(undetectedGates({ test: 'npm run test' }), ['lint', 'typecheck', 'e2e', 'build']);
});

test('proposeConfig assembles a complete, strict config', () => {
  const config = proposeConfig({
    files: ['pnpm-lock.yaml', 'tsconfig.json'],
    scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run' },
    defaultBranch: 'develop',
  });
  assert.deepEqual(config, {
    language: 'ts',
    docsDir: 'docs/features',
    tracker: { mode: 'link' },
    stages: { intake: true, tests: 'ask' },
    gates: { lint: 'pnpm run lint', typecheck: 'pnpm run typecheck', test: 'pnpm run test' },
    git: { base: 'develop', worktree: true, squash: true },
  });
});

test('a repo with nothing detectable still proposes a valid config with no gates', () => {
  const config = proposeConfig({});
  assert.equal(config.language, 'none');
  assert.deepEqual(config.gates, {});
  assert.equal(config.git.base, 'main');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - `Cannot find module '../lib/detect.js'`

- [ ] **Step 3: Write `lib/detect.js`**

```js
// Repo inspection behind /delivery-init.
//
// Every function here is pure and takes plain data, so the detection rules are
// testable without building fixture directories on disk. bin/delivery.js is the
// only place that reads the filesystem.
//
// The governing rule: NEVER invent a command. A gate with no script behind it is
// left out of the proposal and reported as undetected, because a config naming a
// command that does not exist is worse than a config that admits the gap.

// Ordered: the first lockfile present wins.
export const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

export const LANGUAGE_MARKERS = [
  ['tsconfig.json', 'ts'],
  ['pyproject.toml', 'py'],
  ['setup.py', 'py'],
  ['go.mod', 'go'],
];

// Gate name -> the package.json scripts that may implement it, best first.
export const GATE_SCRIPTS = {
  lint: ['lint'],
  typecheck: ['typecheck', 'tsc'],
  test: ['test'],
  e2e: ['e2e', 'test:e2e'],
  build: ['build'],
};

export function detectPackageManager(files = []) {
  for (const [lockfile, manager] of LOCKFILES) {
    if (files.includes(lockfile)) return manager;
  }
  return 'npm';
}

export function detectLanguage(files = []) {
  for (const [marker, language] of LANGUAGE_MARKERS) {
    if (files.includes(marker)) return language;
  }
  return 'none';
}

export function detectGates(scripts = {}, packageManager = 'npm') {
  const gates = {};
  for (const [gate, candidates] of Object.entries(GATE_SCRIPTS)) {
    const script = candidates.find(
      (name) => typeof scripts[name] === 'string' && scripts[name].trim() !== '',
    );
    if (script) gates[gate] = `${packageManager} run ${script}`;
  }
  return gates;
}

export function undetectedGates(gates = {}) {
  return Object.keys(GATE_SCRIPTS).filter((gate) => !(gate in gates));
}

export function proposeConfig({ files = [], scripts = {}, defaultBranch = 'main' } = {}) {
  return {
    language: detectLanguage(files),
    docsDir: 'docs/features',
    tracker: { mode: 'link' },
    stages: { intake: true, tests: 'ask' },
    gates: detectGates(scripts, detectPackageManager(files)),
    git: { base: defaultBranch, worktree: true, squash: true },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 20 tests total

- [ ] **Step 5: Commit**

```bash
git add lib/detect.js test/detect.test.js
git commit -m "feat(detect): propose a delivery config from repo signals"
```

---

### Task 3: Ticket artifact status

**Files:**
- Create: `lib/status.js`
- Create: `test/status.test.js`

**Interfaces:**
- Consumes: a `Config` as produced by `applyDefaults` in Task 1.
- Produces: `requiredArtifacts(config): string[]`, `conditionalArtifacts(config): string[]`, `missingArtifacts(config, presentFiles: string[]): string[]`, `inferTicket(changedPaths: string[], docsDir: string): string | null`, `ticketDir(config, ticket): string`.

- [ ] **Step 1: Write the failing test**

Create `test/status.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDefaults } from '../lib/config.js';
import {
  conditionalArtifacts,
  inferTicket,
  missingArtifacts,
  requiredArtifacts,
  ticketDir,
} from '../lib/status.js';

test('the default config requires four artifacts', () => {
  assert.deepEqual(requiredArtifacts(applyDefaults({})), [
    'intake.md',
    'scope.md',
    'product.md',
    'plan.md',
  ]);
});

test('turning intake off drops its artifact', () => {
  const config = applyDefaults({ stages: { intake: false } });
  assert.deepEqual(requiredArtifacts(config), ['scope.md', 'product.md', 'plan.md']);
});

test('tests: true makes test-cases.md required rather than conditional', () => {
  const config = applyDefaults({ stages: { tests: true } });
  assert.ok(requiredArtifacts(config).includes('test-cases.md'));
  assert.deepEqual(conditionalArtifacts(config), []);
});

test('tests: "ask" leaves test-cases.md conditional, so it is never reported missing', () => {
  const config = applyDefaults({});
  assert.equal(requiredArtifacts(config).includes('test-cases.md'), false);
  assert.deepEqual(conditionalArtifacts(config), ['test-cases.md']);
});

test('tests: false makes test-cases.md neither required nor conditional', () => {
  const config = applyDefaults({ stages: { tests: false } });
  assert.equal(requiredArtifacts(config).includes('test-cases.md'), false);
  assert.deepEqual(conditionalArtifacts(config), []);
});

test('missingArtifacts compares by basename, so full paths are accepted', () => {
  const config = applyDefaults({});
  const present = ['docs/features/m5/intake.md', 'docs/features/m5/scope.md'];
  assert.deepEqual(missingArtifacts(config, present), ['product.md', 'plan.md']);
});

test('nothing is missing once every required artifact exists', () => {
  const config = applyDefaults({ stages: { intake: false } });
  const present = ['scope.md', 'product.md', 'plan.md'];
  assert.deepEqual(missingArtifacts(config, present), []);
});

test('exactly one touched ticket directory identifies the ticket', () => {
  const paths = ['docs/features/m5/plan.md', 'src/thing.ts', 'docs/features/m5/scope.md'];
  assert.equal(inferTicket(paths, 'docs/features'), 'm5');
});

test('two touched ticket directories are not an answer', () => {
  const paths = ['docs/features/m5/plan.md', 'docs/features/m6/plan.md'];
  assert.equal(inferTicket(paths, 'docs/features'), null);
});

test('no touched ticket directory is not an answer', () => {
  assert.equal(inferTicket(['src/thing.ts'], 'docs/features'), null);
});

test('a trailing slash on docsDir does not change the answer', () => {
  assert.equal(inferTicket(['docs/features/m5/plan.md'], 'docs/features/'), 'm5');
});

test('a file directly inside docsDir is not a ticket', () => {
  assert.equal(inferTicket(['docs/features/README.md'], 'docs/features'), null);
});

test('ticketDir joins the configured docsDir with the ticket key', () => {
  assert.equal(ticketDir(applyDefaults({}), 'm5'), 'docs/features/m5');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - `Cannot find module '../lib/status.js'`

- [ ] **Step 3: Write `lib/status.js`**

```js
// What a ticket owes, given the repo's config.
//
// Pure on purpose: the hook and the CLI both need this answer, and neither
// should be the place where the rule lives.

// A path segment that names a ticket directory rather than a file.
const isTicketSegment = (segment, rest) => segment !== '' && rest.includes('/');

export function requiredArtifacts(config) {
  const artifacts = [];
  if (config.stages.intake) artifacts.push('intake.md');
  artifacts.push('scope.md', 'product.md', 'plan.md');
  // Only an unconditional yes makes the test artifact mandatory.
  if (config.stages.tests === true) artifacts.push('test-cases.md');
  return artifacts;
}

// Artifacts whose necessity is decided later by the human. Reported separately
// so "we agreed not to write tests" never reads as a missing artifact.
export function conditionalArtifacts(config) {
  return config.stages.tests === 'ask' ? ['test-cases.md'] : [];
}

export function missingArtifacts(config, presentFiles = []) {
  const present = new Set(presentFiles.map((file) => file.split('/').pop()));
  return requiredArtifacts(config).filter((artifact) => !present.has(artifact));
}

export function ticketDir(config, ticket) {
  const base = config.docsDir.replace(/\/+$/, '');
  return `${base}/${ticket}`;
}

// Which ticket this branch is about, inferred from the paths it touched under
// docsDir. Exactly one match is an answer; zero or several is not, and the
// caller falls back to a generic reminder rather than guessing wrong.
export function inferTicket(changedPaths = [], docsDir = 'docs/features') {
  const prefix = `${docsDir.replace(/\/+$/, '')}/`;
  const tickets = new Set();
  for (const path of changedPaths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const segment = rest.split('/')[0];
    if (isTicketSegment(segment, rest)) tickets.add(segment);
  }
  return tickets.size === 1 ? [...tickets][0] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 33 tests total

- [ ] **Step 5: Commit**

```bash
git add lib/status.js test/status.test.js
git commit -m "feat(status): derive required artifacts and infer the ticket"
```

---

### Task 4: The CLI

**Files:**
- Create: `bin/delivery.js`
- Create: `test/cli.test.js`
- Modify: `package.json` (add the `bin` field)

**Interfaces:**
- Consumes: `loadConfig`, `CONFIG_PATH` (Task 1); `proposeConfig`, `undetectedGates` (Task 2); `missingArtifacts`, `conditionalArtifacts`, `requiredArtifacts`, `inferTicket`, `ticketDir` (Task 3).
- Produces: an executable with three subcommands - `node bin/delivery.js init [--write]`, `node bin/delivery.js status [ticket]`, `node bin/delivery.js check [ticket]`. Exit code 0 when everything the config demands is satisfied, 1 otherwise.

- [ ] **Step 1: Write the failing test**

Create `test/cli.test.js`:

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../bin/delivery.js');

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function scratchRepo({ pkg, config, artifacts = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'delivery-cli-'));
  if (pkg) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  if (config) {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/delivery.json'), JSON.stringify(config));
  }
  for (const artifact of artifacts) {
    const full = join(root, artifact);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '# stub\n');
  }
  return root;
}

test('init proposes a config from what it can actually see', () => {
  const root = scratchRepo({
    pkg: { scripts: { lint: 'eslint .', test: 'vitest run' } },
  });
  const { code, stdout } = run(['init'], root);
  assert.equal(code, 0);
  const proposed = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1));
  assert.deepEqual(proposed.gates, { lint: 'npm run lint', test: 'npm run test' });
  assert.equal(proposed.stages.tests, 'ask');
});

test('init names the gates it could not detect instead of inventing them', () => {
  const root = scratchRepo({ pkg: { scripts: { test: 'vitest run' } } });
  const { stdout } = run(['init'], root);
  assert.match(stdout, /not detected: lint, typecheck, e2e, build/);
});

test('init --write creates the config file', () => {
  const root = scratchRepo({ pkg: { scripts: { test: 'vitest run' } } });
  const { code } = run(['init', '--write'], root);
  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(join(root, '.claude/delivery.json'), 'utf8'));
  assert.equal(written.$schema, 'https://raw.githubusercontent.com/pulse-amazing-team/agent-workflow/main/schema.json');
  assert.deepEqual(written.gates, { test: 'npm run test' });
});

test('init --write refuses to clobber an existing config', () => {
  const root = scratchRepo({ pkg: {}, config: { language: 'ts' } });
  const { code, stdout } = run(['init', '--write'], root);
  assert.equal(code, 1);
  assert.match(stdout, /already exists/);
});

test('status lists the artifacts a ticket still owes', () => {
  const root = scratchRepo({
    config: { gates: { test: 'npm test' } },
    artifacts: ['docs/features/m5/intake.md', 'docs/features/m5/scope.md'],
  });
  const { code, stdout } = run(['status', 'm5'], root);
  assert.equal(code, 1);
  assert.match(stdout, /missing: product\.md, plan\.md/);
});

test('status reports a complete ticket as satisfied', () => {
  const root = scratchRepo({
    config: {},
    artifacts: [
      'docs/features/m5/intake.md',
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const { code, stdout } = run(['status', 'm5'], root);
  assert.equal(code, 0);
  assert.match(stdout, /all required artifacts present/);
});

test('status flags test-cases.md as an open decision under tests: "ask"', () => {
  const root = scratchRepo({
    config: {},
    artifacts: [
      'docs/features/m5/intake.md',
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const { stdout } = run(['status', 'm5'], root);
  assert.match(stdout, /decision pending: test-cases\.md/);
});

test('an invalid config fails loudly rather than falling back to defaults', () => {
  const root = scratchRepo({ config: { language: 'rust' } });
  const { code, stdout } = run(['status', 'm5'], root);
  assert.equal(code, 1);
  assert.match(stdout, /language must be one of/);
});

test('check runs the configured gates and reports the failure', () => {
  const root = scratchRepo({
    config: { stages: { intake: false }, gates: { lint: 'sh -c "exit 3"' } },
    artifacts: [
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const { code, stdout } = run(['check', 'm5'], root);
  assert.equal(code, 1);
  assert.match(stdout, /gate lint FAILED/);
});

test('check passes when every gate exits zero and every artifact exists', () => {
  const root = scratchRepo({
    config: { stages: { intake: false }, gates: { lint: 'sh -c "exit 0"' } },
    artifacts: [
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const { code, stdout } = run(['check', 'm5'], root);
  assert.equal(code, 0);
  assert.match(stdout, /gate lint passed/);
});

test('check with no gates configured says so instead of claiming success', () => {
  const root = scratchRepo({
    config: { stages: { intake: false } },
    artifacts: [
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const { stdout } = run(['check', 'm5'], root);
  assert.match(stdout, /no gates configured/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - the CLI file does not exist

- [ ] **Step 3: Write `bin/delivery.js`**

```js
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
    console.log(`  decision pending: ${pending.join(', ')} - ask whether tests are in scope`);
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
if (!commands[command]) {
  console.log('usage: delivery <init|status|check> [args]');
  process.exit(1);
}
process.exit(commands[command]());
```

- [ ] **Step 4: Make it executable and register it**

```bash
chmod +x bin/delivery.js
```

Add to `package.json` after `"scripts"`:

```json
  "bin": { "delivery": "./bin/delivery.js" },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 44 tests total

- [ ] **Step 6: Commit**

```bash
git add bin/delivery.js test/cli.test.js package.json
git commit -m "feat(cli): add init, status and check subcommands"
```

---

### Task 5: Plugin manifests and README

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugin.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: an installable plugin. `${CLAUDE_PLUGIN_ROOT}` resolves to the repo root at runtime, so commands and hooks reference `${CLAUDE_PLUGIN_ROOT}/bin/delivery.js`.

- [ ] **Step 1: Create `.claude-plugin/marketplace.json`**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "agent-workflow",
  "description": "Portable delivery workflow for coding agents: staged artifacts, gates and a pre-PR self-check, configured per repository.",
  "owner": {
    "name": "pulse-amazing-team",
    "url": "https://github.com/pulse-amazing-team"
  },
  "plugins": [
    {
      "name": "delivery-workflow",
      "description": "Ship every ticket through the same staged process, with per-repo configuration.",
      "source": "./",
      "category": "workflow"
    }
  ]
}
```

- [ ] **Step 2: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "delivery-workflow",
  "version": "0.1.0",
  "description": "Ship every ticket through the same staged process: intake, scope, product, plan, implementation, an explicit tests decision, then gates and a pre-PR self-check. Configured per repository through .claude/delivery.json.",
  "author": { "name": "pulse-amazing-team", "url": "https://github.com/pulse-amazing-team" },
  "homepage": "https://github.com/pulse-amazing-team/agent-workflow",
  "repository": "https://github.com/pulse-amazing-team/agent-workflow",
  "license": "MIT",
  "keywords": ["workflow", "delivery", "process", "gates"],
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-pr-reminder.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Replace `README.md`**

````markdown
# agent-workflow

A portable delivery workflow for coding agents, distributed as a Claude Code plugin.

Every ticket ships through the same stages - intake, scope, product, plan, implementation, an explicit decision about tests, then verification gates and a pre-PR self-check. Each stage leaves a real artifact, so a second person can pick a ticket up from its docs alone.

The process lives here once. Everything project-specific lives in the project.

## Install

```
/plugin marketplace add pulse-amazing-team/agent-workflow
/plugin install delivery-workflow
```

Then once per repository:

```
/delivery-init
```

It inspects the repo - package manager, scripts, language, default branch - and proposes a `.claude/delivery.json`. It never invents a command it could not find; gates it cannot detect are listed so you can add them by hand.

## Configuration

`.claude/delivery.json`, committed to the repo:

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
  "git": { "base": "main", "worktree": true, "squash": true }
}
```

Three rules govern how it is read:

**An absent `gates` key means the gate does not exist.** It does not mean "guess the command". This removes the most common failure mode: an agent reporting that it ran gates when it ran nothing.

**Defaults are strict.** Anything unspecified is on and mandatory. Relaxing a rule takes an explicit line in a file that lives in git and shows up in review. Forgetting to configure something gives you a stricter process, never a looser one.

**`language` selects the hard-rule set.** `ts` forbids `any`, non-null `!` and `as T` casts. Language-independent rules - Conventional Commits, never hand-editing generated files - always apply.

See [schema.json](schema.json) for every key, or [docs/design.md](docs/design.md) for why it is shaped this way.

## The tests decision

`stages.tests` is `"ask"` by default. After implementation the agent stops and asks whether tests are in scope. On yes it runs a short question session - what is worth covering, where the unit/e2e boundary sits, which cases are genuinely risky - and the answers become `test-cases.md`.

The question is asked once per ticket and the answer is recorded in `plan.md`, so a multi-session ticket does not re-litigate it.

Set it to `true` to always write tests, `false` to drop the test stages entirely - in which case the test items also drop out of the self-check, so there is nothing to misreport.

## Commands

- `/delivery-init` - inspect the repo and propose a config
- `/delivery-check <ticket>` - verify artifacts and actually run the gates, printing real output

## Development

```
npm test
```

No dependencies. Tests are `node --test`.
````

- [ ] **Step 4: Verify the manifests parse**

Run: `node -e "for (const f of ['.claude-plugin/marketplace.json','.claude-plugin/plugin.json','schema.json','package.json']) { JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, 'ok'); }"`
Expected: four `ok` lines

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json .claude-plugin/plugin.json README.md
git commit -m "feat(plugin): add marketplace and plugin manifests"
```

---

### Task 6: The skill and its templates

**Files:**
- Create: `skills/delivery-workflow/SKILL.md`
- Create: `skills/delivery-workflow/templates/intake.md`
- Create: `skills/delivery-workflow/templates/scope.md`
- Create: `skills/delivery-workflow/templates/product.md`
- Create: `skills/delivery-workflow/templates/plan.md`
- Create: `skills/delivery-workflow/templates/test-cases.md`

**Interfaces:**
- Consumes: `bin/delivery.js` (Task 4) via `${CLAUDE_PLUGIN_ROOT}`.
- Produces: a skill named `delivery-workflow` that Claude Code auto-surfaces.

- [ ] **Step 1: Write `skills/delivery-workflow/SKILL.md`**

````markdown
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

The key, lowercased, names the artifact directory: `<docsDir>/<ticket>/`.

## Stages

Work them in order. Create a todo per stage.

**0. Intake** (`intake.md`) - skip if `stages.intake` is false.
Capture the raw ask and your assumptions, then groom: ask the human your clarifying questions in ONE batch - scope, flow, edge cases, acceptance, data - and WAIT for answers. Record the questions, the answers, and the decisions. Note a default only where a question went unanswered. If nothing is genuinely unclear, say so; do not invent busywork questions.

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

It verifies the artifacts and actually runs the configured gates. Paste its output. If a gate fails, quote the failure - never claim green blind.

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
````

- [ ] **Step 2: Write `templates/intake.md`**

```markdown
# <TICKET> · Intake

## Raw ask

<paste the ticket link and its text verbatim>

## Assumptions

- <what you are assuming that the ask does not state>

## Grooming questions

Asked in one batch on <date>.

| # | Question | Answer |
|---|----------|--------|
| 1 |          |        |

## Decisions

- <decision, and the reasoning behind it>

## Unanswered

- <question> - proceeding on the default: <default, and why it is safe>

## Risky unknowns

- <what could invalidate the plan if it turns out otherwise>
```

- [ ] **Step 3: Write `templates/scope.md`**

```markdown
# <TICKET> · Scope

<one sentence: what this delivers>

## In

- <surface or behaviour that is part of this ticket>

## Out (non-goals)

- <thing a reader would reasonably expect, and why it is not here>

## Affected surfaces

- <path or subsystem> - <what changes there>

## Dependencies

- <ticket, branch or external thing this needs first, or "none">
```

- [ ] **Step 4: Write `templates/product.md`**

```markdown
# <TICKET> · Product

## Intent

<what problem this solves, for whom, and why it is worth doing>

## User stories

- As a <role>, I can <action>, so that <outcome>.

## Acceptance criteria

- [ ] <observable, checkable statement - not "works correctly">

## Deliberately not doing

- <thing that was considered and rejected, with the reason>
```

- [ ] **Step 5: Write `templates/plan.md`**

```markdown
# <TICKET> · Implementation plan

## Ticket reconciliation

<what the ticket says that is no longer true of the code, and how you resolved it. Omit the section if the ticket is accurate.>

## Approach

<the shape of the change, in a few sentences>

## Data model

<schema or state changes, and the migration. "None" is a valid answer.>

## Files

| File | Change |
|------|--------|
|      |        |

## Tests decision

<Recorded once, when the question is asked. Written so a later session does not re-open it.>

- Decision: <write tests / no tests>
- Reasoning: <why>
- If yes, what is worth covering: <the risky parts, and where the unit/e2e boundary sits>

## Risks

| Risk | Mitigation |
|------|-----------|
|      |            |
```

- [ ] **Step 6: Write `templates/test-cases.md`**

```markdown
# <TICKET> · Test cases

Each case names the test that proves it.

## Unit

| # | Case | Kind | Test |
|---|------|------|------|
| U1 |     | happy / edge / failure | |

## Integration / e2e

| # | Case | Kind | Test |
|---|------|------|------|
| I1 |     | happy / failure | |

## Manual QA

Required for any UI, external-provider or device flow.

- **Preconditions:** <what must be true first>
- **Steps:** <numbered, with the expected result at each step>
```

- [ ] **Step 7: Verify the skill frontmatter parses**

Run: `head -4 skills/delivery-workflow/SKILL.md`
Expected: a `---` fenced block containing `name: delivery-workflow` and a `description:` line

- [ ] **Step 8: Commit**

```bash
git add skills/
git commit -m "feat(skill): add the delivery-workflow skill and artifact templates"
```

---

### Task 7: Slash commands

**Files:**
- Create: `commands/delivery-init.md`
- Create: `commands/delivery-check.md`

**Interfaces:**
- Consumes: `bin/delivery.js` (Task 4).
- Produces: `/delivery-init` and `/delivery-check`.

- [ ] **Step 1: Write `commands/delivery-init.md`**

````markdown
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
````

- [ ] **Step 2: Write `commands/delivery-check.md`**

````markdown
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
````

- [ ] **Step 3: Verify both command files have frontmatter**

Run: `for f in commands/*.md; do echo "--- $f"; head -4 "$f"; done`
Expected: each file opens with `---`, a `description:` line, an `allowed-tools:` line, and a closing `---`

- [ ] **Step 4: Commit**

```bash
git add commands/
git commit -m "feat(commands): add /delivery-init and /delivery-check"
```

---

### Task 8: The pre-PR reminder hook

**Files:**
- Create: `hooks/pre-pr-reminder.js`
- Create: `test/hook.test.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 1); `inferTicket`, `missingArtifacts`, `conditionalArtifacts`, `ticketDir` (Task 3).
- Produces: a PreToolUse hook. Reads the tool call as JSON on stdin, exits 0 always, and writes `{ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }` to stdout only when the command is a PR creation and something is missing.

- [ ] **Step 1: Write the failing test**

Create `test/hook.test.js`:

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '../hooks/pre-pr-reminder.js');

function runHook(payload, cwd) {
  const stdout = execFileSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return stdout.trim() === '' ? null : JSON.parse(stdout);
}

function repo({ config = {}, artifacts = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'delivery-hook-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/delivery.json'), JSON.stringify(config));
  for (const artifact of artifacts) {
    const full = join(root, artifact);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '# stub\n');
  }
  return root;
}

const prCall = { tool_name: 'Bash', tool_input: { command: 'gh pr create --fill' } };

test('a command that is not a PR creation is ignored entirely', () => {
  const root = repo();
  const output = runHook({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }, root);
  assert.equal(output, null);
});

test('a non-Bash tool is ignored entirely', () => {
  const root = repo();
  const output = runHook({ tool_name: 'Read', tool_input: { file_path: 'x' } }, root);
  assert.equal(output, null);
});

test('a PR with artifacts missing gets a reminder naming them', () => {
  const root = repo({ artifacts: ['docs/features/m5/intake.md'] });
  const output = runHook(prCall, root);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(output.hookSpecificOutput.additionalContext, /scope\.md/);
  assert.match(output.hookSpecificOutput.additionalContext, /m5/);
});

test('the reminder never blocks', () => {
  const root = repo({ artifacts: ['docs/features/m5/intake.md'] });
  const output = runHook(prCall, root);
  assert.equal('permissionDecision' in (output.hookSpecificOutput ?? {}), false);
  assert.equal('decision' in output, false);
});

test('a complete ticket produces no reminder at all', () => {
  const root = repo({
    config: { stages: { intake: false, tests: false } },
    artifacts: [
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const output = runHook(prCall, root);
  assert.equal(output, null);
});

test('an ambiguous ticket falls back to a generic reminder rather than guessing', () => {
  const root = repo({
    artifacts: ['docs/features/m5/scope.md', 'docs/features/m6/scope.md'],
  });
  const output = runHook(prCall, root);
  assert.match(output.hookSpecificOutput.additionalContext, /could not tell which ticket/);
});

test('a repo with no config produces no reminder', () => {
  const root = mkdtempSync(join(tmpdir(), 'delivery-hook-'));
  const output = runHook(prCall, root);
  assert.equal(output, null);
});

test('malformed stdin does not crash the hook', () => {
  const root = repo();
  const stdout = execFileSync(process.execPath, [HOOK], {
    cwd: root,
    input: 'not json',
    encoding: 'utf8',
  });
  assert.equal(stdout.trim(), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - the hook file does not exist

- [ ] **Step 3: Write `hooks/pre-pr-reminder.js`**

```js
#!/usr/bin/env node
// A soft reminder before a PR is opened.
//
// It NEVER blocks. A blocking gate breaks legitimate hotfixes and is the first
// thing a new user disables, so this only injects what is missing and lets the
// agent decide. Silence is the normal case: no config, no PR command, or a
// complete ticket all produce no output at all.

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
    const { execSync } = require('node:child_process');
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
  if (notes.length === 0) return;

  emit(
    `Delivery workflow reminder for ${ticket}: ${notes.join('; ')}. ` +
      `Run /delivery-check ${ticket} for the full picture. This is a reminder, not a block.`,
  );
}

main();
```

- [ ] **Step 4: Fix the CommonJS require in an ESM file**

The `require('node:child_process')` inside `changedPaths` will throw in an ES module. Replace the import at the top of the file:

```js
import { execSync } from 'node:child_process';
```

and the body of `changedPaths` becomes:

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 52 tests total

- [ ] **Step 6: Commit**

```bash
git add hooks/pre-pr-reminder.js test/hook.test.js
git commit -m "feat(hook): remind about missing artifacts before a PR"
```

---

### Task 9: Install and verify end to end

**Files:**
- Modify: none (verification task)
- Create: `docs/verification-2026-07-27.md` (the recorded evidence)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: proof the plugin installs and its pieces work from an installed copy rather than from the source tree.

- [ ] **Step 1: Push the branch and confirm the tree is complete**

```bash
npm test
git push -u origin HEAD
```

Expected: all tests pass, branch pushed.

- [ ] **Step 2: Install the plugin from the real marketplace**

In a Claude Code session:

```
/plugin marketplace add pulse-amazing-team/agent-workflow
/plugin install delivery-workflow
```

Expected: the plugin installs and `delivery-workflow` appears in the skills list.

- [ ] **Step 3: Verify `/delivery-init` against a scratch repo**

```bash
mkdir -p /tmp/delivery-scratch && cd /tmp/delivery-scratch && git init -q
printf '{"scripts":{"lint":"eslint .","test":"vitest run"}}' > package.json
```

Then run `/delivery-init` in that directory.

Expected: it proposes `gates.lint` and `gates.test` derived from those scripts, and reports `typecheck, e2e, build` as not detected.

- [ ] **Step 4: Verify `/delivery-check` reports an incomplete ticket**

```bash
cd /tmp/delivery-scratch && mkdir -p docs/features/x1 && echo '# stub' > docs/features/x1/intake.md
```

Then run `/delivery-check x1`.

Expected: it names `scope.md, product.md, plan.md` as missing and exits non-zero.

- [ ] **Step 5: Verify the hook fires and does not block**

In `/tmp/delivery-scratch`, ask the agent to run `gh pr create --fill`.

Expected: the missing-artifact reminder appears in context, AND the command is still attempted (it will fail for its own reasons - no remote - which is fine; what matters is that the hook did not prevent it).

- [ ] **Step 6: Record the evidence**

Create `docs/verification-2026-07-27.md` containing, for each of steps 2 to 5, the command run and the actual output pasted verbatim. If any step failed, record the failure and the fix rather than a clean retelling.

- [ ] **Step 7: Commit**

```bash
git add docs/verification-2026-07-27.md
git commit -m "docs: record end-to-end plugin verification"
```

---

### Task 10: Migrate pulse onto the plugin

**Files:**
- Create: `<pulse>/.claude/delivery.json`
- Modify: `<pulse>/AGENTS.md` (remove the sections that moved)
- Modify: `<pulse>/CLAUDE.md` (drop the skills-symlink paragraph)
- Delete: `<pulse>/.agents/skills/delivery-workflow/SKILL.md`
- Delete: `<pulse>/docs/delivery-workflow.md`
- Delete: `<pulse>/docs/features/README.md`
- Delete: `<pulse>/.claude/.DS_Store`

**Interfaces:**
- Consumes: the installed plugin from Task 9.
- Produces: `pulse` running the shared process, with only project-specific prose left in its own files.

- [ ] **Step 1: Create a worktree for the migration**

```bash
cd ~/Desktop/work/pulse
git fetch upstream --prune
git worktree add ~/Desktop/work/pulse-workflow-migration -b chore/adopt-delivery-plugin upstream/main
cd ~/Desktop/work/pulse-workflow-migration
```

- [ ] **Step 2: Write `.claude/delivery.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/pulse-amazing-team/agent-workflow/main/schema.json",
  "language": "ts",
  "docsDir": "docs/features",
  "tracker": { "mode": "link" },
  "stages": { "intake": true, "tests": "ask" },
  "gates": {
    "lint": "pnpm turbo run lint",
    "typecheck": "pnpm turbo run typecheck",
    "test": "pnpm turbo run test",
    "e2e": "pnpm turbo run e2e",
    "build": "pnpm turbo run build"
  },
  "git": { "base": "main", "worktree": true, "squash": true }
}
```

- [ ] **Step 3: Verify those gate commands are real before trusting them**

```bash
grep -n '"lint"\|"typecheck"\|"test"\|"e2e"\|"build"' turbo.json
```

Expected: each named task exists in `turbo.json`. If one does not, remove that key from the config rather than leaving a command that cannot run. An absent gate is honest; a broken one is not.

- [ ] **Step 4: Cut the moved sections out of `AGENTS.md`**

Delete these sections entirely:

- `## Delivery workflow (mandatory - every ticket)` through the end of its stage list
- `### Before you call it done (self-check)`
- `### Card intake rules (every new card)`

Replace the first with:

```markdown
## Delivery workflow

Every ticket ships through the staged process in the `delivery-workflow` plugin - intake, scope, product, plan, implementation, an explicit tests decision, then gates and a pre-PR self-check.
The process itself lives in that plugin, not here. This repo's configuration is `.claude/delivery.json`.

Install it once: `/plugin marketplace add pulse-amazing-team/agent-workflow` then `/plugin install delivery-workflow`.

What stays repo-specific and lives below: the stack, the layout, the API contract conventions, the web conventions, the gotchas, and the Trello board rules.
```

Keep everything else in `AGENTS.md` untouched - stack, layout, setup, demo logins, verification gates, hard rules, board priority, API contract conventions, web conventions, gotchas, where things live.

- [ ] **Step 5: Keep the Trello rules, which the plugin does not carry**

The `## Working from the board` section stays, including the board name, the priority lanes and the MR-column rule. The plugin's tracker mode is `link` and it writes nothing back, so `pulse`'s Trello automation is repo-local by design. Add one line at the top of that section:

```markdown
The plugin's tracker mode is `link` - it reads a pasted ticket and writes nothing back. Everything in this section is Pulse-specific board handling on top of that.
```

- [ ] **Step 6: Drop the stale symlink paragraph from `CLAUDE.md`**

Remove these two lines:

```
Repo skills are canonical in `.agents/skills/`.
`.claude/skills/` symlinks to them so Claude Code auto-surfaces them; when adding a new skill, put it in `.agents/skills/` and add a matching symlink under `.claude/skills/`.
```

Replace with:

```
The delivery process comes from the `delivery-workflow` plugin, configured by `.claude/delivery.json`.
```

- [ ] **Step 7: Delete what moved**

```bash
git rm .agents/skills/delivery-workflow/SKILL.md
git rm docs/delivery-workflow.md
git rm docs/features/README.md
git rm --cached .claude/.DS_Store 2>/dev/null || true
rm -f .claude/.DS_Store
```

- [ ] **Step 8: Find and fix every reference to the deleted files**

```bash
grep -rn 'docs/delivery-workflow.md\|docs/features/README.md\|.agents/skills/delivery-workflow' --include='*.md' --include='*.json' . | grep -v node_modules
```

Expected after fixing: no hits outside `docs/features/<ticket>/` artifacts of already-merged tickets, which are historical records and stay as they are.

- [ ] **Step 9: Verify the plugin actually drives this repo**

```bash
node "$HOME/.claude/plugins/cache/agent-workflow/delivery-workflow"/*/bin/delivery.js status 264
```

Expected: it reads `pulse`'s config and reports on `docs/features/264/`. If the cache path differs, find it with `ls ~/.claude/plugins/cache`.

- [ ] **Step 10: Run the repo's own gates**

```bash
pnpm turbo run typecheck lint --filter=@pulse/backoffice
```

Expected: pass. This change is documentation and config only, so a failure here means something unrelated is broken - say so rather than fixing it silently in this PR.

- [ ] **Step 11: Commit and open the PR**

```bash
git add .claude/delivery.json AGENTS.md CLAUDE.md
git commit -m "chore: adopt the shared delivery-workflow plugin

The staged delivery process, the pre-PR self-check and the ticket intake rules
now come from pulse-amazing-team/agent-workflow, installed as a Claude Code
plugin, and this repo configures them through .claude/delivery.json.

What stays here is what is actually specific to Pulse: the stack, the layout,
the API contract conventions, the gotchas and the Trello board handling. The
plugin's tracker mode is link, so it reads a pasted ticket and writes nothing
back - the board automation is repo-local by design.

Also drops the CLAUDE.md paragraph describing .claude/skills symlinks into
.agents/skills. Those symlinks were already gone, so the repo-local skill had
silently stopped loading; the plugin replaces it."

gh pr create --repo pulse-amazing-team/pulse --head chore/adopt-delivery-plugin \
  --title "chore: adopt the shared delivery-workflow plugin" \
  --body "See the commit message. Docs and config only - no runtime change."
```

- [ ] **Step 12: Remove the worktree**

```bash
cd ~/Desktop/work/pulse
git worktree remove ~/Desktop/work/pulse-workflow-migration
git worktree prune
```

---

## Self-review

**Spec coverage.** Every section of `docs/design.md` maps to a task: three layers (Tasks 1, 6, 10), distribution (Task 5), `/delivery-init` (Tasks 2, 4, 7), config and its three rules (Task 1, enforced in `applyDefaults` and `validate`), the key table (schema.json, Task 1 step 7), the stage model and the tests gate (Task 6), plugin contents (Tasks 5-8), soft enforcement (Task 8), pulse migration (Task 10), and the `.claude/skills` fix (Task 10 steps 6-7).

**Deviation recorded.** The plugin sits at the repo root rather than under `plugins/delivery-workflow/`; Task 1 step 8 folds this back into the design doc, as the process itself requires.

**Out of scope, as the spec says.** No tracker adapters beyond `link`, no Codex support, no blocking enforcement, no npm publish. None of these have tasks, which is correct.

**Known rough edge.** Task 8 step 3 writes a `require()` call inside an ES module and step 4 immediately fixes it. That is deliberate: the mistake is easy to make when moving code between module systems, and the test written in step 1 catches it. If the implementer writes the import correctly the first time, step 4 is a no-op and the tests still pass.
