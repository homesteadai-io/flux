/// <reference types="vite/client" />

interface FluxWindowApi {
  minimize: () => void;
  close: () => void;
}

interface Window {
  fluxWindow: FluxWindowApi;
}
