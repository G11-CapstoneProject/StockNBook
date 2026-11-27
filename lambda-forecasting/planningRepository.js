/*
 * StockNBook Forecasting — planning queries (stocknbook_v2 schema).
 *
 * Used by the Stock Plan (next months), Forecast Accuracy (backtest) and Events features.
 * Reads: orders + order_items, branch_inventory, bookings + booking_items, store_events.
 * Writes: store_events only.
 */

const VALID_SALES_SQL = `LOWER(TRIM(COALESCE(o.status, ''))) = 'completed'`;
// Bookings that hold their items (down payment paid or later).
const ACCEPTED_SQL = `LOWER(TRIM(b.status)) IN ('confirmed', 'preparing', 'released', 'return inspection', 'pending settlement', 'completed')`;
const RENTAL_LINE_SQL = `bi.item_type = 'rental' AND COALESCE(LOWER(TRIM(bi.item_status)), '') <> 'cancelled' AND bi.item_status NOT LIKE 'claim%'`;
const inDay = (column) => `${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`;

function scope(alias, storeId, branchId) {
    const params = [Number(storeId)];
    let where = `${alias}.store_id = ?`;
    if (branchId) { where += ` AND ${alias}.branch_id = ?`; params.push(Number(branchId)); }
    return { where, params };
}

/** POS units per branch, product and month. */
async function getMonthlyProductUnits(db, { storeId, branchId = null, startDate, endDate }) {
    const s = scope("o", storeId, branchId);
    const [rows] = await db.execute(
        `SELECT o.branch_id AS branchId, pv.product_id AS productId, DATE_FORMAT(o.order_date, '%Y-%m') AS monthKey,
                SUM(oi.quantity) AS units
         FROM orders o
             INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.store_id = o.store_id
             INNER JOIN product_variants pv ON pv.id = oi.variant_id AND pv.store_id = oi.store_id
         WHERE ${s.where} AND ${VALID_SALES_SQL} AND ${inDay("o.order_date")}
         GROUP BY o.branch_id, pv.product_id, monthKey`,
        [...s.params, startDate, endDate]
    );
    return rows;
}

/** POS units per branch, product and week (weeks start on Monday). */
async function getWeeklyProductUnits(db, { storeId, branchId = null, startDate, endDate }) {
    const s = scope("o", storeId, branchId);
    const [rows] = await db.execute(
        `SELECT o.branch_id AS branchId, pv.product_id AS productId,
                DATE_FORMAT(DATE_SUB(DATE(o.order_date), INTERVAL WEEKDAY(DATE(o.order_date)) DAY), '%Y-%m-%d') AS weekStart,
                SUM(oi.quantity) AS units
         FROM orders o
             INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.store_id = o.store_id
             INNER JOIN product_variants pv ON pv.id = oi.variant_id AND pv.store_id = oi.store_id
         WHERE ${s.where} AND ${VALID_SALES_SQL} AND ${inDay("o.order_date")}
         GROUP BY o.branch_id, pv.product_id, weekStart`,
        [...s.params, startDate, endDate]
    );
    return rows;
}

/**
 * Stock per branch and product (all of its variants): available = usable − reserved,
 * where usable = on hand − unavailable (0 when expired). Same rule as the Product Demand forecast.
 */
async function getProductStock(db, { storeId, branchId = null }) {
    const s = scope("bi", storeId, branchId);
    const [rows] = await db.execute(
        `SELECT bi.branch_id AS branchId, br.branch_name AS branchName, p.id AS productId, p.product_name AS productName,
                COALESCE(NULLIF(TRIM(c.category_name), ''), 'Uncategorized') AS category,
                SUM(CASE WHEN bi.expiration_date IS NOT NULL AND bi.expiration_date < CURDATE() THEN 0
                         ELSE GREATEST(GREATEST(bi.on_hand_quantity - bi.unavailable_quantity, 0) - bi.reserved_quantity, 0) END) AS available,
                SUM(bi.reorder_level) AS reorderLevel
         FROM branch_inventory bi
             INNER JOIN product_variants pv ON pv.id = bi.variant_id AND pv.store_id = bi.store_id
             INNER JOIN products p ON p.id = pv.product_id AND p.store_id = pv.store_id
             LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
             LEFT JOIN branches br ON br.id = bi.branch_id AND br.store_id = bi.store_id
         WHERE ${s.where} AND LOWER(bi.status) = 'active' AND LOWER(p.status) = 'active' AND LOWER(pv.status) = 'active'
           AND p.deleted_at IS NULL AND pv.deleted_at IS NULL
           AND ((p.has_variants = 0 AND pv.is_default = 1) OR (p.has_variants = 1 AND pv.is_default = 0))
         GROUP BY bi.branch_id, br.branch_name, p.id, p.product_name, category`,
        s.params
    );
    return rows;
}

