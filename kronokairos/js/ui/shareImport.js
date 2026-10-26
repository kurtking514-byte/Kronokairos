// Share button + import preview (Phase 6B).
// - renderShareSection(): the "Share my schedule" box shown in Settings.
// - checkShareLink(): called on page load. If the address has #s=..., shows a preview
//   and lets the student Replace, Add, or Cancel. Nothing is saved before they choose.
// Only subjects are ever shared. Settings are never put in a link (share.js enforces this).
// Everything from a link is shown with textContent only, never as HTML.

import { encodeShare, decodeShare } from "../share.js";
import { loadState, saveState } from "../storage.js";
import { newSubject, to12h, endTime, findOverlaps } from "../model.js";

const PRIVACY_WARNING =
  "This link contains the Zoom links and passcodes in your schedule. Only post it in private group chats.";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className) {
  const btn = el("button", className, label);
  btn.type = "button";
  return btn;
}

function classCount(n) {
  return `${n} ${n === 1 ? "class" : "classes"}`;
}

// ===================== Share button (Settings) =====================

export function renderShareSection(container, state) {
  ensureStyles();
  const section = el("section", "share-section");
  section.setAttribute("aria-labelledby", "share-heading");
  const heading = el("h3", "", "Share with a classmate");
  heading.id = "share-heading";
  section.append(
    heading,
    el("p", "share-muted", "Make a link your classmate can open to preview and import your classes. " +
      "The link is made on this device and is not stored anywhere."),
  );

  const area = el("div", "");
  const start = button("Share my schedule", "share-primary");
  if (state.subjects.length === 0) {
    start.disabled = true;
    area.append(start, el("p", "share-muted", "Add a class first, then you can share your schedule."));
  } else {
    start.addEventListener("click", () => askConfirm(area, state, start));
    area.append(start);
  }
  section.append(area);
  container.append(section);
}

// Step 1: the privacy warning. No link exists yet.
function askConfirm(area, state, start) {
  const warning = el("p", "share-warning", PRIVACY_WARNING);
  warning.setAttribute("role", "alert");
  const confirm = button("Create link", "share-primary");
  const cancel = button("Cancel", "share-secondary");
  cancel.addEventListener("click", () => area.replaceChildren(start));
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    cancel.disabled = true;
    confirm.textContent = "Making link\u2026";
    const link = await encodeShare(state);
    if (link) showLink(area, link, start);
    else showTooBig(area, start);
  });
  const row = el("div", "share-row");
  row.append(confirm, cancel);
  area.replaceChildren(warning, row);
}

function showTooBig(area, start) {
  const msg = el("p", "", "Your schedule couldn't be turned into a link. It may be too big, " +
    "or this browser can't make share links.");
  msg.setAttribute("role", "alert");
  const back = button("OK", "share-secondary");
  back.addEventListener("click", () => area.replaceChildren(start));
  area.replaceChildren(msg, back);
}

// Step 2: the link, with Copy and (on phones) the share sheet.
function showLink(area, link, start) {
  const label = el("label", "", "Your share link");
  label.htmlFor = "share-link-box";
  const box = document.createElement("input");
  box.type = "text";
  box.id = "share-link-box";
  box.className = "share-link";
  box.readOnly = true;
  box.value = link;
  box.addEventListener("focus", () => box.select());

  const status = el("p", "share-muted", "Only post it in private group chats.");
  status.setAttribute("role", "status");

  const copy = button("Copy", "share-primary");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = "Link copied. Only post it in private group chats.";
    } catch {
      box.focus();
      box.select();
      status.textContent = "Couldn't copy automatically. The link is selected. Copy it by hand.";
    }
  });

  const row = el("div", "share-row");
  row.append(copy);

  if (typeof navigator.share === "function") {
    const share = button("Share\u2026", "share-secondary");
    share.addEventListener("click", async () => {
      try {
        await navigator.share({ title: "My class schedule", url: link });
      } catch {
        // The student closed the share sheet. Nothing to do.
      }
    });
    row.append(share);
  }

  const done = button("Done", "share-secondary");
  done.addEventListener("click", () => area.replaceChildren(start)); // also clears the link from the screen
  row.append(done);

  area.replaceChildren(label, box, row, status);
}

