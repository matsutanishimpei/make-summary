import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./MobileApp";
import "./mobile.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
