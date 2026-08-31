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
  ArrowUpOnSquareIcon,
  ArrowsPointingOutIcon,
  ArrowsRightLeftIcon,
  Bars3Icon,
  Bars4Icon,
  BookOpenIcon,
  BookmarkIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CheckBadgeIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  DocumentDuplicateIcon,
  DocumentIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  FireIcon,
  FolderIcon,
  FolderOpenIcon,
  KeyIcon,
  LightBulbIcon,
  LinkSlashIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MapIcon,
  MoonIcon,
  PaperClipIcon,
  PencilIcon,
  PhotoIcon,
  PlayCircleIcon,
  PlusIcon,
  RectangleStackIcon,
  ShareIcon,
  SignalIcon,
  SparklesIcon,
  SunIcon,
  TableCellsIcon,
  TrashIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

// O nome é semântico (o que o ícone significa), nunca o desenho: se amanhã
// "grafo" virar outro pictograma, os call sites continuam válidos.
const ICONS = {
  add: PlusIcon,
  attachment: PaperClipIcon,
  back: ArrowLeftIcon,
  batchImport: DocumentDuplicateIcon,
  chat: ChatBubbleLeftRightIcon,
  check: CheckIcon,
  clear: TrashIcon,
  close: XMarkIcon,
  densityComfortable: Bars4Icon,
  densityCompact: Bars3Icon,
  done: CheckBadgeIcon,
  edit: PencilIcon,
  errors: ExclamationTriangleIcon,
  externalSource: ArrowTopRightOnSquareIcon,
  file: DocumentIcon,
  flashcards: AcademicCapIcon,
  flashcardsExport: RectangleStackIcon,
  folder: FolderIcon,
  folderOpen: FolderOpenIcon,
  forward: ArrowRightIcon,
  graph: ShareIcon,
  hint: LightBulbIcon,
  history: ClockIcon,
  image: PhotoIcon,
  locked: LockClosedIcon,
  next: ChevronDownIcon,
  orphan: LinkSlashIcon,
  path: MapIcon,
  pin: BookmarkIcon,
  prev: ChevronUpIcon,
  random: ArrowsRightLeftIcon,
  read: BookOpenIcon,
  refresh: ArrowPathIcon,
  save: ArrowDownTrayIcon,
  search: MagnifyingGlassIcon,
  semantic: SparklesIcon,
  settings: Cog6ToothIcon,
  share: ArrowUpOnSquareIcon,
  shortcuts: CommandLineIcon,
  sidebar: ViewColumnsIcon,
  stats: ChartBarIcon,
  streak: FireIcon,
  table: TableCellsIcon,
  text: DocumentTextIcon,
  themeSystem: ComputerDesktopIcon,
  themeLight: SunIcon,
  themeDark: MoonIcon,
  token: KeyIcon,
  connection: SignalIcon,
  trash: TrashIcon,
  video: PlayCircleIcon,
  zoomIn: MagnifyingGlassPlusIcon,
  zoomOut: MagnifyingGlassMinusIcon,
  zoomReset: ArrowsPointingOutIcon,
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
