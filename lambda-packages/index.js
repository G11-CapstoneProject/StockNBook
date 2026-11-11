/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "stocknbook-secret-key";

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook_v2",
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

// ===== BEGIN StockNBook v2 catalog (identical in lambda-products, lambda-pos, lambda-bookings, lambda-packages) =====
/*
 * stocknbook_v2 keeps ONE catalog row per product (products) and the prices on
 * product_variants. Every product has one hidden default variant
 * (is_default = 1) that carries the product-level price and, for a product
 * without variants, its stock. Real variants have is_default = 0.
 * Physical stock exists only in branch_inventory, and a product belongs to the
 * branch that holds the branch_inventory row of its default variant.
 *
 * Rental equipment has no variants: its branch_inventory row points at the
 * equipment row directly (branch_inventory.equipment_id).
 *
 * The read models below expose the column names this Lambda already returns,
 * so API responses and the UI stay exactly the same.
 */
const V2_PRODUCT_STOCK_SQL = (p, bi) => `CASE WHEN ${p}.has_variants = 1 THEN COALESCE((
        SELECT SUM(vbi.on_hand_quantity)
        FROM product_variants vv
                 JOIN branch_inventory vbi ON vbi.variant_id = vv.id AND vbi.branch_id = ${bi}.branch_id
        WHERE vv.product_id = ${p}.id AND vv.is_default = 0 AND vv.deleted_at IS NULL), 0)
    ELSE ${bi}.on_hand_quantity END`;
const V2_PRODUCT_ALERT_SQL = (p, bi) => `CASE WHEN ${p}.has_variants = 1 THEN COALESCE((
        SELECT SUM(vbi.reorder_level)
        FROM product_variants vv
                 JOIN branch_inventory vbi ON vbi.variant_id = vv.id AND vbi.branch_id = ${bi}.branch_id
        WHERE vv.product_id = ${p}.id AND vv.is_default = 0 AND vv.deleted_at IS NULL), 0)
    ELSE ${bi}.reorder_level END`;

// Product rows exactly as the inventory screens use them (one row per product).
const V2_PRODUCTS = `(SELECT
        p.id, p.store_id, base_bi.branch_id, p.product_number,
        p.product_name AS name, COALESCE(cat.category_name, '') AS category, p.category_id,
        p.description,
        ${V2_PRODUCT_STOCK_SQL("p", "base_bi")} AS stock,
        ${V2_PRODUCT_ALERT_SQL("p", "base_bi")} AS alert_level,
        dv.cost_price AS original_price, dv.selling_price AS sales_price,
        dv.pricing_method, dv.markup_percentage,
        base_bi.expiration_date, p.has_variants, p.next_variant_sequence, p.status,
        p.created_at, p.updated_at, p.deleted_at,
        dv.id AS default_variant_id, base_bi.id AS base_inventory_id
    FROM products p
             JOIN product_variants dv ON dv.product_id = p.id AND dv.is_default = 1
             JOIN branch_inventory base_bi ON base_bi.variant_id = dv.id
             LEFT JOIN categories cat ON cat.id = p.category_id)`;

// Real (selectable) variants with their branch stock.
const V2_PRODUCT_VARIANTS = `(SELECT
        v.id, v.store_id, v.product_id, v.variant_number, v.variant_name,
        v.attributes AS variant_values,
        COALESCE(vbi.on_hand_quantity, 0) AS stock, COALESCE(vbi.reorder_level, 0) AS alert_level,
        v.cost_price AS original_price, v.selling_price AS sales_price,
        v.pricing_method, v.markup_percentage, vbi.expiration_date,
        vbi.branch_id, vbi.id AS inventory_id, v.status, v.created_at, v.updated_at, v.deleted_at
    FROM product_variants v
             LEFT JOIN branch_inventory vbi ON vbi.variant_id = v.id
    WHERE v.is_default = 0)`;

// Consumable branch stock keyed by (product_id, variant_id); variant_id is NULL
// for a product without variants.
const V2_BRANCH_INVENTORY = `(SELECT
        bi.id, bi.store_id, bi.branch_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE v.id END AS variant_id,
        bi.variant_id AS catalog_variant_id,
        bi.on_hand_quantity AS quantity_on_hand, bi.reserved_quantity, bi.unavailable_quantity,
        bi.reorder_level, v.cost_price, v.selling_price AS sales_price, bi.expiration_date,
        bi.status, bi.created_at, bi.updated_at
    FROM branch_inventory bi
             JOIN product_variants v ON v.id = bi.variant_id)`;

// Batch tracking is not part of stocknbook_v2: each branch_inventory row is
// its own (single) batch with one expiration date.
const V2_INVENTORY_BATCHES = `(SELECT
        bi.id, bi.store_id, bi.branch_id, bi.id AS branch_inventory_id,
        CONCAT('INV-', bi.id) AS batch_code, bi.on_hand_quantity AS received_quantity,
        bi.on_hand_quantity AS remaining_quantity, v.cost_price AS unit_cost,
        bi.updated_at AS received_at, bi.expiration_date,
        CASE WHEN bi.on_hand_quantity > 0 THEN 'active' ELSE 'depleted' END AS status
    FROM branch_inventory bi
             JOIN product_variants v ON v.id = bi.variant_id)`;

// Movement history with the legacy reference/actor fields.
const V2_INVENTORY_MOVEMENTS = `(SELECT
        m.id, m.store_id, m.branch_id, m.branch_inventory_id, m.movement_type,
        m.quantity_change AS quantity_delta, m.quantity_before, m.quantity_after, m.unit_cost,
        m.reference_type,
        CASE WHEN m.reason LIKE 'Ref %: %'
                 THEN SUBSTRING_INDEX(SUBSTRING(m.reason, 5), ': ', 1)
             ELSE CAST(m.reference_id AS CHAR) END AS reference_id,
        m.performed_by AS actor_id, mu.role AS actor_role, COALESCE(mu.full_name, 'System') AS actor_name,
        CASE WHEN m.reason LIKE 'Ref %: %'
                 THEN SUBSTRING(m.reason, LOCATE(': ', m.reason) + 2)
             ELSE m.reason END AS notes,
        m.created_at
    FROM inventory_movements m
             LEFT JOIN users mu ON mu.id = m.performed_by)`;

