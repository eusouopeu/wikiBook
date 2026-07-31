// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/claude.ts
// Porta de packages/desktop/src/main/handlers/claudeHandlers.js — só
// summarize/generate (usados na criação de artigo); claude:ask fica para
// quando ArticleView.tsx for portado (é a função de perguntas dentro de um
// artigo aberto, fora do escopo desta fase).
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

async function callClaude(apiKey: string, systemPrompt: string, userMessage: string, maxTokens = 800): Promise<string> {
  const res = await CapacitorHttp.post({
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
  });

  if (res.status !== 200) {
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`Anthropic API status ${res.status}: ${body}`);
  }

  const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  return data.content[0].text.trim();
}

export async function summarize(text: string, title = ""): Promise<string> {
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const userMsg = title
    ? `Título: ${title}\n\nTexto:\n${text.slice(0, 6000)}`
    : text.slice(0, 6000);
  return callClaude(apiKey, SYSTEM_SUMMARIZE, userMsg, 600);
}

export async function generate(title: string, context = ""): Promise<string> {
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const userMsg = context
    ? `Conceito: ${title}\n\nContexto adicional (artigos relacionados na minha base):\n${context.slice(0, 2000)}`
    : `Conceito: ${title}`;
  return callClaude(apiKey, SYSTEM_GENERATE, userMsg, 800);
}
