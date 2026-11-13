import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- In-memory stand-in for Appwrite (prefs + expenses table) ------------------------------------------
const store = vi.hoisted(() => ({ prefs: {} as Record<string, string>, rows: new Map<string, any>(), seq: 0, failDeleteFor: new Set<string>() }));
vi.mock("./appwrite/client", () => ({
  ID: { unique: () => `id${++store.seq}` },
  Query: { equal: () => null, orderDesc: () => null, limit: (n: number) => ({ limit: n }), cursorAfter: (id: string) => ({ after: id }) },
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
    listRows: async ({ queries = [] }: any) => {
      const limit = queries.find((q: any) => q?.limit)?.limit ?? 25;
      const after = queries.find((q: any) => q?.after)?.after;
      const all = [...store.rows.values()];
      const start = after ? all.findIndex((row) => row.$id === after) + 1 : 0;
      return { rows: all.slice(start, start + limit) };
    },
  },
}));

import { tablesDB } from "./appwrite/client";
import { addExpense, listExpenses } from "./services/expenses";
import { deleteCategory, findSimilarCategories, listCategories, mergeCategories, removeUnusedCategories, renameCategory, suggestedCategories, undoMerge } from "./services/categories";
import { addExpenseToTrip, createTrip, deleteTrip, listTrips } from "./services/trips";
import { addBorrowing, addLoan, deleteBorrowing, deleteLoan, friendBalances, getFinance, netPosition, recordFriendSettlement, replaceExpenseFinanceData, saveSalary } from "./services/finance";
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
    expect(month.cashSpent).toBe(300); // 700 lent out, 400 borrowed in
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

describe("net position counts loans, shared expenses and borrowings together", () => {
  const who = (finance: Awaited<ReturnType<typeof getFinance>>, name: string) => friendBalances(finance).find((b) => b.name === name)!;

  it("lent 1000 + borrowed 400 + friend-paid 200 from the same person nets to +400", async () => {
    await addLoan({ friend: "Asha", amount: 1000, note: "", timestamp: stamp() });
    await addBorrowing({ lender: "asha", amount: 400, note: "", timestamp: stamp() });   // different casing, same person
    await addTx(200, FOOD, { kind: "friend_paid", friend: "ASHA" });
    const finance = await getFinance();
    expect(who(finance, "Asha")).toMatchObject({ theyOweYou: 1000, youOweThem: 600, net: 400 });
    expect(netPosition(finance)).toBe(400);
  });

  it("net across several people adds up, and a borrowing can make the total negative", async () => {
    await addLoan({ friend: "Asha", amount: 300, note: "", timestamp: stamp() });
    await addBorrowing({ lender: "Meera", amount: 900, note: "", timestamp: stamp() });
    const finance = await getFinance();
    expect(netPosition(finance)).toBe(-600);
    expect(who(finance, "Meera").net).toBe(-900);
  });

  it("paying a lender back reduces what you owe and leaves other people untouched", async () => {
    await addLoan({ friend: "Asha", amount: 300, note: "", timestamp: stamp() });
    await addBorrowing({ lender: "Meera", amount: 900, note: "", timestamp: stamp() });
    const settlement = await addExpense(UID, { amount: 400, categoryId: SETTLE, note: "Settlement paid to Meera", timestamp: stamp() });
    await recordFriendSettlement("Meera", "to_friend", 400, settlement.$id);
    const finance = await getFinance();
    expect(who(finance, "Meera").net).toBe(-500);
    expect(who(finance, "Asha").net).toBe(300);
    expect(netPosition(finance)).toBe(-200);
  });

  it("a payment is applied to shared expenses first, then to borrowings, for the same person", async () => {
    await addTx(300, FOOD, { kind: "friend_paid", friend: "Meera" });
    await addBorrowing({ lender: "Meera", amount: 500, note: "", timestamp: stamp() });
    const settlement = await addExpense(UID, { amount: 400, categoryId: SETTLE, note: "Settlement paid to Meera", timestamp: stamp() });
    await recordFriendSettlement("Meera", "to_friend", 400, settlement.$id);
    const finance = await getFinance();
    expect(finance.friendPaidExpenses![0].repaid).toBe(300);
    expect(finance.borrowings![0].repaid).toBe(100);
    expect(who(finance, "Meera").net).toBe(-400);
  });

  it("cannot settle more than is owed across both kinds of debt", async () => {
    await addTx(300, FOOD, { kind: "friend_paid", friend: "Meera" });
    await addBorrowing({ lender: "Meera", amount: 500, note: "", timestamp: stamp() });
    await expect(recordFriendSettlement("Meera", "to_friend", 800.5, "x")).rejects.toThrow(/cannot exceed/i);
  });

  it("an uneven three-way split does not leave a phantom 1-paisa balance after settling", async () => {
    await addTx(100, FOOD, { kind: "paid_for_friend", shares: { Asha: 100 / 3, Neel: 100 / 3 } });
    for (const name of ["Asha", "Neel"]) {
      const owed = who(await getFinance(), name).theyOweYou;
      expect(owed).toBe(33.33);
      const settlement = await addExpense(UID, { amount: owed, categoryId: SETTLE, note: `Settlement received from ${name}`, timestamp: stamp() });
      await recordFriendSettlement(name, "from_friend", owed, settlement.$id);
    }
    expect(netPosition(await getFinance())).toBe(0);
    expect(friendBalances(await getFinance()).every((b) => b.net === 0)).toBe(true);
  });
});

