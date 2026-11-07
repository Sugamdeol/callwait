const test = require("node:test");
const assert = require("node:assert");
const C = require("./core.js");

test("three scenes, each with a setting", () => {
  const list = C.sceneList();
  assert.equal(list.length, 3);
  list.forEach((s) => assert.ok(s.setting.length > 40));
});

test("mira opens the call", () => {
  assert.equal(C.nextSpeaker([]), "mira");
});

test("speakers alternate", () => {
  assert.equal(C.nextSpeaker([{ speaker: "mira", text: "hello" }]), "dale");
  assert.equal(C.nextSpeaker([{ speaker: "mira", text: "a" }, { speaker: "dale", text: "b" }]), "mira");
});

test("system prompt names the speaker, the goal and the hangup token", () => {
  const p = C.systemPrompt("dale", "cancel");
  assert.match(p, /You are Dale/);
  assert.match(p, /cancel the account/);
  assert.match(p, /\[HANGUP\]/);
  assert.match(p, /Mira/);
});

test("unknown speaker and scene fall back instead of throwing", () => {
  const p = C.systemPrompt("nobody", "nope");
  assert.match(p, /You are Mira/);
  assert.match(p, /phone support queue/);
});

test("transcript labels turns with names", () => {
  const t = C.transcriptText([{ speaker: "mira", text: "hi" }, { speaker: "dale", text: "hello" }]);
  assert.equal(t, "Mira: hi\nDale: hello");
});

test("empty transcript says the call just connected", () => {
  assert.match(C.transcriptText([]), /just connected/);
});

test("user prompt carries the transcript and the whisper", () => {
  const u = C.userPrompt([{ speaker: "mira", text: "hi" }], "push harder");
  assert.match(u, /Mira: hi/);
  assert.match(u, /push harder/);
  assert.match(u, /Your next line/);
});

test("cleanReply strips a name label and wrapping quotes", () => {
  const r = C.cleanReply('Mira: "I understand, but let me check that."', "mira");
  assert.equal(r.text, "I understand, but let me check that.");
  assert.equal(r.hangup, false);
});

test("cleanReply strips markdown fences", () => {
  const r = C.cleanReply("```\nDale: Fine. Cancel it.\n```", "dale");
  assert.equal(r.text, "Fine. Cancel it.");
});

test("cleanReply detects and removes the hangup token", () => {
  const r = C.cleanReply("Then we are done here. [HANGUP]", "dale");
  assert.equal(r.hangup, true);
  assert.equal(r.text, "Then we are done here.");
});

test("cleanReply removes other bracketed stage directions", () => {
  const r = C.cleanReply("Sure. [pause] Go on.", "mira");
  assert.equal(r.text, "Sure. Go on.");
});

test("cleanReply collapses newlines into one line", () => {
  const r = C.cleanReply("one\ntwo\n\nthree", "mira");
  assert.equal(r.text, "one two three");
});

test("cleanReply truncates a runaway line at a word boundary", () => {
  const long = "word ".repeat(200);
  const r = C.cleanReply(long, "mira");
  assert.ok(r.text.length <= C.MAX_CHARS + 3);
  assert.ok(r.text.endsWith("..."));
});

test("cleanReply survives null and empty input", () => {
  assert.equal(C.cleanReply(null, "mira").text, "");
  assert.equal(C.cleanReply("   ", "mira").text, "");
});

test("isStale catches an exact repeat", () => {
  const turns = [{ speaker: "mira", text: "I can offer you a discount." }];
  assert.equal(C.isStale("I can offer you a discount.", turns), true);
});

test("isStale catches a near repeat", () => {
  const turns = [{ speaker: "mira", text: "I can offer you a discount on the plan today." }];
  assert.equal(C.isStale("I can offer you a discount on the plan right now.", turns), true);
});

test("isStale allows a genuinely new line", () => {
  const turns = [{ speaker: "mira", text: "I can offer you a discount." }];
  assert.equal(C.isStale("Fine, I will put the cancellation through.", turns), false);
});

