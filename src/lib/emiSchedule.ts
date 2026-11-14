// Pure EMI maths: no network, no React. All money is handled in whole paise so splits always add up exactly.

export interface EmiInput {
  /** "emi": you know the monthly amount. "price": work the EMI out from the product price and interest rate. */
  mode: "emi" | "price";
  price: number;
  emiAmount: number;
  months: number;
  /** Interest per year in percent. 0 means a no-cost EMI. Only used when mode is "price". */
  annualRate: number;
  downPayment: number;
  /** One-time charges (processing fee, GST on it) paid with the down payment. */
  fee: number;
  /** yyyy-mm-dd: when the down payment and fee are paid. */
  purchaseDate: string;
  /** yyyy-mm-dd: due date of the first EMI. Later EMIs fall on the same day of each month. */
  firstDue: string;
  /** Hand-edited amounts, by installment index (0-based). */
  overrides?: Record<number, number>;
}

export interface Installment { n: number; due: string; amount: number }
export interface EmiSchedule {
  upfront: number;
  installments: Installment[];
  installmentsTotal: number;
  totalPayable: number;
  /** Extra paid on top of the financed amount. null when the product price is not known. */
  interest: number | null;
  /** The regular monthly amount (before any hand edits). */
  emi: number;
}

export const MAX_MONTHS = 60;
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const rupees = (paise: number) => paise / 100;

// ---- Dates (plain yyyy-mm-dd arithmetic, so time zones can never shift a due date) -------------------
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function parseDate(text: string): { y: number; m: number; d: number } | null {
  const match = DATE.exec(text);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");
export const formatDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The same day of the month, `k` months later. A 31st lands on the last day of shorter months, then returns to the 31st. */
export function addMonthsClamped(start: string, k: number): string {
  const date = parseDate(start);
  if (!date) throw new Error(`Invalid date: ${start}`);
  const index = date.y * 12 + (date.m - 1) + k;
  const y = Math.floor(index / 12), m = (index % 12) + 1;
  return formatDate(y, m, Math.min(date.d, daysInMonth(y, m)));
}

export function validateEmiInput(input: EmiInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const finite = (n: number) => Number.isFinite(n);
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > MAX_MONTHS) errors.months = `Enter between 1 and ${MAX_MONTHS} months.`;
  if (!finite(input.downPayment) || input.downPayment < 0) errors.downPayment = "Enter zero or more.";
  if (!finite(input.fee) || input.fee < 0) errors.fee = "Enter zero or more.";
  if (input.mode === "emi") {
    if (!finite(input.emiAmount) || cents(input.emiAmount) <= 0) errors.emiAmount = "Enter the monthly EMI amount.";
  } else {
    if (!finite(input.price) || cents(input.price) <= 0) errors.price = "Enter the product price.";
    else if (finite(input.downPayment) && cents(input.downPayment) >= cents(input.price)) errors.downPayment = "The down payment must be less than the price. For a full payment, add a normal transaction instead.";
    if (!finite(input.annualRate) || input.annualRate < 0 || input.annualRate > 100) errors.annualRate = "Enter a rate from 0 to 100. Use 0 for a no-cost EMI.";
  }
  const purchase = parseDate(input.purchaseDate), first = parseDate(input.firstDue);
  if (!purchase) errors.purchaseDate = "Choose the purchase date.";
  if (!first) errors.firstDue = "Choose when the first EMI is due.";
  else if (purchase && input.firstDue < input.purchaseDate) errors.firstDue = "The first EMI can't be before the purchase date.";
  for (const [index, amount] of Object.entries(input.overrides ?? {})) {
    if (!finite(amount) || cents(amount) <= 0) { errors.overrides = `Month ${Number(index) + 1}: enter an amount greater than zero.`; break; }
  }
  return errors;
}

/** Builds the full schedule. Call validateEmiInput first: this assumes valid input. */
export function buildEmiSchedule(input: EmiInput): EmiSchedule {
  const n = input.months;
  const upfrontPaise = cents(input.downPayment) + cents(input.fee);
  let regular: number[];
  let emiPaise: number;
  let principalPaise: number | null = null;

  if (input.mode === "emi") {
    emiPaise = cents(input.emiAmount);
    regular = Array(n).fill(emiPaise);
  } else {
    principalPaise = cents(input.price) - cents(input.downPayment);
    const monthlyRate = input.annualRate / 1200;
    if (monthlyRate === 0) {
      // No-cost EMI: split evenly. Any leftover paise goes on the last installment, so the total is exact.
      const base = Math.floor(principalPaise / n);
      emiPaise = base;
      regular = Array(n).fill(base);
      regular[n - 1] = principalPaise - base * (n - 1);
    } else {
      const growth = Math.pow(1 + monthlyRate, n);
      const exact = (principalPaise * monthlyRate * growth) / (growth - 1);
      emiPaise = Math.round(exact);
      regular = Array(n).fill(emiPaise);
    }
  }

  const amounts = regular.map((paise, index) => {
    const override = input.overrides?.[index];
    return override !== undefined && Number.isFinite(override) ? cents(override) : paise;
  });
  const installmentsTotal = amounts.reduce((sum, paise) => sum + paise, 0);
  return {
    upfront: rupees(upfrontPaise),
    installments: amounts.map((paise, index) => ({ n: index + 1, due: addMonthsClamped(input.firstDue, index), amount: rupees(paise) })),
    installmentsTotal: rupees(installmentsTotal),
    totalPayable: rupees(upfrontPaise + installmentsTotal),
    interest: principalPaise === null ? null : rupees(installmentsTotal - principalPaise),
    emi: rupees(emiPaise),
  };
}
