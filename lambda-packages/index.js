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

function serverError(headers, err) {
    const message = err instanceof Error ? err.message : "Internal server error";

    console.error("Lambda error:", err);

    return jsonResponse(500, headers, {
        error: message,
    });
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function parseBooleanFlag(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;

    if (typeof value === "string") {
        const clean = value.trim().toLowerCase();
        return clean === "1" || clean === "true" || clean === "yes";
    }

    return false;
}

function parseVariantValues(value) {
    if (!value) return {};

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === "object" && parsed !== null ? parsed : {};
        } catch {
            return {};
        }
    }

    if (typeof value === "object") return value;

    return {};
}

function cleanVariantValues(value) {
    const rawValues = parseVariantValues(value);
    const cleaned = {};

    Object.entries(rawValues).forEach(([key, val]) => {
        const cleanKey = String(key || "").trim().toLowerCase();
        const cleanValue = String(val || "").trim();

        if (cleanKey && cleanValue) {
            cleaned[cleanKey] = cleanValue;
        }
    });

    return cleaned;
}

function getIncomingVariants(body) {
    const rawVariants =
        body.variants ||
        body.product_variants ||
        body.productVariants ||
        body.variant_details ||
        [];

    if (!Array.isArray(rawVariants)) return [];

    return rawVariants
        .map((variant) => {
            const variantValues = cleanVariantValues(
                firstDefined(
                    variant.variantValues,
                    variant.variant_values,
                    variant.values
                )
            );

            return {
                variantValues,
                stock: toNumber(firstDefined(variant.stock, variant.quantity, variant.qty)) ?? 0,
                alertLevel:
                    toNumber(firstDefined(variant.alertLevel, variant.alert_level, variant.alert)) ?? 0,
                originalPrice:
                    toNumber(
                        firstDefined(
                            variant.originalPrice,
                            variant.original_price,
                            variant.costPrice,
                            variant.cost_price,
                            variant.original
                        )
                    ) ?? 0,
                salesPrice:
                    toNumber(
                        firstDefined(
                            variant.salesPrice,
                            variant.sales_price,
                            variant.price,
                            variant.sales
                        )
                    ) ?? 0,
            };
        })
        .filter((variant) => Object.keys(variant.variantValues).length > 0);
}

function getVariantTotalStock(variants) {
    return variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
}

function getVariantTotalAlert(variants) {
    return variants.reduce((sum, variant) => sum + Number(variant.alertLevel || 0), 0);
}

function getMinVariantPrice(variants, field) {
    const prices = variants
        .map((variant) => Number(variant[field] || 0))
        .filter((price) => Number.isFinite(price) && price > 0);

    return prices.length > 0 ? Math.min(...prices) : 0;
}

async function safeRollback(connection) {
    try {
        if (connection) await connection.rollback();
    } catch {
        // Ignore rollback error.
    }
}

async function ensureStoreExists(connection, storeId) {
    const parsed = Number(storeId);
    if (!Number.isInteger(parsed) || parsed <= 0) return false;

    const [rows] = await connection.execute(
        "SELECT id FROM stores WHERE id = ? LIMIT 1",
        [parsed]
    );

    return rows.length > 0;
}

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
    const parsedBranchId = Number(branchId);
    const parsedStoreId = Number(storeId);

    if (!Number.isInteger(parsedBranchId) || parsedBranchId <= 0) return false;
    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) return false;

    const [rows] = await connection.execute(
        "SELECT id FROM branches WHERE id = ? AND store_id = ? LIMIT 1",
        [parsedBranchId, parsedStoreId]
    );

    return rows.length > 0;
}

function normalizeVariantRow(row) {
    return {
        id: Number(row.id),
        productId: Number(row.productId ?? row.product_id),
        variantValues: parseVariantValues(row.variantValues ?? row.variant_values),
        stock: Number(row.stock ?? 0),
        alertLevel: Number(row.alertLevel ?? row.alert_level ?? 0),
        originalPrice: Number(row.originalPrice ?? row.original_price ?? 0),
        salesPrice: Number(row.salesPrice ?? row.sales_price ?? 0),
        createdAt: row.createdAt ?? row.created_at ?? "",
    };
}

