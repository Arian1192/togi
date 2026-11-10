import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
// Solo la estructura de React Flow; los colores y la letra de la mesa salen de la marca (app.css).
import "@xyflow/react/dist/base.css";
import "./tokens.css";
import "./fonts.css";
import "./app.css";

const root = document.getElementById("root");
if (root === null) throw new Error("falta #root en index.html");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
