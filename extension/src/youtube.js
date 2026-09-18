// YouTube's embedded-player client (what an <iframe> player on a third-party site uses):
// embed page → ytcfg + player build → InnerTube `player` → formats with solved n/sig challenges.
import { EMBED_HOST } from "./netrules.js";
import { normalizeAcodec, normalizeVcodec, parseMimeType } from "./formats.js";

export class ResolveError extends Error {
  constructor(code, message, detail = "") {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const playerCache = new Map(); // player URL → { id, source, sts }

async function fetchText(url, init) {
  const response = await fetch(url, { credentials: "omit", ...init });
  if (!response.ok) throw new ResolveError("extraction_failed", `YouTube answered ${response.status} for ${new URL(url).pathname}.`);
  return response.text();
}

export function parseYtcfg(html) {
  const match = /ytcfg\.set\((\{[\s\S]*?\})\);/.exec(html);
  if (!match) throw new ResolveError("extraction_failed", "Could not read YouTube's embed page configuration.");
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new ResolveError("extraction_failed", "YouTube's embed page configuration was not valid JSON.");
  }
}

function playerJsUrl(ytcfg) {
  const configs = ytcfg.WEB_PLAYER_CONTEXT_CONFIGS || {};
  const jsUrl = ytcfg.PLAYER_JS_URL || configs.WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER?.jsUrl || Object.values(configs)[0]?.jsUrl;
  if (!jsUrl) throw new ResolveError("extraction_failed", "YouTube's embed page did not reference a player script.");
  return new URL(jsUrl, "https://www.youtube.com").toString();
}

async function loadPlayer(url) {
  if (!playerCache.has(url)) {
    const source = await fetchText(url);
    const sts = /(?:signatureTimestamp|sts)\s*:\s*(\d{5})/.exec(source);
    if (!sts) throw new ResolveError("extraction_failed", "Could not find the signature timestamp in YouTube's player script.");
    const id = /\/s\/player\/([^/]+)\//.exec(url)?.[1] || url;
    playerCache.set(url, { id, source, sts: Number(sts[1]) });
  }
  return playerCache.get(url);
}

/** Map YouTube's playabilityStatus to the app's error codes; null when playable. */
export function classifyPlayability(playerResponse) {
  const status = playerResponse?.playabilityStatus?.status;
  const details = playerResponse?.videoDetails || {};
  if (details.isLive || (status === "OK" && details.isLiveContent && Number(details.lengthSeconds) === 0)) {
    return new ResolveError("live_in_progress", "Live streams cannot be clipped until they have ended.");
  }
  if (status === "OK") return null;
  const ps = playerResponse?.playabilityStatus || {};
  const subreason = ps.errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.map((r) => r.text).join("") || "";
  const reason = `${ps.reason || ""} ${subreason}`.trim();
  const lower = reason.toLowerCase();
  if (status === "LIVE_STREAM_OFFLINE") return new ResolveError("live_in_progress", "This live stream has not started or is still in progress.", reason);
  if (lower.includes("not a bot")) {
    return new ResolveError("bot_check", "YouTube is asking this browser to prove it is not a bot. Open youtube.com in another tab, play any video, then try again.", reason);
  }
  if (lower.includes("age") || lower.includes("inappropriate")) {
    return new ResolveError("age_restricted", "This video is age-restricted. YouTube only serves it to signed-in viewers, which this extension does not do.", reason);
  }
  if (lower.includes("private")) return new ResolveError("private", "This video is private.", reason);
  if (lower.includes("members")) return new ResolveError("members_only", "This video is for channel members only.", reason);
  if (lower.includes("other websites") || lower.includes("embedding")) {
    return new ResolveError("embedding_disabled", "The uploader disabled playback outside YouTube. The extension fetches videos the way an embedded player does, so it cannot download this one.", reason);
  }
  if (lower.includes("country") || lower.includes("region")) return new ResolveError("geo_blocked", "This video is not available in your country.", reason);
  return new ResolveError("video_unavailable", reason ? `YouTube says: ${reason}` : `YouTube refused to play this video (${status || "no status"}).`, reason);
}

function decodeUrl(format) {
  if (format.url) {
    const url = new URL(format.url);
    return { url, s: null, sp: null };
  }
  const cipher = format.signatureCipher || format.cipher;
  if (!cipher) return null;
  const params = new URLSearchParams(cipher);
  if (!params.get("url")) return null;
  return { url: new URL(params.get("url")), s: params.get("s"), sp: params.get("sp") || "signature" };
}

/** Normalise one adaptive format; null when it cannot be range-fetched (OTF, DRM, no index). */
export function normalizeFormat(raw) {
  if (raw.type === "FORMAT_STREAM_TYPE_OTF" || raw.drmFamilies?.length || !raw.initRange || !raw.indexRange) return null;
  const decoded = decodeUrl(raw);
  if (!decoded) return null;
  const mime = parseMimeType(raw.mimeType);
  if (!["mp4", "webm"].includes(mime.container)) return null;
  const isVideo = mime.kind === "video";
  return {
    itag: raw.itag,
    mimeType: raw.mimeType,
    container: mime.container,
    vcodec: isVideo ? normalizeVcodec(mime.codecs) : null,
    acodec: isVideo ? null : normalizeAcodec(mime.codecs),
    height: isVideo ? raw.height || 0 : 0,
    width: isVideo ? raw.width || 0 : 0,
    fps: raw.fps || 0,
    qualityLabel: raw.qualityLabel || raw.audioQuality || "",
    bitrate: Number(raw.averageBitrate || raw.bitrate || 0),
    contentLength: Number(raw.contentLength || 0),
    approxDurationMs: Number(raw.approxDurationMs || 0),
    initRange: { start: Number(raw.initRange.start), end: Number(raw.initRange.end) },
    indexRange: { start: Number(raw.indexRange.start), end: Number(raw.indexRange.end) },
    decoded,
    url: null,
  };
}

/** Apply solved challenges: `n` transform plus, for ciphered formats, the decrypted signature. */
export function finalizeUrl(format, solved) {
  const url = new URL(format.decoded.url);
  const n = url.searchParams.get("n");
  if (n) {
    if (!solved.n.has(n)) throw new ResolveError("extraction_failed", "The n challenge for a format was not solved.");
    url.searchParams.set("n", solved.n.get(n));
  }
  if (format.decoded.s) {
    if (!solved.sig.has(format.decoded.s)) throw new ResolveError("extraction_failed", "The signature challenge for a format was not solved.");
    url.searchParams.set(format.decoded.sp, solved.sig.get(format.decoded.s));
  }
  return url.toString();
}

/** Full resolution: metadata plus range-fetchable formats with final URLs. */
export async function resolveVideo(videoId, solver, onStatus = () => {}) {
  onStatus("Reading the video page…");
  const html = await fetchText(`https://www.youtube.com/embed/${videoId}?html5=1`);
  const ytcfg = parseYtcfg(html);
  const context = ytcfg.INNERTUBE_CONTEXT;
  if (!context?.client) throw new ResolveError("extraction_failed", "YouTube's embed page carried no client context.");

  onStatus("Loading YouTube's player…");
  const player = await loadPlayer(playerJsUrl(ytcfg));
  const encryptedHostFlags = ytcfg.WEB_PLAYER_CONTEXT_CONFIGS?.WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER?.encryptedHostFlags;

  onStatus("Asking YouTube for the streams…");
  const body = {
    context: { ...context, thirdParty: { ...(context.thirdParty || {}), embedUrl: EMBED_HOST } },
    videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS",
        signatureTimestamp: player.sts,
        ...(encryptedHostFlags ? { encryptedHostFlags } : {}),
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const headers = {
    "Content-Type": "application/json",
    "X-YouTube-Client-Name": String(ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME || 56),
    "X-YouTube-Client-Version": context.client.clientVersion,
  };
  if (context.client.visitorData) headers["X-Goog-Visitor-Id"] = context.client.visitorData;
  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "omit",
  });
  if (!response.ok) throw new ResolveError("extraction_failed", `YouTube's player API answered ${response.status}.`);
  const playerResponse = await response.json();

