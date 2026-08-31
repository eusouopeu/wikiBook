// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/GraphView.tsx
// Visualização em grafo com D3 force layout — desenhada em <canvas> (D3 só
// calcula a física; o desenho e o hit-testing de clique/hover/drag são
// manuais). Motivo da migração de SVG para canvas: cada nó em SVG virava
// 3-5 elementos DOM — algumas centenas de artigos bem conectados geravam
// milhares de nós DOM e derrubavam o FPS da simulação. Canvas não cresce em
// elementos DOM independente do tamanho do grafo.
//
// Funcionalidades preservadas do SVG original:
//   - Nós com tamanho em cascata (pai maior que filho, recursivamente)
//   - Zoom (scroll + pinch) e pan, arraste de nó
//   - Clique num nó abre o artigo
//   - Arestas mostram o anchorText ao hover (tooltip HTML sobreposto ao canvas)
//   - Cores por fonte: wikipedia=azul, claude=âmbar, manual=verde
// Acessibilidade (adaptada à mudança de tecnologia — canvas não tem nós DOM
// individualmente focáveis): o canvas é um único tab-stop; setas ciclam um
// nó "focado" logicamente (anel de foco desenhado à mão), Enter/Espaço abre
// o artigo focado, e uma região aria-live anuncia o título do nó focado.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useCallback, useState } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "../shared/types";
import { useStore } from "../store/useStore";

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  // Expõe o elemento <canvas> ao pai (para os botões de zoom em GraphControls)
  onCanvasReady?: (el: HTMLCanvasElement | null) => void;
  // Chamado após abrir um artigo por clique/Enter num nó, além da troca de view
  // padrão via store — usado pelo shell mobile, que navega por estado local
  // em vez do campo "view" do store (lido só pelo App.tsx do desktop)
  onNodeOpen?: (id: string) => void;
  // Tag selecionada na legenda (ver GraphLegend em App.tsx) — nós sem essa
  // tag ficam esmaecidos em vez de escondidos, para não perder o contexto
  // das conexões ao redor do que está em destaque.
  highlightTag?: string | null;
}

type SimNode = GraphNode & d3.SimulationNodeDatum;
interface SimEdge { id: string; anchorText: string; source: SimNode; target: SimNode; }

// Paleta por fonte
const SOURCE_COLOR: Record<string, string> = {
  wikipedia: "#378ADD",
  claude:    "#BA7517",
  manual:    "#1D9E75",
};

// Cor determinística por tag (anel externo do nó)
const TAG_PALETTE = ["#E05561", "#B58CF6", "#4EC9B0", "#E5C07B", "#61AFEF", "#D19A66", "#C678DD", "#98C379"];
function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