describe("a standalone borrowing is real cash coming in", () => {
  it("borrow 1000 then repay 1000 leaves your balance where it started", async () => {
    await addBorrowing({ lender: "Meera", amount: 1000, note: "", timestamp: stamp() });
    expect((await snapshot()).month.cashSpent).toBe(-1000);
    const settlement = await addExpense(UID, { amount: 1000, categoryId: SETTLE, note: "Settlement paid to Meera", timestamp: stamp() });
    await recordFriendSettlement("Meera", "to_friend", 1000, settlement.$id);
    expect((await snapshot()).month.cashSpent).toBe(0);
  });

  it("lend 500 then get 500 back also nets to zero", async () => {
    await addLoan({ friend: "Asha", amount: 500, note: "", timestamp: stamp() });
    expect((await snapshot()).month.cashSpent).toBe(500);
    const settlement = await addExpense(UID, { amount: 500, categoryId: SETTLE, note: "Settlement received from Asha", timestamp: stamp() });
    await recordFriendSettlement("Asha", "from_friend", 500, settlement.$id);
    expect((await snapshot()).month.cashSpent).toBe(0);
  });

  it("an expense paid with borrowed money does not count as cash in or out", async () => {
    await addTx(900, FOOD, { kind: "borrowed", lender: "Meera" });
    expect((await snapshot()).month.cashSpent).toBe(0);
  });
});

describe("records that belong to a transaction cannot be deleted from the Balances page", () => {
  it("refuses to delete a loan tied to an expense, so category spend cannot silently change", async () => {
    await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000 } });
    const before = await snapshot();
    await expect(deleteLoan(before.finance.loans[0].id)).rejects.toThrow(/belongs to a transaction/i);
    expect((await snapshot()).month.byCategory[FOOD]).toBe(1000);
  });

  it("refuses to delete a borrowing tied to an expense", async () => {
    await addTx(900, FOOD, { kind: "borrowed", lender: "Meera" });
    await expect(deleteBorrowing((await getFinance()).borrowings![0].id)).rejects.toThrow(/belongs to a transaction/i);
  });

  it("still allows deleting an untouched standalone loan or borrowing", async () => {
    await addLoan({ friend: "Asha", amount: 500, note: "", timestamp: stamp() });
    await addBorrowing({ lender: "Meera", amount: 400, note: "", timestamp: stamp() });
    const finance = await getFinance();
    await deleteLoan(finance.loans[0].id);
    await deleteBorrowing(finance.borrowings![0].id);
    const after = await getFinance();
    expect(after.loans).toHaveLength(0);
    expect(after.borrowings).toHaveLength(0);
  });
});

