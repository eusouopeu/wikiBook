// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/pathHandlers.js
// Trilhas de aprendizado (percurso guiado estilo Duolingo, ver
// packages/shared/shared/types.ts/LearningPath). Dois usos do Claude:
//   1. path:consolidateProfile — resume as respostas do roteiro fixo de
//      entrevista (ver packages/shared/lib/interviewScript.ts) num perfil
//      curto. Sempre no modelo padrão (barato) — não é a parte que precisa
//      de raciocínio forte.
//   2. path:generate — gera a trilha inteira (unidades/passos/recursos) via
//      tool use (schema forçado, sem parser artesanal de texto). Modelo
//      escolhido pelo usuário na tab-pill do wizard (ver
//      packages/shared/lib/pathModels.ts).
// Persistência: um arquivo <id>.json por trilha em userData/paths/, igual ao
// padrão de articleHandlers.js — sem lixeira/histórico (trilha é regenerável
// a qualquer momento, diferente de um artigo escrito à mão).
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { callClaude } = require("./claudeHandlers");
const { searchWikipedia } = require("./wikipediaHandlers");

const DATA_DIR = path.join(app.getPath("userData"), "paths");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function pathFile(id) { return path.join(DATA_DIR, `${id}.json`); }

function writeAtomic(filePath, data) {
  fs.writeFileSync(filePath + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(filePath + ".tmp", filePath);
}

// ── Modelos de geração ──────────────────────────────────────────────────────
// Fonte única em packages/shared/lib/claudePrompts.js (PATH_MODELS) —
// compartilhada com packages/mobile/src/platform/claude.ts.
const {
  PATH_MODELS: MODEL_CATALOG,
  SYSTEM_GENERATE_PATH,
  GENERATE_PATH_TOOL,
} = require("../../../../shared/lib/claudePrompts");
function resolveModel(id) { return MODEL_CATALOG[id] ?? MODEL_CATALOG["sonnet-standard"]; }

// materializeUnits/materializeResources (monta unidades/passos/recursos a
// partir da resposta bruta do Claude) são compartilhados com
// packages/mobile/src/platform/claude.ts — só a busca na Wikipédia e a
// geração de id variam por plataforma, injetadas abaixo em MATERIALIZE_DEPS.
const { materializeUnits } = require("../../../../shared/lib/pathMaterialize");
const MATERIALIZE_DEPS = { searchWikipedia, makeId: () => crypto.randomUUID() };

// ── path:consolidateProfile ─────────────────────────────────────────────────
const SYSTEM_CONSOLIDATE = `
Você é um assistente que resume uma entrevista de nivelamento de aprendizado.
Dado um objetivo de aprendizado e uma lista de perguntas/respostas, produza um
perfil curto em português brasileiro, em 4 a 6 frases corridas (sem bullets),
cobrindo: nível de experiência atual, meta concreta, tempo disponível por
semana, recursos/condições disponíveis, formato preferido e possíveis
obstáculos. Seja direto e específico — este perfil vai guiar a geração de uma
trilha de estudo estruturada.
Responda APENAS com o perfil, sem título, sem introdução.
`.trim();

// ── path:generate ───────────────────────────────────────────────────────────
// SYSTEM_GENERATE_PATH/GENERATE_PATH_TOOL vêm de
// packages/shared/lib/claudePrompts.js — compartilhados com
// packages/mobile/src/platform/claude.ts.

function createPathHandlers(ipcMain) {

  ipcMain.handle("path:list", () => {
    ensureDataDir();
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
    const paths = files.map(f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")));
    paths.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return { ok: true, data: paths };
  });

  ipcMain.handle("path:get", (_evt, { id }) => {
    try {
      const data = JSON.parse(fs.readFileSync(pathFile(id), "utf8"));
      return { ok: true, data };
    } catch {
      return { ok: false, error: "Trilha não encontrada." };
    }
  });

  ipcMain.handle("path:save", (_evt, { path: learningPath }) => {
    ensureDataDir();
    const now = new Date().toISOString();
    const record = {
      ...learningPath,
      id: learningPath.id ?? crypto.randomUUID(),
      createdAt: learningPath.createdAt ?? now,
      updatedAt: now,
    };
    writeAtomic(pathFile(record.id), record);
    return { ok: true, data: record };
  });

  ipcMain.handle("path:delete", (_evt, { id }) => {
    try { fs.unlinkSync(pathFile(id)); } catch { /* já não existia */ }
    return { ok: true };
  });

  ipcMain.handle("path:consolidateProfile", async (_evt, { goal, answers }) => {
    try {
      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) return { ok: false, error: "API key da Anthropic não configurada." };

      const qa = (answers ?? [])
        .map(a => `P: ${a.question}\nR: ${a.answer}`)
        .join("\n\n");
      const userMsg = `Objetivo: ${goal}\n\n${qa}`;
      const profileSummary = await callClaude(apiKey, SYSTEM_CONSOLIDATE, userMsg, 500);
      return { ok: true, data: { profileSummary } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("path:generate", async (_evt, { goal, profileSummary, model, lang = "pt" }) => {
    try {
      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) return { ok: false, error: "API key da Anthropic não configurada." };

      const m = resolveModel(model);
      const userMsg = `Objetivo de aprendizado: ${goal}\n\nPerfil do estudante:\n${profileSummary}`;
      const result = await callClaude(apiKey, SYSTEM_GENERATE_PATH, userMsg, {
        model: m.apiModel,
        maxTokens: m.maxTokens,
        thinking: m.thinking,
        thinkingBudgetTokens: m.thinkingBudgetTokens,
        tools: [GENERATE_PATH_TOOL],
        toolChoice: { type: "tool", name: "emit_learning_path" },
      });

      const units = await materializeUnits(result.units ?? [], lang, MATERIALIZE_DEPS);
      return { ok: true, data: { units } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { createPathHandlers };
