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
import { searchWikipedia } from "./wikipedia";
import type {
  InterviewAnswer, PathGenerationModel, PathUnit,
} from "@lexicon/shared";
// Prompts/templates: fonte única em packages/shared/lib/claudePrompts.js —
// ver o comentário daquele arquivo para o porquê de ser .js/CommonJS.
import {
  SYSTEM_SUMMARIZE, SYSTEM_ASK, GENERATE_TEMPLATES, resolveGenerateTemplate, PATH_MODELS,
  SYSTEM_GENERATE_PATH, GENERATE_PATH_TOOL,
} from "@lexicon/shared/lib/claudePrompts.js";
// materializeUnits (monta unidades/passos/recursos a partir da resposta bruta
// do Claude) é compartilhado com packages/desktop/src/main/handlers/
// pathHandlers.js — só a busca na Wikipédia e a geração de id variam por
// plataforma, injetadas em MATERIALIZE_DEPS abaixo.
import { materializeUnits } from "@lexicon/shared/lib/pathMaterialize.js";

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

interface CallClaudeOpts {
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudgetTokens?: number;
  tools?: unknown[];
  toolChoice?: { type: string; name?: string };
}

// opts aceita número (maxTokens, compatibilidade com as chamadas antigas) ou
// um objeto — mesma convenção do desktop (ver claudeHandlers.js/callClaude).
// Quando `tools` é passado, retorna o `input` do bloco tool_use em vez do
// texto — usado por generatePath (saída estruturada via tool use).
async function callClaude(
  apiKey: string, systemPrompt: string, userMessage: string, opts: number | CallClaudeOpts = 800
): Promise<any> {
  const o: CallClaudeOpts = typeof opts === "number" ? { maxTokens: opts } : { ...opts };
  const body: Record<string, unknown> = {
    model: o.model ?? "claude-haiku-4-5-20251001",
    max_tokens: o.maxTokens ?? 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  if (o.thinking) {
    body.thinking = { type: "enabled", budget_tokens: o.thinkingBudgetTokens ?? 4000 };
    if (o.toolChoice?.type === "tool") delete o.toolChoice;
  }
  if (o.tools) body.tools = o.tools;
  if (o.toolChoice) body.tool_choice = o.toolChoice;

  const options = {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    data: body,
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
      if (o.tools) {
        const toolUse = (data.content as any[]).find(b => b.type === "tool_use");
        if (!toolUse) throw new Error("Claude não retornou o bloco de tool use esperado.");
        return toolUse.input;
      }
      const textBlock = (data.content as any[]).find(b => b.type === "text");
      return (textBlock?.text ?? "").trim();
    }

    const canRetry = RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length;
    if (!canRetry) {
      const body2 = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      throw new Error(`Anthropic API status ${res.status}: ${body2}`);
    }

    const retryAfter = Number(getHeader(res.headers, "retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_DELAYS_MS[attempt];
    await sleep(delay + Math.random() * 200);
  }
}

// Cache em memória por termo normalizado — mesmo raciocínio do desktop
// (claudeHandlers.js): reabrir/recriar o mesmo título não deve pagar por uma
// chamada nova à API paga da Anthropic. Sem TTL, descartado ao fechar o app.
// Não cobre ask() (contextual, cada pergunta é distinta).
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

export async function generate(title: string, context = "", templateId = "padrao"): Promise<string> {
  const template = resolveGenerateTemplate(templateId);
  const cacheKey = `${templateId}::${normTerm(title)}::${normTerm(context.slice(0, 200))}`;
  const cached = generateCache.get(cacheKey);
  if (cached) return cached;
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const userMsg = context
    ? `Conceito: ${title}\n\nContexto adicional (artigos relacionados na minha base):\n${context.slice(0, 2000)}`
    : `Conceito: ${title}`;
  const summary = await callClaude(apiKey, template.systemPrompt, userMsg, 800);
  generateCache.set(cacheKey, summary);
  return summary;
}

export function generateTemplates(): Array<{ id: string; label: string }> {
  return Object.entries(GENERATE_TEMPLATES).map(([id, t]) => ({ id, label: t.label }));
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

// ── Trilhas de aprendizado ───────────────────────────────────────────────────
// Porta de packages/desktop/src/main/handlers/pathHandlers.js.
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

// SYSTEM_GENERATE_PATH/GENERATE_PATH_TOOL vêm de
// packages/shared/lib/claudePrompts.js (import no topo do arquivo) —
// compartilhados com packages/desktop/src/main/handlers/pathHandlers.js.

// Fonte única em packages/shared/lib/claudePrompts.js (PATH_MODELS) —
// compartilhada com packages/desktop/src/main/handlers/pathHandlers.js.
const MODEL_CATALOG = PATH_MODELS as Record<PathGenerationModel, {
  apiModel: string; thinking: boolean; thinkingBudgetTokens?: number; maxTokens: number;
}>;

export async function consolidateProfile(goal: string, answers: InterviewAnswer[]): Promise<string> {
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const qa = answers.map(a => `P: ${a.question}\nR: ${a.answer}`).join("\n\n");
  const userMsg = `Objetivo: ${goal}\n\n${qa}`;
  return callClaude(apiKey, SYSTEM_CONSOLIDATE, userMsg, 500);
}

// searchWikipedia e a geração de id variam por plataforma (Node https vs.
// CapacitorHttp; crypto.randomUUID do Node vs. o Web Crypto global do
// WebView) — injetados em materializeUnits, ver pathMaterialize.js.
const MATERIALIZE_DEPS = { searchWikipedia, makeId: () => crypto.randomUUID() };

export async function generatePath(
  goal: string, profileSummary: string, model: PathGenerationModel, lang = "pt"
): Promise<PathUnit[]> {
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const m = MODEL_CATALOG[model] ?? MODEL_CATALOG["sonnet-standard"];
  const userMsg = `Objetivo de aprendizado: ${goal}\n\nPerfil do estudante:\n${profileSummary}`;
  const result = await callClaude(apiKey, SYSTEM_GENERATE_PATH, userMsg, {
    model: m.apiModel, maxTokens: m.maxTokens, thinking: m.thinking,
    thinkingBudgetTokens: m.thinkingBudgetTokens,
    tools: [GENERATE_PATH_TOOL], toolChoice: { type: "tool", name: "emit_learning_path" },
  });
  return materializeUnits(result.units ?? [], lang, MATERIALIZE_DEPS);
}
