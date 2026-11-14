import { ID } from "../appwrite/client";
import type { EmiInstallment, EmiPlan, Expense } from "../../types";
import { buildEmiSchedule, parseDate, validateEmiInput, type EmiInput } from "../emiSchedule";
import { createExpenseWithId } from "./expenses";
import { getJSON, mutateJSON } from "./prefs";
import { deleteTransactions } from "./transactions";

const KEY = "emis";

export const listEmis = () => getJSON<EmiPlan[]>(KEY, []);

/** Midday on the due date in the user's timezone, so the transaction lands on that calendar day. */
export function dueTimestamp(date: string) {
  const d = parseDate(date);
  if (!d) throw new Error(`Invalid date: ${date}`);
  return new Date(d.y, d.m - 1, d.d, 12, 0, 0).toISOString();
}
/** Today as yyyy-mm-dd in the user's timezone. */
export function todayString(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Fixed ids: the same payment always maps to the same transaction row, which is what makes creating it repeatable.
export const installmentExpenseId = (planId: string, n: number) => `emi${planId}n${n}`;
export const upfrontExpenseId = (planId: string) => `emi${planId}u`;

export interface NewEmi { name: string; categoryId: string; input: EmiInput }

export async function createEmi(details: NewEmi): Promise<EmiPlan> {
  const name = details.name.trim();
  if (!name) throw new Error("Enter what you bought.");
  if (!details.categoryId) throw new Error("Choose a category.");
  const errors = validateEmiInput(details.input);
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);
  const schedule = buildEmiSchedule(details.input);
  const plan: EmiPlan = {
    id: ID.unique(),
    name,
    categoryId: details.categoryId,
    createdAt: new Date().toISOString(),
    ...(details.input.mode === "price" ? { price: details.input.price, annualRate: details.input.annualRate } : {}),
    ...(schedule.upfront > 0 ? { upfront: { date: details.input.purchaseDate, amount: schedule.upfront } } : {}),
    installments: schedule.installments.map((item) => ({ n: item.n, due: item.due, amount: item.amount })),
  };
  await mutateJSON<EmiPlan[]>(KEY, (plans) => [...plans, plan], []);
  return plan;
}

// ---- Turning due payments into transactions --------------------------------------------------------------
export interface Materialized { planName: string; label: string; amount: number; date: string }
let running: Promise<{ created: Materialized[]; failed: number }> | null = null;

/**
 * Adds a transaction for every EMI payment that is due (today or earlier) and does not have one yet.
 * Safe to call as often as you like, from several tabs at once: nothing is ever added twice, and a payment whose
 * transaction was deleted is not brought back.
 */
export function materializeDueEmis(uid: string, now = new Date()): Promise<{ created: Materialized[]; failed: number }> {
  if (running) return running;
  running = (async () => {
    const today = todayString(now);
    const plans = await listEmis();
    type Job = { planId: string; key: "u" | number; id: string; label: string; plan: EmiPlan; amount: number; date: string };
    const jobs: Job[] = [];
    for (const plan of plans) {
      if (plan.upfront && !plan.upfront.expenseId && !plan.upfront.cancelled && plan.upfront.date <= today) {
        jobs.push({ planId: plan.id, key: "u", id: upfrontExpenseId(plan.id), label: "down payment", plan, amount: plan.upfront.amount, date: plan.upfront.date });
      }
      for (const item of plan.installments) {
        if (!item.expenseId && !item.cancelled && item.due <= today) {
          jobs.push({ planId: plan.id, key: item.n, id: installmentExpenseId(plan.id, item.n), label: `EMI ${item.n} of ${plan.installments.length}`, plan, amount: item.amount, date: item.due });
        }
      }
    }
    const created: Materialized[] = [];
    const done: Job[] = [];
    let failed = 0;
    for (const job of jobs) {
      try {
        const outcome = await createExpenseWithId(uid, job.id, {
          amount: job.amount, categoryId: job.plan.categoryId, note: `${job.plan.name} · ${job.label}`, timestamp: dueTimestamp(job.date),
        });
        done.push(job);
        if (outcome === "created") created.push({ planName: job.plan.name, label: job.label, amount: job.amount, date: job.date });
      } catch {
        failed += 1; // left alone: the next run tries again
      }
    }
    if (done.length) {
      await mutateJSON<EmiPlan[]>(KEY, (current) => current.map((plan) => {
        const mine = done.filter((job) => job.planId === plan.id);
        if (!mine.length) return plan;
        return {
          ...plan,
          upfront: plan.upfront && mine.some((job) => job.key === "u") ? { ...plan.upfront, expenseId: upfrontExpenseId(plan.id) } : plan.upfront,
          installments: plan.installments.map((item) => mine.some((job) => job.key === item.n) ? { ...item, expenseId: installmentExpenseId(plan.id, item.n) } : item),
        };
      }), []);
    }
    return { created, failed };
  })().finally(() => { running = null; });
  return running;
}

