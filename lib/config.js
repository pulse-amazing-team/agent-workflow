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

export const DEFAULTS = Object.freeze({
  language: 'none',
  docsDir: 'docs/features',
  tracker: { mode: 'link' },
  stages: { intake: true, tests: 'ask' },
  gates: {},
  git: { base: 'main', worktree: true, squash: true },
});

// Sections merged key-by-key, so overriding one key keeps its siblings.
const SECTIONS = ['tracker', 'stages', 'git'];

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
  for (const key of ['worktree', 'squash']) {
    if (typeof config.git[key] !== 'boolean') errors.push(`git.${key} must be a boolean`);
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
  const config = applyDefaults(raw);
  return { exists: true, path, config, errors: validate(config) };
}