// POS lines keyed by (product_id, variant_id).
const V2_ORDER_ITEMS = `(SELECT
        oi.id, oi.store_id, oi.order_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE oi.variant_id END AS variant_id,
        oi.variant_id AS catalog_variant_id,
        oi.product_name_snapshot AS product_name, oi.quantity, oi.unit_price,
        oi.cost_price_at_sale, oi.discount_amount, oi.line_total
    FROM order_items oi
             JOIN product_variants v ON v.id = oi.variant_id)`;

// Consumable booking lines keyed by (product_id, variant_id).
const V2_PRODUCT_BOOKING_ITEMS = `(SELECT
        bki.id, bki.store_id, bki.booking_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE bki.variant_id END AS variant_id,
        bki.variant_id AS catalog_variant_id, bki.item_type, bki.quantity,
        bki.unit_price_snapshot, bki.line_total, bki.item_status, bki.created_at
    FROM booking_items bki
             JOIN product_variants v ON v.id = bki.variant_id
    WHERE bki.item_type = 'consumable')`;

// Consumable package lines keyed by (product_id, variant_id).
const V2_PRODUCT_PACKAGE_ITEMS = `(SELECT
        pki.id, pki.store_id, pki.package_id, v.product_id,
        CASE WHEN v.is_default = 1 THEN NULL ELSE pki.variant_id END AS variant_id,
        pki.variant_id AS catalog_variant_id, pki.quantity, pki.unit_price_snapshot, pki.sort_order
    FROM package_items pki
             JOIN product_variants v ON v.id = pki.variant_id
    WHERE pki.item_type = 'consumable')`;

async function v2DefaultVariantId(connection, productId) {
    const [rows] = await connection.execute(
        "SELECT id FROM product_variants WHERE product_id = ? AND is_default = 1 LIMIT 1",
        [productId]
    );
    return rows.length ? Number(rows[0].id) : null;
}

// (product_id, variant_id|null) -> product_variants.id used by stocknbook_v2.
async function v2CatalogVariantId(connection, productId, variantId) {
    if (variantId !== null && variantId !== undefined && variantId !== "") return Number(variantId);
    return v2DefaultVariantId(connection, productId);
}

// Locks the branch stock row of a product/variant (FOR UPDATE).
async function v2LockInventory(connection, { storeId, branchId, productId, variantId = null }) {
    const catalogVariantId = await v2CatalogVariantId(connection, productId, variantId);
    if (!catalogVariantId) return null;
    const [rows] = await connection.execute(
        `SELECT bi.id, bi.variant_id, bi.on_hand_quantity, bi.reserved_quantity,
                bi.unavailable_quantity, bi.reorder_level, bi.expiration_date
         FROM branch_inventory bi
                  JOIN product_variants v ON v.id = bi.variant_id
         WHERE bi.store_id = ? AND bi.branch_id = ? AND bi.variant_id = ?
           AND v.product_id = ? AND bi.status = 'active'
             LIMIT 1
         FOR UPDATE`,
        [storeId, branchId, catalogVariantId, productId]
    );
    if (!rows.length) return null;
    return {
        ...rows[0],
        id: Number(rows[0].id),
        quantity_on_hand: Number(rows[0].on_hand_quantity),
        catalog_variant_id: catalogVariantId,
    };
}

// Creates the branch stock row for a catalog variant when it does not exist yet.
async function v2EnsureInventoryRow(connection, { storeId, branchId, catalogVariantId, reorderLevel = 0, expirationDate = null }) {
    const [found] = await connection.execute(
        "SELECT id FROM branch_inventory WHERE branch_id = ? AND variant_id = ? LIMIT 1",
        [branchId, catalogVariantId]
    );
    if (found.length) return Number(found[0].id);
    const [insert] = await connection.execute(
        `INSERT INTO branch_inventory
         (store_id, branch_id, variant_id, on_hand_quantity, reorder_level, expiration_date, status)
         VALUES (?, ?, ?, 0, ?, ?, 'active')`,
        [storeId, branchId, catalogVariantId, Math.max(0, Number(reorderLevel) || 0), expirationDate || null]
    );
    return Number(insert.insertId);
}

// inventory_movements.performed_by must be a user of the same store.
async function v2ActorUserId(connection, storeId, actorId) {
    const id = Number(actorId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const [rows] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND store_id = ? LIMIT 1",
        [id, storeId]
    );
    return rows.length ? id : null;
}

// A text reference (receipt key, request key ...) is kept at the start of the
// movement reason so it can be read back as reference_id.
function v2MovementReason(reference, notes) {
    const ref = String(reference ?? "").replace(/: /g, " ").trim();
    const text = String(notes ?? "").trim();
    if (!ref) return text || null;
    return `Ref ${ref}: ${text}`;
}

