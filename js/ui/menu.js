// Home menu: an animated clock, the date with the moon phase, and the game-style menu.
// The menu words are the tab buttons in index.html and the clock lives in #clock-home, so both
// stay on screen across pages: big on the menu, docked (menu left, clock top) on the other screens.
// This module builds the clock once, keeps it ticking, and runs the menu highlight and arrow keys.

import { to12h } from "../model.js";
import { motionReduced, getPageChange } from "../motion.js";

const NS = "http://www.w3.org/2000/svg";
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const C = 120; // centre of the 240x240 clock drawing
const pad = (n) => String(n).padStart(2, "0");

function svg(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// ---- moon phase (0 = new, 0.5 = full), from a known new moon and the average lunar month ----
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const LUNAR_MONTH = 29.530588853 * 86400000;
export function moonPhase(date) {
  const p = ((date - NEW_MOON) % LUNAR_MONTH) / LUNAR_MONTH;
  return p < 0 ? p + 1 : p;
}
export function moonName(p) {
  const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  return names[Math.round(p * 8) % 8];
}
// The lit part of a moon of radius r at (cx, cy): an outer half circle and the curved edge of the shadow.
export function moonPath(p, cx, cy, r) {
  const k = Math.cos(2 * Math.PI * p);
  const rx = Math.abs(k) * r;
  const waxing = p < 0.5;
  const outer = waxing ? 1 : 0;
  const inner = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${inner} ${cx} ${cy - r} Z`;
}

function polar(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function buildClock() {
  const box = document.createElement("div");
  box.className = "menu-clock";
  box.setAttribute("role", "img");
  const glow = document.createElement("div");
  glow.className = "clock-glow";
  const sweep = document.createElement("div");
  sweep.className = "clock-sweep";

  const root = svg("svg", { viewBox: "0 0 240 240", "aria-hidden": "true" });
  const defs = svg("defs");
  const face = svg("radialGradient", { id: "menu-clock-face", cx: "50%", cy: "40%", r: "60%" });
  face.append(svg("stop", { offset: "0%", class: "face-stop-in" }), svg("stop", { offset: "100%", class: "face-stop-out" }));
  defs.append(face);
  root.append(defs);

  // The turning rings each get their own <svg>, and that whole element turns. Turning shapes inside
  // one drawing made the browser redraw the whole clock face every frame, which made hovering the
  // menu laggy; a separate element is drawn once and just rotated by the graphics card.
  const ringLayer = (cls, ...parts) => {
    const layer = svg("svg", { viewBox: "0 0 240 240", class: `ring-layer ${cls}`, "aria-hidden": "true" });
    layer.append(...parts);
    return layer;
  };

  // Outer ring of words, turning slowly.
  const words = svg("g", { class: "ring ring-text" });
  const textPath = svg("path", { id: "menu-clock-text", d: `M ${C} ${C - 111} a 111 111 0 1 1 -0.01 0` });
  const text = svg("text", { class: "ring-words" });
  const tp = svg("textPath", { href: "#menu-clock-text", textLength: 690, lengthAdjust: "spacing" });
  tp.textContent = "KRONOKAIROS ✦ TIME WAITS FOR NO ONE ✦ KRONOKAIROS ✦ TIME WAITS FOR NO ONE ✦";
  text.append(tp);
  words.append(text);

  // Segmented ring turning the other way, with a bright segment chasing round it.
  const seg = svg("circle", { cx: C, cy: C, r: 100, class: "ring ring-seg" });
  const chase = svg("circle", { cx: C, cy: C, r: 100, class: "ring ring-chase" });
  const dots = svg("circle", { cx: C, cy: C, r: 93, class: "ring ring-dots" });
  const rings = [
    ringLayer("spin-text", svg("defs", {}), words),
    ringLayer("spin-seg", seg),
    ringLayer("spin-chase", chase),
    ringLayer("spin-dots", dots),
  ];
  rings[0].firstChild.append(textPath);
  root.append(svg("circle", { cx: C, cy: C, r: 88, class: "face", fill: "url(#menu-clock-face)" }));
  root.append(svg("circle", { cx: C, cy: C, r: 52, class: "face-line" }));

  // Minute ticks, slanted hour blocks, and four big numerals.
  const marks = svg("g", { class: "marks" });
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) continue;
    const [x1, y1] = polar(86, i * 6), [x2, y2] = polar(81, i * 6);
    marks.append(svg("line", { x1, y1, x2, y2, class: "tick" }));
  }
  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) continue;
    marks.append(svg("polygon", { points: `${C - 3},${C - 86} ${C + 4},${C - 86} ${C + 2},${C - 70} ${C - 5},${C - 70}`, class: "block", transform: `rotate(${i * 30} ${C} ${C})` }));
  }
  for (const [n, deg] of [["12", 0], ["3", 90], ["6", 180], ["9", 270]]) {
    const [x, y] = polar(68, deg);
    const t = svg("text", { x, y: y + 9, class: "num", "text-anchor": "middle" });
    t.textContent = n;
    marks.append(t);
  }
  root.append(marks);

  // Moon dial below the centre.
  const moon = svg("g", { class: "moon" });
  const moonLit = svg("path", { class: "moon-lit" });
  moon.append(svg("circle", { cx: C, cy: C + 30, r: 13, class: "moon-dark" }), moonLit, svg("circle", { cx: C, cy: C + 30, r: 13, class: "moon-rim" }));
  root.append(moon);

  // Hands: blades for hour and minute, a thin red second hand that ticks.
  const hand = (cls, ...parts) => {
    const g = svg("g", { class: `hand ${cls}` });
    g.append(...parts);
    root.append(g);
    return g;
  };
  const hour = hand("hour", svg("polygon", { points: `${C},${C + 14} ${C - 10},${C - 4} ${C},${C - 56} ${C + 10},${C - 4}` }));
  const minute = hand("minute", svg("polygon", { points: `${C},${C + 16} ${C - 5},${C} ${C},${C - 80} ${C + 5},${C}` }));
  const second = hand("second",
    svg("line", { x1: C, y1: C + 24, x2: C, y2: C - 84 }),
    svg("circle", { cx: C, cy: C + 20, r: 4.5 }),
  );
  root.append(svg("circle", { cx: C, cy: C, r: 7, class: "pin" }), svg("circle", { cx: C, cy: C, r: 2.5, class: "pin-dot" }));

  // Floats like a dropped item in a game: bobs up and down while turning, with a thick rim,
  // a back face, and a shadow on the "ground" that shrinks as it rises.
  const div = (cls) => Object.assign(document.createElement("div"), { className: cls });
  const shadow = div("clock-shadow");
  const bob = div("clock-bob");
  const spin = div("clock-spin");
  const rims = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => {
    const r = div("clock-rim");
    r.style.transform = `translateZ(${-i * 1.6}px)`;
    return r;
  });
  const back = div("clock-back");
  const logo = document.querySelector(".app-header .logo")?.cloneNode(true); // the KK logo on the back
  if (logo) back.append(logo);
  spin.append(...rims, back, sweep, ...rings, root);
  bob.append(spin);
  box.append(glow, shadow, bob);
  return { box, hour, minute, second, moonLit };
}

function buildBackdrop() {
  const bg = document.createElement("div");
  bg.className = "menu-bg";
  bg.setAttribute("aria-hidden", "true");
  for (const cls of ["band band-a", "band band-b", "band band-c", "streak s1", "streak s2", "streak s3", "streak s4", "edge", "edge-thin"]) {
    const d = document.createElement("div");
    d.className = cls;
    bg.append(d);
  }
  return bg;
}

// The menu screen itself only adds the moving backdrop; the clock and words are always there.
export function render(container) {
  container.append(buildBackdrop());
}

function startClock(host) {
  const clock = buildClock();
  const stamp = document.createElement("div");
  stamp.className = "menu-stamp";
  const date = document.createElement("p");
  date.className = "menu-date";
  const side = document.createElement("div");
  side.className = "menu-stamp-side";
  const day = document.createElement("p");
  day.className = "menu-day";
  const time = document.createElement("p");
  time.className = "menu-time";
  const moon = document.createElement("p");
  moon.className = "menu-moon";
  side.append(day, time);
  stamp.append(date, side, moon);
  host.append(clock.box, stamp);

  // Angles only ever grow, so the hands never spin backwards past 12.
  let lastMinute = -1, lastS = -1, laps = 0;
  function tick() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    if (lastS >= 0 && s < lastS) laps++;
    lastS = s;
    clock.hour.style.transform = `rotate(${(h % 12) * 30 + m / 2}deg)`;
    clock.minute.style.transform = `rotate(${m * 6 + s / 10}deg)`;
    clock.second.style.transform = `rotate(${(laps * 60 + s) * 6}deg)`;
    if (m !== lastMinute) {
      lastMinute = m;
      const label = to12h(`${pad(h)}:${pad(m)}`);
      const phase = moonPhase(now);
      date.textContent = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
      day.textContent = DAYS[now.getDay()];
      time.textContent = label;
      moon.textContent = moonName(phase);
      clock.moonLit.setAttribute("d", moonPath(phase, C, C + 30, 13));
      clock.box.setAttribute("aria-label", `Clock showing ${label}, ${moonName(phase).toLowerCase()}`);
    }
  }
  tick();
  requestAnimationFrame(() => clock.box.classList.add("is-ticking")); // hands animate only after the first draw
  setInterval(tick, 1000);
}

// ---- the menu words ----
function tabs() {
  return [...document.querySelectorAll(".tab")];
}
function onMenu() {
  return document.body.dataset.screen === "menu";
}
// One item is "active": white triangle, red letters. It follows the pointer and keyboard focus,
// and falls back to the current (or last opened) screen.
export function setActive(tab) {
  if (!tab) return;
  for (const t of tabs()) t.classList.toggle("is-active", t === tab);
}

// Page change between inner pages, like the game's sub-menus: the old page sinks into a flat dark
// blue and a wobbly blob grows out of the pressed button with the new page already inside it.
// The browser keeps a picture of the old page while the new one is drawn (View Transitions);
// styles.css gives the new page the blob mask. Without support, or with less motion, it just switches.
export function reveal(swap, from) {
  if (motionReduced() || getPageChange() === "slide" || !document.startViewTransition) return swap();
  const box = from?.isConnected ? from.getBoundingClientRect() : null;
  const x = box ? box.left + box.width / 2 : innerWidth / 2;
  const y = box ? box.top + box.height / 2 : innerHeight / 2;
  // The blob's edge dips to about 44% of its width, so make it big enough to pass the farthest corner.
  const size = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) / 0.44;
  const move = document.startViewTransition(swap);
  move.ready.then(() => {
    const root = document.documentElement;
    root.animate(
      { maskSize: ["0px 0px", `${size}px ${size}px`], maskPosition: [`${x}px ${y}px`, `${x - size / 2}px ${y - size / 2}px`] },
      { duration: 650, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "both", pseudoElement: "::view-transition-new(root)" },
    );
    root.animate(
      { filter: ["none", "grayscale(1) brightness(1.5)"], opacity: [1, 0.3] }, // fades into the blue backdrop
      { duration: 280, easing: "ease-out", fill: "both", pseudoElement: "::view-transition-old(root)" },
    );
  }).catch(() => {}); // skipped (another tap came first): the page has still switched
}

// Where the cursor was before the current move (updated first, in the capture phase).
const pointerWas = { x: NaN, y: NaN };
let pointerNow = { x: NaN, y: NaN };

export function init() {
  document.addEventListener("pointermove", (e) => {
    pointerWas.x = pointerNow.x;
    pointerWas.y = pointerNow.y;
    pointerNow = { x: e.clientX, y: e.clientY };
  }, { capture: true, passive: true });
  startClock(document.getElementById("clock-home"));
  for (const tab of tabs()) {
    // Only a real mouse move picks a word: when the words glide under a still cursor (app.js), the
    // browser reports a hover too, which used to light up whichever word landed under it. A real
    // move changes the cursor's position (the browser's own movement numbers read 0 on the first
    // event over a word, which made the highlight lag).
    tab.addEventListener("pointermove", (e) => {
      if ((e.clientX !== pointerWas.x || e.clientY !== pointerWas.y) && !document.body.classList.contains("is-gliding")) setActive(tab);
    });
    tab.addEventListener("focus", () => setActive(tab));
  }
  document.querySelector(".tabs")?.addEventListener("pointerleave", () => {
    if (!document.activeElement?.classList.contains("tab")) setActive(document.querySelector(".tab.is-last"));
  });

  // Up/Down (or W/S) move through the menu, like a game menu. Enter and Space press the button as usual.
  document.addEventListener("keydown", (e) => {
    if (!onMenu() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector("dialog[open]")) return;
    const k = e.key.toLowerCase();
    const step = e.key === "ArrowDown" || k === "s" ? 1 : e.key === "ArrowUp" || k === "w" ? -1 : 0;
    if (!step) return;
    if (e.target.closest?.("input, textarea, select")) return;
    e.preventDefault();
    const list = tabs();
    const from = list.indexOf(document.querySelector(".tab.is-active"));
    const next = list[(from + step + list.length) % list.length];
    setActive(next);
    next.focus();
  });
}
