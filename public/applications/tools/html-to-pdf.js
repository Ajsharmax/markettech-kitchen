/* HTML to PDF — renders an HTML file to PDF in this browser. */
import { baseName, UserError, ACCEPT, htmlToPdf } from "/applications/core.js";

const specs = {};

specs["html-to-pdf"] = {
  accept: "html",
  multiple: false,
  action: "Convert to PDF",
  dropText: "Drop an HTML file here or click to choose",
  dropHint: "HTML document (.html). The file is read on this device and is never uploaded.",
  intro: "This turns the HTML you give it into a PDF in your browser. Styles, layout and content are kept as the browser can render them.",
  options: [
    { id: "format", type: "select", label: "Page size", default: "a4", choices: [["a4", "A4 (210 × 297 mm)"], ["letter", "US Letter (8.5 × 11 in)"], ["legal", "US Legal (8.5 × 14 in)"], ["a5", "A5 (148 × 210 mm)"]] }
  ],
  async run({ files, opts, job }) {
    const file = files[0];
    if (!file) throw new UserError("Choose an HTML file first.");
    if (!ACCEPT.html.test(file)) throw new UserError("“" + file.name + "” is not an HTML file. Use a .html file with the HTML you want converted.");
    job.progress(2, "Reading the HTML file…");
    const html = await (await file.arrayBuffer()).text();
    const bytes = await htmlToPdf(html, { format: opts.format || "a4" });
    job.progress(98, "Done");
    return {
      outputs: [{ name: baseName(file.name) + ".pdf", data: bytes, mime: "application/pdf" }],
      note: "Converted " + file.name + " to PDF in your browser."
    };
  }
};

export default specs;
