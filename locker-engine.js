#!/usr/bin/env node
// locker-engine.js — the real work happens here (file walking + AES-256-GCM encryption/decryption),
// using Node's own audited crypto module rather than hand-rolled C++ crypto. locker.cpp is a thin
// front-end: it captures the secret function, hands it to this script via a temp file path, and
// relays this script's first output line (a status token) plus everything after it verbatim.
//
// Every locked file is: [12-byte IV][16-byte auth tag][ciphertext], written to "<original>.locked",
// with the original deleted. Nothing about the plaintext is ever written to .locker/ — only a salt
// and a verification hash (HMAC of a fixed label under the derived key), so a wrong secret is
// rejected before any file is touched.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SKIP_DIR_NAMES = new Set([".locker", "node_modules", "guard-state"]);
// locker's own files, plus the "guard" launcher (guard.ps1 / Open-Project.bat) — locking the
// door itself would tar it shut, so these are never encrypted.
const SKIP_FILE_NAMES = new Set([
  "locker.exe",
  "locker",
  "locker-engine.js",
  "guard.ps1",
  "Open-Project.bat",
  "app-server.js",
  "desktop-main.js",
  "folder-watch.py",
  "session-guard.sh",
  "locker-app.sh",
  "install.sh",
  "uninstall.sh",
  "launcher.ps1",
  "Locker-App.bat",
  "package.json",
  "package-lock.json",
]);
const LOCKED_SUFFIX = ".locked";
const VERIFY_LABEL = "locker-v1-verify";

function fail(token, message) {
  console.log(`RESULT:${token}`);
  if (message) console.log(message);
  process.exit(1);
}

function ok(token, message) {
  console.log(`RESULT:${token}`);
  if (message) console.log(message);
  process.exit(0);
}

function readSecretString(secretFilePath) {
  const text = fs.readFileSync(secretFilePath, "utf8");
  // "Whatever you type is your secret." Power users may pass a JS function literal, and its
  // return value becomes the secret. But if the text is not a callable function (e.g. a plain
  // password/phrase, or a function with a typo), the raw text itself is used as the secret.
  // So there is no "syntax error" dead end -- any non-empty input works.
  let fn;
  try {
    // eslint-disable-next-line no-eval
    fn = eval("(" + text + ")");
  } catch (e) {
    fn = undefined;
  }
  if (typeof fn === "function") {
    try {
      return String(fn());
    } catch (e) {
      /* function threw at runtime -> fall back to the raw text below */
    }
  }
  const raw = text.trim();
  return raw.length ? raw : null;
}

function configPath(folder) {
  return path.join(folder, ".locker", "config.json");
}

function manifestPath(folder) {
  return path.join(folder, ".locker", "manifest.json");
}

function loadConfig(folder) {
  const p = configPath(folder);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function loadManifest(folder) {
  const p = manifestPath(folder);
  if (!fs.existsSync(p)) return { files: [] };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { files: [] };
  }
}

function saveManifest(folder, manifest) {
  fs.mkdirSync(path.join(folder, ".locker"), { recursive: true });
  fs.writeFileSync(manifestPath(folder), JSON.stringify(manifest, null, 2));
}

/** scrypt is deliberately slow (defends the secret against offline guessing of a stolen config.json). */
function deriveKey(secretString, saltHex) {
  return crypto.scryptSync(secretString, Buffer.from(saltHex, "hex"), 32, { N: 16384, r: 8, p: 1 });
}

function verifyHashFor(key) {
  return crypto.createHmac("sha256", key).update(VERIFY_LABEL).digest("hex");
}

/** True if the given secret matches the stored config, without touching any locked file. */
function secretMatches(config, secretString) {
  if (secretString === null) return false;
  const key = deriveKey(secretString, config.salt);
  return verifyHashFor(key) === config.verifyHash;
}

/** Recursively lists real files under dir, skipping locker's own files, .locker/, and symlinks. */
function walkFiles(dir, results) {
  results = results || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return results;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walkFiles(full, results);
    } else if (entry.isFile()) {
      if (SKIP_FILE_NAMES.has(entry.name)) continue;
      if (entry.name.endsWith(LOCKED_SUFFIX)) continue; // already locked, lock() re-run should skip it
      results.push(full);
    }
  }
  return results;
}

function toRelSlash(folder, absPath) {
  return path.relative(folder, absPath).split(path.sep).join("/");
}

function fromRelSlash(folder, relSlash) {
  return path.join(folder, ...relSlash.split("/"));
}

