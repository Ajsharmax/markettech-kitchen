/* Excel to PDF — renders the first sheet of an Excel workbook to PDF in this browser. */
import { baseName, UserError, lib, htmlToPdf } from "/applications/core.js";

const specs = {};

specs["excel-to-pdf"] = {
  accept: "xlsx",
  multiple: false,
  action: "Convert to PDF",
  dropText: "Drop an Excel file here or click to choose",
  dropHint: "Excel workbook (.xlsx). The file is read on this device and is never uploaded.",
  intro: "This turns the first sheet of your workbook into a PDF in your browser. Sheet values are rendered and exported as PDF; styling is simplified. Your file never leaves this device.",
  options: [
    { id: "format", type: "select", label: "Page size", default: "a4", choices: [["a4", "A4 (210 × 297 mm)"], ["letter", "US Letter (8.5 × 11 in)"], ["legal", "US Legal (8.5 × 14 in)"], ["a5", "A5 (148 × 210 mm)"]] }
  ],
  async run({ files, opts, job }) {
    const file = files[0];
    if (!file) throw new UserError("Choose an Excel file first.");
    if (!/x\s*x/i.test(file.name) && !/\.xlsx$/i.test(file.name)) throw new UserError("“" + file.name + "” is not an .xlsx Excel file.");
    job.progress(2, "Reading the Excel file…");
    const buf = await file.arrayBuffer();
    const XLSX = await lib("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.SheetNames[0] && wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new UserError("The workbook has no sheets to convert.");
    const html = XLSX.utils.sheet_to_html(ws);
    const bytes = await htmlToPdf(html, { format: opts.format || "a4" });
    job.progress(98, "Done");
    return {
      outputs: [{ name: baseName(file.name) + ".pdf", data: bytes, mime: "application/pdf" }],
      note: "Converted " + file.name + " to PDF in your browser."
    };
  }
};

export default specs;
