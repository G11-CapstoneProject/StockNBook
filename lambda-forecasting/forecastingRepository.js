/*
 * StockNBook Forecasting repository — stocknbook_v2 schema.
 *
 * v2 tables used:
 *   branch_inventory (per-branch stock: on_hand / reserved / unavailable / reorder_level / expiration_date)
 *   product_variants -> products (product_name, has_variants, category_id) -> categories
 *   orders (status, order_date) + order_items (variant_id, quantity)
 *   bookings (status, event_date) + booking_items (item_type, quantity) + customers + packages
 *   users (permissions) for Manager / Staff access
 *
 * Products are store-wide in v2 and stock is per branch, so every inventory item key
 * includes the branch: "branchId:productId:variantId".
 */

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function toSafeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function toDateOnly(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const raw = String(value ?? "").trim().slice(0, 10);

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
        raw === "0000-00-00"
    ) {
        return null;
    }

    return raw;
}

// Completed POS sales only (v2 orders have one status column).
const VALID_SALES_SQL = `LOWER(TRIM(COALESCE(o.status, ''))) = 'completed'`;

// Upcoming committed bookings: down payment paid, not yet finished.
const UPCOMING_BOOKING_STATUSES_SQL = `LOWER(TRIM(COALESCE(b.status, ''))) IN ('confirmed', 'preparing', 'released')`;

// Booking lines that are real items (not the package line, not cancelled).
const BOOKED_ITEM_SQL = `bi.item_type IN ('consumable', 'rental')
          AND bi.item_status <> 'cancelled'
          AND bi.item_status NOT LIKE 'claim%'`;

function getInventoryKey(branchId, productId, variantId) {
    return `${branchId}:${productId}:${variantId || "product"}`;
}

function getProductLookupKey(branchId, productId) {
    return `${branchId}:${productId}`;
}

/*
  Returns the inventory item's key for a POS line in the same branch.
  Exact product + variant match first; products without variants match their
  product-level item (POS lines carry the default variant id).
*/
function resolveInventoryItemKey(
    inventoryByProduct,
    branchId,
    productId,
    variantId
) {
    const parsedProductId = toPositiveInteger(productId);
    const parsedBranchId = toPositiveInteger(branchId);

    if (!parsedProductId || !parsedBranchId) {
        return null;
    }

    const candidates =
        inventoryByProduct.get(getProductLookupKey(parsedBranchId, parsedProductId)) || [];

    if (candidates.length === 0) {
        return null;
    }

    const parsedVariantId = toPositiveInteger(variantId);

    const exactMatch = candidates.find(
        (item) => toPositiveInteger(item.variantId) === parsedVariantId
    );

    if (exactMatch) {
        return exactMatch.id;
    }

    const productLevelItem = candidates.find(
        (item) => !toPositiveInteger(item.variantId)
    );

    return productLevelItem ? productLevelItem.id : null;
}

function indexInventoryByProduct(inventoryItems) {
    const inventoryByProduct = new Map();

    inventoryItems.forEach((item) => {
        const productId = toPositiveInteger(item.productId);
        const branchId = toPositiveInteger(item.branchId);

        if (!productId || !branchId) {
            return;
        }

        const key = getProductLookupKey(branchId, productId);
        const currentItems = inventoryByProduct.get(key) || [];
        currentItems.push(item);
        inventoryByProduct.set(key, currentItems);
    });

    return inventoryByProduct;
}

function getStartOfWeekUTC(date) {
    const result = new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate()
        )
    );

    const mondayOffset = (result.getUTCDay() + 6) % 7;
    result.setUTCDate(result.getUTCDate() - mondayOffset);

    return result;
}

function addDaysUTC(date, days) {
    const result = new Date(date.getTime());
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function toISODate(date) {
    return date.toISOString().slice(0, 10);
}

function getWeekWindows(historyWeeks = 12, today = new Date()) {
    const currentWeekStart = getStartOfWeekUTC(today);
    const count = Math.max(3, Number(historyWeeks) || 12);
    const weekStarts = [];

    for (let offset = count - 1; offset >= 0; offset -= 1) {
        weekStarts.push(addDaysUTC(currentWeekStart, -offset * 7));
    }

    return weekStarts.map((startDate) => ({
        startDate: toISODate(startDate),
        endDate: toISODate(addDaysUTC(startDate, 6)),
    }));
}

function getMonthRange(historyMonths = 12, today = new Date()) {
    const count = Math.max(1, Number(historyMonths) || 12);

    // Completed calendar months only.
    // Example on July 1, 2026: start July 1, 2025, end June 30, 2026.
    const currentMonthStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
    );

    const end = new Date(currentMonthStart.getTime());
    end.setUTCDate(end.getUTCDate() - 1);

    const start = new Date(
        Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth() - (count - 1),
            1
        )
    );

    return {
        startDate: toISODate(start),
        endDate: toISODate(end),
    };
}

