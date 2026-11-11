#!/usr/bin/env node
/**
 * Validates every record in data/diseases/.
 *
 * Two classes of check:
 *   1. Shape   — required keys, types, enums, minimum lengths.
 *   2. Integrity — rules that a JSON Schema cannot express across records:
 *                  slug/file agreement, category/agent coherence, broken
 *                  `related` links, duplicate names, orphan synonyms.
 *
 * Exit code 0 when clean, 1 when any error is found. Warnings never fail
 * the build; they are printed so they can be triaged deliberately.
 */

import { readRecords, CATEGORY_ORDER, BIOLOGICAL_AGENT_KINDS, nameKey } from './lib.mjs';

const AGENT_KINDS = new Set([
  'bacterium', 'virus', 'fungus', 'protozoan', 'helminth', 'arthropod',
  'prion', 'toxin', 'mycotoxin', 'mineral', 'management', 'genetic', 'immune',
]);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TOP_LEVEL_KEYS = new Set([
  'slug', 'name', 'synonyms', 'category', 'agents', 'hosts', 'zoonotic',
  'notifiable', 'distribution', 'aetiology', 'pathophysiology', 'diagnosis',
  'control', 'prognosis', 'related', 'references',
]);

const errors = [];
const warnings = [];

const err = (slug, path, message) => errors.push({ slug, path, message });
const warn = (slug, path, message) => warnings.push({ slug, path, message });

const isString = (v) => typeof v === 'string';
const isNonEmptyString = (v) => isString(v) && v.trim().length > 0;
const isStringArray = (v) => Array.isArray(v) && v.every(isNonEmptyString);

/** Check a value is an array of non-empty strings meeting a minimum length. */
function checkStringArray(slug, path, value, { min = 0, minLength = 1 } = {}) {
  if (!Array.isArray(value)) {
    err(slug, path, 'must be an array');
    return false;
  }
  if (value.length < min) {
    err(slug, path, `must contain at least ${min} item(s), found ${value.length}`);
  }
  let ok = true;
  value.forEach((item, i) => {
    if (!isString(item)) {
      err(slug, `${path}[${i}]`, 'must be a string');
      ok = false;
    } else if (item.trim().length < minLength) {
      err(slug, `${path}[${i}]`, `must be at least ${minLength} characters`);
      ok = false;
    }
  });
  return ok;
}

/** Reject repeated values inside one array (case-insensitive). */
function checkNoDuplicatesInArray(slug, path, value) {
  if (!Array.isArray(value)) return;
  const seen = new Map();
  for (const item of value) {
    if (!isString(item)) continue;
    const key = nameKey(item);
    if (seen.has(key)) {
      err(slug, path, `duplicate entry ${JSON.stringify(item)} (also at index ${seen.get(key)})`);
    } else {
      seen.set(key, seen.size);
    }
  }
}

function checkRequiredString(slug, path, value, minLength = 2, parent = '') {
  const full = parent ? `${parent}.${path}` : path;
  if (value === undefined) {
    err(slug, full, 'is required');
    return false;
  }
  if (!isString(value)) {
    err(slug, full, 'must be a string');
    return false;
  }
  if (value.trim().length < minLength) {
    err(slug, full, `must be at least ${minLength} characters`);
    return false;
  }
  return true;
}

