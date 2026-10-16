/* Conversion tools: images to PDF, PDF to images/PowerPoint, text extraction, PDF to Word (text), compress, grayscale. */
import { lib, UserError, openPdfLib, openPdfJs, renderPage, canvasBlob, parseRanges, baseName, readBytes, isPdf, h } from "/applications/core.js";

const specs = {};
const MAX_PIXELS = 120e6;

function checkCanvas(w, h2) {
  if (w * h2 > MAX_PIXELS || w > 16000 || h2 > 16000) throw new UserError("This page is too large to render at that quality. Choose a lower DPI.");
}

/* ---------- images to PDF ---------- */
async function decodeToCanvas(file) {
  const bmp = await createImageBitmap(file).catch(() => { throw new UserError("“" + file.name + "” could not be read as an image."); });
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d"); ctx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
  return c;
}
async function hasAlpha(canvas) {
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 255) return true;
  return false;
}

specs["images-to-pdf"] = {
  accept: "image", multiple: true, min: 1, reorder: true, action: "Create PDF", zipName: "images",
  dropText: "Drop images here or click to choose", dropHint: "JPG, PNG, WebP, GIF or BMP. Each image becomes one page.",
  options: [
    { id: "size", type: "select", label: "Page size", default: "a4", choices: [["a4", "A4"], ["letter", "US Letter"], ["a6", "A6 (105 × 148 mm)"], ["label", "4 × 6 in label"], ["fit", "Same size as the image"]] },
    { id: "orient", type: "select", label: "Orientation", default: "auto", choices: [["auto", "Automatic"], ["portrait", "Portrait"], ["landscape", "Landscape"]], show: o => o.size !== "fit" },
    { id: "margin", type: "select", label: "Margin", default: "18", choices: [["0", "None"], ["18", "Small"], ["36", "Large"]] }
  ],
  async run({ files, opts, job }) {
    const { PDFDocument } = await lib("pdflib"), doc = await PDFDocument.create();
    const sizes = { a4: [595.28, 841.89], letter: [612, 792], a6: [297.64, 419.53], label: [288, 432] };
    const margin = Number(opts.margin) || 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const canvas = await decodeToCanvas(f.file);
      const png = f.file.type === "image/png" || (await hasAlpha(canvas));
      const bytes = new Uint8Array(await (await canvasBlob(canvas, png ? "image/png" : "image/jpeg", 0.95)).arrayBuffer());
      const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      let pw, ph;
      if (opts.size === "fit") { const k = Math.min(1, 1200 / Math.max(img.width, img.height)) * 0.75; pw = img.width * k + margin * 2; ph = img.height * k + margin * 2; }
      else {
        [pw, ph] = sizes[opts.size];
        const land = opts.orient === "landscape" || (opts.orient === "auto" && img.width > img.height);
        if (land !== pw > ph) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * s, hh = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
      job.progress(Math.round((i + 1) / files.length * 92), "Added image " + (i + 1) + " of " + files.length); await job.tick();
    }
    doc.setProducer("MarketTech Applications");
    return [{ name: files.length === 1 ? baseName(files[0].name) + ".pdf" : "images-" + files.length + "-pages.pdf", data: await doc.save(), mime: "application/pdf" }];
  }
};

/* ---------- PDF to images ---------- */
specs["pdf-to-images"] = {
  accept: "pdf", multiple: false, action: "Convert to images", zipName: "pages",
  options: [
    { id: "fmt", type: "select", label: "Format", default: "jpeg", choices: [["jpeg", "JPG (smaller files)"], ["png", "PNG (sharper text)"]] },
    { id: "dpi", type: "select", label: "Quality", default: "150", choices: [["72", "Screen (72 DPI)"], ["110", "Good (110 DPI)"], ["150", "High (150 DPI)"], ["200", "Print (200 DPI)"], ["300", "Very high (300 DPI)"]] },
    { id: "pages", type: "text", label: "Pages", default: "all" }
  ],
  async run({ files, opts, job }) {
    const f = files[0], pdf = await openPdfJs(await f.bytes(), f.name), sel = parseRanges(opts.pages, pdf.numPages);
    const ext = opts.fmt === "png" ? "png" : "jpg", pad = String(pdf.numPages).length, out = [];
    for (let i = 0; i < sel.length; i++) {
      const page = await pdf.getPage(sel[i]), vp = page.getViewport({ scale: Number(opts.dpi) / 72 });
      checkCanvas(vp.width, vp.height);
      const canvas = await renderPage(pdf, sel[i], { scale: Number(opts.dpi) / 72 });
      const blob = await canvasBlob(canvas, "image/" + opts.fmt, 0.92);
      out.push({ name: baseName(f.name) + "-page-" + String(sel[i]).padStart(pad, "0") + "." + ext, data: blob, mime: "image/" + opts.fmt });
      canvas.width = canvas.height = 1;
      job.progress(Math.round((i + 1) / sel.length * 95), "Converted page " + sel[i] + " (" + (i + 1) + " of " + sel.length + ")"); await job.tick();
    }
    return out;
  }
};