// Canvas 2D não lê variáveis CSS sozinho como o SVG lia via atributo
// fill="var(--fg)" — resolvemos manualmente uma vez por frame.
function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export const GraphView: React.FC<Props> = ({ nodes, edges, onCanvasReady, onNodeOpen, highlightTag }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const dprRef = useRef(1);
  const drawRef = useRef<() => void>(() => {});

  const openArticle = useStore(s => s.openArticle);
  const setView = useStore(s => s.setView);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [focusedTitle, setFocusedTitle] = useState("");
  const [canvasFocused, setCanvasFocused] = useState(false);

  useEffect(() => {
    onCanvasReady?.(canvasRef.current);
    return () => onCanvasReady?.(null);
  }, [onCanvasReady]);

  // ── Hit-testing em coordenadas de mundo (já convertidas do mouse via zoom) ──
  const hitTestNode = useCallback((wx: number, wy: number): SimNode | undefined => {
    const list = simNodesRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      const dx = wx - (n.x ?? 0), dy = wy - (n.y ?? 0);
      if (dx * dx + dy * dy <= n.radius * n.radius) return n;
    }
    return undefined;
  }, []);

  const hitTestEdge = useCallback((wx: number, wy: number): SimEdge | undefined => {
    const threshold = 6;
    for (const e of simEdgesRef.current) {
      const d = distToSegment(wx, wy, e.source.x ?? 0, e.source.y ?? 0, e.target.x ?? 0, e.target.y ?? 0);
      if (d <= threshold) return e;
    }
    return undefined;
  }, []);

  const toWorld = useCallback((mx: number, my: number): [number, number] => {
    return transformRef.current.invert([mx, my]);
  }, []);

  // ── Desenho — chamado a cada tick da simulação, zoom/pan, hover e foco ─────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const fg = readCssVar("--fg", "#ddd");
    const t = transformRef.current;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dprRef.current, dprRef.current);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const simNodes = simNodesRef.current;
    const simEdges = simEdgesRef.current;
    const focusedNode = canvasFocused ? simNodes[focusedIndex] : undefined;

    // Arestas
    for (const e of simEdges) {
      const sx = e.source.x ?? 0, sy = e.source.y ?? 0;
      const tx = e.target.x ?? 0, ty = e.target.y ?? 0;
      const dx = tx - sx, dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const endX = tx - (dx / dist) * (e.target.radius + 3);
      const endY = ty - (dy / dist) * (e.target.radius + 3);
      const isHighlighted = hoveredNodeId != null && (e.source.id === hoveredNodeId || e.target.id === hoveredNodeId);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = "#888";
      ctx.globalAlpha = hoveredNodeId ? (isHighlighted ? 1 : 0.12) : 0.55;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const angle = Math.atan2(dy, dx);
      const arrowSize = 5;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = "#888";
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Nós
    for (const n of simNodes) {
      const x = n.x ?? 0, y = n.y ?? 0;
      const color = SOURCE_COLOR[n.source] ?? "#888";
      const isHovered = n.id === hoveredNodeId;
      const isDimmed = !!highlightTag && !(n.tags ?? []).includes(highlightTag);
      const dimFactor = isDimmed ? 0.15 : 1;

      if ((n.tags?.length ?? 0) > 0) {
        ctx.beginPath();
        ctx.arc(x, y, n.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = tagColor(n.tags[0]);
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = 0.75 * dimFactor;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Sombra sutil
      ctx.beginPath();
      ctx.arc(x, y, n.radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.25 * dimFactor;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Círculo principal
      ctx.beginPath();
      ctx.arc(x, y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = (isHovered ? 0.38 : 0.18) * dimFactor;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = n.depth === 0 ? 2.2 : 1.4;
      ctx.globalAlpha = dimFactor;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Badge de profundidade (raízes)
      if (n.depth === 0) {
        ctx.beginPath();
        ctx.arc(x + n.radius * 0.7, y - n.radius * 0.7, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 0.12 * dimFactor;
        ctx.fill();
        ctx.globalAlpha = 0.4 * dimFactor;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Anel de foco (navegação por teclado)
      if (focusedNode && focusedNode.id === n.id) {
        ctx.beginPath();
        ctx.arc(x, y, n.radius + 9, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Rótulo
      const label = n.title.length > 30 ? n.title.slice(0, 28) + "…" : n.title;
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = fg;
      ctx.globalAlpha = 0.85 * dimFactor;
      ctx.fillText(label, x, y + n.radius + 14);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [hoveredNodeId, focusedIndex, canvasFocused, highlightTag]);

  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { draw(); }, [draw]);

  // ── Ajusta a resolução do canvas ao container (com devicePixelRatio) ───────
  const applyCanvasSize = useCallback((): { width: number; height: number } => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return { width: 800, height: 600 };
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    return { width, height };
  }, []);

  // ── Cria/recria a simulação quando nodes/edges mudam ────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const { width, height } = applyCanvasSize();

    const idToNode = new Map<string, SimNode>();
    const simNodes: SimNode[] = nodes.map(n => ({ ...n }));
    simNodes.forEach(n => idToNode.set(n.id, n));
    const simEdges: SimEdge[] = edges
      .filter(e => idToNode.has(e.source) && idToNode.has(e.target))
      .map(e => ({ id: e.id, anchorText: e.anchorText, source: idToNode.get(e.source)!, target: idToNode.get(e.target)! }));

    simNodesRef.current = simNodes;
    simEdgesRef.current = simEdges;

    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force("link",
        d3.forceLink<SimNode, SimEdge>(simEdges)
          .id(d => d.id)
          .distance(d => {
            const srcRadius = (d.source as SimNode).radius;
            const tgtRadius = (d.target as SimNode).radius;
            return (srcRadius + tgtRadius) * 2.2 + 20;
          })
          .strength(0.4)
      )
      .force("charge", d3.forceManyBody().strength(-320))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius(n => n.radius + 18).strength(0.85))
      .alphaDecay(0.025)
      .on("tick", () => drawRef.current());

    simulationRef.current = simulation;
    setFocusedIndex(0);
    drawRef.current();

    return () => { simulation.stop(); simulationRef.current = null; };
  }, [nodes, edges, applyCanvasSize]);

  // ── Zoom, pan e arraste de nó ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const selection = d3.select(canvas);

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 5])
      .filter((event: any) => {
        if (event.button) return false;
        if (event.type === "mousedown" || event.type === "touchstart") {
          const [mx, my] = d3.pointer(event, canvas);
          const [wx, wy] = toWorld(mx, my);
          return !hitTestNode(wx, wy);   // clique sobre nó pertence ao drag, não ao pan
        }
        return true;
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        drawRef.current();
      });
    selection.call(zoom);

    (canvas as any).__zoomIn = () => selection.transition().duration(300).call(zoom.scaleBy, 1.35);
    (canvas as any).__zoomOut = () => selection.transition().duration(300).call(zoom.scaleBy, 0.75);
    (canvas as any).__zoomReset = () => selection.transition().duration(400).call(zoom.transform, d3.zoomIdentity);

    const drag = d3.drag<HTMLCanvasElement, unknown, SimNode | undefined>()
      .subject((event: any) => {
        const [mx, my] = d3.pointer(event, canvas);
        const [wx, wy] = toWorld(mx, my);
        return hitTestNode(wx, wy);
      })
      .on("start", (event) => {
        if (!event.subject) return;
        if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        if (!event.subject) return;
        const [mx, my] = d3.pointer(event.sourceEvent, canvas);
        const [wx, wy] = toWorld(mx, my);
        event.subject.fx = wx;
        event.subject.fy = wy;
        drawRef.current();
      })
      .on("end", (event) => {
        if (!event.subject) return;
        if (!event.active) simulationRef.current?.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      });
    selection.call(drag);

    return () => { selection.on(".zoom", null); selection.on(".drag", null); };
  }, [hitTestNode, toWorld]);

  // ── Hover (nó destacado + tooltip de aresta) e clique ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleMouseMove(event: MouseEvent) {
      const [mx, my] = d3.pointer(event, canvas);
      const [wx, wy] = toWorld(mx, my);
      const node = hitTestNode(wx, wy);
      setHoveredNodeId(prev => (prev === (node?.id ?? null) ? prev : node?.id ?? null));
      if (node) { setHoverTooltip(null); return; }
      const edge = hitTestEdge(wx, wy);
      setHoverTooltip(edge?.anchorText ? { x: mx, y: my, text: edge.anchorText } : null);
    }
    function handleMouseLeave() {
      setHoveredNodeId(null);
      setHoverTooltip(null);
    }
    function handleClick(event: MouseEvent) {
      const [mx, my] = d3.pointer(event, canvas);
      const [wx, wy] = toWorld(mx, my);
      const node = hitTestNode(wx, wy);
      if (!node) return;
      openArticle(node.id);
      setView("article");
      onNodeOpen?.(node.id);
    }

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("click", handleClick);
    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("click", handleClick);
    };
  }, [hitTestNode, hitTestEdge, toWorld, openArticle, setView, onNodeOpen]);

  // ── Redimensionamento: recentraliza a simulação preservando posições ───────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = applyCanvasSize();
      const sim = simulationRef.current;
      if (sim) {
        sim.force("center", d3.forceCenter(width / 2, height / 2));
        sim.alpha(0.2).restart();
      }
      drawRef.current();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyCanvasSize]);

  // ── Teclado: Tab foca o canvas (tab-stop único); setas ciclam o nó focado ──
  useEffect(() => {
    setFocusedTitle(simNodesRef.current[focusedIndex]?.title ?? "");
  }, [focusedIndex, nodes]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const list = simNodesRef.current;
    if (list.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex(i => (i + 1) % list.length);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex(i => (i - 1 + list.length) % list.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const node = list[focusedIndex];
      if (node) { openArticle(node.id); setView("article"); onNodeOpen?.(node.id); }
    }
  }

  return (
    <div className="graph-canvas-wrap">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Grafo de artigos — use as setas para navegar entre artigos e Enter para abrir"
        style={{ width: "100%", height: "100%", display: "block" }}
        onFocus={() => setCanvasFocused(true)}
        onBlur={() => setCanvasFocused(false)}
        onKeyDown={handleKeyDown}
      />
      {hoverTooltip && (
        <div className="graph-edge-tooltip" style={{ left: hoverTooltip.x + 12, top: hoverTooltip.y - 12 }}>
          {hoverTooltip.text}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {canvasFocused && focusedTitle ? `Artigo focado: ${focusedTitle}` : ""}
      </div>
    </div>
  );
};
