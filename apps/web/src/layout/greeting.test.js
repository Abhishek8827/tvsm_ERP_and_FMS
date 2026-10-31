import { describe, expect, it } from "vitest";
import { firstName, greetingFor } from "./greeting";

// IST = UTC + 5:30
const ist = (h, m = 0) => new Date(Date.UTC(2026, 9, 30, h - 5, m - 30));
describe("greeting", () => {
  it("follows the hour in IST, not the computer time zone", () => {
    expect(greetingFor(ist(6))).toBe("Good morning");
    expect(greetingFor(ist(11, 59))).toBe("Good morning");
    expect(greetingFor(ist(12))).toBe("Good afternoon");
    expect(greetingFor(ist(16, 59))).toBe("Good afternoon");
    expect(greetingFor(ist(17))).toBe("Good evening");
    expect(greetingFor(ist(23))).toBe("Good evening");
    expect(greetingFor(ist(0, 30))).toBe("Good morning");
  });
  it("first name only", () => {
    expect(firstName("Abhishek Wani")).toBe("Abhishek");
    expect(firstName("  ")).toBe("");
    expect(firstName(undefined)).toBe("");
  });
});
