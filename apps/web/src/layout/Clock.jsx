import { useEffect, useState } from "react";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** Live date and time in IST (the school's time), ticking every second. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time
      dateTime={now.toISOString()}
      className="text-right text-xs leading-tight sm:text-sm"
    >
      <span className="block font-medium text-ink">{timeFmt.format(now)}</span>
      <span className="block text-ink-muted">{dateFmt.format(now)}</span>
    </time>
  );
}
