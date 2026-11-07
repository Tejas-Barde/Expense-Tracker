import { ID, account } from "../appwrite/client";
import type { FinanceData, FriendPaidExpense, Loan } from "../../types";

const PREF_KEY = "finance";
const emptyFinance: FinanceData = { salary: 0, loans: [], friendPaidExpenses: [] };

export async function getFinance(): Promise<FinanceData> {
  const prefs = (await account.getPrefs()) as Record<string, string>;
  if (!prefs[PREF_KEY]) return emptyFinance;
  const data = JSON.parse(prefs[PREF_KEY]) as Partial<FinanceData>;
  return {
    salary: typeof data.salary === "number" && data.salary >= 0 ? data.salary : 0,
    loans: Array.isArray(data.loans) ? data.loans : [],
    friendPaidExpenses: Array.isArray(data.friendPaidExpenses) ? data.friendPaidExpenses.map((item) => ({
      ...item,
      repaid: typeof item.repaid === "number" ? item.repaid : 0,
      repayments: Array.isArray(item.repayments) ? item.repayments : [],
    })) : [],
  };
}

async function saveFinance(finance: FinanceData) {
  const prefs = await account.getPrefs();
  await account.updatePrefs({ ...prefs, [PREF_KEY]: JSON.stringify(finance) });
}

export async function saveSalary(salary: number) {
  const finance = await getFinance();
  await saveFinance({ ...finance, salary });
}

export async function addLoan(loan: Omit<Loan, "id" | "repaid">) {
  const finance = await getFinance();
  const newLoan: Loan = { ...loan, friend: normalizeFriendName(loan.friend), id: ID.unique(), repaid: 0 };
  await saveFinance({ ...finance, loans: [newLoan, ...finance.loans] });
}

export async function updateLoanRepaid(id: string, repaid: number) {
  const finance = await getFinance();
  const loan = finance.loans.find((item) => item.id === id);
  if (!loan) throw new Error("Lending entry could not be found.");
  if (repaid < 0 || repaid > loan.amount) throw new Error("Repayment must be between zero and the amount lent.");
  const previous = loan.repaid;
  const received = Math.max(0, repaid - previous);
  const repayments = [
    ...(loan.repayments ?? []),
    ...(received > 0 ? [{ amount: received, timestamp: new Date().toISOString() }] : []),
  ];
  await saveFinance({
    ...finance,
    loans: finance.loans.map((item) => item.id === id ? { ...item, repaid, repayments } : item),
  });
}

export async function addFriendPaidExpense(expense: FriendPaidExpense) {
  const finance = await getFinance();
  await saveFinance({
    ...finance,
    friendPaidExpenses: [...(finance.friendPaidExpenses ?? []), { ...expense, friend: normalizeFriendName(expense.friend), repaid: 0, repayments: [] }],
  });
}

export async function updateFriendPaidRepaid(expenseId: string, repaid: number) {
  const finance = await getFinance();
  const debt = finance.friendPaidExpenses?.find((item) => item.expenseId === expenseId);
  if (!debt) throw new Error("Debt could not be found.");
  if (repaid < 0 || repaid > debt.amount) throw new Error("Payment must be between zero and the amount owed.");
  const previous = debt.repaid ?? 0;
  const paid = Math.max(0, repaid - previous);
  await saveFinance({
    ...finance,
    friendPaidExpenses: (finance.friendPaidExpenses ?? []).map((item) => item.expenseId === expenseId ? {
      ...item,
      repaid,
      repayments: [
        ...(item.repayments ?? []),
        ...(paid > 0 ? [{ amount: paid, timestamp: new Date().toISOString() }] : []),
      ],
    } : item),
  });
}

export async function recordFriendSettlement(friendName: string, direction: "to_friend" | "from_friend", amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
  const finance = await getFinance();
  const key = friendNameKey(friendName);
  const timestamp = new Date().toISOString();
  let remaining = amount;

  if (direction === "to_friend") {
    const debts = finance.friendPaidExpenses ?? [];
    const updated = debts.map((debt) => {
      if (!remaining || friendNameKey(debt.friend) !== key) return debt;
      const due = Math.max(debt.amount - (debt.repaid ?? 0), 0);
      const applied = Math.min(due, remaining);
      if (applied <= 0) return debt;
      remaining -= applied;
      const repaid = (debt.repaid ?? 0) + applied;
      return {
        ...debt,
        repaid,
        repayments: [...(debt.repayments ?? []), { amount: applied, timestamp }],
      };
    });
    await saveFinance({ ...finance, friendPaidExpenses: updated });
  } else {
    const updatedLoans = finance.loans.map((loan) => {
      if (!remaining || friendNameKey(loan.friend) !== key) return loan;
      const due = Math.max(loan.amount - loan.repaid, 0);
      const applied = Math.min(due, remaining);
      if (applied <= 0) return loan;
      remaining -= applied;
      const repaid = loan.repaid + applied;
      return {
        ...loan,
        repaid,
        repayments: [...(loan.repayments ?? []), { amount: applied, timestamp }],
      };
    });
    await saveFinance({ ...finance, loans: updatedLoans });
  }
}

export async function removeExpenseFinanceData(expenseIds: string[]) {
  const finance = await getFinance();
  const removed = new Set(expenseIds);
  await saveFinance({
    ...finance,
    friendPaidExpenses: (finance.friendPaidExpenses ?? []).filter((item) => !removed.has(item.expenseId)),
    loans: finance.loans.filter((loan) => !loan.expenseId || !removed.has(loan.expenseId)),
  });
}

export function normalizeFriendName(name: string) {
  return name.trim().replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function friendNameKey(name: string) {
  return normalizeFriendName(name).toLocaleLowerCase();
}
