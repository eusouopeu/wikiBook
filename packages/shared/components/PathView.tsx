// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/PathView.tsx
// Aba "Trilha" — percurso guiado estilo Duolingo. Três telas dentro do mesmo
// componente: lista de trilhas → assistente de criação (objetivo → entrevista
// de roteiro fixo → escolha de modelo → geração) → visualização serpentina
// dos passos com painel de detalhe.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import { Icon } from "./Icon";
import type { InterviewAnswer, LearningPath, PathGenerationModel, PathResource, PathStep } from "../shared/types";
import { INTERVIEW_SCRIPT } from "../lib/interviewScript";
import { PATH_MODEL_OPTIONS, estimatePathGenerationCostUsd, formatUsd } from "../lib/pathModels";
import { confirmDialog } from "../lib/confirmDialog";

function openResourceLink(url: string, internal = true) {
  window.lexicon.invoke("browser:open", { url, internal }).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

function pathProgress(p: LearningPath) {
  const total = p.units.reduce((acc, u) => acc + u.steps.length, 0);
  const done = p.units.reduce((acc, u) => acc + u.steps.filter(s => s.status === "done").length, 0);
  return { total, done };
}

// ── Tela 1: lista de trilhas ─────────────────────────────────────────────────
const PathList: React.FC<{ onCreate: () => void }> = ({ onCreate }) => {
  const { paths, openPath, deletePathRecord } = useStore();

  return (
    <div className="path-list-screen">
      <div className="path-list-header">
        <h2>Trilhas de aprendizado</h2>
        <button type="button" className="icon-btn" title="Nova trilha" aria-label="Nova trilha" onClick={onCreate}>
          <Icon name="add" />
        </button>
      </div>
      {paths.length === 0 ? (
        <div className="empty-state">
          <p>Diga o que você quer aprender — o app faz algumas perguntas e monta um
          percurso guiado, com os passos na ordem certa e fontes para cada um.</p>
          <button className="primary" onClick={onCreate}>+ Nova trilha</button>
        </div>
      ) : (
        <ul className="path-list">
          {paths.map(p => {
            const { total, done } = pathProgress(p);
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <li key={p.id} className="path-list-item" onClick={() => openPath(p.id)}>
                <div className="path-list-item-main">
                  <strong>{p.goal}</strong>
                  <div className="path-list-progress-bar">
                    <div className="path-list-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="path-list-progress-label">{done}/{total} passos concluídos</span>
                </div>
                <button
                  className="text-btn"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirmDialog(`Excluir a trilha "${p.goal}"? Isso não pode ser desfeito.`, "Excluir trilha")) {
                      deletePathRecord(p.id);
                    }
                  }}
                >
                  Excluir
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// ── Tela 2: assistente de criação ────────────────────────────────────────────
type WizardStage = "goal" | "interview" | "model" | "generating";

const CreatePathWizard: React.FC<{ onDone: () => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const { consolidateProfile, generatePathUnits, importPathArticles, savePathRecord } = useStore();
  const [stage, setStage] = useState<WizardStage>("goal");
  const [goal, setGoal] = useState("");
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [profileSummary, setProfileSummary] = useState("");
  const [model, setModel] = useState<PathGenerationModel>("sonnet-standard");
  const [error, setError] = useState("");

  const question = INTERVIEW_SCRIPT[qIndex];

  function submitAnswer(answer: string) {
    if (!answer.trim()) return;
    const next = [...answers, { questionId: question.id, question: question.prompt(goal), answer: answer.trim() }];
    setAnswers(next);
    setCurrentAnswer("");
    if (qIndex + 1 < INTERVIEW_SCRIPT.length) {
      setQIndex(qIndex + 1);
    } else {
      setStage("model");
      runConsolidation(next);
    }
  }

  function runConsolidation(withAnswers: InterviewAnswer[]) {
    setError("");
    consolidateProfile(goal, withAnswers)
      .then(setProfileSummary)
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }

  async function handleGenerate() {
    setStage("generating");
    setError("");
    try {
      const units = await generatePathUnits(goal, profileSummary, model);
      // Importa os artigos da Wikipedia selecionados pela trilha para uma
      // pasta própria — sem isso, os links dos passos abririam no navegador
      // do sistema em vez da própria aba de artigos do app.
      const importedUnits = await importPathArticles(units, goal);
      await savePathRecord({ goal, interviewAnswers: answers, profileSummary, model, units: importedUnits });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("model");
    }
  }

  return (
    <div className="path-wizard">
      <div className="path-wizard-header">
        <button className="text-btn" onClick={onCancel}><Icon name="back" /><span>Cancelar</span></button>
      </div>

      {stage === "goal" && (
        <div className="path-wizard-step">
          <h2>O que você quer aprender?</h2>
          <p className="path-wizard-hint">Ex.: "violão", "alemão", "calistenia"</p>
          <input
            type="text" autoFocus className="path-wizard-goal-input"
            value={goal} onChange={e => setGoal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && goal.trim()) setStage("interview"); }}
            placeholder="Digite seu objetivo…"
          />
          <div className="modal-actions">
            <button className="primary" disabled={!goal.trim()} onClick={() => setStage("interview")}>
              Continuar
            </button>
          </div>
        </div>
      )}

      {stage === "interview" && question && (
        <div className="path-wizard-step">
          <div className="path-wizard-progress">Pergunta {qIndex + 1} de {INTERVIEW_SCRIPT.length}</div>
          <h2>{question.prompt(goal)}</h2>
          {question.type === "choice" ? (
            <div className="path-wizard-choices">
              {question.options!.map(opt => (
                <button key={opt} className="path-wizard-choice" onClick={() => submitAnswer(opt)}>
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <>
              <textarea
                autoFocus rows={3} value={currentAnswer}
                onChange={e => setCurrentAnswer(e.target.value)}
                placeholder={question.placeholder}
              />
              <div className="modal-actions">
                <button className="primary" disabled={!currentAnswer.trim()} onClick={() => submitAnswer(currentAnswer)}>
                  {qIndex + 1 < INTERVIEW_SCRIPT.length ? "Próxima" : "Concluir entrevista"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {stage === "model" && (
        <div className="path-wizard-step">
          <h2>Como gerar sua trilha</h2>
          {!profileSummary ? (
            <p className="path-wizard-hint">Consolidando seu perfil a partir das respostas…</p>
          ) : (
            <p className="path-wizard-profile-summary">{profileSummary}</p>
          )}
          <div className="path-model-pills">
            {PATH_MODEL_OPTIONS.map(m => (
              <button
                key={m.id}
                className={model === m.id ? "path-model-pill active" : "path-model-pill"}
                onClick={() => setModel(m.id)}
              >
                <span className="path-model-pill-label">{m.label}</span>
                <span className="path-model-pill-desc">{m.description}</span>
                <span className="path-model-pill-cost">~{formatUsd(estimatePathGenerationCostUsd(m.id))} por geração</span>
              </button>
            ))}
          </div>
          {error && <div className="modal-error">{error}</div>}
          <div className="modal-actions">
            {error && !profileSummary && (
              <button onClick={() => runConsolidation(answers)}>Tentar novamente</button>
            )}
            <button className="primary" disabled={!profileSummary} onClick={handleGenerate}>
              Gerar trilha
            </button>
          </div>
        </div>
      )}

      {stage === "generating" && (
        <div className="path-wizard-step path-wizard-generating">
          <div className="spinner" />
          <p>Montando sua trilha de "{goal}"…</p>
          <p className="path-wizard-hint">Isso pode levar até 1 minuto.</p>
        </div>
      )}
    </div>
  );
};

// ── Painel de detalhe de um passo ────────────────────────────────────────────
const StepPanel: React.FC<{ step: PathStep; pathId: string; onClose: () => void; onOpenArticle?: (id: string) => void }> = ({ step, pathId, onClose, onOpenArticle }) => {
  const { completeStep, openArticle, setView } = useStore();

  // Recurso com articleId (importado na criação da trilha, ver
  // importPathArticles) abre o artigo dentro do app; sem articleId (falha de
  // rede na importação, ou trilha criada antes desta função existir) cai
  // para o navegador externo, como sempre foi.
  function openWikipediaResource(r: PathResource) {
    if (r.articleId) {
      openArticle(r.articleId);
      setView("article");
      onOpenArticle?.(r.articleId);
      onClose();
    } else {
      openResourceLink(r.url!);
    }
  }

  return (
    <div className="step-panel-overlay" onClick={onClose}>
      <div className="step-panel" onClick={e => e.stopPropagation()}>
        <button className="step-panel-close" onClick={onClose}>×</button>
        <h3>{step.title}</h3>
        <p className="step-panel-objective">{step.objective}</p>
        <div className="step-panel-meta">⏱ ~{step.estimatedMinutes} min</div>

        <h4>Prática</h4>
        <p>{step.practice}</p>

        {step.resources.length > 0 && (
          <>
            <h4>Recursos</h4>
            <ul className="step-panel-resources">
              {step.resources.map(r => (
                <li key={r.id} className="step-panel-resource">
                  {r.kind === "wikipedia" ? (
                    <button className="resource-link" onClick={() => openWikipediaResource(r)}>
                      <Icon name="read" /><span>{r.title}</span>
                    </button>
                  ) : (
                    <div className="resource-video">
                      <span className="resource-video-label">
                        <Icon name={r.kind === "image-search" ? "image" : "video"} /><span>{r.title}</span>
                      </span>
                      <div className="resource-video-engines">
                        {r.engines?.map(eng => (
                          <button key={eng.label} className="resource-engine-btn" onClick={() => openResourceLink(eng.url)}>
                            {eng.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {step.status !== "done" ? (
          <button className="primary step-panel-complete" onClick={() => { completeStep(pathId, step.id); onClose(); }}>
            <Icon name="check" /><span>Marcar como concluído</span>
          </button>
        ) : (
          <div className="step-panel-done-badge"><Icon name="check" /><span>Concluído</span></div>
        )}
      </div>
    </div>
  );
};

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

// ── Tela 3: percurso serpentino ──────────────────────────────────────────────
const PathDetail: React.FC<{ learningPath: LearningPath; onBack: () => void; onOpenArticle?: (id: string) => void }> = ({ learningPath, onBack, onOpenArticle }) => {
  const [openStep, setOpenStep] = useState<PathStep | null>(null);
  const { total, done } = pathProgress(learningPath);

  // Desbloqueio é estritamente sequencial (ver pathHandlers.js/platform/claude.ts:
  // um passo só fica "available" quando o anterior é concluído) — por isso o
  // passo imediatamente anterior na lista achatada é sempre o motivo real do
  // bloqueio, não uma suposição.
  const flatSteps = useMemo(
    () => learningPath.units.flatMap(u => u.steps),
    [learningPath]
  );
  const hasLockedStep = flatSteps.some(s => s.status === "locked");

  return (
    <div className="path-detail-screen">
      <div className="path-detail-header">
        <button className="text-btn" onClick={onBack}><Icon name="back" /><span>Todas as trilhas</span></button>
        <h2>{learningPath.goal}</h2>
        <span className="path-detail-progress-label">{done}/{total} passos</span>
      </div>

      <div className="path-serpentine">
        {learningPath.units.map((unit, unitIdx) => {
          const unitMinutes = unit.steps.reduce((acc, s) => acc + (s.estimatedMinutes || 0), 0);
          return (
          <div className="path-unit" key={unit.id}>
            <div className="path-unit-title">{unit.title}</div>
            <div className="path-unit-duration">{formatMinutes(unitMinutes)}</div>
            <div className="path-unit-steps">
              {unit.steps.map((step, stepIdx) => {
                const align = (unitIdx * 100 + stepIdx) % 2 === 0 ? "left" : "right";
                const isLocked = step.status === "locked";
                const flatIdx = flatSteps.indexOf(step);
                const prevStep = flatIdx > 0 ? flatSteps[flatIdx - 1] : null;
                const lockedReason = prevStep
                  ? `Bloqueado até concluir "${prevStep.title}"`
                  : "Bloqueado";
                return (
                  <button
                    key={step.id}
                    className={`path-step-node path-step-${step.status} path-step-align-${align}`}
                    onClick={() => step.status !== "locked" && setOpenStep(step)}
                    disabled={isLocked}
                    title={isLocked ? lockedReason : step.title}
                    aria-label={isLocked ? `${step.title} — ${lockedReason}` : step.title}
                  >
                    <span className="path-step-icon">
                      {step.status === "done" ? <Icon name="check" /> : isLocked ? <Icon name="locked" /> : "●"}
                    </span>
                    <span className="path-step-label">{step.title}</span>
                    <span className="path-step-duration">{formatMinutes(step.estimatedMinutes)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      {hasLockedStep && (
        <p className="path-locked-legend">
          <Icon name="locked" /> Passos bloqueados liberam um de cada vez, ao concluir o anterior.
        </p>
      )}

      {openStep && (
        <StepPanel
          step={openStep}
          pathId={learningPath.id}
          onClose={() => setOpenStep(null)}
          onOpenArticle={onOpenArticle}
        />
      )}
    </div>
  );
};

// ── Componente raiz da aba ───────────────────────────────────────────────────
// onOpenArticle: só usado pelo shell mobile (PathScreen), para trocar de tela
// quando um recurso de passo abre um artigo importado — no desktop, abrir o
// artigo já basta (setView troca a aba sozinho), como no GraphView.
export const PathView: React.FC<{ onOpenArticle?: (id: string) => void }> = ({ onOpenArticle }) => {
  const { paths, activePathId, openPath } = useStore();
  const [creating, setCreating] = useState(false);

  const activePath = useMemo(() => paths.find(p => p.id === activePathId) ?? null, [paths, activePathId]);

  if (creating) {
    return (
      <CreatePathWizard
        onDone={() => setCreating(false)}
        onCancel={() => setCreating(false)}
      />
    );
  }

  if (activePath) {
    return <PathDetail learningPath={activePath} onBack={() => openPath("")} onOpenArticle={onOpenArticle} />;
  }

  return <PathList onCreate={() => setCreating(true)} />;
};
