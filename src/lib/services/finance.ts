import { ID, account } from "../appwrite/client";
import type { FinanceData, FriendPaidExpense, Loan } from "../../types";
import { mutateJSON } from "./prefs";

const PREF_KEY = "finance";
const emptyFinance: FinanceData = { salary: 0, loans: [], friendPaidExpenses: [] };

export async function getFinance(): Promise<FinanceData> {
  const prefs = (await account.getPrefs()) as Record<string, string>;
  if (!prefs[PREF_KEY]) return emptyFinance;
  const data = JSON.parse(prefs[PREF_KEY]) as Partial<FinanceData>;
  return {
    salary: typeof data.salary === "number" && data.salary >= 0 ? data.salary : 0,
    loans: Array.isArray(data.loans) ? data.loans : [],
    friendPaidExpenses: Array.isArray(data.friendPaidExpenses) ? data.friendPaidExpenses.map((item) => {
      if (typeof item.personalShare === "number") {
        // Older saves stored the owed amount as (total - my share); what I owe the payer is my share.
        const legacyInverted = typeof item.originalAmount === "number"
          && item.personalShare !== item.amount
          && Math.abs(item.originalAmount - item.personalShare - item.amount) < 0.005;
        const owed = legacyInverted ? item.personalShare : item.amount;
        const repaid = typeof item.repaid === "number" ? item.repaid : 0;
        return {
          ...item,
          amount: owed,
          repaid: Math.min(repaid, owed),
          repayments: Array.isArray(item.repayments) ? item.repayments : [],
        };
      }
      const gross = typeof item.originalAmount === "number" ? item.originalAmount : item.amount;
      const personalShare = Math.max(0, Math.min(gross, item.amount));
      return {
        ...item,
        originalAmount: gross,
        personalShare,
        amount: Math.max(0, gross - personalShare),
        repaid: typeof item.repaid === "number" ? item.repaid : 0,
        repayments: Array.isArray(item.repayments) ? item.repayments : [],
      };
    }) : [],
    settlements: Array.isArray(data.settlements) ? data.settlements : [],
    borrowings: Array.isArray(data.borrowings) ? data.borrowings.map((item) => ({
      ...item,
      repaid: typeof item.repaid === "number" ? item.repaid : 0,
      repayments: Array.isArray(item.repayments) ? item.repayments : [],
    })) : [],
  };
}

async function saveFinance(finance: FinanceData) {
  await mutateJSON<FinanceData>(PREF_KEY, () => finance, emptyFinance);
}

export async function saveSalary(salary: number) {
  if (!Number.isFinite(salary) || salary < 0) throw new Error("Salary must be zero or greater.");
  const finance = await getFinance();
  await saveFinance({ ...finance, salary });
}

export async function restoreFinanceData(finance: FinanceData) {
  await saveFinance({
    ...finance,
    loans: Array.isArray(finance.loans) ? finance.loans : [],
    friendPaidExpenses: Array.isArray(finance.friendPaidExpenses) ? finance.friendPaidExpenses : [],
    borrowings: Array.isArray(finance.borrowings) ? finance.borrowings : [],
    settlements: Array.isArray(finance.settlements) ? finance.settlements : [],
  });
}

