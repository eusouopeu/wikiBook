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

import React, { useEffect, useRef, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  virtualizeThreshold?: number;
}

export function VirtualList<T>({
  items, itemHeight, itemKey, renderItem, className, virtualizeThreshold = 80,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const virtualize = items.length > virtualizeThreshold;

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
          height={height}
          width="100%"
          itemCount={items.length}
          itemSize={itemHeight}
          itemKey={(index: number) => itemKey(items[index], index)}
        >
          {({ index, style }: ListChildComponentProps) => (
            <div style={style}>{renderItem(items[index], index)}</div>
          )}
        </FixedSizeList>
      )}
    </div>
  );
}
