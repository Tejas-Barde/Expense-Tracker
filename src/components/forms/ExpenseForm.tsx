import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addExpense, deleteExpense, updateExpense } from "../../lib/services/expenses";
import { friendNameKey, normalizeFriendName, removeExpenseFinanceData, replaceExpenseFinanceData, restoreFinanceData } from "../../lib/services/finance";
import { addExpenseToTrip, createTrip, listTrips, moveExpenseToTrip, removeExpensesFromTrips } from "../../lib/services/trips";
import { captureState, undoCreate, undoEdit } from "../../lib/services/transactions";
import { errorMessage } from "../../lib/errors";
import { isCatchAll, isSystemCategory } from "../../lib/services/categories";
import type { Expense, Trip } from "../../types";
import { evaluateAmount, localDate, money, round2, toLocalInput } from "../../lib/utils";

type PaymentMode = "self" | "friend_paid" | "paid_for_friend" | "borrowed";
const MODES: { value: PaymentMode; label: string; summary: string; hint: string }[] = [
  { value: "self", label: "I paid", summary: "You paid", hint: "Paid from your own account. Your balance and the category both go down by the full amount." },
  { value: "friend_paid", label: "Someone else paid", summary: "Someone else paid", hint: "Enter only your share as the amount. It counts in your category spending and is added to what you owe them, but your account balance does not change until you settle." },
  { value: "paid_for_friend", label: "I paid for others", summary: "You paid for others", hint: "Enter what you paid in total. Your account goes down by that amount, but only your own share counts in the category. The rest is recorded as money owed to you." },
  { value: "borrowed", label: "Borrowed money", summary: "Paid with borrowed money", hint: "Spent with money borrowed from someone. It counts in the category, and the amount is recorded as payable to the lender. Your account is unchanged until you repay." },
];

