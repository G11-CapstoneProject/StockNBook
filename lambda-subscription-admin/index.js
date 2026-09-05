const mysql = require("mysql2/promise");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";
const PAYMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED"];
const SUBSCRIPTION_STATUSES = ["ACTIVE", "EXPIRING", "EXPIRED", "CANCELLED"];
const CHANGE_TYPES = ["upgrade", "downgrade", "renewal", "cancellation", "admin_override"];
const REJECTION_REASONS = [
    "Payment not found",
    "Incorrect amount",
    "Invalid reference number",
    "Duplicate reference number",
    "Unclear payment proof",
    "Payment details do not match",
    "Other",
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const dbConfig = {
    host: "127.0.0.1",
    user: "root",
    password: "BTA5EYVWLfWcebF",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function response(event, statusCode, body) {
    const origin = event.headers?.origin || event.headers?.Origin || "";
    const allowOrigin = allowedOrigins.includes("*")
        ? "*"
        : allowedOrigins.includes(origin)
            ? origin
            : allowedOrigins[0] || "*";

    return {
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": allowOrigin,
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "OPTIONS, POST",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    };
}

function getHttpMethod(event) {
    return (
        event.requestContext?.http?.method ||
        event.httpMethod ||
        "POST"
    ).toUpperCase();
}

function parseBody(event) {
    if (!event.body) return {};

    const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;

    try {
        return JSON.parse(rawBody);
    } catch {
        throw httpError(400, "Invalid JSON request body.");
    }
}

function text(value, maxLength = 500) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function requiredText(value, label, maxLength = 500) {
    const result = text(value, maxLength);
    if (!result) throw httpError(400, `${label} is required.`);
    return result;
}

function positiveId(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw httpError(400, `${label} must be a valid positive number.`);
    }
    return parsed;
}

function optionalId(value) {
    if (value === null || value === undefined || value === "") return null;
    return positiveId(value, "ID");
}

function normalizeStatus(value) {
    return String(value || "").trim().toUpperCase();
}

function normalizeDate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw httpError(400, "Invalid date value.");
    return date.toISOString().slice(0, 10);
}

function addMonths(dateOnly, months) {
    const [year, month, day] = String(dateOnly).split("-").map(Number);
    const index = month - 1 + Number(months);
    const targetYear = year + Math.floor(index / 12);
    const targetMonth = ((index % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const targetDay = Math.min(day, lastDay);
    return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10);
}

function addDays(dateOnly, days) {
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + Number(days));
    return date.toISOString().slice(0, 10);
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function moneyCents(value) {
    return Math.round(Number(value || 0) * 100);
}

function displaySubscriptionStatus(status, expiresAt) {
    const normalized = normalizeStatus(status);
    if (normalized === "CANCELLED") return "CANCELLED";
    if (!expiresAt) return normalized || "ACTIVE";

    const expiry = normalizeDate(expiresAt);
    const now = today();
    if (expiry < now) return "EXPIRED";
    if (expiry <= addDays(now, 7)) return "EXPIRING";
    return "ACTIVE";
}

function lowerStatus(status) {
    return normalizeStatus(status).toLowerCase();
}

function changeTypeForPlanChange(oldPlanId, newPlanId) {
    if (!oldPlanId) return "upgrade";
    if (Number(newPlanId) === Number(oldPlanId)) return "renewal";
    return Number(newPlanId) > Number(oldPlanId) ? "upgrade" : "downgrade";
}

function getBearerToken(headers = {}) {
    const value = headers.Authorization || headers.authorization || "";
    return value.replace(/^Bearer\s+/i, "").trim();
}

async function requirePlatformAdmin(event, connection) {
    const token = getBearerToken(event.headers);
    if (!token) throw httpError(401, "Missing authorization token.");

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        throw httpError(401, "Invalid or expired token.");
    }

    if (payload.role !== "PLATFORM_ADMIN") {
        throw httpError(403, "Platform Administrator access is required.");
    }

    const adminId = positiveId(
        payload.platform_admin_id || payload.platformAdminId || payload.user_id || payload.id,
        "Platform Administrator ID"
    );

    const [rows] = await connection.execute(
        `SELECT platform_admin_id, full_name, email, role, status, is_active
         FROM platform_admins
         WHERE platform_admin_id = ?
             LIMIT 1`,
        [adminId]
    );

    const admin = rows[0];
    const activeFlag = admin ? Number(admin.is_active) === 1 : false;
    const statusActive =
        admin ? String(admin.status || "").trim().toLowerCase() === "active" : false;
    const roleIsPlatformAdmin =
        admin ? String(admin.role || "").trim().toLowerCase() === "platform_admin" : false;

    if (!admin || !activeFlag || !statusActive || !roleIsPlatformAdmin) {
        throw httpError(403, "Platform Administrator access is required.");
    }

    return admin;
}

async function getPaymentColumns(connection) {
    const [rows] = await connection.query("SHOW COLUMNS FROM payments");
    const names = new Set(rows.map((row) => row.Field));

    const pick = (candidates, required = true) => {
        const found = candidates.find((candidate) => names.has(candidate));
        if (!found && required) {
            throw new Error(`payments table is missing a required column. Expected one of: ${candidates.join(", ")}`);
        }
        return found || null;
    };

    return {
        id: pick(["id", "payment_id"]),
        storeId: pick(["store_id"]),
        planId: pick(["plan_id", "requested_plan_id"]),
        amount: pick(["amount", "amount_remitted", "amount_submitted"]),
        reference: pick(["reference_no", "reference_number", "gcash_reference_no", "gcash_reference"]),
        receipt: pick(["receipt_url", "proof_file_url", "receipt_file_url"], false),
        status: pick(["status"]),
        reviewer: pick(["reviewed_by_admin_id", "verified_by_admin_id", "reviewing_admin_id"], false),
        createdAt: pick(["created_at", "submitted_at", "payment_date"], false),
        reviewedAt: pick(["reviewed_at", "verified_at"], false),
    };
}

