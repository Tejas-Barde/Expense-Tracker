import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { saveBudget } from "../../lib/services/budgets";
import { saveSalary } from "../../lib/services/finance";
export default function BudgetForm({ onClose }: { onClose: () => void }) {
  const { uid, mk, categories, budget, finance, loading } = useData(); const qc = useQueryClient();
  const [total, setTotal] = useState(String(budget?.total ?? ""));
  const [salary, setSalary] = useState(String(finance.salary || ""));
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(budget?.limits ?? {}).map(([k, v]) => [k, String(v)])));
  useEffect(() => {
    if (!loading) {
      setTotal(String(budget?.total ?? ""));
      setSalary(String(finance.salary || ""));
      setLimits(Object.fromEntries(Object.entries(budget?.limits ?? {}).map(([k, v]) => [k, String(v)])));
    }
  }, [loading, budget, finance.salary]);
  const m = useMutation({
    mutationFn: async () => {
      await saveBudget(uid, mk, parseFloat(total) || 0,
        Object.fromEntries(Object.entries(limits).filter(([, v]) => parseFloat(v) > 0).map(([k, v]) => [k, parseFloat(v)])), budget?.id ?? null);
      await saveSalary(parseFloat(salary) || 0);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["finance", uid] }); toast.success("Budget and salary saved"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  if (loading) return <Modal title={`Budget for ${mk}`} onClose={onClose}><p className="text-sm text-mute">Loading budget settings…</p></Modal>;
  return (
    <Modal title={`Budget for ${mk}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm text-mute">Monthly salary
          <input className="input mt-1" type="number" min="0" step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Enter your monthly salary" /></label>
        <label className="block text-sm text-mute">Overall monthly limit
          <input className="input mt-1" type="number" min="0" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
        <p className="text-sm text-mute">Category limits</p>
        {categories.map((c) => (
          <div key={c.$id} className="flex items-center gap-3">
            <span className="size-3 rounded-full shrink-0" style={{ background: c.color }} /><span className="flex-1 text-sm">{c.name}</span>
            <input className="input !w-32" type="number" min="0" placeholder="0" value={limits[c.$id] ?? ""} onChange={(e) => setLimits({ ...limits, [c.$id]: e.target.value })} />
          </div>))}
        <button className="btn w-full" disabled={m.isPending} onClick={() => m.mutate()}>Save budget</button>
      </div>
    </Modal>
  );
}
