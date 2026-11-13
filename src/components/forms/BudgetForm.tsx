import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { saveBudget } from "../../lib/services/budgets";
import { saveSalary } from "../../lib/services/finance";
import { errorMessage } from "../../lib/errors";
import { isSystemCategory } from "../../lib/services/categories";
import { money } from "../../lib/utils";

const num = (value: string) => (value.trim() === "" ? 0 : Number(value));
const bad = (value: string) => value.trim() !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0);

export default function BudgetForm({ onClose }: { onClose: () => void }) {
  const { uid, mk, categories, budget, finance, loading } = useData(); const qc = useQueryClient();
  const [total, setTotal] = useState(String(budget?.total ?? ""));
  const [salary, setSalary] = useState(String(finance.salary || ""));
  const [savings, setSavings] = useState(String(budget?.savings ?? ""));
  const [submitted, setSubmitted] = useState(false);
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(budget?.limits ?? {}).map(([k, v]) => [k, String(v)])));
  useEffect(() => {
    if (!loading) {
      setTotal(String(budget?.total ?? ""));
      setSalary(String(finance.salary || ""));
      setSavings(String(budget?.savings ?? ""));
      setLimits(Object.fromEntries(Object.entries(budget?.limits ?? {}).map(([k, v]) => [k, String(v)])));
    }
  }, [loading, budget, finance.salary]);
  const monthLabel = new Date(`${mk}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const errors: Record<string, string> = {};
  if (bad(salary)) errors.salary = "Enter a salary of zero or more.";
  if (bad(total)) errors.total = "Enter a limit of zero or more.";
  if (bad(savings)) errors.savings = "Enter savings of zero or more.";
  if (Object.values(limits).some(bad)) errors.limits = "Category limits must be zero or more.";
  const salaryN = num(salary), totalN = num(total), savingsN = num(savings);
  const limitSum = Object.values(limits).reduce((sum, value) => sum + (bad(value) ? 0 : num(value)), 0);
  const warnings = [
    salaryN > 0 && totalN + savingsN > salaryN ? `Your limit and savings add up to ${money(totalN + savingsN)}, which is more than your salary of ${money(salaryN)}.` : "",
    totalN > 0 && limitSum > totalN ? `Category limits add up to ${money(limitSum)}, which is more than the overall limit of ${money(totalN)}.` : "",
  ].filter(Boolean);

  const m = useMutation({
    mutationFn: async () => {
      await saveBudget(uid, mk, totalN,
        Object.fromEntries(Object.entries(limits).filter(([, v]) => num(v) > 0).map(([k, v]) => [k, num(v)])), budget?.id ?? null, savingsN);
      await saveSalary(salaryN);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["finance", uid] }); toast.success("Budget saved"); onClose(); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Couldn't save your budget. Please try again.")),
  });
  if (loading) return <Modal title="Budget and salary" onClose={onClose}><p className="text-sm text-mute" role="status">Loading your budget…</p></Modal>;
  const err = (key: string) => (submitted ? errors[key] : undefined);
  const Err = ({ k }: { k: string }) => err(k) ? <span role="alert" className="mt-1 block text-xs text-red-300">{err(k)}</span> : null;
  return (
    <Modal title="Budget and salary" onClose={onClose}>
      <form className="space-y-4" noValidate onSubmit={(event) => {
        event.preventDefault(); setSubmitted(true);
        if (Object.keys(errors).length) { toast.error(Object.values(errors)[0]); return; }
        m.mutate();
      }}>
        <label className="block"><span className="mb-1 block text-sm font-medium">Monthly salary (₹)</span>
          <input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0.00" />
          <span className="mt-1 block text-xs text-mute">Used to work out your remaining balance. Applies to every month.</span><Err k="salary" /></label>
        <p className="border-t border-line pt-3 text-xs font-medium uppercase tracking-wide text-mute">{monthLabel}</p>
        <label className="block"><span className="mb-1 block text-sm font-medium">Spending limit (₹)</span>
          <input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" />
          <Err k="total" /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">Planned savings (₹)</span>
          <input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={savings} onChange={(e) => setSavings(e.target.value)} placeholder="0.00" />
          <span className="mt-1 block text-xs text-mute">Set aside before you work out what is left to spend.</span><Err k="savings" /></label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Category limits <span className="font-normal text-mute">(optional)</span></legend>
          <div className="space-y-2">
            {categories.filter((c) => !isSystemCategory(c)).map((c) => (
              <div key={c.$id} className="flex items-center gap-3">
                <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                <input className="input !w-28 shrink-0 sm:!w-32" type="number" min="0" inputMode="decimal" placeholder="No limit" aria-label={`${c.name} limit`}
                  value={limits[c.$id] ?? ""} onChange={(e) => setLimits({ ...limits, [c.$id]: e.target.value })} />
              </div>))}
          </div>
          <Err k="limits" />
        </fieldset>
        {warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">{warning}</p>)}
        <button className="btn w-full disabled:opacity-50" type="submit" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save budget"}</button>
      </form>
    </Modal>
  );
}