describe("category management", () => {
  const seed = async (names: string[]) => {
    await listCategories(UID); // seeds the defaults
    store.prefs.categories = JSON.stringify(names.map((name, index) => ({ $id: `c${index}`, userId: UID, name, color: `#00000${index}`, isDefault: false })));
  };
  const ids = async () => Object.fromEntries((await listCategories(UID)).map((c) => [c.name, c.$id]));

  it("flags categories that are really the same thing, and leaves different ones alone", async () => {
    const cats = [
      ["Food", "food ", "Dining"], ["Cab/Travel", "Transport"], ["Shopping/Clothes", "Clothes"], ["Groceries"], ["Gym"],
    ];
    await seed(cats.flat());
    const groups = findSimilarCategories(await listCategories(UID)).map((g) => g.map((c) => c.name).sort());
    expect(groups).toContainEqual(["Dining", "Food", "food "].sort());
    expect(groups).toContainEqual(["Cab/Travel", "Transport"]);
    expect(groups).toContainEqual(["Clothes", "Shopping/Clothes"]);
    expect(groups.flat()).not.toContain("Groceries");
    expect(groups.flat()).not.toContain("Gym");
  });

  it("never offers to merge the Settlements category", async () => {
    await seed(["Settlements", "settlements "]);
    expect(findSimilarCategories(await listCategories(UID))).toEqual([]);
  });

  it("suggests a home for glasses and trimmers only when nothing equivalent exists", async () => {
    await seed(["Food", "Cab/Travel"]);
    const names = suggestedCategories(await listCategories(UID)).map((s) => s.name);
    expect(names).toContain("Health & Personal Care");
    expect(names).not.toContain("Transport");        // Cab/Travel already covers it
    expect(names).not.toContain("Food & Dining");    // Food already covers it
    await seed(["Personal Care"]);
    expect(suggestedCategories(await listCategories(UID)).map((s) => s.name)).not.toContain("Health & Personal Care");
  });

  it("merging moves every transaction, adds up the budget limits and removes the old categories", async () => {
    await seed(["Food", "Dining", "Shopping"]);
    const c = await ids();
    await addTx(100, c.Food, { kind: "self" });
    await addTx(250, c.Dining, { kind: "self" });
    await addTx(40, c.Shopping, { kind: "self" });
    store.prefs.budgets = JSON.stringify({ [MK]: { total: 5000, savings: 0, limits: { [c.Food]: 1000, [c.Dining]: 500, [c.Shopping]: 300 } } });
    const result = await mergeCategories(UID, [c.Dining], c.Food);
    expect(result.moved).toBe(1);
    const { expenses, month } = await snapshot();
    expect(expenses.find((e) => e.amount === 250)!.categoryId).toBe(c.Food);
    expect(month.byCategory[c.Food]).toBe(350);
    expect(Object.keys(await ids()).sort()).toEqual(["Food", "Shopping"]);
    const budget = JSON.parse(store.prefs.budgets)[MK];
    expect(budget.limits).toEqual({ [c.Food]: 1500, [c.Shopping]: 300 });
    expect(budget.total).toBe(5000);
  });

  it("merging keeps trip, split and debt data attached to the same transactions", async () => {
    await seed(["Food", "Dining"]);
    const c = await ids();
    const trip = await createTrip(UID, "Goa");
    const id = await addTx(2000, c.Dining, { kind: "paid_for_friend", shares: { Asha: 1000 } }, trip.id);
    const before = await snapshot();
    await mergeCategories(UID, [c.Dining], c.Food);
    const after = await snapshot();
    expect(after.finance).toEqual(before.finance);
    expect(after.trips).toEqual(before.trips);
    expect(after.month.tripSpent).toBe(1000);
    expect(after.expenses.find((e) => e.$id === id)!.categoryId).toBe(c.Food);
  });

  it("undoing a merge restores categories, budgets and each transaction's original category", async () => {
    await seed(["Food", "Dining", "Shopping"]);
    const c = await ids();
    await addTx(100, c.Food, { kind: "self" });
    await addTx(250, c.Dining, { kind: "self" });
    store.prefs.budgets = JSON.stringify({ [MK]: { total: 5000, limits: { [c.Food]: 1000, [c.Dining]: 500 } } });
    const catsBefore = store.prefs.categories, budgetsBefore = store.prefs.budgets;
    const expensesBefore = (await listExpenses(UID)).map((e) => [e.$id, e.categoryId]).sort();
    const result = await mergeCategories(UID, [c.Dining], c.Food);
    await undoMerge(result.undo);
    expect(JSON.parse(store.prefs.categories)).toEqual(JSON.parse(catsBefore));
    expect(JSON.parse(store.prefs.budgets)).toEqual(JSON.parse(budgetsBefore));
    expect((await listExpenses(UID)).map((e) => [e.$id, e.categoryId]).sort()).toEqual(expensesBefore);
  });

  it("a failure part-way through a merge rolls everything back", async () => {
    await seed(["Food", "Dining"]);
    const c = await ids();
    const a = await addTx(100, c.Dining, { kind: "self" });
    const b = await addTx(200, c.Dining, { kind: "self" });
    const originalUpdate = tablesDB.updateRow;
    (tablesDB as any).updateRow = async (args: any) => { if (args.rowId === b) throw new Error("network"); return originalUpdate(args); };
    try {
      await expect(mergeCategories(UID, [c.Dining], c.Food)).rejects.toThrow();
    } finally { (tablesDB as any).updateRow = originalUpdate; }
    expect(store.rows.get(a).categoryId).toBe(c.Dining);
    expect(store.rows.get(b).categoryId).toBe(c.Dining);
    expect(Object.keys(await ids()).sort()).toEqual(["Dining", "Food"]);
  });

  it("cannot delete a category that is in use, but can delete an empty one", async () => {
    await seed(["Food", "Gym"]);
    const c = await ids();
    await addTx(100, c.Gym, { kind: "self" });
    await expect(deleteCategory(UID, c.Gym)).rejects.toThrow(/merge it into another category/i);
    await deleteCategory(UID, c.Food);
    expect(Object.keys(await ids())).toEqual(["Gym"]);
  });

  it("renaming rejects duplicates, blanks and the reserved Settlements name", async () => {
    await seed(["Food", "Gym"]);
    const c = await ids();
    await expect(renameCategory(UID, c.Gym, "food")).rejects.toThrow(/already exists/i);
    await expect(renameCategory(UID, c.Gym, "   ")).rejects.toThrow(/enter a category name/i);
    await expect(renameCategory(UID, c.Gym, "Settlements")).rejects.toThrow(/reserved/i);
    await renameCategory(UID, c.Gym, "Fitness");
    expect(Object.keys(await ids()).sort()).toEqual(["Fitness", "Food"]);
  });

  it("protects the Settlements category from merge, rename and delete", async () => {
    await seed(["Food", "Settlements"]);
    const c = await ids();
    await expect(mergeCategories(UID, [c.Settlements], c.Food)).rejects.toThrow(/managed by the app/i);
    await expect(mergeCategories(UID, [c.Food], c.Settlements)).rejects.toThrow(/managed by the app/i);
    await expect(renameCategory(UID, c.Settlements, "Payments")).rejects.toThrow(/managed by the app/i);
    await expect(deleteCategory(UID, c.Settlements)).rejects.toThrow(/managed by the app/i);
  });

  it("loads more than one page of transactions", async () => {
    for (let i = 0; i < 1203; i++) store.rows.set(`bulk${i}`, { $id: `bulk${i}`, userId: UID, amount: 1, categoryId: FOOD, note: "", timestamp: stamp() });
    expect(await listExpenses(UID)).toHaveLength(1203);
  });
});

