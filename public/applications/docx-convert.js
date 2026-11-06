/* MarketTech Applications — Word (.docx) to PDF engine.
 * Rebuilds the document in this browser from the OOXML package using the
 * self-hosted JSZip and pdf-lib builds. No document bytes leave the device.
 *
 * Kept: page size and margins, paragraph styles and headings, bold / italic /
 * underline / strike, text colours and shading, alignment and indents,
 * spacing, bullet and numbered lists, tables (borders, shading, merged
 * cells), inline pictures and page breaks.
 * Not kept (reported to the caller): headers and footers, footnotes, text
 * boxes, charts, SmartArt, columns and floating layouts. */

import { lib, UserError } from "/applications/core.js";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const TWIP = 20;   /* twips per point */
const EMU = 12700; /* EMU per point */
const MAX_PAGES = 400;

/* ---------- XML helpers ---------- */
const isEl = n => !!n && n.nodeType === 1;
const kidsOf = (el, name) => {
  const out = [];
  if (!el) return out;
  for (const n of el.childNodes) if (isEl(n) && (!name || n.localName === name)) out.push(n);
  return out;
};
const kidOf = (el, name) => kidsOf(el, name)[0] || null;
const wAttr = (el, name) => (el ? el.getAttributeNS(W_NS, name) ?? el.getAttribute("w:" + name) : null);
const valOf = el => wAttr(el, "val");
const numAttr = (el, name, dflt) => {
  const v = wAttr(el, name);
  return v === null || v === "" || Number.isNaN(Number(v)) ? dflt : Number(v);
};
const onOff = el => {
  if (!el) return false;
  const v = valOf(el);
  if (v === null) return true;
  return !/^(0|false|off|none)$/i.test(v);
};

const parser = new DOMParser();
function parseXml(text, label) {
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new UserError(label + " inside this file is damaged, so it cannot be converted.");
  return doc.documentElement;
}

/* ---------- colours ---------- */
const THEME = {
  dark1: "000000", light1: "FFFFFF", dark2: "44546A", light2: "E7E6E6",
  text1: "000000", background1: "FFFFFF", text2: "44546A", background2: "E7E6E6",
  accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000",
  accent5: "5B9BD5", accent6: "70AD47", hyperlink: "0563C1", followedHyperlink: "954F72"
};
const HIGHLIGHT = {
  yellow: "FFFF00", green: "00FF00", cyan: "00FFFF", magenta: "FF00FF", blue: "0000FF",
  red: "FF0000", darkBlue: "000080", darkCyan: "008080", darkGreen: "008000",
  darkMagenta: "800080", darkRed: "800000", darkYellow: "808000", darkGray: "808080",
  lightGray: "C0C0C0", black: "000000", white: "FFFFFF"
};
let PDF_RGB = null;
const hexToRgb = (pdf, hex) => {
  const clean = String(hex || "").replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return PDF_RGB(0, 0, 0);
  return PDF_RGB(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255);
};

/* ---------- text for the standard PDF fonts (WinAnsi) ---------- */
const ALLOWED = new Set();
for (let c = 32; c <= 126; c++) ALLOWED.add(c);
for (let c = 160; c <= 255; c++) ALLOWED.add(c);
for (const c of [0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC,
  0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178]) ALLOWED.add(c);
const REPLACE = new Map([
  ["\u2010", "-"], ["\u2011", "-"], ["\u2012", "-"], ["\u2015", "-"], ["\u2212", "-"],
  ["\u2032", "'"], ["\u2033", '"'], ["\u00AD", ""], ["\u00A0", " "], ["\u2007", " "],
  ["\u202F", " "], ["\u2009", " "], ["\u200A", " "], ["\u2002", " "], ["\u2003", " "],
  ["\u2192", "->"], ["\u2190", "<-"], ["\u2194", "<->"], ["\u20B9", "Rs."], ["\u2713", "v"],
  ["\u2714", "v"], ["\u25AA", "\u2022"], ["\u25CF", "\u2022"], ["\u2023", "\u2022"]
]);
function sanitize(text, stats) {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 9 || cp === 10 || cp === 13) { out += " "; continue; }
    if (REPLACE.has(ch)) { out += REPLACE.get(ch); continue; }
    if (ALLOWED.has(cp)) { out += ch; continue; }
    if (stats) { stats.dropped++; stats.seen.add(ch); }
  }
  return out;
}
const UNSUPPORTED_SCRIPT = /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F\u10A0-\u10FF\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

/* ---------- fonts ---------- */
const FONT_MAP = [
  [/courier|consolas|mono|lucida console/i, "courier"],
  [/times|georgia|cambria|garamond|palatino|book|serif|constantia|caladea/i, "times"]
];
function fontKeyFor(family) {
  const name = String(family || "Calibri");
  for (const [re, key] of FONT_MAP) if (re.test(name)) return key;
  return "helvetica";
}

/* ---------- run and paragraph properties ---------- */
const DEFAULT_RUN = {
  bold: false, italic: false, underline: false, strike: false, size: 11,
  font: "helvetica", fontName: "Calibri", sup: false, sub: false,
  colorHex: "000000", shade: null, highlight: null, caps: false
};

