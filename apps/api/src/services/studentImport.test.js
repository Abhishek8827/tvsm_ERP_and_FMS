import { describe, expect, it } from "vitest";
import { missingFieldsPatch } from "./studentImport.js";

describe("missingFieldsPatch", () => {
  it("fills only empty fields and never replaces a saved value", () => {
    const patch = missingFieldsPatch(
      { fatherName: "Rajesh", contactNo: "", section: undefined, pen: null },
      {
        fatherName: "Other",
        contactNo: "9876543210",
        section: "a",
        pen: "P1",
        motherName: "",
      },
    );
    expect(patch).toEqual({ contactNo: "9876543210", section: "A", pen: "P1" });
  });
  it("gives an empty patch when nothing is missing", () => {
    expect(
      missingFieldsPatch({ fatherName: "R" }, { fatherName: "S" }),
    ).toEqual({});
  });
});
