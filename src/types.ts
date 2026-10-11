export interface Category { $id: string; userId: string; name: string; color: string; isDefault: boolean }
export interface Expense { $id: string; userId: string; amount: number; categoryId: string; note: string; timestamp: string }
export interface Budget { id: string | null; total: number; limits: Record<string, number> }
