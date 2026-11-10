import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Legend, LineChart, Line, CartesianGrid } from "recharts";
import { useData } from "../../lib/hooks";
import { money, monthKey, dailyLimit, pace, barColor } from "../../lib/utils";
import { actualCashOut } from "../../lib/services/finance";
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="min-w-0 bg-panel border border-line rounded-xl p-4"><h3 className="text-sm text-mute mb-2">{title}</h3>{children}</section>);
const tip = { contentStyle: { background: "#151c2c", color: "#edf2ff", border: "1px solid #29334a", borderRadius: 8 }, itemStyle: { color: "#edf2ff" }, labelStyle: { color: "#edf2ff" } };

export default function Dashboard({ month }: { month?: Date }) {
  const { categories, expenses, budget, finance, trips, loading } = useData(month);
  const now = month ?? new Date(), mk = monthKey(now), warned = useRef(false);
  const isPastMonth = !!month && mk !== monthKey(new Date());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const d = useMemo(() => {
    const friendPaid = (finance.friendPaidExpenses ?? [])
      .filter((item) => monthKey(new Date(item.timestamp)) === mk)
      .reduce((sum, item) => sum + (item.originalAmount ?? item.amount), 0);
    const month = expenses.filter((e) =>
      e.timestamp.startsWith(mk) || monthKey(new Date(e.timestamp)) === mk);
    const expenseSpent = month.reduce((sum, expense) => sum + expense.amount, 0);
    const cashOutFromExpenses = month.reduce((sum, expense) =>
      sum + actualCashOut(expense.$id, expense.amount, finance), 0);
    const lentThisMonth = finance.loans.filter((loan) => !loan.expenseId && monthKey(new Date(loan.timestamp)) === mk).reduce((sum, loan) => sum + loan.amount, 0);
    const borrowedThisMonth = (finance.borrowings ?? [])
      .filter((borrowing) => monthKey(new Date(borrowing.timestamp)) === mk)
      .reduce((sum, borrowing) => sum + borrowing.amount, 0);
    const spent = cashOutFromExpenses + lentThisMonth;
    const todayExpenses = month.filter((expense) =>
      new Date(expense.timestamp).toDateString() === now.toDateString())
      .reduce((sum, expense) => sum + actualCashOut(expense.$id, expense.amount, finance), 0);
    const today = todayExpenses
      + finance.loans.filter((loan) => !loan.expenseId && monthKey(new Date(loan.timestamp)) === mk && new Date(loan.timestamp).toDateString() === now.toDateString()).reduce((sum, loan) => sum + loan.amount, 0);
    const tripExpenseIds = new Set(trips.flatMap((trip) => trip.expenseIds));
    const tripSpent = month
      .filter((expense) => tripExpenseIds.has(expense.$id))
      .reduce((sum, expense) => sum + expense.amount, 0);
    const byCat: Record<string, number> = {};
    month.forEach((expense) => {
      if (tripExpenseIds.has(expense.$id)) return;
      if (/^Settlement (paid to|received from) /i.test(expense.note)) return;
      byCat[expense.categoryId] = (byCat[expense.categoryId] ?? 0) + expense.amount;
    });
    byCat["__trip__"] = tripSpent;
    const rows = [
      ...categories.map((c) => ({ ...c, spent: byCat[c.$id] ?? 0, budget: budget?.limits[c.$id] ?? 0 })),
      { $id: "__trip__", userId: "", name: "Trip", color: "#a78bfa", isDefault: false, spent: tripSpent, budget: 0 },
    ];
    const moneyOwed = finance.loans.reduce((sum, loan) => sum + Math.max(loan.amount - loan.repaid, 0), 0);
    const received = finance.loans.reduce((sum, loan) =>
      sum + (loan.repayments ?? []).filter((payment) => monthKey(new Date(payment.timestamp)) === mk)
        .reduce((paymentSum, payment) => paymentSum + payment.amount, 0), 0);
    const debtsToFriends = finance.friendPaidExpenses ?? [];
    const oweToFriends = debtsToFriends.reduce((sum, debt) => sum + Math.max(debt.amount - (debt.repaid ?? 0), 0), 0);
    const paidToFriends = debtsToFriends.reduce((sum, debt) =>
      sum + (debt.repayments ?? []).filter((payment) => monthKey(new Date(payment.timestamp)) === mk)
        .reduce((paymentSum, payment) => paymentSum + payment.amount, 0), 0);
    const borrowings = finance.borrowings ?? [];
    const borrowingOutstanding = borrowings.reduce((sum, borrowing) =>
      sum + Math.max(borrowing.amount - borrowing.repaid, 0), 0);
    const borrowingRepaid = borrowings.reduce((sum, borrowing) =>
      sum + (borrowing.repayments ?? []).filter((payment) => monthKey(new Date(payment.timestamp)) === mk)
        .reduce((paymentSum, payment) => paymentSum + payment.amount, 0), 0);
    let cum = 0; const trend = Array.from({ length: isPastMonth ? daysInMonth : now.getDate() }, (_, i) => {
      cum += month.filter((e) => new Date(e.timestamp).getDate() === i + 1).reduce((s, e) => s + actualCashOut(e.$id, e.amount, finance), 0)
        + finance.loans.filter((loan) => !loan.expenseId && monthKey(new Date(loan.timestamp)) === mk && new Date(loan.timestamp).getDate() === i + 1).reduce((sum, loan) => sum + loan.amount, 0);
      return { day: i + 1, total: cum };
    });
    return { spent, expenseSpent, tripSpent, friendPaid, received, moneyOwed, oweToFriends, paidToFriends,
      borrowedThisMonth, borrowingOutstanding, borrowingRepaid, today, rows, trend, average: spent / daysInMonth,
      top: [...rows].sort((a, b) => b.spent - a.spent)[0] };
  }, [expenses, categories, budget, finance, trips, mk, isPastMonth, daysInMonth, now]);

  const monthEnd = month ? new Date(month.getFullYear(), month.getMonth() + 1, 0) : now;
  const total = budget?.total ?? 0;
  const daily = isPastMonth ? (total ? total / daysInMonth : 0) : dailyLimit(total, d.spent, now);
  const p = pace(total, d.spent, monthEnd);
  const pct = total ? (d.spent / total) * 100 : 0;
  const configuredSavings = budget?.savings ?? 0;
  const savings = Math.max(configuredSavings, 0);
  const salaryAllocationLeft = finance.salary - total - savings;
  const salaryRemaining = finance.salary - d.spent - savings;
  const shares = d.rows.filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent);
  useEffect(() => { if (!isPastMonth && pct > 90 && !warned.current) { warned.current = true; toast.warning(`You've used ${pct.toFixed(0)}% of this month's budget`); } }, [pct, isPastMonth]);
  if (loading) return <p className="text-mute">Loading…</p>;

  return (
    <div className="min-w-0 space-y-4">
      <section className="bg-panel border border-line rounded-xl p-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm text-mute">{isPastMonth ? "Monthly average per day" : "Suggested daily limit"}</p>
          <p className="text-4xl font-bold text-accent">{total ? money(daily) : "Set a budget"}</p></div>
        <p className={`font-semibold ${p.cls}`}>{p.label}</p>
      </section>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card title="Monthly salary"><p className="text-xl font-bold">{finance.salary ? money(finance.salary) : "Not set"}</p>
          <p className="text-xs text-mute">Set in Budget</p></Card>
        <Card title="Planned budget"><p className="text-xl font-bold">{total ? money(total) : "Not set"}</p>
          <p className="text-xs text-mute">{isPastMonth ? "Monthly limit" : "This month's limit"}</p></Card>
        <Card title="Planned savings"><p className="text-xl font-bold text-emerald-400">{money(savings)}</p>
          <p className="text-xs text-mute">
            {finance.salary
              ? salaryAllocationLeft >= 0
                ? `${money(salaryAllocationLeft)} left to allocate`
                : `${money(Math.abs(salaryAllocationLeft))} over salary allocation`
              : "Add salary to see allocation"}
          </p></Card>
        <Card title="Salary remaining"><p className={`text-xl font-bold ${salaryRemaining < 0 ? "text-red-300" : "text-accent"}`}>
          {finance.salary ? `${salaryRemaining < 0 ? "-" : ""}${money(Math.abs(salaryRemaining))}` : "Not set"}
        </p>
          <p className="text-xs text-mute">{finance.salary
            ? salaryRemaining >= 0
              ? "After spending and planned savings"
              : "Spent and savings exceed salary"
            : "Add salary to see remaining salary"}</p></Card>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title={isPastMonth ? "Spent in month" : "Spent this month"}><p className="text-2xl font-bold">{money(d.spent)}</p>
          <p className="text-sm text-mute">of {total ? money(total) : "no budget"}</p>
          <div className="h-2 mt-2 bg-ink rounded"><div className={`h-2 rounded ${barColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></Card>
        <Card title={isPastMonth ? "Average per day" : "Today"}><p className="text-2xl font-bold">{money(isPastMonth ? d.average : d.today)}</p>
          <p className={`text-sm ${total && !isPastMonth && d.today > daily ? "text-red-400" : "text-mute"}`}>{isPastMonth ? `${daysInMonth} days in month` : `limit ${total ? money(daily) : "—"}`}</p></Card>
        <Card title="Top category"><p className="text-2xl font-bold text-text">{d.top?.spent ? d.top.name : "—"}</p>
          <p className="text-sm text-mute">{d.top?.spent ? money(d.top.spent) : "No spending yet"}</p></Card>
        <Card title="Trip spending"><p className="text-2xl font-bold text-violet-300">{money(d.tripSpent)}</p>
          <p className="text-sm text-mute">{finance.salary
            ? `${((d.tripSpent / finance.salary) * 100).toFixed(0)}% of monthly salary`
            : "Add salary to compare"}</p></Card>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card title="Paid by others"><p className="text-xl font-bold text-sky-300">{money(d.friendPaid)}</p>
          <p className="text-xs text-mute">Outside account cash out; included in categories</p></Card>
        <Card title="Receivable"><p className="text-xl font-bold text-emerald-400">{money(d.moneyOwed)}</p>
          <p className="text-xs text-mute">Not yet received</p></Card>
        <Card title={isPastMonth ? "Received that month" : "Received this month"}><p className="text-xl font-bold text-emerald-400">{money(d.received)}</p>
          <p className="text-xs text-mute">Repayments credited</p></Card>
        <Card title="Payable"><p className="text-xl font-bold text-red-300">{money(d.oweToFriends + d.borrowingOutstanding)}</p>
          <p className="text-xs text-mute">Shared expenses and money borrowed</p></Card>
        <Card title={isPastMonth ? "Paid out that month" : "Paid out this month"}><p className="text-xl font-bold text-red-300">{money(d.paidToFriends)}</p>
          <p className="text-xs text-mute">Payments applied to balances</p></Card>
        <Card title={isPastMonth ? "Borrowed that month" : "Borrowed this month"}><p className="text-xl font-bold text-violet-300">{money(d.borrowedThisMonth)}</p>
          <p className="text-xs text-mute">Not counted as income</p></Card>
        <Card title="Borrowing payable"><p className="text-xl font-bold text-red-300">{money(d.borrowingOutstanding)}</p>
          <p className="text-xs text-mute">Remaining balance</p></Card>
        <Card title={isPastMonth ? "Borrowing repaid" : "Borrowing repaid this month"}><p className="text-xl font-bold">{money(d.borrowingRepaid)}</p>
          <p className="text-xs text-mute">Payments applied to borrowings</p></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Category share">
          {shares.length === 0 ? <p className="py-8 text-center text-sm text-mute">Your category spending will appear here.</p> : (
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
                  const share = (r.spent / (d.expenseSpent || 1)) * 100;
                  return (
                    <div key={r.$id} className="min-w-0">
                      <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="font-medium">{money(r.spent)}</span>
                          <span className="ml-2 text-xs text-mute">{share.toFixed(0)}%</span>
                        </span>
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
        </Card>
        <Card title="Budget vs actual">
          <ResponsiveContainer width="100%" height={260}><BarChart data={d.rows}>
            <XAxis dataKey="name" tick={{ fill: "#9aa8c2", fontSize: 11 }} tickFormatter={(name: string) => name.length > 9 ? `${name.slice(0, 8)}…` : name} interval="preserveStartEnd" />
            <YAxis width={48} tick={{ fill: "#9aa8c2", fontSize: 10 }} />
            <Tooltip {...tip} formatter={(v: number) => money(v)} /><Legend />
            <Bar dataKey="budget" fill="#52617d" name="Budget" radius={[4, 4, 0, 0]} /><Bar dataKey="spent" fill="#7187ff" name="Spent" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Card>
        <div className="lg:col-span-2"><Card title="Cumulative daily spending">
          <ResponsiveContainer width="100%" height={240}><LineChart data={d.trend}>
            <CartesianGrid stroke="#29334a" /><XAxis dataKey="day" tick={{ fill: "#9aa8c2", fontSize: 11 }} /><YAxis tick={{ fill: "#9aa8c2", fontSize: 11 }} />
            <Tooltip {...tip} formatter={(v: number) => money(v)} labelFormatter={(l) => `Day ${l}`} />
            <Line dataKey="total" stroke="#4d65ff" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></Card></div>
      </div>
      <Card title="Budget usage by category"><div className="space-y-3">
        {d.rows.filter((r) => r.budget > 0).map((r) => { const x = (r.spent / r.budget) * 100; return (
          <div key={r.$id}><div className="flex justify-between text-sm"><span>{r.name}</span><span className="text-mute">{money(r.spent)} / {money(r.budget)}</span></div>
            <div className="h-2 mt-1 bg-ink rounded"><div className={`h-2 rounded ${barColor(x)}`} style={{ width: `${Math.min(x, 100)}%` }} /></div></div>); })}
        {!d.rows.some((r) => r.budget > 0) && <p className="text-sm text-mute">Set category limits in Budget to see usage here.</p>}</div></Card>
    </div>
  );
}
