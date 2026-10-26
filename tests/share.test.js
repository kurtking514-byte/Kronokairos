import assert from "node:assert/strict";
import { defaultState, newSubject, validateSubject } from "../js/model.js";
import { encodeShare, decodeShare } from "../js/share.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// Fake data only.
const subj = (o = {}) =>
  newSubject({
    id: "abc123", name: "Math", color: "#3b82f6", days: ["Mon", "Wed", "Fri"], start: "07:30", minutes: 80,
    link: "https://example.test/j/123456789?pwd=FAKE", meetingId: "123456789", passcode: "Fake1x", ...o,
  });
const stateWith = (subjects, settings = {}) => {
  const s = defaultState();
  s.settings = { ...s.settings, ...settings };
  s.subjects = subjects;
  return s;
};
const hashOf = (url) => url.slice(url.indexOf("#"));

// ---- helpers that build links by hand, so bad payloads can be tested ----
const compress = async (text) => {
  const bytes = new TextEncoder().encode(text);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
const craft = async (payload) =>
  "#s=" + Buffer.from(await compress(typeof payload === "string" ? payload : JSON.stringify(payload))).toString("base64url");
const unpackLink = async (url) => {
  const bytes = Buffer.from(hashOf(url).slice(3), "base64url");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(await new Response(stream).arrayBuffer()));
};
const item = (o = {}) => ({ a: "abc123", n: "Math", c: "#3b82f6", d: [0, 2, 4], t: "07:30", m: 80, l: "", i: "", p: "", ...o });
const ok = async (o) => decodeShare(await craft({ v: 1, s: [item(o)] }));

// ---------- round trip ----------
t("round trip returns identical subjects", async () => {
  const subjects = [
    subj(),
    subj({ id: "b2", name: "English", days: ["Tue", "Thu"], start: "13:05", minutes: 120, color: "#22c55e", link: "", meetingId: "98765432109", passcode: "" }),
    subj({ id: "c3", name: "PE", days: ["Sat"], link: "", meetingId: "", passcode: "" }),
  ];
  const result = await decodeShare(hashOf(await encodeShare(stateWith(subjects))));
  assert.deepEqual(result.subjects, subjects);
});
t("an empty schedule round trips to an empty list", async () => {
  assert.deepEqual(await decodeShare(hashOf(await encodeShare(defaultState()))), { subjects: [] });
});
t("special characters in names, links and passcodes survive", async () => {
  const subjects = [
    subj({ id: "u1", name: "Ñandú ✓ \u{1F600}, \"quoted\" & <b>bold</b> \\ back; slash", passcode: "a,b;c\\d\"e'f<>&" }),
    subj({ id: "u2", name: "日本語 العربية", link: "https://example.test/j/123456789?pwd=a%20b&x=1#frag" }),
  ];
  const result = await decodeShare(hashOf(await encodeShare(stateWith(subjects))));
  assert.deepEqual(result.subjects, subjects);
});
t("exactly 50 subjects round trip", async () => {
  const subjects = Array.from({ length: 50 }, (_, n) => subj({ id: `id${n}`, name: `Class ${n}` }));
  const result = await decodeShare(hashOf(await encodeShare(stateWith(subjects))));
  assert.equal(result.subjects.length, 50);
});
t("days come back in week order and Sunday is never encoded", async () => {
  const link = await encodeShare(stateWith([subj({ days: ["Fri", "Mon", "Sun"] })]));
  assert.deepEqual((await unpackLink(link)).s[0].d, [0, 4]);
  assert.deepEqual((await decodeShare(hashOf(link))).subjects[0].days, ["Mon", "Fri"]);
});
t("decodeShare returns a fresh object every time", async () => {
  const h = hashOf(await encodeShare(stateWith([subj()])));
  const a = await decodeShare(h);
  const b = await decodeShare(h);
  a.subjects[0].name = "changed";
  assert.equal(b.subjects[0].name, "Math");
});

