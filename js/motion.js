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
// Slide is the default: the blob is heavy on phones (a picture of the whole page, masked) and made
// the owner dizzy. Anyone who picked the blob in Settings keeps it.
const PAGE_KEY = "kronokairos.pageChange";

export function getPageChange() {
  try {
    return localStorage.getItem(PAGE_KEY) === "circles" ? "circles" : "slide";
  } catch {
    return "slide";
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
