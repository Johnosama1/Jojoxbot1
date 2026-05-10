import { useEffect, useRef } from "react";

export default function Confetti({ active }: { active: boolean }) {
  const piecesRef = useRef<HTMLDivElement[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;
    const colors = ["#ffd700", "#9333ea", "#ff4081", "#00e5ff", "#76ff03", "#ffab40"];
    const pieces: HTMLDivElement[] = [];

    for (let i = 0; i < 60; i++) {
      const el = document.createElement("div");
      el.className = "confetti-piece";
      el.style.left = `${Math.random() * 100}vw`;
      el.style.width = `${6 + Math.random() * 8}px`;
      el.style.height = `${6 + Math.random() * 8}px`;
      el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      el.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
      el.style.animationDuration = `${1.5 + Math.random() * 2}s`;
      el.style.animationDelay = `${Math.random() * 0.5}s`;
      el.style.top = "-10px";
      container.appendChild(el);
      pieces.push(el);
    }

    const timeout = setTimeout(() => {
      pieces.forEach((p) => p.remove());
    }, 4000);

    return () => {
      clearTimeout(timeout);
      pieces.forEach((p) => p.remove());
    };
  }, [active]);

  return <div ref={containerRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1000 }} />;
}
