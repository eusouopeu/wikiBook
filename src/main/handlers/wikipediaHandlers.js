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
const WIKI_UA = "Brita/1.0 (app pessoal; contato@exemplo.com) Node.js";

// ── Fetch com suporte a headers customizados ──────────────────────────────────
function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": WIKI_UA,
        "Accept": "application/json, text/html",
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      // Segue redirecionamentos (301/302) automaticamente
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, headers).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
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

function createWikipediaHandlers(ipcMain) {

  // ── wikipedia:fetch { query, lang? } → { title, html, extract } ─────────────
  // query: string de busca (ex.: "fotossíntese")
  // lang: código de idioma (padrão "pt")
  ipcMain.handle("wikipedia:fetch", async (_evt, { query, lang = "pt" }) => {
    try {
      // Passo 1: busca o título exato via API de search
      const searchUrl =
        `https://${lang}.wikipedia.org/w/api.php?` +
        `action=query&list=search&srsearch=${encodeURIComponent(query)}` +
        `&srlimit=1&format=json&origin=*`;

      const searchRes = await fetchUrl(searchUrl);
      if (searchRes.status !== 200) {
        return { ok: false, error: `Wikipedia retornou status ${searchRes.status}` };
      }

      const searchData = JSON.parse(searchRes.body);
      const results = searchData?.query?.search;
      if (!results || results.length === 0) {
        return { ok: false, error: `Nenhum resultado encontrado para "${query}".` };
      }

      const pageTitle = results[0].title;

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

      return {
        ok: true,
        data: {
          title: pageTitle,
          html: cleanHtml,
          plainTextExtract: paragraphs.join("\n\n"),
          sourceUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { createWikipediaHandlers };