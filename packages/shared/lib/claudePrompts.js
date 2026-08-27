// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/claudePrompts.js
// Fonte única dos prompts de sistema, templates de geração e tabela de
// modelos de trilha usados nas chamadas à API da Anthropic — antes duplicados
// byte a byte entre packages/desktop/src/main/handlers/claudeHandlers.js e
// packages/mobile/src/platform/claude.ts (cada shell reimplementava a
// chamada HTTP e o parsing de resposta, que são de fato específicos de
// plataforma — Node https vs. CapacitorHttp — mas o TEXTO dos prompts e a
// tabela de modelos não têm nenhuma razão para divergir entre os dois).
//
// Arquivo em CommonJS plano (não .ts) de propósito: o processo main do
// Electron carrega seus handlers via require() direto, sem passar por
// nenhum bundler — só o processo renderer (via esbuild) entende TypeScript/
// ESM. module.exports aqui é consumido tanto por require() (desktop main,
// Node puro) quanto por import (mobile, via esbuild, que faz a interop de
// CommonJS automaticamente).
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

// ── Modelos de geração de trilha (ver path:generate / PathGenerationModel) ──
const PATH_MODELS = {
  "sonnet-standard": { apiModel: "claude-sonnet-5", thinking: false, maxTokens: 8000 },
  "sonnet-thinking": { apiModel: "claude-sonnet-5", thinking: true, thinkingBudgetTokens: 6000, maxTokens: 10000 },
  "opus-standard": { apiModel: "claude-opus-5", thinking: false, maxTokens: 8000 },
};

// ── Geração de trilha (ver path:generate / PathGenerationModel) ────────────
// Antes duplicado byte a byte entre pathHandlers.js (desktop) e claude.ts
// (mobile) — só o texto/schema do prompt e os geradores de link de busca,
// que não têm razão pra divergir; a parte que resta em cada shell
// (resolveWikipediaResource, materializeResources/Units) depende de
// searchWikipedia, que é específica de plataforma (Node https vs.
// CapacitorHttp).
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
    em movimento (postura, movimento, pronúncia, técnica) — "query" é a
    consulta que encontraria o vídeo ideal, não invente um título de vídeo
    específico
  - kind "image-search": quando o passo se beneficia de uma referência
    visual estática rápida de consulta — mapa mental, cheatsheet, diagrama,
    tabela-resumo — "query" é a busca que encontraria esse material (ex.:
    "cheatsheet acordes violão iniciante", "mapa mental fotossíntese")
  - Ajuste a proporção ao domínio: temas físicos/práticos (instrumento,
    exercício físico, pronúncia) pedem mais "video-search"; temas
    conceituais ou que envolvam memorização de estrutura/vocabulário pedem
    mais "image-search"/"wikipedia"
- Leve o perfil do estudante em conta: nível inicial, tempo disponível
  (ajuste a duração/quantidade de passos), formato preferido e obstáculos
  relatados
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
                        kind: { type: "string", enum: ["wikipedia", "video-search", "image-search"] },
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

// Sem API de terceiro (Pinterest exige app registrado + review para buscar
// pins fora da conta do próprio usuário — não dá pra embutir num app pessoal
// sem credencial própria do usuário). Mesma estratégia do vídeo: pontos de
// entrada de busca determinísticos, sem chave nenhuma.
function videoSearchEngines(query) {
  const q = encodeURIComponent(query);
  return [
    { label: "YouTube", url: `https://www.youtube.com/results?search_query=${q}` },
    { label: "DuckDuckGo (vídeos)", url: `https://duckduckgo.com/?q=${q}&iax=videos&ia=videos` },
    { label: "Google (vídeos)", url: `https://www.google.com/search?q=${q}&tbm=vid` },
  ];
}

function imageSearchEngines(query) {
  const q = encodeURIComponent(query);
  return [
    { label: "Pinterest", url: `https://www.pinterest.com/search/pins/?q=${q}` },
    { label: "Google Imagens", url: `https://www.google.com/search?q=${q}&tbm=isch` },
    { label: "DuckDuckGo (imagens)", url: `https://duckduckgo.com/?q=${q}&iax=images&ia=images` },
  ];
}

module.exports = {
  SYSTEM_SUMMARIZE,
  SYSTEM_ASK,
  SYSTEM_GENERATE,
  GENERATE_TEMPLATES,
  resolveGenerateTemplate,
  PATH_MODELS,
  SYSTEM_GENERATE_PATH,
  GENERATE_PATH_TOOL,
  videoSearchEngines,
  imageSearchEngines,
};