function readRunProps(el) {
  if (!el) return {};
  const p = {};
  const b = kidOf(el, "b"), i = kidOf(el, "i"), u = kidOf(el, "u"), st = kidOf(el, "strike");
  if (b) p.bold = onOff(b);
  if (i) p.italic = onOff(i);
  if (u) p.underline = !/^none$/i.test(valOf(u) || "");
  if (st) p.strike = onOff(st);
  const sz = kidOf(el, "sz");
  const szv = sz && numAttr(sz, "val", NaN);
  if (szv && szv > 0) p.size = szv / 2;
  const fonts = kidOf(el, "rFonts");
  if (fonts) {
    const name = wAttr(fonts, "ascii") || wAttr(fonts, "hAnsi") || wAttr(fonts, "cs");
    if (name) { p.fontName = name; p.font = fontKeyFor(name); }
  }
  const color = kidOf(el, "color");
  if (color) {
    const theme = wAttr(color, "themeColor");
    const hex = theme ? THEME[theme] : valOf(color);
    if (hex && !/^auto$/i.test(hex)) p.colorHex = String(hex).replace(/^#/, "").toUpperCase();
  }
  const va = kidOf(el, "vertAlign");
  if (va) { const v = valOf(va); p.sup = v === "superscript"; p.sub = v === "subscript"; }
  const shd = kidOf(el, "shd");
  if (shd) { const f = wAttr(shd, "fill"); if (f && !/^auto$/i.test(f) && f !== "FFFFFF") p.shade = f; }
  const hl = kidOf(el, "highlight");
  if (hl) { const f = HIGHLIGHT[(valOf(hl) || "").toLowerCase()]; if (f) p.highlight = f; }
  const caps = kidOf(el, "caps");
  if (caps && onOff(caps)) p.caps = true;
  const smallCaps = kidOf(el, "smallCaps");
  if (smallCaps && onOff(smallCaps)) p.caps = true;
  return p;
}

function readParaProps(el) {
  if (!el) return {};
  const p = {};
  const jc = kidOf(el, "jc");
  if (jc) p.align = valOf(jc) || "left";
  const ind = kidOf(el, "ind");
  if (ind) {
    const left = wAttr(ind, "left") ?? wAttr(ind, "start");
    const right = wAttr(ind, "right") ?? wAttr(ind, "end");
    const first = wAttr(ind, "firstLine");
    const hanging = wAttr(ind, "hanging");
    if (left !== null) p.left = Number(left) / TWIP;
    if (right !== null) p.right = Number(right) / TWIP;
    if (first !== null) p.first = Number(first) / TWIP;
    else if (hanging !== null) p.first = -Number(hanging) / TWIP;
  }
  const sp = kidOf(el, "spacing");
  if (sp) {
    const before = wAttr(sp, "before"), after = wAttr(sp, "after"), line = wAttr(sp, "line");
    if (before !== null) p.before = Number(before) / TWIP;
    if (after !== null) p.after = Number(after) / TWIP;
    if (line !== null) {
      p.lineTwips = Number(line) / TWIP;
      p.line = Number(line) / 240;
      p.lineRule = wAttr(sp, "lineRule") || "auto";
    }
  }
  const numPr = kidOf(el, "numPr");
  if (numPr) {
    const numId = kidOf(numPr, "numId"), ilvl = kidOf(numPr, "ilvl");
    if (numId) p.numId = valOf(numId);
    if (ilvl) p.ilvl = Number(valOf(ilvl)) || 0;
  }
  const pbb = kidOf(el, "pageBreakBefore");
  if (pbb && onOff(pbb)) p.pageBreakBefore = true;
  const keepNext = kidOf(el, "keepNext");
  if (keepNext && onOff(keepNext)) p.keepNext = true;
  const shd = kidOf(el, "shd");
  if (shd) { const f = wAttr(shd, "fill"); if (f && !/^auto$/i.test(f) && f !== "FFFFFF") p.shade = f; }
  const pBdr = kidOf(el, "pBdr");
  if (pBdr) {
    p.borders = {};
    for (const edge of ["top", "bottom", "left", "right"]) {
      const e = kidOf(pBdr, edge);
      if (e) p.borders[edge] = {
        sz: numAttr(e, "sz", 4) / 8,
        hex: (valOf(e) && !/^auto$/i.test(valOf(e))) ? valOf(e) : (wAttr(e, "color") || "000000")
      };
    }
  }
  return p;
}

/* ---------- styles ---------- */
function parseStyles(xml) {
  const map = new Map();
  const defaults = { pPr: {}, rPr: {} };
  if (!xml) return { map, defaults };
  const root = parseXml(xml, "The style sheet");
  const dd = kidOf(root, "docDefaults");
  if (dd) {
    Object.assign(defaults.rPr, readRunProps(kidOf(kidOf(dd, "rPrDefault"), "rPr")));
    Object.assign(defaults.pPr, readParaProps(kidOf(kidOf(dd, "pPrDefault"), "pPr")));
  }
  for (const style of kidsOf(root, "style")) {
    const id = wAttr(style, "styleId");
    if (!id) continue;
    const basedOn = kidOf(style, "basedOn");
    const nameEl = kidOf(style, "name");
    map.set(id, {
      id,
      type: wAttr(style, "type") || "paragraph",
      basedOn: basedOn ? valOf(basedOn) : null,
      name: nameEl ? valOf(nameEl) : id,
      pPr: readParaProps(kidOf(style, "pPr")),
      rPr: readRunProps(kidOf(style, "rPr")),
      raw: style
    });
  }
  return { map, defaults };
}
function styleChain(styles, id, type) {
  const out = [];
  let cur = styles.map.get(id);
  let guard = 0;
  while (cur && guard++ < 12) {
    if (!type || cur.type === type) out.unshift(cur);
    cur = cur.basedOn ? styles.map.get(cur.basedOn) : null;
  }
  return out;
}

/* ---------- numbering ---------- */
function formatNumber(n, fmt) {
  switch (String(fmt || "decimal").toLowerCase()) {
    case "lowerletter": return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case "upperletter": return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case "lowerroman": return roman(n).toLowerCase();
    case "upperroman": return roman(n);
    case "none": return "";
    default: return String(n);
  }
}
function roman(n) {
  const map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
function parseNumbering(xml) {
  const nums = new Map(), abstracts = new Map();
  if (!xml) return { nums, abstracts };
  const root = parseXml(xml, "The list definitions");
  for (const abs of kidsOf(root, "abstractNum")) {
    const levels = [];
    for (const lvl of kidsOf(abs, "lvl")) {
      const start = kidOf(lvl, "start");
      const fmt = kidOf(lvl, "numFmt");
      const text = kidOf(lvl, "lvlText");
      const pPr = readParaProps(kidOf(lvl, "pPr"));
      levels[numAttr(lvl, "ilvl", 0)] = {
        start: start ? numAttr(start, "val", 1) : 1,
        fmt: fmt ? valOf(fmt) : "decimal",
        text: text ? valOf(text) || "" : "",
        left: pPr.left,
        first: pPr.first
      };
    }
    abstracts.set(wAttr(abs, "abstractNumId"), levels);
  }
  for (const num of kidsOf(root, "num")) {
    const abs = kidOf(num, "abstractNumId");
    if (abs) nums.set(wAttr(num, "numId"), valOf(abs));
  }
  return { nums, abstracts };
}

/* ---------- relationships ---------- */
function parseRels(xml) {
  const out = new Map();
  if (!xml) return out;
  const root = parseXml(xml, "The document links");
  for (const rel of kidsOf(root, "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) out.set(id, target);
  }
  return out;
}
function resolvePath(base, target) {
  if (/^https?:/i.test(target) || target.startsWith("/")) return null;
  const parts = (base + "/" + target).split("/");
  const stack = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}
async function readZipText(zip, path) {
  const f = zip.file(path);
  return f ? f.async("string") : null;
}

/* ---------- block walker ---------- */
function blocksOf(container) {
  const out = [];
  const walk = parent => {
    for (const node of kidsOf(parent)) {
      if (node.localName === "p" || node.localName === "tbl") out.push(node);
      else if (node.localName === "sdt") { const c = kidOf(node, "sdtContent"); if (c) walk(c); }
      else if (node.localName === "customXml") walk(node);
    }
  };
  walk(container);
  return out;
}

/* ---------- image decoding ---------- */
async function gifToPng(pdf, data) {
  const blob = new Blob([data], { type: "image/gif" });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();
  const png = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("encode")), "image/png"));
  return pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
}

