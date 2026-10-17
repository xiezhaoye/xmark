/**
 * Entry point: wire the store to the real HTTP client and mount the app.
 *
 * @module main
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles.css";
import { createClient } from "./api/client";
import { httpFetch } from "./platform";
import { useReaderStore } from "./state/readerStore";
import { App } from "./App";

useReaderStore.getState().reset((c) => createClient(c, httpFetch));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
