// packages/mobile/src/main.tsx
// Bootstrap temporário do scaffold Capacitor — substituído pela camada de
// persistência + tela de lista de artigos (window.lexicon real + shell mobile).
import React from "react";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root")!);
root.render(<div style={{ padding: 24, fontFamily: "sans-serif" }}>Lexicon — scaffold Capacitor OK</div>);
