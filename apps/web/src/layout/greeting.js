/** "Good morning" / "Good afternoon" / "Good evening" by the hour in IST (the school's time). */
export function greetingFor(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    })
      .format(date)
      .slice(0, 2),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** First word of the name: "Abhishek Wani" -> "Abhishek". */
export const firstName = (name) =>
  String(name ?? "")
    .trim()
    .split(/\s+/)[0] || "";
