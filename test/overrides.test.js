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
