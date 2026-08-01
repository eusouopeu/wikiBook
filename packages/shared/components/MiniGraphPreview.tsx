// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/MiniGraphPreview.tsx
// Preview estático (sem force simulation) do artigo + vizinhos diretos,
// mostrado ao passar o mouse sobre um item da lista na sidebar (desktop).
// Reaproveita computeLocalSubgraph (mesma função usada pelo modo "Local" do
// GraphView) para achar os vizinhos; o layout em círculo é só trigonometria —
// não há física, então renderiza instantaneamente.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from "react";
import type { GraphNode, GraphEdge } from "../shared/types";
import { computeLocalSubgraph } from "../store/useStore";

const SOURCE_COLOR: Record<string, string> = {
  wikipedia: "#378ADD",
  claude: "#BA7517",
  manual: "#1D9E75",
};

interface Props {
  x: number;
  y: number;
  centerId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const WIDTH = 220;
const HEIGHT = 160;

export const MiniGraphPreview: React.FC<Props> = ({ x, y, centerId, nodes, edges }) => {
  const { nodes: subNodes, edges: subEdges } = useMemo(
    () => computeLocalSubgraph(nodes, edges, centerId, 1),
    [nodes, edges, centerId]
  );

  const positions = useMemo(() => {
    const cx = WIDTH / 2, cy = HEIGHT / 2;
    const others = subNodes.filter(n => n.id !== centerId);
    const radius = Math.min(WIDTH, HEIGHT) / 2 - 30;
    const map = new Map<string, { x: number; y: number }>();
    map.set(centerId, { x: cx, y: cy });
    others.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, others.length) - Math.PI / 2;
      map.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
    return map;
  }, [subNodes, centerId]);

  if (subNodes.length <= 1) return null;   // sem vizinhos — nada útil a mostrar

  return (
    <div className="mini-graph-preview" style={{ position: "fixed", top: y, left: x }}>
      <svg width={WIDTH} height={HEIGHT}>
        {subEdges.map(e => {
          const s = positions.get(e.source);
          const t = positions.get(e.target);
          if (!s || !t) return null;
          return <line key={e.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#888" strokeOpacity={0.5} strokeWidth={1} />;
        })}
        {subNodes.map(n => {
          const p = positions.get(n.id);
          if (!p) return null;
          const isCenter = n.id === centerId;
          const label = n.title.length > 16 ? n.title.slice(0, 14) + "…" : n.title;
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <circle r={isCenter ? 10 : 6} fill={SOURCE_COLOR[n.source] ?? "#888"} fillOpacity={0.85}
                      stroke={isCenter ? "#fff" : "none"} strokeWidth={1} strokeOpacity={0.5} />
              <text y={isCenter ? 22 : 16} textAnchor="middle" fontSize={9} fill="var(--fg, #ddd)">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
