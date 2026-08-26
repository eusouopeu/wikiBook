// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/claudeHandlers.js
// Dois modos de uso da API Anthropic:
//   1. claude:summarize — recebe texto bruto e devolve resumo em bullet points
//   2. claude:generate  — gera um artigo novo em bullet points a partir de um título
// ─────────────────────────────────────────────────────────────────────────────

const https = require("https");

const REQUEST_TIMEOUT_MS = 60_000;

// Retry com backoff exponencial só para falhas transitórias (rate limit,
// erro 5xx do servidor, erro de rede/timeout) — erros de request malformado
// ou credencial inválida (400/401/403) falham já na 1ª tentativa, sem retry.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [500, 1500, 4000];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: "POST",
        timeout: REQUEST_TIMEOUT_MS,
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let buf = "";
        res.on("data", c => buf += c);
        res.on("end", () => resolve({ status: res.statusCode, body: buf, headers: res.headers }));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Tempo esgotado após ${REQUEST_TIMEOUT_MS / 1000}s ao chamar a API da Anthropic.`)));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// opts (4º argumento) aceita tanto um número (maxTokens, compatibilidade com
// as chamadas antigas — sempre no modelo padrão claude-haiku-4-5, sem
// pensamento estendido) quanto um objeto { model, maxTokens, thinking,
// thinkingBudgetTokens, tools, toolChoice } — usado pela geração de trilha
// (path:generate), que precisa escolher modelo/pensamento e forçar saída
// estruturada via tool use.
async function callClaude(apiKey, systemPrompt, userMessage, opts = 800) {
  const o = typeof opts === "number" ? { maxTokens: opts } : opts;
  const body = {
    model: o.model ?? "claude-haiku-4-5-20251001",
    max_tokens: o.maxTokens ?? 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  if (o.thinking) {
    body.thinking = { type: "enabled", budget_tokens: o.thinkingBudgetTokens ?? 4000 };
    // Extended thinking exige temperatura padrão (1) e não é compatível com
    // forçar uma tool específica — só "auto" ou "any" continuam válidos.
    if (o.toolChoice?.type === "tool") delete o.toolChoice;
  }
  if (o.tools) body.tools = o.tools;
  if (o.toolChoice) body.tool_choice = o.toolChoice;

  const requestArgs = [
    "api.anthropic.com",
    "/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
  ];

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await httpsPost(...requestArgs);
    } catch (networkErr) {
      if (attempt >= RETRY_DELAYS_MS.length) throw networkErr;
      await sleep(RETRY_DELAYS_MS[attempt] + Math.random() * 200);
      continue;
    }

    if (res.status === 200) {
      const data = JSON.parse(res.body);
      if (o.tools) {
        const toolUse = data.content.find(b => b.type === "tool_use");
        if (!toolUse) throw new Error("Claude não retornou o bloco de tool use esperado.");
        return toolUse.input;
      }
      const textBlock = data.content.find(b => b.type === "text");
      return (textBlock?.text ?? "").trim();
    }

    const canRetry = RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length;
    if (!canRetry) {
      throw new Error(`Anthropic API status ${res.status}: ${res.body}`);
    }

    const retryAfter = Number(res.headers?.["retry-after"]);
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_DELAYS_MS[attempt];
    await sleep(delay + Math.random() * 200);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts e templates: fonte única em packages/shared/lib/claudePrompts.js,
// compartilhada com packages/mobile/src/platform/claude.ts (ver o comentário
// daquele arquivo para o porquê de ser .js/CommonJS em vez de .ts).
const {
  SYSTEM_SUMMARIZE, SYSTEM_ASK, GENERATE_TEMPLATES, resolveGenerateTemplate,
} = require("../../../../shared/lib/claudePrompts");

// ─────────────────────────────────────────────────────────────────────────────

// Cache em memória por termo normalizado — chamar summarize/generate de novo
// para o mesmo título (reabrir um artigo da Wikipedia já resumido, gerar o
// mesmo conceito duas vezes) reaproveita a resposta anterior em vez de pagar
// por uma chamada nova à API paga da Anthropic. Sem TTL: descartado ao
// fechar o app. Não se aplica a claude:ask (conversa contextual, cada
// pergunta é distinta por natureza).
const summarizeCache = new Map();
const generateCache = new Map();
function normTerm(s) { return (s ?? "").trim().toLowerCase(); }

function createClaudeHandlers(ipcMain) {

  // ── claude:summarize { text, title? } → { summary: string } ─────────────────
  // Gera resumo em bullet points a partir de texto já existente (ex.: extraído
  // da Wikipedia). Chamado automaticamente ao salvar um artigo da Wikipedia.
  // bypassCache: true no payload pula a leitura do cache (mas ainda grava o
  // resultado novo nele) — usado pelo botão "↺ Regenerar resumo" do
  // ArticleView, onde o usuário pede explicitamente uma resposta nova, não a
  // já vista antes.
  ipcMain.handle("claude:summarize", async (_evt, { text, title = "", bypassCache = false }) => {
    try {
      const cacheKey = normTerm(title) || normTerm(text.slice(0, 200));
      if (!bypassCache && summarizeCache.has(cacheKey)) {
        return { ok: true, data: { summary: summarizeCache.get(cacheKey) } };
      }

      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) {
        return { ok: false, error: "API key da Anthropic não configurada." };
      }

      const userMsg = title
        ? `Título: ${title}\n\nTexto:\n${text.slice(0, 6000)}`
        : text.slice(0, 6000);

      const summary = await callClaude(apiKey, SYSTEM_SUMMARIZE, userMsg, 600);
      summarizeCache.set(cacheKey, summary);
      return { ok: true, data: { summary } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── claude:generate { title, context? } → { summary: string } ────────────────
  // Gera um artigo novo em bullet points quando o usuário não quer buscar
  // na Wikipedia e prefere pedir ao Claude diretamente.
  // context: texto opcional de outros artigos relacionados para dar contexto
  ipcMain.handle("claude:generate", async (_evt, { title, context = "", templateId = "padrao" }) => {
    try {
      const template = resolveGenerateTemplate(templateId);
      const cacheKey = `${template === GENERATE_TEMPLATES.padrao ? "padrao" : templateId}::${normTerm(title)}::${normTerm(context.slice(0, 200))}`;
      if (generateCache.has(cacheKey)) return { ok: true, data: { summary: generateCache.get(cacheKey) } };

      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) {
        return { ok: false, error: "API key da Anthropic não configurada." };
      }

      const userMsg = context
        ? `Conceito: ${title}\n\nContexto adicional (artigos relacionados na minha base):\n${context.slice(0, 2000)}`
        : `Conceito: ${title}`;

      const summary = await callClaude(apiKey, template.systemPrompt, userMsg, 800);
      generateCache.set(cacheKey, summary);
      return { ok: true, data: { summary } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── claude:generateTemplates → lista de templates disponíveis ────────────────
  // Consultado pelo modal de "Novo artigo" para popular o seletor — mantém a
  // lista (ids + rótulos) definida num único lugar (main process).
  ipcMain.handle("claude:generateTemplates", () => {
    return {
      ok: true,
      data: Object.entries(GENERATE_TEMPLATES).map(([id, t]) => ({ id, label: t.label })),
    };
  });

  // ── claude:ask { question, articleTitle, articleText, relatedContext? } ─────
  // Chat contextual: responde uma pergunta usando o artigo aberto (e títulos de
  // artigos vinculados/backlinks) como contexto. Sem histórico persistido —
  // cada pergunta é independente (mais simples e suficiente para o caso de uso).
  ipcMain.handle("claude:ask", async (_evt, { question, articleTitle, articleText, relatedContext = "" }) => {
    try {
      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) {
        return { ok: false, error: "API key da Anthropic não configurada." };
      }

      const userMsg = [
        `Artigo: ${articleTitle}`,
        `Conteúdo:\n${articleText.slice(0, 6000)}`,
        relatedContext ? `\nArtigos relacionados:\n${relatedContext.slice(0, 1500)}` : "",
        `\nPergunta: ${question}`,
      ].filter(Boolean).join("\n");

      const answer = await callClaude(apiKey, SYSTEM_ASK, userMsg, 500);
      return { ok: true, data: { answer } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

}

module.exports = { createClaudeHandlers, callClaude };
