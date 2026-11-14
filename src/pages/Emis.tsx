import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useData } from "../lib/hooks";
import { useConfirm } from "../components/Confirm";
import Modal from "../components/Modal";
import EmiForm from "../components/forms/EmiForm";
import { deleteEmi, emiDueLaterThisMonth, emiProgress, stopEmi, todayString } from "../lib/services/emis";
import { parseDate } from "../lib/emiSchedule";
import { errorMessage } from "../lib/errors";
import { money } from "../lib/utils";
import type { EmiPlan } from "../types";

const prettyDate = (date: string) => {
  const d = parseDate(date);
  return d ? new Date(d.y, d.m - 1, d.d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : date;
};

export default function Emis() {
  const { emis, expenses, categories, loading } = useData();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EmiPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayString();
  const existing = new Set(expenses.map((expense) => expense.$id));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["emis"] }); qc.invalidateQueries({ queryKey: ["expenses"] }); };
  const later = emiDueLaterThisMonth(emis);
  const totalRemaining = emis.reduce((sum, plan) => sum + emiProgress(plan).remaining, 0);
  const active = emis.filter((plan) => !emiProgress(plan).finished);
  const finished = emis.filter((plan) => emiProgress(plan).finished);

  const stop = async (plan: EmiPlan) => {
    const progress = emiProgress(plan);
    const ok = await confirm({
      title: `Stop “${plan.name}”?`,
      message: `The ${progress.remainingCount} remaining payment${progress.remainingCount === 1 ? "" : "s"} (${money(progress.remaining)}) will be cancelled. Payments already added stay in your transactions. Paid it off early? Add that last payment as a normal transaction, then stop the plan.`,
      confirmLabel: "Stop remaining", destructive: true,
    });
    if (!ok) return;
    try { await stopEmi(plan.id); refresh(); toast.success("Remaining payments cancelled"); }
    catch (error) { toast.error(errorMessage(error, "Couldn't stop the plan.")); }
  };

  const remove = async (withTransactions: boolean) => {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await deleteEmi(deleting.id, expenses, withTransactions);
      refresh(); qc.invalidateQueries({ queryKey: ["finance"] }); qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success(withTransactions ? `Plan and ${result.deleted} payment${result.deleted === 1 ? "" : "s"} deleted` : "Plan deleted. Its payments stay in your transactions.");
      setDeleting(null);
    } catch (error) { toast.error(errorMessage(error, "Couldn't delete the plan.")); }
    finally { setBusy(false); }
  };

  if (loading) return <p className="text-mute" role="status">Loading your EMIs…</p>;

  const card = (plan: EmiPlan) => {
    const progress = emiProgress(plan);
    const category = categories.find((item) => item.$id === plan.categoryId);
    const pct = progress.totalCount ? (progress.paidCount / progress.totalCount) * 100 : 100;
    const isOpen = open === plan.id;
    return (
      <article key={plan.id} className="min-w-0 rounded-xl border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{plan.name}</h3>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-mute">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: category?.color ?? "#64748b" }} aria-hidden="true" />{category?.name ?? "Uncategorised"}
              {plan.annualRate ? <span>· {plan.annualRate}% a year</span> : null}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${progress.finished ? "bg-emerald-400/10 text-emerald-300" : "bg-accent/10 text-accent"}`}>
            {plan.stopped ? "Stopped" : progress.finished ? "Completed" : "Active"}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded bg-ink"><div className="h-2 rounded bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1.5 flex justify-between gap-3 text-xs text-mute">
          <span>{progress.paidCount} of {progress.totalCount} payments added</span>
          <span>{progress.remaining > 0 ? `${money(progress.remaining)} still to pay` : "Nothing left to pay"}</span>
        </p>
        {progress.next && <p className="mt-2 text-sm">Next: <span className="font-medium">{money(progress.next.amount)}</span> <span className="text-mute">on {prettyDate(progress.next.due)}</span></p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost !min-h-10 !px-3 text-sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : plan.id)}>{isOpen ? "Hide schedule" : "Schedule"}</button>
          {progress.remainingCount > 0 && !plan.stopped && <button type="button" className="btn-ghost !min-h-10 !px-3 text-sm" onClick={() => void stop(plan)}>Stop remaining</button>}
          <button type="button" className="min-h-10 rounded-lg px-3 text-sm text-mute hover:bg-red-500/10 hover:text-red-300" onClick={() => setDeleting(plan)}>Delete</button>
        </div>
        {isOpen && (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-ink text-sm">
            {plan.upfront && (() => {
              const u = plan.upfront;
              const state = u.cancelled ? "Cancelled" : u.expenseId ? (existing.has(u.expenseId) ? "Added" : "Deleted") : u.date <= today ? "Due" : "Upcoming";
              return <li className="flex items-center justify-between gap-3 px-3 py-2"><span><span className="block">Down payment and fees</span><span className="block text-xs text-mute">{prettyDate(u.date)}</span></span><span className="text-right"><span className="block font-medium">{money(u.amount)}</span><span className="block text-xs text-mute">{state}</span></span></li>;
            })()}
            {plan.installments.map((item) => {
              const state = item.cancelled ? "Cancelled" : item.expenseId ? (existing.has(item.expenseId) ? "Added" : "Deleted") : item.due <= today ? "Due" : "Upcoming";
              return (
                <li key={item.n} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span><span className="block">EMI {item.n} of {plan.installments.length}</span><span className="block text-xs text-mute">{prettyDate(item.due)}</span></span>
                  <span className="text-right"><span className={`block font-medium ${item.cancelled ? "text-mute line-through" : ""}`}>{money(item.amount)}</span><span className={`block text-xs ${state === "Added" ? "text-emerald-300" : "text-mute"}`}>{state}</span></span>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    );
  };

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-bold">EMIs</h2><p className="text-sm text-mute">Things you are paying off in monthly installments.</p></div>
        <button className="btn w-full shrink-0 sm:w-auto" onClick={() => setAdding(true)}>Add an EMI</button>
      </header>

      {emis.length > 0 && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-panel p-4"><p className="text-sm text-mute">Still to pay</p><p className="mt-1 text-xl font-bold">{money(totalRemaining)}</p><p className="text-xs text-mute">{active.length} active EMI{active.length === 1 ? "" : "s"}</p></div>
          <div className="rounded-xl border border-line bg-panel p-4"><p className="text-sm text-mute">Due later this month</p><p className="mt-1 text-xl font-bold">{money(later.total)}</p><p className="text-xs text-mute">{later.count} payment{later.count === 1 ? "" : "s"}</p></div>
        </section>
      )}

      {emis.length === 0 ? (
        <section className="rounded-xl border border-line bg-panel p-8 text-center">
          <p className="font-semibold">No EMIs yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-mute">Bought something in installments? Add it once and each month's payment is added to your transactions on its due date.</p>
          <button className="btn mt-4" onClick={() => setAdding(true)}>Add your first EMI</button>
        </section>
      ) : (
        <>
          <div className="space-y-3">{active.map(card)}</div>
          {finished.length > 0 && <><h3 className="px-1 pt-2 text-xs font-medium uppercase tracking-wide text-mute">Completed</h3><div className="space-y-3">{finished.map(card)}</div></>}
        </>
      )}

      {adding && <EmiForm onClose={() => setAdding(false)} />}
      {deleting && (
        <Modal title={`Delete “${deleting.name}”?`} onClose={() => { if (!busy) setDeleting(null); }}>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-mute">What should happen to the payments already added to your transactions?</p>
            <div className="space-y-2">
              <button type="button" className="btn w-full disabled:opacity-50" disabled={busy} onClick={() => void remove(false)}>Delete the plan, keep the payments</button>
              <button type="button" className="min-h-11 w-full rounded-lg bg-red-500 px-4 font-semibold text-white hover:bg-red-600 disabled:opacity-50" disabled={busy} onClick={() => void remove(true)}>Delete the plan and its payments</button>
              <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
