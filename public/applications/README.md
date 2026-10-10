# MarketTech Applications — Phase 1

## Routes
- `/applications` — searchable applications hub.
- `/applications/label-crop-4x6` — first tool, Label Crop 4×6.
- `/label-cropper.html` remains available as a compatibility route/page.

## Self-hosted, pinned browser libraries
- PDF.js 3.11.174: `vendor/pdfjs-3.11.174.min.js` and its matching worker.
- pdf-lib 1.10.0: `vendor/pdf-lib-1.10.0.min.js`.
- JSZip 3.10.1: `vendor/jszip-3.10.1.min.js`.

The pdf-lib build is pinned to 1.10.0 because that is the self-hostable distribution available from the selected repository source. It differs from the 1.17.1 CDN reference in the earlier standalone tool and needs regression testing against the label PDFs used by the store before relying on it for production shipping.

## Shared foundation
- `registry.js`: central metadata for ready and coming-soon cards.
- `shared/file-drop.js`: file validation, removal, drag reorder, and file-list rendering.
- `shared/pdf-utils.js`: PDF load/render/save, thumbnails, page range parsing, ZIP output, and large-file warnings.
- `shared/worker-runner.js`: cancellable worker orchestration contract.
- `label-crop-worker.js`: vector-preserving crop/export worker for Label Crop 4×6.

## Privacy controls
The application pages use a restrictive Content Security Policy with `connect-src 'self'`, local scripts, and local worker sources. The label tool references no third-party CDN at runtime. This is a code/configuration check, not a substitute for a real browser Network-tab audit.

## Known limits in this phase
- The Label Crop tool asks for a password to render encrypted PDFs, but the current pdf-lib build may not export encrypted source PDFs correctly. Treat encrypted-PDF export as unsupported until specifically tested.
- The reusable shared file-drop/PDF utility modules are foundations for the upcoming tools; Label Crop 4×6 still has its own specialized crop UI.
- Browser testing with 1-page, 50-page, embedded-font, rotated-page, and encrypted PDFs has not yet been completed in this phase.
- Tier 1 and Tier 2 tools remain Coming soon until implemented and tested.