/* ---------- PDF to PowerPoint (editable text + preserved page artwork) ---------- */
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPTX_MAX_FILE_BYTES = 150 * 1024 * 1024;
const PPTX_MAX_SLIDES = 200;
const PPTX_MAX_PAGE_PIXELS = 32e6;
const PPTX_MAX_ARTWORK_BYTES = 80 * 1024 * 1024;
const PPTX_MAX_TEXT_ITEMS = 50000;
const MAX_SLIDE_INCHES = 13.333333;

function powerpointPageSize(mode, firstPageWidth, firstPageHeight) {
  if (mode === "wide") return { layout: "LAYOUT_WIDE", width: 13.333333, height: 7.5 };
  if (mode === "standard") return { layout: "LAYOUT_4x3", width: 10, height: 7.5 };
  const aspect = firstPageWidth / firstPageHeight;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new UserError("The first selected page has an invalid size.");
  const width = aspect >= 1 ? MAX_SLIDE_INCHES : MAX_SLIDE_INCHES * aspect;
  const height = aspect >= 1 ? MAX_SLIDE_INCHES / aspect : MAX_SLIDE_INCHES;
  return { layout: "pdf-first-page", width, height };
}

function fitPageToSlide(aspect, slideWidth, slideHeight) {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new UserError("A PDF page has an invalid size.");
  let width = slideWidth, height = width / aspect;
  if (height > slideHeight) { height = slideHeight; width = height * aspect; }
  return { x: (slideWidth - width) / 2, y: (slideHeight - height) / 2, w: width, h: height };
}

