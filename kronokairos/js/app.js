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

const SCREENS = { today, schedule, links, settings, add: subjectForm, ai: reviewImport, how: howItWorks };

const main = document.getElementById("screen");
const tabs = document.querySelectorAll(".tab");
let state = loadState();
let current = "today";

// The current tab is kept in memory, not in the URL hash:
// the hash is reserved for share links (#s=...).
function show(name) {
  current = name;
  tabs.forEach((tab) => {
    if (tab.dataset.screen === name) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  main.replaceChildren();
  SCREENS[name].render(main, state);
}

for (const screen of Object.values(SCREENS)) screen.init?.();

tabs.forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.screen)));
document.getElementById("add-btn").addEventListener("click", () => show("add"));
document.getElementById("ai-btn").addEventListener("click", () => show("ai"));
// Phase 8: the "How it works and limits" link in the page footer.
document.getElementById("how-btn").addEventListener("click", () => {
  show("how");
  main.querySelector("h2")?.focus(); // tell keyboard and screen-reader users the page changed
});

onChange((next) => {
  state = next;
  show(current);
});

show(current);

// Phase 6B: if the page was opened from a share link (#s=...), show the import preview.
checkShareLink();

// Phase 8: first-run welcome (skipped when there are classes or a share link is open).
maybeShowWelcome(state);

// Phase 7: offline support and the install hint.
initPwa();
