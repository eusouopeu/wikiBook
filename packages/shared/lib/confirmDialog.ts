// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/confirmDialog.ts
// Confirmação nativa cross-platform via o canal IPC comum ("dialog:confirm"),
// implementado no Electron (dialog.showMessageBox) e no mobile
// (@capacitor/dialog Dialog.confirm) — evita usar window.confirm() em
// componentes compartilhados: dentro da WebView do Capacitor ele renderiza
// com estilo inconsistente com o resto do app, especialmente ruim numa
// confirmação destrutiva. Cai para window.confirm() só se o canal não
// existir (ex.: preview de browser fora do shell desktop/mobile).
// ─────────────────────────────────────────────────────────────────────────────

export async function confirmDialog(message: string, title = "Confirmar"): Promise<boolean> {
  try {
    const res = await window.lexicon.invoke("dialog:confirm", { title, message });
    if (res.ok) return Boolean((res.data as { confirmed: boolean } | undefined)?.confirmed);
  } catch {
    // canal indisponível — cai para o confirm() do browser abaixo
  }
  return window.confirm(message);
}
