import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useData } from "../lib/hooks";
import { deleteExpense } from "../lib/services/expenses";
import { dayLabel, timeTag, money } from "../lib/utils";
export default function Expenses() {
  const { categories, expenses } = useData(); const qc = useQueryClient();
  const [q, setQ] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const cat = (id: string) => categories.find((c) => c.$id === id);
  const del = useMutation({ mutationFn: deleteExpense,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); toast.success("Expense deleted"); }, onError: (e: any) => toast.error(e.message) });
  const groups = useMemo(() => {
    const s = q.toLowerCase(), g = new Map<string, typeof expenses>();
    expenses.filter((e) => {
      const t = e.timestamp.slice(0, 10);
      return (!from || t >= from) && (!to || t <= to) && (!s || e.note.toLowerCase().includes(s) || cat(e.categoryId)?.name.toLowerCase().includes(s) || dayLabel(e.timestamp).toLowerCase().includes(s));
    }).forEach((e) => { const k = dayLabel(e.timestamp); g.set(k, [...(g.get(k) ?? []), e]); });
    return [...g];
  }, [expenses, categories, q, from, to]);
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="input" placeholder="Search note, category or date" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
      {groups.length === 0 && <p className="text-mute">No expenses match. Add one with “Add expense”.</p>}
      {groups.map(([day, items]) => (
        <section key={day}>
          <h3 className="flex justify-between text-sm text-mute mb-2"><span>{day}</span><span>{money(items.reduce((s, e) => s + e.amount, 0))}</span></h3>
          <div className="space-y-2">{items.map((e) => { const c = cat(e.categoryId); return (
            <div key={e.$id} className="flex items-center gap-3 bg-panel border border-line rounded-lg p-3">
              <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-ink text-text font-medium">
                <span className="size-2 rounded-full shrink-0" style={{ background: c?.color ?? "#64748b" }} />
                {c?.name ?? "Unknown"}
              </span>
              <span className="text-xs text-mute">{timeTag(e.timestamp)}</span>
              <span className="flex-1 truncate text-sm">{e.note}</span>
              <span className="font-semibold">{money(e.amount)}</span>
              <button className="text-mute hover:text-red-400" aria-label="Delete expense" onClick={() => del.mutate(e.$id)}>🗑</button>
            </div>); })}</div>
        </section>))}
    </div>
  );
}
