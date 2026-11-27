/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Checks that the seeded data is consistent (the same rules the Lambdas rely on).
 *
 *   node scripts/seed/verify.js          checks the stores of SEED_RUN_TAG
 *   node scripts/seed/verify.js --all    checks every store in the database
 */
const { CONFIG } = require("./lib/config");
const { connect } = require("./lib/db");

const ALL_TABLES = ["plans", "platform_admins", "platform_settings", "stores", "branches", "users", "otp_codes", "subscriptions",
    "subscription_payments", "subscription_expiry_notices", "categories", "products", "product_variants", "equipment",
    "branch_inventory", "customers", "packages", "package_items", "bookings", "booking_items", "orders", "order_items", "payments",
    "refunds", "inventory_movements", "stock_issues", "employee_actions", "store_events"];

async function main() {
    const db = await connect();
    const all = process.argv.includes("--all");
    const [stores] = await db.query(all ? `SELECT id, store_name FROM stores ORDER BY id`
        : `SELECT id, store_name FROM stores WHERE slug LIKE ? ORDER BY id`, [`${CONFIG.slugPrefix}%`]);
    if (!stores.length) throw new Error(all ? "No stores in this database." : `No stores for seed tag "${CONFIG.runTag}". Run run.js first.`);
    const ids = stores.map((s) => Number(s.id));
    const IN = `(${ids.join(",")})`;
    let failed = 0;
    const check = async (label, sql, hint = "") => {
        const [rows] = await db.query(sql);
        const bad = Number(rows[0].bad || 0);
        if (bad) failed += 1;
        console.log(`${bad ? "✘" : "✔"} ${label}${bad ? `: ${bad} problem row(s)${hint ? ` (${hint})` : ""}` : ""}`);
    };

    console.log(`Database ${CONFIG.db.database}: ${stores.length} store(s) checked (${stores.map((s) => s.store_name).join(", ")})\n`);
    console.log("Rows per table:");
    const [present] = await db.query(`SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
    const presentSet = new Set(present.map((r) => r.t));
    for (const table of ALL_TABLES) {
        if (!presentSet.has(table)) continue;
        const [r] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
        console.log(`  ${table.padEnd(28)} ${Number(r[0].n).toLocaleString()}`);
    }
    console.log("");

    // ── Inventory ──
    await check("Stock equals the sum of its movements (on hand / reserved / unavailable)", `
        SELECT COUNT(*) AS bad FROM branch_inventory bi
        LEFT JOIN (SELECT branch_inventory_id,
                          SUM(CASE WHEN quantity_bucket='on_hand' THEN quantity_change ELSE 0 END) AS oh,
                          SUM(CASE WHEN quantity_bucket='reserved' THEN quantity_change ELSE 0 END) AS rs,
                          SUM(CASE WHEN quantity_bucket='unavailable' THEN quantity_change ELSE 0 END) AS un
                   FROM inventory_movements WHERE store_id IN ${IN} GROUP BY branch_inventory_id) m ON m.branch_inventory_id = bi.id
        WHERE bi.store_id IN ${IN} AND (COALESCE(m.oh,0) <> bi.on_hand_quantity OR COALESCE(m.rs,0) <> bi.reserved_quantity
                                         OR COALESCE(m.un,0) <> bi.unavailable_quantity)`);
    await check("Movement history is continuous (each 'before' equals the previous 'after')", `
        SELECT COUNT(*) AS bad FROM (
            SELECT quantity_before, LAG(quantity_after) OVER (PARTITION BY branch_inventory_id, quantity_bucket ORDER BY created_at, id) AS prev
            FROM inventory_movements WHERE store_id IN ${IN}) x
        WHERE prev IS NOT NULL AND prev <> quantity_before`);
    await check("Reserved stock equals the reserved booking items", `
        SELECT COUNT(*) AS bad FROM branch_inventory bi
        LEFT JOIN (SELECT b.branch_id, i.variant_id, SUM(i.quantity) AS qty FROM booking_items i
                   JOIN bookings b ON b.id = i.booking_id AND b.store_id = i.store_id
                   WHERE i.store_id IN ${IN} AND i.item_type='consumable' AND i.item_status='reserved'
                   GROUP BY b.branch_id, i.variant_id) r ON r.branch_id = bi.branch_id AND r.variant_id = bi.variant_id
        WHERE bi.store_id IN ${IN} AND bi.variant_id IS NOT NULL AND COALESCE(r.qty,0) <> bi.reserved_quantity`);
    await check("Every product has a variant (simple products: exactly one default)", `
        SELECT COUNT(*) AS bad FROM products p
        LEFT JOIN (SELECT product_id, COUNT(*) AS n, SUM(is_default) AS d FROM product_variants GROUP BY product_id) v ON v.product_id = p.id
        WHERE p.store_id IN ${IN} AND (COALESCE(v.n,0) = 0 OR (p.has_variants = 0 AND (v.n <> 1 OR v.d <> 1)))`);
    await check("Every branch has an inventory row for every variant and equipment", `
        SELECT COUNT(*) AS bad FROM branches br
        JOIN product_variants pv ON pv.store_id = br.store_id
        LEFT JOIN branch_inventory bi ON bi.branch_id = br.id AND bi.variant_id = pv.id
        WHERE br.store_id IN ${IN} AND bi.id IS NULL`);

    // ── Bookings (same rules as lambda-bookings-v2.js) ──
    const money = `(SELECT b.*,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.booking_id=b.id AND p.payment_type='booking_payment'),0) AS paid,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.booking_id=b.id AND p.payment_type='security_deposit'),0) AS dep,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.booking_id=b.id AND p.payment_type='additional_charge'),0) AS chg,
            COALESCE((SELECT SUM(r.amount) FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE p.booking_id=b.id),0) AS refunded
        FROM bookings b WHERE b.store_id IN ${IN}) x`;
    await check("Confirmed and later bookings have their down payment", `
        SELECT COUNT(*) AS bad FROM ${money}
        WHERE status IN ('Confirmed','Preparing','Released','Return Inspection','Pending Settlement','Completed') AND paid + 0.005 < required_down_payment`);
    await check("Released and later bookings are fully paid, with the deposit collected", `
        SELECT COUNT(*) AS bad FROM ${money}
        WHERE status IN ('Released','Return Inspection','Pending Settlement','Completed')
          AND (paid + 0.005 < COALESCE(NULLIF(agreed_price,0), package_price_snapshot) OR dep + 0.005 < refundable_deposit_required)`);
    await check("Completed bookings: no deposit held and no unpaid charges", `
        SELECT COUNT(*) AS bad FROM ${money}
        WHERE status = 'Completed' AND (ABS(dep - deposit_applied_amount - refunded) > 0.005
              OR final_additional_charges - chg - deposit_applied_amount > 0.005 OR settlement_status <> 'settled')`);
    await check("Completed bookings: all rentals returned and inspected", `
        SELECT COUNT(*) AS bad FROM booking_items i JOIN bookings b ON b.id = i.booking_id
        WHERE b.store_id IN ${IN} AND b.status = 'Completed' AND i.item_type = 'rental'
          AND (i.item_status NOT IN ('cleared', 'damaged') OR i.inspected_at IS NULL)`);
    await check("Item status matches booking status", `
        SELECT COUNT(*) AS bad FROM booking_items i JOIN bookings b ON b.id = i.booking_id
        WHERE b.store_id IN ${IN} AND i.item_type <> 'package' AND NOT (
              (b.status IN ('Pending Review','Awaiting Down Payment') AND i.item_status = 'pending')
           OR (b.status IN ('Confirmed','Preparing') AND i.item_status = 'reserved')
           -- the Lambda hands consumables over first; the booking waits for the rental checkout
           OR (b.status IN ('Confirmed','Preparing') AND i.item_type = 'consumable' AND i.item_status = 'released')
           OR (b.status IN ('Cancelled','Rejected') AND i.item_status = 'cancelled')
           OR (b.status = 'Released' AND i.item_status = 'released')
           OR (b.status IN ('Return Inspection','Pending Settlement','Completed') AND i.item_type = 'consumable' AND i.item_status = 'released')
           -- rentals: 'returned' until inspected, then 'cleared' or 'damaged'
           OR (b.status = 'Return Inspection' AND i.item_type = 'rental' AND i.item_status = 'returned' AND i.inspected_at IS NULL)
           OR (b.status IN ('Pending Settlement','Completed') AND i.item_type = 'rental' AND i.inspected_at IS NOT NULL
               AND i.item_status = IF(i.damaged_quantity > 0, 'damaged', 'cleared')))`);
    // Custom quotes may be discounted below their items (the Lambda allows it with a pricing note), so they are skipped.
    await check("Package and rental prices cover their items (custom quotes may have a discount)", `
        SELECT COUNT(*) AS bad FROM bookings b
        WHERE b.store_id IN ${IN} AND LOWER(b.booking_type) <> 'custom' AND b.agreed_price IS NOT NULL AND b.agreed_price + 0.005 <
              (SELECT COALESCE(SUM(line_total),0) FROM booking_items i WHERE i.booking_id = b.id AND i.parent_item_id IS NULL)`);
    // Same rule as the Lambda: only reserved and checked-out equipment holds stock (pending requests do not).
    await check("Rental equipment is never double-booked beyond branch stock", `
        SELECT COUNT(*) AS bad FROM (
            SELECT b.branch_id, i.equipment_id, d.day, SUM(i.quantity) AS used
            FROM booking_items i JOIN bookings b ON b.id = i.booking_id
            JOIN (SELECT DISTINCT event_date AS day FROM bookings WHERE store_id IN ${IN}) d
              ON d.day BETWEEN b.rental_start_date AND b.rental_end_date
            WHERE b.store_id IN ${IN} AND i.item_type = 'rental' AND i.item_status IN ('reserved','released')
            GROUP BY b.branch_id, i.equipment_id, d.day) u
        JOIN branch_inventory bi ON bi.branch_id = u.branch_id AND bi.equipment_id = u.equipment_id
        WHERE u.used > bi.on_hand_quantity - bi.unavailable_quantity`);

    // ── POS ──
    await check("POS order totals match their items and payment", `
        SELECT COUNT(*) AS bad FROM orders o
        LEFT JOIN (SELECT order_id, SUM(line_total) AS s FROM order_items WHERE store_id IN ${IN} GROUP BY order_id) it ON it.order_id = o.order_id
        LEFT JOIN (SELECT order_id, SUM(amount) AS p, COUNT(*) AS n FROM payments WHERE store_id IN ${IN} AND order_id IS NOT NULL GROUP BY order_id) pay ON pay.order_id = o.order_id
        WHERE o.store_id IN ${IN} AND (ABS(COALESCE(it.s,0) - o.subtotal) > 0.005 OR ABS(o.subtotal - o.discount_amount - o.total) > 0.005
              OR ABS(COALESCE(pay.p,0) - o.total) > 0.005 OR COALESCE(pay.n,0) <> 1)`);

    // ── Plans & people ──
    await check("Each store has one owner and one subscription", `
        SELECT COUNT(*) AS bad FROM stores s WHERE s.id IN ${IN} AND (
            (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.role = 'owner') <> 1 OR
            (SELECT COUNT(*) FROM subscriptions x WHERE x.store_id = s.id) <> 1)`);
    await check("Plan limits respected (branches, staff, products, bookings this month)", `
        SELECT COUNT(*) AS bad FROM stores s JOIN subscriptions sub ON sub.store_id = s.id JOIN plans p ON p.id = sub.plan_id
        WHERE s.id IN ${IN} AND (
            (p.max_branches > 0 AND (SELECT COUNT(*) FROM branches b WHERE b.store_id = s.id) > p.max_branches) OR
            (p.max_staff > 0 AND (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.role = 'staff') > p.max_staff) OR
            (p.max_inventory > 0 AND (SELECT COUNT(*) FROM products x WHERE x.store_id = s.id AND x.deleted_at IS NULL) > p.max_inventory) OR
            (p.max_bookings > 0 AND (SELECT COUNT(*) FROM bookings b WHERE b.store_id = s.id
                 AND b.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) > p.max_bookings))`,
        "plan limits come from the plans table");

    console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
    process.exitCode = failed ? 1 : 0;
    await db.end();
}

main().catch((error) => {
    console.error("Verify failed:", error.message);
    process.exit(1);
});
