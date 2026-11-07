/* Call Waiting - the drawing, the OAuth flow and the loop that drives two
   agents through a phone call. All the rules live in core.js; this file only
   moves text around, calls the models and paints the result. No build step,
   no dependencies, no server. Visitors pay with their own Pollen. */

(function () {
  "use strict";

  var C = window.CALLWAIT;

  var CFG = {
    clientId: "pk_OTwzp12Hs8UrpqKm",
    authEndpoint: "https://enter.pollinations.ai/authorize",
    tokenEndpoint: "https://enter.pollinations.ai/api/oauth/token",
    userinfoEndpoint: "https://enter.pollinations.ai/api/oauth/userinfo",
    chatEndpoint: "https://gen.pollinations.ai/v1/chat/completions",
    scope: "profile usage",
    budget: 6,
    expiryDays: 7
  };

  var SPEAKER_MODEL = "openai/gpt-5.4-nano";
  var JUDGE_MODEL = "openai/gpt-5.4-nano";

  var $ = function (s) { return document.querySelector(s); };

  var S = {
    token: sessionStorage.getItem("callwait.token") || null,
    scene: "cancel",
    turns: [],
    busy: false,
    running: false,
    stop: false,
    calls: 0,
    started: 0,
    timer: null
  };

  /* ------------------------------------------------------------------ auth */

  function pageUrl() {
    return window.location.origin + window.location.pathname.replace(/index\.html$/, "");
  }
  function b64url(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function rnd(n) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    var b = new Uint8Array(n), out = "";
    crypto.getRandomValues(b);
    for (var i = 0; i < n; i += 1) out += alphabet[b[i] % alphabet.length];
    return out;
  }
  function signIn() {
    var verifier = rnd(64), state = rnd(24);
    sessionStorage.setItem("callwait.verifier", verifier);
    sessionStorage.setItem("callwait.state", state);
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(b64url).then(function (ch) {
      var p = new URLSearchParams({
        response_type: "code",
        client_id: CFG.clientId,
        redirect_uri: pageUrl(),
        scope: CFG.scope,
        budget: String(CFG.budget),
        models: "text",
        expiry: String(CFG.expiryDays),
        state: state,
        code_challenge: ch,
        code_challenge_method: "S256"
      });
      window.location.assign(CFG.authEndpoint + "?" + p.toString());
    });
  }
  function finishSignIn() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code"), err = params.get("error");
    if (!code && !err) return Promise.resolve(false);
    if (window.history && window.history.replaceState) window.history.replaceState(null, "", pageUrl());
    if (err) {
      setStatus("Sign in failed: " + err + " " + (params.get("error_description") || ""), "err");
      return Promise.resolve(true);
    }
    var verifier = sessionStorage.getItem("callwait.verifier");
    var wantState = sessionStorage.getItem("callwait.state");
    var gotState = params.get("state");
    if (!verifier) {
      setStatus("Sign in could not finish because this tab lost its verifier. Sign in again.", "err");
      return Promise.resolve(true);
    }
    if (wantState && gotState && wantState !== gotState) {
      setStatus("Sign in failed: the state did not match. Sign in again.", "err");
      return Promise.resolve(true);
    }
    setStatus("Finishing sign in...", "");
    return fetch(CFG.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        client_id: CFG.clientId,
        redirect_uri: pageUrl(),
        code_verifier: verifier
      })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || !d.access_token) throw new Error((d && (d.error_description || d.error)) || ("HTTP " + r.status));
        S.token = d.access_token;
        sessionStorage.setItem("callwait.token", S.token);
        sessionStorage.removeItem("callwait.verifier");
        sessionStorage.removeItem("callwait.state");
      });
    }).then(function () {
      setStatus("Signed in. Your own Pollen pays for every turn.", "ok");
      return loadUser().then(function () { return true; });
    }).catch(function (e) {
      setStatus("Sign in failed: " + (e && e.message ? e.message : "unknown error"), "err");
      return true;
    });
  }
  function loadUser() {
    if (!S.token) {
      $("#who").textContent = "Not signed in";
      $("#signBtn").textContent = "Sign in with Pollen";
      return Promise.resolve();
    }
    if (S.token.indexOf("sk_") === 0) {
      $("#who").textContent = "Your key";
      $("#signBtn").textContent = "Sign out";
      return Promise.resolve();
    }
    return fetch(CFG.userinfoEndpoint, { headers: { Authorization: "Bearer " + S.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (u) {
        var name = (u && (u.name || u.githubUsername || u.username || u.email)) || "Pollen account";
        $("#who").textContent = name;
        $("#signBtn").textContent = "Sign out";
      });
  }
  function toggleSign() {
    if (S.token) {
      S.token = null;
      sessionStorage.removeItem("callwait.token");
      loadUser();
      setStatus("Signed out.", "");
      syncButtons();
    } else signIn();
  }

  /* Paste a secret key instead of signing in. It is kept in this tab only
     and sent to gen.pollinations.ai only. */
  function toggleKeyRow() {
    var row = $("#keyRow");
    row.hidden = !row.hidden;
    if (!row.hidden) $("#keyInput").focus();
  }
  function saveKey() {
    var k = $("#keyInput").value.trim();
    if (!k) return;
    if (k.indexOf("pk_") === 0) {
      setStatus("That is an app key. A secret key starts with sk_.", "err");
      return;
    }
    if (k.indexOf("sk_") !== 0) {
      setStatus("That does not look like a Pollinations secret key (sk_...).", "err");
      return;
    }
    S.token = k;
    sessionStorage.setItem("callwait.token", k);
    $("#keyInput").value = "";
    $("#keyRow").hidden = true;
    $("#who").textContent = "Your key";
    setStatus("Using your key. Your own Pollen pays for every turn.", "ok");
    syncButtons();
  }

  /* ----------------------------------------------------------------- model */

  function setStatus(msg, kind) {
    var el = $("#status");
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function chat(system, user, maxTokens, jsonMode) {
    var body = {
      model: SPEAKER_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: maxTokens || 300,
      reasoning_effort: "low"
    };
    if (jsonMode) body.response_format = { type: "json_object" };
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 90000);
    return fetch(CFG.chatEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + S.token },
      body: JSON.stringify(body),
      signal: ctrl.signal
    }).then(function (r) {
      return r.text().then(function (text) {
        clearTimeout(timer);
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        if (!r.ok) {
          var m = (data && data.error && (data.error.message || data.error)) || text || ("HTTP " + r.status);
          var e2 = new Error(String(typeof m === "string" ? m : JSON.stringify(m)).slice(0, 200));
          e2.status = r.status;
          throw e2;
        }
        S.calls += 1;
        $("#cost").textContent = S.calls;
        var ch = data && data.choices && data.choices[0];
        var content = ch && ch.message ? (ch.message.content || "") : "";
        if (Array.isArray(content)) {
          content = content.map(function (p) { return typeof p === "string" ? p : (p && p.text) || ""; }).join(" ");
        }
        return String(content || "");
      });
    }).catch(function (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") { e = new Error("the model took longer than 90 seconds"); }
      throw e;
    });
  }

  /* ---------------------------------------------------------------- drawing */

  function renderScenes() {
    var box = $("#scenes");
    box.innerHTML = "";
    C.sceneList().forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "scene";
      b.setAttribute("aria-pressed", String(s.id === S.scene));
      b.innerHTML = '<span class="t"></span><span class="s"></span>';
      b.querySelector(".t").textContent = s.title;
      b.querySelector(".s").textContent = s.opener;
      b.addEventListener("click", function () {
        if (S.running) return;
        S.scene = s.id;
        renderScenes();
        resetCall();
      });
      box.appendChild(b);
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function paintTurn(t) {
    var cast = C.CAST[t.speaker];
    var row = el("div", "turn " + t.speaker);
    var head = el("div", "head");
    head.appendChild(el("span", "name", cast.name));
    head.appendChild(el("span", "pill", cast.role));
    if (t.retry) head.appendChild(el("span", "pill", "retried"));
    if (t.hangup) head.appendChild(el("span", "pill", "hung up"));
    row.appendChild(head);
    row.appendChild(el("div", "bubble", t.text));
    var tools = el("div", "tools");
    var speak = el("button", "iconbtn", "hear it");
    speak.type = "button";
    speak.addEventListener("click", function () { say(t.text, cast.voice, speak); });
    tools.appendChild(speak);
    row.appendChild(tools);
    $("#call").appendChild(row);
    $("#call").scrollTop = $("#call").scrollHeight;
  }

  function clearThinking() {
    var n = $("#thinking");
    if (n) n.remove();
  }
  function showThinking(name) {
    clearThinking();
    var n = el("div", "thinking");
    n.id = "thinking";
    n.appendChild(el("i"));
    n.appendChild(el("i"));
    n.appendChild(el("i"));
    n.appendChild(el("span", "", " " + name + " is talking..."));
    $("#call").appendChild(n);
    $("#call").scrollTop = $("#call").scrollHeight;
  }

  function resetCall() {
    S.turns = [];
    S.calls = 0;
    S.running = false;
    S.stop = false;
    $("#call").innerHTML = "";
    var empty = el("div", "empty");
    empty.id = "empty";
    empty.innerHTML = "Press <kbd>Start the call</kbd>. Mira picks up first, then they take turns until one of them ends it or the turn limit runs out.";
    $("#call").appendChild(empty);
    $("#verdict").hidden = true;
    $("#turnCount").textContent = "0";
    $("#wordCount").textContent = "0";
    $("#cost").textContent = "0";
    $("#timer").textContent = "00:00";
    $("#callState").textContent = "line idle";
    $("#live").className = "live";
    setStatus("", "");
    syncButtons();
  }

  function syncButtons() {
    $("#startBtn").disabled = S.running || !S.token;
    $("#stopBtn").disabled = !S.running;
    $("#startBtn").textContent = S.running ? "Call in progress" : "Start the call";
    $("#signBtn").textContent = S.token ? "Sign out" : "Sign in with Pollen";
  }

  function startTimer() {
    S.started = Date.now();
    clearInterval(S.timer);
    S.timer = setInterval(function () {
      var s = Math.floor((Date.now() - S.started) / 1000);
      var mm = String(Math.floor(s / 60)).padStart(2, "0");
      var ss = String(s % 60).padStart(2, "0");
      $("#timer").textContent = mm + ":" + ss;
    }, 1000);
  }

  function updateCounts() {
    var st = C.stats(S.turns);
    $("#turnCount").textContent = String(st.turns);
    $("#wordCount").textContent = String(st.words);
  }

  /* ------------------------------------------------------------- the call */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* One speaker, one line. A stale or empty reply is retried once with the
     reason attached; if it is still stale the call is stopped rather than
     looped. */
  function speakOnce(speakerId, attempt) {
    var scene = C.SCENES[S.scene];
    var nudge = $("#whisperInput").value.trim();
    var user = C.userPrompt(S.turns, nudge);
    if (attempt > 0) {
      user += "\n\nYour last attempt repeated something already said. Say something new that moves the call forward.";
    }
    return chat(C.systemPrompt(speakerId, S.scene), user, 320).then(function (raw) {
      var clean = C.cleanReply(raw, speakerId);
      if (!clean.text) throw new Error("empty reply");
      if (C.isStale(clean.text, S.turns)) {
        if (attempt === 0) return speakOnce(speakerId, 1);
        throw new Error("the model kept repeating itself");
      }
      return clean;
    });
  }

  function runCall() {
    if (S.running) return;
    if (!S.token) { setStatus("Sign in first, or paste a key. Your own Pollen pays.", "err"); return; }
    resetCall();
    S.running = true;
    S.stop = false;
    syncButtons();
    $("#live").className = "live on";
    $("#callState").textContent = C.SCENES[S.scene].title;
    startTimer();
    setStatus("", "");

    function step() {
      if (S.stop) return Promise.resolve("stopped");
      var over = C.callOver(S.turns, false);
      if (over) return Promise.resolve(over);
      var speaker = C.nextSpeaker(S.turns);
      var cast = C.CAST[speaker];
      showThinking(cast.name);
      return speakOnce(speaker, 0).then(function (clean) {
        clearThinking();
        var t = { speaker: speaker, text: clean.text, hangup: clean.hangup };
        S.turns.push(t);
        paintTurn(t);
        updateCounts();
        $("#whisperInput").value = "";
        if (C.honourHangup(S.turns.length, clean.hangup)) return "hangup";
        return sleep(420).then(step);
      }).catch(function (e) {
        clearThinking();
        var msg = e && e.message ? e.message : "unknown error";
        if (e && e.status === 401) msg = "the key was refused. Sign in again.";
        if (e && e.status === 402) msg = "out of Pollen. Top up, then start again.";
        if (e && e.status === 429) msg = "rate limited. Wait a moment and start again.";
        setStatus("Call stopped: " + msg, "err");
        return "error";
      });
    }

    step().then(function (reason) {
      S.running = false;
      clearInterval(S.timer);
      $("#live").className = "live";
      syncButtons();
      if (reason === "error") { $("#callState").textContent = "line dropped"; return; }
      if (reason === "stopped") { $("#callState").textContent = "you hung up"; }
      else if (reason === "hangup") { $("#callState").textContent = "call ended"; }
      else { $("#callState").textContent = "turn limit reached"; }
      if (S.turns.length < 2) { setStatus("That call ended too early to judge.", "err"); return; }
      return judge();
    });
  }

  function judge() {
    setStatus("A third model is reading the call...", "");
    return chat(C.JUDGE_SYSTEM, C.judgePrompt(S.turns), 200, true).then(function (raw) {
      var v = C.readVerdict(raw);
      var box = $("#verdict");
      box.hidden = false;
      if (v.who) {
        $("#verdictTitle").textContent = C.CAST[v.who].name + " ended the call.";
      } else {
        $("#verdictTitle").textContent = "The judge could not name a winner.";
      }
      $("#verdictWhy").textContent = v.why || "";
      var conf = v.confidence == null ? 0 : v.confidence;
      var sat = v.satisfied == null ? 0 : v.satisfied;
      $("#confFill").style.width = Math.round(conf * 100) + "%";
      $("#confVal").textContent = v.confidence == null ? "not given" : Math.round(conf * 100) + "% sure";
      $("#satFill").style.width = Math.round(sat * 100) + "%";
      $("#satVal").textContent = v.satisfied == null ? "not given" : Math.round(sat * 100) + "%";
      setStatus("", "");
    }).catch(function (e) {
      setStatus("The call finished but the judge failed: " + (e && e.message ? e.message : "unknown error"), "err");
    });
  }

  /* -------------------------------------------------------------- hear it */

  function say(text, voice, btn) {
    if (!S.token) { setStatus("Sign in to hear a turn.", "err"); return; }
    if (!window.speechSynthesis) { setStatus("This browser has no speech synthesis.", "err"); return; }
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = voice === "onyx" ? 0.85 : 1.06;
    var voices = window.speechSynthesis.getVoices();
    var pick = voices.filter(function (v) { return /en(-|_)?(US|GB)/i.test(v.lang); });
    if (pick.length) u.voice = pick[voice === "onyx" ? Math.min(1, pick.length - 1) : 0];
    btn.textContent = "speaking...";
    u.onend = function () { btn.textContent = "hear it"; };
    u.onerror = function () { btn.textContent = "hear it"; };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  /* ---------------------------------------------------------------- wiring */

  function stopCall() {
    S.stop = true;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    $("#stopBtn").disabled = true;
  }

  function boot() {
    renderScenes();
    resetCall();
    $("#signBtn").addEventListener("click", toggleSign);
    $("#keyBtn").addEventListener("click", toggleKeyRow);
    $("#keySave").addEventListener("click", saveKey);
    $("#keyInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") saveKey();
    });
    $("#startBtn").addEventListener("click", runCall);
    $("#stopBtn").addEventListener("click", stopCall);
    $("#whisperInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !S.running) runCall();
    });
    finishSignIn().then(function () {
      return loadUser();
    }).then(syncButtons);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