function getUpcomingBookingRange(periodDays = 30, today = new Date()) {
    const days = Math.max(1, Number(periodDays) || 30);

    const start = new Date(
        Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate()
        )
    );

    return {
        startDate: toISODate(start),
        endDate: toISODate(addDaysUTC(start, days - 1)),
    };
}

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
    const parsedBranchId = toPositiveInteger(branchId);
    const parsedStoreId = toPositiveInteger(storeId);

    if (!parsedBranchId || !parsedStoreId) {
        return false;
    }

    const [rows] = await connection.execute(
        `SELECT id
         FROM branches
         WHERE id = ?
           AND store_id = ?
         LIMIT 1`,
        [parsedBranchId, parsedStoreId]
    );

    return rows.length > 0;
}

/*
 * Permissions of the logged-in Manager / Staff from v2 `users`.
 * Returns null when no active account matches the token.
 */
async function getUserPermissions(connection, decoded, storeId, role) {
    const candidateIds = [
        decoded?.user_id,
        decoded?.userId,
        decoded?.id,
        decoded?.sub,
        role === "manager" ? decoded?.manager_id : decoded?.staff_id,
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

        if (rows.length) {
            const raw = rows[0].permissions;

            if (raw && typeof raw === "object") return raw;

            try {
                const parsed = JSON.parse(raw || "{}");
                return parsed && typeof parsed === "object" ? parsed : {};
            } catch {
                return {};
            }
        }
    }

    return null;
}

/*
 * Consumable stock per branch.
 * Products without variants use their default variant; products with variants list each variant
 * (the hidden default variant is skipped), the same rule as the Inventory module.
 *
 * Usable stock = on hand − unavailable (0 when the batch is expired).
 * Reserved = units already held for confirmed bookings (branch_inventory.reserved_quantity).
 */
async function getInventoryItems(connection, { storeId, branchId = null }) {
    let query = `
        SELECT
            p.id AS product_id,
            bi.branch_id,
            p.product_name,
            p.has_variants,
            COALESCE(NULLIF(TRIM(c.category_name), ''), 'Uncategorized') AS category,
            bi.on_hand_quantity,
            bi.reserved_quantity,
            bi.unavailable_quantity,
            bi.reorder_level,
            DATE_FORMAT(bi.expiration_date, '%Y-%m-%d') AS expiration_date,
            pv.id AS variant_row_id,
            pv.variant_name,
            b.branch_name
        FROM branch_inventory bi
                 INNER JOIN product_variants pv
                            ON pv.id = bi.variant_id
                                AND pv.store_id = bi.store_id
                 INNER JOIN products p
                            ON p.id = pv.product_id
                                AND p.store_id = pv.store_id
                 LEFT JOIN categories c
                           ON c.id = p.category_id
                               AND c.store_id = p.store_id
                 LEFT JOIN branches b
                           ON b.id = bi.branch_id
                               AND b.store_id = bi.store_id
        WHERE bi.store_id = ?
          AND bi.variant_id IS NOT NULL
          AND LOWER(bi.status) = 'active'
          AND LOWER(p.status) = 'active'
          AND LOWER(pv.status) = 'active'
          AND p.deleted_at IS NULL
          AND pv.deleted_at IS NULL
          AND ((p.has_variants = 0 AND pv.is_default = 1) OR (p.has_variants = 1 AND pv.is_default = 0))
    `;

    const params = [storeId];

    if (branchId) {
        query += " AND bi.branch_id = ?";
        params.push(branchId);
    }

    query += " ORDER BY b.branch_name ASC, p.product_name ASC, pv.variant_name ASC";

    const [rows] = await connection.execute(query, params);
    const today = toISODate(new Date());

    return rows.map((row) => {
        const productId = Number(row.product_id);
        const branchIdValue = Number(row.branch_id);
        const isVariant = Number(row.has_variants) === 1;
        const variantId = isVariant ? toPositiveInteger(row.variant_row_id) : null;
        const variantName = isVariant ? String(row.variant_name || "Variant") : null;

        const itemName = isVariant
            ? `${row.product_name} / ${variantName}`
            : String(row.product_name || "Unnamed Product");

        const expired = Boolean(row.expiration_date && row.expiration_date < today);
        const usable = expired
            ? 0
            : Math.max(0, toSafeNumber(row.on_hand_quantity) - toSafeNumber(row.unavailable_quantity));

        return {
            id: getInventoryKey(branchIdValue, productId, variantId),
            productId,
            variantId,
            productName: String(row.product_name || ""),
            variantName,
            itemName,
            category: String(row.category || "Uncategorized"),
            branchId: branchIdValue,
            branchName: String(row.branch_name || "Unnamed Branch"),
            isVariant,
            onHandQuantity: usable,
            reservedQuantity: expired ? 0 : toSafeNumber(row.reserved_quantity),
            lowStockThreshold: toSafeNumber(row.reorder_level),
            expirationDate: row.expiration_date || null,
        };
    });
}

