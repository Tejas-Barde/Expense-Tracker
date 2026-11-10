import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- In-memory stand-in for Appwrite (prefs + expenses table) ------------------------------------------
const store = vi.hoisted(() => ({ prefs: {} as Record<string, string>, rows: new Map<string, any>(), seq: 0, failDeleteFor: new Set<string>() }));
vi.mock("./appwrite/client", () => ({
  ID: { unique: () => `id${++store.seq}` },
  Query: { equal: () => null, orderDesc: () => null, limit: () => null },
  DB: "db", TABLE: { expenses: "expenses" }, ownerPerms: () => [],
  account: {
    getPrefs: async () => ({ ...store.prefs }),
    updatePrefs: async (prefs: Record<string, string>) => { store.prefs = { ...prefs }; },
  },
  tablesDB: {
    createRow: async ({ rowId, data }: any) => {
      if (store.rows.has(rowId)) throw new Error("exists");
      const row = { $id: rowId, ...data }; store.rows.set(rowId, row); return row;
    },
    updateRow: async ({ rowId, data }: any) => { const row = { ...store.rows.get(rowId), ...data }; store.rows.set(rowId, row); return row; },
    deleteRow: async ({ rowId }: any) => {
      if (store.failDeleteFor.has(rowId)) throw new Error("network");
      if (!store.rows.delete(rowId)) throw new Error("missing");
    },
    listRows: async () => ({ rows: [...store.rows.values()] }),
  },
}));

import { addExpense, listExpenses } from "./services/expenses";
import { addExpenseToTrip, createTrip, listTrips } from "./services/trips";
import { addBorrowing, addLoan, getFinance, recordFriendSettlement, replaceExpenseFinanceData, saveSalary } from "./services/finance";
import { captureState, deleteTransactions, undoCreate, undoDelete, undoEdit } from "./services/transactions";
import { summarizeMonth, summarizeTrip } from "./summary";
import type { Expense } from "../types";

const UID = "u1";
const FOOD = "cat-food", RENT = "cat-rent", SETTLE = "cat-settle";
const NOW = new Date();
const MK = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;
const stamp = () => new Date().toISOString();

type Mode =
  | { kind: "self" }
  | { kind: "friend_paid"; friend: string }                      // amount entered is the user's own share
  | { kind: "paid_for_friend"; shares: Record<string, number> }  // friend -> their share
  | { kind: "borrowed"; lender: string };

/** Mirrors what ExpenseForm does when saving a new transaction. */
async function addTx(amount: number, categoryId: string, mode: Mode, tripId?: string, note = "tx") {
  const timestamp = stamp();
  const created = await addExpense(UID, { amount, categoryId, note, timestamp });
  const expenseId = created.$id;
  await replaceExpenseFinanceData(
    expenseId,
    mode.kind === "friend_paid" ? { expenseId, friend: mode.friend, amount, originalAmount: amount, personalShare: amount, timestamp } : null,
    mode.kind === "paid_for_friend"
      ? Object.entries(mode.shares).map(([friend, share]) => ({ friend, amount: share, note, timestamp, expenseId }))
      : [],
    mode.kind === "borrowed" ? { lender: mode.lender, amount, note, timestamp } : null,
  );
  if (tripId) await addExpenseToTrip(tripId, expenseId);
  return expenseId;
}

async function snapshot() {
  const [expenses, finance, trips] = await Promise.all([listExpenses(UID), getFinance(), listTrips(UID)]);
  const month = summarizeMonth(expenses, finance, trips, MK);
  return { expenses, finance, trips, month };
}
const del = async (...ids: string[]) => deleteTransactions(ids, await listExpenses(UID));

beforeEach(() => { store.prefs = {}; store.rows.clear(); store.seq = 0; store.failDeleteFor.clear(); });

