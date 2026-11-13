import { ID } from "../appwrite/client";
import { getJSON, setJSON } from "./prefs";
import { listExpenses, setExpenseCategory } from "./expenses";
import type { Category } from "../../types";

/** Categories seeded for a new account. Modelled on the groupings used by Splitwise, Walnut and Axio. */
export const DEFAULT_CATEGORIES: { name: string; color: string; hint: string; core: boolean }[] = [
  { name: "Food & Dining", color: "#f97316", hint: "Restaurants, takeaway, cafes, snacks", core: true },
  { name: "Groceries", color: "#84cc16", hint: "Vegetables, fruit, supermarket, household supplies", core: true },
  { name: "Transport", color: "#38bdf8", hint: "Cabs, auto, metro, bus, fuel, parking", core: true },
  { name: "Shopping", color: "#e879f9", hint: "Clothes, shoes, electronics, accessories", core: true },
  { name: "Health & Personal Care", color: "#14b8a6", hint: "Medicines, doctor, glasses, haircut, grooming, trimmer", core: true },
  { name: "Bills & Utilities", color: "#facc15", hint: "Electricity, water, gas, mobile, internet", core: true },
  { name: "Rent & Housing", color: "#818cf8", hint: "Rent, maintenance, repairs, furniture", core: true },
  { name: "Entertainment", color: "#f43f5e", hint: "Movies, games, events, outings", core: true },
  { name: "Subscriptions", color: "#a78bfa", hint: "OTT, music, apps, memberships", core: true },
  { name: "Other", color: "#94a3b8", hint: "Anything that does not fit elsewhere", core: true },
  // Offered as suggestions only, so a new account is not cluttered with categories it may never use.
  { name: "Education", color: "#06b6d4", hint: "Courses, books, exam fees", core: false },
  { name: "Gifts & Donations", color: "#fb7185", hint: "Presents, festivals, charity", core: false },
];
const CATEGORY_COLORS = ["#f97316", "#0ea5e9", "#a855f7", "#84cc16", "#f43f5e", "#f59e0b", "#2563eb", "#db2777", "#0891b2", "#7c3aed", "#16a34a", "#dc2626", "#4f46e5", "#ca8a04"];

/** The category settlement payments are filed under. It is managed by the app, not by the user. */
/** "Other" is the catch-all, so it is kept even when nothing uses it yet. */
export const isCatchAll = (category: { name: string }) => normalizeName(category.name) === "other";
export const isSystemCategory = (category: { name: string }) => category.name.trim().toLocaleLowerCase() === "settlements";

// ---- Similarity detection ---------------------------------------------------------------------------
// Names that people use interchangeably. Used only to suggest merges; nothing is merged automatically.
const SYNONYM_GROUPS: string[][] = [
  ["food", "dining", "food and dining", "eating out", "restaurant", "restaurants", "meals", "meal", "snacks", "takeaway", "cafe"],
  ["groceries", "grocery", "vegetables", "supermarket", "kirana"],
  ["transport", "transportation", "cab", "cabs", "taxi", "travel", "commute", "fuel", "petrol", "auto", "metro", "cab travel"],
  ["shopping", "clothes", "clothing", "apparel", "shopping clothes", "fashion"],
  ["health", "healthcare", "medical", "medicine", "medicines", "pharmacy", "personal care", "grooming", "salon", "health and personal care"],
  ["utilities", "utility", "bills", "bill", "recharge", "electricity", "internet", "bills and utilities"],
  ["rent", "housing", "home", "rent and housing"],
  ["entertainment", "movies", "fun", "leisure", "outings"],
  ["subscriptions", "subscription", "ott", "memberships"],
  ["education", "learning", "courses", "books"],
  ["gifts", "gift", "donations", "donation", "charity", "gifts and donations"],
  ["misc", "miscellaneous", "other", "others", "general", "uncategorised", "uncategorized"],
];

const normalizeName = (name: string) => name.toLocaleLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
function groupOf(name: string): number {
  const full = normalizeName(name);
  const direct = SYNONYM_GROUPS.findIndex((group) => group.includes(full));
  if (direct >= 0) return direct;
  const parts = full.split(/ and | /).filter(Boolean);
  const partGroups = parts.map((part) => SYNONYM_GROUPS.findIndex((group) => group.includes(part)));
  return partGroups.length > 0 && partGroups.every((index) => index >= 0 && index === partGroups[0]) ? partGroups[0] : -1;
}

