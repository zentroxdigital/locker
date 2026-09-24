# Locker Kit — সেটআপ গাইড

যেকোনো প্রজেক্ট ফোল্ডারকে **AES-256-GCM** দিয়ে সত্যিকারভাবে এনক্রিপ্ট করে তালা মেরে দেয়, একটা
graphical desktop অ্যাপ থেকে। system-wide install বা admin লাগে না। ফোল্ডার **default-এ locked** থাকে; কাজ করার
সময় অ্যাপ খুলে unlock করো, window বন্ধ করলেই **নিজে থেকে আবার lock**।

---

## ১. যা লাগবে (একবারের প্রস্তুতি)

- **Node.js 22.12 বা নতুন version** ইনস্টল থাকতে হবে। চেক করতে PowerShell-এ: `node --version`
  (না থাকলে https://nodejs.org থেকে LTS নামিয়ে ইনস্টল করো।)
- প্রথমবার install করার সময় internet লাগবে; installer Electron desktop runtime নামাবে। Edge/Chrome লাগে না।

---

## ২. PC-তে একবার install (সবচেয়ে সহজ — কপি করা লাগে না)

**ধাপ ১ —** এই kit ফোল্ডারের **`Install.bat`-এ একবার double-click** করো (per-user, admin লাগে না)।
এটা টুল ফাইলগুলো `%LOCALAPPDATA%\Locker`-এ কপি করে, right-click মেনু আর CLI যোগ করে।

**ধাপ ২ —** এখন **যেকোনো ফোল্ডারে right-click → "Open with Locker"** → অ্যাপ খুলবে ঐ ফোল্ডার ধরে।
> Windows 11-এ custom মেনু **"Show more options"** (বা `Shift+F10`)-এর নিচে থাকে।

**ধাপ ৩ (প্রথমবার কোনো ফোল্ডারে) —** status **"New"** → secret function লিখে **Set Password** →
setup হয়ে **lock** হয়ে যাবে। এরপর প্রতিবার: right-click → Open → **Unlock** → কাজ → **window বন্ধ = auto-lock**।

**অন্য PC-তে:** সেই PC-তে এই kit নিয়ে গিয়ে আবার একবার `Install.bat` চালাও — ব্যস।
**Uninstall:** `Uninstall.bat` (right-click মেনু + PATH সরায়; locked ফোল্ডার আগে unlock করে নিও)।

### Linux Mint

Terminal-এ kit folder থেকে একবার `bash install.sh` চালাও। এরপর Nemo/Files-এ folder right-click →
**Open with Locker**। অ্যাপটি browser-এ নয়, আলাদা Electron desktop window-এ খুলবে।

### বিকল্প: শুধু একটা ফোল্ডারে (install ছাড়া)
Install করতে না চাইলে পুরো kit folder-এ একবার `npm install` এবং `node node_modules/electron/install.js`
চালাও। এরপর Windows-এ `Locker-App.bat`, অথবা Linux-এ `./locker-app.sh` চালালেই হবে।

---

## ৩. Secret function কেমন হবে (গুরুত্বপূর্ণ)

Secret হলো একটা JavaScript function। **এটা যা `return` করে শুধু সেটা থেকেই key তৈরি হয়** — function-এর
নাম বা ভেতরের লজিক key-তে যায় না। তাই:

- return value-টা এমন দাও যা **শুধু তুমি জানো ও সহজে অনুমান করা যায় না**:
  ```js
  function myKey(){
    return "esR@yat-2019#Khuje-Nao-8f3kQ!zPmr-only-in-my-head";
  }
  ```
- ⚠️ `return "Access Granted"` জাতীয় common string দিও না — সহজে অনুমানযোগ্য।
- function সবসময় **একই জিনিস return** করতে হবে (random/date/time ব্যবহার করবে না)।

---

## ৪. মনে রাখার নিয়ম

- **Default-এ locked রাখো।** কাজ শেষে window বন্ধ = auto-lock। disk-এ কেউ ঢুকলে গিবারিশ পাবে।
- **Secret কোথাও save হয় না** — প্রতিবার চায়, session শেষে RAM থেকেও মুছে যায়। তাই function-টা
  **নিরাপদ জায়গায় নিজে লিখে রাখো** — ভুলে গেলে **কোনো recovery নেই**।
- **Delete করার আগে unlock করো।** Locked অবস্থায় `.locker/` ফোল্ডার বা locker ফাইলগুলো মুছলে
  ডেটা আর ফেরানো যাবে না (`config.json`-এর salt ছাড়া সঠিক password দিয়েও unlock হয় না)।
- **Backup রাখো** — হ্যাকার পড়তে না পারলেও ফাইল মুছে দিতে পারে। locked অবস্থায় backup রাখলে সেটাও
  নিরাপদ (গিবারিশ)।
- unlock করা অবস্থায় ফাইল plaintext — তখন server/host/অন্য কেউ পড়তে পারবে। **locked অবস্থায় কোনো
  ফোল্ডার host/serve করা যায় না** (গিবারিশ)।

---

## ৫. CLI বিকল্প (অ্যাপ ছাড়া, ঐচ্ছিক)

`locker.exe` কপি করলে PowerShell থেকেও চালাতে পারবে:

```powershell
.\locker.exe setup  "D:\path\to\project"
.\locker.exe lock   "D:\path\to\project"
.\locker.exe unlock "D:\path\to\project"
.\locker.exe status "D:\path\to\project"
```

---

## ৬. ফাইলগুলো কী করে

| ফাইল | কাজ |
|---|---|
| `locker-engine.js` | আসল এনক্রিপশন (AES-256-GCM, scrypt key derivation) — cross-platform Node |
| `app-server.js` | graphical অ্যাপ (mascot + digital UI); engine-কেই চালায়, নতুন crypto না |
| `desktop-main.js` | Windows/Linux-এ native Electron window ও app lifecycle চালায় |
| `launcher.ps1` / `locker-app.sh` | desktop app চালু করে; window বন্ধ হলে auto-lock শেষ করে server থামায় |
| `Locker-App.bat` | 👈 double-click করার ফাইল (terminal ছাড়া অ্যাপ খোলে) |
| `locker.exe` | ঐচ্ছিক CLI front-end |

> এই locker ফাইলগুলো lock করার সময় নিজে থেকে বাদ (skip) থাকে — তাই lock করলে অ্যাপ নিজে আটকে যায় না।
