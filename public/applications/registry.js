export const APPLICATION_CATEGORIES = ["Organize", "Print Helpers"];

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
