// ─────────────────────────────────────────────────────────────────────────────
// src/main/preload.js
// Bridge segura entre renderer e processo main via contextBridge
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("brita", {
  // Invoca um handler registrado no main process e retorna Promise<IpcResponse>
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
});
