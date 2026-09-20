import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

const root = document.getElementById("root")!;

/**
 * Something failed before React could paint.
 *
 * A module that throws while it is being imported takes the whole bundle
 * down, and the user sees a black page with the reason buried in the
 * console. Printing it on the page instead costs nothing and turns a
 * mystery into a fixable message.
 */
function showCrash(error: unknown): void {
  if (root.childElementCount > 0) return; // React already rendered something
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `
    <div style="max-width:42rem;margin:12vh auto;padding:0 1rem;font-family:system-ui,sans-serif;color:#e7e9ee">
      <h1 style="font-size:1.125rem;margin:0 0 .5rem">The app could not start</h1>
      <p style="margin:0 0 1rem;color:#9aa1ad;font-size:.875rem">Uygulama başlatılamadı.</p>
      <pre style="white-space:pre-wrap;word-break:break-word;background:#15171c;border:1px solid #262a33;border-radius:.5rem;padding:.75rem;font-size:.8125rem;margin:0">${message.replace(
        /[<&]/g,
        (c) => (c === "<" ? "&lt;" : "&amp;"),
      )}</pre>
    </div>`;
}

window.addEventListener("error", (e) => showCrash(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showCrash(e.reason));

// Imported dynamically so a throw at module scope lands in the catch below
// rather than killing the bundle before any of this runs.
import("./App.tsx")
  .then(({ default: App }) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch(showCrash);
