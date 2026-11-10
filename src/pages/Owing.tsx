import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useData } from "../lib/hooks";
import { money } from "../lib/utils";
import { deleteBorrowing, deleteLoan, friendNameKey, normalizeFriendName, recordFriendSettlement } from "../lib/services/finance";
import { addExpense, deleteExpense } from "../lib/services/expenses";
import { addCategory, listCategories } from "../lib/services/categories";
import LendingForm from "../components/forms/LendingForm";
import { useConfirm } from "../components/Confirm";
import { deleteTransactions } from "../lib/services/transactions";
import { errorMessage } from "../lib/errors";

export default function Owing() {
  const { uid, categories, finance, loading } = useData();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [settlementAmounts, setSettlementAmounts] = useState<Record<string, string>>({});
  const settlementMutation = useMutation({
    mutationFn: async ({ friend, direction, amount }: { friend: string; direction: "to_friend" | "from_friend"; amount: number }) => {
      let settlementExpenseId: string | null = null;
      const existingCategories = categories.length ? categories : await listCategories(uid);
      let category = existingCategories.find((item) => item.name.toLocaleLowerCase() === "settlements");
      if (!category) {
        await addCategory(uid, "Settlements", "#f59e0b");
        const refreshed = await listCategories(uid);
        category = refreshed.find((item) => item.name.toLocaleLowerCase() === "settlements");
      }
      if (!category) throw new Error("Could not create the Settlements category.");
      const normalizedFriend = normalizeFriendName(friend);
      const created = await addExpense(uid, {
        amount,
        categoryId: category.$id,
        note: direction === "to_friend"
          ? `Settlement paid to ${normalizedFriend}`
          : `Settlement received from ${normalizedFriend}`,
        timestamp: new Date().toISOString(),
      });
      settlementExpenseId = created.$id;
      try {
        await recordFriendSettlement(friend, direction, amount, settlementExpenseId);
      } catch (error) {
        if (settlementExpenseId) await Promise.allSettled([deleteExpense(settlementExpenseId)]);
        throw error;
      }
      return { $id: created.$id, userId: uid, amount, categoryId: category.$id, note: created.note as string, timestamp: created.timestamp as string };
    },
    onSuccess: (settlement) => {
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ["finance", uid] });
        qc.invalidateQueries({ queryKey: ["expenses"] });
        qc.invalidateQueries({ queryKey: ["categories"] });
      };
      refresh();
      toast.success("Payment recorded", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            deleteTransactions([settlement.$id], [settlement])
              .then(() => { refresh(); toast.success("Payment reversed"); })
              .catch((error) => toast.error(errorMessage(error, "Couldn't reverse the payment.")));
          },
        },
      });
    },
    onError: (error: unknown) => toast.error(errorMessage(error, "Could not record the payment. Please try again.")),
  });
  const totalLent = finance.loans.reduce((sum, loan) => sum + loan.amount, 0);
  const totalRepaid = finance.loans.reduce((sum, loan) => sum + loan.repaid, 0);
  const outstanding = totalLent - totalRepaid;
  const debtsToFriends = finance.friendPaidExpenses ?? [];
  const borrowings = finance.borrowings ?? [];
  const totalOwedToFriends = debtsToFriends.reduce((sum, debt) => sum + Math.max(debt.amount - (debt.repaid ?? 0), 0), 0);
  const totalBorrowed = borrowings.reduce((sum, borrowing) => sum + borrowing.amount, 0);
  const borrowedOutstanding = borrowings.reduce((sum, borrowing) =>
    sum + Math.max(borrowing.amount - borrowing.repaid, 0), 0);
  const totalPayable = totalOwedToFriends + borrowedOutstanding;
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
  borrowings.forEach((borrowing) => {
    const name = normalizeFriendName(borrowing.lender);
    if (!name) return;
    const key = friendNameKey(name);
    const current = balances.get(key) ?? { name, theyOweYou: 0, youOweThem: 0 };
    current.youOweThem += Math.max(borrowing.amount - borrowing.repaid, 0);
    balances.set(key, current);
  });
  const netBalance = [...balances.values()].reduce((sum, balance) =>
    sum + balance.theyOweYou - balance.youOweThem, 0);

  if (loading) return <p className="text-mute">Loading…</p>;
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">Balances</h2><p className="text-sm text-mute">See who owes you and who you owe, and record payments.</p></div>
        <button className="btn shrink-0" onClick={() => setShowForm(true)}>Record loan or borrowing</button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Summary title="Total lent" amount={totalLent} />
        <Summary title="Repaid to you" amount={totalRepaid} />
        <Summary title="Receivable" amount={outstanding} prominent />
        <Summary title="Total borrowed" amount={totalBorrowed} />
        <Summary title="Borrowing outstanding" amount={borrowedOutstanding} negative={borrowedOutstanding > 0} />
        <Summary title="You owe others" amount={totalPayable} negative={totalPayable > 0} />
        <Summary
          title="Net settlement"
          amount={Math.abs(netBalance)}
          prominent={netBalance !== 0}
          suffix={netBalance > 0 ? "owed to you" : netBalance < 0 ? "you owe" : "settled"}
          negative={netBalance < 0}
        />
      </div>
      {balances.size > 0 && (
        <section className="rounded-xl border border-line bg-panel p-4">
          <h3 className="font-semibold">Overall balances</h3>
          <p className="mb-3 text-xs text-mute">Net settlement is shown by person, with gross amounts listed below.</p>
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
                  {(balance.youOweThem > 0 || balance.theyOweYou > 0) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {balance.youOweThem > 0 && <span className="text-red-300">You owe: {money(balance.youOweThem)}</span>}
                      {balance.theyOweYou > 0 && <span className="text-emerald-400">Owed to you: {money(balance.theyOweYou)}</span>}
                    </div>
                  )}
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
                          onClick={async () => {
                            if (!(await confirm({ title: "Record this payment?", message: `You paid ${balance.name} ${money(amount)}. It will reduce what you owe and come out of your balance.`, confirmLabel: "Record payment" }))) return;
                            settlementMutation.mutate(
                              { friend: balance.name, direction: "to_friend", amount },
                              { onSuccess: () => setSettlementAmounts({ ...settlementAmounts, [key]: "" }) },
                            );
                          }}>I paid them</button>
                      )}
                      {net > 0 && (
                        <button className="btn disabled:opacity-40"
                          disabled={settlementMutation.isPending || amount <= 0 || amount > net}
                          onClick={async () => {
                            if (!(await confirm({ title: "Record this payment?", message: `${balance.name} paid you ${money(amount)}. It will reduce what they owe and be added to your balance.`, confirmLabel: "Record payment" }))) return;
                            settlementMutation.mutate(
                              { friend: balance.name, direction: "from_friend", amount },
                              { onSuccess: () => setSettlementAmounts({ ...settlementAmounts, [key]: "" }) },
                            );
                          }}>They paid me</button>
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
            <h3 className="font-semibold">Shared expenses you owe</h3>
            <p className="text-xs text-mute">Expenses someone else paid for you</p>
          </div>
          {debtsToFriends.map((debt) => {
            const due = Math.max(debt.amount - (debt.repaid ?? 0), 0);
            return (
              <article key={debt.expenseId} className="rounded-xl border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h4 className="font-semibold">{debt.friend || "Other person"}</h4><p className="text-xs text-mute">{new Date(debt.timestamp).toLocaleDateString()}</p></div>
                  <div className="text-right"><p className="font-semibold">{money(debt.amount)} total</p><p className="text-sm text-red-300">{money(due)} outstanding</p></div>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {borrowings.length > 0 && (
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">Money borrowed</h3>
            <p className="text-xs text-mute">Outstanding obligations to lenders</p>
          </div>
          {borrowings.map((borrowing) => {
            const due = Math.max(borrowing.amount - borrowing.repaid, 0);
            return (
              <article key={borrowing.id} className="rounded-xl border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">{borrowing.lender}</h4>
                    <p className="text-xs text-mute">
                      {new Date(borrowing.timestamp).toLocaleDateString()}{borrowing.note ? ` · ${borrowing.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 text-right">
                    <div>
                      <p className="font-semibold">{money(borrowing.amount)} borrowed</p>
                      <p className="text-sm text-red-300">{money(due)} outstanding</p>
                    </div>
                    <button type="button" className="grid size-11 place-items-center rounded-lg text-mute hover:bg-red-500/10 hover:text-red-400"
                      aria-label={`Delete borrowing from ${borrowing.lender}`} onClick={async () => {
                        if (!(await confirm({ title: "Delete this borrowing?", message: `The borrowing record from ${borrowing.lender} will be removed.`, confirmLabel: "Delete", destructive: true }))) return;
                        try {
                          await deleteBorrowing(borrowing.id);
                          qc.invalidateQueries({ queryKey: ["finance", uid] });
                          toast.success("Borrowing deleted");
                        } catch (error) {
                          toast.error(errorMessage(error, "Could not delete the borrowing."));
                        }
                      }}>🗑</button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {!finance.loans.length && !debtsToFriends.length && borrowings.length === 0 && <section className="rounded-xl border border-line bg-panel p-6 text-center">
        <p className="font-semibold">No balances yet</p>
        <p className="mt-1 text-sm text-mute">Record a loan or borrowing, or add an expense that someone else paid.</p>
      </section>}
      <div className="space-y-3">
        {finance.loans.map((loan) => {
          const due = Math.max(loan.amount - loan.repaid, 0);
          return <section key={loan.id} className="min-w-0 rounded-xl border border-line bg-panel p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="truncate font-semibold">{loan.friend}</h3>
                <p className="text-xs text-mute">{new Date(loan.timestamp).toLocaleDateString()} {loan.note && `· ${loan.note}`}</p></div>
              <div className="flex shrink-0 items-start gap-2 text-right"><div><p className="font-semibold">{money(loan.amount)} lent</p>
                <p className="text-sm text-emerald-400">{money(due)} owed</p></div>
                <button type="button" className="grid size-11 place-items-center rounded-lg text-mute hover:bg-red-500/10 hover:text-red-400"
                  aria-label={`Delete loan to ${loan.friend}`} onClick={async () => {
                    if (!(await confirm({ title: "Delete this loan?", message: `The loan record to ${loan.friend} will be removed.`, confirmLabel: "Delete", destructive: true }))) return;
                    try {
                      await deleteLoan(loan.id);
                      qc.invalidateQueries({ queryKey: ["finance", uid] });
                      toast.success("Loan deleted");
                    } catch (error) {
                      toast.error(errorMessage(error, "Could not delete the loan."));
                    }
                  }}>🗑</button>
              </div>
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
