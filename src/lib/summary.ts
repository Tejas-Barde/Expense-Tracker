import type { Expense, FinanceData, Trip } from "../types";
import { accountCashFlow, categorySpend } from "./services/finance";
import { monthKey, round2 } from "./utils";

/**
 * What changed in "who owes whom" during a month. This is what separates the two spending numbers:
 *   effective spending = money that left your account - net change in what others owe you
 * (a loan or a share you paid for others is cash out that is not your spending; a bill someone else paid
 * for you is your spending that never left your account).
 */
export interface Reconciliation {
  /** New money others owe you: loans, and the shares of costs you paid for others. */
  receivableAdded: number;
  /** Money paid back to you. */
  receivableCollected: number;
  /** New money you owe: costs others paid for you, and money you borrowed. */
  payableAdded: number;
  /** Money you paid back. */
  payableSettled: number;
  /** (receivableAdded - receivableCollected) - (payableAdded - payableSettled). Positive: more is owed to you than before. */
  netChange: number;
}

export function reconcileMonth(finance: FinanceData, mk: string): Reconciliation {
  const inMonth = (iso: string) => monthKey(new Date(iso)) === mk;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const paymentsIn = (payments?: { amount: number; timestamp: string }[]) => sum((payments ?? []).filter((payment) => inMonth(payment.timestamp)).map((payment) => payment.amount));
  const debts = finance.friendPaidExpenses ?? [];
  const borrowings = finance.borrowings ?? [];
  // Opening balances existed before the app was used, so they are not new money in or out of any month.
  const receivableAdded = sum(finance.loans.filter((loan) => !loan.opening && inMonth(loan.timestamp)).map((loan) => loan.amount));
  const receivableCollected = sum(finance.loans.map((loan) => paymentsIn(loan.repayments)));
  const payableAdded = sum(debts.filter((debt) => inMonth(debt.timestamp)).map((debt) => debt.amount))
    + sum(borrowings.filter((item) => !item.opening && inMonth(item.timestamp)).map((item) => item.amount));
  const payableSettled = sum(debts.map((debt) => paymentsIn(debt.repayments))) + sum(borrowings.map((item) => paymentsIn(item.repayments)));
  const netChange = round2(receivableAdded - receivableCollected - payableAdded + payableSettled);
  return { receivableAdded: round2(receivableAdded), receivableCollected: round2(receivableCollected), payableAdded: round2(payableAdded), payableSettled: round2(payableSettled), netChange };
}

export interface MonthSummary {
  /** Real money movement for the month: cash out from expenses + standalone loans (received settlements reduce it). */
  cashSpent: number;
  /** Own-share spending per category id (trip expenses excluded). */
  byCategory: Record<string, number>;
  /** Own-share spending on expenses that belong to a trip. */
  tripSpent: number;
  /** Sum of byCategory and tripSpent. */
  categorizedSpent: number;
  expensesInMonth: Expense[];
  reconciliation: Reconciliation;
  /** Repayments this month that have no settlement transaction, already included in cashSpent. */
  unrecorded: { paid: number; received: number };
  /** categorizedSpent - (cashSpent - netChange). Zero when the numbers reconcile; non-zero points at inconsistent older data. */
  mismatch: number;
}

export function expensesInMonth(expenses: Expense[], mk: string) {
  // Always the user's local month: the UTC date in an ISO string can fall in the neighbouring month.
  return expenses.filter((expense) => monthKey(new Date(expense.timestamp)) === mk);
}

/**
 * Repayments that were marked on a debt or loan without a "Settlement" transaction (the app used to allow this).
 * The money really moved, but no transaction recorded it, so it is counted here instead.
 * A repayment made through a settlement carries that settlement's timestamp and is already counted by its transaction.
 */
export function unrecordedRepayments(finance: FinanceData, inPeriod: (iso: string) => boolean) {
  const recorded = new Set((finance.settlements ?? []).map((settlement) => settlement.timestamp));
  const total = (payments?: { amount: number; timestamp: string }[]) =>
    (payments ?? []).filter((payment) => !recorded.has(payment.timestamp) && inPeriod(payment.timestamp)).reduce((sum, payment) => sum + payment.amount, 0);
  const paid = (finance.friendPaidExpenses ?? []).reduce((sum, debt) => sum + total(debt.repayments), 0)
    + (finance.borrowings ?? []).reduce((sum, item) => sum + total(item.repayments), 0);
  const received = finance.loans.reduce((sum, loan) => sum + total(loan.repayments), 0);
  return { paid: round2(paid), received: round2(received) };
}

/**
 * Cash that moves without an expense row: a standalone loan leaves your account, a standalone borrowing
 * arrives in it, and so do repayments with no settlement transaction. (Loans and borrowings attached to an
 * expense are already covered by that expense.)
 */
export function standaloneCashFlow(finance: FinanceData, inPeriod: (iso: string) => boolean) {
  const lent = finance.loans.filter((loan) => !loan.expenseId && !loan.opening && inPeriod(loan.timestamp)).reduce((sum, loan) => sum + loan.amount, 0);
  const borrowed = (finance.borrowings ?? []).filter((item) => !item.expenseId && !item.opening && inPeriod(item.timestamp)).reduce((sum, item) => sum + item.amount, 0);
  const repayments = unrecordedRepayments(finance, inPeriod);
  return lent - borrowed + repayments.paid - repayments.received;
}

export function summarizeMonth(expenses: Expense[], finance: FinanceData, trips: Trip[], mk: string): MonthSummary {
  const month = expensesInMonth(expenses, mk);
  const tripExpenseIds = new Set(trips.flatMap((trip) => trip.expenseIds));
  const standalone = standaloneCashFlow(finance, (iso) => monthKey(new Date(iso)) === mk);
  const cashSpent = month.reduce((sum, expense) => sum + accountCashFlow(expense, finance), 0) + standalone;
  const byCategory: Record<string, number> = {};
  let tripSpent = 0;
  for (const expense of month) {
    const share = categorySpend(expense, finance);
    if (tripExpenseIds.has(expense.$id)) tripSpent += share;
    else byCategory[expense.categoryId] = (byCategory[expense.categoryId] ?? 0) + share;
  }
  const categorizedSpent = Object.values(byCategory).reduce((sum, value) => sum + value, 0) + tripSpent;
  const reconciliation = reconcileMonth(finance, mk);
  const mismatch = round2(categorizedSpent - (cashSpent - reconciliation.netChange));
  return { cashSpent: round2(cashSpent), byCategory, tripSpent, categorizedSpent: round2(categorizedSpent), expensesInMonth: month, reconciliation, mismatch, unrecorded: unrecordedRepayments(finance, (iso) => monthKey(new Date(iso)) === mk) };
}

/** Category split of a single trip, using only the user's own share of each expense. */
export function summarizeTrip(expenses: Expense[], finance: FinanceData, trip: Trip) {
  const ids = new Set(trip.expenseIds);
  const tripExpenses = expenses.filter((expense) => ids.has(expense.$id));
  const byCategory: Record<string, number> = {};
  for (const expense of tripExpenses) {
    byCategory[expense.categoryId] = (byCategory[expense.categoryId] ?? 0) + categorySpend(expense, finance);
  }
  return { byCategory, total: Object.values(byCategory).reduce((sum, value) => sum + value, 0), count: tripExpenses.length };
}
