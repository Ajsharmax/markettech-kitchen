import { APPLICATIONS, APPLICATION_CATEGORIES } from "/applications/registry.js?v=20261010-2";
const root = document.getElementById("applications-results");
const search = document.getElementById("applications-search");
const chips = document.getElementById("applications-categories");
const count = document.getElementById("applications-count");
const empty = document.getElementById("applications-empty");
let activeCategory = "All";
document.getElementById("applications-year").textContent = new Date().getFullYear();
const allCategories = ["All", ...APPLICATION_CATEGORIES];
allCategories.forEach(category => {
  const button = document.createElement("button");
  button.type = "button"; button.className = "applications-chip"; button.textContent = category;
  button.setAttribute("aria-pressed", String(category === activeCategory));
  button.addEventListener("click", () => { activeCategory = category; [...chips.children].forEach(chip => chip.setAttribute("aria-pressed", String(chip.textContent === category))); render(); });
  chips.append(button);
});
function makeCard(tool) {
  const card = document.createElement(tool.status === "ready" && tool.loader ? "a" : "div");
  card.className = "application-card" + (tool.status === "ready" ? "" : " is-coming");
  if (tool.status === "ready" && tool.loader) card.href = tool.loader;
  else { card.setAttribute("aria-disabled", "true"); card.tabIndex = -1; }
  const top = document.createElement("div"); top.className = "application-card-top";
  const icon = document.createElement("span"); icon.className = "application-icon"; icon.textContent = tool.icon; icon.setAttribute("aria-hidden","true");
  const badges = document.createElement("span"); badges.className = "application-badges";
  if (tool.featured) { const featured = document.createElement("span"); featured.className = "application-badge featured"; featured.textContent = "Featured"; badges.append(featured); }
  if (tool.status !== "ready") { const coming = document.createElement("span"); coming.className = "application-badge"; coming.textContent = "Coming soon"; badges.append(coming); }
  top.append(icon,badges);
  const title = document.createElement("h4"); title.textContent = tool.name;
  const description = document.createElement("p"); description.textContent = tool.description;
  const offline = document.createElement("div"); offline.className = "application-offline";
  const dot = document.createElement("span"); dot.setAttribute("aria-hidden","true"); offline.append(dot,document.createTextNode("Works offline in your browser"));
  card.append(top,title,description,offline);
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