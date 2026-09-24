"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const net = require("net");
const path = require("path");

const APP_DIR = __dirname;
const SERVER_FILE = path.join(APP_DIR, "app-server.js");

let mainWindow = null;
let serverProcess = null;
let baseUrl = null;
let token = null;
let shuttingDown = false;
let allowWindowClose = false;

function targetFromArguments() {
  const prefix = "--locker-target=";
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return path.resolve(argument ? argument.slice(prefix.length) : APP_DIR);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolve(address.port));
    });
  });
}

function request(pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    if (!baseUrl) return reject(new Error("Locker server is not running"));
    const requestUrl = new URL(pathname, baseUrl);
    const req = http.request(requestUrl, { method, timeout: 1500 }, (res) => {
      res.resume();
      res.once("end", () => resolve(res.statusCode));
    });
    req.once("timeout", () => req.destroy(new Error("Request timed out")));
    req.once("error", reject);
    req.end();
  });
}

async function waitForServer() {
  let lastError = null;
  for (let attempt = 0; attempt < 75; attempt += 1) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error("Locker server stopped before the window could open");
    }
    try {
      const status = await request(`/ping?t=${encodeURIComponent(token)}`);
      if (status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw lastError || new Error("Locker server did not start");
}

async function startServer(target) {
  const port = await reservePort();
  token = crypto.randomBytes(16).toString("hex");
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, [SERVER_FILE, String(port), token, target], {
    cwd: APP_DIR,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let serverError = "";
  serverProcess.stderr.on("data", (chunk) => { serverError += String(chunk); });
  serverProcess.once("error", (error) => { serverError += error.message; });
  serverProcess.once("exit", () => {
    serverProcess = null;
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox("Locker", serverError.trim() || "Locker server unexpectedly stopped.");
      allowWindowClose = true;
      mainWindow.close();
    }
  });

  await waitForServer();
}

function waitForServerExit() {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.exitCode !== null) return resolve();
    serverProcess.once("exit", resolve);
  });
}

async function shutdownAndQuit() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();

  if (serverProcess) {
    try {
      await request("/api/shutdown", "POST");
    } catch (_) {
      // If the server is already gone there is nothing left to shut down.
    }
    await waitForServerExit();
  }

  allowWindowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
}

async function createWindow() {
  const target = targetFromArguments();
  await startServer(target);

  mainWindow = new BrowserWindow({
    width: 500,
    height: 700,
    minWidth: 430,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0e1116",
    title: "Locker",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(baseUrl + "/")) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (allowWindowClose) return;
    event.preventDefault();
    shutdownAndQuit();
  });

  await mainWindow.loadURL(`${baseUrl}/?t=${encodeURIComponent(token)}`);
}

app.setName("Locker Kit");
app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox("Locker could not start", error.message || String(error));
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on("before-quit", (event) => {
  if (allowWindowClose || shuttingDown || !serverProcess) return;
  event.preventDefault();
  shutdownAndQuit();
});

app.on("window-all-closed", () => {
  if (!shuttingDown) shutdownAndQuit();
});