async function listPaymentSubmissions(connection, status, search) {
    const c = await getPaymentColumns(connection);
    const filters = [];
    const values = [];
    const requestedStatus = String(status || "PENDING").toUpperCase();

    if (requestedStatus !== "ALL") {
        if (!PAYMENT_STATUSES.includes(requestedStatus)) throw httpError(400, "Invalid payment status filter.");
        filters.push(`UPPER(p.${c.status}) = ?`);
        values.push(requestedStatus);
    }

    const cleanSearch = text(search, 120);
    if (cleanSearch) {
        const like = `%${cleanSearch}%`;
        filters.push(`(s.store_name LIKE ? OR s.owner_name LIKE ? OR s.email LIKE ? OR p.${c.reference} LIKE ?)`);
        values.push(like, like, like, like);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const createdSelect = c.createdAt ? `p.${c.createdAt}` : "NULL";
    const receiptSelect = c.receipt ? `p.${c.receipt}` : "NULL";
    const reviewerSelect = c.reviewer ? `p.${c.reviewer}` : "NULL";
    const reviewedSelect = c.reviewedAt ? `p.${c.reviewedAt}` : "NULL";

    const [rows] = await connection.execute(
        `SELECT
             p.${c.id} AS payment_id,
             p.${c.storeId} AS store_id,
             p.${c.planId} AS requested_plan_id,
             p.${c.amount} AS amount_submitted,
             p.${c.reference} AS reference_number,
             ${receiptSelect} AS receipt_url,
             p.${c.status} AS raw_status,
             ${createdSelect} AS submitted_at,
             ${reviewedSelect} AS reviewed_at,
             ${reviewerSelect} AS reviewed_by_admin_id,
             s.store_name,
             s.owner_name,
             s.email AS owner_email,
             pl.name AS requested_plan_name,
             pl.price AS plan_price
         FROM payments p
                  INNER JOIN stores s ON s.id = p.${c.storeId}
                  LEFT JOIN plans pl ON pl.id = p.${c.planId}
             ${where}
         ORDER BY
             CASE UPPER(p.${c.status}) WHEN 'PENDING' THEN 1 WHEN 'APPROVED' THEN 2 WHEN 'REJECTED' THEN 3 ELSE 4 END,
        ${createdSelect} DESC,
        p.${c.id} DESC`,
        values
    );

    return rows.map((row) => ({
        payment_submission_id: Number(row.payment_id),
        business_id: Number(row.store_id),
        store_id: Number(row.store_id),
        store_name_snapshot: row.store_name,
        owner_name_snapshot: row.owner_name,
        owner_email: row.owner_email,
        business_code_snapshot: null,
        current_plan_id: null,
        requested_plan_id: row.requested_plan_id == null ? null : Number(row.requested_plan_id),
        current_plan_name_snapshot: null,
        requested_plan_name_snapshot: row.requested_plan_name || "Unknown Plan",
        required_amount: Number(row.plan_price || 0),
        amount_submitted: Number(row.amount_submitted || 0),
        reference_number: row.reference_number,
        payment_date: row.submitted_at,
        proof_file_url: row.receipt_url,
        status: normalizeStatus(row.raw_status),
        submitted_at: row.submitted_at,
        verified_at: row.reviewed_at,
        verified_by: null,
        rejection_reason: null,
        rejection_explanation: null,
        billing_period: "MONTHLY",
    }));
}

async function getPaymentSubmission(connection, paymentId) {
    const c = await getPaymentColumns(connection);
    const createdSelect = c.createdAt ? `p.${c.createdAt}` : "NULL";
    const receiptSelect = c.receipt ? `p.${c.receipt}` : "NULL";
    const reviewerSelect = c.reviewer ? `p.${c.reviewer}` : "NULL";
    const reviewedSelect = c.reviewedAt ? `p.${c.reviewedAt}` : "NULL";

    const [rows] = await connection.execute(
        `SELECT
             p.${c.id} AS payment_id,
             p.${c.storeId} AS store_id,
             p.${c.planId} AS requested_plan_id,
             p.${c.amount} AS amount_submitted,
             p.${c.reference} AS reference_number,
             ${receiptSelect} AS receipt_url,
             p.${c.status} AS raw_status,
             ${createdSelect} AS submitted_at,
             ${reviewedSelect} AS reviewed_at,
             ${reviewerSelect} AS reviewed_by_admin_id,
             s.store_name,
             s.owner_name,
             s.email AS owner_email,
             pl.name AS requested_plan_name,
             pl.price AS plan_price,
             sub.id AS subscription_id,
             sub.status AS subscription_status,
             sub.started_at,
             sub.expires_at,
             cur.name AS current_plan_name,
             cur.id AS current_plan_id
         FROM payments p
                  INNER JOIN stores s ON s.id = p.${c.storeId}
                  LEFT JOIN plans pl ON pl.id = p.${c.planId}
                  LEFT JOIN subscriptions sub ON sub.store_id = s.id
                  LEFT JOIN plans cur ON cur.id = sub.plan_id
         WHERE p.${c.id} = ?
             LIMIT 1`,
        [paymentId]
    );

    if (!rows[0]) throw httpError(404, "Payment not found.");
    const row = rows[0];

    return {
        payment_submission_id: Number(row.payment_id),
        business_id: Number(row.store_id),
        store_id: Number(row.store_id),
        store_name_snapshot: row.store_name,
        owner_name_snapshot: row.owner_name,
        owner_email: row.owner_email,
        requested_plan_id: Number(row.requested_plan_id),
        requested_plan_name_snapshot: row.requested_plan_name || "Unknown Plan",
        required_amount: Number(row.plan_price || 0),
        amount_submitted: Number(row.amount_submitted || 0),
        reference_number: row.reference_number,
        proof_file_url: row.receipt_url,
        status: normalizeStatus(row.raw_status),
        submitted_at: row.submitted_at,
        verified_at: row.reviewed_at,
        verified_by_admin_id: row.reviewed_by_admin_id,
        current_plan_id: row.current_plan_id,
        current_plan_name_snapshot: row.current_plan_name,
        subscription_id: row.subscription_id == null ? null : Number(row.subscription_id),
        subscription_status: row.subscription_status ? displaySubscriptionStatus(row.subscription_status, row.expires_at) : null,
        start_date: row.started_at,
        expiration_date: row.expires_at,
        billing_period: "MONTHLY",
    };
}

async function getSubscriptionSummary(connection) {
    const c = await getPaymentColumns(connection);
    const [paymentRows] = await connection.execute(
        `SELECT
             SUM(CASE WHEN UPPER(${c.status}) = 'PENDING' THEN 1 ELSE 0 END) AS pending_verification,
             SUM(CASE WHEN UPPER(${c.status}) = 'APPROVED' THEN 1 ELSE 0 END) AS approved_payments,
             SUM(CASE WHEN UPPER(${c.status}) = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_payments
         FROM payments`
    );

    const [subscriptionRows] = await connection.execute(
        `SELECT
             SUM(CASE WHEN LOWER(status) <> 'cancelled' AND expires_at >= CURDATE() THEN 1 ELSE 0 END) AS active_subscriptions,
             SUM(CASE WHEN LOWER(status) <> 'cancelled' AND expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS expiring_soon,
             SUM(CASE WHEN LOWER(status) = 'expired' OR (LOWER(status) = 'active' AND expires_at < CURDATE()) THEN 1 ELSE 0 END) AS expired_subscriptions
         FROM subscriptions`
    );

    return {
        pending_verification: Number(paymentRows[0]?.pending_verification || 0),
        active_subscriptions: Number(subscriptionRows[0]?.active_subscriptions || 0),
        expiring_soon: Number(subscriptionRows[0]?.expiring_soon || 0),
        expired_subscriptions: Number(subscriptionRows[0]?.expired_subscriptions || 0),
        approved_payments: Number(paymentRows[0]?.approved_payments || 0),
        rejected_payments: Number(paymentRows[0]?.rejected_payments || 0),
    };
}

async function listBusinesses(connection, search) {
    const c = await getPaymentColumns(connection);
    const values = [];
    let where = "";
    const cleanSearch = text(search, 120);

    if (cleanSearch) {
        const like = `%${cleanSearch}%`;
        where = `WHERE (s.store_name LIKE ? OR s.owner_name LIKE ? OR s.email LIKE ?)`;
        values.push(like, like, like);
    }

    const [rows] = await connection.execute(
        `SELECT
             s.id AS business_id,
             s.store_name,
             s.owner_name,
             s.email AS owner_email,
             sub.id AS subscription_id,
             sub.status AS raw_subscription_status,
             sub.started_at,
             sub.expires_at,
             sub.auto_renew,
             pl.id AS plan_id,
             pl.name AS plan_name,
             COALESCE((SELECT SUM(p2.${c.amount}) FROM payments p2 WHERE p2.${c.storeId} = s.id AND UPPER(p2.${c.status}) = 'APPROVED'), 0) AS lifetime_paid,
             (SELECT COUNT(*) FROM products prod WHERE prod.store_id = s.id) AS inventory_item_count
         FROM stores s
                  LEFT JOIN subscriptions sub ON sub.store_id = s.id
                  LEFT JOIN plans pl ON pl.id = sub.plan_id
             ${where}
         ORDER BY s.store_name ASC`,
        values
    );

    return rows.map((row) => ({
        business_id: Number(row.business_id),
        store_id: Number(row.business_id),
        store_name_snapshot: row.store_name,
        owner_name_snapshot: row.owner_name,
        owner_email: row.owner_email,
        business_code_snapshot: null,
        store_status: String(row.store_status || "").toUpperCase(),
        subscription_id: row.subscription_id == null ? null : Number(row.subscription_id),
        subscription_status: row.subscription_id == null ? null : displaySubscriptionStatus(row.raw_subscription_status, row.expires_at),
        start_date: row.started_at,
        expiration_date: row.expires_at,
        auto_renew: Boolean(row.auto_renew),
        plan_id: row.plan_id == null ? null : Number(row.plan_id),
        plan_name: row.plan_name,
        latest_payment_status: null,
        latest_reference_number: null,
        verified_at: null,
        verified_by: null,
        lifetime_paid: Number(row.lifetime_paid || 0),
    }));
}

async function listSubscriptions(connection, search, statusFilter) {
    const values = [];
    const filters = [];
    const cleanSearch = text(search, 120);

    if (cleanSearch) {
        const like = `%${cleanSearch}%`;
        filters.push("(s.store_name LIKE ? OR s.owner_name LIKE ? OR s.email LIKE ?)");
        values.push(like, like, like);
    }

    const status = String(statusFilter || "ALL").toUpperCase();
    if (status !== "ALL") {
        if (!SUBSCRIPTION_STATUSES.includes(status)) throw httpError(400, "Invalid subscription status filter.");
        if (status === "EXPIRED") {
            filters.push("(LOWER(sub.status) = 'expired' OR (LOWER(sub.status) = 'active' AND sub.expires_at < CURDATE()))");
        } else if (status === "EXPIRING") {
            filters.push("LOWER(sub.status) <> 'cancelled' AND sub.expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)");
        } else {
            filters.push("LOWER(sub.status) = ?");
            values.push(status.toLowerCase());
        }
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const [rows] = await connection.execute(
        `SELECT
             sub.id AS subscription_id,
             sub.store_id,
             sub.plan_id,
             sub.status AS raw_status,
             sub.auto_renew,
             sub.started_at,
             sub.expires_at,
             sub.created_at,
             s.store_name,
             s.owner_name,
             s.email AS owner_email,
             pl.name AS plan_name,
             pl.price AS plan_price,
             (SELECT COUNT(*) FROM subscription_history sh WHERE sh.subscription_id = sub.id) AS history_count
         FROM subscriptions sub
                  INNER JOIN stores s ON s.id = sub.store_id
                  INNER JOIN plans pl ON pl.id = sub.plan_id
             ${where}
         ORDER BY sub.expires_at ASC, s.store_name ASC`,
        values
    );

    return rows.map((row) => ({
        subscription_id: Number(row.subscription_id),
        business_id: Number(row.store_id),
        store_id: Number(row.store_id),
        store_name: row.store_name,
        owner_name: row.owner_name,
        owner_email: row.owner_email,
        plan_id: Number(row.plan_id),
        plan_name: row.plan_name,
        plan_price: Number(row.plan_price || 0),
        status: displaySubscriptionStatus(row.raw_status, row.expires_at),
        auto_renew: Boolean(row.auto_renew),
        started_at: row.started_at,
        expires_at: row.expires_at,
        created_at: row.created_at,
        history_count: Number(row.history_count || 0),
        store_status: String(row.store_status || "").toUpperCase(),
    }));
}

async function getSubscriptionHistory(connection, subscriptionId) {
    const [rows] = await connection.execute(
        `SELECT
             sh.id,
             sh.subscription_id,
             sh.store_id,
             sh.old_plan_id,
             old_plan.name AS old_plan_name,
             sh.new_plan_id,
             new_plan.name AS new_plan_name,
             sh.change_type,
             sh.changed_by,
             pa.full_name AS changed_by_name,
             sh.created_at
         FROM subscription_history sh
                  LEFT JOIN plans old_plan ON old_plan.id = sh.old_plan_id
                  LEFT JOIN plans new_plan ON new_plan.id = sh.new_plan_id
                  LEFT JOIN platform_admins pa ON pa.platform_admin_id = sh.changed_by
         WHERE sh.subscription_id = ?
         ORDER BY sh.created_at DESC, sh.id DESC`,
        [subscriptionId]
    );
    return rows.map((row) => ({
        id: Number(row.id),
        subscription_id: Number(row.subscription_id),
        store_id: Number(row.store_id),
        old_plan_id: row.old_plan_id == null ? null : Number(row.old_plan_id),
        old_plan_name: row.old_plan_name || "—",
        new_plan_id: row.new_plan_id == null ? null : Number(row.new_plan_id),
        new_plan_name: row.new_plan_name || "—",
        change_type: row.change_type,
        changed_by: row.changed_by == null ? null : Number(row.changed_by),
        changed_by_name: row.changed_by_name || "System",
        created_at: row.created_at,
    }));
}

async function listAuditLogs(connection, businessId) {
    const values = [];
    const where = businessId ? "WHERE sal.business_id = ?" : "";
    if (businessId) values.push(positiveId(businessId, "business_id"));

    const [rows] = await connection.execute(
        `SELECT
             sal.audit_log_id,
             sal.business_id,
             sal.subscription_id,
             sal.payment_submission_id,
             sal.action,
             sal.previous_status,
             sal.new_status,
             sal.performed_by_admin_id,
             sal.reason,
             sal.created_at,
             pa.full_name AS performed_by
         FROM subscription_audit_logs sal
                  LEFT JOIN platform_admins pa ON pa.platform_admin_id = sal.performed_by_admin_id
             ${where}
         ORDER BY sal.created_at DESC, sal.audit_log_id DESC
             LIMIT 200`,
        values
    );

    return rows.map((row) => ({
        audit_log_id: Number(row.audit_log_id),
        business_id: Number(row.business_id),
        subscription_id: row.subscription_id == null ? null : Number(row.subscription_id),
        payment_submission_id: row.payment_submission_id == null ? null : Number(row.payment_submission_id),
        action: row.action,
        previous_status: row.previous_status,
        new_status: row.new_status,
        reason: row.reason,
        created_at: row.created_at,
        performed_by: row.performed_by,
    }));
}

async function getPublicPlans() {
    const [rows] = await pool.execute(
        `SELECT
             p.id,
             p.name,
             p.price,
             p.max_inventory,
             p.max_bookings,
             p.max_staff,
             p.max_branches,
             p.has_low_stock_alerts,
             p.has_analytics,
             p.has_forecasting,
             p.has_multi_store
         FROM plans p
         WHERE p.is_archived = 0
         ORDER BY p.price ASC, p.id ASC`
    );

    return rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        price: Number(row.price || 0),
        max_inventory: row.max_inventory == null || Number(row.max_inventory) === 0 ? null : Number(row.max_inventory),
        max_bookings: row.max_bookings == null || Number(row.max_bookings) === 0 ? null : Number(row.max_bookings),
        max_staff: row.max_staff == null || Number(row.max_staff) === 0 ? null : Number(row.max_staff),
        max_branches: row.max_branches == null || Number(row.max_branches) === 0 ? null : Number(row.max_branches),
        has_low_stock_alerts: Boolean(row.has_low_stock_alerts),
        has_analytics: Boolean(row.has_analytics),
        has_forecasting: Boolean(row.has_forecasting),
        has_multi_store: Boolean(row.has_multi_store),
    }));
}

