const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export const REPORT_CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font: 12px/1.4 Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 17px; margin: 0 0 2px; } .sub { color: #555; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; vertical-align: top; }
th { background: #eee; } .r { text-align: right; } tfoot td, .strong td { font-weight: bold; }
.note { color: #444; font-size: 11px; margin-top: 8px; } tr { break-inside: avoid; }
`;

/**
 * One printable report page. `sections` = [{ title?, head: [{label, right}], rows: [[cell...]],
 * foot?: [cell...] }]. Every cell is escaped here, so no value can inject markup.
 */
export function reportHtml({ title, subtitle, sections, notes = [] }) {
  const part = (s) => {
    const th = s.head
      .map((h) => `<th${h.right ? ' class="r"' : ""}>${esc(h.label)}</th>`)
      .join("");
    const tr = (cells) =>
      `<tr>${cells.map((c, i) => `<td${s.head[i]?.right ? ' class="r"' : ""}>${esc(c)}</td>`).join("")}</tr>`;
    const body = s.rows.length
      ? s.rows.map(tr).join("")
      : `<tr><td colspan="${s.head.length}">Nothing to show</td></tr>`;
    return `${s.title ? `<h2>${esc(s.title)}</h2>` : ""}<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${s.foot ? `<tfoot>${tr(s.foot)}</tfoot>` : ""}</table>`;
  };
  return `<h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>${sections.map(part).join("")}${notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}`;
}
