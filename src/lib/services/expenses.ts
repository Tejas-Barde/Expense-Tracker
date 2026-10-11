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
  tablesDB.createRow({
    databaseId: DB,
    tableId: TABLE.expenses,
    rowId: ID.unique(),
    data: { userId: uid, ...e },
    permissions: ownerPerms(uid),
  });
export const deleteExpense = (id: string) =>
  tablesDB.deleteRow({ databaseId: DB, tableId: TABLE.expenses, rowId: id });
