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
    <div className="min-h-screen md:flex">
      <aside className="hidden md:flex flex-col gap-2 w-56 p-4 border-r border-line sticky top-0 h-screen">
        <h1 className="text-xl font-bold mb-4">Ledgerly</h1>
        <NavLink to="/" end className={link}>Dashboard</NavLink><NavLink to="/expenses" className={link}>Expenses</NavLink>
        <button className="btn-ghost mt-4" onClick={() => setModal("budget")}>Budget</button>
        <button className="btn-ghost" onClick={() => setModal("category")}>New category</button>
        <button className="mt-auto text-mute text-sm text-left" onClick={logout}>Log out ({user.name})</button>
      </aside>
      <main className="flex-1 p-4 pb-24 md:p-8 max-w-5xl">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-bold">{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
          <button className="btn" onClick={() => setModal("expense")}>Add expense</button>
        </div>
        <Outlet />
      </main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-panel border-t border-line flex justify-around p-2 text-sm">
        <NavLink to="/" end className={link}>Dashboard</NavLink><NavLink to="/expenses" className={link}>Expenses</NavLink>
        <button className="px-3 py-2 text-mute" onClick={() => setModal("budget")}>Budget</button>
        <button className="px-3 py-2 text-mute" onClick={() => setModal("category")}>Category</button>
        <button className="px-3 py-2 text-mute" onClick={logout}>Log out</button>
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
