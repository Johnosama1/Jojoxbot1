import { TonConnectUI } from "@tonconnect/ui-react";

// Manifest URL — served dynamically from API so iconUrl uses the correct domain
export const MANIFEST_URL = `${window.location.origin}/api/tonconnect-manifest.json`;

// Singleton instance shared across the app
let _ui: TonConnectUI | null = null;

export function getTonConnectUI(): TonConnectUI {
  if (!_ui) {
    _ui = new TonConnectUI({ manifestUrl: MANIFEST_URL });
  }
  return _ui;
}
