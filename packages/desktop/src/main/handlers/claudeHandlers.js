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

async function callClaude(apiKey, systemPrompt, userMessage, maxTokens = 800) {
  const requestArgs = [
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
    },
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
      return data.content[0].text.trim();
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

const SYSTEM_ASK = `
Você é um assistente que responde perguntas com base em um artigo de uma base de
conhecimento pessoal.
Regras:
- Responda apenas com base no artigo e no contexto de artigos relacionados fornecidos
- Se o contexto não for suficiente para responder com segurança, diga isso explicitamente
- Seja direto: entre 1 e 4 frases, sem introduções nem floreios
- Responda em português brasileiro
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

// ── Templates de geração ────────────────────────────────────────────────────
// Cada template é o mesmo formato base (bullet points, português, sem
// título/introdução) com um foco estrutural diferente — o usuário escolhe no
// modal de "Novo artigo" quando a fonte é "Gerar com Claude". "padrao" é o
// comportamento original (SYSTEM_GENERATE), preservado por compatibilidade
// com chamadas antigas (templateId ausente/desconhecido cai nele).
const GENERATE_TEMPLATES = {
  padrao: { label: "Padrão", systemPrompt: SYSTEM_GENERATE },
  definicao: {
    label: "Definição aprofundada",
    systemPrompt: `
Você é um assistente especializado em criar artigos-resumo enciclopédicos.
Dado um título ou conceito, produza um artigo em bullet points em português brasileiro,
com foco em DEFINIÇÃO: o que é, do que é composto, como se distingue de conceitos vizinhos.
Regras:
- Entre 6 e 9 bullet points
- Cada bullet: 1 frase direta, sem sub-bullets, começando com "• "
- Ordem sugerida: definição central → componentes/características essenciais →
  distinção de conceitos frequentemente confundidos com este → variações ou subtipos
- Use linguagem precisa — este é um documento de referência pessoal
- Responda APENAS com os bullet points, sem título, sem introdução
`.trim(),
  },
  historia: {
    label: "Contexto histórico",
    systemPrompt: `
Você é um assistente especializado em criar artigos-resumo enciclopédicos.
Dado um título ou conceito, produza um artigo em bullet points em português brasileiro,
com foco em CONTEXTO HISTÓRICO: origem, evolução ao longo do tempo, marcos e figuras relevantes.
Regras:
- Entre 6 e 9 bullet points
- Cada bullet: 1 frase direta, sem sub-bullets, começando com "• "
- Ordem sugerida: origem/surgimento → marcos e datas relevantes → pessoas/eventos-chave →
  estado atual ou legado
- Use linguagem precisa — este é um documento de referência pessoal
- Responda APENAS com os bullet points, sem título, sem introdução
`.trim(),
  },
  exemplos: {
    label: "Exemplos práticos",
    systemPrompt: `
Você é um assistente especializado em criar artigos-resumo enciclopédicos.
Dado um título ou conceito, produza um artigo em bullet points em português brasileiro,
com foco em APLICAÇÃO PRÁTICA: exemplos concretos, casos de uso, situações do dia a dia.
Regras:
- Entre 6 e 9 bullet points
- Cada bullet: 1 frase direta, sem sub-bullets, começando com "• "
- Comece com uma definição breve (1 bullet), depois dedique a maioria dos bullets a
  exemplos concretos e situações onde o conceito se aplica
- Use linguagem precisa — este é um documento de referência pessoal
- Responda APENAS com os bullet points, sem título, sem introdução
`.trim(),
  },
  referencias: {
    label: "Estruturado (com referências)",
    systemPrompt: `
Você é um assistente especializado em criar artigos-resumo enciclopédicos.
Dado um título ou conceito, produza um artigo em bullet points em português brasileiro,
cobrindo estas seções, NESTA ORDEM, um bullet de transição por seção usando o rótulo
em negrito no início da linha (ex.: "• Definição: ..."):
Definição, Contexto histórico ou científico, Relevância, Relações com outros conceitos,
Referências ou fontes amplamente reconhecidas sobre o tema.
Regras:
- 1 a 2 bullets por seção (não pule nenhuma das 5 seções)
- Cada bullet começa com "• " seguido do rótulo da seção e ":"
- Frases diretas, sem sub-bullets
- Use linguagem precisa — este é um documento de referência pessoal
- Responda APENAS com os bullet points, sem título, sem introdução
`.trim(),
  },
};
function resolveGenerateTemplate(templateId) {
  return GENERATE_TEMPLATES[templateId] ?? GENERATE_TEMPLATES.padrao;
}

const SYSTEM_SEARCH_RANK = `
Você é um mecanismo de busca semântica para uma base de conhecimento pessoal.
Dada uma consulta e uma lista de artigos candidatos (id, título e resumo),
devolva os ids dos artigos mais relevantes para a consulta — inclusive quando a
palavra exata da consulta não aparece no artigo, mas o significado é relacionado.
Regras:
- Responda APENAS com um array JSON de ids, em ordem decrescente de relevância
- Sem texto antes ou depois, sem bloco de código markdown
- No máximo 15 ids
- Se nenhum artigo for relevante, responda com um array vazio: []
`.trim();

// ─────────────────────────────────────────────────────────────────────────────

// Cache em memória por termo normalizado — chamar summarize/generate de novo
// para o mesmo título (reabrir um artigo da Wikipedia já resumido, gerar o
// mesmo conceito duas vezes) reaproveita a resposta anterior em vez de pagar
// por uma chamada nova à API paga da Anthropic. Sem TTL: descartado ao
// fechar o app. Não se aplica a claude:ask (conversa contextual, cada
// pergunta é distinta por natureza) nem a claude:searchRank (a lista de
// candidatos muda a cada digitação).
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

  // ── claude:searchRank { query, candidates: {id,title,summary}[] } → { ids: string[] } ─
  // Busca semântica opcional: rankeia os artigos mais relevantes para a
  // consulta por significado, não só substring. Candidatos limitados a ~200 e
  // resumo truncado a 150 caracteres cada, para controlar custo de tokens.
  ipcMain.handle("claude:searchRank", async (_evt, { query, candidates = [] }) => {
    try {
      const { getConfig } = require("./configHandlers");
      const apiKey = getConfig("anthropicApiKey");
      if (!apiKey) {
        return { ok: false, error: "API key da Anthropic não configurada." };
      }

      const capped = candidates.slice(0, 200);
      const list = capped
        .map(c => `${c.id}: ${c.title} — ${(c.summary || "").slice(0, 150).replace(/\n/g, " ")}`)
        .join("\n");
      const userMsg = `Consulta: ${query}\n\nArtigos candidatos:\n${list}`;

      const raw = await callClaude(apiKey, SYSTEM_SEARCH_RANK, userMsg, 400);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      let ids;
      try { ids = JSON.parse(cleaned); } catch { ids = []; }
      if (!Array.isArray(ids)) ids = [];

      const knownIds = new Set(capped.map(c => c.id));
      ids = ids.filter(id => typeof id === "string" && knownIds.has(id));

      return { ok: true, data: { ids } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { createClaudeHandlers };
