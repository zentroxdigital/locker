#!/usr/bin/env node
// app-server.js — a tiny local (127.0.0.1 only) server that gives the locker a graphical UI.
// It does NOT re-implement any crypto: every action shells out to the already-tested
// locker-engine.js and relays its RESULT token + message.
//
// Behaviour (v2):
//  - It always targets ITS OWN folder (the folder these files sit in). No folder picking.
//  - The folder is meant to stay LOCKED by default. You open the app, type your secret to
//    Unlock, work, then just close the window — it AUTO-LOCKS on close using the secret held
//    in memory for this session only (never written to disk except a transient temp file per
//    engine call, which is deleted immediately).
//
//   node app-server.js [port] [token]
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = parseInt(process.argv[2] || "8787", 10);
const TOKEN = process.argv[3] || crypto.randomBytes(8).toString("hex");
const APPDIR = __dirname;                        // where the locker tool files live
const ENGINE = path.join(APPDIR, "locker-engine.js");
const VOICE_CACHE = path.join(APPDIR, "voice-cache");
const EDGE_TTS = process.platform === "win32"
  ? path.join(APPDIR, ".voice-venv", "Scripts", "edge-tts.exe")
  : path.join(APPDIR, ".voice-venv", "bin", "edge-tts");
const GREETING_BN = "হাই রায়াত স্যার, আপনি এসেছেন? আমার জন্য কী এনেছেন?";
// The folder to lock/unlock: passed as arg (right-click "Open with Locker"), else this folder.
const HERE = process.argv[4] ? path.resolve(process.argv[4]) : APPDIR;
const APP_MODE = process.argv[5] === "guard" ? "guard" : "folder";

let remembered = null; // secret kept in RAM for THIS session only, so we can auto-lock on close

/** Run the engine once; parse "RESULT:TOKEN\n<message>". Secret (if any) goes via a temp file. */
function runEngine(mode, folder, secretText, cb) {
  let secretPath = null;
  try {
    if (secretText != null && String(secretText).trim() !== "") {
      secretPath = path.join(os.tmpdir(), "locker_gui_" + crypto.randomBytes(6).toString("hex") + ".js");
      fs.writeFileSync(secretPath, String(secretText), "utf8");
    }
  } catch (e) {
    return cb({ code: 1, token: "ERROR", message: "Secret temp file lekha jayni: " + e.message });
  }

  const args = [ENGINE, mode, folder];
  if (secretPath) args.push(secretPath);

  let out = "";
  const child = spawn(process.execPath, args, { windowsHide: true });
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("error", (e) => {
    if (secretPath) try { fs.unlinkSync(secretPath); } catch (x) {}
    cb({ code: 1, token: "ERROR", message: "Engine chalano jayni: " + e.message });
  });
  child.on("close", (code) => {
    if (secretPath) try { fs.unlinkSync(secretPath); } catch (x) {}
    let token = "", message = out;
    const nl = out.indexOf("\n");
    if (out.indexOf("RESULT:") === 0 && nl !== -1) {
      token = out.slice(7, nl).trim();
      message = out.slice(nl + 1);
    }
    cb({ code, token, message: message.trim(), raw: out });
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req, cb) {
  let data = "";
  req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
  req.on("end", () => { try { cb(data ? JSON.parse(data) : {}); } catch (e) { cb({}); } });
}

/** Remember Linux folders that should summon Ms Minute when the directory is opened. */
function registerLockedFolder(folder) {
  if (process.platform !== "linux" || APP_MODE !== "folder") return;
  try {
    const configDir = path.join(os.homedir(), ".config", "locker-kit");
    const registry = path.join(configDir, "watched-folders.json");
    fs.mkdirSync(configDir, { recursive: true });
    let folders = [];
    try {
      folders = JSON.parse(fs.readFileSync(registry, "utf8"));
      if (!Array.isArray(folders)) folders = [];
    } catch (_) {}
    const resolved = path.resolve(folder);
    folders = folders.filter((item) => typeof item === "string" && fs.existsSync(item));
    if (!folders.includes(resolved)) folders.push(resolved);
    const temporary = registry + ".tmp-" + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(folders, null, 2), "utf8");
    fs.renameSync(temporary, registry);
  } catch (_) {
    // Folder locking itself must still work if registration is unavailable.
  }
}

/** Speak through Linux's native audio stack; argv is passed directly without a shell. */
function speakNative(text, lang, cb) {
  if (process.platform !== "linux") return cb(false);
  const cleanText = String(text || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
  if (!cleanText) return cb(false);
  const isBangla = String(lang || "").toLowerCase().startsWith("bn");
  const choices = [
    {
      command: "espeak-ng",
      args: ["-v", isBangla ? "bn+f3" : "en-us+f3", "-p", "68", "-s", "145", cleanText]
    },
    {
      command: "spd-say",
      args: ["-l", isBangla ? "bn" : "en", "-t", "female1", "-r", "-10", "-p", "20", "-w", cleanText]
    }
  ];

  function attempt(index) {
    if (index >= choices.length) return cb(false);
    const choice = choices[index];
    let settled = false;
    const child = spawn(choice.command, choice.args, { windowsHide: true, stdio: "ignore" });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      attempt(index + 1);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) cb(true);
      else attempt(index + 1);
    });
  }
  attempt(0);
}

