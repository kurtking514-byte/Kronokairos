// Schedule: Monday to Saturday timetable with coloured blocks sized by class length.

import { DAYS, findOverlaps, endTime, to12h, joinUrl } from "../model.js";
import { el, ensureStyles, openAddScreen, textOn } from "./shared.js";
import { openEditor } from "./subjectForm.js";

const PX_PER_HOUR = 56;
// Blocks are never drawn shorter than the 44px tap target (same value as .p1-block min-height in shared.js).
const MIN_BLOCK_PX = 44;
const MIN_VISUAL_MINUTES = Math.ceil((MIN_BLOCK_PX / PX_PER_HOUR) * 60);
// How long a block looks on screen, in minutes. Short classes take up more room than their real length.
const visualMinutes = (s) => Math.max(s.minutes, MIN_VISUAL_MINUTES);
const TIME_OK = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// Side-by-side lanes so classes that overlap in a day are still tappable.
// Lanes use the drawn length, so a short class that is padded to the tap size
// shares a row with a close neighbour instead of covering it.
function layout(items) {
  const sorted = [...items].sort((a, b) => mins(a.start) - mins(b.start));
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  let laneEnds = [];
  const close = () => { for (const p of cluster) p.lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const s of sorted) {
    const start = mins(s.start);
    if (start >= clusterEnd) { close(); clusterEnd = -1; }
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = start + visualMinutes(s);
    clusterEnd = Math.max(clusterEnd, start + visualMinutes(s));
    const p = { subject: s, lane, lanes: 1 };
    cluster.push(p);
    placed.push(p);
  }
  close();
  return placed;
}

export function render(container, state) {
  ensureStyles();
  const root = el("div", "p1");
  container.append(root);
  root.append(el("h2", "", "Schedule"));

  const subjects = state.subjects.filter((s) => TIME_OK.test(s.start) && Number.isInteger(s.minutes));
  if (subjects.length === 0) {
    const box = el("div", "p1-card");
    box.append(el("p", "", "Your timetable is empty. Add a class to see it here."));
    const add = el("button", "p1-btn primary", "Add a class");
    add.type = "button";
    add.addEventListener("click", openAddScreen);
    box.append(add);
    root.append(box);
    return;
  }

  root.append(el("p", "p1-muted", "Tap a class to edit it or join."));

  const overlaps = findOverlaps(subjects);
  const overlapping = new Set(overlaps.flatMap((o) => [o.a.id, o.b.id]));

  const startHour = Math.min(...subjects.map((s) => Math.floor(mins(s.start) / 60)));
  const endHour = Math.min(24, Math.max(...subjects.map((s) => Math.ceil((mins(s.start) + visualMinutes(s)) / 60))));
  const height = (endHour - startHour) * PX_PER_HOUR;

  const panel = el("div", "p1-card");
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  let selected = null;
  const blocks = [];

  function select(subject) {
    selected = subject.id;
    for (const b of blocks) b.setAttribute("aria-pressed", String(b.dataset.id === selected));
    const url = joinUrl(subject);
    panel.replaceChildren(
      el("h3", "p1-title", subject.name),
      el("p", "p1-muted", `${subject.days.join(", ")} · ${to12h(subject.start)} to ${to12h(endTime(subject))}`),
    );
    const row = el("div", "p1-row");
    if (url) {
      const join = el("a", "p1-btn primary", "Join");
      join.href = url;
      join.target = "_blank";
      join.rel = "noopener noreferrer";
      row.append(join);
    } else {
      row.append(el("span", "p1-muted", "No link yet."));
    }
    const edit = el("button", "p1-btn", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openEditor(subject.id));
    row.append(edit);
    panel.append(row);
    panel.hidden = false;
    panel.scrollIntoView?.({ block: "nearest" }); // on a phone the panel is below the grid
  }

  const wrap = el("div", "p1-sched");
  const grid = el("div", "p1-grid");
  grid.append(el("div", "p1-colhead", ""));
  for (const d of DAYS) grid.append(el("div", "p1-colhead", d));

  const axis = el("div", "p1-axis");
  axis.style.height = `${height}px`;
  for (let h = startHour; h < endHour; h++) {
    const label = el("span", "", to12h(`${String(h).padStart(2, "0")}:00`).replace(":00", ""));
    label.style.top = `${(h - startHour) * PX_PER_HOUR}px`;
    axis.append(label);
  }
  grid.append(axis);

  for (const day of DAYS) {
    const col = el("div", "p1-col");
    col.style.height = `${height}px`;
    for (let h = startHour; h < endHour; h++) {
      const line = el("div", "p1-hour");
      line.style.top = `${(h - startHour) * PX_PER_HOUR}px`;
      col.append(line);
    }
    for (const { subject, lane, lanes } of layout(subjects.filter((s) => s.days.includes(day)))) {
      const top = ((mins(subject.start) - startHour * 60) / 60) * PX_PER_HOUR;
      const length = visualMinutes(subject);
      const isOverlap = overlapping.has(subject.id);
      const block = el("button", "p1-block" + (isOverlap ? " overlap" : ""));
      block.type = "button";
      block.dataset.id = subject.id;
      block.setAttribute("aria-pressed", "false");
      block.setAttribute("aria-label",
        `${subject.name}, ${day}, ${to12h(subject.start)} to ${to12h(endTime(subject))}${isOverlap ? ", overlaps another class" : ""}`);
      block.style.cssText = `top:${top}px;height:${(length / 60) * PX_PER_HOUR}px;` +
        `left:${(lane / lanes) * 100}%;width:${100 / lanes}%;background:${subject.color};color:${textOn(subject.color)};`;
      const title = el("strong", "", (isOverlap ? "⚠ " : "") + subject.name);
      block.append(title, document.createTextNode(to12h(subject.start)));
      block.addEventListener("click", () => select(subject));
      blocks.push(block);
      col.append(block);
    }
    grid.append(col);
  }
  wrap.append(grid);
  root.append(wrap, panel);

  if (overlaps.length) {
    const box = el("div", "p1-msg");
    box.append(el("strong", "", "⚠ Some classes overlap"));
    const list = el("ul", "");
    for (const o of overlaps) list.append(el("li", "", `${o.a.name} and ${o.b.name} overlap on ${o.day}.`));
    box.append(list);
    root.append(box);
  }
}