describe("month boundaries and defaults", () => {
  it("an expense just after midnight on the 1st belongs to the new month, not the old one", async () => {
    const lateNight = new Date(2026, 11, 1, 0, 30).toISOString();    // 1 Dec, 00:30 local = 30 Nov in UTC
    const earlyMorning = new Date(2026, 10, 30, 23, 45).toISOString(); // 30 Nov, 23:45 local
    await addExpense(UID, { amount: 500, categoryId: FOOD, note: "", timestamp: lateNight });
    await addExpense(UID, { amount: 200, categoryId: FOOD, note: "", timestamp: earlyMorning });
    const expenses = await listExpenses(UID);
    const finance = await getFinance();
    expect(summarizeMonth(expenses, finance, [], "2026-12").cashSpent).toBe(500);
    expect(summarizeMonth(expenses, finance, [], "2026-11").cashSpent).toBe(200);
  });

  it("new accounts start with a focused set that includes Other, and offer the rest as suggestions", async () => {
    const names = (await listCategories(UID)).map((c) => c.name);
    expect(names).toContain("Other");
    expect(names).toContain("Health & Personal Care");
    expect(names).not.toContain("Education");
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(names.length);
    expect(suggestedCategories(await listCategories(UID)).map((s) => s.name).sort()).toEqual(["Education", "Gifts & Donations"]);
  });

  it("removing unused categories keeps the ones in use, Other and Settlements, and can be undone", async () => {
    store.prefs.categories = JSON.stringify(["Food", "Gym", "Pets", "Other", "Settlements"].map((name, i) => ({ $id: `c${i}`, userId: UID, name, color: `#00000${i}`, isDefault: false })));
    await addTx(100, "c0", { kind: "self" });
    store.prefs.budgets = JSON.stringify({ [MK]: { total: 1000, limits: { c0: 500, c1: 200 } } });
    const before = store.prefs.categories;
    const { removed, undo } = await removeUnusedCategories(UID);
    expect(removed.map((c) => c.name).sort()).toEqual(["Gym", "Pets"]);
    expect((await listCategories(UID)).map((c) => c.name)).toEqual(["Food", "Other", "Settlements"]);
    expect(JSON.parse(store.prefs.budgets)[MK].limits).toEqual({ c0: 500 });
    await undoMerge(undo);
    expect(store.prefs.categories).toBe(before);
    expect(JSON.parse(store.prefs.budgets)[MK].limits).toEqual({ c0: 500, c1: 200 });
  });
});

