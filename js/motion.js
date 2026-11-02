// Animation preference: "device" follows the system's reduce-motion setting, "full" always animates.
// Kept apart from the schedule data, in its own small localStorage key. CSS reads <html data-motion>.

const KEY = "kronokairos.motion";

export function getMotion() {
  try {
    return localStorage.getItem(KEY) === "full" ? "full" : "device";
  } catch {
    return "device";
  }
}

export function setMotion(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // storage blocked: the choice still applies until the page closes
  }
  applyMotion(value);
}

export function applyMotion(value = getMotion()) {
  document.documentElement.dataset.motion = value;
}

// Page changes between screens: "circles" (the wobbly cover) or "slide" (no cover, just the glide).
const PAGE_KEY = "kronokairos.pageChange";

export function getPageChange() {
  try {
    return localStorage.getItem(PAGE_KEY) === "slide" ? "slide" : "circles";
  } catch {
    return "circles";
  }
}

export function setPageChange(value) {
  try {
    localStorage.setItem(PAGE_KEY, value);
  } catch {
    // storage blocked: the choice still applies until the page closes
  }
}

export function motionReduced() {
  return getMotion() !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
