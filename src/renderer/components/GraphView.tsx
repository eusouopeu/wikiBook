// ─────────────────────────────────────────────────────────────────────────────
// src/renderer/components/GraphView.tsx
// Visualização em grafo com D3 force layout.
// Funcionalidades:
//   - Nós com tamanho em cascata (pai 20% maior que filho, recursivamente)
//   - Zoom (scroll + pinch) e pan
//   - Clique num nó abre o artigo
//   - Arestas mostram o anchorText ao hover
//   - Cores por fonte: wikipedia=azul, claude=âmbar, manual=verde
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "../../shared/types";
import { useStore } from "../store/useStore";

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Paleta por fonte
const SOURCE_COLOR: Record<string, string> = {
  wikipedia: "#378ADD",
  claude:    "#BA7517",
  manual:    "#1D9E75",
};

export const GraphView: React.FC<Props> = ({ nodes, edges }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const openArticle = useStore(s => s.openArticle);
  const setView = useStore(s => s.setView);

  const draw = useCallback(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    // ── Camada raiz que recebe o zoom ─────────────────────────────────────────
    const root = svg.append("g").attr("class", "zoom-root");

    // ── Defs: marcadores de seta para as arestas ──────────────────────────────
    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 0 10 6")
      .attr("refX", 10).attr("refY", 3)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M0 0L10 3L0 6")
      .attr("fill", "none")
      .attr("stroke", "#888")
      .attr("stroke-width", "1.5")
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round");

    // ── Cópia mutável dos nós/arestas para D3 ────────────────────────────────
    // D3 modifica os objetos in-place; trabalhamos com cópias para não poluir o store
    const simNodes: (GraphNode & d3.SimulationNodeDatum)[] = nodes.map(n => ({ ...n }));
    const idToNode = new Map(simNodes.map(n => [n.id, n]));

    const simEdges = edges
      .filter(e => idToNode.has(e.source) && idToNode.has(e.target))
      .map(e => ({
        ...e,
        source: idToNode.get(e.source)!,
        target: idToNode.get(e.target)!,
      }));

    // ── Simulação de força ────────────────────────────────────────────────────
    const simulation = d3.forceSimulation(simNodes)
      .force("link",
        d3.forceLink(simEdges)
          .id((d: any) => d.id)
          .distance((d: any) => {
            // Links mais longos para nós maiores (raízes)
            const srcRadius = (d.source as GraphNode).radius;
            const tgtRadius = (d.target as GraphNode).radius;
            return (srcRadius + tgtRadius) * 2.2 + 20;
          })
          .strength(0.4)
      )
      .force("charge", d3.forceManyBody().strength(-320))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision",
        d3.forceCollide<GraphNode>().radius(n => n.radius + 18).strength(0.85)
      );

    // ── Arestas ───────────────────────────────────────────────────────────────
    const linkGroup = root.append("g").attr("class", "links");

    const linkLine = linkGroup.selectAll("line")
      .data(simEdges)
      .join("line")
      .attr("stroke", "#888")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.55)
      .attr("marker-end", "url(#arrow)")
      .style("cursor", "default");

    // Tooltip de aresta (anchorText)
    const edgeTooltip = svg.append("g")
      .attr("class", "edge-tooltip")
      .style("pointer-events", "none")
      .style("display", "none");

    const edgeTooltipRect = edgeTooltip.append("rect")
      .attr("rx", 4).attr("ry", 4)
      .attr("fill", "var(--bg2, #1e1e1e)")
      .attr("stroke", "#555")
      .attr("stroke-width", 0.5);

    const edgeTooltipText = edgeTooltip.append("text")
      .attr("fill", "var(--fg, #ddd)")
      .attr("font-size", "11px")
      .attr("dominant-baseline", "middle")
      .attr("text-anchor", "middle");

    linkLine
      .on("mouseenter", function (event, d) {
        const label = (d as any).anchorText as string;
        if (!label) return;
        edgeTooltipText.text(label);
        const bbox = (edgeTooltipText.node() as SVGTextElement).getBBox();
        const pad = 6;
        edgeTooltipRect
          .attr("x", bbox.x - pad).attr("y", bbox.y - pad / 2)
          .attr("width", bbox.width + pad * 2).attr("height", bbox.height + pad);
        const mx = event.offsetX, my = event.offsetY;
        edgeTooltip.attr("transform", `translate(${mx + 12},${my - 12})`).style("display", null);
      })
      .on("mouseleave", () => edgeTooltip.style("display", "none"));

    // ── Nós ───────────────────────────────────────────────────────────────────
    const nodeGroup = root.append("g").attr("class", "nodes");

    const nodeG = nodeGroup.selectAll("g")
      .data(simNodes)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode & d3.SimulationNodeDatum>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      );

    // Círculo de fundo (sombra sutil)
    nodeG.append("circle")
      .attr("r", d => d.radius + 3)
      .attr("fill", "none")
      .attr("stroke", d => SOURCE_COLOR[d.source] ?? "#888")
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.25);

    // Círculo principal
    nodeG.append("circle")
      .attr("r", d => d.radius)
      .attr("fill", d => SOURCE_COLOR[d.source] ?? "#888")
      .attr("fill-opacity", 0.18)
      .attr("stroke", d => SOURCE_COLOR[d.source] ?? "#888")
      .attr("stroke-width", d => d.depth === 0 ? 2.2 : 1.4);

    // Rótulo: título truncado
    nodeG.append("text")
      .text(d => d.title.length > 22 ? d.title.slice(0, 20) + "…" : d.title)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", d => Math.max(9, d.radius * 0.45) + "px")
      .attr("fill", d => SOURCE_COLOR[d.source] ?? "#aaa")
      .attr("pointer-events", "none")
      .style("user-select", "none");

    // Badge de profundidade (pequeno círculo no canto superior direito)
    nodeG.filter(d => d.depth === 0)
      .append("circle")
      .attr("cx", d => d.radius * 0.7)
      .attr("cy", d => -d.radius * 0.7)
      .attr("r", 5)
      .attr("fill", "#fff")
      .attr("fill-opacity", 0.12)
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.8)
      .attr("stroke-opacity", 0.4);

    // Hover: destaca nó e suas arestas
    nodeG
      .on("mouseenter", function (_event, d) {
        d3.select(this).select("circle:nth-child(2)")
          .attr("fill-opacity", 0.38);
        linkLine
          .attr("stroke-opacity", e =>
            (e.source as any).id === d.id || (e.target as any).id === d.id ? 1 : 0.12
          );
      })
      .on("mouseleave", function () {
        d3.select(this).select("circle:nth-child(2)")
          .attr("fill-opacity", 0.18);
        linkLine.attr("stroke-opacity", 0.55);
      })
      .on("click", (_event, d) => {
        openArticle(d.id);
        setView("article");
      });

    // ── Tick ──────────────────────────────────────────────────────────────────
    simulation.on("tick", () => {
      linkLine
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => {
          // Para a aresta parar na borda do círculo-alvo (não no centro)
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return d.target.x - (dx / dist) * (d.target.radius + 3);
        })
        .attr("y2", (d: any) => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return d.target.y - (dy / dist) * (d.target.radius + 3);
        });

      nodeG.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    // ── Zoom & Pan ────────────────────────────────────────────────────────────
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])          // zoom: 10% a 500%
      .on("zoom", (event) => {
        root.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Botões de zoom na UI (ver GraphControls abaixo) chamam estes programaticamente
    (svgRef.current as any).__zoomIn = () =>
      svg.transition().duration(300).call(zoom.scaleBy, 1.35);
    (svgRef.current as any).__zoomOut = () =>
      svg.transition().duration(300).call(zoom.scaleBy, 0.75);
    (svgRef.current as any).__zoomReset = () =>
      svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);

    // Stop simulation after it stabilizes
    simulation.alphaDecay(0.025);

  }, [nodes, edges, openArticle, setView]);

  useEffect(() => { draw(); }, [draw]);

  // Redesenha se o container for redimensionado
  useEffect(() => {
    if (!svgRef.current) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(svgRef.current.parentElement!);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <svg
      ref={svgRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
};
