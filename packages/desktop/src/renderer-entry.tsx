// packages/desktop/src/renderer-entry.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@lexicon/shared";
import "@lexicon/shared/styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
