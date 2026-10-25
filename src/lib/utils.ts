export const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
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
export function pace(total: number, spent: number, now = new Date()) {
  if (!total) return { label: "No budget", cls: "text-mute" };
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (spent > total) return { label: "Over Budget", cls: "text-red-400" };
  if (spent / total >= 0.9 || spent / total > now.getDate() / days + 0.1) return { label: "Near Limit", cls: "text-orange-300" };
  return { label: "On Track", cls: "text-emerald-400" };
}
export const barColor = (p: number) => (p > 90 ? "bg-red-500" : p >= 75 ? "bg-orange-400" : "bg-emerald-500");
