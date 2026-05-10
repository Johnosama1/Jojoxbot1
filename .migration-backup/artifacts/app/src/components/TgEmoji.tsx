/**
 * TgEmoji — renders a Telegram Premium custom emoji.
 *
 * Inside a real Telegram Mini App the native <tg-emoji> web component
 * is supported and renders the animated sticker automatically.
 * Outside Telegram (browser preview) we fall back to the static PNG URL.
 *
 * Usage:
 *   <TgEmoji id="5226711870492126219" fallback="🎡" size={32} />
 */

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "tg-emoji": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { "emoji-id"?: string },
        HTMLElement
      >;
    }
  }
}

interface TgEmojiProps {
  id: string;
  fallback: string;
  size?: number;
  style?: React.CSSProperties;
}

const isTelegram =
  typeof window !== "undefined" &&
  !!(window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp;

export default function TgEmoji({ id, fallback, size = 24, style }: TgEmojiProps) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    flexShrink: 0,
    verticalAlign: "middle",
    ...style,
  };

  if (isTelegram) {
    return (
      <span style={base}>
        <tg-emoji emoji-id={id}>{fallback}</tg-emoji>
      </span>
    );
  }

  // Browser fallback — static PNG from Telegram CDN
  return (
    <img
      src={`https://t.me/i/emoji/${id}.png`}
      alt={fallback}
      width={size}
      height={size}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        objectFit: "contain",
        flexShrink: 0,
        ...style,
      }}
      onError={(e) => {
        // If CDN image fails, show text fallback
        const el = e.currentTarget;
        el.style.display = "none";
        const span = document.createElement("span");
        span.textContent = fallback;
        span.style.fontSize = `${size * 0.85}px`;
        el.parentElement?.appendChild(span);
      }}
    />
  );
}