// ---------- what goes into a link ----------
t("settings are never included", async () => {
  const state = stateWith([subj()], { alarmLeadMinutes: 7, snoozeMinutes: 9, termType: "custom", termEndDate: "2027-03-15" });
  const payload = await unpackLink(await encodeShare(state));
  assert.deepEqual(Object.keys(payload).sort(), ["s", "v"]);
  assert.ok(!JSON.stringify(payload).includes("termEndDate"));
  assert.ok(!JSON.stringify(payload).includes("alarmLeadMinutes"));
});
t("extra fields on a subject are not included", async () => {
  const payload = await unpackLink(await encodeShare(stateWith([{ ...subj(), missing: ["link"], secret: "x" }])));
  assert.deepEqual(Object.keys(payload.s[0]).sort(), ["a", "c", "d", "i", "l", "m", "n", "p", "t"]);
});
t("the payload has a version marker and uses short keys", async () => {
  const payload = await unpackLink(await encodeShare(stateWith([subj()])));
  assert.equal(payload.v, 1);
  assert.equal(payload.s[0].n, "Math");
});
t("the link is the page address plus #s=, without any older hash", async () => {
  const real = globalThis.location;
  globalThis.location = { href: "https://example.test/app/?x=1#old" };
  try {
    const url = await encodeShare(stateWith([subj()]));
    assert.ok(url.startsWith("https://example.test/app/?x=1#s="), url.slice(0, 50));
    assert.ok(!url.includes("#old"));
    assert.match(url.slice(url.indexOf("#s=") + 3), /^[A-Za-z0-9_-]+$/);
  } finally {
    if (real === undefined) delete globalThis.location; else globalThis.location = real;
  }
});
t("without a page address the link starts at #s=", async () => {
  assert.ok((await encodeShare(stateWith([subj()]))).startsWith("#s="));
});
t("compression keeps a normal schedule short", async () => {
  const subjects = Array.from({ length: 8 }, (_, n) => subj({ id: `id${n}`, name: `Class ${n}` }));
  assert.ok((await encodeShare(stateWith(subjects))).length < 1500);
});
t("more than 50 subjects cannot be shared", async () => {
  const subjects = Array.from({ length: 51 }, (_, n) => subj({ id: `id${n}` }));
  assert.equal(await encodeShare(stateWith(subjects)), "");
});
t("encodeShare never throws on odd input", async () => {
  for (const bad of [null, undefined, {}, { subjects: "x" }, { subjects: [null] }, 5]) {
    assert.equal(typeof (await encodeShare(bad)), "string");
  }
});

// ---------- accepted input forms ----------
t("decodeShare accepts #s=..., s=... and a whole link", async () => {
  const url = await encodeShare(stateWith([subj()]));
  const h = hashOf(url);
  assert.equal((await decodeShare(h)).subjects.length, 1);
  assert.equal((await decodeShare(h.slice(1))).subjects.length, 1);
  assert.equal((await decodeShare("https://example.test/app/" + h)).subjects.length, 1);
  assert.equal((await decodeShare(h + "&other=1")).subjects.length, 1);
});

