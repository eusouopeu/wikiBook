// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/claudeHandlers.js
// Dois modos de uso da API Anthropic:
//   1. claude:summarize — recebe texto bruto e devolve resumo em bullet points
//   2. claude:generate  — gera um artigo novo em bullet points a partir de um título
// ─────────────────────────────────────────────────────────────────────────────

const https = require("https");

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let buf = "";
        res.on("data", c => buf += c);
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function callClaude(apiKey, systemPrompt, userMessage, maxTokens = 800) {
  const res = await httpsPost(
    "api.anthropic.com",
    "/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }
  );

  if (res.status !== 200) {
    throw new Error(`Anthropic API status ${res.status}: ${res.body}`);
  }

  const data = JSON.parse(res.body);
  return data.content[0].text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_SUMMARIZE = `
Você é um assistente especializado em criar resumos acadêmicos concisos.
Dado um texto sobre qualquer assunto, produza um resumo em bullet points em português.
Regras:
- Máximo de 8 bullet points
- Cada bullet: 1 frase direta, sem sub-bullets
- Comece cada bullet com "• "
- Foque nos conceitos centrais, definições e relações causais
- Não inclua exemplos ou analogias — apenas afirmações factuais
- Responda APENAS com os bullet points, sem título, sem introdução, sem conclusão
`.trim();

const SYSTEM_GENERATE = `
Você é um assistente especializado em criar artigos-resumo enciclopédicos.
Dado um título ou conceito, produza um artigo em formato de bullet points em português brasileiro.
Regras:
- Entre 6 e 10 bullet points
- Cada bullet: 1 frase direta e informativa, sem sub-bullets
- Comece cada bullet com "• "
- Cubra: definição, contexto histórico ou científico, relevância, relações com outros conceitos
- Use linguagem precisa — este é um documento de referência pessoal
- Responda APENAS com os bullet points, sem título, sem introdução
`.trim();

// ─────────────────────────────────────────────────────────────────────────────

function createClaudeHandlers(ipcMain) {

  // ── claude:summarize { text, title? } → { summary: string } ─────────────────
  // Gera resumo em bullet points a partir de texto já existente (ex.: extraído
  // da Wikipedia). Chamado automaticamente ao salvar um artigo da Wikipedia.
  ipcMain.handle("claude:summarize", async (_evt, { text, title = "" }) => {
    try {
      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) {
        return { ok: false, error: "API key da Anthropic não configurada." };
      }

      const userMsg = title
        ? `Título: ${title}\n\nTexto:\n${text.slice(0, 6000)}`
        : text.slice(0, 6000);

      const summary = await callClaude(apiKey, SYSTEM_SUMMARIZE, userMsg, 600);
      return { ok: true, data: { summary } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── claude:generate { title, context? } → { summary: string } ────────────────
  // Gera um artigo novo em bullet points quando o usuário não quer buscar
  // na Wikipedia e prefere pedir ao Claude diretamente.
  // context: texto opcional de outros artigos relacionados para dar contexto
  ipcMain.handle("claude:generate", async (_evt, { title, context = "" }) => {
    try {
      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) {
        return { ok: false, error: "API key da Anthropic não configurada." };
      }

      const userMsg = context
        ? `Conceito: ${title}\n\nContexto adicional (artigos relacionados na minha base):\n${context.slice(0, 2000)}`
        : `Conceito: ${title}`;

      const summary = await callClaude(apiKey, SYSTEM_GENERATE, userMsg, 800);
      return { ok: true, data: { summary } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { createClaudeHandlers };
