import { loadState, onChange } from "./storage.js";
import * as today from "./ui/today.js";
import * as schedule from "./ui/schedule.js";
import * as links from "./ui/links.js";
import * as settings from "./ui/settings.js";
import * as subjectForm from "./ui/subjectForm.js";
import * as reviewImport from "./ui/reviewImport.js";
import { checkShareLink } from "./ui/shareImport.js"; // Phase 6B
import { initPwa } from "./pwa.js"; // Phase 7
import * as howItWorks from "./ui/howItWorks.js"; // Phase 8
import { maybeShowWelcome } from "./ui/welcome.js"; // Phase 8
import { resumeAlarms } from "./ui/alarmPopup.js";
import { keepStorage } from "./backup.js";
import * as menu from "./ui/menu.js";
import { applyMotion, motionReduced, getPageChange } from "./motion.js";

applyMotion(); // the Settings choice for animations

const SCREENS = { menu, today, schedule, links, settings, add: subjectForm, ai: reviewImport, how: howItWorks };

const main = document.getElementById("screen");
const tabs = document.querySelectorAll(".tab");
let state = loadState();
let current = "menu"; // the app opens on the menu
let lastTab = "today"; // highlighted on the menu, like the last-picked item in a game menu

// The current tab is kept in memory, not in the URL hash:
// the hash is reserved for share links (#s=...).
function show(name) {
  current = name;
  document.body.dataset.screen = name; // CSS lays out the menu and hides chrome per screen
  // "home": big clock and menu. "dock": menu on the left, clock on top, content beside. "form": just the form.
  document.body.dataset.layout = name === "menu" ? "home" : name === "add" ? "form" : "dock";
  if ([...tabs].some((tab) => tab.dataset.screen === name)) lastTab = name;
  tabs.forEach((tab) => {
    if (tab.dataset.screen === name) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
    tab.classList.toggle("is-last", tab.dataset.screen === lastTab);
  });
  menu.setActive(document.querySelector(".tab.is-last"));
  main.replaceChildren();
  SCREENS[name].render(main, state);
}

// Moving between screens: the menu words, clock, logo and name glide from where they were to their
// new places while the content slides in. Between two inner pages the menu stays put and the page
// changes its own way: a blob grows out of the pressed button with the new page inside (menu.reveal),
// or with Simple slide the old page snaps out and the new one is dealt in (deal).
const gliders = () => [
  document.querySelector("#clock-home .menu-clock"),
  document.querySelector(".app-header .logo"),
  document.querySelector(".app-header .brand-name"),
  ...tabs,
];

let glideEnd = 0;
function glide(els, before) {
  if (motionReduced()) return;
  const moves = [];
  els.forEach((node, i) => {
    const a = before[i];
    const b = node?.getBoundingClientRect();
    if (!a?.width || !b?.width) return; // hidden before or after: nothing to glide from
    const dx = a.left - b.left, dy = a.top - b.top, s = a.width / b.width;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) return;
    moves.push([node, dx, dy, s]);
  });
  if (!moves.length) return; // page to page: the menu stays put
  document.body.classList.add("is-gliding"); // styles.css: nothing clips the words mid-glide
  clearTimeout(glideEnd);
  glideEnd = setTimeout(() => document.body.classList.remove("is-gliding"), 820);
  for (const [node, dx, dy, s] of moves) {
    node.animate(
      [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transformOrigin: "0 0", transform: "none" }],
      { duration: 800, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }
}

// Page to page has its own entrance: the new page's pieces are dealt in one at a time from
// alternating sides (styles.css "deal-in"), instead of the whole page sliding in like from home.
function deal() {
  const pieces = [...main.children].flatMap((node) => (node.classList.contains("p1") ? [...node.children] : [node]));
  pieces.forEach((node, i) => {
    node.style.setProperty("--deal-i", i);
    node.style.setProperty("--deal-x", i % 2 ? "-44px" : "44px");
  });
}

// Once the entrance has played, drop "screen-in": a screen that redraws itself in place (the class
// form's − and + buttons, for one) would otherwise replay the entrance on every tap.
let entrance = 0;
function settleEntrance() {
  const mine = ++entrance;
  const finite = main.getAnimations({ subtree: true })
    .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
  Promise.all(finite.map((a) => a.finished.catch(() => {}))).then(() => {
    if (mine === entrance) main.classList.remove("screen-in");
  });
}

let leaving = false;
function go(name, from, after) {
  if (name === current) return after?.(); // already here: no transition
  if (leaving) return;
  const between = current !== "menu" && name !== "menu";
  const swap = () => {
    const els = gliders();
    const before = els.map((node) => node?.getBoundingClientRect());
    show(name);
    main.classList.remove("screen-in");
    main.dataset.enter = between ? "switch" : "enter";
    if (between) deal();
    void main.offsetWidth; // restart the entrance
    main.classList.add("screen-in");
    settleEntrance();
    glide(els, before);
    after?.();
  };
  if (!between) return swap();
  if (getPageChange() === "circles") return menu.reveal(swap, from); // the blob (or a plain switch)
  if (motionReduced()) return swap();
  // Simple slide: the old page snaps out to the left first, then the new one is dealt in.
  leaving = true;
  const out = main.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-36px) skewX(-8deg)" }],
    { duration: 90, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
  );
  out.finished.then(() => {
    leaving = false;
    swap();
    out.cancel();
  });
}

for (const screen of Object.values(SCREENS)) screen.init?.();

tabs.forEach((tab) => tab.addEventListener("click", () => go(tab.dataset.screen, tab)));
// Other screens ask for a page with openScreen() in shared.js (Add a class, Fill in with AI, Edit).
document.addEventListener("kk:go", (e) => go(e.detail.name, e.detail.from));
const menuBtn = document.getElementById("menu-btn");
menuBtn.addEventListener("click", () => go("menu", menuBtn, () => {
  document.querySelector(".tab.is-last")?.focus();
}));
// Phase 8: the "How it works and limits" link in the page footer.
document.getElementById("how-btn").addEventListener("click", () => {
  show("how");
  main.querySelector("h2")?.focus(); // tell keyboard and screen-reader users the page changed
});

// A save redraws the current screen in place: no entrance animation (it made Settings flicker on
// every tap), same scroll position, and focus goes back to the matching button.
// Once there are classes worth keeping, ask the browser not to clear them (js/backup.js).
let askedToKeep = false;
const askToKeep = () => {
  if (askedToKeep || state.subjects.length === 0) return;
  askedToKeep = true;
  keepStorage();
};

onChange((next) => {
  state = next;
  askToKeep();
  const focused = document.activeElement;
  const group = focused?.closest?.("[aria-label]")?.getAttribute("aria-label");
  const label = focused?.textContent;
  const y = scrollY;
  main.classList.remove("screen-in");
  show(current);
  scrollTo(0, y);
  if (focused && !focused.isConnected && group) {
    const same = [...main.querySelectorAll("button")].find((b) => b.textContent === label && b.closest("[aria-label]")?.getAttribute("aria-label") === group);
    same?.focus({ preventScroll: true });
  }
});

// Alarms the student left on come back on by themselves (alarmPopup.js).
resumeAlarms();

show(current);

askToKeep();

// Phase 6B: if the page was opened from a share link (#s=...), show the import preview.
checkShareLink();

// Phase 8: first-run welcome (skipped when there are classes or a share link is open).
maybeShowWelcome(state);

// Phase 7: offline support and the install hint.
initPwa();
