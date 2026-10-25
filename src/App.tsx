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

function Layout() {
  const { user, loading, logout } = useAuth();
  const [modal, setModal] = useState<"expense" | "budget" | "category" | null>(null);
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />; // auth guard
  const link = ({ isActive }: { isActive: boolean }) => `px-3 py-2 rounded-lg ${isActive ? "bg-panel text-accent" : "text-mute"}`;
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden md:flex flex-col gap-2 w-56 p-4 border-r border-line sticky top-0 h-screen">
        <h1 className="text-xl font-bold mb-4">Ledgerly</h1>
        <NavLink to="/" end className={link}>Dashboard</NavLink><NavLink to="/expenses" className={link}>Expenses</NavLink>
        <button className="btn-ghost mt-4" onClick={() => setModal("budget")}>Budget</button>
        <button className="btn-ghost" onClick={() => setModal("category")}>New category</button>
        <button className="mt-auto text-mute text-sm text-left" onClick={logout}>Log out ({user.name})</button>
      </aside>
      <main className="mx-auto min-w-0 w-full max-w-5xl flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
          <h2 className="text-xl sm:text-2xl font-bold">{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
          <button className="btn shrink-0" onClick={() => setModal("expense")}>Add expense</button>
        </div>
        <Outlet />
      </main>
      <nav aria-label="Main navigation" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-panel/95 backdrop-blur border-t border-line grid grid-cols-5 items-center px-1 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] text-[11px]">
        <NavLink to="/" end className={({ isActive }) => `min-w-0 min-h-11 grid place-items-center text-center px-1 py-2 rounded-lg ${isActive ? "bg-ink text-accent" : "text-mute"}`}>Dashboard</NavLink>
        <NavLink to="/expenses" className={({ isActive }) => `min-w-0 min-h-11 grid place-items-center text-center px-1 py-2 rounded-lg ${isActive ? "bg-ink text-accent" : "text-mute"}`}>Expenses</NavLink>
        <button className="min-w-0 min-h-11 px-1 py-2 text-mute" onClick={() => setModal("budget")}>Budget</button>
        <button className="min-w-0 min-h-11 px-1 py-2 text-mute" onClick={() => setModal("category")}>Category</button>
        <button className="min-w-0 min-h-11 px-1 py-2 text-mute" onClick={logout}>Log out</button>
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
        <Route element={<Layout />}><Route index element={<Dashboard />} /><Route path="expenses" element={<Expenses />} /></Route></Routes>
      <Toaster theme="dark" richColors position="top-right" />
    </BrowserRouter></AuthProvider></QueryClientProvider>
  );
}
