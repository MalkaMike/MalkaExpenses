import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ── Existing semantic tokens (used throughout the app via bg-bg / text-fg etc) ──
      colors: {
        bg:      "rgb(var(--bg) / <alpha-value>)",
        fg:      "rgb(var(--fg) / <alpha-value>)",
        muted:   "rgb(var(--muted) / <alpha-value>)",
        card:    "rgb(var(--card) / <alpha-value>)",
        border:  "rgb(var(--border) / <alpha-value>)",
        accent:  "rgb(var(--accent) / <alpha-value>)",
        danger:  "rgb(var(--danger) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        info:    "rgb(var(--info) / <alpha-value>)",
        purple:  "rgb(var(--purple) / <alpha-value>)",

        // ── Stitch "Serene Financial" design tokens ─────────────────────────────────
        // Surface scale (warm off-white)
        "surface":                    "#faf9f7",
        "surface-dim":                "#dadad8",
        "surface-bright":             "#faf9f7",
        "surface-container-lowest":   "#ffffff",
        "surface-container-low":      "#f4f3f1",
        "surface-container":          "#efeeec",
        "surface-container-high":     "#e9e8e6",
        "surface-container-highest":  "#e3e2e0",

        // On-surface
        "on-surface":         "#1a1c1b",
        "on-surface-variant": "#45474b",
        "outline":            "#75777c",
        "outline-variant":    "#c5c6cb",

        // Primary (deep navy)
        "primary":            "#181d25",
        "on-primary":         "#ffffff",
        "primary-container":  "#2d323a",
        "on-primary-container":"#959aa4",
        "primary-fixed":      "#dee2ed",
        "primary-fixed-dim":  "#c2c6d1",

        // Secondary (pastel emerald — income)
        "secondary":              "#486551",
        "on-secondary":           "#ffffff",
        "secondary-container":    "#c7e8cf",
        "on-secondary-container": "#4c6956",
        "secondary-fixed":        "#caead2",
        "secondary-fixed-dim":    "#aeceb7",

        // Tertiary (pastel coral/peach — warm accent)
        "tertiary":             "#311506",
        "on-tertiary":          "#ffffff",
        "tertiary-container":   "#4a2919",
        "on-tertiary-container":"#bf8f79",
        "tertiary-fixed":       "#ffdbcc",
        "tertiary-fixed-dim":   "#f0bba3",

        // Error
        "error":             "#ba1a1a",
        "on-error":          "#ffffff",
        "error-container":   "#ffdad6",
        "on-error-container":"#93000a",
      },

      fontFamily: {
        sans:    ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-manrope)", "ui-sans-serif", "sans-serif"],
        mono:    ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },

      fontSize: {
        // Display
        "display-lg": ["3rem",   { lineHeight: "3.5rem",   letterSpacing: "-0.02em", fontWeight: "700" }],
        // Headlines
        "headline-lg": ["2rem",  { lineHeight: "2.5rem",   letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-md": ["1.5rem",{ lineHeight: "2rem",     letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-sm": ["1.25rem",{ lineHeight: "1.75rem", fontWeight: "600" }],
        // Label (mono)
        "label-md": ["0.875rem", { lineHeight: "1.25rem",  letterSpacing: "0.02em",  fontWeight: "500" }],
        "label-sm": ["0.75rem",  { lineHeight: "1rem",     letterSpacing: "0.05em",  fontWeight: "500" }],
      },

      borderRadius: {
        sm:   "0.25rem",
        DEFAULT: "0.5rem",
        md:   "0.75rem",
        lg:   "1rem",
        xl:   "1.5rem",
        "2xl":"1.5rem",
      },

      boxShadow: {
        // Tonal depth instead of heavy shadows
        card: "0 0 0 1px rgba(0,0,0,0.04)",
        "card-hover": "0 4px 20px rgba(24,29,37,0.08)",
        "modal": "0 8px 32px rgba(24,29,37,0.12)",
      }
    }
  },
  plugins: []
};

export default config;