/** Groups of categories that look like the same thing (e.g. "Food", "food " and "Dining"). */
export function findSimilarCategories(categories: Category[]): Category[][] {
  const buckets = new Map<string, Category[]>();
  for (const category of categories.filter((item) => !isSystemCategory(item))) {
    const group = groupOf(category.name);
    const key = group >= 0 ? `g${group}` : `n${normalizeName(category.name).replace(/s$/, "")}`;
    buckets.set(key, [...(buckets.get(key) ?? []), category]);
  }
  return [...buckets.values()].filter((bucket) => bucket.length > 1);
}

/** Default categories the user does not have yet (and has nothing equivalent to). */
export function suggestedCategories(categories: Category[]) {
  const taken = new Set(categories.map((category) => groupOf(category.name)).filter((index) => index >= 0));
  const names = new Set(categories.map((category) => normalizeName(category.name)));
  return DEFAULT_CATEGORIES.filter((item) => !names.has(normalizeName(item.name)) && !taken.has(groupOf(item.name)));
}

// ---- Colours -------------------------------------------------------------------------------------------
function generatedColor(index: number) {
  const hue = (index * 137.508) % 360;
  const saturation = 0.72, lightness = 0.48;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function nextCategoryColor(categories: Category[], preferredColor?: string) {
  const used = new Set(categories.map((category) => category.color.toLowerCase()));
  if (preferredColor && !used.has(preferredColor.toLowerCase())) return preferredColor;
  const available = CATEGORY_COLORS.find((color) => !used.has(color));
  if (available) return available;
  let index = categories.length;
  let color = generatedColor(index);
  while (used.has(color)) color = generatedColor(++index);
  return color;
}

// ---- Storage ---------------------------------------------------------------------------------------------
export async function listCategories(uid: string): Promise<Category[]> {
  let cats = await getJSON<Category[]>("categories", []);
  if (!cats.length) { // seed system defaults on first login
    cats = DEFAULT_CATEGORIES.filter((item) => item.core).map(({ name, color }) => ({ $id: ID.unique(), userId: uid, name, color, isDefault: true }));
    await setJSON("categories", cats);
  }
  const uniqueCats: Category[] = [];
  for (const category of cats) {
    const color = nextCategoryColor(uniqueCats, category.color);
    uniqueCats.push(color === category.color ? category : { ...category, color });
  }
  if (uniqueCats.some((category, index) => category.color !== cats[index].color)) {
    await setJSON("categories", uniqueCats);
  }
  return uniqueCats;
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export async function addCategory(uid: string, name: string, color: string) {
  const cats = await listCategories(uid);
  if (!name.trim()) throw new Error("Enter a category name.");
  if (cats.some((category) => sameName(category.name, name))) {
    throw new Error("A category with this name already exists.");
  }
  const distinctColor = nextCategoryColor(cats, color);
  await setJSON("categories", [...cats, { $id: ID.unique(), userId: uid, name: name.trim(), color: distinctColor, isDefault: false }]);
}

type StoredBudgets = Record<string, { total: number; limits: Record<string, number>; savings?: number }>;

export async function renameCategory(uid: string, id: string, name: string) {
  const cats = await listCategories(uid);
  const target = cats.find((category) => category.$id === id);
  if (!target) throw new Error("That category no longer exists.");
  if (isSystemCategory(target)) throw new Error("This category is managed by the app and can't be renamed.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a category name.");
  if (isSystemCategory({ name: trimmed })) throw new Error("That name is reserved for settlement payments.");
  if (cats.some((category) => category.$id !== id && sameName(category.name, trimmed))) throw new Error("A category with this name already exists.");
  await setJSON("categories", cats.map((category) => category.$id === id ? { ...category, name: trimmed } : category));
}

/** Deletes a category that no transaction uses. Anything in use has to be merged into another category instead. */
export async function deleteCategory(uid: string, id: string) {
  const cats = await listCategories(uid);
  const target = cats.find((category) => category.$id === id);
  if (!target) return;
  if (isSystemCategory(target)) throw new Error("This category is managed by the app and can't be deleted.");
  const used = (await listExpenses(uid)).filter((expense) => expense.categoryId === id).length;
  if (used > 0) throw new Error(`${used} transaction${used === 1 ? " uses" : "s use"} this category. Merge it into another category instead.`);
  const budgets = await getJSON<StoredBudgets>("budgets", {});
  await setJSON("budgets", Object.fromEntries(Object.entries(budgets).map(([month, budget]) => {
    const { [id]: _removed, ...limits } = budget.limits;
    return [month, { ...budget, limits }];
  })));
  await setJSON("categories", cats.filter((category) => category.$id !== id));
}

export interface MergeUndo { categories: Category[]; budgets: StoredBudgets; moved: { id: string; categoryId: string }[] }
export interface MergeResult { moved: number; undo: MergeUndo }

/**
 * Moves every transaction (and every monthly budget limit) from `fromIds` into `intoId`, then removes the
 * emptied categories. All transactions are re-pointed before any category is removed, and a partial failure is
 * rolled back, so the data never ends up referring to a category that no longer exists.
 */
export async function mergeCategories(uid: string, fromIds: string[], intoId: string): Promise<MergeResult> {
  const sources = [...new Set(fromIds)].filter((id) => id !== intoId);
  if (!sources.length) throw new Error("Choose at least one other category to merge.");
  const cats = await listCategories(uid);
  const into = cats.find((category) => category.$id === intoId);
  if (!into) throw new Error("The category you are merging into no longer exists.");
  if (isSystemCategory(into) || sources.some((id) => { const found = cats.find((category) => category.$id === id); return !found || isSystemCategory(found); })) {
    throw new Error("The Settlements category is managed by the app and can't be merged.");
  }
  const budgets = await getJSON<StoredBudgets>("budgets", {});
  const affected = (await listExpenses(uid)).filter((expense) => sources.includes(expense.categoryId));
  const moved = affected.map((expense) => ({ id: expense.$id, categoryId: expense.categoryId }));
  const done: typeof moved = [];
  try {
    for (let i = 0; i < moved.length; i += 10) {
      const chunk = moved.slice(i, i + 10);
      const results = await Promise.allSettled(chunk.map((item) => setExpenseCategory(item.id, intoId)));
      results.forEach((result, index) => { if (result.status === "fulfilled") done.push(chunk[index]); });
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw (failure as PromiseRejectedResult).reason;
    }
  } catch (error) {
    await Promise.allSettled(done.map((item) => setExpenseCategory(item.id, item.categoryId)));
    throw error;
  }
  const mergedBudgets: StoredBudgets = Object.fromEntries(Object.entries(budgets).map(([month, budget]) => {
    const limits = { ...budget.limits };
    let combined = limits[intoId] ?? 0;
    for (const id of sources) { combined += limits[id] ?? 0; delete limits[id]; }
    if (combined > 0) limits[intoId] = combined;
    return [month, { ...budget, limits }];
  }));
  await setJSON("budgets", mergedBudgets);
  await setJSON("categories", cats.filter((category) => !sources.includes(category.$id)));
  return { moved: moved.length, undo: { categories: cats, budgets, moved } };
}

/**
 * Removes every category that no transaction uses, except the catch-all and the app-managed one.
 * Returns an undo token (categories and budgets as they were).
 */
export async function removeUnusedCategories(uid: string): Promise<{ removed: Category[]; undo: MergeUndo }> {
  const cats = await listCategories(uid);
  const used = new Set((await listExpenses(uid)).map((expense) => expense.categoryId));
  const removed = cats.filter((category) => !used.has(category.$id) && !isSystemCategory(category) && !isCatchAll(category));
  if (!removed.length) return { removed, undo: { categories: cats, budgets: {}, moved: [] } };
  const budgets = await getJSON<StoredBudgets>("budgets", {});
  const gone = new Set(removed.map((category) => category.$id));
  await setJSON("budgets", Object.fromEntries(Object.entries(budgets).map(([month, budget]) => [
    month, { ...budget, limits: Object.fromEntries(Object.entries(budget.limits).filter(([id]) => !gone.has(id))) },
  ])));
  await setJSON("categories", cats.filter((category) => !gone.has(category.$id)));
  return { removed, undo: { categories: cats, budgets, moved: [] } };
}

export async function undoMerge(undo: MergeUndo) {
  await setJSON("categories", undo.categories);
  await setJSON("budgets", undo.budgets);
  const results = await Promise.allSettled(undo.moved.map((item) => setExpenseCategory(item.id, item.categoryId)));
  if (results.some((result) => result.status === "rejected")) throw new Error("Some transactions could not be moved back. Check your connection and try again.");
}
