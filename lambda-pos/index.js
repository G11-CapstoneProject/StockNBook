/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "stocknbook-db.ctc4eeuyq62e.ap-southeast-1.rds.amazonaws.com",
    user: "admin",
    password: "2qJivedWDxCQS6TLjjEl",
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

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
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

async function insertOrderItems(connection, orderId, items) {
    for (const line of items) {
        const productId = getProductId(line);
        const variantId = getVariantId(line);
        const quantity = toPositiveInteger(line.quantity ?? line.qty);

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
            throw new Error("Each POS item must include a valid product_id.");
        }

        if (!quantity) {
            throw new Error("Each POS item must include a valid quantity.");
        }

        await connection.execute(
            `INSERT INTO order_items
                (order_id, product_id, variant_id, product_name, quantity, unit_price)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                orderId,
                productId,
                variantId || null,
                productName,
                quantity,
                unitPrice,
            ]
        );
    }
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
                 INNER JOIN products p ON p.id = pv.product_id
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

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
        return badRequest(headers, "Invalid JSON body.");
    }

    const rawAction = toSafeString(body.action, 80);
    const normalizedAction = normalizeAction(rawAction);

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

    const action = actionAliases[normalizedAction] || normalizedAction;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const authHeader =
            event?.headers?.authorization ||
            event?.headers?.Authorization ||
            "";

        if (!authHeader) {
            return unauthorized(headers, "No token provided.");
        }

        let storeId;
        let tokenBranchId = null;
        let tokenRole = "";

        try {
            const token = authHeader.replace(/^Bearer\s+/i, "");
            const decoded = jwt.verify(token, JWT_SECRET);

            storeId = Number(decoded.store_id);
            tokenBranchId = decoded.branch_id
                ? Number(decoded.branch_id)
                : null;
            tokenRole = String(decoded.role || "").toLowerCase();
        } catch {
            return unauthorized(headers, "Invalid token.");
        }

        if (!Number.isInteger(storeId) || storeId <= 0) {
            return unauthorized(headers, "Invalid store in token.");
        }

        const storeExists = await ensureStoreExists(connection, storeId);

        if (!storeExists) {
            return badRequest(headers, "Store account not found.");
        }

        const isBranchUser =
            tokenRole === "manager" ||
            tokenRole === "staff";

        if (isBranchUser) {
            if (!Number.isInteger(tokenBranchId) || tokenBranchId <= 0) {
                return badRequest(
                    headers,
                    "Missing branch_id in token for this user."
                );
            }

            const branchExists = await ensureBranchBelongsToStore(
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
            const orderId = toSafeString(body.order_id, 255);
            const customerName =
                toSafeString(body.customer_name, 120) ||
                "Customer";

            const total = toNumber(body.total) ?? 0;

            const orderDate =
                toISODate(body.order_date) ||
                new Date().toISOString().slice(0, 10);

            const orderLines = getOrderLines(body);

            if (!orderId) {
                return badRequest(headers, "order_id is required.");
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

            const item = toSafeString(
                body.item || formatOrderItems(orderLines),
                255
            );

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
                    orderLines
                );

                await decreaseStockForOrder(
                    connection,
                    storeId,
                    tokenBranchId,
                    orderLines
                );

                await connection.commit();

                const [rows] = await connection.execute(
                    `SELECT
                         o.order_id AS orderId,
                         o.store_id AS storeId,
                         o.branch_id AS branchId,
                         COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branchName,
                         COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branch,
                       
                         o.item,
                         o.total,
                         o.order_date AS orderDate,
                         o.created_at AS createdAt
                     FROM orders o
                              LEFT JOIN branches b
                                        ON b.id = o.branch_id
                                            AND b.store_id = o.store_id
                     WHERE o.order_id = ?
                         LIMIT 1`,
                    [orderId]
                );

                return jsonResponse(201, headers, {
                    success: true,
                    order: rows[0],
                });
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        }

        if (action === "decrease_stock") {
            const orderLines = getOrderLines(body);

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

                return jsonResponse(200, headers, {
                    success: true,
                });
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        }

        if (action === "get_orders") {
            let query = `
                SELECT
                    o.order_id AS orderId,
                    o.store_id AS storeId,
                    o.branch_id AS branchId,
                    COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branchName,
                    COALESCE(NULLIF(TRIM(b.branch_name), ''), CONCAT('Branch ', o.branch_id), 'Unassigned') AS branch,
                   
                    o.item,
                    o.total,
                    o.order_date AS orderDate,
                    o.created_at AS createdAt
                FROM orders o
                         LEFT JOIN branches b
                                   ON b.id = o.branch_id
                                       AND b.store_id = o.store_id
                WHERE o.store_id = ?
            `;

            const params = [storeId];

            if (isBranchUser && tokenBranchId) {
                query += " AND o.branch_id = ?";
                params.push(tokenBranchId);
            }

            query += " ORDER BY o.created_at DESC, o.order_id DESC";

            const [rows] = await connection.execute(query, params);

            return jsonResponse(200, headers, {
                success: true,
                orders: rows,
            });
        }

        if (action === "update_order") {
            const orderId = toSafeString(body.order_id, 255);

            if (!orderId) {
                return badRequest(headers, "Invalid order_id.");
            }

            const item = toSafeString(body.item, 255);
            const total = toNumber(body.total) ?? 0;

            const orderDate =
                toISODate(body.order_date) ||
                new Date().toISOString().slice(0, 10);

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

            if (isBranchUser && tokenBranchId) {
                query += " AND branch_id = ?";
                params.push(tokenBranchId);
            }

            const [result] = await connection.execute(query, params);

            if (result.affectedRows === 0) {
                return notFound(headers, "Order not found.");
            }

            return jsonResponse(200, headers, {
                success: true,
            });
        }

        if (action === "delete_order") {
            const orderId = toSafeString(body.order_id, 255);

            if (!orderId) {
                return badRequest(headers, "Invalid order_id.");
            }

            await connection.beginTransaction();

            try {
                let lookupQuery = `
                    SELECT order_id
                    FROM orders
                    WHERE order_id = ?
                      AND store_id = ?
                `;

                const lookupParams = [orderId, storeId];

                if (isBranchUser && tokenBranchId) {
                    lookupQuery += " AND branch_id = ?";
                    lookupParams.push(tokenBranchId);
                }

                const [orders] = await connection.execute(
                    lookupQuery,
                    lookupParams
                );

                if (orders.length === 0) {
                    await connection.rollback();
                    return notFound(headers, "Order not found.");
                }

                await connection.execute(
                    "DELETE FROM order_items WHERE order_id = ?",
                    [orderId]
                );

                await connection.execute(
                    "DELETE FROM orders WHERE order_id = ? AND store_id = ?",
                    [orderId, storeId]
                );

                await connection.commit();

                return jsonResponse(200, headers, {
                    success: true,
                });
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        }

        return badRequest(headers, "Invalid action.");
    } catch (error) {
        return serverError(headers, error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};