function normalizePdfRgb(values) {
  if (!values || typeof values.length !== "number" || values.length < 3) return null;
  const channels = [0, 1, 2].map(i => Number(values[i]));
  if (!channels.every(Number.isFinite)) return null;
  const multiplier = Math.max(...channels) <= 1 ? 255 : 1;
  return "#" + channels.map(v => Math.max(0, Math.min(255, Math.round(v * multiplier))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function pdfTextAppearance(page, pdfjs, count) {
  const defaults = Array(count).fill("#000000");
  try {
    const list = await page.getOperatorList(), colors = [], modes = [];
    let fill = "#000000", renderingMode = 0;
    const OPS = pdfjs.OPS;
    for (let i = 0; i < list.fnArray.length; i++) {
      const op = list.fnArray[i], args = list.argsArray[i] || [];
      if (op === OPS.setTextRenderingMode) renderingMode = Number(args[0]) || 0;
      else if (op === OPS.setFillRGBColor || op === OPS.setFillColor) {
        const rgb = args.length === 1 && args[0] && typeof args[0].length === "number" ? args[0] : args;
        fill = normalizePdfRgb(rgb) || fill;
      } else if (op === OPS.setFillCMYKColor) {
        const cmyk = args.length === 1 && args[0] && typeof args[0].length === "number" ? Array.from(args[0]) : args.map(Number);
        if (cmyk.length >= 4 && cmyk.slice(0, 4).every(Number.isFinite)) {
          const [c, m, y, k] = cmyk;
          fill = normalizePdfRgb([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]);
        }
      }
      if ([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText].includes(op)) {
        colors.push(fill);
        modes.push(renderingMode);
      }
    }
    return {
      colors: colors.length === count ? colors : defaults,
      hasInvisibleText: modes.includes(3)
    };
  } catch { return { colors: defaults, hasInvisibleText: false }; }
}

function powerpointFont(style, item, mode = "source") {
  const source = String(style && style.fontFamily || "").split(",")[0].replace(/["']/g, "").trim();
  const lower = (source + " " + String(item.fontName || "")).toLowerCase();
  let fontFace = source || "Arial";
  if (/sans.?serif/.test(lower)) fontFace = "Arial";
  else if (/mono|courier/.test(lower)) fontFace = "Courier New";
  else if (/serif/.test(lower) && !/sans/.test(lower)) fontFace = "Times New Roman";
  if (mode === "office") {
    fontFace = /mono|courier/.test(lower) ? "Courier New" : /serif/.test(lower) && !/sans/.test(lower) ? "Times New Roman" : "Arial";
  }
  return { fontFace, bold: /bold|black|heavy|demi/.test(lower), italic: /italic|oblique/.test(lower) };
}

function itemMetrics(item, viewport) {
  const t = item.transform;
  if (!t || t.length < 6) return null;
  const [a, b, c, d, e, f] = t;
  const baseline = viewport.convertToViewportPoint(e, f);
  const next = viewport.convertToViewportPoint(e + a, f + b);
  const vertical = viewport.convertToViewportPoint(e + c, f + d);
  const dx = next[0] - baseline[0], dy = next[1] - baseline[1];
  const directionLength = Math.hypot(dx, dy);
  const fontHeight = Math.hypot(vertical[0] - baseline[0], vertical[1] - baseline[1]);
  if ((!directionLength && !fontHeight) || !Number.isFinite(directionLength + fontHeight)) return null;
  return {
    baseline,
    axis: directionLength ? [dx / directionLength, dy / directionLength] : [1, 0],
    angle: directionLength ? Math.atan2(dy, dx) : 0,
    fontHeight: fontHeight || directionLength
  };
}

function groupPdfTextRuns(record) {
  const groups = [];
  for (let i = 0; i < record.items.length; i++) {
    const item = record.items[i], metrics = itemMetrics(item, record.viewport), color = record.colors[i] || "#000000";
    const previous = groups[groups.length - 1];
    let joined = false;
    if (previous && metrics && previous.metrics && !previous.item.hasEOL &&
        previous.item.fontName === item.fontName && previous.item.dir === item.dir && previous.color === color) {
      const angleDelta = Math.atan2(Math.sin(metrics.angle - previous.metrics.angle), Math.cos(metrics.angle - previous.metrics.angle));
      const dx = metrics.baseline[0] - previous.end[0], dy = metrics.baseline[1] - previous.end[1];
      const gap = dx * previous.metrics.axis[0] + dy * previous.metrics.axis[1];
      const lineOffset = Math.abs(dx * -previous.metrics.axis[1] + dy * previous.metrics.axis[0]);
      const height = Math.max(metrics.fontHeight, previous.metrics.fontHeight);
      const fontSizesMatch = Math.abs(metrics.fontHeight - previous.metrics.fontHeight) <= height * 0.08;
      if (Math.abs(angleDelta) < Math.PI / 90 && fontSizesMatch && lineOffset <= Math.max(1.5, height * 0.25) && gap >= -height * 0.2 && gap <= height * 1.6) {
        const text = String(item.str || "");
        if (gap > height * 0.12 && !/\s$/.test(previous.item.str) && !/^\s/.test(text)) previous.item.str += " ";
        previous.item.str += text;
        previous.item.width = Math.max(previous.item.width, (metrics.baseline[0] - previous.start[0]) * previous.metrics.axis[0] + (metrics.baseline[1] - previous.start[1]) * previous.metrics.axis[1] + (Number(item.width) || 0));
        previous.item.height = Math.max(Number(previous.item.height) || 0, Number(item.height) || 0);
        previous.item.hasEOL = !!item.hasEOL;
        previous.end = [metrics.baseline[0] + previous.metrics.axis[0] * (Number(item.width) || 0), metrics.baseline[1] + previous.metrics.axis[1] * (Number(item.width) || 0)];
        joined = true;
      }
    }
    if (!joined) {
      const copy = { ...item, transform: item.transform && Array.from(item.transform) };
      const end = metrics ? [metrics.baseline[0] + metrics.axis[0] * (Number(item.width) || 0), metrics.baseline[1] + metrics.axis[1] * (Number(item.width) || 0)] : null;
      groups.push({ item: copy, color, metrics, start: metrics && metrics.baseline, end });
    }
  }
  return { ...record, items: groups.map(group => group.item), colors: groups.map(group => group.color) };
}

function addEditablePdfText(slide, record, frame, opts) {
  const { viewport, items, styles, colors } = record;
  const unit = frame.w / viewport.width;
  let added = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i], text = String(item.str || "");
    if (!text.trim()) continue;
    const t = item.transform;
    if (!t || t.length < 6) continue;
    const [a, b, c, d, e, f] = t;
    const baseline = viewport.convertToViewportPoint(e, f);
    const next = viewport.convertToViewportPoint(e + a, f + b);
    const vertical = viewport.convertToViewportPoint(e + c, f + d);
    const dx = next[0] - baseline[0], dy = next[1] - baseline[1];
    const directionLength = Math.hypot(dx, dy), fontHeight = Math.hypot(vertical[0] - baseline[0], vertical[1] - baseline[1]);
    if ((!directionLength && !fontHeight) || !Number.isFinite(directionLength + fontHeight)) continue;
    const angle = directionLength ? Math.atan2(dy, dx) * 180 / Math.PI : 0;
    const angleRad = angle * Math.PI / 180;
    const fontSize = Math.max(2, (fontHeight || directionLength) * unit * 72);
    const style = styles[item.fontName] || {};
    const font = powerpointFont(style, item, opts.fontMode);
    const ascent = Number.isFinite(style.ascent) ? Math.max(0.25, Math.min(1.4, style.ascent)) : 0.8;
    const descent = Number.isFinite(style.descent) ? Math.min(0, Math.max(-0.6, style.descent)) : -0.2;
    const baselineX = frame.x + baseline[0] * unit;
    const baselineY = frame.y + baseline[1] * unit;
    const ascentIn = fontSize * ascent / 72;
    const sourceHeight = Number(item.height) > 0 ? Number(item.height) * unit : fontSize / 72;
    const width = Math.max((Number(item.width) || 0) * unit * 1.025, fontSize / 72 * 0.2);
    const height = Math.max(sourceHeight * 1.15, fontSize * (ascent - descent) / 72 * 1.15, fontSize / 72 * 1.15);
    const visualX = baselineX + Math.sin(angleRad) * ascentIn;
    const visualY = baselineY - Math.cos(angleRad) * ascentIn;
    const rotateOffsetX = width / 2 * (1 - Math.cos(angleRad)) + height / 2 * Math.sin(angleRad);
    const rotateOffsetY = height / 2 * (1 - Math.cos(angleRad)) - width / 2 * Math.sin(angleRad);
    const x = visualX - rotateOffsetX, y = visualY - rotateOffsetY;
    slide.addText(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""), {
      x, y, w: width, h: height, rotate: angle,
      fontFace: font.fontFace, fontSize, bold: font.bold, italic: font.italic, rtlMode: item.dir === "rtl",
      color: opts.colorMode === "black" ? "#000000" : (colors[i] || "#000000"), margin: 0, breakLine: false,
      valign: "mid", fit: "shrink"
    });
    added++;
  }
  return added;
}

specs["pdf-to-powerpoint"] = {
  accept: "pdf", multiple: false, action: "Convert to editable PowerPoint",
  intro: "Choose artwork fidelity or text-only slides, group nearby text runs into easier-to-edit lines, and control font mapping and text color. Table text stays editable; table rules and other artwork remain graphics when included.",
  options: [
    { id: "pages", type: "text", label: "Pages to convert", default: "all", help: "Use all, odd, even, or page ranges such as 1-4, 6." },
    { id: "slideSize", type: "select", label: "PowerPoint slide size", default: "match", choices: [["match", "Match the first selected PDF page"], ["wide", "Widescreen (16:9)"], ["standard", "Standard (4:3)"]], help: "All slides share one size. Other page shapes are centered without cropping." },
    { id: "artworkMode", type: "select", label: "Page artwork", default: "preserve", choices: [["preserve", "Keep page artwork with editable text"], ["text", "Text only · omit artwork for maximum editability"]], help: "Artwork includes table rules, logos, QR codes and decorative shapes; these are not native PowerPoint shapes." },
    { id: "textGrouping", type: "select", label: "Editable text boxes", default: "runs", choices: [["runs", "Keep PDF text blocks · closest layout match"], ["lines", "Group nearby blocks on the same line · easier to edit"]], help: "Grouping only combines adjacent runs with matching font, size, color and baseline." },
    { id: "fontMode", type: "select", label: "Font mapping", default: "source", choices: [["source", "Use PDF font names when available"], ["office", "Use Office-safe fonts · Arial, Times New Roman, Courier New"]], help: "Font substitutions can change text width slightly; text boxes may need manual adjustment." },
    { id: "colorMode", type: "select", label: "Text color", default: "pdf", choices: [["pdf", "Preserve PDF text colors"], ["black", "Black · easier to restyle"]] },
    { id: "dpi", type: "select", label: "Artwork resolution", default: "200", choices: [["150", "Standard (150 DPI)"], ["200", "High (200 DPI)"], ["300", "Print (300 DPI)"]], show: o => o.artworkMode === "preserve" },
    { id: "format", type: "select", label: "Artwork format", default: "png", choices: [["png", "PNG · crisp lines and codes"], ["jpeg", "JPEG · smaller file"]], show: o => o.artworkMode === "preserve" }
  ],
  async run({ files, opts, job }) {
    const file = files[0];
    if (file.size > PPTX_MAX_FILE_BYTES) throw new UserError("This PDF is over 150 MB. Split it into smaller files before converting.");
    job.progress(1, "Opening PDF…");
    const pdf = await openPdfJs(await file.bytes(), file.name, { disableFontFace: false });
    const pdfjs = await lib("pdfjs");
    const pages = parseRanges(opts.pages, pdf.numPages);
    if (pages.length > PPTX_MAX_SLIDES) throw new UserError("This export has more than 200 slides. Convert a smaller page range, or split the PDF first.");
    if (!pages.length) throw new UserError("Choose at least one page to convert.");

    const records = [];
    let textCount = 0;
    for (let i = 0; i < pages.length; i++) {
      const pageNumber = pages[i], page = await pdf.getPage(pageNumber);
      const [viewport, content] = await Promise.all([page.getViewport({ scale: 1 }), page.getTextContent()]);
      const items = content.items.filter(item => typeof item.str === "string" && item.str.trim() && item.width > 0 && item.height > 0);
      if (!items.length) throw new UserError("Page " + pageNumber + " has no selectable text. It may be scanned; OCR must add visible/selectable text before conversion. Image-only scans cannot be rebuilt as editable text.");
      textCount += items.length;
      if (textCount > PPTX_MAX_TEXT_ITEMS) throw new UserError("This selection has too many separate text objects. Convert fewer pages at a time.");
      const appearance = await pdfTextAppearance(page, pdfjs, items.length);
      if (appearance.hasInvisibleText) throw new UserError("Page " + pageNumber + " contains invisible text, often from OCR over a scanned page. The text cannot be cleanly removed from the background artwork; use a PDF with visible selectable text instead.");
      records.push({ pageNumber, viewport, items, styles: content.styles || {}, colors: appearance.colors });
      job.progress(Math.round(3 + (i + 1) / pages.length * 14), "Reading text on page " + pageNumber + " of " + pdf.numPages + "…");
      await job.tick();
    }

    const firstSize = records[0].viewport;
    const size = powerpointPageSize(opts.slideSize, firstSize.width, firstSize.height);
    const PptxGenJS = await lib("pptxgenjs");
    const pptx = new PptxGenJS();
    if (size.layout === "pdf-first-page") pptx.defineLayout({ name: size.layout, width: size.width, height: size.height });
    pptx.layout = size.layout;
    pptx.author = "MarketTech Applications";
    pptx.company = "MarketTech Applications";
    pptx.title = baseName(file.name);
    pptx.subject = "Editable text PowerPoint converted from a PDF";
    pptx.lang = "en-IN";

    const keepArtwork = opts.artworkMode !== "text";
    const dpi = keepArtwork ? Number(opts.dpi) : null;
    const scale = keepArtwork ? dpi / 72 : null;
    const imageType = opts.format === "jpeg" ? "image/jpeg" : "image/png";
    let artworkBytes = 0, editableTextCount = 0;
    for (let i = 0; i < records.length; i++) {
      const record = records[i], viewport = record.viewport;
      let imageData = null;
      if (keepArtwork) {
        const scaledViewport = (await pdf.getPage(record.pageNumber)).getViewport({ scale });
        const pixelWidth = Math.ceil(scaledViewport.width), pixelHeight = Math.ceil(scaledViewport.height);
        if (pixelWidth > 16000 || pixelHeight > 16000 || pixelWidth * pixelHeight > PPTX_MAX_PAGE_PIXELS) {
          throw new UserError("Page " + record.pageNumber + " is too large at " + dpi + " DPI. Choose a lower artwork resolution.");
        }
        job.progress(Math.round(17 + i / records.length * 70), "Rebuilding artwork on page " + record.pageNumber + " of " + pdf.numPages + "…");
        const canvas = await renderPage(pdf, record.pageNumber, { scale, skipText: true });
        try { imageData = canvas.toDataURL(imageType, 0.94); }
        catch { canvas.width = canvas.height = 1; throw new UserError("Artwork on page " + record.pageNumber + " could not be encoded. Choose a lower resolution or JPEG."); }
        canvas.width = canvas.height = 1;
        if (!imageData || imageData === "data:,") throw new UserError("Artwork on page " + record.pageNumber + " could not be encoded. Choose a lower resolution or JPEG.");
        artworkBytes += Math.ceil(imageData.slice(imageData.indexOf(",") + 1).length * 0.75);
        if (artworkBytes > PPTX_MAX_ARTWORK_BYTES) throw new UserError("The artwork would exceed 80 MB. Select fewer pages, lower its resolution, or choose JPEG.");
      } else {
        job.progress(Math.round(17 + i / records.length * 70), "Placing editable text from page " + record.pageNumber + " of " + pdf.numPages + "…");
      }

      const frame = fitPageToSlide(viewport.width / viewport.height, size.width, size.height);
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      if (imageData) slide.addImage({ data: imageData, ...frame });
      const editableRecord = opts.textGrouping === "lines" ? groupPdfTextRuns(record) : record;
      const pageTextCount = addEditablePdfText(slide, editableRecord, frame, opts);
      if (!pageTextCount) throw new UserError("Selectable text on page " + record.pageNumber + " could not be positioned for editable conversion.");
      editableTextCount += pageTextCount;
      job.progress(Math.round(17 + (i + 1) / records.length * 70), (keepArtwork ? "Rebuilt page " : "Placed text from page ") + record.pageNumber + " (" + (i + 1) + " of " + records.length + ")");
      await job.tick();
    }

    job.progress(92, "Building PowerPoint…");
    const packed = await pptx.write({ outputType: "blob", compression: true });
    const data = new Blob([packed], { type: PPTX_MIME });
    const sizeLabel = opts.slideSize === "wide" ? "16:9 widescreen" : opts.slideSize === "standard" ? "4:3 standard" : "matched to the first selected PDF page";
    const artworkSummary = keepArtwork ? ("kept as a " + (opts.format === "jpeg" ? "JPEG" : "PNG") + " graphics layer at " + dpi + " DPI") : "omitted for a text-only deck";
    const groupingSummary = opts.textGrouping === "lines" ? "nearby text runs grouped by line" : "PDF text blocks kept separate";
    const fontSummary = opts.fontMode === "office" ? "Office-safe fonts" : "PDF font names where available";
    const colorSummary = opts.colorMode === "black" ? "black text" : "PDF text colors";
    return {
      outputs: [{ name: baseName(file.name) + ".pptx", data, mime: PPTX_MIME }],
      note: "Created " + pages.length + " slides with " + editableTextCount + " editable text boxes from " + textCount + " PDF text runs; artwork " + artworkSummary + ". Text: " + groupingSummary + "; fonts: " + fontSummary + "; color: " + colorSummary + "; slide size " + sizeLabel + "."
    };
  }
};

/* ---------- text extraction ---------- */
export async function pageLines(pdf, n) {
  const page = await pdf.getPage(n), tc = await page.getTextContent();
  const lines = []; let cur = "", lastY = null, lastEnd = null;
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    const y = it.transform[5], x = it.transform[4];
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, (it.height || 8) * 0.5)) { lines.push(cur); cur = ""; lastEnd = null; }
    else if (lastEnd !== null && x - lastEnd > 1.5 && cur && !/\s$/.test(cur) && !/^\s/.test(it.str)) cur += " ";
    cur += it.str; lastY = y; lastEnd = x + (it.width || 0);
    if (it.hasEOL) { lines.push(cur); cur = ""; lastY = null; lastEnd = null; }
  }
  if (cur) lines.push(cur);
  return lines.map(s => s.replace(/\s+$/, ""));
}

