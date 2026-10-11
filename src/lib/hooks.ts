import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { listCategories } from "./services/categories";
import { listExpenses } from "./services/expenses";
import { getBudget } from "./services/budgets";
import { monthKey } from "./utils";
export function useData() {
  const uid = useAuth().user!.$id, mk = monthKey();
  const c = useQuery({ queryKey: ["categories"], queryFn: () => listCategories(uid) });
  const e = useQuery({ queryKey: ["expenses"], queryFn: () => listExpenses(uid) });
  const b = useQuery({ queryKey: ["budget", mk], queryFn: () => getBudget(uid, mk) });
  return { uid, mk, categories: c.data ?? [], expenses: e.data ?? [], budget: b.data ?? null, loading: c.isLoading || e.isLoading || b.isLoading };
}
