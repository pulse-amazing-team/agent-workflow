# Interactive `/delivery-init` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/delivery-init` into an opt-in wizard and add a `style` section to `.claude/delivery.json` so agent-behaviour preferences (code comments, commit granularity, checkpoint depth) are configured rather than assumed.

**Architecture:** The CLI stays non-interactive: the agent asks the questions and passes the answers as repeatable `--set key=value` / `--unset key` flags to `init`, which remains the only writer of the config file. Two new pure functions in `lib/config.js` parse and apply those overrides, reusing the existing `validate()` so enum rules live in one place. `bin/delivery.js` keeps all filesystem access.

**Tech Stack:** Node >= 22, ESM, zero dependencies, `node --test` (auto-discovers `test/*.test.js`), `node:assert/strict`.

**Spec:** [docs/specs/2026-07-27-interactive-delivery-init.md](../specs/2026-07-27-interactive-delivery-init.md)

## Global Constraints

- No dependencies. Nothing may be added to `package.json`.
- ESM only, Node >= 22 built-ins only.
- `lib/` stays pure: no `node:fs`, no `node:child_process`. All filesystem access lives in `bin/delivery.js`.
- Never invent a gate command. An absent `gates` key means the gate does not exist.
- Conventional Commits for every commit: `type(scope): summary`.
- No em dash anywhere in code, comments, docs or commit messages. Use a plain dash.
- Comments explain why, not what, matching the existing style in `lib/`.
- Work on branch `feat/interactive-delivery-init`, which already exists and holds the spec commit.
- Run the full suite with `npm test` before each commit. It must be green.

---

### Task 1: The `style` section in the config model

**Files:**
- Modify: `lib/config.js` (DEFAULTS, KNOWN_KEYS, SECTIONS, unknownKeys, validate)
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `STYLE_VALUES` - a frozen object mapping `comments`, `commits`, `checkpoints` to their allowed value arrays. `DEFAULTS.style` - `{ comments: 'why-only', commits: 'per-stage', checkpoints: 'plan' }`. `applyDefaults(raw)` now returns a `style` section merged key by key. `validate(config)` now reports out-of-enum style values.

- [ ] **Step 1: Write the failing tests**

Add to `test/config.test.js`. Note that the first existing test, `an empty config resolves to the strict defaults`, uses `deepEqual` and will fail until you add the `style` key to its expectation - that edit is part of this step.

```js
test('an empty config resolves to the strict defaults', () => {
  assert.deepEqual(applyDefaults({}), {
    language: 'none',
    docsDir: 'docs/features',
    tracker: { mode: 'link' },
    stages: { intake: true, tests: 'ask' },
    gates: {},
    git: { base: 'main', worktree: true, squash: true },
    style: { comments: 'why-only', commits: 'per-stage', checkpoints: 'plan' },
  });
});

test('a partial style override keeps its unmentioned siblings', () => {
  const config = applyDefaults({ style: { comments: 'none' } });
  assert.equal(config.style.comments, 'none');
  assert.equal(config.style.commits, 'per-stage');
  assert.equal(config.style.checkpoints, 'plan');
});

test('every style key rejects a value outside its enum', () => {
  for (const [key, values] of [
    ['comments', ['none', 'why-only', 'generous']],
    ['commits', ['atomic', 'per-stage', 'single']],
    ['checkpoints', ['intake', 'plan', 'every']],
  ]) {
    for (const value of values) {
      assert.deepEqual(validate(applyDefaults({ style: { [key]: value } })), []);
    }
    const errors = validate(applyDefaults({ style: { [key]: 'wat' } }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(`style\\.${key}`));
  }
});

test('a typo inside style is reported rather than ignored', () => {
  assert.deepEqual(unknownKeys({ style: { comment: 'none' } }), ['style.comment']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. The `deepEqual` test reports a missing `style` key, the enum tests report zero errors where one was expected, and the typo test returns `[]`.

- [ ] **Step 3: Implement**

In `lib/config.js`, add the enum table next to the other exported constants:

```js
// Style is agent behaviour, not process strictness, so these are not "strict
// defaults" like the rest of the file: they reproduce what SKILL.md already
// does, so a repo that upgrades the plugin without touching its config keeps
// behaving exactly as it did. See docs/specs/2026-07-27-interactive-delivery-init.md.
export const STYLE_VALUES = Object.freeze({
  comments: ['none', 'why-only', 'generous'],
  commits: ['atomic', 'per-stage', 'single'],
  checkpoints: ['intake', 'plan', 'every'],
});
```

Add `style` to `DEFAULTS`:

```js
  git: { base: 'main', worktree: true, squash: true },
  style: { comments: 'why-only', commits: 'per-stage', checkpoints: 'plan' },
