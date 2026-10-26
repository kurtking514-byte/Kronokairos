import assert from "node:assert/strict";
import { parseInvite } from "../js/invite.js";

export const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const NONE = { link: null, meetingId: null, passcode: null };

// All data below is fake.
const STANDARD = `Teacher Example is inviting you to a scheduled Zoom meeting.

Topic: Math 101
Time: Oct 26, 2026 07:30 AM Manila

Join Zoom Meeting
https://us04web.zoom.us/j/12345678901?pwd=AbCdEf123456ghIJ

Join and take notes
https://us04web.zoom.us/j/12345678901?pwd=AbCdEf123456ghIJ&mynotes=on

Meeting chat link
https://us04web.zoom.us/launch/jc/12345678901

Add to calendar
https://us04web.zoom.us/meeting/tZErdOGsqzMs/ics?icsToken=fake

Meeting ID: 123 4567 8901
Passcode: AbC123`;

const LINK = "https://us04web.zoom.us/j/12345678901?pwd=AbCdEf123456ghIJ";

t("standard invite gives link, ID and passcode", () => {
  assert.deepEqual(parseInvite(STANDARD), { link: LINK, meetingId: "12345678901", passcode: "AbC123" });
});

t("link ID and Meeting ID line agree on standard samples", () => {
  const samples = [
    ["https://zoom.us/j/987654321?pwd=fakeToken1", "987 654 321"],
    ["https://us02web.zoom.us/j/98765432101?pwd=fakeToken2", "987 6543 2101"],
    ["https://us04web.zoom.us/j/55501002030", "555 0100 2030"],
  ];
  for (const [url, label] of samples) {
    const r = parseInvite(`Join Zoom Meeting\n${url}\n\nMeeting ID: ${label}\nPasscode: Zz9`);
    assert.equal(r.meetingId, url.match(/\/j\/(\d+)/)[1]);
    assert.equal(r.meetingId, label.replace(/ /g, ""));
  }
});

t("passcode keeps upper and lower case exactly", () => {
  assert.equal(parseInvite("Meeting ID: 123 456 7890\nPasscode: aBcD9xYz").passcode, "aBcD9xYz");
  assert.equal(parseInvite("Passcode: xY9zQ1").passcode, "xY9zQ1");
});

t("passcode with symbols is kept exactly", () => {
  assert.equal(parseInvite("Passcode: A!b#9").passcode, "A!b#9");
});

t("Password: works like Passcode:", () => {
  assert.equal(parseInvite("Meeting ID: 123 456 7890\nPassword: Qw3rTy").passcode, "Qw3rTy");
});

t("labels work in any letter case", () => {
  const r = parseInvite("MEETING ID: 123 456 7890\nPASSCODE: AbC123");
  assert.deepEqual([r.meetingId, r.passcode], ["1234567890", "AbC123"]);
});

t("link only: ID comes from the link, passcode is null", () => {
  assert.deepEqual(parseInvite("https://us04web.zoom.us/j/12345678901?pwd=fakeToken"), {
    link: "https://us04web.zoom.us/j/12345678901?pwd=fakeToken", meetingId: "12345678901", passcode: null,
  });
});

t("link without a query works", () => {
  assert.equal(parseInvite("https://zoom.us/j/987654321").link, "https://zoom.us/j/987654321");
});

t("ID only: link is null", () => {
  assert.deepEqual(parseInvite("Meeting ID: 123 456 7890\nPasscode: AbC123"),
    { link: null, meetingId: "1234567890", passcode: "AbC123" });
});

t("no passcode line gives a null passcode", () => {
  const r = parseInvite("Join Zoom Meeting\nhttps://zoom.us/j/987654321\nMeeting ID: 987 654 321");
  assert.equal(r.passcode, null);
  assert.equal(r.meetingId, "987654321");
});

t("the passcode is not taken from the pwd= part of the link", () => {
  assert.equal(parseInvite("https://zoom.us/j/987654321?pwd=fakeToken").passcode, null);
});

t("with several links, the first normal one is used", () => {
  const r = parseInvite("https://zoom.us/j/111222333?pwd=one\nhttps://zoom.us/j/444555666?pwd=two");
  assert.equal(r.link, "https://zoom.us/j/111222333?pwd=one");
});

t("a take-notes link listed first is skipped for a normal one", () => {
  const r = parseInvite("https://zoom.us/j/111222333?pwd=one&mynotes=on\nhttps://zoom.us/j/111222333?pwd=one");
  assert.equal(r.link, "https://zoom.us/j/111222333?pwd=one");
});

t("a take-notes link on its own is used with the notes flag removed", () => {
  assert.equal(parseInvite("https://zoom.us/j/111222333?pwd=one&mynotes=on").link,
    "https://zoom.us/j/111222333?pwd=one");
  assert.equal(parseInvite("https://zoom.us/j/111222333?mynotes=on").link, "https://zoom.us/j/111222333");
});

t("meeting chat links (/launch/jc/) are ignored", () => {
  assert.deepEqual(parseInvite("Meeting chat link\nhttps://us04web.zoom.us/launch/jc/12345678901"), NONE);
});

