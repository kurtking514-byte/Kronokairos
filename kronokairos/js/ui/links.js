// Links: every subject's link, meeting ID and passcode in one place, with join and copy buttons.

import { joinUrl, to12h } from "../model.js";
import { el, ensureStyles, copyText, openAddScreen } from "./shared.js";
import { openEditor } from "./subjectForm.js";

function prettyId(id) {
  // 9 digits: 3-3-3, 10 digits: 3-3-4, 11 digits: 3-4-4 (how Zoom shows them)
  const cut = id.length === 11 ? [3, 7] : [3, 6];
  return /^\d{9,11}$/.test(id) ? `${id.slice(0, cut[0])} ${id.slice(cut[0], cut[1])} ${id.slice(cut[1])}` : id;
}

// The meeting number inside an invite link, if there is one.
function idInLink(link) {
  return /\/j\/(\d+)/.exec(link ?? "")?.[1] ?? null;
}

function card(subject) {
  const box = el("div", "p1-card");
  const title = el("h3", "p1-title");
  const dot = el("span", "p1-dot");
  dot.style.background = subject.color;
  title.append(dot, subject.name || "Untitled class");
  box.append(title, el("p", "p1-muted", `${subject.days.join(", ")} · ${to12h(subject.start)}`));

  const url = joinUrl(subject);
  box.append(el("p", "", url ? `Link: ${subject.link || url}` : "No link or meeting ID yet."));
  if (subject.link) box.lastChild.style.overflowWrap = "anywhere";
  if (subject.meetingId) box.append(el("p", "", `Meeting ID: ${prettyId(subject.meetingId)}`));
  if (subject.passcode) {
    const p = el("p", "");
    p.append("Passcode: ", el("strong", "p1-mono p1-pass", subject.passcode));
    box.append(p, el("p", "p1-muted", "Compare with the original post. Letters like l, I, 0 and O are easy to mix up."));
  }
  const inLink = idInLink(subject.link);
  if (inLink && subject.meetingId && inLink !== subject.meetingId) {
    box.append(el("p", "p1-msg", "⚠ The meeting ID inside the link is different from the Meeting ID above. Check both."));
  }

  const status = el("p", "p1-muted");
  status.setAttribute("role", "status");
  const say = (text) => { status.textContent = text; };

  const row = el("div", "p1-row");
  const button = (label, onClick, disabled) => {
    const b = el("button", "p1-btn", label);
    b.type = "button";
    b.setAttribute("aria-label", `${label} for ${subject.name || "this class"}`); // several cards share these labels
    b.disabled = !!disabled;
    b.addEventListener("click", onClick);
    return b;
  };

  if (url) {
    const join = el("a", "p1-btn primary", "Join");
    join.href = url;
    join.target = "_blank";
    join.rel = "noopener noreferrer";
    join.setAttribute("aria-label", `Join ${subject.name || "this class"}`);
    row.append(join);
  }
  row.append(
    button("Copy passcode", async () => say((await copyText(subject.passcode)) ? "Passcode copied." : "Could not copy."), !subject.passcode),
    button("Copy link", async () => say((await copyText(url)) ? "Link copied." : "Could not copy."), !url),
    // Test join: copies the passcode (if any) and opens the link, so you can check it works before class.
    button("Test join", () => {
      if (subject.passcode) copyText(subject.passcode);
      window.open(url, "_blank", "noopener,noreferrer");
      say(subject.passcode ? "Opened the link. Passcode copied in case Zoom asks." : "Opened the link.");
    }, !url),
    button("Edit", () => openEditor(subject.id)),
  );
  box.append(row, status);
  return box;
}

export function render(container, state) {
  ensureStyles();
  const root = el("div", "p1");
  container.append(root);
  root.append(el("h2", "", "Links"));

  if (state.subjects.length === 0) {
    const box = el("div", "p1-card");
    box.append(el("p", "", "No classes yet. Add one and its link will show up here."));
    const add = el("button", "p1-btn primary", "Add a class");
    add.type = "button";
    add.addEventListener("click", openAddScreen);
    box.append(add);
    root.append(box);
    return;
  }
  root.append(el("p", "p1-muted", "If a teacher changes a link, fix it here with Edit."));
  for (const subject of state.subjects) root.append(card(subject));
}
