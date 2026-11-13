import { describe, expect, it } from "vitest";
import { evaluateAmount, localDate, money, round2, suggestedDailyLimit } from "./utils";

describe("evaluateAmount", () => {
  it.each([
    ["250", 250], ["250.50", 250.5], ["1,200", 1200], ["250+120", 370], ["250 + 120 - 20", 350], ["3*80", 240], ["3x80", 240],
    ["900/3", 300], ["100+50*2", 200], ["10/4", 2.5], ["100/3", 33.33], [".5", 0.5],
  ])("reads %s as %s", (text, value) => expect(evaluateAmount(text)).toBe(value));

  it.each(["", "abc", "12abc", "+5", "5+", "5++5", "5/0", "2**3", "(2+3)", "1e3", "5 5", "alert(1)", "--5"])("rejects %j", (text) => {
    expect(evaluateAmount(text)).toBeNull();
  });

  it("never evaluates code", () => {
    expect(evaluateAmount("process.exit()")).toBeNull();
    expect(evaluateAmount("1;2")).toBeNull();
  });
});

describe("money", () => {
  it("shows whole rupees without decimals and keeps the paise otherwise", () => {
    expect(money(3406)).toBe("₹3,406");
    expect(money(33.33)).toBe("₹33.33");
    expect(money(1234567)).toBe("₹12,34,567");
    expect(money(0.1 + 0.2)).toBe("₹0.3");
  });
  it("rounds to the paisa", () => expect(round2(100 / 3)).toBe(33.33));
});

describe("localDate", () => {
  it("uses the user's own timezone, not UTC", () => {
    // 00:30 on 1 December in India is still 30 November in UTC
    const late = new Date(2026, 11, 1, 0, 30).toISOString();
    expect(localDate(late)).toBe("2026-12-01");
  });
});

describe("suggestedDailyLimit", () => {
  const nov13 = new Date(2026, 10, 13); // 18 days left including today

  it("uses the money left in the account when that is lower than the budget room (the real case)", () => {
    const result = suggestedDailyLimit({ budgetLeft: 58000 - 37387.9, accountLeft: 58000 - 45430 }, nov13)!;
    expect(result.limitedBy).toBe("account");
    expect(result.days).toBe(18);
    expect(result.perDay).toBeCloseTo(12570 / 18, 5);   // about ₹698, not ₹1,145
  });

  it("uses the budget when that is the tighter limit", () => {
    const result = suggestedDailyLimit({ budgetLeft: 3600, accountLeft: 50000 }, nov13)!;
    expect(result.limitedBy).toBe("budget");
    expect(result.perDay).toBe(200);
  });

  it("works with only a budget, only a salary, or neither", () => {
    expect(suggestedDailyLimit({ budgetLeft: 1800, accountLeft: null }, nov13)).toMatchObject({ perDay: 100, limitedBy: "budget" });
    expect(suggestedDailyLimit({ budgetLeft: null, accountLeft: 1800 }, nov13)).toMatchObject({ perDay: 100, limitedBy: "account" });
    expect(suggestedDailyLimit({ budgetLeft: null, accountLeft: null }, nov13)).toBeNull();
  });

  it("never goes negative when you are over budget or overdrawn", () => {
    expect(suggestedDailyLimit({ budgetLeft: -500, accountLeft: 9000 }, nov13)!.perDay).toBe(0);
    expect(suggestedDailyLimit({ budgetLeft: 9000, accountLeft: -1 }, nov13)!.perDay).toBe(0);
  });

  it("on the last day of the month the whole remainder is available today", () => {
    expect(suggestedDailyLimit({ budgetLeft: 900, accountLeft: 2000 }, new Date(2026, 10, 30))!.perDay).toBe(900);
  });
});