t("calendar (.ics) links are ignored", () => {
  assert.equal(parseInvite("https://us04web.zoom.us/meeting/tZErdOGsqzMs/ics?icsToken=fake").link, null);
  assert.equal(parseInvite("https://zoom.us/j/111222333/calendar.ics").link, null);
});

t("messy spacing, tabs and non-breaking spaces", () => {
  const r = parseInvite("  Meeting   ID :\t123\u00a0456   7890  \n   Passcode:   AbC123   \n\n\n  https://zoom.us/j/1234567890   ");
  assert.deepEqual(r, { link: "https://zoom.us/j/1234567890", meetingId: "1234567890", passcode: "AbC123" });
});

t("Windows line endings", () => {
  assert.deepEqual(parseInvite(STANDARD.replace(/\n/g, "\r\n")), parseInvite(STANDARD));
});

t("Meeting ID on the line after the label", () => {
  assert.equal(parseInvite("Meeting ID:\n123 456 7890").meetingId, "1234567890");
});

t("Meeting ID written with hyphens", () => {
  assert.equal(parseInvite("Meeting ID: 123-4567-8901").meetingId, "12345678901");
});

t("link split after pwd= is joined", () => {
  const r = parseInvite("Join Zoom Meeting\nhttps://us04web.zoom.us/j/12345678901?pwd=\nAbCdEf123456ghIJ\nMeeting ID: 123 4567 8901");
  assert.equal(r.link, LINK);
});

t("link cut in the middle of the token is joined", () => {
  const r = parseInvite("https://us04web.zoom.us/j/12345678901?pwd=AbCdEf12345678901234567890abcd\nEFGH5678\nMeeting ID: 123 4567 8901");
  assert.equal(r.link, "https://us04web.zoom.us/j/12345678901?pwd=AbCdEf12345678901234567890abcdEFGH5678");
});

t("a short link followed by a plain word is not joined", () => {
  const r = parseInvite("https://zoom.us/j/987654321\nPasscode\nAbC123");
  assert.equal(r.link, "https://zoom.us/j/987654321");
});

t("trailing punctuation is removed from the link", () => {
  for (const tail of [".", ",", ";", ")", "]", ">", "!"]) {
    assert.equal(parseInvite(`Join here: https://zoom.us/j/987654321?pwd=fakeToken${tail}`).link,
      "https://zoom.us/j/987654321?pwd=fakeToken", tail);
  }
});

t("links in angle brackets or markdown work", () => {
  assert.equal(parseInvite("<https://zoom.us/j/987654321?pwd=fakeToken>").link, "https://zoom.us/j/987654321?pwd=fakeToken");
  assert.equal(parseInvite("[Join](https://zoom.us/j/987654321?pwd=fakeToken)").link, "https://zoom.us/j/987654321?pwd=fakeToken");
});

t("http and mixed-case hosts are accepted", () => {
  assert.equal(parseInvite("HTTPS://US02WEB.ZOOM.US/j/987654321").meetingId, "987654321");
});

t("look-alike hosts are not Zoom links", () => {
  assert.equal(parseInvite("https://evilzoom.us/j/987654321").link, null);
  assert.equal(parseInvite("https://zoom.us.evil.test/j/987654321").link, null);
  assert.equal(parseInvite("https://zoom.us@evil.test/j/987654321").link, null);
});

t("a Meeting ID line with the wrong length falls back to the link ID", () => {
  const r = parseInvite("https://zoom.us/j/987654321\nMeeting ID: 12 34");
  assert.equal(r.meetingId, "987654321");
});

t("a wrong-length ID with no link gives null", () => {
  assert.equal(parseInvite("Meeting ID: 12 34").meetingId, null);
  assert.equal(parseInvite("Meeting ID: 123 456 789 012").meetingId, null);
});

t("if the Meeting ID line and link disagree, both are returned as written", () => {
  const r = parseInvite("https://zoom.us/j/111222333?pwd=x\nMeeting ID: 444 555 666");
  assert.equal(r.meetingId, "444555666");
  assert.equal(r.link, "https://zoom.us/j/111222333?pwd=x");
});

t("non-Zoom text gives all null", () => {
  assert.deepEqual(parseInvite("Hello class! Please read chapter 3. See https://example.test/page"), NONE);
});

t("empty and blank strings give all null", () => {
  assert.deepEqual(parseInvite(""), NONE);
  assert.deepEqual(parseInvite("  \n\t \r\n "), NONE);
});

t("non-string input never throws", () => {
  for (const bad of [null, undefined, 42, {}, [], true, () => 1]) {
    assert.deepEqual(parseInvite(bad), NONE);
  }
});

t("result always has exactly the three contract keys", () => {
  for (const input of ["", STANDARD, "x"]) {
    assert.deepEqual(Object.keys(parseInvite(input)).sort(), ["link", "meetingId", "passcode"]);
  }
});

t("very long junk input is handled quickly", () => {
  const started = Date.now();
  parseInvite("https://zoom.us/j/" + "9".repeat(100000) + " Meeting ID: " + "1 ".repeat(50000));
  parseInvite("a".repeat(200000));
  assert.ok(Date.now() - started < 2000);
});
