import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addCategory, nextCategoryColor } from "../../lib/services/categories";
import { errorMessage } from "../../lib/errors";

export default function CategoryForm({ onClose }: { onClose: () => void }) {
  const { uid, categories } = useData(); const qc = useQueryClient();
  const [name, setName] = useState(""); const [color, setColor] = useState(() => nextCategoryColor(categories));
  const [submitted, setSubmitted] = useState(false);
  const trimmed = name.trim();
  const error = !trimmed ? "Enter a category name."
    : categories.some((category) => category.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase()) ? "A category with this name already exists."
    : "";
  const m = useMutation({
    mutationFn: () => addCategory(uid, trimmed, color),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success(`"${trimmed}" added`); onClose(); },
    onError: (e: unknown) => toast.error(errorMessage(e, "Couldn't add the category. Please try again.")),
  });
  return (
    <Modal title="New category" onClose={onClose}>
      <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); setSubmitted(true); if (!error) m.mutate(); }}>
        <label className="block"><span className="mb-1 block text-sm font-medium">Name</span>
          <input className="input" placeholder="e.g. Groceries" value={name} maxLength={40} aria-invalid={submitted && !!error} onChange={(e) => setName(e.target.value)} autoFocus />
          {submitted && error && <span role="alert" className="mt-1 block text-xs text-red-300">{error}</span>}</label>
        <label className="flex items-center justify-between gap-3 text-sm font-medium">Colour
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 cursor-pointer rounded bg-transparent" /></label>
        <button className="btn w-full disabled:opacity-50" type="submit" disabled={m.isPending}>{m.isPending ? "Adding…" : "Add category"}</button>
      </form>
    </Modal>
  );
}
