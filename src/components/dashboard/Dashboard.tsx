import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Legend, LineChart, Line, CartesianGrid } from "recharts";
import { useData } from "../../lib/hooks";
import { money, monthKey, suggestedDailyLimit, pace, barColor } from "../../lib/utils";
import { accountCashFlow, categorySpend, friendBalances } from "../../lib/services/finance";
import { isSystemCategory } from "../../lib/services/categories";
import { standaloneCashFlow, summarizeMonth } from "../../lib/summary";

const Card = ({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) => (
  <section className={`min-w-0 overflow-hidden rounded-xl border border-line bg-panel p-4 ${className}`}>
    <h3 className="mb-2 truncate text-sm text-mute">{title}</h3>{children}
  </section>
);
const tip = { contentStyle: { background: "#151c2c", color: "#edf2ff", border: "1px solid #29334a", borderRadius: 8 }, itemStyle: { color: "#edf2ff" }, labelStyle: { color: "#edf2ff" } };

export default function Dashboard({ month }: { month?: Date }) {
  const { categories, expenses, budget, finance, trips, loading } = useData(month);
  const dayKey = new Date().toDateString();
  // Stable between renders (so the numbers below are only recomputed when something changes), but still rolls over at midnight.
  const now = useMemo(() => month ?? new Date(), [month, dayKey]);
  const mk = monthKey(now), warned = useRef(false);
  const isPastMonth = !!month && mk !== monthKey(new Date());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const d = useMemo(() => {
    const summary = summarizeMonth(expenses, finance, trips, mk);
    const monthExpenses = summary.expensesInMonth;
    const { byCategory: byCat, tripSpent, categorizedSpent: effective, cashSpent: actual, reconciliation, mismatch, unrecorded } = summary;
    const sameDay = (iso: string) => new Date(iso).toDateString() === now.toDateString();
    const todayEffective = monthExpenses.filter((expense) => sameDay(expense.timestamp)).reduce((sum, expense) => sum + categorySpend(expense, finance), 0);
    const rows = [
      ...categories.filter((c) => !isSystemCategory(c)).map((c) => ({ ...c, spent: byCat[c.$id] ?? 0, budget: budget?.limits[c.$id] ?? 0 })),
      { $id: "__trip__", userId: "", name: "Trip", color: "#a78bfa", isDefault: false, spent: tripSpent, budget: 0 },
    ];
    const balances = friendBalances(finance);
    const receivable = balances.reduce((sum, row) => sum + row.theyOweYou, 0);
    const payable = balances.reduce((sum, row) => sum + row.youOweThem, 0);
    let cashCum = 0, effectiveCum = 0;
    const trend = Array.from({ length: isPastMonth ? daysInMonth : now.getDate() }, (_, i) => {
      const day = monthExpenses.filter((e) => new Date(e.timestamp).getDate() === i + 1);
      cashCum += day.reduce((s, e) => s + accountCashFlow(e, finance), 0)
        + standaloneCashFlow(finance, (iso) => monthKey(new Date(iso)) === mk && new Date(iso).getDate() === i + 1);
      effectiveCum += day.reduce((s, e) => s + categorySpend(e, finance), 0);
      return { day: i + 1, actual: Math.round(cashCum * 100) / 100, effective: Math.round(effectiveCum * 100) / 100 };
    });
    return { actual, effective, tripSpent, reconciliation, mismatch, unrecorded, todayEffective, rows, receivable, payable, net: receivable - payable, trend,
      top: [...rows].sort((a, b) => b.spent - a.spent)[0] };
  }, [expenses, categories, budget, finance, trips, mk, isPastMonth, daysInMonth, now]);

  const monthEnd = month ? new Date(month.getFullYear(), month.getMonth() + 1, 0) : now;
  const total = budget?.total ?? 0;
  // Budgets and daily limits are about your own spending, so they use the effective figure.
  const p = pace(total, d.effective, monthEnd);
  const pct = total ? (d.effective / total) * 100 : 0;
  const savings = Math.max(budget?.savings ?? 0, 0);
  const salaryAllocationLeft = finance.salary - total - savings;
  // Salary remaining follows your bank balance, so it uses what actually left the account.
  const salaryRemaining = finance.salary - d.actual - savings;
  // The daily limit respects both your budget and the money actually left in your account, whichever is lower.
  const limit = isPastMonth ? null : suggestedDailyLimit({
    budgetLeft: total > 0 ? total - d.effective : null,
    accountLeft: finance.salary > 0 ? salaryRemaining : null,
  }, now);
  const shares = d.rows.filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent);
  const rec = d.reconciliation;
  const bridge = [
    { label: "Paid for others or lent", note: "Cash out that isn't your spending. Others owe it back.", sign: "−", value: rec.receivableAdded },
    { label: "Paid back to you", note: "Money returning from what you paid for others.", sign: "+", value: rec.receivableCollected },
    { label: "Paid by others or borrowed", note: "Your spending that didn't leave your account. You owe it.", sign: "+", value: rec.payableAdded },
    { label: "You paid back", note: "Cash out that clears what you owed, not new spending.", sign: "−", value: rec.payableSettled },
  ].filter((row) => row.value > 0.004);
  useEffect(() => { if (!isPastMonth && pct > 90 && !warned.current) { warned.current = true; toast.warning(`You've used ${pct.toFixed(0)}% of this month's budget`); } }, [pct, isPastMonth]);
  if (loading) return <p className="text-mute" role="status">Loading your overview…</p>;

  return (
    <div className="min-w-0 space-y-4">
      {/* The two numbers that matter, side by side */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="Spending this month">
        <div className="min-w-0 rounded-xl border border-accent/40 bg-panel p-5">
          <p className="text-sm text-mute">{isPastMonth ? "Your spending that month" : "Your spending this month"}</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-accent">{money(d.effective)}</p>
          <p className="mt-1 text-xs leading-relaxed text-mute">What you would have spent if you had paid for everything yourself. This is what categories and budgets use.</p>
          {total > 0 && <>
            <div className="mt-3 h-2 overflow-hidden rounded bg-ink"><div className={`h-2 rounded ${barColor(pct)}`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} /></div>
            <p className="mt-1.5 flex justify-between gap-3 text-xs text-mute"><span>{money(d.effective)} of {money(total)} budget</span><span className={p.cls}>{p.label}</span></p>
          </>}
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-panel p-5">
          <p className="text-sm text-mute">{isPastMonth ? "Left your account that month" : "Left your account this month"}</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">{money(d.actual)}</p>
          <p className="mt-1 text-xs leading-relaxed text-mute">Actual money that moved through your bank. Money borrowed or paid back to you counts here, but is not spending.</p>
          <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-sm">
            <span className="text-mute">Salary remaining</span>
            <span className={`font-semibold ${salaryRemaining < 0 ? "text-red-300" : "text-text"}`}>
              {finance.salary ? `${salaryRemaining < 0 ? "−" : ""}${money(Math.abs(salaryRemaining))}` : "Add your salary"}
            </span>
          </p>
        </div>
      </section>

      {/* How the two numbers connect */}
      <Card title="How the two numbers connect">
        <dl className="space-y-2.5 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt>Left your account</dt><dd className="font-medium">{money(d.actual)}</dd></div>
          {bridge.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0"><span className="block">{row.label}</span><span className="block text-xs text-mute">{row.note}</span></dt>
              <dd className={`shrink-0 font-medium ${row.sign === "+" ? "text-emerald-300" : "text-red-300"}`}>{row.sign} {money(row.value)}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5 font-semibold"><dt>Your spending</dt><dd className="text-accent">{money(d.effective)}</dd></div>
        </dl>
        {bridge.length === 0 && <p className="mt-3 text-xs text-mute">You paid for everything yourself this month, so both numbers match.</p>}
        {(d.unrecorded.paid > 0.004 || d.unrecorded.received > 0.004) && (
          <p className="mt-3 rounded-lg border border-line bg-ink p-2.5 text-xs leading-relaxed text-mute">
            {[d.unrecorded.paid > 0.004 ? `${money(d.unrecorded.paid)} you paid back` : "", d.unrecorded.received > 0.004 ? `${money(d.unrecorded.received)} paid back to you` : ""].filter(Boolean).join(" and ")}{" "}
            this month was marked as repaid without a payment transaction, so it is counted as money that left (or reached) your account.
          </p>
        )}
        {Math.abs(d.mismatch) > 0.5 && (
          <p role="status" className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs text-amber-200">
            These don't add up exactly: {money(Math.abs(d.mismatch))} difference. Some older records may be incomplete.
          </p>
        )}
        <p className="mt-3 text-xs text-mute">
          Change in what's owed to you this month: <span className="font-medium text-text">{rec.netChange > 0 ? "+" : rec.netChange < 0 ? "−" : ""}{money(Math.abs(rec.netChange))}</span>.
          Your spending = left your account − that change.
        </p>
      </Card>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card title="Monthly salary"><p className="text-xl font-bold">{finance.salary ? money(finance.salary) : "Not set"}</p>
          <p className="text-xs text-mute">Set under Budget and salary</p></Card>
        <Card title={isPastMonth ? "Average per day" : "Suggested daily limit"}>
          <p className="text-xl font-bold">{isPastMonth ? money(d.effective / daysInMonth) : limit ? money(limit.perDay) : "Not set"}</p>
          <p className={`text-xs leading-relaxed ${limit && d.todayEffective > limit.perDay ? "text-red-300" : "text-mute"}`}>
            {isPastMonth ? `${daysInMonth} days in month` : limit
              ? `Today: ${money(d.todayEffective)} · ${limit.limitedBy === "account" ? "limited by what's left in your account" : "based on your budget"}`
              : "Set a budget or salary to see this"}</p></Card>
        <Card title="Planned savings"><p className="text-xl font-bold text-emerald-400">{money(savings)}</p>
          <p className="text-xs text-mute">{finance.salary
            ? salaryAllocationLeft >= 0 ? `${money(salaryAllocationLeft)} left to allocate` : `${money(Math.abs(salaryAllocationLeft))} over salary allocation`
            : "Add salary to see allocation"}</p></Card>
        <Card title="Trip spending"><p className="text-xl font-bold text-violet-300">{money(d.tripSpent)}</p>
          <p className="text-xs text-mute">{d.top?.spent ? `Top category: ${d.top.name}` : "No spending yet"}</p></Card>
      </section>

      <Card title="Who owes whom, all time">
        <div className="grid grid-cols-3 gap-3">
          <div><p className="text-xs text-mute">Others owe you</p><p className="text-lg font-bold text-emerald-400">{money(d.receivable)}</p></div>
          <div><p className="text-xs text-mute">You owe others</p><p className="text-lg font-bold text-red-300">{money(d.payable)}</p></div>
          <div><p className="text-xs text-mute">Net</p><p className={`text-lg font-bold ${d.net < 0 ? "text-red-300" : "text-emerald-400"}`}>{d.net < 0 ? "−" : ""}{money(Math.abs(d.net))}</p></div>
        </div>
        <p className="mt-2 text-xs text-mute">{d.net > 0 ? "More is owed to you than you owe." : d.net < 0 ? "You owe more than is owed to you." : "Nothing outstanding overall."}{" "}
          <Link to="/owing" className="font-medium text-accent">See who</Link></p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your spending by category">
          {shares.length === 0 ? <p className="py-8 text-center text-sm text-mute">Add a transaction and your spending by category will show up here.</p> : (
            <div className="grid min-w-0 items-center gap-4 md:grid-cols-2">
              <div className="hidden min-w-0 md:block">
                <ResponsiveContainer width="100%" height={220}><PieChart>
                  <Pie data={shares} dataKey="spent" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={2} stroke="none">
                    {shares.map((r) => <Cell key={r.$id} fill={r.color} />)}</Pie>
                  <Tooltip {...tip} formatter={(v: number) => [money(v), "Spent"]} />
                </PieChart></ResponsiveContainer>
              </div>
              <div className="min-w-0 space-y-3 md:max-h-[220px] md:overflow-y-auto md:overscroll-contain md:pr-2">
                {shares.map((r) => {
                  const share = (r.spent / (d.effective || 1)) * 100;
                  return (
                    <div key={r.$id} className="min-w-0">
                      <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} /><span className="truncate">{r.name}</span></span>
                        <span className="shrink-0 text-right"><span className="font-medium">{money(r.spent)}</span><span className="ml-2 text-xs text-mute">{share.toFixed(0)}%</span></span>
                      </div>
                      <div role="progressbar" aria-label={`${r.name} share of spending`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(share, 100)}%`, background: r.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {shares.length > 0 && <p className="mt-3 border-t border-line pt-2 text-xs text-mute">Adds up to {money(d.effective)}, your spending above.</p>}
        </Card>
        <Card title="Budget vs spending">
          <ResponsiveContainer width="100%" height={260}><BarChart data={d.rows.filter((r) => r.spent > 0 || r.budget > 0)}>
            <XAxis dataKey="name" tick={{ fill: "#9aa8c2", fontSize: 11 }} tickFormatter={(name: string) => name.length > 9 ? `${name.slice(0, 8)}…` : name} interval="preserveStartEnd" />
            <YAxis width={48} tick={{ fill: "#9aa8c2", fontSize: 10 }} />
            <Tooltip {...tip} formatter={(v: number) => money(v)} /><Legend />
            <Bar dataKey="budget" fill="#52617d" name="Budget" radius={[4, 4, 0, 0]} /><Bar dataKey="spent" fill="#7187ff" name="Spent" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Card>
        <div className="lg:col-span-2"><Card title="Cumulative daily spending">
          <ResponsiveContainer width="100%" height={240}><LineChart data={d.trend}>
            <CartesianGrid stroke="#29334a" /><XAxis dataKey="day" tick={{ fill: "#9aa8c2", fontSize: 11 }} /><YAxis tick={{ fill: "#9aa8c2", fontSize: 11 }} />
            <Tooltip {...tip} formatter={(v: number) => money(v)} labelFormatter={(l) => `Day ${l}`} /><Legend />
            <Line dataKey="effective" name="Your spending" stroke="#7187ff" strokeWidth={2} dot={false} />
            <Line dataKey="actual" name="Left your account" stroke="#9aa8c2" strokeWidth={2} strokeDasharray="5 4" dot={false} /></LineChart></ResponsiveContainer></Card></div>
      </div>
      <Card title="Budget usage by category"><div className="space-y-3">
        {d.rows.filter((r) => r.budget > 0).map((r) => { const x = (r.spent / r.budget) * 100; return (
          <div key={r.$id}><div className="flex justify-between text-sm"><span>{r.name}</span><span className="text-mute">{money(r.spent)} / {money(r.budget)}</span></div>
            <div className="mt-1 h-2 rounded bg-ink"><div className={`h-2 rounded ${barColor(x)}`} style={{ width: `${Math.min(x, 100)}%` }} /></div></div>); })}
        {!d.rows.some((r) => r.budget > 0) && <p className="text-sm text-mute">Set category limits under Budget and salary to track them here.</p>}</div></Card>
    </div>
  );
}
