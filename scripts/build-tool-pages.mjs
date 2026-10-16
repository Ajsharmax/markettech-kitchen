// Generates one static HTML page per ready tool from the registry, so every tool has a real URL.
// Run: node scripts/build-tool-pages.mjs
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public", "applications");
const { APPLICATIONS } = await import(pathToFileURL(path.join(dir, "registry.js")).href);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

const page = t => `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f3f5ff">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="description" content="${esc(t.description)} Runs in your browser; files are never uploaded.">
<title>${esc(t.name)} — MarketTech Applications</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css?v=kinetic-2">
<link rel="stylesheet" href="/applications/applications.css?v=kinetic-2">
<link rel="stylesheet" href="/applications/toolkit.css?v=kinetic-2">${t.css ? `\n<link rel="stylesheet" href="${t.css}?v=kinetic-2">` : ""}
<script src="/theme.js?v=1"></script>
<script type="module" src="/applications/tool.js?v=1"></script>
</head>
<body class="applications-page tk-page" data-tool="${t.slug}">
<div class="apps-kinetic-bg" aria-hidden="true"><span class="apps-orb apps-orb-a"></span><span class="apps-orb apps-orb-b"></span><span class="apps-orb apps-orb-c"></span></div>
<header class="applications-header"><a class="applications-brand" href="/" aria-label="MarketTech home"><img src="/images/markettech-tech-logo.svg?v=2" alt="MarketTech — Smart Shopping &amp; Smart Tools" width="228" height="76"></a><nav aria-label="Applications navigation"><a href="/">Store</a><a href="/applications">Applications</a></nav></header>
<main class="tk-main${t.wide ? " wide" : ""}">
<p class="tk-crumbs"><a href="/applications">← All applications</a></p>
<header class="tk-head"><p class="applications-eyebrow">${esc(t.category.toUpperCase())}</p><h1>${esc(t.name)}</h1><p>${esc(t.description)}</p><span class="tk-privacy">Your files are processed on your device and never uploaded.</span></header>
<noscript><p class="tk-note">This tool needs JavaScript turned on.</p></noscript>
<div id="tool-root"></div>
<nav class="tk-more" aria-label="More tools"><h2>More tools</h2><div id="more-tools"></div></nav>
</main>
<footer class="applications-footer"><span>MarketTech Applications</span><a href="/">Back to MarketTech ↗</a></footer>
</body>
</html>
`;

const keep = new Set(["index.html"]);
const made = new Set();
for (const t of APPLICATIONS.filter(t => t.status === "ready")) { writeFileSync(path.join(dir, t.slug + ".html"), page(t)); made.add(t.slug + ".html"); }
// remove stale generated pages and the old placeholders
for (const f of readdirSync(dir)) if (f.endsWith(".html") && !keep.has(f) && !made.has(f)) { unlinkSync(path.join(dir, f)); console.log("removed", f); }
console.log("wrote", made.size, "tool pages");
