// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/wikipedia.ts
// Porta de packages/desktop/src/main/handlers/wikipediaHandlers.js.
// A sanitização de HTML é regex puro — 100% portável, copiada sem alteração.
// A única troca real é o transporte: https do Node → CapacitorHttp (nativo,
// sem CORS, no build iOS/Android). Nota: no preview via browser comum (sem
// device nativo), CapacitorHttp cai para fetch() normal — funciona para a
// Wikipedia porque a API dela já manda CORS permissivo (por isso o
// `origin=*` na query de busca), mas não serve para validar o caminho nativo.
// ─────────────────────────────────────────────────────────────────────────────

import { CapacitorHttp } from "@capacitor/core";

function sanitizeWikipediaHtml(html: string): string {
  let out = html;

  out = out
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\s+on[a-z]+="[^"]*"/gi, "")
    .replace(/\s+on[a-z]+='[^']*'/gi, "");

  out = out.replace(/\bsrc="\/\/([^"]+)"/g, 'src="https://$1"');

  out = out.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_, inner) => {
    const imgMatch = inner.match(/<img\b[^>]*>/i);
    if (!imgMatch) return "";
    let imgTag = imgMatch[0];
    imgTag = imgTag.replace(/\s+srcset="[^"]*"/g, "");
    imgTag = imgTag.replace(/\s+class="[^"]*"/g, "");
    imgTag = imgTag.replace(/\s+style="[^"]*"/g, "");
    return `<div class="wiki-figure">${imgTag}</div>`;
  });

  return out
    .replace(/\s+href="[^"]*"/g, "")
    .replace(/\s+style="[^"]*"/g, "")
    .replace(/\s+class="(?:mw-[^"]*|reference[^"]*|navbox[^"]*|infobox[^"]*)"/g, "")
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, "")
    .replace(/<div[^>]*class="[^"]*thumb[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<h[23][^>]*>(?:Ver também|Referências|Ligações externas|Notes?|References?)[^<]*<\/h[23]>[\s\S]*?(?=<h[23]|$)/gi, "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g, '<span class="wiki-term">$1</span>')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const WIKI_UA = "Lexicon/1.0 (app pessoal; contato@exemplo.com) Capacitor";

// Cache em memória por termo normalizado — evita chamadas de rede duplicadas
// quando o usuário busca/reabre o mesmo termo mais de uma vez na mesma
// sessão. Sem TTL: descartado ao fechar o app, e o conteúdo da Wikipedia é
// estável o suficiente para a duração de uma sessão.
const searchCache = new Map<string, Array<{ title: string; snippet: string }>>();
const fetchCache = new Map<string, { title: string; html: string; plainTextExtract: string; sourceUrl: string }>();
function cacheKey(lang: string, term: string) { return `${lang}::${term.trim().toLowerCase()}`; }

async function searchWikipedia(query: string, lang: string, limit: number) {
  const key = cacheKey(lang, `${query}::${limit}`);
  const cached = searchCache.get(key);
  if (cached) return cached;

  const res = await CapacitorHttp.get({
    url: `https://${lang}.wikipedia.org/w/api.php`,
    params: {
      action: "query", list: "search", srsearch: query,
      srlimit: String(limit), format: "json", origin: "*",
    },
    headers: { "Accept": "application/json", "User-Agent": WIKI_UA },
  });
  if (res.status !== 200) throw new Error(`Wikipedia retornou status ${res.status}`);
  const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  const results = data?.query?.search ?? [];
  searchCache.set(key, results);
  return results;
}

export async function search(query: string, lang: string): Promise<Array<{ title: string; snippet: string }>> {
  const results = await searchWikipedia(query, lang, 5);
  return results.map((r: any) => ({
    title: r.title,
    snippet: (r.snippet ?? "").replace(/<[^>]+>/g, ""),
  }));
}

export async function fetchArticle(
  query: string | undefined, exactTitle: string | undefined, lang: string
): Promise<{ title: string; html: string; plainTextExtract: string; sourceUrl: string }> {
  const fetchKey = cacheKey(lang, exactTitle ?? query ?? "");
  const cachedFetch = fetchCache.get(fetchKey);
  if (cachedFetch) return cachedFetch;

  let pageTitle = exactTitle;
  if (!pageTitle) {
    const results = await searchWikipedia(query ?? "", lang, 1);
    if (results.length === 0) throw new Error(`Nenhum resultado encontrado para "${query}".`);
    pageTitle = results[0].title;
  }

  const res = await CapacitorHttp.get({
    url: `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`,
    headers: { "Accept": "text/html", "User-Agent": WIKI_UA },
    responseType: "text",
  });
  if (res.status !== 200) throw new Error(`Erro ao buscar HTML do artigo (status ${res.status})`);

  const raw = res.data as string;
  const bodyMatch = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : raw;
  const cleanHtml = sanitizeWikipediaHtml(bodyHtml);

  const paragraphs: string[] = [];
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(cleanHtml)) !== null && paragraphs.length < 3) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text.length > 60) paragraphs.push(text);
  }

  const data = {
    title: pageTitle,
    html: cleanHtml,
    plainTextExtract: paragraphs.join("\n\n"),
    sourceUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
  };
  fetchCache.set(fetchKey, data);
  fetchCache.set(cacheKey(lang, pageTitle), data);
  return data;
}
