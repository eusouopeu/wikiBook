// ─────────────────────────────────────────────────────────────────────────────
// src/shared/types.ts
// ─────────────────────────────────────────────────────────────────────────────

// Um trecho salvo manualmente pelo usuário a partir de outro artigo.
// html: fragmento HTML sanitizado (formatação mantida, hrefs removidos) — captura ORIGINAL, imutável
// plainText: versão em texto puro do html original — baseline imutável usada para
//   diff de edição (marcação de adições/remoções) e para busca/dedup
//   - kind "text"  → texto extraído do html
//   - kind "table" → tabela Markdown equivalente (colunas/linhas preservadas)
//   - kind "image" → alt text (ou rótulo padrão)
// editedMarkdown: presente em trechos "text"/"table" que o usuário editou pelo
//   editor — fonte de verdade para exibição e (para "text") para o parser de
//   flashcards. Em "table", é a tabela em Markdown editada célula a célula.
// category: cor de fundo semântica escolhida ao salvar o trecho
//   default (creme) | concept (azul) | list (verde) | numeric (roxo)
// kind ausente (dados legados) equivale a "text"; category ausente = "default"
export type ExcerptCategory = "default" | "concept" | "list" | "numeric";

export interface ArticleExcerpt {
  id: string;
  kind?: "text" | "image" | "table";
  category?: ExcerptCategory;
  html: string;
  plainText: string;
  editedMarkdown?: string;
  sourceArticleId: string;
  sourceArticleTitle: string;
  savedAt: string;
  updatedAt?: string;
}

// Item do sumário/ordem de exibição dos trechos — permite agrupar sob headings
// e reordenar por arraste. Ausência de outline no artigo = ordem padrão de excerpts.
export type ExcerptOutlineItem =
  | { type: "excerpt"; id: string }
  | { type: "heading"; id: string; text: string };

// Snapshot de uma versão anterior de um artigo — ver article:getHistory/
// article:revertVersion. Guardado fora do objeto Article (arquivo próprio),
// nunca incluído no article:list.
export interface ArticleHistoryEntry {
  title: string;
  content: string;
  summary: string;
  updatedAt: string;
}

// Metadados leves de um artigo na lixeira — ver article:listTrash/
// article:purge. Sem content/excerpts (a tela de lixeira só lista e
// restaura/apaga, nunca exibe o conteúdo).
export interface TrashedArticle {
  id: string;
  title: string;
  source: Article["source"];
  deletedAt: string;
}