describe("trips", () => {
  it("deleting a trip keeps its transactions and returns them to their categories", async () => {
    const trip = await createTrip(UID, "Goa");
    await addTx(2000, FOOD, { kind: "self" }, trip.id);
    expect((await snapshot()).month.tripSpent).toBe(2000);
    await deleteTrip(trip.id);
    const s = await snapshot();
    expect(s.trips).toHaveLength(0);
    expect(s.expenses).toHaveLength(1);
    expect(s.month.tripSpent).toBe(0);
    expect(s.month.byCategory[FOOD]).toBe(2000);
  });

  it("quick back-to-back changes do not overwrite each other", async () => {
    const a = await createTrip(UID, "Goa");
    const b = await createTrip(UID, "Pune");
    await Promise.all([addExpenseToTrip(a.id, "e1"), addExpenseToTrip(b.id, "e2"), addExpenseToTrip(a.id, "e3"), createTrip(UID, "Jaipur")]);
    const trips = await listTrips(UID);
    expect(trips.find((t) => t.name === "Goa")!.expenseIds.sort()).toEqual(["e1", "e3"]);
    expect(trips.find((t) => t.name === "Pune")!.expenseIds).toEqual(["e2"]);
    expect(trips.map((t) => t.name)).toContain("Jaipur");
  });

  it("rejects a duplicate trip name", async () => {
    await createTrip(UID, "Goa");
    await expect(createTrip(UID, " goa ")).rejects.toThrow(/already exists/i);
  });
});

