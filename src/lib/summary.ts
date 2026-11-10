import type { Expense, FinanceData, Trip } from "../types";
import { accountCashFlow, categorySpend } from "./services/finance";
import { monthKey } from "./utils";

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
}

export function expensesInMonth(expenses: Expense[], mk: string) {
  return expenses.filter((expense) => expense.timestamp.startsWith(mk) || monthKey(new Date(expense.timestamp)) === mk);
}

export function summarizeMonth(expenses: Expense[], finance: FinanceData, trips: Trip[], mk: string): MonthSummary {
  const month = expensesInMonth(expenses, mk);
  const tripExpenseIds = new Set(trips.flatMap((trip) => trip.expenseIds));
  const lentStandalone = finance.loans
    .filter((loan) => !loan.expenseId && monthKey(new Date(loan.timestamp)) === mk)
    .reduce((sum, loan) => sum + loan.amount, 0);
  const cashSpent = month.reduce((sum, expense) => sum + accountCashFlow(expense, finance), 0) + lentStandalone;
  const byCategory: Record<string, number> = {};
  let tripSpent = 0;
  for (const expense of month) {
    const share = categorySpend(expense, finance);
    if (tripExpenseIds.has(expense.$id)) tripSpent += share;
    else byCategory[expense.categoryId] = (byCategory[expense.categoryId] ?? 0) + share;
  }
  const categorizedSpent = Object.values(byCategory).reduce((sum, value) => sum + value, 0) + tripSpent;
  return { cashSpent, byCategory, tripSpent, categorizedSpent, expensesInMonth: month };
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