/** Generate/cache a clear Microsoft neural female voice. Linux installer provides edge-tts. */
function neuralSpeech(text, lang, cb) {
  if (process.platform !== "linux") return cb(null);
  const cleanText = String(text || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
  if (!cleanText) return cb(null);
  const isBangla = String(lang || "").toLowerCase().startsWith("bn");
  const voice = isBangla ? "bn-BD-NabanitaNeural" : "en-US-AriaNeural";
  const fileName = cleanText === GREETING_BN && isBangla
    ? "greeting-bn.mp3"
    : crypto.createHash("sha256").update(voice + "\n" + cleanText).digest("hex") + ".mp3";
  const output = path.join(VOICE_CACHE, fileName);

  try {
    if (fs.existsSync(output) && fs.statSync(output).size > 0) return cb(fs.readFileSync(output));
    if (!fs.existsSync(EDGE_TTS)) return cb(null);
    fs.mkdirSync(VOICE_CACHE, { recursive: true });
  } catch (_) {
    return cb(null);
  }

  const temporary = output + ".tmp-" + process.pid;
  const child = spawn(EDGE_TTS, ["--voice", voice, "--text", cleanText, "--write-media", temporary], {
    windowsHide: true,
    stdio: "ignore"
  });
  let finished = false;
  const timer = setTimeout(() => {
    if (!finished) child.kill();
  }, 30000);
  function done(audio) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cb(audio);
  }
  child.once("error", () => done(null));
  child.once("close", (code) => {
    if (finished) return;
    if (code !== 0) {
      try { fs.unlinkSync(temporary); } catch (_) {}
      return done(null);
    }
    try {
      if (!fs.existsSync(output)) fs.renameSync(temporary, output);
      else fs.unlinkSync(temporary);
      done(fs.readFileSync(output));
    } catch (_) {
      try { fs.unlinkSync(temporary); } catch (_) {}
      done(null);
    }
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const p = u.pathname;

  if (p !== "/api/shutdown" && u.searchParams.get("t") !== TOKEN) {
    return send(res, 403, { error: "bad token" });
  }

  if (p === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(PAGE(TOKEN, HERE, APP_MODE, process.platform === "linux"));
  }
  if (p === "/ping") return send(res, 200, { ok: true });

  if (p === "/api/status" && req.method === "POST") {
    return runEngine("status", HERE, null, (r) => send(res, 200, r));
  }

  if (p === "/api/speak" && req.method === "POST") {
    return readBody(req, (b) => {
      speakNative(b.text, b.lang, (spoken) => send(res, 200, { ok: spoken }));
    });
  }

  if (p === "/api/neural-speak" && req.method === "POST") {
    return readBody(req, (b) => {
      neuralSpeech(b.text, b.lang, (audio) => {
        if (!audio) return send(res, 503, { ok: false });
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": audio.length,
          "Cache-Control": "private, max-age=86400"
        });
        res.end(audio);
      });
    });
  }

  if ((p === "/api/setup" || p === "/api/lock" || p === "/api/unlock") && req.method === "POST") {
    const mode = p.split("/").pop();
    return readBody(req, (b) => {
      if (!b.secret || !String(b.secret).trim())
        return send(res, 200, { token: "ERROR", message: "Password ta likho." });
      runEngine(mode, HERE, b.secret, (r) => {
        if (r.code === 0) {
          if (mode === "lock") {
            remembered = null;                              // locked, nothing to auto-lock
            registerLockedFolder(HERE);
          }
          else remembered = String(b.secret);               // keep so we can auto-lock on close
        }
        send(res, 200, r);
      });
    });
  }

  if (p === "/api/guard" && req.method === "POST" && APP_MODE === "guard") {
    return readBody(req, (b) => {
      if (!b.secret || !String(b.secret).trim())
        return send(res, 200, { code: 1, token: "ERROR", message: "Key দিন।" });
      const mode = b.setup === true ? "setup" : "verify";
      runEngine(mode, HERE, b.secret, (r) => {
        send(res, 200, r);
        if (r.code === 0) setTimeout(() => process.exit(0), 1000);
      });
    });
  }

  if (p === "/api/shutdown") {
    send(res, 200, { ok: true });
    // best-effort auto-lock using the secret from this session, then exit
    if (remembered) {
      runEngine("lock", HERE, remembered, () => setTimeout(() => process.exit(0), 100));
    } else {
      setTimeout(() => process.exit(0), 120);
    }
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("locker-gui listening on http://127.0.0.1:" + PORT + "/?t=" + TOKEN);
});

