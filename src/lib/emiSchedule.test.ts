import { describe, expect, it } from "vitest";
import { addMonthsClamped, buildEmiSchedule, validateEmiInput, type EmiInput } from "./emiSchedule";

const base: EmiInput = {
  mode: "emi", price: 0, emiAmount: 1000, months: 3, annualRate: 0, downPayment: 0, fee: 0,
  purchaseDate: "2026-11-14", firstDue: "2026-12-05",
};
const amounts = (input: Partial<EmiInput>) => buildEmiSchedule({ ...base, ...input }).installments.map((i) => i.amount);

describe("dates", () => {
  it("keeps the same day each month and clamps short months without drifting", () => {
    const dates = [0, 1, 2, 3, 4].map((k) => addMonthsClamped("2027-01-31", k));
    expect(dates).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  });
  it("handles leap years and year ends", () => {
    expect(addMonthsClamped("2028-01-30", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonthsClamped("2026-12-31", 14)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-11-15", 0)).toBe("2026-11-15");
  });
});

describe("the trimmer: known EMI", () => {
  it("₹1,000 for 3 months starting 5 December", () => {
    const schedule = buildEmiSchedule(base);
    expect(schedule.installments).toEqual([
      { n: 1, due: "2026-12-05", amount: 1000 }, { n: 2, due: "2027-01-05", amount: 1000 }, { n: 3, due: "2027-02-05", amount: 1000 },
    ]);
    expect(schedule.totalPayable).toBe(3000);
    expect(schedule.upfront).toBe(0);
    expect(schedule.interest).toBeNull();
  });
  it("a down payment and a fee are paid upfront and counted in the total", () => {
    const schedule = buildEmiSchedule({ ...base, downPayment: 500, fee: 99 });
    expect(schedule.upfront).toBe(599);
    expect(schedule.totalPayable).toBe(3599);
  });
});

describe("even and odd splits from a price (no-cost EMI)", () => {
  const price = (p: number, months: number, extra: Partial<EmiInput> = {}) => ({ mode: "price" as const, price: p, months, ...extra });
  it("splits evenly when it divides exactly", () => expect(amounts(price(3000, 3))).toEqual([1000, 1000, 1000]));
  it("an odd split puts the leftover paise on the last installment and always adds up", () => {
    expect(amounts(price(1000, 3))).toEqual([333.33, 333.33, 333.34]);
    expect(amounts(price(1000, 7))).toEqual([142.85, 142.85, 142.85, 142.85, 142.85, 142.85, 142.9]);
    for (const [total, months] of [[999.99, 7], [1, 3], [100000, 11], [12345.67, 12], [0.1, 3]] as const) {
      const schedule = buildEmiSchedule({ ...base, ...price(total, months) });
      expect(Math.round(schedule.installmentsTotal * 100)).toBe(Math.round(total * 100));
    }
  });
  it("a down payment reduces what is financed", () => {
    const schedule = buildEmiSchedule({ ...base, ...price(3000, 3, { downPayment: 600 }) });
    expect(schedule.installments.map((i) => i.amount)).toEqual([800, 800, 800]);
    expect(schedule.upfront).toBe(600);
    expect(schedule.totalPayable).toBe(3000);
    expect(schedule.interest).toBe(0);
  });
});

describe("with interest (reducing balance)", () => {
  it("₹1,00,000 at 12% for 12 months is about ₹8,884.88 a month", () => {
    const schedule = buildEmiSchedule({ ...base, mode: "price", price: 100000, months: 12, annualRate: 12 });
    expect(schedule.emi).toBeCloseTo(8884.88, 2);
    expect(new Set(schedule.installments.map((i) => i.amount)).size).toBe(1);
    expect(schedule.interest).toBeCloseTo(6618.56, 0);
  });
  it("a single month at 12% costs 1% interest", () => {
    expect(buildEmiSchedule({ ...base, mode: "price", price: 1000, months: 1, annualRate: 12 }).installments[0].amount).toBe(1010);
  });
});

describe("hand-edited (uneven) installments", () => {
  it("overrides replace single months and change the total", () => {
    const schedule = buildEmiSchedule({ ...base, overrides: { 0: 1500, 2: 500 } });
    expect(schedule.installments.map((i) => i.amount)).toEqual([1500, 1000, 500]);
    expect(schedule.totalPayable).toBe(3000);
  });
});

describe("validation", () => {
  const errors = (input: Partial<EmiInput>) => validateEmiInput({ ...base, ...input });
  it("accepts the normal case", () => expect(errors({})).toEqual({}));
  it("months must be a whole number from 1 to 60", () => {
    for (const months of [0, -1, 61, 2.5, NaN]) expect(errors({ months }).months).toBeTruthy();
    expect(errors({ months: 60 }).months).toBeUndefined();
    expect(errors({ months: 1 }).months).toBeUndefined();
  });
  it("needs an EMI amount, or a price in price mode", () => {
    expect(errors({ emiAmount: 0 }).emiAmount).toBeTruthy();
    expect(errors({ emiAmount: NaN }).emiAmount).toBeTruthy();
    expect(errors({ mode: "price", price: 0 }).price).toBeTruthy();
  });
  it("a down payment of the whole price or more is rejected", () => {
    expect(errors({ mode: "price", price: 3000, downPayment: 3000 }).downPayment).toBeTruthy();
    expect(errors({ mode: "price", price: 3000, downPayment: 3500 }).downPayment).toBeTruthy();
    expect(errors({ mode: "price", price: 3000, downPayment: 2999 }).downPayment).toBeUndefined();
  });
  it("rejects negative money and silly interest rates", () => {
    expect(errors({ downPayment: -1 }).downPayment).toBeTruthy();
    expect(errors({ fee: -5 }).fee).toBeTruthy();
    expect(errors({ mode: "price", price: 1000, annualRate: -1 }).annualRate).toBeTruthy();
    expect(errors({ mode: "price", price: 1000, annualRate: 101 }).annualRate).toBeTruthy();
  });
  it("dates must be real and the first EMI cannot precede the purchase", () => {
    expect(errors({ firstDue: "2026-13-01" }).firstDue).toBeTruthy();
    expect(errors({ firstDue: "2026-02-30" }).firstDue).toBeTruthy();
    expect(errors({ purchaseDate: "" }).purchaseDate).toBeTruthy();
    expect(errors({ purchaseDate: "2026-11-14", firstDue: "2026-11-13" }).firstDue).toBeTruthy();
    expect(errors({ purchaseDate: "2026-11-14", firstDue: "2026-11-14" }).firstDue).toBeUndefined();
  });
  it("hand-edited amounts must be positive", () => {
    expect(errors({ overrides: { 1: 0 } }).overrides).toBeTruthy();
    expect(errors({ overrides: { 1: -5 } }).overrides).toBeTruthy();
    expect(errors({ overrides: { 1: 10 } }).overrides).toBeUndefined();
  });
});
