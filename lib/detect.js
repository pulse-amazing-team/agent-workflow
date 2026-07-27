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
