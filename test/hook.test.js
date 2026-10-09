import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function git(cwd, args) {
  execFileSync('git', args, { cwd });
}

// The hook infers the ticket from `git diff --name-only <base>...HEAD`, so the
// fixture needs a real history: a base commit on `main` (what the branch
// diverged from), then the artifacts committed on a second branch (what the
// branch actually did). Without this, `git diff` has nothing to compare and
// every test would exercise the "could not tell which ticket" fallback
// instead of the artifact checks it means to test.
function repo({ config = {}, artifacts = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shipwright-hook-'));
  git(root, ['init', '-q']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/shipwright.json'), JSON.stringify(config));
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);

  git(root, ['checkout', '-q', '-b', 'work']);
  for (const artifact of artifacts) {
    const full = join(root, artifact);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, '# stub\n');
  }
  if (artifacts.length > 0) {
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'ticket work']);
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
    config: { stages: { intake: false, tests: false }, gates: { test: 'npm test' } },
    artifacts: [
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const output = runHook(prCall, root);
  assert.equal(output, null);
});

// Carried over from Task 4's review: `shipwright check` exits 0 when a repo has
// configured no gates, because there is nothing to fail - the printed message
// is honest but the exit code is not. This hook must not read that silence as
// "verified", so a gate-less repo gets a reminder even with every artifact in
// place.
test('a complete ticket with no gates configured still gets a reminder that nothing will be verified', () => {
  const root = repo({
    config: { stages: { intake: false, tests: false } },
    artifacts: [
      'docs/features/m5/scope.md',
      'docs/features/m5/product.md',
      'docs/features/m5/plan.md',
    ],
  });
  const output = runHook(prCall, root);
  assert.match(output.hookSpecificOutput.additionalContext, /nothing will be verified/);
});

test('an ambiguous ticket falls back to a generic reminder rather than guessing', () => {
  const root = repo({
    artifacts: ['docs/features/m5/scope.md', 'docs/features/m6/scope.md'],
  });
  const output = runHook(prCall, root);
  assert.match(output.hookSpecificOutput.additionalContext, /could not tell which ticket/);
});

test('a repo with no config produces no reminder', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipwright-hook-'));
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

// Fix round: changedPaths used to build a shell command by string
// interpolation, and config.git.base is attacker-controlled - it arrives with
// whatever .claude/shipwright.json a branch or PR brings. A base like
// `main; touch <marker> #` must never actually run `touch`.
test('a hostile git.base cannot execute a shell command', () => {
  const root = repo();
  const marker = join(root, 'PWNED');
  writeFileSync(
    join(root, '.claude/shipwright.json'),
    JSON.stringify({ git: { base: `main; touch ${marker} #` } }),
  );
  runHook(prCall, root);
  assert.equal(existsSync(marker), false);
});

// Fix round: existsSync(dir) is true for a plain file too, so a ticket
// directory that has been replaced by a file (rename or refactor gone wrong,
// no malice needed) used to throw ENOTDIR out of readdirSync uncaught. The
// hook's own header promises it never blocks - runHook throws if the process
// exits non-zero, so this only passes if the hook still exits 0.
test('a ticket path that is a file instead of a directory does not crash the hook', () => {
  const root = repo({ artifacts: ['docs/features/m5/intake.md'] });
  rmSync(join(root, 'docs/features/m5'), { recursive: true, force: true });
  writeFileSync(join(root, 'docs/features/m5'), 'not a directory\n');
  assert.doesNotThrow(() => runHook(prCall, root));
});

// Fix round 2: docsDir reaches additionalContext through ticketDir() in the
// missing-artifacts note, a second interpolation site the first fix round
// missed. A crafted docsDir must come back capped, not verbatim - this is the
// common path (a ticket resolves, artifacts are missing), more common than
// the ambiguous-ticket fallback that was already capped.
test('a long crafted docsDir is capped rather than reflected verbatim', () => {
  const payload = 'X'.repeat(200);
  const docsDir = `docs/${payload}`;
  const root = repo({
    config: { docsDir },
    artifacts: [`${docsDir}/m5/intake.md`],
  });
  const output = runHook(prCall, root);
  const context = output.hookSpecificOutput.additionalContext;
  assert.equal(context.includes(payload), false);
  assert.ok(context.length < 700, `expected a bounded message, got ${context.length} chars`);
});

// Fix round 2: gate NAMES (unlike commands) are never length- or
// content-validated by lib/config.js, and unlike a path they have no
// filesystem-imposed size ceiling. A crafted gate name reaches
// additionalContext through the ambiguous-ticket fallback's gate list.
test('a long crafted gate name is capped rather than reflected verbatim', () => {
  const payload = 'G'.repeat(200);
  const root = repo({
    config: { gates: { [payload]: 'echo ok' } },
    artifacts: ['docs/features/m5/scope.md', 'docs/features/m6/scope.md'],
  });
  const output = runHook(prCall, root);
  const context = output.hookSpecificOutput.additionalContext;
  assert.equal(context.includes(payload), false);
  assert.ok(context.length < 700, `expected a bounded message, got ${context.length} chars`);
});

// Fix round 3: changedPaths used to catch every git failure - a misnamed or
// unfetched base branch, or no repo at all - and return [], the same value it
// returns for a genuine "nothing changed". inferTicket then reported the
// former as "could not tell which ticket", which is false: nothing was
// ambiguous, the lookup never ran. A wrong git.base must say so by name, not
// masquerade as ambiguity.
test('a git.base that does not exist reports the comparison failure, not ambiguity', () => {
  const root = repo({
    config: { git: { base: 'develop' } },
    artifacts: ['docs/features/m5/intake.md'],
  });
  let output;
  assert.doesNotThrow(() => {
    output = runHook(prCall, root);
  });
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /develop/);
  assert.doesNotMatch(context, /could not tell which ticket/);
});

// Fix round 3, the guard: when git DOES succeed and genuinely finds nothing
// under docsDir, that is still real ambiguity and must keep using the
// original message. This is the test that stops a future refactor from
// collapsing "git failed" (null) and "git succeeded with nothing" ([])
// back into the same branch.
test('git succeeding with no touched ticket directory still produces the ambiguity message', () => {
  const root = repo();
  const output = runHook(prCall, root);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /could not tell which ticket/);
  assert.doesNotMatch(context, /could not compare this branch/);
});