specs["extract-text"] = {
  accept: "pdf", multiple: true, reorder: false, action: "Extract text", zipName: "text",
  options: [{ id: "marks", type: "checkbox", label: "Mark each page (for example “--- Page 3 ---”)", default: true }],
  async run({ files, opts, job }) {
    const out = []; let empty = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i], pdf = await openPdfJs(await f.bytes(), f.name), parts = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const lines = await pageLines(pdf, p);
        parts.push((opts.marks ? "--- Page " + p + " ---\n" : "") + lines.join("\n"));
        job.progress(Math.round(((i + p / pdf.numPages) / files.length) * 95), "Reading " + f.name + ", page " + p); if (p % 5 === 0) await job.tick();
      }
      const text = parts.join("\n\n");
      if (!text.replace(/--- Page \d+ ---/g, "").trim()) empty++;
      out.push({ name: baseName(f.name) + ".txt", data: new Blob([text], { type: "text/plain;charset=utf-8" }), mime: "text/plain" });
    }
    return { outputs: out, note: empty ? "No selectable text was found in " + empty + " file(s). Scanned PDFs are pictures of text and need OCR, which this toolkit does not include yet." : "" };
  }
};

/* ---------- PDF to Word (text only) ---------- */
const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function buildDocx(pages) {
  const JSZip = await lib("jszip"), zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  let body = "";
  pages.forEach((lines, i) => {
    if (i > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    for (const line of lines) body += '<w:p><w:r><w:t xml:space="preserve">' + xmlEsc(line) + "</w:t></w:r></w:p>";
  });
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>');
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}
specs["pdf-to-word"] = {
  accept: "pdf", multiple: false, action: "Convert to Word",
  intro: "This makes an editable Word file from the text in the PDF. Layout, tables, fonts and pictures are not kept. For exact layout, use a desktop converter.",
  async run({ files, job }) {
    const f = files[0], pdf = await openPdfJs(await f.bytes(), f.name), pages = [];
    for (let p = 1; p <= pdf.numPages; p++) { pages.push(await pageLines(pdf, p)); job.progress(Math.round(p / pdf.numPages * 90), "Reading page " + p + " of " + pdf.numPages); if (p % 5 === 0) await job.tick(); }
    if (!pages.some(l => l.join("").trim())) throw new UserError("No selectable text was found. This looks like a scanned PDF, which needs OCR.");
    return [{ name: baseName(f.name) + ".docx", data: await buildDocx(pages), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }];
  }
};

/* ---------- raster tools: compress and grayscale ---------- */
async function rasterise(pdfBytes, name, { dpi, quality, gray, job }) {
  const { PDFDocument } = await lib("pdflib"), pdf = await openPdfJs(pdfBytes, name), out = await PDFDocument.create();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: dpi / 72 });
    checkCanvas(vp.width, vp.height);
    const canvas = await renderPage(pdf, p, { scale: dpi / 72 });
    if (gray) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true }), img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; d[i] = d[i + 1] = d[i + 2] = v; }
      ctx.putImageData(img, 0, 0);
    }
    const jpg = await out.embedJpg(new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", quality)).arrayBuffer()));
    const np = out.addPage([base.width, base.height]); np.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
    canvas.width = canvas.height = 1;
    job.progress(Math.round(p / pdf.numPages * 95), "Processed page " + p + " of " + pdf.numPages); await job.tick();
  }
  out.setProducer("MarketTech Applications");
  return out.save();
}
const kb = n => n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(2) + " MB";

