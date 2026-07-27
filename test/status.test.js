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

test('a caller must scope presentFiles to one ticket - the contract, pinned', () => {
  const config = applyDefaults({ stages: { intake: false } });
  // Only m5's own directory. m6's identically-named artifacts are not visible
  // here, which is exactly the caller obligation the doc comment states.
  const m5Only = ['docs/features/m5/scope.md'];
  assert.deepEqual(missingArtifacts(config, m5Only), ['product.md', 'plan.md']);

  // The same list with a second ticket's files mixed in would wrongly clear
  // m5's requirements. This asserts the failure mode explicitly so nobody
  // "fixes" the caller contract away without seeing what it costs.
  const mixed = ['docs/features/m5/scope.md', 'docs/features/m6/product.md', 'docs/features/m6/plan.md'];
  assert.deepEqual(missingArtifacts(config, mixed), []);
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