/* ---------- main entry ---------- */
export async function convertDocx(bytes, fileName, options, job) {
  const JSZip = await lib("jszip");
  const { PDFDocument, StandardFonts, rgb } = await lib("pdflib");
  PDF_RGB = rgb;
  const F = StandardFonts;

  let zip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new UserError("“" + fileName + "” is not a .docx file. Old .doc files must be saved as .docx in Word first."); }
  if (!zip.file("word/document.xml")) throw new UserError("“" + fileName + "” is not a Word .docx file. Open it in Word and use Save As → Word Document (.docx).");

  const [docXml, stylesXml, numberingXml, relsXml] = await Promise.all([
    readZipText(zip, "word/document.xml"),
    readZipText(zip, "word/styles.xml"),
    readZipText(zip, "word/numbering.xml"),
    readZipText(zip, "word/_rels/document.xml.rels")
  ]);

  const documentRoot = parseXml(docXml, "The document body");
  const body = kidOf(documentRoot, "body") || documentRoot;
  const styles = parseStyles(stylesXml);
  const numbering = parseNumbering(numberingXml);
  const rels = parseRels(relsXml);

  /* Refuse documents this browser engine cannot typeset (no font embedding). */
  let wrongGlyphs = null;
  for (const t of documentRoot.getElementsByTagNameNS(W_NS, "t")) {
    if (UNSUPPORTED_SCRIPT.test(t.textContent || "")) { wrongGlyphs = t.textContent.trim(); break; }
  }
  if (wrongGlyphs) {
    const sample = wrongGlyphs.slice(0, 24);
    throw new UserError("This document contains Hindi, Greek, Cyrillic, Arabic or Chinese script (for example “" + sample + "”). This browser converter can only typeset Latin text, so it would produce broken pages. Open the file in Word and use File → Save as → PDF instead.");
  }

  const pdf = await PDFDocument.create();
  const fonts = {
    helvetica: await pdf.embedFont(F.Helvetica), helveticaBold: await pdf.embedFont(F.HelveticaBold),
    helveticaItalic: await pdf.embedFont(F.HelveticaOblique), helveticaBoldItalic: await pdf.embedFont(F.HelveticaBoldOblique),
    times: await pdf.embedFont(F.TimesRoman), timesBold: await pdf.embedFont(F.TimesRomanBold),
    timesItalic: await pdf.embedFont(F.TimesRomanItalic), timesBoldItalic: await pdf.embedFont(F.TimesRomanBoldItalic),
    courier: await pdf.embedFont(F.Courier), courierBold: await pdf.embedFont(F.CourierBold),
    courierItalic: await pdf.embedFont(F.CourierOblique), courierBoldItalic: await pdf.embedFont(F.CourierBoldOblique)
  };

  const stats = { dropped: 0, seen: new Set(), imagesSkipped: 0, imagesKept: 0 };
  const imageCache = new Map();
  const blips = [...documentRoot.getElementsByTagNameNS(A_NS, "blip")];
  if (job) job.progress(6, "Reading pictures…");
  for (const blip of blips) {
    const rid = blip.getAttributeNS(R_NS, "embed") ?? blip.getAttribute("r:embed");
    if (!rid || imageCache.has(rid)) continue;
    const target = rels.get(rid);
    const path = target ? resolvePath("word", target) : null;
    const file = path ? zip.file(path) : null;
    if (!file) { imageCache.set(rid, null); stats.imagesSkipped++; continue; }
    try {
      const data = new Uint8Array(await file.async("arraybuffer"));
      const isPng = data[0] === 0x89 && data[1] === 0x50;
      const isJpg = data[0] === 0xff && data[1] === 0xd8;
      const isGif = data[0] === 0x47 && data[1] === 0x49;
      if (isPng) { imageCache.set(rid, await pdf.embedPng(data)); stats.imagesKept++; }
      else if (isJpg) { imageCache.set(rid, await pdf.embedJpg(data)); stats.imagesKept++; }
      else if (isGif) { imageCache.set(rid, await gifToPng(pdf, data)); stats.imagesKept++; }
      else { imageCache.set(rid, null); stats.imagesSkipped++; }
    } catch { imageCache.set(rid, null); stats.imagesSkipped++; }
  }

  const ctx = {
    pdf,
    font(st) {
      const suffix = st.bold && st.italic ? "BoldItalic" : st.bold ? "Bold" : st.italic ? "Italic" : "";
      return fonts[st.font + suffix] || fonts[st.font] || fonts.helvetica;
    },
    width(text, st) { return this.font(st).widthOfTextAtSize(text, st.size); },
    rgb: hex => hexToRgb(pdf, hex)
  };

  /* ---------- page writer ---------- */
  const PAGE_SIZES = {
    a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008],
    a5: [419.53, 595.28], a3: [841.89, 1190.55], b5: [498.9, 708.66]
  };
  const reader = {
    page: null,
    section: { w: 595.28, h: 841.89, top: 56.7, right: 56.7, bottom: 56.7, left: 56.7 },
    y: 0,
    newPage() {
      if (pdf.getPageCount() >= MAX_PAGES) throw new UserError("This document is longer than " + MAX_PAGES + " pages. Split it into smaller files first.");
      this.page = pdf.addPage([this.section.w, this.section.h]);
      this.y = this.section.top;
      return this.page;
    },
    contentWidth() { return this.section.w - this.section.left - this.section.right; },
    contentHeight() { return this.section.h - this.section.top - this.section.bottom; },
    bottom() { return this.section.h - this.section.bottom; },
    space(h) { return this.bottom() - this.y >= h - 0.01; }
  };

  function readSection(sectPr) {
    const out = { ...reader.section };
    if (!sectPr) return out;
    const pgSz = kidOf(sectPr, "pgSz");
    const pgMar = kidOf(sectPr, "pgMar");
    if (pgSz) {
      let w = numAttr(pgSz, "w", 11906) / TWIP;
      let h = numAttr(pgSz, "h", 16838) / TWIP;
      if ((wAttr(pgSz, "orient") || "").toLowerCase() === "landscape" && w < h) [w, h] = [h, w];
      out.w = w;
      out.h = h;
    }
    if (pgMar) {
      out.top = numAttr(pgMar, "top", 1440) / TWIP;
      out.right = numAttr(pgMar, "right", 1440) / TWIP;
      out.bottom = numAttr(pgMar, "bottom", 1440) / TWIP;
      out.left = numAttr(pgMar, "left", 1440) / TWIP;
    }
    return out;
  }

  reader.section = readSection(kidOf(body, "sectPr"));
  if (options && options.pageSize && options.pageSize !== "document") {
    const size = PAGE_SIZES[options.pageSize];
    if (size) {
      const landscape = reader.section.w > reader.section.h;
      reader.section.w = landscape ? size[1] : size[0];
      reader.section.h = landscape ? size[0] : size[1];
    }
  }

  const DEFAULT_SIZE = styles.defaults.rPr.size || 11;

  /* ---------- paragraph model ---------- */
  function mergeRPr(a, b) {
    if (!a && !b) return null;
    const holder = document.createElement("holder");
    for (const src of [a, b]) if (src) for (const n of [...src.childNodes]) holder.append(n.cloneNode(true));
    return holder;
  }

  function drawingInfo(drawing) {
    if (!drawing) return null;
    let blip = drawing.getElementsByTagNameNS(A_NS, "blip")[0];
    if (!blip) {
      const imageData = drawing.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "imagedata")[0];
      if (imageData) {
        const rid = imageData.getAttributeNS(R_NS, "id") ?? imageData.getAttribute("r:id");
        const img = rid ? imageCache.get(rid) : null;
        if (!img) return null;
        const style = imageData.getAttribute("style") || "";
        const wMatch = style.match(/width:\s*([\d.]+)pt/);
        const hMatch = style.match(/height:\s*([\d.]+)pt/);
        return { image: img, w: wMatch ? Number(wMatch[1]) : img.width * 0.75, h: hMatch ? Number(hMatch[1]) : img.height * 0.75 };
      }
      return null;
    }
    const rid = blip.getAttributeNS(R_NS, "embed") ?? blip.getAttribute("r:embed");
    const img = rid ? imageCache.get(rid) : null;
    if (!img) return null;
    let cx = 0, cy = 0;
    const extents = drawing.getElementsByTagNameNS("*", "extent");
    if (extents.length) { cx = Number(extents[0].getAttribute("cx")) || 0; cy = Number(extents[0].getAttribute("cy")) || 0; }
    let w = cx ? cx / EMU : img.width * 0.75;
    let h = cy ? cy / EMU : img.height * 0.75;
    if (!(w > 0) || !(h > 0)) { w = 120; h = 90; }
    return { image: img, w, h };
  }

  function buildRuns(parEl, paraChain, out) {
    const baseStyle = { ...DEFAULT_RUN, ...styles.defaults.rPr };
    for (const s of paraChain) Object.assign(baseStyle, s.rPr);
    if (baseStyle.size && baseStyle.size < 1) baseStyle.size = DEFAULT_SIZE;

    const styleFor = rPr => {
      const st = { ...baseStyle };
      if (rPr) {
        const rStyle = kidOf(rPr, "rStyle");
        if (rStyle) for (const s of styleChain(styles, valOf(rStyle), "character")) Object.assign(st, s.rPr);
        Object.assign(st, readRunProps(rPr));
      }
      if (!st.size || st.size < 1) st.size = DEFAULT_SIZE;
      return st;
    };

    const visit = (node, inheritedRPr) => {
      for (const child of kidsOf(node)) {
        switch (child.localName) {
          case "r": {
            const rPr = mergeRPr(inheritedRPr, kidOf(child, "rPr"));
            const st = styleFor(rPr);
            for (const part of kidsOf(child)) {
              if (part.localName === "t") out.push({ type: "text", text: part.textContent || "", st });
              else if (part.localName === "tab") out.push({ type: "tab", st });
              else if (part.localName === "br") out.push({ type: (wAttr(part, "type") || "") === "page" ? "pagebreak" : "break", st });
              else if (part.localName === "cr") out.push({ type: "break", st });
              else if (part.localName === "noBreakHyphen") out.push({ type: "text", text: "-", st });
              else if (part.localName === "drawing" || part.localName === "pict") {
                const img = drawingInfo(part.localName === "drawing" ? part : kidOf(part, "shape") || part);
                if (img) out.push({ type: "image", ...img, st });
              }
            }
            break;
          }
          case "hyperlink": {
            const hPr = kidOf(child, "rPr");
            for (const r of kidsOf(child, "r")) {
              const st = styleFor(mergeRPr(mergeRPr(inheritedRPr, hPr), kidOf(r, "rPr")));
              st.underline = true;
              if (!st.colorHex || st.colorHex === "000000") st.colorHex = "0563C1";
              for (const part of kidsOf(r)) if (part.localName === "t") out.push({ type: "text", text: part.textContent || "", st });
            }
            break;
          }
          case "ins": case "smartTag": case "customXml": case "bdo":
            visit(child, inheritedRPr);
            break;
          case "sdt": {
            const c = kidOf(child, "sdtContent");
            if (c) visit(c, inheritedRPr);
            break;
          }
          case "fldSimple": visit(child, inheritedRPr); break;
          default: break;
        }
      }
    };
    visit(parEl, null);
  }

  function buildParagraph(p, opts = {}) {
    const pPr = kidOf(p, "pPr");
    const styleIdEl = pPr && kidOf(pPr, "pStyle");
    const styleId = styleIdEl ? valOf(styleIdEl) : null;
    const paraChain = styleId ? styleChain(styles, styleId, "paragraph") : [];
    const props = { ...styles.defaults.pPr };
    for (const s of paraChain) Object.assign(props, s.pPr);
    if (pPr) Object.assign(props, readParaProps(pPr));
    if (opts.inTable && !(pPr && kidOf(pPr, "spacing"))) { props.before = 0; props.after = 0; }
    const runs = [];
    buildRuns(p, paraChain, runs);
    const base = { ...DEFAULT_RUN, ...styles.defaults.rPr };
    for (const s of paraChain) Object.assign(base, s.rPr);
    if (pPr) { const mark = kidOf(pPr, "rPr"); if (mark) Object.assign(base, readRunProps(mark)); }
    if (!base.size || base.size < 1) base.size = DEFAULT_SIZE;
    return { props, runs, base, sectPr: pPr ? kidOf(pPr, "sectPr") : null };
  }

  /* ---------- line breaking ---------- */
  const sameStyle = (a, b) => a === b || (!!a && !!b &&
    a.size === b.size && a.font === b.font && a.bold === b.bold && a.italic === b.italic &&
    a.underline === b.underline && a.strike === b.strike && a.colorHex === b.colorHex &&
    a.sup === b.sup && a.sub === b.sub && a.caps === b.caps &&
    a.shade === b.shade && a.highlight === b.highlight);

  function tokenize(par) {
    const items = [];
    let pending = "";
    let pendingSt = null;
    const flush = () => {
      if (pending) { items.push({ type: "word", text: pending, st: pendingSt }); pending = ""; pendingSt = null; }
    };
    for (const run of par.runs) {
      if (run.type === "text") {
        const text = sanitize(run.st.caps ? run.text.toUpperCase() : run.text, stats);
        for (const piece of text.split(/(\s+)/)) {
          if (!piece) continue;
          if (/^\s+$/.test(piece)) { flush(); items.push({ type: "space", st: run.st }); }
          else {
            if (pendingSt && !sameStyle(pendingSt, run.st)) flush();
            if (!pendingSt) pendingSt = run.st;
            pending += piece;
          }
        }
      } else if (run.type === "image") {
        flush();
        items.push({ type: "image", image: run.image, w: run.w, h: run.h, st: run.st });
      } else {
        flush();
        items.push({ type: run.type, st: run.st });
      }
    }
    flush();
    return items;
  }

  function lineHeightFor(size, maxImage, props) {
    let h = size * 1.2;
    if (props.lineRule === "exact" && props.lineTwips) h = props.lineTwips;
    else if (props.lineRule === "atLeast" && props.lineTwips) h = Math.max(h, props.lineTwips);
    else if (props.line) h = props.line * size * 1.2;
    return Math.max(h, maxImage * 1.05, 1);
  }

  function layoutParagraph(par, width) {
    const items = tokenize(par);
    const props = par.props;
    const left = props.left || 0, right = props.right || 0, first = props.first || 0;
    const baseSize = par.base.size || DEFAULT_SIZE;
    const lines = [];
    let cur = { items: [], w: 0, maxSize: baseSize, maxImage: 0 };
    const widthFor = idx => Math.max(12, width - left - right - (idx === 0 ? first : 0));
    const push = () => { lines.push(cur); cur = { items: [], w: 0, maxSize: baseSize, maxImage: 0 }; };

    for (const item of items) {
      if (item.type === "break" || item.type === "pagebreak") {
        push();
        if (item.type === "pagebreak") lines[lines.length - 1].pageBreakAfter = true;
        continue;
      }
      if (item.type === "tab") {
        const tabW = 36;
        if (cur.items.length && cur.w + tabW > widthFor(lines.length)) push();
        cur.items.push({ ...item, width: tabW });
        cur.w += tabW;
        continue;
      }
      if (item.type === "image") {
        const avail = widthFor(lines.length);
        let w = item.w, h = item.h;
        if (w > avail) { const k = avail / w; w = avail; h *= k; }
        if (cur.items.length && cur.w + w > avail) push();
        cur.items.push({ type: "image", image: item.image, width: w, height: h });
        cur.w += w;
        cur.maxImage = Math.max(cur.maxImage, h);
        continue;
      }
      if (item.type === "space") {
        if (!cur.items.length) continue;
        const w = ctx.width(" ", item.st);
        cur.items.push({ type: "space", st: item.st, width: w });
        cur.w += w;
        continue;
      }
      /* words */
      const st = item.st;
      let text = item.text;
      let w = ctx.width(text, st);
      let avail = widthFor(lines.length);
      if (cur.items.length && cur.w + w > avail) { push(); avail = widthFor(lines.length); }
      if (w > avail && text.length > 1) {
        let rest = text;
        while (rest.length) {
          const room = widthFor(lines.length) - cur.w;
          let take = rest.length;
          while (take > 1 && ctx.width(rest.slice(0, take), st) > room) take--;
          const piece = rest.slice(0, take);
          const pieceW = ctx.width(piece, st);
          cur.items.push({ type: "word", text: piece, st, width: pieceW });
          cur.w += pieceW;
          cur.maxSize = Math.max(cur.maxSize, st.size);
          rest = rest.slice(take);
          if (rest) push();
        }
        continue;
      }
      cur.items.push({ type: "word", text, st, width: w });
      cur.w += w;
      cur.maxSize = Math.max(cur.maxSize, st.size);
    }
    push();
    if (lines.length > 1 && !lines[lines.length - 1].items.length) lines.pop();
    if (!lines.length) lines.push({ items: [], w: 0, maxSize: baseSize, maxImage: 0 });

    let total = 0;
    for (const line of lines) {
      line.height = lineHeightFor(line.maxSize, line.maxImage, props);
      total += line.height;
    }
    return { lines, height: total, left, right, first };
  }

  /* ---------- lists ---------- */
  function listMarker(props, par) {
    const numId = props.numId === undefined || props.numId === null ? null : String(props.numId);
    if (!numId || numId === "0") return null;
    const absId = numbering.nums.get(numId);
    if (!absId) return null;
    const levels = numbering.abstracts.get(absId);
    if (!levels) return null;
    const ilvl = props.ilvl || 0;
    const level = levels[ilvl];
    if (!level) return null;
    if (!ctx.counters) ctx.counters = new Map();
    const counts = ctx.counters.get(numId) || [];
    for (let i = 0; i <= ilvl; i++) {
      if (counts[i] === undefined) counts[i] = ((levels[i] && levels[i].start) || 1) - 1;
    }
    counts[ilvl] += 1;
    for (let i = ilvl + 1; i < 9; i++) delete counts[i];
    ctx.counters.set(numId, counts);

    const isBullet = /^bullet$/i.test(level.fmt || "");
    let text = level.text || "";
    for (let i = 0; i <= ilvl; i++) {
      const lv = levels[i];
      if (!lv) continue;
      const n = counts[i] !== undefined ? counts[i] : (lv.start || 1);
      text = text.split("%" + (i + 1)).join(formatNumber(n, lv.fmt));
    }
    if (!text) text = isBullet ? "\u2022" : formatNumber(counts[ilvl], level.fmt);
    if (!isBullet && /^none$/i.test(level.fmt || "")) return null;
    text = sanitize(text, null);
    if (!text) text = isBullet ? "\u2022" : formatNumber(counts[ilvl], level.fmt) || "\u2022";

    if (props.left === undefined && level.left !== undefined) props.left = level.left;
    if (props.first === undefined && level.first !== undefined) props.first = level.first;
    if (props.left === undefined) props.left = (ilvl + 1) * 18;
    if (props.first === undefined) props.first = -18;

    const st = {
      bold: false, italic: false, underline: false, strike: false, sup: false, sub: false,
      size: par.base.size || DEFAULT_SIZE, font: par.base.font || "helvetica",
      fontName: par.base.fontName || "Calibri", colorHex: par.base.colorHex || "000000",
      caps: false, shade: null, highlight: null
    };
    return { text, st, gap: Math.max(3, Math.abs(props.first || 0) * 0.14) };
  }

  /* ---------- paragraph drawing ---------- */
  function drawParagraph(par, layout, frame, opts = {}) {
    const props = par.props;
    const inCell = !!opts.inCell;
    const align = props.align || "left";
    let y = inCell ? opts.startY : reader.y;
    let breakAfterParagraph = false;

    if (!inCell) {
      if (props.pageBreakBefore && Math.abs(reader.y - reader.section.top) > 0.5) { reader.newPage(); y = reader.y; }
      if (props.keepNext) {
        const reserve = layout.height + (par.base.size || DEFAULT_SIZE) * 2.6;
        if (!reader.space(reserve) && Math.abs(y - reader.section.top) > 0.5) { reader.newPage(); y = reader.y; }
      }
      if (props.before && Math.abs(y - reader.section.top) > 0.5) {
        if (reader.space(props.before + 12)) y += props.before;
      }
    } else if (props.before) {
      y += props.before;
    }

    for (let li = 0; li < layout.lines.length; li++) {
      const line = layout.lines[li];
      if (!inCell && !reader.space(line.height)) { reader.newPage(); y = reader.y; }
      const top = y;
      const indent = layout.left + (li === 0 ? layout.first : 0);
      const avail = Math.max(12, frame.width - layout.left - layout.right - (li === 0 ? layout.first : 0));
      const free = Math.max(0, avail - line.w);
      let x = frame.x + indent + (align === "center" ? free / 2 : (align === "right" || align === "end") ? free : 0);
      const page = reader.page;
      const baselineY = top + line.height * 0.78;

      if (props.shade) {
        page.drawRectangle({
          x: frame.x + layout.left, y: reader.section.h - top - line.height,
          width: avail, height: line.height, color: ctx.rgb(props.shade)
        });
      }
      if (props.borders) {
        for (const edge of ["top", "bottom"]) {
          const b = props.borders[edge];
          if (!b) continue;
          const lineY = reader.section.h - (edge === "top" ? top : top + line.height);
          page.drawLine({
            start: { x: frame.x + layout.left, y: lineY },
            end: { x: frame.x + layout.left + avail, y: lineY },
            thickness: Math.max(0.4, b.sz), color: ctx.rgb(b.hex)
          });
        }
      }
      if (li === 0 && par.bullet) {
        const bst = par.bullet.st;
        const bw = ctx.width(par.bullet.text, bst);
        page.drawText(par.bullet.text, {
          x: frame.x + indent - bw - par.bullet.gap,
          y: reader.section.h - baselineY,
          size: bst.size, font: ctx.font(bst), color: ctx.rgb(bst.colorHex)
        });
      }

      let extra = 0;
      if ((align === "both" || align === "justify") && li < layout.lines.length - 1) {
        const spaces = line.items.filter(it => it.type === "space").length;
        if (spaces) extra = Math.max(0, avail - line.w) / spaces;
      }

      for (const item of line.items) {
        if (item.type === "image") {
          page.drawImage(item.image, {
            x, y: reader.section.h - (baselineY + item.height - line.height * 0.78),
            width: item.width, height: item.height
          });
          x += item.width;
          continue;
        }
        if (item.type === "space" || item.type === "tab") { x += item.width + extra; continue; }
        const st = item.st;
        const drawSize = st.sup || st.sub ? st.size * 0.65 : st.size;
        const raise = st.sup ? -st.size * 0.33 : st.sub ? st.size * 0.15 : 0;
        const baseline = reader.section.h - (baselineY + raise);
        if (st.shade) page.drawRectangle({ x, y: baseline - drawSize * 0.28, width: item.width + 0.6, height: drawSize * 1.12, color: ctx.rgb(st.shade) });
        if (st.highlight) page.drawRectangle({ x, y: baseline - drawSize * 0.3, width: item.width + 0.6, height: drawSize * 1.1, color: ctx.rgb(st.highlight) });
        if (item.text.trim()) {
          page.drawText(item.text, {
            x, y: baseline, size: drawSize,
            font: ctx.font({ ...st, size: drawSize }),
            color: ctx.rgb(st.colorHex || "000000")
          });
        }
        if (st.underline) page.drawLine({
          start: { x, y: baseline - drawSize * 0.14 },
          end: { x: x + item.width, y: baseline - drawSize * 0.14 },
          thickness: Math.max(0.5, drawSize * 0.055), color: ctx.rgb(st.colorHex || "000000")
        });
        if (st.strike) page.drawLine({
          start: { x, y: baseline + drawSize * 0.26 },
          end: { x: x + item.width, y: baseline + drawSize * 0.26 },
          thickness: Math.max(0.5, drawSize * 0.055), color: ctx.rgb(st.colorHex || "000000")
        });
        x += item.width;
      }

      y = top + line.height;
      if (!inCell) reader.y = y;
      if (line.pageBreakAfter) {
        if (li === layout.lines.length - 1) breakAfterParagraph = true;
        else if (!inCell) { reader.newPage(); y = reader.y; }
      }
    }

    if (props.after) y += props.after;
    if (!inCell && breakAfterParagraph) { reader.newPage(); y = reader.y; }
    if (!inCell) reader.y = y;
    return y;
  }

  /* ---------- tables ---------- */
  function readBorders(el) {
    if (!el) return null;
    const out = {};
    for (const edge of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
      const e = kidOf(el, edge);
      if (!e) continue;
      const v = valOf(e);
      if (v && /^nil$/i.test(v)) { out[edge] = null; continue; }
      out[edge] = {
        sz: Math.max(0.4, numAttr(e, "sz", 4) / 8),
        hex: (v && !/^auto$/i.test(v)) ? v : (wAttr(e, "color") || "000000")
      };
    }
    return out;
  }
  function readCellMargins(el) {
    if (!el) return null;
    const out = {};
    for (const edge of ["top", "left", "bottom", "right"]) {
      const e = kidOf(el, edge);
      if (e) out[edge] = numAttr(e, "w", 0) / TWIP;
    }
    return out;
  }
  function tableProps(tbl) {
    const tblPr = kidOf(tbl, "tblPr");
    const prop = {};
    const styleIdEl = tblPr && kidOf(tblPr, "tblStyle");
    if (styleIdEl) {
      for (const s of styleChain(styles, valOf(styleIdEl), "table")) {
        const raw = s.raw && kidOf(s.raw, "tblPr");
        if (!raw) continue;
        prop.borders = readBorders(kidOf(raw, "tblBorders")) || prop.borders;
        prop.cellMar = readCellMargins(kidOf(raw, "tblCellMar")) || prop.cellMar;
      }
    }
    if (tblPr) {
      prop.borders = readBorders(kidOf(tblPr, "tblBorders")) || prop.borders;
      prop.cellMar = readCellMargins(kidOf(tblPr, "tblCellMar")) || prop.cellMar;
      const jc = kidOf(tblPr, "jc");
      prop.align = jc ? valOf(jc) : null;
      const w = kidOf(tblPr, "tblW");
      if (w) {
        const type = wAttr(w, "type") || "auto";
        const v = Number(wAttr(w, "w")) || 0;
        if (type === "dxa") prop.width = v / TWIP;
        else if (type === "pct") prop.pct = v / 5000;
      }
      const ind = kidOf(tblPr, "tblInd");
      prop.indent = ind ? numAttr(ind, "w", 0) / TWIP : 0;
    }
    return prop;
  }
  function columnWidths(tbl, width) {
    const grid = kidOf(tbl, "tblGrid");
    let cols = grid ? kidsOf(grid, "gridCol").map(c => numAttr(c, "w", 0) / TWIP) : [];
    if (!cols.length) {
      const firstRow = kidOf(tbl, "tr");
      if (firstRow) {
        let n = 0;
        for (const tc of kidsOf(firstRow, "tc")) {
          const tcPr = kidOf(tc, "tcPr");
          const gs = tcPr && kidOf(tcPr, "gridSpan");
          n += gs ? numAttr(gs, "val", 1) : 1;
        }
        if (n) cols = Array(n).fill(width / n);
      }
    }
    if (!cols.length) cols = [width];
    const total = cols.reduce((a, b) => a + b, 0) || width;
    if (Math.abs(total - width) > 2) cols = cols.map(c => c / total * width);
    return cols;
  }
  function cellBorders(tcPr, tblBorders) {
    const own = tcPr ? readBorders(kidOf(tcPr, "tcBorders")) : null;
    const out = {};
    for (const edge of ["top", "left", "bottom", "right"]) {
      if (own && edge in own) out[edge] = own[edge];
      else if (tblBorders && edge in tblBorders) out[edge] = tblBorders[edge];
      else out[edge] = null;
    }
    return out;
  }

  function measureCellBlocks(tc, width) {
    const tcPr = kidOf(tc, "tcPr");
    const mar = (tcPr && readCellMargins(kidOf(tcPr, "tcMar"))) || {};
    const padding = { top: mar.top ?? 0, bottom: mar.bottom ?? 0, left: mar.left ?? 5.4, right: mar.right ?? 5.4 };
    const inner = Math.max(12, width - padding.left - padding.right);
    let height = 0;
    for (const node of blocksOf(tc)) {
      if (node.localName === "p") {
        const par = buildParagraph(node, { inTable: true });
        const marker = listMarker(par.props, par);
        if (marker) par.bullet = marker;
        const layout = layoutParagraph(par, inner);
        height += (par.props.before || 0) + layout.height + (par.props.after || 0);
      } else if (node.localName === "tbl") {
        height += measureTable(node, inner);
      }
    }
    if (!height) height = DEFAULT_SIZE * 1.2;
    return height + padding.top + padding.bottom;
  }

  function measureTable(tbl, width) {
    const cols = columnWidths(tbl, Math.min(width, tableProps(tbl).width || width));
    let total = 0;
    for (const tr of kidsOf(tbl, "tr")) {
      let rowH = 0, col = 0;
      for (const tc of kidsOf(tr, "tc")) {
        const tcPr = kidOf(tc, "tcPr");
        const gs = tcPr && kidOf(tcPr, "gridSpan");
        const span = gs ? numAttr(gs, "val", 1) : 1;
        const vMergeEl = tcPr ? kidOf(tcPr, "vMerge") : null;
        const continues = vMergeEl && (valOf(vMergeEl) || "continue") === "continue";
        const cw = cols.slice(col, col + span).reduce((a, b) => a + b, 0);
        if (!continues) rowH = Math.max(rowH, measureCellBlocks(tc, cw));
        col += span;
      }
      const trPr = kidOf(tr, "trPr");
      const trH = trPr && kidOf(trPr, "trHeight");
      if (trH) rowH = Math.max(rowH, numAttr(trH, "val", 0) / TWIP);
      total += rowH;
    }
    return total;
  }

  function renderTable(tbl, frame, depth = 0) {
    if (depth > 3) return;
    const info = tableProps(tbl);
    const width = Math.min(frame.width, info.width || frame.width);
    const cols = columnWidths(tbl, width);
    const rows = kidsOf(tbl, "tr");
    if (!rows.length) return;
    const padDefault = { top: 0, bottom: 0, left: 5.4, right: 5.4 };
    if (info.cellMar) Object.assign(padDefault, info.cellMar);
    let tableX = frame.x + (info.indent || 0);
    if (info.align === "center") tableX = frame.x + (frame.width - width) / 2;
    else if (info.align === "right" || info.align === "end") tableX = frame.x + frame.width - width;

    const headerRows = rows.filter(tr => {
      const trPr = kidOf(tr, "trPr");
      const h = trPr && kidOf(trPr, "tblHeader");
      return h && onOff(h);
    });

    const drawRow = (tr, repeat) => {
      const trPr = kidOf(tr, "trPr");
      let rowH = 0, col = 0;
      const cells = [];
      for (const tc of kidsOf(tr, "tc")) {
        const tcPr = kidOf(tc, "tcPr");
        const gs = tcPr && kidOf(tcPr, "gridSpan");
        const span = gs ? numAttr(gs, "val", 1) : 1;
        const vMergeEl = tcPr ? kidOf(tcPr, "vMerge") : null;
        const vMerge = vMergeEl ? (valOf(vMergeEl) || "continue") : null;
        const cellW = cols.slice(col, col + span).reduce((a, b) => a + b, 0);
        const mar = (tcPr && readCellMargins(kidOf(tcPr, "tcMar"))) || padDefault;
        const padding = { top: mar.top ?? padDefault.top, bottom: mar.bottom ?? padDefault.bottom, left: mar.left ?? padDefault.left, right: mar.right ?? padDefault.right };
        const inner = Math.max(12, cellW - padding.left - padding.right);
        const cell = { x: tableX + cols.slice(0, col).reduce((a, b) => a + b, 0), w: cellW, padding, inner, tcPr, blocks: blocksOf(tc), vMerge, units: [], height: 0 };
        if (vMerge !== "continue") {
          for (const node of cell.blocks) {
            if (node.localName === "p") {
              const par = buildParagraph(node, { inTable: true });
              const marker = listMarker(par.props, par);
              if (marker) par.bullet = marker;
              const layout = layoutParagraph(par, inner);
              cell.height += (par.props.before || 0) + layout.height + (par.props.after || 0);
              cell.units.push({ par, layout });
            } else if (node.localName === "tbl") {
              const nestedH = measureTable(node, inner);
              cell.height += nestedH;
              cell.units.push({ nested: node, height: nestedH });
            }
          }
        }
        rowH = Math.max(rowH, cell.height + padding.top + padding.bottom);
        cells.push(cell);
        col += span;
      }
      const trH = trPr && kidOf(trPr, "trHeight");
      if (trH) rowH = Math.max(rowH, numAttr(trH, "val", 0) / TWIP);

      if (!repeat && !reader.space(rowH) && rowH < reader.contentHeight()) {
        reader.newPage();
        for (const h of headerRows) if (h !== tr) drawRow(h, true);
      }
      const top = reader.y;

      for (const cell of cells) {
        const shd = cell.tcPr && kidOf(cell.tcPr, "shd");
        const fill = shd ? wAttr(shd, "fill") : null;
        if (fill && !/^auto$/i.test(fill) && fill !== "FFFFFF") {
          reader.page.drawRectangle({ x: cell.x, y: reader.section.h - top - rowH, width: cell.w, height: rowH, color: ctx.rgb(fill) });
        }
        const borders = cellBorders(cell.tcPr, info.borders);
        for (const edge of ["top", "left", "bottom", "right"]) {
          const b = borders[edge];
          if (!b) continue;
          const t = Math.max(0.4, b.sz);
          const color = ctx.rgb(b.hex);
          if (edge === "top") reader.page.drawLine({ start: { x: cell.x, y: reader.section.h - top }, end: { x: cell.x + cell.w, y: reader.section.h - top }, thickness: t, color });
          if (edge === "bottom") reader.page.drawLine({ start: { x: cell.x, y: reader.section.h - top - rowH }, end: { x: cell.x + cell.w, y: reader.section.h - top - rowH }, thickness: t, color });
          if (edge === "left") reader.page.drawLine({ start: { x: cell.x, y: reader.section.h - top }, end: { x: cell.x, y: reader.section.h - top - rowH }, thickness: t, color });
          if (edge === "right") reader.page.drawLine({ start: { x: cell.x + cell.w, y: reader.section.h - top }, end: { x: cell.x + cell.w, y: reader.section.h - top - rowH }, thickness: t, color });
        }
        const va = cell.tcPr && kidOf(cell.tcPr, "vAlign");
        const vAlign = va ? valOf(va) : "top";
        let cellTop = top + cell.padding.top;
        if (vAlign === "center") cellTop = top + (rowH - cell.height) / 2;
        else if (vAlign === "bottom") cellTop = top + rowH - cell.height - cell.padding.bottom;
        let y = cellTop;
        for (const unit of cell.units) {
          if (unit.par) y = drawParagraph(unit.par, unit.layout, { x: cell.x + cell.padding.left, width: cell.inner }, { inCell: true, startY: y });
          else if (unit.nested) {
            const saved = reader.y;
            reader.y = y;
            renderTable(unit.nested, { x: cell.x + cell.padding.left, width: cell.inner }, depth + 1);
            y = Math.max(y + unit.height, reader.y);
            reader.y = saved;
          }
        }
      }
      reader.y = top + rowH;
    };

    for (const tr of rows) drawRow(tr, false);
  }

  /* ---------- render the body ---------- */
  const blocks = blocksOf(body);
  reader.newPage();
  let seen = 0;
  for (const block of blocks) {
    if (block.localName === "p") {
      const par = buildParagraph(block);
      const marker = listMarker(par.props, par);
      if (marker) par.bullet = marker;
      const layout = layoutParagraph(par, reader.contentWidth());
      drawParagraph(par, layout, { x: reader.section.left, width: reader.contentWidth() });
      if (par.sectPr) {
        const next = readSection(par.sectPr);
        const type = wAttr(par.sectPr, "type") || "nextPage";
        reader.section = next;
        if (type === "nextPage" || type === "oddPage" || type === "evenPage") reader.newPage();
      }
      seen++;
      if (job && seen % 10 === 0) job.progress(Math.min(92, 10 + Math.round((seen / Math.max(20, blocks.length)) * 80)), "Laying out page content…");
    } else if (block.localName === "tbl") {
      renderTable(block, { x: reader.section.left, width: reader.contentWidth() });
    }
  }

  /* ---------- optional page numbers ---------- */
  if (options && options.pageNumbers) {
    const pages = pdf.getPages();
    const size = 9;
    pages.forEach((page, i) => {
      const label = String(i + 1) + " / " + pages.length;
      const font = fonts.helvetica;
      const w = font.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: (page.getSize().width - w) / 2,
        y: Math.max(16, reader.section.bottom / 2.4),
        size, font, color: rgb(0.45, 0.45, 0.45)
      });
    });
  }

  if (job) job.progress(96, "Finishing the PDF…");
  pdf.setTitle(fileName.replace(/\.docx$/i, ""));
  pdf.setCreator("MarketTech Applications");
  pdf.setProducer("MarketTech Applications — Word to PDF (browser)");
  const out = await pdf.save();
  return {
    bytes: out,
    pages: pdf.getPageCount(),
    dropped: stats.dropped,
    imagesSkipped: stats.imagesSkipped,
    imagesKept: stats.imagesKept
  };
}
