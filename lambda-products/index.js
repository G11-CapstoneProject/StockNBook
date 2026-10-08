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

function normalizeOptionalDate(value) {
    if (value === undefined || value === null || value === "") return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const text = String(value).trim();

    if (!text) return null;

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!isoMatch) {
        throw new Error(`Invalid expiration date "${text}". Use YYYY-MM-DD.`);
    }

    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));

    if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
    ) {
        throw new Error(`Invalid expiration date "${text}".`);
    }

    return text;
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
                expirationDate: normalizeOptionalDate(
                    firstDefined(
                        variant.expirationDate,
                        variant.expiration_date,
                        variant.expiryDate,
                        variant.expiry_date
                    )
                ),
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
        expirationDate:
            row.expirationDate ??
            row.expiration_date ??
            null,
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
             pv.id,
             pv.product_id AS productId,
             pv.variant_values AS variantValues,
             COALESCE(bi.quantity_on_hand, pv.stock) AS stock,
             COALESCE(bi.reorder_level, pv.alert_level) AS alertLevel,
             COALESCE(bi.cost_price, pv.original_price) AS originalPrice,
             COALESCE(bi.sales_price, pv.sales_price) AS salesPrice,
             pv.expiration_date AS expirationDate,
             pv.created_at AS createdAt
         FROM product_variants pv
                  INNER JOIN products p
                             ON p.id = pv.product_id
                  LEFT JOIN branch_inventory bi
                            ON bi.store_id = p.store_id
                                AND bi.branch_id = p.branch_id
                                AND bi.product_id = p.id
                                AND bi.variant_id = pv.id
                                AND bi.status = 'active'
         WHERE pv.product_id IN (${placeholders})
           AND pv.deleted_at IS NULL
         ORDER BY pv.id ASC`,
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

function hideProductCostsForNonOwners(products, tokenRole) {
    if (tokenRole === "owner") return products;

    return products.map((product) => ({
        ...product,
        originalPrice: 0,
        variants: Array.isArray(product.variants)
            ? product.variants.map((variant) => ({
                ...variant,
                originalPrice: 0,
            }))
            : [],
    }));
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
            COALESCE(bi.quantity_on_hand, products.stock) AS stock,
            COALESCE(bi.reorder_level, products.alert_level) AS alertLevel,
            COALESCE(bi.cost_price, products.original_price) AS originalPrice,
            COALESCE(bi.sales_price, products.sales_price) AS salesPrice,
            products.expiration_date AS expirationDate,
            products.has_variants AS hasVariants,
            products.created_at AS createdAt
        FROM products
                 LEFT JOIN branches
                           ON products.branch_id = branches.id
                               AND products.store_id = branches.store_id
                 LEFT JOIN branch_inventory bi
                           ON bi.store_id = products.store_id
                               AND bi.branch_id = products.branch_id
                               AND bi.product_id = products.id
                               AND bi.variant_id IS NULL
                               AND bi.status = 'active'
        WHERE products.store_id = ?
          AND products.deleted_at IS NULL
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

    const placeholders = variants.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");

    const params = variants.flatMap((variant) => [
        productId,
        JSON.stringify(variant.variantValues || {}),
        Number(variant.stock || 0),
        Number(variant.alertLevel || 0),
        Number(variant.originalPrice || 0),
        Number(variant.salesPrice || 0),
        variant.expirationDate || null,
    ]);

    await connection.execute(
        `INSERT INTO product_variants
         (product_id, variant_values, stock, alert_level, original_price, sales_price, expiration_date)
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
           AND branch_id = ?
           AND deleted_at IS NULL`,
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


async function ensureRestockHistoryTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS restock_history (
                                                       id BIGINT NOT NULL AUTO_INCREMENT,
                                                       store_id BIGINT NOT NULL,
                                                       branch_id BIGINT NOT NULL,
                                                       product_id BIGINT NOT NULL,
                                                       product_name VARCHAR(255) NOT NULL,
            variant_name VARCHAR(255) NULL,
            stock_before INT NOT NULL DEFAULT 0,
            quantity_added INT NOT NULL DEFAULT 0,
            current_stock INT NOT NULL DEFAULT 0,
            received_by VARCHAR(255) NULL,
            notes VARCHAR(500) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_restock_store (store_id),
            INDEX idx_restock_branch (branch_id),
            INDEX idx_restock_product (product_id),
            INDEX idx_restock_created_at (created_at)
            )
    `);
}

