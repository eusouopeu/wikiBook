// ─────────────────────────────────────────────────────────────────────────────
// src/main/handlers/wikipediaHandlers.js
// Busca conteúdo da Wikipedia e o sanitiza:
//   - Remove todos os hrefs externos
//   - Mantém estrutura de texto (parágrafos, listas, títulos)
//   - Remove infoboxes, referências e seções de navegação
// ─────────────────────────────────────────────────────────────────────────────

// ATENÇÃO: Electron não tem jsdom nativo. Usamos o parser DOMParser
// do renderer via IPC invertido — mas aqui no main preferimos uma abordagem
// mais leve: regex + substituição de string. Para uso futuro com jsdom,
// basta instalar: npm install jsdom

const https = require("https");
const { URL } = require("url");

// User-Agent obrigatório pela Wikipedia — sem ele retorna 403
const WIKI_UA = "Lexicon/1.0 (app pessoal; contato@exemplo.com) Node.js";

const REQUEST_TIMEOUT_MS = 20_000;

// ── Fetch com suporte a headers customizados ──────────────────────────────────
function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": WIKI_UA,
        "Accept": "application/json, text/html",
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      // Segue redirecionamentos (301/302) automaticamente
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // Location pode ser relativa — resolve contra a URL original
        const next = new URL(res.headers.location, url).toString();
        return fetchUrl(next, headers).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`Tempo esgotado após ${REQUEST_TIMEOUT_MS / 1000}s ao acessar ${parsed.hostname}.`)));
    req.on("error", reject);
    req.end();
  });
}

// ── Sanitiza o HTML retornado pela API Wikipedia ──────────────────────────────
// A Wikipedia REST API retorna HTML completo da seção; precisamos:
// 1. Remover todos os atributos href (os links internos tornarão-se clicáveis
//    apenas após o usuário defini-los manualmente)
// 2. Remover classes de navegação, thumbnails e referências numéricas
// 3. Manter parágrafos, listas, headings
function sanitizeWikipediaHtml(html) {
  let out = html;

  // 0. Defesa em profundidade: remove <script>, <style> e atributos on* (onclick,
  //    onerror etc.). O renderer ainda passa tudo pelo DOMPurify antes de exibir.
  out = out
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\s+on[a-z]+="[^"]*"/gi, "")
    .replace(/\s+on[a-z]+='[^']*'/gi, "");

  // 1. Corrige URLs protocol-relative (//upload.wikimedia.org/…) → HTTPS
  out = out.replace(/\bsrc="\/\/([^"]+)"/g, 'src="https://$1"');

  // 2. Transforma <figure> mantendo apenas o <img> interno (descarta legenda/wrapper)
  out = out.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_, inner) => {
    const imgMatch = inner.match(/<img\b[^>]*>/i);
    if (!imgMatch) return "";
    let imgTag = imgMatch[0];
    imgTag = imgTag.replace(/\s+srcset="[^"]*"/g, "");   // remove srcset (URLs complexas)
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

// ─────────────────────────────────────────────────────────────────────────────

// Cache em memória por termo normalizado (lang + query/título em minúsculas,
// sem espaços nas pontas) — evita chamadas de rede duplicadas quando o
// usuário busca/reabre o mesmo termo mais de uma vez na mesma sessão. Sem
// TTL: o conteúdo da Wikipedia é estável o suficiente para a duração do app,
// e o cache é descartado ao fechar.
const searchCache = new Map();
const fetchCache = new Map();
function cacheKey(lang, term) { return `${lang}::${term.trim().toLowerCase()}`; }

// Busca títulos candidatos na API de search
async function searchWikipedia(query, lang, limit) {
  const key = cacheKey(lang, `${query}::${limit}`);
  if (searchCache.has(key)) return searchCache.get(key);

  const searchUrl =
    `https://${lang}.wikipedia.org/w/api.php?` +
    `action=query&list=search&srsearch=${encodeURIComponent(query)}` +
    `&srlimit=${limit}&format=json&origin=*`;

  const searchRes = await fetchUrl(searchUrl);
  if (searchRes.status !== 200) {
    throw new Error(`Wikipedia retornou status ${searchRes.status}`);
  }
  const searchData = JSON.parse(searchRes.body);
  const results = searchData?.query?.search ?? [];
  searchCache.set(key, results);
  return results;
}

function createWikipediaHandlers(ipcMain) {

  // ── wikipedia:search { query, lang? } → [{ title, snippet }] ────────────────
  // Usado pelo modal de novo artigo para prévia dos resultados antes de criar.
  ipcMain.handle("wikipedia:search", async (_evt, { query, lang = "pt" }) => {
    try {
      const results = await searchWikipedia(query, lang, 5);
      return {
        ok: true,
        data: results.map(r => ({
          title: r.title,
          // snippet vem com marcação <span class="searchmatch"> — vira texto puro
          snippet: (r.snippet ?? "").replace(/<[^>]+>/g, ""),
        })),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── wikipedia:fetch { query?, exactTitle?, lang? } → { title, html, extract }
  // query: string de busca (ex.: "fotossíntese") — resolve o melhor resultado
  // exactTitle: título exato já escolhido (pula a etapa de busca)
  // lang: código de idioma (padrão "pt")
  ipcMain.handle("wikipedia:fetch", async (_evt, { query, exactTitle, lang = "pt" }) => {
    try {
      const fetchKey = cacheKey(lang, exactTitle ?? query ?? "");
      if (fetchCache.has(fetchKey)) return { ok: true, data: fetchCache.get(fetchKey) };

      let pageTitle = exactTitle;
      if (!pageTitle) {
        // Passo 1: busca o título exato via API de search
        const results = await searchWikipedia(query, lang, 1);
        if (results.length === 0) {
          return { ok: false, error: `Nenhum resultado encontrado para "${query}".` };
        }
        pageTitle = results[0].title;
      }

      // Passo 2: busca o HTML do artigo via REST API
      // Substitui espaços por _ antes de codificar (padrão Wikipedia)
      const htmlUrl =
        `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;

      const htmlRes = await fetchUrl(htmlUrl);
      if (htmlRes.status !== 200) {
        return { ok: false, error: `Erro ao buscar HTML do artigo (status ${htmlRes.status})` };
      }

      // Passo 3: extrai apenas o conteúdo principal do <body>
      // (a REST API retorna um HTML completo com <head>)
      const bodyMatch = htmlRes.body.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const bodyHtml = bodyMatch ? bodyMatch[1] : htmlRes.body;

      // Passo 4: sanitiza
      const cleanHtml = sanitizeWikipediaHtml(bodyHtml);

      // Passo 5: extrai um resumo em texto puro (primeiros 3 parágrafos)
      const paragraphs = [];
      const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let m;
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
      // Também indexa pelo título resolvido — cobre o caso de busca por
      // termo aproximado seguida de reabertura pelo título exato.
      fetchCache.set(cacheKey(lang, pageTitle), data);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { createWikipediaHandlers };