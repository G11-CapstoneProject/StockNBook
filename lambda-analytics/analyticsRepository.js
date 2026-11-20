/*
 * StockNBook Analytics repository — stocknbook_v2 schema.
 *
 * v2 tables used:
 *   orders (status, order_date) + order_items (variant_id, quantity, line_total)
 *   product_variants -> products (product_name, category_id) -> categories (category_name)
 *   bookings (status, event_date, booking_type) + booking_items (item_type, item_name_snapshot, quantity)
 *   users (role, permissions) for Manager / Staff access
 */

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

// Booking statuses that count as accepted (down payment paid or later), same as the Bookings module.
const ACCEPTED_BOOKING_STATUSES_SQL = `LOWER(TRIM(b.status)) IN (
    'confirmed', 'preparing', 'released', 'return inspection', 'pending settlement', 'completed'
)`;

// Completed POS sales only (v2 orders have one status column).
const VALID_SALES_SQL = `LOWER(TRIM(COALESCE(o.status, ''))) = 'completed'`;

/*
 * Store / branch scope plus an inclusive date range.
 * The range is written as >= start AND < day after end, so it also works for
 * DATETIME columns such as orders.order_date (sales late on the last day are included).
 */
function buildScopeWhere({
                             tableAlias,
                             storeId,
                             branchId,
                             dateColumn = null,
                             startDate = null,
                             endDate = null,
                         }) {
    const alias = tableAlias ? `${tableAlias}.` : "";
    const where = [`${alias}store_id = ?`];
    const params = [Number(storeId)];

    if (branchId) {
        where.push(`${alias}branch_id = ?`);
        params.push(Number(branchId));
    }

    if (dateColumn && startDate && endDate) {
        where.push(`${dateColumn} >= ? AND ${dateColumn} < DATE_ADD(?, INTERVAL 1 DAY)`);
        params.push(startDate, endDate);
    }

    return {
        where: where.join(" AND "),
        params,
    };
}

async function ensureStoreExists(connection, storeId) {
    const parsedStoreId = toPositiveInteger(storeId);

    if (!parsedStoreId) return false;

    const [rows] = await connection.execute(
        `SELECT id FROM stores WHERE id = ? LIMIT 1`,
        [parsedStoreId]
    );

    return rows.length > 0;
}

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
    const parsedBranchId = toPositiveInteger(branchId);
    const parsedStoreId = toPositiveInteger(storeId);

    if (!parsedBranchId || !parsedStoreId) return false;

    const [rows] = await connection.execute(
        `SELECT id, branch_name
         FROM branches
         WHERE id = ? AND store_id = ?
             LIMIT 1`,
        [parsedBranchId, parsedStoreId]
    );

    return rows[0] || null;
}

async function getBranchName(connection, branchId, storeId) {
    if (!branchId) return null;

    const branch = await ensureBranchBelongsToStore(
        connection,
        branchId,
        storeId
    );

    return branch ? String(branch.branch_name || "") : null;
}

/*
 * Permissions of the logged-in Manager / Staff from v2 `users`.
 * The token may carry user_id / id / sub, or the older manager_id / staff_id.
 */
async function getRolePermissions(connection, decoded) {
    const role = String(decoded.role || "").toLowerCase();

    if (role === "owner") return {};
    if (role !== "manager" && role !== "staff") return {};

    const storeId = toPositiveInteger(decoded.store_id ?? decoded.storeId);
    if (!storeId) return {};

    const candidateIds = [
        decoded.user_id,
        decoded.userId,
        decoded.id,
        decoded.sub,
        role === "manager" ? decoded.manager_id : decoded.staff_id,
    ]
        .map(toPositiveInteger)
        .filter(Boolean);

    for (const userId of candidateIds) {
        const [rows] = await connection.execute(
            `SELECT permissions
             FROM users
             WHERE id = ?
               AND store_id = ?
               AND LOWER(role) = ?
               AND LOWER(status) = 'active'
                 LIMIT 1`,
            [userId, storeId, role]
        );

        if (rows.length) return rows[0].permissions || {};
    }

    return {};
}

