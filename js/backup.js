// Keeping the schedule safe. It lives only in this browser's storage, which the browser may clear
// (Safari wipes sites unused for 7 days, and "clear browsing data" wipes everything). So:
// ask the browser to keep it (persist), and let the student save a backup file and restore it.

import { parseState } from "./storage.js";

const BACKUP_KEY = "kronokairos.backupAt"; // when the last backup file was saved (ms)
const REMIND_DAYS = 30;

export function lastBackupAt() {
  try {
    const n = Number(globalThis.localStorage?.getItem(BACKUP_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function markBackedUp(now = Date.now()) {
  try {
    globalThis.localStorage?.setItem(BACKUP_KEY, String(now));
  } catch {
    // Storage blocked: the reminder may show again.
  }
}

// Ask the browser not to clear our data. Chrome decides quietly, Firefox may ask once.
// Resolves true if the data is (now) kept.
export async function keepStorage() {
  try {
    const s = globalThis.navigator?.storage;
    if (!s?.persist) return false;
    if (await s.persisted()) return true;
    return await s.persist();
  } catch {
    return false;
  }
}

export async function storageKept() {
  try {
    return (await globalThis.navigator?.storage?.persisted?.()) === true;
  } catch {
    return false;
  }
}

// The Today reminder: there are classes, the browser may clear them, and no backup for a month.
export function backupDue(state, kept, last = lastBackupAt(), now = Date.now()) {
  if (kept || !(state?.subjects?.length > 0)) return false;
  return last === null || now - last > REMIND_DAYS * 86400000;
}

const pad = (n) => String(n).padStart(2, "0");

export function backupName(now = new Date()) {
  return `kronokairos-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export function downloadBackup(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = backupName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackedUp();
}

// Reads a backup file. Resolves to a clean state, or null if it isn't a Kronokairos backup.
export async function readBackup(file) {
  try {
    if (!file || file.size > 2_000_000) return null; // a real backup is a few KB
    return parseState(await file.text());
  } catch {
    return null;
  }
}
