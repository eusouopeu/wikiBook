// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/claude.ts
// Porta de packages/desktop/src/main/handlers/claudeHandlers.js — summarize,
// generate e ask (chat contextual dentro do artigo, sem histórico persistido,
// igual ao desktop).
//
// IMPORTANTE (transporte): a API da Anthropic não expõe CORS para chamada de
// browser/WebView — por isso o desktop faz essa chamada no processo main via
// https do Node, nunca no renderer. Aqui usamos CapacitorHttp, que faz a
// requisição nativamente (fora do fetch/XHR do WebView) nos builds iOS/
// Android reais — mas no preview via browser comum, CapacitorHttp cai para
// fetch() normal, então ESSE caminho especificamente vai falhar por CORS até
// rodar no simulador/device nativo. Wikipedia não tem esse problema (ela
// manda CORS permissivo); a API da Anthropic manda.
// ─────────────────────────────────────────────────────────────────────────────

import { CapacitorHttp } from "@capacitor/core";
import { getConfigValue } from "./config";

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

const SYSTEM_ASK = `
Você é um assistente que responde perguntas com base em um artigo de uma base de
conhecimento pessoal.
Regras:
- Responda apenas com base no artigo e no contexto de artigos relacionados fornecidos
- Se o contexto não for suficiente para responder com segurança, diga isso explicitamente
- Seja direto: entre 1 e 4 frases, sem introduções nem floreios
- Responda em português brasileiro
`.trim();

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

// Retry com backoff exponencial só para falhas transitórias (rate limit, erro
// 5xx do servidor, erro de rede) — erros de request malformado ou credencial
// inválida (400/401/403) falham já na 1ª tentativa, sem retry. Mesma política
// do desktop (packages/desktop/src/main/handlers/claudeHandlers.js).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [500, 1500, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

async function callClaude(apiKey: string, systemPrompt: string, userMessage: string, maxTokens = 800): Promise<string> {
  const options = {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    data: {
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    },
  };

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await CapacitorHttp.post(options);
    } catch (networkErr) {
      if (attempt >= RETRY_DELAYS_MS.length) throw networkErr;
      await sleep(RETRY_DELAYS_MS[attempt] + Math.random() * 200);
      continue;
    }

    if (res.status === 200) {
      const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
      return data.content[0].text.trim();
    }

    const canRetry = RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length;
    if (!canRetry) {
      const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      throw new Error(`Anthropic API status ${res.status}: ${body}`);
    }

    const retryAfter = Number(getHeader(res.headers, "retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_DELAYS_MS[attempt];
    await sleep(delay + Math.random() * 200);
  }
}

// Cache em memória por termo normalizado — mesmo raciocínio do desktop
// (claudeHandlers.js): reabrir/recriar o mesmo título não deve pagar por uma
// chamada nova à API paga da Anthropic. Sem TTL, descartado ao fechar o app.
// Não cobre ask() (contextual, cada pergunta é distinta) nem searchRank()
// (a lista de candidatos muda a cada digitação).
const summarizeCache = new Map<string, string>();
const generateCache = new Map<string, string>();
function normTerm(s: string) { return s.trim().toLowerCase(); }

// bypassCache: usado pelo botão "↺ Regenerar resumo", onde o usuário pede
// explicitamente uma resposta nova — ainda grava o resultado no cache.
export async function summarize(text: string, title = "", bypassCache = false): Promise<string> {
  const cacheKey = normTerm(title) || normTerm(text.slice(0, 200));
  if (!bypassCache) {
    const cached = summarizeCache.get(cacheKey);
    if (cached) return cached;
  }
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const userMsg = title
    ? `Título: ${title}\n\nTexto:\n${text.slice(0, 6000)}`
    : text.slice(0, 6000);
  const summary = await callClaude(apiKey, SYSTEM_SUMMARIZE, userMsg, 600);
  summarizeCache.set(cacheKey, summary);
  return summary;
}

export async function generate(title: string, context = ""): Promise<string> {
  const cacheKey = `${normTerm(title)}::${normTerm(context.slice(0, 200))}`;
  const cached = generateCache.get(cacheKey);
  if (cached) return cached;
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const userMsg = context
    ? `Conceito: ${title}\n\nContexto adicional (artigos relacionados na minha base):\n${context.slice(0, 2000)}`
    : `Conceito: ${title}`;
  const summary = await callClaude(apiKey, SYSTEM_GENERATE, userMsg, 800);
  generateCache.set(cacheKey, summary);
  return summary;
}

export async function ask(
  question: string, articleTitle: string, articleText: string, relatedContext = ""
): Promise<string> {
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const userMsg = [
    `Artigo: ${articleTitle}`,
    `Conteúdo:\n${articleText.slice(0, 6000)}`,
    relatedContext ? `\nArtigos relacionados:\n${relatedContext.slice(0, 1500)}` : "",
    `\nPergunta: ${question}`,
  ].filter(Boolean).join("\n");
  return callClaude(apiKey, SYSTEM_ASK, userMsg, 500);
}

// Busca semântica opcional: rankeia os artigos mais relevantes para a consulta
// por significado, não só substring. Candidatos limitados a ~200 e resumo
// truncado a 150 caracteres cada, para controlar custo de tokens.
export async function searchRank(
  query: string, candidates: Array<{ id: string; title: string; summary: string }>
): Promise<string[]> {
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");

  const capped = candidates.slice(0, 200);
  const list = capped
    .map(c => `${c.id}: ${c.title} — ${(c.summary || "").slice(0, 150).replace(/\n/g, " ")}`)
    .join("\n");
  const userMsg = `Consulta: ${query}\n\nArtigos candidatos:\n${list}`;

  const raw = await callClaude(apiKey, SYSTEM_SEARCH_RANK, userMsg, 400);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let ids: unknown;
  try { ids = JSON.parse(cleaned); } catch { ids = []; }
  if (!Array.isArray(ids)) ids = [];

  const knownIds = new Set(capped.map(c => c.id));
  return (ids as unknown[]).filter((id): id is string => typeof id === "string" && knownIds.has(id));
}