describe("dashboard rules", () => {
  it("self-paid: bank balance and category both move by the full amount", async () => {
    await addTx(500, FOOD, { kind: "self" });
    const { month } = await snapshot();
    expect(month.cashSpent).toBe(500);
    expect(month.byCategory[FOOD]).toBe(500);
  });

  it("friend paid my 2k meal: Food shows 2k, bank untouched, 2k owed", async () => {
    await addTx(2000, FOOD, { kind: "friend_paid", friend: "ravi" });
    const { month, finance } = await snapshot();
    expect(month.cashSpent).toBe(0);
    expect(month.byCategory[FOOD]).toBe(2000);
    expect(finance.friendPaidExpenses).toHaveLength(1);
    expect(finance.friendPaidExpenses![0]).toMatchObject({ friend: "Ravi", amount: 2000, personalShare: 2000 });
  });

  it("I paid 2k for a friend (1k theirs): bank -2k, Food 1k, 1k receivable", async () => {
    await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000 } });
    const { month, finance } = await snapshot();
    expect(month.cashSpent).toBe(2000);
    expect(month.byCategory[FOOD]).toBe(1000);
    expect(finance.loans.reduce((s, l) => s + l.amount - l.repaid, 0)).toBe(1000);
  });

  it("trip 5k (2k food + 3k rent): dashboard Trip 5k, no category double counting, trip page splits by category", async () => {
    const trip = await createTrip(UID, "Goa");
    await addTx(2000, FOOD, { kind: "self" }, trip.id);
    await addTx(3000, RENT, { kind: "self" }, trip.id);
    const { month, expenses, finance, trips } = await snapshot();
    expect(month.tripSpent).toBe(5000);
    expect(month.byCategory[FOOD] ?? 0).toBe(0);
    expect(month.byCategory[RENT] ?? 0).toBe(0);
    expect(month.cashSpent).toBe(5000);
    const goa = summarizeTrip(expenses, finance, trips[0]);
    expect(goa.byCategory).toEqual({ [FOOD]: 2000, [RENT]: 3000 });
  });

  it("borrowed-money expense: category counts it, bank does not until repaid", async () => {
    await addTx(900, FOOD, { kind: "borrowed", lender: "Meera" });
    const { month, finance } = await snapshot();
    expect(month.cashSpent).toBe(0);
    expect(month.byCategory[FOOD]).toBe(900);
    expect(finance.borrowings).toHaveLength(1);
  });
});

