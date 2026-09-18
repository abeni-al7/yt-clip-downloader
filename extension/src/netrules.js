// Request-header rules for this tab only. A page cannot set Referer or Origin itself, and YouTube
// needs both to look like an embedded player on a third-party site (the embed page's encrypted
// host flags must match the `thirdParty.embedUrl` sent to the player API, and the API rejects a
// `chrome-extension://` Origin). Scoped to the tab so normal YouTube browsing is untouched.

export const EMBED_HOST = "https://www.reddit.com/";

const RULES_PER_TAB = 4;

function rulesFor(tabId, firstId) {
  const condition = (urlFilter) => ({ tabIds: [tabId], urlFilter, resourceTypes: ["xmlhttprequest"] });
  return [
    {
      id: firstId,
      priority: 1,
      condition: condition("||www.youtube.com/embed/"),
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "referer", operation: "set", value: EMBED_HOST },
          { header: "origin", operation: "remove" },
        ],
      },
    },
    {
      id: firstId + 1,
      priority: 1,
      condition: condition("||www.youtube.com/s/player/"),
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "referer", operation: "set", value: "https://www.youtube.com/" },
          { header: "origin", operation: "remove" },
        ],
      },
    },
    {
      id: firstId + 2,
      priority: 1,
      condition: condition("||www.youtube.com/youtubei/"),
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "referer", operation: "set", value: "https://www.youtube.com/" },
          { header: "origin", operation: "set", value: "https://www.youtube.com" },
        ],
      },
    },
    {
      id: firstId + 3,
      priority: 1,
      condition: condition("||googlevideo.com/"),
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "referer", operation: "set", value: "https://www.youtube.com/" },
          { header: "origin", operation: "remove" },
        ],
      },
    },
  ];
}

export async function installNetRules() {
  const tab = await chrome.tabs.getCurrent();
  if (!tab?.id) throw new Error("This page must run in a browser tab.");
  // Rule ids are int32; other clip tabs may hold rules, so take the first free block.
  const used = new Set((await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id));
  let firstId = 1;
  while ([...Array(RULES_PER_TAB).keys()].some((i) => used.has(firstId + i))) firstId += RULES_PER_TAB;
  const rules = rulesFor(tab.id, firstId);
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
  window.addEventListener("pagehide", () => {
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) }).catch(() => {});
  });
}
