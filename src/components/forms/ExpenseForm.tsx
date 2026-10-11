import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addExpense } from "../../lib/services/expenses";
export default function ExpenseForm({ onClose }: { onClose: () => void }) {
  const { uid, categories } = useData(); const qc = useQueryClient();
  const [amount, setAmount] = useState(""); const [categoryId, setCat] = useState(""); const [note, setNote] = useState(""); const [dt, setDt] = useState("");
  const m = useMutation({
    mutationFn: () => addExpense(uid, { amount: parseFloat(amount), categoryId, note,
      timestamp: dt ? new Date(dt).toISOString() : new Date().toISOString() }), // auto-timestamp unless overridden
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); toast.success("Expense added"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const ok = parseFloat(amount) > 0 && categoryId;
  return (
    <Modal title="Add expense" onClose={onClose}>
      <div className="space-y-3">
        <input className="input" type="number" min="0" step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <select className="input" value={categoryId} onChange={(e) => setCat(e.target.value)}>
          <option value="">Choose category</option>{categories.map((c) => <option key={c.$id} value={c.$id}>{c.name}</option>)}
        </select>
        <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="block text-sm text-mute">Date & time (leave empty to use right now)
          <input className="input mt-1" type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} /></label>
        <button className="btn w-full disabled:opacity-40" disabled={!ok || m.isPending} onClick={() => m.mutate()}>Add expense</button>
      </div>
    </Modal>
  );
}
