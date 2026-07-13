// virality.studio — X roster overlay · background service worker.
// All tracker requests run here: host_permissions let the extension reach
// virality.studio with the user's existing session cookie, no CORS involved.

const DEFAULT_BASE = "https://www.virality.studio";

async function getBase() {
  const { baseUrl } = await chrome.storage.sync.get({ baseUrl: DEFAULT_BASE });
  return (baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

async function api(path, init) {
  const base = await getBase();
  let res;
  try {
    res = await fetch(base + path, { credentials: "include", ...init });
  } catch (e) {
    return { ok: false, status: 0, error: "Network error — is the tracker reachable?" };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON (e.g. auth redirect HTML) */
  }
  if (res.status === 401 || res.status === 403 || (res.redirected && !data)) {
    return { ok: false, status: 401, error: "Signed out", base };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}`, base };
  }
  return { ok: true, status: res.status, data, base };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "profile") {
      sendResponse(await api(`/api/ext/profile?username=${encodeURIComponent(msg.username)}`));
    } else if (msg?.type === "track") {
      const body = { input: msg.username, backfill: true };
      if (msg.rateQuoteTweet != null && msg.rateQuoteTweet !== "") {
        body.rateQuoteTweet = Number(msg.rateQuoteTweet);
      }
      if (msg.tag) body.tags = [msg.tag];
      sendResponse(
        await api("/api/accounts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    } else if (msg?.type === "base") {
      sendResponse({ ok: true, base: await getBase() });
    } else {
      sendResponse({ ok: false, error: "Unknown message" });
    }
  })();
  return true; // async response
});
