/* eslint-disable @typescript-eslint/no-require-imports */
/** Platform-level rows shared by every store: plans and the platform admin login. */
const { CONFIG } = require("../lib/config");
const V = require("../lib/vocab");

// Same values as the team's stocknbook_v2 `plans` table (0 = unlimited).
const PLANS = [
    { plan_code: "starter", plan_name: "Starter", price: 0, max_branches: 1, max_staff: 1, max_inventory: 50, max_bookings: 20,
        has_low_stock_alerts: 0, has_analytics: 0, has_forecasting: 0, has_multi_store: 0 },
    { plan_code: "growth", plan_name: "Growth", price: 500, max_branches: 3, max_staff: 3, max_inventory: 800, max_bookings: 20,
        has_low_stock_alerts: 0, has_analytics: 0, has_forecasting: 0, has_multi_store: 1 },
    { plan_code: "scale", plan_name: "Scale", price: 1299, max_branches: 0, max_staff: 0, max_inventory: 0, max_bookings: 0,
        has_low_stock_alerts: 1, has_analytics: 1, has_forecasting: 1, has_multi_store: 1 },
];

/** Adds any missing plan. Existing plans are left exactly as the team configured them. */
async function seedPlans(db) {
    for (const plan of PLANS) {
        const cols = Object.keys(plan);
        await db.query(
            `INSERT INTO plans (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
             ON DUPLICATE KEY UPDATE id = id`, cols.map((c) => plan[c]));
    }
    const [rows] = await db.query(`SELECT * FROM plans WHERE is_archived = 0`);
    const byCode = {};
    for (const row of rows) byCode[String(row.plan_code).toLowerCase()] = row;
    for (const plan of PLANS)
        if (!byCode[plan.plan_code]) throw new Error(`Plan "${plan.plan_code}" is archived or missing.`);
    return byCode;
}

/** One platform admin for the Admin pages. Re-running only refreshes its password. */
async function seedPlatformAdmin(db, passwordHash) {
    const email = `admin@${CONFIG.emailDomain}`;
    await db.query(
        `INSERT INTO platform_admins (full_name, email, password_hash, role, status)
         VALUES (?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), status = 'active'`,
        ["Seed Platform Admin", email, passwordHash, V.PLATFORM_ADMIN_ROLE]);
    const [rows] = await db.query(`SELECT id FROM platform_admins WHERE email = ?`, [email]);
    return { id: Number(rows[0].id), email };
}

module.exports = { seedPlans, seedPlatformAdmin, PLANS };