specs["compress-pdf"] = {
  accept: "pdf", multiple: false, action: "Compress PDF",
  options: [
    { id: "mode", type: "select", label: "Compression", default: "balanced", choices: [["lossless", "Light: keep text sharp (small saving)"], ["balanced", "Balanced: pages become images (good saving)"], ["strong", "Strong: smaller images (largest saving)"]] }
  ],
  intro: "Balanced and Strong turn each page into a picture. File size drops a lot, but text can no longer be selected or searched.",
  async run({ files, opts, job }) {
    const f = files[0], before = f.size, bytes = await f.bytes();
    let data;
    if (opts.mode === "lossless") {
      const doc = await openPdfLib(bytes, f.name); doc.setProducer("MarketTech Applications"); doc.setCreator(""); job.progress(60);
      data = await doc.save({ useObjectStreams: true });
    } else data = await rasterise(bytes, f.name, { dpi: opts.mode === "strong" ? 90 : 130, quality: opts.mode === "strong" ? 0.55 : 0.72, gray: false, job });
    let after = data.length;
    if (after >= before) {
      /* Rebuilding made it bigger (already compact, or mostly text). Hand back the original bytes instead of a worse file. */
      return { outputs: [{ name: baseName(f.name) + "-compressed.pdf", data: bytes, mime: "application/pdf" }], note: "This PDF is already compact (" + kb(before) + "), so it was left unchanged. Try Strong if it is full of photos." };
    }
    const pct = Math.round((1 - after / before) * 100);
    return { outputs: [{ name: baseName(f.name) + "-compressed.pdf", data, mime: "application/pdf" }], note: "Before " + kb(before) + ", after " + kb(after) + " (" + pct + "% smaller)." };
  }
};

