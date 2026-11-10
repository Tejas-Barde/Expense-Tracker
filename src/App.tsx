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
import CategoryForm from "./components/forms/CategoryForm";
import Owing from "./pages/Owing";
import Trips from "./pages/Trips";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/history", label: "Transactions" },
  { to: "/owing", label: "Balances" },
  { to: "/trips", label: "Trips" },
];

function Layout() {
  const { user, loading, logout } = useAuth();
  const confirm = useConfirm();
  const [modal, setModal] = useState<"expense" | "budget" | "category" | "more" | null>(null);
  if (loading) return <div className="grid min-h-dvh place-items-center text-sm text-mute" role="status">Loading your finances…</div>;
  if (!user) return <Navigate to="/login" replace />; // auth guard
  const link = ({ isActive }: { isActive: boolean }) => `min-h-11 px-3 py-2 rounded-lg flex items-center ${isActive ? "bg-accent/10 text-accent font-semibold" : "text-mute hover:bg-panel hover:text-text"}`;
  const mobileLink = ({ isActive }: { isActive: boolean }) => `min-w-0 min-h-12 grid place-items-center text-center px-1 py-2 rounded-lg text-[11px] font-medium ${isActive ? "bg-ink text-accent" : "text-mute"}`;
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
          <button className="btn-ghost w-full text-left" onClick={() => open("category")}>New category</button>
        </div>
        <button className="mt-auto flex min-h-14 items-center gap-3 rounded-xl px-2 text-left hover:bg-panel" onClick={signOut}>
          <span className="grid size-9 place-items-center rounded-full bg-line text-xs font-bold text-text">{initials}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{displayName}</span><span className="block text-xs text-mute">Sign out</span></span>
        </button>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-mute">This month</p>
            <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
          </div>
          <button className="btn hidden shrink-0 shadow-lg shadow-accent/10 md:block" onClick={() => open("expense")}>Add transaction</button>
        </div>
        <Outlet />
      </main>

      <button type="button" aria-label="Add transaction" onClick={() => open("expense")}
        className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-full bg-accent text-3xl font-light leading-none text-white shadow-xl shadow-black/40 active:scale-95 md:hidden">+</button>
      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-center gap-1 border-t border-line bg-panel/95 px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={mobileLink}>{item.label}</NavLink>)}
        <button type="button" className="min-h-12 min-w-0 px-1 py-2 text-[11px] font-medium text-mute" onClick={() => setModal("more")}>More</button>
      </nav>

      {modal === "expense" && <ExpenseForm onClose={() => setModal(null)} />}
      {modal === "budget" && <BudgetForm onClose={() => setModal(null)} />}
      {modal === "category" && <CategoryForm onClose={() => setModal(null)} />}
      {modal === "more" && (
        <Modal title="More" onClose={() => setModal(null)}>
          <div className="space-y-2">
            <button type="button" className="btn-ghost w-full text-left" onClick={() => open("budget")}>Budget and salary</button>
            <button type="button" className="btn-ghost w-full text-left" onClick={() => open("category")}>New category</button>
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
