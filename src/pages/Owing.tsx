import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useData } from "../lib/hooks";
import { money } from "../lib/utils";
import { updateLoanRepaid } from "../lib/services/finance";
import LendingForm from "../components/forms/LendingForm";

export default function Owing() {
  const { uid, finance, loading } = useData();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [repayments, setRepayments] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: ({ id, repaid }: { id: string; repaid: number }) => updateLoanRepaid(id, repaid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", uid] });
      toast.success("Repayment updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const totalLent = finance.loans.reduce((sum, loan) => sum + loan.amount, 0);
  const totalRepaid = finance.loans.reduce((sum, loan) => sum + loan.repaid, 0);
  const outstanding = totalLent - totalRepaid;

  if (loading) return <p className="text-mute">Loading…</p>;
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">Owing</h2><p className="text-sm text-mute">Track money friends owe you.</p></div>
        <button className="btn shrink-0" onClick={() => setShowForm(true)}>Lend money</button>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary title="Total lent" amount={totalLent} />
        <Summary title="Paid back" amount={totalRepaid} />
        <Summary title="Still owed" amount={outstanding} prominent />
      </div>
      {!finance.loans.length && <section className="rounded-xl border border-line bg-panel p-6 text-center">
        <p className="font-semibold">No lending entries yet</p>
        <p className="mt-1 text-sm text-mute">Add money you lend to a friend to track it separately from everyday spending.</p>
      </section>}
      <div className="space-y-3">
        {finance.loans.map((loan) => {
          const due = Math.max(loan.amount - loan.repaid, 0);
          const value = repayments[loan.id] ?? String(loan.repaid);
          return <section key={loan.id} className="min-w-0 rounded-xl border border-line bg-panel p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="truncate font-semibold">{loan.friend}</h3>
                <p className="text-xs text-mute">{new Date(loan.timestamp).toLocaleDateString()} {loan.note && `· ${loan.note}`}</p></div>
              <div className="shrink-0 text-right"><p className="font-semibold">{money(loan.amount)} lent</p>
                <p className="text-sm text-emerald-400">{money(due)} owed</p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <label className="min-w-0 flex-1 text-xs text-mute">Amount paid back
                <input className="input mt-1" type="number" min="0" max={loan.amount} step="0.01" inputMode="decimal" value={value}
                  onChange={(event) => setRepayments({ ...repayments, [loan.id]: event.target.value })} /></label>
              <button className="btn disabled:opacity-40" disabled={mutation.isPending || Number(value) < 0 || Number(value) > loan.amount}
                onClick={() => mutation.mutate({ id: loan.id, repaid: Number(value) })}>Update</button>
            </div>
          </section>;
        })}
      </div>
      {showForm && <LendingForm onClose={() => setShowForm(false)} />}
    </div>
  );
}

function Summary({ title, amount, prominent = false }: { title: string; amount: number; prominent?: boolean }) {
  return <section className="rounded-xl border border-line bg-panel p-4">
    <p className="text-sm text-mute">{title}</p>
    <p className={`mt-1 text-2xl font-bold ${prominent ? "text-emerald-400" : ""}`}>{money(amount)}</p>
  </section>;
}