function parsePermissions(value) {
    if (!value) return {};

    if (typeof value === "object") return value;

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function hasExplicitAnalyticsDenial(permissions) {
    const normalized = parsePermissions(permissions);
    const denied = (value) => value === false || value === "none" || value === "false" || value === 0;

    return (
        denied(normalized.analytics) ||
        denied(normalized.analytics_access) ||
        denied(normalized.analytics_view) ||
        denied(normalized.view_analytics)
    );
}

// v2 permissions are saved as true / "full" / "view" (or "none" / false).
function hasAnalyticsAccess(permissions) {
    const normalized = parsePermissions(permissions);
    const value = normalized.analytics_access ?? normalized.analytics;

    return [true, 1, "1", "true", "full", "view", "view_only"].includes(value);
}

/* -------------------------------------------------------
 * ANALYTICS QUERIES (v2)
 * ------------------------------------------------------- */

async function getAnalyticsSales(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    const scope = buildScopeWhere({
        tableAlias: "o",
        storeId,
        branchId,
        dateColumn: "o.order_date",
        startDate,
        endDate,
    });

    const [rows] = await connection.execute(
        `SELECT
             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS day,
            o.branch_id AS branchId,
            b.branch_name AS branchName,
            SUM(COALESCE(o.total, 0)) AS value,
            COUNT(*) AS orders
         FROM orders o
             INNER JOIN branches b
         ON b.id = o.branch_id
             AND b.store_id = o.store_id
         WHERE ${scope.where}
           AND ${VALID_SALES_SQL}
         GROUP BY
             DATE_FORMAT(o.order_date, '%Y-%m-%d'),
             o.branch_id,
             b.branch_name
         ORDER BY day`,
        scope.params
    );

    return rows;
}

async function getAnalyticsProducts(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    const scope = buildScopeWhere({
        tableAlias: "o",
        storeId,
        branchId,
        dateColumn: "o.order_date",
        startDate,
        endDate,
    });

    // Variant products show as "Product (Variant)", like the Inventory page.
    const [rows] = await connection.execute(
        `SELECT
             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS day,
            pv.product_id AS productId,
            oi.variant_id AS variantId,
            CASE
                WHEN p.id IS NULL THEN oi.product_name_snapshot
                WHEN p.has_variants = 1 THEN CONCAT(p.product_name, ' (', pv.variant_name, ')')
                ELSE p.product_name
        END AS productName,
            COALESCE(NULLIF(TRIM(c.category_name), ''), 'Uncategorized') AS category,
            HOUR(o.order_date) AS purchaseHour,
            SUM(COALESCE(oi.quantity, 0)) AS units,
            SUM(COALESCE(oi.line_total, 0)) AS revenue
         FROM orders o
         INNER JOIN order_items oi
            ON oi.order_id = o.order_id
            AND oi.store_id = o.store_id
         LEFT JOIN product_variants pv
            ON pv.id = oi.variant_id
            AND pv.store_id = oi.store_id
         LEFT JOIN products p
            ON p.id = pv.product_id
            AND p.store_id = pv.store_id
         LEFT JOIN categories c
            ON c.id = p.category_id
            AND c.store_id = p.store_id
         WHERE ${scope.where}
        AND ${VALID_SALES_SQL}
        GROUP BY
        DATE_FORMAT(o.order_date, '%Y-%m-%d'),
        pv.product_id,
        oi.variant_id,
        productName,
        category,
        HOUR(o.order_date)
        ORDER BY day`,
        scope.params
    );

    return rows;
}

async function getAnalyticsBookings(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    const scope = buildScopeWhere({
        tableAlias: "b",
        storeId,
        branchId,
        dateColumn: "b.event_date",
        startDate,
        endDate,
    });

    // Package name comes from the booking's package line (the saved snapshot), then the packages table.
    const [rows] = await connection.execute(
        `SELECT
             DATE_FORMAT(b.event_date, '%Y-%m-%d') AS day,
            b.id AS bookingId,
            CASE LOWER(b.booking_type)
                WHEN 'package' THEN 'Package'
                WHEN 'custom' THEN 'Custom'
                WHEN 'rental' THEN 'Rental'
                ELSE COALESCE(NULLIF(TRIM(b.booking_type), ''), 'Unspecified')
        END AS bookingType,
            CASE WHEN LOWER(b.booking_type) = 'package' THEN COALESCE(
                (SELECT pi.item_name_snapshot FROM booking_items pi
                 WHERE pi.booking_id = b.id AND pi.store_id = b.store_id AND pi.item_type = 'package'
                 ORDER BY pi.id LIMIT 1),
                pk.package_name, ''
            ) ELSE '' END AS packageName,
            b.status AS status
         FROM bookings b
         LEFT JOIN packages pk
            ON pk.id = b.package_id
            AND pk.store_id = b.store_id
         WHERE ${scope.where}
        AND ${ACCEPTED_BOOKING_STATUSES_SQL}
        ORDER BY b.event_date`,
        scope.params
    );

    return rows;
}

async function getAnalyticsBookingItems(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    const scope = buildScopeWhere({
        tableAlias: "b",
        storeId,
        branchId,
        dateColumn: "b.event_date",
        startDate,
        endDate,
    });

    // Consumables and rental equipment booked; the package line itself is not an item.
    const [rows] = await connection.execute(
        `SELECT
             DATE_FORMAT(b.event_date, '%Y-%m-%d') AS day,
            b.id AS bookingId,
            b.booking_type AS bookingType,
            CASE WHEN bi.parent_item_id IS NULL THEN 'custom' ELSE 'package' END AS sourceType,
            COALESCE(pv.product_id, bi.equipment_id) AS productId,
            CASE
                WHEN bi.variant_name_snapshot IS NOT NULL AND bi.variant_name_snapshot <> ''
                    THEN CONCAT(bi.item_name_snapshot, ' (', bi.variant_name_snapshot, ')')
                ELSE bi.item_name_snapshot
        END AS productName,
            CASE WHEN bi.item_type = 'rental' THEN 'Rental equipment' ELSE 'Consumable' END AS category,
            SUM(COALESCE(bi.quantity, 0)) AS bookedUnits
         FROM bookings b
         INNER JOIN booking_items bi
            ON bi.booking_id = b.id
            AND bi.store_id = b.store_id
         LEFT JOIN product_variants pv
            ON pv.id = bi.variant_id
            AND pv.store_id = bi.store_id
         WHERE ${scope.where}
        AND ${ACCEPTED_BOOKING_STATUSES_SQL}
        AND bi.item_type IN ('consumable', 'rental')
        AND COALESCE(LOWER(TRIM(bi.item_status)), '') <> 'cancelled'
        AND bi.item_status NOT LIKE 'claim%'
        GROUP BY
        DATE_FORMAT(b.event_date, '%Y-%m-%d'),
        b.id,
        b.booking_type,
        sourceType,
        productId,
        productName,
        category`,
        scope.params
    );

    return rows;
}

/* -------------------------------------------------------
 * RENTAL LIFECYCLE EVENTS (read-only)
 * ------------------------------------------------------- */

/**
 * Retrieve rental item facts for Analytics without changing booking workflows.
 * Bookings are scoped by event_date; releases and returns are independently
 * scoped by their own timestamps so activity in later periods is not lost.
 * The engine must apply the appropriate date to each metric and must not
 * count damaged units as additional returned units.
 */
async function getAnalyticsRentalItems(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    const store = toPositiveInteger(storeId);
    if (!store || !startDate || !endDate) {
        throw new Error("Rental Analytics requires a store and date range.");
    }

    const params = [store];
    let branchClause = "";
    if (branchId !== null) {
        const branch = toPositiveInteger(branchId);
        if (!branch) throw new Error("Invalid rental Analytics branch.");
        branchClause = " AND b.branch_id = ?";
        params.push(branch);
    }

    // Include events occurring within the requested window, even when the
    // original booking event date falls outside that window.
    const eventRange = (column) =>
        `${column} >= ? AND ${column} < DATE_ADD(?, INTERVAL 1 DAY)`;
    params.push(
        startDate, endDate,
        startDate, endDate,
        startDate, endDate
    );

    const [rows] = await connection.execute(
        `SELECT
             bi.id AS bookingItemId,
             b.id AS bookingId,
             b.branch_id AS branchId,
             LOWER(TRIM(COALESCE(b.status, ''))) AS bookingStatus,
             LOWER(TRIM(COALESCE(b.booking_type, ''))) AS bookingType,
             LOWER(TRIM(COALESCE(bi.item_status, ''))) AS itemStatus,
             bi.equipment_id AS equipmentId,
             bi.item_name_snapshot AS equipmentName,
             COALESCE(bi.quantity, 0) AS bookedUnits,
             COALESCE(bi.returned_quantity, 0) AS returnedUnits,
             COALESCE(bi.damaged_quantity, 0) AS damagedUnits,
             COALESCE(bi.missing_quantity, 0) AS missingUnits,
             DATE_FORMAT(b.event_date, '%Y-%m-%d') AS bookingDay,
             DATE_FORMAT(bi.released_at, '%Y-%m-%d') AS releaseDay,
             DATE_FORMAT(bi.returned_at, '%Y-%m-%d') AS returnDay,
             bi.released_at AS releasedAt,
             bi.returned_at AS returnedAt,
             b.rental_start_date AS rentalStartDate,
             b.rental_end_date AS rentalEndDate,
             b.return_time AS expectedReturnTime
         FROM bookings b
                  INNER JOIN booking_items bi
                             ON bi.booking_id = b.id AND bi.store_id = b.store_id
         WHERE b.store_id = ?${branchClause}
           AND bi.item_type = 'rental'
           AND (
             (${eventRange('b.event_date')}) OR
             (${eventRange('bi.released_at')}) OR
             (${eventRange('bi.returned_at')})
             )
         ORDER BY b.id, bi.id`,
        params
    );

    return rows;
}

/* -------------------------------------------------------
 * OLDER HELPERS (kept so any other file that imports them still works; v2 columns)
 * ------------------------------------------------------- */

async function getSalesRows(connection, { storeId, branchId = null, startDate, endDate }) {
    const scope = buildScopeWhere({ tableAlias: "o", storeId, branchId, dateColumn: "o.order_date", startDate, endDate });
    const [rows] = await connection.execute(
        `SELECT o.order_id AS orderId, o.branch_id AS branchId,
                DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate, COALESCE(o.total, 0) AS total
         FROM orders o
         WHERE ${scope.where} AND ${VALID_SALES_SQL}
         ORDER BY o.order_date ASC, o.created_at ASC`,
        scope.params
    );
    return rows;
}

async function getProductRevenueRows(connection, { storeId, branchId = null, startDate, endDate }) {
    const scope = buildScopeWhere({ tableAlias: "o", storeId, branchId, dateColumn: "o.order_date", startDate, endDate });
    const [rows] = await connection.execute(
        `SELECT COALESCE(NULLIF(TRIM(c.category_name), ''), 'Uncategorized') AS category,
                SUM(COALESCE(oi.line_total, 0)) AS value
         FROM orders o
             INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.store_id = o.store_id
             LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.store_id = oi.store_id
             LEFT JOIN products p ON p.id = pv.product_id AND p.store_id = pv.store_id
             LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
         WHERE ${scope.where} AND ${VALID_SALES_SQL}
         GROUP BY category
         HAVING value > 0
         ORDER BY value DESC, category ASC`,
        scope.params
    );
    return rows;
}

async function getBookings(connection, { storeId, branchId = null, startDate, endDate }) {
    const scope = buildScopeWhere({ tableAlias: "b", storeId, branchId, dateColumn: "b.event_date", startDate, endDate });
    const [rows] = await connection.execute(
        `SELECT b.id, b.branch_id AS branchId,
                DATE_FORMAT(b.event_date, '%Y-%m-%d') AS eventDate,
                COALESCE(TIME_FORMAT(b.event_time, '%H:%i'), '') AS eventTime,
                COALESCE(b.status, '') AS status,
                COALESCE((SELECT pi.item_name_snapshot FROM booking_items pi
                          WHERE pi.booking_id = b.id AND pi.store_id = b.store_id AND pi.item_type = 'package'
                          ORDER BY pi.id LIMIT 1), '') AS packageName,
                COALESCE(b.custom_order, '') AS customOrder,
                COALESCE(b.agreed_price, 0) AS agreedPrice,
                COALESCE(b.package_price_snapshot, 0) AS packagePrice,
                COALESCE((SELECT SUM(p.amount) FROM payments p
                          WHERE p.booking_id = b.id AND p.store_id = b.store_id
                            AND p.payment_type = 'booking_payment' AND p.status = 'recorded'), 0) AS amountPaid
         FROM bookings b
         WHERE ${scope.where}
         ORDER BY b.event_date ASC, b.event_time ASC, b.created_at ASC`,
        scope.params
    );
    return rows;
}

module.exports = {
    toPositiveInteger,
    ensureStoreExists,
    ensureBranchBelongsToStore,
    getBranchName,
    getSalesRows,
    getProductRevenueRows,
    getBookings,
    getRolePermissions,
    hasExplicitAnalyticsDenial,
    hasAnalyticsAccess,
    getAnalyticsSales,
    getAnalyticsProducts,
    getAnalyticsBookings,
    getAnalyticsBookingItems,
    getAnalyticsRentalItems,
};
