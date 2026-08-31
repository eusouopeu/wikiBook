// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/screens/GraphScreen.tsx
// Envolve o GraphView de @lexicon/shared — reaproveitado sem alteração de
// lógica: d3.zoom() e d3.drag() já escutam eventos de touch nativamente
// (pinch-to-zoom e arraste de nó funcionam sem código extra). A única
// mudança no componente compartilhado foi um prop opcional (onNodeOpen) para
// a navegação local do shell mobile.
//
// O toggle global/local e os botões de zoom são os mesmos do GraphControls/
// graph-scope-toggle do desktop (App.tsx) — replicados aqui porque o
// desktop não expõe esse pedaço como componente separado (está inline no
// App.tsx de 3 colunas, que o mobile não reaproveita). Ambos ficam nos
// "actions" da TopBar padronizada (ver components/TopBar.tsx).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from "react";
import { useStore, computeLocalSubgraph, GraphView, GraphLegend, TopBar, Icon } from "@lexicon/shared";

interface Props {
  onOpenArticle: (id: string) => void;
}

const GraphControls: React.FC<{ canvasRef: React.RefObject<HTMLCanvasElement | null> }> = ({ canvasRef }) => (
  <div className="graph-controls">
    <button className="icon-btn" title="Aproximar" aria-label="Aproximar" onClick={() => (canvasRef.current as any)?.__zoomIn()}><Icon name="zoomIn" /></button>
    <button className="icon-btn" title="Afastar" aria-label="Afastar" onClick={() => (canvasRef.current as any)?.__zoomOut()}><Icon name="zoomOut" /></button>
    <button className="icon-btn" title="Resetar" aria-label="Resetar" onClick={() => (canvasRef.current as any)?.__zoomReset()}><Icon name="zoomReset" /></button>
  </div>
);

export function GraphScreen({ onOpenArticle }: Props) {
  const {
    graphNodes, graphEdges, activeArticleId,
    graphScope, setGraphScope, localDepth, setLocalDepth,
    requestSearchFocus,
  } = useStore();
  const [graphCanvasEl, setGraphCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const displayedGraph = useMemo(() => {
    if (graphScope !== "local" || !activeArticleId) return { nodes: graphNodes, edges: graphEdges };
    return computeLocalSubgraph(graphNodes, graphEdges, activeArticleId, localDepth);
  }, [graphScope, activeArticleId, localDepth, graphNodes, graphEdges]);

  const displayedGraphTags = useMemo(() => {
    const tags = new Set<string>();
    for (const n of displayedGraph.nodes) for (const t of n.tags ?? []) tags.add(t);
    return Array.from(tags).sort();
  }, [displayedGraph]);
  useEffect(() => {
    if (tagFilter && !displayedGraphTags.includes(tagFilter)) setTagFilter(null);
  }, [displayedGraphTags, tagFilter]);

  return (
    <div className="mobile-graph-screen">
      <TopBar
        title="Grafo"
        onSearch={requestSearchFocus}
        actions={
          <>
            <div className="graph-scope-toggle">
              <button className={graphScope === "global" ? "active" : ""} onClick={() => setGraphScope("global")}>
                Global
              </button>
              <button
                className={graphScope === "local" ? "active" : ""}
                disabled={!activeArticleId}
                onClick={() => setGraphScope("local")}
              >
                Local
              </button>
            </div>
            {graphScope === "local" && (
              <select className="graph-depth-select" value={localDepth}
                      onChange={e => setLocalDepth(Number(e.target.value) as 1 | 2)}>
                <option value={1}>1 salto</option>
                <option value={2}>2 saltos</option>
              </select>
            )}
            <GraphControls canvasRef={{ current: graphCanvasEl }} />
          </>
        }
      />

      <div className="graph-container">
        {displayedGraph.nodes.length > 0 ? (
          <>
            <GraphView
              nodes={displayedGraph.nodes}
              edges={displayedGraph.edges}
              onCanvasReady={setGraphCanvasEl}
              onNodeOpen={onOpenArticle}
              highlightTag={tagFilter}
            />
            <GraphLegend
              tags={displayedGraphTags}
              activeTag={tagFilter}
              onToggleTag={t => setTagFilter(prev => (prev === t ? null : t))}
            />
          </>
        ) : (
          <div className="mobile-empty">
            {graphScope === "local"
              ? "Este artigo não tem vizinhos dentro do alcance selecionado."
              : "O grafo aparecerá aqui conforme você cria artigos e vínculos."}
          </div>
        )}
      </div>
    </div>
  );
}
