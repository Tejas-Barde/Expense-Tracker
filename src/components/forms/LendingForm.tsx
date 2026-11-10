import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addBorrowing, addLoan } from "../../lib/services/finance";
import { normalizeFriendName } from "../../lib/services/finance";
import { money } from "../../lib/utils";

export default function LendingForm({ onClose }: { onClose: () => void }) {
  const { uid, finance } = useData();
  const qc = useQueryClient();
  const [friend, setFriend] = useState("");
  const [mode, setMode] = useState<"lend" | "borrow">("lend");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const mutation = useMutation({
    mutationFn: () => {
      const entry = {
        amount: Number(amount),
        note: note.trim(),
        timestamp: date ? new Date(date).toISOString() : new Date().toISOString(),
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
    onError: (error: Error) => toast.error(error.message),
  });
  const valid = friend.trim().length > 0 && Number.isFinite(Number(amount)) && Number(amount) > 0;
  const friendSuggestions = [...new Set([
    ...finance.loans.map((loan) => normalizeFriendName(loan.friend)),
    ...(finance.friendPaidExpenses ?? []).map((debt) => normalizeFriendName(debt.friend)),
    ...(finance.borrowings ?? []).map((borrowing) => normalizeFriendName(borrowing.lender)),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return (
    <Modal title="Record money movement" onClose={onClose}>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          const confirmation = mode === "lend"
            ? `Record a loan of ${money(Number(amount))} to ${normalizeFriendName(friend)}?`
            : `Record that you borrowed ${money(Number(amount))} from ${normalizeFriendName(friend)}?`;
          if (window.confirm(confirmation)) mutation.mutate();
        }
      }}>
        <fieldset>
          <legend className="mb-2 text-sm text-mute">Transaction type</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={mode === "lend"} onClick={() => setMode("lend")}
              className={`btn-ghost ${mode === "lend" ? "!border-accent !bg-accent/10 !text-accent" : ""}`}>Money lent</button>
            <button type="button" aria-pressed={mode === "borrow"} onClick={() => setMode("borrow")}
              className={`btn-ghost ${mode === "borrow" ? "!border-accent !bg-accent/10 !text-accent" : ""}`}>Money borrowed</button>
          </div>
        </fieldset>
        <datalist id="lending-friend-suggestions">
          {friendSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <label className="block text-sm text-mute">{mode === "lend" ? "Borrower" : "Lender"}
          <input className="input mt-1" list="lending-friend-suggestions" value={friend} onChange={(event) => setFriend(event.target.value)} autoFocus autoComplete="off" placeholder="Person's name" required /></label>
        <label className="block text-sm text-mute">Amount
          <input className="input mt-1" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
        <label className="block text-sm text-mute">Note (optional)
          <input className="input mt-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was it for?" /></label>
        <label className="block text-sm text-mute">Date
          <input className="input mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <p className="text-sm text-mute">
          {mode === "lend"
            ? "This amount will be included in spending and tracked as receivable."
            : "This amount will be tracked as payable and will not be counted as income or spending."}
        </p>
        <button className="btn w-full disabled:opacity-40" type="submit" disabled={!valid || mutation.isPending}>
          {mode === "lend" ? "Save loan" : "Save borrowing"}
        </button>
      </form>
    </Modal>
  );
}
