/* Local-only label PDF export worker. All source bytes are transferred from the page; no network requests are made. */
importScripts("/applications/vendor/pdf-lib-1.10.0.min.js");
let cancelled = false;
self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === "cancel") { cancelled = true; return; }
  if (message.type !== "start") return;
  cancelled = false;
  try {
    const { files, pages, settings } = message.payload;
    const { PDFDocument } = PDFLib;
    const output = await PDFDocument.create();
    const cache = new Map();
    const total = pages.length;
    const sizeName = settings.name.replace(/[^a-z0-9]/gi, "");
    for (let i = 0; i < pages.length; i++) {
      if (cancelled) throw new DOMException("Processing cancelled.", "AbortError");
      const item = pages[i];
      if (!cache.has(item.fileIdx)) {
        const source = new Uint8Array(files[item.fileIdx].bytes);
        cache.set(item.fileIdx, await PDFDocument.load(source, { ignoreEncryption: true }));
      }
      const sourceDoc = cache.get(item.fileIdx);
      const copied = (await output.copyPages(sourceDoc, [item.pageIdx]))[0];
      const c = item.crop, view = item.view;
      const left = view[0] + c.x, top = view[3] - c.y;
      const embedded = await output.embedPage(copied, { left, bottom: top - c.h, right: left + c.w, top });
      const W = settings.width, H = settings.height, margin = settings.margin;
      const cover = settings.fit === "cover";
      const m = cover ? 0 : Math.max(0, Math.min(margin, Math.min(W,H)/2 - 10));
      const aw = W - 2*m, ah = H - 2*m;
      const scale = cover ? Math.max(aw/c.w, ah/c.h) : Math.min(aw/c.w, ah/c.h);
      const x = (W - c.w*scale)/2, y = H - (H - c.h*scale)/2 - c.h*scale;
      const page = output.addPage([W,H]);
      page.drawPage(embedded, { x, y, xScale: scale, yScale: scale });
      self.postMessage({ type: "progress", value: Math.round((i+1)/total*100), message: "Preparing label " + (i+1) + " of " + total });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (cancelled) throw new DOMException("Processing cancelled.", "AbortError");
    const bytes = await output.save();
    self.postMessage({ type: "result", filename: "labels-" + sizeName + "-" + total + ".pdf", bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", name: error && error.name || "Error", message: error && error.message || "PDF export failed." });
  }
};