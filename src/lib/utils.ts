/** Whole rupees when the amount is whole, otherwise paise (so ₹33.33 never shows as ₹33). */
export const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** yyyy-mm-dd in the user's own timezone (an ISO string's date part is UTC and can be a day off). */
export const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Value for a datetime-local input, in local time. */
export const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
/**
 * Reads an amount the way a calculator would: "250", "250+120", "1,200 - 150", "3*80", "900/3".
 * Returns null for anything that is not a plain sum, so no code is ever evaluated.
 */
export function evaluateAmount(text: string): number | null {
  if (/[\d.]\s+[\d.]/.test(text)) return null; // "5 5" is a typo, not 55
  const cleaned = text.replace(/,/g, "").replace(/[x×]/gi, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  if (!cleaned || !/^[0-9.+\-*/]+$/.test(cleaned)) return null;
  const tokens = cleaned.match(/\d*\.?\d+|[+\-*/]/g);
  if (!tokens || tokens.join("") !== cleaned) return null;
  const terms: number[] = []; const ops: string[] = [];
  let expectNumber = true, current = 0, pending: string | null = null;
  for (const token of tokens) {
    if (/^[+\-*/]$/.test(token)) {
      if (expectNumber) return null;
      if (token === "*" || token === "/") pending = token;
      else { terms.push(current); ops.push(token); pending = null; }
      expectNumber = true;
    } else {
      const value = Number(token);
      if (!expectNumber || !Number.isFinite(value)) return null;
      if (pending === "*") current *= value;
      else if (pending === "/") { if (value === 0) return null; current /= value; }
      else current = value;
      pending = null; expectNumber = false;
    }
  }
  if (expectNumber) return null;
  terms.push(current);
  const total = terms.reduce((sum, term, index) => (index === 0 ? term : ops[index - 1] === "+" ? sum + term : sum - term), 0);
  return Number.isFinite(total) ? round2(total) : null;
}
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const timeTag = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
export function dayLabel(iso: string) {
  const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
/** (Total Monthly Limit - Month-to-Date Spent) / Remaining Days (today included) */
export function dailyLimit(total: number, spent: number, now = new Date()) {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(0, (total - spent) / (days - now.getDate() + 1));
}
/**
 * What you can spend per day for the rest of the month (today included). It is the smaller of two amounts:
 * what is left of your budget, and what is left in your account. Either can be unknown (null) if not set up.
 */
export function suggestedDailyLimit(left: { budgetLeft: number | null; accountLeft: number | null }, now = new Date()) {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const options = [
    { source: "budget" as const, amount: left.budgetLeft },
    { source: "account" as const, amount: left.accountLeft },
  ].filter((option): option is { source: "budget" | "account"; amount: number } => option.amount !== null);
  if (!options.length) return null;
  const tightest = options.reduce((best, option) => (option.amount < best.amount ? option : best));
  return { perDay: Math.max(0, tightest.amount) / days, limitedBy: tightest.source, days };
}
export function pace(total: number, spent: number, now = new Date()) {
  if (!total) return { label: "No budget", cls: "text-mute" };
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (spent > total) return { label: "Over Budget", cls: "text-red-400" };
  if (spent / total >= 0.9 || spent / total > now.getDate() / days + 0.1) return { label: "Near Limit", cls: "text-orange-300" };
  return { label: "On Track", cls: "text-emerald-400" };
}
export const barColor = (p: number) => (p > 90 ? "bg-red-500" : p >= 75 ? "bg-orange-400" : "bg-emerald-500");
