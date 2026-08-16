/**
 * register-app/src/main.tsx — the packaged register's entry point.
 *
 * This is the Vite equivalent of src/app/pos/page.tsx. That file is how
 * Next.js mounts the register for the browser PWA; this is how the iPad app
 * mounts the very same component. Both render <RegisterShell/> and pass it the
 * same two props, so there is one register, mounted two ways.
 *
 * The difference is where the register sends its traffic. On the website the
 * page is served by our own server, so relative paths work and apiBase is "".
 * Inside the app the page comes from capacitor://localhost, which has no
 * server behind it, so an absolute https base must be baked in at build time.
 *
 * register-host-core decides that, and it is deliberately unforgiving for the
 * packaged build: if the app was built without a usable server address it
 * refuses to start and says so on screen. A register that boots and then fails
 * every request would be discovered by a budtender with a customer waiting,
 * and an unrecorded sale is a traceability problem, not an inconvenience.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RegisterShell } from "@/app/pos/RegisterShell";
import { resolveRegisterHostConfig } from "@/lib/pos/register-host-core";

import "./register.css";

/**
 * Render the "this build is broken" screen.
 *
 * Written in plain HTML with inline styles on purpose: this has to be readable
 * even if the stylesheet failed to load, and it must not depend on any of the
 * register's own code, since the whole point is that the register cannot run.
 */
function renderFatal(container: HTMLElement, message: string): void {
  container.innerHTML = "";

  const wrap = document.createElement("main");
  wrap.setAttribute("role", "alert");
  wrap.style.cssText =
    "min-height:100vh;display:flex;align-items:center;justify-content:center;" +
    "padding:2rem;background:#060807;color:#e8eae9;" +
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;";

  const card = document.createElement("div");
  card.style.cssText =
    "max-width:34rem;border:1px solid #3a2a2a;background:#140f0f;border-radius:1rem;padding:2rem;";

  const h = document.createElement("h1");
  h.textContent = "This register cannot start";
  h.style.cssText = "margin:0 0 0.75rem;font-size:1.25rem;font-weight:600;color:#ff9b9b;";

  const p = document.createElement("p");
  p.textContent = message;
  p.style.cssText = "margin:0 0 1rem;font-size:0.95rem;line-height:1.55;";

  const help = document.createElement("p");
  help.textContent =
    "Show this screen to whoever installed the app. No sales have been lost and nothing on this iPad needs to be reset.";
  help.style.cssText = "margin:0;font-size:0.85rem;line-height:1.5;color:#a9b0ad;";

  card.append(h, p, help);
  wrap.append(card);
  container.append(wrap);
}

const container = document.getElementById("root");

if (!container) {
  // Cannot happen with the shipped index.html, but failing silently here would
  // be a blank white screen with no explanation at all.
  document.body.innerHTML =
    "<p style=\"font-family:system-ui;padding:2rem\">Register failed to start: app container missing.</p>";
} else {
  const config = resolveRegisterHostConfig(
    {
      apiBase: __REGISTER_API_BASE__,
      buildVersion: __REGISTER_BUILD_VERSION__,
    },
    window.location,
  );

  if (!config.ok) {
    renderFatal(container, config.error);
  } else {
    // Helpful in a support call: "what does the register say it's talking to?"
    console.info(`[register] ${config.description}`);

    createRoot(container).render(
      <StrictMode>
        <RegisterShell buildVersion={config.buildVersion} apiBase={config.apiBase} />
      </StrictMode>,
    );
  }
}