test("isStale treats empty text as stale", () => {
  assert.equal(C.isStale("", []), true);
});

test("callOver reports a hangup first", () => {
  assert.equal(C.callOver([{ speaker: "dale", text: "bye" }], true), "hangup");
});

test("callOver reports the turn limit", () => {
  const turns = new Array(C.MAX_TURNS).fill({ speaker: "mira", text: "x" });
  assert.equal(C.callOver(turns, false), "turn limit");
});

test("callOver is null while the call can continue", () => {
  assert.equal(C.callOver([{ speaker: "mira", text: "x" }], false), null);
});

test("judge prompt carries the transcript", () => {
  const j = C.judgePrompt([{ speaker: "mira", text: "hi" }]);
  assert.ok(j.includes("Mira: hi"));
  assert.match(j, /Judge it/);
});

test("judge system prompt asks for the three fields", () => {
  assert.match(C.JUDGE_SYSTEM, /"conceded"/);
  assert.match(C.JUDGE_SYSTEM, /"satisfied"/);
});

test("judge prompt names who hung up", () => {
  const j = C.judgePrompt([{ speaker: "dale", text: "bye", hangup: true }], "dale");
  assert.match(j, /Dale hung up/);
});

test("hangerUpper finds the last speaker who hung up", () => {
  assert.equal(C.hangerUpper([
    { speaker: "mira", text: "a" },
    { speaker: "dale", text: "b", hangup: true }
  ]), "dale");
});

test("hangerUpper is null when nobody hung up", () => {
  assert.equal(C.hangerUpper([{ speaker: "mira", text: "a" }]), null);
});

test("readVerdict reads clean JSON", () => {
  const v = C.readVerdict('{"who":"dale","confidence":0.8,"satisfied":0.15,"why":"he asked three times"}');
  assert.equal(v.who, "dale");
  assert.equal(v.confidence, 0.8);
  assert.equal(v.satisfied, 0.15);
  assert.equal(v.why, "he asked three times");
});

test("readVerdict digs JSON out of a fenced reply", () => {
  const v = C.readVerdict('Here you go:\n```json\n{"who":"Mira","confidence":0.6,"satisfied":0.9}\n```');
  assert.equal(v.who, "mira");
  assert.equal(v.confidence, 0.6);
});

test("readVerdict normalises percentages and clamps", () => {
  const v = C.readVerdict('{"who":"dale","confidence":80,"satisfied":140}');
  assert.equal(v.confidence, 0.8);
  assert.equal(v.satisfied, 1);
});

test("readVerdict falls back to a bare word", () => {
  assert.equal(C.readVerdict("Dale hangs up first.").who, "dale");
});

test("readVerdict returns nulls for junk", () => {
  const v = C.readVerdict(null);
  assert.equal(v.who, null);
  assert.equal(v.satisfied, null);
  assert.equal(v.why, "");
});

test("stats counts turns, words and words per speaker", () => {
  const s = C.stats([
    { speaker: "mira", text: "one two three" },
    { speaker: "dale", text: "four five" }
  ]);
  assert.equal(s.turns, 2);
  assert.equal(s.words, 5);
  assert.equal(s.per.mira, 3);
  assert.equal(s.per.dale, 2);
});

test("a hangup before the minimum is not honoured", () => {
  assert.equal(C.honourHangup(1, true), false);
  assert.equal(C.honourHangup(3, true), false);
});

test("a hangup at the minimum is honoured", () => {
  assert.equal(C.honourHangup(4, true), true);
  assert.equal(C.honourHangup(7, true), true);
});

test("no hangup means no hangup", () => {
  assert.equal(C.honourHangup(9, false), false);
});

test("the short-call guard appears in the prompt before the minimum", () => {
  assert.match(C.userPrompt([], ""), /do not end the call yet/);
});

test("the short-call guard is gone once the minimum is reached", () => {
  const turns = new Array(C.MIN_TURNS).fill({ speaker: "mira", text: "x" });
  assert.doesNotMatch(C.userPrompt(turns, ""), /do not end the call yet/);
});