describe("deleting a transaction keeps everything consistent", () => {
  it("self-paid", async () => {
    const empty = await snapshot();
    const id = await addTx(500, FOOD, { kind: "self" });
    await del(id);
    const after = await snapshot();
    expect(after.expenses).toHaveLength(0);
    expect(after.month).toEqual(empty.month);
  });

  it("friend-paid: the debt disappears with the expense", async () => {
    const id = await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    await del(id);
    const { finance, month } = await snapshot();
    expect(finance.friendPaidExpenses).toHaveLength(0);
    expect(month.byCategory[FOOD] ?? 0).toBe(0);
    expect(month.cashSpent).toBe(0);
  });

  it("paid-for-friend: the receivable disappears with the expense", async () => {
    const id = await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000, Neel: 500 } });
    await del(id);
    const { finance, month } = await snapshot();
    expect(finance.loans).toHaveLength(0);
    expect(month.cashSpent).toBe(0);
  });

  it("borrowed: the borrowing record disappears with the expense", async () => {
    const id = await addTx(900, FOOD, { kind: "borrowed", lender: "Meera" });
    await del(id);
    expect((await snapshot()).finance.borrowings).toHaveLength(0);
  });

  it("trip expense: removed from the trip and from trip totals", async () => {
    const trip = await createTrip(UID, "Goa");
    const a = await addTx(2000, FOOD, { kind: "self" }, trip.id);
    await addTx(3000, RENT, { kind: "self" }, trip.id);
    await del(a);
    const { trips, month, expenses, finance } = await snapshot();
    expect(trips[0].expenseIds).not.toContain(a);
    expect(month.tripSpent).toBe(3000);
    expect(summarizeTrip(expenses, finance, trips[0]).total).toBe(3000);
  });

  it("settling a friend-paid debt, then deleting the settlement, restores the debt and the bank balance", async () => {
    await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const settlement = await addExpense(UID, { amount: 2000, categoryId: SETTLE, note: "Settlement paid to Ravi", timestamp: stamp() });
    await recordFriendSettlement("Ravi", "to_friend", 2000, settlement.$id);
    let s = await snapshot();
    expect(s.finance.friendPaidExpenses![0].repaid).toBe(2000);
    expect(s.month.cashSpent).toBe(2000);            // money actually left the bank
    expect(s.month.byCategory[SETTLE] ?? 0).toBe(0); // settlements never count as category spending
    await del(settlement.$id);
    s = await snapshot();
    expect(s.finance.friendPaidExpenses![0].repaid).toBe(0);
    expect(s.month.cashSpent).toBe(0);
    expect(s.month.byCategory[FOOD]).toBe(2000);
  });

  it("money received from a friend raises the bank balance; deleting that settlement restores the receivable", async () => {
    await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000 } });
    const settlement = await addExpense(UID, { amount: 1000, categoryId: SETTLE, note: "Settlement received from Asha", timestamp: stamp() });
    await recordFriendSettlement("Asha", "from_friend", 1000, settlement.$id);
    let s = await snapshot();
    expect(s.month.cashSpent).toBe(1000);            // 2000 out, 1000 back
    expect(s.finance.loans[0].repaid).toBe(1000);
    await del(settlement.$id);
    s = await snapshot();
    expect(s.month.cashSpent).toBe(2000);
    expect(s.finance.loans[0].repaid).toBe(0);
  });

  it("refuses to delete an expense that already has settlements applied", async () => {
    const id = await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const settlement = await addExpense(UID, { amount: 500, categoryId: SETTLE, note: "Settlement paid to Ravi", timestamp: stamp() });
    await recordFriendSettlement("Ravi", "to_friend", 500, settlement.$id);
    const before = await snapshot();
    await expect(del(id)).rejects.toThrow(/settle/i);
    expect(await snapshot()).toEqual(before);        // nothing was half-deleted
  });

  it("allows deleting the expense together with its settlement in one go", async () => {
    const id = await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const settlement = await addExpense(UID, { amount: 500, categoryId: SETTLE, note: "Settlement paid to Ravi", timestamp: stamp() });
    await recordFriendSettlement("Ravi", "to_friend", 500, settlement.$id);
    const result = await del(id, settlement.$id);
    expect(result.deleted).toHaveLength(2);
    const s = await snapshot();
    expect(s.expenses).toHaveLength(0);
    expect(s.finance.friendPaidExpenses).toHaveLength(0);
    expect(s.finance.settlements).toHaveLength(0);
  });

  it("a failed row deletion leaves that transaction's records intact", async () => {
    const keep = await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const gone = await addTx(300, FOOD, { kind: "self" });
    store.failDeleteFor.add(keep);
    const result = await del(keep, gone);
    expect(result.failed).toEqual([keep]);
    const s = await snapshot();
    expect(s.expenses.map((e) => e.$id)).toEqual([keep]);
    expect(s.finance.friendPaidExpenses).toHaveLength(1);
  });

  it("standalone loans and borrowings are unaffected by deleting an unrelated expense", async () => {
    await addLoan({ friend: "Asha", amount: 700, note: "cash", timestamp: stamp() });
    await addBorrowing({ lender: "Meera", amount: 400, note: "", timestamp: stamp() });
    const id = await addTx(100, FOOD, { kind: "self" });
    await del(id);
    const { finance, month } = await snapshot();
    expect(finance.loans).toHaveLength(1);
    expect(finance.borrowings).toHaveLength(1);
    expect(month.cashSpent).toBe(700);
  });
});