/** Rental units owned per branch and item (on hand − unavailable). */
async function getEquipmentOwned(db, { storeId, branchId = null }) {
    const s = scope("bi", storeId, branchId);
    const [rows] = await db.execute(
        `SELECT bi.branch_id AS branchId, br.branch_name AS branchName, e.id AS equipmentId, e.equipment_name AS name,
                COALESCE(NULLIF(TRIM(c.category_name), ''), 'Rental equipment') AS category,
                GREATEST(bi.on_hand_quantity - bi.unavailable_quantity, 0) AS owned
         FROM branch_inventory bi
             INNER JOIN equipment e ON e.id = bi.equipment_id AND e.store_id = bi.store_id
             LEFT JOIN categories c ON c.id = e.category_id AND c.store_id = e.store_id
             LEFT JOIN branches br ON br.id = bi.branch_id AND br.store_id = bi.store_id
         WHERE ${s.where} AND bi.equipment_id IS NOT NULL AND LOWER(bi.status) = 'active' AND e.deleted_at IS NULL`,
        s.params
    );
    return rows;
}

/** Rental periods (pickup/delivery date to return date) of accepted bookings overlapping a window. */
async function getRentalPeriods(db, { storeId, branchId = null, startDate, endDate }) {
    const s = scope("b", storeId, branchId);
    const [rows] = await db.execute(
        `SELECT b.branch_id AS branchId, bi.equipment_id AS equipmentId,
                DATE_FORMAT(b.event_date, '%Y-%m-%d') AS eventDate,
                DATE_FORMAT(COALESCE(b.handover_date, b.rental_start_date, b.event_date), '%Y-%m-%d') AS startDate,
                DATE_FORMAT(COALESCE(b.rental_end_date, b.event_end_date, b.event_date), '%Y-%m-%d') AS endDate,
                SUM(bi.quantity) AS quantity
         FROM bookings b INNER JOIN booking_items bi ON bi.booking_id = b.id AND bi.store_id = b.store_id
         WHERE ${s.where} AND ${ACCEPTED_SQL} AND ${RENTAL_LINE_SQL} AND bi.equipment_id IS NOT NULL
           AND COALESCE(b.rental_end_date, b.event_end_date, b.event_date) >= ?
           AND COALESCE(b.handover_date, b.rental_start_date, b.event_date) <= ?
         GROUP BY b.id, b.branch_id, bi.equipment_id, eventDate, startDate, endDate`,
        [...s.params, startDate, endDate]
    );
    return rows;
}

/** Units per product (all branches in scope) between two dates. */
async function getProductUnitsBetween(db, { storeId, branchId = null, startDate, endDate }) {
    const s = scope("o", storeId, branchId);
    const [rows] = await db.execute(
        `SELECT pv.product_id AS productId, p.product_name AS name,
                COALESCE(NULLIF(TRIM(c.category_name), ''), 'Uncategorized') AS category, SUM(oi.quantity) AS units
         FROM orders o
             INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.store_id = o.store_id
             INNER JOIN product_variants pv ON pv.id = oi.variant_id AND pv.store_id = oi.store_id
             INNER JOIN products p ON p.id = pv.product_id AND p.store_id = pv.store_id
             LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
         WHERE ${s.where} AND ${VALID_SALES_SQL} AND ${inDay("o.order_date")}
         GROUP BY pv.product_id, p.product_name, category`,
        [...s.params, startDate, endDate]
    );
    return rows;
}

/** Sales total and units between two dates. */
async function getSalesTotalBetween(db, { storeId, branchId = null, startDate, endDate }) {
    const s = scope("o", storeId, branchId);
    const [rows] = await db.execute(
        `SELECT COALESCE(SUM(o.total), 0) AS sales, COUNT(*) AS orders
         FROM orders o WHERE ${s.where} AND ${VALID_SALES_SQL} AND ${inDay("o.order_date")}`,
        [...s.params, startDate, endDate]
    );
    return rows[0] || { sales: 0, orders: 0 };
}

