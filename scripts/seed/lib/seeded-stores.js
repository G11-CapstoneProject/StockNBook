/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Removes ONLY the stores created by run.js for one seed tag (slug starts with "<SEED_RUN_TAG>-"),
 * with all their rows, plus the seed platform admin. Real stores are never matched.
 * Used by destroy.js, and by run.js to replace an older demo set.
 */
const { CONFIG } = require("./config");

// Child tables first, so foreign keys stay ON the whole time.
const BY_STORE = ["store_events", "refunds", "stock_issues", "inventory_movements", "payments", "order_items", "orders", "employee_actions",
    "booking_items", "bookings", "package_items", "packages", "customers", "branch_inventory", "product_variants", "products",
    "equipment", "categories", "subscription_payments", "otp_codes"];

async function removeSeededStores(db, log = console.log) {
    const [stores] = await db.query(`SELECT id, store_name FROM stores WHERE slug LIKE ? ORDER BY id`, [`${CONFIG.slugPrefix}%`]);
    for (const store of stores) {
        await db.beginTransaction();
        try {
            const id = store.id;
            await db.query(`DELETE FROM booking_items WHERE store_id = ? AND parent_item_id IS NOT NULL`, [id]);
            for (const table of BY_STORE) {
                try {
                    await db.query(`DELETE FROM \`${table}\` WHERE store_id = ?`, [id]);
                } catch (error) {
                    // A table added by a later migration (for example store_events) may not exist yet: nothing to delete there.
                    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
                }
            }
            await db.query(`DELETE n FROM subscription_expiry_notices n JOIN subscriptions s ON s.id = n.subscription_id WHERE s.store_id = ?`, [id]);
            await db.query(`DELETE FROM subscriptions WHERE store_id = ?`, [id]);
            await db.query(`UPDATE users SET manager_id = NULL, invited_by = NULL WHERE store_id = ?`, [id]);
            await db.query(`DELETE FROM users WHERE store_id = ?`, [id]);
            await db.query(`DELETE FROM branches WHERE store_id = ?`, [id]);
            await db.query(`DELETE FROM stores WHERE id = ?`, [id]);
            await db.commit();
            log(`  ✔ removed ${store.store_name}`);
        } catch (error) {
            await db.rollback();
            throw error;
        }
    }
    await db.query(`DELETE FROM platform_admins WHERE email = ? AND id NOT IN (SELECT reviewed_by FROM subscription_payments WHERE reviewed_by IS NOT NULL)`,
        [`admin@${CONFIG.emailDomain}`]);
    return stores.length;
}

module.exports = { removeSeededStores };
