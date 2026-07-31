// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/config.ts
// Porta de packages/desktop/src/main/handlers/configHandlers.js.
// Mesma política de segurança do desktop: só a API key da Anthropic é
// sensível — lá vai para o Keychain via safeStorage, aqui vai para o
// Keychain/Keystore via capacitor-secure-storage-plugin. O resto (idioma da
// Wikipedia etc.) usa @capacitor/preferences, não sensível.
//
// Simplificação sinalizada: o desktop's config:get sem `key` devolve TODAS as
// chaves, inclusive a API key decriptada. Como nenhum fluxo real do app chama
// config:get sem key para segredos (SettingsModal sempre pede
// "anthropicApiKey" explicitamente), a versão mobile do "dump geral" só
// devolve as preferências não sensíveis — chaves secretas exigem key
// explícita. Mais seguro por padrão, sem mudar nenhum comportamento do app.
// ─────────────────────────────────────────────────────────────────────────────

import { Preferences } from "@capacitor/preferences";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

const SECRET_KEYS = new Set(["anthropicApiKey"]);

async function getSecureValue(key: string): Promise<string | undefined> {
  try {
    const { value } = await SecureStoragePlugin.get({ key });
    return value;
  } catch {
    return undefined; // chave nunca foi definida
  }
}

export async function getConfigValue(key: string): Promise<string | undefined> {
  if (SECRET_KEYS.has(key)) return getSecureValue(key);
  const { value } = await Preferences.get({ key });
  return value ?? undefined;
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const { keys } = await Preferences.keys();
  const out: Record<string, string> = {};
  for (const k of keys) {
    const { value } = await Preferences.get({ key: k });
    if (value != null) out[k] = value;
  }
  return out;
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  if (SECRET_KEYS.has(key)) {
    await SecureStoragePlugin.set({ key, value });
    return;
  }
  await Preferences.set({ key, value });
}
