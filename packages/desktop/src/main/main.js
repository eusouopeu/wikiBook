// ─────────────────────────────────────────────────────────────────────────────
// src/main/main.js
// Processo principal do Electron
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require("electron");
const path = require("path");

const { createArticleHandlers } = require("./handlers/articleHandlers");
const { createWikipediaHandlers } = require("./handlers/wikipediaHandlers");
const { createClaudeHandlers } = require("./handlers/claudeHandlers");
const { createConfigHandlers, getConfig } = require("./handlers/configHandlers");
const { createFlashcardHandlers } = require("./handlers/flashcardHandlers");
const { createSyncHandlers } = require("./handlers/syncHandlers");

let mainWindow = null;

const THEME_BG = { light: "#f7f4ee", dark: "#0f0f0f" };
function backgroundColorFor(theme) {
  if (theme === "light" || theme === "dark") return THEME_BG[theme];
  return nativeTheme.shouldUseDarkColors ? THEME_BG.dark : THEME_BG.light;
}

function createWindow() {
  // Aplica o tema manual salvo (se houver) ANTES de ler nativeTheme.shouldUseDarkColors,
  // senão a janela nasce com a cor do SO e só o CSS do renderer reflete a escolha do
  // usuário — qualquer repaint nativo (resize, restore) pisca com o fundo errado.
  const savedTheme = getConfig("theme");
  if (savedTheme === "light" || savedTheme === "dark") nativeTheme.themeSource = savedTheme;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",   // macOS: barra integrada ao conteúdo
    backgroundColor: backgroundColorFor(savedTheme),
    icon: path.join(__dirname, "../../build/icon.png"),
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
  // Em dev, o dock do macOS usa o ícone do Electron por padrão — em produção
  // (build empacotado) o "icon" do electron-builder já cuida disso.
  if (process.platform === "darwin" && process.env.NODE_ENV === "development") {
    app.dock?.setIcon(path.join(__dirname, "../../build/icon.png"));
  }

  // Registra todos os handlers IPC
  createArticleHandlers(ipcMain);
  createWikipediaHandlers(ipcMain);
  createClaudeHandlers(ipcMain);
  createConfigHandlers(ipcMain, {
    onThemeChange: (theme) => {
      nativeTheme.themeSource = theme === "light" || theme === "dark" ? theme : "system";
      mainWindow?.setBackgroundColor(backgroundColorFor(theme));
    },
  });
  createFlashcardHandlers(ipcMain);
  createSyncHandlers(ipcMain);

  // Confirmação nativa cross-platform (ver packages/shared/lib/confirmDialog.ts)
  // — usada por componentes compartilhados com o mobile, onde window.confirm()
  // renderiza com estilo inconsistente dentro da WebView do Capacitor.
  ipcMain.handle("dialog:confirm", async (_evt, { title, message } = {}) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Cancelar", "Confirmar"],
      defaultId: 1,
      cancelId: 0,
      title: title ?? "Confirmar",
      message: message ?? "",
    });
    return { ok: true, data: { confirmed: result.response === 1 } };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
