import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useUser } from "../lib/userContext";
import { api, invalidateUserCaches } from "../lib/api";
import { useTonAddress, useTonConnectUI, TonConnectButton } from "@tonconnect/ui-react";
import { Wallet, Send, CheckCircle, ArrowLeft } from "lucide-react";

const MAX_WITHDRAWAL = 10000;

function maskWallet(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "•••••" + addr.slice(-5);
}


export default function WithdrawPage() {
  const { user, refresh } = useUser();
  const [, navigate] = useLocation();
  const [minWithdrawal, setMinWithdrawal] = useState(0.1);

  useEffect(() => {
    api.getConfig().then(cfg => {
      if (cfg.minWithdrawal && cfg.minWithdrawal > 0) setMinWithdrawal(cfg.minWithdrawal);
    }).catch(() => {});
  }, []);

  useTonConnectUI();
  const connectedAddress = useTonAddress();
  const prevAddressRef = useRef<string>("");

  const [syncing, setSyncing]   = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  useEffect(() => {
    if (!user) return;
    const prev = prevAddressRef.current;
    prevAddressRef.current = connectedAddress;

    if (connectedAddress && connectedAddress !== user.savedWalletAddress) {
      setSyncing(true);
      api.saveWallet(user.id, connectedAddress)
        .then(() => refresh())
        .then(() => { setSyncDone(true); setTimeout(() => setSyncDone(false), 3000); })
        .catch(() => {})
        .finally(() => setSyncing(false));
    } else if (!connectedAddress && prev && user.savedWalletAddress) {
      api.saveWallet(user.id, "").then(() => refresh()).catch(() => {});
    }
  }, [connectedAddress, user?.id]);

  const [amount, setAmount]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]       = useState(false);
  const [error, setError]           = useState("");


  const balance     = parseFloat(user?.balance || "0");
  const canWithdraw = balance >= minWithdrawal;
  const savedWallet = user?.savedWalletAddress ?? null;

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || submitting || !savedWallet) return;
    setError(""); setSuccess(false);
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < minWithdrawal) { setError(`Minimum withdrawal: ${minWithdrawal} TON`); return; }
    if (amt > MAX_WITHDRAWAL) { setError(`Maximum withdrawal: ${MAX_WITHDRAWAL} TON`); return; }
    if (amt > balance) { setError("Insufficient balance"); return; }
    setSubmitting(true);
    try {
      await api.requestWithdrawal({ userId: user.id, amount, walletAddress: savedWallet });
      invalidateUserCaches(user.id);
      setSuccess(true); setAmount("");
      await refresh();
      setTimeout(() => setSuccess(false), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Withdrawal request failed");
    } finally {
      setSubmitting(false);
    }
  };

  const maxAllowed = Math.min(balance, MAX_WITHDRAWAL);
  const presets = [minWithdrawal, 0.5, 1.0, maxAllowed];

  return (
    <div className="page-content px-3 pt-3 flex flex-col gap-3">

      {/* ── Header with back button ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 2px" }}>
        <button
          onClick={() => navigate("/account")}
          style={{
            width: 38, height: 38, borderRadius: 12,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
            backdropFilter: "blur(14px)",
          }}
        >
          <ArrowLeft size={18} color="#fff" />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ color: "#fff", fontWeight: 900, fontSize: 18, margin: 0, letterSpacing: -0.3 }}>
            Withdraw TON
          </h1>
          <p style={{ color: "rgba(255,255,255,0.40)", fontSize: 11, margin: "1px 0 0" }}>
            Send your earnings to your wallet
          </p>
        </div>
      </div>

      {/* ── Wallet card ── */}
      <div className="slide-up" style={{
        padding: "14px",
        borderRadius: 18,
        background: savedWallet
          ? "linear-gradient(145deg, rgba(16,185,129,0.10), rgba(8,6,22,0.78))"
          : "linear-gradient(145deg, rgba(0,115,230,0.12), rgba(8,6,22,0.78))",
        border: savedWallet ? "1px solid rgba(16,185,129,0.32)" : "1px solid rgba(0,115,230,0.28)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 4px 18px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
            background: savedWallet ? "rgba(16,185,129,0.18)" : "rgba(0,115,230,0.18)",
            border: savedWallet ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(0,115,230,0.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: savedWallet ? "0 0 10px rgba(16,185,129,0.18)" : "0 0 10px rgba(0,115,230,0.15)",
          }}>
            <Wallet size={15} color={savedWallet ? "#34d399" : "#60a5fa"} />
          </div>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 14, flex: 1 }}>
            {savedWallet ? "Connected Wallet" : "Connect TON Wallet"}
          </span>
          <style>{`
            tc-root { display: inline-flex !important; }
            tc-button { display: inline-flex !important; }
            tc-button button { border-radius: 12px !important; font-size: 13px !important; font-weight: 800 !important; padding: 8px 14px !important; white-space: nowrap !important; }
          `}</style>
          <TonConnectButton />
        </div>

        {savedWallet && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginTop: 10,
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.22)",
            borderRadius: 12, padding: "9px 11px",
          }}>
            <Wallet size={12} color="#34d399" style={{ flexShrink: 0 }} />
            <span style={{ color: "#34d399", fontSize: 11.5, fontFamily: "monospace", direction: "ltr", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {maskWallet(savedWallet)}
            </span>
            <CheckCircle size={13} color="#34d399" style={{ flexShrink: 0 }} />
          </div>
        )}

        {syncing && (
          <div style={{
            marginTop: 9, background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 10, padding: "8px 11px",
            color: "#fbbf24", fontSize: 11.5, textAlign: "center",
          }}>
            Saving wallet...
          </div>
        )}
        {syncDone && !syncing && (
          <div style={{
            marginTop: 9, background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.30)",
            borderRadius: 10, padding: "8px 11px",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <CheckCircle size={13} color="#34d399" />
            <span style={{ color: "#34d399", fontSize: 11.5 }}>Wallet linked successfully</span>
          </div>
        )}
      </div>

      {/* ── Withdrawal form ── */}
      <div className="slide-up" style={{
        padding: "14px",
        borderRadius: 18,
        background: "linear-gradient(145deg, rgba(20,16,42,0.65), rgba(8,6,22,0.78))",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 4px 18px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "linear-gradient(135deg, rgba(251,191,36,0.25), rgba(245,158,11,0.10))",
            border: "1px solid rgba(251,191,36,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 12px rgba(251,191,36,0.18)",
          }}>
            <Send size={14} color="#fbbf24" />
          </div>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>Request Withdrawal</span>
          <span style={{
            marginLeft: "auto",
            background: canWithdraw ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${canWithdraw ? "rgba(16,185,129,0.32)" : "rgba(255,255,255,0.10)"}`,
            color: canWithdraw ? "#34d399" : "rgba(255,255,255,0.32)",
            fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
          }}>
            {canWithdraw ? "Eligible" : `Min ${minWithdrawal}`}
          </span>
        </div>

        {!savedWallet ? (
          <div style={{ textAlign: "center", padding: "26px 10px" }}>
            <Wallet size={32} style={{ color: "rgba(255,255,255,0.14)", marginBottom: 8 }} />
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 12.5, margin: 0, fontWeight: 600 }}>
              Connect a TON wallet first
            </p>
            <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 10.5, marginTop: 4 }}>
              Tap "Connect Wallet" above
            </p>
          </div>
        ) : (
          <>
            {success && (
              <div style={{
                background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.32)",
                borderRadius: 12, padding: "10px 12px", marginBottom: 12,
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <CheckCircle size={14} color="#34d399" />
                <span style={{ color: "#34d399", fontSize: 12, fontWeight: 600 }}>Withdrawal request submitted!</span>
              </div>
            )}

            <form onSubmit={handleWithdraw} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <div>
                <label style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, display: "block", marginBottom: 7, fontWeight: 700 }}>
                  Amount (TON)
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type="number" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`${minWithdrawal}`}
                    step="any"
                    disabled={!canWithdraw || submitting}
                    className="ton-input" style={{ paddingRight: 56, fontSize: 18, fontWeight: 800 }}
                  />
                  <span style={{
                    position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                    color: "rgba(251,191,36,0.65)", fontSize: 13, fontWeight: 800, pointerEvents: "none",
                  }}>TON</span>
                </div>
              </div>

              {/* Quick presets */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {presets.map((p, i) => {
                  const v = p > 0 ? p : 0;
                  const disabled = !canWithdraw || submitting || v > balance || v < minWithdrawal || v > MAX_WITHDRAWAL;
                  const isMax = i === presets.length - 1;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled}
                      onClick={() => setAmount(v.toFixed(isMax ? 2 : 2))}
                      style={{
                        padding: "8px 4px", borderRadius: 10,
                        background: isMax
                          ? "linear-gradient(135deg, rgba(251,191,36,0.18), rgba(245,158,11,0.06))"
                          : "rgba(255,255,255,0.05)",
                        border: isMax ? "1px solid rgba(251,191,36,0.35)" : "1px solid rgba(255,255,255,0.10)",
                        color: isMax ? "#fbbf24" : "rgba(255,255,255,0.70)",
                        fontSize: 11, fontWeight: 800,
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.4 : 1,
                        fontFamily: "inherit",
                      }}
                    >
                      {isMax ? "MAX" : v}
                    </button>
                  );
                })}
              </div>

              {error && (
                <div style={{
                  background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.28)",
                  borderRadius: 10, padding: "9px 11px", color: "#fca5a5", fontSize: 12, fontWeight: 600,
                }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={!canWithdraw || submitting}
                style={{
                  width: "100%", padding: "14px", borderRadius: 14,
                  fontSize: 14, fontWeight: 800, border: "none",
                  cursor: canWithdraw && !submitting ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  background: canWithdraw
                    ? "linear-gradient(135deg, #fde68a, #fbbf24, #f59e0b)"
                    : "rgba(255,255,255,0.06)",
                  color: canWithdraw ? "#0a0600" : "rgba(255,255,255,0.30)",
                  boxShadow: canWithdraw ? "0 6px 22px rgba(251,191,36,0.40)" : "none",
                  opacity: submitting ? 0.65 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  transition: "all 0.2s",
                }}>
                <Send size={14} />
                {submitting ? "Submitting..." : "Request Withdrawal"}
              </button>
            </form>
          </>
        )}
      </div>

    </div>
  );
}