// ---------- corrupt and hostile input ----------
t("junk, empty and wrong-type input returns null", async () => {
  for (const bad of [undefined, null, 5, {}, [], true, "", "#", "#s=", "s=", "hello", "#x=abc", "https://example.test/?s=abc"]) {
    assert.equal(await decodeShare(bad), null, String(bad));
  }
});
t("corrupt data returns null", async () => {
  const h = hashOf(await encodeShare(stateWith([subj()])));
  assert.equal(await decodeShare(h.slice(0, 20)), null);                  // cut short
  const extra = await decodeShare(h + "AAAA");                            // junk after a complete link:
  assert.ok(extra === null || extra.subjects.length === 1);               // browsers differ; either is safe
  assert.equal(await decodeShare("#s=" + "A".repeat(200)), null);         // not deflate data
  assert.equal(await decodeShare("#s=a"), null);                          // impossible base64 length
  assert.equal(await decodeShare(h.replace(/.$/, "$")), null);            // bad character
  assert.equal(await decodeShare("#s=!!!!"), null);
  const flipped = h.slice(0, 12) + (h[12] === "A" ? "B" : "A") + h.slice(13);
  assert.equal(await decodeShare(flipped), null);
});
t("text that is not JSON returns null", async () => {
  assert.equal(await decodeShare(await craft("not json at all")), null);
  assert.equal(await decodeShare(await craft("")), null);
  assert.equal(await decodeShare(await craft("null")), null);
  assert.equal(await decodeShare(await craft("[1,2,3]")), null);
});
t("a wrong or missing version returns null", async () => {
  for (const v of [2, 0, "1", null, undefined, 1.5, [1]]) {
    assert.equal(await decodeShare(await craft({ v, s: [item()] })), null, String(v));
  }
  assert.equal(await decodeShare(await craft({ s: [item()] })), null);
});
t("more than 50 subjects returns null", async () => {
  const many = (n) => ({ v: 1, s: Array.from({ length: n }, (_, k) => item({ a: `id${k}` })) });
  assert.equal((await decodeShare(await craft(many(50)))).subjects.length, 50);
  assert.equal(await decodeShare(await craft(many(51))), null);
  assert.equal(await decodeShare(await craft(many(5000))), null);
});
t("a tiny link that unpacks to a huge file returns null quickly", async () => {
  const bomb = await craft(`{"v":1,"s":[],"pad":"${" ".repeat(20_000_000)}"}`);
  assert.ok(bomb.length < 40_000, "the test link must itself be small");
  const started = Date.now();
  assert.equal(await decodeShare(bomb), null);
  assert.ok(Date.now() - started < 3000);
});
t("a very long link returns null", async () => {
  assert.equal(await decodeShare("#s=" + "A".repeat(200_000)), null);
});
t("s must be a list of subjects", async () => {
  for (const s of [null, "x", {}, 5, undefined]) assert.equal(await decodeShare(await craft({ v: 1, s })), null);
  assert.equal(await decodeShare(await craft({ v: 1, s: [null] })), null);
  assert.equal(await decodeShare(await craft({ v: 1, s: ["x"] })), null);
  assert.equal(await decodeShare(await craft({ v: 1, s: [[]] })), null);
});
t("one bad subject makes the whole link null", async () => {
  const result = await decodeShare(await craft({ v: 1, s: [item(), item({ a: "b2", t: "25:00" })] }));
  assert.equal(result, null);
});
t("a good hand-made payload is accepted (so the checks below mean something)", async () => {
  const r = await ok({});
  assert.equal(r.subjects[0].name, "Math");
  assert.deepEqual(r.subjects[0].days, ["Mon", "Wed", "Fri"]);
});
t("every subject field is validated", async () => {
  const bad = [
    { n: "" }, { n: "   " }, { n: 5 }, { n: "x".repeat(101) },
    { a: "" }, { a: 5 }, { a: "has space" }, { a: "<script>" }, { a: "x".repeat(33) },
    { c: "red" }, { c: "#fff" }, { c: "#3b82f6;background:url(x)" }, { c: 5 },
    { d: [] }, { d: "012" }, { d: [6] }, { d: [-1] }, { d: [1.5] }, { d: [0, 0] }, { d: ["Mon"] }, { d: [0, 1, 2, 3, 4, 5, 5] },
    { t: "7:30" }, { t: "25:00" }, { t: "" }, { t: 730 },
    { m: 9 }, { m: 301 }, { m: "80" }, { m: 80.5 }, { m: null },
    { i: "12345678" }, { i: "1234567890123" }, { i: "12345abc9" }, { i: 123456789 },
    { p: 5 }, { p: "x".repeat(101) },
    { l: 5 }, { l: "x".repeat(2001) },
  ];
  for (const o of bad) assert.equal(await ok(o), null, JSON.stringify(o));
});
t("links must be plain http(s) addresses", async () => {
  for (const l of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "ftp://example.test/x", "//example.test",
    "example.test/j/1", "https://exa mple.test", "https://example.test/\n", "https://example.test/\u0000", " https://example.test"]) {
    assert.equal(await ok({ l }), null, JSON.stringify(l));
  }
  assert.equal((await ok({ l: "https://example.test/j/123456789?pwd=ABC" })).subjects.length, 1);
  assert.equal((await ok({ l: "http://example.test/j/1" })).subjects.length, 1);
  assert.equal((await ok({ l: "" })).subjects.length, 1);
});
t("duplicate subject ids return null", async () => {
  assert.equal(await decodeShare(await craft({ v: 1, s: [item(), item()] })), null);
});
t("unknown keys are dropped and cannot pollute anything", async () => {
  const text = '{"v":1,"__proto__":{"polluted":1},"s":[{"a":"abc123","n":"Math","c":"#3b82f6","d":[0],"t":"07:30","m":80,"l":"","i":"","p":"",' +
    '"__proto__":{"polluted":1},"constructor":{"x":1},"extra":"x","settings":{"snoozeMinutes":99}}]}';
  const r = await decodeShare(await craft(text));
  assert.deepEqual(Object.keys(r.subjects[0]).sort(),
    ["color", "days", "id", "link", "meetingId", "minutes", "name", "passcode", "start"]);
  assert.equal({}.polluted, undefined);
  assert.equal(r.settings, undefined);
});
t("decoded subjects pass validateSubject with no errors", async () => {
  const r = await decodeShare(hashOf(await encodeShare(stateWith([subj(), subj({ id: "z9", link: "", meetingId: "" })]))));
  for (const s of r.subjects) assert.deepEqual(validateSubject(s).errors, []);
});

// ---------- never throws ----------
t("random junk never throws and never returns a bad subject", async () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/%#&?";
  for (let n = 0; n < 150; n++) {
    let text = "";
    for (let k = Math.floor(rand() * 120); k > 0; k--) text += alphabet[Math.floor(rand() * alphabet.length)];
    const r = await decodeShare(rand() < 0.5 ? "#s=" + text : text);
    assert.ok(r === null || Array.isArray(r.subjects));
  }
});
t("random wrong-typed fields never throw and only valid subjects come out", async () => {
  let seed = 777;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const junk = [null, undefined, true, 0, -1, 1e9, "", "x", "#ffffff", [], {}, [0], "07:30", 80, "https://example.test/", "123456789"];
  const keys = ["a", "n", "c", "d", "t", "m", "l", "i", "p"];
  for (let n = 0; n < 150; n++) {
    const o = item();
    for (const k of keys) if (rand() < 0.25) o[k] = junk[Math.floor(rand() * junk.length)];
    const r = await decodeShare(await craft({ v: 1, s: [o] }));
    if (r) for (const s of r.subjects) assert.deepEqual(validateSubject(s).errors, []);
  }
});
