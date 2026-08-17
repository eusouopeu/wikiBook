# @lexicon/sync-server

Servidor de sincronização self-hosted do Wikibook, para usar o app em mais de
um dispositivo. Node.js puro + `node:sqlite` (built-in do Node 22.5+, sem
dependência nativa para compilar) + Express.

## Rodando

```bash
cd packages/sync-server
npm install
npm start
```

Por padrão sobe em `http://localhost:8787` e grava o banco em
`packages/sync-server/data/sync.db`. Para mudar:

```bash
PORT=9000 SYNC_DB_PATH=/caminho/para/sync.db npm start
```

Para deixar acessível de outros dispositivos na mesma rede (celular, outro
computador), rode num host acessível por eles — uma VPS, um Raspberry Pi, ou
o próprio computador desde que a porta esteja liberada no firewall/roteador —
e use o IP/domínio dele como "Servidor de sincronização" nas Configurações do
app, em vez de `localhost`.

## Autenticação

Sem cadastro de usuário/senha. Nas Configurações do app, o primeiro
dispositivo gera um **token** aleatório (botão "Gerar novo token") — esse
token é o identificador da sua biblioteca no servidor. Cole o mesmo token nos
outros dispositivos, apontando todos para o mesmo servidor, para que
sincronizem entre si. Qualquer token nunca visto antes cria uma biblioteca
nova silenciosamente na primeira sincronização.

Trate o token como uma senha: quem o tiver, junto com o endereço do seu
servidor, lê e escreve na sua biblioteca.

## O que a sincronização cobre

- Artigos e pastas, mesclados por "o mais recente vence" (`updatedAt` de cada
  artigo).
- **Não cobre exclusões entre dispositivos** nesta primeira versão: excluir
  um artigo num dispositivo não o remove dos outros na sincronização
  seguinte. Foi uma escolha deliberada — um merge automático de exclusões tem
  risco de apagar dados por engano (ex.: dispositivo desatualizado sincroniza
  e "ressuscita" um artigo que outro tinha apagado de propósito, ou o
  inverso). Excluir em cada dispositivo continua funcionando normalmente,
  apenas não se propaga.
- Sincronização é sob demanda (botão "Sincronizar agora"), não automática em
  segundo plano.