function validateRecord({ record, slugFromFile }) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    err(slugFromFile, '(root)', 'must be a JSON object');
    return null;
  }

  const slug = isNonEmptyString(record.slug) ? record.slug : slugFromFile;

  // ---- unexpected keys ----------------------------------------------------
  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      err(slug, key, `unexpected key (allowed: ${[...TOP_LEVEL_KEYS].join(', ')})`);
    }
  }

  // ---- identity -----------------------------------------------------------
  if (checkRequiredString(slug, 'slug', record.slug)) {
    if (!SLUG_RE.test(record.slug)) {
      err(slug, 'slug', 'must be kebab-case: lowercase letters, digits and single hyphens');
    }
    if (record.slug !== slugFromFile) {
      err(slug, 'slug', `must match the filename (${slugFromFile}.json)`);
    }
  }
  checkRequiredString(slug, 'name', record.name);

  if (record.synonyms !== undefined) {
    if (checkStringArray(slug, 'synonyms', record.synonyms, { minLength: 2 })) {
      checkNoDuplicatesInArray(slug, 'synonyms', record.synonyms);
      const self = nameKey(record.name ?? '');
      for (const synonym of record.synonyms) {
        if (nameKey(synonym) === self) {
          err(slug, 'synonyms', `synonym ${JSON.stringify(synonym)} repeats the record's own name`);
        }
      }
    }
  }

  // ---- classification -----------------------------------------------------
  if (!CATEGORY_ORDER.includes(record.category)) {
    err(slug, 'category', `must be one of: ${CATEGORY_ORDER.join(', ')}`);
  }

  // ---- agents -------------------------------------------------------------
  let biologicalAgents = 0;
  let toxicAgents = 0;
  if (!Array.isArray(record.agents) || record.agents.length === 0) {
    err(slug, 'agents', 'must be a non-empty array');
  } else {
    record.agents.forEach((agent, i) => {
      const path = `agents[${i}]`;
      if (agent === null || typeof agent !== 'object' || Array.isArray(agent)) {
        err(slug, path, 'must be an object');
        return;
      }
      for (const key of Object.keys(agent)) {
        if (!['kind', 'name', 'notes', 'toxins', 'vector', 'reservoir'].includes(key)) {
          err(slug, `${path}.${key}`, 'unexpected key');
        }
      }
      if (!AGENT_KINDS.has(agent.kind)) {
        err(slug, `${path}.kind`, `must be one of: ${[...AGENT_KINDS].join(', ')}`);
      } else if (BIOLOGICAL_AGENT_KINDS.has(agent.kind)) {
        biologicalAgents += 1;
      } else if (agent.kind === 'toxin' || agent.kind === 'mycotoxin') {
        toxicAgents += 1;
      }
      checkRequiredString(slug, 'name', agent.name, 2, path);
      if (agent.toxins !== undefined) {
        checkStringArray(slug, `${path}.toxins`, agent.toxins);
      }
      for (const key of ['notes', 'vector', 'reservoir']) {
        if (agent[key] !== undefined && !isString(agent[key])) {
          err(slug, `${path}.${key}`, 'must be a string');
        }
      }
    });
  }

  // Category/agent coherence: this is the check that stops a record being
  // filed as infectious while listing no pathogen at all.
  if (record.category === 'infectious' && Array.isArray(record.agents) && biologicalAgents === 0) {
    err(slug, 'agents', 'category "infectious" requires at least one biological agent kind');
  }
  if (record.category === 'parasitic' && Array.isArray(record.agents)) {
    const parasitic = record.agents.some((a) =>
      a && ['protozoan', 'helminth', 'arthropod'].includes(a.kind));
    if (!parasitic) {
      err(slug, 'agents', 'category "parasitic" requires a protozoan, helminth or arthropod agent');
    }
  }
  if (record.category === 'toxic' && Array.isArray(record.agents) && toxicAgents === 0) {
    err(slug, 'agents', 'category "toxic" requires at least one toxin or mycotoxin agent');
  }

  // ---- hosts --------------------------------------------------------------
  if (record.hosts === null || typeof record.hosts !== 'object' || Array.isArray(record.hosts)) {
    err(slug, 'hosts', 'must be an object');
  } else {
    for (const key of Object.keys(record.hosts)) {
      if (!['primary', 'also', 'notes'].includes(key)) {
        err(slug, `hosts.${key}`, 'unexpected key');
      }
    }
    checkStringArray(slug, 'hosts.primary', record.hosts.primary, { min: 1 });
    if (record.hosts.also !== undefined) {
      checkStringArray(slug, 'hosts.also', record.hosts.also);
      if (Array.isArray(record.hosts.primary) && Array.isArray(record.hosts.also)) {
        const primary = new Set(record.hosts.primary.map(nameKey));
        for (const host of record.hosts.also) {
          if (primary.has(nameKey(host))) {
            err(slug, 'hosts.also', `${JSON.stringify(host)} already appears in hosts.primary`);
          }
        }
      }
    }
    if (record.hosts.notes !== undefined && !isString(record.hosts.notes)) {
      err(slug, 'hosts.notes', 'must be a string');
    }
  }

  // ---- flags --------------------------------------------------------------
  if (typeof record.zoonotic !== 'boolean') {
    err(slug, 'zoonotic', 'must be true or false — an explicit judgement, not an omission');
  }
  if (record.notifiable === null || typeof record.notifiable !== 'object' || Array.isArray(record.notifiable)) {
    err(slug, 'notifiable', 'must be an object with a boolean "woah" field');
  } else {
    for (const key of Object.keys(record.notifiable)) {
      if (!['woah', 'national', 'note'].includes(key)) {
        err(slug, `notifiable.${key}`, 'unexpected key');
      }
    }
    if (typeof record.notifiable.woah !== 'boolean') {
      err(slug, 'notifiable.woah', 'must be true or false');
    }
    if (record.notifiable.national !== undefined && typeof record.notifiable.national !== 'boolean') {
      err(slug, 'notifiable.national', 'must be true or false');
    }
    if (record.notifiable.note !== undefined && !isString(record.notifiable.note)) {
      err(slug, 'notifiable.note', 'must be a string');
    }
  }
  // Zoonoses are the reason the flag exists; a zoonotic record that is not
  // WOAH-listed should say so, because readers will assume otherwise.
  if (record.zoonotic === true && record.notifiable && record.notifiable.woah === false &&
      !record.notifiable.note) {
    warn(slug, 'notifiable.note', 'zoonotic but not WOAH-listed — add a note so the gap is deliberate');
  }

  if (record.distribution !== undefined && !isString(record.distribution)) {
    err(slug, 'distribution', 'must be a string');
  }

  // ---- aetiology ----------------------------------------------------------
  if (record.aetiology === null || typeof record.aetiology !== 'object' || Array.isArray(record.aetiology)) {
    err(slug, 'aetiology', 'must be an object');
  } else {
    for (const key of Object.keys(record.aetiology)) {
      if (!['summary', 'determinants', 'risk_factors', 'epidemiology'].includes(key)) {
        err(slug, `aetiology.${key}`, 'unexpected key');
      }
    }
    checkRequiredString(slug, 'summary', record.aetiology.summary, 40, 'aetiology');
    checkStringArray(slug, 'aetiology.determinants', record.aetiology.determinants, { min: 1, minLength: 5 });
    checkNoDuplicatesInArray(slug, 'aetiology.determinants', record.aetiology.determinants);
    checkStringArray(slug, 'aetiology.risk_factors', record.aetiology.risk_factors, { min: 1, minLength: 5 });
    checkNoDuplicatesInArray(slug, 'aetiology.risk_factors', record.aetiology.risk_factors);
    if (record.aetiology.epidemiology !== undefined && !isString(record.aetiology.epidemiology)) {
      err(slug, 'aetiology.epidemiology', 'must be a string');
    }
  }

  // ---- pathophysiology ----------------------------------------------------
  if (record.pathophysiology === null || typeof record.pathophysiology !== 'object' ||
      Array.isArray(record.pathophysiology)) {
    err(slug, 'pathophysiology', 'must be an object');
  } else {
    for (const key of Object.keys(record.pathophysiology)) {
      if (!['summary', 'cascade', 'lesions', 'clinical_signs'].includes(key)) {
        err(slug, `pathophysiology.${key}`, 'unexpected key');
      }
    }
    checkRequiredString(slug, 'summary', record.pathophysiology.summary, 40, 'pathophysiology');
    if (!Array.isArray(record.pathophysiology.cascade) || record.pathophysiology.cascade.length < 2) {
      err(slug, 'pathophysiology.cascade',
        'must be an array of at least 2 steps — a single step is a statement, not a mechanism');
    } else {
      record.pathophysiology.cascade.forEach((step, i) => {
        const path = `pathophysiology.cascade[${i}]`;
        if (step === null || typeof step !== 'object' || Array.isArray(step)) {
          err(slug, path, 'must be an object');
          return;
        }
        for (const key of Object.keys(step)) {
          if (!['title', 'detail'].includes(key)) err(slug, `${path}.${key}`, 'unexpected key');
        }
        checkRequiredString(slug, 'title', step.title, 3, path);
        checkRequiredString(slug, 'detail', step.detail, 20, path);
      });
    }
    checkStringArray(slug, 'pathophysiology.lesions', record.pathophysiology.lesions, { min: 1, minLength: 5 });
    checkNoDuplicatesInArray(slug, 'pathophysiology.lesions', record.pathophysiology.lesions);
    checkStringArray(slug, 'pathophysiology.clinical_signs', record.pathophysiology.clinical_signs,
      { min: 1, minLength: 3 });
    checkNoDuplicatesInArray(slug, 'pathophysiology.clinical_signs', record.pathophysiology.clinical_signs);
  }

  // ---- diagnosis ----------------------------------------------------------
  if (record.diagnosis === null || typeof record.diagnosis !== 'object' || Array.isArray(record.diagnosis)) {
    err(slug, 'diagnosis', 'must be an object');
  } else {
    for (const key of Object.keys(record.diagnosis)) {
      if (!['antemortem', 'postmortem', 'laboratory', 'differentials'].includes(key)) {
        err(slug, `diagnosis.${key}`, 'unexpected key');
      }
    }
    for (const key of ['antemortem', 'postmortem']) {
      if (record.diagnosis[key] !== undefined) {
        checkStringArray(slug, `diagnosis.${key}`, record.diagnosis[key], { minLength: 5 });
      }
    }
    checkStringArray(slug, 'diagnosis.laboratory', record.diagnosis.laboratory, { min: 1, minLength: 5 });
    checkStringArray(slug, 'diagnosis.differentials', record.diagnosis.differentials, { min: 1, minLength: 3 });
    checkNoDuplicatesInArray(slug, 'diagnosis.differentials', record.diagnosis.differentials);
  }

  // ---- control ------------------------------------------------------------
  if (record.control === null || typeof record.control !== 'object' || Array.isArray(record.control)) {
    err(slug, 'control', 'must be an object');
  } else {
    for (const key of Object.keys(record.control)) {
      if (!['prevention', 'vaccination', 'treatment', 'outbreak', 'public_health', 'notes'].includes(key)) {
        err(slug, `control.${key}`, 'unexpected key');
      }
    }
    checkStringArray(slug, 'control.prevention', record.control.prevention, { min: 1, minLength: 5 });
    checkNoDuplicatesInArray(slug, 'control.prevention', record.control.prevention);
    for (const key of ['treatment', 'outbreak', 'public_health']) {
      if (record.control[key] !== undefined) {
        checkStringArray(slug, `control.${key}`, record.control[key], { minLength: 5 });
      }
    }
    if (record.control.treatment === undefined) {
      err(slug, 'control.treatment', 'is required — use an empty array if there is no practical treatment');
    } else if (Array.isArray(record.control.treatment) && record.control.treatment.length === 0 &&
               !record.control.notes) {
      warn(slug, 'control.notes',
        'no treatment offered but no note explains why — readers will assume an omission');
    }
    for (const key of ['vaccination', 'notes']) {
      if (record.control[key] !== undefined && !isString(record.control[key])) {
        err(slug, `control.${key}`, 'must be a string');
      }
    }
  }

  if (record.prognosis !== undefined && !isString(record.prognosis)) {
    err(slug, 'prognosis', 'must be a string');
  }

  // ---- references ---------------------------------------------------------
  if (!Array.isArray(record.references) || record.references.length === 0) {
    err(slug, 'references', 'must be a non-empty array — an unsourced claim is not a reference entry');
  } else {
    record.references.forEach((ref, i) => {
      const path = `references[${i}]`;
      if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
        err(slug, path, 'must be an object');
        return;
      }
      for (const key of Object.keys(ref)) {
        if (!['label', 'url'].includes(key)) err(slug, `${path}.${key}`, 'unexpected key');
      }
      checkRequiredString(slug, 'label', ref.label, 3, path);
      if (checkRequiredString(slug, 'url', ref.url, 8, path)) {
        if (!/^https?:\/\//.test(ref.url)) {
          err(slug, `${path}.url`, 'must start with http:// or https://');
        }
      }
    });
  }

  return slug;
}

