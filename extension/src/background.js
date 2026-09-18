// Toolbar button: open the clip page, pre-filled with the video of the current tab when it is one.
import { parseYoutubeUrl } from "./youtube_url.js";

chrome.action.onClicked.addListener(async (tab) => {
  const parsed = tab?.url ? parseYoutubeUrl(tab.url) : null;
  const params = new URLSearchParams();
  if (parsed) {
    params.set("v", parsed.videoId);
    if (parsed.startHintS != null) params.set("t", String(parsed.startHintS));
  }
  const query = params.toString();
  await chrome.tabs.create({ url: chrome.runtime.getURL("ui.html") + (query ? `?${query}` : "") });
});
