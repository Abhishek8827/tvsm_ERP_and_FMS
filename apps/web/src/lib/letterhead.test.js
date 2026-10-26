import { describe, expect, it } from "vitest";
import { CERT_CSS, bonafideHtml } from "./certificateHtml";
import { cashbookHtml } from "./cashbookHtml";
import { LETTERHEAD_CSS, letterheadHtml } from "./letterhead";
import { reportHtml } from "./reportsHtml";

describe("letterhead", () => {
  const html = letterheadHtml();
  it("has every line of the school letterhead, with district Burhanpur", () => {
    for (const t of [
      "THAKUR VIRENDRA SINGH MEMORIAL SCHOOL",
      "MANAGED BY TH. VIRENDRA SINGH MEMORIAL EDUCATION SOCIETY",
      "Reg. N0. 03/04/02/22332/20",
      "RAILWAY STATION ROAD, NEPANAGAR, DIST. BURHANPUR (M.P.)",
      "DISE CODE - 23480513302",
      "E-mail ID - tvsmnepa@gmail.com",
      "M.No. - 9575926900/ 9644995511",
    ])
      expect(html).toContain(t);
    expect(html).toContain('<img src="/logo.jpg"');
  });
  it("small version is marked for the half-A4 receipt", () => {
    expect(letterheadHtml({ small: true })).toContain('class="lh sm"');
  });
  it("reports and the cashbook print with it, and the certificate CSS carries its styles", () => {
    expect(reportHtml({ title: "T", subtitle: "s", sections: [] })).toContain(
      'class="lh"',
    );
    expect(CERT_CSS).toContain(LETTERHEAD_CSS.trim().slice(0, 20));
    expect(typeof bonafideHtml).toBe("function");
    expect(typeof cashbookHtml).toBe("function");
  });
});
