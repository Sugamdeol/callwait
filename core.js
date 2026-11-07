/* Call Waiting - the rules of a phone call between two AI agents.
   Pure functions only: no DOM, no network. app.js does the drawing and the
   talking; this file decides what a turn is, what a reply may contain and
   when the call has to end. Node can require it for the tests. */

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CALLWAIT = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_TURNS = 14;
  var MIN_TURNS = 4;
  var MAX_CHARS = 320;

  /* Two callers, one line. Each has a goal it will not give up. */
  var CAST = {
    mira: {
      id: "mira",
      name: "Mira",
      role: "retention agent",
      voice: "nova",
      colour: "#7bd88f",
      goal: "keep the caller on the line and on the plan",
      style: "warm, scripted, apologetic, never lets a pause sit"
    },
    dale: {
      id: "dale",
      name: "Dale",
      role: "caller",
      voice: "onyx",
      colour: "#f2b25c",
      goal: "cancel the account and get off the phone",
      style: "tired, polite, increasingly specific about wanting to leave"
    }
  };

  var SCENES = {
    cancel: {
      id: "cancel",
      title: "Cancelling the account",
      opener: "Dale calls to cancel. Mira is the retention line.",
      setting: "A phone support queue at a small software company. Dale has been a customer for four years and wants to cancel today. Mira's job is to keep him."
    },
    refund: {
      id: "refund",
      title: "The refund that is not a refund",
      opener: "Dale wants his money back. Mira can only offer credit.",
      setting: "A billing line. Dale was charged twice and wants the duplicate charge returned to his card. Mira may only offer account credit, never a card refund."
    },
    delivery: {
      id: "delivery",
      title: "Where is the parcel",
      opener: "Dale's parcel is late. Mira has a tracking page and no answers.",
      setting: "A courier helpline. Dale's parcel is nine days late. Mira can see the tracking status but the status has not changed in a week."
    }
  };

  function sceneList() {
    return Object.keys(SCENES).map(function (k) { return SCENES[k]; });
  }

  function other(id) {
    return id === "mira" ? CAST.dale : CAST.mira;
  }

  /* The system prompt for one speaker. The transcript is passed as the user
     message so the model sees the call so far, not a chat history it can
     rewrite. */
  function systemPrompt(speakerId, sceneId) {
    var me = CAST[speakerId] || CAST.mira;
    var them = other(me.id);
    var scene = SCENES[sceneId] || SCENES.cancel;
    return [
      "You are " + me.name + ", the " + me.role + " on a live phone call.",
      "Setting: " + scene.setting,
      "Your goal: " + me.goal + ". You never abandon it.",
      "Your manner: " + me.style + ".",
      "You are speaking to " + them.name + ", whose goal is to " + them.goal + ".",
      "",
      "Rules:",
      "1. Say one turn of speech only. No stage directions, no name label, no quotes around the whole line.",
      "2. At most 55 words. Real phone speech: contractions, short sentences, the odd filler.",
      "3. React to the last thing said. Never repeat your previous line.",
      "4. Never mention that you are a model, an AI or a simulation.",
      "5. If you decide the call is over, end your line with the exact token [HANGUP] and nothing after it.",
      "6. Otherwise do not use square brackets at all."
    ].join("\n");
  }

  function transcriptText(turns) {
    if (!turns.length) return "(the call has just connected, nobody has spoken)";
    return turns.map(function (t) {
      return (CAST[t.speaker] ? CAST[t.speaker].name : t.speaker) + ": " + t.text;
    }).join("\n");
  }

  function userPrompt(turns, nudge) {
    var lines = ["The call so far:", transcriptText(turns), ""];
    if (nudge) lines.push("The person listening just whispered to you: \"" + nudge + "\"", "");
    /* Calls that end after two lines have nothing to judge. Nobody may hang
       up before the minimum, so the first few turns always happen. */
    if (turns.length < MIN_TURNS) {
      lines.push("The call has only just started. Stay on the line, answer what was said, and do not end the call yet.", "");
    }
    lines.push("Your next line:");
    return lines.join("\n");
  }

  /* Strip what a model adds around speech: a name label, wrapping quotes,
     markdown, a stray "Mira:" prefix. Returns {text, hangup}. */
  function cleanReply(raw, speakerId) {
    var s = String(raw == null ? "" : raw).trim();
    s = s.replace(/^```[a-z]*\s*/i, "").replace(/```$/,"").trim();
    var me = CAST[speakerId] || CAST.mira;
    var label = new RegExp("^\\**\\s*" + me.name + "\\s*\\**\\s*:\\s*", "i");
    s = s.replace(label, "");
    s = s.replace(/^["'\u201c\u2018]+/, "").replace(/["'\u201d\u2019]+$/, "").trim();
    s = s.replace(/\s*\n+\s*/g, " ");
    var hangup = /\[HANGUP\]/i.test(s);
    s = s.replace(/\s*\[HANGUP\]\s*/gi, " ").trim();
    s = s.replace(/\s*\[[^\]]{0,40}\]\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    if (s.length > MAX_CHARS) {
      s = s.slice(0, MAX_CHARS - 3);
      var cut = s.lastIndexOf(" ");
      if (cut > MAX_CHARS * 0.6) s = s.slice(0, cut);
      s = s.replace(/[,;:\s]+$/, "") + "...";
    }
    return { text: s, hangup: hangup };
  }

  /* A turn is only accepted if it says something new. A model that parrots
     its last line, or answers with nothing, gets one retry and then the call
     is stopped rather than looped. */
  function isStale(text, turns) {
    var t = String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (!t) return true;
    return turns.some(function (old) {
      var o = String(old.text || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (!o) return false;
      if (o === t) return true;
      var a = t.split(" "), b = o.split(" ");
      var same = a.filter(function (w) { return b.indexOf(w) !== -1; }).length;
      return same / Math.max(a.length, b.length) > 0.7;
    });
  }

  /* Who speaks next. Mira opens, then they alternate. */
  function nextSpeaker(turns) {
    if (!turns.length) return "mira";
    return turns[turns.length - 1].speaker === "mira" ? "dale" : "mira";
  }

  function callOver(turns, hangupSeen) {
    if (hangupSeen) return "hangup";
    if (turns.length >= MAX_TURNS) return "turn limit";
    return null;
  }

  /* A model may try to end the call on its first line. Honour the token only
     once the call has run long enough to be worth judging; before that the
     speaker is told to stay on the line. Pass the turn count including the
     line just spoken. */
  function honourHangup(turnCount, hangupSeen) {
    return Boolean(hangupSeen) && turnCount >= MIN_TURNS;
  }

  /* The judge: a third model reads the finished call and says who gave up
     first and whether Dale got what he called for. It is asked for JSON so
     the answer can be drawn, and it is told to judge the transcript only. */
  var JUDGE_SYSTEM = [
    "You read a finished phone call between two agents and judge it.",
    "Answer only from what is in the transcript. Do not invent facts.",
    "Reply with one JSON object and nothing else:",
    '{"who":"mira"|"dale","confidence":0.0-1.0,"satisfied":0.0-1.0,"why":"one sentence"}',
    "who is the person who ended the call, or would have ended it next.",
    "confidence is how sure you are of that. satisfied is the chance Dale hung up having got what he called for.",
    "why names the moment in the call that decided it, in at most 25 words."
  ].join("\n");

  function judgePrompt(turns) {
    return "The call:\n\n" + transcriptText(turns) + "\n\nJudge it.";
  }

  /* Read the judge's reply defensively: models wrap JSON in fences, add a
     sentence before it, or answer with a bare word. */
  function readVerdict(raw) {
    var out = { who: null, confidence: null, satisfied: null, why: "" };
    if (raw == null) return out;
    var s = String(raw).trim();
    var start = s.indexOf("{"), end = s.lastIndexOf("}");
    var obj = null;
    if (start !== -1 && end > start) {
      try { obj = JSON.parse(s.slice(start, end + 1)); } catch (e) { obj = null; }
    }
    if (obj && typeof obj === "object") {
      var who = String(obj.who || obj.speaker || "").toLowerCase();
      if (who.indexOf("dale") === 0) out.who = "dale";
      else if (who.indexOf("mira") === 0) out.who = "mira";
      out.confidence = num(obj.confidence);
      out.satisfied = num(obj.satisfied != null ? obj.satisfied : obj.satisfaction);
      if (typeof obj.why === "string") out.why = obj.why.slice(0, 200);
      return out;
    }
    var low = s.toLowerCase();
    if (low.indexOf("dale") !== -1 && low.indexOf("mira") === -1) out.who = "dale";
    else if (low.indexOf("mira") !== -1 && low.indexOf("dale") === -1) out.who = "mira";
    return out;
  }

  function num(v) {
    var n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n)) return null;
    if (n > 1 && n <= 100) n = n / 100;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    return n;
  }

  function stats(turns) {
    var words = 0, per = { mira: 0, dale: 0 };
    turns.forEach(function (t) {
      var n = String(t.text || "").split(/\s+/).filter(Boolean).length;
      words += n;
      if (per[t.speaker] != null) per[t.speaker] += n;
    });
    return { turns: turns.length, words: words, per: per };
  }

  return {
    CAST: CAST, SCENES: SCENES, MAX_TURNS: MAX_TURNS, MIN_TURNS: MIN_TURNS,
    MAX_CHARS: MAX_CHARS,
    sceneList: sceneList, other: other, systemPrompt: systemPrompt,
    transcriptText: transcriptText, userPrompt: userPrompt, cleanReply: cleanReply,
    isStale: isStale, nextSpeaker: nextSpeaker, callOver: callOver, honourHangup: honourHangup,
    JUDGE_SYSTEM: JUDGE_SYSTEM, judgePrompt: judgePrompt,
    readVerdict: readVerdict, stats: stats
  };
});
