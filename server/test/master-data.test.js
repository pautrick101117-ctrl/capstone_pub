import test from "node:test";
import assert from "node:assert/strict";
import { MASTER_DATA_CATEGORIES, normalizeMasterCategory } from "../src/lib/masterData.js";

test("master-data categories cover the controlled portal lists", () => {
  for (const category of ["purok", "administration_term", "concern_category", "event_category", "official_position"]) {
    assert.ok(MASTER_DATA_CATEGORIES.includes(category));
  }
});

test("master-data category normalization is predictable", () => {
  assert.equal(normalizeMasterCategory("Administration-Term"), "administration_term");
  assert.equal(normalizeMasterCategory(" concern category "), "concern_category");
});
