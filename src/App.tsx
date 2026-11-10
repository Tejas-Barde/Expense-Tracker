import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./lib/auth";
import Auth from "./pages/Auth";
import Expenses from "./pages/Expenses";
import Dashboard from "./components/dashboard/Dashboard";
import ExpenseForm from "./components/forms/ExpenseForm";
import BudgetForm from "./components/forms/BudgetForm";
import CategoryForm from "./components/forms/CategoryForm";
import Owing from "./pages/Owing";
import Trips from "./pages/Trips";

function Layout() {
  const { user, loading, logout } = useAuth();
  const [modal, setModal] = useState<"expense" | "budget" | "category" | null>(null);
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />; // auth guard
  const link = ({ isActive }: { isActive: boolean }) => `min-h-11 px-3 py-2 rounded-lg flex items-center ${isActive ? "bg-accent/10 text-accent font-semibold" : "text-mute hover:bg-panel hover:text-text"}`;
  const mobileLink = ({ isActive }: { isActive: boolean }) => `min-w-0 min-h-11 grid place-items-center text-center px-1 py-2 rounded-lg ${isActive ? "bg-ink text-accent" : "text-mute"}`;
  const displayName = user.name?.trim() || "Account";
  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden md:flex flex-col w-60 p-4 border-r border-line bg-panel/40 sticky top-0 h-screen">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="grid size-9 place-items-center rounded-xl bg-accent text-sm font-bold text-white">L</div>
          <div><h1 className="font-bold tracking-tight">Ledgerly</h1><p className="text-xs text-mute">Personal finance</p></div>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Main navigation">
          <NavLink to="/" end className={link}>Overview</NavLink>
          <NavLink to="/history" className={link}>Transactions</NavLink>
          <NavLink to="/owing" className={link}>Balances</NavLink>
          <NavLink to="/trips" className={link}>Trips</NavLink>
        </nav>
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <button className="btn-ghost w-full text-left" onClick={() => setModal("budget")}>Manage budget</button>
          <button className="btn-ghost w-full text-left" onClick={() => setModal("category")}>Add category</button>
        </div>
        <button className="mt-auto flex min-h-14 items-center gap-3 rounded-xl px-2 text-left hover:bg-panel"
          onClick={() => { if (window.confirm("Log out of Ledgerly?")) void logout(); }}>
          <span className="grid size-9 place-items-center rounded-full bg-line text-xs font-bold text-text">{initials}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{displayName}</span><span className="block text-xs text-mute">Log out</span></span>
        </button>
      </aside>
      <main className="mx-auto min-w-0 w-full max-w-5xl flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
          <div><p className="text-xs font-medium uppercase tracking-wider text-mute">Ledgerly</p><h2 className="text-xl sm:text-2xl font-bold tracking-tight">{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2></div>
          <button className="btn shrink-0 shadow-lg shadow-accent/10" onClick={() => setModal("expense")}>New transaction</button>
        </div>
        <Outlet />
      </main>
      <nav aria-label="Main navigation" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/95 backdrop-blur border-t border-line grid grid-cols-7 items-center px-1 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] text-[10px]">
        <NavLink to="/" end className={mobileLink}>Overview</NavLink>
        <NavLink to="/history" className={mobileLink}>Transactions</NavLink>
        <NavLink to="/owing" className={mobileLink}>Balances</NavLink>
        <NavLink to="/trips" className={mobileLink}>Trips</NavLink>
        <button className="min-w-0 min-h-11 px-1 py-2 text-mute" onClick={() => setModal("budget")}>Budget</button>
        <button className="min-w-0 min-h-11 px-1 py-2 text-mute" onClick={() => setModal("category")}>Category</button>
        <button className="min-w-0 min-h-11 px-1 py-2 text-mute"
          onClick={() => { if (window.confirm("Log out of Ledgerly?")) void logout(); }}>Log out</button>
      </nav>
      {modal === "expense" && <ExpenseForm onClose={() => setModal(null)} />}
      {modal === "budget" && <BudgetForm onClose={() => setModal(null)} />}
      {modal === "category" && <CategoryForm onClose={() => setModal(null)} />}
    </div>
  );
}
const qc = new QueryClient();
export default function App() {
  return (
    <QueryClientProvider client={qc}><AuthProvider><BrowserRouter>
      <Routes><Route path="/login" element={<Auth />} />
        <Route element={<Layout />}><Route index element={<Dashboard />} /><Route path="history" element={<Expenses />} /><Route path="expenses" element={<Expenses />} /><Route path="owing" element={<Owing />} /><Route path="trips" element={<Trips />} /></Route></Routes>
      <Toaster theme="dark" richColors position="top-right" />
    </BrowserRouter></AuthProvider></QueryClientProvider>
  );
}
