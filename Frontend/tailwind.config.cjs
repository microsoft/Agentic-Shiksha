/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  safelist: [
    // useful when these are applied conditionally
    "prose",
    "prose-invert",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1440px" },
    },
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        neutral: {
          750: '#333333', // Custom shade between 700 (#404040) and 800 (#262626)
          925: '#121212', // Custom shade between 900 (#171717) and 950 (#0a0a0a)
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },

      /* Streamlit-like readable markdown with good dark-mode contrast */
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            "--tw-prose-body": theme("colors.foreground"),
            "--tw-prose-headings": theme("colors.foreground"),
            "--tw-prose-links": theme("colors.primary.DEFAULT"),
            "--tw-prose-bold": theme("colors.foreground"),
            "--tw-prose-quotes": theme("colors.foreground"),
            "--tw-prose-hr": theme("colors.border"),
            "--tw-prose-code": theme("colors.foreground"),
            "--tw-prose-th-borders": theme("colors.border"),
            "--tw-prose-td-borders": theme("colors.border"),
            a: { textDecoration: "none", borderBottom: `1px dotted ${theme("colors.primary.DEFAULT")}` },
            "a:hover": { borderBottomStyle: "solid" },
            code: { backgroundColor: theme("colors.muted.DEFAULT"), padding: "0.15rem 0.35rem", borderRadius: "0.375rem" },
            "code::before": { content: "''" },
            "code::after": { content: "''" },
            pre: { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderRadius: "0.75rem" },
            blockquote: { borderLeftColor: theme("colors.border") },
          },
        },
        invert: {
          css: {
            "--tw-prose-body": theme("colors.muted.foreground"),
            "--tw-prose-headings": theme("colors.foreground"),
            "--tw-prose-links": theme("colors.primary.DEFAULT"),
            "--tw-prose-bold": theme("colors.foreground"),
            "--tw-prose-hr": theme("colors.border"),
            "--tw-prose-code": theme("colors.foreground"),
            "--tw-prose-th-borders": theme("colors.border"),
            "--tw-prose-td-borders": theme("colors.border"),
            pre: { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" },
          },
        },
      }),
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
  ],
};