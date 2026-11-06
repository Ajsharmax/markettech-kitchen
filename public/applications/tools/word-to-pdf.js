/* Word to PDF — rebuilds a .docx as a PDF in this browser. */
import { baseName, UserError } from "/applications/core.js";
import { convertDocx } from "/applications/docx-convert.js";

const specs = {};

specs["word-to-pdf"] = {
  accept: "docx",
  multiple: false,
  action: "Convert to PDF",
  dropText: "Drop a Word file here or click to choose",
  dropHint: "Word documents (.docx). The file is read on this device and is never uploaded.",
  intro: "This rebuilds the document in your browser: headings, bold and italic text, colours, lists, tables, pictures and page breaks are kept. Headers, footers, footnotes, text boxes, charts and floating layouts are not included yet. Hindi and other non-Latin scripts are refused here because the browser fonts cannot typeset them faithfully.",
  options: [
    {
      id: "pageSize", type: "select", label: "Page size", default: "document",
      choices: [["document", "Use the size in the document"], ["a4", "A4 (210 × 297 mm)"], ["letter", "US Letter (8.5 × 11 in)"], ["legal", "US Legal (8.5 × 14 in)"], ["a5", "A5 (148 × 210 mm)"]]
    },
    { id: "pageNumbers", type: "checkbox", label: "Add page numbers at the bottom", default: false }
  ],
  async run({ files, opts, job }) {
    const file = files[0];
    if (!file) throw new UserError("Choose a .docx file first.");
    if (!/\.docx$/i.test(file.name)) throw new UserError("“" + file.name + "” is not a .docx file. In Word, use Save As → Word Document (.docx) first.");
    job.progress(2, "Reading the Word file…");
    const bytes = await file.bytes();
    const result = await convertDocx(bytes, file.name, opts, job);
    job.progress(98, "Done");
    const notes = ["Rebuilt " + result.pages + (result.pages === 1 ? " page" : " pages") + " in your browser."];
    if (result.imagesKept) notes.push(result.imagesKept + (result.imagesKept === 1 ? " picture kept" : " pictures kept") + ".");
    if (result.imagesSkipped) notes.push(result.imagesSkipped + " picture(s) used a format this browser cannot draw (such as EMF or WMF) and were skipped.");
    if (result.dropped) notes.push(result.dropped + " character(s) outside the Latin alphabet were left out.");
    return {
      outputs: [{ name: baseName(file.name) + ".pdf", data: result.bytes, mime: "application/pdf" }],
      note: notes.join(" ")
    };
  }
};

export default specs;
