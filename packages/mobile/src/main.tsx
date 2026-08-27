// packages/mobile/src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { StatusBar } from "@capacitor/status-bar";
import "@lexicon/shared/styles.css";
import "./mobile.css";
import { installLexiconBridge } from "./platform/bridge";
import { MobileApp } from "./MobileApp";

installLexiconBridge();

// Android 15+ (targetSdk 36 aqui) desenha a WebView por baixo das barras de
// sistema por padrão (edge-to-edge obrigatório) — sem isso, o conteúdo do
// topo de cada aba ficava embaixo da barra de status (relógio, rede,
// bateria). overlay:false devolve o comportamento "clássico": o SO reserva
// o espaço da barra de status e a WebView começa depois dela, sem depender
// de env(safe-area-inset-top) estar corretamente populado. .catch() (não
// try/catch — a chamada é assíncrona) engole a rejeição do preview web, que
// não tem implementação nativa do plugin.
StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});

const root = createRoot(document.getElementById("root")!);
root.render(<MobileApp />);
