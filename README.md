# Lexicon — Base de conhecimento pessoal com grafo de conceitos

Monorepo (npm workspaces) com a UI React + D3 + Zustand compartilhada entre um
app desktop (Electron, macOS/Windows/Linux) e um app mobile (Capacitor,
iOS/Android) que permitem criar, explorar e visualizar artigos interligados —
vindos da Wikipedia ou gerados pelo Claude — como um grafo pessoal de
conhecimento.

---

## Instalação e execução (desktop)

```bash
# 1. Instalar dependências (na raiz do monorepo — resolve todos os workspaces)
npm install

# 2. Modo desenvolvimento (abre o DevTools automaticamente)
npm run dev --workspace packages/desktop

# 3. Build para distribuição
npm run build --workspace packages/desktop
```

### Pré-requisitos
- Node.js 18+
- macOS 12+ (testado; funciona no Windows/Linux com ajuste da titleBarStyle)

### Primeira execução
1. Abra o app
2. Clique no ícone ⚙ (canto superior esquerdo da sidebar)
3. Cole sua Anthropic API Key e salve
4. Crie seu primeiro artigo com "+ Novo artigo"

---

## Estrutura do projeto

```
lexicon-app/
├── package.json                   # workspace root (npm workspaces)
└── packages/
    ├── shared/                    # @lexicon/shared — UI React/D3/Zustand, sem nada de host
    │   ├── App.tsx                # Componente raiz do desktop (layout 3 colunas)
    │   ├── styles.css             # Tema editorial escuro
    │   ├── store/useStore.ts      # Estado global Zustand + cálculo do grafo
    │   ├── components/
    │   │   ├── GraphView.tsx      # Grafo D3 com zoom e tamanho em cascata
    │   │   └── ArticleView.tsx    # Visualização de artigo + menu de contexto
    │   └── shared/types.ts        # Tipos TypeScript compartilhados (contrato do bridge)
    │
    ├── desktop/                   # Shell Electron
    │   ├── index.html
    │   ├── src/
    │   │   ├── renderer-entry.tsx # Bootstrap React — importa App de @lexicon/shared
    │   │   └── main/
    │   │       ├── main.js        # Processo principal Electron
    │   │       ├── preload.js     # Bridge IPC segura (contextBridge) → window.lexicon
    │   │       └── handlers/      # articleHandlers/wikipediaHandlers/claudeHandlers/
    │   │                          # flashcardHandlers/configHandlers — fs local do Node
    │   └── dist/                  # Gerado pelo esbuild (não commitar)
    │
    └── mobile/                    # Shell Capacitor (iOS/Android)
        └── src/platform/          # window.lexicon equivalente via plugins Capacitor
```

Desktop e mobile importam os mesmos componentes/estado de `@lexicon/shared`; só a
implementação de `window.lexicon.invoke(channel, payload)` muda por plataforma
(IPC do Electron vs. plugins nativos do Capacitor).

---

## Onde os dados ficam

Todos os dados são locais — nenhuma sincronização com nuvem.

| Dado | Localização |
|---|---|
| Artigos | `~/Library/Application Support/Lexicon/articles/` (macOS) |
| Configurações | `~/Library/Application Support/Lexicon/config.json` |

Cada artigo é um arquivo `<slug>.json` independente — fácil de fazer backup ou
exportar manualmente.

---

## Fluxo de uso

### Criar um artigo a partir da Wikipedia
1. Clique em "+ Novo artigo"
2. Digite o termo de pesquisa (ex.: "fotossíntese")
3. Selecione "Buscar na Wikipedia"
4. O app busca o artigo, sanitiza o HTML (remove hrefs externos) e gera um resumo
   em bullet points automaticamente via Claude

### Criar um artigo via Claude
1. Mesmo fluxo, mas selecione "Gerar com Claude"
2. O Claude produz um artigo-resumo em bullet points a partir do título informado

### Criar links entre artigos (hipertexto interno)
1. Abra um artigo qualquer
2. Selecione uma ou mais palavras no texto
3. Clique com o botão direito → escolha:
   - **"Pesquisar na Wikipedia"** — busca o termo e cria o artigo + link automaticamente
   - **"Gerar artigo com Claude"** — gera o artigo e cria o link
4. O link fica registrado no artigo-pai (o texto selecionado vira um link azul clicável)
5. O artigo-filho aparece no grafo conectado ao pai

### Sincronizar entre dispositivos (opcional)
Por padrão os dados são só locais. Para usar o app em mais de um dispositivo,
suba o servidor self-hosted em `packages/sync-server` (Node.js + SQLite,
`npm install && npm start` — ver o README do pacote) e nas Configurações de
cada dispositivo:
1. Aponte "Servidor de sincronização" para o endereço onde ele está rodando
2. No primeiro dispositivo, clique em "Gerar novo token" e copie-o
3. Cole o mesmo token nos outros dispositivos, apontando para o mesmo servidor
4. Clique em "Sincronizar agora" em qualquer um deles quando quiser enviar/
   receber mudanças — não é automático em segundo plano

### Visualização em grafo
- Clique na aba "Grafo" para ver todos os artigos e suas conexões
- **Tamanho dos nós em cascata**: artigos-raiz (criados diretamente, sem pai) são os
  maiores. Cada nível de profundidade fica 20% menor que o nível anterior:
  - Profundidade 0 (raiz): raio base × 1.2^N
  - Profundidade 1: raio base × 1.2^(N-1)
  - ...e assim por diante
- **Zoom**: scroll do mouse / pinch para zoom; arraste para pan
- **Botões**: ＋ / － / ⌖ no canto da aba de grafo
- **Hover em aresta**: mostra o anchorText (texto que gerou o link)
- **Clique em nó**: abre o artigo na visualização de artigo

---

## Decisões de arquitetura

### Por que arquivos JSON em vez de SQLite?
Os artigos são documentos independentes. JSON permite:
- Backup trivial (copiar/colar uma pasta)
- Inspeção manual sem ferramentas especiais
- Sem necessidade de migrations quando o schema muda

### Por que o hiperlink é registrado no artigo-PAI?
Porque o link representa uma decisão de quem está lendo — não uma propriedade
intrínseca do termo. Dois artigos diferentes podem vincular a mesma palavra para
conceitos diferentes. Deletar um artigo-filho remove suas referências nos pais,
mas não o contrário.

### Sanitização do HTML da Wikipedia
O HTML retornado pela Wikipedia REST API é completamente limpo:
- Todos os `href` são removidos — os textos de links viram `<span class="wiki-term">`
- Infoboxes, thumbnails, seções de referência e navegação são removidos
- O usuário depois decide quais `wiki-term`s vincular a outros artigos

### Cálculo de profundidade e tamanho dos nós
Usa BFS a partir dos nós-raiz (sem pai). Um nó pode ser filho de múltiplos pais —
nesse caso, usa-se a menor profundidade encontrada (o caminho mais curto desde
uma raiz). O raio é: `BASE_RADIUS × 1.2^(maxDepth - depth)`.

---

## Dependências externas

| Dependência | Uso | Licença |
|---|---|---|
| `d3` v7 | Grafo force-directed + zoom | BSD-3 |
| `zustand` v4 | Gerenciamento de estado | MIT |
| `electron` v31 | Shell nativo | MIT |
| `esbuild` | Bundler do renderer | MIT |
| Wikipedia REST API | Conteúdo de artigos | CC BY-SA |
| Anthropic API | Resumos e geração | Comercial |
