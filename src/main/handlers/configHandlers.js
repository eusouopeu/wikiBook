// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/configHandlers.js
// Persistência de configurações (API key, preferências)
// Salvo em: userData/config.json
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

let _cache = null;

function loadConfig() {
  if (_cache) return _cache;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      _cache = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      _cache = {};
    }
  } else {
    _cache = {};
  }
  return _cache;
}

function saveConfig(config) {
  _cache = config;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// Exportado para uso interno nos outros handlers (ex.: claudeHandlers)
function getConfig(key) {
  return loadConfig()[key];
}

function createConfigHandlers(ipcMain) {

  // ── config:get { key? } → value | entire config ────────────────────────────
  ipcMain.handle("config:get", (_evt, { key } = {}) => {
    const config = loadConfig();
    return { ok: true, data: key ? config[key] : config };
  });

  // ── config:set { key, value } ──────────────────────────────────────────────
  ipcMain.handle("config:set", (_evt, { key, value }) => {
    const config = loadConfig();
    config[key] = value;
    saveConfig(config);
    return { ok: true };
  });
}

module.exports = { createConfigHandlers, getConfig };
