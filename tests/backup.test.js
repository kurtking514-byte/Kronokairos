import assert from "node:assert/strict";
import { parseState } from "../js/storage.js";
import { backupDue, backupName, readBackup } from "../js/backup.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const good = { id: "a1", name: "Math", color: "#3b82f6", days: ["Mon"], start: "07:30", minutes: 80, link: "", meetingId: "", passcode: "" };
const withClass = { version: 1, settings: {}, subjects: [good] };
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 2);

t("a saved backup reads back as the same classes", () => {
  const back = parseState(JSON.stringify(withClass, null, 2));
  assert.equal(back.subjects.length, 1);
  assert.equal(back.subjects[0].name, "Math");
});
t("a file that isn't a backup is refused", () => {
  assert.equal(parseState("not json"), null);
  assert.equal(parseState(JSON.stringify({ hello: 1 })), null);
  assert.equal(parseState(JSON.stringify({ version: 2, subjects: [] })), null);
});
t("readBackup reads a file and refuses a huge one", async () => {
  const file = (text, size = text.length) => ({ size, text: async () => text });
  assert.equal((await readBackup(file(JSON.stringify(withClass)))).subjects.length, 1);
  assert.equal(await readBackup(file("{}", 5_000_000)), null);
  assert.equal(await readBackup(null), null);
});
t("no reminder without classes, or when the browser keeps the data", () => {
  assert.equal(backupDue({ subjects: [] }, false, null, NOW), false);
  assert.equal(backupDue(withClass, true, null, NOW), false);
});
t("reminder when there was never a backup, or the last is over 30 days old", () => {
  assert.equal(backupDue(withClass, false, null, NOW), true);
  assert.equal(backupDue(withClass, false, NOW - 31 * DAY, NOW), true);
  assert.equal(backupDue(withClass, false, NOW - 3 * DAY, NOW), false);
});
t("the backup file is named with the date", () => {
  assert.equal(backupName(new Date(2026, 10, 2)), "kronokairos-backup-2026-11-02.json");
});
