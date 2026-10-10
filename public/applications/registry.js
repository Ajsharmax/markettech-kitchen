export const APPLICATION_CATEGORIES = [
  "Organize", "Optimize", "Convert", "Edit", "Security", "Print Helpers"
];

export const APPLICATIONS = [
  { id:"label-crop-4x6", slug:"label-crop-4x6", name:"Label Crop 4×6", description:"Crop shipping labels from A4 PDFs into print-ready 4×6-inch labels.", category:"Print Helpers", icon:"▣", status:"ready", loader:"/applications/label-crop-4x6.html", featured:true },
  { id:"merge-pdf", slug:"merge-pdf", name:"Merge PDF", description:"Combine PDFs into one document and reorder files before merging.", category:"Organize", icon:"⊕", status:"coming-soon", loader:null },
  { id:"split-pdf", slug:"split-pdf", name:"Split PDF", description:"Split by page ranges, every N pages, or extract selected pages.", category:"Organize", icon:"⇱", status:"coming-soon", loader:null },
  { id:"organize-pages", slug:"organize-pages", name:"Organize pages", description:"Reorder, rotate, duplicate, or delete pages visually.", category:"Organize", icon:"▦", status:"coming-soon", loader:null },
  { id:"rotate-pdf", slug:"rotate-pdf", name:"Rotate PDF", description:"Rotate every page or only the pages you select.", category:"Organize", icon:"⟳", status:"coming-soon", loader:null },
  { id:"remove-extract-pages", slug:"remove-extract-pages", name:"Remove & Extract Pages", description:"Remove unwanted pages or save selected pages separately.", category:"Organize", icon:"⊖", status:"coming-soon", loader:null },
  { id:"crop-pdf", slug:"crop-pdf", name:"Crop PDF", description:"Set a custom crop box for all pages or selected pages.", category:"Edit", icon:"⌗", status:"coming-soon", loader:null },
  { id:"page-numbers", slug:"page-numbers", name:"Add page numbers", description:"Choose position, numbering format, start value, and page range.", category:"Edit", icon:"№", status:"coming-soon", loader:null },
  { id:"watermark-pdf", slug:"watermark-pdf", name:"Add watermark", description:"Add text or image watermarks with opacity, rotation, and tiling.", category:"Edit", icon:"◇", status:"coming-soon", loader:null },
  { id:"images-to-pdf", slug:"images-to-pdf", name:"Images to PDF", description:"Turn JPG, PNG, and WebP images into a PDF with page options.", category:"Convert", icon:"▧", status:"coming-soon", loader:null },
  { id:"pdf-to-images", slug:"pdf-to-images", name:"PDF to images", description:"Export PDF pages as PNG or JPG and download them in a ZIP.", category:"Convert", icon:"▤", status:"coming-soon", loader:null },
  { id:"extract-text", slug:"extract-text", name:"Extract text", description:"Copy or download selectable PDF text as a plain text file.", category:"Convert", icon:"T", status:"coming-soon", loader:null },
  { id:"edit-metadata", slug:"edit-metadata", name:"Edit metadata", description:"Update a PDF's title, author, subject, and keywords.", category:"Edit", icon:"✎", status:"coming-soon", loader:null },
  { id:"sign-pdf", slug:"sign-pdf", name:"Sign PDF", description:"Draw, type, or upload a signature and place it on a page.", category:"Edit", icon:"✍", status:"coming-soon", loader:null },
  { id:"compress-pdf", slug:"compress-pdf", name:"Compress PDF", description:"Reduce file size by rebuilding pages as images; text will be flattened.", category:"Optimize", icon:"⇣", status:"coming-soon", loader:null },
  { id:"ocr-pdf", slug:"ocr-pdf", name:"OCR PDF", description:"Recognize scanned text with selectable language and local OCR assets.", category:"Convert", icon:"⌕", status:"coming-soon", loader:null },
  { id:"protect-unlock-pdf", slug:"protect-unlock-pdf", name:"Protect & Unlock PDF", description:"Password tools require a verified client-side encryption implementation.", category:"Security", icon:"▣", status:"coming-soon", loader:null },
  { id:"redact-pdf", slug:"redact-pdf", name:"Redact PDF", description:"Burn selected redaction boxes into page images to remove hidden content.", category:"Security", icon:"▰", status:"coming-soon", loader:null },
  { id:"grayscale-pdf", slug:"grayscale-pdf", name:"Grayscale PDF", description:"Convert pages to grayscale with a documented image-based workflow.", category:"Optimize", icon:"◐", status:"coming-soon", loader:null },
  { id:"pdf-to-word", slug:"pdf-to-word", name:"PDF to Word", description:"Complex document conversion needs a separate, verified conversion engine.", category:"Convert", icon:"W", status:"coming-soon", loader:null },
  { id:"pdf-to-excel", slug:"pdf-to-excel", name:"PDF to Excel", description:"Table extraction and spreadsheet reconstruction are not yet available.", category:"Convert", icon:"X", status:"coming-soon", loader:null },
  { id:"pdf-to-powerpoint", slug:"pdf-to-powerpoint", name:"PDF to PowerPoint", description:"Presentation conversion needs a dedicated document engine.", category:"Convert", icon:"P", status:"coming-soon", loader:null },
  { id:"office-to-pdf", slug:"office-to-pdf", name:"Word / Excel / PowerPoint to PDF", description:"Reliable Office conversion is best handled by a self-hosted LibreOffice service.", category:"Convert", icon:"⇢", status:"coming-soon", loader:null },
  { id:"html-to-pdf", slug:"html-to-pdf", name:"HTML to PDF", description:"Faithful HTML printing may require a browser-rendering service.", category:"Convert", icon:"⌘", status:"coming-soon", loader:null },
  { id:"repair-pdf", slug:"repair-pdf", name:"Repair PDF", description:"Recovery of damaged PDF structures is not reliably possible in a basic browser toolkit.", category:"Security", icon:"⚒", status:"coming-soon", loader:null }
];