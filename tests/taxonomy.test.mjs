import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_TYPES, TAXONOMY_IDS } from "../apps/api/src/domain/constants.mjs";
import { categoryExistsInTaxonomy, getTaxonomyForEntityYear } from "../apps/api/src/domain/taxonomies.mjs";

test("returns Schedule C taxonomy for sole prop", () => {
  const taxonomy = getTaxonomyForEntityYear(ENTITY_TYPES.SOLE_PROP, 2024);
  assert.ok(taxonomy);
  assert.equal(taxonomy.id, TAXONOMY_IDS.SCHEDULE_C_2024);
  assert.equal(categoryExistsInTaxonomy(taxonomy.id, "advertising"), true);
});

test("returns Form 1120 taxonomy for c-corp", () => {
  const taxonomy = getTaxonomyForEntityYear(ENTITY_TYPES.C_CORP, 2025);
  assert.ok(taxonomy);
  assert.equal(taxonomy.id, TAXONOMY_IDS.FORM_1120_2025);
  assert.equal(categoryExistsInTaxonomy(taxonomy.id, "owner_draw"), false);
});
