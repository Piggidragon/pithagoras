import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerServiceWorker } from "./register-sw";
import App from "./App";
import "./styles";
import { installTooltips } from "./tooltips";

installTooltips();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

registerServiceWorker(import.meta.env.PROD);