async function getHistoricalSales(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    /*
      POS quantities per branch, product/variant and calendar week (Monday start),
      aggregated in MySQL so only the weekly totals are sent to the Lambda.
    */
    let query = `
        SELECT
            o.branch_id,
            pv.product_id,
            oi.variant_id,
            SUM(oi.quantity) AS quantity,
            DATE_FORMAT(
                    DATE_SUB(
                            DATE(o.order_date),
                            INTERVAL WEEKDAY(DATE(o.order_date)) DAY
                    ),
                    '%Y-%m-%d'
            ) AS order_date
        FROM orders o
                 INNER JOIN order_items oi
                            ON oi.order_id = o.order_id
                                AND oi.store_id = o.store_id
                 INNER JOIN product_variants pv
                            ON pv.id = oi.variant_id
                                AND pv.store_id = oi.store_id
        WHERE o.store_id = ?
          AND ${VALID_SALES_SQL}
          AND o.order_date >= ?
          AND o.order_date < DATE_ADD(?, INTERVAL 1 DAY)
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY
            o.branch_id,
            pv.product_id,
            oi.variant_id,
            order_date
        ORDER BY order_date ASC
    `;

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
        branchId: toPositiveInteger(row.branch_id),
        productId: toPositiveInteger(row.product_id),
        variantId: toPositiveInteger(row.variant_id),
        quantity: toSafeNumber(row.quantity),
        orderDate: toDateOnly(row.order_date),
    }));
}

async function getMonthlySalesSummary(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    let query = `
        SELECT
            DATE_FORMAT(o.order_date, '%Y-%m') AS month_key,
            SUM(oi.quantity) AS total_units,
            COUNT(DISTINCT o.order_id) AS order_count
        FROM orders o
                 INNER JOIN order_items oi
                            ON oi.order_id = o.order_id
                                AND oi.store_id = o.store_id
        WHERE o.store_id = ?
          AND ${VALID_SALES_SQL}
          AND o.order_date >= ?
          AND o.order_date < DATE_ADD(?, INTERVAL 1 DAY)
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY month_key
        ORDER BY month_key ASC
    `;

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
        monthKey: String(row.month_key || ""),
        totalUnits: toSafeNumber(row.total_units),
        orderCount: toSafeNumber(row.order_count),
    }));
}

async function getItemMonthlySalesSummary(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    let query = `
        SELECT
            o.branch_id,
            pv.product_id,
            oi.variant_id,
            DATE_FORMAT(o.order_date, '%Y-%m') AS month_key,
            SUM(oi.quantity) AS total_units,
            COUNT(DISTINCT o.order_id) AS order_count
        FROM orders o
                 INNER JOIN order_items oi
                            ON oi.order_id = o.order_id
                                AND oi.store_id = o.store_id
                 INNER JOIN product_variants pv
                            ON pv.id = oi.variant_id
                                AND pv.store_id = oi.store_id
        WHERE o.store_id = ?
          AND ${VALID_SALES_SQL}
          AND o.order_date >= ?
          AND o.order_date < DATE_ADD(?, INTERVAL 1 DAY)
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY
            o.branch_id,
            pv.product_id,
            oi.variant_id,
            month_key
        ORDER BY month_key ASC
    `;

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
        branchId: toPositiveInteger(row.branch_id),
        productId: toPositiveInteger(row.product_id),
        variantId: toPositiveInteger(row.variant_id),
        monthKey: String(row.month_key || ""),
        totalUnits: toSafeNumber(row.total_units),
        orderCount: toSafeNumber(row.order_count),
    }));
}

function buildItemMonthlySalesMap(inventoryItems, itemMonthlySales) {
    const monthlySalesMap = new Map();
    const inventoryByProduct = indexInventoryByProduct(inventoryItems);

    inventoryItems.forEach((item) => {
        monthlySalesMap.set(item.id, []);
    });

    itemMonthlySales.forEach((sale) => {
        if (!sale.productId || !sale.monthKey) {
            return;
        }

        const itemKey = resolveInventoryItemKey(
            inventoryByProduct,
            sale.branchId,
            sale.productId,
            sale.variantId
        );

        if (!itemKey) {
            return;
        }

        const current = monthlySalesMap.get(itemKey);

        if (current) {
            current.push({
                monthKey: sale.monthKey,
                totalUnits: sale.totalUnits,
                orderCount: sale.orderCount,
            });
        }
    });

    return monthlySalesMap;
}

