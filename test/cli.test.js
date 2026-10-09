import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../bin/shipwright.js');

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function scratchRepo({ pkg, config, artifacts = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shipwright-cli-'));
  if (pkg) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  if (config) {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/shipwright.json'), JSON.stringify(config));
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
  const written = JSON.parse(readFileSync(join(root, '.claude/shipwright.json'), 'utf8'));
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

// Fix round: existsSync(dir) is true for a plain file too, so a ticket path
// that has been replaced by a file (rename or refactor gone wrong, no malice
// needed) used to throw ENOTDIR out of readdirSync uncaught, crashing the
// command instead of reporting a result.
test('status reports missing artifacts instead of crashing when the ticket path is a file', () => {
  const root = scratchRepo({ config: {} });
  mkdirSync(join(root, 'docs/features'), { recursive: true });
  writeFileSync(join(root, 'docs/features/m5'), 'not a directory\n');
  const { code, stdout } = run(['status', 'm5'], root);
  assert.equal(code, 1);
  assert.match(stdout, /missing: intake\.md, scope\.md, product\.md, plan\.md/);
});

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
  const written = JSON.parse(readFileSync(join(root, '.claude/shipwright.json'), 'utf8'));
  assert.equal(written.style.checkpoints, 'every');
  assert.equal(written.git.worktree, false);
});

test('a bad override exits 1 and writes nothing at all', () => {
  const root = scratchRepo({ pkg: { scripts: { test: 'vitest run' } } });
  const { code, stdout } = run(['init', '--write', '--set', 'style.comments=chatty'], root);
  assert.equal(code, 1);
  assert.match(stdout, /style\.comments must be one of/);
  assert.throws(() => readFileSync(join(root, '.claude/shipwright.json'), 'utf8'));
});