async function getRestockReceivedBy(
    connection,
    decoded,
    tokenRole,
    storeId
) {
    try {
        if (tokenRole === "manager" && decoded?.manager_id) {
            const [rows] = await connection.execute(
                `SELECT manager_name
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                     LIMIT 1`,
                [Number(decoded.manager_id), storeId]
            );

            if (rows.length > 0) {
                return (
                    toSafeString(rows[0].manager_name, 255) ||
                    toSafeString(decoded.email, 255) ||
                    "Manager"
                );
            }
        }

        if (tokenRole === "staff" && decoded?.staff_id) {
            const [rows] = await connection.execute(
                `SELECT staff_name
                 FROM staff
                 WHERE id = ?
                   AND store_id = ?
                     LIMIT 1`,
                [Number(decoded.staff_id), storeId]
            );

            if (rows.length > 0) {
                return (
                    toSafeString(rows[0].staff_name, 255) ||
                    toSafeString(decoded.email, 255) ||
                    "Staff"
                );
            }
        }

        if (tokenRole === "owner") {
            const [rows] = await connection.execute(
                `SELECT owner_name
                 FROM stores
                 WHERE id = ?
                     LIMIT 1`,
                [storeId]
            );

            if (rows.length > 0) {
                return (
                    toSafeString(rows[0].owner_name, 255) ||
                    toSafeString(decoded?.email, 255) ||
                    "Owner"
                );
            }
        }
    } catch (error) {
        console.error("Unable to resolve restock receiver:", error);
    }

    return (
        toSafeString(decoded?.email, 255) ||
        toSafeString(tokenRole, 80) ||
        "User"
    );
}

async function recordRestockHistory(
    connection,
    {
        storeId,
        branchId,
        beforeProduct,
        afterProduct,
        receivedBy,
    }
) {
    if (!beforeProduct || !afterProduct || !branchId) {
        return;
    }

    const beforeVariants = Array.isArray(beforeProduct.variants)
        ? beforeProduct.variants
        : [];

    const afterVariants = Array.isArray(afterProduct.variants)
        ? afterProduct.variants
        : [];

    const beforeHasVariants =
        Boolean(beforeProduct.hasVariants) || beforeVariants.length > 0;

    const afterHasVariants =
        Boolean(afterProduct.hasVariants) || afterVariants.length > 0;

    if (beforeHasVariants !== afterHasVariants) {
        return;
    }

    await ensureRestockHistoryTable(connection);

    if (!afterHasVariants) {
        const stockBefore = Number(beforeProduct.stock || 0);
        const currentStock = Number(afterProduct.stock || 0);
        const quantityAdded = currentStock - stockBefore;

        if (quantityAdded <= 0) {
            return;
        }

        await connection.execute(
            `INSERT INTO restock_history
             (
                 store_id,
                 branch_id,
                 product_id,
                 product_name,
                 variant_name,
                 stock_before,
                 quantity_added,
                 current_stock,
                 received_by
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branchId,
                Number(afterProduct.id),
                toSafeString(afterProduct.name || beforeProduct.name, 255),
                null,
                stockBefore,
                quantityAdded,
                currentStock,
                receivedBy,
            ]
        );

        return;
    }

    const previousVariants = new Map();

    for (const variant of beforeVariants) {
        const signature = getVariantSignature(
            variant.variantValues || {}
        );

        if (!signature) {
            continue;
        }

        previousVariants.set(signature, Number(variant.stock || 0));
    }

    for (const variant of afterVariants) {
        const signature = getVariantSignature(
            variant.variantValues || {}
        );

        if (!signature || !previousVariants.has(signature)) {
            continue;
        }

        const stockBefore = Number(previousVariants.get(signature) || 0);
        const currentStock = Number(variant.stock || 0);
        const quantityAdded = currentStock - stockBefore;

        if (quantityAdded <= 0) {
            continue;
        }

        await connection.execute(
            `INSERT INTO restock_history
             (
                 store_id,
                 branch_id,
                 product_id,
                 product_name,
                 variant_name,
                 stock_before,
                 quantity_added,
                 current_stock,
                 received_by
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                storeId,
                branchId,
                Number(afterProduct.id),
                toSafeString(afterProduct.name || beforeProduct.name, 255),
                getVariantDisplayName(variant.variantValues),
                stockBefore,
                quantityAdded,
                currentStock,
                receivedBy,
            ]
        );
    }
}


