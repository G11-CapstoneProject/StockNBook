/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const fs = require("fs");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

// Reuse database connections across warm requests. This avoids paying the
// TCP/TLS/database handshake cost for every dashboard API call.
const dbPool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
});

function jsonResponse(statusCode, headers, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body),
    };
}

function badRequest(headers, message) {
    return jsonResponse(400, headers, { error: message });
}

function unauthorized(headers, message) {
    return jsonResponse(401, headers, { error: message });
}

function notFound(headers, message) {
    return jsonResponse(404, headers, { error: message });
}

function serverError(headers, error) {
    console.error("POS Lambda error:", error);

    return jsonResponse(500, headers, {
        error:
            error instanceof Error
                ? error.message
                : "Internal server error",
    });
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}


function normalizeCreditContact(value) {
    let digits = String(value ?? "").replace(/\D/g, "");

    if (digits.startsWith("63") && digits.length === 12) {
        digits = `0${digits.slice(2)}`;
    } else if (digits.length === 10 && digits.startsWith("9")) {
        digits = `0${digits}`;
    }

    return digits;
}

function isValidCreditContact(value) {
    const raw = String(value ?? "").trim();

    // Reject letters and unrelated symbols before normalization.
    if (!raw || !/^[+\d\s()-]+$/.test(raw)) {
        return false;
    }

    const normalized = normalizeCreditContact(raw);

    // Philippine mobile number: 09XXXXXXXXX after normalization.
    return /^09\d{9}$/.test(normalized);
}

function isPlaceholderCreditValue(value) {
    const normalized = String(value || "").trim().toLowerCase();

    return [
        "",
        "walk-in",
        "walk in",
        "customer",
        "n/a",
        "na",
        "none",
        "-",
    ].includes(normalized);
}

async function getOutstandingCreditForContact(
    connection,
    storeId,
    contactNumber
) {
    const normalizedContact = normalizeCreditContact(contactNumber);

    if (!normalizedContact) {
        return {
            matchedOrders: 0,
            outstandingBalance: 0,
            overdueBalance: 0,
            openOrders: 0,
            oldestDueDate: null,
        };
    }

    const internationalContact = normalizedContact.startsWith("0")
        ? `63${normalizedContact.slice(1)}`
        : normalizedContact;

    /*
     * Filter by the normalized contact in SQL so a credit check does not load
     * every credit transaction for a growing store into Node memory.
     * Existing data may be stored as 09..., +63..., or with spaces/dashes.
     */
    const normalizedContactSql = `
        REPLACE(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            REPLACE(COALESCE(o.customer_contact_number, ''), ' ', ''),
                            '+', ''
                        ),
                        '-', ''
                    ),
                    '(', ''
                ),
                ')', ''
            ),
            '.', ''
        )
    `;

    const [rows] = await connection.execute(
        `SELECT
             o.order_id,
             o.control_number,
             o.customer_contact_number,
             o.total,
             o.customer_payment,
             o.credit_due_date,
             COALESCE(SUM(cc.amount), 0) AS collected
         FROM orders AS o
                  LEFT JOIN credit_collections AS cc
                            ON cc.store_id = o.store_id
                                AND cc.order_id = o.order_id
         WHERE o.store_id = ?
           AND UPPER(COALESCE(o.payment_mode, '')) = 'CREDIT'
           AND o.customer_contact_number IS NOT NULL
           AND ${normalizedContactSql} IN (?, ?)
           AND LOWER(TRIM(COALESCE(o.status, ''))) NOT IN
               ('void', 'voided', 'cancelled', 'canceled', 'refunded')
         GROUP BY
             o.order_id,
             o.control_number,
             o.customer_contact_number,
             o.total,
             o.customer_payment,
             o.credit_due_date`,
        [storeId, normalizedContact, internationalContact]
    );

    const todayISO = getManilaISODate();

    let outstandingBalance = 0;
    let overdueBalance = 0;
    let openOrders = 0;
    let oldestDueDate = null;

    for (const row of rows) {
        const totalPaid = roundMoney(
            Number(row.customer_payment || 0) +
            Number(row.collected || 0)
        );

        const balance = roundMoney(
            Math.max(
                0,
                Number(row.total || 0) - totalPaid
            )
        );

        if (balance <= 0) {
            continue;
        }

        openOrders += 1;
        outstandingBalance = roundMoney(
            outstandingBalance + balance
        );

        const dueDate = row.credit_due_date
            ? toISODate(row.credit_due_date)
            : null;
        if (dueDate && (!oldestDueDate || dueDate < oldestDueDate)) {
            oldestDueDate = dueDate;
        }

        if (dueDate && dueDate < todayISO) {
            overdueBalance = roundMoney(
                overdueBalance + balance
            );
        }
    }

    return {
        matchedOrders: rows.length,
        outstandingBalance,
        overdueBalance,
        openOrders,
        oldestDueDate,
    };
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function toISODate(value) {
    const raw = toSafeString(value, 40);

    if (!raw) return null;

    const date = new Date(raw);

    if (!Number.isFinite(date.getTime())) {
        return null;
    }

    return date.toISOString().slice(0, 10);
}

function getManilaISODate(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value);

    const readPart = (type) =>
        parts.find((part) => part.type === type)?.value || "";

    return `${readPart("year")}-${readPart("month")}-${readPart("day")}`;
}

function shiftMonthStartISO(referenceDate, monthsBack) {
    const [year, month] = String(referenceDate || "")
        .split("-")
        .map(Number);

    const date = new Date(Date.UTC(year, month - 1 - monthsBack, 1));
    return date.toISOString().slice(0, 10);
}

function getOwnerDashboardPeriodStarts(referenceDate) {
    const [year, month] = String(referenceDate || "")
        .split("-")
        .map(Number);

    const monthIndex = Math.max(0, Math.min(11, (month || 1) - 1));
    const quarterStartMonth = Math.floor(monthIndex / 3) * 3;

    const format = (date) => date.toISOString().slice(0, 10);

    return {
        month: format(new Date(Date.UTC(year, monthIndex, 1))),
        quarter: format(new Date(Date.UTC(year, quarterStartMonth, 1))),
        year: format(new Date(Date.UTC(year, 0, 1))),
    };
}

const OWNER_DASHBOARD_EXCLUDED_STATUSES_SQL = `
    LOWER(TRIM(COALESCE(o.status, ''))) NOT IN (
        'pending',
        'pending payment',
        'unpaid',
        'cancelled',
        'canceled',
        'refunded',
        'void',
        'voided',
        'draft',
        'failed'
    )
`;

function normalizeDashboardNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildTopDashboardRows(rows, salesKey, unitsKey, limit = 8) {
    return rows
        .map((row) => ({
            key: `product:${String(row.name || "").trim().toLowerCase()}`,
            name: String(row.name || "Unnamed Product").trim() || "Unnamed Product",
            sales: normalizeDashboardNumber(row[salesKey]),
            units: normalizeDashboardNumber(row[unitsKey]),
        }))
        .filter((row) => row.sales > 0 || row.units > 0)
        .sort((a, b) => b.sales - a.sales)
        .slice(0, limit);
}

function monthStartFromISODate(value) {
    const date = toISODate(value);
    return date ? `${date.slice(0, 7)}-01` : null;
}

function nextMonthStartFromISODate(value) {
    const monthStart = monthStartFromISODate(value);
    if (!monthStart) return null;
    const [year, month] = monthStart.split("-").map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

// Dashboard summary tables turn large historical POS scans into small,
// incrementally-maintained aggregates. The migration in Data/ creates and
// backfills them. If it has not been run yet, the API safely falls back to the
// original live aggregation queries instead of breaking POS functionality.
let posSummaryTableAvailability = {
    checkedAt: 0,
    available: false,
};

async function hasPosDashboardSummaryTables(connection) {
    const now = Date.now();

    if (now - posSummaryTableAvailability.checkedAt < 30_000) {
        return posSummaryTableAvailability.available;
    }

    try {
        const [rows] = await connection.execute(
            `SELECT COUNT(DISTINCT table_name) AS tableCount
             FROM information_schema.tables
             WHERE table_schema = DATABASE()
               AND table_name IN ('pos_daily_summary', 'pos_product_monthly_summary')`
        );

        posSummaryTableAvailability = {
            checkedAt: now,
            available: Number(rows[0]?.tableCount || 0) === 2,
        };
    } catch (error) {
        console.warn(
            "Unable to check POS dashboard summary tables; using live aggregation fallback:",
            error?.message || error
        );
        posSummaryTableAvailability = {
            checkedAt: now,
            available: false,
        };
    }

    return posSummaryTableAvailability.available;
}

function aggregateSummaryItems(items) {
    const byProduct = new Map();

    for (const rawItem of Array.isArray(items) ? items : []) {
        const productId = toPositiveInteger(rawItem?.productId);
        if (!productId) continue;

        const key = String(productId);
        const existing = byProduct.get(key) || {
            productId,
            productName: toSafeString(rawItem?.productName, 255) || `Product #${productId}`,
            units: 0,
            sales: 0,
        };

        existing.units += Number(rawItem?.quantity || 0);
        existing.sales = roundMoney(existing.sales + Number(rawItem?.lineTotal || 0));
        byProduct.set(key, existing);
    }

    return Array.from(byProduct.values());
}

async function upsertPosDashboardSummary(
    connection,
    { storeId, branchId, orderDate, sales, cost, items }
) {
    if (!(await hasPosDashboardSummaryTables(connection))) return;

    await connection.execute(
        `INSERT INTO pos_daily_summary
         (store_id, branch_id, summary_date, gross_sales, cost_of_sales, transaction_count)
         VALUES (?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
                                  gross_sales = gross_sales + VALUES(gross_sales),
                                  cost_of_sales = cost_of_sales + VALUES(cost_of_sales),
                                  transaction_count = transaction_count + 1,
                                  updated_at = CURRENT_TIMESTAMP`,
        [storeId, branchId, orderDate, roundMoney(sales), roundMoney(cost)]
    );

    const productRows = aggregateSummaryItems(items);
    if (productRows.length === 0) return;

    const placeholders = productRows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
    const values = [];
    const monthStart = monthStartFromISODate(orderDate);

    for (const row of productRows) {
        values.push(
            storeId,
            branchId,
            monthStart,
            row.productId,
            row.productName,
            Math.max(0, Number(row.units || 0)),
            roundMoney(row.sales)
        );
    }

    await connection.execute(
        `INSERT INTO pos_product_monthly_summary
         (store_id, branch_id, month_start, product_id, product_name, units_sold, sales_amount)
         VALUES ${placeholders}
             ON DUPLICATE KEY UPDATE
                                  product_name = VALUES(product_name),
                                  units_sold = units_sold + VALUES(units_sold),
                                  sales_amount = sales_amount + VALUES(sales_amount),
                                  updated_at = CURRENT_TIMESTAMP`,
        values
    );
}

async function rebuildPosDashboardSummaryForDay(
    connection,
    storeId,
    branchId,
    summaryDate
) {
    if (!(await hasPosDashboardSummaryTables(connection))) return;

    await connection.execute(
        `DELETE FROM pos_daily_summary
         WHERE store_id = ? AND branch_id = ? AND summary_date = ?`,
        [storeId, branchId, summaryDate]
    );

    await connection.execute(
        `DELETE FROM pos_product_monthly_summary
         WHERE store_id = ? AND branch_id = ? AND month_start = ?`,
        [storeId, branchId, monthStartFromISODate(summaryDate)]
    );

    await connection.execute(
        `INSERT INTO pos_daily_summary
         (store_id, branch_id, summary_date, gross_sales, cost_of_sales, transaction_count)
         SELECT
             o.store_id,
             o.branch_id,
             o.order_date,
             SUM(o.total) AS gross_sales,
             SUM(COALESCE(item_cost.cost, o.total)) AS cost_of_sales,
             COUNT(*) AS transaction_count
         FROM orders o
                  LEFT JOIN (
             SELECT
                 oi.store_id,
                 oi.order_id,
                 SUM(
                         COALESCE(
                                 oi.cost_price_at_sale,
                                 CASE
                                     WHEN oi.variant_id IS NOT NULL
                                         THEN COALESCE(pv.original_price, p.original_price, 0)
                                     ELSE COALESCE(p.original_price, 0)
                                     END,
                                 0
                         ) * oi.quantity
                 ) AS cost
             FROM order_items oi
                      INNER JOIN orders io
                                 ON io.store_id = oi.store_id
                                     AND io.order_id = oi.order_id
                      LEFT JOIN products p
                                ON p.id = oi.product_id
                                    AND p.store_id = oi.store_id
                      LEFT JOIN product_variants pv
                                ON pv.id = oi.variant_id
                                    AND pv.product_id = oi.product_id
             WHERE io.store_id = ?
               AND io.branch_id = ?
               AND io.order_date = ?
               AND LOWER(TRIM(COALESCE(io.status, ''))) NOT IN (
                                                                'pending', 'pending payment', 'unpaid', 'cancelled', 'canceled',
                                                                'refunded', 'void', 'voided', 'draft', 'failed'
                 )
             GROUP BY oi.store_id, oi.order_id
         ) item_cost
                            ON item_cost.store_id = o.store_id
                                AND item_cost.order_id = o.order_id
         WHERE o.store_id = ?
           AND o.branch_id = ?
           AND o.order_date = ?
           AND ${OWNER_DASHBOARD_EXCLUDED_STATUSES_SQL}
         GROUP BY o.store_id, o.branch_id, o.order_date`,
        [storeId, branchId, summaryDate, storeId, branchId, summaryDate]
    );

    const monthStart = monthStartFromISODate(summaryDate);
    const nextMonthStart = nextMonthStartFromISODate(summaryDate);

    await connection.execute(
        `INSERT INTO pos_product_monthly_summary
         (store_id, branch_id, month_start, product_id, product_name, units_sold, sales_amount)
         SELECT
             o.store_id,
             o.branch_id,
             ?,
             oi.product_id,
             MAX(oi.product_name) AS product_name,
             SUM(oi.quantity) AS units_sold,
             SUM(oi.line_total) AS sales_amount
         FROM orders o
                  INNER JOIN order_items oi
                             ON oi.store_id = o.store_id
                                 AND oi.order_id = o.order_id
         WHERE o.store_id = ?
           AND o.branch_id = ?
           AND o.order_date >= ?
           AND o.order_date < ?
           AND ${OWNER_DASHBOARD_EXCLUDED_STATUSES_SQL}
         GROUP BY o.store_id, o.branch_id, oi.product_id`,
        [monthStart, storeId, branchId, monthStart, nextMonthStart]
    );
}


async function getNextAvailablePosOrderId(
    connection,
    storeId,
    orderDate,
    requestedOrderId
) {
    const requested = toSafeString(requestedOrderId, 255);

    if (!requested) {
        return "";
    }

    /*
     * Frontend IDs normally look like:
     * HAPPY-POS-20260819-01
     *
     * The frontend may only have one branch's orders loaded, while order_id
     * is the PRIMARY KEY for the entire orders table. Therefore the backend
     * must choose the final sequence using ALL orders for this store/date.
     */
    const sequenceMatch = requested.match(/^(.*)-(\d+)$/);

    const baseId = sequenceMatch
        ? sequenceMatch[1]
        : requested;

    const requestedSequence =
        sequenceMatch && Number.isFinite(Number(sequenceMatch[2]))
            ? Math.max(1, Number(sequenceMatch[2]))
            : 1;

    const [rows] = await connection.execute(
        `SELECT order_id AS orderId
         FROM orders
         WHERE store_id = ?
           AND order_date = ?`,
        [storeId, orderDate]
    );

    const escapedBase = baseId.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );

    const sequencePattern = new RegExp(
        `^${escapedBase}-(\\d+)$`,
        "i"
    );

    let maxSequence = 0;

    for (const row of rows) {
        const existingId = String(row.orderId || "").trim();
        const match = existingId.match(sequencePattern);

        if (!match) {
            continue;
        }

        const sequence = Number(match[1]);

        if (
            Number.isFinite(sequence) &&
            sequence > maxSequence
        ) {
            maxSequence = sequence;
        }
    }

    const nextSequence = Math.max(
        requestedSequence,
        maxSequence + 1
    );

    return `${baseId}-${String(nextSequence).padStart(2, "0")}`;
}

