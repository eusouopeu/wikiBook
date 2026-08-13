import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.pedro.lexicon.mobile',
  appName: 'Wikibook',
  webDir: 'dist',
  // Requisições nativas (fora do fetch/XHR do WebView) — necessário para a API
  // da Anthropic, que não expõe CORS para chamada direta do browser/WebView.
  // Usado também para a Wikipedia, por consistência entre os dois caminhos de
  // rede em vez de depender de headers CORS que ela pode mudar.
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