// ---------------------------------------------------------------------------------------------
function PAGE(token, self, appMode, nativeTts) {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Locker</title>
<style>
  :root{
    --bg:#0e1116; --card:#171b22; --card2:#1f242d; --line:#2a313c;
    --ink:#e8edf4; --muted:#93a0b4; --accent:#5b8cff; --accent2:#7c6bff;
    --ok:#37d67a; --warn:#ffb454; --bad:#ff5b6e;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{
    background:transparent;
    color:var(--ink); font-family:"Segoe UI",system-ui,Arial,sans-serif;
    display:flex; align-items:flex-start; justify-content:center; padding:18px;
  }
  body.guard{align-items:center}
  body:not(.guard){padding-top:48px}
  .app{width:100%; max-width:560px}
  .window-drag{position:fixed;z-index:20;top:0;left:0;right:150px;height:42px;-webkit-app-region:drag}
  body.guard .window-drag{display:none}
  .title{display:flex; align-items:center; gap:10px; margin:2px 2px 14px}
  .title b{font-size:20px; letter-spacing:.3px}
  .title .dot{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}

  .stage{display:flex; flex-direction:column; align-items:center; gap:12px; margin-bottom:16px}
  .mascot{width:344px;height:380px;max-width:70vw;flex:0 0 auto;
    filter:drop-shadow(0 0 12px rgba(255,138,43,.68)) drop-shadow(0 0 28px rgba(239,111,22,.34))}
  /* gentle idle float */
  #body{transform-origin:60px 70px; animation:float 3.2s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  /* playful "hi" bounce + tilt (dhong) — overrides float briefly */
  .hi #body{animation:hi .95s ease}
  @keyframes hi{
    0%{transform:translateY(0) rotate(0)} 18%{transform:translateY(-14px) rotate(-8deg)}
    40%{transform:translateY(0) rotate(7deg)} 60%{transform:translateY(-8px) rotate(-5deg)}
    80%{transform:translateY(0) rotate(3deg)} 100%{transform:translateY(0) rotate(0)}}
  /* blinking: eyelids drop briefly */
  .lid{transform-origin:center top; transform:scaleY(0); animation:blink 5s infinite}
  @keyframes blink{0%,92%,100%{transform:scaleY(0)}94%{transform:scaleY(1)}96%{transform:scaleY(0)}}
  /* clock hands slowly turning = "alive" */
  #hHour{transform-origin:60px 52px; animation:spin 24s linear infinite}
  #hMin{transform-origin:60px 52px; animation:spin 6s linear infinite}
  @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  /* talking: mouth opens/closes while she speaks */
  #mouth{transform-origin:60px 70px; transform:scaleY(1)}
  .talking #mouth{animation:talk .16s ease-in-out infinite}
  @keyframes talk{0%,100%{transform:scaleY(.7)}50%{transform:scaleY(1.5)}}
  /* one hand waves when greeting/eating */
  #armR{transform-origin:96px 66px}
  .wave #armR{animation:wave .5s ease-in-out 4}
  @keyframes wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-22deg)}}
  .eating #mouth{animation:talk .22s ease-in-out infinite}

  .bubble{position:relative; background:var(--card2); border:1px solid var(--line);
    border-radius:14px; padding:12px 16px; color:var(--ink); font-size:14px; line-height:1.45;
    width:100%; text-align:center;}
  .bubble:after{content:"";position:absolute;top:-8px;left:50%;transform:translateX(-50%);
    border:8px solid transparent;border-bottom-color:var(--card2)}
  .bubble small{color:var(--muted)}
  .mute{margin-left:8px; cursor:pointer; user-select:none; opacity:.8}

  .card{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin-bottom:12px}
  .folderrow{display:flex; align-items:center; justify-content:space-between; gap:10px}
  .folder{font-size:12.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
  .folder b{color:var(--ink)}
  .pill{display:inline-flex; align-items:center; gap:7px; padding:6px 11px; border-radius:999px; font-size:12px; font-weight:600;
        background:#0c0f14; border:1px solid var(--line); color:var(--muted); flex:0 0 auto}
  .pill .d{width:8px;height:8px;border-radius:50%;background:var(--muted)}
  .pill.locked{color:var(--warn)} .pill.locked .d{background:var(--warn);box-shadow:0 0 8px var(--warn)}
  .pill.unlocked{color:var(--ok)} .pill.unlocked .d{background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .pill.none{color:var(--muted)}
  .pill.bad{color:var(--bad)} .pill.bad .d{background:var(--bad)}

  textarea{width:100%; min-height:120px; resize:vertical; background:#0c0f14; color:#d8e6ff;
    border:1px solid var(--line); border-radius:10px; padding:12px; font-family:Consolas,"Courier New",monospace; font-size:13px}
  /* modern "digital / computer" button */
  .go{
    --glow:#5b8cff;
    position:relative; width:100%; margin-top:14px; cursor:pointer; overflow:hidden;
    padding:17px 18px 17px 40px; border-radius:14px; color:#eaf2ff;
    font-family:Consolas,"Courier New",monospace; font-size:15px; font-weight:800;
    text-transform:uppercase; letter-spacing:3px;
    background:
      repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 2px, transparent 2px 4px),
      linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.18)),
      linear-gradient(135deg, #1b2333, #10151f);
    border:1px solid color-mix(in srgb, var(--glow) 45%, transparent);
    box-shadow:0 0 0 1px rgba(255,255,255,.03) inset, 0 10px 26px rgba(0,0,0,.5),
               0 0 26px -8px var(--glow);
    transition:transform .06s ease, box-shadow .2s ease, border-color .2s ease;
  }
  .go:before{ /* sheen sweep */
    content:""; position:absolute; top:0; left:-45%; width:45%; height:100%;
    background:linear-gradient(120deg, transparent, rgba(255,255,255,.16), transparent);
    transform:skewX(-20deg); animation:sheen 3.4s ease-in-out infinite;
  }
  @keyframes sheen{0%{left:-45%}55%{left:135%}100%{left:135%}}
  .go:after{ /* pulsing LED */
    content:""; position:absolute; left:16px; top:50%; width:9px; height:9px; margin-top:-4.5px;
    border-radius:50%; background:var(--glow); box-shadow:0 0 10px var(--glow); animation:led 1.4s infinite;
  }
  @keyframes led{0%,100%{opacity:.45}50%{opacity:1}}
  .go:hover{ box-shadow:0 0 0 1px rgba(255,255,255,.05) inset, 0 12px 30px rgba(0,0,0,.55), 0 0 34px -4px var(--glow);
             border-color:color-mix(in srgb, var(--glow) 75%, transparent); }
  .go:active{ transform:translateY(1px) }
  .go:disabled{ opacity:.5; cursor:not-allowed }
  .go.unlock{ --glow:#22e08a }
  .go.lock{   --glow:#5b8cff }
  .go.set{    --glow:#ffb454 }
  /* slim status bar (folder path removed) */
  .statusbar{display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:14px}

  .out{margin-top:10px; background:#0c0f14; border:1px solid var(--line); border-radius:10px; padding:11px 13px;
       font-size:13px; color:var(--ink); min-height:20px; white-space:pre-wrap; display:none}
  .out.show{display:block}
  .out.ok{border-color:#1f5c3a} .out.bad{border-color:#5c2530} .out.warn{border-color:#5c471f}
</style>
</head>
<body class="${appMode === "guard" ? "guard" : ""}">
<div class="window-drag" aria-hidden="true"></div>
<div class="app">
  <div class="stage">
    <svg class="mascot" id="mascot" viewBox="0 0 120 132" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="face" cx="42%" cy="34%" r="75%">
          <stop offset="0" stop-color="#ffb057"/><stop offset="55%" stop-color="#ff8a2b"/><stop offset="100%" stop-color="#ef6f16"/>
        </radialGradient>
      </defs>
      <g id="body">
        <!-- legs + shoes -->
        <line x1="52" y1="90" x2="50" y2="112" stroke="#3a2a1a" stroke-width="4" stroke-linecap="round"/>
        <line x1="68" y1="90" x2="70" y2="112" stroke="#3a2a1a" stroke-width="4" stroke-linecap="round"/>
        <ellipse cx="47" cy="114" rx="9" ry="5" fill="#fff"/><ellipse cx="73" cy="114" rx="9" ry="5" fill="#fff"/>
        <!-- arms + gloves -->
        <path id="armL" d="M28 66 q-12 4 -16 14" stroke="#3a2a1a" stroke-width="4" fill="none" stroke-linecap="round"/>
        <circle cx="11" cy="82" r="6" fill="#fff" stroke="#3a2a1a" stroke-width="1.5"/>
        <g id="armR">
          <path d="M92 66 q12 2 17 -6" stroke="#3a2a1a" stroke-width="4" fill="none" stroke-linecap="round"/>
          <circle cx="110" cy="59" r="6" fill="#fff" stroke="#3a2a1a" stroke-width="1.5"/>
        </g>
        <!-- clock face -->
        <circle cx="60" cy="52" r="42" fill="url(#face)" stroke="#c9540d" stroke-width="3"/>
        <circle cx="60" cy="52" r="38" fill="none" stroke="#7a3a08" stroke-width="2"
                stroke-dasharray="1.6 8.3" stroke-linecap="round"/>
        <!-- hands -->
        <line id="hHour" x1="60" y1="52" x2="60" y2="34" stroke="#5a2c06" stroke-width="3" stroke-linecap="round"/>
        <line id="hMin"  x1="60" y1="52" x2="78" y2="52" stroke="#5a2c06" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="60" cy="52" r="3" fill="#3a2a1a"/>
        <!-- eyes with lashes -->
        <g>
          <ellipse cx="49" cy="44" rx="8" ry="10" fill="#fff" stroke="#3a2a1a" stroke-width="1.5"/>
          <ellipse cx="71" cy="44" rx="8" ry="10" fill="#fff" stroke="#3a2a1a" stroke-width="1.5"/>
          <!-- centered pupils: she looks directly at the user -->
          <circle cx="49" cy="44" r="4.6" fill="#2a1a0c"/><circle cx="71" cy="44" r="4.6" fill="#2a1a0c"/>
          <circle cx="47.5" cy="42.3" r="1.35" fill="#fff"/><circle cx="69.5" cy="42.3" r="1.35" fill="#fff"/>
          <path d="M41 36 l-4 -3 M44 33 l-2 -4" stroke="#3a2a1a" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M79 36 l4 -3 M76 33 l2 -4" stroke="#3a2a1a" stroke-width="1.6" stroke-linecap="round"/>
          <!-- eyelids for blink -->
          <ellipse class="lid" cx="49" cy="44" rx="8.4" ry="10.4" fill="url(#face)"/>
          <ellipse class="lid" cx="71" cy="44" rx="8.4" ry="10.4" fill="url(#face)"/>
        </g>
        <!-- nose + mouth -->
        <circle cx="60" cy="56" r="1.8" fill="#3a2a1a"/>
        <path id="mouth" d="M50 65 Q60 74 70 65 Q60 70 50 65 Z" fill="#5a2410"/>
      </g>
    </svg>
  </div>

  <div class="bubble" id="bubble">Hi Rayat sir, আপনি এসেছেন? আমার জন্য কী এনেছেন?</div>

  <div class="statusbar">
    <span class="pill none" id="pill"><span class="d"></span><span id="pilltext">…</span></span>
    <span class="mute" id="mute" title="Voice on/off">🔊</span>
  </div>

  <div class="card">
    <textarea id="secret" spellcheck="false" autofocus placeholder="আপনার secret function বা key দিন"></textarea>
    <button class="go" id="go" disabled>…</button>
    <div class="out" id="out"></div>
  </div>
</div>

<script>
const T = ${JSON.stringify(token)};
const SELF = ${JSON.stringify(self)};
const APP_MODE = ${JSON.stringify(appMode)};
const NATIVE_TTS = ${JSON.stringify(nativeTts)};
const $ = (id)=>document.getElementById(id);
const bubble=$("bubble"), mascot=$("mascot"), out=$("out"), go=$("go");
let status = null;

function say(html){ if(bubble) bubble.innerHTML = html; }
function eating(on){ mascot.classList.toggle("eating", !!on); }
function setOut(msg, kind){ out.textContent = msg||""; out.className = "out show" + (kind?(" "+kind):""); if(!msg) out.className="out"; }

// ---- female voice: cached neural audio, native Linux TTS, then browser fallback ----
let voiceOn = true;
let VOICES = [];
let currentAudio = null;
let currentAudioUrl = null;
let speechSequence = 0;
function loadVoices(){ try{ VOICES = window.speechSynthesis.getVoices() || []; }catch(e){ VOICES=[]; } }
loadVoices();
if(window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
function femaleVoice(langPrefix){
  const pref = ["zira","aria","jenny","michelle","hazel","susan","samantha","eva","female"];
  if(langPrefix){
    const matching = VOICES.filter(v=>(v.lang||"").toLowerCase().startsWith(langPrefix));
    for(const p of pref){ const v = matching.find(v=>(v.name||"").toLowerCase().includes(p)); if(v) return v; }
    if(matching[0]) return matching[0];
  }
  for(const p of pref){ const v = VOICES.find(v=>(v.name||"").toLowerCase().includes(p)); if(v) return v; }
  return VOICES.find(v=>/^en/i.test(v.lang||"")) || VOICES[0] || null;
}
function browserSpeak(text, opts){
  if(!window.speechSynthesis) return;
  opts = opts || {};
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const langPrefix = opts.lang ? opts.lang.slice(0,2).toLowerCase() : null;
    const v = femaleVoice(langPrefix); if(v) u.voice = v;
    if(opts.lang) u.lang = opts.lang;
    u.pitch = 1.35; u.rate = 1.0;   // higher pitch = cheerful, feminine
    u.onstart = ()=>mascot.classList.add("talking");
    u.onend   = ()=>mascot.classList.remove("talking");
    window.speechSynthesis.speak(u);
  }catch(e){}
}
function stopClientAudio(){
  if(currentAudio){ try{ currentAudio.pause(); currentAudio.currentTime=0; }catch(e){} currentAudio=null; }
  if(currentAudioUrl){ try{ URL.revokeObjectURL(currentAudioUrl); }catch(e){} currentAudioUrl=null; }
}
async function playNeuralVoice(text, lang, sequence){
  const res = await fetch("/api/neural-speak?t=" + T, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text:text,lang:lang})
  });
  if(!res.ok) throw new Error("neural voice unavailable");
  const blob = await res.blob();
  if(sequence!==speechSequence || !voiceOn || !blob.size) return false;
  stopClientAudio();
  currentAudioUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentAudioUrl);
  currentAudio.volume = 1;
  await currentAudio.play();
  return new Promise((resolve,reject)=>{
    currentAudio.onended=()=>{ stopClientAudio(); resolve(true); };
    currentAudio.onerror=()=>{ stopClientAudio(); reject(new Error("audio playback failed")); };
  });
}
function speak(text, opts){
  if(!voiceOn) return;
  opts = opts || {};
  const sequence = ++speechSequence;
  stopClientAudio();
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  if(NATIVE_TTS){
    mascot.classList.add("talking");
    const inferredLang = /[\u0980-\u09ff]/.test(text) ? "bn-BD" : "en-US";
    const lang = opts.lang||inferredLang;
    playNeuralVoice(text, lang, sequence)
      .then(()=>{ if(sequence===speechSequence) mascot.classList.remove("talking"); })
      .catch(()=>api("/api/speak", {text:text, lang:lang})
        .then(r=>{
          if(sequence!==speechSequence) return;
          mascot.classList.remove("talking");
          if(!r.ok) browserSpeak(text, opts);
        })
        .catch(()=>{ if(sequence===speechSequence){ mascot.classList.remove("talking"); browserSpeak(text, opts); } }));
    return;
  }
  browserSpeak(text, opts);
}
function wave(){ mascot.classList.remove("wave"); void mascot.offsetWidth; mascot.classList.add("wave"); }
function hi(){ mascot.classList.remove("hi"); void mascot.offsetWidth; mascot.classList.add("hi"); setTimeout(()=>mascot.classList.remove("hi"), 1000); }

$("mute").onclick = (e)=>{
  e.stopPropagation();
  voiceOn = !voiceOn;
  $("mute").textContent = voiceOn ? "🔊" : "🔇";
  if(!voiceOn){ speechSequence++; stopClientAudio(); if(window.speechSynthesis) window.speechSynthesis.cancel(); mascot.classList.remove("talking"); }
  else greet();
};

async function api(pathname, body){
  const res = await fetch(pathname + "?t=" + T, {
    method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body||{})
  });
  return res.json();
}

