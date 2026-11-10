import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addExpense, deleteExpense, updateExpense } from "../../lib/services/expenses";
import { friendNameKey, normalizeFriendName, removeExpenseFinanceData, replaceExpenseFinanceData, restoreFinanceData } from "../../lib/services/finance";
import { addExpenseToTrip, createTrip, listTrips, moveExpenseToTrip, removeExpensesFromTrips } from "../../lib/services/trips";
import { captureState, undoCreate, undoEdit } from "../../lib/services/transactions";
import { errorMessage } from "../../lib/errors";
import type { Expense, Trip } from "../../types";
import { money } from "../../lib/utils";

type PaymentMode = "self" | "friend_paid" | "paid_for_friend" | "borrowed";
const MODES: { value: PaymentMode; label: string; hint: string }[] = [
  { value: "self", label: "I paid", hint: "Paid from your own account. Your balance and the category both go down by the full amount." },
  { value: "friend_paid", label: "Someone else paid", hint: "Enter only your share. It counts in your category spending and is added to what you owe them, but your account balance does not change until you settle." },
  { value: "paid_for_friend", label: "I paid for others", hint: "Enter what you paid in total. Your account goes down by that amount, but only your own share counts in the category. The rest is recorded as money owed to you." },
  { value: "borrowed", label: "Borrowed money", hint: "Spent with money borrowed from someone. It counts in the category, and the amount is recorded as payable to the lender. Your account is unchanged until you repay." },
];

