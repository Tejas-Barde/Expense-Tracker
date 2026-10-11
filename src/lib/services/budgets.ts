import { getJSON, setJSON } from "./prefs";
import type { Budget } from "../../types";
type Stored = Record<string, { total: number; limits: Record<string, number> }>; // keyed by "YYYY-MM"
export async function getBudget(_uid: string, monthYear: string): Promise<Budget | null> {
  const b = (await getJSON<Stored>("budgets", {}))[monthYear];
  return b ? { id: monthYear, total: b.total, limits: b.limits } : null;
}
export async function saveBudget(_uid: string, monthYear: string, total: number, limits: Record<string, number>, _id: string | null) {
  const all = await getJSON<Stored>("budgets", {});
  await setJSON("budgets", { ...all, [monthYear]: { total, limits } });
}
