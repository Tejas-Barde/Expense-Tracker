import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../components/Modal";
import { useData } from "../lib/hooks";
import { deleteTransactions, undoDelete } from "../lib/services/transactions";
import { errorMessage } from "../lib/errors";
import { categorySpend } from "../lib/services/finance";
import { dayLabel, timeTag, money } from "../lib/utils";
import Dashboard from "../components/dashboard/Dashboard";
import ExpenseForm from "../components/forms/ExpenseForm";
import type { Expense } from "../types";

export default function Expenses() {
  const { uid, categories, expenses, finance } = useData();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [showPreviousMonth, setShowPreviousMonth] = useState(false);
  const previousMonth = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }, []);
  const previousMonthLabel = previousMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const cat = (id: string) => categories.find((category) => category.$id === id);
  const personalAmount = (expense: typeof expenses[number]) => {
    return expense.amount;
  };

  const visibleExpenses = useMemo(() => {
    const search = q.trim().toLowerCase();
    return expenses.filter((expense) => {
      const date = expense.timestamp.slice(0, 10);
      return (!from || date >= from) && (!to || date <= to)
        && (!search || expense.note.toLowerCase().includes(search)
          || cat(expense.categoryId)?.name.toLowerCase().includes(search)
          || dayLabel(expense.timestamp).toLowerCase().includes(search));
    });
  }, [expenses, categories, q, from, to]);

  const groups = useMemo(() => {
    const grouped = new Map<string, typeof expenses>();
    visibleExpenses.forEach((expense) => {
      const day = dayLabel(expense.timestamp);
      grouped.set(day, [...(grouped.get(day) ?? []), expense]);
    });
    return [...grouped];
  }, [visibleExpenses]);

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteTransactions(ids, expenses),
    onSuccess: ({ deleted, failed, undo }) => {
      refresh();
      setSelectedIds(new Set(failed));
      if (failed.length) {
        setConfirmIds(failed);
        toast.warning(deleted.length
          ? `${deleted.length} deleted, but ${failed.length} could not be deleted. Review them and try again.`
          : `${failed.length} could not be deleted. Check your connection and try again.`);
        if (!deleted.length) return;
      } else {
        setConfirmIds(null);
        setSelectionMode(false);
      }
      if (deleted.length && undo) {
        toast.success(deleted.length === 1 ? "Transaction deleted" : `${deleted.length} transactions deleted`, {
          duration: 10000,
          action: {
            label: "Undo",
            onClick: () => {
              undoDelete(uid, undo).then(() => {
                refresh();
                toast.success(deleted.length === 1 ? "Transaction restored" : `${deleted.length} transactions restored`);
              }).catch((error) => toast.error(errorMessage(error, "Couldn't restore the deleted transaction.")));
            },
          },
        });
      }
    },
    onError: (error: unknown) => {
      setConfirmIds(null);
      toast.error(errorMessage(error, "Couldn't delete the transaction."));
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["finance", uid] });
    qc.invalidateQueries({ queryKey: ["trips"] });
  };

  const selectedExpenses = expenses.filter((expense) => selectedIds.has(expense.$id));
  const selectedTotal = selectedExpenses.reduce((sum, expense) => sum + personalAmount(expense), 0);
  const visibleSelectedCount = visibleExpenses.filter((expense) => selectedIds.has(expense.$id)).length;
  const allVisibleSelected = visibleExpenses.length > 0 && visibleSelectedCount === visibleExpenses.length;
  const confirmExpenses = confirmIds?.flatMap((id) => {
    const expense = expenses.find((item) => item.$id === id);
    return expense ? [expense] : [];
  }) ?? [];
  const confirmTotal = confirmExpenses.reduce((sum, expense) => sum + personalAmount(expense), 0);

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  function resetFilters() {
    setQ("");
    setFrom("");
    setTo("");
    clearSelection();
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (updated.has(id)) updated.delete(id);
      else updated.add(id);
      return updated;
    });
  }

  function toggleVisibleSelection() {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (allVisibleSelected) visibleExpenses.forEach((expense) => updated.delete(expense.$id));
      else visibleExpenses.forEach((expense) => updated.add(expense.$id));
      return updated;
    });
  }

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">Transactions</h2><p className="text-sm text-mute">Search, edit or delete anything you have recorded.</p></div>
        <button type="button" className="btn-ghost shrink-0" aria-pressed={selectionMode}
          onClick={() => selectionMode ? clearSelection() : setSelectionMode(true)}>
          {selectionMode ? "Done" : "Select"}
        </button>
      </header>
      <section className="overflow-hidden rounded-xl border border-line bg-panel">
        <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
          aria-expanded={showPreviousMonth} onClick={() => setShowPreviousMonth((visible) => !visible)}>
          <div>
            <h2 className="font-semibold">{previousMonthLabel} summary</h2>
            <p className="text-xs text-mute">See how last month went</p>
          </div>
          <span className="text-mute">{showPreviousMonth ? "Hide" : "Show"}</span>
        </button>
        {showPreviousMonth && (
          <div className="border-t border-line p-3 sm:p-4">
            <Dashboard month={previousMonth} />
          </div>
        )}
      </section>
      <div className="grid gap-2 sm:grid-cols-3">
        <datalist id="history-search-suggestions">
          {[...new Set([
            ...expenses.map((expense) => expense.note.trim()).filter(Boolean),
            ...categories.map((category) => category.name),
          ])].map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <input className="input" list="history-search-suggestions" placeholder="Search by note, category or date" value={q}
          onChange={(event) => { setQ(event.target.value); clearSelection(); }} />
        <input className="input" type="date" value={from} aria-label="From date"
          onChange={(event) => { setFrom(event.target.value); clearSelection(); }} />
        <input className="input" type="date" value={to} aria-label="To date"
          onChange={(event) => { setTo(event.target.value); clearSelection(); }} />
      </div>
      {selectionMode && visibleExpenses.length > 0 && (
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2">
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
            <input className="size-5 shrink-0 accent-[var(--color-accent)]" type="checkbox"
              checked={allVisibleSelected} onChange={toggleVisibleSelection} />
            <span>{allVisibleSelected ? "Deselect visible" : "Select visible"}</span>
          </label>
          <span className="shrink-0 text-xs text-mute">{visibleExpenses.length} shown</span>
        </div>
      )}
      {groups.length === 0 && (
        <section className="rounded-xl border border-line bg-panel p-5 text-center">
          <p className="text-mute">{q || from || to ? "No transactions match these filters." : "No transactions yet."}</p>
          {(q || from || to) && <button type="button" className="mt-3 min-h-11 px-3 text-sm text-accent" onClick={resetFilters}>Clear filters</button>}
        </section>
      )}
      {groups.map(([day, items]) => (
        <section key={day} className="min-w-0">
          <h3 className="mb-2 flex items-baseline justify-between gap-3 px-1 text-xs font-medium uppercase tracking-wide text-mute">
            <span>{day}</span>
            <span className="normal-case tracking-normal">Your spend {money(items.reduce((sum, expense) => sum + categorySpend(expense, finance), 0))}</span>
          </h3>
          <div className="space-y-2">{items.map((expense) => {
            const category = cat(expense.categoryId);
            const label = expense.note || category?.name || "Transaction";
            const friendPaid = finance.friendPaidExpenses?.find((item) => item.expenseId === expense.$id);
            const borrowing = finance.borrowings?.find((item) => item.expenseId === expense.$id);
            const sharedLoans = finance.loans.filter((loan) => loan.expenseId === expense.$id);
            const friendsOwedAmount = sharedLoans.reduce((sum, loan) => sum + Math.max(loan.amount - loan.repaid, 0), 0);
            const settlement = /^Settlement (paid to|received from) /i.test(expense.note);
            const received = /^Settlement received from /i.test(expense.note);
            return (
              <article key={expense.$id} className={`flex min-w-0 items-center gap-2 rounded-xl border bg-panel py-2 pl-3 pr-1 ${selectedIds.has(expense.$id) ? "border-accent" : "border-line"}`}>
                {selectionMode && <label className="grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center" aria-label={`Select ${label}`}>
                  <input className="size-5 accent-[var(--color-accent)]" type="checkbox" checked={selectedIds.has(expense.$id)}
                    onChange={() => toggleSelected(expense.$id)} />
                </label>}
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: category?.color ?? "#64748b" }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium">{expense.note || <span className="text-mute">{category?.name ?? "No note"}</span>}</p>
                    <p className={`shrink-0 whitespace-nowrap text-sm font-semibold ${received ? "text-emerald-400" : ""}`}>{received ? "+" : ""}{money(expense.amount)}</p>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mute">
                    <span>{category?.name ?? "Uncategorised"}</span><span aria-hidden="true">·</span><span>{timeTag(expense.timestamp)}</span>
                    {friendPaid && <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-red-300">
                      Paid by {friendPaid.friend || "someone else"} · you owe {money(Math.max(friendPaid.amount - (friendPaid.repaid ?? 0), 0))}
                    </span>}
                    {sharedLoans.length > 0 && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300">
                      Your share {money(categorySpend(expense, finance))} · {money(friendsOwedAmount)} to receive
                    </span>}
                    {borrowing && <span className="rounded-full bg-violet-400/10 px-2 py-0.5 text-violet-300">Borrowed from {borrowing.lender}</span>}
                    {settlement && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-300">{received ? "Payment received" : "Payment made"}</span>}
                  </p>
                </div>
                {!selectionMode && (
                  <div className="flex shrink-0">
                    {!settlement && <button type="button" className="grid min-h-11 min-w-10 place-items-center rounded-lg text-mute hover:bg-accent/10 hover:text-accent"
                      aria-label={`Edit ${label}`} onClick={() => setEditExpense(expense)}>✎</button>}
                    <button type="button" className="grid min-h-11 min-w-10 place-items-center rounded-lg text-mute hover:bg-red-500/10 hover:text-red-400"
                      aria-label={`Delete ${label}`} onClick={() => setConfirmIds([expense.$id])}>🗑</button>
                  </div>
                )}
              </article>
            );
          })}</div>
        </section>
      ))}

      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-3 shadow-xl md:bottom-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{selectedIds.size} selected</p>
            <p className="truncate text-xs text-mute">{money(selectedTotal)} total</p>
          </div>
          <button type="button" className="min-h-11 shrink-0 rounded-lg bg-red-500 px-4 font-semibold text-white hover:bg-red-600 disabled:opacity-50"
            disabled={deleteMutation.isPending} onClick={() => setConfirmIds(selectedExpenses.map((expense) => expense.$id))}>
            Delete selected
          </button>
        </div>
      )}

      {confirmIds && <Modal title={confirmIds.length === 1 ? "Delete transaction?" : `Delete ${confirmIds.length} transactions?`}
        onClose={() => { if (!deleteMutation.isPending) setConfirmIds(null); }}>
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-ink p-4">
            <p className="text-sm text-mute">{confirmIds.length === 1 ? "This transaction will be deleted." : "These transactions will be deleted."}</p>
            <p className="mt-1 text-2xl font-bold">{confirmIds.length} {confirmIds.length === 1 ? "transaction" : "transactions"}</p>
            <p className="text-sm text-mute">Total: {money(confirmTotal)}</p>
            {confirmExpenses.length > 0 && <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto border-t border-line pt-2 text-sm">
              {confirmExpenses.slice(0, 5).map((expense) => (
                <li key={expense.$id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{expense.note || cat(expense.categoryId)?.name || "Transaction"}</span>
                  <span className="shrink-0">{money(expense.amount)}</span>
                </li>
              ))}
              {confirmExpenses.length > 5 && <li className="text-xs text-mute">and {confirmExpenses.length - 5} more…</li>}
            </ul>}
          </div>
          <p className="text-sm text-mute">Linked balances, receivables and trip entries are removed with it. You can undo this right after deleting.</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn-ghost w-full" disabled={deleteMutation.isPending} onClick={() => setConfirmIds(null)}>Cancel</button>
            <button type="button" className="min-h-11 rounded-lg bg-red-500 px-4 font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              disabled={deleteMutation.isPending || confirmIds.length === 0}
              onClick={() => deleteMutation.mutate(confirmIds)}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </Modal>}
      {editExpense && <ExpenseForm expense={editExpense} onClose={() => setEditExpense(null)} />}
    </div>
  );
}