async function attachVariants(connection, products) {
    if (!Array.isArray(products) || products.length === 0) return [];

    const productIds = products.map((product) => Number(product.id)).filter(Boolean);

    if (productIds.length === 0) {
        return products.map((product) => ({
            ...product,
            hasVariants: false,
            has_variants: 0,
            variants: [],
        }));
    }

    const placeholders = productIds.map(() => "?").join(",");

    const [variantRows] = await connection.execute(
        `SELECT
             id,
             product_id AS productId,
             variant_values AS variantValues,
             stock,
             alert_level AS alertLevel,
             original_price AS originalPrice,
             sales_price AS salesPrice,
             created_at AS createdAt
         FROM product_variants
         WHERE product_id IN (${placeholders})
         ORDER BY id ASC`,
        productIds
    );

    const variantsByProductId = {};

    variantRows.forEach((row) => {
        const variant = normalizeVariantRow(row);
        const key = String(variant.productId);

        if (!variantsByProductId[key]) {
            variantsByProductId[key] = [];
        }

        variantsByProductId[key].push(variant);
    });

    return products.map((product) => {
        const variants = variantsByProductId[String(product.id)] || [];
        const hasVariants =
            Number(product.hasVariants ?? product.has_variants ?? 0) === 1 ||
            variants.length > 0;

        return {
            ...product,
            hasVariants,
            has_variants: hasVariants ? 1 : 0,
            variants,
        };
    });
}

async function getProducts(connection, storeId, activeBranchId, productId = null) {
    let query = `
        SELECT
            products.id,
            products.store_id AS storeId,
            products.branch_id AS branchId,
            branches.branch_name AS branchName,
            products.name,
            products.category,
            products.stock,
            products.alert_level AS alertLevel,
            products.original_price AS originalPrice,
            products.sales_price AS salesPrice,
            products.has_variants AS hasVariants,
            products.created_at AS createdAt
        FROM products
                 LEFT JOIN branches
                           ON products.branch_id = branches.id
                               AND products.store_id = branches.store_id
        WHERE products.store_id = ?
    `;

    const params = [storeId];

    if (activeBranchId) {
        query += " AND products.branch_id = ?";
        params.push(activeBranchId);
    }

    if (productId) {
        query += " AND products.id = ?";
        params.push(productId);
    }

    query += " ORDER BY products.created_at DESC";

    const [rows] = await connection.execute(query, params);

    return attachVariants(connection, rows);
}

async function getProductById(connection, storeId, activeBranchId, productId) {
    const products = await getProducts(connection, storeId, activeBranchId, productId);
    return products[0] || null;
}

async function insertProductVariants(connection, productId, variants) {
    if (!Array.isArray(variants) || variants.length === 0) return;

    const placeholders = variants.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");

    const params = variants.flatMap((variant) => [
        productId,
        JSON.stringify(variant.variantValues || {}),
        Number(variant.stock || 0),
        Number(variant.alertLevel || 0),
        Number(variant.originalPrice || 0),
        Number(variant.salesPrice || 0),
    ]);

    await connection.execute(
        `INSERT INTO product_variants
         (product_id, variant_values, stock, alert_level, original_price, sales_price)
         VALUES ${placeholders}`,
        params
    );
}

/* DUPLICATE VALIDATION HELPERS */

