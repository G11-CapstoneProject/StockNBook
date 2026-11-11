// ===== BEGIN StockNBook v2 read models (analytics/forecasting) =====
// ===== BEGIN StockNBook v2 catalog (identical in lambda-products, lambda-pos, lambda-bookings, lambda-packages) =====
/*
 * stocknbook_v2 keeps ONE catalog row per product (products) and the prices on
 * product_variants. Every product has one hidden default variant
 * (is_default = 1) that carries the product-level price and, for a product
 * without variants, its stock. Real variants have is_default = 0.
 * Physical stock exists only in branch_inventory, and a product belongs to the
 * branch that holds the branch_inventory row of its default variant.
 *
 * Rental equipment follows the same rule with equipment / equipment_variants.
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

// ===== BEGIN StockNBook v2 POS read models =====
/*
 * POS sales live in orders (Order No. = orders.order_number) and order_items
 * (one line per product_variants row; a product without variants uses its
 * default variant). The read models below return the legacy column names, with
 * order_id = the Order No. text shown in the app, so reports stay unchanged.
 */
const V2_POS_ORDERS = `(SELECT
        po.order_id AS order_pk, po.order_number AS order_id, po.store_id, po.branch_id,
        po.processed_by AS cashier_id, 'WALK_IN' AS customer_type, po.customer_id,
        po.payment_mode, po.tax_type, po.subtotal, po.discount_amount,
        po.vatable_sales, po.vat_amount, po.amount_tendered AS customer_payment, po.change_due,
        po.total, DATE(po.order_date) AS order_date, po.created_at, po.status
    FROM orders po)`;

// Same as V2_POS_ORDERS plus the item summary text ("Name - Variant xQty, ...").
const V2_POS_ORDERS_WITH_ITEM = `(SELECT
        po.order_id AS order_pk, po.order_number AS order_id, po.store_id, po.branch_id,
        po.processed_by AS cashier_id, 'WALK_IN' AS customer_type, po.customer_id,
        po.payment_mode, po.tax_type, po.subtotal, po.discount_amount,
        po.vatable_sales, po.vat_amount, po.amount_tendered AS customer_payment, po.change_due,
        po.total, DATE(po.order_date) AS order_date, po.created_at, po.status,
        (SELECT LEFT(GROUP_CONCAT(CONCAT(poi.product_name_snapshot,
                    CASE WHEN piv.is_default = 1 THEN '' ELSE CONCAT(' - ', piv.variant_name) END,
                    ' x', poi.quantity) ORDER BY poi.id SEPARATOR ', '), 255)
         FROM order_items poi
                  JOIN product_variants piv ON piv.id = poi.variant_id
         WHERE poi.order_id = po.order_id) AS item
    FROM orders po)`;

const V2_POS_ORDER_ITEMS = `(SELECT
        poi.id, poi.store_id, pio.branch_id, pio.order_number AS order_id, poi.order_id AS order_pk,
        piv.product_id, CASE WHEN piv.is_default = 1 THEN NULL ELSE poi.variant_id END AS variant_id,
        poi.variant_id AS catalog_variant_id,
        poi.product_name_snapshot AS product_name, poi.quantity, poi.unit_price, poi.line_total,
        poi.cost_price_at_sale, poi.discount_amount
    FROM order_items poi
             JOIN orders pio ON pio.order_id = poi.order_id
             JOIN product_variants piv ON piv.id = poi.variant_id)`;
// ===== END StockNBook v2 POS read models =====

// Booking bill payments (security deposits and damage/loss charge payments are separate).
const V2_BOOKING_PAID_SQL = (b) => `(COALESCE((SELECT SUM(bp.amount) FROM payments bp
        WHERE bp.booking_id = ${b}.id AND bp.status <> 'voided'
          AND bp.payment_type NOT IN ('Security Deposit','Additional Charge')), 0)
    - COALESCE((SELECT SUM(br.amount) FROM refunds br JOIN payments brp ON brp.id = br.payment_id
        WHERE brp.booking_id = ${b}.id AND br.status = 'completed'
          AND brp.payment_type NOT IN ('Security Deposit','Additional Charge')), 0))`;

