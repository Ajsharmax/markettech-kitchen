// Functional smoke tests for the shared Applications tools (no browser or network required).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { calculateEmi } from "../public/applications/tools/emi.js";
import { sanitizeResumeData } from "../public/applications/tools/cv-resume.js";

const root = path.resolve(".");
const require = createRequire(import.meta.url);
const PDFLib = require(path.join(root, "public/applications/vendor/pdf-lib-1.10.0.min.js"));
const JSZip = require(path.join(root, "public/applications/vendor/jszip-3.10.1.min.js"));
globalThis.window = globalThis;
globalThis.PDFLib = PDFLib;
globalThis.JSZip = JSZip;

async function importTool(file) {
  const sourcePath = path.join(root, "public/applications/tools", file);
  const coreUrl = pathToFileURL(path.join(root, "public/applications/core.js")).href;
  const rawStage = readFileSync(path.join(root, "public/applications/stage.js"), "utf8").replaceAll('"/applications/core.js"', JSON.stringify(coreUrl));
  const stageUrl = "data:text/javascript;base64," + Buffer.from(rawStage).toString("base64");
  const rawPages = readFileSync(path.join(root, "public/applications/tools/pages.js"), "utf8").replaceAll('"/applications/core.js"', JSON.stringify(coreUrl));
  const pagesUrl = "data:text/javascript;base64," + Buffer.from(rawPages).toString("base64");
  const source = readFileSync(sourcePath, "utf8")
    .replaceAll('"/applications/core.js"', JSON.stringify(coreUrl))
    .replaceAll('"/applications/stage.js"', JSON.stringify(stageUrl))
    .replaceAll('"/applications/tools/pages.js"', JSON.stringify(pagesUrl));
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

const job = { progress() {}, async tick() {} };
const { PDFDocument, StandardFonts, rgb } = PDFLib;
const original = await PDFDocument.create();
const font = await original.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 4; i++) {
  const page = original.addPage([300 + i * 10, 400 + i * 10]);
  page.drawText("Page " + (i + 1), { x: 20, y: 200, size: 18, font, color: rgb(0, 0, 0) });
}
original.setTitle("Source title");
original.setAuthor("Source author");
const originalBytes = new Uint8Array(await original.save());
const sourceFile = { name: "sample.pdf", size: originalBytes.length, bytes: async () => originalBytes };
const pageModule = await importTool("pages.js");
const pageTools = pageModule.default;
const runPageTool = (slug, opts = {}) => pageTools[slug].run({ files: [sourceFile], opts, job });

// Visual coordinate mappings stay correct for every PDF page rotation and non-zero crop-box origin.
for (const [angle, start, end] of [
  [0, { x: 10, y: 20 }, { x: 310, y: 420 }],
  [90, { x: 310, y: 20 }, { x: 10, y: 420 }],
  [180, { x: 310, y: 420 }, { x: 10, y: 20 }],
  [270, { x: 10, y: 420 }, { x: 310, y: 20 }]
]) {
  const mapper = pageModule.visualMapper({ getCropBox: () => ({ x: 10, y: 20, width: 300, height: 400 }), getRotation: () => ({ angle }) });
  assert.deepEqual(mapper.map(0, 0), start);
  assert.deepEqual(mapper.map(mapper.vw, mapper.vh), end);
}

const labelModule = await importTool("label-crop.js");
function fakeScanCanvas() {
  const width = 100, height = 100, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = 255; }
  const ink = (x, y) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
  for (let y = 15; y <= 44; y++) for (let x = 20; x <= 79; x++) ink(x, y);
  for (let x = 0; x < width; x++) ink(x, 60);
  return { width, height, getContext: () => ({ getImageData: () => ({ data }) }) };
}
assert.deepEqual(labelModule.detectLabel(fakeScanCanvas(), 100, 100, 2), { x: 18, y: 13, w: 64, h: 34 });
assert.deepEqual(labelModule.detectLabel({ width: 100, height: 100, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }) }) }, 100, 100, 2), { x: 0, y: 0, w: 100, h: 100 });

// Merge, split, remove, and extract retain the intended page counts/order.
const merged = await pageTools["merge-pdf"].run({ files: [sourceFile, sourceFile], opts: {}, job });
assert.equal((await PDFDocument.load(merged[0].data)).getPageCount(), 8);
const split = await runPageTool("split-pdf", { mode: "every", n: 3 });
assert.deepEqual(await Promise.all(split.map(async output => (await PDFDocument.load(output.data)).getPageCount())), [3, 1]);
const removed = await runPageTool("remove-pages", { pages: "2,4" });
assert.equal((await PDFDocument.load(removed.outputs[0].data)).getPageCount(), 2);
const extracted = await runPageTool("extract-pages", { pages: "4,1" });
const extractedDoc = await PDFDocument.load(extracted.outputs[0].data);
assert.equal(extractedDoc.getPageCount(), 2);
assert.equal(extractedDoc.getPages()[0].getWidth(), 300, "extracted pages should stay in original order");
await assert.rejects(() => runPageTool("remove-pages", { pages: "all" }), /remove every page/i);

