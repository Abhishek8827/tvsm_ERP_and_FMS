/**
 * Why a rebate is given (the school's own words) and which fee it lowers.
 * adjustOn: 'last' = the final month of the year, 'all' = every month of the year (whole-year
 * concessions), 'oldest' = the oldest unpaid fee first, null = the Admin picks (category "other").
 * needs: extra detail the Admin must give for that category.
 */
export const REBATE_CATEGORIES = {
  bc: { label: "BC (sibling)", adjustOn: "last", needs: "sibling" },
  otp: { label: "OTP (one time payment)", adjustOn: "last", needs: "receipt" },
  rte: { label: "RTE", adjustOn: "all", needs: null },
  management: { label: "By Management", adjustOn: "all", needs: null },
  scholarship: { label: "Scholarship", adjustOn: "all", needs: null },
  other: { label: "Other", adjustOn: null, needs: null },
};
export const REBATE_CATEGORY_KEYS = Object.keys(REBATE_CATEGORIES);
export const REBATE_ADJUST_KEYS = ["oldest", "last", "all"];
