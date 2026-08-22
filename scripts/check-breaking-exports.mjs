#!/usr/bin/env node
// Real, automated guardrail against the most common accidental breaking change: an exported
// symbol silently disappearing. Not full structural type-compatibility checking (that needs
// proper tooling, e.g. api-extractor, and is a bigger undertaking than this session can build
// soundly) -- but "did an export that existed before now not exist" is cheap, reliable, and
// catches exactly the class of mistake a human re-checking a diff by eye is most likely to
// miss under time pressure. If this fires, the version bump MUST be MAJOR -- checked here, not
// left to memory.
//
// Diffs src/index.ts (the real entry point), not dist/index.d.ts -- dist/ is gitignored,
// never committed at any tag, so comparing against it fails outright on every real tag. Found
// by actually running this against claudia-rte's real v1.0.0 tag before shipping it anywhere,
// not assumed to work.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function latestTag() {
  try {
    return execSync('git describe --tags --abbrev=0 HEAD^', { encoding: 'utf8' }).trim();
  } catch {
    return null; // no prior tag -- first release, nothing to compare against
  }
}

function exportedNames(srcContent) {
  const names = new Set();
  for (const m of srcContent.matchAll(/export\s+\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  for (const m of srcContent.matchAll(/export\s+(?:default\s+)?(?:function|class|const|let)\s+(\w+)/g)) names.add(m[1]);
  for (const m of srcContent.matchAll(/export\s+(?:type|interface)\s+(\w+)/g)) names.add(m[1]);
  return names;
}

const tag = latestTag();
if (!tag) {
  console.log('No prior tag found -- first release, nothing to compare. Passing.');
  process.exit(0);
}

console.log(`Comparing exported API surface (src/index.ts) against ${tag}...`);

let oldSrc;
try {
  oldSrc = execSync(`git show ${tag}:src/index.ts`, { encoding: 'utf8' });
} catch (e) {
  console.error(`::error::Could not read src/index.ts at ${tag}: ${e.message}`);
  process.exit(1);
}
const newSrc = readFileSync('src/index.ts', 'utf8');

const oldNames = exportedNames(oldSrc);
const newNames = exportedNames(newSrc);
const removed = [...oldNames].filter((n) => !newNames.has(n));

if (removed.length === 0) {
  console.log(`No exports removed since ${tag} (checked: ${[...oldNames].join(', ')}). Passing.`);
  process.exit(0);
}

console.error(`::error::Exports removed since ${tag}: ${removed.join(', ')}`);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [newMajor] = pkg.version.split('.').map(Number);
const [oldMajor] = tag.replace(/^v/, '').split('.').map(Number);

if (newMajor <= oldMajor) {
  console.error(`::error::An export was removed but package.json's version (${pkg.version}) does not bump MAJOR past ${tag}. This is a breaking change -- it must ship as a MAJOR version, not silently.`);
  process.exit(1);
}
console.log(`Version correctly bumped to MAJOR ${newMajor} for a breaking change. Passing.`);
