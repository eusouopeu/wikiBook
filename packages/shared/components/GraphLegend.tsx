// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/GraphLegend.tsx
// Legenda de cores e controles de zoom da aba Grafo do desktop.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { Icon } from "./Icon";

// ── Controles de zoom do grafo ────────────────────────────────────────────────
// Chama os métodos D3 expostos no SVGElement pelo GraphView
export const GraphControls: React.FC<{ canvasRef: React.RefObject<HTMLCanvasElement | null> }> = ({ canvasRef }) => (
  <div className="graph-controls">
    <button className="icon-btn" title="Aproximar" aria-label="Aproximar" onClick={() => (canvasRef.current as any)?.__zoomIn()}><Icon name="zoomIn" /></button>
    <button className="icon-btn" title="Afastar" aria-label="Afastar"   onClick={() => (canvasRef.current as any)?.__zoomOut()}><Icon name="zoomOut" /></button>
    <button className="icon-btn" title="Resetar" aria-label="Resetar"   onClick={() => (canvasRef.current as any)?.__zoomReset()}><Icon name="zoomReset" /></button>
  </div>
);

// Mesma paleta determinística de components/GraphView.tsx — duplicada aqui de
// propósito (import cruzado do módulo D3 traria d3 pro bundle só pra isso).
const TAG_PALETTE = ["#E05561", "#B58CF6", "#4EC9B0", "#E5C07B", "#61AFEF", "#D19A66", "#C678DD", "#98C379"];
function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

// ── Legenda de cores do grafo ─────────────────────────────────────────────────
// Tags viram chips clicáveis: clicar esmaece no GraphView todo nó sem aquela
// tag, sem escondê-los — assim dá pra achar um grupo temático sem perder o
// contexto das conexões ao redor.
export const GraphLegend: React.FC<{ tags: string[]; activeTag: string | null; onToggleTag: (t: string) => void }> = ({ tags, activeTag, onToggleTag }) => (
  <div className="graph-legend">
    <span><i className="legend-dot" style={{ background: "#378ADD" }} /> Wikipédia</span>
    <span><i className="legend-dot" style={{ background: "#BA7517" }} /> Claude</span>
    <span><i className="legend-dot" style={{ background: "#1D9E75" }} /> Manual</span>
    {tags.length > 0 && (
      <div className="graph-legend-tags">
        {tags.map(t => (
          <button
            key={t}
            type="button"
            className={`graph-legend-tag ${activeTag === t ? "active" : ""}`}
            style={{ "--tag-color": tagColor(t) } as React.CSSProperties}
            onClick={() => onToggleTag(t)}
          >
            <i className="legend-dot" style={{ background: tagColor(t) }} />#{t}
          </button>
        ))}
      </div>
    )}
  </div>
);
