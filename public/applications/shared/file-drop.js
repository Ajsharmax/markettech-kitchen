/** Reusable browser-only file list with validation, removal and drag reordering. */
export class FileDropZone {
  constructor(root, { accept = ["application/pdf"], multiple = true, onChange = () => {} } = {}) {
    if (!root) throw new Error("FileDropZone needs a root element.");
    this.root = root;
    this.accept = new Set(accept);
    this.multiple = multiple;
    this.onChange = onChange;
    this.files = [];
    this.root.addEventListener("dragover", e => { e.preventDefault(); this.root.classList.add("is-dragover"); });
    this.root.addEventListener("dragleave", () => this.root.classList.remove("is-dragover"));
    this.root.addEventListener("drop", e => {
      e.preventDefault(); this.root.classList.remove("is-dragover");
      if (e.dataTransfer?.files) this.add(e.dataTransfer.files);
    });
  }
  add(fileList) {
    const accepted = [], rejected = [];
    for (const file of Array.from(fileList || [])) {
      const ext = file.name.split(".").pop().toLowerCase();
      const valid = this.accept.has(file.type) || (this.accept.has("application/pdf") && ext === "pdf") ||
        (this.accept.has("image/*") && /^image\/(png|jpeg|webp|gif)$/i.test(file.type));
      if (valid) accepted.push(file); else rejected.push(file.name);
    }
    this.files = (this.multiple ? this.files : []).concat(accepted);
    this.onChange(this.files.slice(), { rejected });
    return { accepted, rejected };
  }
  remove(index) { this.files.splice(index, 1); this.onChange(this.files.slice(), { rejected: [] }); }
  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.files.length || to >= this.files.length) return;
    const [file] = this.files.splice(from, 1); this.files.splice(to, 0, file);
    this.onChange(this.files.slice(), { rejected: [] });
  }
  clear() { this.files = []; this.onChange([], { rejected: [] }); }
  renderList(listElement) {
    listElement.replaceChildren();
    this.files.forEach((file, index) => {
      const row = document.createElement("li"); row.draggable = true; row.className = "application-file-row";
      row.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", String(index)); e.dataTransfer.effectAllowed = "move"; });
      row.addEventListener("dragover", e => { e.preventDefault(); });
      row.addEventListener("drop", e => { e.preventDefault(); const from = Number(e.dataTransfer.getData("text/plain")); this.move(from, index); });
      const name = document.createElement("span"); name.textContent = file.name;
      const size = document.createElement("small"); size.textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", "Remove " + file.name);
      remove.addEventListener("click", () => this.remove(index));
      row.append(name, size, remove); listElement.append(row);
    });
  }
}