describe("undo", () => {
  it("undoing a delete restores the expense, debts, receivables and trip link exactly", async () => {
    const trip = await createTrip(UID, "Goa");
    await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" }, trip.id);
    const id = await addTx(2000, RENT, { kind: "paid_for_friend", shares: { Asha: 1000 } }, trip.id);
    const before = await snapshot();
    const result = await del(id);
    expect((await snapshot()).expenses).toHaveLength(1);
    await undoDelete(UID, result.undo!);
    const after = await snapshot();
    expect(after.finance).toEqual(before.finance);
    expect(after.trips).toEqual(before.trips);
    expect(after.month).toEqual(before.month);
    expect(new Set(after.expenses.map((e) => e.$id))).toEqual(new Set(before.expenses.map((e) => e.$id)));
  });

  it("undoing a delete of a settlement re-applies it", async () => {
    await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const settlement = await addExpense(UID, { amount: 2000, categoryId: SETTLE, note: "Settlement paid to Ravi", timestamp: stamp() });
    await recordFriendSettlement("Ravi", "to_friend", 2000, settlement.$id);
    const before = await snapshot();
    const result = await del(settlement.$id);
    await undoDelete(UID, result.undo!);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses to undo once other data has changed", async () => {
    const id = await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const result = await del(id);
    await saveSalary(50000);
    await addLoan({ friend: "Asha", amount: 10, note: "", timestamp: stamp() });
    await expect(undoDelete(UID, result.undo!)).rejects.toThrow(/no longer be undone/i);
    expect((await snapshot()).expenses).toHaveLength(0);
  });

  it("undoing an add removes the expense and everything it created", async () => {
    const empty = await snapshot();
    const trip = await createTrip(UID, "Goa");
    const id = await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000 } }, trip.id);
    await undoCreate(id);
    const s = await snapshot();
    expect(s.expenses).toHaveLength(0);
    expect(s.finance.loans).toHaveLength(0);
    expect(s.trips[0].expenseIds).toEqual([]);
    expect(s.month).toEqual(empty.month);
  });

  it("undoing an edit restores the previous amount, split and trip", async () => {
    const trip = await createTrip(UID, "Goa");
    const id = await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000 } }, trip.id);
    const original = (await listExpenses(UID))[0] as Expense;
    const before = await snapshot();
    const tokenBefore = await captureState();
    // edit: 3000, now a plain self-paid expense outside the trip
    const { updateExpense } = await import("./services/expenses");
    const { moveExpenseToTrip } = await import("./services/trips");
    await updateExpense(id, { amount: 3000, categoryId: FOOD, note: "tx", timestamp: original.timestamp });
    await replaceExpenseFinanceData(id, null, [], null);
    await moveExpenseToTrip(id, "");
    const tokenAfter = await captureState();
    expect((await snapshot()).month.cashSpent).toBe(3000);
    await undoEdit(original, { before: tokenBefore, after: tokenAfter, expenses: [] });
    expect(await snapshot()).toEqual(before);
  });
});

describe("editing keeps settlement history", () => {
  it("re-saving a partly settled friend-paid expense keeps what was already paid", async () => {
    const id = await addTx(2000, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const settlement = await addExpense(UID, { amount: 500, categoryId: SETTLE, note: "Settlement paid to Ravi", timestamp: stamp() });
    await recordFriendSettlement("Ravi", "to_friend", 500, settlement.$id);
    const timestamp = stamp();
    await replaceExpenseFinanceData(id, { expenseId: id, friend: "Ravi", amount: 2000, originalAmount: 2000, personalShare: 2000, timestamp }, [], null);
    const { finance } = await snapshot();
    expect(finance.friendPaidExpenses![0].repaid).toBe(500);
    expect(finance.friendPaidExpenses![0].repayments).toHaveLength(1);
  });

  it("re-saving a partly repaid loan keeps its id so settlement allocations stay valid", async () => {
    const id = await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000 } });
    const settlement = await addExpense(UID, { amount: 400, categoryId: SETTLE, note: "Settlement received from Asha", timestamp: stamp() });
    await recordFriendSettlement("Asha", "from_friend", 400, settlement.$id);
    const loanId = (await snapshot()).finance.loans[0].id;
    await replaceExpenseFinanceData(id, null, [{ friend: "Asha", amount: 1000, note: "tx", timestamp: stamp(), expenseId: id }], null);
    const loan = (await snapshot()).finance.loans[0];
    expect(loan.id).toBe(loanId);
    expect(loan.repaid).toBe(400);
    // and the settlement can still be reversed cleanly afterwards
    await del(settlement.$id);
    expect((await snapshot()).finance.loans[0].repaid).toBe(0);
  });
});

describe("legacy data", () => {
  it("friend-paid entries saved with the inverted owed amount are read back as 'my share'", async () => {
    store.prefs.finance = JSON.stringify({
      salary: 0, loans: [], borrowings: [], settlements: [],
      friendPaidExpenses: [{ expenseId: "e1", friend: "Ravi", amount: 0, originalAmount: 2000, personalShare: 2000, timestamp: stamp() }],
    });
    const debt = (await getFinance()).friendPaidExpenses![0];
    expect(debt.amount).toBe(2000);
  });
});
