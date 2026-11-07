/* Headless run of a real call: the same core.js rules the page uses, against
   the live Pollinations API. Proves the loop terminates, the lines are new,
   and the judge returns usable JSON. */
const fs = require("fs");
const C = require("/tmp/callwait/core.js");

const KEY = JSON.parse(fs.readFileSync("/data/hermes/state/pollinations-quests/config.json", "utf8")).api_key;
const MODEL = "openai/gpt-5.4-nano";
const SCENE = process.argv[2] || "cancel";
const STOP_AFTER = Number(process.argv[3] || 6);

let calls = 0;

async function chat(system, user, maxTokens, jsonMode, attempts = 0) {
  const body = {
    model: MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: maxTokens || 300,
    reasoning_effort: "low"
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const r = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify(body)
  });
  let text = await r.text();
  if (!r.ok && r.status >= 500 && attempts < 1) {
    await new Promise((z) => setTimeout(z, 2500));
    return chat(system, user, maxTokens, jsonMode, attempts + 1);
  }
  if (!r.ok) throw new Error("HTTP " + r.status + " " + text.slice(0, 200));
  calls += 1;
  return JSON.parse(text).choices[0].message.content || "";
}

async function speakOnce(turns, speaker, attempt) {
  const user = C.userPrompt(turns, "") + (attempt ? "\n\nYour last attempt repeated something already said. Say something new." : "");
  const raw = await chat(C.systemPrompt(speaker, SCENE), user, 320);
  const clean = C.cleanReply(raw, speaker);
  if (!clean.text) throw new Error("empty reply");
  if (C.isStale(clean.text, turns)) {
    if (attempt === 0) return speakOnce(turns, speaker, 1);
    throw new Error("kept repeating itself");
  }
  return clean;
}

(async () => {
  const turns = [];
  let reason = null;
  let verdict = null;
  while (!reason) {
    const over = C.callOver(turns, false);
    if (over) { reason = over; break; }
    const speaker = C.nextSpeaker(turns);
    const clean = await speakOnce(turns, speaker, 0);
    turns.push({ speaker, text: clean.text, hangup: clean.hangup });
    console.log(`${C.CAST[speaker].name}: ${clean.text}${clean.hangup ? "  [HANGUP]" : ""}`);
    if (C.honourHangup(turns.length, clean.hangup)) { reason = "hangup"; break; }
    if (turns.length >= STOP_AFTER) { reason = "stopped-by-harness"; break; }
  }
  console.log("\n--- reason:", reason, "| turns:", turns.length, "| calls:", calls);
  console.log("stats:", JSON.stringify(C.stats(turns)));
  const raw = await chat(C.JUDGE_SYSTEM, C.judgePrompt(turns, C.hangerUpper(turns)), 700, true);
  console.log("\nJUDGE RAW:", raw);
  verdict = C.readVerdict(raw);
  console.log("VERDICT:", JSON.stringify(verdict));
  if (!verdict.who) { console.log("FAIL: no who"); process.exit(1); }
  if (verdict.confidence == null) { console.log("FAIL: no confidence"); process.exit(1); }
  if (verdict.satisfied == null) { console.log("FAIL: no satisfied"); process.exit(1); }
  console.log("OK");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
