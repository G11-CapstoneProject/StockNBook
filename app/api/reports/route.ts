import { NextRequest, NextResponse } from "next/server";
import mysql, { type Connection, type PoolConnection } from "mysql2/promise";
import jwt from "jsonwebtoken";
import { handler as forecastingHandler } from "../../../lambda-forecasting/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ===== BEGIN StockNBook v2 read models (reports) =====
// stocknbook_v2 tables shown with the column names this report already uses.
const V2_PRODUCT_STOCK_SQL = (p: string, bi: string) => `CASE WHEN ${p}.has_variants = 1 THEN COALESCE((
        SELECT SUM(vbi.on_hand_quantity)
        FROM product_variants vv
                 JOIN branch_inventory vbi ON vbi.variant_id = vv.id AND vbi.branch_id = ${bi}.branch_id
        WHERE vv.product_id = ${p}.id AND vv.is_default = 0 AND vv.deleted_at IS NULL), 0)
    ELSE ${bi}.on_hand_quantity END`;

const V2_PRODUCT_ALERT_SQL = (p: string, bi: string) => `CASE WHEN ${p}.has_variants = 1 THEN COALESCE((
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

const V2_POS_ORDERS = `(SELECT
        po.order_id AS order_pk, po.order_number AS order_id, po.store_id, po.branch_id,
        po.processed_by AS cashier_id, 'WALK_IN' AS customer_type, po.customer_id,
        po.payment_mode, po.tax_type, po.subtotal, po.discount_amount,
        po.vatable_sales, po.vat_amount, po.amount_tendered AS customer_payment, po.change_due,
        po.total, DATE(po.order_date) AS order_date, po.created_at, po.status
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

// Booking bill payments (security deposits and damage/loss charge payments are separate).
const V2_BOOKING_PAID_SQL = (b: string) => `(COALESCE((SELECT SUM(bp.amount) FROM payments bp
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
// ===== END StockNBook v2 read models (reports) =====

type Role = "owner" | "manager" | "staff";
type TokenPayload = jwt.JwtPayload & {
    store_id?: number | string;
    storeId?: number | string;
    branch_id?: number | string;
    branchId?: number | string;
    staff_id?: number | string;
    staffId?: number | string;
    manager_id?: number | string;
    managerId?: number | string;
    role?: string;
};

type DateRange = {
    startDate: string;
    endDate: string;
    label: string;
};

function asPositiveInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown) {
    return String(value ?? "").trim();
}

function isDate(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDate(value: Date) {
    return value.toISOString().slice(0, 10);
}

function defaultRange(): DateRange {
    const now = new Date();
    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );

    return {
        startDate: toIsoDate(start),
        endDate: toIsoDate(now),
        label: new Intl.DateTimeFormat("en-PH", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
        }).format(start),
    };
}

function resolveDateRange(searchParams: URLSearchParams): DateRange | null {
    const fallback = defaultRange();
    const startDate = asText(searchParams.get("startDate")) || fallback.startDate;
    const endDate = asText(searchParams.get("endDate")) || fallback.endDate;

    if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) {
        return null;
    }

    const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
    const days = Math.floor((end - start) / 86_400_000) + 1;

    if (days > 366) {
        return null;
    }

    const label = new Intl.DateTimeFormat("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });

    return {
        startDate,
        endDate,
        label:
            startDate === endDate
                ? label.format(new Date(`${startDate}T00:00:00.000Z`))
                : `${label.format(new Date(`${startDate}T00:00:00.000Z`))} – ${label.format(
                    new Date(`${endDate}T00:00:00.000Z`)
                )}`,
    };
}

function databaseConfig() {
    return {
        host: "127.0.0.1",
        user: "root",
        password: "BTA5EYVWLfWcebF",
        database: "stocknbook_v2",
        port: 3306,
    };
}

const reportsPool = mysql.createPool({
    ...databaseConfig(),
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
});

function jsonError(message: string, status: number) {
    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        { status }
    );
}

function getToken(request: NextRequest): TokenPayload {
    const authHeader = request.headers.get("Authorization") || "";

    if (!authHeader) {
        throw new Error("Missing Authorization header.");
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
        throw new Error("Missing authentication token.");
    }

    const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "stocknbook-secret-key"
    );

    if (!decoded || typeof decoded === "string") {
        throw new Error("Invalid authentication token.");
    }

    return decoded as TokenPayload;
}

async function ensureBranchBelongsToStore(
    connection: Connection,
    branchId: number,
    storeId: number
) {
    const [rows] = await connection.execute(
        `SELECT id, branch_name
         FROM branches
         WHERE id = ? AND store_id = ?
             LIMIT 1`,
        [branchId, storeId]
    );

    return (rows as Array<{ id: number; branch_name: string }>)[0] || null;
}

async function loadStoreName(
    connection: Connection,
    storeId: number
) {
    const [rows] = await connection.execute(
        `SELECT store_name
         FROM stores
         WHERE id = ?
             LIMIT 1`,
        [storeId]
    );

    const store = (
        rows as Array<{
            store_name?: string;
        }>
    )[0];

    return asText(store?.store_name) || "Store";
}

function getInventoryStatus(stock: number, alertLevel: number) {
    if (stock <= 0) return "Out of Stock";
    if (stock <= alertLevel) return "Low Stock";
    return "In Stock";
}

async function loadBranches(
    connection: Connection,
    storeId: number,
    branchId: number | null
) {
    let query = `
        SELECT id, branch_name, address, phone AS contact_number
        FROM branches
        WHERE store_id = ?
    `;
    const params: Array<number> = [storeId];

    if (branchId) {
        query += " AND id = ?";
        params.push(branchId);
    }

    query += " ORDER BY branch_name ASC";

    const [rows] = await connection.execute(query, params);

    return (rows as Array<Record<string, unknown>>).map((row) => ({
        id: Number(row.id),
        name: asText(row.branch_name),
        location: asText(row.address),
        contact: asText(row.contact_number),
    }));
}

async function loadInventory(
    connection: Connection,
    storeId: number,
    branchId: number | null
) {
    let query = `
        SELECT
            p.id AS product_id,
            bi.branch_id,
            p.name AS product_name,
            p.category,
            bi.quantity_on_hand AS inventory_stock,
            bi.reorder_level AS inventory_alert_level,
            bi.cost_price AS inventory_cost_price,
            bi.sales_price AS inventory_sales_price,
            p.has_variants,
            br.branch_name,
            bi.variant_id AS variant_id,
            pv.variant_values
        FROM ${V2_BRANCH_INVENTORY} bi
                 INNER JOIN ${V2_PRODUCTS} p
                            ON p.id = bi.product_id
                                AND p.store_id = bi.store_id
                                AND p.branch_id = bi.branch_id
                 LEFT JOIN branches br
                           ON br.id = bi.branch_id AND br.store_id = bi.store_id
                 LEFT JOIN ${V2_PRODUCT_VARIANTS} pv
                           ON pv.id = bi.variant_id AND pv.product_id = p.id
        WHERE bi.store_id = ?
          AND bi.status = 'active'
          AND p.deleted_at IS NULL
          AND (bi.variant_id IS NULL OR pv.deleted_at IS NULL)
    `;

    const params: Array<number> = [storeId];

    if (branchId) {
        query += " AND bi.branch_id = ?";
        params.push(branchId);
    }

    query += " ORDER BY br.branch_name ASC, p.name ASC, bi.variant_id ASC";

    const [rows] = await connection.execute(query, params);
    const grouped = new Map<string, Record<string, unknown>>();

    for (const rawRow of rows as Array<Record<string, unknown>>) {
        const id = String(rawRow.product_id);
        const product =
            grouped.get(id) ||
            {
                id,
                product: asText(rawRow.product_name) || "Unnamed Product",
                category: asText(rawRow.category) || "Uncategorized",
                branch: asText(rawRow.branch_name) || "Unassigned Branch",
                stock: asNumber(rawRow.inventory_stock),
                reorderLevel: asNumber(rawRow.inventory_alert_level),
                costPrice: asNumber(rawRow.inventory_cost_price),
                salesPrice: asNumber(rawRow.inventory_sales_price),
                variants: [] as Array<Record<string, unknown>>,
            };

        if (rawRow.variant_id) {
            const values = (() => {
                try {
                    return JSON.parse(asText(rawRow.variant_values) || "{}") as Record<
                        string,
                        unknown
                    >;
                } catch {
                    return {};
                }
            })();

            const variantName =
                Object.values(values)
                    .map((value) => asText(value))
                    .filter(Boolean)
                    .join(" / ") || "Variant";

            const variantStock = asNumber(rawRow.inventory_stock);
            const variantAlert = asNumber(rawRow.inventory_alert_level);

            (product.variants as Array<Record<string, unknown>>).push({
                id: String(rawRow.variant_id),
                name: variantName,
                stock: variantStock,
                reorderLevel: variantAlert,
                costPrice: asNumber(rawRow.inventory_cost_price),
                salesPrice: asNumber(rawRow.inventory_sales_price),
                status: getInventoryStatus(variantStock, variantAlert),
            });
        }

        grouped.set(id, product);
    }

    return Array.from(grouped.values()).map((product) => {
        const variants = product.variants as Array<Record<string, unknown>>;
        const hasVariants = variants.length > 0;

        const stock = hasVariants
            ? variants.reduce((sum, variant) => sum + asNumber(variant.stock), 0)
            : asNumber(product.stock);

        const reorderLevel = hasVariants
            ? variants.reduce(
                (sum, variant) => sum + asNumber(variant.reorderLevel),
                0
            )
            : asNumber(product.reorderLevel);

        const hasOut = variants.some(
            (variant) => asText(variant.status) === "Out of Stock"
        );
        const hasLow = variants.some(
            (variant) => asText(variant.status) === "Low Stock"
        );

        return {
            ...product,
            stock,
            reorderLevel,
            status: hasVariants
                ? hasOut
                    ? "Out of Stock"
                    : hasLow
                        ? "Low Stock"
                        : "In Stock"
                : getInventoryStatus(stock, reorderLevel),
            variants: hasVariants ? variants : undefined,
        };
    });
}


async function loadRestockHistory(
    connection: Connection,
    storeId: number,
    branchId: number | null,
    range: DateRange
) {
    // Stock-ins are the positive receiving movements in inventory_movements.
    let query = `
        SELECT
            rh.id,
            rh.branch_id,
            p.product_name,
            CASE WHEN v.is_default = 1 THEN NULL ELSE v.variant_name END AS variant_name,
            rh.quantity_before AS stock_before,
            rh.quantity_change AS quantity_added,
            rh.quantity_after AS current_stock,
            u.full_name AS received_by,
            CASE WHEN rh.reason LIKE 'Ref %: %'
                     THEN SUBSTRING(rh.reason, LOCATE(': ', rh.reason) + 2)
                 ELSE rh.reason END AS notes,
            DATE_FORMAT(rh.created_at, '%Y-%m-%d') AS restock_date,
            br.branch_name
        FROM inventory_movements rh
                 JOIN branch_inventory sbi ON sbi.id = rh.branch_inventory_id
                 JOIN product_variants v ON v.id = sbi.variant_id
                 JOIN products p ON p.id = v.product_id
                 LEFT JOIN users u ON u.id = rh.performed_by
                 LEFT JOIN branches br
                           ON br.id = rh.branch_id
                               AND br.store_id = rh.store_id
        WHERE rh.store_id = ?
          AND rh.quantity_change > 0
          AND rh.movement_type IN ('OPENING_STOCK','MANAGER_RECEIPT','STAFF_RECEIPT')
          AND rh.created_at >= CONCAT(?, ' 00:00:00')
          AND rh.created_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)
    `;

    const params: Array<number | string> = [
        storeId,
        range.startDate,
        range.endDate,
    ];

    if (branchId) {
        query += " AND rh.branch_id = ?";
        params.push(branchId);
    }

    query += " ORDER BY rh.created_at DESC, rh.id DESC";

    const [rows] = await connection.execute(query, params);

    return (rows as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        reference: `RST-${String(row.id).padStart(6, "0")}`,
        date: asText(row.restock_date),
        product: asText(row.product_name) || "Unnamed Product",
        variantName: asText(row.variant_name) || undefined,
        branch:
            asText(row.branch_name) ||
            (row.branch_id ? `Branch ${row.branch_id}` : "Unassigned Branch"),
        quantityAdded: asNumber(row.quantity_added),
        currentStock: asNumber(row.current_stock),
        stockBefore: asNumber(row.stock_before),
        receivedBy: asText(row.received_by) || "Not recorded",
        notes: asText(row.notes) || undefined,
    }));
}

async function loadSales(
    connection: Connection,
    storeId: number,
    branchId: number | null,
    range: DateRange
) {
    let query = `
        SELECT
            o.order_id,
            o.branch_id,
            br.branch_name,
            DATE_FORMAT(o.order_date, '%Y-%m-%d') AS order_date,
            COALESCE(o.total, 0) AS total,
            COALESCE(SUM(oi.quantity), 0) AS total_quantity,
            GROUP_CONCAT(
                    CONCAT(
                            COALESCE(oi.product_name, 'Product'),
                            ' × ',
                            COALESCE(oi.quantity, 0)
                    )
                        ORDER BY oi.id SEPARATOR ', '
            ) AS items_text
        FROM ${V2_POS_ORDERS} o
                 LEFT JOIN branches br
                           ON br.id = o.branch_id AND br.store_id = o.store_id
                 LEFT JOIN ${V2_POS_ORDER_ITEMS} oi
                           ON oi.order_id = o.order_id
        WHERE o.store_id = ?
          AND o.order_date BETWEEN ? AND ?
    `;

    const params: Array<number | string> = [
        storeId,
        range.startDate,
        range.endDate,
    ];

    if (branchId) {
        query += " AND o.branch_id = ?";
        params.push(branchId);
    }

    query += `
        GROUP BY
            o.order_id,
            o.branch_id,
            br.branch_name,
            o.order_date,
            o.total
        ORDER BY o.order_date DESC, o.order_id DESC
    `;

    const [rows] = await connection.execute(query, params);

    return (rows as Array<Record<string, unknown>>).map((row) => ({
        id: asText(row.order_id),
        reference: asText(row.order_id),
        date: asText(row.order_date),
        branch: asText(row.branch_name) || "Unassigned Branch",
        branchId: String(row.branch_id ?? ""),
        customer: "Walk-in Customer",
        product: asText(row.items_text) || "No items recorded",
        itemsText: asText(row.items_text) || "No items recorded",
        category: "",
        quantity: asNumber(row.total_quantity),
        amount: asNumber(row.total),
        revenueSource: "pos",
        statusLabel: "Completed",
        cashier: undefined,
    }));
}

function acceptedBookingStatus(status: string) {
    return ["confirmed", "preparing", "completed"].includes(
        status.trim().toLowerCase()
    );
}

async function loadBookings(
    connection: Connection,
    storeId: number,
    branchId: number | null,
    range: DateRange
) {
    let query = `
        SELECT
            b.id,
            b.branch_id,
            br.branch_name,
            b.booking_reference,
            b.name,
            b.phone,
            b.event_date,
            b.event_time,
            b.event_type,
            b.package_name,
            b.custom_order,
            b.venue,
            b.notes,
            b.status,
            b.agreed_price,
            b.package_price,
            b.payment_status,
            b.required_down_payment,
            b.amount_paid,
            b.balance,
            cu.full_name AS created_by_name
        FROM ${V2_BOOKINGS} b
                 LEFT JOIN users cu ON cu.id = b.created_by
                 LEFT JOIN branches br
                           ON br.id = b.branch_id AND br.store_id = b.store_id
        WHERE b.store_id = ?
          AND b.event_date BETWEEN ? AND ?
    `;

    const params: Array<number | string> = [
        storeId,
        range.startDate,
        range.endDate,
    ];

    if (branchId) {
        query += " AND b.branch_id = ?";
        params.push(branchId);
    }

    query += " ORDER BY b.event_date DESC, b.id DESC";

    const [rows] = await connection.execute(query, params);

    return (rows as Array<Record<string, unknown>>).map((row) => {
        const agreedPrice = asNumber(row.agreed_price);
        const packagePrice = asNumber(row.package_price);
        const amount = agreedPrice > 0 ? agreedPrice : packagePrice;

        return {
            id: String(row.id),
            reference: asText(row.booking_reference) || `BOOKING-${row.id}`,
            date: asText(row.event_date),
            eventDate: asText(row.event_date),
            scheduleTime: asText(row.event_time) || undefined,
            branch: asText(row.branch_name) || "Unassigned Branch",
            branchId: String(row.branch_id ?? ""),
            customer: asText(row.name) || "Customer",
            phone: asText(row.phone) || undefined,
            venue: asText(row.venue) || undefined,
            packageName:
                asText(row.package_name) ||
                asText(row.custom_order) ||
                "Custom / Unspecified",
            status: asText(row.status).toLowerCase() || "pending",
            statusLabel: asText(row.status) || "Pending",
            amount,
            amountPaid: asNumber(row.amount_paid),
            requiredDownPayment: asNumber(row.required_down_payment),
            balance: asNumber(row.balance),
            paymentStatus: asText(row.payment_status) || "unpaid",
            notes: asText(row.notes) || undefined,
            createdBy: asText(row.created_by_name) || undefined,
        };
    });
}

function bookingSummary(bookings: Array<Record<string, unknown>>) {
    const count = {
        pending: 0,
        confirmed: 0,
        preparing: 0,
        cancelled: 0,
        completed: 0,
    };

    for (const booking of bookings) {
        const status = asText(booking.status).toLowerCase() as keyof typeof count;
        if (status in count) {
            count[status] += 1;
        }
    }

    return {
        totalBookings: bookings.length,
        ...count,
    };
}

function bookingRevenue(bookings: Array<Record<string, unknown>>) {
    return bookings
        .filter((booking) => acceptedBookingStatus(asText(booking.status)))
        .reduce((sum, booking) => sum + asNumber(booking.amount), 0);
}

async function loadEmployeeActions(
    connection: Connection,
    storeId: number,
    branchId: number | null,
    range: DateRange
) {
    let query = `
        SELECT
            ea.id,
            ea.branch_id,
            ea.user_id AS employee_id,
            ea.user_name AS employee_name,
            ea.user_role AS employee_role,
            ea.module,
            ea.reference_number,
            ea.action,
            ea.entity_id AS reference_id,
            JSON_UNQUOTE(ea.details) AS details,
            br.branch_name,

            DATE_FORMAT(
                    ea.created_at,
                    '%Y-%m-%d'
            ) AS action_date,

            DATE_FORMAT(
                    ea.created_at,
                    '%H:%i:%s'
            ) AS action_time

        FROM employee_actions ea
                 LEFT JOIN branches br
                           ON br.id = ea.branch_id
                               AND br.store_id = ea.store_id

        WHERE ea.store_id = ?
          AND ea.created_at >= CONCAT(?, ' 00:00:00')
          AND ea.created_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)
    `;

    const params: Array<number | string> = [
        storeId,
        range.startDate,
        range.endDate,
    ];

    if (branchId) {
        query += `
            AND ea.branch_id = ?
        `;

        params.push(branchId);
    }

    query += `
        ORDER BY ea.created_at DESC
    `;


    const [rows] = await connection.execute(query, params);


    return (rows as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),

        employeeName:
            asText(row.employee_name) || "Unknown",

        employeeRole:
            asText(row.employee_role) || "Staff",

        employeeId: asPositiveInteger(row.employee_id),

        action:
            asText(row.action),

        module:
            asText(row.module),

        referenceNumber:
            asText(row.reference_number) || "-",

        referenceId:
            asText(row.reference_id) || "-",

        details:
            asText(row.details),

        branch:
            asText(row.branch_name) ||
            (row.branch_id ? `Branch ${row.branch_id}` : "Unassigned Branch"),

        branchId:
            row.branch_id != null ? String(row.branch_id) : undefined,

        date:
            asText(row.action_date),

        time:
            asText(row.action_time),
    }));
}

// An audit request must also honor the existing Reports permission, not
// merely a client-side sidebar check. Account IDs and branches come from JWT.
async function canReadAuditLogs(
    connection: Connection, role: Role, storeId: number,
    branchId: number | null, employeeId: number | null
) {
    if (role === "owner") return true;
    if (!branchId || !employeeId) return false;
    const [rows] = await connection.execute(
        `SELECT permissions FROM users
         WHERE id = ? AND store_id = ? AND branch_id = ? AND role = ?
           AND LOWER(status) = 'active' LIMIT 1`,
        [employeeId, storeId, branchId, role]
    );
    const account = (rows as Array<{ permissions?: unknown }>)[0];
    if (!account) return false;
    let permissions = account.permissions;
    if (typeof permissions === "string") {
        try { permissions = JSON.parse(permissions); } catch { return false; }
    }
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return false;
    const values = permissions as Record<string, unknown>;
    const access = values.reports_access ?? values.reports;
    return access === true || access === 1 || access === "true" ||
        access === "1" || access === "view" || access === "view_only" ||
        access === "viewOnly" || access === "full";
}

// Audit Logs: employees only. Restrict scope in SQL, not in the browser.
// Owner: managers and staff of this store. Manager: staff in their token branch.
// Staff (if granted the existing Reports permission): only their own actions.
// Preserve the original Reports employee_actions data source, which also serves
// the previous Employee Actions History. Filter it on the server using the
// authenticated store / branch and role, never client-provided role values.
function normalizeAuditModule(value: string) {
    const moduleName = asText(value);
    const normalized = moduleName.toLowerCase();
    if (normalized.startsWith("book")) return "Bookings";
    if (normalized.startsWith("invent") || normalized.includes("stock") || normalized.startsWith("restock")) return "Inventory";
    if (normalized.startsWith("package")) return "Packages";
    if (normalized.startsWith("sales") || normalized.includes("pos")) return "Sales / POS";
    return moduleName || "Other";
}

const AUDIT_MODULE_OPTIONS = ["Bookings", "Inventory", "Sales / POS", "Packages"];

async function loadAuditLogs(
    connection: Connection,
    storeId: number,
    role: Role,
    branchId: number | null,
    staffId: number | null,
    range: DateRange,
    searchParams: URLSearchParams
) {
    // This is the same query used by the original employee actions screen.
    // Managers / staff are restricted to their JWT branch in the caller.
    const sourceActions = await loadEmployeeActions(connection, storeId, branchId, range);
    const moduleFilter = normalizeAuditModule(asText(searchParams.get("module")).slice(0, 100));
    const hasModuleFilter = Boolean(asText(searchParams.get("module")));
    const search = asText(searchParams.get("search")).toLowerCase().slice(0, 120);

    const matchingActions = sourceActions.filter((record) => {
        const employeeRole = record.employeeRole.trim().toLowerCase();
        // Do not expose owner actions, even when the records came from the
        // unrestricted legacy report. Only manager + staff for owner;
        // only staff for manager; only self for staff.
        const isManagerAction = employeeRole === "manager" || employeeRole.endsWith(" manager");
        const isStaffAction = employeeRole === "staff" || employeeRole.endsWith(" staff");
        if (role === "owner" && !isManagerAction && !isStaffAction) return false;
        if (role === "manager" && !isStaffAction) return false;
        if (role === "staff" && (!isStaffAction || record.employeeId !== staffId)) return false;

        const displayModule = normalizeAuditModule(record.module);
        if (hasModuleFilter && displayModule !== moduleFilter) return false;
        if (!search) return true;
        return [
            record.employeeName, record.employeeRole, record.action,
            record.details, record.module, displayModule, record.referenceNumber,
            record.referenceId, record.branch,
        ].some((value) => asText(value).toLowerCase().includes(search));
    });

    const pageSize = 25;
    const requestedPage = Number(searchParams.get("page") || "1");
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, 100000) : 1;
    const total = matchingActions.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageRows = matchingActions.slice((safePage - 1) * pageSize, safePage * pageSize);

    // Always load the store's real branches, not just branches that currently
    // have actions in the selected date range.
    const branches = role === "owner"
        ? (await loadBranches(connection, storeId, null)).map((branch) => ({
            id: Number(branch.id), name: asText(branch.name),
        }))
        : [];

    const logs = pageRows.map((record) => ({
        id: record.id,
        employeeName: record.employeeName,
        employeeRole: record.employeeRole,
        action: record.action || "Recorded action",
        details: record.details,
        module: normalizeAuditModule(record.module),
        reference: record.referenceNumber !== "-" ? record.referenceNumber : record.referenceId !== "-" ? record.referenceId : "",
        branch: record.branch,
        date: record.date,
        time: record.time,
    }));

    return { logs, total, page: safePage, pageSize, totalPages, modules: AUDIT_MODULE_OPTIONS, branches };
}

async function loadForecastReport(
    authHeader: string,
    branchId: number | null
) {
    try {
        const event = {
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
            },
            body: JSON.stringify({
                action: "get_inventory_forecast",
                ...(branchId ? { branch_id: branchId } : {}),
            }),
            requestContext: {
                http: {
                    method: "POST",
                },
            },
        };

        const response = await forecastingHandler(event);

        if ((response.statusCode || 200) < 200 || (response.statusCode || 200) >= 300) {
            return { forecasting: [], seasonalInsights: [] };
        }

        let payload: Record<string, unknown> = {};

        try {
            payload = response.body
                ? (JSON.parse(response.body) as Record<string, unknown>)
                : {};
        } catch {
            return { forecasting: [], seasonalInsights: [] };
        }

        const items = Array.isArray(payload.items) ? payload.items : [];

        const forecasting = items.slice(0, 40).map((value, index) => {
            const item = value as Record<string, unknown>;
            const timeAlert = asText(item.timeAlert);
            const status = asText(item.status);
            const riskLevel =
                timeAlert.includes("STOCKOUT") || timeAlert.includes("REORDER")
                    ? "High"
                    : status === "LOW" || status === "RISK"
                        ? "Medium"
                        : "Low";

            return {
                id: asText(item.id) || `forecast-${index + 1}`,
                item: asText(item.itemName) || "Unnamed Item",
                type: "Product",
                currentValue: `${asNumber(item.onHandQuantity)} units`,
                forecastedDemand: `${asNumber(item.forecastedDemand)} units / 30 days`,
                suggestedRestock: `${asNumber(item.suggestedRestock)} units`,
                riskLevel,
            };
        });

        const seasonalInsights = items
            .map((value) => value as Record<string, unknown>)
            .filter((item) => {
                const seasonality = item.seasonality as Record<string, unknown> | undefined;
                const status = asText(seasonality?.status);
                return status && status !== "NO_HISTORY" && status !== "LIMITED_HISTORY";
            })
            .slice(0, 12)
            .map((item) => {
                const seasonality = item.seasonality as Record<string, unknown> | undefined;
                return {
                    period: asText(item.itemName) || "Product",
                    trend: asText(seasonality?.status) || "Seasonal signal",
                    recommendation:
                        asText(seasonality?.recommendation) ||
                        `Review stock for ${asText(item.itemName) || "this product"} based on its POS sales pattern.`,
                };
            });

        return { forecasting, seasonalInsights };
    } catch {
        // Keep the Reports route usable even when local forecasting is unavailable.
        return { forecasting: [], seasonalInsights: [] };
    }
}

export async function GET(request: NextRequest) {
    let connection: PoolConnection | null = null;

    try {
        const range = resolveDateRange(new URL(request.url).searchParams);

        if (!range) {
            return jsonError(
                "Choose a valid reporting range of up to 366 days.",
                400
            );
        }

        const authHeader = request.headers.get("Authorization") || "";
        const token = getToken(request);
        const storeId = asPositiveInteger(token.store_id ?? token.storeId);
        const role = asText(token.role).toLowerCase() as Role;
        const tokenBranchId = asPositiveInteger(token.branch_id ?? token.branchId);

        if (!storeId || !["owner", "manager", "staff"].includes(role)) {
            return jsonError("Invalid store or role in authentication token.", 401);
        }

        const searchParams = new URL(request.url).searchParams;
        const requestedBranchId = asPositiveInteger(
            searchParams.get("branch_id") || searchParams.get("branchId")
        );
        const scope = asText(searchParams.get("scope")).toLowerCase();

        connection = await reportsPool.getConnection();

        let branchId: number | null = null;

        if (role === "manager" || role === "staff") {
            if (!tokenBranchId) {
                return jsonError("Your account has no assigned branch.", 400);
            }

            branchId = tokenBranchId;
        } else if (requestedBranchId) {
            const branch = await ensureBranchBelongsToStore(
                connection,
                requestedBranchId,
                storeId
            );

            if (!branch) {
                return jsonError("Invalid branch for this store.", 400);
            }

            branchId = requestedBranchId;
        }

        if (scope === "audit_logs" || scope === "audit-logs") {
            const staffId = asPositiveInteger(token.staff_id ?? token.staffId);
            const managerId = asPositiveInteger(token.manager_id ?? token.managerId);
            const employeeId = role === "manager" ? managerId : staffId;
            if (!(await canReadAuditLogs(connection, role, storeId, branchId, employeeId))) {
                return jsonError("You do not have permission to view these audit logs.", 403);
            }
            const audit = await loadAuditLogs(
                connection, storeId, role, branchId, staffId, range, searchParams
            );
            return NextResponse.json({ success: true, data: audit });
        }

        // Staff dashboard only needs today's employee activity. Allow it to
        // request that small slice without loading inventory, sales, bookings,
        // restock history, and forecasting from the full Reports workspace.
        if (scope === "employee_actions" || scope === "employee-actions") {
            const employeeActions = await loadEmployeeActions(
                connection,
                storeId,
                branchId,
                range
            );

            return NextResponse.json({
                success: true,
                data: { employeeActions },
            });
        }

        const [
            storeName,
            branches,
            inventoryList,
            salesList,
            bookingList,
            restockHistory,
            employeeActions,
            forecastReport,
        ] = await Promise.all([
            loadStoreName(connection, storeId),
            loadBranches(connection, storeId, branchId),
            loadInventory(connection, storeId, branchId),
            loadSales(connection, storeId, branchId, range),
            loadBookings(connection, storeId, branchId, range),
            loadRestockHistory(connection, storeId, branchId, range),

            loadEmployeeActions(
                connection,
                storeId,
                branchId,
                range
            ),

            loadForecastReport(authHeader, branchId),
        ]);

        const totalSales = salesList.reduce(
            (sum, sale) => sum + asNumber(sale.amount),
            0
        );

        const branchName =
            branchId && branches.length === 1
                ? asText(branches[0].name)
                : "All Branches";

        const lowStockItems = inventoryList.filter(
            (item) => asText(item.status) === "Low Stock"
        );

        const outOfStockItems = inventoryList.filter(
            (item) => asText(item.status) === "Out of Stock"
        );

        return NextResponse.json({
            success: true,
            data: {
                branch: branchName,
                storeName,
                monthLabel: range.label,
                isSampleData: false,
                dateRange: {
                    startDate: range.startDate,
                    endDate: range.endDate,
                },
                access: {
                    role,
                    assignedBranch: branchName,
                    branchLocked: role !== "owner",
                },
                branchOptions: branches.map((branch) => asText(branch.name)),
                summary: {
                    grossSales: totalSales,
                    bookingRevenue: bookingRevenue(bookingList),
                    totalTransactions: salesList.length,
                    averageOrderValue:
                        salesList.length > 0
                            ? Math.round(totalSales / salesList.length)
                            : 0,
                },
                bookingSummary: bookingSummary(bookingList),
                inventoryList,
                lowStockItems,
                outOfStockItems,
                restockHistory,
                salesList,
                bookingList,

                employeeActions,

                forecasting: forecastReport.forecasting,
                seasonalInsights: forecastReport.seasonalInsights,

                staffActivities: [],
            },
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to load reports.";

        if (
            message.includes("Authorization") ||
            message.includes("authentication") ||
            message.includes("token")
        ) {
            return jsonError(message, 401);
        }

        console.error("Reports API error:", error);
        return jsonError(message, 500);
    } finally {
        if (connection) {
            connection.release();
        }
    }
}