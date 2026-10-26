// Share link (Phase 6). The schedule is packed into the URL hash (#s=...), which browsers
// never send to a server. Only `subjects` are shared, never `settings`.
// Pipeline: subjects -> short-key JSON -> deflate-raw -> base64url.

import { DAYS, validateSubject } from "./model.js";

const VERSION = 1;
const MAX_SUBJECTS = 50;
const MAX_JSON_BYTES = 100_000;   // limit on the unpacked text, so a tiny "zip bomb" link cannot eat memory
const MAX_ENCODED_CHARS = 40_000; // limit on the link data itself
const B64URL = /^[A-Za-z0-9_-]+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// A link must be a plain http(s) address with no spaces or control characters (it ends up in an href).
const LINK_RE = /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i;

// ---------- bytes <-> base64url ----------

function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- compression ----------

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Returns null if the unpacked data would be bigger than maxBytes.
async function inflate(bytes, maxBytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ---------- one subject <-> short keys ----------
// a=id n=name c=color d=day numbers (0=Mon..5=Sat) t=start m=minutes l=link i=meetingId p=passcode

function cleanLink(value) {
  let link = typeof value === "string" ? value.trim() : "";
  if (link && !/^[a-z][a-z0-9+.-]*:/i.test(link)) link = "https://" + link;
  return link.length <= 2000 && LINK_RE.test(link) ? link : "";
}

function pack(subject) {
  return {
    a: subject.id,
    n: String(subject.name ?? "").trim().slice(0, 100),
    c: subject.color,
    d: DAYS.map((day, index) => (subject.days?.includes(day) ? index : -1)).filter((index) => index >= 0),
    t: subject.start,
    m: subject.minutes,
    l: cleanLink(subject.link),
    i: subject.meetingId ?? "",
    p: String(subject.passcode ?? "").slice(0, 100),
  };
}

// Rebuilds a full subject from known keys only, or returns null if anything is wrong.
function unpack(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const { a, n, c, d, t, m, l, i, p } = item;
  if (typeof a !== "string" || !ID_RE.test(a)) return null;
  if (typeof n !== "string" || n.length > 100) return null;
  if (typeof c !== "string" || !COLOR_RE.test(c)) return null;
  if (!Array.isArray(d) || d.length > DAYS.length) return null;
  if (!d.every((k) => Number.isInteger(k) && k >= 0 && k < DAYS.length) || new Set(d).size !== d.length) return null;
  if (typeof t !== "string" || !Number.isInteger(m)) return null;
  if (typeof l !== "string" || l.length > 2000 || (l !== "" && !LINK_RE.test(l))) return null;
  if (typeof i !== "string" || typeof p !== "string" || p.length > 100) return null;

  const subject = {
    id: a, name: n, color: c,
    days: [...d].sort((x, y) => x - y).map((k) => DAYS[k]),
    start: t, minutes: m, link: l, meetingId: i, passcode: p,
  };
  return validateSubject(subject).errors.length === 0 ? subject : null;
}

// ---------- public API ----------

function pageUrl() {
  const href = globalThis.location?.href;
  return typeof href === "string" ? href.split("#")[0] : "";
}

// Returns "<page url>#s=<data>", or "" if the schedule cannot be shared
// (too many subjects, too big, or the browser has no CompressionStream).
export async function encodeShare(state) {
  try {
    const subjects = Array.isArray(state?.subjects) ? state.subjects : [];
    if (subjects.length > MAX_SUBJECTS || typeof CompressionStream === "undefined") return "";
    const json = JSON.stringify({ v: VERSION, s: subjects.map(pack) });
    const data = toBase64Url(await deflate(new TextEncoder().encode(json)));
    if (data.length > MAX_ENCODED_CHARS) return "";
    return `${pageUrl()}#s=${data}`;
  } catch {
    return "";
  }
}

// Accepts "#s=...", "s=..." or a whole link. Returns { subjects } or null. Never throws.
export async function decodeShare(hash) {
  try {
    const data = extractData(hash);
    if (!data || typeof DecompressionStream === "undefined") return null;
    const bytes = fromBase64Url(data);
    if (!bytes) return null;
    const unpacked = await inflate(bytes, MAX_JSON_BYTES);
    if (!unpacked) return null;
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(unpacked));
    if (!payload || payload.v !== VERSION || !Array.isArray(payload.s) || payload.s.length > MAX_SUBJECTS) return null;

    const subjects = [];
    const seen = new Set();
    for (const item of payload.s) {
      const subject = unpack(item);
      if (!subject || seen.has(subject.id)) return null;
      seen.add(subject.id);
      subjects.push(subject);
    }
    return { subjects };
  } catch {
    return null;
  }
}

function extractData(input) {
  if (typeof input !== "string" || input.length > MAX_ENCODED_CHARS + 2000) return null;
  const hashAt = input.indexOf("#");
  const rest = hashAt >= 0 ? input.slice(hashAt + 1) : input;
  for (const part of rest.split("&")) {
    if (part.startsWith("s=")) {
      const data = part.slice(2);
      return data.length <= MAX_ENCODED_CHARS && B64URL.test(data) ? data : null;
    }
  }
  return null;
}
