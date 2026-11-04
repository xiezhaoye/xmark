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
import { createLocalClient } from "./api/localClient";
import { httpFetch } from "./platform";
import { useReaderStore } from "./state/readerStore";
import { App } from "./App";

// One factory for both sources: a `localPath` means the folder the native
// picker granted, everything else is a Mac over Tailscale.
useReaderStore.getState().reset((c) =>
  c.localPath ? createLocalClient({ path: c.localPath, name: "本机文件夹" }) : createClient(c, httpFetch),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
