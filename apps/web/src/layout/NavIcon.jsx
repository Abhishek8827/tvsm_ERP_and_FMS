/**
 * Small line icons for the sidebar (shown alone when the sidebar is narrow). Drawn inline so
 * there is no extra download. An unknown key shows a plain dot, never nothing.
 */
const P = {
  dashboard: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  'collect-fee': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 8h6M9 11h6M10 8c3 0 3 5 0 5l4 3" />
    </>
  ),
  receipts: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  'fees-receipts': <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  approvals: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  students: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-4 3-6 7-6s7 2 7 6" />
    </>
  ),
  'fee-structure': <path d="M4 6h16M4 12h16M4 18h16M9 4v16" />,
  'fees-database': (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
  rebates: (
    <>
      <path d="M18 6 6 18" />
      <circle cx="7.5" cy="7.5" r="2" />
      <circle cx="16.5" cy="16.5" r="2" />
    </>
  ),
  transport: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M4 11h16M7 19v-3M17 19v-3" />
      <circle cx="8" cy="13.5" r=".6" />
      <circle cx="16" cy="13.5" r=".6" />
    </>
  ),
  cashbook: (
    <>
      <path d="M6 4h11a1 1 0 0 1 1 1v15H7a1 1 0 0 1-1-1V4Z" />
      <path d="M9 9h6M9 13h6" />
    </>
  ),
  expenses: <path d="M7 17 17 7M9 7h8v8" />,
  'petty-cash': (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'day-close': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  'bank-cash': <path d="m3 9 9-5 9 5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18" />,
  reports: <path d="M5 20V10M12 20V4M19 20v-7" />,
  'tc-bonafide': (
    <>
      <path d="M5 4h14v12H5z" />
      <path d="m9 16-1 4 4-2 4 2-1-4M8 8h8M8 11h5" />
    </>
  ),
  'data-import': <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
  'users-settings': <path d="M5 7h14M5 12h14M5 17h14M9 5v4M15 10v4M8 15v4" />,
  'audit-log': <path d="M7 4h10v16H7zM10 8h4M10 12h4M10 16h2" />,
};

export function NavIcon({ name }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {P[name] ?? <circle cx="12" cy="12" r="2" />}
    </svg>
  );
}
