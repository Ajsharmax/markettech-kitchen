/* Single source of truth for the Applications hub and the tool pages.
 * status "ready"  = built, runs entirely in the browser, has its own page at /applications/<slug>.
 * status "coming-soon" = not available yet; `reason` says why. Nothing is faked. */
export const APPLICATION_CATEGORIES = ["Print Helpers", "Organize PDF", "Edit PDF", "Convert from PDF", "Convert to PDF", "Optimize PDF", "Security"];

const ready = (slug, module, name, category, icon, description, extra = {}) => ({ id: slug, slug, name, category, icon, description, status: "ready", module, ...extra });
const soon = (slug, name, category, icon, description, reason) => ({ id: slug, slug, name, category, icon, description, status: "coming-soon", module: null, reason });

export const APPLICATIONS = [
  /* Print Helpers */
  ready("label-crop-4x6", "label-crop", "Label Crop 4×6", "Print Helpers", "▣", "Cut shipping labels out of A4 order PDFs and get print-ready 4×6 inch pages. Finds the label automatically.", { featured: true, wide: true }),

  /* Organize */
  ready("merge-pdf", "pages", "Merge PDF", "Organize PDF", "⊕", "Combine several PDFs into one and set their order.", { featured: true }),
  ready("split-pdf", "pages", "Split PDF", "Organize PDF", "⇱", "Split by page ranges, every N pages, or one file per page."),
  ready("organize-pages", "visual", "Organize pages", "Organize PDF", "▦", "See every page, then reorder, rotate, delete, duplicate or add blank pages."),
  ready("remove-pages", "pages", "Remove pages", "Organize PDF", "⊖", "Delete the pages you do not need."),
  ready("extract-pages", "pages", "Extract pages", "Organize PDF", "⇥", "Keep only the pages you choose in a new PDF."),
  ready("rotate-pdf", "pages", "Rotate PDF", "Organize PDF", "↻", "Turn all pages, or only some, by 90°, 180° or 270°."),

  /* Edit */
  ready("crop-pdf", "visual", "Crop PDF", "Edit PDF", "⌗", "Trim the margins by drawing the area you want to keep."),
  ready("add-page-numbers", "pages", "Add page numbers", "Edit PDF", "№", "Number the pages with your choice of position and format."),
  ready("add-watermark", "pages", "Add watermark", "Edit PDF", "◈", "Stamp text or an image on every page, centred or repeated."),
  ready("sign-pdf", "visual", "Sign PDF", "Edit PDF", "✎", "Draw, type or upload a signature and place it on the page."),
  ready("edit-metadata", "pages", "Edit PDF details", "Edit PDF", "ⓘ", "Change or clear the title, author, subject and keywords."),
  ready("compare-pdf", "convert", "Compare PDFs", "Edit PDF", "⇄", "See which lines of text were added or removed between two versions."),

  /* Convert from PDF */
  ready("pdf-to-images", "convert", "PDF to JPG / PNG", "Convert from PDF", "▨", "Turn each page into an image at the quality you choose."),
  ready("extract-text", "convert", "PDF to text", "Convert from PDF", "¶", "Copy out all selectable text as a .txt file."),
  ready("pdf-to-word", "convert", "PDF to Word (text)", "Convert from PDF", "W", "Get the text of a PDF as an editable .docx. Layout and pictures are not kept."),
  ready("pdf-to-powerpoint", null, "PDF to PowerPoint", "Convert from PDF", "P", "Turn each PDF page into an image-based PowerPoint slide.", { url: "/pdf-to-powerpoint.html" }),
  ready("pdf-to-excel", null, "PDF to Excel", "Convert from PDF", "X", "Extract selectable PDF text into an Excel workbook; review estimated rows and columns.", { url: "/pdf-to-excel.html" }),
  ready("ocr-pdf", null, "OCR PDF", "Convert from PDF", "◎", "Recognize text in scanned PDFs in English or Hindi and export it as a text file.", { url: "/ocr-pdf.html" }),

  /* Convert to PDF */
  ready("images-to-pdf", "convert", "JPG / PNG to PDF", "Convert to PDF", "▤", "Put one or many images into a PDF, in the order you choose."),
  soon("word-to-pdf", "Word to PDF", "Convert to PDF", "W", "Convert .docx files.", "A browser cannot lay out Word files accurately. Needs a private LibreOffice service on your own server."),
  soon("excel-to-pdf", "Excel to PDF", "Convert to PDF", "X", "Convert spreadsheets.", "Needs a private LibreOffice service on your own server."),
  soon("powerpoint-to-pdf", "PowerPoint to PDF", "Convert to PDF", "P", "Convert slides.", "Needs a private LibreOffice service on your own server."),
  soon("html-to-pdf", "HTML to PDF", "Convert to PDF", "‹›", "Turn a web page into a PDF.", "Needs a headless browser on a server."),

  /* Optimize */
  ready("compress-pdf", "convert", "Compress PDF", "Optimize PDF", "⇣", "Make the file smaller. Light keeps text; Balanced and Strong flatten pages to images."),
  ready("grayscale-pdf", "convert", "Grayscale PDF", "Optimize PDF", "◐", "Convert colour pages to black and white to save ink."),
  soon("repair-pdf", "Repair PDF", "Optimize PDF", "⚒", "Recover a damaged file.", "Real repair needs a dedicated engine; a browser can only fail more politely."),

  /* Security */
  ready("redact-pdf", "visual", "Redact PDF", "Security", "▧", "Black out names, numbers or images. Covered content is removed, not just hidden."),
  soon("protect-pdf", "Protect PDF", "Security", "⚿", "Add a password.", "The self-hosted PDF library cannot encrypt. Needs a vetted WebAssembly encryption module."),
  soon("unlock-pdf", "Unlock PDF", "Security", "⚷", "Remove a password you know.", "Needs a vetted WebAssembly decryption module.")
];
