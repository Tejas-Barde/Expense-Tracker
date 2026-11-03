import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useData } from "../lib/hooks";
import { money } from "../lib/utils";
import { friendNameKey, normalizeFriendName, updateFriendPaidRepaid, updateLoanRepaid } from "../lib/services/finance";
import LendingForm from "../components/forms/LendingForm";

export default function Owing() {
  const { uid, finance, loading } = useData();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [repayments, setRepayments] = useState<Record<string, string>>({});
  const [paymentsReceived, setPaymentsReceived] = useState<Record<string, string>>({});
  const [paymentsToFriend, setPaymentsToFriend] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: ({ id, repaid }: { id: string; repaid: number }) => updateLoanRepaid(id, repaid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", uid] });
      toast.success("Payment received updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const debtMutation = useMutation({
    mutationFn: ({ expenseId, repaid }: { expenseId: string; repaid: number }) => updateFriendPaidRepaid(expenseId, repaid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", uid] });
      toast.success("Payment to friend updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const totalLent = finance.loans.reduce((sum, loan) => sum + loan.amount, 0);
  const totalRepaid = finance.loans.reduce((sum, loan) => sum + loan.repaid, 0);
  const outstanding = totalLent - totalRepaid;
  const debtsToFriends = finance.friendPaidExpenses ?? [];
  const totalOwedToFriends = debtsToFriends.reduce((sum, debt) => sum + Math.max(debt.amount - (debt.repaid ?? 0), 0), 0);
  const balances = new Map<string, { name: string; theyOweYou: number; youOweThem: number }>();
  finance.loans.forEach((loan) => {
    const name = normalizeFriendName(loan.friend);
    if (!name) return;
    const key = friendNameKey(name);
    const current = balances.get(key) ?? { name, theyOweYou: 0, youOweThem: 0 };
    current.theyOweYou += Math.max(loan.amount - loan.repaid, 0);
    balances.set(key, current);
  });
  debtsToFriends.forEach((debt) => {
    const name = normalizeFriendName(debt.friend);
    if (!name) return;
    const key = friendNameKey(name);
    const current = balances.get(key) ?? { name, theyOweYou: 0, youOweThem: 0 };
    current.youOweThem += Math.max(debt.amount - (debt.repaid ?? 0), 0);
    balances.set(key, current);
  });

  if (loading) return <p className="text-mute">Loading…</p>;
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">Owing</h2><p className="text-sm text-mute">Track money friends owe you and money you owe friends.</p></div>
        <button className="btn shrink-0" onClick={() => setShowForm(true)}>Lend money</button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary title="Total lent" amount={totalLent} />
        <Summary title="Paid back" amount={totalRepaid} />
        <Summary title="Still owed" amount={outstanding} prominent />
        <Summary title="You owe friends" amount={totalOwedToFriends} />
      </div>
      {balances.size > 0 && (
        <section className="rounded-xl border border-line bg-panel p-4">
          <h3 className="font-semibold">Overall balances</h3>
          <p className="mb-3 text-xs text-mute">Balances are combined by friend name.</p>
          <div className="space-y-2">
            {[...balances.values()].map((balance) => {
              const net = balance.theyOweYou - balance.youOweThem;
              return (
                <div key={friendNameKey(balance.name)} className="flex items-center justify-between gap-3 rounded-lg bg-ink px-3 py-2">
                  <span className="truncate font-medium">{balance.name}</span>
                  <span className={`shrink-0 text-sm font-semibold ${net > 0 ? "text-emerald-400" : net < 0 ? "text-red-300" : "text-mute"}`}>
                    {net > 0 ? `${money(net)} is owed to you` : net < 0 ? `You owe ${money(Math.abs(net))}` : "Settled up"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {debtsToFriends.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">Money you owe friends</h3>
            <p className="text-xs text-mute">Expenses paid by friends for you</p>
          </div>
          {debtsToFriends.map((debt) => {
            const due = Math.max(debt.amount - (debt.repaid ?? 0), 0);
            const payment = Number(paymentsToFriend[debt.expenseId] ?? "");
            return (
              <article key={debt.expenseId} className="rounded-xl border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h4 className="font-semibold">{debt.friend || "Friend"}</h4><p className="text-xs text-mute">{new Date(debt.timestamp).toLocaleDateString()}</p></div>
                  <div className="text-right"><p className="font-semibold">{money(debt.amount)} borrowed</p><p className="text-sm text-red-300">{money(due)} you owe</p></div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <label className="min-w-0 flex-1 text-xs text-mute">Payment made to friend
                    <input className="input mt-1" type="number" min="0.01" max={due} step="0.01" inputMode="decimal"
                      value={paymentsToFriend[debt.expenseId] ?? ""} placeholder="Enter amount paid"
                      onChange={(event) => setPaymentsToFriend({ ...paymentsToFriend, [debt.expenseId]: event.target.value })} /></label>
                  <button className="btn disabled:opacity-40"
                    disabled={debtMutation.isPending || payment <= 0 || payment > due}
                    onClick={() => debtMutation.mutate(
                      { expenseId: debt.expenseId, repaid: (debt.repaid ?? 0) + payment },
                      { onSuccess: () => setPaymentsToFriend({ ...paymentsToFriend, [debt.expenseId]: "" }) },
                    )}>Record payment</button>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {!finance.loans.length && <section className="rounded-xl border border-line bg-panel p-6 text-center">
        <p className="font-semibold">No lending entries yet</p>
        <p className="mt-1 text-sm text-mute">Add money you lend to a friend to track it separately from everyday spending.</p>
      </section>}
      <div className="space-y-3">
        {finance.loans.map((loan) => {
          const due = Math.max(loan.amount - loan.repaid, 0);
          const value = repayments[loan.id] ?? String(loan.repaid);
          const payment = Number(paymentsReceived[loan.id] ?? "");
          return <section key={loan.id} className="min-w-0 rounded-xl border border-line bg-panel p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="truncate font-semibold">{loan.friend}</h3>
                <p className="text-xs text-mute">{new Date(loan.timestamp).toLocaleDateString()} {loan.note && `· ${loan.note}`}</p></div>
              <div className="shrink-0 text-right"><p className="font-semibold">{money(loan.amount)} lent</p>
                <p className="text-sm text-emerald-400">{money(due)} owed</p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <label className="min-w-0 flex-1 text-xs text-mute">Payment received from friend
                <input className="input mt-1" type="number" min="0.01" max={due} step="0.01" inputMode="decimal"
                  value={paymentsReceived[loan.id] ?? ""} placeholder="Enter amount received"
                  onChange={(event) => setPaymentsReceived({ ...paymentsReceived, [loan.id]: event.target.value })} /></label>
              <button className="btn disabled:opacity-40"
                disabled={mutation.isPending || payment <= 0 || payment > due}
                onClick={() => {
                  mutation.mutate(
                    { id: loan.id, repaid: loan.repaid + payment },
                    { onSuccess: () => setPaymentsReceived({ ...paymentsReceived, [loan.id]: "" }) },
                  );
                }}>Record payment</button>
              <label className="min-w-0 basis-full text-xs text-mute sm:basis-auto">Total paid back
                <input className="input mt-1 sm:w-36" type="number" min="0" max={loan.amount} step="0.01" inputMode="decimal" value={value}
                  onChange={(event) => setRepayments({ ...repayments, [loan.id]: event.target.value })} /></label>
              <button className="btn-ghost disabled:opacity-40" disabled={mutation.isPending || Number(value) < 0 || Number(value) > loan.amount}
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
