// Client for the challenge sandbox (sandbox.html): yt-dlp's EJS solver runs there because extension
// pages may not compile code at runtime. Solutions are cached per player build for the page's lifetime.

export class ChallengeSolver {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.cache = new Map(); // `${playerId}:${type}:${challenge}` → solution
    this.frame = document.createElement("iframe");
    this.frame.hidden = true;
    this.frame.src = chrome.runtime.getURL("sandbox.html");
    let readyResolve;
    let readyReject;
    this.ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    window.addEventListener("message", (event) => {
      if (event.source !== this.frame.contentWindow) return;
      const { type, id, result, error } = event.data || {};
      if (type === "ready") {
        if (error) readyReject(new Error(`The challenge sandbox could not start: ${error}`));
        else readyResolve();
      } else if (type === "result") {
        if (id == null) {
          for (const settle of this.pending.values()) settle(result);
          this.pending.clear();
          return;
        }
        const settle = this.pending.get(id);
        this.pending.delete(id);
        settle?.(result);
      }
    });
    this.frame.addEventListener("load", () => this.init().catch(readyReject));
    document.body.append(this.frame);
  }

  async init() {
    const [lib, core] = await Promise.all(
      ["vendor/ejs/lib.min.js", "vendor/ejs/core.min.js"].map((path) => fetch(chrome.runtime.getURL(path)).then((r) => r.text())),
    );
    this.frame.contentWindow.postMessage({ type: "init", lib, core }, "*");
  }

  /** `challenges` is `{ n: string[], sig: string[] }`; returns `{ n: Map, sig: Map }`. */
  async solve(playerId, player, challenges) {
    const requests = [];
    const solved = { n: new Map(), sig: new Map() };
    for (const type of ["n", "sig"]) {
      const missing = [...new Set(challenges[type] || [])].filter((c) => {
        const hit = this.cache.get(`${playerId}:${type}:${c}`);
        if (hit !== undefined) solved[type].set(c, hit);
        return hit === undefined;
      });
      if (missing.length) requests.push({ type, challenges: missing });
    }
    if (!requests.length) return solved;

    await this.ready;
    const result = await new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      this.frame.contentWindow.postMessage({ type: "solve", id, player, requests }, "*");
    });
    if (result.type === "error") throw new Error(`Could not solve YouTube's player challenge: ${result.error}`);
    result.responses.forEach((response, i) => {
      if (response.type === "error") throw new Error(`Could not solve YouTube's ${requests[i].type} challenge: ${response.error}`);
      for (const [challenge, solution] of Object.entries(response.data)) {
        this.cache.set(`${playerId}:${requests[i].type}:${challenge}`, solution);
        solved[requests[i].type].set(challenge, solution);
      }
    });
    return solved;
  }
}
