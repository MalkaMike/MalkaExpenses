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

        // ── Surfaces. Values follow the Apple reference (DESIGN.md); the
        // ── Material-style names are kept so no screen has to be renamed.
        "surface":                   "#f5f5f7",
        "surface-dim":               "#e2e2e5",
        "surface-bright":            "#ffffff",
        "surface-container-lowest":  "#ffffff",
        "surface-container-low":     "#f4f8fb",
        "surface-container":         "#f5f5f7",
        "surface-container-high":    "#e2e2e5",
        "surface-container-highest": "#e2e2e5",
        "surface-variant":           "#e2e2e5",
        "surface-tint":              "#565e74",

        // On-surface
        "on-surface":           "#1d1d1f",
        "on-surface-variant":   "#707070",
        "outline":              "#858585",
        "outline-variant":      "#d2d2d7",
        "inverse-surface":      "#30312f",
        "inverse-on-surface":   "#f2f0ed",

        // Primary — the one chromatic action colour
        "primary":                  "#0071e3",
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
        "background":    "#f5f5f7",
        "on-background": "#1d1d1f",

        // ── Apple style reference (DESIGN.md) ──────────────────────────────
        // Same values as the semantic tokens above, addressable directly for
        // screens written against the reference rather than the legacy names.
        "apple-blue":   "#0071e3", // filled action buttons ONLY — never text
        "link-blue":    "#0066cc", // outlined action borders, inline links
        "signal-blue":  "#2997ff", // decorative borders and icon strokes
        "carbon":       "#1d1d1f", // primary ink
        "frost":        "#f5f5f7", // page canvas
        "ice":          "#f4f8fb", // elevated wash
        "smoke":        "#333333",
        "graphite":     "#474747",
        "ash":          "#707070", // muted body text
        "mist":         "#858585",
        "hairline":     "#d2d2d7", // the only border colour on light surfaces
        "pebble":       "#e2e2e5", // button fills, disabled surfaces
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

        // Apple scale (DESIGN.md). The negative tracking is what makes this
        // type read as precise rather than merely large — it is not optional.
        "ap-caption":     ["12px", { lineHeight: "1.33", letterSpacing: "-0.264px" }],
        "ap-body-sm":     ["14px", { lineHeight: "1.29", letterSpacing: "-0.224px" }],
        "ap-body":        ["17px", { lineHeight: "1.47", letterSpacing: "-0.272px" }],
        "ap-subheading":  ["21px", { lineHeight: "1.24", letterSpacing: "-0.105px" }],
        "ap-heading-sm":  ["28px", { lineHeight: "1.18", letterSpacing: "0.196px" }],
        "ap-heading":     ["40px", { lineHeight: "1.14", letterSpacing: "0.44px" }],
      },

      borderRadius: {
        sm:      "0.25rem",
        DEFAULT: "0.5rem",
        lg:      "0.5rem",   // matches Stitch: rounded-lg = 0.5rem
        xl:      "0.5rem",
        "2xl":   "0.5rem",
        "3xl":   "0.75rem",
        full:    "9999px",
        // Apple has exactly two radii: 8px for cards/images/inputs, and a full
        // capsule for every interactive pill. Nothing in between.
        "ap-card": "8px",
        "ap-pill": "980px",
      },

      boxShadow: {
        // Not elevation: Apple builds hierarchy from hairline borders and surface
        // shifts. These stayed as "shadow-*" names so existing screens inherit
        // the hairline without being rewritten.
        card:        "0 0 0 1px #d2d2d7",
        "card-hover":"0 0 0 1px #858585",
        modal:       "0 0 0 1px #d2d2d7",
        sm:          "0 0 0 1px #d2d2d7",
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
