import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useData } from "../lib/hooks";
import { money } from "../lib/utils";
import { friendNameKey, normalizeFriendName, recordFriendSettlement } from "../lib/services/finance";
import { addExpense, deleteExpense } from "../lib/services/expenses";
import { addCategory, listCategories } from "../lib/services/categories";
import LendingForm from "../components/forms/LendingForm";

export default function Owing() {
  const { uid, categories, finance, loading } = useData();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [settlementAmounts, setSettlementAmounts] = useState<Record<string, string>>({});
  const settlementMutation = useMutation({
    mutationFn: async ({ friend, direction, amount }: { friend: string; direction: "to_friend" | "from_friend"; amount: number }) => {
      let settlementExpenseId: string | null = null;
      if (direction === "to_friend") {
        const existingCategories = categories.length ? categories : await listCategories(uid);
        let category = existingCategories.find((item) => item.name.toLocaleLowerCase() === "settlements");
        if (!category) {
          await addCategory(uid, "Settlements", "#f59e0b");
          const refreshed = await listCategories(uid);
          category = refreshed.find((item) => item.name.toLocaleLowerCase() === "settlements");
        }
        if (!category) throw new Error("Could not create the Settlements category.");
        const created = await addExpense(uid, {
          amount,
          categoryId: category.$id,
          note: `Settlement paid to ${normalizeFriendName(friend)}`,
          timestamp: new Date().toISOString(),
        });
        settlementExpenseId = created.$id;
      }
      try {
        await recordFriendSettlement(friend, direction, amount);
      } catch (error) {
        if (settlementExpenseId) await Promise.allSettled([deleteExpense(settlementExpenseId)]);
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", uid] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Settlement updated");
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
  const netBalance = [...balances.values()].reduce((sum, balance) =>
    sum + balance.theyOweYou - balance.youOweThem, 0);

  if (loading) return <p className="text-mute">Loading…</p>;
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">Owing</h2><p className="text-sm text-mute">Track money friends owe you and money you owe friends.</p></div>
        <button className="btn shrink-0" onClick={() => setShowForm(true)}>Lend money</button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Summary title="Total lent" amount={totalLent} />
        <Summary title="Paid back" amount={totalRepaid} />
        <Summary title="Still owed" amount={outstanding} prominent />
        <Summary title="You owe friends" amount={totalOwedToFriends} />
        <Summary
          title="Net settlement"
          amount={Math.abs(netBalance)}
          prominent={netBalance !== 0}
          suffix={netBalance > 0 ? "owed to you" : netBalance < 0 ? "you owe" : "settled up"}
          negative={netBalance < 0}
        />
      </div>
      {balances.size > 0 && (
        <section className="rounded-xl border border-line bg-panel p-4">
          <h3 className="font-semibold">Overall balances</h3>
          <p className="mb-3 text-xs text-mute">Balances are combined by friend name.</p>
          <div className="space-y-2">
            {[...balances.values()].map((balance) => {
              const net = balance.theyOweYou - balance.youOweThem;
              const key = friendNameKey(balance.name);
              const amount = Number(settlementAmounts[key] ?? "");
              return (
                <div key={key} className="rounded-lg bg-ink p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{balance.name}</span>
                    <span className={`shrink-0 text-sm font-semibold ${net > 0 ? "text-emerald-400" : net < 0 ? "text-red-300" : "text-mute"}`}>
                      {net > 0 ? `${money(net)} is owed to you` : net < 0 ? `You owe ${money(Math.abs(net))}` : "Settled up"}
                    </span>
                  </div>
                  {net !== 0 && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 text-xs text-mute">Settlement amount
                        <input className="input mt-1" type="number" min="0.01" step="0.01" inputMode="decimal"
                          value={settlementAmounts[key] ?? ""} placeholder="Enter amount paid"
                          onChange={(event) => setSettlementAmounts({ ...settlementAmounts, [key]: event.target.value })} />
                      </label>
                      {net < 0 && (
                        <button className="btn-ghost disabled:opacity-40"
                          disabled={settlementMutation.isPending || amount <= 0 || amount > Math.abs(net)}
                          onClick={() => {
                            if (!window.confirm(`Confirm that you paid ${balance.name} ${money(amount)}?`)) return;
                            settlementMutation.mutate(
                              { friend: balance.name, direction: "to_friend", amount },
                              { onSuccess: () => setSettlementAmounts({ ...settlementAmounts, [key]: "" }) },
                            );
                          }}>I paid</button>
                      )}
                      {net > 0 && (
                        <button className="btn disabled:opacity-40"
                          disabled={settlementMutation.isPending || amount <= 0 || amount > net}
                          onClick={() => {
                            if (!window.confirm(`Confirm that ${balance.name} paid you ${money(amount)}?`)) return;
                            settlementMutation.mutate(
                              { friend: balance.name, direction: "from_friend", amount },
                              { onSuccess: () => setSettlementAmounts({ ...settlementAmounts, [key]: "" }) },
                            );
                          }}>Friend paid</button>
                      )}
                    </div>
                  )}
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
            return (
              <article key={debt.expenseId} className="rounded-xl border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h4 className="font-semibold">{debt.friend || "Friend"}</h4><p className="text-xs text-mute">{new Date(debt.timestamp).toLocaleDateString()}</p></div>
                  <div className="text-right"><p className="font-semibold">{money(debt.amount)} borrowed</p><p className="text-sm text-red-300">{money(due)} you owe</p></div>
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
          return <section key={loan.id} className="min-w-0 rounded-xl border border-line bg-panel p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="truncate font-semibold">{loan.friend}</h3>
                <p className="text-xs text-mute">{new Date(loan.timestamp).toLocaleDateString()} {loan.note && `· ${loan.note}`}</p></div>
              <div className="shrink-0 text-right"><p className="font-semibold">{money(loan.amount)} lent</p>
                <p className="text-sm text-emerald-400">{money(due)} owed</p></div>
            </div>
          </section>;
        })}
      </div>
      {showForm && <LendingForm onClose={() => setShowForm(false)} />}
    </div>
  );
}

function Summary({ title, amount, prominent = false, suffix, negative = false }: {
  title: string;
  amount: number;
  prominent?: boolean;
  suffix?: string;
  negative?: boolean;
}) {
  return <section className="rounded-xl border border-line bg-panel p-4">
    <p className="text-sm text-mute">{title}</p>
    <p className={`mt-1 text-2xl font-bold ${negative ? "text-red-300" : prominent ? "text-emerald-400" : ""}`}>{money(amount)}</p>
    {suffix && <p className="mt-1 text-xs text-mute">{suffix}</p>}
  </section>;
}
