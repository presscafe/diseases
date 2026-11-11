#!/usr/bin/env node
/**
 * Builds site/index.json from data/diseases/.
 *
 * The viewer is a single static HTML file that fetches this index at runtime,
 * so there is no build step, no bundler and no dependency. `--check` verifies
 * that the committed index is current without writing, which is what CI uses.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, readRecords, buildIndex } from './lib.mjs';

const OUT = join(ROOT, 'site', 'index.json');
const checkOnly = process.argv.includes('--check');

const entries = await readRecords();

const failed = entries.filter((entry) => entry.parseError);
if (failed.length) {
  console.error('Cannot build: unparseable records. Run `npm run validate` first.');
  for (const entry of failed) console.error(`  ${entry.slugFromFile}: ${entry.parseError.message}`);
  process.exit(1);
}

const index = buildIndex(entries.map((entry) => entry.record));
const serialised = `${JSON.stringify(index, null, 2)}\n`;

// The timestamp changes on every run, so compare without it when checking.
function withoutTimestamp(text) {
  return text.replace(/"generated_at": "[^"]*",\n/, '');
}

if (checkOnly) {
  let existing;
  try {
    existing = await readFile(OUT, 'utf8');
  } catch {
    console.error('site/index.json is missing. Run `npm run build`.');
    process.exit(1);
  }
  if (withoutTimestamp(existing) !== withoutTimestamp(serialised)) {
    console.error('site/index.json is out of date. Run `npm run build` and commit the result.');
    process.exit(1);
  }
  console.log(`site/index.json is current (${index.count} records).`);
  process.exit(0);
}

await writeFile(OUT, serialised, 'utf8');
console.log(`Wrote ${OUT} (${index.count} records, ${index.categories.length} categories).`);