async function v2RecordMovement(connection, {
    storeId, branchId, inventoryId, movementType, delta, before, after,
    referenceType = null, referenceId = null, reference = null, unitCost = null,
    actorId = null, notes = null, bucket = "on_hand",
}) {
    const numericReference = Number(referenceId);
    const [result] = await connection.execute(
        `INSERT INTO inventory_movements
         (store_id, branch_id, branch_inventory_id, movement_type, quantity_bucket, quantity_change,
          quantity_before, quantity_after, unit_cost, reference_type, reference_id, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            storeId, branchId, inventoryId, movementType, bucket, Number(delta),
            Number(before), Number(after),
            unitCost === null || unitCost === undefined ? null : Number(unitCost),
            referenceType,
            Number.isSafeInteger(numericReference) && numericReference > 0 ? numericReference : null,
            v2MovementReason(reference, notes),
            await v2ActorUserId(connection, storeId, actorId),
        ]
    );
    return Number(result.insertId);
}

// Category text -> categories.id (created on first use, like the old free-text category).
async function v2CategoryId(connection, storeId, categoryName, categoryType = "product") {
    const name = String(categoryName || "").trim();
    if (!name) return null;
    const [rows] = await connection.execute(
        `SELECT id FROM categories
         WHERE store_id = ? AND category_type = ? AND LOWER(category_name) = LOWER(?)
             LIMIT 1`,
        [storeId, categoryType, name]
    );
    if (rows.length) return Number(rows[0].id);
    const [insert] = await connection.execute(
        "INSERT INTO categories (store_id, category_name, category_type, status) VALUES (?, ?, ?, 'active')",
        [storeId, name.slice(0, 150), categoryType]
    );
    return Number(insert.insertId);
}

function v2VariantName(values, fallback) {
    const name = Object.values(values || {})
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(", ");
    return (name || fallback || "Default").slice(0, 150);
}
// ===== END StockNBook v2 catalog =====

// ===== BEGIN StockNBook v2 packages read model =====
// Packages with the legacy column names (name, original_value, cover_image).
// Package contents are read from package_items by attachV2Inclusions().
const V2_PACKAGES = `(SELECT
        pk.id, pk.store_id, pk.branch_id, pk.package_code, pk.package_name AS name, pk.description,
        COALESCE((SELECT SUM(pki.quantity * pki.unit_price_snapshot)
                  FROM package_items pki WHERE pki.package_id = pk.id), 0) AS original_value,
        pk.discount_type, pk.discount_value, pk.package_price, pk.down_payment_amount, pk.duration,
        pk.status, pk.category, pk.cover_image_url AS cover_image, NULL AS inclusions,
        pk.created_at, pk.updated_at
    FROM packages pk)`;
// ===== END StockNBook v2 packages read model =====

function jsonResponse(statusCode, headers, body) {
    return { statusCode, headers, body: JSON.stringify(body) };
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
    console.error("Packages Lambda error:", error);
    return jsonResponse(500, headers, {
        error: error instanceof Error ? error.message : "Internal server error",
    });
}

function toSafeString(value, max = 255) {
    return String(value ?? "").trim().slice(0, max);
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function normalizeAction(value) {
    return toSafeString(value, 80)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

async function safeRollback(connection) {
    try {
        if (connection) await connection.rollback();
    } catch {
        // Ignore rollback errors.
    }
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

    if (!Number.isInteger(parsedBranchId) || parsedBranchId <= 0) return false;
    if (!Number.isInteger(parsedStoreId) || parsedStoreId <= 0) return false;

    const [rows] = await connection.execute(
        `SELECT id
         FROM branches
         WHERE id = ?
           AND store_id = ?
             LIMIT 1`,
        [parsedBranchId, parsedStoreId]
    );

    return rows.length > 0;
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
            `SELECT full_name AS manager_name FROM users WHERE id = ? AND store_id = ? AND role = 'manager' LIMIT 1`,
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
            `SELECT full_name AS staff_name FROM users WHERE id = ? AND store_id = ? AND role = 'staff' LIMIT 1`,
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
            `SELECT id AS owner_user_id, full_name AS owner_name FROM users WHERE store_id = ? AND role = 'owner' ORDER BY id ASC LIMIT 1`,
            [storeId]
        );

        return {
            id: rows[0]?.owner_user_id ? Number(rows[0].owner_user_id) : null,
            name: toSafeString(rows[0]?.owner_name, 255) || "Owner",
            role: "Owner",
        };
    }

    return { id: null, name: "Unknown", role: "Staff" };
}

/*
 * Writes one row to employee_actions. Called from inside the same DB
 * transaction as the package action it's logging, so the log and the
 * action succeed or fail together.
 */
async function logEmployeeAction(connection, entry) {
    // employee_actions.user_id references users.id (owners included).
    const userId = Number(entry?.employee?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    const entityId = Number(entry.referenceId);
    await connection.execute(
        `INSERT INTO employee_actions
         (store_id, branch_id, user_id, user_name, user_role,
          module, reference_number, action, entity_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.storeId,
            entry.branchId ?? null,
            userId,
            String(entry.employee.name || "Unknown").slice(0, 150),
            entry.employee.role,
            entry.module,
            entry.referenceNumber ?? null,
            entry.action,
            Number.isSafeInteger(entityId) && entityId > 0 ? entityId : null,
            entry.details === undefined || entry.details === null
                ? null
                : JSON.stringify(entry.details),
        ]
    );
}

function buildPackageReference(id) {
    return `PKG-${String(id).padStart(6, "0")}`;
}

