import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Modal from "../Modal";
import { useConfirm } from "../Confirm";
import { useData } from "../../lib/hooks";
import { addMonthsClamped, buildEmiSchedule, MAX_MONTHS, parseDate, validateEmiInput, type EmiInput } from "../../lib/emiSchedule";
import { createEmi, materializeDueEmis, todayString } from "../../lib/services/emis";
import { isCatchAll, isSystemCategory } from "../../lib/services/categories";
import { errorMessage } from "../../lib/errors";
import { evaluateAmount, money } from "../../lib/utils";

const prettyDate = (date: string) => {
  const d = parseDate(date);
  return d ? new Date(d.y, d.m - 1, d.d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : date;
};
/** Empty means zero (for optional fields); anything else is read like a calculator; unreadable is NaN. */
const amountOf = (text: string) => (text.trim() === "" ? 0 : (evaluateAmount(text) ?? NaN));

const Field = ({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-sm font-medium">{label}</span>
    {children}
    {error ? <span role="alert" className="mt-1 block text-xs text-red-300">{error}</span> : hint ? <span className="mt-1 block text-xs text-mute">{hint}</span> : null}
  </label>
);

export default function EmiForm({ onClose }: { onClose: () => void }) {
  const { uid, categories, expenses } = useData();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const today = todayString();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [mode, setMode] = useState<"emi" | "price">("emi");
  const [price, setPrice] = useState("");
  const [emiAmount, setEmiAmount] = useState("");
  const [months, setMonths] = useState("3");
  const [rate, setRate] = useState("0");
  const [down, setDown] = useState("");
  const [fee, setFee] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [firstDue, setFirstDue] = useState(addMonthsClamped(today, 1));
  const [firstDueTouched, setFirstDueTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const categoryTouched = useRef(false);
  const [edits, setEdits] = useState<{ key: string; values: Record<number, string> }>({ key: "", values: {} });

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    expenses.forEach((item) => { result[item.categoryId] = (result[item.categoryId] ?? 0) + 1; });
    return result;
  }, [expenses]);
  const choices = categories.filter((category) => !isSystemCategory(category))
    .sort((a, b) => Number(isCatchAll(a)) - Number(isCatchAll(b)) || (counts[b.$id] ?? 0) - (counts[a.$id] ?? 0) || a.name.localeCompare(b.name));
  const noteCategory = useMemo(() => {
    const known = new Map<string, string>();
    [...expenses].reverse().forEach((item) => { if (item.note.trim()) known.set(item.note.trim().toLocaleLowerCase(), item.categoryId); });
    return known;
  }, [expenses]);

  // Hand-edited amounts only make sense for the numbers they were edited against.
  const baseKey = [mode, price, emiAmount, months, rate, down, fee].join("|");
  const overrides = useMemo(() => {
    if (edits.key !== baseKey) return {};
    return Object.fromEntries(Object.entries(edits.values).map(([index, text]) => [Number(index), amountOf(text)]));
  }, [edits, baseKey]);
  const input: EmiInput = {
    mode, price: amountOf(price), emiAmount: amountOf(emiAmount), months: Number(months), annualRate: rate.trim() === "" ? 0 : Number(rate),
    downPayment: amountOf(down), fee: amountOf(fee), purchaseDate, firstDue, overrides,
  };
  const errors: Record<string, string> = validateEmiInput(input);
  if (!name.trim()) errors.name = "Enter what you bought.";
  if (!categoryId) errors.category = "Choose a category.";
  const ready = Object.keys(errors).length === 0;
  const baseErrors = Object.keys(errors).filter((key) => key !== "name" && key !== "category" && key !== "overrides").length === 0;
  // The preview stays visible while a hand-edited amount is invalid, so it can be corrected; saving stays blocked by errors.overrides.
  const validOverrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => Number.isFinite(value) && value > 0));
  const schedule = baseErrors ? buildEmiSchedule({ ...input, overrides: validOverrides }) : null;
  const dueNow = schedule ? [
    ...(schedule.upfront > 0 && purchaseDate <= today ? [{ amount: schedule.upfront }] : []),
    ...schedule.installments.filter((item) => item.due <= today),
  ] : [];
  const show = (key: string) => (submitted ? errors[key] : undefined);

  const m = useMutation({
    mutationFn: async () => {
      const plan = await createEmi({ name, categoryId, input });
      const result = await materializeDueEmis(uid);
      return { plan, added: result.created.length };
    },
    onSuccess: ({ plan, added }) => {
      qc.invalidateQueries({ queryKey: ["emis"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      toast.success(added ? `EMI created. ${added} payment${added === 1 ? "" : "s"} already due ${added === 1 ? "was" : "were"} added.` : `EMI created. The first payment is on ${prettyDate(plan.installments[0].due)}.`);
      onClose();
    },
    onError: (error: unknown) => toast.error(errorMessage(error, "Couldn't create the EMI. Please try again.")),
  });

  const submit = async () => {
    setSubmitted(true);
    if (!ready || !schedule) { toast.error(Object.values(errors)[0]); return; }
    if (dueNow.length) {
      const total = dueNow.reduce((sum, item) => sum + item.amount, 0);
      const ok = await confirm({
        title: "Add payments that are already due?",
        message: `${dueNow.length} payment${dueNow.length === 1 ? "" : "s"} totalling ${money(total)} fall on or before today, so ${dueNow.length === 1 ? "it" : "they"} will be added to your transactions now, dated on the due ${dueNow.length === 1 ? "date" : "dates"}.`,
        confirmLabel: "Create EMI",
      });
      if (!ok) return;
    }
    m.mutate();
  };

  const onName = (value: string) => {
    setName(value);
    const remembered = noteCategory.get(value.trim().toLocaleLowerCase());
    if (!categoryTouched.current && remembered && categories.some((category) => category.$id === remembered)) setCategoryId(remembered);
  };
  const onPurchase = (value: string) => {
    setPurchaseDate(value);
    if (!firstDueTouched && parseDate(value)) setFirstDue(addMonthsClamped(value, 1));
  };
  const setEdit = (index: number, value: string) => setEdits({ key: baseKey, values: { ...(edits.key === baseKey ? edits.values : {}), [index]: value } });
  const hasEdits = Object.keys(overrides).length > 0;

  return (
    <Modal title="Add an EMI" onClose={onClose} footer={
      <button className="btn w-full disabled:opacity-40" type="submit" form="emi-form" disabled={m.isPending}>{m.isPending ? "Creating…" : "Create EMI"}</button>
    }>
      <form id="emi-form" className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p className="text-xs leading-relaxed text-mute">Each monthly payment is added to your transactions on its due date, in the category you choose. It counts in that month's spending and comes out of that month's account balance.</p>

        <Field label="What did you buy?" error={show("name")}>
          <input className="input" value={name} maxLength={60} placeholder="e.g. Trimmer" autoComplete="off" autoFocus aria-invalid={!!show("name")} onChange={(e) => onName(e.target.value)} />
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Category</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
            {choices.map((category) => {
              const active = categoryId === category.$id;
              return (
                <button key={category.$id} type="button" role="radio" aria-checked={active}
                  className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${active ? "border-accent bg-accent/10 font-medium text-text" : "border-line bg-ink text-mute hover:text-text"}`}
                  onClick={() => { categoryTouched.current = true; setCategoryId(category.$id); }}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: category.color }} aria-hidden="true" />{category.name}
                </button>
              );
            })}
          </div>
          {show("category") && <p role="alert" className="mt-1 text-xs text-red-300">{show("category")}</p>}
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">What do you know?</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={mode === "emi"} className={`min-h-11 rounded-lg border px-2 text-sm ${mode === "emi" ? "border-accent bg-accent/10 font-medium text-accent" : "border-line bg-ink text-mute"}`} onClick={() => setMode("emi")}>The monthly EMI</button>
            <button type="button" aria-pressed={mode === "price"} className={`min-h-11 rounded-lg border px-2 text-sm ${mode === "price" ? "border-accent bg-accent/10 font-medium text-accent" : "border-line bg-ink text-mute"}`} onClick={() => setMode("price")}>The price and interest</button>
          </div>
        </fieldset>

        {mode === "emi" ? (
          <Field label="Monthly EMI (₹)" error={show("emiAmount")}>
            <input className="input" type="text" inputMode="decimal" placeholder="e.g. 1000" value={emiAmount} autoComplete="off" aria-invalid={!!show("emiAmount")} onChange={(e) => setEmiAmount(e.target.value)} />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Product price (₹)" error={show("price")}>
              <input className="input" type="text" inputMode="decimal" placeholder="e.g. 3000" value={price} autoComplete="off" aria-invalid={!!show("price")} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Interest (% a year)" error={show("annualRate")} hint="0 for a no-cost EMI">
              <input className="input" type="text" inputMode="decimal" value={rate} autoComplete="off" aria-invalid={!!show("annualRate")} onChange={(e) => setRate(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Number of months" error={show("months")}>
          <div className="flex flex-wrap items-center gap-2">
            {[3, 6, 12, 24].map((value) => (
              <button key={value} type="button" aria-pressed={months === String(value)}
                className={`min-h-11 min-w-12 rounded-full border px-3 text-sm ${months === String(value) ? "border-accent bg-accent/10 font-medium text-text" : "border-line bg-ink text-mute"}`} onClick={() => setMonths(String(value))}>{value}</button>
            ))}
            <input className="input !w-24" type="number" min="1" max={MAX_MONTHS} inputMode="numeric" aria-label="Number of months" value={months} aria-invalid={!!show("months")} onChange={(e) => setMonths(e.target.value)} />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Down payment (₹)" error={show("downPayment")} hint="Optional">
            <input className="input" type="text" inputMode="decimal" placeholder="0" value={down} autoComplete="off" aria-invalid={!!show("downPayment")} onChange={(e) => setDown(e.target.value)} />
          </Field>
          <Field label="Fees (₹)" error={show("fee")} hint="Processing, GST. Optional">
            <input className="input" type="text" inputMode="decimal" placeholder="0" value={fee} autoComplete="off" aria-invalid={!!show("fee")} onChange={(e) => setFee(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase date" error={show("purchaseDate")} hint="Down payment and fees fall on this day">
            <input className="input" type="date" value={purchaseDate} aria-invalid={!!show("purchaseDate")} onChange={(e) => onPurchase(e.target.value)} />
          </Field>
          <Field label="First EMI due" error={show("firstDue")} hint="Later ones fall on the same day each month">
            <input className="input" type="date" value={firstDue} aria-invalid={!!show("firstDue")} onChange={(e) => { setFirstDue(e.target.value); setFirstDueTouched(true); }} />
          </Field>
        </div>

        {schedule && (
          <section className="space-y-3 rounded-xl border border-line bg-ink p-3" aria-label="Payment schedule">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium">Payment schedule</h3>
              {hasEdits && <button type="button" className="min-h-9 text-xs font-medium text-accent" onClick={() => setEdits({ key: "", values: {} })}>Reset amounts</button>}
            </div>
            <ul className="divide-y divide-line text-sm">
              {schedule.upfront > 0 && (
                <li className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="block">Down payment{amountOf(fee) > 0 ? " and fees" : ""}</span><span className="block text-xs text-mute">{prettyDate(purchaseDate)}{purchaseDate <= today ? " · added now" : ""}</span></span>
                  <span className="shrink-0 font-medium">{money(schedule.upfront)}</span>
                </li>
              )}
              {schedule.installments.map((item, index) => (
                <li key={item.n} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0"><span className="block">EMI {item.n} of {schedule.installments.length}</span><span className="block text-xs text-mute">{prettyDate(item.due)}{item.due <= today ? " · added now" : ""}</span></span>
                  <input className="input !min-h-10 !w-28 shrink-0 text-right" type="text" inputMode="decimal" aria-label={`Amount for EMI ${item.n}`}
                    value={edits.key === baseKey && edits.values[index] !== undefined ? edits.values[index] : String(item.amount)} onChange={(e) => setEdit(index, e.target.value)} />
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-line pt-2 text-sm">
              {mode === "price" && <div className="flex justify-between gap-3"><dt className="text-mute">Monthly EMI</dt><dd>{money(schedule.emi)}</dd></div>}
              {schedule.interest !== null && schedule.interest > 0.004 && <div className="flex justify-between gap-3"><dt className="text-mute">Interest</dt><dd>{money(schedule.interest)}</dd></div>}
              <div className="flex justify-between gap-3 font-semibold"><dt>Total you will pay</dt><dd className="text-accent">{money(schedule.totalPayable)}</dd></div>
            </dl>
            {hasEdits && <p className="text-xs text-mute">You edited some amounts. Changing the EMI, months or price resets them.</p>}
            {dueNow.length > 0 && <p className="text-xs text-amber-200">{dueNow.length} payment{dueNow.length === 1 ? " is" : "s are"} already due and will be added to your transactions when you create this.</p>}
          </section>
        )}
        {submitted && errors.overrides && <p role="alert" className="text-xs text-red-300">{errors.overrides}</p>}
      </form>
    </Modal>
  );
}