// Bookings with the legacy customer/package/payment columns.
const V2_BOOKINGS = `(SELECT
        b.id, b.store_id, b.branch_id, b.booking_reference, b.customer_id, b.package_id,
        b.booking_type, b.event_type, b.theme, b.event_date, b.event_end_date, b.event_time,
        b.venue, b.rental_start_date, b.rental_end_date, b.custom_order, b.notes, b.status,
        bc.full_name AS name, bc.facebook_name, bc.phone, bc.email,
        COALESCE(bpk.package_name, '') AS package_name,
        b.package_price_snapshot AS package_price, b.agreed_price, b.required_down_payment,
        b.down_payment_deadline, b.refundable_deposit_required, b.vat_amount,
        b.final_additional_charges, b.deposit_applied_amount, b.approved_refund_amount,
        b.settlement_status, b.settlement_notes, b.cancellation_reason,
        b.approved_by, b.approved_at, b.created_by,
        ${V2_BOOKING_PAID_SQL("b")} AS amount_paid,
        GREATEST(COALESCE(b.agreed_price, 0) - ${V2_BOOKING_PAID_SQL("b")}, 0) AS balance,
        CASE WHEN ${V2_BOOKING_PAID_SQL("b")} <= 0 THEN 'Unpaid'
             WHEN ${V2_BOOKING_PAID_SQL("b")} + 0.005 >= COALESCE(b.agreed_price, 0) THEN 'Paid'
             ELSE 'Partially Paid' END AS payment_status,
        b.created_at, b.updated_at
    FROM bookings b
             JOIN customers bc ON bc.id = b.customer_id
             LEFT JOIN packages bpk ON bpk.id = b.package_id)`;

const V2_BOOKING_LINES = `(SELECT
        bki.id, bki.id AS booking_item_id, bki.booking_id, bki.store_id, lb.branch_id,
        CASE WHEN bki.parent_item_id IS NULL THEN 'custom' ELSE 'package' END AS source_type,
        pbi.package_id, lv.product_id,
        CASE WHEN lv.is_default = 1 THEN NULL ELSE bki.variant_id END AS variant_id,
        bki.variant_id AS catalog_variant_id,
        bki.item_name_snapshot AS product_name, COALESCE(bki.variant_name_snapshot, '') AS variant_name,
        COALESCE(lcat.category_name, '') AS category,
        bki.quantity AS booked_quantity,
        CASE WHEN bki.item_status = 'pending' THEN 0 ELSE bki.quantity END AS reserved_quantity,
        bki.used_quantity, bki.returned_quantity AS restored_quantity,
        bki.unit_price_snapshot AS unit_price, bki.line_total AS estimated_subtotal,
        ROUND(bki.used_quantity * bki.unit_price_snapshot, 2) AS used_subtotal,
        bki.item_status AS inventory_status, bki.notes,
        bki.prepared_at, bki.prepared_by, bki.released_at AS issued_at, bki.released_by AS issued_by,
        bki.created_at, bki.updated_at
    FROM booking_items bki
             JOIN bookings lb ON lb.id = bki.booking_id AND lb.store_id = bki.store_id
             JOIN product_variants lv ON lv.id = bki.variant_id
             LEFT JOIN products lp ON lp.id = lv.product_id
             LEFT JOIN categories lcat ON lcat.id = lp.category_id
             LEFT JOIN booking_items pbi ON pbi.id = bki.parent_item_id
    WHERE bki.item_type = 'consumable')`;
// ===== END StockNBook v2 read models (analytics/forecasting) =====

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function buildScopeWhere({
                             tableAlias,
                             storeId,
                             branchId,
                             dateColumn = null,
                             startDate = null,
                             endDate = null,
                         }) {
    const alias = tableAlias ? `${tableAlias}.` : "";
    const where = [`${alias}store_id = ?`];
    const params = [Number(storeId)];

    if (branchId) {
        where.push(`${alias}branch_id = ?`);
        params.push(Number(branchId));
    }

    if (dateColumn && startDate && endDate) {
        where.push(`${dateColumn} BETWEEN ? AND ?`);
        params.push(startDate, endDate);
    }

    return {
        where: where.join(" AND "),
        params,
    };
}

