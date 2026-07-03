import type { Config } from "tailwindcss";

/**
 * Operator-terminal dark design language, v2.
 * Semantic colour tokens — components reference role (surface, line, fg, muted…)
 * rather than raw palette values, so the whole app re-themes from here.
 *
 * Dual accent system:
 *   accent (violet) — performance, navigation, primary actions
 *   money  (teal)   — the value layer: rates, CPM, Value Score, spend
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#07080A", // page canvas
        surface: "#0F1116", // cards / panels
        "surface-2": "#161922", // raised / hover
        "surface-3": "#1D2230", // highest elevation (popovers)
        line: "#232833", // borders
        "line-soft": "#181C25", // hairlines
        fg: "#EDEFF3", // primary text
        muted: "#9AA1AD", // secondary text
        subtle: "#5F6673", // tertiary / captions
        accent: {
          DEFAULT: "#7C6DF7",
          400: "#9B8FFA",
          600: "#6C5DF0",
          700: "#5B49E0",
          soft: "rgba(124,109,247,0.14)",
        },
        money: {
          DEFAULT: "#2AC8B5",
          400: "#54DCCB",
          600: "#1FAE9D",
          soft: "rgba(42,200,181,0.13)",
        },
        pos: { DEFAULT: "#37C08A", soft: "rgba(55,192,138,0.14)" },
        neg: { DEFAULT: "#F0616D", soft: "rgba(240,97,109,0.14)" },
        warn: { DEFAULT: "#E7B23C", soft: "rgba(231,178,60,0.14)" },
        // brand kept + remapped to accent tones for any un-swept references
        brand: {
          50: "rgba(124,109,247,0.15)",
          100: "rgba(124,109,247,0.22)",
          500: "#7C6DF7",
          600: "#6C5DF0",
          700: "#5B49E0",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.4)",
        "panel-hover":
          "0 2px 6px rgba(0,0,0,0.45), 0 12px 32px -16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.03)",
        pop: "0 16px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
        "glow-accent": "0 0 0 1px rgba(124,109,247,0.35), 0 0 24px -6px rgba(124,109,247,0.5)",
        "glow-money": "0 0 0 1px rgba(42,200,181,0.3), 0 0 24px -6px rgba(42,200,181,0.45)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        shimmer: "shimmer 1.8s linear infinite",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
