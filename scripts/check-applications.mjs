// Syntax-checks the Applications ES modules. Needs Node 22+ (module syntax detection). Not part of `npm run check`.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const dir = "public/applications";
const files = ["core.js", "stage.js", "tool.js", "applications.js", "registry.js", ...readdirSync(path.join(dir, "tools")).map(f => "tools/" + f)];
let bad = 0;
for (const f of files) { const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: (await import("node:fs")).readFileSync(path.join(dir, f)), encoding: "utf8" }); if (r.status) { bad++; console.error(f + ":\n" + r.stderr); } }
if (bad) process.exit(1);
console.log("applications modules OK (" + files.length + " files)");
