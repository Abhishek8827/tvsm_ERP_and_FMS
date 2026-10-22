const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/**
 * Prints a piece of HTML in a hidden, empty page of its own.
 * WHY not window.print() on the app: it prints the whole app (menu, clock, tables) with parts
 * hidden by CSS, which is slow, can spill onto extra pages and re-renders while the print window
 * is open. A clean page holds only the receipt, so the print window opens at once and the layout
 * is exactly what the CSS says. Resolves once the print window has been opened.
 */
export function printHtml({ html, css, title = 'Print' }) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
    });
    const remove = () => frame.remove();
    // <base> lets "/logo.jpg" resolve to this site inside the empty page.
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base href="${escapeHtml(
      `${window.location.origin}/`,
    )}"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${html}</body></html>`;
    frame.onload = async () => {
      try {
        const doc = frame.contentDocument;
        // Wait for the logo, otherwise it can print as an empty box.
        await Promise.all(
          [...doc.images].map((img) =>
            img.complete
              ? null
              : new Promise((done) => {
                  img.onload = done;
                  img.onerror = done;
                }),
          ),
        );
        frame.contentWindow.addEventListener('afterprint', () => setTimeout(remove, 500), {
          once: true,
        });
        frame.contentWindow.focus();
        frame.contentWindow.print();
        // Safety net: some browsers never fire afterprint.
        setTimeout(remove, 120_000);
        resolve();
      } catch (err) {
        remove();
        reject(err);
      }
    };
    document.body.appendChild(frame);
  });
}
