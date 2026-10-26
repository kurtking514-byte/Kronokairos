// Reads a pasted Zoom invite and pulls out the link, meeting ID and passcode.
// Returns null for anything it can't find. Never throws.

const NOT_FOUND = () => ({ link: null, meetingId: null, passcode: null });

// A Zoom meeting link: any zoom.us host, path /j/<digits>, optional query.
// The host check stops look-alikes such as evilzoom.us or zoom.us.evil.test.
const LINK_RE = /https?:\/\/(?:[a-z0-9-]+\.)*zoom\.us\/j\/(\d+)[^\s<>"')\]]*/gi;
const ID_LABEL_RE = /meeting\s*id\s*[:\uff1a]?\s*(\d[\d \t-]*)/i;
const PASSCODE_RE = /(?:pass\s*code|password)\s*[:\uff1a]\s*(\S+)/i;

function cleanText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "");
}

// Email apps sometimes break a long link over two lines. Glue the pieces back.
function joinWrappedLinks(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimEnd();
    while (i + 1 < lines.length && continuesLink(line, lines[i + 1])) {
      line += lines[i + 1].trim();
      i++;
    }
    out.push(line);
  }
  return out.join("\n");
}

function continuesLink(line, next) {
  if (!/https?:\/\/\S*$/i.test(line)) return false;
  const token = next.trim();
  if (!token || /\s/.test(token) || /^https?:/i.test(token)) return false;
  if (!/^[A-Za-z0-9._~:/?#@!$&*+,;=%-]+$/.test(token)) return false;
  const brokeAtSeparator = /[?&=]$/.test(line) || /^[?&=]/.test(token);
  // A very long line that is cut mid-token (usually at about 76 characters).
  const hardWrapped = line.length >= 70 && /\d/.test(token);
  return brokeAtSeparator || hardWrapped;
}

function stripTrailingPunctuation(url) {
  return url.replace(/[.,;:!?]+$/, "");
}

// "Join and take notes" links add mynotes=on. Remove it if it's the only link we have.
function removeNotesFlag(url) {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const params = url.slice(q + 1).split("&").filter((p) => !/^mynotes=on$/i.test(p));
  return url.slice(0, q) + (params.length ? "?" + params.join("&") : "");
}

function findLink(text) {
  let plain = null;
  let withNotes = null;
  for (const m of text.matchAll(LINK_RE)) {
    const url = stripTrailingPunctuation(m[0]);
    if (/\/launch\/jc\//i.test(url) || /\.ics\b/i.test(url)) continue;
    if (/mynotes=on/i.test(url)) {
      withNotes ??= { url: removeNotesFlag(url), id: m[1] };
    } else {
      plain = { url, id: m[1] };
      break; // first plain link wins
    }
  }
  return plain ?? withNotes;
}

const validId = (id) => /^\d{9,11}$/.test(id ?? "");

export function parseInvite(text) {
  try {
    if (typeof text !== "string") return NOT_FOUND();
    const clean = joinWrappedLinks(cleanText(text));

    const link = findLink(clean);

    // Meeting ID: the "Meeting ID" line first, then the link. Only 9 to 11 digits count.
    const labelMatch = clean.match(ID_LABEL_RE);
    const labelId = labelMatch ? labelMatch[1].replace(/\D/g, "") : null;
    let meetingId = null;
    if (validId(labelId)) meetingId = labelId;
    else if (validId(link?.id)) meetingId = link.id;

    // Passcode: kept exactly as written (upper and lower case matter).
    const codeMatch = clean.match(PASSCODE_RE);
    const passcode = codeMatch ? codeMatch[1] : null;

    return { link: link ? link.url : null, meetingId, passcode };
  } catch {
    return NOT_FOUND();
  }
}
