/**
 * Tailwind is mapped to the Figma design tokens (styles/tokens.css). Pages never use raw
 * colours or one-off spacing - only these semantic names ("no one-off styling").
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: v("bg-app"),
        surface: v("bg-surface"),
        sidebar: v("bg-sidebar"),
        brand: { DEFAULT: v("brand"), dark: v("brand-dark") },
        success: v("success"),
        warning: v("warning"),
        danger: v("danger"),
        info: v("info"),
        ink: { DEFAULT: v("text"), muted: v("text-muted") },
        line: v("border"),
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      borderRadius: { card: "14px" },
      // One shadow scale for the whole app (soft, layered, blue-tinted): pages never invent their own.
      boxShadow: {
        card: "0 1px 2px rgb(31 58 138 / 0.06), 0 8px 24px -8px rgb(31 58 138 / 0.14)",
        lift: "0 2px 4px rgb(31 58 138 / 0.08), 0 16px 32px -10px rgb(31 58 138 / 0.26)",
        glow: "0 6px 18px -4px rgb(36 87 197 / 0.55)",
        bar: "0 10px 30px -12px rgb(15 30 80 / 0.7)",
      },
    },
  },
  plugins: [],
};
