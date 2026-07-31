// ─────────────────────────────────────────────────────────────────────────────
// scripts/dev-electron.js
// Runner de desenvolvimento: sobe o Electron e o REINICIA automaticamente sempre
// que um arquivo do processo principal (src/main/**) ou de tipos compartilhados
// (src/shared/**) muda. Sem isso, o `electron .` fica preso na versão do código
// carregada na inicialização, e mudanças no main process só entram após fechar e
// reabrir o app manualmente.
//
// O renderer (src/renderer/**) continua sendo reconstruído pelo esbuild --watch;
// como um restart do main também recarrega a janela, mudanças de interface entram
// no próximo restart — ou recarregue a janela com ⌘R para vê-las na hora.
// ─────────────────────────────────────────────────────────────────────────────

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const electronBin = require("electron");                 // caminho do binário do Electron
const WATCH_DIRS = ["src/main", "src/shared"].map(d => path.join(ROOT, d));

let child = null;
let restarting = false;
let debounce = null;

function start() {
  restarting = false;
  child = spawn(electronBin, ["."], { stdio: "inherit", cwd: ROOT });
  child.on("close", code => {
    if (restarting) { start(); return; }               // fechou por causa de um restart nosso
    process.exit(code ?? 0);                            // usuário fechou o app → encerra o dev
  });
}

function restart() {
  if (!child || restarting) return;
  restarting = true;
  console.log("\n[dev] mudança no main process detectada — reiniciando Electron…\n");
  child.kill();                                          // o handler de 'close' respawna
}

for (const dir of WATCH_DIRS) {
  try {
    fs.watch(dir, { recursive: true }, (_evt, file) => {
      if (file && !/\.(js|ts|json)$/.test(file)) return; // ignora temporários do editor
      clearTimeout(debounce);
      debounce = setTimeout(restart, 150);               // agrupa rajadas de eventos
    });
  } catch (e) {
    console.warn(`[dev] não foi possível observar ${dir}: ${e.message}`);
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { restarting = false; if (child) child.kill(); process.exit(0); });
}

start();
