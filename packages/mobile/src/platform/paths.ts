// ─────────────────────────────────────────────────────────────────────────────
// packages/mobile/src/platform/paths.ts
// Porta de packages/desktop/src/main/handlers/pathHandlers.js (CRUD de
// LearningPath) — mesma modelagem de articles.ts, um JSON por trilha.
// A geração via Claude (consolidateProfile/generatePath) fica em claude.ts,
// igual ao desktop separar CRUD (articleHandlers) de IA (claudeHandlers).
// ─────────────────────────────────────────────────────────────────────────────

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import type { LearningPath } from "@lexicon/shared";

const PATHS_DIR = "paths";

async function ensureDir() {
  try {
    await Filesystem.mkdir({ path: PATHS_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // já existe
  }
}
function pathFile(id: string) { return `${PATHS_DIR}/${id}.json`; }

export async function listPaths(): Promise<LearningPath[]> {
  await ensureDir();
  let entries;
  try {
    entries = await Filesystem.readdir({ path: PATHS_DIR, directory: Directory.Data });
  } catch {
    return [];
  }
  const out: LearningPath[] = [];
  for (const f of entries.files) {
    if (!f.name.endsWith(".json")) continue;
    try {
      const res = await Filesystem.readFile({
        path: `${PATHS_DIR}/${f.name}`, directory: Directory.Data, encoding: Encoding.UTF8,
      });
      out.push(JSON.parse(res.data as string) as LearningPath);
    } catch {
      // arquivo corrompido/parcial — ignora
    }
  }
  out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return out;
}

export async function getPath(id: string): Promise<LearningPath> {
  const res = await Filesystem.readFile({
    path: pathFile(id), directory: Directory.Data, encoding: Encoding.UTF8,
  });
  return JSON.parse(res.data as string) as LearningPath;
}

export async function savePath(partial: Partial<LearningPath> & { goal: string }): Promise<LearningPath> {
  await ensureDir();
  const now = new Date().toISOString();
  const record: LearningPath = {
    interviewAnswers: [], profileSummary: "", model: "sonnet-standard", units: [],
    ...partial,
    id: partial.id ?? crypto.randomUUID(),
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  } as LearningPath;
  await Filesystem.writeFile({
    path: pathFile(record.id), data: JSON.stringify(record, null, 2),
    directory: Directory.Data, encoding: Encoding.UTF8,
  });
  return record;
}

export async function deletePath(id: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: pathFile(id), directory: Directory.Data });
  } catch {
    // já não existia
  }
}
