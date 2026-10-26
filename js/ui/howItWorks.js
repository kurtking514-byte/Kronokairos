// "How it works and limits" page (Phase 8). The limits follow Plan section 12.

const HOW = [
  "Add your classes. Tap Fill in with AI to import them from screenshots, or tap + Add subject to add one by hand. " +
    "Check each class before you save it.",
  "On the Today screen, tap Start alarms once each time you open this page. Phones block sound until you tap. " +
    "At class time (or 5 or 10 minutes early, as set in Settings) you get a sound and a Join button.",
  "In Settings, tap Add to my calendar to get weekly calendar events with alarms. " +
    "Your calendar app handles them, even when this page is closed.",
  "Tap Join to open your class. If Zoom asks for a passcode, tap Copy passcode first and paste it.",
];

const PRIVACY = [
  "Your schedule is saved only on this device. We don't store your links or passcodes.",
  "There is no account and no server. Screenshots go to your own AI app, not to this site.",
  "A share link contains the Zoom links and passcodes in your schedule. Only post it in private group chats.",
];

const LIMITS = [
  "This site cannot open Zoom by itself. The last step is always one tap on the alarm popup or the calendar notification.",
  "Adding events to your calendar needs your approval once. A website cannot add them silently.",
  "The page alarm only rings while this page is open and your device is awake. The calendar alarm is the backup that works when the page is closed.",
  "On Android, Google Calendar may ignore alarms in imported files. You may need a one-time setting: in Google Calendar, go to Settings and set a default notification at the start of the event.",
  "It cannot get you past a waiting room.",
  "AI import can misread screenshots, especially passcodes and meeting IDs. Always check every class on the review screen.",
  "Schedules do not update automatically for a whole section. That would need a server and stored data, which we left out on purpose for privacy. If a teacher changes a link, fix it in Links or share a new link.",
  "Joining with no tap at all only works with a program running on your own laptop. That is not part of this site.",
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title, items, ordered) {
  const box = el("section", "card how-card");
  const list = el(ordered ? "ol" : "ul", "how-list");
  for (const text of items) list.append(el("li", "", text));
  box.append(el("h3", "", title), list);
  return box;
}

export function render(container) {
  const root = el("div", "how");
  const heading = el("h2", "", "How it works and limits");
  heading.tabIndex = -1; // lets the app move focus here when the page opens
  root.append(
    heading,
    section("How it works", HOW, true),
    section("Your privacy", PRIVACY, false),
    section("What it can't do", LIMITS, false),
  );

  const back = el("button", "how-back", "Back to Today");
  back.type = "button";
  back.addEventListener("click", () => document.querySelector('.tab[data-screen="today"]')?.click());
  root.append(back);
  container.append(root);
}
