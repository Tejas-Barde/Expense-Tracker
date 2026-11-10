import { useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";

export default function Auth() {
  const { user, login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [submitted, setSubmitted] = useState(false), [pending, setPending] = useState(false), [formError, setFormError] = useState("");
  if (user) return <Navigate to="/" replace />;

  const errors: Record<string, string> = {};
  if (mode === "signup" && !name.trim()) errors.name = "Enter your full name.";
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Enter a valid email address, like name@example.com.";
  if (!pw) errors.pw = mode === "login" ? "Enter your password." : "Choose a password.";
  else if (mode === "signup" && pw.length < 8) errors.pw = "Use at least 8 characters.";

  const submit = async () => {
    setSubmitted(true); setFormError("");
    if (Object.keys(errors).length) return;
    setPending(true);
    try {
      if (mode === "login") await login(email.trim(), pw);
      else await signup(name.trim(), email.trim(), pw);
    } catch (error) {
      const message = errorMessage(error, mode === "login" ? "We couldn't sign you in. Please try again." : "We couldn't create your account. Please try again.");
      setFormError(message); toast.error(message);
    } finally { setPending(false); }
  };
  const err = (key: string) => (submitted ? errors[key] : undefined);
  const switchMode = () => { setMode(mode === "login" ? "signup" : "login"); setSubmitted(false); setFormError(""); };

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/20">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-accent font-bold text-white">L</div>
          <div><p className="text-lg font-bold">Ledgerly</p><p className="text-xs text-mute">Personal finance</p></div>
        </div>
        <h1 className="mb-1 text-2xl font-bold tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="mb-5 text-sm text-mute">{mode === "login" ? "Sign in to see your spending and balances." : "Track what you spend and who owes whom, in one place."}</p>
        <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {mode === "signup" && (
            <label className="block"><span className="mb-1 block text-sm font-medium">Full name</span>
              <input className="input" autoComplete="name" value={name} aria-invalid={!!err("name")} onChange={(e) => setName(e.target.value)} />
              {err("name") && <span role="alert" className="mt-1 block text-xs text-red-300">{err("name")}</span>}</label>
          )}
          <label className="block"><span className="mb-1 block text-sm font-medium">Email address</span>
            <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={email} aria-invalid={!!err("email")} onChange={(e) => setEmail(e.target.value)} />
            {err("email") && <span role="alert" className="mt-1 block text-xs text-red-300">{err("email")}</span>}</label>
          <label className="block"><span className="mb-1 block text-sm font-medium">Password</span>
            <input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={pw} aria-invalid={!!err("pw")} onChange={(e) => setPw(e.target.value)} />
            {err("pw") ? <span role="alert" className="mt-1 block text-xs text-red-300">{err("pw")}</span>
              : mode === "signup" ? <span className="mt-1 block text-xs text-mute">At least 8 characters.</span> : null}</label>
          {formError && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{formError}</p>}
          <button className="btn w-full disabled:opacity-50" type="submit" disabled={pending}>
            {pending ? (mode === "login" ? "Signing in…" : "Creating account…") : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button type="button" className="mt-4 min-h-11 w-full text-sm text-mute hover:text-text" onClick={switchMode}>
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
      </div>
    </div>
  );
}
