/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * StockNBook — Bookings Lambda rewritten for the stocknbook_v2 schema (27 tables).
 *
 * Every action name and JSON response shape is the same as the old Lambda, so the
 * Owner / Manager / Staff / public booking pages keep working without big changes.
 *
 * WHERE THE OLD TABLES WENT (v1 -> v2)
 *   bookings.name/phone/email/facebook_name -> customers (bookings.customer_id)
 *   bookings.package_name / package_json    -> booking_items row item_type='package' (+ child rows)
 *   bookings.package_price                  -> bookings.package_price_snapshot
 *   bookings.amount_paid / balance / payment_status -> computed from payments (payment_type='booking_payment')
 *   booking_items (consumables)             -> booking_items item_type='consumable' (variant_id is required)
 *   booking_rental_items                    -> booking_items item_type='rental' (equipment_id, rental_days)
 *   rental_booking_allocations              -> booking_items.item_status for rental rows
 *   booking_sales_fulfillment               -> booking_items.prepared_at/prepared_by/released_at/released_by
 *   booking_financial_details.refundable_deposit_required -> bookings.refundable_deposit_required
 *   deposit_collected                       -> payments payment_type='security_deposit'
 *   deposit_applied                         -> bookings.deposit_applied_amount
 *   deposit_refunded                        -> refunds refund_type='deposit_refund'
 *   booking_customer_claims                 -> booking_items.damaged_quantity/missing_quantity (incidents)
 *                                              + bookings.final_additional_charges (ONE booking-wide charge)
 *   claim payments (booking_financial_events 'claim_paid') -> payments payment_type='additional_charge'
 *   booking_fee_policies (delivery/setup)   -> removed in v2 (always 0)
 *   booking_approval_requests               -> removed in v2 (bookings.approved_by/approved_at)
 *   booking_customer_review_profiles        -> customers.review_required/identity_verified/review_reason
 *   booking_customer_case_events            -> employee_actions (entity_type='customer_case')
 *   rental_equipment                        -> equipment (store-wide) + branch_inventory (per branch stock)
 *   products.stock / inventory_batches      -> branch_inventory (on_hand / reserved / unavailable, expiration_date)
 *   managers / staff / owner                -> users (role = owner | manager | staff)
 */

const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

// ===== ENV SECURITY CHANGE: Required JWT environment variable BEGIN =====
// MERGE FIX: Restore the missing module-level environment validator.
function requiredEnv(name) {
    const value = process.env[name];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const JWT_SECRET = requiredEnv("JWT_SECRET");
// ===== ENV SECURITY CHANGE: Required JWT environment variable END =====

const dbConfig = {
    // ===== ENV SECURITY CHANGE: MySQL environment configuration BEGIN =====
    host: requiredEnv("DB_HOST"),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    database: requiredEnv("DB_NAME"),
    port: Number(process.env.DB_PORT || 3306),
    // ===== ENV SECURITY CHANGE: MySQL environment configuration END =====
    ssl: { rejectUnauthorized: false },
};

const dbPool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    decimalNumbers: true, // DECIMAL columns come back as numbers, not strings
});

// ─── V2 vocabulary. Agree on these with the teammates who own Inventory/Rentals. ───
const ITEM = { PACKAGE: "package", CONSUMABLE: "consumable", RENTAL: "rental" };
const ITEM_STATUS = {
    PENDING: "pending",     // booking not yet confirmed; nothing is held
    RESERVED: "reserved",   // confirmed; consumables held in branch_inventory.reserved_quantity / rental dates blocked
    RELEASED: "released",   // handed to the customer (consumables issued / rental equipment checked out)
    RETURNED: "returned",   // rental equipment received back (set by the rental-return workflow)
    CANCELLED: "cancelled",
};
// The Rental Inventory Lambda (Staff return form) finishes a return as 'returned' (waiting for
// inspection), 'cleaning', 'damaged' or 'cleared'. For Bookings, all four mean "received back".
const RETURNED_STATUSES = new Set([ITEM_STATUS.RETURNED, "cleaning", "damaged", "cleared"]);
const isReturned = (item) => RETURNED_STATUSES.has(String(item?.item_status ?? "").trim().toLowerCase());
// Rental line status in the words the Manager screens use.
const allocationLabel = (item) => item.item_status === ITEM_STATUS.RELEASED ? "checked_out"
    : item.item_status === ITEM_STATUS.PENDING ? "pending_review" : isReturned(item) ? "returned" : item.item_status;
const PAYMENT = {
    BOOKING: "booking_payment",      // counts toward the agreed booking price
    DEPOSIT: "security_deposit",     // refundable liability, NOT revenue
    CHARGE: "additional_charge",     // damage / missing-item charge payments
    RECORDED: "recorded",
};
const REFUND = { DEPOSIT: "deposit_refund", BOOKING: "booking_refund", DONE: "completed" };
const MOVE = {
    RESERVE: "BOOKING_RESERVE",
    UNRESERVE: "BOOKING_RESERVATION_RELEASE",
    ISSUE: "BOOKING_ISSUE",
    CANCEL_USED: "BOOKING_CANCEL_USED",
    REF: "BOOKING",
};
// Delivery/setup fees and branch fee policies do not exist in v2.
const FEE_POLICY_V2 = {
    deliveryFee: 0, setupFee: 0, refundableDeposit: 0, depositPolicy: "optional",
    deliveryIncludedPackage: false, setupIncludedPackage: false,
};

// ─── Generic helpers ─────────────────────────────────────────────────────────
const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
};

function response(statusCode, payload) {
    return { statusCode, headers, body: JSON.stringify(payload) };
}

function parseBody(event) {
    if (!event.body) return {};
    if (typeof event.body === "object") return event.body;
    try { return JSON.parse(event.body || "{}"); } catch { return {}; }
}

function toNumber(value, fallback = 0) {
    const num = Number(value ?? fallback);
    return Number.isFinite(num) ? num : fallback;
}

const money2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const cents = (value) => Math.round(Number(value || 0) * 100);
const lower = (value) => String(value ?? "").trim().toLowerCase();
const isId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function normalizeDateFilter(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanPackageName(value) {
    if (!value) return "";
    return String(value).replace(/\s*-\s*₱?\s*[\d,]+(\.\d+)?\s*$/i, "").trim();
}

function normalizeText(value) {
    return cleanPackageName(value).toLowerCase().trim();
}

function rentalError(message) {
    const e = new Error(message);
    e.rentalValidation = true;
    return e;
}

function rentalDate(value, label) {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
        throw rentalError(`${label} must be a valid YYYY-MM-DD date.`);
    }
    return text;
}

function rentalDays(from, to) {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
    if (days < 1 || days > 30) throw rentalError("Rental period must be from 1 to 30 calendar days.");
    return days;
}

function rentalTodayManila() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
}

