/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "stocknbook-db.clyuqe48evd0.ap-southeast-1.rds.amazonaws.com",
    user: "admin",
    password: "2qJivedWDxCQS6TLjjEl",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

function badRequest(headers, message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: message }) };
}
function unauthorized(headers, message) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: message }) };
}
function serverError(headers) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error" }) };
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}
function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function toISODate(value) {
    const raw = toSafeString(value, 40);
    const iso = new Date(raw);
    if (!raw) return null;
    if (!Number.isFinite(iso.getTime())) return null;
    return iso.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatOrderItems(items) {
    if (!Array.isArray(items)) return "";

    return items
        .map((line) => {
            const productName = toSafeString(
                line.product_name ??
                line.productName ??
                line.name ??
                line.item ??
                `Product #${line.product_id ?? line.id ?? ""}`,
                100
            );

            const variantName = toSafeString(
                line.variant_name ??
                line.variantName ??
                line.variant ??
                line.option ??
                line.size ??
                "",
                100
            );

            const qty = toNumber(line.quantity ?? line.qty) ?? 1;

            return `${productName}${variantName ? ` - ${variantName}` : ""} x${qty}`;
        })
        .filter(Boolean)
        .join(", ");
}

function getOrderLines(body) {
    const items =
        body.items ||
        body.order_items ||
        body.orderItems ||
        body.cart ||
        body.cartItems;

    if (Array.isArray(items)) return items;

    if (
        body.product_id ||
        body.productId ||
        body.variant_id ||
        body.variantId ||
        body.product_variant_id ||
        body.productVariantId ||
        body.item
    ) {
        return [body];
    }

    return [];
}

function toPositiveInteger(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeAction(value) {
    return toSafeString(value, 80)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

async function ensureStoreExists(connection, storeId) {
    const parsed = Number(storeId);
    if (!Number.isInteger(parsed) || parsed <= 0) return false;
    const [rows] = await connection.execute("SELECT id FROM stores WHERE id = ? LIMIT 1", [parsed]);
    return rows.length > 0;
}

async function decreaseStockForOrder(connection, storeId, items) {
    const lines = Array.isArray(items) ? items : [];

    for (const line of lines) {
        const qty = toPositiveInteger(line.quantity ?? line.qty) || 1;

        const variantId = toPositiveInteger(
            line.variant_id ??
            line.variantId ??
            line.product_variant_id ??
            line.productVariantId ??
            line.variant?.id
        );

        const productId = toPositiveInteger(
            line.product_id ??
            line.productId ??
            line.product?.id
        );

        let productName = toSafeString(
            line.product_name ??
            line.productName ??
            line.product?.name ??
            line.name ??
            line.item ??
            "",
            150
        );

        let variantName = toSafeString(
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

        const combinedItem = toSafeString(line.item ?? line.name ?? "", 255);

        if (!variantName && combinedItem.includes("/")) {
            const parts = combinedItem.split("/");
            productName = toSafeString(parts[0], 150);
            variantName = toSafeString(parts.slice(1).join("/").replace(/\sx\d+$/i, ""), 150);
        }

        const variantTokens = variantName
            .toLowerCase()
            .replace(/\sx\d+$/i, "")
            .split(/[\/,|]+/)
            .map((token) => token.trim())
            .filter(Boolean);

        if (variantId) {
            const [result] = await connection.execute(
                `UPDATE product_variants pv
                 INNER JOIN products p ON p.id = pv.product_id
                 SET pv.stock = GREATEST(pv.stock - ?, 0),
                     p.stock = GREATEST(p.stock - ?, 0)
                 WHERE pv.id = ? AND p.store_id = ?`,
                [qty, qty, variantId, storeId]
            );

            if (result.affectedRows > 0) continue;
        }

        if (productId && variantTokens.length > 0) {
            const tokenWhere = variantTokens
                .map(() => "LOWER(CAST(pv.variant_values AS CHAR)) LIKE ?")
                .join(" AND ");

            const tokenValues = variantTokens.map((token) => `%${token}%`);

            const [result] = await connection.execute(
                `UPDATE product_variants pv
                 INNER JOIN products p ON p.id = pv.product_id
                 SET pv.stock = GREATEST(pv.stock - ?, 0),
                     p.stock = GREATEST(p.stock - ?, 0)
                 WHERE pv.product_id = ?
                   AND p.store_id = ?
                   AND ${tokenWhere}`,
                [qty, qty, productId, storeId, ...tokenValues]
            );

            if (result.affectedRows > 0) continue;
        }

        if (productName && variantTokens.length > 0) {
            const tokenWhere = variantTokens
                .map(() => "LOWER(CAST(pv.variant_values AS CHAR)) LIKE ?")
                .join(" AND ");

            const tokenValues = variantTokens.map((token) => `%${token}%`);

            const [result] = await connection.execute(
                `UPDATE product_variants pv
                 INNER JOIN products p ON p.id = pv.product_id
                 SET pv.stock = GREATEST(pv.stock - ?, 0),
                     p.stock = GREATEST(p.stock - ?, 0)
                 WHERE LOWER(p.name) = LOWER(?)
                   AND p.store_id = ?
                   AND ${tokenWhere}`,
                [qty, qty, productName, storeId, ...tokenValues]
            );

            if (result.affectedRows > 0) continue;
        }

        if (productId) {
            await connection.execute(
                `UPDATE products
                 SET stock = GREATEST(stock - ?, 0)
                 WHERE id = ? AND store_id = ?`,
                [qty, productId, storeId]
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

    const method = event?.requestContext?.http?.method || event.httpMethod;
    if (method === "OPTIONS") return { statusCode: 204, headers };

    let body = {};
    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return badRequest(headers, "Invalid JSON body");
    }

    const rawAction = toSafeString(body.action, 80);
    const normalizedAction = normalizeAction(rawAction);

    const actionAliases = {
        place_order: "create_order",
        create_pos_order: "create_order",
        create_sale: "create_order",
        checkout: "create_order",

        deduct_stock: "decrease_stock",
        decrease_stock: "decrease_stock",
        reduce_stock: "decrease_stock",
        update_stock: "decrease_stock",
        decrement_stock: "decrease_stock",
        update_variant_stock: "decrease_stock",
        decrease_variant_stock: "decrease_stock",
        update_inventory_stock: "decrease_stock",
        update_product_stock: "decrease_stock",
        decrease_product_stock: "decrease_stock",
        deduct_product_stock: "decrease_stock",
        adjust_stock: "decrease_stock",
        update_inventory: "decrease_stock",
    };

    let action = actionAliases[normalizedAction] || normalizedAction;

    if (
        action !== "decrease_stock" &&
        (normalizedAction.includes("stock") || normalizedAction.includes("inventory")) &&
        getOrderLines(body).length > 0
    ) {
        action = "decrease_stock";
    }

    console.log("POS rawAction:", rawAction);
    console.log("POS normalizedAction:", normalizedAction);
    console.log("POS mapped action:", action);
    console.log("POS body keys:", Object.keys(body));

    let connection;



    try {
        connection = await mysql.createConnection(dbConfig);

        // --- AUTH ---
        const authHeader = event?.headers?.authorization || event?.headers?.Authorization || "";
        if (!authHeader) return unauthorized(headers, "No token provided");

        let store_id;
        try {
            const token = authHeader.replace("Bearer ", "");
            const decoded = jwt.verify(token, JWT_SECRET);
            store_id = Number(decoded.store_id);
        } catch {
            return unauthorized(headers, "Invalid token");
        }

        if (!Number.isInteger(store_id) || store_id <= 0) {
            return unauthorized(headers, "Invalid store in token");
        }

        const storeExists = await ensureStoreExists(connection, store_id);
        if (!storeExists) return badRequest(headers, "Store account not found");

        // --- CREATE ---
        if (action === "create_order") {
            const orderId = toSafeString(body.order_id, 255);
            const customerName = toSafeString(body.customer_name, 120) || "Customer";
            const item = toSafeString(
                body.item || formatOrderItems(body.items || body.order_items || body.cart),
                255
            );
            const total = toNumber(body.total) ?? 0;

            // normalize order_date -> YYYY-MM-DD (fallback to today)
            const normalizedOrderDate =
                toISODate(body.order_date) || new Date().toISOString().slice(0, 10);

            if (!orderId) return badRequest(headers, "order_id is required");

            const [result] = await connection.execute(
                `INSERT INTO orders
         (order_id, store_id, customer_name, item, total, order_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [orderId, store_id, customerName, item, total, normalizedOrderDate]
            );

            if (result.affectedRows === 0) {
                return serverError(headers);
            }

            const orderLines = getOrderLines({
                ...body,
                item,
            });

            if (orderLines.length > 0) {
                await decreaseStockForOrder(connection, store_id, orderLines);
            }

            const [rows] = await connection.execute(
                `SELECT order_id AS orderId, store_id AS storeId, customer_name AS customerName,
                        item, total, order_date AS orderDate, created_at AS createdAt
                 FROM orders WHERE order_id = ? LIMIT 1`,
                [orderId]
            );

            return { statusCode: 201, headers, body: JSON.stringify({ success: true, order: rows[0] }) };
        }
        // --- DECREASE STOCK ---
        if (action === "decrease_stock") {
            const orderLines = getOrderLines(body);

            if (orderLines.length === 0) {
                return badRequest(headers, "No items found for stock update");
            }

            await decreaseStockForOrder(connection, store_id, orderLines);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true }),
            };
        }

        // --- READ ---
        if (action === "get_orders") {
            const [rows] = await connection.execute(
                `SELECT order_id AS orderId, store_id AS storeId, customer_name AS customerName,
                        item, total, order_date AS orderDate, created_at AS createdAt
                 FROM orders WHERE store_id = ?
                 ORDER BY created_at DESC, order_id DESC`,
                [store_id]
            );
            return { statusCode: 200, headers, body: JSON.stringify({ orders: rows }) };
        }

        // --- UPDATE ---
        if (action === "update_order") {
            const orderId = toSafeString(body.order_id, 255);
            if (!orderId) return badRequest(headers, "Invalid order_id");

            const customerName = toSafeString(body.customer_name, 120) || "Customer";
            const item = toSafeString(body.item, 255);
            const total = toNumber(body.total) ?? 0;

            // normalize order_date -> YYYY-MM-DD (fallback to today)
            const normalizedOrderDate =
                toISODate(body.order_date) || new Date().toISOString().slice(0, 10);

            const [result] = await connection.execute(
                `UPDATE orders
         SET customer_name=?, item=?, total=?, order_date=?
         WHERE order_id=? AND store_id=?`,
                [customerName, item, total, normalizedOrderDate, orderId, store_id]
            );

            if (result.affectedRows === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: "Order not found" }) };
            }

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // --- DELETE ---
        if (action === "delete_order") {
            const orderId = toSafeString(body.order_id, 255);
            if (!orderId) return badRequest(headers, "Invalid order_id");

            const [result] = await connection.execute(
                `DELETE FROM orders WHERE order_id=? AND store_id=?`,
                [orderId, store_id]
            );

            if (result.affectedRows === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: "Order not found" }) };
            }

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // --- IGNORE EXTRA POS FOLLOW-UP ACTIONS ---
        console.log("POS ignored unsupported action:", {
            rawAction,
            normalizedAction,
            mappedAction: action,
            bodyKeys: Object.keys(body),
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                ignored: true,
                action: rawAction || null,
            }),
        };

    } catch (err) {
        console.error("Lambda error:", err);
        return serverError(headers);
    } finally {
        if (connection) await connection.end();
    }
};