// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/pathModels.ts
// Catálogo dos 3 modos de geração de trilha oferecidos na tab-pill do wizard,
// e a estimativa de custo por solicitação mostrada abaixo de cada um.
// Preços por milhão de tokens (USD) — tabela pública da Anthropic, ago/2026.
// Puramente client-side: não faz chamada nenhuma, só aritmética, para o
// usuário comparar as opções ANTES de gastar a chamada de verdade.
// ─────────────────────────────────────────────────────────────────────────────

import type { PathGenerationModel } from "../shared/types";

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

export const PATH_MODEL_OPTIONS: PathModelOption[] = [
  {
    id: "sonnet-standard",
    label: "Sonnet 5",
    description: "Padrão — rápido e barato, sem raciocínio estendido.",
    apiModel: "claude-sonnet-5",
    thinking: false,
    maxOutputTokens: 8000,
    pricePerMTokIn: 3,
    pricePerMTokOut: 15,
  },
  {
    id: "sonnet-thinking",
    label: "Sonnet 5 + pensamento",
    description: "Mesmo modelo, com raciocínio estendido — trilhas mais bem sequenciadas.",
    apiModel: "claude-sonnet-5",
    thinking: true,
    thinkingBudgetTokens: 6000,
    maxOutputTokens: 10000,
    pricePerMTokIn: 3,
    pricePerMTokOut: 15,
  },
  {
    id: "opus-standard",
    label: "Opus 5",
    description: "Modelo mais forte, sem raciocínio estendido — melhor senso pedagógico.",
    apiModel: "claude-opus-5",
    thinking: false,
    maxOutputTokens: 8000,
    pricePerMTokIn: 15,
    pricePerMTokOut: 75,
  },
];

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