// Highest overlapping quantity on any single day in [from, to].
// Checked-out (released) equipment stays unavailable through today if it is overdue.
function rentalPeakReserved(allocations, from, to, today) {
    const changes = new Map();
    for (const allocation of allocations) {
        const status = String(allocation.status);
        if (status !== "reserved" && status !== "checked_out") continue;
        const first = String(allocation.startDate) > from ? String(allocation.startDate) : from;
        const heldEnd = status === "checked_out" && String(allocation.endDate) < today ? today : String(allocation.endDate);
        const last = heldEnd < to ? heldEnd : to;
        if (first > last) continue;
        changes.set(first, (changes.get(first) || 0) + Number(allocation.quantity));
        const following = new Date(Date.parse(`${last}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
        changes.set(following, (changes.get(following) || 0) - Number(allocation.quantity));
    }
    let active = 0, peak = 0;
    for (const [, change] of [...changes].sort(([a], [b]) => a.localeCompare(b))) {
        active += change;
        peak = Math.max(peak, active);
    }
    return peak;
}

function rentalMoneyCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100)))
        throw rentalError("Invalid price in catalog.");
    return Math.round(n * 100);
}

function parseRentalSelection(raw) {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > 30) throw rentalError("Select at most 30 rental equipment types.");
    const seen = new Set();
    return raw.map((line) => {
        const equipmentId = Number(line?.equipmentId);
        const quantity = Number(line?.quantity);
        if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0 ||
            !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000 || seen.has(equipmentId))
            throw rentalError("Rental equipment selections must have unique IDs and valid quantities.");
        seen.add(equipmentId);
        return { equipmentId, quantity, expectedDailyRate: line.expectedDailyRate };
    });
}

function financeCurrency(value, label = "Amount") {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100000000 || Math.abs(raw * 100 - Math.round(raw * 100)) > 0.00001)
        throw rentalError(`${label} must be a non-negative amount with at most two decimal places.`);
    return Math.round(raw * 100) / 100;
}

function financePositive(value, label = "Amount") {
    const n = financeCurrency(value, label);
    if (n <= 0) throw rentalError(`${label} must be positive.`);
    return n;
}

// v2 stores event_time as TIME. Accept "14:30", "14:30:00" or "2:30 PM".
function normalizeEventTime(value, label = "Event time") {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    let m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
    m = raw.match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*([AaPp])\.?[Mm]\.?$/);
    if (m) {
        let hour = Number(m[1]) % 12;
        if (/p/i.test(m[3])) hour += 12;
        return `${String(hour).padStart(2, "0")}:${m[2]}:00`;
    }
    throw rentalError(`${label} must be a valid time, for example 14:30.`);
}

// ─── Pickup / delivery and return schedule ───────────────────────────────────
// bookings.handover_method / handover_date / handover_time say when the customer gets the items.
// For rentals the rental period is handover date → return date (rental_start_date / rental_end_date),
// so availability and rental days cover the real time the equipment is out.
const HANDOVER_METHODS = new Set(["pickup", "delivery"]);
const HANDOVER_LEAD_DAYS = 7;   // pickup/delivery at most 7 days before the event
const RETURN_GRACE_DAYS = 7;    // return at most 7 days after the event ends
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const handoverLabel = (method) => (method === "delivery" ? "Delivery" : "Pickup");
const scheduleFields = (r) => ({
    handoverMethod: r.handoverMethod === "delivery" ? "delivery" : "pickup",
    handoverDate: String(r.handoverDate || r.eventDate || ""), handoverTime: String(r.handoverTime || ""),
    returnDate: Number(r.rentalLines || 0) > 0 ? String(r.returnDate || "") : "",
    returnTime: Number(r.rentalLines || 0) > 0 ? String(r.returnTime || "") : "",
    deliveryAddress: r.handoverMethod === "delivery" ? String(r.venue || "") : "",
});

// Missing fields fall back to the old behaviour (pickup on the event date, return on the event end date).
function parseBookingSchedule(body, { startDate, endDate, hasRentals }) {
    const method = lower(body.handoverMethod || body.handover_method || "pickup");
    if (!HANDOVER_METHODS.has(method)) throw rentalError("Choose Pickup or Delivery.");
    const label = handoverLabel(method);
    const handoverInput = body.handoverDate || body.handover_date;
    const handoverDate = handoverInput ? rentalDate(handoverInput, `${label} date`) : startDate;
    const handoverTime = normalizeEventTime(body.handoverTime || body.handover_time || body.eventTime || body.event_time, `${label} time`);
    if (handoverDate > startDate) throw rentalError(`${label} date must be on or before the event date.`);
    if (handoverDate < addDays(startDate, -HANDOVER_LEAD_DAYS))
        throw rentalError(`${label} date can be at most ${HANDOVER_LEAD_DAYS} days before the event.`);
    if (handoverInput && handoverDate < rentalTodayManila()) throw rentalError(`${label} date cannot be in the past.`);
    if (!hasRentals) return { method, handoverDate, handoverTime, returnDate: null, returnTime: null };
    const returnInput = body.returnDate || body.return_date || body.rentalEndDate || body.rental_end_date;
    const returnDate = returnInput ? rentalDate(returnInput, "Return date") : endDate;
    const returnTime = normalizeEventTime(body.returnTime || body.return_time, "Return time");
    if (returnDate < endDate) throw rentalError("Return date must be on or after the event end date.");
    if (returnDate > addDays(endDate, RETURN_GRACE_DAYS))
        throw rentalError(`Return date can be at most ${RETURN_GRACE_DAYS} days after the event.`);
    if (returnDate === handoverDate && handoverTime && returnTime && returnTime <= handoverTime)
        throw rentalError(`Return time must be later than the ${label.toLowerCase()} time.`);
    rentalDays(handoverDate, returnDate);
    return { method, handoverDate, handoverTime, returnDate, returnTime };
}

function limitText(value, max, label) {
    const text = String(value ?? "").trim();
    if (text.length > max) throw rentalError(`${label} must be at most ${max} characters.`);
    return text || null;
}

const CANONICAL_BOOKING_STATUSES = [
    "Pending Review", "Awaiting Down Payment", "Confirmed", "Preparing", "Released",
    "Return Inspection", "Pending Settlement", "Completed", "Cancelled", "Rejected",
];

function normalizeBookingStatus(value) {
    const clean = lower(value);
    const match = CANONICAL_BOOKING_STATUSES.find((s) => s.toLowerCase() === clean);
    if (match) return match;
    if (clean === "canceled") return "Cancelled";
    if (clean === "pending") return "Pending Review";
    return null;
}

// Cancelled / rejected bookings owe nothing more.
const closedStatus = (status) => ["Cancelled", "Rejected"].includes(normalizeBookingStatus(status));

function paymentStatusLabel(total, downPayment, paid) {
    if (total > 0 && paid + 0.005 >= total) return "Fully Paid";
    if (downPayment > 0 && paid + 0.005 >= downPayment) return "Down Payment Paid";
    if (paid > 0) return "Partial";
    return downPayment > 0 ? "Down Payment Required" : "Unpaid";
}

// Total booking price: the agreed price when set, otherwise the package price snapshot.
function bookingTotal(b) {
    const agreed = Number(b.agreed_price);
    if (Number.isFinite(agreed) && agreed > 0) return agreed;
    return Number(b.package_price_snapshot || 0);
}

// ─── VAT (reuses the POS store setting stores.tax_registration) ──────────────
// Booking prices are VAT-inclusive and never change because of VAT. For a VAT-registered store,
// the VAT already inside the agreed booking price is saved on bookings.vat_amount, and
// VATable sales = agreed price − VAT. Non-VAT stores save 0. The refundable security deposit is
// not a sale and is never part of the agreed price, so it is never taxed.
// The saved figure is refreshed whenever the agreed price is saved and once more when the Manager
// approves the booking (the price is locked from then on). After approval it never changes,
// so cancelled bookings keep their original tax record; refunds are recorded separately.
const VAT_RATE_PERCENT = 12;
const VAT_REGISTERED_VALUES = new Set(["vat", "vat_registered", "vat-registered", "registered"]);
const isVatRegistered = (value) => VAT_REGISTERED_VALUES.has(lower(value));
function inclusiveVat(total) {
    const totalCents = Math.max(0, cents(total));
    const vatCents = Math.round(totalCents * VAT_RATE_PERCENT / (100 + VAT_RATE_PERCENT));
    return { vatAmount: vatCents / 100, vatableSales: (totalCents - vatCents) / 100 };
}
async function saveBookingVat(db, { bookingId, storeId }) {
    const [rows] = await db.execute(
        `SELECT b.agreed_price, s.tax_registration FROM bookings b JOIN stores s ON s.id=b.store_id
         WHERE b.id=? AND b.store_id=?`, [Number(bookingId), Number(storeId)]);
    if (!rows.length) return 0;
    const agreed = Number(rows[0].agreed_price);
    // Only the agreed (taxable) booking price is used; no price yet means no VAT yet.
    const vat = isVatRegistered(rows[0].tax_registration) && Number.isFinite(agreed) && agreed > 0
        ? inclusiveVat(agreed).vatAmount : 0;
    await db.execute(`UPDATE bookings SET vat_amount=? WHERE id=? AND store_id=?`, [vat, Number(bookingId), Number(storeId)]);
    return vat;
}

function buildBookingReference(row, id) {
    return row?.booking_reference || `BKG-${String(id).padStart(6, "0")}`;
}

function generateBookingReference() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const token = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `BKG-${new Date().getFullYear()}-${token}`;
}

async function withTransaction(db, work) {
    await db.beginTransaction();
    try {
        const result = await work();
        await db.commit();
        return result;
    } catch (err) {
        try { await db.rollback(); } catch { /* keep the original error */ }
        throw err;
    }
}

// Custom-order text written by the public portal is "catalog only" when every line
// matches a verified consumable or rental line. Anything else needs Manager review.
function catalogOnlyBookingText(text, items = null, rentals = null) {
    const lines = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return items === null && rentals === null ? true : ![...(items || []), ...(rentals || [])].length;
    const entries = lines.filter((line) => !/^(Selected inventory items:|Additional request:)$/i.test(line));
    if (!entries.every((line) => /^.{1,255} x [1-9]\d*(?: x [1-9]\d* day\(s\))? = ₱[\d,]+(?:\.\d{1,2})?$/i.test(line))) return false;
    if (items === null || rentals === null) return true;
    const requirements = [];
    for (const item of items) requirements.push({ name: lower(item.name), qty: Number(item.quantity), days: null, amount: Number(item.amount) });
    for (const item of rentals) requirements.push({ name: lower(item.name), qty: Number(item.quantity), days: Number(item.days), amount: Number(item.amount) });
    if (requirements.length !== entries.length) return false;
    const pending = [...requirements];
    for (const line of entries) {
        const match = line.match(/^(.*?) x (\d+)(?: x (\d+) day\(s\))? = ₱([\d,]+(?:\.\d{1,2})?)$/i);
        if (!match) return false;
        const name = match[1].toLowerCase(), qty = Number(match[2]), days = match[3] ? Number(match[3]) : null;
        const amount = Number(match[4].replaceAll(",", ""));
        const index = pending.findIndex((item) => name.includes(item.name) && item.qty === qty && item.days === days &&
            Math.abs(item.amount - amount) <= 0.01);
        if (index < 0) return false;
        pending.splice(index, 1);
    }
    return pending.length === 0;
}

// ─── Users, permissions and audit log (v2 `users` + `employee_actions`) ──────
function normalizeOperationalAccess(permissions, moduleName, role) {
    let values = permissions;
    if (typeof values === "string") {
        try { values = JSON.parse(values); } catch { values = {}; }
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) values = {};
    const keys = moduleName === "bookings" ? ["bookings_access", "booking_access", "bookings"] : [`${moduleName}_access`, moduleName];
    const selected = keys.find((key) => Object.prototype.hasOwnProperty.call(values, key));
    if (!selected) return role === "manager" ? "full" : "none";
    const access = values[selected];
    if (moduleName === "bookings" && role === "staff") {
        if (access === "full" || access === "standard" || access === "confirm_standard") return "standard";
        if (access === true || access === 1 || access === "1" || access === "true" ||
            access === "view" || access === "view_only" || access === "viewOnly") return "view";
        return "none";
    }
    if (access === true || access === 1 || access === "1" || access === "true" || access === "full") return "full";
    if (access === "standard" || access === "confirm_standard") return "standard";
    if (access === "view" || access === "view_only" || access === "viewOnly") return "view";
    return "none";
}

function verifyProtectedStore(event) {
    const authHeader = event.headers?.Authorization || event.headers?.authorization || "";
    if (!authHeader) throw new Error("No token");
    const decoded = jwt.verify(authHeader.replace("Bearer ", ""), JWT_SECRET);
    return {
        storeId: Number(decoded.store_id || decoded.storeId || 0),
        tokenRole: lower(decoded.role),
        tokenBranchId: decoded.branch_id || decoded.branchId ? Number(decoded.branch_id || decoded.branchId) : null,
        decoded,
    };
}

// Find the logged-in person in v2 `users`. The JWT may carry user_id / id / sub,
// an email, or (older auth code) manager_id / staff_id. The role must match.
async function resolveActor(db, decoded, storeId, role) {
    const select = `SELECT id, store_id, branch_id, full_name, role, permissions, status FROM users`;
    const accept = (row) => row && lower(row.role) === role && lower(row.status) === "active" ? row : null;
    const directIds = [decoded.user_id, decoded.userId, decoded.id, decoded.sub].filter(isId).map(Number);
    for (const id of directIds) {
        const [rows] = await db.execute(`${select} WHERE id=? AND store_id=? LIMIT 1`, [id, storeId]);
        if (accept(rows[0])) return rows[0];
    }
    if (decoded.email) {
        const [rows] = await db.execute(`${select} WHERE email=? AND store_id=? LIMIT 1`, [String(decoded.email), storeId]);
        if (accept(rows[0])) return rows[0];
    }
    const legacyId = role === "manager" ? decoded.manager_id : role === "staff" ? decoded.staff_id : decoded.owner_id;
    if (isId(legacyId)) {
        const [rows] = await db.execute(`${select} WHERE id=? AND store_id=? LIMIT 1`, [Number(legacyId), storeId]);
        if (accept(rows[0])) return rows[0];
    }
    if (role === "owner") {
        const [rows] = await db.execute(`${select} WHERE store_id=? AND role='owner' ORDER BY id LIMIT 1`, [storeId]);
        if (accept(rows[0])) return rows[0];
    }
    return null;
}

function actorView(row) {
    return { id: Number(row.id), name: String(row.full_name || row.role || "User").slice(0, 150), role: lower(row.role) };
}

async function logEmployeeAction(db, entry) {
    if (!entry.actor?.id) return; // employee_actions.user_id is required; public actions are not logged
    const details = typeof entry.details === "string" ? { message: entry.details } : (entry.details || {});
    await db.execute(
        `INSERT INTO employee_actions
         (store_id, branch_id, user_id, user_name, user_role, module, action, entity_type, entity_id, reference_number, details)
         VALUES (?, ?, ?, ?, ?, 'Bookings', ?, ?, ?, ?, ?)`,
        [entry.storeId, entry.branchId ?? null, entry.actor.id, entry.actor.name, entry.actor.role,
            String(entry.action).slice(0, 100), entry.entityType || "booking", entry.entityId ?? null,
            entry.referenceNumber ? String(entry.referenceNumber).slice(0, 100) : null, JSON.stringify(details)]
    );
}

// Idempotency for settlement / financial events (payments have their own unique request_key).
async function requestKeyUsed(db, storeId, key) {
    const [pay] = await db.execute(
        `SELECT id FROM payments WHERE store_id=? AND (request_key=? OR request_key LIKE ?) LIMIT 1`,
        [storeId, key, `${key}-%`]);
    if (pay.length) return true;
    const [log] = await db.execute(
        `SELECT id FROM employee_actions WHERE store_id=? AND module='Bookings'
                                           AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.requestKey'))=? LIMIT 1`, [storeId, key]);
    return log.length > 0;
}

// ─── Booking loaders (v2) ────────────────────────────────────────────────────
const BOOKING_CORE_FIELDS = `
    b.id, b.store_id, b.branch_id, b.booking_reference, b.booking_type, b.customer_id, b.package_id,
    b.status, b.agreed_price, b.package_price_snapshot, b.required_down_payment, b.refundable_deposit_required,
    b.vat_amount, b.final_additional_charges, b.deposit_applied_amount, b.approved_refund_amount, b.settlement_status,
    b.settlement_notes, b.settlement_reviewed_at, b.approved_by, b.approved_at, b.custom_order,
    b.cancellation_reason,
    DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate,
    DATE_FORMAT(COALESCE(b.event_end_date,b.event_date),'%Y-%m-%d') AS eventEndDate,
    DATE_FORMAT(COALESCE(b.rental_start_date,b.event_date),'%Y-%m-%d') AS rentalStart,
    DATE_FORMAT(COALESCE(b.rental_end_date,b.event_end_date,b.event_date),'%Y-%m-%d') AS rentalEnd,
    DATE_FORMAT(b.down_payment_deadline,'%Y-%m-%d %H:%i:%s') AS dpDeadline,
    b.handover_method AS handoverMethod,
    DATE_FORMAT(COALESCE(b.handover_date,b.rental_start_date,b.event_date),'%Y-%m-%d') AS handoverDate,
    TIME_FORMAT(COALESCE(b.handover_time,b.event_time),'%H:%i') AS handoverTime,
    TIME_FORMAT(b.return_time,'%H:%i') AS returnTime,
    c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
    c.facebook_name AS customer_facebook`;

async function loadBooking(db, { bookingId, storeId, branchId = null, lock = false }) {
    const params = [Number(bookingId), Number(storeId)];
    let sql = `SELECT ${BOOKING_CORE_FIELDS}
               FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
               WHERE b.id=? AND b.store_id=?`;
    if (branchId) { sql += " AND b.branch_id=?"; params.push(Number(branchId)); }
    sql += " LIMIT 1";
    if (lock) sql += " FOR UPDATE OF b";
    const [rows] = await db.execute(sql, params);
    return rows[0] || null;
}

async function loadItems(db, bookingId, storeId, lock = false) {
    const [rows] = await db.execute(
        `SELECT bi.id, bi.parent_item_id, bi.package_id, bi.variant_id, bi.equipment_id, bi.item_type,
                bi.item_name_snapshot, bi.variant_name_snapshot, bi.quantity, bi.rental_days,
                bi.unit_price_snapshot, bi.line_total, bi.used_quantity, bi.item_status,
                bi.prepared_at, bi.released_at, bi.returned_quantity, bi.damaged_quantity,
                bi.missing_quantity, bi.returned_at, bi.inspected_at, bi.return_notes,
                pv.product_id, cat.category_name
         FROM booking_items bi
                  LEFT JOIN product_variants pv ON pv.id=bi.variant_id AND pv.store_id=bi.store_id
                  LEFT JOIN products p ON p.id=pv.product_id AND p.store_id=pv.store_id
                  LEFT JOIN categories cat ON cat.id=p.category_id AND cat.store_id=p.store_id
         WHERE bi.booking_id=? AND bi.store_id=?
           AND bi.item_status NOT LIKE 'claim%' -- charge rows some modules keep in booking_items are not booking lines
         ORDER BY bi.id ${lock ? "FOR UPDATE OF bi" : ""}`,
        [Number(bookingId), Number(storeId)]);
    return rows;
}

function splitItems(items) {
    const active = items.filter((i) => i.item_status !== ITEM_STATUS.CANCELLED);
    const packageRow = items.find((i) => i.item_type === ITEM.PACKAGE) || null;
    const consumables = active.filter((i) => i.item_type === ITEM.CONSUMABLE);
    const rentals = active.filter((i) => i.item_type === ITEM.RENTAL);
    return {
        packageRow,
        consumables,
        customConsumables: consumables.filter((i) => !i.parent_item_id),
        packageConsumables: consumables.filter((i) => i.parent_item_id),
        rentals,
        extraRentals: rentals.filter((i) => !i.parent_item_id),
        includedRentals: rentals.filter((i) => i.parent_item_id),
    };
}

function quoteFromItems(items) {
    const { packageRow, customConsumables, rentals } = splitItems(items);
    const packageBase = packageRow ? Number(packageRow.line_total || 0) : 0;
    const salesSubtotal = money2(customConsumables.reduce((s, i) => s + Number(i.line_total || 0), 0));
    const rentalSubtotal = money2(rentals.reduce((s, i) => s + Number(i.line_total || 0), 0));
    return { packageBase, salesSubtotal, rentalSubtotal, agreedCharges: money2(packageBase + salesSubtotal + rentalSubtotal) };
}

async function getBookingMoney(db, bookingId, storeId) {
    const [pay] = await db.execute(
        `SELECT COALESCE(SUM(CASE WHEN payment_type=? THEN amount ELSE 0 END),0) AS bookingPaid,
                COALESCE(SUM(CASE WHEN payment_type=? THEN amount ELSE 0 END),0) AS depositCollected,
                COALESCE(SUM(CASE WHEN payment_type=? THEN amount ELSE 0 END),0) AS chargePaid
         FROM payments WHERE booking_id=? AND store_id=? AND status=?`,
        [PAYMENT.BOOKING, PAYMENT.DEPOSIT, PAYMENT.CHARGE, Number(bookingId), Number(storeId), PAYMENT.RECORDED]);
    const [ref] = await db.execute(
        `SELECT COALESCE(SUM(CASE WHEN r.refund_type=? THEN r.amount ELSE 0 END),0) AS depositRefunded,
                COALESCE(SUM(CASE WHEN r.refund_type=? THEN r.amount ELSE 0 END),0) AS bookingRefunded
         FROM refunds r JOIN payments p ON p.id=r.payment_id AND p.store_id=r.store_id
         WHERE p.booking_id=? AND r.store_id=? AND LOWER(r.status) IN ('completed','processed')`,
        [REFUND.DEPOSIT, REFUND.BOOKING, Number(bookingId), Number(storeId)]);
    return {
        bookingPaid: money2(pay[0].bookingPaid),
        depositCollected: money2(pay[0].depositCollected),
        chargePaid: money2(pay[0].chargePaid),
        depositRefunded: money2(ref[0].depositRefunded),
        bookingRefunded: money2(ref[0].bookingRefunded), // booking payments given back on cancellation
    };
}

function depositFigures(b, m) {
    const depositRequired = money2(b.refundable_deposit_required);
    const depositApplied = money2(b.deposit_applied_amount);
    const depositHeld = Math.max(0, money2(m.depositCollected - depositApplied - m.depositRefunded));
    const charges = money2(b.final_additional_charges);
    const claimBalance = Math.max(0, money2(charges - m.chargePaid - depositApplied));
    return { depositRequired, depositApplied, depositHeld, charges, claimBalance };
}

// Damaged / missing units recorded on rental rows by the return-inspection workflow.
function incidentsFromItems(items) {
    const result = [];
    for (const item of items) {
        if (item.item_type !== ITEM.RENTAL) continue;
        if (Number(item.damaged_quantity) > 0)
            result.push({ sourceType: "damage", item, quantity: Number(item.damaged_quantity) });
        if (Number(item.missing_quantity) > 0)
            result.push({ sourceType: "missing", item, quantity: Number(item.missing_quantity) });
    }
    return result;
}

// v2 keeps ONE booking-wide charge. Present it in the claim format the receipt already
// understands: the first item carries the "Combined booking-wide charge", the rest are covered.
function synthesizeClaims(b, items, m) {
    if (!b.settlement_reviewed_at) return [];
    const charge = money2(b.final_additional_charges);
    const applied = money2(b.deposit_applied_amount);
    const settled = charge > 0 && m.chargePaid + applied + 0.005 >= charge;
    const incidents = incidentsFromItems(items);
    if (!incidents.length && charge <= 0) return [];
    if (!incidents.length) incidents.push({ sourceType: "damage", item: { id: 0, equipment_id: 0, item_name_snapshot: "Booking-wide charge" }, quantity: 1 });
    const names = incidents.map((x) => x.item.item_name_snapshot).join(", ").slice(0, 180);
    const notes = String(b.settlement_notes || "").trim();
    return incidents.map((x, i) => ({
        id: Number(x.item.id) * 10 + (x.sourceType === "missing" ? 1 : 0),
        sourceType: x.sourceType,
        sourceId: Number(x.item.id),
        equipmentName: x.item.item_name_snapshot,
        quantity: x.quantity,
        reason: i === 0
            ? `Combined booking-wide ${charge > 0 ? "charge" : "waiver"} for ${incidents.length} item(s) (${names})${notes ? `: ${notes}` : ""}`
            : `Covered by the same combined booking-wide charge; no separate charge for ${x.item.item_name_snapshot}.`,
        amount: i === 0 ? charge : 0,
        amountPaid: i === 0 ? m.chargePaid : 0,
        depositApplied: i === 0 ? applied : 0,
        status: charge <= 0 ? "waived" : i === 0 ? (settled ? "settled" : "approved") : "settled",
    }));
}

async function getBookingStatement(db, bookingId, storeId) {
    const b = await loadBooking(db, { bookingId, storeId });
    if (!b) throw rentalError("Booking not found in assigned branch.");
    const items = await loadItems(db, bookingId, storeId);
    const m = await getBookingMoney(db, bookingId, storeId);
    // A cancelled/rejected booking still shows what was booked (its lines were cancelled with it).
    const viewItems = closedStatus(b.status)
        ? items.map((i) => (i.item_status === ITEM_STATUS.CANCELLED ? { ...i, item_status: "booked" } : i)) : items;
    const q = quoteFromItems(viewItems);
    const { packageRow, customConsumables, rentals } = splitItems(viewItems);
    const d = depositFigures(b, m);
    const total = bookingTotal(b);
    // Cancelled / rejected bookings: when, why, and how the money was handed back (for the Billing tab).
    let cancellation = null;
    if (closedStatus(b.status)) {
        const [logRows] = await db.execute(
            `SELECT DATE_FORMAT(MAX(created_at),'%Y-%m-%d %H:%i:%s') AS at FROM employee_actions
             WHERE store_id=? AND entity_id=? AND entity_type='booking' AND action IN ('Cancelled booking','Rejected booking request')`,
            [Number(storeId), Number(bookingId)]);
        const [updRows] = await db.execute(`SELECT DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS at FROM bookings WHERE id=?`, [Number(bookingId)]);
        const [refRows] = await db.execute(
            `SELECT GROUP_CONCAT(DISTINCT r.refund_method ORDER BY r.refund_method) AS methods
             FROM refunds r JOIN payments p ON p.id=r.payment_id AND p.store_id=r.store_id
             WHERE p.booking_id=? AND r.store_id=? AND LOWER(r.status) IN ('completed','processed')`,
            [Number(bookingId), Number(storeId)]);
        const status = normalizeBookingStatus(b.status);
        cancellation = {
            status,
            reason: String(b.cancellation_reason || "").replace(/^Rejected:\s*/i, "").trim() || null,
            closedAt: logRows[0]?.at || updRows[0]?.at || null,
            refundMethod: refRows[0]?.methods || null,
            bookingPayments: m.bookingPaid,
            bookingRefunded: m.bookingRefunded,
            amountKept: Math.max(0, money2(m.bookingPaid - m.bookingRefunded)),
            depositRefunded: m.depositRefunded,
        };
    }
    const [names] = await db.execute(
        `SELECT s.store_name AS storeName, br.branch_name AS branchName FROM stores s
                                                                                 LEFT JOIN branches br ON br.id=? AND br.store_id=s.id WHERE s.id=? LIMIT 1`, [Number(b.branch_id), Number(storeId)]);
    // VAT rows use the SAVED figure only (shown when the booking was saved as a VAT sale).
    const savedVat = money2(b.vat_amount);
    const agreedForVat = Number(b.agreed_price) > 0 ? money2(b.agreed_price) : 0;
    const vat = savedVat > 0 && agreedForVat > 0
        ? { rate: VAT_RATE_PERCENT, taxableCharges: agreedForVat, vatableSales: money2(agreedForVat - savedVat), vatAmount: savedVat }
        : null;
    return {
        booking: {
            id: Number(b.id), reference: b.booking_reference, name: b.customer_name, eventDate: b.eventDate,
            storeName: names[0]?.storeName || "", branchName: names[0]?.branchName || "",
            status: b.status, bookingType: b.booking_type, packageName: packageRow?.item_name_snapshot || "",
            agreedPrice: b.agreed_price == null ? null : Number(b.agreed_price),
            downPayment: Number(b.required_down_payment || 0), dpDeadline: b.dpDeadline || null,
            bookingPayments: m.bookingPaid, bookingRefunded: m.bookingRefunded,
            balance: closedStatus(b.status) ? 0 : Math.max(0, money2(total - m.bookingPaid)),
        },
        packageBase: q.packageBase, rentalSubtotal: q.rentalSubtotal, deliveryFee: 0, setupFee: 0,
        depositRequired: d.depositRequired, depositCollected: m.depositCollected,
        depositApplied: d.depositApplied, depositRefunded: m.depositRefunded, depositHeld: d.depositHeld,
        depositWaiverReason: null, salesSubtotal: q.salesSubtotal, agreedCharges: q.agreedCharges,
        claimBalance: d.claimBalance,
        salesItems: customConsumables.map((i) => ({
            name: i.item_name_snapshot, variantName: i.variant_name_snapshot || "",
            quantity: Number(i.quantity), unitPrice: Number(i.unit_price_snapshot), amount: Number(i.line_total),
        })),
        rentalItems: rentals.map((i) => ({
            name: i.item_name_snapshot, quantity: Number(i.quantity), days: Number(i.rental_days || 0),
            dailyRate: Number(i.unit_price_snapshot), amount: Number(i.line_total),
        })),
        claims: synthesizeClaims(b, items, m),
        cancellation,
        vat,
    };
}

// ─── Booking list query (replaces bookingSelectFields / bookingPageSelectFields) ─
function bookingListSql(whereSql) {
    return `
        SELECT b.id, b.store_id, b.branch_id, br.branch_name, b.booking_reference, b.booking_type,
               c.full_name, c.facebook_name, c.phone, c.email,
               DATE_FORMAT(b.event_date,'%Y-%m-%d') AS event_date,
               DATE_FORMAT(b.event_end_date,'%Y-%m-%d') AS event_end_date,
               TIME_FORMAT(b.event_time,'%H:%i') AS event_time,
               b.handover_method,
               DATE_FORMAT(COALESCE(b.handover_date,b.rental_start_date,b.event_date),'%Y-%m-%d') AS handover_date,
               TIME_FORMAT(COALESCE(b.handover_time,b.event_time),'%H:%i') AS handover_time,
               DATE_FORMAT(b.rental_end_date,'%Y-%m-%d') AS return_date,
               TIME_FORMAT(b.return_time,'%H:%i') AS return_time,
               b.event_type, b.theme, b.venue, b.custom_order, b.notes, b.status,
               b.agreed_price, b.package_price_snapshot, b.required_down_payment, b.refundable_deposit_required,
               b.approved_at, b.cancellation_reason,
               DATE_FORMAT(b.created_at,'%Y-%m-%d %H:%i:%s') AS created_at,
               COALESCE(it.package_name, pk.package_name, '') AS package_name,
               COALESCE(it.rental_lines,0) AS rental_lines,
               COALESCE(it.custom_lines,0) AS custom_lines,
               COALESCE(it.consumable_lines,0) AS consumable_lines,
               COALESCE(pay.booking_paid,0) AS booking_paid,
               COALESCE(pay.deposit_collected,0) AS deposit_collected,
               COALESCE(rf.booking_refunded,0) AS booking_refunded
        FROM bookings b
                 JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
                 LEFT JOIN branches br ON br.id=b.branch_id AND br.store_id=b.store_id
                 LEFT JOIN packages pk ON pk.id=b.package_id AND pk.store_id=b.store_id
                 LEFT JOIN (
            SELECT booking_id,
                   MAX(CASE WHEN item_type='${ITEM.PACKAGE}' THEN item_name_snapshot END) AS package_name,
                   -- Composition counts include cancelled lines, so a cancelled booking keeps its real type.
                   SUM(item_type='${ITEM.RENTAL}' AND item_status NOT LIKE 'claim%') AS rental_lines,
                   SUM(item_type='${ITEM.CONSUMABLE}' AND parent_item_id IS NULL AND item_status NOT LIKE 'claim%') AS custom_lines,
                   SUM(item_type='${ITEM.CONSUMABLE}' AND item_status NOT LIKE 'claim%') AS consumable_lines
            FROM booking_items WHERE store_id=? GROUP BY booking_id
        ) it ON it.booking_id=b.id
                 LEFT JOIN (
            SELECT booking_id,
                   SUM(CASE WHEN payment_type='${PAYMENT.BOOKING}' THEN amount ELSE 0 END) AS booking_paid,
                   SUM(CASE WHEN payment_type='${PAYMENT.DEPOSIT}' THEN amount ELSE 0 END) AS deposit_collected
            FROM payments WHERE store_id=? AND booking_id IS NOT NULL AND status='${PAYMENT.RECORDED}'
            GROUP BY booking_id
        ) pay ON pay.booking_id=b.id
                 LEFT JOIN (
            SELECT p.booking_id, SUM(r.amount) AS booking_refunded
            FROM refunds r JOIN payments p ON p.id=r.payment_id AND p.store_id=r.store_id
            WHERE r.refund_type='${REFUND.BOOKING}' AND LOWER(r.status) IN ('completed','processed') AND p.booking_id IS NOT NULL
            GROUP BY p.booking_id
        ) rf ON rf.booking_id=b.id
        WHERE ${whereSql}`;
}

// Same field names the frontend already reads (both snake_case and camelCase).
function mapBookingRow(r) {
    const total = bookingTotal(r);
    const paid = money2(r.booking_paid);
    const dp = Number(r.required_down_payment || 0);
    const agreed = r.agreed_price == null ? null : Number(r.agreed_price);
    const packagePrice = Number(r.package_price_snapshot || 0);
    const balance = closedStatus(r.status) ? 0 : Math.max(0, money2(total - paid));
    const paymentStatus = paymentStatusLabel(total, dp, paid);
    const deposit = Number(r.refundable_deposit_required || 0);
    return {
        id: Number(r.id),
        branchId: Number(r.branch_id), branch_id: Number(r.branch_id), branchName: r.branch_name || "",
        bookingReference: r.booking_reference, bookingType: r.booking_type,
        rentalItemCount: Number(r.rental_lines), customConsumableItemCount: Number(r.custom_lines),
        consumableItemCount: Number(r.consumable_lines),
        name: r.full_name, facebookName: r.facebook_name || "", phone: r.phone || "", email: r.email || "",
        date: r.event_date, eventEndDate: r.event_end_date, eventTime: r.event_time || "",
        handoverMethod: r.handover_method === "delivery" ? "delivery" : "pickup",
        handoverDate: r.handover_date || r.event_date, handoverTime: r.handover_time || "",
        returnDate: Number(r.rental_lines) > 0 ? (r.return_date || r.event_end_date || r.event_date) : "",
        returnTime: Number(r.rental_lines) > 0 ? (r.return_time || "") : "",
        eventType: r.event_type || "", eventName: r.event_type || "",
        package: r.package_name, packageName: r.package_name,
        customOrder: r.custom_order || "", theme: r.theme || "", venue: r.venue || "", notes: r.notes || "",
        status: normalizeBookingStatus(r.status) || r.status,
        agreed_price: agreed, agreedPrice: agreed,
        package_price: packagePrice, packagePrice,
        required_down_payment: dp, requiredDownPayment: dp,
        amount_paid: paid, amountPaid: paid, balance,
        amount_refunded: money2(r.booking_refunded), amountRefunded: money2(r.booking_refunded),
        payment_status: paymentStatus, paymentStatus,
        refundable_deposit: deposit, refundableDeposit: deposit,
        securityDepositRequired: deposit, securityDepositCollected: money2(r.deposit_collected),
        approvalStatus: r.approved_at ? "approved" : null, approvalReason: null,
        cancellationReason: r.cancellation_reason || null,
        createdAt: r.created_at,
    };
}

// ─── Inventory (v2 branch_inventory) ─────────────────────────────────────────
async function getVariantInventory(db, { storeId, branchId, variantId, lock = false }) {
    const [rows] = await db.execute(
        `SELECT id, on_hand_quantity, reserved_quantity, unavailable_quantity, status,
                DATE_FORMAT(expiration_date,'%Y-%m-%d') AS expirationDate
         FROM branch_inventory WHERE store_id=? AND branch_id=? AND variant_id=? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
        [Number(storeId), Number(branchId), Number(variantId)]);
    return rows[0] || null;
}

// Units that can still be promised for an event on `eventDate`.
function sellableUnits(inv, eventDate) {
    if (!inv || lower(inv.status) !== "active") return 0;
    if (inv.expirationDate && eventDate && inv.expirationDate < eventDate) return 0;
    return Math.max(0, Number(inv.on_hand_quantity) - Number(inv.reserved_quantity) - Number(inv.unavailable_quantity));
}

async function moveInventory(db, { storeId, branchId, inv, bucket, change, movementType, bookingId, actor, reason, unitCost = null }) {
    if (!change) return;
    const column = bucket === "reserved" ? "reserved_quantity" : "on_hand_quantity";
    const before = Number(inv[column]);
    const after = before + change;
    if (after < 0) throw rentalError(`Inventory ${bucket} quantity would become negative (have ${before}, change ${change}).`);
    await db.execute(`UPDATE branch_inventory SET ${column}=? WHERE id=?`, [after, inv.id]);
    inv[column] = after;
    await db.execute(
        `INSERT INTO inventory_movements
         (store_id, branch_id, branch_inventory_id, movement_type, quantity_bucket, quantity_change,
          quantity_before, quantity_after, unit_cost, reference_type, reference_id, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Number(storeId), Number(branchId), inv.id, movementType, bucket === "reserved" ? "reserved" : "on_hand",
            change, before, after, unitCost, MOVE.REF, Number(bookingId), reason || null, actor?.id ?? null]);
}

async function variantCost(db, variantId, storeId) {
    const [rows] = await db.execute(`SELECT cost_price FROM product_variants WHERE id=? AND store_id=?`, [variantId, storeId]);
    return rows.length ? Number(rows[0].cost_price) : null;
}

// Resolve a product/variant from the catalog. Products without variants use their default variant.
async function resolveVariant(db, { storeId, branchId, productId = null, variantId = null }) {
    const base = `SELECT pv.id AS variantId, pv.product_id AS productId, pv.variant_name, pv.selling_price,
                         pv.status AS vStatus, pv.deleted_at AS vDeleted, pv.is_default,
                         p.product_name, p.has_variants, p.status AS pStatus, p.deleted_at AS pDeleted,
                         cat.category_name
                  FROM product_variants pv
                           JOIN products p ON p.id=pv.product_id AND p.store_id=pv.store_id
                           LEFT JOIN categories cat ON cat.id=p.category_id AND cat.store_id=p.store_id`;
    let row;
    if (variantId) {
        const params = [Number(variantId), Number(storeId)];
        let sql = `${base} WHERE pv.id=? AND pv.store_id=?`;
        if (productId) { sql += " AND pv.product_id=?"; params.push(Number(productId)); }
        const [rows] = await db.execute(`${sql} LIMIT 1`, params);
        row = rows[0];
        if (!row) throw rentalError(`Selected variant is unavailable${productId ? ` for product #${productId}` : ""}.`);
    } else {
        const [rows] = await db.execute(
            `${base} WHERE pv.product_id=? AND pv.store_id=? AND pv.deleted_at IS NULL
             ORDER BY pv.is_default DESC, pv.id ASC LIMIT 2`, [Number(productId), Number(storeId)]);
        row = rows[0];
        if (!row) throw rentalError(`Product #${productId} is not available.`);
        if (Number(row.has_variants) === 1) throw rentalError(`Select a variant for ${row.product_name}.`);
    }
    if (row.pDeleted || row.vDeleted || lower(row.pStatus) !== "active" || lower(row.vStatus) !== "active")
        throw rentalError(`${row.product_name} is no longer active.`);
    const inv = await getVariantInventory(db, { storeId, branchId, variantId: row.variantId });
    if (!inv || lower(inv.status) !== "active")
        throw rentalError(`${row.product_name} is not stocked at the selected branch.`);
    return {
        variantId: Number(row.variantId), productId: Number(row.productId), productName: row.product_name,
        variantName: Number(row.has_variants) === 1 ? row.variant_name : null,
        category: row.category_name || "", price: Number(row.selling_price || 0),
    };
}

async function validatePublicBookingSalesItems(db, rawItems, storeId, branchId) {
    if (!Array.isArray(rawItems) || rawItems.length > 150) throw rentalError("Invalid custom inventory selection.");
    const result = [];
    const seen = new Set();
    for (const item of rawItems) {
        const productId = Number(item.productId ?? item.product_id ?? item.id);
        const rawVariant = item.variantId ?? item.variant_id;
        const variantId = rawVariant ? Number(rawVariant) : null;
        const qty = Number(item.quantity ?? item.qty ?? 1);
        if (!isId(productId) || (variantId !== null && !isId(variantId)) ||
            !Number.isSafeInteger(qty) || qty <= 0 || qty > 100000)
            throw rentalError("Invalid product or quantity in the custom booking.");
        const v = await resolveVariant(db, { storeId, branchId, productId, variantId });
        if (seen.has(v.variantId)) throw rentalError("Duplicate product or variant selected for this booking.");
        seen.add(v.variantId);
        const expected = item.salesPrice ?? item.sales_price ?? item.unitPrice;
        if (expected !== undefined && rentalMoneyCents(expected) !== rentalMoneyCents(v.price))
            throw rentalError(`Price changed for ${v.productName}. Refresh the booking quotation.`);
        result.push({ ...v, quantity: qty });
    }
    return result;
}

// ─── Rental equipment (v2 equipment + branch_inventory) ──────────────────────
async function loadBranchEquipment(db, { storeId, branchId, equipmentIds = null, lock = false }) {
    const params = [Number(branchId), Number(storeId)];
    let filter = "";
    if (equipmentIds) {
        if (!equipmentIds.length) return [];
        filter = ` AND e.id IN (${equipmentIds.map(() => "?").join(",")})`;
        params.push(...equipmentIds.map(Number));
    }
    const [rows] = await db.execute(
        `SELECT e.id, e.equipment_name AS name, cat.category_name AS category, e.rental_rate_per_day AS dailyRate,
                inv.id AS inventoryId, inv.on_hand_quantity AS onHand, inv.unavailable_quantity AS unavailable
         FROM equipment e
                  JOIN branch_inventory inv ON inv.equipment_id=e.id AND inv.store_id=e.store_id
             AND inv.branch_id=? AND LOWER(inv.status)='active'
                  LEFT JOIN categories cat ON cat.id=e.category_id AND cat.store_id=e.store_id
         WHERE e.store_id=? AND e.deleted_at IS NULL AND LOWER(e.status)='active'${filter}
         ORDER BY ${lock ? "e.id" : "e.equipment_name"} ${lock ? "FOR UPDATE OF inv" : "LIMIT 200"}`, params);
    return rows;
}

const equipmentCapacity = (e) => Math.max(0, Number(e.onHand) - Number(e.unavailable));

// Reserved / checked-out rental lines of OTHER bookings that overlap [from, to].
async function rentalAllocationsByEquipment(db, { storeId, branchId, equipmentIds, from, to, excludeBookingId = null }) {
    const map = new Map();
    if (!equipmentIds.length) return map;
    const [rows] = await db.execute(
        `SELECT bi.equipment_id AS equipmentId,
                CASE WHEN bi.item_status=? THEN GREATEST(bi.quantity-bi.returned_quantity,0) ELSE bi.quantity END AS quantity,
                CASE WHEN bi.item_status=? THEN 'checked_out' ELSE 'reserved' END AS status,
                DATE_FORMAT(COALESCE(b.rental_start_date,b.event_date),'%Y-%m-%d') AS startDate,
                DATE_FORMAT(COALESCE(b.rental_end_date,b.event_end_date,b.event_date),'%Y-%m-%d') AS endDate
         FROM booking_items bi JOIN bookings b ON b.id=bi.booking_id AND b.store_id=bi.store_id
         WHERE bi.store_id=? AND b.branch_id=? AND bi.item_type=?
           AND bi.equipment_id IN (${equipmentIds.map(() => "?").join(",")})
           AND bi.item_status IN (?,?) AND b.id<>?
           AND COALESCE(b.rental_start_date,b.event_date)<=?
           AND (COALESCE(b.rental_end_date,b.event_end_date,b.event_date)>=? OR bi.item_status=?)`,
        [ITEM_STATUS.RELEASED, ITEM_STATUS.RELEASED, Number(storeId), Number(branchId), ITEM.RENTAL,
            ...equipmentIds.map(Number), ITEM_STATUS.RESERVED, ITEM_STATUS.RELEASED,
            Number(excludeBookingId || 0), to, from, ITEM_STATUS.RELEASED]);
    for (const row of rows) {
        const id = Number(row.equipmentId);
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(row);
    }
    return map;
}

async function requireRentalCapacity(db, { storeId, branchId, needs, from, to, excludeBookingId, lock }) {
    // needs: Map equipmentId -> quantity
    const ids = [...needs.keys()].sort((a, b) => a - b);
    if (!ids.length) return new Map();
    const equipment = await loadBranchEquipment(db, { storeId, branchId, equipmentIds: ids, lock });
    const byId = new Map(equipment.map((e) => [Number(e.id), e]));
    const allocations = await rentalAllocationsByEquipment(db, { storeId, branchId, equipmentIds: ids, from, to, excludeBookingId });
    const today = rentalTodayManila();
    for (const id of ids) {
        const e = byId.get(id);
        if (!e) throw rentalError("Selected rental equipment is unavailable in this branch.");
        const peak = rentalPeakReserved(allocations.get(id) || [], from, to, today);
        const remaining = Math.max(0, equipmentCapacity(e) - peak);
        if (needs.get(id) > remaining)
            throw rentalError(`${e.name}: only ${remaining} unit(s) available for ${from} to ${to}. Please reduce the quantity or choose another date.`);
    }
    return byId;
}

function rentalNeeds(rentals) {
    const needs = new Map();
    for (const r of rentals) needs.set(Number(r.equipment_id), (needs.get(Number(r.equipment_id)) || 0) + Number(r.quantity));
    return needs;
}

// ─── Reservation / release / cancellation ────────────────────────────────────
// Confirmation: hold consumables in branch_inventory.reserved_quantity.
async function reserveBookingInventory(db, { booking, storeId, branchId, actor }) {
    const [items] = await db.execute(
        `SELECT id, variant_id, item_name_snapshot, variant_name_snapshot, quantity
         FROM booking_items WHERE booking_id=? AND store_id=? AND item_type=? AND item_status=?
         ORDER BY variant_id, id FOR UPDATE`,
        [Number(booking.id), Number(storeId), ITEM.CONSUMABLE, ITEM_STATUS.PENDING]);
    const byVariant = new Map();
    for (const item of items) {
        if (!isId(item.variant_id) || Number(item.quantity) <= 0)
            throw rentalError("A booking item is missing its valid product or quantity.");
        const list = byVariant.get(Number(item.variant_id)) || [];
        list.push(item);
        byVariant.set(Number(item.variant_id), list);
    }
    let reservedCount = 0;
    for (const [variantId, lines] of [...byVariant].sort(([a], [b]) => a - b)) {
        const label = lines[0].variant_name_snapshot ? `${lines[0].item_name_snapshot} — ${lines[0].variant_name_snapshot}` : lines[0].item_name_snapshot;
        const [check] = await db.execute(
            `SELECT pv.status AS vStatus, pv.deleted_at AS vDeleted, p.status AS pStatus, p.deleted_at AS pDeleted
             FROM product_variants pv JOIN products p ON p.id=pv.product_id AND p.store_id=pv.store_id
             WHERE pv.id=? AND pv.store_id=?`, [variantId, Number(storeId)]);
        if (!check.length || check[0].vDeleted || check[0].pDeleted ||
            lower(check[0].vStatus) !== "active" || lower(check[0].pStatus) !== "active")
            throw rentalError(`${label} is inactive for ${booking.eventDate}. Refresh the branch inventory.`);
        const inv = await getVariantInventory(db, { storeId, branchId, variantId, lock: true });
        const needed = lines.reduce((s, l) => s + Number(l.quantity), 0);
        const available = sellableUnits(inv, booking.eventDate);
        if (!inv) throw rentalError(`Inventory record not found for ${label} in this branch.`);
        if (available < needed)
            throw rentalError(`Not enough stock for ${label}. Available: ${available}, needed: ${needed}.`);
        await moveInventory(db, { storeId, branchId, inv, bucket: "reserved", change: needed, movementType: MOVE.RESERVE,
            bookingId: booking.id, actor, reason: `Reserved ${needed} unit(s) of ${label} for ${booking.booking_reference}.` });
        await db.execute(
            `UPDATE booking_items SET item_status=? WHERE id IN (${lines.map(() => "?").join(",")})`,
            [ITEM_STATUS.RESERVED, ...lines.map((l) => l.id)]);
        reservedCount += lines.length;
    }
    return { ok: true, reservedCount };
}

async function confirmRentalAllocations(db, { booking, storeId, branchId, price }) {
    const [lines] = await db.execute(
        `SELECT id, equipment_id, quantity, line_total FROM booking_items
         WHERE booking_id=? AND store_id=? AND item_type=? AND item_status=? ORDER BY equipment_id FOR UPDATE`,
        [Number(booking.id), Number(storeId), ITEM.RENTAL, ITEM_STATUS.PENDING]);
    if (!lines.length) return;
    // Only older Rental bookings have a price fixed by the daily rates; Custom prices may include a discount.
    const minimum = lines.reduce((s, l) => s + cents(l.line_total), 0) / 100;
    if (lower(booking.booking_type) === "rental" && (!Number.isFinite(Number(price)) || Number(price) < minimum - 0.005))
        throw rentalError(`Set an agreed booking price of at least ₱${minimum.toFixed(2)} before confirming this rental.`);
    // Locking the branch_inventory rows serializes confirmations of the same equipment.
    await requireRentalCapacity(db, { storeId, branchId, needs: rentalNeeds(lines), from: booking.rentalStart,
        to: booking.rentalEnd, excludeBookingId: booking.id, lock: true });
    await db.execute(`UPDATE booking_items SET item_status=? WHERE id IN (${lines.map(() => "?").join(",")})`,
        [ITEM_STATUS.RESERVED, ...lines.map((l) => l.id)]);
}

function getUsedItemsInput(body) {
    const raw = body.usedItems || body.used_items || body.cancelItems || body.cancel_items || [];
    let parsed = raw;
    if (typeof raw === "string") { try { parsed = JSON.parse(raw); } catch { parsed = []; } }
    return Array.isArray(parsed) ? parsed : [];
}

function usedQuantityFor(itemId, usedItems) {
    const match = usedItems.find((u) => Number(u.booking_item_id || u.bookingItemId || u.id || 0) === Number(itemId));
    if (!match) return 0;
    return Math.max(0, Math.floor(toNumber(match.used_quantity ?? match.usedQuantity ?? match.quantityUsed ?? 0)));
}

// ─── Product prices for cancellation refunds ─────────────────────────────────
// A package (or a custom quote) can cost less than its products at normal prices: a discount.
// For refunds, each consumable is valued at its share of the agreed deal:
//   Package: ratio = (package price) ÷ (normal value of consumables + rentals included in the package)
//            (older package bookings with extra rentals: those extras were charged at full price, so they are left out)
//   Custom:  ratio = (agreed price) ÷ (normal value of consumables + rental equipment), because a Custom
//            discount covers everything in the booking.
// No discount → ratio 1 (normal price). Never above 1, so a product is never valued above its normal price.
function consumablePriceRatio(booking, items) {
    const consumables = items.filter((i) => i.item_type === ITEM.CONSUMABLE);
    const rentals = items.filter((i) => i.item_type === ITEM.RENTAL);
    const custom = lower(booking.booking_type) === "custom";
    const includedRentalCents = rentals.filter((r) => r.parent_item_id).reduce((sum, r) =>
        sum + cents(r.unit_price_snapshot) * Number(r.quantity || 0) * Math.max(1, Number(r.rental_days || 1)), 0);
    const separateRentalCents = rentals.filter((r) => !r.parent_item_id).reduce((sum, r) => sum + cents(r.line_total), 0);
    const normalCents = consumables.reduce((sum, i) => sum + cents(i.unit_price_snapshot) * Number(i.quantity || 0), 0) +
        includedRentalCents + (custom ? separateRentalCents : 0);
    const agreedCents = cents(bookingTotal(booking)) - (custom ? 0 : separateRentalCents);
    if (!(normalCents > 0) || !(agreedCents > 0)) return 1;
    return Math.min(1, Math.max(0, agreedCents / normalCents));
}
const refundUnitPrice = (item, ratio) => money2(Number(item.unit_price_snapshot || 0) * ratio);
// Value of used products at the deal price: used quantity × the (rounded) price shown to the Manager,
// so the math on screen adds up. When EVERYTHING is used it is exactly the deal price (no ₱0.01 left over),
// and it is never more than the deal price.
function usedValueAtDealPrice(lines, ratio) {
    const shown = lines.reduce((sum, l) => sum + cents(Number(l.used || 0) * refundUnitPrice(l.item, ratio)), 0) / 100;
    const dealTotal = money2(ratio * lines.reduce((sum, l) => sum + Number(l.item.quantity || 0) * Number(l.item.unit_price_snapshot || 0), 0));
    const allUsed = lines.length > 0 && lines.every((l) => Number(l.used || 0) >= Number(l.item.quantity || 0));
    return allUsed ? dealTotal : Math.min(money2(shown), dealTotal);
}

// Cancellation: un-reserve unused consumables; units already used leave on_hand.
async function restoreBookingInventoryOnCancel(db, { booking, storeId, branchId, usedItems, actor }) {
    const items = await loadItems(db, booking.id, storeId, true);
    const priceRatio = consumablePriceRatio(booking, items);   // discounted price when the booking has a discount
    const rentals = items.filter((i) => i.item_type === ITEM.RENTAL && i.item_status !== ITEM_STATUS.CANCELLED);
    if (rentals.some((r) => r.item_status === ITEM_STATUS.RELEASED))
        throw rentalError("Receive the checked-out rental equipment before cancelling this booking.");
    if (rentals.some(isReturned))
        throw rentalError("Returned rentals already contain fulfilled charges; contact an administrator for refund adjustments.");
    let restoredCount = 0, restoredQuantity = 0, usedQuantity = 0;
    const usedLines = [];
    for (const item of items) {
        if (item.item_type !== ITEM.CONSUMABLE || item.item_status !== ITEM_STATUS.RESERVED) continue;
        const qty = Number(item.quantity);
        const used = Math.max(Number(item.used_quantity || 0), usedQuantityFor(item.id, usedItems));
        const label = item.variant_name_snapshot ? `${item.item_name_snapshot} — ${item.variant_name_snapshot}` : item.item_name_snapshot;
        if (used > qty) throw rentalError(`Used quantity for ${label} cannot exceed reserved quantity. Reserved: ${qty}, used: ${used}.`);
        const inv = await getVariantInventory(db, { storeId, branchId, variantId: item.variant_id, lock: true });
        if (!inv) throw rentalError(`Inventory record not found for ${label}.`);
        await moveInventory(db, { storeId, branchId, inv, bucket: "reserved", change: -qty, movementType: MOVE.UNRESERVE,
            bookingId: booking.id, actor, reason: `Cancelled ${booking.booking_reference}: released ${qty - used} unused reserved unit(s) of ${label}.` });
        if (used > 0) {
            await moveInventory(db, { storeId, branchId, inv, bucket: "on_hand", change: -used, movementType: MOVE.CANCEL_USED,
                bookingId: booking.id, actor, unitCost: await variantCost(db, item.variant_id, storeId),
                reason: `Cancelled ${booking.booking_reference}: ${used} unit(s) of ${label} were already used.` });
        }
        await db.execute(`UPDATE booking_items SET used_quantity=?, item_status=? WHERE id=?`, [used, ITEM_STATUS.CANCELLED, item.id]);
        restoredCount += 1;
        restoredQuantity += qty - used;
        usedQuantity += used;
        usedLines.push({ item, used });
    }
    const usedValue = usedValueAtDealPrice(usedLines, priceRatio);
    await db.execute(
        `UPDATE booking_items SET item_status=? WHERE booking_id=? AND store_id=? AND item_status IN (?,?)
                                                  AND (item_type<>? OR item_status=?)`,
        [ITEM_STATUS.CANCELLED, Number(booking.id), Number(storeId), ITEM_STATUS.PENDING, ITEM_STATUS.RESERVED,
            ITEM.CONSUMABLE, ITEM_STATUS.PENDING]);
    return { ok: true, restoredCount, restoredQuantity, usedQuantity, usedValue };
}

// ─── Confirmation checks ─────────────────────────────────────────────────────
async function inspectBookingForConfirmation(db, { bookingId, storeId, branchId, lock = false }) {
    const booking = await loadBooking(db, { bookingId, storeId, branchId, lock });
    if (!booking) throw rentalError("Booking does not belong to your assigned branch.");
    if (!["Pending Review", "Awaiting Down Payment"].includes(normalizeBookingStatus(booking.status)))
        throw rentalError("Only a reviewed, not-yet-confirmed booking can be approved or confirmed.");
    const items = await loadItems(db, bookingId, storeId);
    const money = await getBookingMoney(db, bookingId, storeId);
    const s = splitItems(items);
    const q = quoteFromItems(items);
    const reasons = [];
    const type = lower(booking.booking_type);
    const isPackage = type === "package", isCustom = type === "custom", isRental = type === "rental";
    if (!isPackage && !isCustom && !isRental) reasons.push("Unsupported booking type.");
    if (isCustom && !catalogOnlyBookingText(booking.custom_order,
        s.customConsumables.map((i) => ({ name: i.item_name_snapshot, quantity: i.quantity, amount: i.line_total })),
        s.extraRentals.map((i) => ({ name: i.item_name_snapshot, quantity: i.quantity, days: i.rental_days, amount: i.line_total }))))
        reasons.push("Customer requested work outside the verified catalog; Manager must review scope and quotation.");
    if (s.customConsumables.some((i) => Math.abs(Number(i.line_total) - Number(i.unit_price_snapshot) * Number(i.quantity)) > 0.01) ||
        s.consumables.some((i) => Number(i.quantity) <= 0))
        reasons.push("One or more catalog item amounts are inconsistent.");
    if (s.extraRentals.some((i) => Math.abs(Number(i.line_total) - Number(i.unit_price_snapshot) * Number(i.quantity) * Number(i.rental_days || 0)) > 0.01) ||
        s.includedRentals.some((i) => Math.abs(Number(i.line_total)) > 0.005))
        reasons.push("One or more rental line amounts are inconsistent.");
    if (isPackage && (!s.packageRow || Number(s.packageRow.line_total) <= 0 || Number(booking.package_price_snapshot || 0) <= 0))
        reasons.push("Package details or price are missing; Manager must verify the package.");
    if (isPackage && s.packageRow && !s.packageConsumables.length && !s.includedRentals.length)
        reasons.push("Package inventory lines are missing or inconsistent with its saved inclusions.");
    if (isRental && (!s.rentals.length || s.consumables.length || s.packageRow))
        reasons.push("Rental-only booking must contain rental equipment, without package or consumable items.");
    if (isCustom && !s.consumables.length && !s.rentals.length)
        reasons.push("There are no verified catalog items; custom scope requires Manager review.");
    const agreed = Number(booking.agreed_price || 0);
    if (!Number.isFinite(agreed) || agreed <= 0) reasons.push("The agreed booking price has not been set.");
    if (Math.abs(agreed - q.agreedCharges) > 0.01) reasons.push("Agreed price differs from the authorized catalog quotation.");
    const down = Number(booking.required_down_payment || 0);
    if (!Number.isFinite(down) || down < 0 || down > agreed) reasons.push("Down-payment terms are invalid.");
    if (money.bookingPaid < 0 || money.bookingPaid > agreed + 0.005) reasons.push("Recorded customer payment is invalid.");
    return { booking, items, money, reasons, baseline: q.agreedCharges, standardEligible: reasons.length === 0 };
}

const BLOCKING_REASON = /has not been set|has not been recorded|invalid|inconsistent|quotation is missing|do not match|missing/i;

async function checkAvailableBeforePayment(db, { booking, items, storeId, branchId }) {
    const s = splitItems(items);
    const byVariant = new Map();
    for (const c of s.consumables) byVariant.set(Number(c.variant_id), (byVariant.get(Number(c.variant_id)) || 0) + Number(c.quantity));
    for (const [variantId, qty] of byVariant) {
        const inv = await getVariantInventory(db, { storeId, branchId, variantId });
        if (sellableUnits(inv, booking.eventDate) < qty)
            throw rentalError("Insufficient sales inventory for the requested booking inclusions.");
    }
    if (s.rentals.length) {
        try {
            await requireRentalCapacity(db, { storeId, branchId, needs: rentalNeeds(s.rentals), from: booking.rentalStart,
                to: booking.rentalEnd, excludeBookingId: booking.id, lock: false });
        } catch (err) {
            if (err.rentalValidation) throw rentalError("Rental equipment is no longer available for the requested date range.");
            throw err;
        }
    }
}

function requireBookingDeposit(booking, money) {
    const total = bookingTotal(booking);
    const dp = Number(booking.required_down_payment ?? 0), paid = money.bookingPaid;
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(dp) || dp < 0 || dp > total || paid < 0 || paid > total + 0.005)
        throw rentalError("The agreed booking price or payment terms are invalid.");
    if (paid + 0.005 < dp) throw rentalError("Verify and record the required down payment before confirming and allocating items.");
    if (dp <= 0 && !booking.approved_by) throw rentalError("No-DP reservations require an explicit Manager authorization.");
}

async function requireCustomerReviewClear(db, { booking, storeId }) {
    const [rows] = await db.execute(
        `SELECT review_required, identity_verified, updated_at FROM customers WHERE id=? AND store_id=?`,
        [Number(booking.customer_id), Number(storeId)]);
    const c = rows[0];
    if (!c || Number(c.review_required) !== 1 || Number(c.identity_verified) !== 1) return;
    const [exceptions] = await db.execute(
        `SELECT id FROM employee_actions WHERE store_id=? AND entity_type='customer_case' AND entity_id=?
                                           AND action='confirmation_exception' AND created_at >= ? LIMIT 1`,
        [Number(storeId), Number(booking.id), c.updated_at]);
    if (!exceptions.length)
        throw rentalError("Customer review required. A Manager must verify the customer and document an exception for this booking before confirmation.");
}

// After a verified DP payment commits, try to confirm + reserve automatically.
async function confirmApprovedBookingAfterPayment(db, { bookingId, storeId, branchId, actor }) {
    try {
        return await withTransaction(db, async () => {
            const current = await loadBooking(db, { bookingId, storeId, branchId, lock: true });
            if (!current) throw rentalError("Booking was not found in the assigned branch.");
            if (normalizeBookingStatus(current.status) !== "Awaiting Down Payment")
                return { confirmed: false, status: normalizeBookingStatus(current.status) };
            const money = await getBookingMoney(db, bookingId, storeId);
            const required = Number(current.required_down_payment);
            if (!Number.isFinite(required) || required <= 0 || money.bookingPaid + 0.005 < required)
                return { confirmed: false, status: "Awaiting Down Payment" };
            const review = await inspectBookingForConfirmation(db, { bookingId, storeId, branchId });
            const blocking = review.reasons.filter((r) => BLOCKING_REASON.test(r));
            if (blocking.length) throw rentalError(blocking.join(" "));
            requireBookingDeposit(current, money);
            await requireCustomerReviewClear(db, { booking: current, storeId });
            const inventory = await reserveBookingInventory(db, { booking: current, storeId, branchId, actor });
            await confirmRentalAllocations(db, { booking: current, storeId, branchId, price: current.agreed_price });
            const [updated] = await db.execute(
                `UPDATE bookings SET status='Confirmed' WHERE id=? AND store_id=? AND branch_id=? AND status='Awaiting Down Payment'`,
                [Number(bookingId), Number(storeId), Number(branchId)]);
            if (updated.affectedRows !== 1) throw rentalError("Booking status changed while reserving items.");
            await logEmployeeAction(db, { storeId, branchId, actor, entityId: bookingId,
                referenceNumber: current.booking_reference, action: "Automatically confirmed after verified down payment",
                details: "Approved booking reached required DP; consumable inventory and rental equipment reserved." });
            return { confirmed: true, status: "Confirmed", reservedItems: inventory.reservedCount || 0 };
        });
    } catch (err) {
        return { confirmed: false, status: "Awaiting Down Payment", reservationIssue: err?.message || "Reservation could not be completed." };
    }
}

// ─── Completion / settlement checks ──────────────────────────────────────────
function requireRentalReturnBeforeCompletion(items) {
    const rentals = splitItems(items).rentals;
    if (rentals.some((r) => !isReturned(r)))
        throw rentalError("Receive and account for rented equipment before completing the booking.");
}

function requireRentalIncidentSettlement(booking, items, money, allowOutstanding = false) {
    const rentals = splitItems(items).rentals;
    if (rentals.some((r) => isReturned(r) && !r.inspected_at))
        throw rentalError("Staff must inspect all physically returned rental equipment before completing the booking.");
    if (incidentsFromItems(items).length && !booking.settlement_reviewed_at)
        throw rentalError("Manager must approve or waive the booking-linked damage or missing-equipment charge.");
    if (!allowOutstanding && depositFigures(booking, money).claimBalance > 0.005)
        throw rentalError("Record and verify all additional customer payments before completing the booking or refunding the deposit.");
}

async function automaticallyCompleteSettledBooking(db, bookingId, storeId) {
    const booking = await loadBooking(db, { bookingId, storeId, lock: true });
    if (!booking || normalizeBookingStatus(booking.status) !== "Pending Settlement") return false;
    const items = await loadItems(db, bookingId, storeId);
    const money = await getBookingMoney(db, bookingId, storeId);
    const total = bookingTotal(booking);
    if (!(total > 0) || money.bookingPaid + 0.005 < total) return false;
    const d = depositFigures(booking, money);
    if (money.depositCollected + 0.005 < d.depositRequired || d.depositHeld > 0.005) return false;
    if (splitItems(items).consumables.some((c) => c.item_status !== ITEM_STATUS.RELEASED)) return false;
    try {
        requireRentalReturnBeforeCompletion(items);
        requireRentalIncidentSettlement(booking, items, money);
    } catch (err) {
        if (err.rentalValidation) return false;
        throw err;
    }
    const [result] = await db.execute(
        `UPDATE bookings SET status='Completed', settlement_status='settled'
         WHERE id=? AND store_id=? AND status='Pending Settlement'`, [Number(bookingId), Number(storeId)]);
    return result.affectedRows === 1;
}

// Spread a deposit refund across the booking's deposit payments (refunds.payment_id is required).
async function refundDeposit(db, { booking, storeId, amount, actor, reason, method, requestKey }) {
    let remaining = cents(amount);
    if (remaining <= 0) return;
    const [deposits] = await db.execute(
        `SELECT p.id, p.amount,
                COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id AND r.store_id=p.store_id
                                                                AND LOWER(r.status) IN ('completed','processed')),0) AS refunded
         FROM payments p WHERE p.booking_id=? AND p.store_id=? AND p.payment_type=? AND p.status=?
         ORDER BY p.id FOR UPDATE`,
        [Number(booking.id), Number(storeId), PAYMENT.DEPOSIT, PAYMENT.RECORDED]);
    for (const p of deposits) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, cents(p.amount) - cents(p.refunded));
        if (take <= 0) continue;
        await db.execute(
            `INSERT INTO refunds (store_id, payment_id, refund_type, amount, refund_reason, refund_method,
                                  status, approved_by, processed_by, processed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [Number(storeId), p.id, REFUND.DEPOSIT, take / 100,
                `${requestKey ? `[${requestKey}] ` : ""}${reason || "Security deposit refund"}`.slice(0, 1000),
                String(method || "cash").slice(0, 50), REFUND.DONE, actor?.id ?? null, actor?.id ?? null]);
        remaining -= take;
    }
    if (remaining > 0) throw rentalError("Refund amount exceeds the security deposit still held.");
    await db.execute(`UPDATE bookings SET approved_refund_amount=approved_refund_amount+? WHERE id=? AND store_id=?`,
        [cents(amount) / 100, Number(booking.id), Number(storeId)]);
}

// Refund part of the booking payments when a booking is cancelled (refunds.payment_id is required).
async function refundBookingPayment(db, { booking, storeId, amount, actor, reason, method }) {
    let remaining = cents(amount);
    if (remaining <= 0) return;
    const [payments] = await db.execute(
        `SELECT p.id, p.amount,
                COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id=p.id AND r.store_id=p.store_id
                                                                AND LOWER(r.status) IN ('completed','processed')),0) AS refunded
         FROM payments p WHERE p.booking_id=? AND p.store_id=? AND p.payment_type=? AND p.status=?
         ORDER BY p.id DESC FOR UPDATE`,
        [Number(booking.id), Number(storeId), PAYMENT.BOOKING, PAYMENT.RECORDED]);
    for (const p of payments) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, cents(p.amount) - cents(p.refunded));
        if (take <= 0) continue;
        await db.execute(
            `INSERT INTO refunds (store_id, payment_id, refund_type, amount, refund_reason, refund_method,
                                  status, approved_by, processed_by, processed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [Number(storeId), p.id, REFUND.BOOKING, take / 100, String(reason || "Booking cancelled").slice(0, 1000),
                String(method || "cash").slice(0, 50), REFUND.DONE, actor?.id ?? null, actor?.id ?? null]);
        remaining -= take;
    }
    if (remaining > 0) throw rentalError("The refund is more than the booking payments received.");
}