async function getNextAvailableControlNumber(connection, orderDate) {
    const compactDate = String(orderDate || "")
        .replace(/[^0-9]/g, "")
        .slice(0, 8);

    const prefix = `INV-${compactDate}-`;

    const [rows] = await connection.execute(
        `SELECT control_number AS controlNumber
         FROM orders
         WHERE control_number LIKE ?`,
        [`${prefix}%`]
    );

    let maxSequence = 0;

    for (const row of rows) {
        const value = String(row.controlNumber || "").trim();
        const match = value.match(new RegExp(`^${prefix}(\\d+)$`, "i"));

        if (!match) continue;

        const sequence = Number(match[1]);
        if (Number.isFinite(sequence)) {
            maxSequence = Math.max(maxSequence, sequence);
        }
    }

    return `${prefix}${String(maxSequence + 1).padStart(5, "0")}`;
}

function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function addDaysToISODate(isoDate, days) {
    const parsed = new Date(`${isoDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime())) return null;
    parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
    return parsed.toISOString().slice(0, 10);
}

function normalizeAction(value) {
    return toSafeString(value, 80)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

function getOrderLines(body) {
    const items =
        body.items ||
        body.order_items ||
        body.orderItems ||
        body.cart ||
        body.cartItems;

    if (Array.isArray(items)) {
        return items;
    }

    if (
        body.product_id ||
        body.productId ||
        body.variant_id ||
        body.variantId ||
        body.item
    ) {
        return [body];
    }

    return [];
}

function getProductId(line) {
    return toPositiveInteger(
        line.product_id ??
        line.productId ??
        line.product?.id
    );
}

function getVariantId(line) {
    return toPositiveInteger(
        line.variant_id ??
        line.variantId ??
        line.product_variant_id ??
        line.productVariantId ??
        line.variant?.id
    );
}

function getProductName(line) {
    return toSafeString(
        line.product_name ??
        line.productName ??
        line.item_name ??
        line.product?.name ??
        line.name ??
        line.item ??
        "",
        150
    );
}

function getVariantName(line) {
    return toSafeString(
        line.variant_name ??
        line.variantName ??
        line.variant_label ??
        line.variantLabel ??
        line.variant ??
        line.option ??
        line.size ??
        "",
        150
    );
}

function formatOrderItems(items) {
    if (!Array.isArray(items)) {
        return "";
    }

    return items
        .map((line) => {
            const productName =
                getProductName(line) ||
                `Product #${getProductId(line) || ""}`;

            const variantName = getVariantName(line);

            const quantity =
                toPositiveInteger(line.quantity ?? line.qty) || 1;

            return `${productName}${variantName ? ` - ${variantName}` : ""} x${quantity}`;
        })
        .filter(Boolean)
        .join(", ");
}

function formatVariantValues(value) {
    if (!value) return "";

    let parsed = value;

    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return toSafeString(parsed, 150);
        }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return "";
    }

    return Object.values(parsed)
        .map((entry) => toSafeString(entry, 80))
        .filter(Boolean)
        .join(" / ")
        .slice(0, 150);
}

async function getSellableBatchQuantity(
    connection,
    inventoryId,
    saleDate
) {
    const [rows] = await connection.execute(
        `SELECT COALESCE(SUM(remaining_quantity), 0) AS sellableQuantity
         FROM inventory_batches
         WHERE branch_inventory_id = ?
           AND remaining_quantity > 0
           AND status = 'active'
           AND (expiration_date IS NULL OR expiration_date >= ?)`,
        [inventoryId, saleDate]
    );

    return Math.max(0, Number(rows[0]?.sellableQuantity || 0));
}

async function resolveAuthoritativeOrderLines(
    connection,
    storeId,
    branchId,
    rawItems,
    saleDate
) {
    const resolved = [];

    for (const rawLine of rawItems) {
        const productId = getProductId(rawLine);
        const variantId = getVariantId(rawLine);
        const quantity = toPositiveInteger(rawLine.quantity ?? rawLine.qty);

        if (!productId) {
            throw new Error("Each POS item must include a valid product_id.");
        }

        if (!quantity) {
            throw new Error("Each POS item must include a valid quantity.");
        }

        let rows;

        if (variantId) {
            [rows] = await connection.execute(
                `SELECT
                     p.id AS productId,
                     p.name AS productName,
                     pv.id AS variantId,
                     pv.variant_values AS variantValues,
                     COALESCE(NULLIF(bi.sales_price, 0), NULLIF(pv.sales_price, 0), NULLIF(p.sales_price, 0), 0) AS salesPrice,
                     bi.id AS inventoryId,
                     bi.quantity_on_hand AS quantityOnHand
                 FROM products p
                          INNER JOIN product_variants pv
                                     ON pv.product_id = p.id
                                         AND pv.id = ?
                          LEFT JOIN branch_inventory bi
                                    ON bi.store_id = p.store_id
                                        AND bi.branch_id = p.branch_id
                                        AND bi.product_id = p.id
                                        AND bi.variant_id = pv.id
                                        AND bi.status = 'active'
                 WHERE p.id = ?
                   AND p.store_id = ?
                   AND p.branch_id = ?
                     LIMIT 1`,
                [variantId, productId, storeId, branchId]
            );
        } else {
            [rows] = await connection.execute(
                `SELECT
                     p.id AS productId,
                     p.name AS productName,
                     NULL AS variantId,
                     NULL AS variantValues,
                     COALESCE(NULLIF(bi.sales_price, 0), NULLIF(p.sales_price, 0), 0) AS salesPrice,
                     bi.id AS inventoryId,
                     bi.quantity_on_hand AS quantityOnHand
                 FROM products p
                          LEFT JOIN branch_inventory bi
                                    ON bi.store_id = p.store_id
                                        AND bi.branch_id = p.branch_id
                                        AND bi.product_id = p.id
                                        AND bi.variant_id IS NULL
                                        AND bi.status = 'active'
                 WHERE p.id = ?
                   AND p.store_id = ?
                   AND p.branch_id = ?
                     LIMIT 1`,
                [productId, storeId, branchId]
            );
        }

        if (!rows.length) {
            throw new Error(
                `Product ${productId}${variantId ? ` variant ${variantId}` : ""} is not available in this branch.`
            );
        }

        const row = rows[0];
        const inventoryId = toPositiveInteger(row.inventoryId);

        if (!inventoryId) {
            throw new Error(
                `Database V2 inventory is missing for ${row.productName || `product ${productId}`}. Run the V2 backfill/verification.`
            );
        }

        const quantityOnHand = Math.max(0, Number(row.quantityOnHand || 0));
        if (quantityOnHand < quantity) {
            throw new Error(
                `Not enough stock for ${row.productName || `product ${productId}`}. Available: ${quantityOnHand}, needed: ${quantity}.`
            );
        }

        const sellableQuantity = await getSellableBatchQuantity(
            connection,
            inventoryId,
            saleDate
        );

        if (sellableQuantity < quantity) {
            throw new Error(
                `Not enough non-expired stock for ${row.productName || `product ${productId}`}. Sellable: ${sellableQuantity}, needed: ${quantity}.`
            );
        }

        const unitPrice = roundMoney(row.salesPrice);
        const variantName = variantId
            ? formatVariantValues(row.variantValues) || getVariantName(rawLine) || `Variant #${variantId}`
            : "";

        resolved.push({
            product_id: productId,
            variant_id: variantId || null,
            product_name: toSafeString(row.productName, 150) || `Product #${productId}`,
            variant_name: variantName,
            quantity,
            unit_price: unitPrice,
            item_name: `${toSafeString(row.productName, 150) || `Product #${productId}`}${variantName ? `/${variantName}` : ""}`,
        });
    }

    return resolved;
}

async function ensureStoreExists(connection, storeId) {
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
        return false;
    }

    const [rows] = await connection.execute(
        "SELECT id FROM stores WHERE id = ? LIMIT 1",
        [parsedStoreId]
    );

    return rows.length > 0;
}

