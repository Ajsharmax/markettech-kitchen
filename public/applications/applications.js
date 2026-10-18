import { APPLICATIONS, APPLICATION_CATEGORIES, applicationHref } from "/applications/registry.js?v=5";
const root = document.getElementById("applications-results");
const search = document.getElementById("applications-search");
const chips = document.getElementById("applications-categories");
const count = document.getElementById("applications-count");
const empty = document.getElementById("applications-empty");
let activeCategory = "All";
const footerYear = document.querySelector('[data-footer-year]');
if (footerYear) footerYear.textContent = new Date().getFullYear();
const allCategories = ["All", ...APPLICATION_CATEGORIES];
allCategories.forEach(category => {
  const button = document.createElement("button");
  button.type = "button"; button.className = "applications-chip"; button.textContent = category;
  button.setAttribute("aria-pressed", String(category === activeCategory));
  button.addEventListener("click", () => { activeCategory = category; [...chips.children].forEach(chip => chip.setAttribute("aria-pressed", String(chip.textContent === category))); render(); });
  chips.append(button);
});
function makeCard(tool) {
  const live = tool.status === "ready";
  const card = document.createElement(live ? "a" : "div");
  card.className = "application-card" + (tool.status === "ready" ? "" : " is-coming");
  if (live) card.href = applicationHref(tool);
  else { card.setAttribute("aria-disabled", "true"); card.tabIndex = -1; }
  const top = document.createElement("div"); top.className = "application-card-top";
  const icon = document.createElement("span"); icon.className = "application-icon"; icon.textContent = tool.icon; icon.setAttribute("aria-hidden","true");
  const badges = document.createElement("span"); badges.className = "application-badges";
  if (tool.featured) { const featured = document.createElement("span"); featured.className = "application-badge featured"; featured.textContent = "Featured"; badges.append(featured); }
  if (tool.status !== "ready") { const coming = document.createElement("span"); coming.className = "application-badge"; coming.textContent = "Coming soon"; badges.append(coming); }
  top.append(icon,badges);
  const title = document.createElement("h4"); title.textContent = tool.name;
  const description = document.createElement("p"); description.textContent = live ? tool.description : (tool.reason || tool.description);
  const offline = document.createElement("div"); offline.className = "application-offline";
  const dot = document.createElement("span"); dot.setAttribute("aria-hidden","true"); if (live) offline.append(dot,document.createTextNode("Works in your browser. No upload."));
  card.append(top,title,description);
  if (live) {
    const action = document.createElement("span"); action.className = "application-open"; action.textContent = "Open tool →";
    card.append(offline,action);
  }
  return card;
}
function render() {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = APPLICATIONS.filter(tool => (activeCategory === "All" || tool.category === activeCategory) &&
    [tool.name,tool.description,tool.category].join(" ").toLocaleLowerCase().includes(query));
  root.replaceChildren();
  const groups = activeCategory === "All" ? APPLICATION_CATEGORIES : [activeCategory];
  for (const category of groups) {
    const tools = visible.filter(tool => tool.category === category);
    if (!tools.length) continue;
    const section = document.createElement("section"); section.className = "applications-category";
    const heading = document.createElement("h3"); heading.textContent = category;
    const grid = document.createElement("div"); grid.className = "applications-card-grid";
    tools.forEach(tool => grid.append(makeCard(tool)));
    section.append(heading,grid); root.append(section);
  }
  count.textContent = visible.length + (visible.length === 1 ? " tool" : " tools");
  empty.hidden = visible.length !== 0;
}
search.addEventListener("input", render);
render();