/** Rental units booked per item (by event date) and bookings per event type, between two dates. */
async function getBookingActivityBetween(db, { storeId, branchId = null, startDate, endDate }) {
    const s = scope("b", storeId, branchId);
    const [[equipment], [types]] = await Promise.all([
        db.execute(
            `SELECT bi.equipment_id AS equipmentId, COALESCE(e.equipment_name, MAX(bi.item_name_snapshot)) AS name, SUM(bi.quantity) AS units
             FROM bookings b INNER JOIN booking_items bi ON bi.booking_id = b.id AND bi.store_id = b.store_id
                 LEFT JOIN equipment e ON e.id = bi.equipment_id AND e.store_id = bi.store_id
             WHERE ${s.where} AND ${ACCEPTED_SQL} AND ${RENTAL_LINE_SQL} AND b.event_date BETWEEN ? AND ?
             GROUP BY bi.equipment_id, e.equipment_name`,
            [...s.params, startDate, endDate]),
        db.execute(
            `SELECT COALESCE(NULLIF(TRIM(b.event_type), ''), 'Other') AS eventType, COUNT(*) AS bookings
             FROM bookings b WHERE ${s.where} AND ${ACCEPTED_SQL} AND b.event_date BETWEEN ? AND ?
             GROUP BY eventType ORDER BY bookings DESC`,
            [...s.params, startDate, endDate]),
    ]);
    return { equipment, types };
}

/* -------------------------------------------------------
 * STORE EVENTS
 * ------------------------------------------------------- */

const EVENT_TYPES = ["election", "holiday", "school", "local_event", "promotion", "other"];

/** Events for the store. Branch users see store-wide events and their own branch's events. */
async function listEvents(db, { storeId, branchId = null }) {
    const params = [Number(storeId)];
    let where = "ev.store_id = ? AND ev.deleted_at IS NULL";
    if (branchId) { where += " AND (ev.branch_id IS NULL OR ev.branch_id = ?)"; params.push(Number(branchId)); }
    const [rows] = await db.execute(
        `SELECT ev.id, ev.branch_id AS branchId, br.branch_name AS branchName, ev.event_name AS name, ev.event_type AS type,
                DATE_FORMAT(ev.start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(ev.end_date, '%Y-%m-%d') AS endDate,
                ev.notes, ev.created_by AS createdBy
         FROM store_events ev LEFT JOIN branches br ON br.id = ev.branch_id AND br.store_id = ev.store_id
         WHERE ${where}
         ORDER BY ev.start_date, ev.id`,
        params
    );
    return rows;
}

async function getEvent(db, { storeId, eventId }) {
    const [rows] = await db.execute(
        `SELECT id, branch_id AS branchId, event_name AS name, event_type AS type,
                DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate, notes
         FROM store_events WHERE id = ? AND store_id = ? AND deleted_at IS NULL LIMIT 1`,
        [Number(eventId), Number(storeId)]
    );
    return rows[0] || null;
}

async function saveEvent(db, { storeId, eventId = null, branchId = null, name, type, startDate, endDate, notes, userId }) {
    if (eventId) {
        await db.execute(
            `UPDATE store_events SET branch_id = ?, event_name = ?, event_type = ?, start_date = ?, end_date = ?, notes = ?
             WHERE id = ? AND store_id = ? AND deleted_at IS NULL`,
            [branchId, name, type, startDate, endDate, notes, Number(eventId), Number(storeId)]
        );
        return Number(eventId);
    }
    const [result] = await db.execute(
        `INSERT INTO store_events (store_id, branch_id, event_name, event_type, start_date, end_date, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [Number(storeId), branchId, name, type, startDate, endDate, notes, userId || null]
    );
    return Number(result.insertId);
}

async function deleteEvent(db, { storeId, eventId }) {
    const [result] = await db.execute(
        `UPDATE store_events SET deleted_at = NOW() WHERE id = ? AND store_id = ? AND deleted_at IS NULL`,
        [Number(eventId), Number(storeId)]
    );
    return result.affectedRows > 0;
}

module.exports = {
    EVENT_TYPES,
    getMonthlyProductUnits,
    getWeeklyProductUnits,
    getProductStock,
    getEquipmentOwned,
    getRentalPeriods,
    getProductUnitsBetween,
    getSalesTotalBetween,
    getBookingActivityBetween,
    listEvents,
    getEvent,
    saveEvent,
    deleteEvent,
};
