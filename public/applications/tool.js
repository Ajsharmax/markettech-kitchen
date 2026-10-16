import { APPLICATIONS, applicationHref } from "/applications/registry.js";
import { h, mountSpec, UserError } from "/applications/core.js";

const slug = document.body.dataset.tool;
const tool = APPLICATIONS.find(t => t.slug === slug && t.status === "ready");
const root = document.getElementById("tool-root");

async function start() {
  if (!tool) { root.append(h("p", { class: "tk-note" }, "This tool is not available yet."), h("a", { class: "tk-btn", href: "/applications" }, "Back to all tools")); return; }
  try {
    const mod = (await import("/applications/tools/" + tool.module + ".js")).default;
    const spec = mod[slug];
    if (!spec) throw new UserError("This tool could not be loaded.");
    if (spec.custom) spec.mount(root); else await mountSpec(root, spec);
  } catch (e) {
    console.error(e);
    root.append(h("p", { class: "tk-status error", role: "alert" }, "This tool failed to load: " + (e && e.message ? e.message : e) + " Reload the page and try again."));
  }
  const more = APPLICATIONS.filter(t => t.status === "ready" && t.slug !== slug).slice(0, 8);
  const nav = document.getElementById("more-tools");
  if (nav) for (const t of more) nav.append(h("a", { href: applicationHref(t) }, t.name));
}
start();
