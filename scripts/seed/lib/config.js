/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Seeder settings. Everything can be changed with environment variables, which are
 * read from .env.local (the same file the app uses), so no password is written here.
 *
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL   database connection
 *   SEED_SIZE        small (default, quick) | full (plan-sized: 9 stores, up to 1,500 products)
 *   SEED_RUN_TAG     namespace for slugs/emails (default demo-v1); destroy.js removes only this tag
 *   SEED_PASSWORD    password for every seeded login (default StockNBook@2026)
 *   SEED_TODAY       pretend "today" is this date, YYYY-MM-DD (default: today in Asia/Manila)
 *   SEED_HISTORY_MONTHS  months of POS/booking history before today (default 36 = 3 years)
 */
const path = require("path");
require("dotenv").config({ path: process.env.SEED_ENV_FILE || path.resolve(process.cwd(), ".env.local") });

function sanitizeRunTag(value) {
    const tag = String(value || "demo-v1").trim().toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    if (!tag) throw new Error("SEED_RUN_TAG must contain letters or numbers.");
    return tag;
}

function envInt(name, fallback, min, max) {
    const raw = process.env[name];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max)
        throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
    return value;
}

function manilaToday() {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date());
}

function manilaNowTime() {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false })
        .format(new Date());
}

// Plan-aligned sizes. Branch and staff counts follow the plan limits in the `plans` table.
const PRESETS = {
    small: {
        stores: ["scale", "growth", "starter"],
        branches: { starter: 1, growth: 3, scale: 5 },
        products: { starter: 50, growth: 120, scale: 200 },
        equipment: { starter: 8, growth: 14, scale: 24 },
        customers: { starter: 80, growth: 160, scale: 300 },
        packagesPerBranch: { starter: 4, growth: 4, scale: 5 },
        ordersPerBranchDay: { starter: 4, growth: 4, scale: 5 },
        bookingsPerMonth: { starter: 20, growth: 20, scale: 40 },
    },
    full: {
        stores: ["scale", "scale", "scale", "growth", "growth", "growth", "starter", "starter", "starter"],
        branches: { starter: 1, growth: 3, scale: 5 },
        products: { starter: 50, growth: 800, scale: 1500 },
        equipment: { starter: 10, growth: 30, scale: 60 },
        customers: { starter: 120, growth: 300, scale: 800 },
        packagesPerBranch: { starter: 5, growth: 5, scale: 6 },
        ordersPerBranchDay: { starter: 5, growth: 6, scale: 8 },
        bookingsPerMonth: { starter: 20, growth: 20, scale: 100 },
    },
};

const sizeName = String(process.env.SEED_SIZE || "small").trim().toLowerCase();
if (!PRESETS[sizeName]) throw new Error(`SEED_SIZE must be one of: ${Object.keys(PRESETS).join(", ")}.`);

const today = String(process.env.SEED_TODAY || manilaToday()).trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("SEED_TODAY must use YYYY-MM-DD.");

const runTag = sanitizeRunTag(process.env.SEED_RUN_TAG);

const CONFIG = {
    db: {
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD ?? process.env.DB_ROOT_PASSWORD ?? "",
        database: process.env.DB_NAME || "stocknbook_v2",
        ssl: String(process.env.DB_SSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : undefined,
    },
    runTag,
    emailDomain: `${runTag}.seed.stocknbook.test`,
    slugPrefix: `${runTag}-`,
    sizeName,
    size: PRESETS[sizeName],
    password: process.env.SEED_PASSWORD || "StockNBook@2026",
    today,
    // Only used to keep today's seeded sales/bookings before the current clock time.
    nowTime: process.env.SEED_TODAY ? "20:00" : manilaNowTime(),
    historyMonths: envInt("SEED_HISTORY_MONTHS", 36, 3, 36),
    futureMonths: envInt("SEED_FUTURE_MONTHS", 3, 0, 12),
    // New bookings left free this month so testers can still create bookings under the plan limit.
    bookingHeadroom: envInt("SEED_BOOKING_HEADROOM", 6, 0, 20),
};

module.exports = { CONFIG, PRESETS, sanitizeRunTag };
