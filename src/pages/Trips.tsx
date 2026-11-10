import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/hooks";
import { createTrip, listTrips } from "../lib/services/trips";
import { money, timeTag } from "../lib/utils";
import { errorMessage } from "../lib/errors";
import { categorySpend } from "../lib/services/finance";

export default function Trips() {
  const { user } = useAuth();
  const uid = user!.$id;
  const { categories, expenses, finance, loading } = useData();
  const qc = useQueryClient();
  const tripsQuery = useQuery({ queryKey: ["trips", uid], queryFn: () => listTrips(uid) });
  const trips = tripsQuery.data ?? [];
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const selectedIdResolved = selectedId || trips[0]?.id || "";
  const selected = trips.find((trip) => trip.id === selectedIdResolved);
  const tripExpenses = useMemo(() =>
    selected ? expenses.filter((expense) => selected.expenseIds.includes(expense.$id)) : [],
  [expenses, selected]);

  const createMutation = useMutation({
    mutationFn: () => createTrip(uid, newName),
    onSuccess: (trip) => {
      qc.invalidateQueries({ queryKey: ["trips", uid] });
      setSelectedId(trip.id);
      setNewName("");
      setCreating(false);
      toast.success("Trip created. Pick it when adding a transaction.");
    },
    onError: (error: unknown) => toast.error(errorMessage(error, "Could not create the trip. Please try again.")),
  });

  const categoryTotals = useMemo(() => categories.map((category) => ({
    ...category,
    total: tripExpenses.filter((expense) => expense.categoryId === category.$id)
      .reduce((sum, expense) => sum + categorySpend(expense, finance), 0),
  })).filter((category) => category.total > 0).sort((a, b) => b.total - a.total), [categories, tripExpenses, finance]);
  const total = tripExpenses.reduce((sum, expense) =>
    sum + categorySpend(expense, finance), 0);
  const receivable = tripExpenses.reduce((sum, expense) =>
    sum + finance.loans.filter((loan) => loan.expenseId === expense.$id)
      .reduce((loanSum, loan) => loanSum + Math.max(loan.amount - loan.repaid, 0), 0), 0);

  if (loading || tripsQuery.isLoading) return <p className="text-mute">Loading your trips…</p>;

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold">Trips</h1><p className="text-sm text-mute">Trip spending is kept apart from your everyday categories.</p></div>
        <button type="button" className="btn-ghost shrink-0" onClick={() => setCreating((value) => !value)}>
          {creating ? "Cancel" : "New trip"}
        </button>
      </header>

      {creating && (
        <form className="flex gap-2 rounded-xl border border-line bg-panel p-3" onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim()) createMutation.mutate();
        }}>
          <input className="input flex-1" value={newName} onChange={(event) => setNewName(event.target.value)}
            placeholder="Trip name, e.g. Goa 2026" aria-label="Trip name" autoFocus />
          <button className="btn shrink-0 disabled:opacity-40" disabled={!newName.trim() || createMutation.isPending}>Create</button>
        </form>
      )}

      {trips.length === 0 ? (
        <section className="rounded-xl border border-line bg-panel p-8 text-center">
          <p className="font-semibold">No trips yet</p>
          <p className="mt-1 text-sm text-mute">Create a trip, then choose it when you add a transaction to see its spending by category.</p>
        </section>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {trips.map((trip) => (
              <button type="button" key={trip.id} onClick={() => setSelectedId(trip.id)}
                className={`min-h-11 shrink-0 rounded-lg border px-4 text-sm ${selected?.id === trip.id ? "border-accent bg-accent/10 text-accent" : "border-line bg-panel text-mute"}`}>
                {trip.name}
              </button>
            ))}
          </div>

          {selected && (
            <>
              <section className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-panel p-4 sm:col-span-1">
                  <p className="text-sm text-mute">Your trip share</p><p className="mt-1 text-3xl font-bold text-accent">{money(total)}</p>
                </div>
                <div className="rounded-xl border border-line bg-panel p-4">
                  <p className="text-sm text-mute">Expenses</p><p className="mt-1 text-2xl font-bold">{tripExpenses.length}</p>
                </div>
                <div className="rounded-xl border border-line bg-panel p-4">
                  <p className="text-sm text-mute">Receivable</p>
                  <p className="mt-1 truncate text-xl font-bold text-emerald-400">{money(receivable)}</p>
                </div>
              </section>

              <section className="rounded-xl border border-line bg-panel p-4">
                <h2 className="mb-3 font-semibold">{selected.name} by category</h2>
                {categoryTotals.length === 0 ? <p className="text-sm text-mute">No spending in this trip yet.</p> : (
                  <div className="space-y-3">{categoryTotals.map((category) => {
                    const pct = total ? (category.total / total) * 100 : 0;
                    return (
                      <div key={category.$id}>
                        <div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{category.name}</span><span className="font-semibold">{money(category.total)}</span></div>
                        <div className="h-2 overflow-hidden rounded bg-ink"><div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} /></div>
                      </div>
                    );
                  })}</div>
                )}
              </section>

              <section className="space-y-2">
                <h2 className="font-semibold">Trip expenses</h2>
                {tripExpenses.length === 0 ? <p className="rounded-xl border border-line bg-panel p-4 text-sm text-mute">Transactions you add to this trip will appear here.</p> :
                  tripExpenses.map((expense) => {
                    const category = categories.find((item) => item.$id === expense.categoryId);
                    return (
                      <article key={expense.$id} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: category?.color ?? "#64748b" }} />
                        <div className="min-w-0 flex-1"><p className="truncate text-sm">{expense.note || category?.name || "Expense"}</p>
                          <p className="text-xs text-mute">{category?.name ?? "Unknown"} · {timeTag(expense.timestamp)}</p></div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold">{money(categorySpend(expense, finance))}</p>
                          {categorySpend(expense, finance) !== expense.amount && <p className="text-xs text-mute">{money(expense.amount)} total</p>}
                        </div>
                      </article>
                    );
                  })}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