function applyPill(tk){
  const pill=$("pill"), txt=$("pilltext"); pill.className="pill";
  if(tk==="LOCKED_STATUS"){ pill.classList.add("locked"); txt.textContent="Locked"; }
  else if(tk==="UNLOCKED_STATUS"){ pill.classList.add("unlocked"); txt.textContent="Unlocked"; }
  else if(tk==="NOT_CONFIGURED"){ pill.classList.add("none"); txt.textContent="New"; }
  else { pill.classList.add("bad"); txt.textContent="?"; }
}

function updateButton(){
  go.disabled=false;
  if(APP_MODE==="guard"){
    go.textContent = status==="NOT_CONFIGURED" ? "Set Guard Key" : "Enter";
    go.className = status==="NOT_CONFIGURED" ? "go set" : "go unlock";
    return;
  }
  if(status==="NOT_CONFIGURED"){ go.textContent="Set Password"; go.className="go set"; }
  else if(status==="LOCKED_STATUS"){ go.textContent="🔓 Unlock"; go.className="go unlock"; }
  else if(status==="UNLOCKED_STATUS"){ go.textContent="🔒 Lock"; go.className="go lock"; }
  else { go.textContent="Refresh"; go.className="go"; }
}

async function refresh(){
  const r = await api("/api/status", {});
  status = r.token; applyPill(r.token); updateButton();
}