async function getPlans(connection) {
    const [rows] = await connection.execute(
        `SELECT
             p.id,
             p.name,
             p.price,
             p.max_inventory,
             p.max_bookings,
             p.max_staff,
             p.max_branches,
             p.is_archived,
             p.created_at,
             p.has_low_stock_alerts,
             p.has_analytics,
             p.has_forecasting,
             p.has_multi_store,
             (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND LOWER(s.status) <> 'cancelled' AND s.expires_at >= CURDATE()) AS active_subscribers
         FROM plans p
         ORDER BY p.is_archived ASC, p.price ASC, p.id ASC`
    );

    return rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        price: Number(row.price || 0),
        max_inventory: row.max_inventory == null || Number(row.max_inventory) === 0 ? null : Number(row.max_inventory),
        max_bookings: row.max_bookings == null || Number(row.max_bookings) === 0 ? null : Number(row.max_bookings),
        max_staff: row.max_staff == null || Number(row.max_staff) === 0 ? null : Number(row.max_staff),
        max_branches: row.max_branches == null || Number(row.max_branches) === 0 ? null : Number(row.max_branches),
        is_archived: Boolean(row.is_archived),
        created_at: row.created_at,
        has_low_stock_alerts: Boolean(row.has_low_stock_alerts),
        has_analytics: Boolean(row.has_analytics),
        has_forecasting: Boolean(row.has_forecasting),
        has_multi_store: Boolean(row.has_multi_store),
        active_subscribers: Number(row.active_subscribers || 0),
    }));
}

