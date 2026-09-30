// Silence console.log/info/debug/warn in production
if (import.meta.env.PROD) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
}

import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";              // tailwind directives live here
import { router } from "./router";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/lib/ThemeProvider";
import { logger } from "@/lib/loggingService";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css"; // if using rehype-highlight

// Initialize logging session
const restored = logger.restoreSession();
if (!restored) {
  logger.startSession();
}

// Clean up old logs to free localStorage space
logger.cleanup(3);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  </React.StrictMode>
);