specs["grayscale-pdf"] = {
  accept: "pdf", multiple: false, action: "Convert to grayscale",
  intro: "Each page is converted to a black-and-white picture. Text can no longer be selected. Useful for saving colour ink when printing.",
  async run({ files, job }) {
    const f = files[0];
    const data = await rasterise(await f.bytes(), f.name, { dpi: 150, quality: 0.85, gray: true, job });
    return [{ name: baseName(f.name) + "-grayscale.pdf", data, mime: "application/pdf" }];
  }
};

/* ---------- compare two PDFs ---------- */
specs["compare-pdf"] = {
  accept: "pdf", multiple: true, min: 2, reorder: true, action: "Compare PDFs",
  intro: "Add exactly two PDFs. The first is the original and the second is the changed version. Only the text is compared.",
  async run({ files, job }) {
    if (files.length !== 2) throw new UserError("Add exactly two PDF files to compare.");
    const texts = [];
    for (let i = 0; i < 2; i++) {
      const pdf = await openPdfJs(await files[i].bytes(), files[i].name), lines = [];
      for (let p = 1; p <= pdf.numPages; p++) { for (const l of await pageLines(pdf, p)) if (l.trim()) lines.push(l.trim()); job.progress((i + p / pdf.numPages) * 40); if (p % 5 === 0) await job.tick(); }
      texts.push(lines);
    }
    const [a, b] = texts;
    if (a.length * b.length > 25e6) throw new UserError("These documents are too long to compare line by line in the browser.");
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const rows = []; let i = 0, j = 0, added = 0, removed = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { rows.push(["same", a[i]]); i++; j++; }
      else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) { rows.push(["add", b[j]]); j++; added++; }
      else { rows.push(["del", a[i]]); i++; removed++; }
    }
    job.progress(95);
    const box = h("div", { class: "tk-diff", role: "region", "aria-label": "Differences" });
    const shown = rows.filter((r, k) => r[0] !== "same" || rows.slice(Math.max(0, k - 1), k + 2).some(x => x[0] !== "same"));
    for (const [kind, text] of shown) box.append(h("div", { class: "tk-diff-" + kind }, h("span", { "aria-hidden": "true" }, kind === "add" ? "+" : kind === "del" ? "−" : " "), h("span", { class: "tk-sr" }, kind === "add" ? "Added: " : kind === "del" ? "Removed: " : "Unchanged: "), text));
    const report = rows.map(r => (r[0] === "add" ? "+ " : r[0] === "del" ? "- " : "  ") + r[1]).join("\n");
    return { outputs: [{ name: "comparison.txt", data: new Blob([report], { type: "text/plain;charset=utf-8" }), mime: "text/plain" }], view: added + removed ? box : h("p", { class: "tk-note" }, "No text differences found."), note: added + " lines added, " + removed + " lines removed." };
  }
};

export default specs;
void isPdf; void readBytes;
