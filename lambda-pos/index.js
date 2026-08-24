/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const fs = require("fs");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "020820@Steph",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

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
    for (const line of items) {
        const productId = getProductId(line);
        const variantId = getVariantId(line);

        const quantity = toPositiveInteger(
            line.quantity ?? line.qty
        );

        const productName =
            getProductName(line) ||
            `Product #${productId || ""}`;

        const unitPrice =
            toNumber(
                line.unit_price ??
                line.unitPrice ??
                line.price ??
                line.sales_price ??
                line.salesPrice
            ) ?? 0;

        if (!productId) {
            throw new Error(
                "Each POS item must include a valid product_id."
            );
        }

        if (!quantity) {
            throw new Error(
                "Each POS item must include a valid quantity."
            );
        }

        const lineTotal = unitPrice * quantity;

        await connection.execute(
            `INSERT INTO order_items
             (
                 order_id,
                 store_id,
                 branch_id,
                 product_id,
                 variant_id,
                 product_name,
                 quantity,
                 unit_price,
                 line_total
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            ]
        );
    }
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
                 CASE
                     WHEN oi.variant_id IS NOT NULL
                         THEN COALESCE(
                             pv.original_price,
                             p.original_price,
                             0
                              )
                     ELSE COALESCE(
                             p.original_price,
                             0
                          )
                     END AS costPrice
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

async function decreaseStockForOrder(
    connection,
    storeId,
    branchId,
    items
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
        connection =
            await mysql.createConnection(dbConfig);

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

        if (action === "create_order") {
            const requestedOrderId =
                toSafeString(
                    body.order_id,
                    255
                );

            const customerName =
                toSafeString(
                    body.customer_name,
                    120
                ) || "Customer";

            const total =
                toNumber(body.total) ?? 0;

            const orderDate =
                toISODate(body.order_date) ||
                new Date()
                    .toISOString()
                    .slice(0, 10);

            const orderLines =
                getOrderLines(body);

            if (!requestedOrderId) {
                return badRequest(
                    headers,
                    "order_id is required."
                );
            }

            if (!isBranchUser || !tokenBranchId) {
                return badRequest(
                    headers,
                    "Only an assigned Manager or Staff branch can create POS orders."
                );
            }

            if (orderLines.length === 0) {
                return badRequest(
                    headers,
                    "At least one POS item is required."
                );
            }

            const item =
                toSafeString(
                    body.item ||
                    formatOrderItems(orderLines),
                    255
                );

            let orderId =
                await getNextAvailablePosOrderId(
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
                    await connection.execute(
                        `INSERT INTO orders
                         (
                             order_id,
                             store_id,
                             branch_id,
                             item,
                             total,
                             order_date
                         )
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            orderId,
                            storeId,
                            tokenBranchId,
                            item,
                            total,
                            orderDate,
                        ]
                    );

                    await insertOrderItems(
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
                        orderLines
                    );

                    const actingEmployee =
                        await getActingEmployee(
                            connection,
                            decodedToken
                        );

                    await logEmployeeAction(
                        connection,
                        {
                            storeId,
                            branchId: tokenBranchId,
                            employee: actingEmployee,
                            module: "Sales / POS",
                            referenceNumber: orderId,
                            action: "Completed POS transaction",
                            referenceId: orderId,
                            details: `${item} — Total ₱${total}`,
                        }
                    );

                    await connection.commit();

                    const [rows] =
                        await connection.execute(
                            `SELECT
                                 o.order_id AS orderId,
                                 o.store_id AS storeId,
                                 o.branch_id AS branchId,

                                 COALESCE(
                                         NULLIF(
                                                 TRIM(b.branch_name),
                                                 ''
                                         ),
                                         CONCAT(
                                                 'Branch ',
                                                 o.branch_id
                                         ),
                                         'Unassigned'
                                 ) AS branchName,

                                 COALESCE(
                                         NULLIF(
                                                 TRIM(b.branch_name),
                                                 ''
                                         ),
                                         CONCAT(
                                                 'Branch ',
                                                 o.branch_id
                                         ),
                                         'Unassigned'
                                 ) AS branch,

                                 o.item,
                                 o.total,
                                 DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
                                 o.created_at AS createdAt

                             FROM orders o

                                      LEFT JOIN branches b
                                                ON b.id = o.branch_id
                                                    AND b.store_id = o.store_id

                             WHERE o.order_id = ?

                                 LIMIT 1`,
                            [orderId]
                        );

                    const orderItemsById =
                        await loadOrderItemsForOrders(
                            connection,
                            storeId,
                            [orderId]
                        );

                    return jsonResponse(
                        201,
                        headers,
                        {
                            success: true,
                            order: {
                                ...rows[0],
                                orderItems:
                                    orderItemsById.get(
                                        String(orderId)
                                    ) || [],
                            },
                        }
                    );
                } catch (error) {
                    await connection.rollback();

                    /*
                     * Two branches/staff users can submit at almost the same
                     * moment. If that happens, recalculate the next sequence
                     * and retry rather than returning ER_DUP_ENTRY.
                     */
                    if (
                        error?.code === "ER_DUP_ENTRY" &&
                        attempt <
                        MAX_ORDER_ID_ATTEMPTS - 1
                    ) {
                        orderId =
                            await getNextAvailablePosOrderId(
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
                "Unable to generate a unique POS order ID."
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
                await decreaseStockForOrder(
                    connection,
                    storeId,
                    tokenBranchId,
                    orderLines
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

        if (action === "get_orders") {
            const requestedDateFrom = toISODate(
                body.date_from ??
                body.dateFrom ??
                body.start_date ??
                body.startDate
            );

            const requestedDateTo = toISODate(
                body.date_to ??
                body.dateTo ??
                body.end_date ??
                body.endDate
            );

            if (
                requestedDateFrom &&
                requestedDateTo &&
                requestedDateFrom > requestedDateTo
            ) {
                return badRequest(
                    headers,
                    "date_from cannot be later than date_to."
                );
            }

            let query = `
                SELECT
                    o.order_id AS orderId,
                    o.store_id AS storeId,
                    o.branch_id AS branchId,

                    COALESCE(
                            NULLIF(
                                    TRIM(b.branch_name),
                                    ''
                            ),
                            CONCAT(
                                    'Branch ',
                                    o.branch_id
                            ),
                            'Unassigned'
                    ) AS branchName,

                    COALESCE(
                            NULLIF(
                                    TRIM(b.branch_name),
                                    ''
                            ),
                            CONCAT(
                                    'Branch ',
                                    o.branch_id
                            ),
                            'Unassigned'
                    ) AS branch,

                    o.item,
                    o.total,

                    /*
                     * Calculate cost from the exact products/variants that
                     * belong to each order item. This avoids frontend
                     * product-name matching and keeps branch profit accurate.
                     *
                     * If an older order has no order_items rows, fall back to
                     * its sales total so the profit is safely reported as 0.
                     */
                    COALESCE(
                            SUM(
                                    CASE
                                        WHEN oi.id IS NULL THEN NULL
                                        ELSE
                                            COALESCE(
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
                    ) AS totalCost,

                    (
                        o.total -
                        COALESCE(
                                SUM(
                                        CASE
                                            WHEN oi.id IS NULL THEN NULL
                                            ELSE
                                                COALESCE(
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
                        )
                        ) AS profit,

                    DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
                    o.created_at AS createdAt

                FROM orders o

                         LEFT JOIN branches b
                                   ON b.id = o.branch_id
                                       AND b.store_id = o.store_id

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
            `;

            const params = [storeId];

            if (
                isBranchUser &&
                tokenBranchId
            ) {
                query +=
                    " AND o.branch_id = ?";

                params.push(tokenBranchId);
            } else if (
                tokenRole === "owner" &&
                requestedBranchId
            ) {
                query +=
                    " AND o.branch_id = ?";

                params.push(requestedBranchId);
            }

            if (requestedDateFrom) {
                query += " AND o.order_date >= ?";
                params.push(requestedDateFrom);
            }

            if (requestedDateTo) {
                query += " AND o.order_date <= ?";
                params.push(requestedDateTo);
            }

            query += `
                GROUP BY
                    o.order_id,
                    o.store_id,
                    o.branch_id,
                    b.branch_name,
                    o.item,
                    o.total,
                    o.order_date,
                    o.created_at
                ORDER BY o.created_at DESC, o.order_id DESC
            `;

            const [rows] =
                await connection.execute(
                    query,
                    params
                );

            /*
             * The POS screens use o.item for their order rows and totals.
             * Loading every order_items row for every order made the Owner
             * view extremely slow when a store had thousands of orders.
             * Detailed order items are now loaded only when explicitly asked.
             */
            const includeOrderItems =
                body.include_order_items === true ||
                body.includeOrderItems === true;

            let orders = rows;

            if (includeOrderItems && rows.length > 0) {
                const orderItemsById = await loadOrderItemsForOrders(
                    connection,
                    storeId,
                    rows.map((row) => row.orderId)
                );

                orders = rows.map((row) => ({
                    ...row,
                    orderItems:
                        orderItemsById.get(String(row.orderId)) || [],
                }));
            }

            return jsonResponse(
                200,
                headers,
                {
                    success: true,
                    orders,
                }
            );
        }

        if (action === "update_order") {
            const orderId =
                toSafeString(
                    body.order_id,
                    255
                );

            if (!orderId) {
                return badRequest(
                    headers,
                    "Invalid order_id."
                );
            }

            const item =
                toSafeString(
                    body.item,
                    255
                );

            const total =
                toNumber(body.total) ?? 0;

            const orderDate =
                toISODate(body.order_date) ||
                new Date()
                    .toISOString()
                    .slice(0, 10);

            let query = `
                UPDATE orders
                SET
                    item = ?,
                    total = ?,
                    order_date = ?
                WHERE order_id = ?
                  AND store_id = ?
            `;

            const params = [
                item,
                total,
                orderDate,
                orderId,
                storeId,
            ];

            if (
                isBranchUser &&
                tokenBranchId
            ) {
                query +=
                    " AND branch_id = ?";

                params.push(tokenBranchId);
            }

            const [result] =
                await connection.execute(
                    query,
                    params
                );

            if (result.affectedRows === 0) {
                return notFound(
                    headers,
                    "Order not found."
                );
            }

            try {
                const actingEmployee =
                    await getActingEmployee(
                        connection,
                        decodedToken
                    );

                await logEmployeeAction(
                    connection,
                    {
                        storeId,
                        branchId: tokenBranchId,
                        employee: actingEmployee,
                        module: "Sales / POS",
                        referenceNumber: orderId,
                        action: "Updated POS order",
                        referenceId: orderId,
                        details: `${item} — Total ₱${total}`,
                    }
                );
            } catch (logError) {
                // The order update already succeeded; don't fail the
                // request just because the activity log couldn't be written.
                console.error(
                    "employee_actions logging failed for update_order:",
                    logError
                );
            }

            return jsonResponse(
                200,
                headers,
                {
                    success: true,
                }
            );
        }

        if (action === "delete_order") {
            const orderId =
                toSafeString(
                    body.order_id,
                    255
                );

            if (!orderId) {
                return badRequest(
                    headers,
                    "Invalid order_id."
                );
            }

            await connection.beginTransaction();

            try {
                let lookupQuery = `
                    SELECT order_id, item, total, branch_id
                    FROM orders
                    WHERE order_id = ?
                      AND store_id = ?
                `;

                const lookupParams = [
                    orderId,
                    storeId,
                ];

                if (
                    isBranchUser &&
                    tokenBranchId
                ) {
                    lookupQuery +=
                        " AND branch_id = ?";

                    lookupParams.push(
                        tokenBranchId
                    );
                }

                const [orders] =
                    await connection.execute(
                        lookupQuery,
                        lookupParams
                    );

                if (orders.length === 0) {
                    await connection.rollback();

                    return notFound(
                        headers,
                        "Order not found."
                    );
                }

                const deletedOrder = orders[0];

                await connection.execute(
                    `DELETE FROM order_items
                     WHERE order_id = ?`,
                    [orderId]
                );

                await connection.execute(
                    `DELETE FROM orders
                     WHERE order_id = ?
                       AND store_id = ?`,
                    [
                        orderId,
                        storeId,
                    ]
                );

                const actingEmployee =
                    await getActingEmployee(
                        connection,
                        decodedToken
                    );

                await logEmployeeAction(
                    connection,
                    {
                        storeId,
                        branchId:
                            tokenBranchId ||
                            deletedOrder.branch_id,
                        employee: actingEmployee,
                        module: "Sales / POS",
                        referenceNumber: orderId,
                        action: "Deleted POS order",
                        referenceId: orderId,
                        details: `${deletedOrder.item || "Order"} — Total ₱${deletedOrder.total ?? 0}`,
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
            await connection.end();
        }
    }
};