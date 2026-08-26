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
  InterviewAnswer, PathGenerationModel, PathResource, PathStep, PathUnit,
} from "@lexicon/shared";

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

// ── Templates de geração ────────────────────────────────────────────────────
// Mesmos templates do desktop (ver claudeHandlers.js/GENERATE_TEMPLATES) —
// escolhidos no modal de "Novo artigo" quando a fonte é "Gerar com Claude".
export const GENERATE_TEMPLATES: Record<string, { label: string; systemPrompt: string }> = {
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
function resolveGenerateTemplate(templateId: string) {
  return GENERATE_TEMPLATES[templateId] ?? GENERATE_TEMPLATES.padrao;
}

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

const SYSTEM_GENERATE_PATH = `
Você é um planejador de currículo especializado em criar trilhas de
aprendizado estruturadas, no estilo de um app de ensino gamificado (como
Duolingo): uma sequência ordenada de passos pequenos e concretos, do
básico ao avançado, cada um construindo sobre o anterior.

Dado um objetivo de aprendizado e um perfil do estudante, gere a trilha
completa via a ferramenta fornecida. Regras:
- Entre 4 e 8 unidades (agrupamentos temáticos), em ordem crescente de dificuldade
- Cada unidade com 3 a 6 passos
- Cada passo deve ser uma ação concreta e pequena (não "aprender teoria musical"
  inteira de uma vez, mas "reconhecer as notas na primeira corda")
- "objective": 1 frase do que o estudante SABE FAZER ao concluir o passo
- "practice": 1 a 3 frases de exercício prático concreto para fixar o passo
  (não apenas "leia sobre X" — algo que o estudante faça)
- "estimatedMinutes": estimativa realista de tempo para completar o passo
- Para "resources", cada passo deve ter 1 a 3 recursos:
  - kind "wikipedia": quando o passo se beneficia de uma explicação
    enciclopédica de um conceito (definições, contexto, teoria) — "query" é o
    termo de busca na Wikipedia em português
  - kind "video-search": quando o passo se beneficia de demonstração visual
    (postura, movimento, pronúncia, técnica) — "query" é a consulta que
    encontraria o vídeo ideal, não invente um título de vídeo específico
  - Ajuste a proporção ao domínio: temas físicos/práticos pedem mais
    "video-search"; temas conceituais pedem mais "wikipedia"
- Leve o perfil do estudante em conta: nível inicial, tempo disponível,
  formato preferido e obstáculos relatados
- Todo texto em português brasileiro
`.trim();

const GENERATE_PATH_TOOL = {
  name: "emit_learning_path",
  description: "Emite a trilha de aprendizado estruturada.",
  input_schema: {
    type: "object",
    properties: {
      units: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  objective: { type: "string" },
                  estimatedMinutes: { type: "integer" },
                  practice: { type: "string" },
                  resources: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        kind: { type: "string", enum: ["wikipedia", "video-search"] },
                        title: { type: "string" },
                        query: { type: "string" },
                      },
                      required: ["kind", "title", "query"],
                    },
                  },
                },
                required: ["title", "objective", "estimatedMinutes", "practice", "resources"],
              },
            },
          },
          required: ["title", "steps"],
        },
      },
    },
    required: ["units"],
  },
};

const MODEL_CATALOG: Record<PathGenerationModel, {
  apiModel: string; thinking: boolean; thinkingBudgetTokens?: number; maxTokens: number;
}> = {
  "sonnet-standard": { apiModel: "claude-sonnet-5", thinking: false, maxTokens: 8000 },
  "sonnet-thinking": { apiModel: "claude-sonnet-5", thinking: true, thinkingBudgetTokens: 6000, maxTokens: 10000 },
  "opus-standard": { apiModel: "claude-opus-5", thinking: false, maxTokens: 8000 },
};

export async function consolidateProfile(goal: string, answers: InterviewAnswer[]): Promise<string> {
  const apiKey = await getConfigValue("anthropicApiKey");
  if (!apiKey) throw new Error("API key da Anthropic não configurada.");
  const qa = answers.map(a => `P: ${a.question}\nR: ${a.answer}`).join("\n\n");
  const userMsg = `Objetivo: ${goal}\n\n${qa}`;
  return callClaude(apiKey, SYSTEM_CONSOLIDATE, userMsg, 500);
}

function videoSearchEngines(query: string) {
  const q = encodeURIComponent(query);
  return [
    { label: "YouTube", url: `https://www.youtube.com/results?search_query=${q}` },
    { label: "DuckDuckGo (vídeos)", url: `https://duckduckgo.com/?q=${q}&iax=videos&ia=videos` },
    { label: "Google (vídeos)", url: `https://www.google.com/search?q=${q}&tbm=vid` },
  ];
}

async function resolveWikipediaResource(query: string, lang: string) {
  try {
    const results = await searchWikipedia(query, lang, 1);
    if (results.length > 0) {
      const title = results[0].title;
      return {
        title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        verified: true,
      };
    }
  } catch {
    // segue para o fallback de busca
  }
  return {
    title: `Buscar "${query}" na Wikipédia`,
    url: `https://${lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`,
    verified: true,
  };
}

async function materializeResources(rawResources: any[], lang: string): Promise<PathResource[]> {
  const out: PathResource[] = [];
  for (const r of rawResources ?? []) {
    if (r.kind === "wikipedia") {
      const resolved = await resolveWikipediaResource(r.query, lang);
      out.push({
        id: crypto.randomUUID(), kind: "wikipedia",
        title: resolved.title, url: resolved.url, query: r.query, verified: resolved.verified,
      });
    } else {
      out.push({
        id: crypto.randomUUID(), kind: "video-search",
        title: r.title, query: r.query, verified: true, engines: videoSearchEngines(r.query),
      });
    }
  }
  return out;
}

async function materializeUnits(rawUnits: any[], lang: string): Promise<PathUnit[]> {
  const units: PathUnit[] = [];
  let previousStepId: string | null = null;
  for (const rawUnit of rawUnits) {
    const steps: PathStep[] = [];
    let order = units.reduce((acc, u) => acc + u.steps.length, 0);
    for (const rawStep of rawUnit.steps ?? []) {
      const stepId = crypto.randomUUID();
      const resources = await materializeResources(rawStep.resources, lang);
      steps.push({
        id: stepId, order: order++, title: rawStep.title, objective: rawStep.objective,
        estimatedMinutes: Number(rawStep.estimatedMinutes) || 15, practice: rawStep.practice,
        prerequisiteIds: previousStepId ? [previousStepId] : [],
        resources, status: previousStepId ? "locked" : "available",
      });
      previousStepId = stepId;
    }
    units.push({ id: crypto.randomUUID(), title: rawUnit.title, steps });
  }
  return units;
}

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
  return materializeUnits(result.units ?? [], lang);
}
