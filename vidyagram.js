/* Vidyagram (LearnByAKP) — shared API client used by index (app.js) and batch page (batch.js). */
(function (global) {
  "use strict";

  const BASE = "https://learnbyakp.onrender.com";
  const PDF_VIEWER = "https://pdfweb.classx.co.in/pdfjs/web/viewer-new.html";
  const AES_KEY = "638udh3829162018";
  const AES_IV = "fedcba9876543210";
  const ENROLLED_KEY = "vidyagram-enrolled";
  const LIST_CACHE_KEY = "vidyagram-batches-cache";

  const API = {
    batchLists: [0, 20, 30].map((start) => `${BASE}/api/get/folder_courses?start=${start}&parent_id=58`),
    folder: (courseId, parentId) =>
      `${BASE}/api/get/folder_contentsv3?course_id=${encodeURIComponent(courseId)}&parent_id=${encodeURIComponent(parentId)}`,
    live: (courseId) => `${BASE}/api/get/live-courses?course_id=${encodeURIComponent(courseId)}`,
    previousLive: (courseId) => `${BASE}/api/get/get_previous_live_videos?course_id=${encodeURIComponent(courseId)}`,
    video: (videoId, courseId) =>
      `${BASE}/api/get/fetchVideoDetailsById?video_id=${encodeURIComponent(videoId)}&course_id=${encodeURIComponent(courseId)}&ytflag=0`,
    decode: (path) => `${BASE}/appx/decode?url=${encodeURIComponent(path)}`
  };

  /* ---------- helpers ---------- */
  const first = (obj, keys, fallback = "") => {
    for (const key of keys) {
      const value = obj && obj[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return fallback;
  };

  function extractList(json, depth = 0) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== "object" || depth > 3) return [];
    for (const key of ["data", "courses", "result", "results", "list", "items", "content", "videos"]) {
      const value = json[key];
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        const nested = extractList(value, depth + 1);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  function toIsoDate(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "number" || /^\d{9,13}$/.test(String(value))) {
      const n = Number(value);
      const d = new Date(n < 1e12 ? n * 1000 : n);
      return isNaN(d) ? "" : d.toISOString();
    }
    const text = String(value).trim();
    const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (dmy) {
      const d = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], +(dmy[4] || 0), +(dmy[5] || 0)));
      return isNaN(d) ? "" : d.toISOString();
    }
    const d = new Date(text.replace(" ", "T"));
    return isNaN(d) ? "" : d.toISOString();
  }

  function formatValidity(value) {
    if (value === undefined || value === null || value === "") return "";
    const text = String(value).trim();
    if (/^\d+$/.test(text)) {
      const days = Number(text);
      if (days >= 365 && days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
      return `${days} days`;
    }
    return text;
  }

  /* ---------- network (Render free tier can take ~30–50 s to wake up) ---------- */
  async function getJSON(url, { retries = 2, timeout = 60000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Server error (${response.status})`);
        const text = await response.text();
        try { return JSON.parse(text); }
        catch (e) { throw new Error("Server ne valid data nahi bheja"); }
      } catch (error) {
        lastError = error.name === "AbortError" ? new Error("Server respond nahi kar raha (timeout)") : error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  /* ---------- batches ---------- */
  function normalizeBatch(raw) {
    const id = String(first(raw, ["id", "course_id", "_id", "courseId"]));
    if (!id) return null;
    const price = parseFloat(first(raw, ["price", "course_price", "sp", "selling_price"], 0)) || 0;
    const mrp = parseFloat(first(raw, ["mrp", "course_mrp", "original_price"], 0)) || 0;
    const freeFlag = String(first(raw, ["is_free", "isFree", "free"], "")).toLowerCase();
    return {
      _id: id,
      name: String(first(raw, ["course_name", "title", "name", "courseName"], "Untitled batch")).trim(),
      byName: String(first(raw, ["category", "category_name", "exam_name", "exam", "cat_name", "course_category", "sub_title", "subtitle"], "")).trim(),
      previewImage: first(raw, ["course_thumbnail", "thumbnail", "course_image", "image", "banner", "thumb", "cover"], ""),
      price,
      mrp,
      isFree: price === 0 || freeFlag === "1" || freeFlag === "true",
      validity: formatValidity(first(raw, ["validity", "validity_days", "course_validity", "duration"], "")),
      startDate: toIsoDate(first(raw, ["start_date", "startDate", "course_start_date", "created_at", "date"], "")),
      endDate: toIsoDate(first(raw, ["end_date", "endDate", "expiry_date"], "")),
      language: "",
      type: "VIDYAGRAM_BATCH"
    };
  }

  function readCachedBatches() {
    try {
      const list = JSON.parse(localStorage.getItem(LIST_CACHE_KEY) || "null");
      return Array.isArray(list) && list.length ? list : null;
    } catch (e) { return null; }
  }

  async function fetchBatches() {
    const results = await Promise.allSettled(API.batchLists.map((url) => getJSON(url)));
    const seen = new Set();
    const batches = [];
    let failures = 0;
    results.forEach((result) => {
      if (result.status !== "fulfilled") { failures++; return; }
      extractList(result.value).forEach((raw) => {
        const batch = normalizeBatch(raw);
        if (batch && !seen.has(batch._id)) { seen.add(batch._id); batches.push(batch); }
      });
    });
    if (!batches.length) {
      const reason = results.find((r) => r.status === "rejected");
      throw (reason && reason.reason) || new Error("Koi batch nahi mila");
    }
    try { localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(batches)); } catch (e) {}
    return { batches, partial: failures > 0 };
  }

  /* ---------- enrolled (localStorage: vidyagram-enrolled) ---------- */
  function getEnrolled() {
    try {
      const list = JSON.parse(localStorage.getItem(ENROLLED_KEY) || "[]");
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) { return []; }
  }
  function isEnrolled(id) { return getEnrolled().includes(String(id)); }
  function toggleEnrolled(id) {
    id = String(id);
    const list = getEnrolled();
    const index = list.indexOf(id);
    if (index === -1) list.push(id); else list.splice(index, 1);
    try { localStorage.setItem(ENROLLED_KEY, JSON.stringify(list)); } catch (e) {}
    return list.includes(id);
  }

  /* ---------- content ---------- */
  function normalizeItem(raw) {
    const type = String(first(raw, ["material_type", "materialType", "type"], "")).toUpperCase().trim();
    const id = String(first(raw, ["id", "folder_id", "video_id", "_id"], ""));
    return {
      id,
      type,
      title: String(first(raw, ["Title", "title", "name", "video_title", "pdf_title", "folder_name"], "Untitled")).trim(),
      thumbnail: first(raw, ["thumbnail", "video_thumbnail", "thumb", "image"], ""),
      videoId: String(first(raw, ["video_id", "id"], "")),
      pdfLink: first(raw, ["pdf_link", "pdfLink", "pdf_url", "file_link"], ""),
      date: toIsoDate(first(raw, ["published_at", "created_at", "date", "start_date"], "")),
      duration: first(raw, ["duration", "video_duration"], ""),
      raw
    };
  }

  async function fetchFolder(courseId, parentId = -1) {
    const json = await getJSON(API.folder(courseId, parentId));
    return extractList(json).map(normalizeItem);
  }

  function normalizeLive(raw) {
    const item = normalizeItem(raw);
    item.title = String(first(raw, ["title", "Title", "live_title", "name", "video_title"], item.title)).trim();
    item.startsAt = toIsoDate(first(raw, ["start_time", "live_at", "date", "start_date", "scheduled_at", "published_at"], ""));
    item.link = first(raw, ["link", "live_link", "youtube_link", "url"], "");
    item.type = item.type || "VIDEO";
    return item;
  }

  async function fetchLive(courseId) {
    const [live, previous] = await Promise.allSettled([
      getJSON(API.live(courseId)),
      getJSON(API.previousLive(courseId))
    ]);
    if (live.status === "rejected" && previous.status === "rejected") throw live.reason;
    return {
      upcoming: live.status === "fulfilled" ? extractList(live.value).map(normalizeLive) : [],
      previous: previous.status === "fulfilled" ? extractList(previous.value).map(normalizeLive) : []
    };
  }

  /* ---------- AES-CBC 128 (Web Crypto) ---------- */
  function b64ToBytes(value) {
    let text = String(value).trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (text.length % 4) text += "=";
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function aesDecrypt(cipherText) {
    if (!global.crypto || !global.crypto.subtle) throw new Error("Decrypt ke liye HTTPS (secure connection) chahiye");
    const encoder = new TextEncoder();
    const key = await global.crypto.subtle.importKey("raw", encoder.encode(AES_KEY), { name: "AES-CBC" }, false, ["decrypt"]);
    const plain = await global.crypto.subtle.decrypt({ name: "AES-CBC", iv: encoder.encode(AES_IV) }, key, b64ToBytes(cipherText));
    return new TextDecoder().decode(plain).trim();
  }

  async function decryptLink(value) {
    const text = String(value || "").trim();
    if (!text) throw new Error("Link available nahi hai");
    if (/^https?:\/\//i.test(text)) return text;
    const candidates = text.includes(":") ? [text, text.split(":")[0]] : [text];
    for (const candidate of candidates) {
      try {
        const out = await aesDecrypt(candidate);
        if (/^https?:\/\//i.test(out)) return out;
      } catch (e) { /* try next */ }
    }
    throw new Error("PDF link decrypt nahi ho paya");
  }

  function pdfViewerUrl(url) {
    return `${PDF_VIEWER}?file=${encodeURIComponent(url)}&save_flag=1`;
  }

  /* ---------- video ---------- */
  async function decodeStream(path) {
    const response = await fetch(API.decode(path));
    if (!response.ok) throw new Error(`Stream decode fail (${response.status})`);
    const text = (await response.text()).trim();
    try {
      const json = JSON.parse(text);
      if (typeof json === "string") return json;
      const value = first(json, ["url", "link", "decoded", "result", "data", "stream"], "");
      if (typeof value === "string") return value;
      if (value && typeof value === "object") return first(value, ["url", "link", "decoded"], "");
    } catch (e) { /* plain text */ }
    return text.replace(/^"|"$/g, "");
  }

  const isStreamUrl = (value) => /^https?:\/\/\S+/i.test(value) && /\.(m3u8|mp4)(\?|#|$)/i.test(value);

  async function resolveVideo(videoId, courseId) {
    const json = await getJSON(API.video(videoId, courseId), { retries: 1 });
    const data = (json && typeof json.data === "object" && !Array.isArray(json.data) && json.data) || json || {};
    const candidates = [];
    for (const key of ["encrypted_links", "links", "qualities", "video_links", "hls_links"]) {
      const arr = data[key];
      if (Array.isArray(arr)) {
        arr.forEach((entry) => {
          const url = typeof entry === "string" ? entry : first(entry, ["path", "url", "link", "file", "src"], "");
          const label = typeof entry === "string" ? "" : first(entry, ["quality", "resolution", "label", "name"], "");
          if (url) candidates.push({ label: String(label), url: String(url) });
        });
      }
    }
    for (const key of ["hls_url", "hlsUrl", "video_url", "download_link", "stream_url", "m3u8", "url", "link"]) {
      if (typeof data[key] === "string" && data[key]) candidates.push({ label: "Auto", url: data[key] });
    }
    const sources = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      try {
        const url = isStreamUrl(candidate.url) ? candidate.url : await decodeStream(candidate.url);
        if (/^https?:\/\//i.test(url) && !sources.some((s) => s.url === url)) {
          const label = candidate.label ? (/^\d+$/.test(candidate.label) ? `${candidate.label}p` : candidate.label) : "Auto";
          sources.push({ label, url });
        }
      } catch (e) { /* skip bad quality */ }
    }
    if (!sources.length) throw new Error("Is video ka stream link nahi mila");
    sources.sort((a, b) => (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0));
    return {
      title: String(first(data, ["Title", "title", "video_title", "name"], "")),
      sources,
      pdfLink: first(data, ["pdf_link", "pdfLink", "pdf_url"], "")
    };
  }

  global.Vidyagram = {
    BASE, API, getJSON, extractList, fetchBatches, readCachedBatches, normalizeBatch,
    getEnrolled, isEnrolled, toggleEnrolled,
    fetchFolder, fetchLive, resolveVideo,
    decryptLink, pdfViewerUrl, formatValidity, toIsoDate
  };
})(window);