async function ensureStoreExists(connection, storeId) {
    const parsedStoreId = toPositiveInteger(storeId);

    if (!parsedStoreId) {
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

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
    const parsedBranchId = toPositiveInteger(branchId);
    const parsedStoreId = toPositiveInteger(storeId);

    if (!parsedBranchId || !parsedStoreId) {
        return false;
    }

    const [rows] = await connection.execute(
        `SELECT id, branch_name
         FROM branches
         WHERE id = ?
           AND store_id = ?
         LIMIT 1`,
        [parsedBranchId, parsedStoreId]
    );

    return rows[0] || null;
}

async function getBranchName(connection, branchId, storeId) {
    if (!branchId) {
        return null;
    }

    const branch = await ensureBranchBelongsToStore(connection, branchId, storeId);
    return branch ? String(branch.branch_name || "") : null;
}

async function getSalesRows(
    connection,
    {
        storeId,
        branchId = null,
        startDate,
        endDate,
    }
) {
    const scope = buildScopeWhere({
        tableAlias: "o",
        storeId,
        branchId,
        dateColumn: "o.order_date",
        startDate,
        endDate,
    });

    const [rows] = await connection.execute(
        `
        SELECT
            o.order_id AS orderId,
            o.branch_id AS branchId,
            DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate,
            COALESCE(o.total, 0) AS total
        FROM ${V2_POS_ORDERS} o
        WHERE ${scope.where}
        ORDER BY o.order_date ASC, o.created_at ASC
        `,
        scope.params
    );

    return rows;
}

async function getProductRevenueRows(
    connection,
    {
        storeId,
        branchId = null,
        startDate,
        endDate,
    }
) {
    const scope = buildScopeWhere({
        tableAlias: "o",
        storeId,
        branchId,
        dateColumn: "o.order_date",
        startDate,
        endDate,
    });

    const [rows] = await connection.execute(
        `
        SELECT
            COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') AS category,
            SUM(
                COALESCE(oi.quantity, 0) *
                COALESCE(NULLIF(oi.unit_price, 0), NULLIF(p.sales_price, 0), 0)
            ) AS value
        FROM ${V2_POS_ORDERS} o
        INNER JOIN ${V2_POS_ORDER_ITEMS} oi
            ON oi.order_id = o.order_id
        LEFT JOIN ${V2_PRODUCTS} p
            ON p.id = oi.product_id
           AND p.store_id = o.store_id
        WHERE ${scope.where}
        GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized')
        HAVING value > 0
        ORDER BY value DESC, category ASC
        `,
        scope.params
    );

    return rows;
}

async function getBookings(
    connection,
    {
        storeId,
        branchId = null,
        startDate,
        endDate,
    }
) {
    const scope = buildScopeWhere({
        tableAlias: "b",
        storeId,
        branchId,
        dateColumn: "b.event_date",
        startDate,
        endDate,
    });

    const [rows] = await connection.execute(
        `
        SELECT
            b.id,
            b.branch_id AS branchId,
            DATE_FORMAT(b.event_date, '%Y-%m-%d') AS eventDate,
            COALESCE(b.event_time, '') AS eventTime,
            COALESCE(b.status, '') AS status,
            COALESCE(b.package_name, '') AS packageName,
            COALESCE(b.custom_order, '') AS customOrder,
            COALESCE(b.agreed_price, 0) AS agreedPrice,
            COALESCE(b.package_price, 0) AS packagePrice,
            COALESCE(b.amount_paid, 0) AS amountPaid
        FROM ${V2_BOOKINGS} b
        WHERE ${scope.where}
        ORDER BY b.event_date ASC, b.event_time ASC, b.created_at ASC
        `,
        scope.params
    );

    return rows;
}

async function getRolePermissions(connection, decoded) {
    const role = String(decoded.role || "").toLowerCase();

    if (role === "owner") {
        return {};
    }

    if (role === "manager") {
        const managerId = toPositiveInteger(decoded.manager_id);

        if (!managerId) {
            return {};
        }

        const [rows] = await connection.execute(
            `SELECT permissions FROM users WHERE id = ? AND store_id = ? AND branch_id = ? AND role = 'manager' AND status = 'active' LIMIT 1`,
            [
                managerId,
                Number(decoded.store_id),
                Number(decoded.branch_id),
            ]
        );

        return rows[0]?.permissions || {};
    }

    if (role === "staff") {
        const staffId = toPositiveInteger(decoded.staff_id);

        if (!staffId) {
            return {};
        }

        const [rows] = await connection.execute(
            `SELECT permissions FROM users WHERE id = ? AND store_id = ? AND branch_id = ? AND role = 'staff' AND status = 'active' LIMIT 1`,
            [
                staffId,
                Number(decoded.store_id),
                Number(decoded.branch_id),
            ]
        );

        return rows[0]?.permissions || {};
    }

    return {};
}

function parsePermissions(value) {
    if (!value) {
        return {};
    }

    if (typeof value === "object") {
        return value;
    }

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function hasExplicitAnalyticsDenial(permissions) {
    const normalized = parsePermissions(permissions);

    return (
        normalized.analytics === false ||
        normalized.analytics_view === false ||
        normalized.view_analytics === false
    );
}

module.exports = {
    toPositiveInteger,
    ensureStoreExists,
    ensureBranchBelongsToStore,
    getBranchName,
    getSalesRows,
    getProductRevenueRows,
    getBookings,
    getRolePermissions,
    hasExplicitAnalyticsDenial,
};