// ---- Managing a plan ---------------------------------------------------------------------------------------
/** Cancels every payment that is not due yet. Payments already added stay as they are. */
export async function stopEmi(planId: string, now = new Date()) {
  const today = todayString(now);
  await mutateJSON<EmiPlan[]>(KEY, (plans) => plans.map((plan) => plan.id !== planId ? plan : {
    ...plan,
    stopped: true,
    upfront: plan.upfront && !plan.upfront.expenseId && plan.upfront.date > today ? { ...plan.upfront, cancelled: true } : plan.upfront,
    installments: plan.installments.map((item) => !item.expenseId && item.due > today ? { ...item, cancelled: true } : item),
  }), []);
}

/** Deletes the plan. With `withTransactions`, the payments already added are deleted too (undo is not offered for this). */
export async function deleteEmi(planId: string, expenses: Expense[], withTransactions: boolean) {
  const plans = await listEmis();
  const plan = plans.find((item) => item.id === planId);
  if (!plan) return { deleted: 0 };
  let deleted = 0;
  if (withTransactions) {
    const existing = new Set(expenses.map((expense) => expense.$id));
    const ids = [plan.upfront?.expenseId, ...plan.installments.map((item) => item.expenseId)].filter((id): id is string => !!id && existing.has(id));
    if (ids.length) deleted = (await deleteTransactions(ids, expenses)).deleted.length;
  }
  await mutateJSON<EmiPlan[]>(KEY, (current) => current.filter((item) => item.id !== planId), []);
  return { deleted };
}

// ---- Read helpers ------------------------------------------------------------------------------------------
export function emiProgress(plan: EmiPlan) {
  const live = plan.installments.filter((item) => !item.cancelled);
  const paid = live.filter((item) => item.expenseId);
  const pending = live.filter((item) => !item.expenseId);
  const upfrontPending = plan.upfront && !plan.upfront.expenseId && !plan.upfront.cancelled ? plan.upfront.amount : 0;
  const sum = (items: EmiInstallment[]) => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100;
  return {
    paidCount: paid.length, totalCount: live.length, remainingCount: pending.length,
    remaining: Math.round((sum(pending) + upfrontPending) * 100) / 100,
    paidAmount: sum(paid) + (plan.upfront?.expenseId ? plan.upfront.amount : 0),
    next: pending[0] as EmiInstallment | undefined,
    finished: pending.length === 0 && !upfrontPending,
  };
}

/** What each EMI-created transaction is called, so lists can show "EMI 2 of 3". */
export function emiLabels(plans: EmiPlan[]) {
  const labels = new Map<string, string>();
  for (const plan of plans) {
    if (plan.upfront?.expenseId) labels.set(plan.upfront.expenseId, "EMI down payment");
    for (const item of plan.installments) if (item.expenseId) labels.set(item.expenseId, `EMI ${item.n} of ${plan.installments.length}`);
  }
  return labels;
}

/** Payments still to come later this month. They will leave the account, so the daily limit should expect them. */
export function emiDueLaterThisMonth(plans: EmiPlan[], now = new Date()) {
  const today = todayString(now);
  const monthPrefix = today.slice(0, 7);
  let total = 0, count = 0;
  for (const plan of plans) {
    const items = [
      ...(plan.upfront && !plan.upfront.expenseId && !plan.upfront.cancelled ? [{ due: plan.upfront.date, amount: plan.upfront.amount }] : []),
      ...plan.installments.filter((item) => !item.expenseId && !item.cancelled),
    ];
    for (const item of items) if (item.due > today && item.due.startsWith(monthPrefix)) { total += item.amount; count += 1; }
  }
  return { total: Math.round(total * 100) / 100, count };
}

export const plansUsingCategories = (plans: EmiPlan[], categoryIds: string[]) =>
  plans.filter((plan) => categoryIds.includes(plan.categoryId) && !emiProgress(plan).finished);