// ===================== Import preview (on page load) =====================

let dialogOpen = false;
let listening = false;

// Call once on load. Also reacts if a share link is pasted into an already-open tab.
export async function checkShareLink() {
  if (!listening) {
    listening = true;
    window.addEventListener("hashchange", () => checkShareLink());
  }
  if (dialogOpen || !location.hash.startsWith("#s=")) return;
  dialogOpen = true; // set before the await so a second call cannot open another dialog

  const result = await decodeShare(location.hash);
  const dlg = openDialog();
  if (!result) {
    showMessage(dlg, "This link couldn't be read",
      "It may be cut off or changed. Ask your classmate to send the link again.");
  } else if (result.subjects.length === 0) {
    showMessage(dlg, "Nothing to import", "This link doesn't have any classes in it.");
  } else {
    showPreview(dlg, result.subjects);
  }
}

// One close path for every outcome: cancel, Esc, done, error. It always removes the hash.
function openDialog() {
  ensureStyles();
  const dlg = document.createElement("dialog");
  dlg.className = "share-dialog";
  dlg.setAttribute("aria-labelledby", "share-dlg-title");
  dlg.addEventListener("close", () => {
    dlg.remove();
    dialogOpen = false;
    clearHash();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function clearHash() {
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    // Some browsers block this in odd contexts. The app still works.
  }
}

function setContent(dlg, title, ...nodes) {
  const h = el("h2", "", title);
  h.id = "share-dlg-title";
  h.tabIndex = -1;
  dlg.replaceChildren(h, ...nodes);
  h.focus();
}

function showMessage(dlg, title, text) {
  const p = el("p", "", text);
  const ok = button("OK", "share-primary");
  ok.addEventListener("click", () => dlg.close());
  setContent(dlg, title, p, ok);
}

function showPreview(dlg, incoming) {
  const current = loadState();
  const hasCurrent = current.subjects.length > 0;

  const intro = el("p", "", `${classCount(incoming.length)} in this link. ` +
    "Nothing is saved until you choose below.");
  const list = el("ul", "share-list");
  for (const subject of incoming) list.append(subjectItem(subject));

  const actions = el("div", "share-actions");
  if (hasCurrent) {
    const replace = button("Replace my schedule", "share-primary");
    replace.addEventListener("click", () => doImport(dlg, incoming, "replace"));
    const add = button("Add to mine", "share-secondary");
    add.addEventListener("click", () => doImport(dlg, incoming, "add"));
    actions.append(replace, add,
      el("p", "share-muted", `Replace removes your current ${classCount(current.subjects.length)}. ` +
        "Add keeps them."));
  } else {
    const importBtn = button("Import", "share-primary");
    importBtn.addEventListener("click", () => doImport(dlg, incoming, "replace"));
    actions.append(importBtn);
  }
  const cancel = button("Cancel", "share-secondary");
  cancel.addEventListener("click", () => dlg.close());
  actions.append(cancel);

  setContent(dlg, "Import this schedule?", intro, list, actions);
}

// One class: name, days, time, length. Link, meeting ID and passcode stay hidden until Show.
function subjectItem(subject) {
  const item = el("li", "share-item");
  const head = el("div", "share-item-head");
  const swatch = el("span", "share-swatch");
  swatch.style.background = subject.color;
  swatch.setAttribute("aria-hidden", "true");
  head.append(swatch, el("strong", "", subject.name || "(no name)"));

  const when = `${to12h(subject.start)} \u2013 ${to12h(endTime(subject))}, ${subject.minutes} min`;
  item.append(head,
    el("p", "share-line", subject.days.join(", ")),
    el("p", "share-line", when));

  const rows = [
    ["Link", subject.link],
    ["Meeting ID", subject.meetingId],
    ["Passcode", subject.passcode],
  ].filter(([, value]) => value);

  if (rows.length > 0) {
    const secret = el("div", "share-secret");
    secret.hidden = true;
    for (const [name, value] of rows) secret.append(el("p", "share-line", `${name}: ${value}`));
    const toggle = button("Show", "share-secondary share-small");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", `Show link and passcode for ${subject.name}`);
    toggle.addEventListener("click", () => {
      const open = secret.hidden;
      secret.hidden = !open;
      toggle.textContent = open ? "Hide" : "Show";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", `${open ? "Hide" : "Show"} link and passcode for ${subject.name}`);
    });
    item.append(toggle, secret);
  }
  return item;
}

function freshId(used) {
  let id = newSubject({}).id;
  while (used.has(id)) id = newSubject({}).id;
  return id;
}

// Replace swaps the subjects only; the student's settings are kept as they are.
function doImport(dlg, incoming, mode) {
  const current = loadState(); // read again, in case something changed while the preview was open
  let subjects;
  if (mode === "replace") {
    subjects = incoming;
  } else {
    const used = new Set(current.subjects.map((s) => s.id));
    const added = incoming.map((s) => {
      const id = used.has(s.id) ? freshId(used) : s.id;
      used.add(id);
      return { ...s, id };
    });
    subjects = [...current.subjects, ...added];
  }
  saveState({ ...current, subjects });

  const verb = mode === "replace" ? "Imported" : "Added";
  const message = el("p", "", `${verb} ${classCount(incoming.length)}.`);
  message.setAttribute("role", "status");
  const nodes = [message];
  if (mode === "add" && findOverlaps(subjects).length > findOverlaps(current.subjects).length) {
    nodes.push(el("p", "share-muted", "Some of these classes overlap with yours. Check them in Schedule."));
  }
  const done = button("Done", "share-primary");
  done.addEventListener("click", () => dlg.close());
  setContent(dlg, "Done", ...nodes, done);
  done.focus();
}

// ===================== Styles =====================

function ensureStyles() {
  if (document.getElementById("share-styles")) return;
  const style = document.createElement("style");
  style.id = "share-styles";
  style.textContent = `
    .share-section { margin-top: calc(var(--space, 16px) * 1.5); padding: var(--space, 16px);
      background: var(--surface, transparent); border-radius: var(--radius, 12px); }
    .share-section h3 { margin: 0 0 8px; }
    .share-section p { margin: 0 0 8px; }
    .share-muted { color: var(--muted, #555); }
    .share-warning { font-weight: 600; }
    .share-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
    .share-primary, .share-secondary { min-height: 44px; padding: 0 16px; font: inherit; cursor: pointer;
      border: 2px solid var(--primary, #2563eb); border-radius: var(--radius, 12px); }
    .share-primary { background: var(--primary, #2563eb); color: var(--bg, #fff); font-weight: 600; }
    .share-secondary { background: transparent; color: var(--text, inherit); }
    .share-small { margin-top: 8px; }
    .share-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .share-section button:focus-visible, .share-dialog button:focus-visible,
    .share-link:focus-visible, .share-dialog h2:focus-visible { outline: 3px solid var(--text, #000); outline-offset: 2px; }
    .share-section label { display: block; margin-top: 8px; font-weight: 600; }
    .share-link { box-sizing: border-box; width: 100%; min-height: 44px; margin-top: 4px; padding: 0 8px; font: inherit; }

    .share-dialog { box-sizing: border-box; width: min(92vw, 560px); max-height: 85vh; overflow-y: auto;
      padding: var(--space, 16px); color: var(--text, inherit); background: var(--bg, Canvas);
      border: 2px solid var(--primary, #2563eb); border-radius: var(--radius, 12px); }
    .share-dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
    .share-dialog h2 { margin: 0 0 8px; }
    .share-dialog h2:focus { outline: none; }
    .share-dialog p { margin: 0 0 8px; }
    .share-list { list-style: none; margin: 12px 0; padding: 0; display: grid; gap: 8px; }
    .share-item { padding: 12px; background: var(--surface, transparent); border-radius: var(--radius, 12px);
      border: 1px solid var(--muted, #888); overflow-wrap: anywhere; }
    .share-item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .share-swatch { flex: none; width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--text, #000); }
    .share-line { margin: 0 0 4px; }
    .share-secret { margin-top: 8px; }
    .share-actions { display: grid; gap: 8px; margin-top: 12px; }
    .share-actions p { margin: 0; }
  `;
  document.head.append(style);
}