/* -------------------------------------------------------------------------- */
/* Database V2 inventory synchronization                                      */
/* -------------------------------------------------------------------------- */

function inventoryVariantKey(variantId) {
    return variantId == null ? "regular" : `variant:${Number(variantId)}`;
}

async function consumeInventoryBatches(connection, branchInventoryId, quantity) {
    let remaining = Math.max(0, Number(quantity || 0));
    if (remaining <= 0) return;

    const [batches] = await connection.execute(
        `SELECT id, remaining_quantity
         FROM inventory_batches
         WHERE branch_inventory_id = ?
           AND remaining_quantity > 0
         ORDER BY (expiration_date IS NULL) ASC,
                  expiration_date ASC,
                  received_at ASC,
                  id ASC
         FOR UPDATE`,
        [branchInventoryId]
    );

    for (const batch of batches) {
        if (remaining <= 0) break;

        const available = Math.max(0, Number(batch.remaining_quantity || 0));
        const take = Math.min(available, remaining);
        if (take <= 0) continue;

        await connection.execute(
            `UPDATE inventory_batches
             SET remaining_quantity = remaining_quantity - ?,
                 status = CASE
                              WHEN remaining_quantity - ? <= 0 THEN 'depleted'
                              ELSE status
                          END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [take, take, batch.id]
        );

        remaining -= take;
    }

    if (remaining > 0) {
        throw new Error(
            `Database V2 batch balance is short by ${remaining} unit(s) for inventory #${branchInventoryId}. ` +
            `Run the V2 verification/backfill before changing stock.`
        );
    }
}

async function createInventoryBatch(connection, inventoryRow, quantity, expirationDate, movementType, referenceId) {
    const qty = Math.max(0, Number(quantity || 0));
    if (qty <= 0) return;

    const safeType = String(movementType || "ADJUSTMENT_IN")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 24);
    const ref = String(referenceId || inventoryRow.product_id || "item")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 40);
    const batchCode = `V2-${safeType}-${ref}-${inventoryRow.id}-${Date.now()}`.slice(0, 100);

    await connection.execute(
        `INSERT INTO inventory_batches
         (store_id, branch_id, branch_inventory_id, batch_code,
          received_quantity, remaining_quantity, unit_cost, received_at,
          expiration_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
        [
            inventoryRow.store_id,
            inventoryRow.branch_id,
            inventoryRow.id,
            batchCode,
            qty,
            qty,
            Number(inventoryRow.cost_price || 0),
            expirationDate || null,
            expirationDate && String(expirationDate).slice(0, 10) < new Date().toISOString().slice(0, 10)
                ? "expired"
                : "active",
        ]
    );
}

async function insertInventoryMovement(connection, inventoryRow, options) {
    const before = Number(options.quantityBefore || 0);
    const after = Number(options.quantityAfter || 0);
    const delta = after - before;

    if (delta === 0 && !options.force) return;

    const actor = options.actor || { id: null, role: "SYSTEM", name: "StockNBook" };

    await connection.execute(
        `INSERT INTO inventory_movements
         (store_id, branch_id, branch_inventory_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, actor_id, actor_role, actor_name, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            inventoryRow.store_id,
            inventoryRow.branch_id,
            inventoryRow.id,
            String(options.movementType || "ADJUSTMENT").slice(0, 40),
            delta,
            before,
            after,
            options.referenceType ? String(options.referenceType).slice(0, 40) : null,
            options.referenceId != null ? String(options.referenceId).slice(0, 255) : null,
            actor.id ?? null,
            actor.role ? String(actor.role).slice(0, 40) : null,
            actor.name ? String(actor.name).slice(0, 255) : null,
            options.notes ? String(options.notes).slice(0, 500) : null,
        ]
    );
}

