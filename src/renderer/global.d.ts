import type { DesktopApi } from "../main/preload.cjs";

declare global {
  interface Window {
    featureContext: DesktopApi;
  }
}

export {};