const Field = ({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-sm font-medium text-text">{label}</span>
    {children}
    {error ? <span role="alert" className="mt-1 block text-xs text-red-300">{error}</span>
      : hint ? <span className="mt-1 block text-xs text-mute">{hint}</span> : null}
  </label>
);

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export default function ExpenseForm({ onClose, expense, onEmi }: { onClose: () => void; expense?: Expense; onEmi?: () => void }) {
  const { uid, categories, expenses, finance } = useData(); const qc = useQueryClient();
  const [amount, setAmount] = useState(""); const [categoryId, setCat] = useState(""); const [note, setNote] = useState(""); const [dt, setDt] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("self");
  const [friendName, setFriendName] = useState("");
  const [borrowedFrom, setBorrowedFrom] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState("");
  const [newTripName, setNewTripName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [splitMode, setSplitMode] = useState<"equal" | "exact">("equal");
  const [splitFriends, setSplitFriends] = useState<{ name: string; share: string }[]>([]);
  const categoryTouched = useRef(false);
  const loadedFor = useRef<string | null>(null);
  const tripLoadedFor = useRef<string | null>(null);
  const againRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => { listTrips(uid).then(setTrips).catch(() => setTrips([])); }, [uid]);

  // Fill the form once per edited transaction. Later background refreshes must not overwrite what is being typed.
  useEffect(() => {
    if (!expense || loadedFor.current === expense.$id) return;
    loadedFor.current = expense.$id;
    setAmount(String(expense.amount));
    setCat(expense.categoryId);
    categoryTouched.current = true;
    setNote(expense.note ?? "");
    setDt(toLocalInput(new Date(expense.timestamp)));
    const friendPaid = finance.friendPaidExpenses?.find((item) => item.expenseId === expense.$id);
    const sharedLoans = finance.loans.filter((loan) => loan.expenseId === expense.$id);
    const linkedBorrowing = finance.borrowings?.find((item) => item.expenseId === expense.$id);
    if (friendPaid) {
      setPaymentMode("friend_paid"); setFriendName(friendPaid.friend); setSplitFriends([]); setShowMore(true);
    } else if (sharedLoans.length) {
      setPaymentMode("paid_for_friend"); setSplitMode("exact"); setShowMore(true);
      setSplitFriends(sharedLoans.map((loan) => ({ name: loan.friend, share: String(loan.amount) })));
    } else if (linkedBorrowing) {
      setPaymentMode("borrowed"); setBorrowedFrom(linkedBorrowing.lender); setShowMore(true);
    }
  }, [expense, finance.friendPaidExpenses, finance.loans, finance.borrowings]);
  useEffect(() => {
    if (!expense || trips.length === 0 || tripLoadedFor.current === expense.$id) return;
    tripLoadedFor.current = expense.$id;
    const existingTrip = trips.find((trip) => trip.expenseIds.includes(expense.$id));
    setTripId(existingTrip?.id ?? "");
    if (existingTrip) setShowMore(true);
  }, [expense, trips]);

  // ---- Derived values ---------------------------------------------------------------------------------
  const parsedAmount = evaluateAmount(amount);
  const expenseAmount = parsedAmount ?? NaN;
  const isFormula = /[+\-*/x×÷]/i.test(amount.replace(/^\s*-/, ""));
  const exactShares = splitFriends.reduce((sum, person) => sum + (parseFloat(person.share) || 0), 0);
  const friendKeys = splitFriends.map((person) => friendNameKey(person.name)).filter(Boolean);

  const visibleCategories = categories.filter((category) => !isSystemCategory(category) || category.$id === categoryId);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    expenses.forEach((item) => { result[item.categoryId] = (result[item.categoryId] ?? 0) + 1; });
    return result;
  }, [expenses]);
  // Most-used categories first, so the one you want is usually the first or second chip. "Other" stays last.
  const orderedCategories = [...visibleCategories].sort((a, b) =>
    Number(isCatchAll(a)) - Number(isCatchAll(b)) || (counts[b.$id] ?? 0) - (counts[a.$id] ?? 0) || a.name.localeCompare(b.name));
  const noteCategory = useMemo(() => {
    const known = new Map<string, string>();
    [...expenses].reverse().forEach((item) => { if (item.note.trim()) known.set(item.note.trim().toLocaleLowerCase(), item.categoryId); });
    return known; // the most recent use of each note wins
  }, [expenses]);

  const errors: Record<string, string> = {};
  if (amount.trim() === "" || parsedAmount === null) errors.amount = amount.trim() === "" ? "Enter an amount." : "Enter an amount like 250, or a sum like 250+120.";
  else if (!(parsedAmount > 0)) errors.amount = "Enter an amount greater than zero.";
  if (!categoryId) errors.category = "Choose a category.";
  if (dt && !Number.isFinite(new Date(dt).getTime())) errors.date = "Enter a valid date and time.";
  if (paymentMode === "friend_paid" && !normalizeFriendName(friendName)) errors.payer = "Enter the name of the person who paid.";
  if (paymentMode === "borrowed" && !normalizeFriendName(borrowedFrom)) errors.lender = "Enter the name of the person you borrowed from.";
  if (paymentMode === "paid_for_friend") {
    if (splitFriends.length === 0) errors.split = "Add at least one person you paid for.";
    else if (splitFriends.some((person) => !normalizeFriendName(person.name))) errors.split = "Every person needs a name.";
    else if (new Set(friendKeys).size !== friendKeys.length) errors.split = "Each person can only be added once.";
    else if (splitMode === "exact" && splitFriends.some((person) => !(parseFloat(person.share) > 0))) errors.split = "Enter an amount greater than zero for each person.";
    else if (splitMode === "exact" && exactShares > expenseAmount + 0.001) errors.split = `The amounts add up to ${money(exactShares)}, which is more than the total of ${money(expenseAmount)}.`;
  }
  const valid = Object.keys(errors).length === 0;
  const show = (key: string) => (submitted ? errors[key] : undefined);

  // ---- Saving -----------------------------------------------------------------------------------------
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
        ? await updateExpense(expense.$id, { amount: expenseAmount, categoryId, note: note.trim(), timestamp })
        : await addExpense(uid, { amount: expenseAmount, categoryId, note: note.trim(), timestamp });
      const expenseId = expense?.$id ?? created.$id;
      try {
        let selectedTripId = tripId;
        const wantedTrip = newTripName.trim();
        if (wantedTrip) {
          // Typing the name of a trip that already exists simply uses that trip.
          const existing = (await listTrips(uid)).find((trip) => sameName(trip.name, wantedTrip));
          const trip = existing ?? await createTrip(uid, wantedTrip);
          selectedTripId = trip.id;
          setTrips((current) => current.some((item) => item.id === trip.id) ? current : [...current, trip]);
        }
        const uniqueFriends = new Map<string, number>();
        let friendPaid: { expenseId: string; friend: string; amount: number; originalAmount: number; personalShare: number; timestamp: string } | null = null;
        if (paymentMode === "friend_paid") {
          // The amount entered is the user's own share; the payer is owed all of it.
          friendPaid = { expenseId, friend: normalizeFriendName(friendName), amount: expenseAmount, originalAmount: expenseAmount, personalShare: expenseAmount, timestamp };
        }
        if (paymentMode === "paid_for_friend") {
          splitFriends.forEach((person) => {
            const name = normalizeFriendName(person.name);
            if (!name) return;
            const key = friendNameKey(name);
            // Round each friend's share to the paisa; your own share is whatever remains, so the parts always add up.
            const share = splitMode === "equal" ? round2(expenseAmount / (splitFriends.length + 1)) : round2(parseFloat(person.share || "0"));
            uniqueFriends.set(key, (uniqueFriends.get(key) ?? 0) + share);
          });
        }
        const borrowing = paymentMode === "borrowed" && normalizeFriendName(borrowedFrom)
          ? { lender: normalizeFriendName(borrowedFrom), amount: expenseAmount, note: note.trim() || "Paid with borrowed money", timestamp }
          : null;
        await replaceExpenseFinanceData(
          expenseId,
          friendPaid,
          [...uniqueFriends].map(([key, share]) => {
            const person = splitFriends.find((item) => friendNameKey(item.name) === key);
            return { friend: person ? normalizeFriendName(person.name) : key, amount: share, note: note.trim() || "Paid through an expense", timestamp, expenseId };
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
      const another = againRef.current && !expense;
      againRef.current = false;
      toast.success(expense ? "Transaction updated" : `${money(expenseAmount)} added`, {
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
      if (!another) { onClose(); return; }
      // Ready for the next one: keep who paid, the trip and the date; clear what is specific to this purchase.
      setAmount(""); setNote(""); setCat(""); categoryTouched.current = false; setSubmitted(false);
      setSplitFriends([]); setFriendName(""); setBorrowedFrom(""); setNewTripName("");
      requestAnimationFrame(() => amountRef.current?.focus());
    },
    onError: (e: unknown) => { againRef.current = false; toast.error(errorMessage(e, "Couldn't save the transaction. Please try again.")); },
  });

  const submit = (another: boolean) => {
    setSubmitted(true);
    if (!valid) {
      if (errors.payer || errors.lender || errors.split) setShowMore(true);
      toast.error(Object.values(errors)[0]);
      return;
    }
    if (m.isPending) return;
    againRef.current = another;
    m.mutate();
  };

  const friendSuggestions = [...new Set([
    ...finance.loans.map((loan) => normalizeFriendName(loan.friend)),
    ...(finance.friendPaidExpenses ?? []).map((debt) => normalizeFriendName(debt.friend)),
    ...(finance.borrowings ?? []).map((borrowing) => normalizeFriendName(borrowing.lender)),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const noteSuggestions = [...new Set(expenses.map((item) => item.note.trim()).filter(Boolean))].slice(0, 30);
  const mode = MODES.find((item) => item.value === paymentMode)!;
  const yourShare = Math.max(expenseAmount - (splitMode === "equal"
    ? round2(expenseAmount / (splitFriends.length + 1)) * splitFriends.length : exactShares), 0);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayInput = toLocalInput(yesterday);
  const dateChoice = !dt ? "now" : localDate(new Date(dt).toISOString()) === localDate(yesterday.toISOString()) ? "yesterday" : "custom";
  const tripName = trips.find((trip) => trip.id === tripId)?.name || newTripName.trim();

  const onNoteChange = (value: string) => {
    setNote(value);
    // A note you have used before brings its category with it, unless you already picked one yourself.
    const remembered = noteCategory.get(value.trim().toLocaleLowerCase());
    if (!categoryTouched.current && remembered && categories.some((category) => category.$id === remembered)) setCat(remembered);
  };

  return (
    <Modal title={expense ? "Edit transaction" : "Add transaction"} onClose={onClose} footer={
      <div className={expense ? "" : "grid gap-2 sm:grid-cols-2"}>
        <button className="btn w-full disabled:opacity-40" type="submit" form="expense-form" disabled={m.isPending}>
          {m.isPending ? "Saving…" : expense ? "Save changes" : "Add transaction"}
        </button>
        {!expense && <button type="button" className="btn-ghost w-full disabled:opacity-40" disabled={m.isPending} onClick={() => submit(true)}>Save and add another</button>}
      </div>
    }>
      <form id="expense-form" className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); submit(false); }}>
        <datalist id="expense-note-suggestions">{noteSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
        <datalist id="friend-name-suggestions">{friendSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>

        <Field label={paymentMode === "friend_paid" ? "Your share (₹)" : paymentMode === "paid_for_friend" ? "Total you paid (₹)" : "Amount (₹)"} error={show("amount")}
          hint={isFormula && parsedAmount !== null ? `= ${money(parsedAmount)}` : "You can type a sum, like 250+120."}>
          <input ref={amountRef} className="input text-lg font-semibold" type="text" inputMode="decimal" placeholder="0" value={amount} autoComplete="off"
            aria-invalid={!!show("amount")} onChange={(e) => setAmount(e.target.value)} autoFocus={!expense} />
        </Field>
        {!expense && onEmi && <button type="button" className="-mt-2 min-h-11 text-sm font-medium text-accent" onClick={onEmi}>Buying on EMI? Set up the installments</button>}

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Category</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
            {orderedCategories.map((category) => {
              const active = categoryId === category.$id;
              return (
                <button type="button" role="radio" aria-checked={active} key={category.$id}
                  className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${active ? "border-accent bg-accent/10 font-medium text-text" : "border-line bg-ink text-mute hover:text-text"}`}
                  onClick={() => { categoryTouched.current = true; setCat(category.$id); }}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: category.color }} aria-hidden="true" />{category.name}
                </button>
              );
            })}
          </div>
          {show("category") && <p role="alert" className="mt-1 text-xs text-red-300">{show("category")}</p>}
        </fieldset>

        <Field label="Note (optional)" hint={!expense && !categoryTouched.current ? "Notes you have used before fill in the category for you." : undefined}>
          <input className="input" list="expense-note-suggestions" placeholder="What was this for?" value={note} maxLength={120} onChange={(e) => onNoteChange(e.target.value)} />
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">When</legend>
          <div className="flex flex-wrap gap-2">
            {([["now", "Now"], ["yesterday", "Yesterday"], ["custom", "Pick date"]] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={dateChoice === value}
                className={`min-h-11 rounded-full border px-4 text-sm ${dateChoice === value ? "border-accent bg-accent/10 font-medium text-text" : "border-line bg-ink text-mute"}`}
                onClick={() => setDt(value === "now" ? "" : value === "yesterday" ? yesterdayInput : (dt || toLocalInput(new Date())))}>{label}</button>
            ))}
          </div>
          {dateChoice !== "now" && <input className="input mt-2" type="datetime-local" aria-label="Date and time" value={dt} onChange={(e) => setDt(e.target.value)} />}
          {show("date") && <p role="alert" className="mt-1 text-xs text-red-300">{show("date")}</p>}
        </fieldset>

        {!showMore ? (
          <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-line bg-ink px-3 text-left text-sm" onClick={() => setShowMore(true)}>
            <span className="min-w-0 truncate"><span className="text-mute">Paid by </span>{mode.summary}{tripName ? <span className="text-mute"> · Trip: {tripName}</span> : null}</span>
            <span className="shrink-0 font-medium text-accent">Change</span>
          </button>
        ) : (
          <div className="space-y-4 rounded-xl border border-line bg-ink p-3">
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Who paid?</legend>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((item) => (
                  <button key={item.value} type="button" aria-pressed={paymentMode === item.value}
                    className={`min-h-11 rounded-lg border px-2 text-sm leading-tight ${paymentMode === item.value ? "border-accent bg-accent/10 font-medium text-accent" : "border-line bg-panel text-mute"}`}
                    onClick={() => setPaymentMode(item.value)}>{item.label}</button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-mute">{mode.hint}</p>
            </fieldset>

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
              <div className="space-y-3">
                <p className="text-sm font-medium">Who did you pay for?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={`btn-ghost ${splitMode === "equal" ? "!border-accent !bg-accent/10 !text-accent" : ""}`} onClick={() => setSplitMode("equal")}>Split equally</button>
                  <button type="button" className={`btn-ghost ${splitMode === "exact" ? "!border-accent !bg-accent/10 !text-accent" : ""}`} onClick={() => setSplitMode("exact")}>Exact amounts</button>
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
                  <button type="button" className="min-h-11 text-sm font-medium text-accent" onClick={() => setSplitFriends([...splitFriends, { name: "", share: "" }])}>+ Add a person</button>
                </div>
                {show("split") && <p role="alert" className="text-xs text-red-300">{show("split")}</p>}
                {expenseAmount > 0 && splitFriends.length > 0 && (
                  <p className="text-xs text-mute">Your share: <span className="font-medium text-text">{money(yourShare)}</span>{" · "}Owed to you: <span className="font-medium text-text">{money(Math.max(expenseAmount - yourShare, 0))}</span></p>
                )}
              </div>
            )}

            <div>
              <p className="mb-1 text-sm font-medium">Trip (optional)</p>
              <select className="input" aria-label="Trip" value={tripId} onChange={(event) => { setTripId(event.target.value); if (event.target.value) setNewTripName(""); }}>
                <option value="">Not part of a trip</option>
                {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
              </select>
              <input className="input mt-2" value={newTripName} placeholder="Or start a new trip, e.g. Goa 2026" aria-label="New trip name"
                onChange={(event) => { setNewTripName(event.target.value); if (event.target.value) setTripId(""); }} />
            </div>
          </div>
        )}

      </form>
    </Modal>
  );
}
