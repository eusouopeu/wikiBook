// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/components/ArticleView.tsx
// Leitor/editor de artigo. Peças autocontidas vivem em arquivos próprios:
// ExcerptEditor/ExcerptsPanel/SaveExcerptModal (trechos), ArticleHistoryPanel,
// AttachmentsPanel, FlashcardsPanel/ReviewModal, BacklinksPanel, TagEditor,
// FindInPageBar, SectionsTocPanel e ArticleOverlays (menu de contexto etc.).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { Article, ArticleExcerpt, ExcerptCategory, Flashcard, FlashcardGrade } from "../shared/types";
import { useStore } from "../store/useStore";
import { computeTrackedEdit, stripTrackedMarkup } from "../lib/excerptDiff";
import { confirmDialog } from "../lib/confirmDialog";
import { buildWikiAccordions, openAncestorDetails } from "../lib/wikiAccordions";
import { findLinkSuggestions } from "../lib/linkSuggestions";
import { escapeHtml, markdownToHtml, excerptHtmlToMarkdown } from "../lib/markdown";
import {
  sanitize, summaryToHtml, linkifyPlainText, injectInternalLinks,
  getSelectionHtml, getSelectionTableHtml,
} from "../lib/articleHtml";
import { resolveOutline } from "../lib/excerptOutline";
import { clearFindMarks, highlightFindMatches } from "../lib/findInPage";
import { slugifyHeading, type TocItem } from "../lib/sectionsToc";
import { Icon } from "./Icon";
import { ReviewModal } from "./ReviewModal";
import { handleFormatShortcut } from "./ExcerptEditor";
import { SaveExcerptModal } from "./SaveExcerptModal";
import { ExcerptsPanel } from "./ExcerptsPanel";
import { BacklinksPanel, type Backlink } from "./BacklinksPanel";
import { TagEditor } from "./TagEditor";
import { FlashcardsPanel } from "./FlashcardsPanel";
import { FindInPageBar } from "./FindInPageBar";
import { SectionsTocPanel } from "./SectionsTocPanel";
import { ArticleHistoryPanel } from "./ArticleHistoryPanel";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { SelectionHintBubble, LinkHoverPreview, ContextMenu } from "./ArticleOverlays";

