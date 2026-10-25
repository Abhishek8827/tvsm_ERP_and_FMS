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
      borderRadius: { card: "10px" },
    },
  },
  plugins: [],
};