async function getLegacyInventoryTargets(connection, storeId, branchId, productId) {
    const [productRows] = await connection.execute(
        `SELECT id, store_id, branch_id, stock, alert_level, original_price,
                sales_price, expiration_date, has_variants
         FROM products
         WHERE id = ? AND store_id = ? AND branch_id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [productId, storeId, branchId]
    );

    if (!productRows.length) return [];
    const product = productRows[0];

    const [variantRows] = await connection.execute(
        `SELECT id, stock, alert_level, original_price, sales_price, expiration_date
         FROM product_variants
         WHERE product_id = ? AND deleted_at IS NULL
         ORDER BY id ASC`,
        [productId]
    );

    if (Number(product.has_variants || 0) === 1 && variantRows.length > 0) {
        return variantRows.map((variant) => ({
            storeId: Number(product.store_id),
            branchId: Number(product.branch_id),
            productId: Number(product.id),
            variantId: Number(variant.id),
            quantity: Math.max(0, Number(variant.stock || 0)),
            reorderLevel: Math.max(0, Number(variant.alert_level || 0)),
            costPrice: Number(variant.original_price || 0),
            salesPrice: Number(variant.sales_price || 0),
            expirationDate: variant.expiration_date || null,
        }));
    }

    return [{
        storeId: Number(product.store_id),
        branchId: Number(product.branch_id),
        productId: Number(product.id),
        variantId: null,
        quantity: Math.max(0, Number(product.stock || 0)),
        reorderLevel: Math.max(0, Number(product.alert_level || 0)),
        costPrice: Number(product.original_price || 0),
        salesPrice: Number(product.sales_price || 0),
        expirationDate: product.expiration_date || null,
    }];
}

async function syncProductInventoryV2(connection, options) {
    const targets = await getLegacyInventoryTargets(
        connection,
        options.storeId,
        options.branchId,
        options.productId
    );

    const [existingRows] = await connection.execute(
        `SELECT id, store_id, branch_id, product_id, variant_id,
                quantity_on_hand, reorder_level, cost_price, sales_price, status
         FROM branch_inventory
         WHERE store_id = ? AND branch_id = ? AND product_id = ?
         FOR UPDATE`,
        [options.storeId, options.branchId, options.productId]
    );

    const existingByKey = new Map(
        existingRows.map((row) => [inventoryVariantKey(row.variant_id), row])
    );
    const targetKeys = new Set(targets.map((target) => inventoryVariantKey(target.variantId)));

    // Rows for removed/replaced variants remain for audit history, but are no longer active.
    for (const row of existingRows) {
        const key = inventoryVariantKey(row.variant_id);
        if (targetKeys.has(key) || String(row.status || "").toLowerCase() !== "active") continue;

        const before = Number(row.quantity_on_hand || 0);
        if (before > 0) {
            await consumeInventoryBatches(connection, row.id, before);
            await insertInventoryMovement(connection, row, {
                movementType: "PRODUCT_STRUCTURE_CHANGE",
                quantityBefore: before,
                quantityAfter: 0,
                referenceType: "PRODUCT",
                referenceId: options.productId,
                actor: options.actor,
                notes: "Archived an inventory row because the product/variant structure changed.",
            });
        }

        await connection.execute(
            `UPDATE branch_inventory
             SET quantity_on_hand = 0, status = 'inactive', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [row.id]
        );
    }

    for (const target of targets) {
        const key = inventoryVariantKey(target.variantId);
        let row = existingByKey.get(key);
        let before = row ? Number(row.quantity_on_hand || 0) : 0;

        if (!row) {
            const [insertResult] = await connection.execute(
                `INSERT INTO branch_inventory
                 (store_id, branch_id, product_id, variant_id, quantity_on_hand,
                  reorder_level, cost_price, sales_price, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                [
                    target.storeId,
                    target.branchId,
                    target.productId,
                    target.variantId,
                    target.quantity,
                    target.reorderLevel,
                    target.costPrice,
                    target.salesPrice,
                ]
            );

            row = {
                id: Number(insertResult.insertId),
                store_id: target.storeId,
                branch_id: target.branchId,
                product_id: target.productId,
                variant_id: target.variantId,
                quantity_on_hand: target.quantity,
                reorder_level: target.reorderLevel,
                cost_price: target.costPrice,
                sales_price: target.salesPrice,
                status: "active",
            };
            before = 0;
        } else {
            await connection.execute(
                `UPDATE branch_inventory
                 SET quantity_on_hand = ?, reorder_level = ?, cost_price = ?,
                     sales_price = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    target.quantity,
                    target.reorderLevel,
                    target.costPrice,
                    target.salesPrice,
                    row.id,
                ]
            );
            row = {
                ...row,
                quantity_on_hand: target.quantity,
                reorder_level: target.reorderLevel,
                cost_price: target.costPrice,
                sales_price: target.salesPrice,
                status: "active",
            };
        }

        const after = Number(target.quantity || 0);
        const delta = after - before;

        if (delta < 0) {
            await consumeInventoryBatches(connection, row.id, Math.abs(delta));
        } else if (delta > 0) {
            await createInventoryBatch(
                connection,
                row,
                delta,
                target.expirationDate,
                options.isCreate ? "INITIAL_STOCK" : "RESTOCK",
                options.productId
            );
        }

        if (delta !== 0) {
            await insertInventoryMovement(connection, row, {
                movementType: options.isCreate
                    ? "INITIAL_STOCK"
                    : delta > 0
                        ? "RESTOCK"
                        : "ADJUSTMENT_OUT",
                quantityBefore: before,
                quantityAfter: after,
                referenceType: "PRODUCT",
                referenceId: options.productId,
                actor: options.actor,
                notes: options.isCreate
                    ? "Initial inventory created with the product."
                    : "Inventory synchronized from the product update during the V2 migration period.",
            });
        }
    }
}

