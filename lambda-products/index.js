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
        if (action === "create_product") {
            const name = toSafeString(body.name, 120);
            const category = toSafeString(body.category, 120);
            const stock = toNumber(body.stock) ?? 0;
            const alertLevel = toNumber(body.alertLevel) ?? 0;
            const originalPrice = toNumber(body.originalPrice) ?? 0;
            const salesPrice = toNumber(body.salesPrice) ?? 0;

            if (!name || !category) return badRequest(headers, "name and category are required");

            const [result] = await connection.execute(
                `INSERT INTO products
          (store_id, name, category, stock, alert_level, original_price, sales_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [store_id, name, category, stock, alertLevel, originalPrice, salesPrice]
            );

            const [rows] = await connection.execute(
                `SELECT id, store_id AS storeId, name, category, stock,
                alert_level AS alertLevel, original_price AS originalPrice,
                sales_price AS salesPrice, created_at AS createdAt
         FROM products WHERE id = ? LIMIT 1`,
                [result.insertId]
            );

            return { statusCode: 201, headers, body: JSON.stringify({ success: true, product: rows[0] }) };
        }

        // --- READ ---
        if (action === "get_products") {
            const [rows] = await connection.execute(
                `SELECT id, store_id AS storeId, name, category, stock,
                alert_level AS alertLevel, original_price AS originalPrice,
                sales_price AS salesPrice, created_at AS createdAt
         FROM products WHERE store_id = ? ORDER BY created_at DESC`,
                [store_id]
            );
            return { statusCode: 200, headers, body: JSON.stringify({ products: rows }) };
        }

        // --- UPDATE ---
        if (action === "update_product") {
            const id = Number(body.id);
            if (!Number.isInteger(id) || id <= 0) return badRequest(headers, "Invalid product id");

            const name = toSafeString(body.name, 120);
            const category = toSafeString(body.category, 120);
            const stock = toNumber(body.stock) ?? 0;
            const alertLevel = toNumber(body.alertLevel) ?? 0;
            const originalPrice = toNumber(body.originalPrice) ?? 0;
            const salesPrice = toNumber(body.salesPrice) ?? 0;

            if (!name || !category) return badRequest(headers, "name and category are required");

            const [result] = await connection.execute(
                `UPDATE products
         SET name=?, category=?, stock=?, alert_level=?, original_price=?, sales_price=?
         WHERE id=? AND store_id=?`,
                [name, category, stock, alertLevel, originalPrice, salesPrice, id, store_id]
            );

            if (result.affectedRows === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: "Product not found" }) };
            }

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // --- DELETE ---
        if (action === "delete_product") {
            const id = Number(body.id);
            if (!Number.isInteger(id) || id <= 0) return badRequest(headers, "Invalid product id");

            const [result] = await connection.execute(
                `DELETE FROM products WHERE id=? AND store_id=?`,
                [id, store_id]
            );

            if (result.affectedRows === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: "Product not found" }) };
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