```

Add `style` to `KNOWN_KEYS.root` and give it its own entry:

```js
  root: ['$schema', 'language', 'docsDir', 'tracker', 'stages', 'gates', 'git', 'style'],
  tracker: ['mode'],
  stages: ['intake', 'tests'],
  git: ['base', 'worktree', 'squash'],
  style: ['comments', 'commits', 'checkpoints'],
```

Add it to `SECTIONS`:

```js
const SECTIONS = ['tracker', 'stages', 'git', 'style'];
```

In `unknownKeys`, replace the hardcoded `['tracker', 'stages', 'git']` with `SECTIONS`, so a section added later cannot be forgotten here:

```js
  for (const section of SECTIONS) {
```

In `validate`, after the `git` checks:

```js
  for (const [key, values] of Object.entries(STYLE_VALUES)) {
    if (!values.includes(config.style[key])) {
      errors.push(`style.${key} must be one of ${values.join(', ')} (got ${JSON.stringify(config.style[key])})`);
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/config.js test/config.test.js
git commit -m "feat(config): add the style section"
```

---

### Task 2: Style in the proposal and in the schema

**Files:**
- Modify: `lib/detect.js` (`proposeConfig`)
- Modify: `schema.json`
- Test: `test/detect.test.js`

**Interfaces:**
- Consumes: the `style` defaults from Task 1, repeated here as literals because `detect.js` does not import `config.js` today and this plan does not change that.
- Produces: `proposeConfig()` output now carries a `style` section, so `init` prints and writes it.

- [ ] **Step 1: Write the failing test**

Add to `test/detect.test.js`:

```js
test('the proposal carries the style defaults so they are visible before writing', () => {
  const config = proposeConfig({ files: [], scripts: {} });
  assert.deepEqual(config.style, {
    comments: 'why-only',
    commits: 'per-stage',
    checkpoints: 'plan',
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `style` being `undefined`.

- [ ] **Step 3: Implement**

In `lib/detect.js`, add the section to the object `proposeConfig` returns:

```js
    git: { base: defaultBranch, worktree: true, squash: true },
    style: { comments: 'why-only', commits: 'per-stage', checkpoints: 'plan' },
```

In `schema.json`, add a `style` property alongside `git`, inside the top-level `properties`:

```json
    "style": {
      "type": "object",
      "additionalProperties": false,
      "description": "How the agent behaves while implementing. Unlike the rest of this file, these defaults reproduce current behaviour rather than being the strictest option.",
      "properties": {
        "comments": {
          "enum": ["none", "why-only", "generous"],
          "default": "why-only",
          "description": "none: only where the code is unreadable without a comment. why-only: explain why, never what. generous: why-only plus doc blocks on public APIs."
        },
        "commits": {
          "enum": ["atomic", "per-stage", "single"],
          "default": "per-stage",
          "description": "Commit granularity inside a ticket. Independent of git.squash, which governs the merge."
        },
        "checkpoints": {
          "enum": ["intake", "plan", "every"],
          "default": "plan",
          "description": "What the agent stops for beyond the intake stop, which is mandatory at every level. intake: nothing further. plan: also wait for plan approval. every: also stop after each stage."
        }
      }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Verify the schema is still valid JSON**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('schema.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add lib/detect.js schema.json test/detect.test.js
git commit -m "feat(init): propose the style section and document it in the schema"
```

---

### Task 3: Parsing and applying overrides

**Files:**
- Modify: `lib/config.js` (two new exported functions and one new exported constant)
- Create: `test/overrides.test.js`

**Interfaces:**
- Consumes: `validate()` and the `style` model from Task 1.
- Produces:
  - `OVERRIDE_KINDS` - frozen map from a dotted key to `'string' | 'boolean' | 'tests'`. `gates.*` is deliberately absent and handled as a wildcard.
  - `parseOverrides(argv: string[]) => { overrides: Array<{key: string, value?: string, unset?: true}>, errors: string[] }`
  - `applyOverrides(config, overrides) => { config, errors: string[] }` - never mutates its input, and its `errors` already include the output of `validate()`.

- [ ] **Step 1: Write the failing tests**

Create `test/overrides.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDefaults, applyOverrides, parseOverrides } from '../lib/config.js';

function apply(argv, base = applyDefaults({})) {
  const { overrides, errors } = parseOverrides(argv);
  const applied = applyOverrides(base, overrides);
  return { config: applied.config, errors: [...errors, ...applied.errors] };
}

test('a --set value is split on the first equals sign, so commands survive intact', () => {
  const { overrides, errors } = parseOverrides(['--set', 'gates.test=npm run test -- --run=all']);
  assert.deepEqual(errors, []);
  assert.deepEqual(overrides, [{ key: 'gates.test', value: 'npm run test -- --run=all' }]);
});

test('--set without an equals sign is an error', () => {
  const { errors } = parseOverrides(['--set', 'stages.tests']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /--set needs key=value/);
});

test('--set with no argument at all is an error rather than swallowing the next flag', () => {
  const { errors, overrides } = parseOverrides(['--set', '--write']);
  assert.equal(overrides.length, 0);
  assert.match(errors[0], /--set needs an argument/);
});

test('booleans coerce only for keys the schema declares boolean', () => {
  const { config, errors } = apply(['--set', 'git.worktree=false', '--set', 'stages.intake=true']);
  assert.deepEqual(errors, []);
  assert.equal(config.git.worktree, false);
  assert.equal(config.stages.intake, true);
});

test('a boolean key rejects anything that is not true or false', () => {
  const { errors } = apply(['--set', 'git.squash=yes']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /git\.squash must be true or false/);
});

test('stages.tests keeps its tri-state', () => {
  assert.equal(apply(['--set', 'stages.tests=true']).config.stages.tests, true);
  assert.equal(apply(['--set', 'stages.tests=false']).config.stages.tests, false);
  assert.equal(apply(['--set', 'stages.tests=ask']).config.stages.tests, 'ask');
  assert.match(apply(['--set', 'stages.tests=maybe']).errors[0], /stages\.tests/);
});

test('a gate value is always a string, never coerced', () => {
  const { config, errors } = apply(['--set', 'gates.e2e=true']);
  assert.deepEqual(errors, []);
  assert.equal(config.gates.e2e, 'true');
});

test('an unknown key is an error, not a silently added field', () => {
  const { config, errors } = apply(['--set', 'style.comment=none']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown key style\.comment/);
  assert.equal('comment' in config.style, false);
});

test('an out-of-enum style value is caught by the shared validate', () => {
  const { errors } = apply(['--set', 'style.checkpoints=sometimes']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /style\.checkpoints must be one of/);
});

test('--unset removes a gate that detection got wrong', () => {
  const base = applyDefaults({ gates: { lint: 'npm run lint', test: 'npm run test' } });
  const { config, errors } = apply(['--unset', 'gates.lint'], base);
  assert.deepEqual(errors, []);
  assert.deepEqual(config.gates, { test: 'npm run test' });
});

test('--unset on anything but a gate is an error, since every other key has a default', () => {
  const { errors } = apply(['--unset', 'git.base']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /--unset only applies to gates/);
});

test('applyOverrides never mutates the config it was given', () => {
  const base = applyDefaults({ gates: { lint: 'npm run lint' } });
  applyOverrides(base, [
    { key: 'git.worktree', value: 'false' },
    { key: 'gates.lint', unset: true },
  ]);
  assert.equal(base.git.worktree, true);
  assert.deepEqual(base.gates, { lint: 'npm run lint' });
});

test('an empty gate command is rejected, because it would silently run nothing', () => {
  const { errors } = apply(['--set', 'gates.lint=   ']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /gates\.lint/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL with `parseOverrides is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/config.js`:

```js
// Every key an override may address, and how its value is read. gates.* is
// deliberately absent: it is a wildcard whose value is always a string, because
// a gate that silently became a boolean would break `check` at runtime.
export const OVERRIDE_KINDS = Object.freeze({
  language: 'string',
  docsDir: 'string',
  'tracker.mode': 'string',
  'stages.intake': 'boolean',
  'stages.tests': 'tests',
  'git.base': 'string',
  'git.worktree': 'boolean',
  'git.squash': 'boolean',
  'style.comments': 'string',
  'style.commits': 'string',
  'style.checkpoints': 'string',
});

// A sentinel rather than undefined, so that a value which legitimately reads as
// absent cannot be mistaken for a coercion failure.
const INVALID = Symbol('invalid');

function coerce(kind, value) {
  if (kind === 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (kind === 'tests' && value === 'ask') return 'ask';
  return INVALID;
}

export function parseOverrides(argv = []) {
  const overrides = [];
  const errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--set' && flag !== '--unset') continue;
    const argument = argv[index + 1];
    index += 1;
    // Consuming the next flag as a value would turn `--set --write` into a key
    // named "--write" and silently drop the write.
    if (argument === undefined || argument.startsWith('--')) {
      errors.push(`${flag} needs an argument`);
      continue;
    }
    if (flag === '--unset') {
      overrides.push({ key: argument, unset: true });
      continue;
    }
    const equals = argument.indexOf('=');
    // Split on the FIRST equals: a gate command may contain more of them.
    if (equals < 1) {
      errors.push(`--set needs key=value (got ${JSON.stringify(argument)})`);
      continue;
    }
    overrides.push({ key: argument.slice(0, equals), value: argument.slice(equals + 1) });
  }
  return { overrides, errors };
}

export function applyOverrides(config, overrides = []) {
  const next = structuredClone(config);
  const errors = [];
  for (const { key, value, unset } of overrides) {
    const parts = key.split('.');
    const isGate = parts.length === 2 && parts[0] === 'gates' && parts[1] !== '';
    if (unset) {
      // Every other key has a default, so unsetting it would mean nothing.
      // Gates are the one place where absence is the meaningful state.
      if (!isGate) {
        errors.push(`--unset only applies to gates (got ${key})`);
        continue;
      }
      delete next.gates[parts[1]];
      continue;
    }
    if (isGate) {
      if (value.trim() === '') {
        errors.push(`gates.${parts[1]} must be a non-empty command string`);
        continue;
      }
      next.gates[parts[1]] = value;
      continue;
    }
    const kind = OVERRIDE_KINDS[key];
    if (kind === undefined) {
      errors.push(`unknown key ${key} - run init without --write to see the keys it accepts`);
      continue;
    }
    const coerced = coerce(kind, value);
    if (coerced === INVALID) {
      errors.push(
        kind === 'tests'
          ? `${key} must be true, false or ask (got ${JSON.stringify(value)})`
          : `${key} must be true or false (got ${JSON.stringify(value)})`,
      );
      continue;
    }
    if (parts.length === 1) next[key] = coerced;
    else next[parts[0]][parts[1]] = coerced;
  }
  // The enum rules live in validate() and are not restated here, so an override
  // and a hand-edited file cannot disagree about what is legal.
  return { config: next, errors: [...errors, ...validate(next)] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/config.js test/overrides.test.js
git commit -m "feat(config): parse and apply --set and --unset overrides"
```

---

### Task 4: Wire overrides into `init`

**Files:**
- Modify: `bin/delivery.js:49-78` (the `init` function) and its import block
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: `parseOverrides` and `applyOverrides` from Task 3, `proposeConfig` and `undetectedGates` from `lib/detect.js`.
- Produces: `init` accepting repeatable `--set key=value` and `--unset key` alongside the existing `--write`.

- [ ] **Step 1: Write the failing tests**

Add to `test/cli.test.js`:

```js
test('init --set changes the proposal it prints', () => {
  const root = scratchRepo({ pkg: { scripts: { test: 'vitest run' } } });
  const { code, stdout } = run(
    ['init', '--set', 'stages.tests=true', '--set', 'style.comments=none'],
    root,
  );
  assert.equal(code, 0);
  const proposed = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1));
  assert.equal(proposed.stages.tests, true);
  assert.equal(proposed.style.comments, 'none');
});

test('init --set can supply a gate detection could not find', () => {
  const root = scratchRepo({ pkg: { scripts: { test: 'vitest run' } } });
  const { stdout } = run(['init', '--set', 'gates.e2e=pnpm run e2e'], root);
  const proposed = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1));
  assert.equal(proposed.gates.e2e, 'pnpm run e2e');
  assert.doesNotMatch(stdout, /not detected:.*e2e/);
});

test('init --unset drops a gate detection got wrong', () => {
  const root = scratchRepo({ pkg: { scripts: { lint: 'eslint .', test: 'vitest run' } } });
  const { stdout } = run(['init', '--unset', 'gates.lint'], root);
  const proposed = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1));
  assert.equal('lint' in proposed.gates, false);
  assert.match(stdout, /not detected: lint/);
});

test('init --write stores the overrides', () => {
  const root = scratchRepo({ pkg: { scripts: { test: 'vitest run' } } });
  const { code } = run(
    ['init', '--write', '--set', 'style.checkpoints=every', '--set', 'git.worktree=false'],
    root,
  );
  assert.equal(code, 0);
  const written = JSON.parse(readFileSync(join(root, '.claude/delivery.json'), 'utf8'));
  assert.equal(written.style.checkpoints, 'every');
  assert.equal(written.git.worktree, false);
});

test('a bad override exits 1 and writes nothing at all', () => {
  const root = scratchRepo({ pkg: { scripts: { test: 'vitest run' } } });
  const { code, stdout } = run(['init', '--write', '--set', 'style.comments=chatty'], root);
  assert.equal(code, 1);
  assert.match(stdout, /style\.comments must be one of/);
  assert.throws(() => readFileSync(join(root, '.claude/delivery.json'), 'utf8'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. `--set` is currently ignored, so the printed proposal is unchanged and the bad-override run exits 0 and writes the file.

- [ ] **Step 3: Implement**

In `bin/delivery.js`, extend the import:

```js
import { CONFIG_PATH, applyOverrides, loadConfig, parseOverrides } from '../lib/config.js';
```

Replace the body of `init` down to the `console.log(JSON.stringify(...))` line:

```js
function init() {
  const pkg = readJson(join(cwd, 'package.json')) ?? {};
  const files = readdirSync(cwd);
  const proposed = proposeConfig({
    files,
    scripts: pkg.scripts ?? {},
    defaultBranch: gitDefaultBranch(),
  });

  const parsed = parseOverrides(rest);
  const applied = applyOverrides(proposed, parsed.overrides);
  const errors = [...parsed.errors, ...applied.errors];
  if (errors.length > 0) {
    // Reported before anything is written, and all at once: a half-applied
    // config is worse than none, and fixing one flag per run is miserable.
    for (const error of errors) console.log(`config error: ${error}`);
    return 1;
  }

  const config = applied.config;
  const undetected = undetectedGates(config.gates);

  console.log(JSON.stringify({ $schema: SCHEMA_URL, ...config }, null, 2));
```

The rest of the function, from the `if (undetected.length > 0)` block onward, is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Verify it by hand against this very repo**

Run: `node bin/delivery.js init --set style.checkpoints=every --set gates.e2e="npm run e2e"`
Expected: a printed config whose `style.checkpoints` is `every` and whose `gates.e2e` is `npm run e2e`, and no file written.

Run: `node bin/delivery.js init --set style.comments=chatty`
Expected: `config error: style.comments must be one of none, why-only, generous (got "chatty")` and exit code 1. Confirm with `echo $?`.

- [ ] **Step 6: Commit**

```bash
git add bin/delivery.js test/cli.test.js
git commit -m "feat(init): accept --set and --unset overrides"
```

---

### Task 5: Teach the skill to read `style`

**Files:**
- Modify: `skills/delivery-workflow/SKILL.md`

**Interfaces:**
- Consumes: the value sets from Task 1. The wording here is the only place that gives them operational meaning, so the words matter as much as the code.

- [ ] **Step 1: Add the fourth reading rule**

In the `First: read the repo's config` section, after the `language` bullet, add:

```markdown
- **`style` is optional, and its defaults are "as today", not "stricter".** Absent means `comments: why-only`, `commits: per-stage`, `checkpoints: plan` - which is exactly what this skill did before the section existed, so upgrading the plugin never changes a repo's process behind its back.
```

- [ ] **Step 2: Add the Style section**

Insert a new section immediately after `The rule` and before `Stages`:

```markdown
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

The stop after intake is mandatory at every level and is never governed by this key. So is the existing rule to wait before writing code when anything is product-ambiguous. `checkpoints` only adds to those:

- `intake` - nothing beyond them.
- `plan` - also post the planning checkpoint and wait for approval before stage 4. The default.
- `every` - also stop after each stage and wait before starting the next.
```

- [ ] **Step 3: Point stage 3 at the setting**

In stage 3, replace the sentence beginning `Then post a **planning checkpoint**` with:

```markdown
Then, unless `style.checkpoints` is `intake`, post a **planning checkpoint** to the human: what you are building, what you are NOT building, the decisions you made, the open questions, and where the risk is. WAIT for approval before writing code. At `intake` you still post it, but you may continue without waiting - except when anything is product-ambiguous, where waiting is required at every level.
```

- [ ] **Step 4: Verify the intake stop is still unconditional**

Run: `grep -n "STOP" skills/delivery-workflow/SKILL.md`
Expected: the stage 0 line still reads `Then **STOP** and groom` with no condition attached to it. Commit `2232700` restored that stop on purpose, and no `checkpoints` value may weaken it.

- [ ] **Step 5: Commit**

```bash
git add skills/delivery-workflow/SKILL.md
git commit -m "docs(skill): give the style settings operational meaning"
```

---

### Task 6: The wizard in `/delivery-init`

**Files:**
- Modify: `commands/delivery-init.md` (steps 3 and 4)

**Interfaces:**
- Consumes: the CLI flags from Task 4. Every key named here must exist in `OVERRIDE_KINDS`.

- [ ] **Step 1: Replace step 3**

Replace the whole of `## Step 3: Show it and get a decision` with:

```markdown
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

Ask each batch as a single question or a single grouped set of questions, not one message per key. After each batch, offer to stop and write what has been decided so far. Collect the answers as `--set` and `--unset` arguments; do not write anything until Step 4.

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
```

- [ ] **Step 2: Replace step 4**

Replace the body of `## Step 4: Write it` with:

````markdown
One command carrying every answer:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/delivery.js" init --write --set <key>=<value> --unset <key>
```

Drop the flags the user did not change. With no answers at all this is the plain `init --write`.

If it exits non-zero it wrote nothing and printed every problem it found. Fix the flags and run it again. Do not fall back to writing the JSON by hand: the command is what validates the file.
````

- [ ] **Step 3: Verify every key named in the command file is a real key**

Run: `grep -o 'gates\.[a-z]*\|stages\.[a-z]*\|git\.[a-z]*\|style\.[a-z]*' commands/delivery-init.md | sort -u`
Expected: only `gates.<name>`, `stages.tests`, `git.squash`, `git.worktree`, `style.checkpoints`, `style.comments`, `style.commits`. Anything else is a key that does not exist and would exit 1 at runtime.

- [ ] **Step 4: Commit**

```bash
git add commands/delivery-init.md
git commit -m "feat(init): make the command an opt-in three-batch wizard"
```

---

### Task 7: Docs and the version floor

**Files:**
- Modify: `.claude-plugin/plugin.json` (`version`)
- Modify: `README.md` (config example, rules, Keys table, a Style section)
- Modify: `docs/design.md` (record the defaults exception)

**Interfaces:**
- Consumes: everything above. Nothing consumes this task.

- [ ] **Step 1: Bump the plugin version**

In `.claude-plugin/plugin.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

This is not cosmetic. An older `lib/config.js` reading a config that has a `style` key reports `unknown key style`, that goes into `errors`, `resolveConfig` returns `null`, and `check` stops working entirely. A new config against an old plugin is broken, not degraded, so the floor has to be stated.

- [ ] **Step 2: Update the README config example**

In the JSON block under `## Configuration`, add after the `git` line:

```json
  "git": { "base": "main", "worktree": true, "squash": true },
  "style": { "comments": "why-only", "commits": "per-stage", "checkpoints": "plan" }
```

- [ ] **Step 3: Note the exception to the strict-defaults rule**

Under `**Defaults are strict.**`, append to that paragraph:

```markdown
One section is deliberately outside this rule. `style` describes agent behaviour, where there is no reading under which one value is stricter than another, so its defaults reproduce what the skill already did rather than picking a strictest option. A config written before `style` existed behaves identically after the upgrade.
```

- [ ] **Step 4: Extend the Keys table**

Add three rows after `git.squash`:

```markdown
| `style.comments` | `none` `why-only` `generous` | `why-only` | How much commentary the code carries |
| `style.commits` | `atomic` `per-stage` `single` | `per-stage` | Commit granularity inside a ticket |
| `style.checkpoints` | `intake` `plan` `every` | `plan` | What the agent stops for, beyond the mandatory intake stop |
```

- [ ] **Step 5: Add a Style section and the version floor**

Insert after `## The tests decision`:

```markdown
## Style

`style` covers how the agent works rather than what it builds: how much it comments, how it commits, and where it stops to ask.

`checkpoints` deserves one clarification. The stop after intake is mandatory at every level and this key cannot switch it off. `intake` means nothing beyond it, `plan` adds waiting for approval of the plan, and `every` adds a stop after each stage.

The section requires plugin version 0.2.0 or later. An older plugin treats `style` as an unrecognised key, which is an error by design, and `/delivery-check` will refuse to run until you update.
```

- [ ] **Step 6: Record the decision in the design doc**

Append to `docs/design.md`:

```markdown
## The style section

`style` holds agent behaviour: `comments`, `commits`, `checkpoints`. It arrived with the interactive `/delivery-init`, because the alternative - a generated block in the repo's own `CLAUDE.md` - is unvalidated, invisible to the CLI and the hook, and makes `init` write into a file it does not own.

Its defaults break the strict-default rule that governs the rest of the config, and that is deliberate. Strictness is meaningless for style: `generous` is not stricter than `none`. So the defaults reproduce what `SKILL.md` already did, which also means upgrading the plugin cannot change a repo's process without a config change. Recorded here so the next reader of `lib/config.js` does not file it as an oversight and "fix" it.

The CLI stays non-interactive. `/delivery-init` is a markdown prompt executed by an agent, and that agent's Bash tool gives the process no interactive stdin, so a readline wizard would hang rather than ask. The agent asks; the CLI takes the answers as `--set` and `--unset` flags and remains the only writer of the file.

The full spec is in [specs/2026-07-27-interactive-delivery-init.md](specs/2026-07-27-interactive-delivery-init.md).
```

- [ ] **Step 7: Run the whole suite one last time**

Run: `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/plugin.json README.md docs/design.md
git commit -m "docs: document the style section and its version floor"
```

---

## Self-review notes

Spec coverage checked section by section: the `style` model is Task 1, the proposal and schema are Task 2, the CLI contract including first-equals splitting and schema-driven coercion is Task 3, the exit-1-writes-nothing guarantee is Task 4, the mandatory intake stop is Task 5, the three batches are Task 6, and the version floor and the recorded defaults exception are Task 7. The two out-of-scope items from the spec, `style.docsLang` and hook awareness of `style`, appear in no task, which is correct.
