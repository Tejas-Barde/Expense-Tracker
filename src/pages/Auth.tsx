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
      <div className="w-full max-w-sm bg-panel border border-line rounded-2xl p-6 space-y-3">
        <h1 className="text-2xl font-bold">{mode === "login" ? "Log in to Ledgerly" : "Create your account"}</h1>
        {mode === "signup" && <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />}
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button className="btn w-full" onClick={submit}>{mode === "login" ? "Log in" : "Sign up"}</button>
        <button className="text-sm text-mute w-full" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}</button>
      </div>
    </div>
  );
}
