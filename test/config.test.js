import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDefaults, loadConfig, validate, unknownKeys } from '../lib/config.js';

function repoWith(contents) {
  const root = mkdtempSync(join(tmpdir(), 'shipwright-'));
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/shipwright.json'), contents);
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
    style: { comments: 'why-only', commits: 'per-stage', checkpoints: 'plan' },
  });
});

test('a partial section override keeps its unmentioned siblings', () => {
  const config = applyDefaults({ git: { base: 'develop' } });
  assert.equal(config.git.base, 'develop');
  assert.equal(config.git.worktree, true);
  assert.equal(config.git.squash, true);
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

// git parses a leading dash as an option, so a crafted base can turn
// `git diff` into an arbitrary-file-write primitive - reproduced with
// {"git":{"base":"--output=/tmp/x"}}, which made git write a file named
// after the ...HEAD suffix. This must be rejected before it ever reaches git.
test('a git.base that looks like a command-line flag is an error', () => {
  const errors = validate(applyDefaults({ git: { base: '--output=/tmp/x' } }));
  assert.ok(errors.length > 0);
  assert.ok(errors.some((error) => /git\.base/.test(error)));
});

test('a git.base carrying shell metacharacters is an error', () => {
  const errors = validate(applyDefaults({ git: { base: 'main; touch /tmp/x' } }));
  assert.ok(errors.length > 0);
  assert.ok(errors.some((error) => /git\.base/.test(error)));
});

test('a missing config file yields defaults and is reported as absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipwright-'));
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

test('a misspelled top-level key is an error, not a silent no-op', () => {
  const result = loadConfig(repoWith(JSON.stringify({ gate: { test: 'npm test' } })));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /unknown key gate/);
});

test('a misspelled key inside a section is an error', () => {
  const result = loadConfig(repoWith(JSON.stringify({ git: { basee: 'develop' } })));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /unknown key git\.basee/);
});

test('$schema is a recognised key and is not reported as unknown', () => {
  const result = loadConfig(repoWith(JSON.stringify({ $schema: 'https://example.com/s.json' })));
  assert.deepEqual(result.errors, []);
});

test('gate names are free-form, so they are never reported as unknown', () => {
  const result = loadConfig(repoWith(JSON.stringify({ gates: { whatever: 'make check' } })));
  assert.deepEqual(result.errors, []);
});

test('a config file containing null is an error, not a crash', () => {
  const result = loadConfig(repoWith('null'));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /must contain a JSON object/);
});

// "gates": [] or "gates": null both spread to {} in applyDefaults, which
// reads identically to "no gates configured" - the same silent-drop the
// unknown-key rule exists to prevent, just one layer up.
test('gates as an array is an error, not a silent "no gates configured"', () => {
  const result = loadConfig(repoWith(JSON.stringify({ gates: [] })));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /gates must be an object/);
});

test('gates as null is an error, not a silent "no gates configured"', () => {
  const result = loadConfig(repoWith(JSON.stringify({ gates: null })));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /gates must be an object/);
});

test('unknown keys are reported before validation errors', () => {
  const result = loadConfig(repoWith(JSON.stringify({ gate: {}, language: 'rust' })));
  assert.match(result.errors[0], /unknown key gate/);
  assert.match(result.errors[1], /language must be one of/);
});
