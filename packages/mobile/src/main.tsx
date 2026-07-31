// packages/mobile/src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "@lexicon/shared/styles.css";
import "./mobile.css";
import { installLexiconBridge } from "./platform/bridge";
import { MobileApp } from "./MobileApp";

installLexiconBridge();

const root = createRoot(document.getElementById("root")!);
root.render(<MobileApp />);
