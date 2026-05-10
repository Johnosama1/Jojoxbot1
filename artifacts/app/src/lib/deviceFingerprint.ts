export async function collectDeviceFingerprint(): Promise<string> {
  const signals: string[] = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency || 0),
    String((navigator as unknown as { deviceMemory?: number }).deviceMemory || 0),
    String(navigator.maxTouchPoints || 0),
  ];
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220; canvas.height = 30;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "alphabetic";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#7c6eff";
      ctx.fillRect(0, 0, 10, 10);
      ctx.fillStyle = "rgba(0,200,120,0.8)";
      ctx.fillText("JojoxVerify🎰2025", 2, 20);
      signals.push(canvas.toDataURL().slice(-64));
    }
  } catch { signals.push(""); }
  return signals.join("|||");
}
