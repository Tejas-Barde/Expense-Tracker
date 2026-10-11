import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Models } from "appwrite";
import { account, ID } from "./appwrite/client";
interface Ctx { user: Models.User<Models.Preferences> | null; loading: boolean;
  login: (e: string, p: string) => Promise<void>; signup: (n: string, e: string, p: string) => Promise<void>; logout: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Ctx["user"]>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { account.get().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  const login = async (e: string, p: string) => { await account.createEmailPasswordSession(e, p); setUser(await account.get()); };
  const signup = async (name: string, email: string, p: string) => {
    await account.create(ID.unique(), email, p, name); // name/email are stored by Appwrite Auth, no profiles collection needed
    await login(email, p);
  };
  const logout = async () => { await account.deleteSession("current"); setUser(null); };
  return <AuthCtx.Provider value={{ user, loading, login, signup, logout }}>{children}</AuthCtx.Provider>;
}
