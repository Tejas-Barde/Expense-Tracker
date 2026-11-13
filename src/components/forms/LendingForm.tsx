import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useConfirm } from "../Confirm";
import { useData } from "../../lib/hooks";
import { addBorrowing, addLoan, normalizeFriendName } from "../../lib/services/finance";
import { errorMessage } from "../../lib/errors";
import { money } from "../../lib/utils";

export default function LendingForm({ onClose }: { onClose: () => void }) {
  const { uid, finance } = useData();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [friend, setFriend] = useState("");
  const [mode, setMode] = useState<"lend" | "borrow">("lend");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [opening, setOpening] = useState(false);
  const mutation = useMutation({
    mutationFn: () => {
      const entry = {
        amount: Number(amount),
        note: note.trim(),
        timestamp: date ? new Date(date).toISOString() : new Date().toISOString(),
        ...(opening ? { opening: true } : {}),
      };
      return mode === "lend"
        ? addLoan({ ...entry, friend: normalizeFriendName(friend) })
        : addBorrowing({ ...entry, lender: normalizeFriendName(friend) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", uid] });
      toast.success(mode === "lend" ? "Loan recorded" : "Borrowing recorded");
      onClose();
    },
    onError: (error: unknown) => toast.error(errorMessage(error, "Couldn't save this entry. Please try again.")),
  });
  const name = normalizeFriendName(friend);
  const errors: Record<string, string> = {};
  if (!name) errors.friend = mode === "lend" ? "Enter the name of the person you lent to." : "Enter the name of the person you borrowed from.";
  if (!(Number(amount) > 0)) errors.amount = "Enter an amount greater than zero.";
  const err = (key: string) => (submitted ? errors[key] : undefined);
  const friendSuggestions = [...new Set([
    ...finance.loans.map((loan) => normalizeFriendName(loan.friend)),
    ...(finance.friendPaidExpenses ?? []).map((debt) => normalizeFriendName(debt.friend)),
    ...(finance.borrowings ?? []).map((borrowing) => normalizeFriendName(borrowing.lender)),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return (
    <Modal title="Record a loan or borrowing" onClose={onClose}>
      <form className="space-y-4" noValidate onSubmit={async (event) => {
        event.preventDefault();
        setSubmitted(true);
        if (Object.keys(errors).length) return;
        const ok = await confirm({
          title: opening ? "Record this opening balance?" : mode === "lend" ? "Record this loan?" : "Record this borrowing?",
          message: opening
            ? (mode === "lend" ? `${name} owed you ${money(Number(amount))} before you started. Your account and spending will not change.` : `You owed ${name} ${money(Number(amount))} before you started. Your account and spending will not change.`)
            : mode === "lend"
              ? `You lent ${money(Number(amount))} to ${name}. It will count as money spent and as money owed to you.`
              : `You borrowed ${money(Number(amount))} from ${name}. It will be added to your balance and recorded as money you owe.`,
          confirmLabel: "Record",
        });
        if (ok) mutation.mutate();
      }}>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What happened?</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={mode === "lend"} onClick={() => setMode("lend")}
              className={`btn-ghost ${mode === "lend" ? "!border-accent !bg-accent/10 !text-accent" : ""}`}>I lent money</button>
            <button type="button" aria-pressed={mode === "borrow"} onClick={() => setMode("borrow")}
              className={`btn-ghost ${mode === "borrow" ? "!border-accent !bg-accent/10 !text-accent" : ""}`}>I borrowed money</button>
          </div>
        </fieldset>
        <datalist id="lending-friend-suggestions">
          {friendSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <label className="block"><span className="mb-1 block text-sm font-medium">{mode === "lend" ? "Lent to" : "Borrowed from"}</span>
          <input className="input" list="lending-friend-suggestions" value={friend} onChange={(event) => setFriend(event.target.value)} autoFocus autoComplete="off" placeholder="Person's name" aria-invalid={!!err("friend")} />
          {err("friend") && <span role="alert" className="mt-1 block text-xs text-red-300">{err("friend")}</span>}</label>
        <label className="block"><span className="mb-1 block text-sm font-medium">Amount (₹)</span>
          <input className="input" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" aria-invalid={!!err("amount")} />
          {err("amount") && <span role="alert" className="mt-1 block text-xs text-red-300">{err("amount")}</span>}</label>
        <label className="block"><span className="mb-1 block text-sm font-medium">Note (optional)</span>
          <input className="input" value={note} maxLength={120} onChange={(event) => setNote(event.target.value)} placeholder="What was it for?" /></label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-ink p-3">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" checked={opening} onChange={(event) => setOpening(event.target.checked)} />
          <span className="text-sm"><span className="block font-medium">{mode === "lend" ? "They already owed me before I started using Ledgerly" : "I already owed this before I started using Ledgerly"}</span>
            <span className="block text-xs leading-relaxed text-mute">Tracked as a balance only. It won't change your account balance or this month's spending, so you can record payments against it later.</span></span>
        </label>
        <label className="block"><span className="mb-1 block text-sm font-medium">Date</span>
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <span className="mt-1 block text-xs text-mute">Leave empty to use today.</span></label>
        <p className="text-xs leading-relaxed text-mute">
          {mode === "lend"
            ? "Lending counts as money spent from your account and is tracked as money owed to you."
            : "The money is added to your balance and tracked as something you owe. It is not counted as income."}
        </p>
        <button className="btn w-full disabled:opacity-50" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : mode === "lend" ? "Save loan" : "Save borrowing"}
        </button>
      </form>
    </Modal>
  );
}
