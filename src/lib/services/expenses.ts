import { tablesDB, DB, TABLE, ID, Query, ownerPerms } from "../appwrite/client";
import type { Models } from "appwrite";
import type { Expense } from "../../types";
const PAGE_SIZE = 500;
/** Loads every expense, newest first, paging through the table so nothing is silently cut off. */
export async function listExpenses(uid: string): Promise<Expense[]> {
  const all: Expense[] = [];
  for (;;) {
    const queries = [Query.equal("userId", uid), Query.orderDesc("timestamp"), Query.limit(PAGE_SIZE)];
    if (all.length) queries.push(Query.cursorAfter(all[all.length - 1].$id));
    const res = await tablesDB.listRows<Models.Row & Expense>({ databaseId: DB, tableId: TABLE.expenses, queries });
    all.push(...res.rows);
    if (res.rows.length < PAGE_SIZE) return all;
  }
}
export const addExpense = (uid: string, e: { amount: number; categoryId: string; note: string; timestamp: string }) =>
  validateExpense(e, () => tablesDB.createRow({
    databaseId: DB,
    tableId: TABLE.expenses,
    rowId: ID.unique(),
    data: { userId: uid, ...e },
    permissions: ownerPerms(uid),
  }));
export const updateExpense = (id: string, e: { amount: number; categoryId: string; note: string; timestamp: string }) =>
  validateExpense(e, () => tablesDB.updateRow({
    databaseId: DB,
    tableId: TABLE.expenses,
    rowId: id,
    data: e,
  }));
/** Re-creates a previously deleted expense under its original id so links from finance data and trips stay valid. */
export const restoreExpense = (uid: string, e: Expense) =>
  tablesDB.createRow({
    databaseId: DB,
    tableId: TABLE.expenses,
    rowId: e.$id,
    data: { userId: uid, amount: e.amount, categoryId: e.categoryId, note: e.note, timestamp: e.timestamp },
    permissions: ownerPerms(uid),
  });
export const setExpenseCategory = (id: string, categoryId: string) =>
  tablesDB.updateRow({ databaseId: DB, tableId: TABLE.expenses, rowId: id, data: { categoryId } });
export const deleteExpense = (id: string) =>
  tablesDB.deleteRow({ databaseId: DB, tableId: TABLE.expenses, rowId: id });

function validateExpense<T>(e: { amount: number; categoryId: string; note: string; timestamp: string }, action: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(e.amount) || e.amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (!e.categoryId) throw new Error("Choose a category.");
  if (!Number.isFinite(new Date(e.timestamp).getTime())) throw new Error("Enter a valid transaction date.");
  return action();
}
