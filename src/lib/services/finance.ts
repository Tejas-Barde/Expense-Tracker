import { ID, account } from "../appwrite/client";
import type { FinanceData, Loan } from "../../types";

const PREF_KEY = "finance";
const emptyFinance: FinanceData = { salary: 0, loans: [] };

export async function getFinance(): Promise<FinanceData> {
  const prefs = (await account.getPrefs()) as Record<string, string>;
  if (!prefs[PREF_KEY]) return emptyFinance;
  const data = JSON.parse(prefs[PREF_KEY]) as Partial<FinanceData>;
  return {
    salary: typeof data.salary === "number" && data.salary >= 0 ? data.salary : 0,
    loans: Array.isArray(data.loans) ? data.loans : [],
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
  const newLoan: Loan = { ...loan, id: ID.unique(), repaid: 0 };
  await saveFinance({ ...finance, loans: [newLoan, ...finance.loans] });
}

export async function updateLoanRepaid(id: string, repaid: number) {
  const finance = await getFinance();
  const loan = finance.loans.find((item) => item.id === id);
  if (!loan) throw new Error("Lending entry could not be found.");
  if (repaid < 0 || repaid > loan.amount) throw new Error("Repayment must be between zero and the amount lent.");
  await saveFinance({
    ...finance,
    loans: finance.loans.map((item) => item.id === id ? { ...item, repaid } : item),
  });
}
