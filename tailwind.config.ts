import type { Config } from "tailwindcss";

/**
 * Operator-terminal dark design language.
 * Semantic colour tokens — components reference role (surface, line, fg, muted…)
 * rather than raw palette values, so the whole app re-themes from here.
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
        bg: "#0A0B0D", // page canvas
        surface: "#111318", // cards / panels
        "surface-2": "#171A21", // raised / hover
        line: "#23272F", // borders
        "line-soft": "#1A1D24", // hairlines
        fg: "#EAECEF", // primary text
        muted: "#99A0AA", // secondary text
        subtle: "#616772", // tertiary / captions
        accent: {
          DEFAULT: "#7C6DF7",
          400: "#9B8FFA",
          600: "#6C5DF0",
          700: "#5B49E0",
          soft: "rgba(124,109,247,0.15)",
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
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.4)",
        pop: "0 16px 48px rgba(0,0,0,0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
