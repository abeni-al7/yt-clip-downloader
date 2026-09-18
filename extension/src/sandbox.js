// Sandboxed page (manifest "sandbox"): the only extension context where code may be compiled at
// runtime, which yt-dlp's EJS solver needs (it builds the extracted challenge functions with
// Function()). The parent sends the solver sources once, then challenge requests; solving runs
// in a blob worker so the page stays responsive.
let worker = null;

const WORKER_TAIL = `
self.onmessage = (event) => {
  const { id, player, requests } = event.data;
  try {
    self.postMessage({ id, result: self.jsc({ type: "player", player, requests, output_preprocessed: false }) });
  } catch (error) {
    self.postMessage({ id, result: { type: "error", error: String((error && error.stack) || error) } });
  }
};
`;

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  const reply = (data) => event.source.postMessage(data, "*");

  if (message.type === "init") {
    if (worker) worker.terminate();
    const code = `${message.lib}\nObject.assign(self, self.lib);\n${message.core}\n${WORKER_TAIL}`;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    } catch (error) {
      reply({ type: "ready", error: String(error) });
      return;
    }
    worker.onmessage = (workerEvent) => reply({ type: "result", ...workerEvent.data });
    worker.onerror = (workerEvent) => reply({ type: "result", id: null, result: { type: "error", error: workerEvent.message || "solver worker crashed" } });
    reply({ type: "ready" });
  } else if (message.type === "solve") {
    if (!worker) {
      reply({ type: "result", id: message.id, result: { type: "error", error: "solver not initialised" } });
      return;
    }
    worker.postMessage({ id: message.id, player: message.player, requests: message.requests });
  }
});