function normalizeDuplicateText(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function getVariantSignature(values) {
    const entries = Object.entries(values || {})
        .map(([key, value]) => [
            normalizeDuplicateText(key),
            normalizeDuplicateText(value),
        ])
        .filter(([, value]) => value.length > 0)
        .sort(([keyA, valueA], [keyB, valueB]) => {
            const keyCompare = keyA.localeCompare(keyB);
            return keyCompare !== 0 ? keyCompare : valueA.localeCompare(valueB);
        });

    if (entries.length === 0) return "";

    return entries.map(([key, value]) => `${key}:${value}`).join("|");
}

function getVariantDisplayName(values) {
    return (
        Object.values(values || {})
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(", ") || "Unnamed variant"
    );
}

function getDuplicateVariantLabel(variants) {
    const seen = new Map();

    for (const variant of variants || []) {
        const signature = getVariantSignature(variant.variantValues);

        if (!signature) continue;

        const displayName = getVariantDisplayName(variant.variantValues);

        if (seen.has(signature)) {
            return displayName;
        }

        seen.set(signature, displayName);
    }

    return "";
}

async function findExistingProductByName(
    connection,
    storeId,
    branchId,
    productName,
    excludeProductId = null
) {
    const [rows] = await connection.execute(
        `SELECT id, name
         FROM products
         WHERE store_id = ?
           AND branch_id = ?`,
        [storeId, branchId]
    );

    const cleanName = normalizeDuplicateText(productName);

    return (
        rows.find((row) => {
            const sameName = normalizeDuplicateText(row.name) === cleanName;
            const notCurrentProduct =
                !excludeProductId || Number(row.id) !== Number(excludeProductId);

            return sameName && notCurrentProduct;
        }) || null
    );
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
        return { statusCode: 204, headers, body: "" };
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

        // ── PUBLIC: get_public_products for customer booking portal ─────────────
        if (action === "get_public_products") {
            const publicStoreId = Number(body.store_id || body.storeId);
            const publicBranchId =
                body.branch_id || body.branchId
                    ? Number(body.branch_id || body.branchId)
                    : null;

            if (!Number.isInteger(publicStoreId) || publicStoreId <= 0) {
                return badRequest(headers, "Missing or invalid store_id");
            }

            const storeExists = await ensureStoreExists(connection, publicStoreId);

            if (!storeExists) {
                return badRequest(headers, "Store account not found");
            }

            if (publicBranchId) {
                const branchOk = await ensureBranchBelongsToStore(
                    connection,
                    publicBranchId,
                    publicStoreId
                );

                if (!branchOk) {
                    return badRequest(headers, "Invalid branch for this store");
                }
            }

            const products = await getProducts(
                connection,
                publicStoreId,
                publicBranchId
            );

            return jsonResponse(200, headers, { products });
        }

        const authHeader =
            event?.headers?.authorization ||
            event?.headers?.Authorization ||
            "";

        if (!authHeader) {
            return unauthorized(headers, "No token provided");
        }

        let decoded;
        let storeId;
        let tokenBranchId;
        let tokenRole;

        try {
            const token = authHeader.replace("Bearer ", "");
            decoded = jwt.verify(token, JWT_SECRET);

            storeId = Number(decoded.store_id);
            tokenBranchId = decoded.branch_id ? Number(decoded.branch_id) : null;
            tokenRole = String(decoded.role || "").toLowerCase();
        } catch {
            return unauthorized(headers, "Invalid token");
        }

        if (!Number.isInteger(storeId) || storeId <= 0) {
            return unauthorized(headers, "Invalid store in token");
        }

        const storeExists = await ensureStoreExists(connection, storeId);

        if (!storeExists) {
            return badRequest(headers, "Store account not found");
        }

        const isBranchUser = tokenRole === "manager" || tokenRole === "staff";

        const rawRequestedBranchId = firstDefined(body.branch_id, body.branchId);

        const requestedBranchId =
            rawRequestedBranchId !== undefined &&
            rawRequestedBranchId !== null &&
            rawRequestedBranchId !== ""
                ? Number(rawRequestedBranchId)
                : null;

        const activeBranchId = isBranchUser
            ? tokenBranchId
            : requestedBranchId || null;

        if (isBranchUser && !activeBranchId) {
            return badRequest(headers, "Missing branch_id for branch user");
        }

        if (activeBranchId) {
            const branchOk = await ensureBranchBelongsToStore(
                connection,
                activeBranchId,
                storeId
            );

            if (!branchOk) {
                return badRequest(headers, "Invalid branch for this store");
            }
        }

        if (action === "get_products") {
            const products = await getProducts(connection, storeId, activeBranchId);
            return jsonResponse(200, headers, { products });
        }

        if (action === "create_product") {
            const name = toSafeString(body.name, 120);
            const category = toSafeString(body.category, 120);
            const packageId = toNumber(firstDefined(body.packageId, body.package_id));
            const packageName = toSafeString(firstDefined(body.packageName, body.package_name), 255);

            const incomingVariants = getIncomingVariants(body);
            const hasVariants =
                parseBooleanFlag(firstDefined(body.hasVariants, body.has_variants)) ||
                incomingVariants.length > 0;

            if (!name || !category) {
                return badRequest(headers, "name and category are required");
            }

            if (!activeBranchId) {
                return badRequest(headers, "branch_id is required");
            }

            if (hasVariants && incomingVariants.length === 0) {
                return badRequest(headers, "Please add at least one valid variant");
            }

            const existingProduct = await findExistingProductByName(
                connection,
                storeId,
                activeBranchId,
                name
            );

            if (existingProduct) {
                return badRequest(
                    headers,
                    `Product "${name}" already exists in this branch.`
                );
            }

            const duplicateVariantLabel = hasVariants
                ? getDuplicateVariantLabel(incomingVariants)
                : "";

            if (duplicateVariantLabel) {
                return badRequest(
                    headers,
                    `Variant "${duplicateVariantLabel}" already exists in this product.`
                );
            }

            const stock = hasVariants
                ? getVariantTotalStock(incomingVariants)
                : toNumber(firstDefined(body.stock, body.quantity, body.qty)) ?? 0;

            const alertLevel = hasVariants
                ? getVariantTotalAlert(incomingVariants)
                : toNumber(firstDefined(body.alertLevel, body.alert_level, body.alert)) ?? 0;

            const originalPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "originalPrice")
                : toNumber(firstDefined(body.originalPrice, body.original_price, body.cost_price)) ?? 0;

            const salesPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "salesPrice")
                : toNumber(firstDefined(body.salesPrice, body.sales_price, body.price)) ?? 0;

            await connection.beginTransaction();

            const [result] = await connection.execute(
                `INSERT INTO products
                 (store_id, branch_id, package_id, package_name, name, category, stock, alert_level, original_price, sales_price, has_variants)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    activeBranchId,
                    packageId,
                    packageName || null,
                    name,
                    category,
                    stock,
                    alertLevel,
                    originalPrice,
                    salesPrice,
                    hasVariants ? 1 : 0,
                ]
            );

            const productId = result.insertId;

            if (hasVariants) {
                await insertProductVariants(connection, productId, incomingVariants);
            }

            await connection.commit();

            const product = await getProductById(
                connection,
                storeId,
                activeBranchId,
                productId
            );

            return jsonResponse(201, headers, {
                success: true,
                product,
            });
        }

        if (action === "update_product") {
            const id = Number(body.id);

            if (!Number.isInteger(id) || id <= 0) {
                return badRequest(headers, "Invalid product id");
            }

            const existing = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            if (!existing) {
                return notFound(headers, "Product not found");
            }

            const name = toSafeString(body.name, 120);
            const category = toSafeString(body.category, 120);
            const packageId = toNumber(firstDefined(body.packageId, body.package_id));
            const packageName = toSafeString(firstDefined(body.packageName, body.package_name), 255);

            const incomingVariants = getIncomingVariants(body);
            const hasVariants =
                parseBooleanFlag(firstDefined(body.hasVariants, body.has_variants)) ||
                incomingVariants.length > 0;

            if (!name || !category) {
                return badRequest(headers, "name and category are required");
            }

            if (hasVariants && incomingVariants.length === 0) {
                return badRequest(headers, "Please add at least one valid variant");
            }

            const duplicateProduct = await findExistingProductByName(
                connection,
                storeId,
                activeBranchId,
                name,
                id
            );

            if (duplicateProduct) {
                return badRequest(
                    headers,
                    `Product "${name}" already exists in this branch.`
                );
            }

            const duplicateVariantLabel = hasVariants
                ? getDuplicateVariantLabel(incomingVariants)
                : "";

            if (duplicateVariantLabel) {
                return badRequest(
                    headers,
                    `Variant "${duplicateVariantLabel}" already exists in this product.`
                );
            }

            const stock = hasVariants
                ? getVariantTotalStock(incomingVariants)
                : toNumber(firstDefined(body.stock, body.quantity, body.qty)) ?? 0;

            const alertLevel = hasVariants
                ? getVariantTotalAlert(incomingVariants)
                : toNumber(firstDefined(body.alertLevel, body.alert_level, body.alert)) ?? 0;

            const originalPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "originalPrice")
                : toNumber(firstDefined(body.originalPrice, body.original_price, body.cost_price)) ?? 0;

            const salesPrice = hasVariants
                ? getMinVariantPrice(incomingVariants, "salesPrice")
                : toNumber(firstDefined(body.salesPrice, body.sales_price, body.price)) ?? 0;

            await connection.beginTransaction();

            let query = `
                UPDATE products
                SET
                    package_id = ?,
                    package_name = ?,
                    name = ?,
                    category = ?,
                    stock = ?,
                    alert_level = ?,
                    original_price = ?,
                    sales_price = ?,
                    has_variants = ?
                WHERE id = ?
                  AND store_id = ?
            `;

            const params = [
                packageId,
                packageName || null,
                name,
                category,
                stock,
                alertLevel,
                originalPrice,
                salesPrice,
                hasVariants ? 1 : 0,
                id,
                storeId,
            ];

            if (activeBranchId) {
                query += " AND branch_id = ?";
                params.push(activeBranchId);
            }

            const [result] = await connection.execute(query, params);

            if (result.affectedRows === 0) {
                await safeRollback(connection);
                return notFound(headers, "Product not found");
            }

            await connection.execute(
                "DELETE FROM product_variants WHERE product_id = ?",
                [id]
            );

            if (hasVariants) {
                await insertProductVariants(connection, id, incomingVariants);
            }

            await connection.commit();

            const product = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            return jsonResponse(200, headers, {
                success: true,
                product,
            });
        }

        if (action === "delete_product") {
            const id = Number(body.id);

            if (!Number.isInteger(id) || id <= 0) {
                return badRequest(headers, "Invalid product id");
            }

            const existing = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            if (!existing) {
                return notFound(headers, "Product not found");
            }

            await connection.beginTransaction();

            await connection.execute(
                "DELETE FROM product_variants WHERE product_id = ?",
                [id]
            );

            let query = `
                DELETE FROM products
                WHERE id = ?
                  AND store_id = ?
            `;

            const params = [id, storeId];

            if (activeBranchId) {
                query += " AND branch_id = ?";
                params.push(activeBranchId);
            }

            const [result] = await connection.execute(query, params);

            if (result.affectedRows === 0) {
                await safeRollback(connection);
                return notFound(headers, "Product not found");
            }

            await connection.commit();

            return jsonResponse(200, headers, { success: true });
        }

        return badRequest(headers, "Invalid action");
    } catch (err) {
        await safeRollback(connection);
        return serverError(headers, err);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};