import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { listCategories } from "./services/categories";
import { listExpenses } from "./services/expenses";
import { getBudget } from "./services/budgets";
import { getFinance } from "./services/finance";
import { listTrips } from "./services/trips";
import { monthKey } from "./utils";
export function useData(month?: Date) {
  const uid = useAuth().user!.$id, mk = monthKey(month);
  const c = useQuery({ queryKey: ["categories"], queryFn: () => listCategories(uid) });
  const e = useQuery({ queryKey: ["expenses"], queryFn: () => listExpenses(uid) });
  const b = useQuery({ queryKey: ["budget", mk], queryFn: () => getBudget(uid, mk) });
  const f = useQuery({ queryKey: ["finance", uid], queryFn: getFinance });
  const t = useQuery({ queryKey: ["trips", uid], queryFn: () => listTrips(uid) });
  return { uid, mk, categories: c.data ?? [], expenses: e.data ?? [], budget: b.data ?? null,
    finance: f.data ?? { salary: 0, loans: [], friendPaidExpenses: [] },
    trips: t.data ?? [], loading: c.isLoading || e.isLoading || b.isLoading || f.isLoading || t.isLoading };
}
