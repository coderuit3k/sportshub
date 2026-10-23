import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: {
      primary: { DEFAULT: "#0F5132", dark: "#0B3D25", light: "#E6F4EC" },
      secondary: { DEFAULT: "#10B981", light: "#ECFDF5" },
      accent: { DEFAULT: "#F59E0B", light: "#FFFBEB" },
      ink: "#0F172A"
    },
    fontFamily: {
      sans: ["var(--font-jakarta)","system-ui","sans-serif"],
      label: ["var(--font-inter)","system-ui","sans-serif"]
    },
    borderRadius: { card: "1rem" }
  }},
  plugins: []
};
export default config;
