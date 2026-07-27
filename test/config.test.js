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
