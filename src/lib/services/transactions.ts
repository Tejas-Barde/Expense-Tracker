import type { Expense, FinanceData, Trip } from "../../types";
import { deleteExpense, restoreExpense, updateExpense } from "./expenses";
import { friendNameKey, getFinance, removeExpenseFinanceData, restoreFinanceData } from "./finance";
import { listTrips, removeExpensesFromTrips, restoreTrips } from "./trips";

/** Everything outside the expense rows that a transaction can touch. */
export interface AppState { finance: FinanceData; trips: Trip[] }
export interface UndoToken { before: AppState; after: AppState; expenses: Expense[] }

export async function captureState(): Promise<AppState> {
  const [finance, trips] = await Promise.all([getFinance(), listTrips("")]);
  return { finance, trips };
}

const sameState = (a: AppState, b: AppState) => JSON.stringify(a) === JSON.stringify(b);

const SETTLEMENT_PAID = /^Settlement paid to (.+)$/i;
const SETTLEMENT_RECEIVED = /^Settlement received from (.+)$/i;

/**
 * Returns a message when an expense has money already settled against it. Deleting such an expense would
 * leave the settlement entry pointing at nothing, so the settlement has to be removed first.
 */
export function settlementBlock(expense: Expense, finance: FinanceData, batch: Expense[] = []): string | null {
  const settledWith = (friend: string, direction: "paid" | "received") => batch.some((other) => {
    const match = (direction === "paid" ? SETTLEMENT_PAID : SETTLEMENT_RECEIVED).exec(other.note);
    return !!match && friendNameKey(match[1]) === friendNameKey(friend);
  });
  const label = expense.note || "This transaction";
  const debt = (finance.friendPaidExpenses ?? []).find((item) => item.expenseId === expense.$id);
  if (debt && (debt.repaid ?? 0) > 0 && !settledWith(debt.friend, "paid")) {
    return `"${label}" already has payments settled to ${debt.friend}. Delete those settlement transactions first.`;
  }
  const loan = finance.loans.find((item) => item.expenseId === expense.$id && item.repaid > 0 && !settledWith(item.friend, "received"));
  if (loan) return `"${label}" already has money received back from ${loan.friend}. Delete those settlement transactions first.`;
  const borrowing = (finance.borrowings ?? []).find((item) => item.expenseId === expense.$id && item.repaid > 0 && !settledWith(item.lender, "paid"));
  if (borrowing) return `"${label}" already has repayments made to ${borrowing.lender}. Delete those settlement transactions first.`;
  return null;
}

export interface DeleteResult { deleted: string[]; failed: string[]; undo: UndoToken | null }

/** Deletes expenses and every record derived from them (debts, loans, borrowings, settlements, trip links). */
export async function deleteTransactions(ids: string[], expenses: Expense[]): Promise<DeleteResult> {
  const targets = ids.flatMap((id) => expenses.filter((expense) => expense.$id === id));
  const before = await captureState();
  for (const expense of targets) {
    const block = settlementBlock(expense, before.finance, targets);
    if (block) throw new Error(block);
  }
  const results = await Promise.allSettled(ids.map((id) => deleteExpense(id)));
  const deleted = ids.filter((_, index) => results[index].status === "fulfilled");
  const failed = ids.filter((_, index) => results[index].status === "rejected");
  if (!deleted.length) return { deleted, failed, undo: null };
  const removed = targets.filter((expense) => deleted.includes(expense.$id));
  await removeExpenseFinanceData(deleted, removed.map((expense) => ({ id: expense.$id, amount: expense.amount, note: expense.note })));
  await removeExpensesFromTrips(deleted);
  const after = await captureState();
  return { deleted, failed, undo: { before, after, expenses: removed } };
}

async function assertUnchanged(expected: AppState) {
  if (!sameState(await captureState(), expected)) {
    throw new Error("This can no longer be undone because your balances or trips changed in the meantime.");
  }
}

export async function undoDelete(uid: string, token: UndoToken) {
  await assertUnchanged(token.after);
  const results = await Promise.allSettled(token.expenses.map((expense) => restoreExpense(uid, expense)));
  if (results.some((result) => result.status === "rejected")) {
    await Promise.allSettled(token.expenses.map((expense) => deleteExpense(expense.$id)));
    throw new Error("Could not restore the transactions. Nothing was changed.");
  }
  await restoreFinanceData(token.before.finance);
  await restoreTrips(token.before.trips);
}

/** Undo for a newly added transaction: removes it and everything it created. */
export async function undoCreate(expenseId: string) {
  await deleteExpense(expenseId);
  await removeExpenseFinanceData([expenseId]);
  await removeExpensesFromTrips([expenseId]);
}

/** Undo for an edit: puts the expense row, finance records and trip links back as they were. */
export async function undoEdit(original: Expense, token: UndoToken) {
  await assertUnchanged(token.after);
  await updateExpense(original.$id, {
    amount: original.amount, categoryId: original.categoryId, note: original.note, timestamp: original.timestamp,
  });
  await restoreFinanceData(token.before.finance);
  await restoreTrips(token.before.trips);
}
