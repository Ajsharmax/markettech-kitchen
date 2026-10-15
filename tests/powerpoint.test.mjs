// Tests the self-hosted PowerPoint build and verifies PDF text becomes editable PPTX text.
// Run: node tests/powerpoint.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SuoAAAAASUVORK5CYII=";
const core = await import(pathToFileURL(path.resolve("public/applications/core.js")));
let paintedText = 0, paintedVectors = 0;
const nativeTextPaint = () => { paintedText++; };
const renderContext = {
  fillStyle: "", fillRect() {}, fillText: nativeTextPaint, strokeText: nativeTextPaint,
  stroke() { paintedVectors++; }
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => renderContext }) };
const renderablePage = {
  getViewport: ({ scale = 1 }) => ({ width: 20 * scale, height: 30 * scale }),
  render: ({ canvasContext }) => ({ promise: Promise.resolve().then(() => {
    canvasContext.fillText("must be editable", 0, 0);
    canvasContext.strokeText("also editable", 0, 0);
    canvasContext.stroke();
  }) })
};
await core.renderPage({ getPage: async () => renderablePage }, 1, { skipText: true });
assert.equal(paintedText, 0, "the artwork render must suppress canvas text");
assert.equal(paintedVectors, 1, "non-text vector artwork must remain visible");
assert.equal(renderContext.fillText, nativeTextPaint, "the canvas context must be restored after rendering");
const fontStyle = { fontFamily: "sans-serif", ascent: 0.8, descent: -0.2 };
const textByPage = {
  1: [
    { str: "Order No: 12345", width: 104, height: 12, transform: [12, 0, 0, 12, 40, 740], fontName: "f1" },
    { str: "SKU 056", width: 36, height: 9, transform: [9, 0, 0, 9, 40, 700], fontName: "f1" }
  ],
  2: [{ str: "Editable page two", width: 92, height: 11, transform: [11, 0, 0, 11, 30, 560], fontName: "f1" }],
  4: [{ str: "OCR text", width: 48, height: 10, transform: [10, 0, 0, 10, 30, 700], fontName: "f1" }]
};
const sizes = { 1: [612, 792], 2: [792, 612], 3: [612, 792], 4: [612, 792] };
const fakePdf = {
  numPages: 4,
  getPage(number) {
    const [width, height] = sizes[number];
    return {
      getViewport({ scale = 1 }) {
        return {
          width: width * scale,
          height: height * scale,
          convertToViewportPoint(x, y) { return [x * scale, (height - y) * scale]; }
        };
      },
      async getTextContent() {
        return { items: textByPage[number] || [], styles: { f1: fontStyle } };
      },
      async getOperatorList() {
        return number === 4 ? { fnArray: [38, 44], argsArray: [[3], []] } : { fnArray: [], argsArray: [] };
      }
    };
  }
};
globalThis.__PptxGenJS = context.PptxGenJS;
globalThis.__samplePdf = fakePdf;
globalThis.__renderCalls = [];
const fakeCore = `
  export class UserError extends Error {}
  export async function lib(name) {
    if (name === "pptxgenjs") return globalThis.__PptxGenJS;
    if (name === "pdfjs") return globalThis.__Pdfjs || { OPS: { setTextRenderingMode: 38, setFillRGBColor: 59, setFillColor: 54, setFillCMYKColor: 61, showText: 44, showSpacedText: 45, nextLineShowText: 46, nextLineSetSpacingShowText: 47 } };
    throw new Error("unexpected library " + name);
  }
  export async function openPdfJs(bytes, name, options) { globalThis.__openOptions = options; return globalThis.__samplePdf; }
  export async function renderPage(pdf, number, options = {}) {
    globalThis.__renderCalls.push({ number, skipText: options.skipText, scale: options.scale });
    return { width: 1200, height: 1600, toDataURL: () => ${JSON.stringify(onePixelPng)} };
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
assert.equal(globalThis.__openOptions.disableFontFace, false, "editable conversion needs PDF.js font metrics");
assert.deepEqual(globalThis.__renderCalls.map(call => call.skipText), [true, true], "the artwork layer must omit selectable PDF text");
assert.equal(result.outputs[0].name, "sample.pptx");
assert.equal(result.outputs[0].data.type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
assert.match(result.note, /3 editable text blocks/, "the result summary should report the native text boxes");

const archive = await JSZip.loadAsync(new Uint8Array(await result.outputs[0].data.arrayBuffer()));
assert.ok(archive.file("[Content_Types].xml"));
const presentation = await archive.file("ppt/presentation.xml").async("string");
assert.equal((presentation.match(/<p:sldId\b/g) || []).length, 2, "the selected PDF range should control slide count");
const customSize = presentation.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
assert.ok(customSize, "match-page mode should create a custom slide size");
assert.ok(Math.abs(Number(customSize[1]) / Number(customSize[2]) - 612 / 792) < 0.001);
const slideOne = await archive.file("ppt/slides/slide1.xml").async("string");
const slideTwo = await archive.file("ppt/slides/slide2.xml").async("string");
assert.match(slideOne, /<p:pic\b/, "non-text artwork should be retained as a graphic layer");
assert.match(slideOne, /<a:t>Order No: 12345<\/a:t>/, "PDF text should be an editable PowerPoint text run");
assert.match(slideOne, /<a:t>SKU 056<\/a:t>/);
assert.match(slideTwo, /<a:t>Editable page two<\/a:t>/);
assert.ok(progress.some(([, message]) => message.includes("Rebuilding page 2")));
await assert.rejects(
  () => convertModule.default["pdf-to-powerpoint"].run({
    files: [{ name: "scan.pdf", size: 1024, bytes: async () => new Uint8Array() }],
    opts: { pages: "3", slideSize: "match", dpi: "150", format: "png" },
    job: { progress() {}, tick: async () => {} }
  }),
  /no selectable text.*visible\/selectable text/i,
  "scanned pages must not silently fall back to a page-photo PowerPoint"
);
await assert.rejects(
  () => convertModule.default["pdf-to-powerpoint"].run({
    files: [{ name: "ocr-scan.pdf", size: 1024, bytes: async () => new Uint8Array() }],
    opts: { pages: "4", slideSize: "match", dpi: "150", format: "png" },
    job: { progress() {}, tick: async () => {} }
  }),
  /contains invisible text.*background artwork/i,
  "invisible OCR layers over page scans must not produce doubled text"
);

// Exercise real PDF.js text extraction/operator data against an actual one-page PDF.
const { PDFDocument, StandardFonts, rgb } = require(path.join(vendor, "pdf-lib-1.10.0.min.js"));
const realPdf = await PDFDocument.create();
const realPage = realPdf.addPage([612, 792]);
const realFont = await realPdf.embedFont(StandardFonts.Helvetica);
realPage.drawText("Actual PDF text", { x: 40, y: 740, size: 16, font: realFont, color: rgb(0.1, 0.2, 0.3) });
const realPdfBytes = await realPdf.save();
const PDFJS = require(path.join(vendor, "pdfjs-3.11.174.min.js"));
PDFJS.GlobalWorkerOptions.workerSrc = path.resolve(vendor, "pdfjs-3.11.174.worker.min.js");
globalThis.__Pdfjs = PDFJS;
globalThis.__samplePdf = await PDFJS.getDocument({ data: new Uint8Array(realPdfBytes), disableFontFace: false, isEvalSupported: false, verbosity: 0 }).promise;
const realResult = await convertModule.default["pdf-to-powerpoint"].run({
  files: [{ name: "real-sample.pdf", size: realPdfBytes.byteLength, bytes: async () => new Uint8Array(realPdfBytes) }],
  opts: { pages: "all", slideSize: "match", dpi: "150", format: "png" },
  job: { progress() {}, tick: async () => {} }
});
const realArchive = await JSZip.loadAsync(new Uint8Array(await realResult.outputs[0].data.arrayBuffer()));
const realSlide = await realArchive.file("ppt/slides/slide1.xml").async("string");
assert.match(realSlide, /<a:t>Actual PDF text<\/a:t>/, "real PDF.js text items should become native PowerPoint text");
assert.match(realSlide, /<a:srgbClr val="1A334C"\/>/, "PDF.js fill-color operators should be carried into the PPTX");
await globalThis.__samplePdf.destroy();
console.log("Editable PowerPoint conversion and PPTX generation passed");