describe("splitting a bill unevenly", () => {
  it("friend shares are rounded to the paisa and your share absorbs the remainder", async () => {
    // 100 split three ways: two friends at 33.33, so you carry 33.34 and the three parts add up exactly
    await addTx(100, FOOD, { kind: "paid_for_friend", shares: { Asha: 33.33, Neel: 33.33 } });
    const { month, finance } = await snapshot();
    expect(finance.loans.map((l) => l.amount)).toEqual([33.33, 33.33]);
    expect(month.byCategory[FOOD]).toBeCloseTo(33.34, 2);
  });
});

describe("actual spend and effective spend always reconcile", () => {
  // effective (your own share, by category) = left your account - net change in what others owe you
  const check = async (label: string) => {
    const { month, finance } = await snapshot();
    const rec = month.reconciliation;
    expect(month.categorizedSpent, `${label}: effective vs actual - change in net`).toBeCloseTo(month.cashSpent - rec.netChange, 2);
    // with only this month's activity, the change in net is the whole outstanding net position
    expect(rec.netChange, `${label}: monthly change vs outstanding net`).toBeCloseTo(netPosition(finance), 2);
    expect(month.mismatch).toBeCloseTo(0, 2);
  };

  it("a worked example: lent, shared, borrowed and settled in one month", async () => {
    await addTx(1000, FOOD, { kind: "self" });                                               // account -1000, own 1000
    await addTx(2000, FOOD, { kind: "paid_for_friend", shares: { Asha: 1000 } });            // account -2000, own 1000, owed to you +1000
    await addTx(500, RENT, { kind: "friend_paid", friend: "Ravi" });                         // account 0,     own 500,  you owe +500
    await addTx(900, FOOD, { kind: "borrowed", lender: "Meera" });                           // account 0,     own 900,  you owe +900
    await addLoan({ friend: "Neel", amount: 300, note: "", timestamp: stamp() });            // account -300,  own 0,    owed to you +300
    await addBorrowing({ lender: "Kiran", amount: 700, note: "", timestamp: stamp() });      // account +700,  own 0,    you owe +700
    const { month } = await snapshot();
    expect(month.cashSpent).toBe(1000 + 2000 + 300 - 700);                                   // 2600
    expect(month.categorizedSpent).toBe(1000 + 1000 + 500 + 900);                            // 3400
    expect(month.reconciliation).toMatchObject({ receivableAdded: 1300, payableAdded: 2100, netChange: -800 });
    expect(month.categorizedSpent).toBe(month.cashSpent - month.reconciliation.netChange);   // 2600 + 800
    await check("worked example");
    // settle everything with Asha and Ravi: the two numbers stay reconciled
    const s1 = await addExpense(UID, { amount: 1000, categoryId: SETTLE, note: "Settlement received from Asha", timestamp: stamp() });
    await recordFriendSettlement("Asha", "from_friend", 1000, s1.$id);
    const s2 = await addExpense(UID, { amount: 500, categoryId: SETTLE, note: "Settlement paid to Ravi", timestamp: stamp() });
    await recordFriendSettlement("Ravi", "to_friend", 500, s2.$id);
    await check("after settling");
    expect((await snapshot()).month.categorizedSpent).toBe(3400);                            // settling never changes what you spent
  });

  it("holds after every step of 40 random sequences of mixed activity", async () => {
    for (let seed = 1; seed <= 40; seed++) {
      store.prefs = {}; store.rows.clear(); store.seq = 0;
      let state = seed * 2654435761 % 4294967296;
      const rnd = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
      const money2 = () => Math.round((50 + rnd() * 4000) * 100) / 100;
      const people = ["Asha", "Ravi", "Meera", "Neel"];
      const pick = <T,>(items: T[]) => items[Math.floor(rnd() * items.length)];
      const trip = await createTrip(UID, "Trip");
      for (let step = 0; step < 25; step++) {
        const roll = rnd();
        const label = `seed ${seed} step ${step}`;
        const amount = money2();
        if (roll < 0.14) await addTx(amount, pick([FOOD, RENT]), { kind: "self" }, rnd() < 0.3 ? trip.id : undefined);
        else if (roll < 0.28) await addTx(amount, FOOD, { kind: "friend_paid", friend: pick(people) });
        else if (roll < 0.44) {
          const a = pick(people), b = pick(people.filter((p) => p !== a));
          const first = Math.round(amount * rnd() * 0.5 * 100) / 100 || 1, second = Math.round(amount * rnd() * 0.4 * 100) / 100 || 1;
          await addTx(amount, FOOD, { kind: "paid_for_friend", shares: rnd() < 0.5 ? { [a]: first } : { [a]: first, [b]: second } }, rnd() < 0.3 ? trip.id : undefined);
        } else if (roll < 0.52) await addTx(amount, RENT, { kind: "borrowed", lender: pick(people) });
        else if (roll < 0.6) await addLoan({ friend: pick(people), amount, note: "", timestamp: stamp() });
        else if (roll < 0.68) await addBorrowing({ lender: pick(people), amount, note: "", timestamp: stamp() });
        else if (roll < 0.86) {
          const balances = friendBalances(await getFinance());
          const payable = balances.filter((b) => b.youOweThem > 0.01), receivable = balances.filter((b) => b.theyOweYou > 0.01);
          const toFriend = payable.length > 0 && (receivable.length === 0 || rnd() < 0.5);
          const candidates = toFriend ? payable : receivable;
          if (candidates.length) {
            const person = pick(candidates);
            const due = toFriend ? person.youOweThem : person.theyOweYou;
            const pay = rnd() < 0.4 ? due : Math.max(0.01, Math.round(due * rnd() * 100) / 100);
            const settlement = await addExpense(UID, { amount: pay, categoryId: SETTLE, note: `Settlement ${toFriend ? "paid to" : "received from"} ${person.name}`, timestamp: stamp() });
            await recordFriendSettlement(person.name, toFriend ? "to_friend" : "from_friend", pay, settlement.$id);
          }
        } else {
          const rows = await listExpenses(UID);
          if (rows.length) { try { await deleteTransactions([pick(rows).$id], rows); } catch { /* blocked: has settlements applied */ } }
        }
        await check(label);
      }
    }
  });
});

