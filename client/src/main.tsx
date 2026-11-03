import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/common/ErrorBoundary.tsx";
import { NotificationToastBridge } from "./components/layout/NotificationToastBridge.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { ConfirmProvider } from "./context/ConfirmContext.tsx";
import { ToastProvider } from "./context/ToastContext.tsx";
import "./index.css";

/**
 * Application entry point. Mounts the React tree into the `#root` element,
 * wiring up client-side routing, the top-level error boundary, and the auth/
 * toast/confirm contexts the rest of the app depends on.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <NotificationToastBridge />
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