// Cancellation policy (suggestion only; the Manager may change it): the store keeps the LARGER of
// the non-refundable down payment or the value of products already used; the rest is refunded.
function suggestedCancellationRefund(netPaid, downPayment, usedValue) {
    return Math.max(0, money2(Number(netPaid) - Math.max(Number(downPayment) || 0, Number(usedValue) || 0)));
}

// Validates the refund the Manager entered in the Cancel dialog against the locked booking figures.
function cancellationRefundPlan(impact, input, verified) {
    const paid = money2(impact.refundableBookingPayment);
    const missing = input === undefined || input === null || String(input).trim() === "";
    if (paid > 0.005 && missing)
        throw rentalError(`Enter how much of the ₱${paid.toFixed(2)} booking payment is refunded (₱0 if none) before cancelling.`);
    const bookingRefund = paid > 0.005 ? financeCurrency(input, "Booking payment refund") : 0;
    if (bookingRefund > paid + 0.005)
        throw rentalError(`The refund cannot be more than the ₱${paid.toFixed(2)} booking payment received.`);
    const depositRefund = money2(impact.depositHeld);
    if ((bookingRefund > 0 || depositRefund > 0) && !verified)
        throw rentalError("Confirm that the refund was actually given back to the customer before cancelling.");
    return { bookingRefund, depositRefund, retained: money2(paid - bookingRefund) };
}