async function archiveProductInventoryV2(connection, options) {
    const [rows] = await connection.execute(
        `SELECT id, store_id, branch_id, product_id, variant_id,
                quantity_on_hand, reorder_level, cost_price, sales_price, status
         FROM branch_inventory
         WHERE store_id = ? AND branch_id = ? AND product_id = ? AND status = 'active'
         FOR UPDATE`,
        [options.storeId, options.branchId, options.productId]
    );

    for (const row of rows) {
        const before = Number(row.quantity_on_hand || 0);
        if (before > 0) {
            await consumeInventoryBatches(connection, row.id, before);
            await insertInventoryMovement(connection, row, {
                movementType: "PRODUCT_ARCHIVE",
                quantityBefore: before,
                quantityAfter: 0,
                referenceType: "PRODUCT",
                referenceId: options.productId,
                actor: options.actor,
                notes: "Inventory archived because the product was removed from future operations.",
            });
        }

        await connection.execute(
            `UPDATE branch_inventory
             SET quantity_on_hand = 0, status = 'inactive', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [row.id]
        );
    }
}

async function syncLegacyProductVariants(connection, productId, incomingVariants) {
    const [existingRows] = await connection.execute(
        `SELECT id, variant_values
         FROM product_variants
         WHERE product_id = ? AND deleted_at IS NULL
         FOR UPDATE`,
        [productId]
    );

    const bySignature = new Map();
    for (const row of existingRows) {
        bySignature.set(getVariantSignature(parseVariantValues(row.variant_values)), row);
    }

    const retainedIds = new Set();

    for (const variant of incomingVariants) {
        const signature = getVariantSignature(variant.variantValues);
        const existing = bySignature.get(signature);

        if (existing) {
            await connection.execute(
                `UPDATE product_variants
                 SET variant_values = ?, stock = ?, alert_level = ?, original_price = ?,
                     sales_price = ?, expiration_date = ?, deleted_at = NULL
                 WHERE id = ? AND product_id = ?`,
                [
                    JSON.stringify(variant.variantValues || {}),
                    Number(variant.stock || 0),
                    Number(variant.alertLevel || 0),
                    Number(variant.originalPrice || 0),
                    Number(variant.salesPrice || 0),
                    variant.expirationDate || null,
                    existing.id,
                    productId,
                ]
            );
            retainedIds.add(Number(existing.id));
        } else {
            const [result] = await connection.execute(
                `INSERT INTO product_variants
                 (product_id, variant_values, stock, alert_level, original_price, sales_price, expiration_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    productId,
                    JSON.stringify(variant.variantValues || {}),
                    Number(variant.stock || 0),
                    Number(variant.alertLevel || 0),
                    Number(variant.originalPrice || 0),
                    Number(variant.salesPrice || 0),
                    variant.expirationDate || null,
                ]
            );
            retainedIds.add(Number(result.insertId));
        }
    }

    const toArchive = existingRows
        .map((row) => Number(row.id))
        .filter((id) => !retainedIds.has(id));

    if (toArchive.length > 0) {
        const placeholders = toArchive.map(() => "?").join(",");
        await connection.execute(
            `UPDATE product_variants
             SET deleted_at = NOW()
             WHERE product_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
            [productId, ...toArchive]
        );
    }
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
 * transaction as the product action it's logging, so the log and the
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

function buildProductReference(id) {
    return `PRD-${String(id).padStart(6, "0")}`;
}

function getTotalStock(product) {
    if (!product) return 0;

    if (product.hasVariants && Array.isArray(product.variants)) {
        return product.variants.reduce(
            (sum, variant) => sum + Number(variant.stock || 0),
            0
        );
    }

    return Number(product.stock || 0);
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
        connection = await dbPool.getConnection();

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
            const visibleProducts = hideProductCostsForNonOwners(products, tokenRole);
            return jsonResponse(200, headers, { products: visibleProducts });
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

            const expirationDate = hasVariants
                ? null
                : normalizeOptionalDate(
                    firstDefined(
                        body.expirationDate,
                        body.expiration_date,
                        body.expiryDate,
                        body.expiry_date
                    )
                );

            await connection.beginTransaction();

            const [result] = await connection.execute(
                `INSERT INTO products
                 (store_id, branch_id, package_id, package_name, name, category, stock, alert_level, original_price, sales_price, expiration_date, has_variants)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    expirationDate,
                    hasVariants ? 1 : 0,
                ]
            );

            const productId = result.insertId;

            if (hasVariants) {
                await insertProductVariants(connection, productId, incomingVariants);
            }

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await syncProductInventoryV2(connection, {
                storeId,
                branchId: activeBranchId,
                productId,
                actor: actingEmployee,
                isCreate: true,
            });

            await logEmployeeAction(connection, {
                storeId,
                branchId: activeBranchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: buildProductReference(productId),
                action: "Added product",
                referenceId: String(productId),
                details: `Added ${name}${hasVariants ? ` with ${incomingVariants.length} variant(s)` : ""} to inventory`,
            });

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

            const expirationDate = hasVariants
                ? null
                : normalizeOptionalDate(
                    firstDefined(
                        body.expirationDate,
                        body.expiration_date,
                        body.expiryDate,
                        body.expiry_date
                    )
                );

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
                    expiration_date = ?,
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
                expirationDate,
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

            if (hasVariants) {
                await syncLegacyProductVariants(connection, id, incomingVariants);
            } else {
                await connection.execute(
                    `UPDATE product_variants
                     SET deleted_at = NOW()
                     WHERE product_id = ? AND deleted_at IS NULL`,
                    [id]
                );
            }

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await syncProductInventoryV2(connection, {
                storeId,
                branchId: activeBranchId,
                productId: id,
                actor: actingEmployee,
                isCreate: false,
            });

            // Fetch after V2 synchronization because getProductById now prefers
            // branch_inventory values during the cutover period.
            const product = await getProductById(
                connection,
                storeId,
                activeBranchId,
                id
            );

            const receivedBy = await getRestockReceivedBy(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await recordRestockHistory(
                connection,
                {
                    storeId,
                    branchId: activeBranchId,
                    beforeProduct: existing,
                    afterProduct: product,
                    receivedBy,
                }
            );

            const stockDelta = getTotalStock(product) - getTotalStock(existing);

            await logEmployeeAction(connection, {
                storeId,
                branchId: activeBranchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: buildProductReference(id),
                action: stockDelta > 0 ? "Restocked inventory" : "Updated product",
                referenceId: String(id),
                details:
                    stockDelta > 0
                        ? `Added ${stockDelta} unit${stockDelta === 1 ? "" : "s"} to ${name}`
                        : `Updated details for ${name}`,
            });

            await connection.commit();

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

            const actingEmployee = await getActingEmployee(
                connection,
                decoded,
                tokenRole,
                storeId
            );

            await archiveProductInventoryV2(connection, {
                storeId,
                branchId: activeBranchId,
                productId: id,
                actor: actingEmployee,
            });

            // Soft-delete variants too, since they can also be referenced
            // by order_items/booking_items and the V2 inventory audit trail.
            await connection.execute(
                "UPDATE product_variants SET deleted_at = NOW() WHERE product_id = ? AND deleted_at IS NULL",
                [id]
            );

            let query = `
                UPDATE products
                SET deleted_at = NOW()
                WHERE id = ?
                  AND store_id = ?
                  AND deleted_at IS NULL
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

            await logEmployeeAction(connection, {
                storeId,
                branchId: activeBranchId,
                employee: actingEmployee,
                module: "Inventory",
                referenceNumber: buildProductReference(id),
                action: "Deleted product",
                referenceId: String(id),
                details: `Removed ${existing.name} from inventory`,
            });

            await connection.commit();

            return jsonResponse(200, headers, { success: true });
        }

        return badRequest(headers, "Invalid action");
    } catch (err) {
        await safeRollback(connection);
        return serverError(headers, err);
    } finally {
        if (connection) {
            connection.release();
        }
    }
};