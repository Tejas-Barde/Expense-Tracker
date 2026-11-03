import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addExpense } from "../../lib/services/expenses";
import { addFriendPaidExpense, addLoan } from "../../lib/services/finance";
export default function ExpenseForm({ onClose }: { onClose: () => void }) {
  const { uid, categories } = useData(); const qc = useQueryClient();
  const [amount, setAmount] = useState(""); const [categoryId, setCat] = useState(""); const [note, setNote] = useState(""); const [dt, setDt] = useState(""); const [pickerOpen, setPickerOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"self" | "friend_paid" | "paid_for_friend">("self");
  const [friendName, setFriendName] = useState("");
  const [friendShare, setFriendShare] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const timestamp = dt ? new Date(dt).toISOString() : new Date().toISOString();
      const expenseAmount = parseFloat(amount);
      const created = await addExpense(uid, { amount: expenseAmount, categoryId, note, timestamp });
      if (paymentMode === "friend_paid") {
        await addFriendPaidExpense({
          expenseId: created.$id,
          friend: friendName.trim(),
          amount: expenseAmount,
          timestamp,
        });
      }
      if (paymentMode === "paid_for_friend") {
        await addLoan({
          friend: friendName.trim(),
          amount: parseFloat(friendShare),
          note: note.trim() || "Paid through an expense",
          timestamp,
          expenseId: created.$id,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
      toast.success("Expense added");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const expenseAmount = parseFloat(amount);
  const shareAmount = parseFloat(friendShare);
  const ok = expenseAmount > 0 && !!categoryId
    && (paymentMode === "self"
      || (friendName.trim().length > 0 && (paymentMode !== "paid_for_friend" || (shareAmount > 0 && shareAmount <= expenseAmount))));
  return (
    <Modal title="Add expense" onClose={onClose}>
      <div className="space-y-3">
        <input className="input" type="number" min="0" step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <button type="button" className="input flex items-center justify-between gap-3 text-left" aria-haspopup="listbox" aria-expanded={pickerOpen}
          onClick={() => setPickerOpen(true)}>
          {categories.find((category) => category.$id === categoryId) ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ background: categories.find((category) => category.$id === categoryId)?.color }} />
              <span className="truncate">{categories.find((category) => category.$id === categoryId)?.name}</span>
            </span>
          ) : <span className="text-mute">Choose category</span>}
          <span aria-hidden="true" className="shrink-0 text-mute">⌄</span>
        </button>
        <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="block text-sm text-mute">Date & time (leave empty to use right now)
          <input className="input mt-1" type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} /></label>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm text-mute">Who paid?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ["self", "I paid"],
              ["friend_paid", "Friend paid"],
              ["paid_for_friend", "I paid for friend"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" className={`min-h-11 rounded-lg border px-3 text-sm ${paymentMode === value ? "border-accent bg-accent/10 text-accent" : "border-line bg-ink text-mute"}`}
                aria-pressed={paymentMode === value} onClick={() => setPaymentMode(value)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {paymentMode !== "self" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-mute">Friend's name
              <input className="input mt-1" value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="Friend name" /></label>
            {paymentMode === "paid_for_friend" && (
              <label className="block text-sm text-mute">Friend owes
                <input className="input mt-1" type="number" min="0.01" max={expenseAmount || undefined} step="0.01" inputMode="decimal"
                  value={friendShare} onChange={(e) => setFriendShare(e.target.value)} placeholder="Amount owed" /></label>
            )}
          </div>
        )}
        {paymentMode === "friend_paid" && <p className="text-sm text-amber-300">This expense is excluded from your spending and adds the amount to what you owe this friend.</p>}
        {paymentMode === "paid_for_friend" && <p className="text-sm text-emerald-300">Only your share is counted as personal spending; the friend owes the remaining amount in Owing.</p>}
        <button className="btn w-full disabled:opacity-40" disabled={!ok || m.isPending} onClick={() => m.mutate()}>Add expense</button>
      </div>
      {pickerOpen && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" role="presentation" onClick={() => setPickerOpen(false)}>
        <section className="w-full max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-line bg-panel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl"
          role="listbox" aria-label="Choose a category" onClick={(event) => event.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Choose category</h3>
            <button type="button" className="min-h-11 min-w-11 text-mute" aria-label="Close categories" onClick={() => setPickerOpen(false)}>✕</button></div>
          <div className="space-y-1">{categories.map((category) => (
            <button type="button" role="option" aria-selected={categoryId === category.$id} key={category.$id}
              className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left ${categoryId === category.$id ? "bg-ink text-text" : "text-mute hover:bg-ink"}`}
              onClick={() => { setCat(category.$id); setPickerOpen(false); }}>
              <span className="size-3 shrink-0 rounded-full" style={{ background: category.color }} />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              {categoryId === category.$id && <span className="text-accent" aria-hidden="true">✓</span>}
            </button>
          ))}</div>
        </section>
      </div>}
    </Modal>
  );
}