function normalizeInclusion(item, index = 0) {
    // Rental equipment remains in packages.inclusions JSON; package_items is
    // reserved for Sales products. Never treat an equipment ID as a product ID.
    if (item?.itemType === "rental" || item?.item_type === "rental") {
        const equipmentId = Number(firstDefined(item.equipmentId, item.equipment_id) || 0);
        const quantity = Number(item.quantity ?? item.qty ?? 0);
        const rate = Number(firstDefined(item.unitSalesPrice, item.unit_sales_price, item.dailyRate) || 0);
        const name = toSafeString(firstDefined(item.productName, item.product_name, item.name), 255);
        return {
            itemType: "rental", equipmentId, inventoryKey: `rental:${equipmentId}`,
            productId: 0, product_id: 0, variantId: null, variant_id: null,
            productName: name, product_name: name, variantName: "", variant_name: "",
            quantity, unitSalesPrice: rate, unit_sales_price: rate,
            unitPrice: rate, unit_price: rate, lineValue: rate * quantity,
            line_value: rate * quantity, availableStock: Number(item.availableStock || 0),
            item: name, variantLabel: "", variant_label: "",
        };
    }
    const productId = Number(
        firstDefined(item?.productId, item?.product_id) || 0
    );

    const rawVariantId = firstDefined(
        item?.variantId,
        item?.variant_id
    );

    const variantId =
        rawVariantId !== undefined &&
        rawVariantId !== null &&
        rawVariantId !== ""
            ? Number(rawVariantId)
            : null;

    const quantity = Math.max(
        0,
        Number(firstDefined(item?.quantity, item?.qty) || 0)
    );

    const unitSalesPrice = Number(
        firstDefined(
            item?.unitSalesPrice,
            item?.unit_sales_price,
            item?.unitPrice,
            item?.unit_price,
            item?.salesPrice,
            item?.sales_price,
            item?.price
        ) || 0
    );

    const productName = toSafeString(
        firstDefined(
            item?.productName,
            item?.product_name,
            item?.item,
            item?.name
        ),
        255
    );

    const variantName = toSafeString(
        firstDefined(
            item?.variantName,
            item?.variant_name,
            item?.variantLabel,
            item?.variant_label
        ),
        255
    );

    const lineValue =
        toNumber(
            firstDefined(
                item?.lineValue,
                item?.line_value,
                item?.lineTotal,
                item?.line_total
            )
        ) ?? unitSalesPrice * quantity;

    const availableStock = Number(
        firstDefined(
            item?.availableStock,
            item?.available_stock
        ) || 0
    );

    const inventoryKey =
        toSafeString(
            firstDefined(item?.inventoryKey, item?.inventory_key),
            255
        ) ||
        (variantId
            ? `product:${productId}:variant:${variantId}`
            : `product:${productId}:regular`) ||
        `package-item:${index}`;

    return {
        inventoryKey,
        productId,
        product_id: productId,
        variantId,
        variant_id: variantId,
        productName,
        product_name: productName,
        variantName,
        variant_name: variantName,
        quantity,
        unitSalesPrice,
        unit_sales_price: unitSalesPrice,
        unitPrice: unitSalesPrice,
        unit_price: unitSalesPrice,
        lineValue,
        line_value: lineValue,
        availableStock,
        available_stock: availableStock,

        // Legacy aliases are preserved for old saved package rows.
        item: item?.item || productName,
        variantLabel:
            item?.variantLabel ||
            item?.variant_label ||
            variantName,
        variant_label:
            item?.variant_label ||
            item?.variantLabel ||
            variantName,
    };
}

function parseInclusions(value) {
    let raw = [];

    try {
        if (Array.isArray(value)) {
            raw = value;
        } else if (typeof value === "string" && value.trim()) {
            const parsed = JSON.parse(value);
            raw = Array.isArray(parsed) ? parsed : [];
        }
    } catch {
        raw = [];
    }

    return raw.map(normalizeInclusion);
}

function normalizePackageRow(row) {
    return {
        id: Number(row.id),
        store_id: Number(row.store_id),
        branch_id: Number(row.branch_id),
        name: row.name || "",
        description: row.description || "",
        original_value: Number(row.original_value || 0),
        discount_type: row.discount_type || "amount",
        discount_value: Number(row.discount_value || 0),
        package_price: Number(row.package_price || 0),
        down_payment_amount: Number(row.down_payment_amount || 0),
        duration: row.duration || "",
        status: row.status || "Active",
        category: row.category || undefined,
        cover_image: row.cover_image || "",
        inclusions: parseInclusions(row.inclusions),
        created_at: row.created_at || "",
    };
}

async function attachV2Inclusions(connection, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows || [];
    const ids = rows.map((row) => Number(row.id)).filter(Boolean);
    if (!ids.length) return rows;
    const [items] = await connection.execute(
        `SELECT pi.package_id AS packageId, pi.item_type AS itemType, pi.quantity,
                pi.unit_price_snapshot AS unitPrice,
                v.product_id AS productId,
                CASE WHEN v.is_default = 1 THEN NULL ELSE v.id END AS variantId,
                p.product_name AS productName,
                CASE WHEN v.is_default = 1 THEN '' ELSE v.variant_name END AS variantName,
                pi.equipment_id AS equipmentId, e.equipment_name AS equipmentName,
                CASE WHEN pi.item_type = 'rental'
                         THEN GREATEST(COALESCE(bi.on_hand_quantity, 0) - COALESCE(bi.unavailable_quantity, 0), 0)
                     ELSE GREATEST(COALESCE(bi.on_hand_quantity, 0) - COALESCE(bi.reserved_quantity, 0)
                                       - COALESCE(bi.unavailable_quantity, 0), 0) END AS availableStock
         FROM package_items pi
                  JOIN packages pk ON pk.id = pi.package_id
                  LEFT JOIN product_variants v ON v.id = pi.variant_id
                  LEFT JOIN products p ON p.id = v.product_id
                  LEFT JOIN equipment e ON e.id = pi.equipment_id
                  LEFT JOIN branch_inventory bi ON bi.branch_id = pk.branch_id
             AND ((pi.variant_id IS NOT NULL AND bi.variant_id = pi.variant_id)
                 OR (pi.equipment_id IS NOT NULL AND bi.equipment_id = pi.equipment_id))
         WHERE pi.package_id IN (${ids.map(() => "?").join(",")})
         ORDER BY pi.package_id, pi.sort_order, pi.id`,
        ids
    );
    const byPackage = new Map();
    for (const item of items) {
        const key = Number(item.packageId);
        if (!byPackage.has(key)) byPackage.set(key, []);
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        byPackage.get(key).push(item.itemType === "rental"
            ? {
                itemType: "rental",
                equipmentId: Number(item.equipmentId),
                productName: item.equipmentName || "",
                quantity,
                unitSalesPrice: unitPrice,
                availableStock: Number(item.availableStock || 0),
            }
            : {
                productId: Number(item.productId),
                variantId: item.variantId == null ? null : Number(item.variantId),
                productName: item.productName || "",
                variantName: item.variantName || "",
                quantity,
                unitSalesPrice: unitPrice,
                lineValue: unitPrice * quantity,
                availableStock: Number(item.availableStock || 0),
            });
    }
    return rows.map((row) => ({ ...row, inclusions: byPackage.get(Number(row.id)) || [] }));
}


