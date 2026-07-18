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

function parseVariantName(rawValue) {
    if (!rawValue) {
        return "";
    }

    if (typeof rawValue === "object") {
        return Object.values(rawValue)
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(" / ");
    }

    const raw = String(rawValue).trim();

    try {
        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === "object") {
            return Object.values(parsed)
                .map((value) => String(value || "").trim())
                .filter(Boolean)
                .join(" / ");
        }
    } catch {
        // Raw text is already an acceptable variant name.
    }

    return raw;
}

function getInventoryKey(productId, variantId) {
    return `${productId}:${variantId || "product"}`;
}

/*
  Returns the inventory item's key for a POS line.

  Preferred behavior is an exact product + variant match. The fallback keeps
  older/demo POS records usable when they have a valid product_id but have
  no variant_id or an outdated variant_id.
*/
function resolveInventoryItemKey(
    inventoryByProduct,
    productId,
    variantId
) {
    const parsedProductId = toPositiveInteger(productId);

    if (!parsedProductId) {
        return null;
    }

    const candidates = inventoryByProduct.get(parsedProductId) || [];

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

    return (productLevelItem || candidates[0]).id;
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

    // Use completed calendar months only.
    // Example on July 1, 2026:
    // Start: July 1, 2025
    // End: June 30, 2026
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

function safeParseJSON(value) {
    if (!value) {
        return null;
    }

    if (typeof value === "object") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function readFirstText(object, keys = []) {
    if (!object || typeof object !== "object") {
        return "";
    }

    for (const key of keys) {
        const value = object[key];

        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }

    return "";
}

function getBookingAllocations(packagePayload) {
    const payload = safeParseJSON(packagePayload);

    if (!payload || typeof payload !== "object") {
        return [];
    }

    const inclusions = Array.isArray(payload.inclusions)
        ? payload.inclusions
        : Array.isArray(payload.items)
            ? payload.items
            : [];

    return inclusions
        .map((inclusion) => {
            const productId = toPositiveInteger(
                inclusion?.productId ??
                inclusion?.product_id ??
                inclusion?.id
            );

            const variantId = toPositiveInteger(
                inclusion?.variantId ?? inclusion?.variant_id
            );

            const quantity = Math.max(
                0,
                toSafeNumber(
                    inclusion?.quantity ??
                    inclusion?.qty ??
                    inclusion?.count ??
                    1
                )
            );

            const itemName = readFirstText(inclusion, [
                "item",
                "name",
                "productName",
                "product_name",
                "title",
            ]);

            if (quantity <= 0) {
                return null;
            }

            return {
                productId,
                variantId,
                quantity,
                itemName,
            };
        })
        .filter(Boolean);
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

async function getInventoryItems(connection, { storeId, branchId = null }) {
    let query = `
        SELECT
            p.id AS product_id,
            p.store_id,
            p.branch_id,
            p.name AS product_name,
            p.category,
            p.stock AS product_stock,
            p.alert_level AS product_alert_level,
            pv.id AS variant_id,
            pv.variant_values,
            pv.stock AS variant_stock,
            pv.alert_level AS variant_alert_level,
            b.branch_name
        FROM products p
                 LEFT JOIN product_variants pv
                           ON pv.product_id = p.id
                 LEFT JOIN branches b
                           ON b.id = p.branch_id
        WHERE p.store_id = ?
    `;

    const params = [storeId];

    if (branchId) {
        query += " AND p.branch_id = ?";
        params.push(branchId);
    }

    query += " ORDER BY p.name ASC, pv.id ASC";

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => {
        const productId = Number(row.product_id);
        const variantId = toPositiveInteger(row.variant_id);

        const isVariant = Boolean(variantId);
        const variantName = isVariant
            ? parseVariantName(row.variant_values) || "Variant"
            : null;

        const itemName = isVariant
            ? `${row.product_name} / ${variantName}`
            : String(row.product_name || "Unnamed Product");

        return {
            id: getInventoryKey(productId, variantId),
            productId,
            variantId,
            productName: String(row.product_name || ""),
            variantName,
            itemName,
            category: String(row.category || "Uncategorized"),
            branchId: Number(row.branch_id),
            branchName: String(row.branch_name || "Unnamed Branch"),
            isVariant,
            onHandQuantity: isVariant
                ? toSafeNumber(row.variant_stock)
                : toSafeNumber(row.product_stock),
            lowStockThreshold: isVariant
                ? toSafeNumber(row.variant_alert_level)
                : toSafeNumber(row.product_alert_level),
        };
    });
}

async function getHistoricalSales(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    /*
      Aggregate POS quantities by inventory item and calendar week inside
      MySQL. The previous query returned every order-item row and transferred
      a much larger result to Lambda. buildWeeklyDemandMap() accepts these
      Monday week-start dates without any other changes.
    */
    let query = `
        SELECT
            oi.product_id,
            oi.variant_id,
            SUM(oi.quantity) AS quantity,
            DATE_FORMAT(
                    DATE_SUB(DATE(o.order_date), INTERVAL WEEKDAY(o.order_date) DAY),
                    '%Y-%m-%d'
            ) AS order_date
        FROM orders o
                 INNER JOIN order_items oi
                            ON oi.order_id = o.order_id
        WHERE o.store_id = ?
          AND oi.product_id IS NOT NULL
          AND o.order_date BETWEEN ? AND ?
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY
            oi.product_id,
            oi.variant_id,
            DATE_SUB(DATE(o.order_date), INTERVAL WEEKDAY(o.order_date) DAY)
        ORDER BY order_date ASC
    `;

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
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
        WHERE o.store_id = ?
          AND oi.product_id IS NOT NULL
          AND o.order_date BETWEEN ? AND ?
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY DATE_FORMAT(o.order_date, '%Y-%m')
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
            oi.product_id,
            oi.variant_id,
            DATE_FORMAT(o.order_date, '%Y-%m') AS month_key,
            SUM(oi.quantity) AS total_units,
            COUNT(DISTINCT o.order_id) AS order_count
        FROM orders o
                 INNER JOIN order_items oi
                            ON oi.order_id = o.order_id
        WHERE o.store_id = ?
          AND oi.product_id IS NOT NULL
          AND o.order_date BETWEEN ? AND ?
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY
            oi.product_id,
            oi.variant_id,
            DATE_FORMAT(o.order_date, '%Y-%m')
        ORDER BY month_key ASC
    `;

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
        productId: toPositiveInteger(row.product_id),
        variantId: toPositiveInteger(row.variant_id),
        monthKey: String(row.month_key || ""),
        totalUnits: toSafeNumber(row.total_units),
        orderCount: toSafeNumber(row.order_count),
    }));
}

function buildItemMonthlySalesMap(inventoryItems, itemMonthlySales) {
    const monthlySalesMap = new Map();
    const inventoryByProduct = new Map();

    inventoryItems.forEach((item) => {
        monthlySalesMap.set(item.id, []);

        const productId = toPositiveInteger(item.productId);

        if (!productId) {
            return;
        }

        const currentItems = inventoryByProduct.get(productId) || [];
        currentItems.push(item);
        inventoryByProduct.set(productId, currentItems);
    });

    itemMonthlySales.forEach((sale) => {
        if (!sale.productId || !sale.monthKey) {
            return;
        }

        const itemKey = resolveInventoryItemKey(
            inventoryByProduct,
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

async function getUpcomingBookings(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    /*
      Exact booking_items schema used by this project:
      id, booking_id, product_id, variant_id, product_name, quantity,
      created_at, unit_price, line_total.

      Do not query reserved_quantity, booked_quantity, store_id, or branch_id
      from booking_items because those columns do not exist in this database.
    */
    let bookingQuery = `
        SELECT
            b.id,
            b.branch_id,
            br.branch_name,
            b.booking_reference,
            b.name,
            b.event_date,
            b.event_time,
            b.status,
            b.package_name
        FROM bookings b
                 LEFT JOIN branches br
                           ON br.id = b.branch_id
                               AND br.store_id = b.store_id
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
                                                      'confirmed',
                                                      'preparing',
                                                      'approved'
            )
    `;

    const bookingParams = [storeId, startDate, endDate];

    if (branchId) {
        bookingQuery += " AND b.branch_id = ?";
        bookingParams.push(branchId);
    }

    bookingQuery += " ORDER BY b.event_date ASC, b.event_time ASC, b.id ASC";

    const [bookingRows] = await connection.execute(
        bookingQuery,
        bookingParams
    );

    if (bookingRows.length === 0) {
        return [];
    }

    let allocationQuery = `
        SELECT
            bi.booking_id,
            bi.product_id,
            bi.variant_id,
            COALESCE(
                    NULLIF(TRIM(bi.product_name), ''),
                    NULLIF(TRIM(p.name), ''),
                    CONCAT('Product ', bi.product_id)
            ) AS item_name,
            SUM(COALESCE(bi.quantity, 0)) AS quantity
        FROM booking_items bi
                 INNER JOIN bookings b
                            ON b.id = bi.booking_id
                 LEFT JOIN products p
                           ON p.id = bi.product_id
                               AND p.store_id = b.store_id
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
                                                      'confirmed',
                                                      'preparing',
                                                      'approved'
            )
          AND bi.product_id IS NOT NULL
    `;

    const allocationParams = [storeId, startDate, endDate];

    if (branchId) {
        allocationQuery += " AND b.branch_id = ?";
        allocationParams.push(branchId);
    }

    allocationQuery += `
        GROUP BY
            bi.booking_id,
            bi.product_id,
            bi.variant_id,
            bi.product_name,
            p.name
        ORDER BY bi.booking_id ASC
    `;

    const [allocationRows] = await connection.execute(
        allocationQuery,
        allocationParams
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
        customerName: String(row.name || "Customer"),
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
      Lightweight data for get_inventory_forecast.

      The detailed booking forecast has its own API action, so the inventory
      request should not load every upcoming booking row and every allocation.
      This function returns only:
      - booking counts
      - product/variant quantities reserved by upcoming bookings
    */
    let bookingWhere = `
        FROM bookings b
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
              'confirmed',
              'preparing',
              'approved'
          )
    `;

    const bookingParams = [storeId, startDate, endDate];

    if (branchId) {
        bookingWhere += " AND b.branch_id = ?";
        bookingParams.push(branchId);
    }

    const countsQuery = `
        SELECT
            COUNT(*) AS expected_bookings,
            SUM(
                CASE
                    WHEN LOWER(TRIM(COALESCE(b.status, ''))) = 'preparing'
                        THEN 1
                    ELSE 0
                END
            ) AS preparing_bookings,
            SUM(
                CASE
                    WHEN LOWER(TRIM(COALESCE(b.status, ''))) IN (
                        'confirmed',
                        'approved'
                    )
                        THEN 1
                    ELSE 0
                END
            ) AS confirmed_bookings,
            SUM(
                CASE
                    WHEN NOT EXISTS (
                        SELECT 1
                        FROM booking_items bi
                        WHERE bi.booking_id = b.id
                    )
                        THEN 1
                    ELSE 0
                END
            ) AS bookings_without_allocation
        ${bookingWhere}
    `;

    let allocationQuery = `
        SELECT
            bi.product_id,
            bi.variant_id,
            COALESCE(
                MAX(NULLIF(TRIM(bi.product_name), '')),
                MAX(NULLIF(TRIM(p.name), '')),
                CONCAT('Product ', bi.product_id)
            ) AS item_name,
            SUM(COALESCE(bi.quantity, 0)) AS quantity
        FROM bookings b
        INNER JOIN booking_items bi
            ON bi.booking_id = b.id
        LEFT JOIN products p
            ON p.id = bi.product_id
           AND p.store_id = b.store_id
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
              'confirmed',
              'preparing',
              'approved'
          )
          AND bi.product_id IS NOT NULL
    `;

    const allocationParams = [storeId, startDate, endDate];

    if (branchId) {
        allocationQuery += " AND b.branch_id = ?";
        allocationParams.push(branchId);
    }

    allocationQuery += `
        GROUP BY
            bi.product_id,
            bi.variant_id
        ORDER BY quantity DESC
    `;

    const [[countRows], [allocationRows]] = await Promise.all([
        connection.execute(countsQuery, bookingParams),
        connection.execute(allocationQuery, allocationParams),
    ]);

    const counts = countRows[0] || {};

    const allocatedInventory = allocationRows
        .map((row) => ({
            productId: toPositiveInteger(row.product_id),
            variantId: toPositiveInteger(row.variant_id),
            itemName: String(row.item_name || "").trim(),
            quantity: Math.max(0, toSafeNumber(row.quantity)),
        }))
        .filter(
            (row) =>
                row.productId &&
                row.quantity > 0
        );

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
    const inventoryByProduct = new Map();

    inventoryItems.forEach((item) => {
        demandMap.set(
            item.id,
            Array.from({ length: weekWindows.length }, () => 0)
        );

        const productId = toPositiveInteger(item.productId);

        if (!productId) {
            return;
        }

        const currentItems = inventoryByProduct.get(productId) || [];
        currentItems.push(item);
        inventoryByProduct.set(productId, currentItems);
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