async function ensureBranchBelongsToStore(
    connection,
    branchId,
    storeId
) {
    const parsedBranchId = Number(branchId);
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedBranchId) || parsedBranchId <= 0) {
        return false;
    }

    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
        return false;
    }

    const [rows] = await connection.execute(
        "SELECT id FROM branches WHERE id = ? AND store_id = ? LIMIT 1",
        [parsedBranchId, parsedStoreId]
    );

    return rows.length > 0;
}

async function insertOrderItems(
    connection,
    orderId,
    storeId,
    branchId,
    items
) {
    const dashboardItems = [];
    let totalCost = 0;

    for (const line of items) {
        const productId = getProductId(line);
        const variantId = getVariantId(line);
        const quantity = toPositiveInteger(line.quantity ?? line.qty);
        const productName = getProductName(line) || `Product #${productId || ""}`;
        const unitPrice =
            toNumber(
                line.unit_price ??
                line.unitPrice ??
                line.price ??
                line.sales_price ??
                line.salesPrice
            ) ?? 0;

        if (!productId) {
            throw new Error("Each POS item must include a valid product_id.");
        }
        if (!quantity) {
            throw new Error("Each POS item must include a valid quantity.");
        }

        let costPriceAtSale = 0;

        if (variantId) {
            const [costRows] = await connection.execute(
                `SELECT COALESCE(pv.original_price, p.original_price, 0) AS costPrice
                 FROM product_variants pv
                          INNER JOIN products p
                                     ON p.id = pv.product_id
                                         AND p.store_id = ?
                                         AND p.branch_id = ?
                 WHERE pv.id = ?
                   AND pv.product_id = ?
                     LIMIT 1`,
                [storeId, branchId, variantId, productId]
            );
            costPriceAtSale = roundMoney(costRows[0]?.costPrice ?? 0);
        } else {
            const [costRows] = await connection.execute(
                `SELECT COALESCE(original_price, 0) AS costPrice
                 FROM products
                 WHERE id = ? AND store_id = ? AND branch_id = ?
                     LIMIT 1`,
                [productId, storeId, branchId]
            );
            costPriceAtSale = roundMoney(costRows[0]?.costPrice ?? 0);
        }

        const lineTotal = roundMoney(unitPrice * quantity);

        await connection.execute(
            `INSERT INTO order_items
             (order_id, store_id, branch_id, product_id, variant_id, product_name,
              quantity, unit_price, line_total, cost_price_at_sale)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderId,
                storeId,
                branchId,
                productId,
                variantId || null,
                productName,
                quantity,
                unitPrice,
                lineTotal,
                costPriceAtSale,
            ]
        );

        const lineCost = roundMoney(costPriceAtSale * quantity);
        totalCost = roundMoney(totalCost + lineCost);
        dashboardItems.push({
            productId,
            productName,
            quantity,
            lineTotal,
        });
    }

    return {
        totalCost,
        items: dashboardItems,
    };
}


async function loadOrderItemsForOrders(connection, storeId, orderIds) {
    const safeOrderIds = Array.from(
        new Set(
            (Array.isArray(orderIds) ? orderIds : [])
                .map((value) => toSafeString(value, 100))
                .filter(Boolean)
        )
    );

    if (safeOrderIds.length === 0) {
        return new Map();
    }

    const byOrderId = new Map();

    /*
     * IMPORTANT:
     * Do not send thousands of order IDs in one huge IN (...) query.
     * MySQL may create large temporary files for that query and can fail
     * with OS errno 28: "No space left on device".
     *
     * Loading the items in small batches keeps the SQL statement and
     * MySQL temporary-file usage under control while preserving the
     * exact same result.
     */
    const CHUNK_SIZE = 200;

    for (
        let start = 0;
        start < safeOrderIds.length;
        start += CHUNK_SIZE
    ) {
        const chunk = safeOrderIds.slice(
            start,
            start + CHUNK_SIZE
        );

        const placeholders = chunk
            .map(() => "?")
            .join(",");

        const [rows] = await connection.execute(
            `SELECT
                 oi.order_id AS orderId,
                 oi.product_id AS productId,
                 oi.variant_id AS variantId,
                 oi.product_name AS name,
                 oi.quantity,
                 oi.unit_price AS unitPrice,
                 oi.line_total AS lineTotal,
                 COALESCE(
                         oi.cost_price_at_sale,
                         CASE
                             WHEN oi.variant_id IS NOT NULL
                                 THEN COALESCE(pv.original_price, p.original_price, 0)
                             ELSE COALESCE(p.original_price, 0)
                             END,
                         0
                 ) AS costPrice
             FROM order_items oi
                      LEFT JOIN products p
                                ON p.id = oi.product_id
                                    AND p.store_id = oi.store_id
                      LEFT JOIN product_variants pv
                                ON pv.id = oi.variant_id
                                    AND pv.product_id = oi.product_id
             WHERE oi.store_id = ?
               AND oi.order_id IN (${placeholders})
             ORDER BY oi.order_id ASC, oi.id ASC`,
            [storeId, ...chunk]
        );

        for (const row of rows) {
            const orderId = String(
                row.orderId || ""
            );

            if (!byOrderId.has(orderId)) {
                byOrderId.set(
                    orderId,
                    []
                );
            }

            byOrderId.get(orderId).push({
                productId:
                    row.productId == null
                        ? null
                        : Number(row.productId),

                variantId:
                    row.variantId == null
                        ? null
                        : Number(row.variantId),

                name: String(
                    row.name || ""
                ),

                quantity: Number(
                    row.quantity || 0
                ),

                unitPrice: Number(
                    row.unitPrice || 0
                ),

                lineTotal: Number(
                    row.lineTotal || 0
                ),

                costPrice: Number(
                    row.costPrice || 0
                ),
            });
        }
    }

    return byOrderId;
}


async function getV2InventoryForUpdate(connection, storeId, branchId, productId, variantId) {
    const [rows] = await connection.execute(
        `SELECT id, store_id, branch_id, product_id, variant_id,
                quantity_on_hand, cost_price
         FROM branch_inventory
         WHERE store_id = ?
           AND branch_id = ?
           AND product_id = ?
           AND variant_id <=> ?
           AND status = 'active'
         LIMIT 1
         FOR UPDATE`,
        [storeId, branchId, productId, variantId || null]
    );

    return rows[0] || null;
}

async function consumeV2Batches(connection, inventoryId, quantity, saleDate) {
    let remaining = Math.max(0, Number(quantity || 0));
    if (remaining <= 0) return;

    const [batches] = await connection.execute(
        `SELECT id, remaining_quantity
         FROM inventory_batches
         WHERE branch_inventory_id = ?
           AND remaining_quantity > 0
           AND status = 'active'
           AND (expiration_date IS NULL OR expiration_date >= ?)
         ORDER BY (expiration_date IS NULL) ASC,
                  expiration_date ASC,
                  received_at ASC,
                  id ASC
             FOR UPDATE`,
        [inventoryId, saleDate]
    );

    for (const batch of batches) {
        if (remaining <= 0) break;
        const available = Math.max(0, Number(batch.remaining_quantity || 0));
        const take = Math.min(available, remaining);
        if (take <= 0) continue;

        await connection.execute(
            `UPDATE inventory_batches
             SET remaining_quantity = remaining_quantity - ?,
                 status = CASE WHEN remaining_quantity - ? <= 0 THEN 'depleted' ELSE status END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [take, take, batch.id]
        );
        remaining -= take;
    }

    if (remaining > 0) {
        throw new Error(
            `Database V2 batch balance is short by ${remaining} unit(s) for inventory #${inventoryId}. ` +
            `Run the V2 verification/backfill before processing POS transactions.`
        );
    }
}

async function decreaseV2Inventory(connection, options) {
    const row = await getV2InventoryForUpdate(
        connection,
        options.storeId,
        options.branchId,
        options.productId,
        options.variantId
    );

    if (!row) {
        throw new Error(
            `Database V2 inventory row is missing for product ${options.productId}` +
            `${options.variantId ? ` variant ${options.variantId}` : ""}. Run the V2 backfill/verification.`
        );
    }

    const before = Number(row.quantity_on_hand || 0);
    const quantity = Math.max(0, Number(options.quantity || 0));

    if (before < quantity) {
        throw new Error(
            `Database V2 stock mismatch for product ${options.productId}. Available: ${before}, needed: ${quantity}.`
        );
    }

    const after = before - quantity;
    const saleDate =
        toISODate(options.saleDate) || getManilaISODate();

    await consumeV2Batches(
        connection,
        row.id,
        quantity,
        saleDate
    );

    await connection.execute(
        `UPDATE branch_inventory
         SET quantity_on_hand = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [after, row.id]
    );

    const actor = options.actor || { id: null, role: "SYSTEM", name: "StockNBook" };
    await connection.execute(
        `INSERT INTO inventory_movements
         (store_id, branch_id, branch_inventory_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, actor_id, actor_role, actor_name, notes)
         VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            options.storeId,
            options.branchId,
            row.id,
            -quantity,
            before,
            after,
            options.referenceType || "POS_ORDER",
            options.referenceId != null ? String(options.referenceId) : null,
            actor.id ?? null,
            actor.role || null,
            actor.name || null,
            options.notes || "POS inventory deduction during Database V2 dual-write.",
        ]
    );
}

async function decreaseStockForOrder(
    connection,
    storeId,
    branchId,
    items,
    movementContext = {}
) {
    for (const line of items) {
        const quantity =
            toPositiveInteger(line.quantity ?? line.qty) || 1;

        const productId = getProductId(line);
        const variantId = getVariantId(line);
        const productName = getProductName(line);

        if (!productId) {
            throw new Error(
                `Missing product_id for "${productName || "POS item"}".`
            );
        }

        if (variantId) {
            const [result] = await connection.execute(
                `UPDATE product_variants pv
                     INNER JOIN products p
                 ON p.id = pv.product_id
                     SET
                         pv.stock = pv.stock - ?,
                         p.stock = p.stock - ?
                 WHERE pv.id = ?
                   AND p.id = ?
                   AND p.store_id = ?
                   AND p.branch_id = ?
                   AND pv.stock >= ?
                   AND p.stock >= ?`,
                [
                    quantity,
                    quantity,
                    variantId,
                    productId,
                    storeId,
                    branchId,
                    quantity,
                    quantity,
                ]
            );

            if (result.affectedRows === 0) {
                throw new Error(
                    `Insufficient stock or invalid variant for "${productName}".`
                );
            }

            await decreaseV2Inventory(connection, {
                storeId,
                branchId,
                productId,
                variantId,
                quantity,
                saleDate: movementContext.saleDate,
                ...movementContext,
                notes: `POS sale: ${productName || `Product #${productId}`} (variant ${variantId}) x${quantity}`,
            });

            continue;
        }

        const [result] = await connection.execute(
            `UPDATE products
             SET stock = stock - ?
             WHERE id = ?
               AND store_id = ?
               AND branch_id = ?
               AND stock >= ?`,
            [
                quantity,
                productId,
                storeId,
                branchId,
                quantity,
            ]
        );

        if (result.affectedRows === 0) {
            throw new Error(
                `Insufficient stock or invalid product for "${productName || productId}".`
            );
        }

        await decreaseV2Inventory(connection, {
            storeId,
            branchId,
            productId,
            variantId: null,
            quantity,
            saleDate: movementContext.saleDate,
            ...movementContext,
            notes: `POS sale: ${productName || `Product #${productId}`} x${quantity}`,
        });
    }
}

