import { tablesDB, DB, TABLE, ID, Query, ownerPerms } from "../appwrite/client";
import type { Models } from "appwrite";
import type { Expense } from "../../types";
export async function listExpenses(uid: string): Promise<Expense[]> {
  const res = await tablesDB.listRows<Models.Row & Expense>({
    databaseId: DB,
    tableId: TABLE.expenses,
    queries: [Query.equal("userId", uid), Query.orderDesc("timestamp"), Query.limit(500)],
  });
  return res.rows;
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
export const deleteExpense = (id: string) =>
  tablesDB.deleteRow({ databaseId: DB, tableId: TABLE.expenses, rowId: id });

function validateExpense<T>(e: { amount: number; categoryId: string; note: string; timestamp: string }, action: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(e.amount) || e.amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (!e.categoryId) throw new Error("Choose a category.");
  if (!Number.isFinite(new Date(e.timestamp).getTime())) throw new Error("Enter a valid transaction date.");
  return action();
}