describe("records from the oldest versions of the app", () => {
  it("friend-paid records with only { amount } keep that amount as what is owed, and repayments marked without a settlement still reconcile", async () => {
    const timestamp = stamp();
    for (const [id, amount, repaid] of [["e1", 726, 726], ["e2", 244, 243], ["e3", 500, 0]] as const) {
      store.rows.set(id, { $id: id, userId: UID, amount, categoryId: FOOD, note: "", timestamp });
    }
    store.prefs.finance = JSON.stringify({
      salary: 0, loans: [], borrowings: [], settlements: [],
      friendPaidExpenses: [
        { expenseId: "e1", friend: "Ravi", amount: 726, timestamp, repaid: 726, repayments: [{ amount: 726, timestamp }] },
        { expenseId: "e2", friend: "Ravi", amount: 244, timestamp, repaid: 243, repayments: [{ amount: 243, timestamp }] },
        { expenseId: "e3", friend: "Asha", amount: 500, timestamp },
      ],
    });
    const { finance, month } = await snapshot();
    expect(finance.friendPaidExpenses!.map((d) => [d.amount, d.personalShare, d.repaid])).toEqual([[726, 726, 726], [244, 244, 243], [500, 500, 0]]);
    expect(month.categorizedSpent).toBe(726 + 244 + 500);       // what you spent
    expect(month.cashSpent).toBe(726 + 243);                    // only the repayments left your account
    expect(month.unrecorded).toEqual({ paid: 969, received: 0 });
    expect(month.reconciliation.netChange).toBe(-(1470 - 969)); // still owe 501
    expect(month.mismatch).toBe(0);
    expect(friendBalances(finance).map((b) => [b.name, b.net])).toEqual([["Ravi", -1], ["Asha", -500]]);
  });

  it("a repayment made through a settlement is not counted twice", async () => {
    await addTx(300, FOOD, { kind: "friend_paid", friend: "Ravi" });
    const settlement = await addExpense(UID, { amount: 300, categoryId: SETTLE, note: "Settlement paid to Ravi", timestamp: stamp() });
    await recordFriendSettlement("Ravi", "to_friend", 300, settlement.$id);
    const { month } = await snapshot();
    expect(month.cashSpent).toBe(300);
    expect(month.unrecorded).toEqual({ paid: 0, received: 0 });
    expect(month.mismatch).toBe(0);
  });
});

