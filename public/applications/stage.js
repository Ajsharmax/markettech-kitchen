/* A rendered PDF page with draggable rectangles on top.
 * Rectangles are stored in PDF points, measured from the top-left of the displayed page. */
import { h } from "/applications/core.js";

const MIN = 8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createStage({ multi = false, aspect = null, variant = "", decorate = null, label = "Selection", maxWidth = 640 } = {}) {
  const canvas = h("canvas", { class: "tk-stage-canvas" });
  const overlay = h("div", { class: "tk-overlay" });
  const el = h("div", { class: "tk-stage", style: "max-width:" + maxWidth + "px" }, canvas, overlay);
  const api = { el, canvas, ptW: 1, ptH: 1, rects: [], sel: -1, onchange: () => {}, aspect };
  const asp = () => api.aspect;
  let drag = null;

  function toPts(e) {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * api.ptW, y: (e.clientY - r.top) / r.height * api.ptH };
  }
  function render() {
    overlay.replaceChildren();
    api.rects.forEach((r, i) => {
      const box = h("div", {
        class: "tk-rect " + variant + (i === api.sel ? " sel" : ""), tabindex: "0", role: "group", "aria-label": label + " " + (i + 1) + " of " + api.rects.length,
        dataset: { i },
        style: "left:" + r.x / api.ptW * 100 + "%;top:" + r.y / api.ptH * 100 + "%;width:" + r.w / api.ptW * 100 + "%;height:" + r.h / api.ptH * 100 + "%"
      });
      if (decorate) decorate(box, r);
      if (i === api.sel || !multi) {
        for (const d of (asp() ? ["nw", "ne", "sw", "se"] : ["nw", "n", "ne", "w", "e", "sw", "s", "se"])) box.append(h("span", { class: "tk-hd", dataset: { h: d } }));
      }
      overlay.append(box);
    });
  }
  api.render = render;
  api.show = (source, ptW, ptH) => {
    api.ptW = ptW; api.ptH = ptH;
    canvas.width = source.width; canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    el.style.aspectRatio = ptW + " / " + ptH;
    render();
  };
  api.setRects = list => { api.rects = list.map(r => ({ ...r })); api.sel = api.rects.length ? Math.min(Math.max(api.sel, 0), api.rects.length - 1) : -1; render(); };
  api.select = i => { api.sel = i; render(); };
  const emit = () => { render(); api.onchange(api.rects); };
  api.remove = i => { if (i < 0 || i >= api.rects.length) return; api.rects.splice(i, 1); api.sel = Math.min(api.sel, api.rects.length - 1); emit(); };
  api.clear = () => { api.rects = []; api.sel = -1; emit(); };
  api.update = (i, patch) => { Object.assign(api.rects[i], patch); fit(api.rects[i]); emit(); };

  function fit(r) {
    r.w = clamp(r.w, MIN, api.ptW); r.h = clamp(r.h, MIN, api.ptH);
    r.x = clamp(r.x, 0, api.ptW - r.w); r.y = clamp(r.y, 0, api.ptH - r.h);
  }

  overlay.addEventListener("pointerdown", e => {
    if (e.button !== undefined && e.button > 0) return;
    const hd = e.target.closest(".tk-hd"), rectEl = e.target.closest(".tk-rect"), p = toPts(e);
    e.preventDefault();
    if (hd && rectEl) { const i = Number(rectEl.dataset.i); api.sel = i; drag = { mode: "resize", dir: hd.dataset.h, i, start: { ...api.rects[i] }, p }; }
    else if (rectEl) { const i = Number(rectEl.dataset.i); api.sel = i; drag = { mode: "move", i, start: { ...api.rects[i] }, p }; render(); }
    else {
      const r = asp() ? { x: p.x, y: p.y, w: MIN, h: MIN / asp() } : { x: p.x, y: p.y, w: 0, h: 0 };
      if (multi) { api.rects.push(r); api.sel = api.rects.length - 1; } else { api.rects = [r]; api.sel = 0; }
      drag = { mode: "draw", i: api.sel, origin: p, start: { ...r }, p };
      render();
    }
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener("pointermove", e => {
    if (!drag) return;
    const p = toPts(e), r = api.rects[drag.i]; if (!r) return;
    const dx = p.x - drag.p.x, dy = p.y - drag.p.y, s = drag.start;
    if (drag.mode === "move") { r.x = clamp(s.x + dx, 0, api.ptW - s.w); r.y = clamp(s.y + dy, 0, api.ptH - s.h); }
    else if (drag.mode === "draw") {
      let x = clamp(p.x, 0, api.ptW), y = clamp(p.y, 0, api.ptH);
      if (asp()) {
        let w = Math.abs(x - drag.origin.x), hh = w / asp();
        const left = x < drag.origin.x ? drag.origin.x - w : drag.origin.x, top = y < drag.origin.y ? drag.origin.y - hh : drag.origin.y;
        if (left >= 0 && top >= 0 && left + w <= api.ptW && top + hh <= api.ptH) { r.x = left; r.y = top; r.w = w; r.h = hh; }
      } else { r.x = Math.min(x, drag.origin.x); r.y = Math.min(y, drag.origin.y); r.w = Math.abs(x - drag.origin.x); r.h = Math.abs(y - drag.origin.y); }
    } else {
      const d = drag.dir;
      if (asp()) {
        const w = Math.max(MIN * asp(), d.includes("e") ? s.w + dx : s.w - dx), hh = w / asp();
        const nx = d.includes("w") ? s.x + s.w - w : s.x, ny = d.includes("n") ? s.y + s.h - hh : s.y;
        if (nx >= 0 && ny >= 0 && nx + w <= api.ptW && ny + hh <= api.ptH) { r.x = nx; r.y = ny; r.w = w; r.h = hh; }
      } else {
        let x = s.x, y = s.y, w = s.w, hh = s.h;
        if (d.includes("w")) { const nx = clamp(s.x + dx, 0, s.x + s.w - MIN); w = s.w + (s.x - nx); x = nx; }
        if (d.includes("e")) w = clamp(s.w + dx, MIN, api.ptW - s.x);
        if (d.includes("n")) { const ny = clamp(s.y + dy, 0, s.y + s.h - MIN); hh = s.h + (s.y - ny); y = ny; }
        if (d.includes("s")) hh = clamp(s.h + dy, MIN, api.ptH - s.y);
        r.x = x; r.y = y; r.w = w; r.h = hh;
      }
    }
    render(); api.onchange(api.rects, true);
  });
  const end = () => {
    if (!drag) return;
    const r = api.rects[drag.i];
    if (drag.mode === "draw" && r && (r.w < MIN || r.h < MIN)) { api.rects.splice(drag.i, 1); api.sel = api.rects.length - 1; }
    drag = null; emit();
  };
  overlay.addEventListener("pointerup", end);
  overlay.addEventListener("pointercancel", end);
  overlay.addEventListener("keydown", e => {
    const rectEl = e.target.closest && e.target.closest(".tk-rect"); if (!rectEl) return;
    const i = Number(rectEl.dataset.i), r = api.rects[i], step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); r.x += moves[e.key][0]; r.y += moves[e.key][1]; fit(r); api.sel = i; emit(); overlay.querySelector('[data-i="' + i + '"]')?.focus(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && multi) { e.preventDefault(); api.remove(i); }
  });
  return api;
}
