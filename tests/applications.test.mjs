// Checks the Applications registry, generated pages and page-range parser. Run: node tests/applications.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const dir = path.resolve("public/applications");
const { APPLICATIONS, APPLICATION_CATEGORIES } = await import(pathToFileURL(path.join(dir, "registry.js")));
const { parseRanges, parseGroups, UserError } = await import(pathToFileURL(path.join(dir, "core.js")));
const slugs = new Set();
for (const t of APPLICATIONS) {
  assert.ok(!slugs.has(t.slug), "duplicate slug " + t.slug); slugs.add(t.slug);
  assert.ok(APPLICATION_CATEGORIES.includes(t.category), t.slug + " has unknown category " + t.category);
  if (t.status === "ready") {
    if (t.url) assert.ok(existsSync(path.resolve("public", "." + t.url)), "missing standalone page for " + t.slug);
    else {
      assert.ok(existsSync(path.join(dir, t.slug + ".html")), "missing page for " + t.slug);
      const src = readFileSync(path.join(dir, "tools", t.module + ".js"), "utf8");
      assert.ok(src.includes('["' + t.slug + '"]') || src.includes('"' + t.slug + '": {') || (t.slug === "emi-calculator" && src.includes("emi: {")), t.module + ".js has no spec for " + t.slug);
    }
  } else assert.ok(t.reason, t.slug + " is coming soon but has no reason");
}
assert.equal(existsSync(path.join(dir, "tool-2.html")), false);
const powerpoint = APPLICATIONS.find(t => t.slug === "pdf-to-powerpoint");
assert.equal(powerpoint.module, "convert", "PDF to PowerPoint should use the shared tool process");
assert.equal(powerpoint.url, undefined, "PDF to PowerPoint should not bypass the Applications tool page");
assert.ok(existsSync(path.join(dir, "vendor", "pptxgenjs-3.12.0.min.js")), "missing self-hosted PowerPoint library");
const powerpointPage = readFileSync(path.join(dir, "pdf-to-powerpoint.html"), "utf8");
assert.ok(powerpointPage.includes('data-tool="pdf-to-powerpoint"'));
assert.ok(powerpointPage.includes("/applications/tool.js"));
assert.ok(!powerpointPage.includes("cdnjs.cloudflare.com"), "PowerPoint page should not rely on a CDN");
assert.deepEqual(parseRanges("1-3, 5, 8-", 10), [1, 2, 3, 5, 8, 9, 10]);
assert.deepEqual(parseRanges("odd", 5), [1, 3, 5]);
assert.deepEqual(parseRanges("even", 5), [2, 4]);
assert.deepEqual(parseRanges("last, 1", 4), [1, 4]);
assert.deepEqual(parseGroups("1-2, 4", 5), [[1, 2], [4]]);
for (const bad of ["0", "6", "3-1", "abc", ""]) assert.throws(() => parseRanges(bad, 5), UserError);
console.log("applications tests passed (" + APPLICATIONS.length + " tools, " + APPLICATIONS.filter(t => t.status === "ready").length + " ready)");
