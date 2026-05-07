import { useState, useEffect, useRef } from "react";
import lottie from "lottie-web";
import usdtAnimData from "../../public/usdt-anim.json";
import { useUser } from "../lib/userContext";
import { api, swapUsdtToTon, invalidateUserCaches, getWithdrawalsOnce } from "../lib/api";
import type { Withdrawal } from "../lib/api";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import {
  Send, CheckCircle, X, Wallet, ChevronLeft,
  Clock, CheckCheck, XCircle, Loader2, ArrowDownUp, RefreshCw, TrendingUp,
} from "lucide-react";
import { useLocation } from "wouter";

const MIN_WITHDRAWAL = 0.1;
const TON_IMG  = "https://assets.coingecko.com/coins/images/17980/standard/photo_2024-09-10_17.09.00.jpeg?1725963446";
const USDT_IMG = "https://assets.coingecko.com/coins/images/325/large/Tether.png";

function UsdtLogo({ size = 32 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      animationData: usdtAnimData as any,
    });
    return () => anim.destroy();
  }, []);
  return <div ref={ref} style={{ width: size, height: size, flexShrink: 0 }} />;
}
function TonLogo({ size = 32 }: { size?: number }) {
  return <img src={TON_IMG} alt="TON" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
}
function maskWallet(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "•••" + addr.slice(-5);
}
function statusIcon(s: string) {
  if (s === "approved" || s === "completed") return <CheckCheck size={12} color="#34d399" />;
  if (s === "rejected")  return <XCircle size={12} color="#f87171" />;
  if (s === "processing") return <Loader2 size={12} color="#fbbf24" style={{ animation: "spin 1s linear infinite" }} />;
  return <Clock size={12} color="rgba(255,255,255,0.35)" />;
}
function statusLabel(s: string) {
  return ({ pending: "Pending", approved: "Approved", completed: "Sent", rejected: "Rejected", processing: "Processing" } as Record<string, string>)[s] ?? s;
}
function statusColor(s: string) {
  if (s === "approved" || s === "completed") return "#34d399";
  if (s === "rejected") return "#f87171";
  if (s === "processing") return "#fbbf24";
  return "rgba(255,255,255,0.38)";
}

