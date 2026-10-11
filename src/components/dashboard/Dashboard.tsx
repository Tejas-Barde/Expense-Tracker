import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Legend, LineChart, Line, CartesianGrid } from "recharts";
import { useData } from "../../lib/hooks";
import { money, monthKey, dailyLimit, pace, barColor } from "../../lib/utils";
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="bg-panel border border-line rounded-xl p-4"><h3 className="text-sm text-mute mb-2">{title}</h3>{children}</section>);
const tip = { contentStyle: { background: "#161d1a", border: "1px solid #26302c", borderRadius: 8 } };

export default function Dashboard() {
  const { categories, expenses, budget, loading } = useData();
  const now = new Date(), mk = monthKey(now), warned = useRef(false);
  const d = useMemo(() => {
    const month = expenses.filter((e) => e.timestamp.startsWith(mk) || monthKey(new Date(e.timestamp)) === mk);
    const spent = month.reduce((s, e) => s + e.amount, 0);
    const today = month.filter((e) => new Date(e.timestamp).toDateString() === now.toDateString()).reduce((s, e) => s + e.amount, 0);
    const byCat: Record<string, number> = {}; month.forEach((e) => (byCat[e.categoryId] = (byCat[e.categoryId] ?? 0) + e.amount));
    const rows = categories.map((c) => ({ ...c, spent: byCat[c.$id] ?? 0, budget: budget?.limits[c.$id] ?? 0 }));
    let cum = 0; const trend = Array.from({ length: now.getDate() }, (_, i) => {
      cum += month.filter((e) => new Date(e.timestamp).getDate() === i + 1).reduce((s, e) => s + e.amount, 0);
      return { day: i + 1, total: cum };
    });
    return { spent, today, rows, trend, top: [...rows].sort((a, b) => b.spent - a.spent)[0] };
  }, [expenses, categories, budget]);

  const total = budget?.total ?? 0, daily = dailyLimit(total, d.spent, now), p = pace(total, d.spent, now);
  const pct = total ? (d.spent / total) * 100 : 0;
  useEffect(() => { if (pct > 90 && !warned.current) { warned.current = true; toast.warning(`You've used ${pct.toFixed(0)}% of this month's budget`); } }, [pct]);
  if (loading) return <p className="text-mute">Loading…</p>;

  return (
    <div className="space-y-4">
      <section className="bg-panel border border-line rounded-xl p-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-mute">Suggested daily limit</p>
          <p className="text-4xl font-bold text-accent">{total ? money(daily) : "Set a budget"}</p></div>
        <p className={`font-semibold ${p.cls}`}>{p.label}</p>
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Spent this month"><p className="text-2xl font-bold">{money(d.spent)}</p>
          <p className="text-sm text-mute">of {total ? money(total) : "no budget"}</p>
          <div className="h-2 mt-2 bg-ink rounded"><div className={`h-2 rounded ${barColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></Card>
        <Card title="Today"><p className="text-2xl font-bold">{money(d.today)}</p>
          <p className={`text-sm ${total && d.today > daily ? "text-red-400" : "text-mute"}`}>limit {total ? money(daily) : "—"}</p></Card>
        <Card title="Top category"><p className="text-2xl font-bold" style={{ color: d.top?.color }}>{d.top?.spent ? d.top.name : "—"}</p>
          <p className="text-sm text-mute">{d.top?.spent ? money(d.top.spent) : "No spending yet"}</p></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Category share">
          <ResponsiveContainer width="100%" height={260}><PieChart>
            <Pie data={d.rows.filter((r) => r.spent > 0)} dataKey="spent" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2} stroke="none">
              {d.rows.filter((r) => r.spent > 0).map((r) => <Cell key={r.$id} fill={r.color} />)}</Pie>
            <Tooltip {...tip} formatter={(v: number) => [`${money(v)} (${((v / (d.spent || 1)) * 100).toFixed(0)}%)`]} /><Legend /></PieChart></ResponsiveContainer></Card>
        <Card title="Budget vs actual">
          <ResponsiveContainer width="100%" height={260}><BarChart data={d.rows}>
            <XAxis dataKey="name" tick={{ fill: "#8a9a93", fontSize: 11 }} /><YAxis tick={{ fill: "#8a9a93", fontSize: 11 }} />
            <Tooltip {...tip} formatter={(v: number) => money(v)} /><Legend />
            <Bar dataKey="budget" fill="#3b4a44" name="Budget" radius={[4, 4, 0, 0]} /><Bar dataKey="spent" fill="#e6b450" name="Spent" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Card>
        <div className="lg:col-span-2"><Card title="Cumulative daily spending">
          <ResponsiveContainer width="100%" height={240}><LineChart data={d.trend}>
            <CartesianGrid stroke="#26302c" /><XAxis dataKey="day" tick={{ fill: "#8a9a93", fontSize: 11 }} /><YAxis tick={{ fill: "#8a9a93", fontSize: 11 }} />
            <Tooltip {...tip} formatter={(v: number) => money(v)} labelFormatter={(l) => `Day ${l}`} />
            <Line dataKey="total" stroke="#e6b450" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></Card></div>
      </div>
      <Card title="Budget usage by category"><div className="space-y-3">
        {d.rows.filter((r) => r.budget > 0).map((r) => { const x = (r.spent / r.budget) * 100; return (
          <div key={r.$id}><div className="flex justify-between text-sm"><span>{r.name}</span><span className="text-mute">{money(r.spent)} / {money(r.budget)}</span></div>
            <div className="h-2 mt-1 bg-ink rounded"><div className={`h-2 rounded ${barColor(x)}`} style={{ width: `${Math.min(x, 100)}%` }} /></div></div>); })}
        {!d.rows.some((r) => r.budget > 0) && <p className="text-sm text-mute">Set category limits in Budget to see usage here.</p>}</div></Card>
    </div>
  );
}
