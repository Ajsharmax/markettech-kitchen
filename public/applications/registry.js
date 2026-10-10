export const APPLICATION_CATEGORIES = ["Organize", "Edit & Convert", "Security & Privacy", "Print Helpers"];

export const APPLICATIONS = [
  {
    id: "merge-pdf",
    slug: "merge-pdf",
    name: "Merge PDF",
    description: "Combine PDFs into one document and reorder files before merging.",
    category: "Organize",
    icon: "⊕",
    status: "ready",
    loader: "/applications/merge-pdf",
    featured: true
  },
  {
    id: "split-pdf",
    slug: "split-pdf",
    name: "Split PDF",
    description: "Extract selected pages or divide a PDF into smaller documents.",
    category: "Organize",
    icon: "⇱",
    status: "coming-soon",
    loader: null
  },
  {
    id: "rotate-pdf",
    slug: "rotate-pdf",
    name: "Rotate PDF",
    description: "Rotate pages and correct document orientation.",
    category: "Edit & Convert",
    icon: "↻",
    status: "coming-soon",
    loader: null
  },
  {
    id: "compress-pdf",
    slug: "compress-pdf",
    name: "Compress PDF",
    description: "Reduce PDF file size for easier sharing and storage.",
    category: "Edit & Convert",
    icon: "⇣",
    status: "coming-soon",
    loader: null
  },
  {
    id: "protect-unlock-pdf",
    slug: "protect-unlock-pdf",
    name: "Protect & Unlock PDF",
    description: "Password tools require a verified client-side encryption implementation.",
    category: "Security & Privacy",
    icon: "♢",
    status: "coming-soon",
    loader: null
  },
  {
    id: "redact-pdf",
    slug: "redact-pdf",
    name: "Redact PDF",
    description: "Burn selected redaction boxes into page images to remove hidden content.",
    category: "Security & Privacy",
    icon: "▧",
    status: "coming-soon",
    loader: null
  },
  {
    id: "repair-pdf",
    slug: "repair-pdf",
    name: "Repair PDF",
    description: "Recovery of damaged PDF structures is not reliably possible in a basic browser toolkit.",
    category: "Security & Privacy",
    icon: "⚒",
    status: "coming-soon",
    loader: null
  },
  {
    id: "label-crop-4x6",
    slug: "label-crop-4x6",
    name: "Label Crop 4×6",
    description: "Crop shipping labels from A4 PDFs into print-ready 4×6-inch labels. Files are processed locally in your browser.",
    category: "Print Helpers",
    icon: "▣",
    status: "ready",
    loader: "/label-cropper.html",
    featured: true
  }
];
