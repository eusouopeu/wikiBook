// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/Icon.tsx
// Ponto único de tradução "nome semântico → ícone Heroicons (outline 24)".
// Todos os ícones da UI passam por aqui: assim trocar um desenho é editar uma
// linha do mapa, não caçar o glifo espalhado por App.tsx/ArticleView.tsx.
//
// Dimensão em `1em` (e não px fixo) de propósito: os botões já definem o
// tamanho via `font-size` no CSS (.icon-btn = 15px, .mobile-icon-btn = 1.3rem,
// .context-menu-item = 16px). Herdando o em, o ícone respeita o tamanho que a
// tela já pedia — inclusive a escala de fonte de acessibilidade — sem precisar
// tocar em nenhuma regra de CSS existente.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import {
  AcademicCapIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  Bars3Icon,
  Bars4Icon,
  BookOpenIcon,
  BookmarkIcon,
  ChatBubbleLeftRightIcon,
  CheckBadgeIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  Cog6ToothIcon,
  DocumentIcon,
  DocumentTextIcon,
  FolderIcon,
  LightBulbIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MapIcon,
  PaperClipIcon,
  PencilIcon,
  PhotoIcon,
  PlayCircleIcon,
  RectangleStackIcon,
  ShareIcon,
  SparklesIcon,
  TableCellsIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

// O nome é semântico (o que o ícone significa), nunca o desenho: se amanhã
// "grafo" virar outro pictograma, os call sites continuam válidos.
const ICONS = {
  attachment: PaperClipIcon,
  back: ArrowLeftIcon,
  chat: ChatBubbleLeftRightIcon,
  check: CheckIcon,
  clear: TrashIcon,
  close: XMarkIcon,
  densityComfortable: Bars4Icon,
  densityCompact: Bars3Icon,
  done: CheckBadgeIcon,
  edit: PencilIcon,
  externalSource: ArrowTopRightOnSquareIcon,
  file: DocumentIcon,
  flashcards: AcademicCapIcon,
  flashcardsExport: RectangleStackIcon,
  folder: FolderIcon,
  forward: ArrowRightIcon,
  graph: ShareIcon,
  hint: LightBulbIcon,
  history: ClockIcon,
  image: PhotoIcon,
  locked: LockClosedIcon,
  next: ChevronDownIcon,
  path: MapIcon,
  pin: BookmarkIcon,
  prev: ChevronUpIcon,
  read: BookOpenIcon,
  refresh: ArrowPathIcon,
  save: ArrowDownTrayIcon,
  search: MagnifyingGlassIcon,
  semantic: SparklesIcon,
  settings: Cog6ToothIcon,
  table: TableCellsIcon,
  text: DocumentTextIcon,
  trash: TrashIcon,
  video: PlayCircleIcon,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** Sobrescreve o tamanho herdado (`1em`). Use só quando o CSS do container não define font-size. */
  size?: number | string;
  className?: string;
  title?: string;
}

export function Icon({ name, size = "1em", className, title }: IconProps) {
  const Svg = ICONS[name];
  return (
    <Svg
      className={className ? `hi ${className}` : "hi"}
      width={size}
      height={size}
      // O rótulo acessível vive no title/aria-label do <button> que envolve o
      // ícone, então aqui ele é decorativo — anunciá-lo de novo duplicaria a
      // leitura no screen reader.
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    />
  );
}
