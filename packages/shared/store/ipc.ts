// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/ipc.ts
// Ponte com o host (preload do Electron / bridge do Capacitor) usada pelas
// fatias do store.
// ─────────────────────────────────────────────────────────────────────────────

// Tipo do bridge exposto pelo preload
declare global {
  interface Window {
    lexicon: {
      invoke: (channel: string, payload?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    };
  }
}

export async function ipc<T>(channel: string, payload?: unknown): Promise<T> {
  const res = await window.lexicon.invoke(channel, payload);
  if (!res.ok) throw new Error(res.error ?? "IPC error");
  return res.data as T;
}
