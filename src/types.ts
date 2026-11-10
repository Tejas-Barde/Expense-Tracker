export interface Category { $id: string; userId: string; name: string; color: string; isDefault: boolean }
export interface Expense { $id: string; userId: string; amount: number; categoryId: string; note: string; timestamp: string }
export interface Budget { id: string | null; total: number; limits: Record<string, number>; savings?: number }
export interface Loan {
  id: string;
  friend: string;
  amount: number;
  repaid: number;
  note: string;
  timestamp: string;
  expenseId?: string;
  repayments?: { amount: number; timestamp: string }[];
}
export interface FriendPaidExpense {
  expenseId: string;
  friend: string;
  amount: number;
  originalAmount?: number;
  personalShare?: number;
  timestamp: string;
  repaid?: number;
  repayments?: { amount: number; timestamp: string }[];
}
export interface Borrowing {
  id: string;
  lender: string;
  amount: number;
  repaid: number;
  note: string;
  timestamp: string;
  expenseId?: string;
  repayments?: { amount: number; timestamp: string }[];
}
export interface Trip {
  id: string;
  name: string;
  timestamp: string;
  expenseIds: string[];
}
export interface FinanceData {
  salary: number;
  loans: Loan[];
  friendPaidExpenses?: FriendPaidExpense[];
  settlements?: Settlement[];
  borrowings?: Borrowing[];
}

export interface Settlement {
  expenseId?: string;
  friend: string;
  direction: "to_friend" | "from_friend";
  amount: number;
  timestamp: string;
  allocations: { targetId: string; amount: number }[];
}