// Arquivo anexado a um artigo (imagem/PDF/qualquer tipo) — só metadados aqui;
// o conteúdo binário fica fora do JSON do artigo (ver article:addAttachment/
// article:exportAttachment), nunca incluído em article:list.
export interface ArticleAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Article {
  id: string;
  title: string;
  source: "wikipedia" | "claude" | "manual";
  // wikipedia: HTML sanitizado; manual: Markdown editado pelo usuário; claude: vazio
  content: string;
  summary: string;
  links: ArticleLink[];
  excerpts: ArticleExcerpt[];
  excerptOutline?: ExcerptOutlineItem[];
  attachments?: ArticleAttachment[];
  tags: string[];
  // Pasta única (lista plana, sem aninhamento) — null/ausente = "Sem pasta"
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Pastas ─────────────────────────────────────────────────────────────────
// Persistidas como um único valor JSON via config:get/config:set (chave
// "folders") — não precisam de handlers IPC próprios, o mecanismo de config
// já existe nos dois shells.
export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export interface ArticleLink {
  id: string;
  anchorText: string;
  targetId: string;
  targetTitle: string;
  createdAt: string;
}

export interface GraphNode {
  id: string;
  title: string;
  source: Article["source"];
  tags: string[];
  folderId?: string | null;
  depth: number;
  radius: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  anchorText: string;
}

// ── Flashcards (repetição espaçada, estilo Obsidian Spaced Repetition) ───────
// Gerados a partir de padrões Markdown no conteúdo de artigos manuais e em
// trechos editados ("==destaque==" → cloze c1, "++destaque++" → cloze c2,
// listas → cloze simultâneo, "Pergunta? resposta" / "Termo: definição" → card
// pergunta/resposta, "=" → básico, "==" solto → invertido).
// Agendamento via SM-2 simplificado.
export type FlashcardKind = "basic" | "reversed" | "cloze" | "enum-cloze" | "qa";
export type FlashcardGrade = "again" | "hard" | "good" | "easy";

export interface Flashcard {
  id: string;
  articleId: string;
  articleTitle: string;
  kind: FlashcardKind;
  front?: string;          // basic/reversed
  back?: string;           // basic/reversed
  clozeText?: string;      // cloze/enum-cloze — contém {{c1::...}}
  clozeGroup?: number;     // cloze/enum-cloze — grupo escondido por este card (1 = c1, 2 = c2…)
  sourceLine: string;      // texto de origem, usado para preservar agendamento entre regenerações
  sourceExcerptId?: string;
  frontBackIndex?: number; // 0/1 (direções de "reversed") ou nº do grupo de cloze
  createdAt: string;
  due: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
}

// ── Trilhas de aprendizado (percurso guiado estilo Duolingo) ────────────────
// Uma LearningPath é gerada a partir de um objetivo em linguagem natural
// ("quero aprender violão") + um perfil consolidado a partir de uma
// entrevista de nivelamento (roteiro fixo de perguntas + 1 chamada de
// consolidação ao Claude). Persistida como arquivo próprio (um JSON por
// trilha), igual aos artigos — não reaproveita Article/ArticleLink porque
// passo de trilha tem ordem, pré-requisito e estado de conclusão, coisas que
// não existem no hipertexto do grafo.
export type PathResourceKind = "wikipedia" | "video-search" | "image-search" | "external";

// Para vídeo/imagem, o Claude não tem acesso a URLs reais de um pin do
// Pinterest ou vídeo do YouTube — inventar uma teria taxa de acerto ~0, e
// nenhum dos dois oferece busca de conteúdo alheio sem credencial própria de
// app registrado (Pinterest exige OAuth + review de app; não dá pra embutir
// num app pessoal sem pedir ao usuário para criar e colar sua própria
// credencial). Em vez de um link específico, geramos consultas de busca e
// vários pontos de entrada determinísticos, sem chave nenhuma: a própria
// página de busca do serviço, mais alternativas. A mesma URL do YouTube pode
// ainda ser interceptada pelo NewPipe no Android caso o usuário o tenha
// configurado como app padrão para links do YouTube — por isso não é um
// esquema de URI próprio, é a URL comum.
export interface SearchEngineLink {
  label: string;
  url: string;
}

export interface PathResource {
  id: string;
  kind: PathResourceKind;
  title: string;
  // wikipedia: URL do artigo já resolvido (verified indica se a busca achou
  // um artigo real); video-search/image-search: query usada; external: url
  // informativa
  url?: string;
  query?: string;
  verified: boolean;
  engines?: SearchEngineLink[];
  // wikipedia: id do artigo importado para a pasta da trilha (ver
  // useStore.importPathArticles) — quando presente, o recurso abre dentro do
  // app em vez do navegador externo.
  articleId?: string;
}

export type PathStepStatus = "locked" | "available" | "done";

export interface PathStep {
  id: string;
  order: number;
  title: string;
  objective: string;
  estimatedMinutes: number;
  practice: string;
  prerequisiteIds: string[];
  resources: PathResource[];
  status: PathStepStatus;
  completedAt?: string;
  articleId?: string;
}

export interface PathUnit {
  id: string;
  title: string;
  steps: PathStep[];
}

// Resposta bruta de uma pergunta do roteiro fixo de entrevista — ver
// packages/shared/lib/interviewScript.ts
export interface InterviewAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export type PathGenerationModel = "sonnet-standard" | "sonnet-thinking" | "opus-standard";

export interface LearningPath {
  id: string;
  goal: string;
  interviewAnswers: InterviewAnswer[];
  profileSummary: string;
  model: PathGenerationModel;
  units: PathUnit[];
  createdAt: string;
  updatedAt: string;
}

export type IpcChannel =
  | "article:list"
  | "article:get"
  | "article:save"
  | "article:delete"
  | "article:restore"
  | "article:listTrash"
  | "article:purge"
  | "article:addLink"
  | "article:removeLink"
  | "article:appendExcerpt"
  | "article:appendImage"
  | "article:removeExcerpt"
  | "article:updateExcerpt"
  | "article:updateExcerptOutline"
  | "article:exportMarkdown"
  | "article:exportFlashcardsCsv"
  | "article:getHistory"
  | "article:revertVersion"
  | "article:addAttachment"
  | "article:removeAttachment"
  | "article:getAttachmentData"
  | "article:exportAttachment"
  | "wikipedia:fetch"
  | "wikipedia:search"
  | "claude:summarize"
  | "claude:generate"
  | "claude:generateTemplates"
  | "claude:ask"
  | "flashcards:regenerate"
  | "flashcards:list"
  | "flashcards:listDue"
  | "flashcards:grade"
  | "config:get"
  | "config:set"
  | "sync:test"
  | "sync:run"
  | "path:list"
  | "path:get"
  | "path:save"
  | "path:delete"
  | "path:consolidateProfile"
  | "path:generate"
  | "browser:open";

export interface IpcRequest<T = unknown> { channel: IpcChannel; payload?: T; }
export interface IpcResponse<T = unknown> { ok: boolean; data?: T; error?: string; }
