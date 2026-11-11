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

function toSafeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function toDateOnly(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const raw = String(value ?? "").trim().slice(0, 10);

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
        raw === "0000-00-00"
    ) {
        return null;
    }

    return raw;
}

function parseVariantName(rawValue) {
    if (!rawValue) {
        return "";
    }

    if (typeof rawValue === "object") {
        return Object.values(rawValue)
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(" / ");
    }

    const raw = String(rawValue).trim();

    try {
        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === "object") {
            return Object.values(parsed)
                .map((value) => String(value || "").trim())
                .filter(Boolean)
                .join(" / ");
        }
    } catch {
        // Raw text is already an acceptable variant name.
    }

    return raw;
}

function getInventoryKey(productId, variantId) {
    return `${productId}:${variantId || "product"}`;
}

/*
  Returns the inventory item's key for a POS line.

  Preferred behavior is an exact product + variant match. The fallback keeps
  older/demo POS records usable when they have a valid product_id but have
  no variant_id or an outdated variant_id.
*/
function resolveInventoryItemKey(
    inventoryByProduct,
    productId,
    variantId
) {
    const parsedProductId = toPositiveInteger(productId);

    if (!parsedProductId) {
        return null;
    }

    const candidates = inventoryByProduct.get(parsedProductId) || [];

    if (candidates.length === 0) {
        return null;
    }

    const parsedVariantId = toPositiveInteger(variantId);

    const exactMatch = candidates.find(
        (item) => toPositiveInteger(item.variantId) === parsedVariantId
    );

    if (exactMatch) {
        return exactMatch.id;
    }

    const productLevelItem = candidates.find(
        (item) => !toPositiveInteger(item.variantId)
    );

    return (productLevelItem || candidates[0]).id;
}

function getStartOfWeekUTC(date) {
    const result = new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate()
        )
    );

    const mondayOffset = (result.getUTCDay() + 6) % 7;
    result.setUTCDate(result.getUTCDate() - mondayOffset);

    return result;
}

function addDaysUTC(date, days) {
    const result = new Date(date.getTime());
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function toISODate(date) {
    return date.toISOString().slice(0, 10);
}

function getWeekWindows(historyWeeks = 12, today = new Date()) {
    const currentWeekStart = getStartOfWeekUTC(today);
    const count = Math.max(3, Number(historyWeeks) || 12);
    const weekStarts = [];

    for (let offset = count - 1; offset >= 0; offset -= 1) {
        weekStarts.push(addDaysUTC(currentWeekStart, -offset * 7));
    }

    return weekStarts.map((startDate) => ({
        startDate: toISODate(startDate),
        endDate: toISODate(addDaysUTC(startDate, 6)),
    }));
}

function getMonthRange(historyMonths = 12, today = new Date()) {
    const count = Math.max(1, Number(historyMonths) || 12);

    // Use completed calendar months only.
    // Example on July 1, 2026:
    // Start: July 1, 2025
    // End: June 30, 2026
    const currentMonthStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
    );

    const end = new Date(currentMonthStart.getTime());
    end.setUTCDate(end.getUTCDate() - 1);

    const start = new Date(
        Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth() - (count - 1),
            1
        )
    );

    return {
        startDate: toISODate(start),
        endDate: toISODate(end),
    };
}

function getUpcomingBookingRange(periodDays = 30, today = new Date()) {
    const days = Math.max(1, Number(periodDays) || 30);

    const start = new Date(
        Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate()
        )
    );

    return {
        startDate: toISODate(start),
        endDate: toISODate(addDaysUTC(start, days - 1)),
    };
}

