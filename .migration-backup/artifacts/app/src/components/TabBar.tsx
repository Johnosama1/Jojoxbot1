import { useLocation } from "wouter";
import { Home, ListTodo, Users, Wallet } from "lucide-react";
import { useWinModalOpen } from "../lib/winModal";

const tabs = [
  { path: "/",         icon: Home },
  { path: "/tasks",    icon: ListTodo },
  { path: "/referral", icon: Users },
  { path: "/wallet",   icon: Wallet },
];

export default function TabBar() {
  const [location, setLocation] = useLocation();
  const winModalOpen = useWinModalOpen();

  if (winModalOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "max(env(safe-area-inset-bottom, 0px), 12px)",
        left: 12,
        right: 12,
        zIndex: 50,
        height: 58,
        borderRadius: 999,
        background: "rgba(15,15,30,0.45)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        padding: "0 10px",
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active =
          location === tab.path ||
          (tab.path !== "/" && location.startsWith(tab.path));

        return (
          <button
            key={tab.path}
            onClick={() => setLocation(tab.path)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              height: "100%",
              outline: "none",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Icon
              size={22}
              color={active ? "#fbbf24" : "rgba(255,255,255,0.55)"}
              strokeWidth={active ? 2.4 : 1.8}
            />
          </button>
        );
      })}
    </div>
  );
}