function cmdSetup(folder, secretFilePath) {
  fs.mkdirSync(path.join(folder, ".locker"), { recursive: true });
  const existingManifest = loadManifest(folder);
  if (existingManifest.files && existingManifest.files.length > 0) {
    fail("ERROR", "এই ফোল্ডার এখন লক অবস্থায় আছে — আগে unlock করো, তারপর নতুন secret সেট করো।");
  }

  const secretString = readSecretString(secretFilePath);
  if (secretString === null) {
    fail("ERROR", "ফাংশনটা ঠিকমতো চলেনি (syntax ভুল, বা কিছু return করেনি)।");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const key = deriveKey(secretString, salt);
  const verifyHash = verifyHashFor(key);

  fs.writeFileSync(
    configPath(folder),
    JSON.stringify({ salt, verifyHash, createdAt: new Date().toISOString() }, null, 2)
  );
  saveManifest(folder, { files: [] });

  ok("OK", "✅ Secret সংরক্ষণ করা হলো। এই ফোল্ডার এখন lock করার জন্য প্রস্তুত।");
}

function cmdLock(folder, secretFilePath) {
  const config = loadConfig(folder);
  if (!config) fail("NOT_CONFIGURED", "প্রথমে 'locker setup' চালাও।");

  const manifest = loadManifest(folder);
  if (manifest.files && manifest.files.length > 0) {
    ok("ALREADY_LOCKED", `🔒 এই ফোল্ডার আগে থেকেই lock করা আছে (${manifest.files.length}টা ফাইল)।`);
  }

  const secretString = readSecretString(secretFilePath);
  if (!secretMatches(config, secretString)) {
    fail("DENIED", "❌ Access denied. কোনো ফাইল ছোঁয়া হয়নি।");
  }

  const key = deriveKey(secretString, config.salt);
  const files = walkFiles(folder);
  const lockedRelPaths = [];

  for (const absPath of files) {
    const buf = fs.readFileSync(absPath);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const out = Buffer.concat([iv, authTag, ciphertext]);

    const lockedPath = absPath + LOCKED_SUFFIX;
    fs.writeFileSync(lockedPath, out);
    fs.unlinkSync(absPath);
    lockedRelPaths.push(toRelSlash(folder, absPath));
  }

  saveManifest(folder, { files: lockedRelPaths, lockedAt: new Date().toISOString() });
  ok(
    "OK",
    `🔒 লক করা হলো — ${lockedRelPaths.length}টা ফাইল এনক্রিপ্ট করা হয়েছে।\n` +
      `Give me code, I will eat, and then I will work for you.`
  );
}

function cmdUnlock(folder, secretFilePath) {
  const config = loadConfig(folder);
  if (!config) fail("NOT_CONFIGURED", "এই ফোল্ডারে কোনো locker সেট করা নেই।");

  const manifest = loadManifest(folder);
  if (!manifest.files || manifest.files.length === 0) {
    ok("ALREADY_UNLOCKED", "✅ এই ফোল্ডার এখন unlocked অবস্থায় আছে। কিছু করার প্রয়োজন নেই।");
  }

  const secretString = readSecretString(secretFilePath);
  if (!secretMatches(config, secretString)) {
    fail("DENIED", "❌ Access denied. কিছু unlock করা হয়নি।");
  }

  const key = deriveKey(secretString, config.salt);
  const remaining = [];
  const failures = [];

  for (const relPath of manifest.files) {
    const lockedPath = fromRelSlash(folder, relPath) + LOCKED_SUFFIX;
    try {
      const raw = fs.readFileSync(lockedPath);
      const iv = raw.subarray(0, 12);
      const authTag = raw.subarray(12, 28);
      const ciphertext = raw.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      const outPath = fromRelSlash(folder, relPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, plaintext);
      fs.unlinkSync(lockedPath);
    } catch (e) {
      failures.push(relPath + " (" + e.message + ")");
      remaining.push(relPath);
    }
  }

  saveManifest(folder, { files: remaining, lockedAt: manifest.lockedAt });

  if (failures.length > 0) {
    // Exit code 2 (not 0): the folder did not fully unlock, and a script calling this should notice.
    // The failing .locked files are kept untouched so they can be inspected or restored from a backup.
    console.log("RESULT:PARTIAL");
    console.log(
      `⚠️  ${manifest.files.length - remaining.length}টা ফাইল unlock হয়েছে, কিন্তু ${failures.length}টা ফাইলে সমস্যা হয়েছে ` +
        `(ফাইলে কেউ হাত দিয়েছে বা ফাইল নষ্ট হয়েছে):\n` +
        failures.join("\n")
    );
    process.exit(2);
  }

  ok(
    "OK",
    `✅ Access granted — ${manifest.files.length}টা ফাইল unlock করা হলো। এবার তুমি এই প্রজেক্টে কাজ করতে পারো।`
  );
}

/** Check a secret without decrypting or changing any file. Used by the login/session guard. */
function cmdVerify(folder, secretFilePath) {
  const config = loadConfig(folder);
  if (!config) fail("NOT_CONFIGURED", "Guard key এখনো সেট করা হয়নি।");

  const secretString = readSecretString(secretFilePath);
  if (!secretMatches(config, secretString)) {
    fail("DENIED", "❌ Access denied. Key মেলেনি।");
  }

  ok("OK", "✅ Access granted.");
}

function cmdStatus(folder) {
  const config = loadConfig(folder);
  if (!config) ok("NOT_CONFIGURED", "এই ফোল্ডারে কোনো locker সেট করা নেই। ('locker setup' চালাও)");

  const manifest = loadManifest(folder);
  const n = (manifest.files || []).length;
  if (n === 0) {
    ok("UNLOCKED_STATUS", "✅ unlocked — এই ফোল্ডার এখন খোলা আছে।");
  }
  ok("LOCKED_STATUS", `🔒 locked — ${n}টা ফাইল এনক্রিপ্ট করা আছে (${manifest.lockedAt || "?"})।`);
}

function main() {
  const mode = process.argv[2];
  const folder = process.argv[3] ? path.resolve(process.argv[3]) : process.cwd();
  const secretFilePath = process.argv[4];

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    fail("ERROR", "ফোল্ডার পাওয়া যায়নি: " + folder);
  }

  switch (mode) {
    case "setup":
      return cmdSetup(folder, secretFilePath);
    case "lock":
      return cmdLock(folder, secretFilePath);
    case "unlock":
      return cmdUnlock(folder, secretFilePath);
    case "verify":
      return cmdVerify(folder, secretFilePath);
    case "status":
      return cmdStatus(folder);
    default:
      fail("ERROR", "অজানা mode: " + mode);
  }
}

main();
