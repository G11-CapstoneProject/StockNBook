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

function badRequest(headers, message) {
    return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: message }),
    };
}

function unauthorized(headers, message) {
    return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: message }),
    };
}

function serverError(headers, err) {
    const errorMessage =
        err?.sqlMessage ||
        err?.message ||
        "Internal server error";

    const errorCode =
        err?.code ||
        "UNKNOWN_ERROR";

    console.error("[lambda-categories] Detailed error:", {
        code: errorCode,
        message: errorMessage,
        errno: err?.errno,
        sqlState: err?.sqlState,
        sqlMessage: err?.sqlMessage,
        stack: err?.stack,
    });

    return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
            error: errorMessage,
            code: errorCode,
        }),
    };
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}

const DEFAULT_CATEGORIES = [
    "Balloons",
    "Backdrops",
    "Tables & Chairs",
    "Linens & Covers",
    "Decorations",
    "Party Favors",
    "Catering / Food",
    "Cake & Desserts",
    "Lights & Sounds",
    "Costumes & Props",
    "Candles & Accessories",
    "Miscellaneous",
];

async function ensureDefaultCategories(connection, storeId) {
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
        return;
    }

    for (const categoryName of DEFAULT_CATEGORIES) {
        const [existing] = await connection.execute(
            `SELECT id
             FROM categories
             WHERE store_id = ?
               AND LOWER(category_name) = LOWER(?)
                 LIMIT 1`,
            [parsedStoreId, categoryName]
        );

        if (existing.length === 0) {
            await connection.execute(
                `INSERT INTO categories (
                    store_id,
                    category_name,
                    status
                )
                 VALUES (?, ?, ?)`,
                [parsedStoreId, categoryName, "active"]
            );
        }
    }
}

async function ensureStoreExists(connection, storeId) {
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) {
        return false;
    }

    const [rows] = await connection.execute(
        `SELECT id
         FROM stores
         WHERE id = ?
         LIMIT 1`,
        [parsedStoreId]
    );

    return rows.length > 0;
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
        body = JSON.parse(event?.body || "{}");
    } catch {
        return badRequest(headers, "Invalid JSON body");
    }

    const action = body.action;
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        console.log("[lambda-categories] action:", action);

        // ── PUBLIC: get_public_categories ────────────────────────────────
        if (action === "get_public_categories") {
            const storeId = Number(body.storeId);

            if (!Number.isInteger(storeId) || storeId <= 0) {
                return badRequest(
                    headers,
                    "Missing or invalid storeId"
                );
            }

            await ensureDefaultCategories(connection, storeId);

            const [rows] = await connection.execute(
                `SELECT
                     id,
                     store_id AS storeId,
                     category_name AS categoryName,
                     status,
                     created_at AS createdAt,
                     updated_at AS updatedAt
                 FROM categories
                 WHERE store_id = ?
                 ORDER BY created_at DESC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    categories: rows,
                }),
            };
        }

        // ── PROTECTED: verify token ──────────────────────────────────────
        const authHeader =
            event?.headers?.authorization ||
            event?.headers?.Authorization ||
            "";

        if (!authHeader) {
            return unauthorized(headers, "No token provided");
        }

        let storeId;

        try {
            const token = authHeader.replace("Bearer ", "");
            const decoded = jwt.verify(token, JWT_SECRET);

            storeId = Number(decoded.store_id);
        } catch {
            return unauthorized(headers, "Invalid token");
        }

        if (!Number.isInteger(storeId) || storeId <= 0) {
            return unauthorized(
                headers,
                "Invalid store in token"
            );
        }

        const storeExists = await ensureStoreExists(
            connection,
            storeId
        );

        if (!storeExists) {
            return badRequest(
                headers,
                "Store account not found"
            );
        }

        // ── PROTECTED: create_category ───────────────────────────────────
        if (action === "create_category") {
            const safeName = toSafeString(
                body.categoryName,
                120
            );

            if (!safeName) {
                return badRequest(
                    headers,
                    "categoryName is required"
                );
            }

            const [existing] = await connection.execute(
                `SELECT id
                 FROM categories
                 WHERE store_id = ?
                   AND LOWER(category_name) = LOWER(?)
                 LIMIT 1`,
                [storeId, safeName]
            );

            if (existing.length > 0) {
                return badRequest(
                    headers,
                    "Category already exists for this store"
                );
            }

            const [result] = await connection.execute(
                `INSERT INTO categories (
                    store_id,
                    category_name,
                    status
                )
                 VALUES (?, ?, ?)`,
                [storeId, safeName, "active"]
            );

            const [rows] = await connection.execute(
                `SELECT
                     id,
                     store_id AS storeId,
                     category_name AS categoryName,
                     status,
                     created_at AS createdAt,
                     updated_at AS updatedAt
                 FROM categories
                 WHERE id = ?
                     LIMIT 1`,
                [result.insertId]
            );

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    success: true,
                    category:
                        rows[0] || {
                            id: result.insertId,
                        },
                }),
            };
        }

        // ── PROTECTED: get_categories ────────────────────────────────────
        if (action === "get_categories") {
            await ensureDefaultCategories(connection, storeId);

            const [rows] = await connection.execute(
                `SELECT
                     id,
                     store_id AS storeId,
                     category_name AS categoryName,
                     status,
                     created_at AS createdAt,
                     updated_at AS updatedAt
                 FROM categories
                 WHERE store_id = ?
                 ORDER BY created_at DESC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    categories: rows,
                }),
            };
        }

        // ── PROTECTED: update_category ───────────────────────────────────
        if (action === "update_category") {
            const categoryId = Number(body.category_id);
            const safeName = toSafeString(
                body.categoryName,
                120
            );

            if (
                !Number.isInteger(categoryId) ||
                categoryId <= 0
            ) {
                return badRequest(
                    headers,
                    "Missing or invalid category_id"
                );
            }

            if (!safeName) {
                return badRequest(
                    headers,
                    "categoryName is required"
                );
            }

            const [duplicate] = await connection.execute(
                `SELECT id
                 FROM categories
                 WHERE store_id = ?
                   AND LOWER(category_name) = LOWER(?)
                   AND id <> ?
                     LIMIT 1`,
                [storeId, safeName, categoryId]
            );

            if (duplicate.length > 0) {
                return badRequest(
                    headers,
                    "Category already exists for this store"
                );
            }

            const [result] = await connection.execute(
                `UPDATE categories
                 SET
                     category_name = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?
                   AND store_id = ?`,
                [safeName, categoryId, storeId]
            );

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Category not found",
                    }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                }),
            };
        }

        // ── PROTECTED: delete_category ───────────────────────────────────
        if (action === "delete_category") {
            const categoryId = Number(body.category_id);

            if (
                !Number.isInteger(categoryId) ||
                categoryId <= 0
            ) {
                return badRequest(
                    headers,
                    "Missing or invalid category_id"
                );
            }

            const [result] = await connection.execute(
                `DELETE FROM categories
                 WHERE id = ?
                   AND store_id = ?`,
                [categoryId, storeId]
            );

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Category not found",
                    }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                }),
            };
        }

        return badRequest(headers, "Invalid action");
    } catch (err) {
        return serverError(headers, err);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};