async function getPackageById(
    connection,
    storeId,
    branchId,
    packageId
) {
    let query = `
        SELECT packages.*
        FROM ${V2_PACKAGES} packages
        WHERE packages.id = ?
          AND packages.store_id = ?
    `;
    const params = [packageId, storeId];
    if (branchId) {
        query += " AND packages.branch_id = ?";
        params.push(branchId);
    }
    query += " LIMIT 1";
    const [rows] = await connection.execute(query, params);
    return rows.length > 0
        ? normalizePackageRow((await attachV2Inclusions(connection, rows))[0])
        : null;
}

function getIncomingPackage(body) {
    return {
        name: toSafeString(body.name, 255),
        description: toSafeString(body.description, 5000),
        category: toSafeString(body.category, 120),

        coverImage:
            typeof body.cover_image === "string"
                ? body.cover_image
                : typeof body.coverImage === "string"
                    ? body.coverImage
                    : "",

        originalValue:
            toNumber(firstDefined(body.original_value, body.originalValue)) ?? 0,

        discountType:
            toSafeString(
                firstDefined(body.discount_type, body.discountType),
                30
            ) || "amount",

        discountValue:
            toNumber(firstDefined(body.discount_value, body.discountValue)) ?? 0,

        packagePrice:
            toNumber(firstDefined(body.package_price, body.packagePrice)) ?? 0,

        downPaymentAmount:
            toNumber(
                firstDefined(
                    body.down_payment_amount,
                    body.downPaymentAmount
                )
            ) ?? 0,

        duration: toSafeString(body.duration, 100) || "N/A",
        status: toSafeString(body.status, 30) || "Active",

        inclusions: Array.isArray(body.inclusions)
            ? body.inclusions.map(normalizeInclusion)
            : [],
    };
}


async function replacePackageItemsV2(connection, packageId, storeId, branchId, inclusions) {
    // Validate rental equipment against the live, branch-scoped rental catalog.
    // This is NOT a reservation; availability for event dates is checked by Bookings.
    const rentalLines = [];
    for (const inclusion of inclusions.filter(i => i.itemType === "rental")) {
        const [rows] = await connection.execute(
            `SELECT e.id, e.equipment_name AS name, e.rental_rate_per_day,
                    bi.on_hand_quantity AS total_units, bi.unavailable_quantity AS held_units
             FROM equipment e
                      JOIN branch_inventory bi ON bi.equipment_id = e.id
             WHERE e.id = ? AND e.store_id = ? AND bi.branch_id = ?
               AND e.deleted_at IS NULL LIMIT 1`, [inclusion.equipmentId, storeId, branchId]);
        if (!rows.length) throw new Error(`Rental equipment ${inclusion.equipmentId} is not available in this branch.`);
        const equipment = rows[0];
        const physical = Number(equipment.total_units) - Number(equipment.held_units);
        if (inclusion.quantity > physical) throw new Error(`${equipment.name}: not enough physical rental units.`);
        if (Number(equipment.rental_rate_per_day) <= 0 ||
            Math.abs(Number(equipment.rental_rate_per_day) - Number(inclusion.unitSalesPrice)) > 0.005)
            throw new Error(`${equipment.name}: rental rate has changed. Refresh the catalog before saving.`);
        rentalLines.push({ ...inclusion, equipmentId: Number(equipment.id) });
    }
    const consumableInclusions = inclusions.filter(i => i.itemType !== "rental");
    const consumableLines = [];
    // Validate tenant/branch ownership before writing normalized package relations.
    for (const inclusion of consumableInclusions) {
        const [rows] = await connection.execute(
            `SELECT p.id, p.has_variants
             FROM products p
                      JOIN product_variants dv ON dv.product_id = p.id AND dv.is_default = 1
                      JOIN branch_inventory base_bi ON base_bi.variant_id = dv.id
             WHERE p.id = ?
               AND p.store_id = ?
               AND base_bi.branch_id = ?
               AND p.deleted_at IS NULL
                 LIMIT 1`,
            [inclusion.productId, storeId, branchId]
        );
        let variantOk = true;
        if (rows.length && inclusion.variantId) {
            const [variants] = await connection.execute(
                `SELECT id FROM product_variants
                 WHERE id = ? AND product_id = ? AND is_default = 0 AND deleted_at IS NULL LIMIT 1`,
                [inclusion.variantId, inclusion.productId]
            );
            variantOk = variants.length > 0;
        }
        if (!rows.length || !variantOk) {
            throw new Error(
                `Package inclusion references a product/variant that does not belong to this store branch (product ${inclusion.productId}).`
            );
        }
        if (Number(rows[0].has_variants)===1 && !inclusion.variantId)
            throw new Error(`Package product ${inclusion.productId} requires a specific variant.`);
        if (Number(rows[0].has_variants)!==1 && inclusion.variantId)
            throw new Error(`Package product ${inclusion.productId} is not variant-based.`);
        consumableLines.push({
            ...inclusion,
            catalogVariantId: await v2CatalogVariantId(connection, inclusion.productId, inclusion.variantId),
        });
    }
    await connection.execute(
        "DELETE FROM package_items WHERE package_id = ?",
        [packageId]
    );
    const lines = inclusions.map((inclusion) => inclusion.itemType === "rental"
        ? rentalLines.shift()
        : consumableLines.shift());
    if (!lines.length) return;
    const placeholders = lines.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = lines.flatMap((line, index) => [
        storeId,
        packageId,
        line.itemType === "rental" ? null : line.catalogVariantId,
        line.itemType === "rental" ? line.equipmentId : null,
        line.itemType === "rental" ? "rental" : "consumable",
        Number(line.quantity || 1),
        Number(line.unitSalesPrice || line.unit_price || 0),
        index,
    ]);
    await connection.execute(
        `INSERT INTO package_items
         (store_id, package_id, variant_id, equipment_id, item_type, quantity, unit_price_snapshot, sort_order)
         VALUES ${placeholders}`,
        params
    );
}

