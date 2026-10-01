// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/store/slices/pathsSlice.ts
// Trilhas de aprendizado: CRUD, geração via Claude, rascunho e progresso.
// ─────────────────────────────────────────────────────────────────────────────

import type { LearningPath, PathUnit } from "../../shared/types";
import { ipc } from "../ipc";
import type { PathsSlice, SliceCreator } from "../types";

// Nome curto do bloco para a etiqueta "[N]/[nome]" — o título da unidade
// gerado pelo Claude não tem limite de tamanho, mas a etiqueta é um chip de
// UI, não um cabeçalho.
function shortenBlockName(title: string, maxLen = 28): string {
  if (title.length <= maxLen) return title;
  const cut = title.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export const createPathsSlice: SliceCreator<PathsSlice> = (set, get) => ({
  paths: [],
  activePathId: null,
  pathDraft: null,

  loadPaths: async () => {
    const paths = await ipc<LearningPath[]>("path:list");
    set({ paths });
  },
  openPath: (id) => set({ activePathId: id, view: "path" }),
  savePathRecord: async (partial) => {
    const saved = await ipc<LearningPath>("path:save", { path: partial });
    set(s => {
      const exists = s.paths.find(p => p.id === saved.id);
      const paths = exists ? s.paths.map(p => p.id === saved.id ? saved : p) : [saved, ...s.paths];
      return { paths, activePathId: saved.id };
    });
    return saved;
  },
  deletePathRecord: async (id) => {
    await ipc("path:delete", { id });
    set(s => ({
      paths: s.paths.filter(p => p.id !== id),
      activePathId: s.activePathId === id ? null : s.activePathId,
    }));
  },
  consolidateProfile: async (goal, answers) => {
    const r = await ipc<{ profileSummary: string }>("path:consolidateProfile", { goal, answers });
    return r.profileSummary;
  },
  generatePathUnits: async (goal, profileSummary, model) => {
    const r = await ipc<{ units: PathUnit[] }>("path:generate", { goal, profileSummary, model });
    return r.units;
  },
  // Guarda a resposta paga do Claude assim que chega, antes de
  // importPathArticles rodar — ver comentário do campo pathDraft. Chave única
  // (uma trilha em geração por vez) porque o assistente também é single-flow.
  loadPathDraft: async () => {
    const raw = await ipc<string | undefined>("config:get", { key: "pathGenerationDraft" });
    set({ pathDraft: raw ? JSON.parse(raw) : null });
  },
  savePathDraft: async (draft) => {
    const stored = { ...draft, createdAt: new Date().toISOString() };
    await ipc("config:set", { key: "pathGenerationDraft", value: JSON.stringify(stored) });
    set({ pathDraft: stored });
  },
  clearPathDraft: async () => {
    await ipc("config:set", { key: "pathGenerationDraft", value: "" });
    set({ pathDraft: null });
  },
  // Cria uma pasta para a trilha e importa cada recurso "wikipedia" resolvido
  // (ver resolveWikipediaResource nos handlers — só recursos com URL real de
  // artigo, "/wiki/…", não a página de busca de fallback) como artigo local
  // dentro dela. Título "[nº da aula]/[nome do artigo]" (aula = ordem global
  // do passo no percurso), etiqueta "[nº do bloco]/[nome curto da unidade]".
  // Guarda o articleId de volta no recurso para o clique abrir no app em vez
  // do navegador externo (ver StepPanel). Falha em um recurso não derruba os
  // demais — o app continua funcional com o link externo como fallback.
  importPathArticles: async (units, goal) => {
    const token = get().beginPendingTask(`Importando artigos de "${goal}"…`);
    try {
      const folder = await get().createFolder(goal);
      const lang = get().wikipediaLang;

      const importedUnits: PathUnit[] = [];
      for (let unitIdx = 0; unitIdx < units.length; unitIdx++) {
        const unit = units[unitIdx];
        const tag = `${unitIdx + 1}/${shortenBlockName(unit.title)}`;
        const steps: typeof unit.steps = [];
        for (const step of unit.steps) {
          const resources: typeof step.resources = [];
          for (const resource of step.resources) {
            if (resource.kind !== "wikipedia" || !resource.url?.includes("/wiki/")) {
              resources.push(resource);
              continue;
            }
            try {
              get().updatePendingTask(token, `Importando "${resource.title}"…`);
              const wiki = await ipc<{ title: string; html: string }>(
                "wikipedia:fetch", { exactTitle: resource.title, lang }
              );
              const article = await get().saveArticle({
                title: `${step.order + 1}/${wiki.title}`,
                source: "wikipedia",
                content: wiki.html,
                summary: "",
                links: [],
                tags: [tag],
                folderId: folder.id,
              });
              resources.push({ ...resource, articleId: article.id });
            } catch {
              // Sem internet/artigo removido nesse meio-tempo — o recurso
              // continua existindo, só sem o link interno.
              resources.push(resource);
            }
          }
          steps.push({ ...step, resources });
        }
        importedUnits.push({ ...unit, steps });
      }
      return importedUnits;
    } finally {
      get().endPendingTask(token);
    }
  },
  completeStep: async (pathId, stepId) => {
    const learningPath = get().paths.find(p => p.id === pathId);
    if (!learningPath) return;
    const now = new Date().toISOString();
    const doneIds = new Set<string>();
    for (const unit of learningPath.units) {
      for (const step of unit.steps) {
        if (step.status === "done" || step.id === stepId) doneIds.add(step.id);
      }
    }
    const units = learningPath.units.map(unit => ({
      ...unit,
      steps: unit.steps.map(step => {
        if (step.id === stepId) return { ...step, status: "done" as const, completedAt: now };
        if (step.status === "done") return step;
        const unlocked = step.prerequisiteIds.every(id => doneIds.has(id));
        return unlocked ? { ...step, status: "available" as const } : step;
      }),
    }));
    await get().savePathRecord({ ...learningPath, units });
  },
  // Reverte um passo concluído por engano — como o desbloqueio é estritamente
  // sequencial (prerequisiteIds de um passo é sempre só o anterior no
  // percurso achatado, ver materializeUnits em pathMaterialize.js), desfazer
  // um passo também tranca de volta tudo que vem depois dele: a conclusão
  // desses dependia da cadeia passar por este passo, e deixá-los "done" sem
  // ele deixaria a serpentina num estado que a UI não sabe representar
  // (passo concluído com pré-requisito bloqueado).
  uncompleteStep: async (pathId, stepId) => {
    const learningPath = get().paths.find(p => p.id === pathId);
    if (!learningPath) return;
    const flatSteps = learningPath.units.flatMap(u => u.steps);
    const idx = flatSteps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    const invalidatedIds = new Set(flatSteps.slice(idx + 1).map(s => s.id));
    const units = learningPath.units.map(unit => ({
      ...unit,
      steps: unit.steps.map(step => {
        if (step.id === stepId) {
          const { completedAt, ...rest } = step;
          return { ...rest, status: "available" as const };
        }
        if (invalidatedIds.has(step.id)) {
          const { completedAt, ...rest } = step;
          return { ...rest, status: "locked" as const };
        }
        return step;
      }),
    }));
    await get().savePathRecord({ ...learningPath, units });
  },
});