export async function addLoan(loan: Omit<Loan, "id" | "repaid">) {
  if (!Number.isFinite(loan.amount) || loan.amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (!normalizeFriendName(loan.friend)) throw new Error("Enter a friend name.");
  const finance = await getFinance();
  const newLoan: Loan = { ...loan, friend: normalizeFriendName(loan.friend), id: ID.unique(), repaid: 0 };
  await saveFinance({ ...finance, loans: [newLoan, ...finance.loans] });
}

export async function deleteLoan(id: string) {
  const finance = await getFinance();
  const loan = finance.loans.find((item) => item.id === id);
  if (loan && loan.repaid > 0) throw new Error("This loan has repayment activity and cannot be deleted. Delete the settlement transaction instead.");
  await saveFinance({ ...finance, loans: finance.loans.filter((item) => item.id !== id) });
}

export async function addBorrowing(borrowing: { lender: string; amount: number; note: string; timestamp: string }) {
  if (!Number.isFinite(borrowing.amount) || borrowing.amount <= 0) throw new Error("Enter an amount greater than zero.");
  if (!normalizeFriendName(borrowing.lender)) throw new Error("Enter a lender name.");
  const finance = await getFinance();
  const newBorrowing = {
    ...borrowing,
    lender: normalizeFriendName(borrowing.lender),
    id: ID.unique(),
    repaid: 0,
    repayments: [],
  };
  await saveFinance({ ...finance, borrowings: [newBorrowing, ...(finance.borrowings ?? [])] });
}

export async function deleteBorrowing(id: string) {
  const finance = await getFinance();
  const borrowing = (finance.borrowings ?? []).find((item) => item.id === id);
  if (borrowing && borrowing.repaid > 0) throw new Error("This borrowing has repayment activity and cannot be deleted. Delete the settlement transaction instead.");
  await saveFinance({ ...finance, borrowings: (finance.borrowings ?? []).filter((item) => item.id !== id) });
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
  if (!Number.isFinite(expense.amount) || expense.amount <= 0) throw new Error("The amount owed to the payer must be greater than zero.");
  if (!normalizeFriendName(expense.friend)) throw new Error("Enter a friend name.");
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

export async function recordFriendSettlement(
  friendName: string,
  direction: "to_friend" | "from_friend",
  amount: number,
  expenseId?: string,
) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
  const key = friendNameKey(friendName);
  const timestamp = new Date().toISOString();
  await mutateJSON<FinanceData>(PREF_KEY, (finance) => {
    const totalDue = direction === "to_friend"
      ? (finance.friendPaidExpenses ?? []).reduce((sum, debt) =>
        friendNameKey(debt.friend) === key ? sum + Math.max(debt.amount - (debt.repaid ?? 0), 0) : sum, 0)
        + (finance.borrowings ?? []).reduce((sum, borrowing) =>
          friendNameKey(borrowing.lender) === key ? sum + Math.max(borrowing.amount - borrowing.repaid, 0) : sum, 0)
      : finance.loans.reduce((sum, loan) =>
        friendNameKey(loan.friend) === key ? sum + Math.max(loan.amount - loan.repaid, 0) : sum, 0);
    if (amount > totalDue + 0.000001) {
      throw new Error(`Settlement cannot exceed the amount due (${amount.toFixed(2)} requested; ${totalDue.toFixed(2)} due).`);
    }
    let remaining = amount;
    const allocations: { targetId: string; amount: number }[] = [];
    if (direction === "to_friend") {
      const updatedDebts = (finance.friendPaidExpenses ?? []).map((debt) => {
        if (!remaining || friendNameKey(debt.friend) !== key) return debt;
        const due = Math.max(debt.amount - (debt.repaid ?? 0), 0);
        const applied = Math.min(due, remaining);
        if (applied <= 0) return debt;
        remaining -= applied;
        const repaid = (debt.repaid ?? 0) + applied;
        allocations.push({ targetId: debt.expenseId, amount: applied });
        return {
          ...debt,
          repaid,
          repayments: [...(debt.repayments ?? []), { amount: applied, timestamp }],
        };
      });
      const updatedBorrowings = (finance.borrowings ?? []).map((borrowing) => {
        if (!remaining || friendNameKey(borrowing.lender) !== key) return borrowing;
        const due = Math.max(borrowing.amount - borrowing.repaid, 0);
        const applied = Math.min(due, remaining);
        if (applied <= 0) return borrowing;
        remaining -= applied;
        const repaid = borrowing.repaid + applied;
        allocations.push({ targetId: borrowing.id, amount: applied });
        return {
          ...borrowing,
          repaid,
          repayments: [...(borrowing.repayments ?? []), { amount: applied, timestamp }],
        };
      });
      return {
        ...finance,
        friendPaidExpenses: updatedDebts,
        borrowings: updatedBorrowings,
        settlements: [
          ...(finance.settlements ?? []).filter((item) => item.expenseId !== expenseId),
          {
            expenseId,
            friend: normalizeFriendName(friendName),
            direction,
            amount,
            timestamp,
            allocations,
          },
        ],
      };
    }
    return {
      ...finance,
      loans: finance.loans.map((loan) => {
        if (!remaining || friendNameKey(loan.friend) !== key) return loan;
        const due = Math.max(loan.amount - loan.repaid, 0);
        const applied = Math.min(due, remaining);
        if (applied <= 0) return loan;
        remaining -= applied;
        const repaid = loan.repaid + applied;
        allocations.push({ targetId: loan.id, amount: applied });
        return {
          ...loan,
          repaid,
          repayments: [...(loan.repayments ?? []), { amount: applied, timestamp }],
        };
      }),
      settlements: [
        ...(finance.settlements ?? []).filter((item) => item.expenseId !== expenseId),
        {
          expenseId,
          friend: normalizeFriendName(friendName),
          direction,
          amount,
          timestamp,
          allocations,
        },
      ],
    };
  }, emptyFinance);
}

export async function removeExpenseFinanceData(
  expenseIds: string[],
  removedExpenses: { id: string; amount: number; note: string }[] = [],
) {
  const removed = new Set(expenseIds);
  await mutateJSON<FinanceData>(PREF_KEY, (finance) => {
    let friendPaidExpenses = (finance.friendPaidExpenses ?? []).filter((item) => !removed.has(item.expenseId));
    let loans = finance.loans.filter((loan) => !loan.expenseId || !removed.has(loan.expenseId));
    let borrowings = (finance.borrowings ?? []).filter((borrowing) => !borrowing.expenseId || !removed.has(borrowing.expenseId));
    const settlements = [...(finance.settlements ?? [])];
    const removedSettlements = settlements.filter((item) => item.expenseId && removed.has(item.expenseId));

    for (const item of removedExpenses) {
      if (!removed.has(item.id)) continue;
      if (removedSettlements.some((settlement) => settlement.expenseId === item.id)) continue;

      const paidToMatch = /^Settlement paid to (.+)$/i.exec(item.note);
      const receivedFromMatch = /^Settlement received from (.+)$/i.exec(item.note);
      if (paidToMatch) {
        removedSettlements.push({
          expenseId: item.id,
          friend: normalizeFriendName(paidToMatch[1]),
          direction: "to_friend",
          amount: item.amount,
          timestamp: "",
          allocations: [],
        });
      } else if (receivedFromMatch) {
        removedSettlements.push({
          expenseId: item.id,
          friend: normalizeFriendName(receivedFromMatch[1]),
          direction: "from_friend",
          amount: item.amount,
          timestamp: "",
          allocations: [],
        });
      }
    }

    for (const settlement of removedSettlements) {
      let allocations = settlement.allocations ?? [];
      const key = friendNameKey(settlement.friend);

      if (!allocations.length && settlement.amount > 0) {
        let remaining = settlement.amount;
        if (settlement.direction === "to_friend") {
          for (const debt of friendPaidExpenses) {
            if (!remaining || friendNameKey(debt.friend) !== key) continue;
            const reversed = Math.min(debt.repaid ?? 0, remaining);
            if (reversed > 0) {
              allocations.push({ targetId: debt.expenseId, amount: reversed });
              remaining -= reversed;
            }
          }
          for (const borrowing of borrowings) {
            if (!remaining || friendNameKey(borrowing.lender) !== key) continue;
            const reversed = Math.min(borrowing.repaid, remaining);
            if (reversed > 0) {
              allocations.push({ targetId: borrowing.id, amount: reversed });
              remaining -= reversed;
            }
          }
        } else {
          for (const loan of loans) {
            if (!remaining || friendNameKey(loan.friend) !== key) continue;
            const reversed = Math.min(loan.repaid, remaining);
            if (reversed > 0) {
              allocations.push({ targetId: loan.id, amount: reversed });
              remaining -= reversed;
            }
          }
        }
      }

      if (settlement.direction === "to_friend") {
        friendPaidExpenses = friendPaidExpenses.map((debt) => {
          const allocation = allocations.find((item) => item.targetId === debt.expenseId);
          if (!allocation) return debt;
          const repaid = Math.max(0, (debt.repaid ?? 0) - allocation.amount);
          return {
            ...debt,
            repaid,
            repayments: (debt.repayments ?? []).filter((payment) =>
              payment.timestamp !== settlement.timestamp || payment.amount !== allocation.amount),
          };
        });
        borrowings = borrowings.map((borrowing) => {
          const allocation = allocations.find((item) => item.targetId === borrowing.id);
          if (!allocation) return borrowing;
          const repaid = Math.max(0, borrowing.repaid - allocation.amount);
          return {
            ...borrowing,
            repaid,
            repayments: (borrowing.repayments ?? []).filter((payment) =>
              payment.timestamp !== settlement.timestamp || payment.amount !== allocation.amount),
          };
        });
      } else {
        loans = loans.map((loan) => {
          const allocation = allocations.find((item) => item.targetId === loan.id);
          if (!allocation) return loan;
          const repaid = Math.max(0, loan.repaid - allocation.amount);
          return {
            ...loan,
            repaid,
            repayments: (loan.repayments ?? []).filter((payment) =>
              payment.timestamp !== settlement.timestamp || payment.amount !== allocation.amount),
          };
        });
      }
    }

    const removedSettlementIds = new Set(
      removedSettlements.map((item) => item.expenseId).filter((id): id is string => !!id),
    );
    return {
      ...finance,
      loans,
      friendPaidExpenses,
      borrowings,
      settlements: settlements.filter((item) => !item.expenseId || !removedSettlementIds.has(item.expenseId)),
    };
  }, emptyFinance);
}

export async function replaceExpenseFinanceData(
  expenseId: string,
  friendPaid: FriendPaidExpense | null,
  loans: Array<Omit<Loan, "id" | "repaid">>,
  borrowing: { lender: string; amount: number; note: string; timestamp: string } | null = null,
) {
  // Editing a transaction must not erase settlements already applied to it, so repayment history and
  // record ids (which settlement allocations point to) are carried over to the rewritten entries.
  await mutateJSON<FinanceData>(PREF_KEY, (finance) => {
    const previousDebt = (finance.friendPaidExpenses ?? []).find((item) => item.expenseId === expenseId);
    const previousLoans = finance.loans.filter((loan) => loan.expenseId === expenseId);
    const previousBorrowing = (finance.borrowings ?? []).find((item) => item.expenseId === expenseId);
    return {
      ...finance,
      friendPaidExpenses: [
        ...(finance.friendPaidExpenses ?? []).filter((item) => item.expenseId !== expenseId),
        ...(friendPaid ? [{
          ...friendPaid,
          friend: normalizeFriendName(friendPaid.friend),
          repaid: previousDebt && friendNameKey(previousDebt.friend) === friendNameKey(friendPaid.friend)
            ? Math.min(previousDebt.repaid ?? 0, friendPaid.amount) : 0,
          repayments: previousDebt && friendNameKey(previousDebt.friend) === friendNameKey(friendPaid.friend)
            ? previousDebt.repayments ?? [] : [],
        }] : []),
      ],
      loans: [
        ...finance.loans.filter((loan) => loan.expenseId !== expenseId),
        ...loans.map((loan) => {
          const previous = previousLoans.find((item) => friendNameKey(item.friend) === friendNameKey(loan.friend));
          return {
            ...loan,
            friend: normalizeFriendName(loan.friend),
            id: previous?.id ?? ID.unique(),
            repaid: Math.min(previous?.repaid ?? 0, loan.amount),
            repayments: previous?.repayments ?? [],
          };
        }),
      ],
      borrowings: [
        ...(finance.borrowings ?? []).filter((item) => item.expenseId !== expenseId),
        ...(borrowing ? [{
          ...borrowing,
          lender: normalizeFriendName(borrowing.lender),
          id: previousBorrowing?.id ?? ID.unique(),
          repaid: Math.min(previousBorrowing?.repaid ?? 0, borrowing.amount),
          repayments: previousBorrowing?.repayments ?? [],
          expenseId,
        }] : []),
      ],
    };
  }, emptyFinance);
}

export function normalizeFriendName(name: string) {
  return name.trim().replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function friendNameKey(name: string) {
  return normalizeFriendName(name).toLocaleLowerCase();
}

export function personalExpenseShare(expenseId: string, grossAmount: number, finance: FinanceData) {
  const friendPaid = (finance.friendPaidExpenses ?? []).find((item) => item.expenseId === expenseId);
  if (friendPaid) return Math.max(0, typeof friendPaid.personalShare === "number"
    ? friendPaid.personalShare
    : friendPaid.originalAmount
      ? Math.max(0, friendPaid.originalAmount - friendPaid.amount)
      : grossAmount - friendPaid.amount);
  const friendShares = finance.loans
    .filter((loan) => loan.expenseId === expenseId)
    .reduce((sum, loan) => sum + loan.amount, 0);
  return Math.max(0, grossAmount - friendShares);
}

export function actualCashOut(expenseId: string, grossAmount: number, finance: FinanceData) {
  if ((finance.friendPaidExpenses ?? []).some((item) => item.expenseId === expenseId)) return 0;
  if ((finance.borrowings ?? []).some((item) => item.expenseId === expenseId)) return 0;
  return grossAmount;
}

export const isSettlementNote = (note: string) => /^Settlement (paid to|received from) /i.test(note);

/** Net movement of the real bank balance: money received from a friend is an inflow (negative). */
export function accountCashFlow(expense: { $id: string; amount: number; note: string }, finance: FinanceData) {
  if (/^Settlement received from /i.test(expense.note)) return -expense.amount;
  return actualCashOut(expense.$id, expense.amount, finance);
}

/** What the expense counts as in category/trip spending: only the user's own share. */
export function categorySpend(expense: { $id: string; amount: number; note: string }, finance: FinanceData) {
  if (isSettlementNote(expense.note)) return 0;
  return personalExpenseShare(expense.$id, expense.amount, finance);
}
