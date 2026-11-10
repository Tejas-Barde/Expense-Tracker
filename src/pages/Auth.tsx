import { useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
export default function Auth() {
  const { user, login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [pw, setPw] = useState("");
  if (user) return <Navigate to="/" replace />;
  const submit = async () => { try { mode === "login" ? await login(email, pw) : await signup(name, email, pw); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/20">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-accent font-bold text-white">L</div>
          <div><p className="font-bold text-lg">Ledgerly</p><p className="text-xs text-mute">Personal finance</p></div>
        </div>
        <h1 className="mb-1 text-2xl font-bold tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="mb-5 text-sm text-mute">{mode === "login" ? "Sign in to review your finances." : "Start organizing your spending and balances."}</p>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {mode === "signup" && <input className="input" placeholder="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
          <input className="input" type="email" placeholder="Email address" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn w-full" type="submit">{mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button className="mt-4 min-h-11 text-sm text-mute w-full" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Don't have an account? Create one" : "Already have an account? Sign in"}</button>
      </div>
    </div>
  );
}
