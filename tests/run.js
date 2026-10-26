process.env.TZ = "Asia/Manila"; // the calendar tests assume Philippine time
// Plain Node test runner. Usage: node tests/run.js
// Picks up every tests/*.test.js file that exports a `tests` array of [name, fn].
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort()) {
  const { tests } = await import(pathToFileURL(path.join(dir, file)).href);
  console.log(`\n${file}`);
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${name}\n        ${String(err.message).split("\n")[0]}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (passed + failed === 0) { console.log("No tests found"); process.exit(1); }
process.exit(failed ? 1 : 0);