async function restoreV2Batches(connection, inventoryRow, quantity, orderId) {
    let remaining = Math.max(0, Number(quantity || 0));
    if (remaining <= 0) return;

    /*
     * POS sales consume batches in FEFO order. A void restores quantity into
     * existing batch capacity (received_quantity - remaining_quantity) first,
     * preserving each batch's original expiry instead of inventing a fresh lot.
     */
    const [batches] = await connection.execute(
        `SELECT id, received_quantity, remaining_quantity, expiration_date
         FROM inventory_batches
         WHERE branch_inventory_id = ?
         ORDER BY (expiration_date IS NULL) ASC,
                  expiration_date ASC,
                  received_at ASC,
                  id ASC
             FOR UPDATE`,
        [inventoryRow.id]
    );

    for (const batch of batches) {
        if (remaining <= 0) break;

        const received = Math.max(0, Number(batch.received_quantity || 0));
        const current = Math.max(0, Number(batch.remaining_quantity || 0));
        const restorable = Math.max(0, received - current);
        const restore = Math.min(restorable, remaining);

        if (restore <= 0) continue;

        await connection.execute(
            `UPDATE inventory_batches
             SET remaining_quantity = remaining_quantity + ?,
                 status = CASE
                              WHEN expiration_date IS NOT NULL
                                  AND expiration_date < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))
                 THEN 'expired'
                 ELSE 'active'
            END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [restore, batch.id]
        );

        remaining -= restore;
    }

    if (remaining > 0) {
        /*
         * Fallback only for older/inconsistent demo data where the original
         * batch capacity is unavailable. The reconciliation batch keeps V2
         * quantity totals consistent and is clearly identifiable for audits.
         */
        const batchCode = `V2-POS-VOID-RECON-${orderId}-${inventoryRow.id}`.slice(0, 100);
        await connection.execute(
            `INSERT INTO inventory_batches
             (store_id, branch_id, branch_inventory_id, batch_code,
              received_quantity, remaining_quantity, unit_cost, received_at,
              expiration_date, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, 'active')`,
            [
                inventoryRow.store_id,
                inventoryRow.branch_id,
                inventoryRow.id,
                batchCode,
                remaining,
                remaining,
                Number(inventoryRow.cost_price || 0),
            ]
        );
    }
}

async function restoreStockForVoidedOrder(
    connection,
    storeId,
    branchId,
    orderId,
    actor
) {
    const [lines] = await connection.execute(
        `SELECT
             oi.product_id AS productId,
             oi.variant_id AS variantId,
             MAX(oi.product_name) AS productName,
             SUM(oi.quantity) AS quantity
         FROM order_items oi
         WHERE oi.store_id = ?
           AND oi.branch_id = ?
           AND oi.order_id = ?
         GROUP BY oi.product_id, oi.variant_id`,
        [storeId, branchId, orderId]
    );

    if (lines.length === 0) {
        throw new Error(
            "This POS transaction has no item-level inventory records, so it cannot be safely voided automatically."
        );
    }

    for (const line of lines) {
        const productId = toPositiveInteger(line.productId);
        const variantId = toPositiveInteger(line.variantId);
        const quantity = Math.max(0, Number(line.quantity || 0));
        const productName = toSafeString(line.productName, 255) || `Product #${productId}`;

        if (!productId || quantity <= 0) continue;

        if (variantId) {
            const [legacyResult] = await connection.execute(
                `UPDATE product_variants pv
                     INNER JOIN products p ON p.id = pv.product_id
                     SET pv.stock = pv.stock + ?,
                         p.stock = p.stock + ?
                 WHERE pv.id = ?
                   AND p.id = ?
                   AND p.store_id = ?
                   AND p.branch_id = ?`,
                [quantity, quantity, variantId, productId, storeId, branchId]
            );

            if (legacyResult.affectedRows === 0) {
                throw new Error(`Unable to restore stock for "${productName}".`);
            }

        } else {
            const [legacyResult] = await connection.execute(
                `UPDATE products
                 SET stock = stock + ?
                 WHERE id = ? AND store_id = ? AND branch_id = ?`,
                [quantity, productId, storeId, branchId]
            );

            if (legacyResult.affectedRows === 0) {
                throw new Error(`Unable to restore stock for "${productName}".`);
            }

        }

        const inventoryRow = await getV2InventoryForUpdate(
            connection,
            storeId,
            branchId,
            productId,
            variantId
        );

        if (!inventoryRow) {
            throw new Error(
                `Database V2 inventory row is missing while voiding "${productName}".`
            );
        }

        const before = Number(inventoryRow.quantity_on_hand || 0);
        const after = before + quantity;

        await restoreV2Batches(
            connection,
            inventoryRow,
            quantity,
            orderId
        );

        await connection.execute(
            `UPDATE branch_inventory
             SET quantity_on_hand = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [after, inventoryRow.id]
        );

        await connection.execute(
            `INSERT INTO inventory_movements
             (store_id, branch_id, branch_inventory_id, movement_type,
              quantity_delta, quantity_before, quantity_after,
              reference_type, reference_id, actor_id, actor_role, actor_name, notes)
             VALUES (?, ?, ?, 'POS_VOID', ?, ?, ?, 'POS_VOID', ?, ?, ?, ?, ?)`,
            [
                storeId,
                branchId,
                inventoryRow.id,
                quantity,
                before,
                after,
                String(orderId),
                actor?.id ?? null,
                actor?.role || null,
                actor?.name || null,
                `POS void stock restoration: ${productName} x${quantity}`,
            ]
        );
    }
}

/*
 * The JWT issued at login only carries ids (store_id / manager_id /
 * staff_id) and an email — never a display name. To log a real,
 * human-readable employee_actions row we look the acting user's name up
 * from their own table using the id that's already in the token.
 */
async function getActingEmployee(connection, decoded) {
    const role = String(decoded?.role || "").toLowerCase();
    const storeId = toPositiveInteger(decoded?.store_id);

    if (role === "manager" && toPositiveInteger(decoded?.manager_id)) {
        const [rows] = await connection.execute(
            `SELECT manager_name FROM managers WHERE id = ? AND store_id = ? LIMIT 1`,
            [toPositiveInteger(decoded.manager_id), storeId]
        );

        return {
            id: toPositiveInteger(decoded.manager_id),
            name: toSafeString(rows[0]?.manager_name, 255) || "Manager",
            role: "Manager",
        };
    }

    if (role === "staff" && toPositiveInteger(decoded?.staff_id)) {
        const [rows] = await connection.execute(
            `SELECT staff_name FROM staff WHERE id = ? AND store_id = ? LIMIT 1`,
            [toPositiveInteger(decoded.staff_id), storeId]
        );

        return {
            id: toPositiveInteger(decoded.staff_id),
            name: toSafeString(rows[0]?.staff_name, 255) || "Staff",
            role: "Staff",
        };
    }

    if (role === "owner" && storeId) {
        const [rows] = await connection.execute(
            `SELECT owner_name FROM stores WHERE id = ? LIMIT 1`,
            [storeId]
        );

        return {
            id: null,
            name: toSafeString(rows[0]?.owner_name, 255) || "Owner",
            role: "Owner",
        };
    }

    return { id: null, name: "Unknown", role: "Staff" };
}

/*
 * Writes one row to employee_actions. Callers decide whether this runs
 * inside the same DB transaction as the action it's logging (so the log
 * and the action succeed/fail together) or as a best-effort call after
 * the action already committed.
 */
async function logEmployeeAction(connection, entry) {
    await connection.execute(
        `INSERT INTO employee_actions
         (store_id, branch_id, employee_id, employee_name, employee_role,
          module, reference_number, action, reference_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.storeId,
            entry.branchId ?? null,
            entry.employee.id,
            entry.employee.name,
            entry.employee.role,
            entry.module,
            entry.referenceNumber ?? null,
            entry.action,
            entry.referenceId ?? null,
            entry.details ?? null,
        ]
    );
}

async function getStoreTaxType(connection, storeId) {
    const [rows] = await connection.execute(
        `SELECT tax_registration AS taxRegistration FROM stores WHERE id = ? LIMIT 1`,
        [storeId]
    );

    if (rows.length === 0) {
        throw new Error("Store tax registration could not be determined.");
    }

    const registration = String(rows[0]?.taxRegistration || "").toUpperCase();

    if (registration === "NON_VAT" || registration === "NON_VAT_REGISTERED") {
        return "NON_VAT";
    }

    if (registration === "VAT_REGISTERED" || registration === "VAT") {
        return "VAT";
    }

    throw new Error(
        "Store tax registration is missing or invalid. Update the store tax profile before processing POS transactions."
    );
}

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "Content-Type, Authorization",
        "Access-Control-Allow-Methods":
            "GET, POST, OPTIONS",
        "Content-Type": "application/json",
    };

    const method =
        event?.requestContext?.http?.method ||
        event?.httpMethod;

    if (method === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: "",
        };
    }

    let body = {};

    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return badRequest(
            headers,
            "Invalid JSON body."
        );
    }

    const rawAction = toSafeString(
        body.action,
        80
    );

    const normalizedAction =
        normalizeAction(rawAction);

    const actionAliases = {
        place_order: "create_order",
        create_pos_order: "create_order",
        create_sale: "create_order",
        checkout: "create_order",

        deduct_stock: "decrease_stock",
        reduce_stock: "decrease_stock",
        update_stock: "decrease_stock",
        decrement_stock: "decrease_stock",

        // Legacy clients that still send delete_order are converted to a
        // non-destructive void so completed POS history is never erased.
        delete_order: "void_order",
    };

    const action =
        actionAliases[normalizedAction] ||
        normalizedAction;

    let connection;

    try {
        connection = await dbPool.getConnection();

        const authHeader =
            event?.headers?.authorization ||
            event?.headers?.Authorization ||
            "";

        if (!authHeader) {
            return unauthorized(
                headers,
                "No token provided."
            );
        }

        let storeId;
        let tokenBranchId = null;
        let tokenRole = "";
        let decodedToken = null;

        try {
            const token =
                authHeader.replace(/^Bearer\s+/i, "");

            const decoded =
                jwt.verify(token, JWT_SECRET);

            decodedToken = decoded;

            storeId =
                Number(decoded.store_id);

            tokenBranchId =
                decoded.branch_id
                    ? Number(decoded.branch_id)
                    : null;

            tokenRole =
                String(decoded.role || "")
                    .toLowerCase();
        } catch {
            return unauthorized(
                headers,
                "Invalid token."
            );
        }

        if (
            !Number.isInteger(storeId) ||
            storeId <= 0
        ) {
            return unauthorized(
                headers,
                "Invalid store in token."
            );
        }

        const storeExists =
            await ensureStoreExists(
                connection,
                storeId
            );

        if (!storeExists) {
            return badRequest(
                headers,
                "Store account not found."
            );
        }

        const isBranchUser =
            tokenRole === "manager" ||
            tokenRole === "staff";

        const requestedBranchId =
            toPositiveInteger(
                body.branch_id ??
                body.branchId
            );

        if (
            tokenRole === "owner" &&
            requestedBranchId
        ) {
            const ownerBranchExists =
                await ensureBranchBelongsToStore(
                    connection,
                    requestedBranchId,
                    storeId
                );

            if (!ownerBranchExists) {
                return badRequest(
                    headers,
                    "Invalid branch for this store."
                );
            }
        }

        if (isBranchUser) {
            if (
                !Number.isInteger(tokenBranchId) ||
                tokenBranchId <= 0
            ) {
                return badRequest(
                    headers,
                    "Missing branch_id in token for this user."
                );
            }

            const branchExists =
                await ensureBranchBelongsToStore(
                    connection,
                    tokenBranchId,
                    storeId
                );

            if (!branchExists) {
                return badRequest(
                    headers,
                    "Invalid branch for this store."
                );
            }
        }

        if (action === "check_customer_credit") {
            if (tokenRole !== "manager" || !tokenBranchId) {
                return badRequest(
                    headers,
                    "Only an assigned Manager can verify customer credit eligibility."
                );
            }

            const contactNumber = toSafeString(
                body.customer_contact_number ?? body.customerContactNumber,
                40
            );

            if (!isValidCreditContact(contactNumber)) {
                return badRequest(
                    headers,
                    "A valid Philippine mobile number is required for the credit check."
                );
            }

            const credit = await getOutstandingCreditForContact(
                connection,
                storeId,
                contactNumber
            );

            const status =
                credit.overdueBalance > 0
                    ? "OVERDUE"
                    : credit.outstandingBalance > 0
                        ? "OUTSTANDING"
                        : credit.matchedOrders > 0
                            ? "CLEARED"
                            : "NEW";

            return jsonResponse(200, headers, {
                status,
                restricted: credit.outstandingBalance > 0,
                matchedOrders: credit.matchedOrders,
                openOrders: credit.openOrders,
                outstandingBalance: credit.outstandingBalance,
                overdueBalance: credit.overdueBalance,
                oldestDueDate: credit.oldestDueDate,
            });
        }

        if (action === "create_order") {
            const requestedOrderId = toSafeString(body.order_id, 255);
            const submittedCustomerName =
                toSafeString(body.customer_name, 120) || "Walk-in";
            const submittedCustomerAddress =
                toSafeString(body.customer_address, 255) || "N/A";
            const customerContactNumber = toSafeString(
                body.customer_contact_number ?? body.customerContactNumber,
                40
            );
            const paymentMode =
                toSafeString(body.payment_mode, 20).toUpperCase() || "CASH";
            const creditTerm =
                toSafeString(body.credit_term, 30) || "N/A";
            const orderDate =
                toISODate(body.order_date) || getManilaISODate();
            const rawOrderLines = getOrderLines(body);
            const customerPayment = roundMoney(
                toNumber(body.customer_payment) ?? 0
            );

            if (!requestedOrderId) {
                return badRequest(headers, "order_id is required.");
            }

            if (!isBranchUser || !tokenBranchId) {
                return badRequest(
                    headers,
                    "Only an assigned Manager or Staff branch can create POS orders."
                );
            }

            if (rawOrderLines.length === 0) {
                return badRequest(headers, "At least one POS item is required.");
            }

            if (!["CASH", "CREDIT"].includes(paymentMode)) {
                return badRequest(headers, "Invalid payment mode.");
            }

            if (paymentMode === "CREDIT" && tokenRole !== "manager") {
                return badRequest(
                    headers,
                    "Only an assigned Manager can create credit sales."
                );
            }

            if (
                paymentMode === "CREDIT" &&
                !["15 Days", "30 Days"].includes(creditTerm)
            ) {
                return badRequest(
                    headers,
                    "A valid credit term is required for credit sales."
                );
            }

            if (customerPayment < 0) {
                return badRequest(headers, "Customer payment cannot be negative.");
            }

            if (paymentMode === "CREDIT") {
                if (isPlaceholderCreditValue(submittedCustomerName)) {
                    return badRequest(
                        headers,
                        "Customer full name is required for credit sales."
                    );
                }

                if (!isValidCreditContact(customerContactNumber)) {
                    return badRequest(
                        headers,
                        "A valid Philippine mobile number is required for credit sales."
                    );
                }

                const existingCredit = await getOutstandingCreditForContact(
                    connection,
                    storeId,
                    customerContactNumber
                );

                if (existingCredit.outstandingBalance > 0) {
                    const statusLabel =
                        existingCredit.overdueBalance > 0
                            ? "overdue"
                            : "outstanding";

                    return badRequest(
                        headers,
                        `New credit is blocked because this customer has an ${statusLabel} balance of ₱${existingCredit.outstandingBalance.toFixed(2)} across ${existingCredit.openOrders} open credit transaction(s). Settle the previous balance first.`
                    );
                }
            }

            // Tax treatment is controlled by the Owner's business tax profile.
            // The frontend value is display-only and is never trusted here.
            const taxType = await getStoreTaxType(connection, storeId);
            const customerName =
                paymentMode === "CREDIT" ? submittedCustomerName : "Walk-in";
            const customerAddress =
                paymentMode === "CREDIT" ? submittedCustomerAddress : "N/A";

            let orderId = await getNextAvailablePosOrderId(
                connection,
                storeId,
                orderDate,
                requestedOrderId
            );

            const MAX_ORDER_ID_ATTEMPTS = 5;

            for (
                let attempt = 0;
                attempt < MAX_ORDER_ID_ATTEMPTS;
                attempt += 1
            ) {
                await connection.beginTransaction();

                try {
                    /*
                     * Product IDs and quantities come from the browser, but all
                     * prices, stock, tenant/branch ownership, and sellable batch
                     * availability are re-read from the database. This keeps the
                     * database authoritative and prevents client-side price edits.
                     */
                    const orderLines = await resolveAuthoritativeOrderLines(
                        connection,
                        storeId,
                        tokenBranchId,
                        rawOrderLines,
                        orderDate
                    );

                    const total = roundMoney(
                        orderLines.reduce(
                            (sum, line) =>
                                sum + Number(line.unit_price || 0) * Number(line.quantity || 0),
                            0
                        )
                    );

                    if (paymentMode === "CASH" && customerPayment < total) {
                        await connection.rollback();
                        return badRequest(
                            headers,
                            "Cash payment must be equal to or greater than the order total."
                        );
                    }

                    if (paymentMode === "CREDIT" && customerPayment > total) {
                        await connection.rollback();
                        return badRequest(
                            headers,
                            "Credit sale payment cannot exceed the order total."
                        );
                    }

                    const vatableSales =
                        taxType === "VAT" ? roundMoney(total / 1.12) : 0;
                    const vatAmount =
                        taxType === "VAT" ? roundMoney(vatableSales * 0.12) : 0;
                    const changeDue =
                        paymentMode === "CASH"
                            ? roundMoney(customerPayment - total)
                            : 0;
                    const creditDays =
                        paymentMode === "CREDIT" && creditTerm.startsWith("30")
                            ? 30
                            : 15;
                    const creditDueDate =
                        paymentMode === "CREDIT"
                            ? addDaysToISODate(orderDate, creditDays)
                            : null;
                    const collectionStatus =
                        paymentMode !== "CREDIT"
                            ? "PAID"
                            : customerPayment >= total
                                ? "PAID"
                                : customerPayment > 0
                                    ? "PARTIAL"
                                    : "PENDING";
                    const item = toSafeString(
                        formatOrderItems(orderLines),
                        255
                    );
                    const controlNumber = await getNextAvailableControlNumber(
                        connection,
                        orderDate
                    );

                    await connection.execute(
                        `INSERT INTO orders
                         (
                             order_id, control_number, store_id, branch_id,
                             customer_name, customer_address, customer_contact_number,
                             payment_mode, credit_term, credit_due_date, collection_status,
                             tax_type, vatable_sales, vat_amount, customer_payment,
                             change_due, cashier_id, cashier_role, item, total, order_date
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            orderId,
                            controlNumber,
                            storeId,
                            tokenBranchId,
                            customerName,
                            customerAddress,
                            paymentMode === "CREDIT" ? customerContactNumber : null,
                            paymentMode,
                            paymentMode === "CREDIT" ? creditTerm : "N/A",
                            creditDueDate,
                            collectionStatus,
                            taxType,
                            vatableSales,
                            vatAmount,
                            customerPayment,
                            changeDue,
                            null,
                            tokenRole,
                            item,
                            total,
                            orderDate,
                        ]
                    );

                    const orderItemSummary = await insertOrderItems(
                        connection,
                        orderId,
                        storeId,
                        tokenBranchId,
                        orderLines
                    );

                    const actingEmployee = await getActingEmployee(
                        connection,
                        decodedToken
                    );

                    await decreaseStockForOrder(
                        connection,
                        storeId,
                        tokenBranchId,
                        orderLines,
                        {
                            referenceType: "POS_ORDER",
                            referenceId: orderId,
                            actor: actingEmployee,
                            saleDate: orderDate,
                        }
                    );

                    await upsertPosDashboardSummary(connection, {
                        storeId,
                        branchId: tokenBranchId,
                        orderDate,
                        sales: total,
                        cost: orderItemSummary.totalCost,
                        items: orderItemSummary.items,
                    });

                    await connection.execute(
                        `UPDATE orders
                         SET cashier_id = ?, cashier_role = ?
                         WHERE order_id = ? AND store_id = ?`,
                        [
                            actingEmployee.id,
                            actingEmployee.role,
                            orderId,
                            storeId,
                        ]
                    );

                    await logEmployeeAction(connection, {
                        storeId,
                        branchId: tokenBranchId,
                        employee: actingEmployee,
                        module: "Sales / POS",
                        referenceNumber: controlNumber,
                        action: "Completed POS transaction",
                        referenceId: orderId,
                        details: `${item} — Total ₱${total} — ${paymentMode} — ${taxType} — VAT ₱${vatAmount}`,
                    });

                    await connection.commit();

                    const [rows] = await connection.execute(
                        `SELECT
                             o.order_id AS orderId,
                             o.store_id AS storeId,
                             o.branch_id AS branchId,
                             COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branchName,
                             COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branch,
                             o.control_number AS controlNumber,
                             o.customer_name AS customerName,
                             o.customer_address AS customerAddress,
                             o.customer_contact_number AS customerContactNumber,
                             o.payment_mode AS paymentMode,
                             o.credit_term AS creditTerm,
                             DATE_FORMAT(o.credit_due_date, '%Y-%m-%d') AS creditDueDate,
                             o.collection_status AS collectionStatus,
                             o.status AS status,
                             o.tax_type AS taxType,
                             o.vatable_sales AS vatableSales,
                             o.vat_amount AS vatAmount,
                             o.customer_payment AS customerPayment,
                             o.customer_payment AS totalPaid,
                             GREATEST(0, o.total - o.customer_payment) AS balance,
                             o.change_due AS changeDue,
                             o.cashier_id AS cashierId,
                             CASE
                                 WHEN LOWER(o.cashier_role) = 'manager' THEN (
                                     SELECT m.manager_name FROM managers m
                                     WHERE m.id = o.cashier_id AND m.store_id = o.store_id LIMIT 1
                             )
                                 WHEN LOWER(o.cashier_role) = 'staff' THEN (
                                     SELECT st.staff_name FROM staff st
                                     WHERE st.id = o.cashier_id AND st.store_id = o.store_id LIMIT 1
                                 )
                                 ELSE NULL
                        END AS cashierName,
                             o.cashier_role AS cashierRole,
                             o.item,
                             o.total,
                             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
                             o.created_at AS createdAt
                         FROM orders o
                                  LEFT JOIN branches b
                                            ON b.id = o.branch_id
                                                AND b.store_id = o.store_id
                         WHERE o.order_id = ? AND o.store_id = ?
                         LIMIT 1`,
                        [orderId, storeId]
                    );

                    const orderItemsById = await loadOrderItemsForOrders(
                        connection,
                        storeId,
                        [orderId]
                    );

                    return jsonResponse(201, headers, {
                        success: true,
                        order: {
                            ...rows[0],
                            orderItems:
                                orderItemsById.get(String(orderId)) || [],
                        },
                    });
                } catch (error) {
                    await connection.rollback();

                    if (
                        error?.code === "ER_DUP_ENTRY" &&
                        attempt < MAX_ORDER_ID_ATTEMPTS - 1
                    ) {
                        orderId = await getNextAvailablePosOrderId(
                            connection,
                            storeId,
                            orderDate,
                            requestedOrderId
                        );
                        continue;
                    }

                    throw error;
                }
            }

            throw new Error(
                "Unable to generate a unique POS order ID and control number."
            );
        }

        if (action === "decrease_stock") {
            const orderLines =
                getOrderLines(body);

            if (orderLines.length === 0) {
                return badRequest(
                    headers,
                    "No items found for stock update."
                );
            }

            if (!isBranchUser || !tokenBranchId) {
                return badRequest(
                    headers,
                    "Only an assigned Manager or Staff branch can update POS stock."
                );
            }

            await connection.beginTransaction();

            try {
                const actingEmployee = await getActingEmployee(
                    connection,
                    decodedToken
                );

                await decreaseStockForOrder(
                    connection,
                    storeId,
                    tokenBranchId,
                    orderLines,
                    {
                        referenceType: "POS_STOCK_UPDATE",
                        referenceId: body.order_id || body.orderId || body.reference_id || null,
                        actor: actingEmployee,
                    }
                );

                await connection.commit();

                return jsonResponse(
                    200,
                    headers,
                    {
                        success: true,
                    }
                );
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        }

        if (action === "get_owner_dashboard_summary") {
            if (tokenRole !== "owner") {
                return jsonResponse(403, headers, {
                    error: "Only the store owner can load the owner dashboard summary.",
                });
            }

            const requestedDateTo =
                toISODate(
                    body.date_to ??
                    body.dateTo ??
                    body.end_date ??
                    body.endDate
                ) || getManilaISODate();

            const requestedDateFrom =
                toISODate(
                    body.date_from ??
                    body.dateFrom ??
                    body.start_date ??
                    body.startDate
                ) || shiftMonthStartISO(requestedDateTo, 12);

            if (requestedDateFrom > requestedDateTo) {
                return badRequest(
                    headers,
                    "date_from cannot be later than date_to."
                );
            }

            const periodStarts =
                getOwnerDashboardPeriodStarts(requestedDateTo);

            const requestStartedAt = Date.now();
            const timings = {};

            /*
             * Fast path: query the incrementally-maintained summary tables.
             * Each query is independent, so it uses the pool concurrently.
             * This makes dashboard cost depend on the number of days/products
             * shown, not on the total lifetime number of POS transactions.
             */
            if (await hasPosDashboardSummaryTables(connection)) {
                const runTimedQuery = async (key, sql, params) => {
                    const startedAt = Date.now();
                    const [rows] = await dbPool.execute(sql, params);
                    timings[key] = Date.now() - startedAt;
                    return rows;
                };

                const [
                    dailyRows,
                    branchRows,
                    monthProductRows,
                    quarterProductRows,
                    yearProductRows,
                ] = await Promise.all([
                    runTimedQuery(
                        "daily",
                        `SELECT
                             DATE_FORMAT(summary_date, '%Y-%m-%d') AS date,
                             SUM(gross_sales) AS sales,
                             SUM(cost_of_sales) AS cost
                         FROM pos_daily_summary
                         WHERE store_id = ?
                           AND summary_date >= ?
                           AND summary_date <= ?
                         GROUP BY summary_date
                         ORDER BY summary_date ASC`,
                        [storeId, requestedDateFrom, requestedDateTo]
                    ),
                    runTimedQuery(
                        "branches",
                        `SELECT
                             s.branch_id AS branchId,
                             COALESCE(
                                     NULLIF(TRIM(b.branch_name), ''),
                                     CONCAT('Branch ', s.branch_id)
                             ) AS name,
                             SUM(CASE WHEN s.summary_date >= ? THEN s.gross_sales ELSE 0 END) AS monthSales,
                             SUM(CASE WHEN s.summary_date >= ? THEN s.gross_sales ELSE 0 END) AS quarterSales,
                             SUM(CASE WHEN s.summary_date >= ? THEN s.gross_sales ELSE 0 END) AS yearSales
                         FROM pos_daily_summary s
                                  LEFT JOIN branches b
                                            ON b.id = s.branch_id
                                                AND b.store_id = s.store_id
                         WHERE s.store_id = ?
                           AND s.summary_date >= ?
                           AND s.summary_date <= ?
                         GROUP BY s.branch_id, b.branch_name`,
                        [
                            periodStarts.month,
                            periodStarts.quarter,
                            periodStarts.year,
                            storeId,
                            periodStarts.year,
                            requestedDateTo,
                        ]
                    ),
                    runTimedQuery(
                        "topMonth",
                        `SELECT
                             product_id AS productId,
                             MAX(product_name) AS name,
                             SUM(sales_amount) AS sales,
                             SUM(units_sold) AS units
                         FROM pos_product_monthly_summary
                         WHERE store_id = ?
                           AND month_start >= ?
                           AND month_start <= ?
                         GROUP BY product_id
                         ORDER BY sales DESC
                             LIMIT 8`,
                        [storeId, periodStarts.month, requestedDateTo]
                    ),
                    runTimedQuery(
                        "topQuarter",
                        `SELECT
                             product_id AS productId,
                             MAX(product_name) AS name,
                             SUM(sales_amount) AS sales,
                             SUM(units_sold) AS units
                         FROM pos_product_monthly_summary
                         WHERE store_id = ?
                           AND month_start >= ?
                           AND month_start <= ?
                         GROUP BY product_id
                         ORDER BY sales DESC
                             LIMIT 8`,
                        [storeId, periodStarts.quarter, requestedDateTo]
                    ),
                    runTimedQuery(
                        "topYear",
                        `SELECT
                             product_id AS productId,
                             MAX(product_name) AS name,
                             SUM(sales_amount) AS sales,
                             SUM(units_sold) AS units
                         FROM pos_product_monthly_summary
                         WHERE store_id = ?
                           AND month_start >= ?
                           AND month_start <= ?
                         GROUP BY product_id
                         ORDER BY sales DESC
                             LIMIT 8`,
                        [storeId, periodStarts.year, requestedDateTo]
                    ),
                ]);

                const normalizedBranches = branchRows.map((row) => ({
                    key:
                        row.branchId === null || row.branchId === undefined
                            ? "unassigned"
                            : String(row.branchId),
                    name: String(row.name || "Unassigned"),
                    month: normalizeDashboardNumber(row.monthSales),
                    quarter: normalizeDashboardNumber(row.quarterSales),
                    year: normalizeDashboardNumber(row.yearSales),
                }));

                const toTopRows = (rows) =>
                    rows.map((row) => ({
                        key: `product:${String(row.productId ?? row.name ?? "").trim().toLowerCase()}`,
                        name: String(row.name || "Unnamed Product").trim() || "Unnamed Product",
                        sales: normalizeDashboardNumber(row.sales),
                        units: normalizeDashboardNumber(row.units),
                    }));

                const summary = {
                    dateRange: {
                        startDate: requestedDateFrom,
                        endDate: requestedDateTo,
                    },
                    daily: dailyRows.map((row) => ({
                        date: String(row.date || ""),
                        sales: normalizeDashboardNumber(row.sales),
                        cost: normalizeDashboardNumber(row.cost),
                    })),
                    branchPerformance: {
                        month: normalizedBranches
                            .map((row) => ({ key: row.key, name: row.name, amount: row.month }))
                            .filter((row) => row.amount > 0)
                            .sort((a, b) => b.amount - a.amount),
                        quarter: normalizedBranches
                            .map((row) => ({ key: row.key, name: row.name, amount: row.quarter }))
                            .filter((row) => row.amount > 0)
                            .sort((a, b) => b.amount - a.amount),
                        year: normalizedBranches
                            .map((row) => ({ key: row.key, name: row.name, amount: row.year }))
                            .filter((row) => row.amount > 0)
                            .sort((a, b) => b.amount - a.amount),
                    },
                    topProducts: {
                        month: toTopRows(monthProductRows),
                        quarter: toTopRows(quarterProductRows),
                        year: toTopRows(yearProductRows),
                    },
                };

                timings.total = Date.now() - requestStartedAt;

                console.info("Owner POS dashboard summary timings:", {
                    mode: "summary_tables",
                    storeId,
                    dateFrom: requestedDateFrom,
                    dateTo: requestedDateTo,
                    ...timings,
                    dailyRows: summary.daily.length,
                    productGroups:
                        monthProductRows.length +
                        quarterProductRows.length +
                        yearProductRows.length,
                });

                return jsonResponse(200, headers, {
                    success: true,
                    summary,
                    meta: {
                        mode: "summary_tables",
                        queryTimingsMs: timings,
                    },
                });
            }

            /*
             * Dashboard-only POS summary.
             *
             * The former Owner dashboard called get_orders with order items for
             * roughly 13 months. That forced the API to build thousands of full
             * transaction objects, run per-order financial joins, serialize a
             * very large JSON payload, and make React aggregate it again.
             *
             * These queries return only the aggregates the Owner dashboard uses:
             * daily sales/cost, branch totals for the current periods, and top
             * product totals. The normal get_orders action remains untouched for
             * the Sales/POS screens that actually need detailed transactions.
             */
            const dailyStartedAt = Date.now();
            const [dailyRows] = await connection.execute(
                `SELECT
                     DATE_FORMAT(costed.order_date, '%Y-%m-%d') AS date,
                     SUM(costed.sales) AS sales,
                     SUM(costed.cost) AS cost
                 FROM (
                     SELECT
                     o.order_id,
                     o.order_date,
                     o.total AS sales,
                     COALESCE(
                     SUM(
                     CASE
                     WHEN oi.id IS NULL THEN NULL
                     ELSE
                     COALESCE(
                     oi.cost_price_at_sale,
                     CASE
                     WHEN oi.variant_id IS NOT NULL
                     THEN pv.original_price
                     ELSE p.original_price
                     END,
                     0
                     ) * COALESCE(oi.quantity, 0)
                     END
                     ),
                     o.total
                     ) AS cost
                     FROM orders o
                     LEFT JOIN order_items oi
                     ON oi.order_id = o.order_id
                     AND oi.store_id = o.store_id
                     LEFT JOIN products p
                     ON p.id = oi.product_id
                     AND p.store_id = oi.store_id
                     LEFT JOIN product_variants pv
                     ON pv.id = oi.variant_id
                     AND pv.product_id = oi.product_id
                     WHERE o.store_id = ?
                     AND o.order_date >= ?
                     AND o.order_date <= ?
                     AND ${OWNER_DASHBOARD_EXCLUDED_STATUSES_SQL}
                     GROUP BY
                     o.order_id,
                     o.order_date,
                     o.total
                     ) AS costed
                 GROUP BY costed.order_date
                 ORDER BY costed.order_date ASC`,
                [storeId, requestedDateFrom, requestedDateTo]
            );
            timings.daily = Date.now() - dailyStartedAt;

            const branchStartedAt = Date.now();
            const [branchRows] = await connection.execute(
                `SELECT
                     o.branch_id AS branchId,
                     COALESCE(
                             NULLIF(TRIM(b.branch_name), ''),
                             CONCAT('Branch ', o.branch_id),
                             'Unassigned'
                     ) AS name,
                     SUM(CASE WHEN o.order_date >= ? THEN o.total ELSE 0 END) AS monthSales,
                     SUM(CASE WHEN o.order_date >= ? THEN o.total ELSE 0 END) AS quarterSales,
                     SUM(CASE WHEN o.order_date >= ? THEN o.total ELSE 0 END) AS yearSales
                 FROM orders o
                          LEFT JOIN branches b
                                    ON b.id = o.branch_id
                                        AND b.store_id = o.store_id
                 WHERE o.store_id = ?
                   AND o.order_date >= ?
                   AND o.order_date <= ?
                   AND ${OWNER_DASHBOARD_EXCLUDED_STATUSES_SQL}
                 GROUP BY o.branch_id, b.branch_name`,
                [
                    periodStarts.month,
                    periodStarts.quarter,
                    periodStarts.year,
                    storeId,
                    periodStarts.year,
                    requestedDateTo,
                ]
            );
            timings.branches = Date.now() - branchStartedAt;

            const productsStartedAt = Date.now();
            const [productRows] = await connection.execute(
                `SELECT
                     oi.product_name AS name,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.line_total ELSE 0 END) AS monthSales,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.quantity ELSE 0 END) AS monthUnits,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.line_total ELSE 0 END) AS quarterSales,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.quantity ELSE 0 END) AS quarterUnits,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.line_total ELSE 0 END) AS yearSales,
                     SUM(CASE WHEN o.order_date >= ? THEN oi.quantity ELSE 0 END) AS yearUnits
                 FROM order_items oi
                          INNER JOIN orders o
                                     ON o.order_id = oi.order_id
                                         AND o.store_id = oi.store_id
                 WHERE o.store_id = ?
                   AND o.order_date >= ?
                   AND o.order_date <= ?
                   AND ${OWNER_DASHBOARD_EXCLUDED_STATUSES_SQL}
                 GROUP BY oi.product_name`,
                [
                    periodStarts.month,
                    periodStarts.month,
                    periodStarts.quarter,
                    periodStarts.quarter,
                    periodStarts.year,
                    periodStarts.year,
                    storeId,
                    periodStarts.year,
                    requestedDateTo,
                ]
            );
            timings.products = Date.now() - productsStartedAt;

            const normalizedBranches = branchRows.map((row) => ({
                key:
                    row.branchId === null || row.branchId === undefined
                        ? "unassigned"
                        : String(row.branchId),
                name: String(row.name || "Unassigned"),
                month: normalizeDashboardNumber(row.monthSales),
                quarter: normalizeDashboardNumber(row.quarterSales),
                year: normalizeDashboardNumber(row.yearSales),
            }));

            const branchPerformance = {
                month: normalizedBranches
                    .map((row) => ({
                        key: row.key,
                        name: row.name,
                        amount: row.month,
                    }))
                    .filter((row) => row.amount > 0)
                    .sort((a, b) => b.amount - a.amount),
                quarter: normalizedBranches
                    .map((row) => ({
                        key: row.key,
                        name: row.name,
                        amount: row.quarter,
                    }))
                    .filter((row) => row.amount > 0)
                    .sort((a, b) => b.amount - a.amount),
                year: normalizedBranches
                    .map((row) => ({
                        key: row.key,
                        name: row.name,
                        amount: row.year,
                    }))
                    .filter((row) => row.amount > 0)
                    .sort((a, b) => b.amount - a.amount),
            };

            const summary = {
                dateRange: {
                    startDate: requestedDateFrom,
                    endDate: requestedDateTo,
                },
                daily: dailyRows.map((row) => ({
                    date: String(row.date || ""),
                    sales: normalizeDashboardNumber(row.sales),
                    cost: normalizeDashboardNumber(row.cost),
                })),
                branchPerformance,
                topProducts: {
                    month: buildTopDashboardRows(
                        productRows,
                        "monthSales",
                        "monthUnits"
                    ),
                    quarter: buildTopDashboardRows(
                        productRows,
                        "quarterSales",
                        "quarterUnits"
                    ),
                    year: buildTopDashboardRows(
                        productRows,
                        "yearSales",
                        "yearUnits"
                    ),
                },
            };

            timings.total = Date.now() - requestStartedAt;

            console.info("Owner POS dashboard summary timings:", {
                mode: "live_fallback",
                storeId,
                dateFrom: requestedDateFrom,
                dateTo: requestedDateTo,
                ...timings,
                dailyRows: summary.daily.length,
                productGroups: productRows.length,
            });

            return jsonResponse(200, headers, {
                success: true,
                summary,
                meta: {
                    mode: "live_fallback",
                    queryTimingsMs: timings,
                },
            });
        }

        if (action === "get_orders") {
            const requestedDateFrom = toISODate(
                body.date_from ?? body.dateFrom ?? body.start_date ?? body.startDate
            );
            const requestedDateTo = toISODate(
                body.date_to ?? body.dateTo ?? body.end_date ?? body.endDate
            );

            if (requestedDateFrom && requestedDateTo && requestedDateFrom > requestedDateTo) {
                return badRequest(headers, "date_from cannot be later than date_to.");
            }

            const includeFinancialMetrics = tokenRole === "owner";
            const requestedSearch = toSafeString(
                body.search ?? body.query ?? body.order_search ?? body.orderSearch,
                120
            );
            const paginationEnabled = body.paginate === true || tokenRole === "owner";
            const page = paginationEnabled
                ? Math.max(1, toPositiveInteger(body.page) || 1)
                : 1;
            const pageSize = paginationEnabled
                ? Math.min(100, Math.max(10, toPositiveInteger(body.page_size ?? body.pageSize) || 50))
                : null;
            const offset = paginationEnabled ? (page - 1) * pageSize : 0;

            const whereClauses = ["o.store_id = ?"];
            const scopeParams = [storeId];

            if (isBranchUser && tokenBranchId) {
                whereClauses.push("o.branch_id = ?");
                scopeParams.push(tokenBranchId);
            } else if (tokenRole === "owner" && requestedBranchId) {
                whereClauses.push("o.branch_id = ?");
                scopeParams.push(requestedBranchId);
            }

            if (requestedDateFrom) {
                whereClauses.push("o.order_date >= ?");
                scopeParams.push(requestedDateFrom);
            }

            if (requestedDateTo) {
                whereClauses.push("o.order_date <= ?");
                scopeParams.push(requestedDateTo);
            }

            if (requestedSearch) {
                const like = `%${requestedSearch}%`;
                whereClauses.push(
                    "(o.order_id LIKE ? OR o.control_number LIKE ? OR o.customer_name LIKE ?)"
                );
                scopeParams.push(like, like, like);
            }

            const creditOpenOnly =
                (body.credit_open_only === true || body.creditOpenOnly === true) &&
                tokenRole === "manager";

            if (creditOpenOnly) {
                whereClauses.push("UPPER(COALESCE(o.payment_mode, '')) = 'CREDIT'");
                whereClauses.push(
                    "LOWER(TRIM(COALESCE(o.status, ''))) NOT IN ('void','voided','cancelled','canceled','refunded')"
                );
                whereClauses.push(`
                    o.total - (
                        COALESCE(o.customer_payment, 0) +
                        COALESCE(
                            (SELECT SUM(cc_open.amount)
                             FROM credit_collections cc_open
                             WHERE cc_open.store_id = o.store_id
                               AND cc_open.order_id = o.order_id),
                            0
                        )
                    ) > 0
                `);
            }

            const whereSql = whereClauses.join(" AND ");

            const financialMetricsSelect = includeFinancialMetrics
                ? `
                    COALESCE(
                        SUM(
                            CASE
                                WHEN oi.id IS NULL THEN NULL
                                ELSE COALESCE(
                                    oi.cost_price_at_sale,
                                    CASE WHEN oi.variant_id IS NOT NULL
                                        THEN pv.original_price ELSE p.original_price END,
                                    0
                                ) * COALESCE(oi.quantity, 0)
                            END
                        ),
                        o.total
                    ) AS totalCost,
                    (
                        o.total - COALESCE(
                            SUM(
                                CASE
                                    WHEN oi.id IS NULL THEN NULL
                                    ELSE COALESCE(
                                        oi.cost_price_at_sale,
                                        CASE WHEN oi.variant_id IS NOT NULL
                                            THEN pv.original_price ELSE p.original_price END,
                                        0
                                    ) * COALESCE(oi.quantity, 0)
                                END
                            ),
                            o.total
                        )
                    ) AS profit,`
                : `NULL AS totalCost, NULL AS profit,`;

            const financialJoins = includeFinancialMetrics
                ? `
                    LEFT JOIN order_items oi
                      ON oi.order_id = o.order_id AND oi.store_id = o.store_id
                    LEFT JOIN products p
                      ON p.id = oi.product_id AND p.store_id = oi.store_id
                    LEFT JOIN product_variants pv
                      ON pv.id = oi.variant_id AND pv.product_id = oi.product_id
                  `
                : "";

            let query = `
                SELECT
                    o.order_id AS orderId,
                    o.store_id AS storeId,
                    o.branch_id AS branchId,
                    COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branchName,
                    COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branch,
                    o.control_number AS controlNumber,
                    o.customer_name AS customerName,
                    o.customer_address AS customerAddress,
                    o.customer_contact_number AS customerContactNumber,
                    o.payment_mode AS paymentMode,
                    o.credit_term AS creditTerm,
                    DATE_FORMAT(o.credit_due_date, '%Y-%m-%d') AS creditDueDate,
                    o.tax_type AS taxType,
                    o.vatable_sales AS vatableSales,
                    o.vat_amount AS vatAmount,
                    o.customer_payment AS customerPayment,
                    (
                        COALESCE(o.customer_payment, 0) +
                        COALESCE((SELECT SUM(cc.amount)
                                  FROM credit_collections cc
                                  WHERE cc.store_id = o.store_id AND cc.order_id = o.order_id), 0)
                    ) AS totalPaid,
                    GREATEST(
                        0,
                        o.total - (
                            COALESCE(o.customer_payment, 0) +
                            COALESCE((SELECT SUM(cc.amount)
                                      FROM credit_collections cc
                                      WHERE cc.store_id = o.store_id AND cc.order_id = o.order_id), 0)
                        )
                    ) AS balance,
                    CASE
                        WHEN LOWER(TRIM(COALESCE(o.status, ''))) IN ('void', 'voided', 'cancelled', 'canceled', 'refunded')
                            THEN 'VOIDED'
                        WHEN UPPER(o.payment_mode) <> 'CREDIT' THEN 'PAID'
                        WHEN o.total - (
                            COALESCE(o.customer_payment, 0) +
                            COALESCE((SELECT SUM(cc.amount)
                                      FROM credit_collections cc
                                      WHERE cc.store_id = o.store_id AND cc.order_id = o.order_id), 0)
                        ) <= 0 THEN 'PAID'
                        WHEN o.credit_due_date IS NOT NULL AND DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) > o.credit_due_date THEN 'OVERDUE'
                        WHEN (
                            COALESCE(o.customer_payment, 0) +
                            COALESCE((SELECT SUM(cc.amount)
                                      FROM credit_collections cc
                                      WHERE cc.store_id = o.store_id AND cc.order_id = o.order_id), 0)
                        ) > 0 THEN 'PARTIAL'
                        ELSE 'PENDING'
                    END AS collectionStatus,
                    o.change_due AS changeDue,
                    o.cashier_id AS cashierId,
                    CASE
                        WHEN LOWER(o.cashier_role) = 'manager' THEN (
                            SELECT m.manager_name FROM managers m
                            WHERE m.id = o.cashier_id AND m.store_id = o.store_id LIMIT 1
                        )
                        WHEN LOWER(o.cashier_role) = 'staff' THEN (
                            SELECT st.staff_name FROM staff st
                            WHERE st.id = o.cashier_id AND st.store_id = o.store_id LIMIT 1
                        )
                        ELSE NULL
                    END AS cashierName,
                    o.cashier_role AS cashierRole,
                    o.status AS status,
                    o.item,
                    o.total,
                    (SELECT s.tax_registration FROM stores s WHERE s.id = o.store_id LIMIT 1) AS taxRegistration,
                    ${financialMetricsSelect}
                    DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
                    o.created_at AS createdAt
                FROM orders o
                LEFT JOIN branches b
                  ON b.id = o.branch_id AND b.store_id = o.store_id
                ${financialJoins}
                WHERE ${whereSql}
            `;

            if (includeFinancialMetrics) {
                query += `
                    GROUP BY
                        o.order_id, o.store_id, o.branch_id, b.branch_name,
                        o.control_number, o.customer_name, o.customer_address,
                        o.customer_contact_number, o.payment_mode, o.credit_term,
                        o.credit_due_date, o.collection_status, o.status, o.tax_type,
                        o.vatable_sales, o.vat_amount, o.customer_payment, o.change_due,
                        o.cashier_id, o.cashier_role, o.item, o.total, o.order_date,
                        o.created_at
                `;
            }

            query += ` ORDER BY o.created_at DESC, o.order_id DESC`;
            const queryParams = [...scopeParams];

            if (paginationEnabled) {
                query += " LIMIT ? OFFSET ?";
                queryParams.push(pageSize, offset);
            }

            const [rows] = await connection.execute(query, queryParams);

            const includeOrderItems =
                body.include_order_items === true || body.includeOrderItems === true;
            let orders = rows;

            if (includeOrderItems && rows.length > 0) {
                const orderItemsById = await loadOrderItemsForOrders(
                    connection,
                    storeId,
                    rows.map((row) => row.orderId)
                );
                orders = rows.map((row) => ({
                    ...row,
                    orderItems: orderItemsById.get(String(row.orderId)) || [],
                }));
            }

            let pagination = null;
            let summary = null;

            if (paginationEnabled) {
                const [countRows] = await connection.execute(
                    `SELECT COUNT(*) AS total FROM orders o WHERE ${whereSql}`,
                    scopeParams
                );
                const total = Number(countRows[0]?.total || 0);
                const totalPages = Math.max(1, Math.ceil(total / pageSize));
                pagination = {
                    page,
                    pageSize,
                    total,
                    totalPages,
                    hasPrevious: page > 1,
                    hasMore: page < totalPages,
                };
            }

            if (includeFinancialMetrics) {
                const realizedStatusFilter = `LOWER(TRIM(COALESCE(o.status, ''))) NOT IN
                    ('pending','pending payment','unpaid','cancelled','canceled','refunded','void','voided','draft','failed')`;

                const [summaryRows] = await connection.execute(
                    `SELECT
                         COUNT(*) AS transactions,
                         COALESCE(SUM(o.total), 0) AS sales,
                         COALESCE(SUM(COALESCE(costs.totalCost, o.total)), 0) AS cost,
                         COALESCE(SUM(o.total - COALESCE(costs.totalCost, o.total)), 0) AS profit
                     FROM orders o
                              LEFT JOIN (
                         SELECT
                             oi.store_id,
                             oi.order_id,
                             SUM(
                                     COALESCE(
                                             oi.cost_price_at_sale,
                                             CASE WHEN oi.variant_id IS NOT NULL
                                                      THEN COALESCE(pv.original_price, p.original_price, 0)
                                                  ELSE COALESCE(p.original_price, 0)
                                                 END,
                                             0
                                     ) * COALESCE(oi.quantity, 0)
                             ) AS totalCost
                         FROM order_items oi
                                  LEFT JOIN products p
                                            ON p.id = oi.product_id AND p.store_id = oi.store_id
                                  LEFT JOIN product_variants pv
                                            ON pv.id = oi.variant_id AND pv.product_id = oi.product_id
                         WHERE oi.store_id = ?
                         GROUP BY oi.store_id, oi.order_id
                     ) costs
                                        ON costs.store_id = o.store_id AND costs.order_id = o.order_id
                     WHERE ${whereSql} AND ${realizedStatusFilter}`,
                    [storeId, ...scopeParams]
                );

                summary = {
                    transactions: Number(summaryRows[0]?.transactions || 0),
                    sales: roundMoney(summaryRows[0]?.sales || 0),
                    cost: roundMoney(summaryRows[0]?.cost || 0),
                    profit: roundMoney(summaryRows[0]?.profit || 0),
                };
            }

            const storeTaxType = await getStoreTaxType(connection, storeId);

            return jsonResponse(200, headers, {
                success: true,
                orders,
                taxType: storeTaxType,
                taxRegistration: storeTaxType === "VAT" ? "VAT_REGISTERED" : "NON_VAT",
                pagination,
                summary,
            });
        }

        if (action === "record_collection") {
            const orderId = toSafeString(body.order_id ?? body.orderId, 255);
            const amount = roundMoney(toNumber(body.amount) ?? 0);
            const paymentMethod =
                toSafeString(body.payment_method ?? body.paymentMethod, 40).toUpperCase() || "CASH";
            const referenceNumber =
                toSafeString(body.reference_number ?? body.referenceNumber, 120);

            if (tokenRole !== "manager" || !tokenBranchId) {
                return badRequest(headers, "Only an assigned Manager can record credit collections.");
            }

            if (!orderId || amount <= 0) {
                return badRequest(headers, "A valid order and collection amount are required.");
            }

            await connection.beginTransaction();

            try {
                const [orderRows] = await connection.execute(
                    `SELECT order_id, control_number, branch_id, customer_name,
                            payment_mode, total, customer_payment, credit_due_date
                     FROM orders
                     WHERE order_id = ?
                       AND store_id = ?
                       AND branch_id = ?
                         LIMIT 1
                     FOR UPDATE`,
                    [orderId, storeId, tokenBranchId]
                );

                if (orderRows.length === 0) {
                    await connection.rollback();
                    return notFound(headers, "Credit sale not found.");
                }

                const order = orderRows[0];
                if (String(order.payment_mode || "").toUpperCase() !== "CREDIT") {
                    await connection.rollback();
                    return badRequest(headers, "Only credit sales can receive collection payments.");
                }

                const [collectionRows] = await connection.execute(
                    `SELECT COALESCE(SUM(amount), 0) AS collected
                     FROM credit_collections
                     WHERE store_id = ? AND order_id = ?`,
                    [storeId, orderId]
                );

                const alreadyPaid = roundMoney(
                    Number(order.customer_payment || 0) +
                    Number(collectionRows[0]?.collected || 0)
                );
                const remainingBalance = roundMoney(
                    Math.max(0, Number(order.total || 0) - alreadyPaid)
                );

                if (amount > remainingBalance) {
                    await connection.rollback();
                    return badRequest(headers, "Collection amount cannot exceed the remaining balance.");
                }

                const actingEmployee = await getActingEmployee(connection, decodedToken);

                await connection.execute(
                    `INSERT INTO credit_collections
                     (store_id, branch_id, order_id, amount, payment_method,
                      reference_number, received_by_id, received_by_name, received_by_role, payment_date)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')))`,
                    [
                        storeId,
                        tokenBranchId,
                        orderId,
                        amount,
                        paymentMethod,
                        referenceNumber || null,
                        actingEmployee.id,
                        actingEmployee.name,
                        actingEmployee.role,
                    ]
                );

                const newTotalPaid = roundMoney(alreadyPaid + amount);
                const newBalance = roundMoney(Math.max(0, Number(order.total || 0) - newTotalPaid));
                const dueDate = order.credit_due_date
                    ? toISODate(order.credit_due_date)
                    : null;
                const overdue = Boolean(
                    dueDate && dueDate < getManilaISODate()
                );
                const collectionStatus =
                    newBalance <= 0 ? "PAID" : overdue ? "OVERDUE" : "PARTIAL";

                await connection.execute(
                    `UPDATE orders
                     SET collection_status = ?
                     WHERE order_id = ? AND store_id = ?`,
                    [collectionStatus, orderId, storeId]
                );

                await logEmployeeAction(connection, {
                    storeId,
                    branchId: tokenBranchId,
                    employee: actingEmployee,
                    module: "Sales / POS",
                    referenceNumber: order.control_number || orderId,
                    action: "Recorded credit collection",
                    referenceId: orderId,
                    details: `Collected ₱${amount} via ${paymentMethod} — Remaining balance ₱${newBalance}`,
                });

                await connection.commit();

                return jsonResponse(200, headers, {
                    success: true,
                    totalPaid: newTotalPaid,
                    balance: newBalance,
                    collectionStatus,
                });
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        }

        if (action === "get_collection_history") {
            const orderId = toSafeString(body.order_id ?? body.orderId, 255);

            if (!orderId) {
                return badRequest(headers, "Invalid order_id.");
            }

            let query = `
                SELECT
                    cc.id,
                    cc.order_id AS orderId,
                    cc.amount,
                    cc.payment_method AS paymentMethod,
                    cc.reference_number AS referenceNumber,
                    DATE_FORMAT(cc.payment_date, '%Y-%m-%d') AS paymentDate,
                    cc.received_by_name AS receivedByName,
                    cc.received_by_role AS receivedByRole
                FROM credit_collections cc
                WHERE cc.store_id = ?
                  AND cc.order_id = ?
            `;
            const params = [storeId, orderId];

            if (tokenRole === "manager" && tokenBranchId) {
                query += " AND cc.branch_id = ?";
                params.push(tokenBranchId);
            } else if (tokenRole !== "owner") {
                return badRequest(headers, "Only Managers and Owners can view collection history.");
            }

            query += " ORDER BY cc.payment_date DESC, cc.id DESC";
            const [rows] = await connection.execute(query, params);

            return jsonResponse(200, headers, {
                success: true,
                collections: rows,
            });
        }

        if (action === "update_tax_registration") {
            if (tokenRole !== "owner") {
                return badRequest(headers, "Only the Owner can change business tax registration.");
            }

            const registration =
                toSafeString(body.tax_registration ?? body.taxRegistration, 30).toUpperCase();

            if (!["VAT_REGISTERED", "NON_VAT"].includes(registration)) {
                return badRequest(headers, "Invalid tax registration.");
            }

            await connection.execute(
                `UPDATE stores SET tax_registration = ? WHERE id = ?`,
                [registration, storeId]
            );

            const actingEmployee = await getActingEmployee(connection, decodedToken);
            await logEmployeeAction(connection, {
                storeId,
                branchId: null,
                employee: actingEmployee,
                module: "Sales / POS",
                referenceNumber: null,
                action: "Updated business tax registration",
                referenceId: String(storeId),
                details: registration,
            });

            return jsonResponse(200, headers, {
                success: true,
                taxRegistration: registration,
                taxType: registration === "NON_VAT" ? "NON_VAT" : "VAT",
            });
        }

        if (action === "update_order") {
            return badRequest(
                headers,
                "Completed POS transactions are immutable. Void the original transaction and create a corrected sale instead."
            );
        }

        if (action === "void_order") {
            const orderId = toSafeString(body.order_id ?? body.orderId, 255);
            const reason = toSafeString(body.reason ?? body.void_reason ?? body.voidReason, 500);

            if (!orderId) {
                return badRequest(headers, "Invalid order_id.");
            }

            if (tokenRole !== "manager" || !tokenBranchId) {
                return badRequest(headers, "Only an assigned Manager can void POS transactions.");
            }

            if (reason.length < 5) {
                return badRequest(headers, "A clear void reason of at least 5 characters is required.");
            }

            await connection.beginTransaction();

            try {
                const [orderRows] = await connection.execute(
                    `SELECT
                         order_id, control_number, item, total, branch_id, order_date,
                         payment_mode, customer_payment, status
                     FROM orders
                     WHERE order_id = ?
                       AND store_id = ?
                       AND branch_id = ?
                         LIMIT 1
                     FOR UPDATE`,
                    [orderId, storeId, tokenBranchId]
                );

                if (orderRows.length === 0) {
                    await connection.rollback();
                    return notFound(headers, "Order not found.");
                }

                const order = orderRows[0];
                const currentStatus = String(order.status || "COMPLETED").trim().toUpperCase();

                if (["VOID", "VOIDED", "CANCELLED", "CANCELED", "REFUNDED"].includes(currentStatus)) {
                    await connection.rollback();
                    return badRequest(headers, "This transaction has already been voided or cancelled.");
                }

                if (String(order.payment_mode || "").toUpperCase() === "CREDIT") {
                    const [collectionRows] = await connection.execute(
                        `SELECT COALESCE(SUM(amount), 0) AS collected
                         FROM credit_collections
                         WHERE store_id = ? AND order_id = ?`,
                        [storeId, orderId]
                    );
                    const totalPaid = roundMoney(
                        Number(order.customer_payment || 0) + Number(collectionRows[0]?.collected || 0)
                    );

                    if (totalPaid > 0) {
                        await connection.rollback();
                        return badRequest(
                            headers,
                            "This credit sale already has recorded payment. Resolve/refund the payment before voiding the transaction."
                        );
                    }
                }

                const actingEmployee = await getActingEmployee(connection, decodedToken);

                await restoreStockForVoidedOrder(
                    connection,
                    storeId,
                    tokenBranchId,
                    orderId,
                    actingEmployee
                );

                await connection.execute(
                    `UPDATE orders
                     SET status = 'VOIDED', collection_status = 'VOIDED'
                     WHERE order_id = ? AND store_id = ? AND branch_id = ?`,
                    [orderId, storeId, tokenBranchId]
                );

                await rebuildPosDashboardSummaryForDay(
                    connection,
                    storeId,
                    Number(order.branch_id),
                    toISODate(order.order_date)
                );

                await logEmployeeAction(connection, {
                    storeId,
                    branchId: tokenBranchId,
                    employee: actingEmployee,
                    module: "Sales / POS",
                    referenceNumber: order.control_number || orderId,
                    action: "Voided POS transaction",
                    referenceId: orderId,
                    details: `${order.item || "Order"} — Total ₱${order.total ?? 0} — Reason: ${reason}`,
                });

                await connection.commit();

                return jsonResponse(200, headers, {
                    success: true,
                    orderId,
                    status: "VOIDED",
                });
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        }

        return badRequest(
            headers,
            "Invalid action."
        );
    } catch (error) {
        return serverError(
            headers,
            error
        );
    } finally {
        if (connection) {
            connection.release();
        }
    }
};