interface Props {
  article: Article;
  // Quando informado (shell mobile), os 4 ícones "primários" do cabeçalho
  // (buscar/sumário/chat/flashcards) são renderizados via portal dentro
  // desse elemento — a barra de navegação superior do próprio shell — em vez
  // de ficarem ao lado do <h1>, liberando espaço no título numa tela estreita.
  // No desktop (sem slot), continuam inline como sempre.
  headerActionsSlot?: HTMLElement | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export const ArticleView: React.FC<Props> = ({ article, headerActionsSlot }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const summaryRef   = useRef<HTMLDivElement>(null);
  const [showSummary, setShowSummary]         = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  // Prévia do resumo regenerado — nunca sobrescreve o resumo atual direto;
  // o usuário compara e decide aplicar ou descartar (evita perder o resumo
  // anterior se a nova geração vier pior).
  const [summaryPreview, setSummaryPreview] = useState<string | null>(null);
  // Se o resumo automático falhou na criação (ver useStore.ts/fetchFromWikipedia),
  // o artigo é salvo com esse texto fixo — o botão "Regenerar resumo" fica na
  // aba Resumo normalmente. A aba padrão ao abrir qualquer artigo é sempre
  // "Artigo": como este componente não é remontado ao trocar de artigo (só a
  // prop muda), sem este reset a aba "Resumo" ficaria "grudada" ao navegar
  // para outro artigo enquanto ela estivesse aberta.
  const summaryFailed = article.summary.trim() === "• Resumo não disponível.";
  useEffect(() => { setShowSummary(false); }, [article.id]);
  const [saveModal, setSaveModal] = useState<{
    visible: boolean; kind: "text" | "table" | "image"; category: ExcerptCategory;
    html: string; src?: string; alt?: string;
  }>({ visible: false, kind: "text", category: "default", html: "" });
  // Edição de artigos manuais (conteúdo em Markdown)
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  // Chat contextual ("Perguntar ao Claude")
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  // Índices de mensagens do assistente já salvas como trecho no artigo — evita
  // duplicar ao clicar "Salvar" mais de uma vez na mesma resposta
  const [savedChatIndices, setSavedChatIndices] = useState<Set<number>>(new Set());
  // Sugestões de link descartadas pelo usuário nesta sessão de visualização
  // (não persistido — reabrir o artigo mostra as sugestões de novo)
  const [dismissedTerms, setDismissedTerms] = useState<Set<string>>(new Set());
  // Quantas sugestões de link mostrar de uma vez ("carregar mais" avança isso)
  const [suggestionLimit, setSuggestionLimit] = useState(20);
  // Edição de trechos salvos (texto)
  const [editingExcerptId, setEditingExcerptId] = useState<string | null>(null);
  const [excerptEditDraft, setExcerptEditDraft] = useState("");
  const [excerptEditBaseline, setExcerptEditBaseline] = useState("");
  // Flashcards
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Histórico de versões
  const [historyOpen, setHistoryOpen] = useState(false);
  // Buscar na página
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCount, setFindCount] = useState(0);
  const [findIndex, setFindIndex] = useState(0);
  const findMatchesRef = useRef<HTMLElement[]>([]);
  // Sumário (Conteúdo)
  const [tocOpen, setTocOpen] = useState(false);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);

  const { contextMenu, showContextMenu, hideContextMenu,
          fetchFromWikipedia, generateWithClaude, addLink, removeLink,
          openArticle, articles, saveArticle, deleteArticle, restoreArticle, loadArticles,
          updateTags, updateExcerptMarkdown, updateExcerptOutline,
          showToast, selectionHintSeen, dismissSelectionHint } = useStore(useShallow(s => ({
    contextMenu: s.contextMenu, showContextMenu: s.showContextMenu,
    hideContextMenu: s.hideContextMenu, fetchFromWikipedia: s.fetchFromWikipedia,
    generateWithClaude: s.generateWithClaude, addLink: s.addLink,
    removeLink: s.removeLink, openArticle: s.openArticle, articles: s.articles,
    saveArticle: s.saveArticle, deleteArticle: s.deleteArticle, restoreArticle: s.restoreArticle,
    loadArticles: s.loadArticles, updateTags: s.updateTags,
    updateExcerptMarkdown: s.updateExcerptMarkdown, updateExcerptOutline: s.updateExcerptOutline,
    showToast: s.showToast, selectionHintSeen: s.selectionHintSeen,
    dismissSelectionHint: s.dismissSelectionHint,
  })));

  const outline = useMemo(() => resolveOutline(article), [article]);

  // Todas as tags já usadas na base — alimenta o autocomplete do TagEditor
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) for (const t of a.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [articles]);


  // Carrega os flashcards já gerados para este artigo (sem forçar regeneração)
  const loadFlashcards = useCallback(async () => {
    const res = await window.lexicon.invoke("flashcards:list", { articleId: article.id });
    if (res.ok) setFlashcards((res.data as Flashcard[]) ?? []);
  }, [article.id]);

  const handleRegenerateFlashcards = useCallback(async () => {
    setFlashcardsLoading(true);
    try {
      const res = await window.lexicon.invoke("flashcards:regenerate", { articleId: article.id });
      if (res.ok) setFlashcards((res.data as Flashcard[]) ?? []);
      else showToast(res.error ?? "Falha ao gerar flashcards.", "error");
    } finally {
      setFlashcardsLoading(false);
    }
  }, [article.id, showToast]);

  const handleGradeCard = useCallback(async (articleId: string, cardId: string, grade: FlashcardGrade) => {
    await window.lexicon.invoke("flashcards:grade", { articleId, cardId, grade });
    if (articleId === article.id) await loadFlashcards();
  }, [article.id, loadFlashcards]);

  // Sai do modo de edição, reseta o chat e recarrega os flashcards ao trocar de artigo
  useEffect(() => {
    setIsEditing(false);
    setChatOpen(false);
    setChatMessages([]);
    setChatInput("");
    setEditingExcerptId(null);
    setReviewOpen(false);
    setHistoryOpen(false);
    setFindOpen(false);
    setFindQuery("");
    setTocOpen(false);
    loadFlashcards();
  }, [article.id, loadFlashcards]);

  // ── Buscar na página: (re)destaca as ocorrências no container ativo ────────
  useEffect(() => {
    const container = showSummary ? summaryRef.current : containerRef.current;
    if (!findOpen || !container) {
      [containerRef.current, summaryRef.current].forEach(el => el && clearFindMarks(el));
      findMatchesRef.current = [];
      setFindCount(0);
      return;
    }
    const matches = highlightFindMatches(container, findQuery);
    findMatchesRef.current = matches;
    setFindCount(matches.length);
    setFindIndex(0);
  }, [findOpen, findQuery, showSummary, article.id]);

  // Marca o resultado atual e rola até ele — abrindo antes qualquer
  // accordion/toggle fechado em que o match esteja (senão o match existe no
  // DOM mas fica invisível, escondido pelo <details> recolhido)
  useEffect(() => {
    findMatchesRef.current.forEach((m, i) => m.classList.toggle("find-match-current", i === findIndex));
    const current = findMatchesRef.current[findIndex];
    if (current) openAncestorDetails(current);
    current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findIndex, findCount]);

  const handleFindNext = useCallback(() => {
    setFindIndex(i => findMatchesRef.current.length ? (i + 1) % findMatchesRef.current.length : 0);
  }, []);
  const handleFindPrev = useCallback(() => {
    setFindIndex(i => findMatchesRef.current.length ? (i - 1 + findMatchesRef.current.length) % findMatchesRef.current.length : 0);
  }, []);
  const handleFindClose = useCallback(() => { setFindOpen(false); setFindQuery(""); }, []);

  // Atalho Cmd/Ctrl+F abre a busca-na-página enquanto este artigo está montado
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !isEditing) {
        e.preventDefault();
        setFindOpen(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditing]);

  // ── Sumário (Conteúdo): extrai os headings do artigo renderizado ───────────
  // Só roda quando o container do artigo está montado (aba "Artigo", não "Resumo") —
  // o sumário reflete a última varredura enquanto o usuário estiver na aba Resumo.
  useEffect(() => {
    if (showSummary) return;
    const container = containerRef.current;
    if (!container) { setTocItems([]); return; }
    const headings = Array.from(container.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
    const used = new Set<string>();
    const items: TocItem[] = headings.map(h => {
      if (h.id) used.add(h.id);
      else h.id = slugifyHeading(h.textContent ?? "", used);
      return { id: h.id, text: h.textContent ?? "", level: Number(h.tagName[1]) };
    });
    setTocItems(items);
  }, [showSummary, article.id, article.content, article.links]);

  const handleJumpToHeading = useCallback((id: string) => {
    setTocOpen(false);
    const jump = () => {
      const el = document.getElementById(id);
      if (!el) return;
      openAncestorDetails(el);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    if (showSummary) {
      setShowSummary(false);
      requestAnimationFrame(() => requestAnimationFrame(jump));
    } else {
      jump();
    }
  }, [showSummary]);

  // ── Clique direito — captura seleção de texto, ou tabela/imagem sob o cursor ─
  const handleContextMenu = useCallback((e: MouseEvent) => {
    const sel = getSelectionHtml();
    const targetEl = e.target as HTMLElement;
    const tableEl = targetEl.closest?.("table") as HTMLTableElement | null;
    const imgEl = targetEl.closest?.("img") as HTMLImageElement | null;

    if (!sel && !tableEl && !imgEl) return;   // nada a oferecer neste clique
    e.preventDefault();

    showContextMenu(e.clientX, e.clientY, article.id, {
      selectedText: sel?.plainText ?? "",
      tableHtml: tableEl?.outerHTML,
      selectionTableHtml: sel ? getSelectionTableHtml() ?? undefined : undefined,
      imageSrc: imgEl?.src,
      imageAlt: imgEl?.alt,
    });
    // Usar o menu de contexto sobre uma seleção é o próprio usuário
    // descobrindo o fluxo — não precisa mais ver a dica.
    if (sel && !selectionHintSeen) { dismissSelectionHint(); setSelectionHint(null); }
  }, [article.id, showContextMenu, selectionHintSeen, dismissSelectionHint]);

  // ── Dica de descoberta: primeira seleção de texto num artigo ────────────────
  // Some artigos "manuais" também suportam clique-direito; a dica cobre o
  // fluxo mais comum (Wikipedia/Claude) sem exigir configuração adicional.
  const [selectionHint, setSelectionHint] = useState<{ x: number; y: number } | null>(null);

  const handleMouseUpForHint = useCallback(() => {
    if (selectionHintSeen || isEditing) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (text.length < 2) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    setSelectionHint({ x: rect.left, y: rect.bottom + 8 });
  }, [selectionHintSeen, isEditing]);

  // ── Clique em link interno ──────────────────────────────────────────────────
  const handleClick = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (link) {
      e.preventDefault();
      const tid = link.getAttribute("data-article-id");
      if (tid) openArticle(tid);
    }
  }, [openArticle]);

  // ── Preview ao passar o mouse sobre um link interno ─────────────────────────
  // Mostra título + início do resumo do artigo-alvo sem precisar navegar até
  // ele — só depende do que já está em memória (articles já carrega summary
  // de todos os artigos), sem chamada extra.
  const [linkPreview, setLinkPreview] = useState<{ articleId: string; x: number; y: number } | null>(null);
  const linkPreviewTimerRef = useRef<number | null>(null);

  const handleLinkMouseOver = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (!link) return;
    const tid = link.getAttribute("data-article-id");
    if (!tid) return;
    const rect = link.getBoundingClientRect();
    if (linkPreviewTimerRef.current) window.clearTimeout(linkPreviewTimerRef.current);
    linkPreviewTimerRef.current = window.setTimeout(() => {
      setLinkPreview({ articleId: tid, x: rect.left, y: rect.bottom + 6 });
    }, 350);
  }, []);

  const handleLinkMouseOut = useCallback((e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (!link) return;
    if (linkPreviewTimerRef.current) { window.clearTimeout(linkPreviewTimerRef.current); linkPreviewTimerRef.current = null; }
    setLinkPreview(null);
  }, []);

  useEffect(() => () => { if (linkPreviewTimerRef.current) window.clearTimeout(linkPreviewTimerRef.current); }, []);

  // Registra eventos nos dois containers (artigo completo e resumo)
  useEffect(() => {
    const refs = [containerRef.current, summaryRef.current].filter(Boolean);
    refs.forEach(el => {
      el!.addEventListener("contextmenu", handleContextMenu);
      el!.addEventListener("click", handleClick);
      el!.addEventListener("mouseover", handleLinkMouseOver);
      el!.addEventListener("mouseout", handleLinkMouseOut);
      el!.addEventListener("mouseup", handleMouseUpForHint);
    });
    return () => refs.forEach(el => {
      el!.removeEventListener("contextmenu", handleContextMenu);
      el!.removeEventListener("click", handleClick);
      el!.removeEventListener("mouseover", handleLinkMouseOver);
      el!.removeEventListener("mouseout", handleLinkMouseOut);
      el!.removeEventListener("mouseup", handleMouseUpForHint);
    });
  }, [handleContextMenu, handleClick, handleLinkMouseOver, handleLinkMouseOut, handleMouseUpForHint, showSummary]);

  // Fecha a dica ao clicar em qualquer lugar fora dela (sem persistir "visto" —
  // só um dispensar temporário; reaparece na próxima seleção, até o usuário
  // efetivamente usar o menu de contexto ou ela ser fechada pelo X)
  useEffect(() => {
    if (!selectionHint) return;
    const handler = () => setSelectionHint(null);
    const id = window.setTimeout(() => document.addEventListener("mousedown", handler, { once: true }), 0);
    return () => { window.clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [selectionHint]);

  // ── Trata imagens quebradas: reserva caixa com dimensões originais ──────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLImageElement>("img").forEach(img => {
      const applyFallback = () => {
        if (img.naturalHeight === 0) {
          img.style.display = "block";
          img.style.minHeight = img.getAttribute("height") ? `${img.getAttribute("height")}px` : "80px";
        }
      };
      img.addEventListener("error", applyFallback, { once: true });
      if (img.complete) applyFallback();
    });
  }, [article.id, article.content]);

  // ── Pesquisar no menu de contexto ──────────────────────────────────────────
  const handleSearch = useCallback(async (source: "wikipedia" | "claude") => {
    const { selectedText, parentArticleId } = contextMenu;
    hideContextMenu();
    if (!selectedText || !parentArticleId) return;
    try {
      const existing = articles.find(a => a.title.toLowerCase() === selectedText.toLowerCase());
      let target = existing;
      if (!target) {
        target = source === "wikipedia"
          ? await fetchFromWikipedia(selectedText, parentArticleId)
          : await generateWithClaude(selectedText, parentArticleId);
      }
      await addLink(parentArticleId, selectedText, target.id, target.title);
      showToast(`Link criado: "${selectedText}" → ${target.title}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [contextMenu, hideContextMenu, articles, fetchFromWikipedia, generateWithClaude, addLink, showToast]);

  // ── Excluir artigo / remover link ───────────────────────────────────────────
  // A exclusão move o artigo para a lixeira (ver articleHandlers.js/articles.ts) —
  // guardamos aqui os links removidos de outros artigos para poder reconstituir
  // tudo se o usuário clicar em "Desfazer" no toast (janela de ~5s).
  const handleDeleteArticle = useCallback(async () => {
    const ok = await confirmDialog(
      "Os links que apontam para ele também serão removidos.",
      `Excluir "${article.title}"?`
    );
    if (!ok) return;
    const removedLinks = articles.flatMap(a =>
      a.links
        .filter(l => l.targetId === article.id)
        .map(l => ({ parentId: a.id, anchorText: l.anchorText, targetId: l.targetId, targetTitle: l.targetTitle }))
    );
    const title = article.title;
    const id = article.id;
    await deleteArticle(id);
    showToast(`Artigo "${title}" excluído.`, "info", {
      durationMs: 5000,
      action: {
        label: "Desfazer",
        onClick: async () => {
          await restoreArticle(id);
          for (const link of removedLinks) {
            await addLink(link.parentId, link.anchorText, link.targetId, link.targetTitle);
          }
          showToast(`Artigo "${title}" restaurado.`);
        },
      },
    });
  }, [article.id, article.title, articles, deleteArticle, restoreArticle, addLink, showToast]);

  const handleRemoveLink = useCallback(async (linkId: string) => {
    await removeLink(article.id, linkId);
  }, [article.id, removeLink]);

  // ── Edição de artigo manual ─────────────────────────────────────────────────
  const handleStartEdit = useCallback(() => {
    setEditDraft(article.content);
    setIsEditing(true);
  }, [article.content]);

  const handleSaveEdit = useCallback(async () => {
    await saveArticle({ ...article, content: editDraft });
    setIsEditing(false);
    showToast("Artigo salvo.");
    handleRegenerateFlashcards();
  }, [article, editDraft, saveArticle, showToast, handleRegenerateFlashcards]);

  // ── Abrir modal "Salvar trecho / tabela / imagem" ───────────────────────────
  // Para texto, a categoria define a cor de fundo do trecho (conceito/lista/dados)
  const handleOpenSaveExcerpt = useCallback((category: ExcerptCategory) => {
    const sel = getSelectionHtml();
    hideContextMenu();
    if (!sel) return;
    setSaveModal({ visible: true, kind: "text", category, html: sel.html });
  }, [hideContextMenu]);

  const handleOpenSaveTable = useCallback(() => {
    const html = contextMenu.tableHtml;
    hideContextMenu();
    if (!html) return;
    setSaveModal({ visible: true, kind: "table", category: "default", html });
  }, [contextMenu.tableHtml, hideContextMenu]);

  // Seleção que cruza células: salva só as células selecionadas, como tabela.
  const handleOpenSaveSelectionTable = useCallback(() => {
    const html = contextMenu.selectionTableHtml;
    hideContextMenu();
    if (!html) return;
    setSaveModal({ visible: true, kind: "table", category: "default", html });
  }, [contextMenu.selectionTableHtml, hideContextMenu]);

  const handleOpenSaveImage = useCallback(() => {
    const { imageSrc, imageAlt } = contextMenu;
    hideContextMenu();
    if (!imageSrc) return;
    setSaveModal({
      visible: true, kind: "image", category: "default",
      html: `<img src="${imageSrc}" alt="${imageAlt ?? ""}">`,
      src: imageSrc, alt: imageAlt,
    });
  }, [contextMenu, hideContextMenu]);

  // ── Confirmar salvamento ────────────────────────────────────────────────────
  const handleConfirmSave = useCallback(async (targetId: string | null, targetTitle: string) => {
    const res = saveModal.kind === "image"
      ? await window.lexicon.invoke("article:appendImage", {
          targetId, targetTitle,
          src: saveModal.src, alt: saveModal.alt ?? "",
          sourceArticleId: article.id, sourceArticleTitle: article.title,
        })
      : await window.lexicon.invoke("article:appendExcerpt", {
          targetId, targetTitle,
          html: saveModal.html, kind: saveModal.kind, category: saveModal.category,
          sourceArticleId: article.id, sourceArticleTitle: article.title,
        });
    if (res.ok) await loadArticles();
    else showToast(res.error ?? "Falha ao salvar.", "error");
  }, [saveModal, article.id, article.title, loadArticles, showToast]);

  const handleRemoveExcerpt = useCallback(async (excerptId: string) => {
    const res = await window.lexicon.invoke("article:removeExcerpt", { targetId: article.id, excerptId });
    if (res.ok) await loadArticles();
  }, [article.id, loadArticles]);

  // ── Edição de trecho salvo ───────────────────────────────────────────────────
  // O rascunho reaberto é reconstruído a partir do editedMarkdown (removendo os
  // marcadores automáticos "(...)" e desembrulhando o itálico de inserção) ou,
  // na primeira edição, a partir do texto puro originalmente capturado.
  const handleStartEditExcerpt = useCallback((excerptId: string) => {
    const ex = article.excerpts.find(e => e.id === excerptId);
    if (!ex) return;
    // Tabelas usam editor próprio (grade); só o editor de texto precisa do draft.
    // Sem edição prévia, o rascunho vem do Markdown derivado do HTML original —
    // preserva negrito, itálico e listas da captura.
    if ((ex.kind ?? "text") === "text") {
      const baseline = stripTrackedMarkup(ex.editedMarkdown ?? excerptHtmlToMarkdown(ex.html));
      setExcerptEditDraft(baseline);
      setExcerptEditBaseline(baseline);
    }
    setEditingExcerptId(excerptId);
  }, [article.excerpts]);

  const handleCancelEditExcerpt = useCallback(() => {
    setEditingExcerptId(null);
    setExcerptEditDraft("");
  }, []);

  const handleSaveEditExcerpt = useCallback(async () => {
    const ex = article.excerpts.find(e => e.id === editingExcerptId);
    if (!ex) return;
    // O baseline do diff é o mesmo Markdown formatado mostrado ao abrir o editor,
    // para que a formatação original não seja lida como inserção
    const annotated = computeTrackedEdit(excerptHtmlToMarkdown(ex.html), excerptEditDraft);
    await updateExcerptMarkdown(article.id, ex.id, annotated);
    setEditingExcerptId(null);
    setExcerptEditDraft("");
    showToast("Trecho salvo.");
    handleRegenerateFlashcards();
  }, [article.id, article.excerpts, editingExcerptId, excerptEditDraft, updateExcerptMarkdown, showToast, handleRegenerateFlashcards]);

  // Tabela: edição direta célula a célula (sem o esquema de itálico/"(...)")
  const handleSaveTableEdit = useCallback(async (excerptId: string, markdown: string) => {
    await updateExcerptMarkdown(article.id, excerptId, markdown);
    setEditingExcerptId(null);
    showToast("Tabela salva.");
  }, [article.id, updateExcerptMarkdown, showToast]);

  const handleReorderOutline = useCallback((next: typeof outline) => {
    updateExcerptOutline(article.id, next);
  }, [article.id, updateExcerptOutline]);

  const handleRegenerateSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    try {
      const res = await window.lexicon.invoke("claude:summarize", {
        title: article.title,
        text: article.content.replace(/<[^>]+>/g, " ").slice(0, 6000),
        bypassCache: true,
      });
      if (res.ok && res.data) setSummaryPreview((res.data as any).summary);
      else showToast(res.error ?? "Falha ao gerar resumo.", "error");
    } finally { setIsLoadingSummary(false); }
  }, [article, showToast]);

  const handleApplySummaryPreview = useCallback(async () => {
    if (summaryPreview === null) return;
    await saveArticle({ ...article, summary: summaryPreview });
    setSummaryPreview(null);
    showToast("Resumo atualizado.");
  }, [article, summaryPreview, saveArticle, showToast]);

  const handleDiscardSummaryPreview = useCallback(() => setSummaryPreview(null), []);

  // ── Perguntar ao Claude sobre este artigo ───────────────────────────────────
  const handleAskClaude = useCallback(async () => {
    const question = chatInput.trim();
    if (!question) return;
    setChatInput("");
    setChatMessages(m => [...m, { role: "user", text: question }]);
    setChatLoading(true);
    try {
      // Contexto: título do artigo, conteúdo em texto puro, e títulos de
      // artigos vinculados/que referenciam este (sem baixar conteúdo deles)
      const relatedTitles = [
        ...article.links.map(l => l.targetTitle),
        ...articles.filter(a => a.links.some(l => l.targetId === article.id)).map(a => a.title),
      ];
      const plainContent = article.content
        ? article.content.replace(/<[^>]+>/g, " ")
        : article.summary;

      const res = await window.lexicon.invoke("claude:ask", {
        question,
        articleTitle: article.title,
        articleText: plainContent || article.summary,
        relatedContext: relatedTitles.map(t => `- ${t}`).join("\n"),
      });

      if (res.ok) {
        setChatMessages(m => [...m, { role: "assistant", text: (res.data as any).answer }]);
      } else {
        setChatMessages(m => [...m, { role: "assistant", text: `Erro: ${res.error}` }]);
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, article, articles]);

  // Persiste uma resposta do chat como trecho do próprio artigo (mesmo
  // mecanismo de excerto já existente) — decisão explícita do usuário, já
  // que por design o chat em si não guarda histórico entre sessões.
  const handleSaveChatAnswer = useCallback(async (index: number, text: string) => {
    const res = await window.lexicon.invoke("article:appendExcerpt", {
      targetId: article.id, targetTitle: article.title,
      html: `<p>${escapeHtml(text)}</p>`, kind: "text", category: "default",
      sourceArticleId: article.id, sourceArticleTitle: article.title,
    });
    if (res.ok) {
      setSavedChatIndices(s => new Set(s).add(index));
      await loadArticles();
      showToast("Resposta salva como trecho do artigo.");
    } else {
      showToast(res.error ?? "Falha ao salvar resposta.", "error");
    }
  }, [article.id, article.title, loadArticles, showToast]);

  // Manual: content é Markdown → HTML + links por texto puro.
  // Wikipedia: content é HTML com spans .wiki-term para ancorar os links —
  // e, só para essa fonte, os títulos viram accordions/toggles recolhíveis
  // (ver lib/wikiAccordions.ts).
  const processedHtml = article.source === "manual"
    ? sanitize(linkifyPlainText(markdownToHtml(article.content), article.links))
    : buildWikiAccordions(sanitize(injectInternalLinks(article.content, article.links)));
  const excerpts: ArticleExcerpt[] = article.excerpts ?? [];

  // Backlinks: artigos cujos links apontam para este
  const backlinks: Backlink[] = articles.flatMap(a =>
    a.links
      .filter(l => l.targetId === article.id)
      .map(l => ({ sourceId: a.id, sourceTitle: a.title, anchorText: l.anchorText }))
  );

  // Sugestão automática de links: os termos que eram <a> no HTML original da
  // Wikipedia viram <span class="wiki-term"> na importação (ver wikipedia.ts)
  // — a marcação de "isso era um conceito linkável" não se perde, só o href.
  // Cruza esses termos com títulos já existentes na base e sugere o link, em
  // vez de exigir que o usuário selecione o trecho manualmente toda vez.
  const linkSuggestions = useMemo(
    () => findLinkSuggestions(article, articles),
    [article, articles]
  );

  const visibleSuggestions = linkSuggestions.filter(s => !dismissedTerms.has(s.term));
  const shownSuggestions = visibleSuggestions.slice(0, suggestionLimit);

  const handleAcceptSuggestion = useCallback(async (term: string, target: Article) => {
    await addLink(article.id, term, target.id, target.title);
    showToast(`Link criado: "${term}" → ${target.title}`);
  }, [article.id, addLink, showToast]);

  // "Vincular todos": cria um link por sugestão visível, em sequência (a
  // mesma chamada addLink recarrega o artigo a cada vez — em paralelo,
  // escritas concorrentes no mesmo JSON poderiam se sobrescrever).
  const handleAcceptAllSuggestions = useCallback(async (suggestions: Array<{ term: string; target: Article }>) => {
    for (const { term, target } of suggestions) {
      await addLink(article.id, term, target.id, target.title);
    }
    showToast(`${suggestions.length} link${suggestions.length > 1 ? "s" : ""} criado${suggestions.length > 1 ? "s" : ""}.`);
  }, [article.id, addLink, showToast]);

  const summaryHtml = summaryToHtml(article.summary);

  // ── Progresso de leitura ───────────────────────────────────────────────────
  // Fita fina no topo do corpo mostrando quanto do artigo já rolou — em artigos
  // longos da Wikipédia a barra de rolagem do painel é curta demais para dar
  // essa noção. Só leitura de scrollTop, sem estado persistido.
  const [readProgress, setReadProgress] = useState(0);
  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setReadProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  }, []);
  useEffect(() => { setReadProgress(0); }, [article.id, showSummary]);

  // Os 4 ícones "primários" do cabeçalho — quando há slot (barra fixa abaixo
  // da TopBar, tanto no desktop quanto no mobile) vão todos por portal para
  // lá, junto dos secundários; sem slot, renderizam ao lado do <h1>.
  const primaryHeaderActions = (
    <>
      <span className="header-popover-anchor">
        <button className={`icon-btn ${findOpen ? "icon-btn-active" : ""}`} title="Buscar na página" aria-label="Buscar na página"
                onClick={() => setFindOpen(o => !o)}><Icon name="search" /></button>
        {findOpen && (
          <FindInPageBar
            query={findQuery} count={findCount} index={findIndex}
            onQueryChange={setFindQuery}
            onNext={handleFindNext} onPrev={handleFindPrev} onClose={handleFindClose}
          />
        )}
      </span>
      {tocItems.length > 0 && (
        <button className="icon-btn" title="Conteúdo" aria-label="Conteúdo" onClick={() => setTocOpen(true)}><Icon name="densityCompact" /></button>
      )}
      <span className="header-popover-anchor">
        <button className={`icon-btn ${chatOpen ? "icon-btn-active" : ""}`} title="Perguntar ao Claude" aria-label="Perguntar ao Claude"
                onClick={() => setChatOpen(o => !o)}><Icon name="chat" /></button>
        {chatOpen && (
          <div className="ask-claude-panel ask-claude-popover">
            {chatMessages.length > 0 && (
              <button
                type="button"
                className="icon-btn ask-claude-clear-btn"
                title="Limpar conversa"
                aria-label="Limpar conversa"
                onClick={() => { setChatMessages([]); setSavedChatIndices(new Set()); }}
              >
                <Icon name="clear" />
              </button>
            )}
            <div className="ask-claude-messages">
              {chatMessages.length === 0 && (
                <p className="ask-claude-hint">
                  Pergunte algo sobre este artigo — o Claude responde usando o conteúdo
                  e os artigos vinculados como contexto.
                </p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`ask-claude-msg ask-claude-${m.role}`}>
                  {m.text}
                  {m.role === "assistant" && (
                    <button
                      type="button"
                      className="ask-claude-save-btn"
                      disabled={savedChatIndices.has(i)}
                      onClick={() => handleSaveChatAnswer(i, m.text)}
                      title="Salvar esta resposta como trecho do artigo"
                    >
                      {savedChatIndices.has(i)
                        ? <><Icon name="check" /><span>Salvo</span></>
                        : <><Icon name="save" /><span>Salvar no artigo</span></>}
                    </button>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="ask-claude-msg ask-claude-assistant ask-claude-loading">Pensando…</div>
              )}
            </div>
            <form className="ask-claude-form" onSubmit={e => { e.preventDefault(); handleAskClaude(); }}>
              <input
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                placeholder="Pergunte sobre este artigo…" disabled={chatLoading}
              />
              <button type="submit" className="primary" disabled={chatLoading || !chatInput.trim()}>
                Perguntar
              </button>
            </form>
          </div>
        )}
      </span>
      <button className="icon-btn" title="Revisar flashcards deste artigo" aria-label="Revisar flashcards deste artigo"
              onClick={() => setReviewOpen(true)}
              disabled={flashcards.filter(c => c.due <= new Date().toISOString()).length === 0}><Icon name="flashcards" /></button>
    </>
  );

  // Histórico / editar / excluir — seguem os primários para onde eles forem.
  const secondaryHeaderActions = (
    <>
      <button className="icon-btn" title="Histórico de versões" aria-label="Histórico de versões"
              onClick={() => setHistoryOpen(true)}><Icon name="history" /></button>
      {article.source === "manual" && !isEditing && (
        <button className="icon-btn" title="Editar artigo" aria-label="Editar artigo" onClick={handleStartEdit}><Icon name="edit" /></button>
      )}
      <button className="icon-btn article-delete-btn" title="Excluir artigo" aria-label="Excluir artigo"
              onClick={handleDeleteArticle}><Icon name="trash" /></button>
    </>
  );

  return (
    <div className="article-view">

      {/* ── Cabeçalho estilo Wikipedia ──────────────────────────────────── */}
      <div className="article-header">
        <div className="article-title-row">
          <h1 className="article-title">{article.title}</h1>
          {!headerActionsSlot && (
            <div className="article-header-actions">
              {primaryHeaderActions}
              {secondaryHeaderActions}
            </div>
          )}
        </div>
        {headerActionsSlot && createPortal(
          <>{primaryHeaderActions}{secondaryHeaderActions}</>, headerActionsSlot
        )}

        <div className="article-header-meta">
          <span className={`source-badge source-${article.source}`}>
            {article.source === "wikipedia" ? "Wikipédia" :
             article.source === "claude"    ? "Claude (IA)" : "Manual"}
          </span>
          <span className="header-sep">·</span>
          <span className="article-date">Atualizado em {new Date(article.updatedAt).toLocaleDateString("pt-BR")}</span>
          {excerpts.length > 0 && (
            <>
              <span className="header-sep">·</span>
              <span className="article-date">{excerpts.length} trecho{excerpts.length > 1 ? "s" : ""} salvos</span>
            </>
          )}
        </div>

        <TagEditor
          tags={article.tags ?? []}
          existingTags={allTags}
          onChange={tags => updateTags(article.id, tags)}
        />

        <AttachmentsPanel
          article={article}
          onChanged={() => openArticle(article.id)}
          showToast={showToast}
        />

        {/* Abas de modo (igual à "discussão / editar" da Wikipedia) */}
        <div className="wiki-tabs">
          <button className={!showSummary ? "wiki-tab active" : "wiki-tab"} onClick={() => setShowSummary(false)}>
            Artigo
          </button>
          <button className={showSummary ? "wiki-tab active" : "wiki-tab"} onClick={() => setShowSummary(true)}>
            Resumo
          </button>
        </div>
      </div>

      {/* ── Linha divisória ─────────────────────────────────────────────── */}
      <div className="wiki-divider" />

      {/* ── Corpo ───────────────────────────────────────────────────────── */}
      <div
        className="article-read-progress"
        style={{ transform: `scaleX(${readProgress})` }}
        role="progressbar"
        aria-label="Progresso de leitura do artigo"
        aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(readProgress * 100)}
      />
      <div className="article-body" onScroll={handleBodyScroll}>

        {/* Índice de links internos (estilo "Sumário" da Wikipedia) — colapsável
            para não empurrar o conteúdo do artigo para baixo da dobra em
            artigos bem conectados; o estado (aberto/fechado) fica só na
            sessão, não é persistido em disco. */}
        {article.links.length > 0 && !showSummary && (
          <details className="wiki-toc" open>
            <summary className="wiki-toc-title">Conceitos vinculados ({article.links.length})</summary>
            <ol className="wiki-toc-list">
              {article.links.map((link, i) => (
                <li key={link.id}>
                  <a href="#" className="toc-link"
                     onClick={e => { e.preventDefault(); openArticle(link.targetId); }}>
                    {link.anchorText}
                  </a>
                  <span className="toc-target"> — {link.targetTitle}</span>
                  <button className="toc-remove-btn" title="Remover link" aria-label="Remover link"
                          onClick={() => handleRemoveLink(link.id)}><Icon name="close" /></button>
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* Sugestões de link automáticas — termos marcados como conceito na
            Wikipedia original, ou o título de outro artigo já existente
            encontrado no texto de qualquer fonte (Claude/manual incluídos).
            Também colapsável, pelo mesmo motivo do bloco acima. */}
        {visibleSuggestions.length > 0 && !showSummary && (
          <details className="wiki-toc link-suggestions" open>
            <summary className="wiki-toc-title link-suggestions-title-row">
              <span>
                Links sugeridos ({visibleSuggestions.length})
                {visibleSuggestions.length > shownSuggestions.length && (
                  <span className="link-suggestions-count">
                    {" "}— mostrando {shownSuggestions.length} de {visibleSuggestions.length}
                  </span>
                )}
              </span>
              <button type="button" className="link-suggestions-accept-all-btn"
                      onClick={e => { e.stopPropagation(); handleAcceptAllSuggestions(shownSuggestions); }}>
                Vincular todos
              </button>
            </summary>
            <ol className="wiki-toc-list">
              {shownSuggestions.map(({ term, target }) => (
                <li key={term}>
                  <span className="suggestion-term">{term}</span>
                  <span className="toc-target"> → {target.title}</span>
                  <button className="suggestion-accept-btn" title="Criar link" aria-label="Criar link"
                          onClick={() => handleAcceptSuggestion(term, target)}><Icon name="check" /></button>
                  <button className="toc-remove-btn" title="Descartar sugestão" aria-label="Descartar sugestão"
                          onClick={() => setDismissedTerms(s => new Set(s).add(term))}><Icon name="close" /></button>
                </li>
              ))}
            </ol>
            {visibleSuggestions.length > shownSuggestions.length && (
              <button
                type="button"
                className="link-suggestions-more-btn"
                onClick={() => setSuggestionLimit(n => n + 20)}
              >
                Carregar mais ({visibleSuggestions.length - shownSuggestions.length} restantes)
              </button>
            )}
          </details>
        )}

        {/* Conteúdo principal */}
        {isEditing ? (
          <div className="manual-editor">
            <textarea
              autoFocus
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onKeyDown={e => handleFormatShortcut(e, setEditDraft)}
              placeholder={"Escreva em Markdown…\n\n# Título de seção\n- item de lista\n**negrito**, *itálico*, ==amarelo==, ++laranja++\n[definição]{.def}  [estrutura]{.enum}  [dado numérico]{.num}"}
            />
            <div className="manual-editor-actions">
              {editDraft !== article.content && (
                <span className="unsaved-indicator" title="Alterações ainda não salvas">
                  ● Não salvo
                </span>
              )}
              <button onClick={() => setIsEditing(false)}>Cancelar</button>
              <button className="primary" onClick={handleSaveEdit}>Salvar</button>
            </div>
          </div>
        ) : showSummary ? (
          <div ref={summaryRef} className="wiki-content summary-content">
            {summaryFailed && (
              <p className="summary-failed-notice">
                O resumo automático falhou ao criar este artigo. Tente gerar novamente.
              </p>
            )}
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
            <div className="summary-actions">
              <button className="wiki-btn" onClick={handleRegenerateSummary} disabled={isLoadingSummary}>
                {isLoadingSummary ? "Gerando…" : <><Icon name="refresh" /><span>Regenerar resumo</span></>}
              </button>
            </div>
          </div>
        ) : article.content ? (
          <div ref={containerRef} className="wiki-content"
               dangerouslySetInnerHTML={{ __html: processedHtml }} />
        ) : (
          <div ref={containerRef} className="wiki-content">
            <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
          </div>
        )}

        {/* Trechos salvos */}
        <ExcerptsPanel
          article={article}
          outline={outline}
          onOpenSource={id => openArticle(id)}
          onRemoveExcerpt={handleRemoveExcerpt}
          onReorder={handleReorderOutline}
          editingExcerptId={editingExcerptId}
          editDraft={excerptEditDraft}
          editBaseline={excerptEditBaseline}
          onStartEdit={handleStartEditExcerpt}
          onEditDraftChange={setExcerptEditDraft}
          onSaveEdit={handleSaveEditExcerpt}
          onSaveTableEdit={handleSaveTableEdit}
          onCancelEdit={handleCancelEditExcerpt}
        />

        {/* Flashcards */}
        <FlashcardsPanel
          cards={flashcards}
          loading={flashcardsLoading}
          onStartReview={() => setReviewOpen(true)}
        />

        {/* Backlinks */}
        <BacklinksPanel backlinks={backlinks} onOpen={id => openArticle(id)} />

      </div>

      {/* ── Sumário (Conteúdo) ──────────────────────────────────────────────── */}
      {tocOpen && (
        <SectionsTocPanel items={tocItems} onJump={handleJumpToHeading} onClose={() => setTocOpen(false)} />
      )}

      {/* ── Prévia do resumo regenerado — nunca sobrescreve sem confirmação ─── */}
      {summaryPreview !== null && (
        <div className="modal-overlay" onClick={handleDiscardSummaryPreview}>
          <div className="modal summary-preview-modal" onClick={e => e.stopPropagation()}>
            <h2>Novo resumo gerado</h2>
            <p className="excerpt-new-hint">
              Compare com o resumo atual antes de substituir — a versão antiga se perde ao aplicar.
            </p>
            <div className="summary-preview-columns">
              <div className="summary-preview-col">
                <span className="summary-preview-label">Atual</span>
                <div className="summary-preview-html wiki-content"
                     dangerouslySetInnerHTML={{ __html: summaryToHtml(article.summary) }} />
              </div>
              <div className="summary-preview-col summary-preview-col-new">
                <span className="summary-preview-label">Novo</span>
                <div className="summary-preview-html wiki-content"
                     dangerouslySetInnerHTML={{ __html: summaryToHtml(summaryPreview) }} />
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={handleDiscardSummaryPreview}>Descartar</button>
              <button className="primary" onClick={handleApplySummaryPreview}>Aplicar novo resumo</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dica: primeira seleção de texto ensina o menu de contexto ──────── */}
      {selectionHint && (
        <SelectionHintBubble
          x={selectionHint.x} y={selectionHint.y}
          onDismiss={() => { dismissSelectionHint(); setSelectionHint(null); }}
        />
      )}

      {/* ── Preview do artigo-alvo ao passar o mouse sobre um link interno ─── */}
      {linkPreview && (() => {
        const target = articles.find(a => a.id === linkPreview.articleId);
        if (!target) return null;
        return (
          <LinkHoverPreview
            x={linkPreview.x} y={linkPreview.y}
            title={target.title}
            snippet={(target.summary || "").replace(/^•\s*/, "").slice(0, 140) || "Sem resumo disponível."}
          />
        );
      })()}

      {/* ── Menu de contexto ─────────────────────────────────────────────── */}
      {contextMenu.visible && contextMenu.parentArticleId === article.id && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          text={contextMenu.selectedText}
          hasTable={!!contextMenu.tableHtml}
          hasSelectionTable={!!contextMenu.selectionTableHtml}
          hasImage={!!contextMenu.imageSrc}
          onSearchWiki={() => handleSearch("wikipedia")}
          onSearchClaude={() => handleSearch("claude")}
          onSaveExcerpt={handleOpenSaveExcerpt}
          onSaveTable={handleOpenSaveTable}
          onSaveSelectionTable={handleOpenSaveSelectionTable}
          onSaveImage={handleOpenSaveImage}
          onClose={hideContextMenu}
        />
      )}

      {/* ── Modal de trecho / tabela / imagem ──────────────────────────────── */}
      {saveModal.visible && (
        <SaveExcerptModal
          kind={saveModal.kind}
          category={saveModal.category}
          html={saveModal.html}
          sourceArticleId={article.id}
          sourceArticleTitle={article.title}
          articles={articles}
          onSave={handleConfirmSave}
          onClose={() => setSaveModal({ visible: false, kind: "text", category: "default", html: "" })}
        />
      )}

      {/* ── Modal de revisão de flashcards (deste artigo) ───────────────────── */}
      {reviewOpen && (
        <ReviewModal
          cards={flashcards.filter(c => c.due <= new Date().toISOString())}
          onGrade={handleGradeCard}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {/* ── Histórico de versões ────────────────────────────────────────────── */}
      {historyOpen && (
        <ArticleHistoryPanel
          article={article}
          onClose={() => setHistoryOpen(false)}
          onReverted={() => openArticle(article.id)}
          showToast={showToast}
        />
      )}
    </div>
  );
};
