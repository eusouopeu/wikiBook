// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/configHandlers.js
// Persistência de configurações (API key, preferências)
// Salvo em: userData/config.json
// Chaves sensíveis (API key) são criptografadas via safeStorage (Keychain no
// macOS). Valores legados em texto puro continuam legíveis e são migrados
// na próxima gravação.
// ─────────────────────────────────────────────────────────────────────────────

const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

// Chaves que devem ser criptografadas em disco — syncToken dá acesso de
// leitura/escrita à biblioteca inteira no servidor de sync, tratado como
// segredo igual à API key.
const SECRET_KEYS = new Set(["anthropicApiKey", "syncToken"]);
const ENC_PREFIX = "enc:v1:";

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

function encryptValue(value) {
  if (typeof value !== "string" || !safeStorage.isEncryptionAvailable()) return value;
  return ENC_PREFIX + safeStorage.encryptString(value).toString("base64");
}

function decryptValue(value) {
  if (typeof value !== "string" || !value.startsWith(ENC_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), "base64"));
  } catch {
    return "";
  }
}

// Exportado para uso interno nos outros handlers (ex.: claudeHandlers)
function getConfig(key) {
  const raw = loadConfig()[key];
  return SECRET_KEYS.has(key) ? decryptValue(raw) : raw;
}

// Exportado para uso interno (ex.: syncHandlers, que grava as pastas
// mescladas de volta na config sem passar pelo IPC config:set)
function setConfig(key, value) {
  const config = loadConfig();
  config[key] = SECRET_KEYS.has(key) ? encryptValue(value) : value;
  saveConfig(config);
}

function createConfigHandlers(ipcMain, { onThemeChange } = {}) {

  // ── config:get { key? } → value | entire config ────────────────────────────
  ipcMain.handle("config:get", (_evt, { key } = {}) => {
    const config = loadConfig();
    if (key) return { ok: true, data: getConfig(key) };
    // Config completa: devolve segredos já decriptados
    const out = {};
    for (const k of Object.keys(config)) {
      out[k] = SECRET_KEYS.has(k) ? decryptValue(config[k]) : config[k];
    }
    return { ok: true, data: out };
  });

  // ── config:set { key, value } ──────────────────────────────────────────────
  ipcMain.handle("config:set", (_evt, { key, value }) => {
    const config = loadConfig();
    config[key] = SECRET_KEYS.has(key) ? encryptValue(value) : value;
    saveConfig(config);
    if (key === "theme") onThemeChange?.(value);
    return { ok: true };
  });
}

module.exports = { createConfigHandlers, getConfig, setConfig };
