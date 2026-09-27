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
               AND oi.order_id COLLATE utf8mb4_unicode_ci IN (${placeholders})
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

async function getStoreTaxType(connection, storeId) {
    try {
        const [rows] = await connection.execute(
            `SELECT tax_registration AS taxRegistration FROM stores WHERE id = ? LIMIT 1`,
            [storeId]
        );

        const registration = String(rows[0]?.taxRegistration || "VAT_REGISTERED").toUpperCase();
        return registration === "NON_VAT" || registration === "NON_VAT_REGISTERED" ? "NON_VAT" : "VAT";
    } catch (error) {
        // Backward-compatible fallback if the migration has not been run yet.
        console.warn("POS tax registration lookup failed; defaulting to VAT:", error?.message || error);
        return "VAT";
    }
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
                ) || "Walk-in";

            const customerAddress =
                toSafeString(
                    body.customer_address,
                    255
                ) || "N/A";

            const customerContactNumber =
                toSafeString(
                    body.customer_contact_number ?? body.customerContactNumber,
                    40
                );

            const paymentMode =
                toSafeString(body.payment_mode, 20).toUpperCase() || "CASH";

            const creditTerm =
                toSafeString(body.credit_term, 30) || "N/A";

            // Tax treatment is controlled by the business tax profile.
            // The cashier's request is intentionally ignored here.
            const taxType = await getStoreTaxType(connection, storeId);

            const total =
                roundMoney(toNumber(body.total) ?? 0);

            const orderDate =
                toISODate(body.order_date) ||
                new Date()
                    .toISOString()
                    .slice(0, 10);

            if (total < 0) {
                return badRequest(headers, "Order total cannot be negative.");
            }

            if (!["CASH", "CREDIT"].includes(paymentMode)) {
                return badRequest(headers, "Invalid payment mode.");
            }

            if (paymentMode === "CREDIT" && !["15 Days", "30 Days"].includes(creditTerm)) {
                return badRequest(headers, "A valid credit term is required for credit sales.");
            }

            if (paymentMode === "CREDIT" && !customerContactNumber) {
                return badRequest(headers, "Customer contact number is required for credit sales.");
            }

            const customerPayment = roundMoney(
                toNumber(body.customer_payment) ??
                (paymentMode === "CREDIT" ? 0 : 0)
            );

            if (customerPayment < 0) {
                return badRequest(headers, "Customer payment cannot be negative.");
            }

            if (paymentMode === "CASH" && customerPayment < total) {
                return badRequest(headers, "Cash payment must be equal to or greater than the order total.");
            }

            if (paymentMode === "CREDIT" && customerPayment > total) {
                return badRequest(headers, "Credit sale payment cannot exceed the order total.");
            }

            const vatableSales =
                taxType === "VAT"
                    ? roundMoney(total / 1.12)
                    : 0;

            const vatAmount =
                taxType === "VAT"
                    ? roundMoney(vatableSales * 0.12)
                    : 0;

            const changeDue =
                paymentMode === "CASH"
                    ? roundMoney(customerPayment - total)
                    : 0;

            const creditDays =
                paymentMode === "CREDIT" && creditTerm.startsWith("30") ? 30 : 15;

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
            let controlNumber = "";

            for (
                let attempt = 0;
                attempt < MAX_ORDER_ID_ATTEMPTS;
                attempt += 1
            ) {
                await connection.beginTransaction();

                try {
                    controlNumber =
                        await getNextAvailableControlNumber(
                            connection,
                            orderDate
                        );

                    await connection.execute(
                        `INSERT INTO orders
                         (
                             order_id,
                             control_number,
                             store_id,
                             branch_id,
                             customer_name,
                             customer_address,
                             customer_contact_number,
                             payment_mode,
                             credit_term,
                             credit_due_date,
                             collection_status,
                             tax_type,
                             vatable_sales,
                             vat_amount,
                             customer_payment,
                             change_due,
                             cashier_id,
                             cashier_role,
                             item,
                             total,
                             order_date
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

                    await logEmployeeAction(
                        connection,
                        {
                            storeId,
                            branchId: tokenBranchId,
                            employee: actingEmployee,
                            module: "Sales / POS",
                            referenceNumber: controlNumber,
                            action: "Completed POS transaction",
                            referenceId: orderId,
                            details: `${item} — Total ₱${total} — ${paymentMode} — ${taxType} — VAT ₱${vatAmount}`,
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

            const includeFinancialMetrics = tokenRole === "owner";

            const financialMetricsSelect = includeFinancialMetrics
                ? `
                    /* Owner-only financial fields. Managers and Staff never
                     * receive wholesale/original cost or profit in the API. */
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
                    ) AS totalCost,

                    (
                        o.total -
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
                        )
                    ) AS profit,`
                : `
                    NULL AS totalCost,
                    NULL AS profit,`;

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
                        COALESCE((
                                     SELECT SUM(cc.amount)
                                     FROM credit_collections cc
                                     WHERE cc.store_id = o.store_id
                                       AND cc.order_id COLLATE utf8mb4_unicode_ci = o.order_id COLLATE utf8mb4_unicode_ci
                                 ), 0)
                        ) AS totalPaid,
                    GREATEST(
                            0,
                            o.total - (
                                COALESCE(o.customer_payment, 0) +
                                COALESCE((
                                             SELECT SUM(cc.amount)
                                             FROM credit_collections cc
                                             WHERE cc.store_id = o.store_id
                                               AND cc.order_id COLLATE utf8mb4_unicode_ci = o.order_id COLLATE utf8mb4_unicode_ci
                                         ), 0)
                                )
                    ) AS balance,
                    CASE
                        WHEN UPPER(o.payment_mode) <> 'CREDIT' THEN 'PAID'
                        WHEN o.total - (
                            COALESCE(o.customer_payment, 0) +
                            COALESCE((
                                         SELECT SUM(cc.amount)
                                         FROM credit_collections cc
                                         WHERE cc.store_id = o.store_id
                                           AND cc.order_id COLLATE utf8mb4_unicode_ci = o.order_id COLLATE utf8mb4_unicode_ci
                                     ), 0)
                            ) <= 0 THEN 'PAID'
                        WHEN o.credit_due_date IS NOT NULL AND CURDATE() > o.credit_due_date THEN 'OVERDUE'
                        WHEN (
                                 COALESCE(o.customer_payment, 0) +
                                 COALESCE((
                                              SELECT SUM(cc.amount)
                                              FROM credit_collections cc
                                              WHERE cc.store_id = o.store_id
                                                AND cc.order_id COLLATE utf8mb4_unicode_ci = o.order_id COLLATE utf8mb4_unicode_ci
                                          ), 0)
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
                ON b.id = o.branch_id
                AND b.store_id = o.store_id

                LEFT JOIN order_items oi
                ON oi.order_id COLLATE utf8mb4_unicode_ci = o.order_id COLLATE utf8mb4_unicode_ci
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
                    o.control_number,
                    o.customer_name,
                    o.customer_address,
                    o.customer_contact_number,
                    o.payment_mode,
                    o.credit_term,
                    o.credit_due_date,
                    o.collection_status,
                    o.status,
                    o.tax_type,
                    o.vatable_sales,
                    o.vat_amount,
                    o.customer_payment,
                    o.change_due,
                    o.cashier_id,
                    o.cashier_role,
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

            const storeTaxType = await getStoreTaxType(connection, storeId);

            return jsonResponse(
                200,
                headers,
                {
                    success: true,
                    orders,
                    taxType: storeTaxType,
                    taxRegistration: storeTaxType === "VAT" ? "VAT_REGISTERED" : "NON_VAT",
                }
            );
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
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
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
                const dueTime = order.credit_due_date
                    ? new Date(order.credit_due_date).getTime()
                    : NaN;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const overdue = Number.isFinite(dueTime) && dueTime < today.getTime();
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

            if (tokenRole !== "manager" || !tokenBranchId) {
                return badRequest(
                    headers,
                    "Only an assigned Manager can modify completed POS orders."
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
                    order_date = ?,
                    status = 'MODIFIED'
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

            if (tokenRole !== "manager" || !tokenBranchId) {
                return badRequest(
                    headers,
                    "Only an assigned Manager can delete POS orders."
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