async function run(mode, secret, verb){
  go.disabled=true; eating(true); wave();
  say("Give me food, I will eat… <small>"+verb+" cholche…</small>");
  speak("Give me food, I will eat!"); setOut("");
  const r = await api("/api/"+mode, { secret });
  eating(false);
  const good = (r.code===0), partial = (r.token==="PARTIAL");
  setOut(r.message || r.raw || "", partial?"warn":(good?"ok":"bad"));
  if(good && mode==="lock"){ say("Yum! Locked and safe. 🔒"); speak("Yum! Locked and safe."); }
  else if(good && mode==="unlock"){ say("Access granted! 🔓 <small>ekhon kaj koro, bondho korle abar lock hobe.</small>"); speak("Access granted! You can work now."); }
  else if(good && mode==="setup"){ say("Password set! 🔑"); speak("Password set!"); }
  else { say("Hmm… <small>abar dekho.</small>"); speak("Hmm, that did not work. Try again."); }
  return good;
}

async function runGuard(secret){
  go.disabled=true; eating(true); wave(); setOut("");
  say("Key যাচাই করছি…");
  const r = await api("/api/guard", { secret, setup: status==="NOT_CONFIGURED" });
  eating(false);
  const good = r.code===0;
  setOut(r.message || "", good?"ok":"bad");
  if(good){
    say("স্বাগতম Rayat sir — access granted! 🔓");
    speak("স্বাগতম রায়াত স্যার", {lang:"bn-BD"});
  } else {
    say("Key মেলেনি। আবার চেষ্টা করুন।");
    speak("চাবি মেলেনি। আবার চেষ্টা করুন।", {lang:"bn-BD"});
    go.disabled=false;
  }
  return good;
}

