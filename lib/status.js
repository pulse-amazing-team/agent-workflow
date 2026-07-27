// What a ticket owes, given the repo's config.
//
// Pure on purpose: the hook and the CLI both need this answer, and neither
// should be the place where the rule lives.

// A path segment that names a ticket directory rather than a file.
const isTicketSegment = (segment, rest) => segment !== '' && rest.includes('/');

export function requiredArtifacts(config) {
  const artifacts = [];
  if (config.stages.intake) artifacts.push('intake.md');
  artifacts.push('scope.md', 'product.md', 'plan.md');
  // Only an unconditional yes makes the test artifact mandatory.
  if (config.stages.tests === true) artifacts.push('test-cases.md');
  return artifacts;
}

// Artifacts whose necessity is decided later by the human. Reported separately
// so "we agreed not to write tests" never reads as a missing artifact.
export function conditionalArtifacts(config) {
  return config.stages.tests === 'ask' ? ['test-cases.md'] : [];
}

// Which required artifacts are absent. `presentFiles` must be the contents of a
// SINGLE ticket's directory - basenames are compared, so a list spanning two
// tickets would let one ticket's scope.md satisfy the other's. Callers resolve
// the ticket first and read that one directory.
export function missingArtifacts(config, presentFiles = []) {
  const present = new Set(presentFiles.map((file) => file.split('/').pop()));
  return requiredArtifacts(config).filter((artifact) => !present.has(artifact));
}

export function ticketDir(config, ticket) {
  const base = config.docsDir.replace(/\/+$/, '');
  return `${base}/${ticket}`;
}

// Which ticket this branch is about, inferred from the paths it touched under
// docsDir. Exactly one match is an answer; zero or several is not, and the
// caller falls back to a generic reminder rather than guessing wrong.
export function inferTicket(changedPaths = [], docsDir = 'docs/features') {
  const prefix = `${docsDir.replace(/\/+$/, '')}/`;
  const tickets = new Set();
  for (const path of changedPaths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const segment = rest.split('/')[0];
    if (isTicketSegment(segment, rest)) tickets.add(segment);
  }
  return tickets.size === 1 ? [...tickets][0] : null;
}