function normalizeLimit(value, label) {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw httpError(400, `${label} must be a non-negative integer or unlimited.`);
    return parsed;
}

async function createPlan(connection, body) {
    const name = requiredText(body.name, "Plan name", 100);
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw httpError(400, "Price must be a non-negative number.");

    const limits = {
        max_inventory: normalizeLimit(body.max_inventory, "Maximum inventory"),
        max_bookings: normalizeLimit(body.max_bookings, "Maximum bookings"),
        max_staff: normalizeLimit(body.max_staff, "Maximum staff"),
        max_branches: normalizeLimit(body.max_branches, "Maximum branches"),
    };

    const [result] = await connection.execute(
        `INSERT INTO plans
         (name, price, max_inventory, max_bookings, max_staff, max_branches,
          is_archived, has_low_stock_alerts, has_analytics, has_forecasting, has_multi_store)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
            name,
            price,
            limits.max_inventory,
            limits.max_bookings,
            limits.max_staff,
            limits.max_branches,
            body.has_low_stock_alerts ? 1 : 0,
            body.has_analytics ? 1 : 0,
            body.has_forecasting ? 1 : 0,
            body.has_multi_store ? 1 : 0,
        ]
    );

    return { message: "Plan created.", plan_id: Number(result.insertId) };
}

async function updatePlan(connection, body) {
    const planId = positiveId(body.plan_id, "plan_id");
    const name = requiredText(body.name, "Plan name", 100);
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw httpError(400, "Price must be a non-negative number.");

    const limits = {
        max_inventory: normalizeLimit(body.max_inventory, "Maximum inventory"),
        max_bookings: normalizeLimit(body.max_bookings, "Maximum bookings"),
        max_staff: normalizeLimit(body.max_staff, "Maximum staff"),
        max_branches: normalizeLimit(body.max_branches, "Maximum branches"),
    };

    const [result] = await connection.execute(
        `UPDATE plans SET
                          name = ?, price = ?, max_inventory = ?, max_bookings = ?, max_staff = ?, max_branches = ?,
                          has_low_stock_alerts = ?, has_analytics = ?, has_forecasting = ?, has_multi_store = ?
         WHERE id = ?`,
        [
            name,
            price,
            limits.max_inventory,
            limits.max_bookings,
            limits.max_staff,
            limits.max_branches,
            body.has_low_stock_alerts ? 1 : 0,
            body.has_analytics ? 1 : 0,
            body.has_forecasting ? 1 : 0,
            body.has_multi_store ? 1 : 0,
            planId,
        ]
    );

    if (!result.affectedRows) throw httpError(404, "Plan not found.");
    return { message: "Plan updated.", plan_id: planId };
}

async function setPlanArchived(connection, planId, archived) {
    planId = positiveId(planId, "plan_id");
    const [result] = await connection.execute(
        "UPDATE plans SET is_archived = ? WHERE id = ?",
        [archived ? 1 : 0, planId]
    );
    if (!result.affectedRows) throw httpError(404, "Plan not found.");
    return { message: archived ? "Plan archived." : "Plan restored.", plan_id: planId };
}

async function approvePayment(connection, paymentId, admin) {
    const c = await getPaymentColumns(connection);
    await connection.beginTransaction();

    try {
        const [paymentRows] = await connection.execute(
            `SELECT p.*, pl.name AS plan_name, pl.price AS plan_price, s.store_name
             FROM payments p
                      INNER JOIN plans pl ON pl.id = p.${c.planId}
                      INNER JOIN stores s ON s.id = p.${c.storeId}
             WHERE p.${c.id} = ?
                 FOR UPDATE`,
            [paymentId]
        );
        const payment = paymentRows[0];
        if (!payment) throw httpError(404, "Payment not found.");
        if (normalizeStatus(payment[c.status]) !== "PENDING") throw httpError(409, "Only pending payments can be approved.");

        const [planRows] = await connection.execute("SELECT * FROM plans WHERE id = ? LIMIT 1", [payment[c.planId]]);
        const plan = planRows[0];
        if (!plan || Number(plan.is_archived) === 1) throw httpError(409, "The requested plan is unavailable or archived.");

        if (moneyCents(payment[c.amount]) !== moneyCents(plan.price)) {
            throw httpError(409, "Submitted amount does not match the current plan price.");
        }

        const [duplicates] = await connection.execute(
            `SELECT ${c.id} AS payment_id FROM payments
             WHERE ${c.reference} = ? AND UPPER(${c.status}) = 'APPROVED' AND ${c.id} <> ?
                 LIMIT 1`,
            [payment[c.reference], paymentId]
        );
        if (duplicates.length) throw httpError(409, "This reference number is already used by an approved payment.");

        const [subscriptionRows] = await connection.execute(
            `SELECT * FROM subscriptions WHERE store_id = ? LIMIT 1 FOR UPDATE`,
            [payment[c.storeId]]
        );
        const existing = subscriptionRows[0] || null;
        const approvalDate = today();
        let startDate = approvalDate;
        let expiresAt = addMonths(approvalDate, 1);
        let subscriptionId;
        let previousStatus = "FREE";
        let oldPlanId = null;
        let changeType = "upgrade";

        if (existing) {
            previousStatus = normalizeStatus(existing.status);
            oldPlanId = Number(existing.plan_id);
            const samePlan = oldPlanId === Number(payment[c.planId]);
            const existingExpiry = existing.expires_at ? normalizeDate(existing.expires_at) : null;
            const usableCurrentPeriod = samePlan && normalizeStatus(existing.status) !== "CANCELLED" && existingExpiry && existingExpiry >= approvalDate;

            if (usableCurrentPeriod) {
                startDate = normalizeDate(existing.started_at) || approvalDate;
                expiresAt = addMonths(existingExpiry, 1);
                changeType = "renewal";
            } else {
                startDate = approvalDate;
                expiresAt = addMonths(approvalDate, 1);
                changeType = changeTypeForPlanChange(oldPlanId, payment[c.planId]);
            }

            await connection.execute(
                `UPDATE subscriptions
                 SET plan_id = ?, status = 'active', auto_renew = auto_renew, started_at = ?, expires_at = ?
                 WHERE id = ?`,
                [payment[c.planId], startDate, expiresAt, existing.id]
            );
            subscriptionId = Number(existing.id);
        } else {
            const [result] = await connection.execute(
                `INSERT INTO subscriptions (store_id, plan_id, status, auto_renew, started_at, expires_at)
                 VALUES (?, ?, 'active', 0, ?, ?)`,
                [payment[c.storeId], payment[c.planId], startDate, expiresAt]
            );
            subscriptionId = Number(result.insertId);
        }

        await connection.execute(
            `UPDATE payments SET
                ${c.status} = 'approved'
                ${c.reviewer ? `, ${c.reviewer} = ?` : ""}
                ${c.reviewedAt ? `, ${c.reviewedAt} = NOW()` : ""}
             WHERE ${c.id} = ?`,
            c.reviewer ? [admin.platform_admin_id, paymentId] : [paymentId]
        );

        await connection.execute(
            `INSERT INTO subscription_history
             (subscription_id, store_id, old_plan_id, new_plan_id, change_type, changed_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [subscriptionId, payment[c.storeId], oldPlanId, payment[c.planId], changeType, admin.platform_admin_id]
        );

        await connection.execute(
            `INSERT INTO subscription_audit_logs
             (business_id, subscription_id, payment_submission_id, action, previous_status, new_status, performed_by_admin_id, reason)
             VALUES (?, ?, ?, 'PAYMENT_APPROVED', ?, 'ACTIVE', ?, ?)`,
            [
                payment[c.storeId],
                subscriptionId,
                paymentId,
                previousStatus,
                admin.platform_admin_id,
                `Approved ${payment.plan_name} plan payment.`,
            ]
        );

        await connection.commit();
        return {
            message: "Payment Approved",
            store_name: payment.store_name,
            plan_name: payment.plan_name,
            start_date: startDate,
            expiration_date: expiresAt,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function rejectPayment(connection, paymentId, admin, rejectionReason, explanation) {
    if (!REJECTION_REASONS.includes(rejectionReason)) throw httpError(400, "Select a valid rejection reason.");
    const c = await getPaymentColumns(connection);
    await connection.beginTransaction();

    try {
        const [rows] = await connection.execute(
            `SELECT p.*, s.store_name, pl.name AS plan_name
             FROM payments p
                      INNER JOIN stores s ON s.id = p.${c.storeId}
                      LEFT JOIN plans pl ON pl.id = p.${c.planId}
             WHERE p.${c.id} = ?
                 FOR UPDATE`,
            [paymentId]
        );
        const payment = rows[0];
        if (!payment) throw httpError(404, "Payment not found.");
        if (normalizeStatus(payment[c.status]) !== "PENDING") throw httpError(409, "Only pending payments can be rejected.");

        await connection.execute(
            `UPDATE payments SET
                ${c.status} = 'rejected'
                ${c.reviewer ? `, ${c.reviewer} = ?` : ""}
                ${c.reviewedAt ? `, ${c.reviewedAt} = NOW()` : ""}
             WHERE ${c.id} = ?`,
            c.reviewer ? [admin.platform_admin_id, paymentId] : [paymentId]
        );

        const reason = [rejectionReason, text(explanation, 500)].filter(Boolean).join(": ");
        await connection.execute(
            `INSERT INTO subscription_audit_logs
             (business_id, subscription_id, payment_submission_id, action, previous_status, new_status, performed_by_admin_id, reason)
             VALUES (?, NULL, ?, 'PAYMENT_REJECTED', 'PENDING', 'REJECTED', ?, ?)`,
            [payment[c.storeId], paymentId, admin.platform_admin_id, reason]
        );

        await connection.commit();
        return { message: "Payment Verification Rejected", store_name: payment.store_name, reason: rejectionReason };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function changeSubscriptionStatus(connection, subscriptionId, admin, nextStatus, reason) {
    if (!SUBSCRIPTION_STATUSES.includes(nextStatus)) throw httpError(400, "Invalid subscription status.");
    if (!reason) throw httpError(400, "A reason is required.");

    await connection.beginTransaction();
    try {
        const [rows] = await connection.execute(
            `SELECT sub.*, s.store_name FROM subscriptions sub
                                                 INNER JOIN stores s ON s.id = sub.store_id
             WHERE sub.id = ? FOR UPDATE`,
            [subscriptionId]
        );
        const sub = rows[0];
        if (!sub) throw httpError(404, "Subscription not found.");

        if (nextStatus === "ACTIVE" && sub.expires_at && normalizeDate(sub.expires_at) < today()) {
            throw httpError(409, "An expired subscription must be renewed or extended before it can be reactivated.");
        }

        const previousStatus = normalizeStatus(sub.status);
        await connection.execute("UPDATE subscriptions SET status = ? WHERE id = ?", [lowerStatus(nextStatus), subscriptionId]);

        await connection.execute(
            `INSERT INTO subscription_history
             (subscription_id, store_id, old_plan_id, new_plan_id, change_type, changed_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [subscriptionId, sub.store_id, sub.plan_id, sub.plan_id, nextStatus === "CANCELLED" ? "cancellation" : "admin_override", admin.platform_admin_id]
        );

        await connection.execute(
            `INSERT INTO subscription_audit_logs
             (business_id, subscription_id, payment_submission_id, action, previous_status, new_status, performed_by_admin_id, reason)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
            [sub.store_id, subscriptionId, `SUBSCRIPTION_${nextStatus}`, previousStatus, nextStatus, admin.platform_admin_id, reason]
        );

        await connection.commit();
        return { message: `Subscription status changed to ${nextStatus}.`, status: nextStatus };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function extendSubscription(connection, subscriptionId, admin, extensionDays, reason) {
    const days = Number(extensionDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw httpError(400, "extension_days must be from 1 to 365.");
    if (!reason) throw httpError(400, "A reason is required.");

    await connection.beginTransaction();
    try {
        const [rows] = await connection.execute("SELECT * FROM subscriptions WHERE id = ? FOR UPDATE", [subscriptionId]);
        const sub = rows[0];
        if (!sub) throw httpError(404, "Subscription not found.");

        const currentExpiry = sub.expires_at ? normalizeDate(sub.expires_at) : null;
        const baseDate = currentExpiry && currentExpiry >= today() ? currentExpiry : today();
        const expiresAt = addDays(baseDate, days);
        const previousStatus = normalizeStatus(sub.status);

        await connection.execute("UPDATE subscriptions SET expires_at = ?, status = 'active' WHERE id = ?", [expiresAt, subscriptionId]);
        await connection.execute("UPDATE stores SET status = 'active' WHERE id = ?", [sub.store_id]);

        await connection.execute(
            `INSERT INTO subscription_history
             (subscription_id, store_id, old_plan_id, new_plan_id, change_type, changed_by)
             VALUES (?, ?, ?, ?, 'admin_override', ?)`,
            [subscriptionId, sub.store_id, sub.plan_id, sub.plan_id, admin.platform_admin_id]
        );

        await connection.execute(
            `INSERT INTO subscription_audit_logs
             (business_id, subscription_id, payment_submission_id, action, previous_status, new_status, performed_by_admin_id, reason)
             VALUES (?, ?, NULL, 'SUBSCRIPTION_EXTENDED', ?, 'ACTIVE', ?, ?)`,
            [sub.store_id, subscriptionId, previousStatus, admin.platform_admin_id, `${days} day(s): ${reason}`]
        );

        await connection.commit();
        return { message: "Subscription extended.", expires_at: expiresAt };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function getPlatformSettings(connection) {
    const [rows] = await connection.execute("SELECT `key`, value, updated_at FROM platform_settings ORDER BY `key` ASC");
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return { settings, rows };
}

async function updatePlatformSettings(connection, values) {
    if (!values || typeof values !== "object") throw httpError(400, "settings must be an object.");
    await connection.beginTransaction();
    try {
        for (const [key, value] of Object.entries(values)) {
            const cleanKey = text(key, 100);
            if (!cleanKey) continue;
            await connection.execute(
                "INSERT INTO platform_settings (`key`, value, updated_at) " +
                "VALUES (?, ?, NOW()) " +
                "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()",
                [cleanKey, String(value ?? "")]
            );
        }
        await connection.commit();
        return { message: "Platform settings updated." };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function listStores(connection, search, planName, storeStatus) {
    const values = [];
    const filters = [];
    const cleanSearch = text(search, 120);

    if (cleanSearch) {
        const like = `%${cleanSearch}%`;
        filters.push("(s.store_name LIKE ? OR s.owner_name LIKE ? OR s.email LIKE ?)");
        values.push(like, like, like);
    }
    if (planName && planName !== "All plans") {
        filters.push("pl.name = ?");
        values.push(planName);
    }
    if (storeStatus && storeStatus !== "All statuses") {
        const normalizedStatus = String(storeStatus).toUpperCase();
        if (normalizedStatus === "ACTIVE") {
            filters.push("(sub.id IS NULL OR (LOWER(sub.status) = 'active' AND (sub.expires_at IS NULL OR sub.expires_at >= CURDATE())))");
        } else if (normalizedStatus === "EXPIRING") {
            filters.push("sub.id IS NOT NULL AND LOWER(sub.status) <> 'cancelled' AND sub.expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)");
        } else if (normalizedStatus === "EXPIRED") {
            filters.push("sub.id IS NOT NULL AND (LOWER(sub.status) = 'expired' OR (LOWER(sub.status) = 'active' AND sub.expires_at < CURDATE()))");
        } else if (normalizedStatus === "CANCELLED") {
            filters.push("sub.id IS NOT NULL AND LOWER(sub.status) = 'cancelled'");
        } else {
            throw httpError(400, "Invalid subscription status filter.");
        }
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const c = await getPaymentColumns(connection);
    const [rows] = await connection.execute(
        `SELECT
             s.id,
             s.store_name,
             s.owner_name,
             s.email,
             s.created_at AS signup_date,
             sub.id AS subscription_id,
             sub.status AS raw_subscription_status,
             sub.started_at,
             sub.expires_at,
             sub.auto_renew,
             pl.id AS plan_id,
             pl.name AS plan_name,
             COALESCE((SELECT SUM(p2.${c.amount}) FROM payments p2 WHERE p2.${c.storeId} = s.id AND UPPER(p2.${c.status}) = 'APPROVED'), 0) AS lifetime_paid
         FROM stores s
                  LEFT JOIN subscriptions sub ON sub.store_id = s.id
                  LEFT JOIN plans pl ON pl.id = sub.plan_id
             ${where}
         ORDER BY s.id DESC`,
        values
    );

    return rows.map((row) => ({
        id: Number(row.id),
        store_name: row.store_name,
        owner_name: row.owner_name,
        email: row.email,
        status: row.subscription_id == null
            ? "ACTIVE"
            : displaySubscriptionStatus(row.raw_subscription_status, row.expires_at),
        store_status: String(row.store_status || "").toUpperCase(),
        signup_date: row.signup_date,
        subscription_id: row.subscription_id == null ? null : Number(row.subscription_id),
        plan_id: row.plan_id == null ? null : Number(row.plan_id),
        plan_name: row.plan_name || "Starter",
        subscription_status: row.subscription_id == null
            ? "ACTIVE"
            : displaySubscriptionStatus(row.raw_subscription_status, row.expires_at),
        started_at: row.started_at,
        expires_at: row.expires_at,
        auto_renew: Boolean(row.auto_renew),
        lifetime_paid: Number(row.lifetime_paid || 0),
    }));
}

async function getStorePlanDetails(connection, storeId) {
    const [storeRows] = await connection.execute(
        "SELECT id FROM stores WHERE id = ? LIMIT 1",
        [storeId]
    );
    if (!storeRows[0]) throw httpError(404, "Store not found.");

    const [planRows] = await connection.execute(
        `SELECT
             pl.id,
             pl.name,
             pl.max_inventory,
             pl.max_bookings,
             pl.max_staff,
             pl.max_branches,
             pl.has_low_stock_alerts,
             pl.has_analytics,
             pl.has_forecasting,
             pl.has_multi_store
         FROM subscriptions sub
                  INNER JOIN plans pl ON pl.id = sub.plan_id
         WHERE sub.store_id = ?
           AND LOWER(sub.status) = 'active'
           AND (sub.expires_at IS NULL OR sub.expires_at >= CURDATE())
         ORDER BY sub.id DESC
             LIMIT 1`,
        [storeId]
    );

    let plan = planRows[0];

    if (!plan) {
        // No active paid subscription row yet — the store is on Starter.
        const [starterRows] = await connection.execute(
            `SELECT
                 id,
                 name,
                 max_inventory,
                 max_bookings,
                 max_staff,
                 max_branches,
                 has_low_stock_alerts,
                 has_analytics,
                 has_forecasting,
                 has_multi_store
             FROM plans
             WHERE is_archived = 0
               AND (LOWER(name) = 'starter' OR price = 0)
             ORDER BY price ASC, id ASC
                 LIMIT 1`
        );
        plan = starterRows[0] || null;
    }

    const limitOrNull = (value) =>
        value === null || value === undefined || Number(value) === 0 ? null : Number(value);

    const maxInventory = limitOrNull(plan?.max_inventory);
    const maxBookings = limitOrNull(plan?.max_bookings);
    const maxStaff = limitOrNull(plan?.max_staff);
    const maxBranches = limitOrNull(plan?.max_branches);

    const [inventoryRows] = await connection.execute(
        "SELECT COUNT(*) AS total FROM products WHERE store_id = ?",
        [storeId]
    );

    let bookingCount = 0;
    try {
        const [bookingRows] = await connection.execute(
            "SELECT COUNT(*) AS total FROM bookings WHERE store_id = ?",
            [storeId]
        );
        bookingCount = Number(bookingRows[0]?.total || 0);
    } catch {
        // Keep this action usable if an older database has no bookings table.
        bookingCount = 0;
    }

    let staffCount = 0;
    try {
        const [staffRows] = await connection.execute(
            "SELECT COUNT(*) AS total FROM staff WHERE store_id = ? AND status = 'active'",
            [storeId]
        );
        staffCount = Number(staffRows[0]?.total || 0);
    } catch {
        staffCount = 0;
    }

    let branchCount = 0;
    try {
        const [branchRows] = await connection.execute(
            "SELECT COUNT(*) AS total FROM branches WHERE store_id = ?",
            [storeId]
        );
        branchCount = Number(branchRows[0]?.total || 0);
    } catch {
        branchCount = 0;
    }

    const usageRow = (label, current, limit) => ({
        label,
        current,
        limit: limit === null ? "∞" : limit,
        percent:
            limit === null
                ? 0
                : Math.min(100, Math.round((current / Math.max(limit, 1)) * 100)),
    });

    return {
        plan_name: plan?.name || "Starter",
        features: [
            { label: `${maxInventory ?? "Unlimited"} inventory items`, enabled: true },
            { label: `${maxBookings ?? "Unlimited"} bookings`, enabled: true },
            { label: `${maxStaff ?? "Unlimited"} staff accounts`, enabled: true },
            { label: `${maxBranches ?? "Unlimited"} branches`, enabled: true },
            { label: "Low-stock alerts", enabled: Boolean(plan?.has_low_stock_alerts) },
            { label: "Analytics", enabled: Boolean(plan?.has_analytics) },
            { label: "Forecasting", enabled: Boolean(plan?.has_forecasting) },
            { label: "Multi-store management", enabled: Boolean(plan?.has_multi_store) },
        ],
        usage: [
            usageRow("Inventory", Number(inventoryRows[0]?.total || 0), maxInventory),
            usageRow("Bookings", bookingCount, maxBookings),
            usageRow("Staff", staffCount, maxStaff),
            usageRow("Branches", branchCount, maxBranches),
        ],
    };
}

async function setStoreStatus(connection, storeId, status, admin, reason) {
    const normalized = String(status || "").trim().toLowerCase();
    if (!["active", "trial", "suspended"].includes(normalized)) throw httpError(400, "Invalid store status.");
    if (!reason) throw httpError(400, "A reason is required.");

    const [rows] = await connection.execute("SELECT id FROM stores WHERE id = ? LIMIT 1", [storeId]);
    if (!rows[0]) throw httpError(404, "Store not found.");

    const previous = "UNKNOWN";

    await connection.execute(
        `INSERT INTO subscription_audit_logs
         (business_id, subscription_id, payment_submission_id, action, previous_status, new_status, performed_by_admin_id, reason)
         VALUES (?, NULL, NULL, 'STORE_STATUS_CHANGED', ?, ?, ?, ?)`,
        [storeId, previous, normalized.toUpperCase(), admin.platform_admin_id, reason]
    );
    return { message: `Store status changed to ${normalized}.` };
}

exports.handler = async (event) => {
    let connection;
    try {
        const method = getHttpMethod(event);
        if (method === "OPTIONS") return response(event, 204, {});
        if (method !== "POST") return response(event, 405, { message: "Only POST requests are allowed." });

        const body = parseBody(event);
        const action = text(body.action, 100);
        if (!action) throw httpError(400, "Missing action.");

        connection = await pool.getConnection();
        const admin = await requirePlatformAdmin(event, connection);

        switch (action) {
            case "get_subscription_summary":
                return response(event, 200, { summary: await getSubscriptionSummary(connection) });

            case "list_payment_submissions":
                return response(event, 200, { payments: await listPaymentSubmissions(connection, body.status, body.search) });

            case "get_payment_submission":
                return response(event, 200, { payment: await getPaymentSubmission(connection, positiveId(body.payment_submission_id, "payment_submission_id")) });

            case "approve_payment_submission":
                return response(event, 200, await approvePayment(connection, positiveId(body.payment_submission_id, "payment_submission_id"), admin));

            case "reject_payment_submission":
                return response(event, 200, await rejectPayment(
                    connection,
                    positiveId(body.payment_submission_id, "payment_submission_id"),
                    admin,
                    text(body.rejection_reason, 100),
                    text(body.rejection_explanation, 500)
                ));

            case "list_businesses":
                return response(event, 200, { businesses: await listBusinesses(connection, body.search) });

            case "list_subscriptions":
                return response(event, 200, { subscriptions: await listSubscriptions(connection, body.search, body.status) });

            case "get_subscription_history":
                return response(event, 200, { history: await getSubscriptionHistory(connection, positiveId(body.subscription_id, "subscription_id")) });

            case "get_business_subscription": {
                const storeId = positiveId(body.business_id || body.store_id, "business_id");
                const rows = await listSubscriptions(connection, "", "ALL");
                const match = rows.find((row) => row.store_id === storeId) || null;
                return response(event, 200, { subscription: match });
            }

            case "list_audit_logs":
                return response(event, 200, { audit_logs: await listAuditLogs(connection, body.business_id) });

            case "suspend_subscription": {
                const storeId = positiveId(body.business_id || body.store_id, "business_id");
                return response(event, 200, await setStoreStatus(connection, storeId, "suspended", admin, text(body.reason, 500)));
            }

            case "reactivate_subscription": {
                const storeId = positiveId(body.business_id || body.store_id, "business_id");
                return response(event, 200, await setStoreStatus(connection, storeId, "active", admin, text(body.reason, 500)));
            }

            case "cancel_subscription":
                return response(event, 200, await changeSubscriptionStatus(
                    connection,
                    positiveId(body.subscription_id, "subscription_id"),
                    admin,
                    "CANCELLED",
                    text(body.reason, 500)
                ));

            case "extend_subscription":
                return response(event, 200, await extendSubscription(
                    connection,
                    positiveId(body.subscription_id, "subscription_id"),
                    admin,
                    body.extension_days,
                    text(body.reason, 500)
                ));

            case "list_plans":
            case "get_plans":
                return response(event, 200, { plans: await getPlans(connection) });

            case "create_plan":
                return response(event, 201, await createPlan(connection, body));

            case "update_plan":
                return response(event, 200, await updatePlan(connection, body));

            case "archive_plan":
                return response(event, 200, await setPlanArchived(connection, body.plan_id, true));

            case "restore_plan":
                return response(event, 200, await setPlanArchived(connection, body.plan_id, false));

            case "get_platform_settings":
                return response(event, 200, await getPlatformSettings(connection));

            case "update_platform_settings":
                return response(event, 200, await updatePlatformSettings(connection, body.settings));

            case "list_stores":
                return response(event, 200, { stores: await listStores(connection, body.search, body.plan, body.status) });

            case "get_store_plan_details":
                return response(event, 200, await getStorePlanDetails(connection, positiveId(body.store_id, "store_id")));

            case "suspend_store":
                return response(event, 200, await setStoreStatus(connection, positiveId(body.store_id, "store_id"), "suspended", admin, text(body.reason, 500)));

            case "reactivate_store":
                return response(event, 200, await setStoreStatus(connection, positiveId(body.store_id, "store_id"), "active", admin, text(body.reason, 500)));

            default:
                throw httpError(400, `Unknown action: ${action}`);
        }
    } catch (error) {
        console.error("subscription-admin error:", error);
        return response(event, error.statusCode || 500, {
            message: error.message || "Internal server error.",
        });
    } finally {
        if (connection) connection.release();
    }
};
async function tryPlatformAdminLogin({
                                         connection,
                                         email,
                                         password,
                                     }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const enteredPassword = String(password || "");

    if (!normalizedEmail || !enteredPassword) {
        return null;
    }

    const [rows] = await connection.execute(
        `
            SELECT
                platform_admin_id,
                full_name,
                email,
                password,
                role,
                is_active
            FROM platform_admins
            WHERE email = ?
                LIMIT 1
        `,
        [normalizedEmail]
    );

    const admin = rows[0];

    if (!admin) {
        return null;
    }

    if (!admin.is_active) {
        const error = new Error("Platform Administrator account is inactive.");
        error.statusCode = 403;
        throw error;
    }

    const passwordMatches = await bcrypt.compare(
        enteredPassword,
        admin.password
    );

    if (!passwordMatches) {
        const error = new Error("Invalid email or password.");
        error.statusCode = 401;
        throw error;
    }

    const token = jwt.sign(
        {
            platform_admin_id: admin.platform_admin_id,
            email: admin.email,
            full_name: admin.full_name,
            role: "PLATFORM_ADMIN",
        },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
    );

    return {
        token,
        user: {
            id: admin.platform_admin_id,
            platform_admin_id: admin.platform_admin_id,
            full_name: admin.full_name,
            email: admin.email,
            role: "PLATFORM_ADMIN",
        },
    };
}

module.exports = {
    handler: exports.handler,
    tryPlatformAdminLogin,
    getPublicPlans,
};