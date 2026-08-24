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

function buildCategoryReference(id) {
    return `CAT-${String(id).padStart(6, "0")}`;
}

/*
 * The JWT issued at login only carries ids (store_id / manager_id /
 * staff_id) and an email — never a display name. To log a real,
 * human-readable employee_actions row we look the acting user's name up
 * from their own table using the id that's already in the token.
 */
async function getActingEmployee(connection, decoded, tokenRole, storeId) {
    const role = String(tokenRole || "").toLowerCase();

    if (role === "manager" && decoded?.manager_id) {
        const [rows] = await connection.execute(
            `SELECT manager_name FROM managers WHERE id = ? AND store_id = ? LIMIT 1`,
            [Number(decoded.manager_id), storeId]
        );

        return {
            id: Number(decoded.manager_id),
            name: toSafeString(rows[0]?.manager_name, 255) || "Manager",
            role: "Manager",
        };
    }

    if (role === "staff" && decoded?.staff_id) {
        const [rows] = await connection.execute(
            `SELECT staff_name FROM staff WHERE id = ? AND store_id = ? LIMIT 1`,
            [Number(decoded.staff_id), storeId]
        );

        return {
            id: Number(decoded.staff_id),
            name: toSafeString(rows[0]?.staff_name, 255) || "Staff",
            role: "Staff",
        };
    }

    if (role === "owner") {
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
 * Writes one row to employee_actions. Called from inside the same DB
 * transaction as the category action it's logging, so the log and the
 * action succeed or fail together.
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

        let decoded;
        let storeId;
        let tokenRole;
        let branchId;

        try {
            const token = authHeader.replace("Bearer ", "");
            decoded = jwt.verify(token, JWT_SECRET);

            storeId = Number(decoded.store_id);
            tokenRole = String(decoded.role || "").toLowerCase();
            branchId = decoded.branch_id ? Number(decoded.branch_id) : null;
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

            await connection.beginTransaction();

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

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await logEmployeeAction(connection, {
                storeId,
                branchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: buildCategoryReference(result.insertId),
                action: "Added category",
                referenceId: String(result.insertId),
                details: `Added ${safeName} to categories`,
            });

            await connection.commit();

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

            const [beforeRows] = await connection.execute(
                `SELECT category_name FROM categories WHERE id = ? AND store_id = ? LIMIT 1`,
                [categoryId, storeId]
            );

            const previousName = beforeRows[0]?.category_name || null;

            await connection.beginTransaction();

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
                await connection.rollback();
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Category not found",
                    }),
                };
            }

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await logEmployeeAction(connection, {
                storeId,
                branchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: buildCategoryReference(categoryId),
                action: "Updated category",
                referenceId: String(categoryId),
                details: previousName && previousName !== safeName
                    ? `Renamed ${previousName} to ${safeName}`
                    : `Updated ${safeName}`,
            });

            await connection.commit();

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

            const [existingRows] = await connection.execute(
                `SELECT category_name FROM categories WHERE id = ? AND store_id = ? LIMIT 1`,
                [categoryId, storeId]
            );

            if (existingRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Category not found",
                    }),
                };
            }

            const categoryName = existingRows[0].category_name;

            await connection.beginTransaction();

            const [result] = await connection.execute(
                `DELETE FROM categories
                 WHERE id = ?
                   AND store_id = ?`,
                [categoryId, storeId]
            );

            if (result.affectedRows === 0) {
                await connection.rollback();
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Category not found",
                    }),
                };
            }

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await logEmployeeAction(connection, {
                storeId,
                branchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: buildCategoryReference(categoryId),
                action: "Deleted category",
                referenceId: String(categoryId),
                details: `Removed ${categoryName} from categories`,
            });

            await connection.commit();

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
        if (connection) {
            try {
                await connection.rollback();
            } catch {
                // ignore rollback errors, original error is what matters
            }
        }
        return serverError(headers, err);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};