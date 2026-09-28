import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerServiceWorker } from "./register-sw";
// Before the app: its first frame is already in the language chosen.
import "./locales";
import App from "./App";
import "./styles";
import { installTooltips } from "./tooltips";
import { watchKeyboard } from "./keyboard";

installTooltips();
watchKeyboard();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

registerServiceWorker(import.meta.env.PROD);
