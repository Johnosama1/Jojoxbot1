/**
 * EmojiText — renders a string that may contain custom emoji patterns.
 *
 * Pattern: fallbackEmoji(custom_emoji_id)
 * Example: "اضغط هنا 🔒(5296369303661067030) للدخول"
 *
 * This lets you write any text with inline Telegram premium emojis
 * without changing core rendering code — just add the ID.
 *
 * Usage:
 *   <EmojiText text="مرحباً 🎡(5226711870492126219) بالمنصة" size={20} />
 */

import TgEmoji from "./TgEmoji";

const PATTERN = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\((\d{15,20})\)/gu;

interface EmojiTextProps {
  text: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

interface Segment {
  type: "text" | "emoji";
  content: string;
  id?: string;
}

function parse(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  // Reset lastIndex before using exec in loop
  PATTERN.lastIndex = 0;

  while ((match = PATTERN.exec(text)) !== null) {
    const [full, fallback, id] = match;
    const start = match.index;

    if (start > last) {
      segments.push({ type: "text", content: text.slice(last, start) });
    }
    segments.push({ type: "emoji", content: fallback, id });
    last = start + full.length;
  }

  if (last < text.length) {
    segments.push({ type: "text", content: text.slice(last) });
  }

  return segments;
}

export default function EmojiText({ text, size = 20, className, style }: EmojiTextProps) {
  const segments = parse(text);

  return (
    <span
      className={className}
      style={{ display: "inline", lineHeight: 1.5, ...style }}
    >
      {segments.map((seg, i) =>
        seg.type === "emoji" ? (
          <TgEmoji key={i} id={seg.id!} fallback={seg.content} size={size} />
        ) : (
          <span key={i}>{seg.content}</span>
        )
      )}
    </span>
  );
}
