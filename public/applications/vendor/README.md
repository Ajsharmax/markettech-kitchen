# Self-hosted browser libraries

These pinned files are served from this site so the document tools do not depend on third-party CDNs. The tools do not upload user files.

| Asset | Version | License |
| --- | --- | --- |
| pdf-lib | 1.10.0 | MIT (upstream distribution) |
| pdf.js | 3.11.174 | Apache-2.0 (upstream distribution) |
| JSZip | 3.10.1 | MIT (upstream distribution) |
| PptxGenJS | 3.12.0 | MIT; see `PPTXGENJS-3.12.0-LICENSE.txt` |
| SheetJS (`xlsx`) | 0.18.5 | Apache-2.0; see `xlsx-0.18.5.LICENSE.txt` |
| Tesseract.js | 5.1.0 | Apache-2.0; see `tesseract-5.1.0/LICENSE.txt` |
| Tesseract.js Core | 5.1.1 | Apache-2.0; see `tesseract-core-5.1.1/LICENSE.txt` |
| Tesseract English/Hindi data | 4.0.0 best-int | MIT; source packages `@tesseract.js-data/eng` and `@tesseract.js-data/hin` 1.0.0 (metadata is next to the models) |

OCR uses the local SIMD LSTM WebAssembly core and locally hosted English and Hindi traineddata. When changing any vendor bundle or model, update its versioned path and retain the upstream license/notice files.
