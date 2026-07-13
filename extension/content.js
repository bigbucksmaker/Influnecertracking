// virality.studio — X roster overlay · content script.
// Watches the URL for profile pages, asks the background worker for tracker
// metrics, and renders a fixed right-hand drawer in a shadow DOM (X's own
// markup never touches it, and vice versa).

(() => {
  const RESERVED = new Set([
    "home", "explore", "notifications", "messages", "i", "settings", "compose",
    "search", "jobs", "communities", "premium", "verified-orgs", "bookmarks",
    "lists", "topics", "moments", "about", "tos", "privacy", "login", "logout",
    "signup", "share", "intent", "hashtag", "account", "follower_requests",
    "grok", "explore_tabs", "help",
  ]);
  const PROFILE_RE = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|highlights|likes|superfollows|affiliates))?\/?$/;

  let currentHandle = null;
  let host = null;
  let root = null;
  let pollTimer = null;
  let addPollTimer = null;

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------
  const fmt = (n) => {
    if (n == null || !isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K";
    return String(Math.round(n));
  };
  const pct = (r, d = 1) => (r == null || !isFinite(r) ? "—" : (r * 100).toFixed(d) + "%");
  const signedPct = (r) => (r == null || !isFinite(r) ? "—" : (r > 0 ? "+" : "") + (r * 100).toFixed(0) + "%");
  const rel = (iso) => {
    if (!iso) return "never";
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // -------------------------------------------------------------------------
  // SVG helpers
  // -------------------------------------------------------------------------
  function ring(score, color, size = 44) {
    if (score == null || !isFinite(score)) return '<div class="na">—</div>';
    const r = (size - 6) / 2;
    const c = 2 * Math.PI * r;
    const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
    return `<svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="3.5"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${filled} ${c - filled}"/>
    </svg>
    <div class="ringnum">${Math.round(score)}</div>`;
  }

  function sparkline(values) {
    const pts = (values || []).filter((v) => isFinite(v));
    if (pts.length < 2 || !pts.some((v) => v > 0)) return "";
    const w = 120, h = 28, pad = 2;
    const max = Math.max(...pts), min = Math.min(...pts), span = max - min || 1;
    const coords = pts.map((v, i) => [
      pad + (i / (pts.length - 1)) * (w - pad * 2),
      pad + (h - pad * 2) - ((v - min) / span) * (h - pad * 2),
    ]);
    const d = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const up = pts[pts.length - 1] >= pts[0];
    const col = up ? "#37C08A" : "#F0616D";
    return `<svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  // -------------------------------------------------------------------------
  // Panel shell
  // -------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .drawer {
      position: fixed; top: 64px; right: 12px; width: 336px; max-height: calc(100vh - 88px);
      overflow-y: auto; z-index: 2147483000; border-radius: 14px;
      background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,0) 34%), rgba(13,15,20,.94);
      border: 1px solid #232833; color: #EDEFF3;
      box-shadow: 0 16px 48px rgba(0,0,0,.55); backdrop-filter: blur(12px);
      font-size: 13px; scrollbar-width: thin;
    }
    .drawer::-webkit-scrollbar { width: 8px; }
    .drawer::-webkit-scrollbar-thumb { background: #232833; border-radius: 4px; }
    .pill {
      position: fixed; top: 72px; right: 12px; z-index: 2147483000;
      display: flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 999px;
      background: rgba(13,15,20,.94); border: 1px solid #232833; color: #9AA1AD;
      cursor: pointer; font-size: 12px; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,.45);
      backdrop-filter: blur(12px);
    }
    .pill:hover { color: #EDEFF3; border-color: #7C6DF7; }
    .logo { width: 18px; height: 18px; border-radius: 5px; background: linear-gradient(135deg, #7C6DF7, #5B49E0);
      display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 11px; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #181C25; }
    .hd .t { font-weight: 700; font-size: 12.5px; letter-spacing: -.01em; }
    .hd .sub { color: #5F6673; font-size: 10.5px; }
    .hd .sp { margin-left: auto; display: flex; gap: 6px; }
    .icobtn { background: none; border: 1px solid #232833; color: #9AA1AD; border-radius: 7px;
      width: 24px; height: 24px; cursor: pointer; font-size: 12px; line-height: 1; }
    .icobtn:hover { color: #EDEFF3; border-color: #7C6DF7; }
    .bd { padding: 12px 14px; }
    .idrow { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .idrow img { width: 36px; height: 36px; border-radius: 999px; }
    .idrow .nm { font-weight: 700; font-size: 14px; }
    .idrow .hn { color: #5F6673; font-size: 11.5px; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 6px; font-size: 10px; font-weight: 700; }
    .b-teal { background: rgba(42,200,181,.13); color: #54DCCB; }
    .b-red { background: rgba(240,97,109,.14); color: #F0616D; }
    .b-amber { background: rgba(231,178,60,.14); color: #E7B23C; }
    .b-slate { background: #161922; color: #9AA1AD; }
    .rings { display: flex; gap: 14px; margin: 12px 0; }
    .ringbox { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .ringbox .ringnum { position: absolute; top: 13px; font-size: 12px; font-weight: 800;
      font-variant-numeric: tabular-nums; width: 44px; text-align: center; }
    .ringbox .lb { font-size: 9.5px; color: #5F6673; text-transform: uppercase; letter-spacing: .08em; }
    .ringbox .rk { font-size: 10px; color: #9AA1AD; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0; }
    .cell { background: rgba(22,25,34,.5); border: 1px solid #181C25; border-radius: 9px; padding: 8px 10px; }
    .cell .k { font-size: 9.5px; color: #5F6673; text-transform: uppercase; letter-spacing: .08em; }
    .cell .v { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
    .cell .s { font-size: 10px; color: #5F6673; }
    .pos { color: #37C08A; } .neg { color: #F0616D; } .money { color: #54DCCB; } .warn { color: #E7B23C; }
    .econ { border: 1px solid rgba(42,200,181,.25); border-radius: 9px; padding: 9px 10px; margin: 10px 0;
      background: rgba(42,200,181,.05); }
    .econ .row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0;
      font-variant-numeric: tabular-nums; }
    .econ .row .k { color: #9AA1AD; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0 4px; }
    .chip { background: rgba(124,109,247,.14); color: #9B8FFA; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; }
    .ft { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
      border-top: 1px solid #181C25; font-size: 11px; color: #5F6673; }
    .lnk { color: #9B8FFA; text-decoration: none; font-weight: 600; }
    .lnk:hover { text-decoration: underline; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: 100%;
      background: #6C5DF0; color: #fff; border: 0; border-radius: 9px; padding: 9px 12px;
      font-size: 13px; font-weight: 700; cursor: pointer; }
    .btn:hover { background: #7C6DF7; }
    .btn[disabled] { opacity: .55; cursor: default; }
    .in { width: 100%; background: #10131a; border: 1px solid #232833; border-radius: 8px;
      color: #EDEFF3; padding: 8px 10px; font-size: 12.5px; margin: 6px 0; }
    .in:focus { outline: none; border-color: #7C6DF7; }
    .note { color: #5F6673; font-size: 11px; line-height: 1.45; }
    .err { color: #F0616D; font-size: 11.5px; margin-top: 6px; }
    .center { text-align: center; padding: 18px 8px; }
    .spin { display: inline-block; width: 16px; height: 16px; border: 2px solid #232833;
      border-top-color: #7C6DF7; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .sparkrow { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 8px; }
    .sparkrow .lb { font-size: 9.5px; color: #5F6673; text-transform: uppercase; letter-spacing: .08em; }
  `;

  function mount() {
    if (host) return;
    host = document.createElement("div");
    host.id = "virality-overlay-host";
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    const wrap = document.createElement("div");
    wrap.id = "wrap";
    root.appendChild(wrap);
  }

  function unmount() {
    clearTimeout(pollTimer);
    clearTimeout(addPollTimer);
    if (host) { host.remove(); host = null; root = null; }
  }

  const collapsed = () => sessionStorage.getItem("vs-overlay-collapsed") === "1";
  const setCollapsed = (v) => sessionStorage.setItem("vs-overlay-collapsed", v ? "1" : "0");

  function shell(inner, { pillOnly = false, handle } = {}) {
    mount();
    const wrap = root.getElementById("wrap");
    if (pillOnly || collapsed()) {
      wrap.innerHTML = `<div class="pill" id="pill"><span class="logo">V</span>${pillOnly ? `Track @${esc(handle)}` : "roster metrics"}</div>`;
      wrap.querySelector("#pill").addEventListener("click", () => {
        setCollapsed(false);
        evaluate(true);
      });
      return null;
    }
    wrap.innerHTML = `
      <div class="drawer">
        <div class="hd">
          <span class="logo">V</span>
          <div><div class="t">virality.studio</div><div class="sub">roster overlay</div></div>
          <div class="sp">
            <button class="icobtn" id="rf" title="Refresh">↻</button>
            <button class="icobtn" id="cl" title="Collapse">—</button>
          </div>
        </div>
        <div id="inner">${inner}</div>
      </div>`;
    wrap.querySelector("#cl").addEventListener("click", () => {
      setCollapsed(true);
      evaluate(true);
    });
    wrap.querySelector("#rf").addEventListener("click", () => evaluate(true));
    return wrap.querySelector("#inner");
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------
  function viewLoading(handle) {
    shell(`<div class="bd center"><span class="spin"></span><div class="note" style="margin-top:8px">Checking @${esc(handle)}…</div></div>`);
  }

  function viewSignedOut(base) {
    const inner = shell(`
      <div class="bd center">
        <div style="font-weight:700;margin-bottom:6px">Signed out</div>
        <p class="note">Sign in to the tracker in another tab, then refresh this panel.</p>
        <button class="btn" id="open" style="margin-top:10px">Open virality.studio</button>
      </div>`);
    if (inner) inner.querySelector("#open").addEventListener("click", () => window.open(base || "https://www.virality.studio", "_blank"));
  }

  function viewError(msg) {
    shell(`<div class="bd center"><div class="err">${esc(msg)}</div></div>`);
  }

  function viewTracked(a, base) {
    const dirBadge =
      a.direction === "rising" ? '<span class="badge b-teal">▲ rising</span>' :
      a.direction === "falling" ? '<span class="badge b-red">▼ falling</span>' :
      '<span class="badge b-slate">flat</span>';
    const conf = a.lowConfidence
      ? `<span class="badge b-amber" title="${esc((a.lowConfidenceReasons || []).join("; "))}">⚠ low confidence</span>`
      : "";
    const price =
      a.pricePosition === "underpriced" ? '<span class="badge b-teal">underpriced</span>' :
      a.pricePosition === "overpriced" ? '<span class="badge b-red">overpriced</span>' :
      a.pricePosition === "fair" ? '<span class="badge b-slate">fair price</span>' : "";

    const inner = shell(`
      <div class="bd">
        <div class="idrow">
          ${a.profilePicture ? `<img src="${esc(a.profilePicture)}" alt="">` : ""}
          <div>
            <div class="nm">${esc(a.displayName || a.username)}</div>
            <div class="hn">@${esc(a.username)} ${dirBadge} ${conf}</div>
          </div>
        </div>

        <div class="rings">
          <div class="ringbox">${ring(a.performanceScore, "#7C6DF7")}<div class="lb">Performance</div><div class="rk">#${a.rank ?? "—"}</div></div>
          <div class="ringbox">${ring(a.valueScore, "#2AC8B5")}<div class="lb">Value</div><div class="rk">${a.valueRank ? "#" + a.valueRank : "no rate"}</div></div>
          <div style="flex:1">
            <div class="sparkrow"><span class="lb">4-week views</span></div>
            ${sparkline(a.viewsSparkline)}
            <div class="note" style="margin-top:4px">${fmt(a.postCount7d)} posts · 7d</div>
          </div>
        </div>

        <div class="grid">
          <div class="cell"><div class="k">Median views</div><div class="v">${fmt(a.medianViews)}</div><div class="s">p25 ${fmt(a.p25Views)}</div></div>
          <div class="cell"><div class="k">ER (impr.)</div><div class="v">${pct(a.erImpressions)}</div><div class="s">eng ÷ views</div></div>
          <div class="cell"><div class="k">Followers</div><div class="v">${fmt(a.currentFollowers)}</div><div class="s ${a.followerGrowth7dPct > 0 ? "pos" : ""}">${signedPct(a.followerGrowth7dPct)} 7d</div></div>
          <div class="cell"><div class="k">WoW views</div><div class="v ${a.wowViewsPct > 0 ? "pos" : a.wowViewsPct < 0 ? "neg" : ""}">${signedPct(a.wowViewsPct)}</div><div class="s">week over week</div></div>
        </div>

        <div class="econ">
          <div class="row"><span class="k">QT rate</span><span>${a.rateQuoteTweet != null ? "$" + a.rateQuoteTweet : "—"}</span></div>
          <div class="row"><span class="k">Post rate</span><span>${a.ratePost != null ? "$" + a.ratePost : "—"}</span></div>
          <div class="row"><span class="k">Est. CPM</span><span class="money">${a.cpm != null ? "$" + a.cpm : "—"}</span></div>
          <div class="row"><span class="k">Pricing</span><span>${price || "—"}${a.ratesStale ? ' <span class="badge b-amber">rates stale</span>' : ""}</span></div>
        </div>

        ${a.tags && a.tags.length ? `<div class="chips">${a.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="ft">
        <span>polled ${rel(a.lastPolledAt)} · ${esc(a.pollingTier)}</span>
        <a class="lnk" id="open" href="#">Open in tracker →</a>
      </div>`);
    if (inner) {
      const link = inner.parentElement.querySelector("#open");
      link.addEventListener("click", (e) => {
        e.preventDefault();
        window.open(`${base}/influencer/${a.username}`, "_blank");
      });
    }
  }

  function viewPending(handle) {
    shell(`
      <div class="bd center">
        <span class="spin"></span>
        <div style="font-weight:700;margin:8px 0 4px">Backfilling @${esc(handle)}…</div>
        <p class="note">Pulling the last 7 days of posts and building the dashboard. Usually under a minute.</p>
      </div>`);
    clearTimeout(addPollTimer);
    addPollTimer = setTimeout(() => evaluate(true), 6000);
  }

  function viewUntracked(handle, base) {
    const inner = shell(`
      <div class="bd">
        <div style="font-weight:700;margin-bottom:2px">@${esc(handle)} isn't tracked</div>
        <p class="note">Add them to the shared watchlist — they'll be backfilled with the last 7 days and scored against the roster.</p>
        <input class="in" id="rate" type="number" min="0" placeholder="QT rate in USD (optional)">
        <input class="in" id="tag" type="text" placeholder="Niche tag (optional)">
        <button class="btn" id="add">＋ Track on virality.studio</button>
        <div class="err" id="err" style="display:none"></div>
      </div>`);
    if (!inner) return;
    const btn = inner.querySelector("#add");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Adding…";
      const rate = inner.querySelector("#rate").value;
      const tag = inner.querySelector("#tag").value.trim();
      const res = await chrome.runtime.sendMessage({ type: "track", username: handle, rateQuoteTweet: rate, tag });
      if (!res.ok) {
        const err = inner.querySelector("#err");
        err.style.display = "block";
        err.textContent = res.error || "Failed to add.";
        btn.disabled = false;
        btn.textContent = "＋ Track on virality.studio";
        return;
      }
      viewPending(handle);
    });
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  function parseHandle() {
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(location.hostname)) return null;
    const m = PROFILE_RE.exec(location.pathname);
    if (!m) return null;
    const h = m[1].toLowerCase();
    if (RESERVED.has(h)) return null;
    return h;
  }

  async function evaluate(force = false) {
    const handle = parseHandle();
    if (!handle) {
      currentHandle = null;
      unmount();
      return;
    }
    if (handle === currentHandle && !force) return;
    currentHandle = handle;
    clearTimeout(addPollTimer);

    if (collapsed()) {
      shell("", {});
      // collapsed shell renders the pill; still resolves state on expand
    }

    viewLoading(handle);
    const res = await chrome.runtime.sendMessage({ type: "profile", username: handle });
    if (handle !== currentHandle) return; // navigated away mid-flight

    if (!res.ok) {
      if (res.status === 401) viewSignedOut(res.base);
      else viewError(res.error || "Could not reach the tracker.");
      return;
    }
    const d = res.data;
    if (d.state === "tracked") {
      if (collapsed()) shell("", {});
      else viewTracked(d.account, res.base);
    } else if (d.state === "pending") {
      viewPending(handle);
    } else {
      // Untracked: stay quiet-ish — a pill, expanding to the add card on click.
      if (collapsed() || sessionStorage.getItem(`vs-dismiss-${handle}`)) {
        shell("", { pillOnly: true, handle });
      } else {
        viewUntracked(handle, res.base);
      }
    }
  }

  // X is an SPA — poll the URL (cheap, bulletproof against History API games).
  let lastHref = "";
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      evaluate();
    }
  }, 500);
  evaluate();
})();
