import { describe, expect, it } from "vitest";

import {
  isValidEmail,
  pageRangeError,
  parsePageRange,
  passwordStrength,
  validatePassword,
  validateRegistration,
} from "@/lib/validate";

describe("email validation", () => {
  it("accepts normal addresses", () => {
    expect(isValidEmail("someone@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co.in")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("no-at-sign.com")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("password strength", () => {
  it("scores short passwords at zero", () => {
    expect(passwordStrength("abc").score).toBe(0);
  });

  it("scores a long mixed password at four", () => {
    const result = passwordStrength("Correct-Horse-42!");
    expect(result.score).toBe(4);
    expect(result.label).toBe("Strong");
  });

  it("enforces every rule", () => {
    expect(validatePassword("Sh0rt!")).toMatch(/8 characters/);
    expect(validatePassword("alllowercase1!")).toMatch(/uppercase/);
    expect(validatePassword("ALLUPPERCASE1!")).toMatch(/lowercase/);
    expect(validatePassword("NoNumbersHere!")).toMatch(/number/);
    expect(validatePassword("NoSymbolHere12")).toMatch(/symbol/);
    expect(validatePassword("GoodPassw0rd!")).toBeNull();
  });
});

describe("registration validation", () => {
  const valid = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "GoodPassw0rd!",
    confirmPassword: "GoodPassw0rd!",
    terms: true,
  };

  it("passes a correct payload", () => {
    expect(validateRegistration(valid)).toEqual({});
  });

  it("requires matching confirmations", () => {
    expect(validateRegistration({ ...valid, confirmPassword: "different" })).toHaveProperty("confirmPassword");
  });

  it("requires accepting terms", () => {
    expect(validateRegistration({ ...valid, terms: false })).toHaveProperty("terms");
  });

  it("rejects punctuation-only names", () => {
    expect(validateRegistration({ ...valid, name: "!!!" })).toHaveProperty("name");
  });
});

describe("page ranges", () => {
  it("accepts all, single pages and spans", () => {
    expect(pageRangeError("all")).toBeNull();
    expect(pageRangeError("1-10, 15")).toBeNull();
    expect(pageRangeError("3")).toBeNull();
  });

  it("rejects reversed and malformed ranges", () => {
    expect(pageRangeError("10-5")).not.toBeNull();
    expect(pageRangeError("banana")).not.toBeNull();
  });

  it("flags ranges beyond the document", () => {
    expect(pageRangeError("99", 10)).toMatch(/only has 10/);
  });

  it("parses ranges into pages", () => {
    expect(parsePageRange("1-3, 5", 10)).toEqual([1, 2, 3, 5]);
    expect(parsePageRange("8-20", 10)).toEqual([8, 9, 10]);
  });
});
