/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

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

function serverError(headers, error) {
    console.error("POS Lambda error:", error);

    return jsonResponse(500, headers, {
        error:
            error instanceof Error
                ? error.message
                : "Internal server error",
    });
}

// Resolve operational access from the current database row, not a cached browser permission.
// Keep legacy access keys compatible with existing Manager/Staff records.
function normalizeOperationalAccess(permissions, moduleName, role) {
    let values = permissions;
    if (typeof values === "string") {
        try { values = JSON.parse(values); } catch { values = {}; }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) values = {};

    const keys = moduleName === "bookings"
        ? ["bookings", "booking_access", "bookings_access"]
        : ["pos", "pos_access", "sales_access"];
    const selected = keys.find((key) => Object.prototype.hasOwnProperty.call(values, key));
    if (!selected) {
        // Sensible legacy defaults: Manager sees branch sales; Staff runs checkout.
        if (moduleName === "pos") return role === "manager" ? "view" : role === "staff" ? "full" : "none";
        return role === "manager" ? "full" : "none";
    }
    const access = values[selected];
    if (access === true || access === 1 || access === "1" || access === "true" || access === "full") return "full";
    if (access === "view" || access === "view_only" || access === "viewOnly") return "view";
    return "none";
}

async function getOperationalAccess(connection, decoded, moduleName) {
    const role = String(decoded?.role || "").trim().toLowerCase();
    if (role === "owner") return "full";
    if (role !== "manager" && role !== "staff") return "none";

    const storeId = Number(decoded?.store_id);
    const branchId = Number(decoded?.branch_id);
    const employeeId = Number(role === "manager" ? decoded?.manager_id : decoded?.staff_id);
    if (![storeId, branchId, employeeId].every((id) => Number.isSafeInteger(id) && id > 0)) return "none";

    const table = role === "manager" ? "managers" : "staff";
    const [rows] = await connection.execute(
        `SELECT permissions FROM ${table} WHERE id = ? AND store_id = ? AND branch_id = ? AND LOWER(status) = 'active' LIMIT 1`,
        [employeeId, storeId, branchId]
    );
    if (!rows.length) return "none";
    return normalizeOperationalAccess(rows[0].permissions, moduleName, role);
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
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

const POS_CASHIER_NAME_SQL = `(SELECT ea.employee_name FROM employee_actions ea
    WHERE ea.store_id = o.store_id AND ea.reference_id COLLATE utf8mb4_unicode_ci = o.order_id
      AND ea.action = 'Completed POS transaction'
    ORDER BY ea.id DESC LIMIT 1)`;
const POS_CASHIER_ROLE_SQL = `(SELECT ea.employee_role FROM employee_actions ea
    WHERE ea.store_id = o.store_id AND ea.reference_id COLLATE utf8mb4_unicode_ci = o.order_id
      AND ea.action = 'Completed POS transaction'
    ORDER BY ea.id DESC LIMIT 1)`;

const POS_WALKIN_ORDER_FILTER_SQL = `(
    UPPER(TRIM(COALESCE(o.customer_type, ''))) = 'WALK_IN'
    OR o.order_id LIKE '%-POS-%'
    OR o.control_number LIKE 'INV-%'
)`;

// All POS sales are paid at checkout and stored in orders/order_items.
// Extra POS status and credit tables are not used by this module.
const POS_SALE_FILTER_SQL = `
    ${POS_WALKIN_ORDER_FILTER_SQL}
    AND UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')
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

async function getStoreTaxType(connection, storeId, lock = false) {
    const [rows] = await connection.execute(
        `SELECT tax_registration AS taxRegistration FROM stores WHERE id = ? LIMIT 1${lock ? " FOR SHARE" : ""}`,
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

        // Full/Read-only POS access comes from the current active employee row.
        // Manager defaults only apply to legacy records missing a POS permission;
        // an explicit 'none' or 'view' always wins.
        if (!["owner", "manager", "staff"].includes(tokenRole)) {
            return jsonResponse(403, headers, { error: "Business account role required." });
        }
        const posAccess = await getOperationalAccess(connection, decodedToken, "pos");
        if (posAccess === "none") {
            return jsonResponse(403, headers, { error: "POS access is not permitted for this account." });
        }
        const posReadActions = new Set([
            "get_orders", "get_owner_dashboard_summary", "get_tax_registration",
        ]);
        if (posAccess !== "full" && !posReadActions.has(action)) {
            return jsonResponse(403, headers, { error: "Full POS access is required for this action." });
        }

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

        if (action === "get_tax_registration") {
            const taxType = await getStoreTaxType(connection, storeId);
            return jsonResponse(200, headers, {
                success: true,
                taxType,
                taxRegistration: taxType === "VAT" ? "VAT_REGISTERED" : "NON_VAT",
            });
        }

        if (action === "create_order") {
            const requestedOrderId = toSafeString(body.order_id, 255);
            const paymentMode =
                toSafeString(body.payment_mode, 20).toUpperCase() || "CASH";
            const orderDate =
                toISODate(body.order_date) || getManilaISODate();
            const rawOrderLines = getOrderLines(body);
            const customerPayment = roundMoney(
                toNumber(body.customer_payment) ?? 0
            );

            if (!requestedOrderId) {
                return badRequest(headers, "order_id is required.");
            }

            if (tokenRole !== "staff" || !tokenBranchId) {
                return jsonResponse(403, headers, { error: "Only assigned Staff can create POS transactions." });
            }

            if (rawOrderLines.length === 0) {
                return badRequest(headers, "At least one POS item is required.");
            }

            if (!["CASH", "GCASH", "BANK_TRANSFER"].includes(paymentMode)) {
                return badRequest(headers, "Invalid payment mode.");
            }

            // This checkout accepts walk-in sales only. Customer names, addresses,
            // no personal customer information or deferred payments are collected.
            if (customerPayment < 0) {
                return badRequest(headers, "Customer payment cannot be negative.");
            }

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
                    // Lock tax registration for the sale; owner edits wait until checkout commits.
                    const taxType = await getStoreTaxType(connection, storeId, true);
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

                    if (["GCASH", "BANK_TRANSFER"].includes(paymentMode) && customerPayment !== total) {
                        await connection.rollback();
                        return badRequest(headers, "GCash and bank-transfer amounts must equal the POS order total.");
                    }

                    if (paymentMode === "CASH" && customerPayment < total) {
                        await connection.rollback();
                        return badRequest(
                            headers,
                            "Cash payment must be equal to or greater than the order total."
                        );
                    }

                    // total is the VAT-INCLUSIVE GRAND TOTAL, not a pre-tax subtotal.
                    // Never add the VAT amount on top of total a second time.
                    // NON_VAT stores retain the full sales amount as total with 0 VAT.
                    const vatableSales =
                        taxType === "VAT" ? roundMoney(total / 1.12) : 0;
                    const vatAmount =
                        taxType === "VAT" ? roundMoney(total - vatableSales) : 0;
                    const changeDue =
                        paymentMode === "CASH"
                            ? roundMoney(customerPayment - total)
                            : 0;
                    const item = toSafeString(
                        formatOrderItems(orderLines),
                        255
                    );
                    const controlNumber = await getNextAvailableControlNumber(
                        connection,
                        orderDate
                    );

                    // Record the cashier once when creating the sales header.
                    const actingEmployee = await getActingEmployee(
                        connection,
                        decodedToken
                    );

                    // One completed sales header and itemized product lines.
                    // Record checkout in the shared employee_actions audit log.
                    await connection.execute(
                        `INSERT INTO orders
                         (
                             order_id, control_number, store_id, branch_id,
                             cashier_id, customer_type, payment_mode, tax_type,
                             vatable_sales, vat_amount, customer_payment, change_due,
                             item, total, order_date
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            orderId,
                            controlNumber,
                            storeId,
                            tokenBranchId,
                            actingEmployee.id,
                            "WALK_IN",
                            paymentMode,
                            taxType,
                            vatableSales,
                            vatAmount,
                            customerPayment,
                            changeDue,
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

                    await logEmployeeAction(connection, {
                        storeId,
                        branchId: tokenBranchId,
                        employee: actingEmployee,
                        module: "Sales / POS",
                        referenceNumber: controlNumber,
                        action: "Completed POS transaction",
                        referenceId: orderId,
                        details: `${item} — Grand Total ₱${total} — ${paymentMode} — ${taxType} — VATable ₱${vatableSales} — VAT ₱${vatAmount}`,
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
                             'Walk-in' AS customerName,
                             o.customer_type AS customerType,
                             NULL AS customerAddress,
                             NULL AS customerContactNumber,
                             o.payment_mode AS paymentMode,
                             NULL AS creditTerm,
                             NULL AS creditDueDate,
                             'PAID' AS collectionStatus,
                             o.tax_type AS taxType,
                             o.vatable_sales AS vatableSales,
                             o.vat_amount AS vatAmount,
                             o.customer_payment AS customerPayment,
                             o.customer_payment AS totalPaid,
                             GREATEST(0, o.total - o.customer_payment) AS balance,
                             o.change_due AS changeDue,
                             o.cashier_id AS cashierId,
                             NULL AS cashierName,
                             NULL AS cashierRole,
                             o.item,
                             o.total,
                             o.total AS grandTotal,
                             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
                             DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
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
                            cashierName: actingEmployee.name,
                            cashierRole: actingEmployee.role,
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
                     COALESCE(SUM(COALESCE(oi.cost_price_at_sale,0) * COALESCE(oi.quantity,0)),0) AS cost
                     FROM orders o
                     LEFT JOIN order_items oi
                     ON oi.order_id = o.order_id
                     AND oi.store_id = o.store_id
                     WHERE o.store_id = ?
                     AND o.order_date >= ?
                     AND o.order_date <= ?
                     AND ${POS_SALE_FILTER_SQL}
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
                   AND ${POS_SALE_FILTER_SQL}
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
                   AND ${POS_SALE_FILTER_SQL}
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
            const dateFrom = toISODate(body.date_from ?? body.dateFrom ?? body.start_date ?? body.startDate);
            const dateTo = toISODate(body.date_to ?? body.dateTo ?? body.end_date ?? body.endDate);
            if (dateFrom && dateTo && dateFrom > dateTo) {
                return badRequest(headers, "date_from cannot be later than date_to.");
            }
            // Exclude historical credit rows; POS only supports immediate payments.
            const where = ["o.store_id = ?", POS_WALKIN_ORDER_FILTER_SQL,
                "UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')"];
            const params = [storeId];
            if (isBranchUser) {
                where.push("o.branch_id = ?");
                params.push(tokenBranchId);
            } else if (requestedBranchId) {
                where.push("o.branch_id = ?");
                params.push(requestedBranchId);
            }
            if (dateFrom) { where.push("o.order_date >= ?"); params.push(dateFrom); }
            if (dateTo) { where.push("o.order_date <= ?"); params.push(dateTo); }
            const search = toSafeString(body.search ?? body.query ?? body.order_search ?? body.orderSearch, 120);
            if (search) {
                where.push("(o.order_id LIKE ? OR o.control_number LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }
            const whereSql = where.join(' AND ');
            const includeFinancials = tokenRole === 'owner';
            const paginate = body.paginate === true || includeFinancials;
            const page = Math.max(1, toPositiveInteger(body.page) || 1);
            const pageSize = paginate ? Math.min(100, Math.max(10, toPositiveInteger(body.page_size ?? body.pageSize) || 50)) : null;
            const offset = paginate ? (page - 1) * pageSize : 0;

            // Cost & profit are only visible to Owner; cost snapshot is stored in order_items.
            const metrics = includeFinancials ? `
                COALESCE(item_cost.cost, 0) AS totalCost,
                (o.total - COALESCE(o.vat_amount, 0) - COALESCE(item_cost.cost, 0)) AS profit,`
                : 'NULL AS totalCost, NULL AS profit,';
            const joinMetrics = includeFinancials ? `LEFT JOIN (
                SELECT store_id, order_id,
                    SUM(COALESCE(cost_price_at_sale,0) * quantity) AS cost
                FROM order_items GROUP BY store_id, order_id
            ) AS item_cost ON item_cost.order_id = o.order_id AND item_cost.store_id = o.store_id` : '';
            let query = `SELECT
                             o.order_id AS orderId, o.store_id AS storeId, o.branch_id AS branchId,
                             COALESCE(NULLIF(TRIM(b.branch_name),''), CONCAT('Branch ', o.branch_id)) AS branchName,
                             o.control_number AS controlNumber, 'Walk-in' AS customerName,
                             o.customer_type AS customerType, o.payment_mode AS paymentMode,
                             o.tax_type AS taxType, o.vatable_sales AS vatableSales,
                             o.vat_amount AS vatAmount, o.customer_payment AS customerPayment,
                             o.customer_payment AS totalPaid, GREATEST(0,o.total-COALESCE(o.customer_payment,0)) AS balance,
                             'PAID' AS collectionStatus, o.change_due AS changeDue,
                             o.cashier_id AS cashierId,
                             ${POS_CASHIER_NAME_SQL} AS cashierName,
                             ${POS_CASHIER_ROLE_SQL} AS cashierRole,
                             o.item, o.total, o.total AS grandTotal,
                             CASE WHEN UPPER(o.tax_type)='VAT' THEN 'VAT_REGISTERED' ELSE 'NON_VAT' END AS taxRegistration,
                             ${metrics}
                                 DATE_FORMAT(o.order_date,'%Y-%m-%d') AS orderDate,
                             DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
                         FROM orders o
                                  LEFT JOIN branches b ON b.id=o.branch_id AND b.store_id=o.store_id
                             ${joinMetrics}
                         WHERE ${whereSql}
                         ORDER BY o.created_at DESC, o.order_id DESC`;
            if (paginate) query += ` LIMIT ${pageSize} OFFSET ${offset}`;
            const [rows] = await connection.execute(query, params);
            const includeItems = body.include_order_items === true || body.includeOrderItems === true || isBranchUser;
            let orders = rows;
            if (includeItems && rows.length) {
                const byId = await loadOrderItemsForOrders(connection, storeId, rows.map(r => r.orderId));
                orders = rows.map(r => ({...r, orderItems: byId.get(String(r.orderId)) || []}));
            }
            let pagination = null;
            if (paginate) {
                const [[count]] = await connection.execute(`SELECT COUNT(*) AS total FROM orders o WHERE ${whereSql}`,params);
                const total = Number(count.total || 0), totalPages = Math.max(1,Math.ceil(total/pageSize));
                pagination = {page,pageSize,total,totalPages,hasPrevious:page>1,hasMore:page<totalPages};
            }
            let summary = null;
            if (tokenRole === 'manager') {
                // Server-scoped totals for all matching branch transactions,
                // not just the 50 rows on the current page. Never expose cost.
                const [[totals]] = await connection.execute(`SELECT
                                                                 COUNT(*) AS transactions,
                                                                 COALESCE(SUM(o.total), 0) AS sales,
                                                                 COALESCE(SUM(o.vat_amount), 0) AS vat
                                                             FROM orders o WHERE ${whereSql} AND ${POS_SALE_FILTER_SQL}`, params);
                summary = {
                    transactions: Number(totals.transactions || 0),
                    sales: roundMoney(totals.sales),
                    vat: roundMoney(totals.vat),
                };
            }
            if (includeFinancials) {
                const [[totals]] = await connection.execute(`SELECT
                                                                 COUNT(*) AS transactions, COALESCE(SUM(o.total),0) AS sales,
                                                                 COALESCE(SUM(COALESCE(c.cost,0)),0) AS cost,
                                                                 COALESCE(SUM(o.total-COALESCE(o.vat_amount,0)-COALESCE(c.cost,0)),0) AS profit
                                                             FROM orders o LEFT JOIN (
                                                                 SELECT store_id,order_id,SUM(COALESCE(cost_price_at_sale,0)*quantity) AS cost
                                                                 FROM order_items GROUP BY store_id,order_id
                                                             ) c ON c.order_id=o.order_id AND c.store_id=o.store_id
                                                             WHERE ${whereSql} AND ${POS_SALE_FILTER_SQL}`,params);
                summary = {transactions:Number(totals.transactions||0),sales:roundMoney(totals.sales),
                    cost:roundMoney(totals.cost), profit:roundMoney(totals.profit)};
            }
            const taxType = await getStoreTaxType(connection,storeId);
            return jsonResponse(200,headers,{success:true,orders,pagination,summary,
                taxType,taxRegistration:taxType==='VAT'?'VAT_REGISTERED':'NON_VAT'});
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

            // Commit the owner setting and audit trail together. A concurrent
            // sale locks the store record while taking its tax snapshot.
            await connection.beginTransaction();
            try {
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
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            }

            return jsonResponse(200, headers, {
                success: true,
                taxRegistration: registration,
                taxType: registration === "NON_VAT" ? "NON_VAT" : "VAT",
            });
        }

        if (["check_customer_credit", "record_collection", "get_collection_history"].includes(action)) {
            return badRequest(headers, "Customer credit is not supported by StockNBook POS.");
        }

        // Unsupported operations, including legacy transaction mutations,
        // are rejected here. Completed POS sales are read-only.
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