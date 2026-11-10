// Set VITE_API_BASE in GitHub Actions / local .env to your deployed Worker URL.
export const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8787").replace(/\/$/, "");
export const CURRENCY = "INR";
export const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 }).format(Number(value || 0));
