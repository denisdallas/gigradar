import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  normalizeOsmBusiness,
  normalizeWebsite,
  opportunityDedupeKey,
} from "../lib/discovery/normalization.mjs";

test("normalizes only public HTTP(S) website links", () => {
  assert.equal(normalizeWebsite("example.org"), "https://example.org/");
  assert.equal(normalizeWebsite("mailto:owner@example.org"), null);
  assert.equal(normalizeWebsite("http://localhost/admin"), null);
  assert.equal(normalizeWebsite("https://user:pass@example.org"), null);
});

test("cleans source text without treating it as instructions", () => {
  assert.equal(cleanText("<p>Build &amp; ship</p>"), "Build & ship");
});

test("maps a named OSM listing to a sourced prospect and rejects unnamed records", () => {
  const country = { code: "HR", name: "Croatia" };
  const result = normalizeOsmBusiness({
    type: "node",
    id: 42,
    lat: 45.8,
    lon: 15.9,
    tags: { name: "Example Guesthouse", tourism: "guest_house", website: "example.org" },
  }, country);
  assert.equal(result.kind, "business_prospect");
  assert.equal(result.country_code, "HR");
  assert.equal(result.website_url, "https://example.org/");
  assert.match(result.source_url, /openstreetmap\.org\/node\/42$/);
  assert.equal(normalizeOsmBusiness({ type: "node", id: 43, tags: {} }, country), null);
});

test("uses a stable source key for idempotent imports", () => {
  assert.equal(opportunityDedupeKey("OpenStreetMap", "node/42"), "openstreetmap:node/42");
});

