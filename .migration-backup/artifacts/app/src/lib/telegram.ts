declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  ready(): void;
  expand(): void;
  close(): void;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
  };
  BackButton: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
  };
  colorScheme: "dark" | "light";
  themeParams: Record<string, string>;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp || null;
}

export function getTelegramUser() {
  const tg = getTelegramWebApp();
  if (!tg) return null;
  return tg.initDataUnsafe?.user || null;
}

export function getStartParam(): string | null {
  const tg = getTelegramWebApp();
  if (!tg) return null;
  return tg.initDataUnsafe?.start_param || null;
}

export function initTelegramApp() {
  const tg = getTelegramWebApp();
  if (tg) {
    tg.ready();
    tg.expand();
    // Disable vertical swipe-to-close gesture
    if (typeof (tg as unknown as Record<string, unknown>).disableVerticalSwipes === "function") {
      (tg as unknown as Record<string, () => void>).disableVerticalSwipes();
    }
  }
  // Lock the page: no body scroll at all
  document.documentElement.style.height = "100%";
  document.documentElement.style.overflow = "hidden";
  document.body.style.height = "100%";
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.width = "100%";
  document.body.style.top = "0";
  document.body.style.left = "0";
}

// For testing in browser without Telegram
export function getMockUser() {
  return {
    id: 123456789,
    username: "testuser",
    first_name: "Test",
    last_name: "User",
    photo_url: undefined as string | undefined,
  };
}