/* ═══════════════════════════════════════════════════════════════════ */
export default function WalletPage() {
  const { user, refresh } = useUser();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"swap" | "withdraw">("swap");

  const [tonPrice, setTonPrice]         = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [swapAmount, setSwapAmount]     = useState("");
  const [swapping, setSwapping]         = useState(false);
  const [swapResult, setSwapResult]     = useState<{ tonAmount: string; tonPrice: number } | null>(null);
  const [swapError, setSwapError]       = useState("");
  const [amount, setAmount]             = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [success, setSuccess]           = useState(false);
  const [wdError, setWdError]           = useState("");
  const [history, setHistory]           = useState<Withdrawal[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [tonConnectUI]   = useTonConnectUI();
  const connectedAddress  = useTonAddress();
  const prevAddressRef    = useRef("");
  const [syncing, setSyncing]     = useState(false);
  const [syncDone, setSyncDone]   = useState(false);
  const reopenAfterConnect        = useRef(false);

  useEffect(() => {
    setPriceLoading(true);
    fetch("/api/price/ton")
      .then(r => r.json()).then(d => setTonPrice(d?.usd ?? null))
      .catch(() => setTonPrice(null)).finally(() => setPriceLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    setHistoryLoading(true);
    getWithdrawalsOnce(user.id).then(setHistory).catch(() => {}).finally(() => setHistoryLoading(false));
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const prev = prevAddressRef.current;
    prevAddressRef.current = connectedAddress;
    if (connectedAddress && connectedAddress !== user.savedWalletAddress) {
      setSyncing(true);
      api.saveWallet(user.id, connectedAddress)
        .then(() => refresh())
        .then(() => { setSyncDone(true); setTimeout(() => setSyncDone(false), 3000); })
        .catch(() => {}).finally(() => setSyncing(false));
    } else if (!connectedAddress && prev && user.savedWalletAddress) {
      api.saveWallet(user.id, "").then(() => refresh()).catch(() => {});
    }
  }, [connectedAddress, user?.id]);

  useEffect(() => {
    if (connectedAddress && reopenAfterConnect.current) {
      reopenAfterConnect.current = false;
      setTab("withdraw");
    }
  }, [connectedAddress]);

  const usdtBalance = parseFloat(user?.balance    || "0");
  const tonBalance  = parseFloat(user?.tonBalance || "0");
  const savedWallet = user?.savedWalletAddress ?? null;
  const canWithdraw = tonBalance >= MIN_WITHDRAWAL;
  const swapAmtNum  = parseFloat(swapAmount) || 0;
  const canSwap     = usdtBalance > 0 && !swapping;
  const tonEquiv    = tonPrice && swapAmtNum > 0 ? (swapAmtNum / tonPrice).toFixed(4) : null;
  const amtNum      = parseFloat(amount) || 0;

  const refreshPrice = () => {
    setPriceLoading(true);
    fetch("/api/price/ton")
      .then(r => r.json()).then(d => setTonPrice(d?.usd ?? null))
      .catch(() => setTonPrice(null)).finally(() => setPriceLoading(false));
  };

  const handleSwap = async () => {
    if (!user || swapping) return;
    setSwapError(""); setSwapResult(null);
    const amt = swapAmtNum || usdtBalance;
    if (amt <= 0) { setSwapError("أدخل مبلغاً"); return; }
    if (amt > usdtBalance) { setSwapError("رصيد USDT غير كافٍ"); return; }
    setSwapping(true);
    try {
      const res = await swapUsdtToTon(user.id, amt);
      setSwapResult({ tonAmount: res.tonAmount, tonPrice: res.tonPrice });
      invalidateUserCaches(user.id);
      await refresh();
      setSwapAmount("");
      getWithdrawalsOnce(user.id).then(setHistory).catch(() => {});
    } catch (e: unknown) {
      setSwapError(e instanceof Error ? e.message : "فشل التحويل");
    } finally { setSwapping(false); }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || submitting) return;
    setWdError(""); setSuccess(false);
    if (!savedWallet) { setWdError("Connect your TON wallet first"); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < MIN_WITHDRAWAL) { setWdError(`Minimum: ${MIN_WITHDRAWAL} TON`); return; }
    if (amt > tonBalance) { setWdError("Insufficient TON balance"); return; }
    setSubmitting(true);
    try {
      await api.requestWithdrawal({ userId: user.id, amount, walletAddress: savedWallet });
      invalidateUserCaches(user.id);
      setSuccess(true); setAmount("");
      await refresh();
      getWithdrawalsOnce(user.id).then(setHistory).catch(() => {});
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setWdError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally { setSubmitting(false); }
  };

  /* ─────────────────────────── RENDER ─────────────────────────── */
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeSlide { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .wallet-fade { animation: fadeSlide 0.22s ease; }
        .wallet-input::-webkit-inner-spin-button,
        .wallet-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .wallet-input { -moz-appearance: textfield; }
        @keyframes botBounce {
          0%   { transform: translateY(0)    scale(1);    }
          20%  { transform: translateY(-18px) scale(1.06); }
          40%  { transform: translateY(0)    scale(0.97); }
          55%  { transform: translateY(-9px)  scale(1.03); }
          70%  { transform: translateY(0)    scale(0.99); }
          85%  { transform: translateY(-4px)  scale(1.01); }
          100% { transform: translateY(0)    scale(1);    }
        }
        .bot-bounce { animation: botBounce 1.4s ease-in-out infinite; }
      `}</style>

      {/* ══ HEADER ══ */}
      <div style={{
        flexShrink: 0,
        padding: "max(env(safe-area-inset-top,0px),14px) 16px 0",
        background: "linear-gradient(180deg, rgba(4,6,28,0.92) 0%, rgba(4,6,28,0.70) 100%)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setLocation("/")} style={{
            width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.08)", cursor: "pointer", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(8px)",
          }}>
            <ChevronLeft size={17} color="#fff" />
          </button>
          <div>
            <div style={{ color: "#fff", fontSize: 19, fontWeight: 900, fontStyle: "italic", letterSpacing: -0.3 }}>My Wallet</div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, marginTop: 1 }}>Manage your funds</div>
          </div>
        </div>

        {/* Balance cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {/* USDT card */}
          <div style={{
            borderRadius: 20, padding: "14px 16px",
            background: "linear-gradient(135deg, rgba(38,161,123,0.30) 0%, rgba(15,60,45,0.65) 100%)",
            border: "1px solid rgba(38,200,150,0.30)",
            boxShadow: "0 4px 20px rgba(38,161,123,0.18), inset 0 1px 0 rgba(255,255,255,0.08)",
            backdropFilter: "blur(16px)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <UsdtLogo size={28} />
              <span style={{ color: "rgba(255,255,255,0.50)", fontSize: 9, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>USDT</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: 22, letterSpacing: -0.5, lineHeight: 1 }}>{usdtBalance.toFixed(2)}</div>
              <UsdtLogo size={22} />
            </div>
            <div style={{ color: "rgba(255,255,255,0.30)", fontSize: 9, marginTop: 4 }}>
              {tonPrice ? `≈ ${(usdtBalance / tonPrice).toFixed(3)} TON` : "—"}
            </div>
          </div>
          {/* TON card */}
          <div style={{
            borderRadius: 20, padding: "14px 16px",
            background: "linear-gradient(135deg, rgba(0,152,234,0.30) 0%, rgba(0,40,80,0.65) 100%)",
            border: "1px solid rgba(0,180,255,0.28)",
            boxShadow: "0 4px 20px rgba(0,152,234,0.18), inset 0 1px 0 rgba(255,255,255,0.08)",
            backdropFilter: "blur(16px)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <TonLogo size={28} />
              <span style={{ color: "rgba(255,255,255,0.50)", fontSize: 9, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>TON</span>
            </div>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: 22, letterSpacing: -0.5, lineHeight: 1 }}>{tonBalance.toFixed(4)}</div>
            <div style={{ color: "rgba(255,255,255,0.30)", fontSize: 9, marginTop: 4 }}>
              {tonPrice ? `≈ $${(tonBalance * tonPrice).toFixed(2)} USD` : "—"}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          background: "rgba(255,255,255,0.05)", borderRadius: 18, padding: 5,
          border: "1px solid rgba(255,255,255,0.07)",
          marginBottom: 0,
        }}>
          {(["swap", "withdraw"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "10px 0", borderRadius: 14, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontWeight: 800, fontSize: 13, letterSpacing: 0.2,
              transition: "all 0.20s cubic-bezier(0.34,1.56,0.64,1)",
              background: tab === t
                ? t === "swap"
                  ? "linear-gradient(135deg, #7c3aed, #4f46e5)"
                  : "linear-gradient(135deg, #0098EA, #0055a5)"
                : "transparent",
              color: tab === t ? "#fff" : "rgba(255,255,255,0.38)",
              boxShadow: tab === t ? "0 4px 18px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
              {t === "swap" ? <ArrowDownUp size={13} /> : <Send size={13} />}
              {t === "swap" ? "Swap" : "Withdraw"}
            </button>
          ))}
        </div>
      </div>

      {/* ══ CONTENT ══ */}
      <div style={{
        flex: 1, overflowY: "auto", overflowX: "hidden",
        WebkitOverflowScrolling: "touch" as never,
        padding: "16px 16px 36px",
        background: "rgba(4,6,28,0.55)",
        backdropFilter: "blur(10px)",
      }}>

        {/* ══════════════ SWAP TAB ══════════════ */}
        {tab === "swap" && (
          <div className="wallet-fade" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Swap card */}
            <div style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 20, overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            }}>
              {/* You send */}
              <div style={{ padding: "16px 16px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5 }}>You send</span>
                  <span style={{
                    background: "rgba(38,161,123,0.15)", border: "1px solid rgba(38,161,123,0.28)",
                    borderRadius: 8, padding: "2px 8px",
                    color: "#34d399", fontSize: 9, fontWeight: 800,
                  }}>Balance: {usdtBalance.toFixed(2)} USDT</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    className="wallet-input"
                    type="number" value={swapAmount}
                    onChange={e => setSwapAmount(e.target.value)}
                    placeholder="0.00" step="0.01" min={0.01} max={usdtBalance}
                    disabled={!canSwap}
                    style={{
                      flex: 1, background: "none", border: "none", outline: "none",
                      color: swapAmtNum > 0 ? "#fff" : "rgba(255,255,255,0.25)",
                      fontSize: 30, fontWeight: 900, fontFamily: "inherit", letterSpacing: -1,
                    }}
                  />
                  <div style={{
                    display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                    background: "rgba(38,161,123,0.12)", border: "1px solid rgba(38,161,123,0.25)",
                    borderRadius: 12, padding: "6px 10px",
                  }}>
                    <UsdtLogo size={20} />
                    <span style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>USDT</span>
                  </div>
                </div>
              </div>

              {/* Arrow divider */}
              <div style={{ position: "relative", height: 1, background: "rgba(255,255,255,0.06)", margin: "0 16px" }}>
                <div style={{
                  position: "absolute", left: "50%", top: "50%",
                  transform: "translate(-50%,-50%)",
                  width: 28, height: 28, borderRadius: "50%",
                  background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                  border: "2px solid rgba(4,6,28,0.8)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 12px rgba(124,58,237,0.55)",
                  zIndex: 1,
                }}>
                  <ArrowDownUp size={12} color="#fff" />
                </div>
              </div>

              {/* You receive */}
              <div style={{ padding: "12px 16px 16px" }}>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5 }}>You receive</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    flex: 1, color: tonEquiv ? "#7ad7ff" : "rgba(255,255,255,0.20)",
                    fontSize: 30, fontWeight: 900, letterSpacing: -1,
                  }}>
                    {tonEquiv ?? "0.00"}
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                    background: "rgba(0,152,234,0.12)", border: "1px solid rgba(0,152,234,0.25)",
                    borderRadius: 12, padding: "6px 10px",
                  }}>
                    <TonLogo size={20} />
                    <span style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>TON</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Presets */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
              {[0.1, 0.5, 1, usdtBalance].map((p, i) => {
                const isMax = i === 3;
                const disabled = p <= 0 || p > usdtBalance;
                const isSelected = swapAmtNum === p;
                return (
                  <button key={i} type="button" disabled={disabled}
                    onClick={() => setSwapAmount(p.toFixed(isMax ? 2 : 1))}
                    style={{
                      padding: "9px 4px", borderRadius: 12, fontFamily: "inherit",
                      background: isSelected
                        ? "linear-gradient(135deg,#7c3aed,#4f46e5)"
                        : isMax
                          ? "rgba(124,58,237,0.14)"
                          : "rgba(255,255,255,0.05)",
                      border: isSelected
                        ? "1px solid rgba(124,58,237,0.6)"
                        : isMax
                          ? "1px solid rgba(124,58,237,0.30)"
                          : "1px solid rgba(255,255,255,0.08)",
                      color: isSelected ? "#fff" : isMax ? "#c4b5fd" : "rgba(255,255,255,0.55)",
                      fontSize: 12, fontWeight: 800,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.32 : 1,
                      boxShadow: isSelected ? "0 2px 10px rgba(124,58,237,0.35)" : "none",
                    }}>
                    {isMax ? "MAX" : p}
                  </button>
                );
              })}
            </div>

            {/* Feedback */}
            {swapResult && (
              <div style={{
                borderRadius: 14, padding: "12px 16px",
                background: "linear-gradient(135deg,rgba(16,185,129,0.15),rgba(6,78,59,0.20))",
                border: "1px solid rgba(16,185,129,0.32)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(16,185,129,0.20)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <CheckCircle size={16} color="#34d399" />
                </div>
                <div>
                  <div style={{ color: "#34d399", fontSize: 13, fontWeight: 800 }}>Swap successful!</div>
                  <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 1 }}>
                    +{swapResult.tonAmount} TON @ ${swapResult.tonPrice.toFixed(2)}
                  </div>
                </div>
              </div>
            )}
            {swapError && (
              <div style={{
                borderRadius: 12, padding: "10px 14px",
                background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)",
                color: "#fca5a5", fontSize: 12, fontWeight: 600,
              }}>{swapError}</div>
            )}

            {/* CTA */}
            <button onClick={handleSwap} disabled={!canSwap || usdtBalance <= 0}
              style={{
                width: "100%", padding: "16px", borderRadius: 18, border: "none",
                background: canSwap && usdtBalance > 0
                  ? "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)"
                  : "rgba(255,255,255,0.05)",
                color: canSwap && usdtBalance > 0 ? "#fff" : "rgba(255,255,255,0.22)",
                fontSize: 15, fontWeight: 800, fontFamily: "inherit",
                cursor: canSwap && usdtBalance > 0 ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                boxShadow: canSwap && usdtBalance > 0 ? "0 8px 28px rgba(124,58,237,0.45)" : "none",
                opacity: swapping ? 0.65 : 1,
                letterSpacing: 0.3,
              }}>
              {swapping
                ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Converting…</>
                : <><ArrowDownUp size={15} /> Swap USDT → TON</>}
            </button>

            {/* Hint */}
            <div style={{
              borderRadius: 14, padding: "10px 14px",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.30)", fontSize: 11, lineHeight: 1.6,
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>💡</span>
              <span>Swapped TON is added to your TON balance and ready to withdraw to your wallet.</span>
            </div>
          </div>
        )}

        {/* ══════════════ WITHDRAW TAB ══════════════ */}
        {tab === "withdraw" && (
          <div className="wallet-fade" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Wallet connect card */}
            <div style={{
              borderRadius: 20, padding: "14px 16px",
              background: savedWallet
                ? "linear-gradient(135deg, rgba(16,185,129,0.14), rgba(6,40,30,0.60))"
                : "linear-gradient(135deg, rgba(0,152,234,0.14), rgba(0,20,50,0.60))",
              border: savedWallet ? "1px solid rgba(52,211,153,0.28)" : "1px solid rgba(0,152,234,0.25)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.20)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 14, flexShrink: 0,
                  background: savedWallet ? "rgba(52,211,153,0.18)" : "rgba(0,152,234,0.18)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: savedWallet ? "1px solid rgba(52,211,153,0.30)" : "1px solid rgba(0,152,234,0.28)",
                }}>
                  <Wallet size={20} color={savedWallet ? "#34d399" : "#38bdf8"} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 9, textTransform: "uppercase", letterSpacing: 1.8, marginBottom: 3, fontWeight: 700 }}>
                    {savedWallet ? "Connected Wallet" : "TON Wallet"}
                  </div>
                  <div style={{ color: "#fff", fontWeight: 800, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {savedWallet ? maskWallet(savedWallet) : "Not connected"}
                  </div>
                </div>
                {connectedAddress ? (
                  <button type="button" onClick={async () => {
                    try { await new Promise(r => setTimeout(r, 80)); await tonConnectUI.disconnect(); } catch { }
                  }} style={{
                    padding: "7px 12px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.30)",
                    background: "rgba(248,113,113,0.10)", color: "#fca5a5",
                    fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <X size={11} /> Disconnect
                  </button>
                ) : (
                  <button type="button" onClick={async () => {
                    try { reopenAfterConnect.current = true; await new Promise(r => setTimeout(r, 80)); await tonConnectUI.openModal(); } catch { }
                  }} style={{
                    padding: "8px 14px", borderRadius: 11, border: "none",
                    background: "linear-gradient(135deg,#0098EA,#005fa3)", color: "#fff",
                    fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                    flexShrink: 0, display: "flex", alignItems: "center", gap: 7,
                    boxShadow: "0 4px 14px rgba(0,152,234,0.45)",
                  }}>
                    <svg width="14" height="14" viewBox="0 0 56 56" fill="none">
                      <circle cx="28" cy="28" r="28" fill="#0098EA"/>
                      <path d="M37.56 15.63H18.44c-3.52 0-5.75 3.78-3.96 6.82l11.73 19.73c.9 1.52 3.05 1.52 3.95 0L41.87 22.45c1.79-3.04-.44-6.82-4.31-6.82z" fill="white"/>
                    </svg>
                    Connect
                  </button>
                )}
              </div>
              {syncing && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, color: "#fbbf24", fontSize: 11 }}>
                  <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Saving wallet address…
                </div>
              )}
              {syncDone && !syncing && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, color: "#34d399", fontSize: 11 }}>
                  <CheckCircle size={12} /> Wallet linked successfully
                </div>
              )}
            </div>

            {/* Success state */}
            {success ? (
              <div style={{
                borderRadius: 20, padding: "28px 20px",
                background: "linear-gradient(135deg,rgba(16,185,129,0.14),rgba(6,40,30,0.55))",
                border: "1px solid rgba(52,211,153,0.28)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center",
              }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(52,211,153,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CheckCircle size={28} color="#34d399" />
                </div>
                <div>
                  <div style={{ color: "#34d399", fontSize: 16, fontWeight: 900 }}>Withdrawal Requested!</div>
                  <div style={{ color: "rgba(255,255,255,0.40)", fontSize: 12, marginTop: 4 }}>We'll process it shortly</div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleWithdraw} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Amount card */}
                <div style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
                  borderRadius: 20, padding: "16px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5 }}>Amount</span>
                    <span style={{
                      background: "rgba(0,152,234,0.14)", border: "1px solid rgba(0,152,234,0.26)",
                      borderRadius: 8, padding: "2px 8px",
                      color: "#38bdf8", fontSize: 9, fontWeight: 800,
                    }}>Available: {tonBalance.toFixed(4)} TON</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      className="wallet-input"
                      type="number" value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00" step="0.01" min={MIN_WITHDRAWAL} max={tonBalance}
                      disabled={!canWithdraw || submitting}
                      style={{
                        flex: 1, background: "none", border: "none", outline: "none",
                        color: amtNum > 0 ? "#fff" : "rgba(255,255,255,0.22)",
                        fontSize: 30, fontWeight: 900, fontFamily: "inherit", letterSpacing: -1,
                      }}
                    />
                    <div style={{
                      display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                      background: "rgba(0,152,234,0.12)", border: "1px solid rgba(0,152,234,0.25)",
                      borderRadius: 12, padding: "6px 10px",
                    }}>
                      <TonLogo size={20} />
                      <span style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>TON</span>
                    </div>
                  </div>
                  {amtNum > 0 && tonPrice && (
                    <div style={{ color: "rgba(255,255,255,0.30)", fontSize: 10, marginTop: 8 }}>
                      ≈ ${(amtNum * tonPrice).toFixed(2)} USD
                    </div>
                  )}
                </div>

                {/* Presets */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                  {[0.1, 0.5, 1, tonBalance].map((p, i) => {
                    const isMax = i === 3;
                    const disabled = !canWithdraw || p > tonBalance || p < MIN_WITHDRAWAL || submitting;
                    const isSelected = amtNum === p;
                    return (
                      <button key={i} type="button" disabled={disabled}
                        onClick={() => setAmount(p.toFixed(isMax ? 4 : 1))}
                        style={{
                          padding: "9px 4px", borderRadius: 12, fontFamily: "inherit",
                          background: isSelected
                            ? "linear-gradient(135deg,#0098EA,#005fa3)"
                            : isMax ? "rgba(0,152,234,0.12)" : "rgba(255,255,255,0.05)",
                          border: isSelected
                            ? "1px solid rgba(0,152,234,0.55)"
                            : isMax ? "1px solid rgba(0,152,234,0.28)" : "1px solid rgba(255,255,255,0.08)",
                          color: isSelected ? "#fff" : isMax ? "#38bdf8" : "rgba(255,255,255,0.50)",
                          fontSize: 12, fontWeight: 800,
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.30 : 1,
                          boxShadow: isSelected ? "0 2px 10px rgba(0,152,234,0.35)" : "none",
                        }}>
                        {isMax ? "MAX" : p}
                      </button>
                    );
                  })}
                </div>

                {wdError && (
                  <div style={{
                    borderRadius: 12, padding: "10px 14px",
                    background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)",
                    color: "#fca5a5", fontSize: 12, fontWeight: 600,
                  }}>{wdError}</div>
                )}

                <button type="submit" disabled={!canWithdraw || submitting}
                  style={{
                    width: "100%", padding: "16px", borderRadius: 18, border: "none",
                    background: canWithdraw
                      ? "linear-gradient(135deg, #0098EA 0%, #005fa3 100%)"
                      : "rgba(255,255,255,0.05)",
                    color: canWithdraw ? "#fff" : "rgba(255,255,255,0.22)",
                    fontSize: 15, fontWeight: 800, fontFamily: "inherit",
                    cursor: canWithdraw && !submitting ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                    boxShadow: canWithdraw ? "0 8px 28px rgba(0,152,234,0.40)" : "none",
                    opacity: submitting ? 0.65 : 1,
                    letterSpacing: 0.3,
                  }}>
                  {submitting
                    ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Submitting…</>
                    : <><Send size={15} /> {savedWallet ? "Withdraw TON" : "Connect wallet first"}</>}
                </button>

                {!canWithdraw && (
                  <div style={{
                    borderRadius: 14, padding: "10px 14px",
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.28)", fontSize: 11, textAlign: "center", lineHeight: 1.6,
                  }}>
                    Swap USDT → TON first to get a withdrawable balance
                  </div>
                )}
              </form>
            )}

            {/* History */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginTop: 6,
            }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
              <span style={{ color: "rgba(255,255,255,0.30)", fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>History</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
            </div>

            {historyLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px 0", color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
                <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Loading…
              </div>
            ) : history.length === 0 ? (
              <div style={{
                textAlign: "center", padding: "20px 0",
                background: "rgba(255,255,255,0.02)", borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.20)", fontSize: 12,
              }}>No withdrawal history yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map(w => (
                  <div key={w.id} style={{
                    padding: "12px 14px", borderRadius: 16,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <TonLogo size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>{parseFloat(w.amount).toFixed(4)} <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 700, fontSize: 11 }}>TON</span></div>
                      <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {maskWallet(w.walletAddress)}
                      </div>
                    </div>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                      background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "4px 8px",
                      border: `1px solid ${statusColor(w.status)}30`,
                    }}>
                      {statusIcon(w.status)}
                      <span style={{ fontSize: 10, fontWeight: 800, color: statusColor(w.status) }}>
                        {statusLabel(w.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