const Field = ({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-sm font-medium text-text">{label}</span>
    {children}
    {error ? <span role="alert" className="mt-1 block text-xs text-red-300">{error}</span>
      : hint ? <span className="mt-1 block text-xs text-mute">{hint}</span> : null}
  </label>
);

export default function ExpenseForm({ onClose, expense }: { onClose: () => void; expense?: Expense }) {
  const { uid, categories, expenses, finance } = useData(); const qc = useQueryClient();
  const [amount, setAmount] = useState(""); const [categoryId, setCat] = useState(""); const [note, setNote] = useState(""); const [dt, setDt] = useState(""); const [pickerOpen, setPickerOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("self");
  const [friendName, setFriendName] = useState("");
  const [borrowedFrom, setBorrowedFrom] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState("");
  const [newTripName, setNewTripName] = useState("");
  const [submitted, setSubmitted] = useState(false);
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
    const linkedBorrowing = finance.borrowings?.find((item) => item.expenseId === expense.$id);
    if (friendPaid) {
      setPaymentMode("friend_paid");
      setFriendName(friendPaid.friend);
      setSplitFriends([]);
    } else if (sharedLoans.length) {
      setPaymentMode("paid_for_friend");
      setSplitMode("exact");
      setSplitFriends(sharedLoans.map((loan) => ({ name: loan.friend, share: String(loan.amount) })));
    } else if (linkedBorrowing) {
      setPaymentMode("borrowed");
      setBorrowedFrom(linkedBorrowing.lender);
    } else {
      setPaymentMode("self");
      setFriendName("");
      setSplitFriends([]);
    }
  }, [expense, finance.friendPaidExpenses, finance.loans, finance.borrowings]);
  useEffect(() => {
    if (!expense || trips.length === 0) return;
    const existingTrip = trips.find((trip) => trip.expenseIds.includes(expense.$id));
    setTripId(existingTrip?.id ?? "");
  }, [expense, trips]);

  const expenseAmount = parseFloat(amount);
  const exactShares = splitFriends.reduce((sum, person) => sum + (parseFloat(person.share) || 0), 0);
  const friendKeys = splitFriends.map((person) => friendNameKey(person.name)).filter(Boolean);

  // Validation: every rule produces a specific message shown next to the field after the first submit attempt.
  const errors: Record<string, string> = {};
  if (!(expenseAmount > 0)) errors.amount = "Enter an amount greater than zero.";
  if (!categoryId) errors.category = "Choose a category.";
  if (dt && !Number.isFinite(new Date(dt).getTime())) errors.date = "Enter a valid date and time.";
  if (paymentMode === "friend_paid" && !normalizeFriendName(friendName)) errors.payer = "Enter the name of the person who paid.";
  if (paymentMode === "borrowed" && !normalizeFriendName(borrowedFrom)) errors.lender = "Enter the name of the person you borrowed from.";
  if (paymentMode === "paid_for_friend") {
    if (splitFriends.length === 0) errors.split = "Add at least one person you paid for.";
    else if (splitFriends.some((person) => !normalizeFriendName(person.name))) errors.split = "Every person needs a name.";
    else if (new Set(friendKeys).size !== friendKeys.length) errors.split = "Each person can only be added once.";
    else if (splitMode === "exact" && splitFriends.some((person) => !(parseFloat(person.share) > 0))) errors.split = "Enter an amount greater than zero for each person.";
    else if (splitMode === "exact" && exactShares > expenseAmount) errors.split = `The amounts add up to ${money(exactShares)}, which is more than the total of ${money(expenseAmount)}.`;
  }
  const valid = Object.keys(errors).length === 0;
  const show = (key: string) => (submitted ? errors[key] : undefined);

  const m = useMutation({
    mutationFn: async () => {
      const timestamp = dt ? new Date(dt).toISOString() : new Date().toISOString();
      if (!Number.isFinite(expenseAmount) || expenseAmount <= 0) throw new Error("Enter an amount greater than zero.");

      if (expense) {
        // Money already settled against this transaction cannot be silently dropped by changing who paid.
        const debt = finance.friendPaidExpenses?.find((item) => item.expenseId === expense.$id);
        const loans = finance.loans.filter((loan) => loan.expenseId === expense.$id);
        const borrowing = finance.borrowings?.find((item) => item.expenseId === expense.$id);
        const locked = (debt && (debt.repaid ?? 0) > 0 && (paymentMode !== "friend_paid" || friendNameKey(friendName) !== friendNameKey(debt.friend)))
          || (loans.some((loan) => loan.repaid > 0 && (paymentMode !== "paid_for_friend" || !friendKeys.includes(friendNameKey(loan.friend)))))
          || (borrowing && borrowing.repaid > 0 && paymentMode !== "borrowed");
        if (locked) throw new Error("Payments have already been settled against this transaction, so who paid can't be changed. Delete the settlement first, or edit only the amount, category or note.");
      }

      const before = expense ? await captureState() : null;
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
        let friendPaid: { expenseId: string; friend: string; amount: number; originalAmount: number; personalShare: number; timestamp: string } | null = null;
        if (paymentMode === "friend_paid") {
          // The amount entered is the user's own share; the payer is owed all of it.
          friendPaid = {
            expenseId,
            friend: normalizeFriendName(friendName),
            amount: expenseAmount,
            originalAmount: expenseAmount,
            personalShare: expenseAmount,
            timestamp,
          };
        }
        if (paymentMode === "paid_for_friend") {
          splitFriends.forEach((person) => {
            const name = normalizeFriendName(person.name);
            if (!name) return;
            const key = friendNameKey(name);
            const share = splitMode === "equal"
              ? expenseAmount / (splitFriends.length + 1)
              : parseFloat(person.share || "0");
            uniqueFriends.set(key, (uniqueFriends.get(key) ?? 0) + share);
          });
        }
        const borrowing = paymentMode === "borrowed" && normalizeFriendName(borrowedFrom)
          ? {
            lender: normalizeFriendName(borrowedFrom),
            amount: expenseAmount,
            note: note.trim() || "Paid with borrowed money",
            timestamp,
          }
          : null;
        await replaceExpenseFinanceData(
          expenseId,
          friendPaid,
          [...uniqueFriends].map(([key, share]) => {
            const person = splitFriends.find((item) => friendNameKey(item.name) === key);
            return {
              friend: person ? normalizeFriendName(person.name) : key,
              amount: share,
              note: note.trim() || "Paid through an expense",
              timestamp,
              expenseId,
            };
          }),
          borrowing,
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
            restoreFinanceData(finance),
          ]);
        }
        throw error;
      }
      const after = before ? await captureState() : null;
      return { expenseId, undo: before && after ? { before, after, expenses: [] } : null };
    },
    onSuccess: ({ expenseId, undo }) => {
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ["expenses"] });
        qc.invalidateQueries({ queryKey: ["finance"] });
        qc.invalidateQueries({ queryKey: ["trips"] });
      };
      refresh();
      toast.success(expense ? "Transaction updated" : "Transaction added", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            const run = expense && undo ? undoEdit(expense, undo) : undoCreate(expenseId);
            run.then(() => { refresh(); toast.success(expense ? "Changes reverted" : "Transaction removed"); })
              .catch((error) => toast.error(errorMessage(error, "Couldn't undo that change.")));
          },
        },
      });
      onClose();
    },
    onError: (e: unknown) => toast.error(errorMessage(e, "Couldn't save the transaction. Please try again.")),
  });

  const friendSuggestions = [...new Set([
    ...finance.loans.map((loan) => normalizeFriendName(loan.friend)),
    ...(finance.friendPaidExpenses ?? []).map((debt) => normalizeFriendName(debt.friend)),
    ...(finance.borrowings ?? []).map((borrowing) => normalizeFriendName(borrowing.lender)),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const noteSuggestions = [...new Set([
    ...expenses.map((item) => item.note.trim()).filter(Boolean),
  ])].slice(0, 20);
  const selectedCategory = categories.find((category) => category.$id === categoryId);
  const mode = MODES.find((item) => item.value === paymentMode)!;
  const yourShare = Math.max(expenseAmount - (splitMode === "equal"
    ? expenseAmount * splitFriends.length / (splitFriends.length + 1) : exactShares), 0);

  return (
    <Modal title={expense ? "Edit transaction" : "Add transaction"} onClose={onClose}>
      <form className="space-y-4" noValidate onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (valid && !m.isPending) m.mutate();
        else if (!valid) toast.error(Object.values(errors)[0]);
      }}>
        <datalist id="expense-note-suggestions">
          {noteSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <datalist id="friend-name-suggestions">
          {friendSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Who paid?</legend>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((item) => (
              <button key={item.value} type="button" aria-pressed={paymentMode === item.value}
                className={`min-h-11 rounded-lg border px-2 text-sm leading-tight ${paymentMode === item.value ? "border-accent bg-accent/10 font-medium text-accent" : "border-line bg-ink text-mute"}`}
                onClick={() => setPaymentMode(item.value)}>{item.label}</button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-mute">{mode.hint}</p>
        </fieldset>

        <Field label={paymentMode === "friend_paid" ? "Your share (₹)" : paymentMode === "paid_for_friend" ? "Total you paid (₹)" : "Amount (₹)"} error={show("amount")}>
          <input className="input" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={amount}
            aria-invalid={!!show("amount")} onChange={(e) => setAmount(e.target.value)} autoFocus={!expense} />
        </Field>

        <Field label="Category" error={show("category")}>
          <button type="button" className="input flex items-center justify-between gap-3 text-left" aria-haspopup="listbox" aria-expanded={pickerOpen}
            aria-invalid={!!show("category")} onClick={() => setPickerOpen(true)}>
            {selectedCategory ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-3 shrink-0 rounded-full" style={{ background: selectedCategory.color }} />
                <span className="truncate">{selectedCategory.name}</span>
              </span>
            ) : <span className="text-mute">Select a category</span>}
            <span aria-hidden="true" className="shrink-0 text-mute">⌄</span>
          </button>
        </Field>

        {paymentMode === "friend_paid" && (
          <Field label="Paid by" error={show("payer")}>
            <input className="input" list="friend-name-suggestions" value={friendName} autoComplete="off" aria-invalid={!!show("payer")}
              onChange={(e) => setFriendName(e.target.value)} placeholder="Name of the person who paid" />
          </Field>
        )}
        {paymentMode === "borrowed" && (
          <Field label="Borrowed from" error={show("lender")}>
            <input className="input" list="friend-name-suggestions" value={borrowedFrom} autoComplete="off" aria-invalid={!!show("lender")}
              onChange={(e) => setBorrowedFrom(e.target.value)} placeholder="Name of the lender" />
          </Field>
        )}
        {paymentMode === "paid_for_friend" && (
          <div className="space-y-3 rounded-xl border border-line bg-ink p-3">
            <p className="text-sm font-medium">Who did you pay for?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`btn-ghost ${splitMode === "equal" ? "!border-accent !bg-accent/10 !text-accent" : ""}`}
                onClick={() => setSplitMode("equal")}>Split equally</button>
              <button type="button" className={`btn-ghost ${splitMode === "exact" ? "!border-accent !bg-accent/10 !text-accent" : ""}`}
                onClick={() => setSplitMode("exact")}>Exact amounts</button>
            </div>
            <div className="space-y-2">
              {splitFriends.map((person, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto] gap-2">
                  <input className="input" list="friend-name-suggestions" value={person.name} placeholder="Name" autoComplete="off" aria-label={`Person ${index + 1} name`}
                    onChange={(event) => setSplitFriends(splitFriends.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                  <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-mute hover:text-red-300" aria-label={`Remove ${person.name || `person ${index + 1}`}`}
                    onClick={() => setSplitFriends(splitFriends.filter((_, itemIndex) => itemIndex !== index))}>✕</button>
                  {splitMode === "exact" && <input className="input col-span-2" type="number" min="0" step="0.01" inputMode="decimal"
                    value={person.share} placeholder="Amount they owe you" aria-label={`Amount ${person.name || `person ${index + 1}`} owes you`}
                    onChange={(event) => setSplitFriends(splitFriends.map((item, itemIndex) => itemIndex === index ? { ...item, share: event.target.value } : item))} />}
                </div>
              ))}
              <button type="button" className="min-h-11 text-sm font-medium text-accent"
                onClick={() => setSplitFriends([...splitFriends, { name: "", share: "" }])}>+ Add a person</button>
            </div>
            {show("split") && <p role="alert" className="text-xs text-red-300">{show("split")}</p>}
            {expenseAmount > 0 && splitFriends.length > 0 && (
              <p className="text-xs text-mute">
                Your share: <span className="font-medium text-text">{money(yourShare)}</span>
                {" · "}Owed to you: <span className="font-medium text-text">{money(Math.max(expenseAmount - yourShare, 0))}</span>
              </p>
            )}
          </div>
        )}

        <Field label="Note (optional)">
          <input className="input" list="expense-note-suggestions" placeholder="What was this for?" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <fieldset className="rounded-xl border border-line bg-ink p-3">
          <legend className="px-1 text-sm font-medium">Trip (optional)</legend>
          <select className="input" aria-label="Trip" value={tripId} onChange={(event) => { setTripId(event.target.value); if (event.target.value) setNewTripName(""); }}>
            <option value="">Not part of a trip</option>
            {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
          </select>
          <input className="input mt-2" value={newTripName} placeholder="Or start a new trip, e.g. Goa 2026" aria-label="New trip name"
            onChange={(event) => { setNewTripName(event.target.value); if (event.target.value) setTripId(""); }} />
        </fieldset>

        <Field label="Date and time" error={show("date")} hint="Leave empty to use the current time.">
          <input className="input" type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} />
        </Field>

        <button className="btn w-full disabled:opacity-40" type="submit" disabled={m.isPending}>
          {m.isPending ? "Saving…" : expense ? "Save changes" : "Add transaction"}
        </button>
      </form>
      {pickerOpen && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" role="presentation" onClick={() => setPickerOpen(false)}>
        <section className="max-h-[75dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-line bg-panel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl"
          role="listbox" aria-label="Choose a category" onClick={(event) => event.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Choose a category</h3>
            <button type="button" className="grid min-h-11 min-w-11 place-items-center text-mute" aria-label="Close categories" onClick={() => setPickerOpen(false)}>✕</button></div>
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
