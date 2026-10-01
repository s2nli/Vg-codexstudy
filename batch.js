/* Batch content page: hierarchy viewer, Live & Upcoming, PDF viewer, in-app Hls.js player. */
(function () {
  "use strict";
  const V = window.Vidyagram;
  const $ = (id) => document.getElementById(id);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

  const params = new URLSearchParams(location.search);
  const courseId = params.get("id") || "";
  let courseTitle = (params.get("title") || "").trim();
  if (!courseTitle && courseId) {
    const cached = (V.readCachedBatches() || []).find((b) => b._id === courseId);
    courseTitle = cached ? cached.name : "Batch";
  }
  courseTitle = courseTitle || "Batch";

  document.title = `${courseTitle} — CODEX STUDYS`;
  $("topTitle").textContent = courseTitle;

  let crumbs = [{ id: "-1", title: courseTitle }];
  let tab = "content";
  const folderCache = new Map();
  let liveCache = null;

  /* ---------- theme toggle ---------- */
  const LIGHT_THEMES = ["light", "sakura-blossom", "lavender-mist"];
  function isLightNow() {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? LIGHT_THEMES.includes(t) : false;
  }
  $("modeBtn").addEventListener("click", () => {
    const next = isLightNow() ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("codex-studys-theme", next); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#f4f5f9" : "#090b10");
  });

  function toast(message) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ---------- icons ---------- */
  const ICON = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l5 5v13H7Z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 9.5v5h4l5 4v-13l-5 4Z" fill="currentColor"/><path d="M16.5 9a4 4 0 0 1 0 6M18.8 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 9.5v5h4l5 4v-13l-5 4Z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>'
  };

  /* ---------- crumbs ---------- */
  function renderCrumbs() {
    const nav = $("crumbs");
    nav.innerHTML = crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      return (i ? '<span class="sep" aria-hidden="true">›</span>' : "") +
        `<button type="button" data-i="${i}" ${last ? 'aria-current="page"' : ""} title="${esc(c.title)}">${esc(c.title)}</button>`;
    }).join("");
    nav.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      if (i === crumbs.length - 1) return;
      crumbs = crumbs.slice(0, i + 1);
      history.pushState({ crumbs }, "");
      showContent();
    }));
  }

  window.addEventListener("popstate", (event) => {
    crumbs = (event.state && event.state.crumbs) || [{ id: "-1", title: courseTitle }];
    if (tab === "content") showContent();
  });
  history.replaceState({ crumbs }, "");

  /* ---------- views ---------- */
  const view = $("view");
  function skeleton() { view.innerHTML = Array.from({ length: 6 }, () => '<div class="skel"></div>').join(""); }
  function errorState(message, retry) {
    view.innerHTML = `<div class="state"><div>${esc(message)}</div><button class="btn" type="button" id="retryBtn">Try again</button></div>`;
    $("retryBtn").addEventListener("click", retry);
  }

  function itemKind(item) {
    const t = item.type;
    if (t === "FOLDER" || t.includes("FOLDER")) return "folder";
    if (t === "VIDEO" || t.includes("VIDEO") || t === "LIVE") return "video";
    if (t === "PDF" || t === "FILE" || t.includes("PDF")) return "pdf";
    if (item.pdfLink) return "pdf";
    return "other";
  }

  function itemRow(item, index, kind) {
    const icon = ICON[kind] || ICON.pdf;
    const thumb = item.thumbnail && kind === "video" ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
    const sub = kind === "folder" ? "Folder" : kind === "video" ? "Video" + (item.duration ? ` · ${esc(item.duration)}` : "") : kind === "pdf" ? "PDF / File" : esc(item.type || "Item");
    const showPdf = kind === "video" && item.pdfLink;
    return `
      <div class="item" role="button" tabindex="0" data-index="${index}" data-kind="${kind}">
        <span class="item-ico ${kind}">${icon}${thumb}</span>
        <span class="item-main"><span class="item-title">${esc(item.title)}</span><span class="item-sub">${sub}</span></span>
        <span class="item-actions">${showPdf ? `<button class="pill" type="button" data-pdf="${index}">View PDF</button>` : ""}${kind === "folder" ? ICON.chev : ""}</span>
      </div>`;
  }

  function bindItems(items, onOpen) {
    view.querySelectorAll(".item").forEach((row) => {
      const item = items[Number(row.dataset.index)];
      const open = () => onOpen(item, row.dataset.kind);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    view.querySelectorAll("[data-pdf]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPdf(items[Number(btn.dataset.pdf)].pdfLink, items[Number(btn.dataset.pdf)].title);
    }));
  }

  async function showContent() {
    renderCrumbs();
    if (!courseId) { errorState("Batch id missing hai. Homepage se batch dubara open karein.", () => location.reload()); return; }
    const current = crumbs[crumbs.length - 1];
    const key = `${courseId}:${current.id}`;
    let items = folderCache.get(key);
    if (!items) {
      skeleton();
      try {
        items = await V.fetchFolder(courseId, current.id);
        folderCache.set(key, items);
      } catch (error) {
        if (tab === "content" && crumbs[crumbs.length - 1] === current) errorState(`Content load nahi hua: ${error.message}`, showContent);
        return;
      }
    }
    if (tab !== "content" || crumbs[crumbs.length - 1] !== current) return;
    if (!items.length) { view.innerHTML = '<div class="state">Is folder me abhi koi content nahi hai.</div>'; return; }
    view.innerHTML = items.map((item, i) => itemRow(item, i, itemKind(item))).join("");
    bindItems(items, (item, kind) => {
      if (kind === "folder") {
        crumbs = crumbs.concat({ id: item.id, title: item.title });
        history.pushState({ crumbs }, "");
        window.scrollTo({ top: 0 });
        showContent();
      } else if (kind === "video") {
        openVideo(item);
      } else if (kind === "pdf") {
        openPdf(item.pdfLink, item.title);
      } else {
        toast("Yeh content type abhi support nahi hota.");
      }
    });
  }

  function liveRow(item, index, upcoming) {
    const when = item.startsAt ? new Date(item.startsAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `
      <div class="item" role="button" tabindex="0" data-index="${index}" data-kind="video">
        <span class="item-ico video">${ICON.video}${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>
        <span class="item-main"><span class="item-title">${esc(item.title)}</span><span class="item-sub">${esc(when || "Recorded session")}</span></span>
        <span class="item-actions">${upcoming ? '<span class="badge-live">LIVE / SOON</span>' : ""}</span>
      </div>`;
  }

  async function showLive() {
    $("crumbs").innerHTML = `<button type="button" aria-current="page">${esc(courseTitle)}</button><span class="sep">›</span><button type="button" aria-current="page">Live &amp; Upcoming</button>`;
    if (!liveCache) {
      skeleton();
      try { liveCache = await V.fetchLive(courseId); }
      catch (error) { if (tab === "live") errorState(`Live sessions load nahi hue: ${error.message}`, showLive); return; }
    }
    if (tab !== "live") return;
    const all = liveCache.upcoming.concat(liveCache.previous);
    if (!all.length) { view.innerHTML = '<div class="state">Abhi koi live ya upcoming session nahi hai.</div>'; return; }
    let html = "";
    if (liveCache.upcoming.length) html += '<div class="group-title">Live &amp; upcoming</div>' + liveCache.upcoming.map((it, i) => liveRow(it, i, true)).join("");
    if (liveCache.previous.length) html += '<div class="group-title">Previous sessions</div>' + liveCache.previous.map((it, i) => liveRow(it, liveCache.upcoming.length + i, false)).join("");
    view.innerHTML = html;
    bindItems(all, (item) => {
      if (item.videoId) openVideo(item);
      else if (item.link) window.open(item.link, "_blank", "noopener");
      else toast("Is session ka video abhi available nahi hai.");
    });
  }

  function setTab(next) {
    tab = next;
    $("tabContent").classList.toggle("active", next === "content");
    $("tabLive").classList.toggle("active", next === "live");
    $("tabContent").setAttribute("aria-selected", String(next === "content"));
    $("tabLive").setAttribute("aria-selected", String(next === "live"));
    next === "content" ? showContent() : showLive();
  }
  $("tabContent").addEventListener("click", () => setTab("content"));
  $("tabLive").addEventListener("click", () => setTab("live"));

  /* ---------- PDF ---------- */
  async function openPdf(link, title) {
    if (!link) return toast("Is item ka PDF available nahi hai.");
    const win = window.open("", "_blank"); // opened synchronously so popup blockers allow it
    try {
      const url = await V.decryptLink(link);
      const viewer = V.pdfViewerUrl(url);
      if (win) { win.location.href = viewer; return; }
      $("pdfTitle").textContent = title || "PDF";
      $("pdfNewTab").href = viewer;
      $("pdfFrame").src = viewer;
      openOverlay("pdfModal");
    } catch (error) {
      if (win) win.close();
      toast(error.message || "PDF open nahi ho paya");
    }
  }
  function closePdf() { $("pdfFrame").src = "about:blank"; closeOverlay("pdfModal"); }
  $("pdfClose").addEventListener("click", closePdf);

  function openOverlay(id) { $(id).classList.add("visible"); document.body.classList.add("modal-open"); }
  function closeOverlay(id) {
    $(id).classList.remove("visible");
    if (!document.querySelector(".overlay.visible")) document.body.classList.remove("modal-open");
  }

  /* ---------- Player ---------- */
  const video = $("video");
  const player = $("player");
  const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
  let hls = null;
  let sources = [];
  let sourceIndex = 0;
  let levelMode = false;
  let idleTimer = null;
  let session = 0;
  let currentPdf = "";

  $("pPlay").innerHTML = ICON.play;
  $("pMute").innerHTML = ICON.vol;

  const fmt = (t) => {
    if (!isFinite(t)) return "0:00";
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
  };

  function showMsg(text) { $("pMsg").textContent = text; $("pMsg").classList.toggle("on", !!text); }
  function spinner(on) { $("pSpinner").classList.toggle("on", on); }

  function destroyHls() { if (hls) { hls.destroy(); hls = null; } }

  function attach(url, startAt = 0, autoplay = true) {
    destroyHls();
    levelMode = false;
    spinner(true);
    showMsg("");
    const isHls = /\.m3u8(\?|#|$)/i.test(url);
    const begin = () => {
      if (startAt > 0) { try { video.currentTime = startAt; } catch (e) {} }
      if (autoplay) video.play().catch(() => {});
    };
    if (isHls && window.Hls && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 40, enableWorker: true });
      let netRetry = 0;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (sources.length <= 1 && hls.levels.length > 1) levelMode = true;
        updateQualityLabel();
        begin();
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetry++ < 2) { hls.startLoad(); return; }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        spinner(false);
        showMsg("Video play nahi ho paya. Dusri quality try karein ya thodi der baad dobara open karein.");
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener("loadedmetadata", begin, { once: true });
    } else {
      video.src = url;
      video.addEventListener("loadedmetadata", begin, { once: true });
    }
    updateQualityLabel();
  }

  function updateQualityLabel() {
    let label = "Auto";
    if (levelMode && hls) label = hls.currentLevel === -1 ? "Auto" : `${hls.levels[hls.currentLevel].height}p`;
    else if (sources.length > 1) label = sources[sourceIndex].label;
    $("pQuality").textContent = label;
    $("pQuality").style.display = (sources.length > 1 || levelMode) ? "" : "none";
  }

  async function openVideo(item) {
    const mine = ++session;
    $("playerTitle").textContent = item.title || "Video";
    currentPdf = item.pdfLink || "";
    $("playerPdfBtn").style.display = currentPdf ? "" : "none";
    sources = []; sourceIndex = 0;
    video.removeAttribute("src");
    video.load();
    showMsg("");
    spinner(true);
    $("pQuality").style.display = "none";
    closeMenu();
    openOverlay("playerModal");
    wake();
    try {
      const details = await V.resolveVideo(item.videoId || item.id, courseId);
      if (mine !== session) return;
      sources = details.sources;
      if (details.pdfLink && !currentPdf) { currentPdf = details.pdfLink; $("playerPdfBtn").style.display = ""; }
      if (details.title && !item.title) $("playerTitle").textContent = details.title;
      attach(sources[0].url);
    } catch (error) {
      if (mine !== session) return;
      spinner(false);
      showMsg(error.message || "Video load nahi hua");
    }
  }

  function closePlayer() {
    session++;
    video.pause();
    destroyHls();
    video.removeAttribute("src");
    video.load();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    closeMenu();
    closeOverlay("playerModal");
  }
  $("playerClose").addEventListener("click", closePlayer);
  $("playerPdfBtn").addEventListener("click", () => openPdf(currentPdf, $("playerTitle").textContent));

  // controls
  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  const seekBy = (d) => { video.currentTime = Math.min(Math.max(0, video.currentTime + d), video.duration || Infinity); };
  $("pPlay").addEventListener("click", toggle);
  video.addEventListener("click", () => { if (!player.classList.contains("idle")) toggle(); wake(); });
  $("pBack").addEventListener("click", () => seekBy(-10));
  $("pFwd").addEventListener("click", () => seekBy(10));
  $("pMute").addEventListener("click", () => { video.muted = !video.muted; });
  $("pVol").addEventListener("input", (e) => { video.volume = Number(e.target.value); video.muted = video.volume === 0; });
  video.addEventListener("volumechange", () => {
    $("pMute").innerHTML = video.muted || video.volume === 0 ? ICON.mute : ICON.vol;
    $("pVol").value = video.muted ? 0 : video.volume;
  });
  video.addEventListener("play", () => { $("pPlay").innerHTML = ICON.pause; wake(); });
  video.addEventListener("pause", () => { $("pPlay").innerHTML = ICON.play; player.classList.remove("idle"); });
  video.addEventListener("waiting", () => spinner(true));
  ["playing", "canplay", "loadeddata"].forEach((ev) => video.addEventListener(ev, () => spinner(false)));
  video.addEventListener("error", () => { if (sources.length && !hls) { spinner(false); showMsg("Video play nahi ho paya."); } });

  function paint() {
    const d = video.duration || 0, t = video.currentTime || 0;
    const pct = d ? (t / d) * 100 : 0;
    $("pFill").style.width = pct + "%";
    $("pKnob").style.left = pct + "%";
    let buf = 0;
    try { if (video.buffered.length) buf = video.buffered.end(video.buffered.length - 1); } catch (e) {}
    $("pBuf").style.width = d ? (buf / d) * 100 + "%" : "0";
    $("pTime").textContent = `${fmt(t)} / ${fmt(d)}`;
  }
  ["timeupdate", "progress", "durationchange", "loadedmetadata"].forEach((ev) => video.addEventListener(ev, paint));

  const seek = $("pSeek");
  function seekFromEvent(e) {
    const r = seek.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    if (video.duration) video.currentTime = ratio * video.duration;
  }
  seek.addEventListener("pointerdown", (e) => {
    seek.setPointerCapture(e.pointerId);
    seekFromEvent(e);
    const move = (ev) => seekFromEvent(ev);
    const up = () => { seek.removeEventListener("pointermove", move); seek.removeEventListener("pointerup", up); };
    seek.addEventListener("pointermove", move);
    seek.addEventListener("pointerup", up);
  });

  // speed + quality menus
  const menu = $("pMenu");
  let menuKind = "";
  function closeMenu() { menu.classList.remove("on"); menuKind = ""; }
  function openMenu(kind) {
    if (menuKind === kind) return closeMenu();
    menuKind = kind;
    let rows = [];
    if (kind === "speed") {
      rows = SPEEDS.map((s) => ({ label: `${s}x`, sel: video.playbackRate === s, run: () => { video.playbackRate = s; $("pSpeed").textContent = `${s}x`; } }));
    } else if (levelMode && hls) {
      rows = [{ label: "Auto", sel: hls.currentLevel === -1 && hls.autoLevelEnabled, run: () => { hls.currentLevel = -1; } }]
        .concat(hls.levels.map((lv, i) => ({ label: `${lv.height}p`, sel: hls.currentLevel === i, run: () => { hls.currentLevel = i; } })).reverse());
    } else {
      rows = sources.map((s, i) => ({
        label: s.label, sel: i === sourceIndex,
        run: () => { const t = video.currentTime; const wasPlaying = !video.paused; sourceIndex = i; attach(s.url, t, wasPlaying); }
      }));
    }
    menu.innerHTML = rows.map((r, i) => `<button type="button" data-i="${i}" class="${r.sel ? "sel" : ""}"><span>${esc(r.label)}</span>${r.sel ? "<span>✓</span>" : ""}</button>`).join("");
    menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { rows[Number(b.dataset.i)].run(); closeMenu(); setTimeout(updateQualityLabel, 50); }));
    menu.classList.add("on");
  }
  $("pSpeed").addEventListener("click", () => openMenu("speed"));
  $("pQuality").addEventListener("click", () => openMenu("quality"));

  // fullscreen + PiP
  $("pFull").addEventListener("click", () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (player.requestFullscreen) player.requestFullscreen().catch(() => {});
    else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
  const pipOk = !!(document.pictureInPictureEnabled && video.requestPictureInPicture);
  if (!pipOk) $("pPip").style.display = "none";
  $("pPip").addEventListener("click", async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (e) { toast("Picture-in-Picture is browser me available nahi hai"); }
  });

  // auto-hide controls
  function wake() {
    player.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!video.paused && !menu.classList.contains("on")) player.classList.add("idle"); }, 3000);
  }
  ["mousemove", "touchstart", "pointerdown", "keydown"].forEach((ev) => player.addEventListener(ev, wake, { passive: true }));

  // keyboard
  document.addEventListener("keydown", (e) => {
    const playerOpen = $("playerModal").classList.contains("visible");
    if (e.key === "Escape") {
      if ($("pdfModal").classList.contains("visible")) closePdf();
      else if (playerOpen && !document.fullscreenElement) closePlayer();
      return;
    }
    if (!playerOpen || /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); toggle(); }
    else if (k === "arrowleft" || k === "j") seekBy(-10);
    else if (k === "arrowright" || k === "l") seekBy(10);
    else if (k === "arrowup") { e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); }
    else if (k === "arrowdown") { e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); }
    else if (k === "f") $("pFull").click();
    else if (k === "m") video.muted = !video.muted;
    wake();
  });

  setTab("content");
})();
