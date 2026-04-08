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

async function ensureStoreExists(connection, storeId) {
    const parsed = Number(storeId);
    if (!Number.isInteger(parsed) || parsed <= 0) return false;
    const [rows] = await connection.execute("SELECT id FROM stores WHERE id = ? LIMIT 1", [parsed]);
    return rows.length > 0;
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

    const action = body.action;
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
            const item = toSafeString(body.item, 255);
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

            const [rows] = await connection.execute(
                `SELECT order_id AS orderId, store_id AS storeId, customer_name AS customerName,
                        item, total, order_date AS orderDate, created_at AS createdAt
                 FROM orders WHERE order_id = ? LIMIT 1`,
                [orderId]
            );

            return { statusCode: 201, headers, body: JSON.stringify({ success: true, order: rows[0] }) };
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

        return badRequest(headers, "Invalid action");
    } catch (err) {
        console.error("Lambda error:", err);
        return serverError(headers);
    } finally {
        if (connection) await connection.end();
    }
};