async function main() {
  const entries = await readRecords();

  if (entries.length === 0) {
    console.error('No records found in data/diseases/.');
    process.exit(1);
  }

  const parsed = [];
  for (const entry of entries) {
    if (entry.parseError) {
      err(entry.slugFromFile, '(root)', `invalid JSON: ${entry.parseError.message}`);
      continue;
    }
    const slug = validateRecord(entry);
    if (slug) parsed.push({ slug, record: entry.record });
  }

  // ---- cross-record integrity --------------------------------------------
  const slugs = new Map();
  for (const { slug } of parsed) {
    if (slugs.has(slug)) {
      err(slug, 'slug', 'duplicate slug across records');
    }
    slugs.set(slug, true);
  }

  // `related` must resolve. A dangling link is a silent 404 in the viewer.
  const relatedSlugs = parsed.flatMap(({ slug, record }) =>
    Array.isArray(record.related) ? record.related.map((target) => ({ slug, target })) : []);

  for (const { slug, target } of relatedSlugs) {
    if (!isString(target)) {
      err(slug, 'related', 'entries must be strings');
    } else if (!slugs.has(target)) {
      err(slug, 'related', `unknown slug ${JSON.stringify(target)} — no such record`);
    } else if (target === slug) {
      err(slug, 'related', 'a record cannot relate to itself');
    }
  }

  // Name and synonym collisions make search ambiguous.
  const nameOwners = new Map();
  for (const { slug, record } of parsed) {
    const names = [record.name, ...(Array.isArray(record.synonyms) ? record.synonyms : [])];
    for (const name of names) {
      if (!isString(name)) continue;
      const key = nameKey(name);
      if (!key) continue;
      if (nameOwners.has(key)) {
        const owner = nameOwners.get(key);
        if (owner !== slug) {
          err(slug, 'name', `${JSON.stringify(name)} is already used by ${owner}`);
        }
      } else {
        nameOwners.set(key, slug);
      }
    }
  }

  // ---- report -------------------------------------------------------------
  const byCategory = new Map();
  for (const { record } of parsed) {
    byCategory.set(record.category, (byCategory.get(record.category) ?? 0) + 1);
  }

  const width = String(parsed.length).length;
  console.log(`\nValidated ${parsed.length} record(s).\n`);
  for (const category of CATEGORY_ORDER) {
    const count = byCategory.get(category);
    if (count) console.log(`  ${category.padEnd(18)} ${String(count).padStart(width)}`);
  }
  console.log('');

  for (const warning of warnings) {
    console.warn(`  warn  ${warning.slug} → ${warning.path}: ${warning.message}`);
  }
  if (warnings.length) console.log('');

  if (errors.length) {
    for (const error of errors) {
      console.error(`  FAIL  ${error.slug} → ${error.path}: ${error.message}`);
    }
    console.error(`\n${errors.length} error(s), ${warnings.length} warning(s).\n`);
    process.exit(1);
  }

  console.log(`OK — ${warnings.length} warning(s), 0 errors.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
