import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useConfirm } from "../Confirm";
import { useData } from "../../lib/hooks";
import {
  addCategory, deleteCategory, findSimilarCategories, isCatchAll, isSystemCategory, mergeCategories, nextCategoryColor,
  removeUnusedCategories, renameCategory, suggestedCategories, undoMerge,
} from "../../lib/services/categories";
import { errorMessage } from "../../lib/errors";

/** One place to add, rename, merge and delete categories. */
export default function CategoriesManager({ onClose }: { onClose: () => void }) {
  const { uid, categories, expenses } = useData();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [keepId, setKeepId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");

  const visible = categories.filter((category) => !isSystemCategory(category));
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    expenses.forEach((expense) => { result[expense.categoryId] = (result[expense.categoryId] ?? 0) + 1; });
    return result;
  }, [expenses]);
  const unused = visible.filter((category) => !(counts[category.$id] ?? 0) && !isCatchAll(category));
  const similar = useMemo(() => findSimilarCategories(categories), [categories]);
  const suggestions = suggestedCategories(categories);
  const picked = visible.filter((category) => selected.includes(category.$id));
  const keep = picked.find((category) => category.$id === keepId) ?? [...picked].sort((a, b) => (counts[b.$id] ?? 0) - (counts[a.$id] ?? 0))[0];

  const refresh = () => ["categories", "expenses", "budget", "finance"].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try { await work(); } catch (error) { toast.error(errorMessage(error, failure)); } finally { setBusy(false); }
  };
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const doMerge = () => run(async () => {
    if (!keep) return;
    const sources = picked.filter((category) => category.$id !== keep.$id);
    const moving = sources.reduce((sum, category) => sum + (counts[category.$id] ?? 0), 0);
    const ok = await confirm({
      title: `Merge into “${keep.name}”?`,
      message: <>
        {moving} transaction{moving === 1 ? "" : "s"} from {sources.map((category) => `“${category.name}”`).join(", ")} will move to “{keep.name}”.
        Monthly limits for these categories are added together, and the merged categories are removed. You can undo this straight afterwards.
      </>,
      confirmLabel: "Merge",
    });
    if (!ok) return;
    const result = await mergeCategories(uid, sources.map((category) => category.$id), keep.$id);
    setSelected([]); setKeepId("");
    refresh();
    toast.success(`Merged into “${keep.name}”`, {
      duration: 10000,
      action: { label: "Undo", onClick: () => { undoMerge(result.undo).then(() => { refresh(); toast.success("Merge undone"); }).catch((error) => toast.error(errorMessage(error, "Couldn't undo the merge."))); } },
    });
  }, "Couldn't merge these categories. Nothing was changed.");

  const saveRename = (id: string) => run(async () => {
    await renameCategory(uid, id, editName);
    setEditingId(null); refresh(); toast.success("Category renamed");
  }, "Couldn't rename the category.");

  const remove = (id: string, name: string) => run(async () => {
    const ok = await confirm({ title: `Delete “${name}”?`, message: "No transactions use this category, so nothing else will change.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    await deleteCategory(uid, id);
    setSelected((current) => current.filter((item) => item !== id)); refresh(); toast.success("Category deleted");
  }, "Couldn't delete the category.");

  const cleanUp = () => run(async () => {
    const ok = await confirm({
      title: `Remove ${unused.length} unused categor${unused.length === 1 ? "y" : "ies"}?`,
      message: <>No transactions use {unused.map((category) => `“${category.name}”`).join(", ")}, so nothing else changes. You can undo this straight afterwards.</>,
      confirmLabel: "Remove", destructive: true,
    });
    if (!ok) return;
    const result = await removeUnusedCategories(uid);
    refresh();
    toast.success(`Removed ${result.removed.length} unused categor${result.removed.length === 1 ? "y" : "ies"}`, {
      duration: 10000,
      action: { label: "Undo", onClick: () => { undoMerge(result.undo).then(() => { refresh(); toast.success("Categories restored"); }).catch((error) => toast.error(errorMessage(error, "Couldn't restore the categories."))); } },
    });
  }, "Couldn't remove the unused categories.");

  const add = (name: string) => run(async () => {
    await addCategory(uid, name, nextCategoryColor(categories));
    setNewName(""); refresh(); toast.success(`“${name.trim()}” added`);
  }, "Couldn't add the category.");

  return (
    <Modal title="Categories" onClose={onClose}>
      <div className="space-y-5">
        {similar.length > 0 && selected.length === 0 && (
          <section className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3" aria-label="Similar categories">
            <p className="text-sm font-medium text-amber-100">These look like the same thing</p>
            {similar.map((group) => (
              <div key={group.map((category) => category.$id).join()} className="flex items-center justify-between gap-3">
                <p className="min-w-0 text-sm text-amber-100/90">{group.map((category) => category.name.trim()).join(" · ")}</p>
                <button type="button" className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-amber-200 hover:bg-amber-400/10"
                  onClick={() => { setSelected(group.map((category) => category.$id)); setKeepId(""); }}>Review</button>
              </div>
            ))}
          </section>
        )}

        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium">Your categories</h3>
            <p className="text-xs text-mute">{selected.length < 2 ? "Tick two or more to merge" : `${selected.length} selected`}</p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-ink">
            {visible.map((category) => {
              const count = counts[category.$id] ?? 0;
              const editing = editingId === category.$id;
              return (
                <li key={category.$id} className="flex min-h-14 items-center gap-1 pr-1">
                  <label className="grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center" aria-label={`Select ${category.name}`}>
                    <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={selected.includes(category.$id)} onChange={() => toggle(category.$id)} />
                  </label>
                  <span className="size-3 shrink-0 rounded-full" style={{ background: category.color }} aria-hidden="true" />
                  {editing ? (
                    <form className="ml-2 flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void saveRename(category.$id); }}>
                      <input className="input !min-h-10 min-w-0 flex-1" value={editName} maxLength={40} autoFocus aria-label={`New name for ${category.name}`} onChange={(event) => setEditName(event.target.value)} />
                      <button type="submit" className="min-h-10 rounded-lg px-3 text-sm font-semibold text-accent" disabled={busy}>Save</button>
                      <button type="button" className="min-h-10 rounded-lg px-2 text-sm text-mute" onClick={() => setEditingId(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <div className="ml-2 min-w-0 flex-1 py-2">
                        <p className="truncate text-sm font-medium">{category.name}</p>
                        <p className="text-xs text-mute">{count} transaction{count === 1 ? "" : "s"}</p>
                      </div>
                      <button type="button" className="grid min-h-11 min-w-10 place-items-center rounded-lg text-mute hover:bg-accent/10 hover:text-accent" aria-label={`Rename ${category.name}`}
                        onClick={() => { setEditingId(category.$id); setEditName(category.name); }}>✎</button>
                      {count === 0 && <button type="button" className="grid min-h-11 min-w-10 place-items-center rounded-lg text-mute hover:bg-red-500/10 hover:text-red-400" aria-label={`Delete ${category.name}`}
                        onClick={() => void remove(category.$id, category.name)}>🗑</button>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {picked.length >= 2 && keep && (
          <section className="space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-3" aria-label="Merge categories">
            <p className="text-sm font-medium">Merge {picked.length} categories into one</p>
            <label className="block text-xs text-mute">Keep this name
              <select className="input mt-1" value={keep.$id} onChange={(event) => setKeepId(event.target.value)}>
                {picked.map((category) => <option key={category.$id} value={category.$id}>{category.name} ({counts[category.$id] ?? 0})</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" onClick={() => { setSelected([]); setKeepId(""); }}>Cancel</button>
              <button type="button" className="btn disabled:opacity-50" disabled={busy} onClick={() => void doMerge()}>{busy ? "Merging…" : "Merge"}</button>
            </div>
          </section>
        )}

        {unused.length > 0 && picked.length < 2 && (
          <section className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ink p-3">
            <p className="min-w-0 text-sm text-mute"><span className="font-medium text-text">{unused.length} unused</span>: {unused.map((category) => category.name).join(", ")}</p>
            <button type="button" className="btn-ghost shrink-0 !min-h-10 disabled:opacity-50" disabled={busy} onClick={() => void cleanUp()}>Remove all</button>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-medium">Add a category</h3>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (newName.trim()) void add(newName); }}>
            <input className="input min-w-0 flex-1" placeholder="e.g. Pets" value={newName} maxLength={40} aria-label="New category name" onChange={(event) => setNewName(event.target.value)} />
            <button type="submit" className="btn shrink-0 disabled:opacity-50" disabled={busy || !newName.trim()}>Add</button>
          </form>
          {suggestions.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-mute">Suggested. Tap to add.</p>
              <div className="space-y-2">
                {suggestions.map((suggestion) => (
                  <button key={suggestion.name} type="button" disabled={busy} onClick={() => void add(suggestion.name)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-ink px-3 py-2 text-left hover:border-accent disabled:opacity-50">
                    <span className="size-3 shrink-0 rounded-full" style={{ background: suggestion.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{suggestion.name}</span><span className="block text-xs text-mute">{suggestion.hint}</span></span>
                    <span className="text-lg text-accent" aria-hidden="true">+</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
