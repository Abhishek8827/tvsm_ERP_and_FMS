/** Hands a downloaded file (a Blob) to the browser's Save dialog / Downloads folder. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const pad = (n) => String(n).padStart(2, "0");
/** 2026-11-01-1530 in school time (IST), safe to use in a file name. */
export function istStamp(date = new Date()) {
  const t = new Date(date.getTime() + 330 * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
}
