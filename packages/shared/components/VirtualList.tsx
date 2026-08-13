// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/VirtualList.tsx
// Lista virtualizada genérica (react-window) — usada pela lista de artigos no
// desktop (App.tsx) e no mobile (ArticleListScreen.tsx). Cada artigo é um
// arquivo JSON independente e a lista/o grafo recalculam a cada render; numa
// base com centenas de artigos, renderizar todos os <li> de uma vez pesa.
//
// Abaixo de `virtualizeThreshold` itens, renderiza a lista normal sem
// react-window — bases pequenas (o caso comum) não pagam o custo de medir
// altura via ResizeObserver nem os efeitos colaterais de windowing (perda de
// scroll nativo do container, foco em itens fora da janela renderizada etc.).
// ─────────────────────────────────────────────────────────────────────────────

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FixedSizeList, type ListChildComponentProps, type ListOnItemsRenderedProps } from "react-window";

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  virtualizeThreshold?: number;
}

export interface VirtualListHandle {
  scrollToItem: (index: number, align?: "auto" | "smart" | "center" | "end" | "start") => void;
}

function VirtualListInner<T>(
  { items, itemHeight, itemKey, renderItem, className, virtualizeThreshold = 80 }: VirtualListProps<T>,
  ref: React.Ref<VirtualListHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const [height, setHeight] = useState(0);
  const virtualize = items.length > virtualizeThreshold;

  // Primeiro índice atualmente visível — usado para reancorar o scroll quando
  // `itemHeight` muda (ex.: alternar densidade da lista) e quando o chamador
  // pede scrollToItem em índices fora da janela renderizada (ex.: navegação
  // por teclado na busca).
  const visibleStartRef = useRef(0);
  const prevItemHeightRef = useRef(itemHeight);

  useEffect(() => {
    if (!virtualize) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height;
      if (h) setHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualize]);

  // Sem isso, trocar `itemHeight` (ex.: densidade compacta ↔ confortável) faz
  // o react-window recalcular o mapeamento pixel→índice a partir do mesmo
  // `scrollTop` em pixels, medido com a altura antiga — a lista "pula" para um
  // trecho diferente de itens em vez de manter o que estava no topo.
  useEffect(() => {
    if (prevItemHeightRef.current === itemHeight) return;
    prevItemHeightRef.current = itemHeight;
    listRef.current?.scrollToItem(visibleStartRef.current, "start");
  }, [itemHeight]);

  useImperativeHandle(ref, () => ({
    scrollToItem: (index, align = "smart") => {
      if (!virtualize) return;
      listRef.current?.scrollToItem(index, align);
    },
  }), [virtualize]);

  const handleItemsRendered = (props: ListOnItemsRenderedProps) => {
    visibleStartRef.current = props.visibleStartIndex;
  };

  if (!virtualize) {
    return (
      <div ref={containerRef} className={className}>
        {items.map((item, i) => (
          <React.Fragment key={itemKey(item, i)}>{renderItem(item, i)}</React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} style={{ padding: 0 }}>
      {height > 0 && (
        <FixedSizeList
          ref={listRef}
          height={height}
          width="100%"
          itemCount={items.length}
          itemSize={itemHeight}
          itemKey={(index: number) => itemKey(items[index], index)}
          onItemsRendered={handleItemsRendered}
        >
          {({ index, style }: ListChildComponentProps) => (
            <div style={style}>{renderItem(items[index], index)}</div>
          )}
        </FixedSizeList>
      )}
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListHandle> }
) => React.ReactElement;