function safeParseJSON(value) {
    if (!value) {
        return null;
    }

    if (typeof value === "object") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function readFirstText(object, keys = []) {
    if (!object || typeof object !== "object") {
        return "";
    }

    for (const key of keys) {
        const value = object[key];

        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }

    return "";
}

function getBookingAllocations(packagePayload) {
    const payload = safeParseJSON(packagePayload);

    if (!payload || typeof payload !== "object") {
        return [];
    }

    const inclusions = Array.isArray(payload.inclusions)
        ? payload.inclusions
        : Array.isArray(payload.items)
            ? payload.items
            : [];

    return inclusions
        .map((inclusion) => {
            const productId = toPositiveInteger(
                inclusion?.productId ??
                inclusion?.product_id ??
                inclusion?.id
            );

            const variantId = toPositiveInteger(
                inclusion?.variantId ?? inclusion?.variant_id
            );

            const quantity = Math.max(
                0,
                toSafeNumber(
                    inclusion?.quantity ??
                    inclusion?.qty ??
                    inclusion?.count ??
                    1
                )
            );

            const itemName = readFirstText(inclusion, [
                "item",
                "name",
                "productName",
                "product_name",
                "title",
            ]);

            if (quantity <= 0) {
                return null;
            }

            return {
                productId,
                variantId,
                quantity,
                itemName,
            };
        })
        .filter(Boolean);
}

async function ensureBranchBelongsToStore(connection, branchId, storeId) {
    const parsedBranchId = toPositiveInteger(branchId);
    const parsedStoreId = toPositiveInteger(storeId);

    if (!parsedBranchId || !parsedStoreId) {
        return false;
    }

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

async function getInventoryItems(connection, { storeId, branchId = null }) {
    let query = `
        SELECT
            p.id AS product_id,
            bi.store_id,
            bi.branch_id,
            p.name AS product_name,
            p.category,
            bi.quantity_on_hand AS inventory_stock,
            bi.reorder_level AS inventory_alert_level,
            bi.variant_id AS variant_id,
            pv.variant_values,
            b.branch_name
        FROM ${V2_BRANCH_INVENTORY} bi
                 INNER JOIN ${V2_PRODUCTS} p
                            ON p.id = bi.product_id
                                AND p.store_id = bi.store_id
                                AND p.branch_id = bi.branch_id
                 LEFT JOIN ${V2_PRODUCT_VARIANTS} pv
                           ON pv.id = bi.variant_id
                               AND pv.product_id = p.id
                 LEFT JOIN branches b
                           ON b.id = bi.branch_id
                               AND b.store_id = bi.store_id
        WHERE bi.store_id = ?
          AND bi.status = 'active'
          AND p.deleted_at IS NULL
          AND (bi.variant_id IS NULL OR pv.deleted_at IS NULL)
    `;

    const params = [storeId];

    if (branchId) {
        query += " AND bi.branch_id = ?";
        params.push(branchId);
    }

    query += " ORDER BY p.name ASC, bi.variant_id ASC";

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => {
        const productId = Number(row.product_id);
        const variantId = toPositiveInteger(row.variant_id);

        const isVariant = Boolean(variantId);
        const variantName = isVariant
            ? parseVariantName(row.variant_values) || "Variant"
            : null;

        const itemName = isVariant
            ? `${row.product_name} / ${variantName}`
            : String(row.product_name || "Unnamed Product");

        return {
            id: getInventoryKey(productId, variantId),
            productId,
            variantId,
            productName: String(row.product_name || ""),
            variantName,
            itemName,
            category: String(row.category || "Uncategorized"),
            branchId: Number(row.branch_id),
            branchName: String(row.branch_name || "Unnamed Branch"),
            isVariant,
            onHandQuantity: toSafeNumber(row.inventory_stock),
            lowStockThreshold: toSafeNumber(row.inventory_alert_level),
        };
    });
}

async function getHistoricalSales(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    /*
      Aggregate POS quantities by inventory item and calendar week inside
      MySQL. The previous query returned every order-item row and transferred
      a much larger result to Lambda. buildWeeklyDemandMap() accepts these
      Monday week-start dates without any other changes.
    */
    let query = `
        SELECT
            oi.product_id,
            oi.variant_id,
            SUM(oi.quantity) AS quantity,
            DATE_FORMAT(
                    DATE_SUB(
                            DATE(o.order_date),
                INTERVAL WEEKDAY(DATE(o.order_date)) DAY
            ),
                    '%Y-%m-%d'
            ) AS order_date
        FROM ${V2_POS_ORDERS} o
                 INNER JOIN ${V2_POS_ORDER_ITEMS} oi
                            ON oi.order_id = o.order_id
        WHERE o.store_id = ?
          AND oi.product_id IS NOT NULL
          AND DATE(o.order_date) BETWEEN ? AND ?
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
    GROUP BY
        oi.product_id,
        oi.variant_id,
        DATE_FORMAT(
            DATE_SUB(
                DATE(o.order_date),
                INTERVAL WEEKDAY(DATE(o.order_date)) DAY
            ),
            '%Y-%m-%d'
        )
    ORDER BY order_date ASC
`;
    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
        productId: toPositiveInteger(row.product_id),
        variantId: toPositiveInteger(row.variant_id),
        quantity: toSafeNumber(row.quantity),
        orderDate: toDateOnly(row.order_date),
    }));
}

