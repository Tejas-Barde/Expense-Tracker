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
  /** Already existed before the app was used: tracked as a balance only, never as money moving in or out. */
  opening?: boolean;
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
  /** Already existed before the app was used: tracked as a balance only, never as money moving in or out. */
  opening?: boolean;
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

/** One monthly payment of an EMI plan. It becomes a normal transaction on its due date. */
export interface EmiInstallment {
  n: number;
  /** yyyy-mm-dd */
  due: string;
  amount: number;
  /** Set once the transaction exists. A deleted transaction is never re-created. */
  expenseId?: string;
  /** Stopped before it was due. */
  cancelled?: boolean;
}
export interface EmiPlan {
  id: string;
  name: string;
  categoryId: string;
  createdAt: string;
  /** Product price, kept for display when known. */
  price?: number;
  annualRate?: number;
  /** Down payment plus one-time fees, paid on the purchase date. */
  upfront?: { date: string; amount: number; expenseId?: string; cancelled?: boolean };
  installments: EmiInstallment[];
  /** True once the remaining payments were stopped. */
  stopped?: boolean;
}
