// Smoke-tests the self-hosted PowerPoint browser build and the PPTX package it produces.
// Run: node tests/powerpoint.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const vendor = path.resolve("public/applications/vendor");
const JSZip = require(path.join(vendor, "jszip-3.10.1.min.js"));
const pptxSource = readFileSync(path.join(vendor, "pptxgenjs-3.12.0.min.js"), "utf8");
const context = {
  JSZip, console, setTimeout, clearTimeout, setImmediate, clearImmediate,
  Buffer, Blob, Uint8Array, Uint8ClampedArray, ArrayBuffer, DataView,
  TextEncoder, TextDecoder, Date, Math, Promise, Error, RegExp, JSON, parseInt, isNaN
};
context.window = context;
context.global = context;
context.self = context;
vm.runInNewContext(pptxSource, context, { timeout: 5000 });
assert.equal(typeof context.PptxGenJS, "function", "the vendored browser build should expose PptxGenJS");

const pptx = new context.PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "MarketTech Applications";
const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SuoAAAAASUVORK5CYII=";
for (let i = 0; i < 2; i++) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addImage({ data: onePixelPng, x: 0, y: 0, w: 13.333333, h: 7.5 });
}
const output = await pptx.write({ outputType: "blob", compression: true });
assert.ok(output instanceof Blob, "browser output should be a Blob");
assert.ok(output.size > 0, "PowerPoint output should not be empty");

const archive = await JSZip.loadAsync(new Uint8Array(await output.arrayBuffer()));
assert.ok(archive.file("[Content_Types].xml"));
assert.ok(archive.file("ppt/presentation.xml"));
assert.ok(archive.file("ppt/slides/slide1.xml"));
assert.ok(archive.file("ppt/slides/slide2.xml"));
assert.ok(Object.keys(archive.files).some(name => name.startsWith("ppt/media/") && name.endsWith(".png")));
const presentation = await archive.file("ppt/presentation.xml").async("string");
assert.equal((presentation.match(/<p:sldId\b/g) || []).length, 2, "the deck should contain both slides");
const slide = await archive.file("ppt/slides/slide1.xml").async("string");
assert.match(slide, /<p:pic\b/, "each PDF page should be embedded as a picture");

// Exercise the actual tool spec with a small PDF.js/canvas stand-in, through the same library build.
globalThis.__PptxGenJS = context.PptxGenJS;
globalThis.__samplePdf = {
  numPages: 3,
  getPage(number) {
    const [width, height] = number === 2 ? [792, 612] : [612, 792];
    return { getViewport: ({ scale = 1 }) => ({ width: width * scale, height: height * scale }) };
  }
};
const fakeCore = `
  export class UserError extends Error {}
  export async function lib(name) { if (name === "pptxgenjs") return globalThis.__PptxGenJS; throw new Error("unexpected library " + name); }
  export async function openPdfJs() { return globalThis.__samplePdf; }
  export async function renderPage(pdf, number, { scale = 1 } = {}) {
    const viewport = pdf.getPage(number).getViewport({ scale });
    return { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height), toDataURL: () => ${JSON.stringify(onePixelPng)} };
  }
  export function parseRanges(text, total) {
    const value = String(text || "").trim().toLowerCase();
    if (value === "all") return Array.from({ length: total }, (_, i) => i + 1);
    return value.split(",").flatMap(part => {
      const match = part.trim().match(/^(\\d+)(?:-(\\d+))?$/);
      if (!match) throw new UserError("Invalid page range");
      const start = Number(match[1]), end = Number(match[2] || start);
      if (start < 1 || end > total || end < start) throw new UserError("Page range is outside the PDF");
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    });
  }
  export function baseName(name) { return String(name || "file").replace(/\\.[^.]+$/, ""); }
  export async function openPdfLib() {}
  export async function canvasBlob() {}
  export async function readBytes() {}
  export function isPdf() { return true; }
  export function h() {}
`;
const convertSource = readFileSync(path.resolve("public/applications/tools/convert.js"), "utf8")
  .replace('from "/applications/core.js";', 'from "data:text/javascript;base64,' + Buffer.from(fakeCore).toString("base64") + '";');
const convertModule = await import("data:text/javascript;base64," + Buffer.from(convertSource).toString("base64"));
const progress = [];
const result = await convertModule.default["pdf-to-powerpoint"].run({
  files: [{ name: "sample.pdf", size: 1024, bytes: async () => new Uint8Array() }],
  opts: { pages: "1-2", slideSize: "match", dpi: "150", format: "png" },
  job: { progress: (value, message) => progress.push([value, message]), tick: async () => {} }
});
assert.equal(result.outputs[0].name, "sample.pptx");
assert.equal(result.outputs[0].data.type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
assert.match(result.note, /Created 2 image-based slides/);
const converted = await JSZip.loadAsync(new Uint8Array(await result.outputs[0].data.arrayBuffer()));
const convertedPresentation = await converted.file("ppt/presentation.xml").async("string");
assert.equal((convertedPresentation.match(/<p:sldId\b/g) || []).length, 2, "page ranges should control the output slide count");
const customSize = convertedPresentation.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
assert.ok(customSize, "the matched-page layout should create a custom slide size");
assert.ok(Math.abs(Number(customSize[1]) / Number(customSize[2]) - 612 / 792) < 0.001);
assert.ok(progress.some(([, message]) => message.includes("Rendering page 2")));
console.log("PowerPoint browser build, converter flow and PPTX generation passed");
