// ─────────────────────────────────────────────────────────────────────────────
// src/main/main.js
// Processo principal do Electron
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
const path = require("path");

const { createArticleHandlers } = require("./handlers/articleHandlers");
const { createWikipediaHandlers } = require("./handlers/wikipediaHandlers");
const { createClaudeHandlers } = require("./handlers/claudeHandlers");
const { createConfigHandlers } = require("./handlers/configHandlers");
const { createFlashcardHandlers } = require("./handlers/flashcardHandlers");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",   // macOS: barra integrada ao conteúdo
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f0f0f" : "#f7f4ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Em dev carrega o bundle gerado pelo esbuild; em prod o mesmo
  mainWindow.loadFile(path.join(__dirname, "../../index.html"));

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  }
}

app.whenReady().then(() => {
  // Registra todos os handlers IPC
  createArticleHandlers(ipcMain);
  createWikipediaHandlers(ipcMain);
  createClaudeHandlers(ipcMain);
  createConfigHandlers(ipcMain);
  createFlashcardHandlers(ipcMain);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