let greeted = false;
function greet(){
  if(greeted) return;
  hi(); wave();
  say("Hi Rayat sir, আপনি এসেছেন? আমার জন্য কী এনেছেন?");
  var hasBn = VOICES.some(function(v){ return (v.lang||"").toLowerCase().indexOf("bn")===0; });
  if(NATIVE_TTS || hasBn) speak("হাই রায়াত স্যার, আপনি এসেছেন? আমার জন্য কী এনেছেন?", {lang:"bn-BD"});
  else speak("Hi Rayat sir, esechen? apni amar jonne ki enechen?");
  greeted = true;
}

go.onclick = async ()=>{
  const secret = $("secret").value;
  if(!secret.trim()){ setOut("Password ta likho.","warn"); return; }
  $("secret").value = "";          // key dewar sathe sathe box theke muche jabe
  if(APP_MODE==="guard"){
    await runGuard(secret);
    return;
  }
  if(status==="NOT_CONFIGURED"){
    if(await run("setup", secret, "Setup")){ await refresh(); if(status==="UNLOCKED_STATUS"){ await run("lock", secret, "Lock"); } }
  } else if(status==="LOCKED_STATUS"){
    await run("unlock", secret, "Unlock");
  } else if(status==="UNLOCKED_STATUS"){
    await run("lock", secret, "Lock");
  } else { /* nothing */ }
  await refresh();
};

// close the window -> server auto-locks (using the secret from this session) then exits
window.addEventListener("beforeunload", ()=>{ try{ navigator.sendBeacon("/api/shutdown"); }catch(e){} });

// greet on load; if the browser blocked audio before a gesture, greet on first interaction
window.addEventListener("load", ()=>{ setTimeout(greet, 400); });
window.addEventListener("pointerdown", function once(){ if(!greeted) greet(); window.removeEventListener("pointerdown", once); }, { once:false });

refresh();
</script>
</body>
</html>`;
}
