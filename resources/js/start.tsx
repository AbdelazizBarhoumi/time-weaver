import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";

declare global {
    interface Window {
        __ROUTER__: ReturnType<typeof getRouter>;
    }
}

const router = getRouter();

if (!window.__ROUTER__) {
    window.__ROUTER__ = router;
}

createRoot(document.getElementById("app")!).render(
    <StrictMode>
        <RouterProvider router={window.__ROUTER__} />
    </StrictMode>
);