function upcomingBookingWhere({ storeId, branchId, startDate, endDate }) {
    let where = `
        b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND ${UPCOMING_BOOKING_STATUSES_SQL}
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        where += " AND b.branch_id = ?";
        params.push(branchId);
    }

    return { where, params };
}

async function getUpcomingBookings(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    const scope = upcomingBookingWhere({ storeId, branchId, startDate, endDate });

    const [bookingRows] = await connection.execute(
        `SELECT
            b.id,
            b.branch_id,
            br.branch_name,
            b.booking_reference,
            c.full_name AS customer_name,
            DATE_FORMAT(b.event_date, '%Y-%m-%d') AS event_date,
            COALESCE(TIME_FORMAT(b.event_time, '%H:%i'), '') AS event_time,
            b.status,
            CASE WHEN LOWER(b.booking_type) = 'package' THEN COALESCE(
                (SELECT pi.item_name_snapshot FROM booking_items pi
                 WHERE pi.booking_id = b.id AND pi.store_id = b.store_id AND pi.item_type = 'package'
                 ORDER BY pi.id LIMIT 1),
                pk.package_name, ''
            ) ELSE '' END AS package_name
        FROM bookings b
                 LEFT JOIN branches br
                           ON br.id = b.branch_id
                               AND br.store_id = b.store_id
                 LEFT JOIN customers c
                           ON c.id = b.customer_id
                               AND c.store_id = b.store_id
                 LEFT JOIN packages pk
                           ON pk.id = b.package_id
                               AND pk.store_id = b.store_id
        WHERE ${scope.where}
        ORDER BY b.event_date ASC, b.event_time ASC, b.id ASC`,
        scope.params
    );

    if (bookingRows.length === 0) {
        return [];
    }

    // Booked consumables (with their product) and rental equipment (no product id).
    const [allocationRows] = await connection.execute(
        `SELECT
            bi.booking_id,
            pv.product_id,
            bi.variant_id,
            CASE
                WHEN bi.variant_name_snapshot IS NOT NULL AND bi.variant_name_snapshot <> ''
                    THEN CONCAT(bi.item_name_snapshot, ' / ', bi.variant_name_snapshot)
                ELSE bi.item_name_snapshot
            END AS item_name,
            SUM(COALESCE(bi.quantity, 0)) AS quantity
        FROM booking_items bi
                 INNER JOIN bookings b
                            ON b.id = bi.booking_id
                                AND b.store_id = bi.store_id
                 LEFT JOIN product_variants pv
                           ON pv.id = bi.variant_id
                               AND pv.store_id = bi.store_id
        WHERE ${scope.where}
          AND ${BOOKED_ITEM_SQL}
        GROUP BY
            bi.booking_id,
            pv.product_id,
            bi.variant_id,
            item_name
        ORDER BY bi.booking_id ASC`,
        scope.params
    );

    const allocationsByBooking = new Map();

    allocationRows.forEach((row) => {
        const quantity = Math.max(0, toSafeNumber(row.quantity));

        if (quantity <= 0) {
            return;
        }

        const bookingId = Number(row.booking_id);
        const current = allocationsByBooking.get(bookingId) || [];

        current.push({
            productId: toPositiveInteger(row.product_id),
            variantId: toPositiveInteger(row.variant_id),
            quantity,
            itemName: String(row.item_name || "").trim(),
        });

        allocationsByBooking.set(bookingId, current);
    });

    return bookingRows.map((row) => ({
        id: Number(row.id),
        branchId: toPositiveInteger(row.branch_id),
        branchName: String(row.branch_name || "Unnamed Branch"),
        bookingReference: String(row.booking_reference || ""),
        customerName: String(row.customer_name || "Customer"),
        eventDate: toDateOnly(row.event_date),
        eventTime: String(row.event_time || ""),
        status: String(row.status || ""),
        packageName:
            String(row.package_name || "").trim() ||
            "Custom / Unspecified",
        allocations: allocationsByBooking.get(Number(row.id)) || [],
    }));
}

async function getUpcomingBookingAllocationSummary(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    /*
      Lightweight data for get_inventory_forecast: booking counts and the consumable
      quantities booked in the next period. The detailed booking forecast is its own action.
    */
    const scope = upcomingBookingWhere({ storeId, branchId, startDate, endDate });

    const countsQuery = `
        SELECT
            COUNT(*) AS expected_bookings,
            SUM(CASE WHEN LOWER(TRIM(b.status)) = 'preparing' THEN 1 ELSE 0 END) AS preparing_bookings,
            SUM(CASE WHEN LOWER(TRIM(b.status)) IN ('confirmed', 'released') THEN 1 ELSE 0 END) AS confirmed_bookings,
            SUM(
                CASE WHEN NOT EXISTS (
                    SELECT 1 FROM booking_items bi
                    WHERE bi.booking_id = b.id
                      AND bi.store_id = b.store_id
                      AND ${BOOKED_ITEM_SQL}
                ) THEN 1 ELSE 0 END
            ) AS bookings_without_allocation
        FROM bookings b
        WHERE ${scope.where}
    `;

    const allocationQuery = `
        SELECT
            pv.product_id,
            bi.variant_id,
            MAX(bi.item_name_snapshot) AS item_name,
            SUM(COALESCE(bi.quantity, 0)) AS quantity
        FROM bookings b
                 INNER JOIN booking_items bi
                            ON bi.booking_id = b.id
                                AND bi.store_id = b.store_id
                 INNER JOIN product_variants pv
                            ON pv.id = bi.variant_id
                                AND pv.store_id = bi.store_id
        WHERE ${scope.where}
          AND bi.item_type = 'consumable'
          AND bi.item_status <> 'cancelled'
        GROUP BY
            pv.product_id,
            bi.variant_id
        ORDER BY quantity DESC
    `;

    const [[countRows], [allocationRows]] = await Promise.all([
        connection.execute(countsQuery, scope.params),
        connection.execute(allocationQuery, scope.params),
    ]);

    const counts = countRows[0] || {};

    const allocatedInventory = allocationRows
        .map((row) => ({
            productId: toPositiveInteger(row.product_id),
            variantId: toPositiveInteger(row.variant_id),
            itemName: String(row.item_name || "").trim(),
            quantity: Math.max(0, toSafeNumber(row.quantity)),
        }))
        .filter((row) => row.productId && row.quantity > 0);

    const allocatedUnits = allocatedInventory.reduce(
        (total, row) => total + row.quantity,
        0
    );

    return {
        expectedBookings: toSafeNumber(counts.expected_bookings),
        confirmedBookings: toSafeNumber(counts.confirmed_bookings),
        preparingBookings: toSafeNumber(counts.preparing_bookings),
        allocationSummary: {
            allocatedUnits,
            allocationItems: allocatedInventory.length,
            bookingsWithoutAllocation: toSafeNumber(
                counts.bookings_without_allocation
            ),
            unlinkedAllocationEntries: 0,
        },
        allocatedInventory,
    };
}

function buildWeeklyDemandMap(inventoryItems, historicalSales, weekWindows) {
    const weekIndexByStart = new Map(
        weekWindows.map((week, index) => [week.startDate, index])
    );

    const demandMap = new Map();
    const inventoryByProduct = indexInventoryByProduct(inventoryItems);

    inventoryItems.forEach((item) => {
        demandMap.set(
            item.id,
            Array.from({ length: weekWindows.length }, () => 0)
        );
    });

    historicalSales.forEach((sale) => {
        if (!sale.productId || !sale.orderDate || sale.quantity <= 0) {
            return;
        }

        const saleDate = new Date(`${sale.orderDate}T00:00:00.000Z`);

        if (Number.isNaN(saleDate.getTime())) {
            return;
        }

        const saleWeekStart = toISODate(getStartOfWeekUTC(saleDate));
        const weekIndex = weekIndexByStart.get(saleWeekStart);

        if (weekIndex === undefined) {
            return;
        }

        const itemKey = resolveInventoryItemKey(
            inventoryByProduct,
            sale.branchId,
            sale.productId,
            sale.variantId
        );

        if (!itemKey) {
            return;
        }

        const currentDemand = demandMap.get(itemKey);

        if (currentDemand) {
            currentDemand[weekIndex] += toSafeNumber(sale.quantity);
        }
    });

    return demandMap;
}

module.exports = {
    ensureBranchBelongsToStore,
    getUserPermissions,
    getWeekWindows,
    getMonthRange,
    getUpcomingBookingRange,
    getInventoryItems,
    getHistoricalSales,
    getMonthlySalesSummary,
    getItemMonthlySalesSummary,
    getUpcomingBookings,
    getUpcomingBookingAllocationSummary,
    buildWeeklyDemandMap,
    buildItemMonthlySalesMap,
};
