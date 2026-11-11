import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, readRecords, buildIndex, nameKey, slugify, CATEGORY_ORDER } from '../tools/lib.mjs';

const run = promisify(execFile);

describe('corpus', () => {
  test('has records and they all parse', async () => {
    const entries = await readRecords();
    assert.ok(entries.length > 0, 'expected at least one record');
    const broken = entries.filter((e) => e.parseError);
    assert.deepEqual(
      broken.map((e) => `${e.slugFromFile}: ${e.parseError.message}`),
      [],
      'unparseable records',
    );
  });

  test('passes the validator with no errors', async () => {
    const { stderr } = await run(process.execPath, [join(ROOT, 'tools', 'validate.mjs')], {
      cwd: ROOT,
    }).catch((error) => ({ stderr: error.stdout ?? error.message, failed: true }));
    assert.equal(stderr.includes('FAIL'), false, `validator reported errors:\n${stderr}`);
  });

  test('every slug matches its filename', async () => {
    const entries = await readRecords();
    for (const { slugFromFile, record } of entries) {
      if (record?.slug) assert.equal(record.slug, slugFromFile, `${slugFromFile} slug mismatch`);
    }
  });

  test('every related link resolves to a real record', async () => {
    const entries = await readRecords();
    const slugs = new Set(entries.map((e) => e.slugFromFile));
    for (const { record } of entries) {
      for (const target of record?.related ?? []) {
        assert.ok(slugs.has(target), `${record.slug} → unknown ${target}`);
      }
    }
  });

  test('names and synonyms are unique across the corpus', async () => {
    const entries = await readRecords();
    const seen = new Map();
    for (const { record } of entries) {
      for (const name of [record?.name, ...(record?.synonyms ?? [])].filter(Boolean)) {
        const key = nameKey(name);
        const owner = seen.get(key);
        assert.ok(!owner || owner === record.slug,
          `"${name}" used by both ${owner} and ${record.slug}`);
        seen.set(key, record.slug);
      }
    }
  });

  test('every category used is a known category', async () => {
    const entries = await readRecords();
    for (const { record } of entries) {
      assert.ok(CATEGORY_ORDER.includes(record?.category),
        `${record?.slug} has unknown category ${record?.category}`);
    }
  });

  test('zoonotic records flag their notifiable status explicitly', async () => {
    const entries = await readRecords();
    for (const { record } of entries) {
      if (record?.zoonotic) {
        assert.equal(typeof record.notifiable?.woah, 'boolean',
          `${record.slug} is zoonotic but notifiable.woah is not a boolean`);
      }
    }
  });
});

describe('data quality guards', () => {
  test('no record is a stub — all four pillars are substantive', async () => {
    const entries = await readRecords();
    for (const { record } of entries) {
      const slug = record.slug;
      assert.ok(record.aetiology.summary.length >= 40, `${slug}: thin aetiology summary`);
      assert.ok(record.pathophysiology.summary.length >= 40, `${slug}: thin pathophysiology summary`);
      assert.ok(record.pathophysiology.cascade.length >= 2, `${slug}: cascade too short`);
      assert.ok(record.pathophysiology.clinical_signs.length >= 1, `${slug}: no clinical signs`);
      assert.ok(record.control.prevention.length >= 1, `${slug}: no prevention`);
      assert.ok(record.references.length >= 1, `${slug}: no references`);
    }
  });

  test('no record carries placeholder text', async () => {
    const entries = await readRecords();
    const banned = /\b(TODO|TBD|FIXME|lorem ipsum|placeholder|xxx)\b/i;
    for (const { record } of entries) {
      const text = JSON.stringify(record);
      assert.equal(banned.test(text), false, `${record.slug} contains placeholder text`);
    }
  });

  test('references point at http(s) URLs', async () => {
    const entries = await readRecords();
    for (const { record } of entries) {
      for (const ref of record.references ?? []) {
        assert.match(ref.url, /^https?:\/\//, `${record.slug}: bad url ${ref.url}`);
      }
    }
  });
});

describe('build output', () => {
  test('committed index.json is current', async () => {
    const result = await run(process.execPath, [join(ROOT, 'tools', 'build.mjs'), '--check'], {
      cwd: ROOT,
    }).catch((error) => ({ stderr: error.stdout ?? error.message, failed: true }));
    assert.ok(!result.failed, `build --check failed:\n${result.stderr}`);
  });

  test('index orders diseases by category then name', async () => {
    const entries = await readRecords();
    const index = buildIndex(entries.map((e) => e.record));
    const positions = index.diseases.map((d) => CATEGORY_ORDER.indexOf(d.category));
    for (let i = 1; i < positions.length; i += 1) {
      assert.ok(positions[i] >= positions[i - 1], 'categories are out of order');
    }
    assert.equal(index.count, entries.length);
  });

  test('category counts sum to the record count', async () => {
    const entries = await readRecords();
    const index = buildIndex(entries.map((e) => e.record));
    const sum = index.categories.reduce((total, c) => total + c.count, 0);
    assert.equal(sum, index.count);
  });

  test('viewer fetches the index it is served', async () => {
    const html = await readFile(join(ROOT, 'site', 'index.html'), 'utf8');
    assert.ok(html.includes("fetch('index.json')"), 'viewer does not fetch index.json');
  });
});

describe('helpers', () => {
  test('slugify produces kebab-case', () => {
    assert.equal(slugify('Foot-and-Mouth Disease'), 'foot-and-mouth-disease');
    assert.equal(slugify('  Milk Fever!  '), 'milk-fever');
    assert.equal(slugify('Peste des petits ruminants'), 'peste-des-petits-ruminants');
  });

  test('nameKey is case and punctuation insensitive', () => {
    assert.equal(nameKey('Blackleg'), nameKey('blackleg'));
    assert.equal(nameKey("Barber's pole worm"), nameKey('barbers pole worm'));
  });
});
