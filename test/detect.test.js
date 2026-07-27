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
    style: { comments: 'why-only', commits: 'per-stage', checkpoints: 'plan' },
  });
});

test('a repo with nothing detectable still proposes a valid config with no gates', () => {
  const config = proposeConfig({});
  assert.equal(config.language, 'none');
  assert.deepEqual(config.gates, {});
  assert.equal(config.git.base, 'main');
});

test('the proposal carries the style defaults so they are visible before writing', () => {
  const config = proposeConfig({ files: [], scripts: {} });
  assert.deepEqual(config.style, {
    comments: 'why-only',
    commits: 'per-stage',
    checkpoints: 'plan',
  });
});
