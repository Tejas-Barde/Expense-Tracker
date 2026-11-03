import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addLoan } from "../../lib/services/finance";
import { normalizeFriendName } from "../../lib/services/finance";

export default function LendingForm({ onClose }: { onClose: () => void }) {
  const { uid, finance } = useData();
  const qc = useQueryClient();
  const [friend, setFriend] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const mutation = useMutation({
    mutationFn: () => addLoan({
      friend: normalizeFriendName(friend),
      amount: Number(amount),
      note: note.trim(),
      timestamp: date ? new Date(date).toISOString() : new Date().toISOString(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", uid] });
      toast.success("Lending added");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const valid = friend.trim().length > 0 && Number(amount) > 0;
  const friendSuggestions = [...new Set([
    ...finance.loans.map((loan) => normalizeFriendName(loan.friend)),
    ...(finance.friendPaidExpenses ?? []).map((debt) => normalizeFriendName(debt.friend)),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return (
    <Modal title="Lend money" onClose={onClose}>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) mutation.mutate(); }}>
        <datalist id="lending-friend-suggestions">
          {friendSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
        </datalist>
        <label className="block text-sm text-mute">Friend's name
          <input className="input mt-1" list="lending-friend-suggestions" value={friend} onChange={(event) => setFriend(event.target.value)} autoFocus autoComplete="off" placeholder="Who are you lending to?" required /></label>
        <label className="block text-sm text-mute">Amount lent
          <input className="input mt-1" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
        <label className="block text-sm text-mute">Note (optional)
          <input className="input mt-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was it for?" /></label>
        <label className="block text-sm text-mute">Date lent
          <input className="input mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <p className="text-sm text-emerald-400">This will count as money out, and the amount owed will appear in green.</p>
        <button className="btn w-full disabled:opacity-40" type="submit" disabled={!valid || mutation.isPending}>Save lending</button>
      </form>
    </Modal>
  );
}
