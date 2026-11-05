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
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** Live date and time in IST (the school's time): "Tue, 03 Nov 2026 | 05:12 PM". */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  // en-IN writes "Tue, 3 Nov 2026"-style text with a comma after the weekday; keep it as is.
  return (
    <time
      dateTime={now.toISOString()}
      className="whitespace-nowrap text-xs text-ink-muted lg:text-sm"
    >
      {dateFmt.format(now)} <span className="text-line">|</span>{" "}
      <span className="font-medium text-ink">
        {timeFmt.format(now).toUpperCase()}
      </span>
    </time>
  );
}
