// ─────────────────────────────────────────────────────────────────────────────
// packages/sync-server/src/server.js
// Servidor de sincronização self-hosted do Wikibook.
//
// Modelo de autenticação: sem cadastro de usuário. O PRIMEIRO dispositivo que
// configura a sincronização gera um token aleatório localmente (nas
// Configurações do app) — esse token vira o identificador da "biblioteca" no
// servidor. Colar o mesmo token em outro dispositivo aponta os dois para os
// mesmos dados. Qualquer requisição com um token nunca visto antes cria essa
// biblioteca silenciosamente (não há passo de "registro").
//
// Merge: last-write-wins por artigo, comparando `updatedAt`. Pastas são
// unidas por id (o lado que envia sempre sobrescreve seu próprio id) — sem
// isso, um POST /sync/push nunca apaga dados que só existem no servidor.
// Fora do escopo desta primeira versão: sincronizar EXCLUSÕES entre
// dispositivos (excluir um artigo localmente não remove ele dos outros
// dispositivos na próxima sincronização) — deixado assim de propósito para
// não arriscar apagar dados por engano num merge automático; documentado no
// README deste pacote.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 8787;
const DB_PATH = process.env.SYNC_DB_PATH || path.join(__dirname, "..", "data", "sync.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    token TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (token, id)
  );
  CREATE TABLE IF NOT EXISTS folders (
    token TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (token, id)
  );
`);

const selectArticle = db.prepare("SELECT data, updated_at FROM articles WHERE token = ? AND id = ?");
const upsertArticle = db.prepare(`
  INSERT INTO articles (token, id, data, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(token, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);
const listArticles = db.prepare("SELECT data FROM articles WHERE token = ?");
const upsertFolder = db.prepare(`
  INSERT INTO folders (token, id, data) VALUES (?, ?, ?)
  ON CONFLICT(token, id) DO UPDATE SET data = excluded.data
`);
const listFolders = db.prepare("SELECT data FROM folders WHERE token = ?");

function mergeArticlesForToken(token, incomingArticles) {
  for (const article of incomingArticles ?? []) {
    if (!article || !article.id || !article.updatedAt) continue;
    const existing = selectArticle.get(token, article.id);
    if (!existing || article.updatedAt > existing.updated_at) {
      upsertArticle.run(token, article.id, JSON.stringify(article), article.updatedAt);
    }
  }
}

function mergeFoldersForToken(token, incomingFolders) {
  for (const folder of incomingFolders ?? []) {
    if (!folder || !folder.id) continue;
    upsertFolder.run(token, folder.id, JSON.stringify(folder));
  }
}

function currentStateForToken(token) {
  return {
    articles: listArticles.all(token).map(row => JSON.parse(row.data)),
    folders: listFolders.all(token).map(row => JSON.parse(row.data)),
  };
}

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "wikibook-sync", version: 1 });
});

function requireToken(req, res, next) {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ ok: false, error: "Token de sincronização ausente (Authorization: Bearer <token>)." });
    return;
  }
  req.libraryToken = token;
  next();
}

// POST /sync/push { articles, folders } → mescla o que vier no corpo com o
// que já existe no servidor para este token, e devolve o estado mesclado
// completo — o cliente adota essa resposta como novo estado local (mesma
// chamada resolve "mandar minhas mudanças" e "buscar as dos outros
// dispositivos" de uma vez, sem round-trip extra).
app.post("/sync/push", requireToken, (req, res) => {
  try {
    const { articles, folders } = req.body ?? {};
    mergeArticlesForToken(req.libraryToken, articles);
    mergeFoldersForToken(req.libraryToken, folders);
    res.json({ ok: true, ...currentStateForToken(req.libraryToken) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /sync/pull → estado atual sem enviar mudanças (útil para inspecionar/
// depurar; o app usa /sync/push para o fluxo normal de "Sincronizar").
app.get("/sync/pull", requireToken, (req, res) => {
  try {
    res.json({ ok: true, ...currentStateForToken(req.libraryToken) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Wikibook sync server ouvindo em http://localhost:${PORT} (banco: ${DB_PATH})`);
});