function validatePackageInput(pkg) {
    if (!pkg.name) return "Package name is required.";

    if (pkg.inclusions.length === 0) {
        return "Please add at least one consumable or rental inclusion.";
    }

    if (
        pkg.discountType !== "amount" &&
        pkg.discountType !== "percentage"
    ) {
        return "Invalid discount type.";
    }

    if (pkg.discountValue < 0) {
        return "Discount cannot be negative.";
    }

    if (
        pkg.discountType === "percentage" &&
        pkg.discountValue > 100
    ) {
        return "Percentage discount cannot exceed 100%.";
    }

    if (pkg.originalValue < 0) {
        return "Original value cannot be negative.";
    }

    if (pkg.packagePrice < 0) {
        return "Package price cannot be negative.";
    }

    if (pkg.downPaymentAmount < 0) {
        return "Down payment cannot be negative.";
    }

    if (pkg.downPaymentAmount > pkg.packagePrice) {
        return "Down payment cannot exceed package price.";
    }

    const seenInclusions=new Set();
    for (const inclusion of pkg.inclusions) {
        const isRental = inclusion.itemType === "rental";
        const inclusionKey = isRental ? `rental:${inclusion.equipmentId}` : `sales:${inclusion.productId}:${inclusion.variantId||0}`;
        if (seenInclusions.has(inclusionKey)) return "Each item may appear only once in a package.";
        seenInclusions.add(inclusionKey);
        if (isRental) {
            if (!Number.isSafeInteger(inclusion.equipmentId) || inclusion.equipmentId <= 0)
                return "Each rental inclusion must specify valid equipment.";
        } else if (!Number.isSafeInteger(inclusion.productId) || inclusion.productId <= 0) {
            return "Each consumable inclusion must reference a valid product.";
        }
        if (!Number.isSafeInteger(inclusion.quantity) || inclusion.quantity <= 0 || inclusion.quantity > 100000)
            return "Each inclusion must contain a positive whole-number quantity.";
        if (!Number.isFinite(inclusion.unitSalesPrice) || inclusion.unitSalesPrice < 0)
            return "Each inclusion must contain a valid price.";
    }

    const expectedOriginal = pkg.inclusions.reduce((total, line) => total + Number(line.lineValue || 0), 0);
    if (Math.abs(expectedOriginal - pkg.originalValue) > 0.02)
        return "The package total does not match its included items.";
    const expectedPrice = pkg.discountType === "percentage"
        ? pkg.originalValue * (1 - pkg.discountValue / 100)
        : pkg.originalValue - pkg.discountValue;
    if (Math.abs(Math.max(0, expectedPrice) - pkg.packagePrice) > 0.02)
        return "The package price does not match its discount.";
    return "";
}

