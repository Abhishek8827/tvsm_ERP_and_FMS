/** Small line icons used by the dashboard and Collect Fee cards. Drawn inline: no icon package. */
const paths = {
  cash: "M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4M18 10v4",
  bank: "M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  coins:
    "M5 6c0-1.4 3.1-2.5 7-2.5S19 4.6 19 6s-3.1 2.5-7 2.5S5 7.4 5 6zM5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6",
  users:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.5a3.2 3.2 0 0 1 0 6.2M18 14.8c2 .7 3.5 2.3 3.5 5.2",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 14l2 2 3.5-4",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  wallet:
    "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l11-3v3M16 14h2",
  refresh: "M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4",
  chevron: "M9 6l6 6-6 6",
  cap: "M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5M22 9v6",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  bus: "M5 4h14a1 1 0 0 1 1 1v12H4V5a1 1 0 0 1 1-1zM4 11h16M7 20v-3M17 20v-3M8 14h.01M16 14h.01",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2",
  stack:
    "M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zM4 6v12c0 1.1 3.6 2 8 2s8-.9 8-2V6M4 12c0 1.1 3.6 2 8 2s8-.9 8-2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.5 3.6-6 8-6s8 2.5 8 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
};

export function Icon({ name, size = 22, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Icon in a soft tinted square (blue by default; purple / green / amber / red / teal / indigo allowed). */
const TINT = {
  blue: "bg-blue-200 text-blue-700",
  purple: "bg-purple-200 text-purple-700",
  green: "bg-green-200 text-green-700",
  amber: "bg-amber-200 text-amber-700",
  red: "bg-red-200 text-red-700",
  teal: "bg-teal-200 text-teal-700",
  indigo: "bg-indigo-200 text-indigo-700",
};
export function IconTile({
  name,
  tone = "blue",
  size = 22,
  box = "h-11 w-11",
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-xl ${box} ${TINT[tone]}`}
    >
      <Icon name={name} size={size} />
    </span>
  );
}
