# Diseases

**Agents · Aetiology · Pathophysiology · Control and Management**

A structured reference of livestock disease, organised around the four pillars in the
title. Every record answers the same four questions in the same order, so that
comparison across diseases is possible and the causal chain — from agent to lesion to
intervention — is always explicit.

There are **38 records** across five categories, weighted toward the diseases that
matter in southern African livestock production.

---

## Why the structure is the point

Most disease references are organised as prose. That is good for reading and bad for
reasoning, because it lets a description stand in for an explanation.

Here, each record must supply:

| Pillar | The question it forces you to answer |
|---|---|
| **Agents** | What is the cause — pathogen, toxin, mineral, management factor or gene? Named precisely, with its toxins, vectors and reservoir where they apply. |
| **Aetiology** | What has to be *true* for disease to occur? Determinants and risk factors, not just a list of causes. |
| **Pathophysiology** | An ordered cascade from exposure to lesion, plus the clinical signs that the cascade explains. |
| **Control and management** | Prevention, vaccination, treatment, outbreak response and public health — kept separate, because they are different jobs with different owners. |

The most useful field is `pathophysiology.cascade`. A record cannot be filed with a
single step, because one step is a statement rather than a mechanism.

---

## Quick start

```bash
npm run validate   # structural + integrity checks across the corpus
npm run build      # regenerate site/index.json
npm test           # 16 tests: schema, data quality, build freshness, helpers
npm run check      # all three, in the order CI uses
npm run serve      # http://localhost:4173 — the static viewer
```

No dependencies. Node 20 or newer. Nothing is compiled.

---

## Layout

```
data/
  schema.json           JSON Schema for editor support (the validator is authoritative)
  diseases/*.json       one record per disease, filename === slug
tools/
  lib.mjs               shared loader — the single definition of "a record"
  validate.mjs          shape + cross-record integrity
  build.mjs             data/ → site/index.json (--check for CI)
  serve.mjs             dependency-free static server
site/
  index.html            the viewer — one file, no framework, no build step
  index.json            generated; committed so the site works from a static host
test/
  validate.test.mjs     the corpus is tested like code, because it is code
```

Adding a disease means adding one file. Adding a *field* means editing the schema,
the validator, the viewer and the tests — which is deliberate friction.

---

## What the validator enforces

Beyond required keys and types, `tools/validate.mjs` enforces rules a JSON Schema
cannot express, because they span records:

- **Slug and filename agree.** `anthrax.json` must declare `"slug": "anthrax"`.
- **Category and agent are coherent.** A record filed as `infectious` must name a
  biological agent; `parasitic` needs a protozoan, helminth or arthropod; `toxic`
  needs a toxin or mycotoxin. This is the check that stops a record being
  classified as infectious while listing no pathogen at all.
- **Cross-references resolve.** Every `related` slug must exist. A dangling link is
  a silent dead end in the viewer, so it fails the build instead.
- **Names and synonyms are unique.** Searching for "redwater" should not be
  ambiguous because two records claim it.
- **No stub records.** Each must carry substantive aetiology and pathophysiology
  summaries, at least two cascade steps, clinical signs, prevention and a reference.
- **Zoonoses declare their status.** A zoonotic record must state whether it is
  WOAH-listed; if it is not, a note is required so that the absence is a decision
  rather than an omission.
- **No placeholder text.** `TODO`, `TBD`, `lorem ipsum` and friends fail the build.

Warnings — such as a record offering no treatment without explaining why — are
printed but do not fail, so they can be triaged deliberately rather than reflexively.

---

## Coverage

| Category | Records | Examples |
|---|---|---|
| Infectious | 17 | Anthrax, FMD, rabies, brucellosis, heartwater, theileriosis, PPR |
| Parasitic | 7 | Babesiosis, anaplasmosis, haemonchosis, fasciolosis, coccidiosis, mange |
| Toxic | 4 | Aflatoxicosis, nitrate, prussic acid, botulism |
| Metabolic | 3 | Milk fever, ketosis, laminitis |
| Nutritional | 7 | Grass tetany, copper, cobalt, selenium, zinc deficiency |
| **Total** | **38** | 11 zoonotic · 12 WOAH-listed |

**Not a clinical manual.** These records support structured reasoning and teaching.
They do not replace a veterinary diagnosis, a withdrawal-period check, or local
regulatory requirements. Drug doses are deliberately not given — those belong in a
formulary that is current for the jurisdiction, not in a reference file that nobody
re-validates.

---

## Design decisions

**No dependencies, no build step for the viewer.** `site/index.html` fetches
`index.json` at runtime. It runs from a static host, from a USB stick, or from
`file://` with a one-line server. Nothing to break, nothing to upgrade.

**The index is committed.** The site works the moment it is cloned. CI checks that
the committed index matches the source with `npm run build --check`, so it cannot
drift silently.

**Species focus.** Weighted toward cattle, sheep and goats in southern Africa, which
is where this reference is used. The structure is species-agnostic; adding poultry or
swine records requires no code changes.

**Honest about uncertainty.** Where a diagnosis depends on excluding alternatives, or
where a control measure does not work as commonly assumed (tuberculin sensitivity,
anthelmintic resistance), the record says so in `control.notes`.

---

## Licence

GNU General Public License v3.0 — see [`licence`](licence).
