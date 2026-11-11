/**
 * Shared data access for the disease reference.
 *
 * Every tool (validate, build, serve, test) reads the corpus through this
 * module so that "what counts as a record" is defined in exactly one place.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DATA_DIR = join(ROOT, 'data', 'diseases');
export const RECORD_SUFFIX = '.json';

/** Categories, in the order they should appear in navigation. */
export const CATEGORY_ORDER = [
  'infectious',
  'parasitic',
  'toxic',
  'metabolic',
  'nutritional',
  'genetic',
  'immune-mediated',
  'degenerative',
];

export const CATEGORY_LABELS = {
  infectious: 'Infectious',
  parasitic: 'Parasitic',
  toxic: 'Toxic',
  metabolic: 'Metabolic',
  nutritional: 'Nutritional',
  genetic: 'Genetic',
  'immune-mediated': 'Immune-mediated',
  degenerative: 'Degenerative',
};

/** Agent kinds that make a record unambiguously biological. */
export const BIOLOGICAL_AGENT_KINDS = new Set([
  'bacterium',
  'virus',
  'fungus',
  'protozoan',
  'helminth',
  'arthropod',
  'prion',
]);

/**
 * List record files on disk, sorted for deterministic output.
 * @returns {Promise<string[]>} absolute paths, sorted by filename
 */
export async function listRecordFiles() {
  let entries;
  try {
    entries = await readdir(DATA_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(RECORD_SUFFIX))
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(DATA_DIR, name));
}

/**
 * Read every record as { file, slugFromFile, record, parseError }.
 * Parse errors are returned rather than thrown so the validator can report
 * them alongside structural problems instead of dying on the first bad file.
 */
export async function readRecords() {
  const files = await listRecordFiles();
  const out = [];
  for (const file of files) {
    const slugFromFile = basename(file, RECORD_SUFFIX);
    let record;
    let parseError = null;
    try {
      record = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      parseError = error;
    }
    out.push({ file, slugFromFile, record, parseError });
  }
  return out;
}

/** Collapse whitespace and trim — used for duplicate detection. */
export function normaliseText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Case- and punctuation-insensitive key for name collision checks.
 *
 * Apostrophes are deleted rather than replaced so that "Barber's pole worm"
 * and "Barbers pole worm" collapse to the same key; every other separator
 * becomes a single space.
 */
export function nameKey(value) {
  return normaliseText(value)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** kebab-case slug from an arbitrary string. */
export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the index the viewer consumes: lightweight summaries plus the full
 * records, with categories ordered for navigation.
 */
export function buildIndex(records) {
  const sorted = [...records].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
    return a.name.localeCompare(b.name);
  });

  return {
    generated_at: new Date().toISOString(),
    count: sorted.length,
    categories: CATEGORY_ORDER.map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      count: sorted.filter((r) => r.category === id).length,
    })).filter((category) => category.count > 0),
    diseases: sorted,
  };
}
