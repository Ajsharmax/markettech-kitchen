// Checks the Applications registry, generated pages and page-range parser. Run: node tests/applications.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.resolve("public/applications");
const { APPLICATIONS, APPLICATION_CATEGORIES } = await import(pathToFileURL(path.join(dir, "registry.js")).href);
const { parseRanges, parseGroups, UserError } = await import(pathToFileURL(path.join(dir, "core.js")).href);

const slugs = new Set();
for (const t of APPLICATIONS) {
  assert.ok(!slugs.has(t.slug), "duplicate slug " + t.slug); slugs.add(t.slug);
  assert.ok(APPLICATION_CATEGORIES.includes(t.category), t.slug + " has unknown category " + t.category);
  if (t.status === "ready") {
    if (t.url) {
      const standalonePath = path.resolve("public", "." + t.url);
      assert.ok(existsSync(standalonePath), "missing standalone page for " + t.slug);
      const html = readFileSync(standalonePath, "utf8");
      assert.ok(html.includes("<title>") && html.includes('type="file"'), t.slug + " standalone page is missing its title or file input");
      assert.ok(html.includes('addEventListener("click",e=>e.stopPropagation())'), t.slug + " file picker click bubbles into its container");
      assert.ok(html.includes("worker-src 'self' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;"), t.slug + " CSP blocks its PDF/OCR workers");
      assert.ok(html.includes("const isPdf=f.type==="), t.slug + " rejects PDFs with an empty MIME type");
    } else {
      assert.ok(existsSync(path.join(dir, t.slug + ".html")), "missing page for " + t.slug + " (run node scripts/build-tool-pages.mjs)");
      const src = readFileSync(path.join(dir, "tools", t.module + ".js"), "utf8");
      assert.ok(src.includes('["' + t.slug + '"]') || src.includes('"' + t.slug + '": {'), t.module + ".js has no spec for " + t.slug);
      const html = readFileSync(path.join(dir, t.slug + ".html"), "utf8");
      assert.ok(html.includes('data-tool="' + t.slug + '"') && html.includes("connect-src 'self'"), t.slug + " page lacks tool id or privacy CSP");
    }
  } else assert.ok(t.reason, t.slug + " is coming soon but has no reason");
}
assert.equal(existsSync(path.join(dir, "tool-2.html")), false, "placeholder pages must be gone");

assert.deepEqual(parseRanges("1-3, 5, 8-", 10), [1, 2, 3, 5, 8, 9, 10]);
assert.deepEqual(parseRanges("odd", 5), [1, 3, 5]);
assert.deepEqual(parseRanges("even", 5), [2, 4]);
assert.deepEqual(parseRanges("last, 1", 4), [1, 4]);
assert.deepEqual(parseGroups("1-2, 4", 5), [[1, 2], [4]]);
for (const bad of ["0", "6", "3-1", "abc", ""]) assert.throws(() => parseRanges(bad, 5), UserError, "should reject " + JSON.stringify(bad));

const headers = readFileSync("public/_headers", "utf8");
assert.ok(/\/applications\/\*\n\s+Content-Security-Policy:[^\n]*connect-src 'self'/.test(headers), "applications CSP must block outbound connections");
console.log("applications tests passed (" + APPLICATIONS.length + " tools, " + APPLICATIONS.filter(t => t.status === "ready").length + " ready)");
