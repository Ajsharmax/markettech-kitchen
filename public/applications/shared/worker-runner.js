/** Worker protocol: post {type:"progress", value, message}; final {type:"result", payload}; failures {type:"error", message}. */
export function runWorker(workerUrl, payload, { onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; worker.terminate(); signal?.removeEventListener("abort", abort); fn(value); };
    const abort = () => { worker.postMessage({ type: "cancel" }); finish(reject, new DOMException("Processing cancelled.", "AbortError")); };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      const data = event.data || {};
      if (data.type === "progress") onProgress({ value: Math.max(0, Math.min(100, Number(data.value) || 0)), message: String(data.message || "") });
      else if (data.type === "result") finish(resolve, data.payload);
      else if (data.type === "error") finish(reject, new Error(data.message || "Processing failed."));
    };
    worker.onerror = event => finish(reject, new Error(event.message || "Worker failed."));
    worker.postMessage({ type: "start", payload });
  });
}