async function getMonthlySalesSummary(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    let query = `
        SELECT
            DATE_FORMAT(o.order_date, '%Y-%m') AS month_key,
            SUM(oi.quantity) AS total_units,
            COUNT(DISTINCT o.order_id) AS order_count
        FROM ${V2_POS_ORDERS} o
                 INNER JOIN ${V2_POS_ORDER_ITEMS} oi
                            ON oi.order_id = o.order_id
        WHERE o.store_id = ?
          AND oi.product_id IS NOT NULL
          AND o.order_date BETWEEN ? AND ?
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY DATE_FORMAT(o.order_date, '%Y-%m')
        ORDER BY month_key ASC
    `;

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
        monthKey: String(row.month_key || ""),
        totalUnits: toSafeNumber(row.total_units),
        orderCount: toSafeNumber(row.order_count),
    }));
}

async function getItemMonthlySalesSummary(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    let query = `
        SELECT
            oi.product_id,
            oi.variant_id,
            DATE_FORMAT(o.order_date, '%Y-%m') AS month_key,
            SUM(oi.quantity) AS total_units,
            COUNT(DISTINCT o.order_id) AS order_count
        FROM ${V2_POS_ORDERS} o
                 INNER JOIN ${V2_POS_ORDER_ITEMS} oi
                            ON oi.order_id = o.order_id
        WHERE o.store_id = ?
          AND oi.product_id IS NOT NULL
          AND o.order_date BETWEEN ? AND ?
    `;

    const params = [storeId, startDate, endDate];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY
            oi.product_id,
            oi.variant_id,
            DATE_FORMAT(o.order_date, '%Y-%m')
        ORDER BY month_key ASC
    `;

    const [rows] = await connection.execute(query, params);

    return rows.map((row) => ({
        productId: toPositiveInteger(row.product_id),
        variantId: toPositiveInteger(row.variant_id),
        monthKey: String(row.month_key || ""),
        totalUnits: toSafeNumber(row.total_units),
        orderCount: toSafeNumber(row.order_count),
    }));
}

function buildItemMonthlySalesMap(inventoryItems, itemMonthlySales) {
    const monthlySalesMap = new Map();
    const inventoryByProduct = new Map();

    inventoryItems.forEach((item) => {
        monthlySalesMap.set(item.id, []);

        const productId = toPositiveInteger(item.productId);

        if (!productId) {
            return;
        }

        const currentItems = inventoryByProduct.get(productId) || [];
        currentItems.push(item);
        inventoryByProduct.set(productId, currentItems);
    });

    itemMonthlySales.forEach((sale) => {
        if (!sale.productId || !sale.monthKey) {
            return;
        }

        const itemKey = resolveInventoryItemKey(
            inventoryByProduct,
            sale.productId,
            sale.variantId
        );

        if (!itemKey) {
            return;
        }

        const current = monthlySalesMap.get(itemKey);

        if (current) {
            current.push({
                monthKey: sale.monthKey,
                totalUnits: sale.totalUnits,
                orderCount: sale.orderCount,
            });
        }
    });

    return monthlySalesMap;
}

async function getUpcomingBookings(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    /*
      Exact booking_items schema used by this project:
      id, booking_id, product_id, variant_id, product_name, quantity,
      created_at, unit_price, line_total.

      Do not query reserved_quantity, booked_quantity, store_id, or branch_id
      from booking_items because those columns do not exist in this database.
    */
    let bookingQuery = `
        SELECT
            b.id,
            b.branch_id,
            br.branch_name,
            b.booking_reference,
            b.name,
            b.event_date,
            b.event_time,
            b.status,
            b.package_name
        FROM ${V2_BOOKINGS} b
                 LEFT JOIN branches br
                           ON br.id = b.branch_id
                               AND br.store_id = b.store_id
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
                                                      'confirmed',
                                                      'preparing',
                                                      'approved'
            )
    `;

    const bookingParams = [storeId, startDate, endDate];

    if (branchId) {
        bookingQuery += " AND b.branch_id = ?";
        bookingParams.push(branchId);
    }

    bookingQuery += " ORDER BY b.event_date ASC, b.event_time ASC, b.id ASC";

    const [bookingRows] = await connection.execute(
        bookingQuery,
        bookingParams
    );

    if (bookingRows.length === 0) {
        return [];
    }

    let allocationQuery = `
        SELECT
            bi.booking_id,
            bi.product_id,
            bi.variant_id,
            COALESCE(
                    NULLIF(TRIM(bi.product_name), ''),
                    NULLIF(TRIM(p.name), ''),
                    CONCAT('Product ', bi.product_id)
            ) AS item_name,
            SUM(COALESCE(bi.booked_quantity, 0)) AS quantity
        FROM ${V2_BOOKING_LINES} bi
                 INNER JOIN ${V2_BOOKINGS} b
                            ON b.id = bi.booking_id
                 LEFT JOIN ${V2_PRODUCTS} p
                           ON p.id = bi.product_id
                               AND p.store_id = b.store_id
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
                                                      'confirmed',
                                                      'preparing',
                                                      'approved'
            )
          AND bi.product_id IS NOT NULL
    `;

    const allocationParams = [storeId, startDate, endDate];

    if (branchId) {
        allocationQuery += " AND b.branch_id = ?";
        allocationParams.push(branchId);
    }

    allocationQuery += `
        GROUP BY
            bi.booking_id,
            bi.product_id,
            bi.variant_id,
            bi.product_name,
            p.name
        ORDER BY bi.booking_id ASC
    `;

    const [allocationRows] = await connection.execute(
        allocationQuery,
        allocationParams
    );

    const allocationsByBooking = new Map();

    allocationRows.forEach((row) => {
        const quantity = Math.max(0, toSafeNumber(row.quantity));

        if (quantity <= 0) {
            return;
        }

        const bookingId = Number(row.booking_id);
        const current = allocationsByBooking.get(bookingId) || [];

        current.push({
            productId: toPositiveInteger(row.product_id),
            variantId: toPositiveInteger(row.variant_id),
            quantity,
            itemName: String(row.item_name || "").trim(),
        });

        allocationsByBooking.set(bookingId, current);
    });

    return bookingRows.map((row) => ({
        id: Number(row.id),
        branchId: toPositiveInteger(row.branch_id),
        branchName: String(row.branch_name || "Unnamed Branch"),
        bookingReference: String(row.booking_reference || ""),
        customerName: String(row.name || "Customer"),
        eventDate: toDateOnly(row.event_date),
        eventTime: String(row.event_time || ""),
        status: String(row.status || ""),
        packageName:
            String(row.package_name || "").trim() ||
            "Custom / Unspecified",
        allocations: allocationsByBooking.get(Number(row.id)) || [],
    }));
}


async function getUpcomingBookingAllocationSummary(
    connection,
    { storeId, branchId = null, startDate, endDate }
) {
    /*
      Lightweight data for get_inventory_forecast.

      The detailed booking forecast has its own API action, so the inventory
      request should not load every upcoming booking row and every allocation.
      This function returns only:
      - booking counts
      - product/variant quantities reserved by upcoming bookings
    */
    let bookingWhere = `
        FROM ${V2_BOOKINGS} b
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
              'confirmed',
              'preparing',
              'approved'
          )
    `;

    const bookingParams = [storeId, startDate, endDate];

    if (branchId) {
        bookingWhere += " AND b.branch_id = ?";
        bookingParams.push(branchId);
    }

    const countsQuery = `
        SELECT
            COUNT(*) AS expected_bookings,
            SUM(
                    CASE
                        WHEN LOWER(TRIM(COALESCE(b.status, ''))) = 'preparing'
                            THEN 1
                        ELSE 0
                        END
            ) AS preparing_bookings,
            SUM(
                    CASE
                        WHEN LOWER(TRIM(COALESCE(b.status, ''))) IN (
                                                                     'confirmed',
                                                                     'approved'
                            )
                            THEN 1
                        ELSE 0
                        END
            ) AS confirmed_bookings,
            SUM(
                    CASE
                        WHEN NOT EXISTS (
                            SELECT 1
                            FROM ${V2_BOOKING_LINES} bi
                            WHERE bi.booking_id = b.id
                        )
                            THEN 1
                        ELSE 0
                        END
            ) AS bookings_without_allocation
            ${bookingWhere}
    `;

    let allocationQuery = `
        SELECT
            bi.product_id,
            bi.variant_id,
            COALESCE(
                    MAX(NULLIF(TRIM(bi.product_name), '')),
                    MAX(NULLIF(TRIM(p.name), '')),
                    CONCAT('Product ', bi.product_id)
            ) AS item_name,
            SUM(COALESCE(bi.booked_quantity, 0)) AS quantity
        FROM ${V2_BOOKINGS} b
                 INNER JOIN ${V2_BOOKING_LINES} bi
                            ON bi.booking_id = b.id
                 LEFT JOIN ${V2_PRODUCTS} p
                           ON p.id = bi.product_id
                               AND p.store_id = b.store_id
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
          AND LOWER(TRIM(COALESCE(b.status, ''))) IN (
                                                      'confirmed',
                                                      'preparing',
                                                      'approved'
            )
          AND bi.product_id IS NOT NULL
    `;

    const allocationParams = [storeId, startDate, endDate];

    if (branchId) {
        allocationQuery += " AND b.branch_id = ?";
        allocationParams.push(branchId);
    }

    allocationQuery += `
        GROUP BY
            bi.product_id,
            bi.variant_id
        ORDER BY quantity DESC
    `;

    const [[countRows], [allocationRows]] = await Promise.all([
        connection.execute(countsQuery, bookingParams),
        connection.execute(allocationQuery, allocationParams),
    ]);

    const counts = countRows[0] || {};

    const allocatedInventory = allocationRows
        .map((row) => ({
            productId: toPositiveInteger(row.product_id),
            variantId: toPositiveInteger(row.variant_id),
            itemName: String(row.item_name || "").trim(),
            quantity: Math.max(0, toSafeNumber(row.quantity)),
        }))
        .filter(
            (row) =>
                row.productId &&
                row.quantity > 0
        );

    const allocatedUnits = allocatedInventory.reduce(
        (total, row) => total + row.quantity,
        0
    );

    return {
        expectedBookings: toSafeNumber(counts.expected_bookings),
        confirmedBookings: toSafeNumber(counts.confirmed_bookings),
        preparingBookings: toSafeNumber(counts.preparing_bookings),
        allocationSummary: {
            allocatedUnits,
            allocationItems: allocatedInventory.length,
            bookingsWithoutAllocation: toSafeNumber(
                counts.bookings_without_allocation
            ),
            unlinkedAllocationEntries: 0,
        },
        allocatedInventory,
    };
}

function buildWeeklyDemandMap(inventoryItems, historicalSales, weekWindows) {
    const weekIndexByStart = new Map(
        weekWindows.map((week, index) => [week.startDate, index])
    );

    const demandMap = new Map();
    const inventoryByProduct = new Map();

    inventoryItems.forEach((item) => {
        demandMap.set(
            item.id,
            Array.from({ length: weekWindows.length }, () => 0)
        );

        const productId = toPositiveInteger(item.productId);

        if (!productId) {
            return;
        }

        const currentItems = inventoryByProduct.get(productId) || [];
        currentItems.push(item);
        inventoryByProduct.set(productId, currentItems);
    });

    historicalSales.forEach((sale) => {
        if (!sale.productId || !sale.orderDate || sale.quantity <= 0) {
            return;
        }

        const saleDate = new Date(`${sale.orderDate}T00:00:00.000Z`);

        if (Number.isNaN(saleDate.getTime())) {
            return;
        }

        const saleWeekStart = toISODate(getStartOfWeekUTC(saleDate));
        const weekIndex = weekIndexByStart.get(saleWeekStart);

        if (weekIndex === undefined) {
            return;
        }

        const itemKey = resolveInventoryItemKey(
            inventoryByProduct,
            sale.productId,
            sale.variantId
        );

        if (!itemKey) {
            return;
        }

        const currentDemand = demandMap.get(itemKey);

        if (currentDemand) {
            currentDemand[weekIndex] += toSafeNumber(sale.quantity);
        }
    });

    return demandMap;
}

module.exports = {
    ensureBranchBelongsToStore,
    getWeekWindows,
    getMonthRange,
    getUpcomingBookingRange,
    getInventoryItems,
    getHistoricalSales,
    getMonthlySalesSummary,
    getItemMonthlySalesSummary,
    getUpcomingBookings,
    getUpcomingBookingAllocationSummary,
    buildWeeklyDemandMap,
    buildItemMonthlySalesMap,
};