  const refusal = classifyPlayability(playerResponse);
  if (refusal) throw refusal;
  if (playerResponse.videoDetails?.videoId && playerResponse.videoDetails.videoId !== videoId) {
    throw new ResolveError("extraction_failed", "YouTube answered with a different video.");
  }

  const raw = playerResponse.streamingData?.adaptiveFormats || [];
  const formats = raw.map(normalizeFormat).filter(Boolean);
  if (!formats.length) {
    const drm = raw.length && raw.every((f) => f.drmFamilies?.length);
    if (drm) throw new ResolveError("drm_protected", "This video is DRM-protected.");
    throw new ResolveError("video_unavailable", "YouTube returned no downloadable streams for this video.");
  }

  onStatus("Solving YouTube's player challenge…");
  const challenges = { n: [], sig: [] };
  for (const f of formats) {
    const n = f.decoded.url.searchParams.get("n");
    if (n) challenges.n.push(n);
    if (f.decoded.s) challenges.sig.push(f.decoded.s);
  }
  const solved = await solver.solve(player.id, player.source, challenges);
  for (const f of formats) f.url = finalizeUrl(f, solved);

  const details = playerResponse.videoDetails || {};
  const thumbnails = details.thumbnail?.thumbnails || [];
  const thumbnail = thumbnails.reduce((best, t) => (!best || (t.width || 0) > (best.width || 0) ? t : best), null)?.url;
  return {
    videoId,
    title: details.title || "Untitled video",
    author: details.author || "",
    durationS: Math.max(1, Number(details.lengthSeconds || 0) || Math.round(Math.max(...formats.map((f) => f.approxDurationMs)) / 1000)),
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    formats,
  };
}
