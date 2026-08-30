// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/pathModels.ts
// Estimativa de custo por geração de trilha, para a tab-pill do wizard
// (ver PathView.tsx). O catálogo de modelos (label/description/preços) mora
// em claudePrompts.js/PATH_MODELS — fonte única também consumida por
// pathHandlers.js (desktop) e claude.ts (mobile) para a chamada de verdade;
// antes esse catálogo era duplicado aqui à mão, com risco de a estimativa de
// custo mostrada na UI divergir do modelo realmente chamado.
// ─────────────────────────────────────────────────────────────────────────────

import type { PathGenerationModel } from "../shared/types";
// @ts-ignore — claudePrompts.js é CommonJS plano (ver comentário no topo do
// arquivo), sem .d.ts; consumido via interop do esbuild, igual ao mobile.
import { PATH_MODELS } from "./claudePrompts.js";

export interface PathModelOption {
  id: PathGenerationModel;
  label: string;
  description: string;
  apiModel: string;
  thinking: boolean;
  // Orçamento de tokens de raciocínio (extended thinking) — só usado quando thinking=true
  thinkingBudgetTokens?: number;
  maxOutputTokens: number;
  pricePerMTokIn: number;
  pricePerMTokOut: number;
}

// Estimativas de tokens de entrada/saída para UMA geração de trilha completa
// (entrevista consolidada + ~6 unidades × ~5 passos). Usadas só para dar uma
// ordem de grandeza de custo, não é telemetria real.
const ESTIMATED_INPUT_TOKENS = 1400;
const ESTIMATED_OUTPUT_TOKENS = 5000;

export const PATH_MODEL_OPTIONS: PathModelOption[] = (Object.keys(PATH_MODELS) as PathGenerationModel[]).map(id => {
  const m = PATH_MODELS[id];
  return {
    id,
    label: m.label,
    description: m.description,
    apiModel: m.apiModel,
    thinking: m.thinking,
    thinkingBudgetTokens: m.thinkingBudgetTokens,
    maxOutputTokens: m.maxTokens,
    pricePerMTokIn: m.pricePerMTokIn,
    pricePerMTokOut: m.pricePerMTokOut,
  };
});

export function getPathModelOption(id: PathGenerationModel): PathModelOption {
  return PATH_MODEL_OPTIONS.find(m => m.id === id) ?? PATH_MODEL_OPTIONS[0];
}

// Estimativa em USD para uma geração completa de trilha neste modelo — soma
// tokens de entrada, saída e (se aplicável) o orçamento de pensamento, que a
// API cobra como token de saída.
export function estimatePathGenerationCostUsd(id: PathGenerationModel): number {
  const m = getPathModelOption(id);
  const outputTokens = ESTIMATED_OUTPUT_TOKENS + (m.thinking ? (m.thinkingBudgetTokens ?? 0) : 0);
  const cost = (ESTIMATED_INPUT_TOKENS / 1_000_000) * m.pricePerMTokIn
    + (outputTokens / 1_000_000) * m.pricePerMTokOut;
  return cost;
}

export function formatUsd(value: number): string {
  if (value < 0.01) return `US$ ${value.toFixed(4)}`;
  return `US$ ${value.toFixed(2)}`;
}