// Fetch live package access for the signed-in branch account. A Manager's
// unconfigured permission keeps its default full access; Staff must be
// explicitly granted view/full. Never trust browser-stored permissions.
async function getPackageAccess(connection, decoded, role, storeId) {
    if (role === "owner") return "full";
    if (role !== "manager" && role !== "staff") return "none";
    const isManager = role === "manager";
    const accountId = Number(isManager ? decoded?.manager_id : decoded?.staff_id);
    const branchId = Number(decoded?.branch_id);
    if (!Number.isInteger(accountId) || accountId <= 0 ||
        !Number.isInteger(branchId) || branchId <= 0) return "none";
    const [rows] = await connection.execute(
        `SELECT permissions FROM users
         WHERE id = ? AND store_id = ? AND branch_id = ? AND role = ? AND status = 'active'
             LIMIT 1`,
        [accountId, storeId, branchId, role]
    );
    if (!rows.length) return "none";
    let permissions = rows[0].permissions || {};
    if (typeof permissions === "string") {
        try { permissions = JSON.parse(permissions); } catch { permissions = {}; }
    }
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
        permissions = {};
    }
    const value = permissions.packages;
    if (isManager && value === undefined) return "full";
    if (value === true || value === "full" || value === "true") return "full";
    if (value === "view" || value === "view_only" || value === "viewOnly") return "view";
    return "none";
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
        return badRequest(headers, "Invalid JSON body.");
    }

    const action = normalizeAction(body.action);
    let connection;

    try {
        connection = await dbPool.getConnection();

        // ── PUBLIC: get_public_packages for customer portal ─────────────
        // ── PUBLIC: GET PACKAGES FOR CUSTOMER BOOKING PORTAL ─────────────
        if (action === "get_public_packages") {
            const publicStoreId = Number(
                firstDefined(
                    body.store_id,
                    body.storeId
                )
            );

            const rawBranchId = firstDefined(
                body.branch_id,
                body.branchId
            );

            const publicBranchId =
                rawBranchId !== undefined &&
                rawBranchId !== null &&
                rawBranchId !== ""
                    ? Number(rawBranchId)
                    : null;

            console.log(
                "[PUBLIC PACKAGES] store:",
                publicStoreId,
                "branch:",
                publicBranchId
            );

            if (
                !Number.isInteger(publicStoreId) ||
                publicStoreId <= 0
            ) {
                return badRequest(
                    headers,
                    "Missing or invalid store_id."
                );
            }

            const storeExists =
                await ensureStoreExists(
                    connection,
                    publicStoreId
                );

            if (!storeExists) {
                return notFound(
                    headers,
                    "Store account not found."
                );
            }

            if (publicBranchId) {
                if (
                    !Number.isInteger(publicBranchId) ||
                    publicBranchId <= 0
                ) {
                    return badRequest(
                        headers,
                        "Invalid branch_id."
                    );
                }

                const branchExists =
                    await ensureBranchBelongsToStore(
                        connection,
                        publicBranchId,
                        publicStoreId
                    );

                if (!branchExists) {
                    return notFound(
                        headers,
                        "Branch not found for this store."
                    );
                }
            }

            let query = `
                SELECT packages.*
                FROM ${V2_PACKAGES} packages
                WHERE packages.store_id = ?
                  AND (
                    packages.status IS NULL
                        OR TRIM(packages.status) = ''
                        OR LOWER(TRIM(packages.status)) = 'active'
                    )
            `;

            const params = [
                publicStoreId
            ];

            if (publicBranchId) {
                query += `
            AND packages.branch_id = ?
        `;

                params.push(
                    publicBranchId
                );
            }

            query += `
        ORDER BY packages.id DESC
    `;

            console.log(
                "[PUBLIC PACKAGES] QUERY:",
                query
            );

            console.log(
                "[PUBLIC PACKAGES] PARAMS:",
                params
            );

            const [rows] =
                await connection.execute(
                    query,
                    params
                );

            console.log(
                "[PUBLIC PACKAGES] ROW COUNT:",
                rows.length
            );

            /*
             * IMPORTANT:
             *
             * Use the SAME normalizer as the authenticated
             * get_packages action.
             *
             * This keeps the public customer response and
             * internal package response identical.
             */
            const packages =
                (await attachV2Inclusions(connection, rows)).map(normalizePackageRow);

            return jsonResponse(
                200,
                headers,
                {
                    success: true,
                    packages,
                    total: packages.length,
                }
            );
        }

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
        let decoded;

        try {
            const token = authHeader.replace(/^Bearer\s+/i, "");
            decoded = jwt.verify(token, JWT_SECRET);

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

        if (!(await ensureStoreExists(connection, storeId))) {
            return badRequest(headers, "Store account not found.");
        }

        const isBranchUser =
            tokenRole === "manager" ||
            tokenRole === "staff";

        const rawRequestedBranchId = firstDefined(
            body.branch_id,
            body.branchId
        );

        const requestedBranchId =
            rawRequestedBranchId !== undefined &&
            rawRequestedBranchId !== null &&
            rawRequestedBranchId !== ""
                ? Number(rawRequestedBranchId)
                : null;

        const activeBranchId =
            isBranchUser
                ? tokenBranchId
                : requestedBranchId;

        if (
            isBranchUser &&
            (!Number.isInteger(activeBranchId) || activeBranchId <= 0)
        ) {
            return badRequest(
                headers,
                "Missing branch_id for branch user."
            );
        }

        if (
            activeBranchId &&
            !(await ensureBranchBelongsToStore(
                connection,
                activeBranchId,
                storeId
            ))
        ) {
            return badRequest(
                headers,
                "Invalid branch for this store."
            );
        }

        if (["get_packages", "create_package", "update_package", "delete_package"].includes(action)) {
            const access = await getPackageAccess(connection, decoded, tokenRole, storeId);
            const canProceed = action === "get_packages" ? access !== "none" : access === "full";
            if (!canProceed) {
                return jsonResponse(403, headers, {
                    error: "You do not have permission for this package operation."
                });
            }
        }

        if (action === "get_packages") {
            let query = `
                SELECT packages.*
                FROM ${V2_PACKAGES} packages
                WHERE packages.store_id = ?
            `;

            const params = [storeId];

            if (activeBranchId) {
                query += " AND packages.branch_id = ?";
                params.push(activeBranchId);
            }

            query += " ORDER BY packages.id DESC";

            const [rows] = await connection.execute(query, params);

            return jsonResponse(200, headers, {
                success: true,
                packages: (await attachV2Inclusions(connection, rows)).map(normalizePackageRow),
            });
        }

        if (action === "create_package") {
            if (!activeBranchId) {
                return badRequest(headers, "branch_id is required.");
            }

            const pkg = getIncomingPackage(body);
            const validationError = validatePackageInput(pkg);

            if (validationError) {
                return badRequest(headers, validationError);
            }

            const [duplicates] = await connection.execute(
                `SELECT id
                 FROM packages
                 WHERE store_id = ?
                   AND branch_id = ?
                   AND LOWER(TRIM(package_name)) = LOWER(TRIM(?))
                     LIMIT 1`,
                [storeId, activeBranchId, pkg.name]
            );

            if (duplicates.length > 0) {
                return badRequest(
                    headers,
                    `Package "${pkg.name}" already exists in this branch.`
                );
            }

            await connection.beginTransaction();

            try {
                const [result] = await connection.execute(
                    `INSERT INTO packages
                     (
                         store_id,
                         branch_id,
                         package_code,
                         package_name,
                         description,
                         discount_type,
                         discount_value,
                         package_price,
                         down_payment_amount,
                         duration,
                         status,
                         category,
                         cover_image_url,
                         updated_by
                     )
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        storeId,
                        activeBranchId,
                        `PKG-NEW-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
                        pkg.name,
                        pkg.description || null,
                        pkg.discountType,
                        pkg.discountValue,
                        pkg.packagePrice,
                        pkg.downPaymentAmount,
                        pkg.duration,
                        pkg.status,
                        pkg.category || null,
                        pkg.coverImage || null,
                        await v2ActorUserId(connection, storeId,
                            (await getActingEmployee(connection, decoded, tokenRole, storeId)).id),
                    ]
                );

                const packageId = Number(result.insertId);
                // The package code is its permanent reference number (PKG-000123).
                await connection.execute(
                    "UPDATE packages SET package_code = ? WHERE id = ?",
                    [buildPackageReference(packageId), packageId]
                );

                await replacePackageItemsV2(
                    connection,
                    packageId,
                    storeId,
                    activeBranchId,
                    pkg.inclusions
                );

                const actingEmployee = await getActingEmployee(
                    connection,
                    decoded,
                    tokenRole,
                    storeId
                );

                await logEmployeeAction(connection, {
                    storeId,
                    branchId: activeBranchId,
                    employee: actingEmployee,
                    module: "Packages",
                    referenceNumber: buildPackageReference(packageId),
                    action: "Added package",
                    referenceId: String(packageId),
                    details: `Added ${pkg.name} to packages`,
                });

                await connection.commit();

                const createdPackage = await getPackageById(
                    connection,
                    storeId,
                    activeBranchId,
                    packageId
                );

                return jsonResponse(201, headers, {
                    success: true,
                    package: createdPackage,
                });
            } catch (error) {
                await safeRollback(connection);
                throw error;
            }
        }

        if (action === "update_package") {
            const packageId = Number(body.id);

            if (!Number.isInteger(packageId) || packageId <= 0) {
                return badRequest(headers, "Invalid package id.");
            }

            const existingPackage = await getPackageById(
                connection,
                storeId,
                activeBranchId,
                packageId
            );

            if (!existingPackage) {
                return notFound(headers, "Package not found.");
            }

            const pkg = getIncomingPackage(body);
            const validationError = validatePackageInput(pkg);

            if (validationError) {
                return badRequest(headers, validationError);
            }

            const branchId =
                activeBranchId || Number(existingPackage.branch_id);

            const [duplicates] = await connection.execute(
                `SELECT id
                 FROM packages
                 WHERE store_id = ?
                   AND branch_id = ?
                   AND LOWER(TRIM(package_name)) = LOWER(TRIM(?))
                   AND id <> ?
                     LIMIT 1`,
                [storeId, branchId, pkg.name, packageId]
            );

            if (duplicates.length > 0) {
                return badRequest(
                    headers,
                    `Package "${pkg.name}" already exists in this branch.`
                );
            }

            await connection.beginTransaction();

            try {
                let query = `
                    UPDATE packages
                    SET
                        package_name = ?,
                        description = ?,
                        discount_type = ?,
                        discount_value = ?,
                        package_price = ?,
                        down_payment_amount = ?,
                        duration = ?,
                        status = ?,
                        category = ?,
                        cover_image_url = ?
                    WHERE id = ?
                      AND store_id = ?
                `;

                const params = [
                    pkg.name,
                    pkg.description || null,
                    pkg.discountType,
                    pkg.discountValue,
                    pkg.packagePrice,
                    pkg.downPaymentAmount,
                    pkg.duration,
                    pkg.status,
                    pkg.category || null,
                    pkg.coverImage || null,
                    packageId,
                    storeId,
                ];

                if (activeBranchId) {
                    query += " AND branch_id = ?";
                    params.push(activeBranchId);
                }

                const [result] = await connection.execute(query, params);

                if (result.affectedRows === 0) {
                    await safeRollback(connection);
                    return notFound(headers, "Package not found.");
                }

                await replacePackageItemsV2(
                    connection,
                    packageId,
                    storeId,
                    branchId,
                    pkg.inclusions
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
                    module: "Packages",
                    referenceNumber: buildPackageReference(packageId),
                    action: "Updated package",
                    referenceId: String(packageId),
                    details: existingPackage.name !== pkg.name
                        ? `Renamed ${existingPackage.name} to ${pkg.name}`
                        : `Updated details for ${pkg.name}`,
                });

                await connection.commit();

                const updatedPackage = await getPackageById(
                    connection,
                    storeId,
                    activeBranchId,
                    packageId
                );

                return jsonResponse(200, headers, {
                    success: true,
                    package: updatedPackage,
                });
            } catch (error) {
                await safeRollback(connection);
                throw error;
            }
        }

        if (action === "delete_package") {
            const packageId = Number(body.id);

            if (!Number.isInteger(packageId) || packageId <= 0) {
                return badRequest(headers, "Invalid package id.");
            }

            const existingPackage = await getPackageById(
                connection,
                storeId,
                activeBranchId,
                packageId
            );

            if (!existingPackage) {
                return notFound(headers, "Package not found.");
            }

            await connection.beginTransaction();

            try {
                // Package contents go first (package_items references packages).
                await connection.execute(
                    "DELETE FROM package_items WHERE package_id = ? AND store_id = ?",
                    [packageId, storeId]
                );
                let query = `
                    DELETE FROM packages
                    WHERE id = ?
                      AND store_id = ?
                `;

                const params = [packageId, storeId];

                if (activeBranchId) {
                    query += " AND branch_id = ?";
                    params.push(activeBranchId);
                }

                const [result] = await connection.execute(query, params);

                if (result.affectedRows === 0) {
                    await safeRollback(connection);
                    return notFound(headers, "Package not found.");
                }

                const actingEmployee = await getActingEmployee(
                    connection,
                    decoded,
                    tokenRole,
                    storeId
                );

                await logEmployeeAction(connection, {
                    storeId,
                    branchId: activeBranchId || Number(existingPackage.branch_id),
                    employee: actingEmployee,
                    module: "Packages",
                    referenceNumber: buildPackageReference(packageId),
                    action: "Deleted package",
                    referenceId: String(packageId),
                    details: `Removed ${existingPackage.name} from packages`,
                });

                await connection.commit();

                return jsonResponse(200, headers, { success: true });
            } catch (error) {
                await safeRollback(connection);
                // Bookings keep a reference to the package they were made from.
                if (String(error?.code || "").startsWith("ER_ROW_IS_REFERENCED")) {
                    return jsonResponse(409, headers, {
                        error: "This package is used by existing bookings and cannot be deleted. Set it to Inactive instead.",
                    });
                }
                throw error;
            }
        }

        return badRequest(headers, "Invalid action.");
    } catch (error) {
        await safeRollback(connection);
        return serverError(headers, error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
};