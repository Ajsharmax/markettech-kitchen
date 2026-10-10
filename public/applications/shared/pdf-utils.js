/** Shared helpers. pdfjsLib, PDFLib and JSZip are pinned local vendor scripts loaded by the calling page. */
export function parsePageRanges(input, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("Page count must be positive.");
  const pages = new Set();
  const parts = String(input || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Enter a page range, for example 1-3, 5, 8-.");
  for (const part of parts) {
    const match = part.match(/^(\d+)?\s*(?:-\s*(\d*)?)?$/);
    if (!match || (!match[1] && !part.startsWith("-"))) throw new Error('Invalid page range: "' + part + '".');
    let start, end;
    if (part.includes("-")) {
      start = match[1] ? Number(match[1]) : 1;
      end = match[2] ? Number(match[2]) : pageCount;
    } else { start = Number(match[1]); end = start; }
    if (start < 1 || end < start || end > pageCount) throw new Error("Page range must be between 1 and " + pageCount + ".");
    for (let p = start; p <= end; p++) pages.add(p);
  }
  return [...pages].sort((a,b) => a-b);
}
export function warnForLargeFile(file, threshold = 100 * 1024 * 1024) {
  return file && file.size > threshold ? "This file is over 100 MB. Processing may use substantial memory; close other tabs or use a smaller file." : "";
}
export async function loadPdf(fileOrBytes, { onPassword } = {}) {
  if (!globalThis.pdfjsLib) throw new Error("The local PDF.js library did not load.");
  const bytes = fileOrBytes instanceof Uint8Array ? fileOrBytes.slice() :
    fileOrBytes instanceof ArrayBuffer ? new Uint8Array(fileOrBytes.slice(0)) : new Uint8Array(await fileOrBytes.arrayBuffer());
  return pdfjsLib.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    onPassword: (updatePassword, reason) => {
      if (onPassword) onPassword(updatePassword, reason);
      else {
        const value = window.prompt(reason === 2 ? "Wrong password. Enter the PDF password again:" : "This PDF is password protected. Enter its password:");
        if (value === null) throw new Error("Password entry cancelled.");
        updatePassword(value);
      }
    }
  }).promise.catch(error => {
    if (error?.name === "PasswordException") throw new Error("Wrong password or password-protected PDF could not be opened.");
    if (error?.name === "InvalidPDFException") throw new Error("This PDF is damaged or invalid.");
    throw error;
  });
}
export async function renderPage(pdf, pageNumber, scale = 1.5, canvas = document.createElement("canvas")) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation: 0 });
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d", { willReadFrequently: true }), viewport }).promise;
  return { canvas, page, viewport };
}
export async function makeThumbnail(pdf, pageNumber, width = 144) {
  const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}
export async function savePdf(pdfDocument) {
  if (!pdfDocument || typeof pdfDocument.save !== "function") throw new Error("A valid PDF document is required.");
  return pdfDocument.save();
}
export async function zipOutputs(files, zipName = "pdf-toolkit-output.zip") {
  if (!globalThis.JSZip) throw new Error("The local ZIP library did not load.");
  const zip = new JSZip();
  for (const item of files) zip.file(item.name, item.blob || item.bytes);
  return new Blob([await zip.generateAsync({ type: "uint8array" })], { type: "application/zip" });
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none"; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}