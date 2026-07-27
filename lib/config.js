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

// Style is agent behaviour, not process strictness, so these are not "strict
// defaults" like the rest of the file: they reproduce what SKILL.md already did
// before the section existed, so upgrading the plugin cannot change a repo's
// process behind its back. See docs/specs/2026-07-27-interactive-delivery-init.md.
export const STYLE_VALUES = Object.freeze({
  comments: ['none', 'why-only', 'generous'],
  commits: ['atomic', 'per-stage', 'single'],
  checkpoints: ['intake', 'plan', 'every'],
});

export const DEFAULTS = Object.freeze({
  language: 'none',
  docsDir: 'docs/features',
  tracker: { mode: 'link' },
  stages: { intake: true, tests: 'ask' },
  gates: {},
  git: { base: 'main', worktree: true, squash: true },
  style: { comments: 'why-only', commits: 'per-stage', checkpoints: 'plan' },
});

// Keys we recognise, by section. A typo like `gate` for `gates` would otherwise
// be dropped silently by applyDefaults and read exactly like "key absent" -
// which would let a typo quietly relax the process.
export const KNOWN_KEYS = Object.freeze({
  root: ['$schema', 'language', 'docsDir', 'tracker', 'stages', 'gates', 'git', 'style'],
  tracker: ['mode'],
  stages: ['intake', 'tests'],
  git: ['base', 'worktree', 'squash'],
  style: ['comments', 'commits', 'checkpoints'],
});

// Sections merged key-by-key, so overriding one key keeps its siblings.
const SECTIONS = ['tracker', 'stages', 'git', 'style'];

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

export function unknownKeys(raw = {}) {
  const found = [];
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.root.includes(key)) found.push(key);
  }
  // SECTIONS rather than a second literal list: a section added to one and
  // forgotten in the other would make its typos invisible.
  for (const section of SECTIONS) {
    const value = raw[section];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of Object.keys(value)) {
      if (!KNOWN_KEYS[section].includes(key)) found.push(`${section}.${key}`);
    }
  }
  return found;
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
  // git parses a leading dash as an option, so a crafted base turns `git diff`
  // into an arbitrary-file-write primitive. This value arrives with whatever
  // branch is checked out, so it is not ours to trust.
  if (typeof config.git.base === 'string' && !/^[A-Za-z0-9._\/-]+$/.test(config.git.base)) {
    errors.push('git.base must be a branch name: letters, digits, dot, underscore, slash or dash');
  }
  if (typeof config.git.base === 'string' && config.git.base.startsWith('-')) {
    errors.push('git.base must not start with a dash - git would read it as an option');
  }
  for (const key of ['worktree', 'squash']) {
    if (typeof config.git[key] !== 'boolean') errors.push(`git.${key} must be a boolean`);
  }
  for (const [key, values] of Object.entries(STYLE_VALUES)) {
    if (!values.includes(config.style[key])) {
      errors.push(
        `style.${key} must be one of ${values.join(', ')} (got ${JSON.stringify(config.style[key])})`,
      );
    }
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
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      exists: true,
      path,
      config: applyDefaults({}),
      errors: [`${CONFIG_PATH} must contain a JSON object`],
    };
  }
  if (raw.gates !== undefined && (raw.gates === null || typeof raw.gates !== 'object' || Array.isArray(raw.gates))) {
    return {
      exists: true,
      path,
      config: applyDefaults({}),
      errors: [`${CONFIG_PATH}: gates must be an object mapping a gate name to a command`],
    };
  }
  const config = applyDefaults(raw);
  const unknown = unknownKeys(raw).map(
    (key) => `unknown key ${key} - check the spelling; it is being ignored`,
  );
  return { exists: true, path, config, errors: [...unknown, ...validate(config)] };
}