async function insertPayment(db, { booking, storeId, type, amount, requestKey, actor, method, referenceNumber, notes }) {
    await db.execute(
        `INSERT INTO payments (store_id, branch_id, booking_id, payment_type, amount, payment_method,
                               reference_number, status, request_key, recorded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Number(storeId), Number(booking.branch_id), Number(booking.id), type, amount,
            String(method || "cash").slice(0, 50), referenceNumber ? String(referenceNumber).slice(0, 120) : null,
            PAYMENT.RECORDED, requestKey ? String(requestKey).slice(0, 120) : null, actor?.id ?? null, notes || null]);
}

// ─── Subscription booking limit (v2 subscriptions / plans / subscription_payments) ─
async function effectiveBookingLimit(db, storeId) {
    const [subRows] = await db.execute(
        `SELECT p.max_bookings, p.price, sub.expires_at, LOWER(sub.status) AS status,
                CASE WHEN sub.expires_at IS NULL OR DATE(sub.expires_at) >= CURDATE() THEN 1 ELSE 0 END AS not_expired
         FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id WHERE sub.store_id=? LIMIT 1`, [storeId]);
    const paid = subRows[0];
    let eligible = !!paid && ["active", "expiring"].includes(paid.status) && Number(paid.not_expired) === 1;
    if (paid && !eligible && ["active", "expiring"].includes(paid.status) && Number(paid.price) > 0) {
        const [grace] = await db.execute(
            `SELECT id FROM subscription_payments WHERE store_id=? AND LOWER(status)='pending'
                                                    AND DATE(submitted_at) <= DATE(?) AND CURDATE() <= DATE_ADD(DATE(?), INTERVAL 2 DAY) LIMIT 1`,
            [storeId, paid.expires_at, paid.expires_at]);
        eligible = grace.length > 0;
    }
    let plan = eligible ? paid : null;
    if (!plan) {
        const [starter] = await db.execute(
            `SELECT max_bookings FROM plans WHERE is_archived=0 AND (LOWER(plan_code)='starter' OR price=0)
             ORDER BY price ASC, id ASC LIMIT 1`);
        plan = starter[0] || null;
    }
    if (!plan) throw new Error("No effective subscription plan is configured.");
    const limit = Number(plan.max_bookings || 0);
    return limit > 0 ? limit : null;
}

async function findActiveBranch(db, storeId, branchId) {
    const [rows] = await db.execute(
        `SELECT id, branch_name AS branchName FROM branches WHERE id=? AND store_id=? AND LOWER(status)='active' LIMIT 1`,
        [Number(branchId), Number(storeId)]);
    return rows[0] || null;
}

async function findOrCreateCustomer(db, { storeId, name, phone, email, facebookName }) {
    const [rows] = await db.execute(
        `SELECT id FROM customers WHERE store_id=? AND phone=? AND LOWER(TRIM(full_name))=LOWER(TRIM(?)) ORDER BY id LIMIT 1`,
        [storeId, phone, name]);
    if (rows.length) {
        await db.execute(
            `UPDATE customers SET email=COALESCE(NULLIF(email,''),?), facebook_name=COALESCE(NULLIF(facebook_name,''),?) WHERE id=?`,
            [email, facebookName, rows[0].id]);
        return Number(rows[0].id);
    }
    const [created] = await db.execute(
        `INSERT INTO customers (store_id, full_name, phone, email, facebook_name) VALUES (?, ?, ?, ?, ?)`,
        [storeId, name, phone, email, facebookName]);
    return Number(created.insertId);
}

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC ACTIONS (no login)
// ═════════════════════════════════════════════════════════════════════════════
const PUBLIC_ACTIONS = {
    async get_public_branches(db, body) {
        const sid = Number(body.storeId ?? body.store_id);
        if (!isId(sid)) return response(400, { error: "Valid store ID required." });
        const [rows] = await db.execute(
            `SELECT id, branch_name AS branchName FROM branches WHERE store_id=? AND LOWER(status)='active'
             ORDER BY branch_name, id LIMIT 100`, [sid]);
        return response(200, { branches: rows.map((b) => ({ id: Number(b.id), name: String(b.branchName) })) });
    },

    async get_public_rental_catalog(db, body) {
        const storeId = Number(body.storeId ?? body.store_id);
        const branchId = Number(body.branchId ?? body.branch_id ?? 0);
        if (!isId(storeId) || !isId(branchId))
            return response(400, { error: "Select a valid branch before viewing rental equipment." });
        const startInput = body.startDate ?? body.start_date, endInput = body.endDate ?? body.end_date;
        const withDates = startInput != null && endInput != null && startInput !== "" && endInput !== "";
        if (!withDates && ((startInput != null && startInput !== "") || (endInput != null && endInput !== "")))
            return response(400, { error: "Select both rental start and end dates." });
        let startDate = null, endDate = null;
        if (withDates) {
            startDate = rentalDate(startInput, "Rental start date");
            endDate = rentalDate(endInput, "Rental end date");
            rentalDays(startDate, endDate);
        }
        const branch = await findActiveBranch(db, storeId, branchId);
        if (!branch) return response(404, { error: "Branch not found for this store." });
        const items = (await loadBranchEquipment(db, { storeId, branchId }))
            .filter((e) => Number(e.dailyRate) > 0 && equipmentCapacity(e) > 0);
        const today = rentalTodayManila();
        const from = withDates && startDate < today ? startDate : today;
        const to = withDates && endDate > today ? endDate : today;
        const allocations = await rentalAllocationsByEquipment(db, { storeId, branchId, equipmentIds: items.map((e) => Number(e.id)), from, to });
        return response(200, {
            branchId, branchName: branch.branchName, startDate, endDate, availabilityForDates: withDates,
            equipment: items.map((e) => {
                const capacity = equipmentCapacity(e);
                const list = allocations.get(Number(e.id)) || [];
                const checkedOut = list.filter((a) => a.status === "checked_out").reduce((s, a) => s + Number(a.quantity), 0);
                const reservedForDates = withDates ? rentalPeakReserved(list, startDate, endDate, today) : null;
                return {
                    id: Number(e.id), name: e.name, category: e.category || "Other", dailyRate: Number(e.dailyRate),
                    physicallyAvailable: Math.max(0, capacity - checkedOut),
                    bookableToday: Math.max(0, capacity - rentalPeakReserved(list, today, today, today)),
                    reservedForDates, availableForDates: withDates ? Math.max(0, capacity - reservedForDates) : null,
                };
            }),
        });
    },

    async get_public_booking_fees(db, body) {
        const sid = Number(body.storeId || body.store_id), bid = Number(body.branchId || body.branch_id);
        if (!isId(sid) || !isId(bid)) return response(400, { error: "Store and branch required." });
        if (!(await findActiveBranch(db, sid, bid))) return response(404, { error: "Branch not found." });
        return response(200, { policy: { ...FEE_POLICY_V2 } });
    },

    async get_public_booking_statement(db, body) {
        const ref = String(body.bookingReference || "").trim(), phone = String(body.phone || "").trim();
        if (!ref || !phone) return response(400, { error: "Booking reference and phone required." });
        const [rows] = await db.execute(
            `SELECT b.id, b.store_id FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
             WHERE b.booking_reference=? AND c.phone=? LIMIT 1`, [ref, phone]);
        if (!rows.length) return response(404, { error: "Booking not found." });
        return response(200, { statement: await getBookingStatement(db, rows[0].id, rows[0].store_id) });
    },

    async create_booking(db, body) {
        const storeId = Number(body.storeId || body.store_id);
        const branchId = Number(body.branchId ?? body.branch_id);
        if (!isId(storeId) || !isId(branchId))
            return response(400, { error: "Select a valid store branch before submitting a booking." });
        if (!(await findActiveBranch(db, storeId, branchId)))
            return response(400, { error: "The selected branch does not belong to this store." });

        let rentalSelections = parseRentalSelection(body.rentalItems);
        const bookingType = lower(body.bookingType || body.booking_type);
        const isPackage = bookingType === "package", isCustom = bookingType === "custom", isRental = bookingType === "rental";
        const name = limitText(body.name, 150, "Full name");
        const phone = limitText(body.phone, 40, "Phone number");
        const email = limitText(body.email, 255, "Email");
        const facebookName = limitText(body.facebookName || body.facebook_name, 150, "Messenger name");
        const eventDate = body.date || body.event_date;
        if (!bookingType || !name || !phone || !eventDate) return response(400, { error: "Missing required booking fields" });
        if (!isPackage && !isCustom && !isRental) return response(400, { error: "Choose Package, Custom, or Rental Booking." });

        const startDate = rentalDate(eventDate, "Event start date");
        const endDate = rentalDate(body.eventEndDate || body.event_end_date || body.rentalEndDate || startDate, "Event end date");
        rentalDays(startDate, endDate);
        const eventType = limitText(body.eventType || body.event_type || (isRental ? "Equipment Rental" : "Based on selected package"), 100, "Event type");
        const theme = limitText(body.theme, 150, "Theme / motif");
        const customOrder = String(body.customOrder || body.custom_order || "").trim();
        const rawItems = Array.isArray(body.bookingItems) ? body.bookingItems : Array.isArray(body.booking_items) ? body.booking_items : [];
        if (isRental && !rentalSelections.length) return response(400, { error: "Select at least one rental equipment item." });
        if (isRental && (body.packageId || body.package_id)) return response(400, { error: "Rental-only bookings cannot include a package." });
        if (isRental && rawItems.length) return response(400, { error: "Rental-only bookings cannot contain consumable items." });
        // Packages are fixed sets: their rental equipment comes from the package itself. Customers who want
        // something different message the store, and the Manager adjusts or creates a package for them.
        if (isPackage && rentalSelections.length)
            return response(400, { error: "Packages are fixed sets. Extra rental equipment can't be added to a package; message the store to change your order." });

        const bookingLimit = await effectiveBookingLimit(db, storeId);
        if (bookingLimit !== null) {
            const [monthly] = await db.execute(
                `SELECT COUNT(*) AS total FROM bookings WHERE store_id=?
                                                          AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                                                          AND created_at < DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')`, [storeId]);
            if (Number(monthly[0]?.total || 0) >= bookingLimit)
                return response(409, { error: `This store has reached its ${bookingLimit} new bookings for this month. Existing reservations remain available.`, code: "SUBSCRIPTION_BOOKING_LIMIT" });
        }

        // Package comes from the database only (packages + package_items).
        let pkg = null, packageLines = [];
        if (isPackage) {
            const packageId = Number(body.packageId || body.package_id ||
                (typeof body.package === "object" && body.package ? body.package.id : 0));
            if (!isId(packageId)) return response(400, { error: "Please select a valid package from the branch catalog." });
            const [rows] = await db.execute(
                `SELECT id, package_name, package_price, down_payment_amount FROM packages
                 WHERE id=? AND store_id=? AND branch_id=? AND LOWER(status)='active' LIMIT 1`, [packageId, storeId, branchId]);
            pkg = rows[0];
            if (!pkg) return response(400, { error: "Selected package is not active or does not belong to this branch." });
            const rawName = typeof body.package === "string" ? cleanPackageName(body.package) : cleanPackageName(body.packageName || body.package_name);
            if (rawName && normalizeText(pkg.package_name) !== normalizeText(rawName))
                return response(400, { error: "Package mismatch: selected package name does not match package snapshot",
                    selectedPackageName: rawName, snapshotPackageName: pkg.package_name });
            if (body.expectedPackagePrice !== undefined && rentalMoneyCents(body.expectedPackagePrice) !== rentalMoneyCents(pkg.package_price))
                return response(409, { error: "This package price has changed. Refresh the quotation before booking." });
            const [lines] = await db.execute(
                `SELECT item_type, variant_id, equipment_id, quantity FROM package_items
                 WHERE package_id=? AND store_id=? ORDER BY sort_order, id`, [packageId, storeId]);
            packageLines = lines;
            if (!packageLines.length) return response(409, { error: "This package has no inventory or rental inclusions. Ask the branch to review it." });
        }

        // Combine package-included rentals with optional customer-paid extras.
        const rentalPlan = new Map(rentalSelections.map((l) => [l.equipmentId, { extra: l.quantity, included: 0, expectedDailyRate: l.expectedDailyRate }]));
        for (const line of packageLines.filter((l) => l.item_type === ITEM.RENTAL)) {
            const id = Number(line.equipment_id);
            const entry = rentalPlan.get(id) || { extra: 0, included: 0 };
            entry.included += Number(line.quantity);
            rentalPlan.set(id, entry);
        }
        if (rentalPlan.size > 30) return response(409, { error: "Too many rental equipment types in this booking." });
        const schedule = parseBookingSchedule(body, { startDate, endDate, hasRentals: rentalPlan.size > 0 });
        const venue = body.venue ? String(body.venue).trim() : "";
        if (schedule.method === "delivery" && !venue)
            return response(400, { error: "Enter the delivery address in Venue." });
        if (rentalPlan.size && schedule.handoverDate < rentalTodayManila())
            return response(400, { error: `${handoverLabel(schedule.method)} date cannot be in the past.` });
        // Rental period = pickup/delivery date → return date.
        const rentalStart = schedule.handoverDate, rentalEnd = schedule.returnDate || endDate;
        // Old field kept for older screens: event_time now holds the pickup/delivery time.
        const eventTime = schedule.handoverTime;

        let reference = String(body.bookingReference || body.booking_reference || "").trim() || generateBookingReference();
        if (reference.length > 80) return response(400, { error: "Booking reference must be at most 80 characters." });

        try {
            return await withTransaction(db, async () => {
                const customerId = await findOrCreateCustomer(db, { storeId, name, phone, email, facebookName });
                const packagePrice = isPackage ? Number(pkg.package_price) : 0;
                const requiredDownPayment = isPackage ? Number(pkg.down_payment_amount || 0) : 0;
                const [result] = await db.execute(
                    `INSERT INTO bookings
                     (store_id, branch_id, booking_reference, customer_id, package_id, booking_type, event_type, theme,
                      event_date, event_end_date, event_time, venue, handover_method, handover_date, handover_time,
                      rental_start_date, rental_end_date, return_time, custom_order,
                      notes, status, package_price_snapshot, agreed_price, required_down_payment, refundable_deposit_required)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Review', ?, NULL, ?, 0)`,
                    [storeId, branchId, reference, customerId, isPackage ? Number(pkg.id) : null, bookingType, eventType, theme,
                        startDate, endDate, eventTime, venue || null, schedule.method, schedule.handoverDate, schedule.handoverTime,
                        rentalPlan.size ? rentalStart : null, rentalPlan.size ? rentalEnd : null,
                        rentalPlan.size ? schedule.returnTime : null,
                        customOrder || null, String(body.notes || "").trim() || null,
                        isPackage ? packagePrice : null, requiredDownPayment]);
                const bookingId = result.insertId;
                const insertItem = async (fields) => {
                    const [r] = await db.execute(
                        `INSERT INTO booking_items (store_id, booking_id, parent_item_id, package_id, variant_id, equipment_id,
                                                    item_type, item_name_snapshot, variant_name_snapshot, quantity, rental_days,
                                                    unit_price_snapshot, line_total, item_status)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [storeId, bookingId, fields.parentId ?? null, fields.packageId ?? null, fields.variantId ?? null,
                            fields.equipmentId ?? null, fields.type, String(fields.name).slice(0, 180),
                            fields.variantName ? String(fields.variantName).slice(0, 150) : null, fields.quantity,
                            fields.days ?? null, fields.unitPrice, fields.lineTotal, ITEM_STATUS.PENDING]);
                    return r.insertId;
                };

                let packageRowId = null;
                if (isPackage) {
                    packageRowId = await insertItem({ type: ITEM.PACKAGE, packageId: Number(pkg.id), name: pkg.package_name,
                        quantity: 1, unitPrice: packagePrice, lineTotal: packagePrice });
                    for (const line of packageLines.filter((l) => l.item_type === ITEM.CONSUMABLE)) {
                        const v = await resolveVariant(db, { storeId, branchId, variantId: line.variant_id });
                        await insertItem({ type: ITEM.CONSUMABLE, parentId: packageRowId, variantId: v.variantId, name: v.productName,
                            variantName: v.variantName, quantity: Number(line.quantity), unitPrice: v.price, lineTotal: 0 });
                    }
                }
                let customSales = 0;
                const savedSales = [];
                if (isCustom) {
                    for (const v of await validatePublicBookingSalesItems(db, rawItems, storeId, branchId)) {
                        const lineTotal = money2(v.price * v.quantity);
                        customSales = money2(customSales + lineTotal);
                        savedSales.push({ name: v.productName, quantity: v.quantity, amount: lineTotal });
                        await insertItem({ type: ITEM.CONSUMABLE, variantId: v.variantId, name: v.productName,
                            variantName: v.variantName, quantity: v.quantity, unitPrice: v.price, lineTotal });
                    }
                }
                let rentalTotal = 0;
                const savedRentals = [];
                if (rentalPlan.size) {
                    const days = rentalDays(rentalStart, rentalEnd);
                    const needs = new Map([...rentalPlan].map(([id, e]) => [id, e.extra + e.included]));
                    const equipment = await requireRentalCapacity(db, { storeId, branchId, needs, from: rentalStart, to: rentalEnd, lock: false });
                    for (const [equipmentId, entry] of [...rentalPlan].sort(([a], [b]) => a - b)) {
                        const e = equipment.get(equipmentId);
                        const rate = rentalMoneyCents(e.dailyRate);
                        if (entry.expectedDailyRate !== undefined && rentalMoneyCents(entry.expectedDailyRate) !== rate)
                            throw rentalError(`${e.name}: the daily rental rate changed. Refresh the quotation.`);
                        if (entry.extra > 0 && rate <= 0) throw rentalError(`${e.name}: daily rental price has not been set.`);
                        if (entry.included > 0)
                            await insertItem({ type: ITEM.RENTAL, parentId: packageRowId, equipmentId, name: e.name,
                                quantity: entry.included, days, unitPrice: rate / 100, lineTotal: 0 });
                        if (entry.extra > 0) {
                            const lineTotal = (rate * entry.extra * days) / 100;
                            rentalTotal = money2(rentalTotal + lineTotal);
                            savedRentals.push({ name: e.name, quantity: entry.extra, days, amount: lineTotal });
                            await insertItem({ type: ITEM.RENTAL, equipmentId, name: e.name, quantity: entry.extra, days,
                                unitPrice: rate / 100, lineTotal });
                        }
                    }
                }
                const expectedPolicy = body.expectedFeePolicy;
                if (expectedPolicy && (rentalMoneyCents(expectedPolicy.deliveryFee || 0) !== 0 ||
                    rentalMoneyCents(expectedPolicy.setupFee || 0) !== 0 || rentalMoneyCents(expectedPolicy.refundableDeposit || 0) !== 0))
                    throw rentalError("Service fees or deposit policy changed. Refresh the booking quotation.");
                const authoritativeTotal = money2(packagePrice + customSales + rentalTotal);
                const catalogOnly = isPackage || isRental || catalogOnlyBookingText(customOrder, savedSales, savedRentals);
                if (catalogOnly && authoritativeTotal > 0)
                    await db.execute(`UPDATE bookings SET agreed_price=? WHERE id=?`, [authoritativeTotal, bookingId]);
                await saveBookingVat(db, { bookingId, storeId });
                return response(201, {
                    success: true, id: bookingId, bookingReference: reference,
                    quoted_booking_charges: authoritativeTotal, refundable_deposit_required: 0,
                    service_fees: { delivery: 0, setup: 0 }, package_price: packagePrice,
                    required_down_payment: requiredDownPayment,
                    balance: catalogOnly ? authoritativeTotal : packagePrice,
                    agreed_price: catalogOnly && authoritativeTotal > 0 ? authoritativeTotal : null,
                    payment_status: "Unpaid",
                    booking_items_saved: savedSales.length + packageLines.filter((l) => l.item_type === ITEM.CONSUMABLE).length,
                    rental_items_saved: rentalPlan.size, rental_quoted_subtotal: rentalTotal,
                });
            });
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") return response(409, { error: "Booking reference is already used. Please submit again." });
            if (err.rentalValidation || rentalSelections.length) return response(409, { error: err.message });
            throw err;
        }
    },

    async get_booking_by_reference(db, body) {
        const ref = body.bookingReference || body.booking_reference;
        if (!ref) return response(400, { error: "Missing bookingReference" });
        const [found] = await db.execute(`SELECT id, store_id FROM bookings WHERE booking_reference=? LIMIT 1`, [String(ref)]);
        if (!found.length) return response(404, { error: "Booking not found" });
        const sid = Number(found[0].store_id);
        const [rows] = await db.execute(bookingListSql("b.id=? AND b.store_id=?"), [sid, sid, found[0].id, sid]);
        return response(200, { booking: mapBookingRow(rows[0]) });
    },

    async get_bookings_by_phone(db, body) {
        const phone = String(body.phone || "").trim();
        const sid = Number(body.storeId || body.store_id);
        if (!phone || !isId(sid)) return response(400, { error: "Missing phone or storeId" });
        const [rows] = await db.execute(bookingListSql("b.store_id=? AND c.phone=?") + " ORDER BY b.created_at DESC",
            [sid, sid, sid, phone]);
        return response(200, { bookings: rows.map(mapBookingRow) });
    },

    async get_public_bookings(db, body) {
        const sid = Number(body.storeId || body.store_id);
        if (!isId(sid)) return response(400, { error: "Missing storeId" });
        const [rows] = await db.execute(
            `SELECT b.id, c.full_name AS name, DATE_FORMAT(b.event_date,'%Y-%m-%d') AS date, b.status
             FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
             WHERE b.store_id=? ORDER BY b.created_at DESC`, [sid]);
        return response(200, { bookings: rows });
    },

    // The public portal's "Cancel Booking" button (missing from the old Lambda).
    async cancel_booking(db, body) {
        const ref = String(body.bookingReference || body.booking_reference || "").trim();
        if (!ref) return response(400, { error: "Missing bookingReference" });
        return withTransaction(db, async () => {
            const [rows] = await db.execute(
                `SELECT b.id, b.store_id, b.status, c.phone FROM bookings b
                                                                     JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
                 WHERE b.booking_reference=? LIMIT 1 FOR UPDATE OF b`, [ref]);
            if (!rows.length) return response(404, { error: "Booking not found" });
            const b = rows[0];
            if (body.phone && String(body.phone).trim() !== String(b.phone || "")) return response(404, { error: "Booking not found" });
            if (normalizeBookingStatus(b.status) !== "Pending Review")
                return response(409, { error: "Only bookings still in Pending Review can be cancelled online. Contact the store." });
            await db.execute(`UPDATE bookings SET status='Cancelled', cancellation_reason=? WHERE id=?`,
                ["Cancelled by customer through the booking portal.", b.id]);
            await db.execute(`UPDATE booking_items SET item_status=? WHERE booking_id=? AND store_id=? AND item_status=?`,
                [ITEM_STATUS.CANCELLED, b.id, b.store_id, ITEM_STATUS.PENDING]);
            return response(200, { success: true, status: "Cancelled" });
        });
    },
};

// ═════════════════════════════════════════════════════════════════════════════
//  PROTECTED ACTIONS (login required). ctx = { db, body, storeId, role, branchId, actor, access, salesAccess }
// ═════════════════════════════════════════════════════════════════════════════
function requireBookingId(body) {
    const id = Number(body.bookingId || body.booking_id);
    if (!isId(id)) throw Object.assign(rentalError("Valid booking ID required."), { status: 400 });
    return id;
}

async function bookingForCtx(ctx, bookingId, lock = false) {
    const b = await loadBooking(ctx.db, { bookingId, storeId: ctx.storeId, lock });
    if (!b) return null;
    if (ctx.role !== "owner" && Number(b.branch_id) !== Number(ctx.branchId)) return "forbidden";
    return b;
}

const PROTECTED_ACTIONS = {
    // ── Lists ────────────────────────────────────────────────────────────────
    async get_booking_page_bookings(ctx) {
        const { body, storeId } = ctx;
        const rawFrom = body.date_from ?? body.dateFrom, rawTo = body.date_to ?? body.dateTo;
        const dateFrom = normalizeDateFilter(rawFrom), dateTo = normalizeDateFilter(rawTo);
        if ((rawFrom && !dateFrom) || (rawTo && !dateTo)) return response(400, { error: "Invalid booking date filter. Use YYYY-MM-DD." });
        if (dateFrom && dateTo && dateFrom > dateTo) return response(400, { error: "date_from cannot be later than date_to." });
        let where = "b.store_id=?";
        const params = [storeId, storeId, storeId];
        const branchId = body.branch_id || body.branchId;
        if (branchId) { where += " AND b.branch_id=?"; params.push(Number(branchId)); }
        if (dateFrom) { where += " AND b.event_date>=?"; params.push(dateFrom); }
        if (dateTo) { where += " AND b.event_date<=?"; params.push(dateTo); }
        const [rows] = await ctx.db.execute(bookingListSql(where) + " ORDER BY b.created_at DESC", params);
        return response(200, { bookings: rows.map(mapBookingRow), total: rows.length });
    },

    async get_bookings(ctx) {
        const branchId = ctx.body.branch_id || ctx.body.branchId;
        const params = [ctx.storeId, ctx.storeId, ctx.storeId];
        let where = "b.store_id=?";
        if (branchId) { where += " AND b.branch_id=?"; params.push(Number(branchId)); }
        const [rows] = await ctx.db.execute(bookingListSql(where) + " ORDER BY b.created_at DESC", params);
        return response(200, { bookings: rows.map(mapBookingRow) });
    },

    async get_dashboard_bookings(ctx) {
        const branchId = ctx.body.branch_id || ctx.body.branchId;
        const params = [ctx.storeId];
        let sql = `SELECT b.id, b.branch_id AS branchId, br.branch_name AS branchName, c.full_name AS name,
                          DATE_FORMAT(b.event_date,'%Y-%m-%d') AS date, b.status,
                          COALESCE((SELECT bi.item_name_snapshot FROM booking_items bi WHERE bi.booking_id=b.id
                                    AND bi.store_id=b.store_id AND bi.item_type='${ITEM.PACKAGE}' LIMIT 1), '') AS packageName,
                          b.event_type AS eventName, DATE_FORMAT(b.created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
                   FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
                       LEFT JOIN branches br ON br.id=b.branch_id AND br.store_id=b.store_id
                   WHERE b.store_id=?`;
        if (branchId) { sql += " AND b.branch_id=?"; params.push(Number(branchId)); }
        const [rows] = await ctx.db.execute(`${sql} ORDER BY b.created_at DESC`, params);
        return response(200, { bookings: rows, total: rows.length });
    },

    // ── Items & availability ─────────────────────────────────────────────────
    async get_booking_items(ctx) {
        const bookingId = requireBookingId(ctx.body);
        const b = await bookingForCtx(ctx, bookingId);
        if (!b) return response(404, { error: "Booking not found" });
        if (b === "forbidden") return response(403, { error: "You cannot access a different branch." });
        const items = await loadItems(ctx.db, bookingId, ctx.storeId);
        const branchId = Number(b.branch_id);
        const consumables = items.filter((i) => i.item_type === ITEM.CONSUMABLE);
        const rentals = items.filter((i) => i.item_type === ITEM.RENTAL);
        const priceRatio = consumablePriceRatio(b, items);
        const enrichedSales = [];
        for (const item of consumables) {
            let available = null, note = null;
            try {
                const inv = await getVariantInventory(ctx.db, { storeId: ctx.storeId, branchId, variantId: item.variant_id });
                if (!inv) note = "Active inventory record not found.";
                else {
                    const ownHeld = item.item_status === ITEM_STATUS.RESERVED ? Math.max(0, Number(item.quantity) - Number(item.used_quantity || 0)) : 0;
                    available = sellableUnits(inv, b.eventDate) + ownHeld;
                    if (lower(inv.status) !== "active") note = "Product or variant is inactive.";
                }
            } catch (err) {
                console.warn("Consumable availability not verified", item.id, err?.message || err);
                note = "Current consumable stock could not be verified.";
            }
            const qty = Number(item.quantity), used = Number(item.used_quantity || 0);
            enrichedSales.push({
                id: Number(item.id), booking_id: bookingId, source_type: item.parent_item_id ? "package" : "custom",
                package_id: null, product_id: item.product_id == null ? null : Number(item.product_id),
                variant_id: Number(item.variant_id), product_name: item.item_name_snapshot,
                variant_name: item.variant_name_snapshot, category: item.category_name || "",
                booked_quantity: qty,
                reserved_quantity: item.item_status === ITEM_STATUS.RESERVED || item.item_status === ITEM_STATUS.RELEASED ? qty : 0,
                used_quantity: used,
                restored_quantity: item.item_status === ITEM_STATUS.CANCELLED ? Math.max(0, qty - used) : 0,
                unit_price: Number(item.unit_price_snapshot),
                // Price used for cancellation refunds: the discounted price if the package / quote has a discount.
                refund_unit_price: refundUnitPrice(item, priceRatio),
                refund_price_ratio: priceRatio,
                estimated_subtotal: item.parent_item_id ? money2(Number(item.unit_price_snapshot) * qty) : Number(item.line_total),
                used_subtotal: money2(Number(item.unit_price_snapshot) * used),
                inventory_status: item.item_status,
                prepared: !!item.prepared_at, issued: !!item.released_at,
                available_for_booking: available, availability_note: note,
            });
        }
        const enrichedRentals = [];
        if (rentals.length) {
            const ids = [...new Set(rentals.map((r) => Number(r.equipment_id)))];
            const equipment = new Map((await loadBranchEquipment(ctx.db, { storeId: ctx.storeId, branchId, equipmentIds: ids })).map((e) => [Number(e.id), e]));
            const allocations = await rentalAllocationsByEquipment(ctx.db, { storeId: ctx.storeId, branchId, equipmentIds: ids,
                from: b.rentalStart, to: b.rentalEnd, excludeBookingId: bookingId });
            const today = rentalTodayManila();
            for (const item of rentals) {
                const e = equipment.get(Number(item.equipment_id));
                const available = e ? Math.max(0, equipmentCapacity(e) - rentalPeakReserved(allocations.get(Number(item.equipment_id)) || [], b.rentalStart, b.rentalEnd, today)) : null;
                const status = allocationLabel(item);
                enrichedRentals.push({
                    id: Number(item.id), equipment_id: Number(item.equipment_id), equipment_name: item.item_name_snapshot,
                    quantity: Number(item.quantity), start_date: b.rentalStart, end_date: b.rentalEnd,
                    billable_days: Number(item.rental_days || 0), daily_rate: Number(item.unit_price_snapshot),
                    rental_rate: Number(item.unit_price_snapshot), agreed_line_total: Number(item.line_total),
                    amount: Number(item.line_total), included_in_package: !!item.parent_item_id,
                    allocation_status: status, returned_quantity: Number(item.returned_quantity || 0),
                    damaged_quantity: Number(item.damaged_quantity || 0), missing_quantity: Number(item.missing_quantity || 0),
                    available_for_event: available,
                    availability_note: e ? null : "Rental equipment is unavailable in this branch.",
                });
            }
        }
        return response(200, {
            success: true,
            booking: { id: bookingId, status: b.status, store_id: ctx.storeId, branch_id: branchId,
                booking_reference: b.booking_reference, event_date: b.eventDate },
            items: enrichedSales, rentalItems: enrichedRentals,
            // 0 when there is no discount; e.g. 8.3 when the package costs 8.3% less than its products at normal prices.
            consumableDiscountPercent: Math.round((1 - priceRatio) * 1000) / 10,
        });
    },

    // ── Financial statement, claims, settlement ──────────────────────────────
    async get_booking_financial_statement(ctx) {
        const bookingId = requireBookingId(ctx.body);
        const b = await bookingForCtx(ctx, bookingId);
        if (!b) return response(404, { error: "Booking not found." });
        if (b === "forbidden") return response(403, { error: "Different branch." });
        return response(200, { statement: await getBookingStatement(ctx.db, bookingId, ctx.storeId),
            viewerRole: ctx.role, canWrite: ctx.access === "full" });
    },

    async get_booking_claim_sources(ctx) {
        const bookingId = requireBookingId(ctx.body);
        const b = await bookingForCtx(ctx, bookingId);
        if (!b) return response(404, { error: "Booking not found." });
        if (b === "forbidden") return response(403, { error: "Different branch." });
        const items = await loadItems(ctx.db, bookingId, ctx.storeId);
        const decision = b.settlement_reviewed_at ? (Number(b.final_additional_charges) > 0 ? "approved" : "waived") : null;
        const incidents = incidentsFromItems(items);
        // Equipment cost price = replacement value, shown to the Manager as a reference when deciding a charge.
        const equipmentIds = [...new Set(incidents.map((x) => Number(x.item.equipment_id)).filter(isId))];
        const costs = new Map();
        if (equipmentIds.length) {
            const [rows] = await ctx.db.execute(`SELECT id, cost_price FROM equipment WHERE store_id=? AND id IN (${equipmentIds.map(() => "?").join(",")})`,
                [ctx.storeId, ...equipmentIds]);
            for (const r of rows) costs.set(Number(r.id), r.cost_price == null ? null : money2(r.cost_price));
        }
        const view = (x) => ({ id: Number(x.item.id), equipmentId: Number(x.item.equipment_id), equipmentName: x.item.item_name_snapshot,
            quantity: x.quantity, reason: x.item.return_notes || "", decisionStatus: decision,
            unitValue: costs.get(Number(x.item.equipment_id)) ?? null });
        // Staff return + inspection records for the Manager's "Rental Return & Final Settlement" dialog.
        const [reports] = await ctx.db.execute(
            `SELECT bi.id, bi.item_name_snapshot, bi.quantity, bi.item_status, bi.returned_quantity, bi.return_notes,
                    bi.damaged_quantity, bi.missing_quantity,
                    DATE_FORMAT(bi.inspected_at,'%Y-%m-%d %H:%i:%s') AS inspectedAt,
                    ins.full_name AS inspectedBy, rec.full_name AS receivedBy
             FROM booking_items bi
                      LEFT JOIN users ins ON ins.id=bi.inspected_by AND ins.store_id=bi.store_id
                      LEFT JOIN users rec ON rec.id=bi.received_by AND rec.store_id=bi.store_id
             WHERE bi.booking_id=? AND bi.store_id=? AND bi.item_type=? AND bi.item_status<>?
             ORDER BY bi.id`, [bookingId, ctx.storeId, ITEM.RENTAL, ITEM_STATUS.CANCELLED]);
        return response(200, {
            missing: incidents.filter((x) => x.sourceType === "missing").map((x) => ({ ...view(x), status: decision ? "writeoff" : "pending" })),
            damage: incidents.filter((x) => x.sourceType === "damage").map((x) => ({ ...view(x), outstanding: decision ? 0 : x.quantity })),
            recoveryInspectionPending: false,
            returnReports: reports.map((r) => ({
                allocationId: Number(r.id), equipmentName: r.item_name_snapshot, issuedQuantity: Number(r.quantity),
                allocationStatus: allocationLabel(r),
                returnedReceivedUnits: isReturned(r) ? Number(r.returned_quantity) : null,
                inspectionStatus: r.inspectedAt ? "inspected" : isReturned(r) ? "pending" : null,
                inspectedAt: r.inspectedAt || null, inspectedBy: r.inspectedBy || null,
                receivedBy: r.receivedBy || null, notes: r.return_notes || null,
                damagedUnits: Number(r.damaged_quantity || 0), missingUnits: Number(r.missing_quantity || 0),
            })),
        });
    },

    // v2 has one booking-wide charge, so approving/waiving decides it for the whole booking.
    async approve_booking_claim(ctx) { return decideBookingCharge(ctx, false); },
    async waive_booking_claim(ctx) { return decideBookingCharge(ctx, true); },

    async settle_booking_security_deposit(ctx) {
        const { db, body, storeId, actor } = ctx;
        const bookingId = requireBookingId(body);
        if (ctx.role !== "manager" || ctx.access !== "full")
            return response(403, { error: "Assigned-branch Manager permission is required to settle deposits." });
        const requestKey = String(body.requestKey || "").trim();
        if (!/^[A-Za-z0-9_-]{12,85}$/.test(requestKey)) return response(400, { error: "A unique settlement request key is required." });
        const mode = String(body.mode || "");
        if (!["refund", "damage", "combined"].includes(mode)) return response(400, { error: "Choose a valid security deposit settlement mode." });
        const refundAmount = financeCurrency(body.refundAmount ?? 0, "Refund amount");
        const receivedAmount = financeCurrency(body.additionalPaymentReceived ?? 0, "Additional payment received");
        if (mode === "refund" && receivedAmount > 0) return response(400, { error: "Additional claim payment requires a documented damage/missing incident." });
        if (receivedAmount > 0 && body.paymentVerified !== true) return response(400, { error: "Verify that the additional customer payment was actually received." });
        if (refundAmount > 0 && body.refundVerified !== true) return response(400, { error: "Confirm that the refund has actually been given to the customer." });
        const newCharge = mode === "refund" ? 0 : financeCurrency(body.chargeAmount ?? 0, "Approved customer charge");
        const reason = String(body.reason || "").trim().slice(0, 500);

        return withTransaction(db, async () => {
            const b = await bookingForCtx(ctx, bookingId, true);
            if (!b) return response(404, { error: "Booking not found." });
            if (b === "forbidden") return response(403, { error: "Different branch." });
            if (await requestKeyUsed(db, storeId, requestKey)) return response(200, { success: true, alreadyRecorded: true });
            if (normalizeBookingStatus(b.status) !== "Pending Settlement")
                throw rentalError("Security deposit settlement is available only after Staff finishes return inspection (Pending Settlement).");
            const items = await loadItems(db, bookingId, storeId);
            const money = await getBookingMoney(db, bookingId, storeId);
            const total = bookingTotal(b);
            if (!(total > 0) || money.bookingPaid + 0.005 < total) throw rentalError("Booking price must be fully paid before return settlement.");
            requireRentalReturnBeforeCompletion(items);
            if (splitItems(items).rentals.some((r) => !r.inspected_at))
                throw rentalError("Staff must finish return inspection before financial settlement.");
            let d = depositFigures(b, money);
            if (money.depositCollected + 0.005 < d.depositRequired) throw rentalError("The agreed security deposit has not been fully collected.");
            let heldCents = cents(d.depositHeld), applyCents = 0;
            const cashCents = cents(receivedAmount), refundCents = cents(refundAmount);
            let decided = false;
            if (mode === "damage" || mode === "combined") {
                const incidents = incidentsFromItems(items);
                if (!b.settlement_reviewed_at) {
                    if (!incidents.length) throw rentalError("No Staff-recorded damaged or missing equipment is available for a charge.");
                    if (reason.length < 10) throw rentalError("Explain the combined customer charge or waiver (at least 10 characters).");
                    await db.execute(
                        `UPDATE bookings SET final_additional_charges=?, settlement_notes=?, settlement_reviewed_by=?,
                                             settlement_reviewed_at=NOW(), settlement_status='reviewed' WHERE id=?`,
                        [newCharge, reason, actor.id, bookingId]);
                    b.final_additional_charges = newCharge;
                    b.settlement_reviewed_at = new Date();
                    decided = true;
                } else if (newCharge > 0) {
                    throw rentalError("No unreviewed affected equipment remains. Do not charge previously decided claims again.");
                }
                d = depositFigures(b, money);
                const outstandingCents = cents(d.claimBalance);
                applyCents = Math.min(heldCents, outstandingCents);
                if (cashCents > outstandingCents - applyCents)
                    throw rentalError("Additional customer payment exceeds the unpaid damage/missing-item charge.");
                if (applyCents > 0)
                    await db.execute(`UPDATE bookings SET deposit_applied_amount=deposit_applied_amount+? WHERE id=?`, [applyCents / 100, bookingId]);
                if (cashCents > 0)
                    await insertPayment(db, { booking: b, storeId, type: PAYMENT.CHARGE, amount: cashCents / 100,
                        requestKey: `${requestKey}-CHG`, actor, method: body.paymentMethod, notes: "Damage / missing-item charge payment" });
                if (!decided && applyCents === 0 && cashCents === 0)
                    throw rentalError("No amount was settled. Record a verified additional payment or choose another outstanding claim.");
            }
            if (refundCents > heldCents - applyCents) throw rentalError("Refund amount exceeds the security deposit still held after charges.");
            if (refundCents > 0) {
                const fresh = await loadBooking(db, { bookingId, storeId });
                requireRentalIncidentSettlement(fresh, items, await getBookingMoney(db, bookingId, storeId));
                await refundDeposit(db, { booking: b, storeId, amount: refundCents / 100, actor, reason: reason || "Security deposit refund",
                    method: body.refundMethod, requestKey });
            }
            if (mode === "refund" && refundCents <= 0 && heldCents > 0)
                throw rentalError("Enter a positive refund amount, or select damage settlement with a documented incident.");
            await logEmployeeAction(db, { storeId, branchId: b.branch_id, actor, entityId: bookingId, referenceNumber: b.booking_reference,
                action: "Settled security deposit / charges",
                details: { requestKey, mode, charge: newCharge, depositApplied: applyCents / 100, cash: cashCents / 100, refund: refundCents / 100, reason } });
            const completed = await automaticallyCompleteSettledBooking(db, bookingId, storeId);
            return response(200, { success: true, completed, appliedDeposit: applyCents / 100,
                additionalPaymentRecorded: cashCents / 100, amountRefunded: refundCents / 100 });
        });
    },

    // Generic append-only money movements (kept for compatibility).
    async record_booking_financial_event(ctx) {
        const { db, body, storeId, actor } = ctx;
        const bookingId = requireBookingId(body);
        if (ctx.role === "owner") return response(403, { error: "Use an authorized branch transaction account for settlements." });
        const type = String(body.eventType || "");
        if (!["deposit_received", "deposit_refunded", "deposit_applied", "claim_paid"].includes(type))
            return response(400, { error: "Invalid financial event." });
        if ((type === "deposit_refunded" || type === "deposit_applied") && ctx.role !== "manager")
            return response(403, { error: "Manager authorization required for deposit refunds or allocations." });
        const amount = financePositive(body.amount, "Payment amount");
        const requestKey = String(body.requestKey || "").trim();
        if (!/^[a-zA-Z0-9_-]{12,100}$/.test(requestKey)) return response(400, { error: "Unique transaction key required." });
        return withTransaction(db, async () => {
            const b = await bookingForCtx(ctx, bookingId, true);
            if (!b) return response(404, { error: "Booking not found." });
            if (b === "forbidden") return response(403, { error: "Different branch." });
            if (await requestKeyUsed(db, storeId, requestKey)) return response(200, { success: true, alreadyRecorded: true });
            const items = await loadItems(db, bookingId, storeId);
            const money = await getBookingMoney(db, bookingId, storeId);
            const d = depositFigures(b, money);
            if (type === "deposit_received") {
                if (amount > d.depositRequired - money.depositCollected + 0.005) throw rentalError("Deposit collected exceeds the agreed refundable deposit.");
                await insertPayment(db, { booking: b, storeId, type: PAYMENT.DEPOSIT, amount, requestKey, actor, method: body.paymentMethod });
            } else if (type === "claim_paid") {
                if (amount > d.claimBalance + 0.005) throw rentalError("Amount exceeds outstanding claim.");
                await insertPayment(db, { booking: b, storeId, type: PAYMENT.CHARGE, amount, requestKey, actor, method: body.paymentMethod });
            } else if (type === "deposit_applied") {
                if (amount > d.depositHeld + 0.005) throw rentalError("Not enough refundable deposit is held.");
                if (amount > d.claimBalance + 0.005) throw rentalError("Amount exceeds outstanding claim.");
                await db.execute(`UPDATE bookings SET deposit_applied_amount=deposit_applied_amount+? WHERE id=?`, [amount, bookingId]);
            } else {
                if (amount > d.depositHeld + 0.005) throw rentalError("Not enough refundable deposit is held.");
                if (!["Pending Settlement", "Completed", "Cancelled"].includes(normalizeBookingStatus(b.status)))
                    throw rentalError("Refund the deposit only after Staff has returned and inspected the booking, or after a reconciled cancellation.");
                if (splitItems(items).rentals.some((r) => [ITEM_STATUS.RESERVED, ITEM_STATUS.RELEASED].includes(r.item_status)))
                    throw rentalError("Rental equipment must be returned or cancelled before deposit refund.");
                requireRentalIncidentSettlement(b, items, money);
                await refundDeposit(db, { booking: b, storeId, amount, actor, reason: "Security deposit refund", method: body.refundMethod, requestKey });
            }
            await logEmployeeAction(db, { storeId, branchId: b.branch_id, actor, entityId: bookingId, referenceNumber: b.booking_reference,
                action: `Financial event: ${type}`, details: { requestKey, type, amount } });
            await automaticallyCompleteSettledBooking(db, bookingId, storeId);
            return response(200, { success: true, statement: await getBookingStatement(db, bookingId, storeId) });
        });
    },

    close_booking_outstanding_claim() {
        return response(409, { error: "Booking cannot be completed with unpaid claims. Use Pending Settlement until everything is resolved." });
    },

    // ── Owner reports ────────────────────────────────────────────────────────
    async get_owner_booking_financial_overview(ctx) {
        if (ctx.role !== "owner") return response(403, { error: "Owner-only financial report." });
        const sid = ctx.storeId;
        const [rows] = await ctx.db.execute(
            `SELECT b.id, b.final_additional_charges AS charges, b.deposit_applied_amount AS applied,
                    b.settlement_reviewed_at AS reviewed,
                    COALESCE(pay.deposits,0) AS deposits, COALESCE(pay.chargePaid,0) AS chargePaid,
                    COALESCE(ref.refunded,0) AS refunded
             FROM bookings b
                      LEFT JOIN (SELECT booking_id,
                                        SUM(CASE WHEN payment_type='${PAYMENT.DEPOSIT}' THEN amount ELSE 0 END) AS deposits,
                                        SUM(CASE WHEN payment_type='${PAYMENT.CHARGE}' THEN amount ELSE 0 END) AS chargePaid
                                 FROM payments WHERE store_id=? AND booking_id IS NOT NULL AND status='${PAYMENT.RECORDED}'
                                 GROUP BY booking_id) pay ON pay.booking_id=b.id
                      LEFT JOIN (SELECT p.booking_id, SUM(r.amount) AS refunded FROM refunds r
                                                                                         JOIN payments p ON p.id=r.payment_id AND p.store_id=r.store_id
                                 WHERE r.store_id=? AND r.refund_type='${REFUND.DEPOSIT}' AND LOWER(r.status) IN ('completed','processed')
                                 GROUP BY p.booking_id) ref ON ref.booking_id=b.id
             WHERE b.store_id=?`, [sid, sid, sid]);
        let held = 0, approved = 0, recovered = 0, applied = 0, outstanding = 0;
        for (const r of rows) {
            held += Math.max(0, Number(r.deposits) - Number(r.applied) - Number(r.refunded));
            if (r.reviewed) approved += Number(r.charges);
            recovered += Number(r.chargePaid);
            applied += Number(r.applied);
            outstanding += Math.max(0, Number(r.charges) - Number(r.chargePaid) - Number(r.applied));
        }
        return response(200, { overview: { deliveryFees: 0, setupFees: 0, refundableDepositsHeld: money2(held),
                approvedClaims: money2(approved), cashRecovered: money2(recovered), depositsApplied: money2(applied),
                outstandingClaims: money2(outstanding) } });
    },

    async get_owner_dashboard_financial_summary(ctx) {
        if (ctx.role !== "owner") return response(403, { error: "Owner access required." });
        const today = rentalTodayManila();
        const currentMonth = today.slice(0, 7), year = today.slice(0, 4);
        const monthIndex = Number(today.slice(5, 7)) - 1;
        const periodStarts = { month: `${currentMonth}-01`, quarter: `${year}-${String(Math.floor(monthIndex / 3) * 3 + 1).padStart(2, "0")}-01`, year: `${year}-01-01` };
        const periods = ["month", "quarter", "year"];
        const [bookings] = await ctx.db.execute(
            `SELECT b.id, b.booking_type AS bookingType, b.agreed_price, b.package_price_snapshot,
                    DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate
             FROM bookings b WHERE b.store_id=? AND LOWER(TRIM(b.status))='completed'
                               AND b.event_date>=? AND b.event_date<=? ORDER BY b.event_date DESC, b.id DESC`,
            [ctx.storeId, periodStarts.year, today]);
        const [lines] = await ctx.db.execute(
            `SELECT bi.booking_id AS bookingId, bi.item_type, bi.parent_item_id, bi.equipment_id, bi.item_name_snapshot,
                    bi.quantity, bi.line_total
             FROM booking_items bi JOIN bookings b ON b.id=bi.booking_id AND b.store_id=bi.store_id
             WHERE b.store_id=? AND LOWER(TRIM(b.status))='completed' AND b.event_date>=? AND b.event_date<=?
               AND bi.item_status<>'${ITEM_STATUS.CANCELLED}'`, [ctx.storeId, periodStarts.year, today]);
        const byBooking = new Map();
        for (const l of lines) {
            const key = String(l.bookingId);
            if (!byBooking.has(key)) byBooking.set(key, []);
            byBooking.get(key).push(l);
        }
        const packageMaps = Object.fromEntries(periods.map((p) => [p, new Map()]));
        const rentalMaps = Object.fromEntries(periods.map((p) => [p, new Map()]));
        let consumable = 0, rental = 0, totalRevenue = 0, unverified = 0, completedThisMonth = 0;
        const reasons = new Set();
        for (const b of bookings) {
            const items = byBooking.get(String(b.id)) || [];
            const pkgRow = items.find((i) => i.item_type === ITEM.PACKAGE);
            const packageBase = pkgRow ? Number(pkgRow.line_total) : 0;
            const customSales = money2(items.filter((i) => i.item_type === ITEM.CONSUMABLE && !i.parent_item_id).reduce((s, i) => s + Number(i.line_total), 0));
            const rentalLines = items.filter((i) => i.item_type === ITEM.RENTAL);
            const rentalQuote = money2(rentalLines.reduce((s, i) => s + Number(i.line_total), 0));
            const packageUnits = items.filter((i) => i.parent_item_id).length;
            const agreed = money2(bookingTotal(b));
            const expected = money2(packageBase + customSales + rentalQuote);
            const verified = Math.abs(agreed - expected) <= 0.01 && (packageBase <= 0.005 || packageUnits > 0);
            if (b.eventDate >= periodStarts.month) {
                completedThisMonth++;
                totalRevenue = money2(totalRevenue + agreed);
                if (verified) { consumable = money2(consumable + packageBase + customSales); rental = money2(rental + rentalQuote); }
                else {
                    unverified++;
                    reasons.add(Math.abs(agreed - expected) > 0.01 ? "Some booking totals do not reconcile to item charges." : "Some package inclusions cannot be classified reliably.");
                }
            }
            for (const period of periods) {
                if (b.eventDate < periodStarts[period]) continue;
                if (pkgRow && packageBase > 0) {
                    const key = lower(pkgRow.item_name_snapshot);
                    const old = packageMaps[period].get(key) || { key, name: pkgRow.item_name_snapshot, bookings: 0, revenue: 0 };
                    old.bookings += 1; old.revenue = money2(old.revenue + packageBase);
                    packageMaps[period].set(key, old);
                }
                for (const line of rentalLines) {
                    const key = String(line.equipment_id);
                    const old = rentalMaps[period].get(key) || { key, name: line.item_name_snapshot, rentals: 0, revenue: 0 };
                    old.rentals += Number(line.quantity); old.revenue = money2(old.revenue + Number(line.line_total));
                    rentalMaps[period].set(key, old);
                }
            }
        }
        const top = (map) => [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
        const verifiedAll = unverified === 0 && Math.abs(money2(consumable + rental) - totalRevenue) <= 0.01;
        return response(200, {
            success: true,
            topBookingPackages: Object.fromEntries(periods.map((p) => [p, top(packageMaps[p])])),
            topRentedProducts: Object.fromEntries(periods.map((p) => [p, top(rentalMaps[p])])),
            bookingRevenueAllocation: {
                month: currentMonth, verified: verifiedAll,
                bookingConsumable: verifiedAll ? consumable : null, bookingRental: verifiedAll ? rental : null,
                bookingRevenue: totalRevenue, verifiedBookingConsumable: consumable, verifiedBookingRental: rental,
                unallocatedBookingRevenue: money2(Math.max(0, totalRevenue - consumable - rental)),
                reason: verifiedAll ? "" : ([...reasons][0] || "Booking goods revenue needs reconciliation."),
            },
            summaryInfo: { completedBookingsThisMonth: completedThisMonth, unverifiedBookingsThisMonth: unverified,
                completedBookingsThisYear: bookings.length },
        });
    },

    async get_booking_costs(ctx) {
        if (ctx.role !== "owner") return response(403, { error: "Only the Owner can access booking cost details." });
        const { body } = ctx;
        const rawFrom = body.date_from ?? body.dateFrom, rawTo = body.date_to ?? body.dateTo;
        const dateFrom = normalizeDateFilter(rawFrom), dateTo = normalizeDateFilter(rawTo);
        if ((rawFrom && !dateFrom) || (rawTo && !dateTo)) return response(400, { error: "Invalid booking cost date filter. Use YYYY-MM-DD." });
        if (dateFrom && dateTo && dateFrom > dateTo) return response(400, { error: "date_from cannot be later than date_to." });
        let sql = `SELECT bi.booking_id AS bookingId, bi.used_quantity AS quantityUsed, pv.cost_price AS unitCost
                   FROM booking_items bi JOIN bookings b ON b.id=bi.booking_id AND b.store_id=bi.store_id
                                         LEFT JOIN product_variants pv ON pv.id=bi.variant_id AND pv.store_id=bi.store_id
                   WHERE b.store_id=? AND bi.item_type='${ITEM.CONSUMABLE}'`;
        const params = [ctx.storeId];
        const branchId = body.branch_id || body.branchId;
        if (branchId) { sql += " AND b.branch_id=?"; params.push(Number(branchId)); }
        if (dateFrom) { sql += " AND b.event_date>=?"; params.push(dateFrom); }
        if (dateTo) { sql += " AND b.event_date<=?"; params.push(dateTo); }
        const [rows] = await ctx.db.execute(`${sql} ORDER BY bi.booking_id, bi.id`, params);
        const totals = new Map(), invalid = new Set();
        for (const row of rows) {
            const key = String(row.bookingId);
            const qty = Number(row.quantityUsed || 0), cost = Number(row.unitCost);
            if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) { invalid.add(key); continue; }
            totals.set(key, (totals.get(key) || 0) + qty * cost);
        }
        const costs = {};
        for (const [key, total] of totals) if (!invalid.has(key)) costs[key] = Number(total.toFixed(2));
        return response(200, { success: true, costs, cost_basis: "booking_item_used_quantity_x_variant_cost_price" });
    },

    // ── Fee policy (removed in v2) ───────────────────────────────────────────
    async get_booking_fee_policy() { return response(200, { policy: { ...FEE_POLICY_V2 } }); },
    set_booking_fee_policy() {
        return response(410, { error: "Delivery/setup fee policies were removed in the v2 database. Rental deposits are set per booking by the Manager." });
    },

    // ── Manager closure review / status / price / payment ────────────────────
    async get_booking_closure_impact(ctx) {
        if (ctx.role !== "manager") return response(403, { error: "Manager permission required for closure review." });
        const bookingId = requireBookingId(ctx.body);
        const impact = await getBookingClosureImpact(ctx.db, { bookingId, storeId: ctx.storeId, branchId: ctx.branchId });
        return response(200, { success: true, impact });
    },

    async update_status(ctx) {
        const { db, body, storeId, actor } = ctx;
        const bookingId = Number(body.booking_id);
        const status = normalizeBookingStatus(body.status);
        if (!isId(bookingId) || !body.status) return response(400, { error: "Missing booking_id or status" });
        if (!status || !["Pending Review", "Awaiting Down Payment", "Confirmed", "Cancelled", "Rejected"].includes(status))
            return response(400, { error: "Invalid booking status" });
        const cancellationReason = String(body.cancel_reason ?? "").trim();
        const rejectionReason = String(body.rejection_reason ?? "").trim();
        const refundInput = body.booking_refund_amount ?? body.bookingRefundAmount;
        const refundMethod = String(body.refund_method || body.refundMethod || "cash").trim().slice(0, 50) || "cash";
        if (status === "Cancelled" && (cancellationReason.length < 5 || cancellationReason.length > 500))
            return response(400, { error: "Enter a cancellation reason (5–500 characters)." });
        if (status === "Rejected" && (rejectionReason.length < 5 || rejectionReason.length > 500))
            return response(400, { error: "Enter a rejection reason (5–500 characters)." });
        if (["Cancelled", "Rejected"].includes(status) && ctx.role !== "manager")
            return response(403, { error: "Only a Manager may reject or cancel bookings." });
        if (status === "Cancelled" && body.impact_acknowledged !== true)
            return response(400, { error: "Review and acknowledge the current cancellation impact before proceeding." });

        const branchId = Number(ctx.branchId);
        const existing = await loadBooking(db, { bookingId, storeId, branchId });
        if (!existing) return response(404, { error: "Booking not found" });
        const currentStatus = normalizeBookingStatus(existing.status) || "Pending Review";
        const allowed = {
            "Pending Review": ["Awaiting Down Payment", "Confirmed", "Rejected"],
            "Awaiting Down Payment": ["Confirmed", "Cancelled"],
            Confirmed: ["Cancelled"],
            Preparing: ["Cancelled"],
        };
        if (!allowed[currentStatus]?.includes(status))
            return response(400, { error: `Cannot move booking from ${currentStatus} to ${status}` });

        let inventoryResult = { reservedCount: 0, restoredCount: 0, restoredQuantity: 0, usedQuantity: 0 };
        let impactForLog = null;
        let cancelRefund = null;
        await withTransaction(db, async () => {
            if (status === "Cancelled" || status === "Rejected") {
                const impact = await getBookingClosureImpact(db, { bookingId, storeId, branchId, lock: true });
                impactForLog = impact;
                if (impact.status !== currentStatus) throw rentalError("Booking changed while reviewing closure. Refresh and review again.");
                if (status === "Rejected") {
                    if (!impact.eligibleForReject) throw rentalError("Only an unapproved pending request can be rejected.");
                    if (impact.paymentReceived > 0 || impact.depositCollected > 0 || impact.reservedConsumableUnits > 0 ||
                        impact.usedConsumableUnits > 0 || Object.keys(impact.rentalAllocations).some((k) => k !== "cancelled" && k !== "pending_review"))
                        throw rentalError("This pending booking has financial or inventory activity. Resolve the discrepancy before rejecting.");
                } else if (!impact.eligibleForCancel) {
                    throw rentalError("This booking cannot be routinely cancelled at its current stage.");
                } else {
                    cancelRefund = cancellationRefundPlan(impact, refundInput, body.refund_verified === true);
                }
            }
            const booking = await loadBooking(db, { bookingId, storeId, branchId, lock: true });
            if (status === "Awaiting Down Payment" || status === "Confirmed") {
                const review = await inspectBookingForConfirmation(db, { bookingId, storeId, branchId });
                const blocking = review.reasons.filter((r) => BLOCKING_REASON.test(r));
                if (blocking.length) throw rentalError(blocking.join(" "));
                if (body.agreed_price !== undefined && Math.abs(Number(body.agreed_price) - Number(booking.agreed_price)) > 0.01)
                    throw rentalError("Save and review the agreed price first; do not override it during confirmation.");
                if (status === "Awaiting Down Payment") {
                    if (Number(booking.required_down_payment || 0) <= 0)
                        throw rentalError("Use the Manager no-DP approval option for a booking with no down payment.");
                    await checkAvailableBeforePayment(db, { booking, items: review.items, storeId, branchId });
                } else if (currentStatus === "Pending Review") {
                    const reason = String(body.noDpReason || "").trim();
                    if (Number(booking.required_down_payment || 0) !== 0 || reason.length < 10)
                        throw rentalError("Direct confirmation requires a zero DP and a Manager waiver reason (10+ characters).");
                    booking.approved_by = actor.id;
                }
                if (currentStatus === "Pending Review") {
                    await db.execute(`UPDATE bookings SET approved_by=?, approved_at=NOW() WHERE id=?`, [actor.id, bookingId]);
                    // Price is locked from here on: save the final VAT record with the store's current registration.
                    await saveBookingVat(db, { bookingId, storeId });
                }
                if (status === "Confirmed") {
                    requireBookingDeposit(booking, review.money);
                    await requireCustomerReviewClear(db, { booking, storeId });
                }
            }
            const params = [status];
            let sql = "UPDATE bookings SET status=?";
            if (status === "Cancelled" || status === "Rejected") {
                sql += ", cancellation_reason=?";
                params.push(status === "Cancelled" ? cancellationReason : `Rejected: ${rejectionReason}`);
            }
            sql += " WHERE id=? AND store_id=? AND branch_id=?";
            params.push(bookingId, storeId, branchId);
            await db.execute(sql, params);

            if (status === "Confirmed") {
                inventoryResult = { ...inventoryResult, ...(await reserveBookingInventory(db, { booking, storeId, branchId, actor })) };
                await confirmRentalAllocations(db, { booking, storeId, branchId, price: booking.agreed_price });
            }
            if (status === "Cancelled") {
                inventoryResult = { ...inventoryResult, ...(await restoreBookingInventoryOnCancel(db,
                        { booking, storeId, branchId, usedItems: getUsedItemsInput(body), actor })) };
                // Money given back in the same transaction; the payment rows themselves are kept as history.
                if (cancelRefund.bookingRefund > 0)
                    await refundBookingPayment(db, { booking, storeId, amount: cancelRefund.bookingRefund, actor,
                        method: refundMethod, reason: `Booking cancelled: ${cancellationReason}` });
                if (cancelRefund.depositRefund > 0)
                    await refundDeposit(db, { booking, storeId, amount: cancelRefund.depositRefund, actor, method: refundMethod,
                        reason: `Booking cancelled before equipment release: ${cancellationReason}` });
                await db.execute(`UPDATE bookings SET settlement_status='settled', settlement_notes=? WHERE id=? AND store_id=?`,
                    [`Cancelled: refunded ₱${cancelRefund.bookingRefund.toFixed(2)} of booking payments (kept ₱${cancelRefund.retained.toFixed(2)})` +
                    `${cancelRefund.depositRefund > 0 ? `; security deposit ₱${cancelRefund.depositRefund.toFixed(2)} refunded` : ""}.`,
                        bookingId, storeId]);
            }
            if (status === "Rejected") {
                await db.execute(`UPDATE booking_items SET item_status=? WHERE booking_id=? AND store_id=? AND item_status=?`,
                    [ITEM_STATUS.CANCELLED, bookingId, storeId, ITEM_STATUS.PENDING]);
            }
            const labels = { "Awaiting Down Payment": "Approved booking awaiting DP", Confirmed: "Confirmed booking",
                Cancelled: "Cancelled booking", Rejected: "Rejected booking request" };
            const ref = buildBookingReference(booking, bookingId);
            await logEmployeeAction(db, { storeId, branchId, actor, entityId: bookingId, referenceNumber: ref,
                action: labels[status] || `Updated booking status to ${status}`,
                details: {
                    message: `${ref} (${booking.customer_name || "customer"}): ${currentStatus} → ${status}`,
                    ...(status === "Confirmed" && currentStatus === "Pending Review" ? { noDpReason: String(body.noDpReason || "").trim() } : {}),
                    ...(status === "Cancelled" ? { reason: cancellationReason, paymentStage: impactForLog?.paymentStage,
                        bookingPaid: impactForLog?.paymentReceived, bookingRefund: cancelRefund?.bookingRefund ?? 0,
                        amountKept: cancelRefund?.retained ?? 0, depositRefunded: cancelRefund?.depositRefund ?? 0,
                        usedItemsValue: inventoryResult.usedValue ?? 0,
                        suggestedRefund: impactForLog ? suggestedCancellationRefund(impactForLog.refundableBookingPayment,
                            impactForLog.requiredDownPayment, inventoryResult.usedValue ?? 0) : null,
                        refundMethod } : {}),
                    ...(status === "Rejected" ? { reason: rejectionReason } : {}),
                },
            });
        });
        return response(200, {
            success: true, status,
            reserved_items: inventoryResult.reservedCount || 0, restored_items: inventoryResult.restoredCount || 0,
            restored_quantity: inventoryResult.restoredQuantity || 0, used_quantity: inventoryResult.usedQuantity || 0,
            ...(cancelRefund ? { booking_refunded: cancelRefund.bookingRefund, deposit_refunded: cancelRefund.depositRefund,
                amount_kept: cancelRefund.retained, used_items_value: inventoryResult.usedValue ?? 0 } : {}),
        });
    },

    async update_price(ctx) {
        const { db, body, storeId, actor } = ctx;
        const bookingId = Number(body.booking_id);
        if (!isId(bookingId) || body.agreed_price === undefined || body.agreed_price === null)
            return response(400, { error: "Missing booking_id or agreed_price" });
        const total = toNumber(body.agreed_price);
        const requiredDp = toNumber(body.required_down_payment ?? body.requiredDownPayment);
        if (total <= 0) return response(400, { error: "agreed_price must be greater than 0" });
        if (requiredDp < 0) return response(400, { error: "required_down_payment cannot be negative" });
        if (requiredDp > total) return response(400, { error: "required_down_payment cannot exceed agreed_price" });
        const branchId = Number(ctx.branchId);

        return withTransaction(db, async () => {
            const b = await loadBooking(db, { bookingId, storeId, branchId, lock: true });
            if (!b) return response(404, { error: "Booking not found" });
            if (normalizeBookingStatus(b.status) !== "Pending Review")
                return response(409, { error: "Booking payment terms are locked after Manager approval." });
            const items = await loadItems(db, bookingId, storeId);
            const s = splitItems(items);
            const q = quoteFromItems(items);
            const rentalCount = s.rentals.length;
            const depositSpecified = body.refundable_deposit !== undefined && body.refundable_deposit !== null;
            const depositAmount = depositSpecified ? financeCurrency(body.refundable_deposit, "Refundable security deposit") : null;
            const requiredMinimum = money2(q.packageBase + q.rentalSubtotal);
            const type = lower(b.booking_type);
            if (type === "package") {
                const savedPrice = Number(b.agreed_price);
                if (!Number.isFinite(savedPrice) || savedPrice <= 0 || Math.abs(total - savedPrice) > 0.005 || Math.abs(total - requiredMinimum) > 0.005)
                    return response(409, { error: "The fixed package + rental quote does not match saved pricing. Refresh the booking." });
                if (rentalCount === 0 && Math.abs(requiredDp - Number(b.required_down_payment || 0)) > 0.005)
                    return response(409, { error: "Consumables-only fixed package down payment cannot be changed." });
            }
            if (rentalCount > 0 && requiredDp <= 0)
                return response(400, { error: "Bookings containing rental equipment require a positive down payment toward the booking price. The refundable security deposit does not replace it." });
            if (type === "rental" && (q.packageBase !== 0 || requiredMinimum <= 0 || Math.abs(total - requiredMinimum) > 0.005))
                return response(409, { error: "Rental-only booking prices are fixed by the selected equipment and services. Only DP and security deposit terms can be edited." });
            // Custom: ONE agreed price for everything (consumables and rental equipment). It may be discounted;
            // a price below the normal total needs a short reason, kept in the activity log.
            const customType = type === "custom";
            const normalCustomTotal = money2(q.salesSubtotal + q.rentalSubtotal);
            const pricingReason = String(body.pricing_adjustment_reason || "").trim();
            const customDiscount = customType && normalCustomTotal > 0 && total < normalCustomTotal - 0.005;
            if (customDiscount && (pricingReason.length < 5 || pricingReason.length > 300))
                return response(400, { error: "Add a short reason for the discount (5–300 characters)." });
            if (pricingReason.length > 300) return response(400, { error: "The pricing note can be at most 300 characters." });
            if (depositSpecified && rentalCount === 0 && depositAmount > 0)
                return response(400, { error: "Rental security deposits apply only to bookings containing rental equipment." });
            // Packages and older Rental bookings keep their fixed price; Custom prices can go below the item total.
            if (!customType && total < requiredMinimum - 0.005)
                return response(400, { error: `The price can't be below the fixed charges of ₱${requiredMinimum.toFixed(2)}.` });
            if (depositSpecified) {
                const money = await getBookingMoney(db, bookingId, storeId);
                if (depositAmount + 0.005 < money.depositCollected)
                    throw rentalError("The agreed deposit cannot be lower than funds already collected; settle them first.");
            }
            await db.execute(
                `UPDATE bookings SET agreed_price=?, required_down_payment=?${depositSpecified ? ", refundable_deposit_required=?" : ""}
                 WHERE id=? AND store_id=? AND branch_id=?`,
                depositSpecified ? [total, requiredDp, depositAmount, bookingId, storeId, branchId] : [total, requiredDp, bookingId, storeId, branchId]);
            await saveBookingVat(db, { bookingId, storeId });
            const ref = buildBookingReference(b, bookingId);
            await logEmployeeAction(db, { storeId, branchId, actor, entityId: bookingId, referenceNumber: ref,
                action: "Updated booking payment terms",
                details: `${ref} (${b.customer_name || "customer"}): price ₱${Number(b.agreed_price || 0).toLocaleString()} → ₱${total.toLocaleString()}, ` +
                    `down payment ₱${Number(b.required_down_payment || 0).toLocaleString()} → ₱${requiredDp.toLocaleString()}` +
                    (depositSpecified ? `, refundable deposit ₱${depositAmount.toLocaleString()}` : "") +
                    (pricingReason ? `, pricing note: ${pricingReason}` : "") });
            return response(200, { success: true, agreed_price: total, required_down_payment: requiredDp,
                ...(depositSpecified ? { refundable_deposit: depositAmount } : {}) });
        });
    },

    async record_booking_customer_payment_with_deposit(ctx) {
        const { db, body, storeId, actor } = ctx;
        if (ctx.role !== "manager" || ctx.access !== "full")
            return response(403, { error: "Assigned-branch Manager with full Bookings access is required." });
        const bookingId = Number(body.booking_id);
        const branchId = Number(ctx.branchId);
        if (!isId(bookingId)) return response(400, { error: "Valid booking ID is required." });
        const bookingPayment = financeCurrency(body.bookingPayment ?? 0, "Booking payment received");
        const depositPayment = financeCurrency(body.depositPayment ?? 0, "Refundable security deposit received");
        const expectedBookingPaid = financeCurrency(body.expectedBookingPaid, "Previously recorded booking payment");
        const expectedDepositCollected = financeCurrency(body.expectedDepositCollected, "Previously recorded security deposit");
        if (bookingPayment + depositPayment <= 0) return response(400, { error: "Record a positive booking payment, security deposit, or both." });
        const requestKey = String(body.requestKey || "").trim();
        if (!/^[a-zA-Z0-9_-]{12,100}$/.test(requestKey)) return response(400, { error: "A unique payment transaction key is required." });

        const saved = await withTransaction(db, async () => {
            const b = await loadBooking(db, { bookingId, storeId, branchId, lock: true });
            if (!b) throw rentalError("Booking not found in the Manager's assigned branch.");
            const [prior] = await db.execute(`SELECT id FROM payments WHERE store_id=? AND request_key IN (?,?) LIMIT 1`,
                [storeId, `${requestKey}-BOOK`, `${requestKey}-DEP`]);
            if (prior.length) return { alreadyRecorded: true };
            const money = await getBookingMoney(db, bookingId, storeId);
            const agreed = bookingTotal(b), down = Number(b.required_down_payment || 0);
            if (agreed <= 0 || money.bookingPaid > agreed + 0.005)
                throw rentalError("The agreed booking price or previous payment needs reconciliation.");
            if (Math.abs(money.bookingPaid - expectedBookingPaid) > 0.005)
                throw rentalError("Booking payments changed. Close and reopen the payment dialog before recording more money.");
            const requiredDeposit = Number(b.refundable_deposit_required || 0);
            if (Math.abs(money.depositCollected - expectedDepositCollected) > 0.005)
                throw rentalError("Security deposit collections changed. Close and reopen the payment dialog.");
            if (cents(bookingPayment) > Math.max(0, cents(agreed) - cents(money.bookingPaid)))
                throw rentalError("Booking payment exceeds the outstanding booking balance.");
            if (cents(depositPayment) > Math.max(0, cents(requiredDeposit) - cents(money.depositCollected)))
                throw rentalError("Security deposit payment exceeds the agreed unpaid refundable deposit.");
            const method = body.paymentMethod || body.payment_method || "cash";
            const reference = body.referenceNumber || body.reference_number || null;
            if (bookingPayment > 0)
                await insertPayment(db, { booking: b, storeId, type: PAYMENT.BOOKING, amount: bookingPayment, requestKey: `${requestKey}-BOOK`,
                    actor, method, referenceNumber: reference, notes: "Verified booking payment" });
            if (depositPayment > 0)
                await insertPayment(db, { booking: b, storeId, type: PAYMENT.DEPOSIT, amount: depositPayment, requestKey: `${requestKey}-DEP`,
                    actor, method, referenceNumber: reference, notes: "Refundable security deposit (not revenue)" });
            const newPaid = money2(money.bookingPaid + bookingPayment);
            const newDeposit = money2(money.depositCollected + depositPayment);
            await logEmployeeAction(db, { storeId, branchId, actor, entityId: bookingId, referenceNumber: buildBookingReference(b, bookingId),
                action: "Recorded verified customer payment",
                details: `Booking payment ₱${bookingPayment.toFixed(2)}; refundable security deposit ₱${depositPayment.toFixed(2)}. Deposit recorded separately from revenue.` });
            const balance = Math.max(0, money2(agreed - newPaid));
            return { newPaid, newDeposit, balance, requiredDeposit, paymentStatus: paymentStatusLabel(agreed, down, newPaid) };
        });
        if (saved.alreadyRecorded) return response(200, { success: true, alreadyRecorded: true, refreshRequired: true });
        const confirmation = await confirmApprovedBookingAfterPayment(db, { bookingId, storeId, branchId, actor });
        const depositRemaining = Math.max(0, money2(saved.requiredDeposit - saved.newDeposit));
        return response(200, {
            success: true, amountPaid: saved.newPaid, balance: saved.balance, paymentStatus: saved.paymentStatus,
            confirmed: confirmation.confirmed, bookingStatus: confirmation.status, reservationIssue: confirmation.reservationIssue || null,
            depositCollected: saved.newDeposit, depositRemaining, totalDueBeforeRelease: money2(saved.balance + depositRemaining),
        });
    },

    update_payment() {
        return response(410, { error: "update_payment was replaced by record_booking_customer_payment_with_deposit. v2 stores payments as rows in the payments table." });
    },

    // ── Staff consumable fulfilment queue ────────────────────────────────────
    async get_staff_sales_booking_queue(ctx) {
        const [rows] = await ctx.db.execute(
            `SELECT b.id AS bookingId, b.booking_reference AS reference, c.full_name AS clientName, b.booking_type AS bookingType,
                    (SELECT p.item_name_snapshot FROM booking_items p WHERE p.booking_id=b.id AND p.store_id=b.store_id
                                                                        AND p.item_type='${ITEM.PACKAGE}' LIMIT 1) AS packageName,
                    b.status AS bookingStatus, DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate,
                    TIME_FORMAT(b.event_time,'%H:%i') AS eventTime, b.agreed_price, b.package_price_snapshot,
                    b.handover_method AS handoverMethod, b.venue AS venue,
                    DATE_FORMAT(COALESCE(b.handover_date,b.rental_start_date,b.event_date),'%Y-%m-%d') AS handoverDate,
                    TIME_FORMAT(COALESCE(b.handover_time,b.event_time),'%H:%i') AS handoverTime,
                    DATE_FORMAT(b.rental_end_date,'%Y-%m-%d') AS returnDate, TIME_FORMAT(b.return_time,'%H:%i') AS returnTime,
                    COALESCE((SELECT SUM(amount) FROM payments pay WHERE pay.booking_id=b.id AND pay.store_id=b.store_id
                              AND pay.payment_type='${PAYMENT.BOOKING}' AND pay.status='${PAYMENT.RECORDED}'),0) AS amountPaid,
                    COALESCE(b.refundable_deposit_required,0) AS depositRequired,
                    COALESCE((SELECT SUM(amount) FROM payments dep WHERE dep.booking_id=b.id AND dep.store_id=b.store_id
                              AND dep.payment_type='${PAYMENT.DEPOSIT}' AND dep.status='${PAYMENT.RECORDED}'),0) AS depositCollected,
                    (SELECT COUNT(*) FROM booking_items r WHERE r.booking_id=b.id AND r.store_id=b.store_id AND r.item_type='${ITEM.RENTAL}'
                       AND r.item_status<>'${ITEM_STATUS.CANCELLED}' AND r.item_status NOT LIKE 'claim%') AS rentalLines,
                    bi.id AS itemId, bi.item_name_snapshot AS productName, bi.variant_name_snapshot AS variantName,
                    bi.quantity, bi.prepared_at AS preparedAt, bi.released_at AS issuedAt
             FROM bookings b
                 JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
                 JOIN booking_items bi ON bi.booking_id=b.id AND bi.store_id=b.store_id
             WHERE b.store_id=? AND b.branch_id=?
               AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement')
               AND bi.item_type='${ITEM.CONSUMABLE}' AND bi.item_status='${ITEM_STATUS.RESERVED}'
               AND bi.used_quantity=0 AND bi.released_at IS NULL
             ORDER BY COALESCE(b.handover_date,b.rental_start_date,b.event_date), b.id, bi.id LIMIT 1000`, [ctx.storeId, ctx.branchId]);
        const groups = new Map();
        for (const row of rows) {
            let booking = groups.get(Number(row.bookingId));
            if (!booking) {
                const total = bookingTotal(row);
                booking = { bookingId: Number(row.bookingId), reference: String(row.reference || ""), clientName: String(row.clientName || "Customer"),
                    bookingType: String(row.bookingType || ""), packageName: String(row.packageName || ""), bookingStatus: String(row.bookingStatus || ""),
                    eventDate: String(row.eventDate || ""), eventTime: String(row.eventTime || ""), ...scheduleFields(row), bookingTotal: total,
                    amountPaid: Number(row.amountPaid), balance: Math.max(0, money2(total - Number(row.amountPaid))),
                    // Mixed bookings: the equipment is released in the Rental queue, and the deposit must be paid first.
                    rentalLines: Number(row.rentalLines || 0), depositRequired: money2(row.depositRequired),
                    depositCollected: money2(row.depositCollected), items: [] };
                groups.set(Number(row.bookingId), booking);
            }
            booking.items.push({ itemId: Number(row.itemId), productName: String(row.productName || "Product"),
                variantName: String(row.variantName || ""), quantity: Number(row.quantity), prepared: !!row.preparedAt, issued: !!row.issuedAt });
        }
        // Type + contents of every active booking in the branch, for the combined Staff queue
        // (one row per booking, with consumables and rental equipment shown together).
        const [contentRows] = await ctx.db.execute(
            `SELECT b.id AS bookingId, b.booking_reference AS reference, b.booking_type AS bookingType, b.status AS bookingStatus,
                    c.full_name AS clientName, DATE_FORMAT(b.event_date,'%Y-%m-%d') AS eventDate, TIME_FORMAT(b.event_time,'%H:%i') AS eventTime,
                    b.handover_method AS handoverMethod, b.venue AS venue,
                    DATE_FORMAT(COALESCE(b.handover_date,b.rental_start_date,b.event_date),'%Y-%m-%d') AS handoverDate,
                    TIME_FORMAT(COALESCE(b.handover_time,b.event_time),'%H:%i') AS handoverTime,
                    DATE_FORMAT(b.rental_end_date,'%Y-%m-%d') AS returnDate, TIME_FORMAT(b.return_time,'%H:%i') AS returnTime,
                    (SELECT p.item_name_snapshot FROM booking_items p WHERE p.booking_id=b.id AND p.store_id=b.store_id
                                                                        AND p.item_type='${ITEM.PACKAGE}' LIMIT 1) AS packageName,
                    SUM(bi.item_type='${ITEM.CONSUMABLE}' AND bi.item_status<>'${ITEM_STATUS.CANCELLED}') AS consumableLines,
                    SUM(bi.item_type='${ITEM.CONSUMABLE}' AND bi.item_status='${ITEM_STATUS.RELEASED}') AS consumablesHandedOver,
                    SUM(bi.item_type='${ITEM.RENTAL}' AND bi.item_status<>'${ITEM_STATUS.CANCELLED}' AND bi.item_status NOT LIKE 'claim%') AS rentalLines
             FROM bookings b
                 JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
                 JOIN booking_items bi ON bi.booking_id=b.id AND bi.store_id=b.store_id
             WHERE b.store_id=? AND b.branch_id=?
               AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement')
             GROUP BY b.id ORDER BY COALESCE(b.handover_date,b.rental_start_date,b.event_date), b.id LIMIT 1000`, [ctx.storeId, ctx.branchId]);
        const bookingContents = contentRows.map((r) => ({
            bookingId: Number(r.bookingId), reference: String(r.reference || ""), bookingType: String(r.bookingType || ""),
            bookingStatus: String(r.bookingStatus || ""), clientName: String(r.clientName || "Customer"), packageName: String(r.packageName || ""),
            eventDate: String(r.eventDate || ""), eventTime: String(r.eventTime || ""), ...scheduleFields(r),
            consumableLines: Number(r.consumableLines || 0), consumablesHandedOver: Number(r.consumablesHandedOver || 0),
            rentalLines: Number(r.rentalLines || 0),
        }));
        return response(200, { success: true, canOperateSalesQueue: ctx.salesAccess === "full", bookings: [...groups.values()], bookingContents });
    },

    async prepare_staff_sales_booking_item(ctx) { return staffSalesFulfilment(ctx, "prepare"); },
    async release_staff_sales_booking(ctx) { return staffSalesFulfilment(ctx, "release"); },

    // ── Customer follow-up (customers + employee_actions) ────────────────────
    async get_customer_review_case(ctx) { return customerCase(ctx, "get"); },
    async set_customer_review(ctx) { return customerCase(ctx, "set_review"); },
    async record_customer_case_event(ctx) { return customerCase(ctx, "event"); },
    async authorize_customer_booking_exception(ctx) { return customerCase(ctx, "exception"); },
    async waive_unpaid_customer_claim(ctx) { return customerCase(ctx, "waive"); },
};

// Staff Bookings is view-only (same as before): these Staff confirmation actions stay disabled.
for (const name of ["assess_booking_confirmation", "confirm_standard_booking", "request_booking_approval", "advance_staff_booking"]) {
    PROTECTED_ACTIONS[name] = () => response(403, { error: "Staff Bookings is view-only. Use Staff Inventory to prepare, release and inspect items." });
}

async function getBookingClosureImpact(db, { bookingId, storeId, branchId, lock = false }) {
    const booking = await loadBooking(db, { bookingId, storeId, branchId, lock });
    if (!booking) throw rentalError("Booking not found for closure review.");
    const items = await loadItems(db, bookingId, storeId);
    const money = await getBookingMoney(db, bookingId, storeId);
    const d = depositFigures(booking, money);
    const consumables = items.filter((i) => i.item_type === ITEM.CONSUMABLE);
    const rentals = items.filter((i) => i.item_type === ITEM.RENTAL);
    const allocationStatus = {};
    for (const r of rentals) {
        const key = allocationLabel(r);
        allocationStatus[key] = (allocationStatus[key] || 0) + 1;
    }
    const current = normalizeBookingStatus(booking.status);
    const rentalAlreadyHandled = Number(allocationStatus.checked_out || 0) > 0 || Number(allocationStatus.returned || 0) > 0;
    const paid = money.bookingPaid, agreed = bookingTotal(booking), down = Number(booking.required_down_payment || 0);
    const reservedUnits = consumables.filter((c) => c.item_status === ITEM_STATUS.RESERVED)
        .reduce((s, c) => s + Math.max(0, Number(c.quantity) - Number(c.used_quantity || 0)), 0);
    const usedUnits = consumables.reduce((s, c) => s + Number(c.used_quantity || 0), 0);
    const netPaid = Math.max(0, money2(paid - money.bookingRefunded));
    const priceRatio = consumablePriceRatio(booking, items);
    const usedValue = usedValueAtDealPrice(consumables.map((c) => ({ item: c, used: Number(c.used_quantity || 0) })), priceRatio);
    return {
        bookingId, bookingReference: booking.booking_reference, status: current,
        eligibleForReject: current === "Pending Review",
        eligibleForCancel: ["Awaiting Down Payment", "Confirmed", "Preparing"].includes(current) && !rentalAlreadyHandled,
        paymentStage: paid <= 0 ? "before_payment" : agreed > 0 && paid + 0.005 >= agreed ? "fully_paid"
            : down > 0 && paid + 0.005 >= down ? "dp_paid" : "partial_payment",
        agreedPrice: agreed, requiredDownPayment: down, paymentReceived: paid,
        depositCollected: money.depositCollected, depositHeld: d.depositHeld,
        reservedConsumableUnits: reservedUnits, usedConsumableUnits: usedUnits,
        rentalItemLines: rentals.length, rentalAllocations: allocationStatus, rentalCancellationBlocked: rentalAlreadyHandled,
        requiresFinancialReview: paid > 0 || money.depositCollected > 0,
        requiresInventoryReview: usedUnits > 0 || rentals.some((r) => r.item_status !== ITEM_STATUS.PENDING),
        // Cancellation refund: suggested = booking payments minus the down payment (the Manager may change it).
        // Equipment has not left yet, so the held security deposit is always refunded in full.
        bookingRefunded: money.bookingRefunded,
        refundableBookingPayment: netPaid,
        usedItemsValue: usedValue,
        suggestedRefund: suggestedCancellationRefund(netPaid, down, usedValue),
        depositRefundOnCancel: d.depositHeld,
        refundDecision: "Suggested refund = booking payment minus the larger of the down payment or the value of used items; the held security deposit is refunded in full.",
    };
}

async function decideBookingCharge(ctx, waiver) {
    const { db, body, storeId, actor } = ctx;
    if (ctx.role !== "manager" || ctx.access !== "full")
        return response(403, { error: "Manager with Full Booking access must review equipment claims." });
    const bookingId = requireBookingId(body);
    const amount = waiver ? 0 : financePositive(body.amount, "Claim charge");
    const reason = String(body.reason || "").trim().slice(0, 500);
    if (reason.length < 10) return response(400, { error: "Document the charge or waiver reason (at least 10 characters)." });
    return withTransaction(db, async () => {
        const b = await bookingForCtx(ctx, bookingId, true);
        if (!b) return response(404, { error: "Booking not found." });
        if (b === "forbidden") return response(403, { error: "Different branch." });
        if (b.settlement_reviewed_at) return response(409, { error: "This booking already has a recorded charge or waiver." });
        const items = await loadItems(db, bookingId, storeId);
        if (!incidentsFromItems(items).length) return response(409, { error: "This booking has no documented damaged or missing equipment." });
        await db.execute(
            `UPDATE bookings SET final_additional_charges=?, settlement_notes=?, settlement_reviewed_by=?,
                                 settlement_reviewed_at=NOW(), settlement_status='reviewed' WHERE id=?`,
            [amount, reason, actor.id, bookingId]);
        await logEmployeeAction(db, { storeId, branchId: b.branch_id, actor, entityId: bookingId, referenceNumber: b.booking_reference,
            action: waiver ? "Waived damage/missing charge" : "Approved damage/missing charge", details: { amount, reason } });
        await automaticallyCompleteSettledBooking(db, bookingId, storeId);
        return response(200, { success: true, statement: await getBookingStatement(db, bookingId, storeId) });
    });
}

async function staffSalesFulfilment(ctx, step) {
    const { db, body, storeId, actor } = ctx;
    if (ctx.salesAccess !== "full") return response(403, { error: "Full Inventory access is required for physical booking preparation and handover." });
    const bookingId = Number(body.booking_id);
    if (!isId(bookingId)) return response(400, { error: "Valid booking ID required." });
    const branchId = Number(ctx.branchId);
    return withTransaction(db, async () => {
        const b = await loadBooking(db, { bookingId, storeId, branchId, lock: true });
        if (!b) throw rentalError("Booking is not in your assigned branch.");
        if (!["confirmed", "preparing", "released", "return inspection", "pending settlement"].includes(lower(b.status)))
            throw rentalError("Only confirmed or preparing bookings can be fulfilled.");
        const items = await loadItems(db, bookingId, storeId, true);
        const lines = items.filter((i) => i.item_type === ITEM.CONSUMABLE && i.item_status !== ITEM_STATUS.CANCELLED);
        if (!lines.length) throw rentalError("This booking has no Sales inventory inclusions.");
        if (lines.some((l) => l.item_status !== ITEM_STATUS.RESERVED || Number(l.used_quantity || 0) > 0))
            throw rentalError("Sales inclusions have already been used, cancelled, or need reconciliation.");
        if (step === "prepare") {
            const itemId = Number(body.item_id);
            const line = lines.find((l) => Number(l.id) === itemId);
            if (!line) throw rentalError("Select a valid product inclusion in this booking.");
            if (line.prepared_at || line.released_at) throw rentalError("This product was already prepared or handed over.");
            await db.execute(`UPDATE booking_items SET prepared_at=NOW(), prepared_by=? WHERE id=?`, [actor.id, itemId]);
            await db.execute(`UPDATE bookings SET status='Preparing' WHERE id=? AND store_id=? AND branch_id=? AND status='Confirmed'`,
                [bookingId, storeId, branchId]);
            await logEmployeeAction(db, { storeId, branchId, actor, entityId: bookingId, referenceNumber: b.booking_reference,
                action: "Prepared Sales booking inclusion", details: `Prepared ${line.quantity} × ${line.item_name_snapshot}` });
            return response(200, { success: true, bookingReference: b.booking_reference });
        }
        const money = await getBookingMoney(db, bookingId, storeId);
        const total = bookingTotal(b);
        if (!(total > 0) || money.bookingPaid + 0.005 < total)
            throw rentalError("Full verified booking payment is required before Sales product handover.");
        const rentals = splitItems(items).rentals;
        if (rentals.length && money.depositCollected + 0.005 < Number(b.refundable_deposit_required || 0))
            throw rentalError("Collect the full agreed refundable security deposit before releasing booking items.");
        if (b.handoverDate > rentalTodayManila())
            throw rentalError(`Products can be handed over from the ${handoverLabel(b.handoverMethod).toLowerCase()} date (${b.handoverDate}).`);
        if (lines.some((l) => !l.prepared_at || l.released_at))
            throw rentalError("Every Sales product inclusion must be prepared and not yet handed over.");
        for (const line of lines) {
            const qty = Number(line.quantity);
            const inv = await getVariantInventory(db, { storeId, branchId, variantId: line.variant_id, lock: true });
            if (!inv) throw rentalError(`Inventory record not found for ${line.item_name_snapshot}.`);
            const label = line.variant_name_snapshot ? `${line.item_name_snapshot} — ${line.variant_name_snapshot}` : line.item_name_snapshot;
            await moveInventory(db, { storeId, branchId, inv, bucket: "reserved", change: -qty, movementType: MOVE.ISSUE,
                bookingId, actor, reason: `Handed over ${qty} × ${label} for ${b.booking_reference}.` });
            await moveInventory(db, { storeId, branchId, inv, bucket: "on_hand", change: -qty, movementType: MOVE.ISSUE,
                bookingId, actor, unitCost: await variantCost(db, line.variant_id, storeId),
                reason: `Handed over ${qty} × ${label} for ${b.booking_reference}.` });
            await db.execute(`UPDATE booking_items SET item_status=?, used_quantity=?, released_at=NOW(), released_by=? WHERE id=?`,
                [ITEM_STATUS.RELEASED, qty, actor.id, line.id]);
        }
        const rentalsStillReserved = rentals.some((r) => [ITEM_STATUS.PENDING, ITEM_STATUS.RESERVED].includes(r.item_status));
        if (!rentalsStillReserved)
            await db.execute(`UPDATE bookings SET status='Released' WHERE id=? AND store_id=? AND branch_id=? AND status IN ('Confirmed','Preparing')`,
                [bookingId, storeId, branchId]);
        if (!rentals.length)
            await db.execute(`UPDATE bookings SET status='Pending Settlement' WHERE id=? AND store_id=? AND branch_id=? AND status='Released'`,
                [bookingId, storeId, branchId]);
        await automaticallyCompleteSettledBooking(db, bookingId, storeId);
        await logEmployeeAction(db, { storeId, branchId, actor, entityId: bookingId, referenceNumber: b.booking_reference,
            action: "Released complete Sales booking inclusions",
            details: `Physically handed over ${lines.length} Sales product lines; stock deducted from branch inventory.` });
        return response(200, { success: true, bookingReference: b.booking_reference });
    });
}

async function customerCase(ctx, op) {
    const { db, body, storeId, actor } = ctx;
    const bookingId = requireBookingId(body);
    const b = await loadBooking(db, { bookingId, storeId });
    if (!b) return response(404, { error: "Booking not found." });
    const branchId = Number(b.branch_id);
    if (ctx.role !== "manager" || Number(ctx.branchId) !== branchId || (op !== "get" && ctx.access !== "full"))
        return response(403, { error: "Assigned-branch Manager permission is required." });
    const [custRows] = await db.execute(
        `SELECT id, phone, review_required, identity_verified, review_reason, DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i') AS updatedAt, updated_at
         FROM customers WHERE id=? AND store_id=?`, [b.customer_id, storeId]);
    const customer = custRows[0];
    const money = await getBookingMoney(db, bookingId, storeId);
    const claimDue = depositFigures(b, money).claimBalance;
    if (op === "get") {
        const profile = customer && (Number(customer.review_required) || customer.review_reason)
            ? { reviewRequired: Number(customer.review_required) === 1, identityVerified: Number(customer.identity_verified) === 1,
                reason: customer.review_reason, updatedBy: null, updatedAt: customer.updatedAt } : null;
        const [events] = await db.execute(
            `SELECT id, action, user_name AS actorName, details, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS createdAt
             FROM employee_actions WHERE store_id=? AND entity_type='customer_case' AND entity_id=? ORDER BY id DESC LIMIT 60`,
            [storeId, bookingId]);
        const mapped = events.map((e) => {
            const d = typeof e.details === "string" ? JSON.parse(e.details || "{}") : (e.details || {});
            return { id: Number(e.id), eventType: d.eventType || e.action, notes: d.notes || "", channel: d.channel || "none",
                followUpOn: d.followUpOn || null, actorName: e.actorName, createdAt: e.createdAt };
        });
        let earlierOutstanding = [];
        if (profile?.identityVerified && profile?.reviewRequired && customer.phone) {
            const [rows] = await db.execute(
                `SELECT b.booking_reference AS reference,
                        b.final_additional_charges - b.deposit_applied_amount - COALESCE(SUM(p.amount),0) AS due
                 FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
                                 LEFT JOIN payments p ON p.booking_id=b.id AND p.store_id=b.store_id AND p.payment_type=? AND p.status=?
                 WHERE b.store_id=? AND b.branch_id=? AND b.id<>? AND c.phone=? AND b.settlement_reviewed_at IS NOT NULL
                 GROUP BY b.id, b.booking_reference, b.final_additional_charges, b.deposit_applied_amount HAVING due>0.005`,
                [PAYMENT.CHARGE, PAYMENT.RECORDED, storeId, branchId, bookingId, customer.phone]);
            earlierOutstanding = rows.map((r) => ({ reference: r.reference, due: Number(r.due) }));
        }
        const latest = mapped.find((e) => e.followUpOn)?.followUpOn || null;
        return response(200, { case: { profile, events: mapped, earlierOutstanding, claimDue, latestScheduledFollowUp: latest,
                followUpOverdue: claimDue > 0 && !!latest && latest < rentalTodayManila(), bookingStatus: b.status,
                contact: { phone: String(b.customer_phone || ""), email: String(b.customer_email || ""), facebookName: String(b.customer_facebook || "") },
                identityLookupAvailable: !!customer?.phone } });
    }
    const reason = String(body.notes || body.reason || "").trim().slice(0, 500);
    if (reason.length < 10) return response(400, { error: "Explain the action in at least 10 characters." });
    const followUp = String(body.followUpOn || "").trim();
    if (followUp && !/^\d{4}-\d{2}-\d{2}$/.test(followUp)) return response(400, { error: "Use a valid follow-up date." });
    const channel = String(body.channel || "none").trim().slice(0, 30);
    const logCase = (eventType, notes = reason) => logEmployeeAction(db, { storeId, branchId, actor, entityType: "customer_case",
        entityId: bookingId, referenceNumber: b.booking_reference, action: eventType,
        details: { eventType, notes, channel, followUpOn: followUp || null } });
    if (op === "event") {
        const eventType = String(body.eventType || "");
        if (!["contact_attempt", "notice_recorded", "customer_response", "dispute_recorded", "payment_promise", "collection_escalation"].includes(eventType))
            return response(400, { error: "Invalid case activity." });
        await logCase(eventType);
        return response(200, { success: true });
    }
    if (op === "set_review") {
        if (!customer?.phone) return response(409, { error: "A valid verified customer contact is required before managing a future-booking review." });
        const hold = body.reviewRequired === true;
        if (hold && body.identityVerified !== true)
            return response(409, { error: "Verify that the customer controls the contact information before placing a review flag." });
        await withTransaction(db, async () => {
            await db.execute(`UPDATE customers SET review_required=?, identity_verified=?, review_reason=? WHERE store_id=? AND phone=?`,
                [hold ? 1 : 0, hold ? 1 : 0, reason, storeId, customer.phone]);
            await logCase(hold ? "review_placed" : "review_cleared");
        });
        return response(200, { success: true });
    }
    if (op === "exception") {
        if (!customer || Number(customer.review_required) !== 1 || Number(customer.identity_verified) !== 1)
            return response(409, { error: "This booking has no verified customer-review restriction." });
        if (!["pending review", "awaiting down payment"].includes(lower(b.status)))
            return response(409, { error: "An exception is only valid before booking confirmation." });
        const [previous] = await db.execute(
            `SELECT id FROM employee_actions WHERE store_id=? AND entity_type='customer_case' AND entity_id=?
                                               AND action='confirmation_exception' AND created_at >= ? LIMIT 1`, [storeId, bookingId, customer.updated_at]);
        if (previous.length) return response(409, { error: "This booking already has a Manager exception." });
        await logCase("confirmation_exception");
        return response(200, { success: true });
    }
    // op === "waive"
    return withTransaction(db, async () => {
        const locked = await loadBooking(db, { bookingId, storeId, lock: true });
        if (!locked.settlement_reviewed_at || Number(locked.final_additional_charges) <= 0)
            throw rentalError("Only an existing approved charge can be waived.");
        if (money.chargePaid > 0 || Number(locked.deposit_applied_amount) > 0)
            throw rentalError("Recorded claim payments or applied deposits cannot be erased. Reconcile refunds through an audited financial correction first.");
        await db.execute(`UPDATE bookings SET final_additional_charges=0, settlement_notes=CONCAT(COALESCE(settlement_notes,''),' | Waived: ',?) WHERE id=?`,
            [reason.slice(0, 200), bookingId]);
        await logCase("claim_waived_after_dispute",
            `Previously approved ₱${Number(locked.final_additional_charges).toFixed(2)} waived after documented Manager investigation. ${reason}`.slice(0, 500));
        await automaticallyCompleteSettledBooking(db, bookingId, storeId);
        return response(200, { success: true });
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  HANDLER
// ═════════════════════════════════════════════════════════════════════════════
const BOOKING_READ_ACTIONS = new Set([
    "get_booking_page_bookings", "get_dashboard_bookings", "get_bookings", "get_booking_items",
    "get_booking_financial_statement", "get_booking_claim_sources", "get_customer_review_case",
    "get_booking_fee_policy", "get_staff_sales_booking_queue",
]);
const SALES_QUEUE_ACTIONS = new Set(["get_staff_sales_booking_queue", "prepare_staff_sales_booking_item", "release_staff_sales_booking"]);
const OWNER_FORBIDDEN = new Set(["update_status", "update_price", "update_payment"]);

// STAFF DASHBOARD (from cm's version): read-only, authenticated branch-scoped operational summaries.
// No changes to reservation, release, POS or maintenance write workflows.
function staffDashboardAccess(raw) {
    let p = raw;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
    if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
    const full = module => {
        const value = p[`${module}_access`] === undefined ? p[module] : p[`${module}_access`];
        return value === 'full' || value === true || value === 'true';
    };
    // Match the rental operational guard: legacy standard/boolean grants are not operational Bookings.
    const bookings = p.bookings_access === 'full';
    const inventory = full('inventory');
    return { bookings, inventory, pos: !bookings && full('pos') };
}
function staffDashboardDay(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get = name => parts.find(p=>p.type===name).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}
function staffDashboardTasks(rows, today) {
    const limit = new Date(`${today}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate()+2);
    const prepEnd = limit.toISOString().slice(0,10);
    const groups = new Map();
    for (const r of rows) {
        const status = String(r.bookingStatus).toLowerCase();
        if (!['confirmed','preparing','released','return inspection','pending settlement'].includes(status)) continue;
        const id = String(r.bookingId);
        let g = groups.get(id);
        if (!g) { g = {reference:r.reference,customer:r.customer,prepare:[],release:[],returns:[]}; groups.set(id,g); }
        if (r.itemStatus === 'reserved' && !r.releasedAt && ['confirmed','preparing'].includes(status)) {
            if (r.preparedAt) g.release.push(r.releaseDate);
            else g.prepare.push(r.releaseDate);
        }
        if (r.itemType === 'rental' && r.itemStatus === 'released' && !r.returnedAt && Number(r.quantity)>Number(r.returnedQuantity)) g.returns.push(r.returnDate);
    }
    const tasks = [];
    for (const [id,g] of groups) {
        const add = (dates, status, cutoff) => {
            const date = dates.filter(d=>typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d<=cutoff).sort()[0];
            if (date) tasks.push({key:`${id}:${status}`,reference:g.reference,customer:g.customer,scheduledDate:date,status});
        };
        // One task per booking/status; incomplete preparation blocks release for the same scheduled date.
        add(g.prepare,'To Prepare',prepEnd);
        add(g.release.filter(d=>!g.prepare.includes(d)),'For Release',today);
        add(g.returns,'Expected Return',today);
    }
    const rank = {'Expected Return':0,'For Release':1,'To Prepare':2};
    return tasks.sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate)||rank[a.status]-rank[b.status]||a.reference.localeCompare(b.reference));
}
async function staffDashboardSummary(db, actor, auth) {
    const storeId = Number(actor.store_id), branchId = Number(actor.branch_id);
    if (auth.tokenRole !== 'staff' || Number(auth.storeId)!==storeId || !isId(branchId) || Number(auth.tokenBranchId)!==branchId || Number(auth.decoded.staff_id)!==Number(actor.id))
        return response(403,{error:'Active Staff account and current assigned branch required.'});
    const access = staffDashboardAccess(actor.permissions), today = staffDashboardDay();
    const result = {success:true,access,today,branchId,staffId:String(actor.id),tasks:null,alerts:null,repair:null,condition:null,consumableHealth:null,inventoryAlertSummary:null,walkIn:null,errors:[]};
    // One snapshot for all authorized sections; only SELECTs are executed.
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    try {
        if (access.bookings) {
            try {
                // Release date = the pickup/delivery date (same rule as the Staff Booking Queue).
                const [rows] = await db.execute(`SELECT b.id AS bookingId,b.booking_reference AS reference,c.full_name AS customer,
                                                        b.status AS bookingStatus,bi.item_type AS itemType,bi.item_status AS itemStatus,bi.quantity,bi.returned_quantity AS returnedQuantity,
                                                        bi.prepared_at AS preparedAt,bi.released_at AS releasedAt,bi.returned_at AS returnedAt,
                                                        DATE_FORMAT(COALESCE(b.handover_date,b.rental_start_date,b.event_date),'%Y-%m-%d') AS releaseDate,
                                                        DATE_FORMAT(COALESCE(b.rental_end_date,b.event_end_date,b.rental_start_date,b.event_date),'%Y-%m-%d') AS returnDate
                                                 FROM bookings b JOIN booking_items bi ON bi.booking_id=b.id AND bi.store_id=b.store_id
                                                                 JOIN customers c ON c.id=b.customer_id AND c.store_id=b.store_id
                                                 WHERE b.store_id=? AND b.branch_id=? AND LOWER(b.status) IN ('confirmed','preparing','released','return inspection','pending settlement')
                                                   AND bi.item_type IN ('consumable','rental') AND bi.item_status IN ('reserved','released')`,[storeId,branchId]);
                result.tasks=staffDashboardTasks(rows,today);
            } catch(e) { console.error('Staff dashboard tasks:',e.code); result.errors.push('Booking tasks unavailable.'); }
        }
        if (access.inventory) {
            let stockAlertSummary = null;
            try {
                // Same v2 sellable-stock formula as getProducts: exclude reserved, unavailable and expired stock.
                const [rows] = await db.execute(`SELECT bi.id AS stockId,p.product_name AS name,p.has_variants AS hasVariants,v.variant_name AS variantName,
                                                        CASE WHEN bi.expiration_date IS NULL OR bi.expiration_date>=? THEN GREATEST(CAST(bi.on_hand_quantity AS SIGNED)-bi.reserved_quantity-bi.unavailable_quantity,0) ELSE 0 END AS available,
                                                        bi.reorder_level AS threshold, DATE_FORMAT(bi.expiration_date,'%Y-%m-%d') AS expirationDate
                                                 FROM branch_inventory bi JOIN product_variants v ON v.id=bi.variant_id AND v.store_id=bi.store_id
                                                                          JOIN products p ON p.id=v.product_id AND p.store_id=bi.store_id
                                                 WHERE bi.store_id=? AND bi.branch_id=? AND bi.status='active' AND v.status='active' AND p.status='active'
                                                   AND p.deleted_at IS NULL AND v.deleted_at IS NULL
                                                   AND ((p.has_variants=0 AND v.is_default=1) OR (p.has_variants=1 AND v.is_default=0))`,[today,storeId,branchId]);
                result.alerts=rows.filter(r=>Number(r.available)===0||Number(r.available)<=Number(r.threshold)).map(r=>({key:String(r.stockId),product:Number(r.hasVariants)?`${r.name} (${r.variantName})`:r.name,available:Number(r.available),status:Number(r.available)===0?'Out of Stock':'Low Stock'})).sort((a,b)=>a.available-b.available||a.product.localeCompare(b.product));
                const outOfStock = result.alerts.filter(r=>r.status==='Out of Stock').length;
                const lowStock = result.alerts.length-outOfStock;
                if (!access.bookings) {
                    result.consumableHealth = {healthy:rows.length-result.alerts.length,lowStock,outOfStock};
                    const cutoff = new Date(today+'T00:00:00Z');
                    cutoff.setUTCDate(cutoff.getUTCDate()+30);
                    const end = cutoff.toISOString().slice(0,10);
                    const dates = rows.map(r=>r.expirationDate).filter(d=>typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
                    stockAlertSummary = {expiring:dates.filter(d=>d>=today && d<=end).length,expired:dates.filter(d=>d<today).length,lowStock,outOfStock};
                }
            } catch(e) { console.error('Staff dashboard stock:',e.code); result.errors.push('Stock alerts unavailable.'); }
            try {
                // Staff Rental Inventory groups non-routine maintenance cases (In Repair / For Inspection) as repairs.
                const [rows] = await db.execute(`SELECT e.id,e.equipment_number AS equipmentNo,e.equipment_name AS product,
                                                        bi.on_hand_quantity AS totalUnits,bi.unavailable_quantity AS unavailableUnits,
                                                        COALESCE((SELECT SUM(si.quantity-si.quantity_resolved) FROM stock_issues si
                                                                  WHERE si.store_id=bi.store_id AND si.branch_id=bi.branch_id AND si.branch_inventory_id=bi.id
                                                                    AND si.issue_type='maintenance' AND si.status IN ('In Repair','For Inspection') AND si.quantity>si.quantity_resolved),0) AS repairUnits
                                                 FROM branch_inventory bi JOIN equipment e ON e.id=bi.equipment_id AND e.store_id=bi.store_id
                                                 WHERE bi.store_id=? AND bi.branch_id=? AND bi.status='active' AND e.status='active' AND e.deleted_at IS NULL`,[storeId,branchId]);
                if (rows.some(r=>Number(r.repairUnits)>Number(r.unavailableUnits)||Number(r.unavailableUnits)>Number(r.totalUnits))) throw new Error('Inconsistent equipment condition');
                result.repair=rows.filter(r=>Number(r.repairUnits)>0).map(r=>({key:String(r.id),equipmentNo:r.equipmentNo,product:r.product,units:Number(r.repairUnits),status:'Under Repair'})).sort((a,b)=>a.product.localeCompare(b.product));
                if (!access.bookings && stockAlertSummary) {
                    // Count equipment records, not units, so each slice represents alert occurrences.
                    result.inventoryAlertSummary = {...stockAlertSummary,underRepair:result.repair.length};
                }
                if(!access.bookings) result.condition={serviceable:rows.reduce((n,r)=>n+Number(r.totalUnits)-Number(r.unavailableUnits),0),underRepair:result.repair.reduce((n,r)=>n+r.units,0),otherUnavailable:rows.reduce((n,r)=>n+Number(r.unavailableUnits)-Number(r.repairUnits),0)};
            } catch(e) { console.error('Staff dashboard repair:',e.code); result.errors.push('Equipment condition unavailable.'); }
        }
        if (access.pos) {
            try {
                // order_date is a date-only checkout value; created_at is the actual checkout timestamp.
                // Convert the DB session's wall-clock timestamps to Manila using its present UTC offset.
                const [rows] = await db.execute(`SELECT HOUR(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP())+28800,o.created_at)) AS hour,
                                                     COUNT(*) AS transactions,COALESCE(SUM((SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.order_id AND oi.store_id=o.store_id)),0) AS items
                                                 FROM orders o WHERE o.store_id=? AND o.branch_id=? AND LOWER(o.status)='completed'
                                                                 AND UPPER(COALESCE(o.payment_mode,'')) IN ('CASH','GCASH','BANK_TRANSFER')
                                                                 AND DATE(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,NOW(),UTC_TIMESTAMP())+28800,o.created_at))=? GROUP BY hour`,[storeId,branchId,today]);
                result.walkIn=Array.from({length:24},(_,hour)=>({hour,transactions:0,items:0}));
                for(const row of rows) result.walkIn[Number(row.hour)]={hour:Number(row.hour),transactions:Number(row.transactions),items:Number(row.items)};
            } catch(e) { console.error('Staff dashboard walk-in:',e.code); result.errors.push('Walk-in activity unavailable.'); }
        }
        await db.commit();
        return response(200,result);
    } catch(e) { await db.rollback(); throw e; }
}

exports.handler = async (event) => {
    const method = event.httpMethod || event.requestContext?.http?.method;
    if (method === "OPTIONS") return { statusCode: 200, headers, body: "" };

    let connection;
    try {
        const body = parseBody(event);
        const action = body.action;
        connection = await dbPool.getConnection();

        if (Object.hasOwn(PUBLIC_ACTIONS, String(action))) return await PUBLIC_ACTIONS[action](connection, body);

        let auth;
        try { auth = verifyProtectedStore(event); }
        catch (err) { return response(401, { error: err.message === "No token" ? "No token" : "Invalid token" }); }
        const { storeId, tokenRole: role } = auth;
        if (!storeId) return response(401, { error: "Invalid token store" });
        if (!["owner", "manager", "staff"].includes(role)) return response(403, { error: "Business account role required." });

        const actorRow = await resolveActor(connection, auth.decoded, storeId, role);
        if (!actorRow) return response(403, { error: "Your account was not found or is inactive in this store." });
        // Staff Dashboard (cm): read-only summary for the Staff dashboard page.
        if (action === "get_staff_operational_dashboard") {
            if (role !== "staff") return response(403, { error: "Staff account required." });
            return await staffDashboardSummary(connection, actorRow, auth);
        }
        const actor = actorView(actorRow);
        const access = role === "owner" ? "full" : normalizeOperationalAccess(actorRow.permissions, "bookings", role);
        const salesAccess = role === "staff" && SALES_QUEUE_ACTIONS.has(action)
            ? normalizeOperationalAccess(actorRow.permissions, "inventory", "staff") : "none";

        if (access === "none" && !(role === "staff" && SALES_QUEUE_ACTIONS.has(action) && salesAccess !== "none"))
            return response(403, { error: "Bookings access is not permitted for this account." });
        if (role === "staff" && !BOOKING_READ_ACTIONS.has(action) && !(SALES_QUEUE_ACTIONS.has(action) && salesAccess === "full"))
            return response(403, { error: "Staff requires authorized Bookings operations access for this action." });
        if (role === "manager" && access !== "full" && !BOOKING_READ_ACTIONS.has(action))
            return response(403, { error: "Full Bookings access is required for this action." });
        if (role === "owner" && OWNER_FORBIDDEN.has(action))
            return response(403, { error: "Operational booking changes require an authorized Manager or Staff workflow." });
        if (SALES_QUEUE_ACTIONS.has(action) && role !== "staff")
            return response(403, { error: "Staff operations account required." });

        let branchId = null;
        if (role === "manager" || role === "staff") {
            branchId = Number(actorRow.branch_id || auth.tokenBranchId);
            if (!isId(branchId)) return response(403, { error: "A valid assigned branch is required." });
            const requested = body.branch_id ?? body.branchId;
            if (requested !== undefined && requested !== null && requested !== "" && Number(requested) !== branchId)
                return response(403, { error: "You cannot access a different branch." });
            body.branch_id = branchId;
            body.branchId = branchId;
        }

        if (!Object.hasOwn(PROTECTED_ACTIONS, String(action))) return response(400, { error: "Invalid action" });
        const handler = PROTECTED_ACTIONS[action];
        return await handler({ db: connection, body, storeId, role, branchId, actor, access, salesAccess, decoded: auth.decoded });
    } catch (err) {
        if (err.rentalValidation) return response(err.status || 409, { error: err.message });
        if (err.code === "ER_DUP_ENTRY") return response(409, { error: "This record was already saved. Refresh before retrying." });
        console.error("BOOKINGS LAMBDA ERROR:", err);
        return response(500, { error: err.message || "Bookings Lambda failed" });
    } finally {
        if (connection) connection.release();
    }
};

// Exposed for local tests only.
exports._internals = { rentalPeakReserved, catalogOnlyBookingText, normalizeEventTime, paymentStatusLabel };
