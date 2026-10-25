/**
 * Class list (Nursery to 12). Classes 11 and 12 will get streams (Arts, Commerce, Science) when
 * those students are added. `key` is what the database stores; `label` is what people read.
 */
export const CLASSES = [
  { key: "PG", label: "Play Group" },
  { key: "NURSERY", label: "Nursery" },
  { key: "LKG", label: "LKG" },
  { key: "UKG", label: "UKG" },
  ...Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return { key: String(n), label: `${n}${suffix}` };
  }),
];

export const CLASS_KEYS = CLASSES.map((c) => c.key);
export const STREAMS = ["ARTS", "COMMERCE", "SCIENCE"];
export const STREAM_CLASSES = ["11", "12"];

export function classLabel(key) {
  return CLASSES.find((c) => c.key === key)?.label ?? key;
}

/**
 * Turns whatever the Excel sheet says ("1st", "5TH", "Class 9", "play group", "Nur") into a class
 * key, or null when it is not recognised (the import then reports that row instead of guessing).
 */
export function normalizeClass(raw) {
  const text = String(raw ?? "")
    .toUpperCase()
    .replace(/CLASS|STD|STANDARD/g, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!text) return null;
  if (["PG", "PLAYGROUP", "PLAY"].includes(text)) return "PG";
  if (["NURSERY", "NUR"].includes(text)) return "NURSERY";
  if (text === "LKG") return "LKG";
  if (text === "UKG") return "UKG";
  const digits = /^(\d{1,2})(ST|ND|RD|TH)?$/.exec(text);
  if (digits) {
    const n = Number(digits[1]);
    if (n >= 1 && n <= 12) return String(n);
  }
  return null;
}
