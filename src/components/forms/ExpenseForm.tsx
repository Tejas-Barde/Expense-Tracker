import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addExpense, deleteExpense, updateExpense } from "../../lib/services/expenses";
import { normalizeFriendName, removeExpenseFinanceData, replaceExpenseFinanceData } from "../../lib/services/finance";
import { addExpenseToTrip, createTrip, listTrips, moveExpenseToTrip } from "../../lib/services/trips";
import { removeExpensesFromTrips } from "../../lib/services/trips";
import type { Expense, Trip } from "../../types";
import { money } from "../../lib/utils";
export default function ExpenseForm({ onClose, expense }: { onClose: () => void; expense?: Expense }) {
  const { uid, categories, expenses, finance } = useData(); const qc = useQueryClient();
  const [amount, setAmount] = useState(""); const [categoryId, setCat] = useState(""); const [note, setNote] = useState(""); const [dt, setDt] = useState(""); const [pickerOpen, setPickerOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"self" | "friend_paid" | "paid_for_friend">("self");
  const [friendName, setFriendName] = useState("");
  const [friendShare, setFriendShare] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState("");
  const [newTripName, setNewTripName] = useState("");
  useEffect(() => { listTrips(uid).then(setTrips).catch(() => setTrips([])); }, [uid]);
  const [splitMode, setSplitMode] = useState<"equal" | "exact">("equal");
  const [splitFriends, setSplitFriends] = useState<{ name: string; share: string }[]>([]);
  useEffect(() => {
    if (!expense) return;
    setAmount(String(expense.amount));
    setCat(expense.categoryId);
    setNote(expense.note ?? "");
    const date = new Date(expense.timestamp);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setDt(local);
    const friendPaid = finance.friendPaidExpenses?.find((item) => item.expenseId === expense.$id);
    const sharedLoans = finance.loans.filter((loan) => loan.expenseId === expense.$id);
    if (friendPaid) {
      setPaymentMode("friend_paid");
      setFriendName(friendPaid.friend);
      setSplitMode("equal");
      setSplitFriends([]);
    } else if (sharedLoans.length) {
      setPaymentMode("paid_for_friend");
      setSplitMode("exact");
      setSplitFriends(sharedLoans.map((loan) => ({ name: loan.friend, share: String(loan.amount) })));
    } else {
      setPaymentMode("self");
      setFriendName("");
      setSplitFriends([]);
    }
  }, [expense, finance.friendPaidExpenses, finance.loans]);
  useEffect(() => {
    if (!expense || trips.length === 0) return;
    const existingTrip = trips.find((trip) => trip.expenseIds.includes(expense.$id));
    setTripId(existingTrip?.id ?? "");
  }, [expense, trips]);
  const m = useMutation({
    mutationFn: async () => {
      const timestamp = dt ? new Date(dt).toISOString() : new Date().toISOString();
      const expenseAmount = parseFloat(amount);
      if (!Number.isFinite(expenseAmount) || expenseAmount <= 0) throw new Error("Enter an amount greater than zero.");
      if (!Number.isFinite(new Date(timestamp).getTime())) throw new Error("Enter a valid transaction date.");
      const created = expense
        ? await updateExpense(expense.$id, { amount: expenseAmount, categoryId, note, timestamp })
        : await addExpense(uid, { amount: expenseAmount, categoryId, note, timestamp });
      const expenseId = expense?.$id ?? created.$id;
      try {
        let selectedTripId = tripId;
        if (newTripName.trim()) {
          const trip = await createTrip(uid, newTripName);
          selectedTripId = trip.id;
          setTrips((current) => [...current, trip]);
        }
        const uniqueFriends = new Map<string, number>();
        let friendPaid: { expenseId: string; friend: string; amount: number; originalAmount: number; timestamp: string } | null = null;
        if (paymentMode === "friend_paid") {
          const friendCount = Math.max(1, splitFriends.length + 1);
          const enteredShares = splitFriends.reduce((sum, person) => sum + parseFloat(person.share || "0"), 0);
          const yourShare = splitMode === "equal"
            ? expenseAmount / friendCount
            : Math.max(0, expenseAmount - enteredShares);
          friendPaid = {
            expenseId,
            friend: normalizeFriendName(friendName),
            amount: yourShare,
            originalAmount: expenseAmount,
            timestamp,
          };
        }
        if (paymentMode === "paid_for_friend") {
          splitFriends.forEach((person) => {
            const name = normalizeFriendName(person.name);
            if (!name) return;
            const key = name.toLocaleLowerCase();
            const share = splitMode === "equal"
              ? expenseAmount / (splitFriends.length + 1)
              : parseFloat(person.share || "0");
            uniqueFriends.set(key, (uniqueFriends.get(key) ?? 0) + share);
          });
        }
        await replaceExpenseFinanceData(
          expenseId,
          friendPaid,
          [...uniqueFriends].map(([key, share]) => {
            const person = splitFriends.find((item) => normalizeFriendName(item.name).toLocaleLowerCase() === key);
            return {
              friend: person ? normalizeFriendName(person.name) : key,
              amount: share,
              note: note.trim() || "Paid through an expense",
              timestamp,
              expenseId,
            };
          }),
        );
        if (expense) await moveExpenseToTrip(expenseId, selectedTripId);
        else if (selectedTripId) await addExpenseToTrip(selectedTripId, expenseId);
      } catch (error) {
        if (!expense) {
          await Promise.allSettled([deleteExpense(expenseId), removeExpenseFinanceData([expenseId]), removeExpensesFromTrips([expenseId])]);
        } else {
          await Promise.allSettled([
            updateExpense(expense.$id, { amount: expense.amount, categoryId: expense.categoryId, note: expense.note, timestamp: expense.timestamp }),
            moveExpenseToTrip(expense.$id, trips.find((trip) => trip.expenseIds.includes(expense.$id))?.id ?? ""),
            removeExpenseFinanceData([expense.$id]),
          ]);
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success(expense ? "Transaction updated" : "Expense added");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const expenseAmount = parseFloat(amount);
  const shareAmount = parseFloat(friendShare);
  const exactShares = splitFriends.reduce((sum, person) => sum + parseFloat(person.share || "0"), 0);
  const normalizedFriendNames = splitFriends.map((person) => normalizeFriendName(person.name).toLocaleLowerCase()).filter(Boolean);
  const hasValidFriends = splitFriends.length === 0 || (
    splitFriends.every((person) => normalizeFriendName(person.name).length > 0)
    && new Set(normalizedFriendNames).size === normalizedFriendNames.length
  );
  const splitValid = splitMode === "equal"
    ? paymentMode === "friend_paid"
      ? hasValidFriends
      : splitFriends.length > 0 && hasValidFriends
    : splitFriends.length > 0 && exactShares > 0 && hasValidFriends
      && (paymentMode === "friend_paid" ? exactShares < expenseAmount : exactShares <= expenseAmount);
  const friendSuggestions = [...new Set([
    ...finance.loans.map((loan) => normalizeFriendName(loan.friend)),
    ...(finance.friendPaidExpenses ?? []).map((debt) => normalizeFriendName(debt.friend)),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const noteSuggestions = [...new Set([
    ...expenses.map((expense) => expense.note.trim()).filter(Boolean),
  ])].slice(0, 20);
  const ok = expenseAmount > 0 && !!categoryId
    && (paymentMode === "self"
      || (paymentMode === "friend_paid" && normalizeFriendName(friendName).length > 0 && splitValid)
      || (paymentMode === "paid_for_friend" && splitValid));
  return (
    <Modal title={expense ? "Edit transaction" : "Add expense"} onClose={onClose}>
      <div className="space-y-3">
        <datalist id="expense-note-suggestions">
          {noteSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <datalist id="friend-name-suggestions">
          {friendSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
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
        <fieldset className="rounded-xl border border-line bg-ink p-3">
          <legend className="px-1 text-sm text-mute">Trip (optional)</legend>
          <select className="input" value={tripId} onChange={(event) => { setTripId(event.target.value); if (event.target.value) setNewTripName(""); }}>
            <option value="">No trip</option>
            {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
          </select>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-mute">or</span>
            <input className="input flex-1" value={newTripName} placeholder="Create a trip, e.g. Goa 2026"
              onChange={(event) => { setNewTripName(event.target.value); if (event.target.value) setTripId(""); }} />
          </div>
        </fieldset>
        <input className="input" list="expense-note-suggestions" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
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
          <div className="space-y-3 rounded-xl border border-line bg-ink p-3">
            {paymentMode === "friend_paid" && (
              <label className="block text-sm text-mute">Friend who paid
                <input className="input mt-1" list="friend-name-suggestions" value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="Friend name" /></label>
            )}
            <div className="flex gap-2">
              <button type="button" className={`btn-ghost flex-1 ${splitMode === "equal" ? "!bg-accent/10 !text-accent" : ""}`}
                onClick={() => setSplitMode("equal")}>Split equally</button>
              <button type="button" className={`btn-ghost flex-1 ${splitMode === "exact" ? "!bg-accent/10 !text-accent" : ""}`}
                onClick={() => setSplitMode("exact")}>Exact amounts</button>
            </div>
            <div className="space-y-2">
              {splitFriends.map((person, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_8rem_auto]">
                  <input className="input" list="friend-name-suggestions" value={person.name} placeholder="Friend name" autoComplete="off"
                    onChange={(event) => setSplitFriends(splitFriends.map((item, itemIndex) => itemIndex === index
                      ? { ...item, name: event.target.value } : item))} />
                  {splitMode === "exact" && <input className="input" type="number" min="0" step="0.01" inputMode="decimal"
                    value={person.share} placeholder="Amount"
                    onChange={(event) => setSplitFriends(splitFriends.map((item, itemIndex) => itemIndex === index
                      ? { ...item, share: event.target.value } : item))} />}
                  <button type="button" className="min-h-11 min-w-11 text-mute" aria-label={`Remove ${person.name || "friend"}`}
                    onClick={() => setSplitFriends(splitFriends.filter((_, itemIndex) => itemIndex !== index))}>✕</button>
                </div>
              ))}
              <button type="button" className="min-h-11 text-sm text-accent"
                onClick={() => setSplitFriends([...splitFriends, { name: "", share: "" }])}>+ Add friend</button>
            </div>
            <p className="text-xs text-mute">
              {splitMode === "equal"
                ? `Estimated ${paymentMode === "friend_paid" ? "your share" : "each share"}: ${expenseAmount > 0 && (paymentMode === "friend_paid" || splitFriends.length > 0)
                  ? money(expenseAmount / (splitFriends.length + 1))
                  : "—"}`
                : `Friend shares entered: ${money(exactShares)} · Your share: ${money(Math.max(expenseAmount - exactShares, 0))}`}
            </p>
          </div>
        )}
        {paymentMode === "friend_paid" && <p className="text-sm text-amber-300">This expense is excluded from personal spending. Your calculated share is added to what you owe this payer.</p>}
        {paymentMode === "paid_for_friend" && <p className="text-sm text-emerald-300">Friend names are merged by name. Their shares are added to Owing, while your share increases category spending.</p>}
        <button className="btn w-full disabled:opacity-40" disabled={!ok || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Saving…" : expense ? "Save changes" : "Add expense"}
        </button>
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
