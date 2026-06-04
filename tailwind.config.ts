import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ── Semantic aliases (used throughout app as bg-bg / text-fg etc) ──
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

        // ── Stitch "Malka Casa" — exact palette from project 6041564693018001250 ──
        // Surfaces (warm paper white)
        "surface":                   "#fbf9f6",
        "surface-dim":               "#dbdad7",
        "surface-bright":            "#fbf9f6",
        "surface-container-lowest":  "#ffffff",
        "surface-container-low":     "#f5f3f0",
        "surface-container":         "#efeeeb",
        "surface-container-high":    "#eae8e5",
        "surface-container-highest": "#e4e2df",
        "surface-variant":           "#e4e2df",
        "surface-tint":              "#565e74",

        // On-surface
        "on-surface":           "#1b1c1a",
        "on-surface-variant":   "#45464d",
        "outline":              "#76777d",
        "outline-variant":      "#c6c6cd",
        "inverse-surface":      "#30312f",
        "inverse-on-surface":   "#f2f0ed",

        // Primary (authoritative black)
        "primary":                  "#000000",
        "on-primary":               "#ffffff",
        "primary-container":        "#131b2e",
        "on-primary-container":     "#7c839b",
        "primary-fixed":            "#dae2fd",
        "primary-fixed-dim":        "#bec6e0",
        "on-primary-fixed":         "#131b2e",
        "on-primary-fixed-variant": "#3f465c",
        "inverse-primary":          "#bec6e0",

        // Secondary (emerald — income / positive)
        "secondary":                  "#006c49",
        "on-secondary":               "#ffffff",
        "secondary-container":        "#6cf8bb",
        "on-secondary-container":     "#00714d",
        "secondary-fixed":            "#6ffbbe",
        "secondary-fixed-dim":        "#4edea3",
        "on-secondary-fixed":         "#002113",
        "on-secondary-fixed-variant": "#005236",

        // Tertiary (coral — expenses / negative)
        "tertiary":                    "#000000",
        "on-tertiary":                 "#ffffff",
        "tertiary-container":          "#410004",
        "on-tertiary-container":       "#ef4444",
        "tertiary-fixed":              "#ffdad7",
        "tertiary-fixed-dim":          "#ffb3ad",
        "on-tertiary-fixed":           "#410004",
        "on-tertiary-fixed-variant":   "#930013",

        // Error
        "error":              "#ba1a1a",
        "on-error":           "#ffffff",
        "error-container":    "#ffdad6",
        "on-error-container": "#93000a",

        // Background alias
        "background":    "#fbf9f6",
        "on-background": "#1b1c1a",
      },

      fontFamily: {
        sans:    ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-manrope)", "ui-sans-serif", "sans-serif"],
        mono:    ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },

      fontSize: {
        // Stitch type scale
        "display-lg":        ["3rem",    { lineHeight: "3.5rem",   letterSpacing: "-0.02em", fontWeight: "600" }],
        "headline-lg":       ["2rem",    { lineHeight: "2.5rem",   letterSpacing: "-0.02em", fontWeight: "600" }],
        "headline-lg-mobile":["1.75rem", { lineHeight: "2.25rem",  fontWeight: "600" }],
        "headline-md":       ["1.5rem",  { lineHeight: "2rem",     letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-sm":       ["1.25rem", { lineHeight: "1.75rem",  fontWeight: "600" }],
        "body-lg":           ["1.125rem",{ lineHeight: "1.75rem",  fontWeight: "400" }],
        "body-md":           ["1rem",    { lineHeight: "1.5rem",   fontWeight: "400" }],
        "body-sm":           ["0.875rem",{ lineHeight: "1.25rem",  fontWeight: "400" }],
        "label-md":          ["0.75rem", { lineHeight: "1rem",     letterSpacing: "0.02em",  fontWeight: "500" }],
        "currency-lg":       ["2rem",    { lineHeight: "2.5rem",   fontWeight: "700" }],
        "currency-md":       ["1rem",    { lineHeight: "1.5rem",   fontWeight: "600" }],
      },

      borderRadius: {
        sm:      "0.25rem",
        DEFAULT: "0.5rem",
        lg:      "0.5rem",   // matches Stitch: rounded-lg = 0.5rem
        xl:      "0.75rem",
        "2xl":   "1rem",
        "3xl":   "1.5rem",
        full:    "9999px",
      },

      boxShadow: {
        // Stitch "soft ambient" depth
        card:        "0px 4px 20px rgba(0,0,0,0.05)",
        "card-hover":"0px 8px 32px rgba(0,0,0,0.08)",
        modal:       "0px 8px 32px rgba(0,0,0,0.12)",
        sm:          "0 0 0 1px rgba(0,0,0,0.04)",
      },

      spacing: {
        "stack-sm":       "8px",
        "stack-md":       "16px",
        "stack-lg":       "24px",
        "gutter":         "24px",
        "margin-mobile":  "16px",
        "margin-desktop": "40px",
        "container-max":  "1280px",
      },
    }
  },
  plugins: []
};

export default config;