// Page edits write real PDF output with rotation, page numbers, watermarks, and metadata.
const rotated = await runPageTool("rotate-pdf", { pages: "1,3", angle: "90" });
assert.equal((await PDFDocument.load(rotated.outputs[0].data)).getPages()[0].getRotation().angle, 90);
const numbered = await runPageTool("add-page-numbers", { pages: "odd", fmt: "Page {n} of {total}", pos: "bc", start: 1, size: 11, margin: 24 });
assert.equal((await PDFDocument.load(numbered.outputs[0].data)).getPageCount(), 4);
const watermarked = await runPageTool("add-watermark", { kind: "text", text: "TEST", color: "#b3261e", size: 48, opacity: 25, angle: 0, layout: "center", pages: "all" });
assert.equal((await PDFDocument.load(watermarked.outputs[0].data)).getPageCount(), 4);
const metadata = await runPageTool("edit-metadata", { title: "New title", author: "New author", subject: "A subject", keywords: "one, two", creator: "Unit test", clear: false });
const editedMetadata = await PDFDocument.load(metadata[0].data);
assert.equal(editedMetadata.getTitle(), "New title");
assert.equal(editedMetadata.getAuthor(), "New author");
assert.equal(editedMetadata.getKeywords(), "one two");

// Text-based converters handle multiple pages, layout line breaks, and OOXML escaping.
class TestNode {
  constructor(tag, text = "") { this.tagName = tag; this.textContent = text; this.children = []; this.attributes = {}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}
const textDocuments = new Map();
let textFileId = 0;
const itemsFor = lines => lines.map((str, index) => ({
  str, transform: [1, 0, 0, 1, 10, 700 - index * 20], width: str.length * 5, height: 10, hasEOL: true
}));
function makeTextFile(name, pages) {
  const bytes = Uint8Array.from([++textFileId, 17, 29, 41]);
  textDocuments.set(Buffer.from(bytes).toString("base64"), pages);
  return { name, size: bytes.length, bytes: async () => bytes };
}
const jpgSample = readFileSync(path.join(root, "public/images/product-pan.jpg"));
const pngSample = readFileSync(path.join(root, "public/images/markettech-logo-v2.png"));
class TestCanvas extends TestNode {
  constructor() { super("CANVAS"); this.width = 1; this.height = 1; }
  getContext() {
    return {
      fillStyle: "#fff", fillRect() {}, drawImage() {}, putImageData() {},
      getImageData: () => { const data = new Uint8ClampedArray(this.width * this.height * 4); for (let i = 3; i < data.length; i += 4) data[i] = 255; return { data }; }
    };
  }
  toBlob(callback, mime) { callback(new Blob([mime === "image/png" ? pngSample : jpgSample], { type: mime })); }
}
globalThis.createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
textDocuments.set(Buffer.from(originalBytes).toString("base64"), Array.from({ length: 4 }, (_, index) => ["Page " + (index + 1)]));
const fakePdfJs = {
  GlobalWorkerOptions: Object.defineProperty({}, "workerSrc", { set() {}, get() { return ""; } }),
  getDocument({ data }) {
    const pages = textDocuments.get(Buffer.from(data).toString("base64"));
    if (!pages) throw new Error("Unknown test PDF");
    return { promise: Promise.resolve({
      numPages: pages.length,
      async getPage(n) {
        const width = 300 + (n - 1) * 10, height = 400 + (n - 1) * 10;
        return {
          getViewport({ scale = 1 }) { return { width: width * scale, height: height * scale }; },
          render() { return { promise: Promise.resolve() }; },
          async getTextContent() { return { items: itemsFor(pages[n - 1]) }; }
        };
      }
    }), destroy() {} };
  }
};
globalThis.pdfjsLib = fakePdfJs;
const convertTools = (await importTool("convert.js")).default;
const before = makeTextFile("before.pdf", [["Alpha", "Remove this", "Keep & stay"]]);
const after = makeTextFile("after.pdf", [["Alpha", "Add this", "Keep & stay"]]);
const textResult = await convertTools["extract-text"].run({ files: [before], opts: { marks: true }, job });
assert.match(await textResult.outputs[0].data.text(), /--- Page 1 ---[\s\S]*Alpha[\s\S]*Remove this/);
const wordResult = await convertTools["pdf-to-word"].run({ files: [before], job });
const docxZip = await JSZip.loadAsync(new Uint8Array(await wordResult[0].data.arrayBuffer()));
const documentXml = await docxZip.file("word/document.xml").async("string");
assert.match(documentXml, /Keep &amp; stay/);
globalThis.Node = TestNode;
globalThis.document = { createElement: tag => tag === "canvas" ? new TestCanvas() : new TestNode(tag), createTextNode: text => new TestNode("#text", String(text)) };
const diff = await convertTools["compare-pdf"].run({ files: [before, after], job });
assert.match(await diff.outputs[0].data.text(), /- Remove this/);
assert.match(await diff.outputs[0].data.text(), /\+ Add this/);

// Image/PDF conversions and raster tools complete with real embedded image data.
const imageResult = await convertTools["images-to-pdf"].run({
  files: [
    { name: "logo.png", file: { name: "logo.png", type: "image/png" } },
    { name: "pan.jpg", file: { name: "pan.jpg", type: "image/jpeg" } }
  ],
  opts: { size: "label", orient: "auto", margin: "18" }, job
});
const imagePdf = await PDFDocument.load(imageResult[0].data);
assert.equal(imagePdf.getPageCount(), 2);
assert.equal(imagePdf.getPages()[0].getWidth(), 432, "automatic image orientation should fit a landscape picture to landscape label paper");
const imagePages = await convertTools["pdf-to-images"].run({ files: [sourceFile], opts: { fmt: "jpeg", dpi: "72", pages: "2,4" }, job });
assert.deepEqual(imagePages.map(output => output.name), ["sample-page-2.jpg", "sample-page-4.jpg"]);
assert.ok(imagePages.every(output => output.mime === "image/jpeg" && output.data.size > 0));
const lossless = await convertTools["compress-pdf"].run({ files: [sourceFile], opts: { mode: "lossless" }, job });
assert.equal((await PDFDocument.load(lossless.outputs[0].data)).getPageCount(), 4);
const balanced = await convertTools["compress-pdf"].run({ files: [sourceFile], opts: { mode: "balanced" }, job });
assert.equal((await PDFDocument.load(balanced.outputs[0].data)).getPageCount(), 4);
const grayscale = await convertTools["grayscale-pdf"].run({ files: [sourceFile], job });
assert.equal((await PDFDocument.load(grayscale[0].data)).getPageCount(), 4);

// Calculator guards manual input and extreme values, while matching the displayed example.
const exampleEmi = calculateEmi(500_000, 10.5, 60);
assert.ok(Math.abs(exampleEmi.emi - 10_746.95) < 0.01);
assert.equal(exampleEmi.schedule.length, 60);
assert.ok(exampleEmi.schedule.at(-1).balance < 0.01);
const interestFree = calculateEmi(120_000, 0, 12);
assert.equal(interestFree.emi, 10_000);
assert.equal(interestFree.interest, 0);
const cappedEmi = calculateEmi(1e12, 999, 1e9);
assert.equal(cappedEmi.schedule.length, 360, "manual tenure must not create an unbounded schedule");
assert.ok(Math.abs(cappedEmi.schedule[0].interest - (10_000_000 * 0.5 / 12)) < 0.01, "manual loan amount and rate must be clamped to the advertised limits");
assert.ok(Number.isFinite(cappedEmi.total));
assert.ok(cappedEmi.schedule.at(-1).balance < 0.01);

// Imported CV JSON is normalized to known fields and harmless bounded collections.
const hostileName = "<script>alert(1)</script>";
const resume = sanitizeResumeData({
  fullName: hostileName,
  activeTemplate: "<img>",
  experience: "not an array",
  skills: ["JavaScript", 42, null],
  languages: [{ name: 12, level: "Fluent" }, null]
});
assert.equal(resume.fullName, hostileName);
assert.equal(resume.activeTemplate, "classic");
assert.deepEqual(resume.experience, []);
assert.deepEqual(resume.skills, ["JavaScript"]);
assert.equal(resume.languages[0].name, "12");
assert.throws(() => sanitizeResumeData(null), /resume data object/i);
const cvSource = readFileSync(path.join(root, "public/applications/tools/cv-resume.js"), "utf8");
assert.match(cvSource, /fetch\("\/applications\/cv-resume\.css"/);
assert.match(cvSource, /<style>html,body\{margin:0;background:#fff;\}/);
assert.match(cvSource, /const title = escapeHTML\(state\.fullName/);

// The external-library standalone tools also need valid executable inline scripts.
for (const file of ["public/pdf-to-excel.html", "public/ocr-pdf.html"]) {
  const html = readFileSync(path.join(root, file), "utf8");
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(code => code.trim());
  assert.ok(inline.length, file + " should contain its tool logic");
  inline.forEach(code => assert.doesNotThrow(() => new Function(code), file + " inline script should parse"));
}

console.log("Applications functional smoke tests passed (PDF page edits, text conversions, CV import/export safeguards, EMI, and standalone page scripts).");