describe("money owed from before the app (opening balances)", () => {
  it("owing a friend ₹11,000 from before, then paying it back: the payment is cash out but not spending, and nothing else moves", async () => {
    await addBorrowing({ lender: "Wejas", amount: 11000, note: "from before", timestamp: stamp(), opening: true });
    let s = await snapshot();
    expect(s.month.cashSpent).toBe(0);               // recording the old debt moves no money
    expect(s.month.categorizedSpent).toBe(0);
    expect(friendBalances(s.finance)[0]).toMatchObject({ name: "Wejas", youOweThem: 11000, net: -11000 });
    const first = await addExpense(UID, { amount: 10000, categoryId: SETTLE, note: "Settlement paid to Wejas", timestamp: stamp() });
    await recordFriendSettlement("Wejas", "to_friend", 10000, first.$id);
    const second = await addExpense(UID, { amount: 1000, categoryId: SETTLE, note: "Settlement paid to Wejas", timestamp: stamp() });
    await recordFriendSettlement("Wejas", "to_friend", 1000, second.$id);
    s = await snapshot();
    expect(s.month.cashSpent).toBe(11000);           // it did leave your account
    expect(s.month.categorizedSpent).toBe(0);        // but it was never spending
    expect(s.month.mismatch).toBe(0);
    expect(friendBalances(s.finance)[0].net).toBe(0);
    expect(s.finance.borrowings![0].repaid).toBe(11000);
  });

  it("an opening loan to a friend is not cash out, and getting it back is cash in", async () => {
    await addLoan({ friend: "Asha", amount: 500, note: "", timestamp: stamp(), opening: true });
    expect((await snapshot()).month.cashSpent).toBe(0);
    const back = await addExpense(UID, { amount: 500, categoryId: SETTLE, note: "Settlement received from Asha", timestamp: stamp() });
    await recordFriendSettlement("Asha", "from_friend", 500, back.$id);
    const { month } = await snapshot();
    expect(month.cashSpent).toBe(-500);
    expect(month.categorizedSpent).toBe(0);
    expect(month.mismatch).toBe(0);
  });

  it("a payment can be dated in the past so it lands in the right month", async () => {
    await addBorrowing({ lender: "Wejas", amount: 1000, note: "", timestamp: stamp(), opening: true });
    const october = new Date(2026, 9, 25, 12).toISOString();
    const settlement = await addExpense(UID, { amount: 1000, categoryId: SETTLE, note: "Settlement paid to Wejas", timestamp: october });
    await recordFriendSettlement("Wejas", "to_friend", 1000, settlement.$id, october);
    const { expenses, finance, trips } = await snapshot();
    const oct = summarizeMonth(expenses, finance, trips, "2026-10");
    expect(oct.cashSpent).toBe(1000);
    expect(oct.mismatch).toBe(0);
    expect(oct.reconciliation.payableSettled).toBe(1000);
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
