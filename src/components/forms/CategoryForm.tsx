import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useData } from "../../lib/hooks";
import { addCategory, nextCategoryColor } from "../../lib/services/categories";
export default function CategoryForm({ onClose }: { onClose: () => void }) {
  const { uid, categories } = useData(); const qc = useQueryClient();
  const [name, setName] = useState(""); const [color, setColor] = useState(() => nextCategoryColor(categories));
  const m = useMutation({
    mutationFn: () => addCategory(uid, name.trim(), color),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success("Category added"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Modal title="New category" onClose={onClose}>
      <div className="space-y-3">
        <input className="input" placeholder="Category name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <label className="flex items-center gap-3 text-sm text-mute">Color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 bg-transparent" /></label>
        <button className="btn w-full disabled:opacity-40" disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>Add category</button>
      </div>
    </Modal>
  );
}
