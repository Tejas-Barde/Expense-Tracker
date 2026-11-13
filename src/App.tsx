import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./lib/auth";
import { ConfirmProvider, useConfirm } from "./components/Confirm";
import Modal from "./components/Modal";
import Auth from "./pages/Auth";
import Expenses from "./pages/Expenses";
import Dashboard from "./components/dashboard/Dashboard";
import ExpenseForm from "./components/forms/ExpenseForm";
import BudgetForm from "./components/forms/BudgetForm";
import CategoriesManager from "./components/forms/CategoriesManager";
import Owing from "./pages/Owing";
import Trips from "./pages/Trips";

const Icon = ({ d, extra }: { d: string; extra?: string }) => (
  <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />{extra && <path d={extra} />}
  </svg>
);
const NAV = [
  { to: "/", label: "Overview", short: "Overview", end: true, icon: <Icon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /> },
  { to: "/history", label: "Transactions", short: "Activity", icon: <Icon d="M8 6h13M8 12h13M8 18h13" extra="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /> },
  { to: "/owing", label: "Balances", short: "Balances", icon: <Icon d="M7 7h13l-3.5-3.5M17 17H4l3.5 3.5" /> },
  { to: "/trips", label: "Trips", short: "Trips", icon: <Icon d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" extra="M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /> },
];

function Layout() {
  const { user, loading, logout } = useAuth();
  const confirm = useConfirm();
  const [modal, setModal] = useState<"expense" | "budget" | "category" | "more" | null>(null);
  if (loading) return <div className="grid min-h-dvh place-items-center text-sm text-mute" role="status">Loading your finances…</div>;
  if (!user) return <Navigate to="/login" replace />; // auth guard
  const link = ({ isActive }: { isActive: boolean }) => `min-h-11 px-3 py-2 rounded-lg flex items-center ${isActive ? "bg-accent/10 text-accent font-semibold" : "text-mute hover:bg-panel hover:text-text"}`;
  const mobileLink = ({ isActive }: { isActive: boolean }) => `min-w-0 min-h-14 flex flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 text-[10px] font-medium ${isActive ? "text-accent" : "text-mute"}`;
  const displayName = user.name?.trim() || "Your account";
  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const signOut = async () => {
    const ok = await confirm({ title: "Sign out?", message: "You will need to sign in again to see your finances.", confirmLabel: "Sign out" });
    if (ok) void logout();
  };
  const open = (next: "expense" | "budget" | "category") => setModal(next);
  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-panel/40 p-4 md:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="grid size-9 place-items-center rounded-xl bg-accent text-sm font-bold text-white">L</div>
          <div><h1 className="font-bold tracking-tight">Ledgerly</h1><p className="text-xs text-mute">Personal finance</p></div>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Main navigation">
          {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={link}>{item.label}</NavLink>)}
        </nav>
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <button className="btn-ghost w-full text-left" onClick={() => open("budget")}>Budget and salary</button>
          <button className="btn-ghost w-full text-left" onClick={() => open("category")}>Categories</button>
        </div>
        <button className="mt-auto flex min-h-14 items-center gap-3 rounded-xl px-2 text-left hover:bg-panel" onClick={signOut}>
          <span className="grid size-9 place-items-center rounded-full bg-line text-xs font-bold text-text">{initials}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{displayName}</span><span className="block text-xs text-mute">Sign out</span></span>
        </button>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-mute">This month</p>
            <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
          </div>
          <button className="btn hidden shrink-0 shadow-lg shadow-accent/10 md:block" onClick={() => open("expense")}>Add transaction</button>
        </div>
        <Outlet />
      </main>

      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 items-end border-t border-line bg-panel/95 px-1 pt-1.5 pb-[calc(.4rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {NAV.slice(0, 2).map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={mobileLink}>{item.icon}{item.short}</NavLink>)}
        <button type="button" aria-label="Add transaction" onClick={() => open("expense")} className="mx-auto -mt-5 mb-1 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg shadow-black/40 ring-4 ring-ink active:scale-95">
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        {NAV.slice(2).map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={mobileLink}>{item.icon}{item.short}</NavLink>)}
        <button type="button" className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 text-[10px] font-medium text-mute" onClick={() => setModal("more")}>
          <Icon d="M5 12h.01M12 12h.01M19 12h.01" />More
        </button>
      </nav>

      {modal === "expense" && <ExpenseForm onClose={() => setModal(null)} />}
      {modal === "budget" && <BudgetForm onClose={() => setModal(null)} />}
      {modal === "category" && <CategoriesManager onClose={() => setModal(null)} />}
      {modal === "more" && (
        <Modal title="More" onClose={() => setModal(null)}>
          <div className="space-y-2">
            <button type="button" className="btn-ghost w-full text-left" onClick={() => open("budget")}>Budget and salary</button>
            <button type="button" className="btn-ghost w-full text-left" onClick={() => open("category")}>Categories</button>
            <button type="button" className="btn-ghost w-full text-left text-red-300" onClick={() => { setModal(null); void signOut(); }}>Sign out ({displayName})</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
export default function App() {
  return (
    <QueryClientProvider client={qc}><AuthProvider><ConfirmProvider><BrowserRouter>
      <Routes><Route path="/login" element={<Auth />} />
        <Route element={<Layout />}><Route index element={<Dashboard />} /><Route path="history" element={<Expenses />} /><Route path="expenses" element={<Expenses />} /><Route path="owing" element={<Owing />} /><Route path="trips" element={<Trips />} /></Route></Routes>
      <Toaster theme="dark" richColors closeButton position="top-center" toastOptions={{ style: { fontFamily: "inherit" } }} />
    </BrowserRouter></ConfirmProvider></AuthProvider></QueryClientProvider>
  );
}
