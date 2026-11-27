/* eslint-disable @typescript-eslint/no-require-imports */
/** stores, branches, users (owner / managers / staff), subscriptions, subscription_payments. */
const zlib = require("zlib");
const { CONFIG } = require("../lib/config");
const V = require("../lib/vocab");
const { addDays, dt } = require("../lib/dates");
const { personName, phMobile } = require("../lib/random");

const STORE_NAMES = ["Demo Party Store", "Sunshine Party Supplies", "Fiesta Events Hub", "Balloon Republic",
    "Celebrate PH Party Shop", "Happy Hour Events", "Confetti Corner", "Partyland Manila", "Bright Occasions"];
const BRANCHES = [
    ["MN", "Main Branch", "123 Aurora Blvd, Cubao, Quezon City"],
    ["MK", "Makati", "45 Kalayaan Ave, Poblacion, Makati City"],
    ["PS", "Pasig", "88 Ortigas Ave Extension, Pasig City"],
    ["AL", "Alabang", "12 Commerce Ave, Alabang, Muntinlupa City"],
    ["MR", "Marikina", "301 Shoe Ave, Sto. Niño, Marikina City"],
];

// Same permission JSON shapes as the team's users table.
const MANAGER_PERMISSIONS = { pos: "full", reports: "full", bookings: "full", packages: "full", analytics: "full",
    inventory: "full", forecasting: "full", staff_management: "full" };
const STAFF_PERMISSIONS = { pos: true, reports: true, bookings: true, packages: true, analytics: false, dashboard: true,
    inventory: true, pos_access: "full", forecasting: false, package_access: "full", reports_access: "full",
    bookings_access: "full", analytics_access: "none", inventory_access: "full", forecasting_access: "none",
    inventory_stock_receive: false };
// Main-branch Staff can view Analytics and Forecasting; Staff in the other branches cannot (to test both cases).
const MAIN_STAFF_PERMISSIONS = { ...STAFF_PERMISSIONS, analytics: true, analytics_access: "view", forecasting: true, forecasting_access: "view" };

function initials(name) {
    return name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 4);
}

// A small, valid PNG used as the GCash receipt image for seeded subscription payments.
let receiptPng = null;
function placeholderReceipt() {
    if (receiptPng) return receiptPng;
    const w = 120, h = 160;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y += 1) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x += 1) {
            const o = y * (w * 3 + 1) + 1 + x * 3;
            const header = y < 28, line = y > 40 && y % 18 < 3 && x > 12 && x < w - 12;
            raw[o] = header ? 0 : line ? 200 : 245;
            raw[o + 1] = header ? 112 : line ? 200 : 247;
            raw[o + 2] = header ? 224 : line ? 210 : 250;
        }
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    receiptPng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
    return receiptPng;
}

/**
 * Builds one store and its people. Returns the in-memory context used by later steps.
 * @param scenario  "active" | "expiring" | "expired"  (subscription test case)
 */
async function buildStore({ ids, rng, index, tier, plan, scenario, passwordHash, admin, storeStart }) {
    const name = STORE_NAMES[index % STORE_NAMES.length] + (index >= STORE_NAMES.length ? ` ${index + 1}` : "");
    const tagCode = CONFIG.runTag.replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 6);
    const n = index + 1;
    const storeId = await ids.take("stores");
    // Store codes must be 2-8 letters/digits with no dash, or POS checkout and new
    // Product Nos. are rejected ("Store/branch initials are missing or invalid").
    const codeSuffix = index >= STORE_NAMES.length ? String(n) : "";
    const storeCode = `${initials(name)}${tagCode}`.slice(0, 8 - codeSuffix.length) + codeSuffix;
    const isVat = tier === "scale";
    const created = dt(storeStart, 9, 0);
    const store = {
        id: storeId, store_code: storeCode, slug: `${CONFIG.slugPrefix}${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}`.slice(0, 150),
        store_name: name, business_name: `${name} Trading`, email: `store.s${n}@${CONFIG.emailDomain}`, phone: phMobile(rng),
        address: BRANCHES[0][2], tax_registration: isVat ? V.TAX.VAT : V.TAX.NON_VAT,
        tin: isVat ? `${rng.int(100, 999)}-${rng.int(100, 999)}-${rng.int(100, 999)}-000` : null,
        status: V.STORE_STATUS, created_at: created, updated_at: created,
    };

    const maxBranches = Number(plan.max_branches) || Infinity;
    const branchCount = Math.min(CONFIG.size.branches[tier], maxBranches, BRANCHES.length);
    const branches = [];
    for (let b = 0; b < branchCount; b += 1) {
        const [code, label, address] = BRANCHES[b];
        branches.push({ id: await ids.take("branches"), store_id: storeId, branch_code: code, branch_name: label, address,
            phone: phMobile(rng), email: `branch.s${n}.${code.toLowerCase()}@${CONFIG.emailDomain}`, status: "active",
            created_at: dt(storeStart, 9, 5 + b), updated_at: dt(storeStart, 9, 5 + b) });
    }

    const verifiedAt = dt(storeStart, 9, 1);
    const lastLogin = dt(addDays(CONFIG.today, -rng.int(0, 3)), rng.int(8, 18), rng.int(0, 59));
    const owner = { id: await ids.take("users"), store_id: storeId, branch_id: null, manager_id: null, employee_code: null,
        full_name: personName(rng), role: V.ROLE.OWNER, email: `owner.s${n}@${CONFIG.emailDomain}`, password_hash: passwordHash,
        phone: store.phone, permissions: null, status: V.USER_STATUS, invited_by: null, email_verified_at: verifiedAt,
        last_login_at: lastLogin, created_at: created, updated_at: created };
    const users = [owner];
    const staffLimit = Number(plan.max_staff) || Infinity;
    let staffCount = 0, managerSeq = 0, staffSeq = 0;
    for (const branch of branches) {
        const bc = branch.branch_code.toLowerCase();
        managerSeq += 1;
        const manager = { id: await ids.take("users"), store_id: storeId, branch_id: branch.id, manager_id: null,
            employee_code: `${storeId}-${branch.id}-MN-${String(managerSeq).padStart(4, "0")}`, full_name: personName(rng),
            role: V.ROLE.MANAGER, email: `manager.s${n}.${bc}@${CONFIG.emailDomain}`, password_hash: passwordHash,
            phone: phMobile(rng), permissions: JSON.stringify(MANAGER_PERMISSIONS), status: V.USER_STATUS, invited_by: owner.id,
            email_verified_at: dt(storeStart, 10, 0), last_login_at: dt(addDays(CONFIG.today, -rng.int(0, 2)), 8, rng.int(0, 59)),
            created_at: dt(storeStart, 9, 30), updated_at: dt(storeStart, 10, 0) };
        users.push(manager);
        branch.managerId = manager.id;
        branch.staffIds = [];
        if (staffCount < staffLimit) {
            staffSeq += 1; staffCount += 1;
            const staff = { id: await ids.take("users"), store_id: storeId, branch_id: branch.id, manager_id: manager.id,
                employee_code: `${storeId}-${branch.id}-SF-${String(staffSeq).padStart(4, "0")}`, full_name: personName(rng),
                role: V.ROLE.STAFF, email: `staff.s${n}.${bc}@${CONFIG.emailDomain}`, password_hash: passwordHash,
                phone: phMobile(rng), permissions: JSON.stringify(branch === branches[0] ? MAIN_STAFF_PERMISSIONS : STAFF_PERMISSIONS),
                status: V.USER_STATUS, invited_by: manager.id,
                email_verified_at: dt(storeStart, 11, 0), last_login_at: dt(addDays(CONFIG.today, -rng.int(0, 1)), 8, rng.int(0, 59)),
                created_at: dt(storeStart, 10, 30), updated_at: dt(storeStart, 11, 0) };
            users.push(staff);
            branch.staffIds.push(staff.id);
        }
        // Branches without a staff seat (plan limit) let the manager handle staff tasks.
        branch.workerIds = branch.staffIds.length ? branch.staffIds : [manager.id];
    }

    const { subscription, payments } = await buildSubscription({ ids, rng, storeId, plan, scenario, admin, storeStart, n });
    return { store, branches, users, owner, subscription, subscriptionPayments: payments, tier, plan, n, storeStart, isVat };
}

async function buildSubscription({ ids, rng, storeId, plan, scenario, admin, storeStart, n }) {
    const id = await ids.take("subscriptions");
    const price = Number(plan.price);
    const today = CONFIG.today;
    const payments = [];
    const tenDigits = () => `${rng.int(1000, 9999)}${rng.int(100000, 999999)}${rng.int(100, 999)}`;
    const approvedPayment = async (submitted) => {
        const reviewed = addDays(submitted, 1);
        payments.push({ id: await ids.take("subscription_payments"), store_id: storeId, plan_id: plan.id, subscription_id: id,
            amount: price, payment_method: "GCash", reference_number: tenDigits(),
            receipt_storage_key: `seed/${CONFIG.runTag}/store${n}/receipt-${payments.length + 1}.png`,
            receipt_data: placeholderReceipt(), receipt_mime_type: "image/png", status: V.SUBSCRIPTION_PAYMENT_STATUS.APPROVED,
            rejection_reason: null, submitted_at: dt(submitted, rng.int(9, 19), rng.int(0, 59)), reviewed_by: admin.id,
            reviewed_at: dt(reviewed, rng.int(9, 17), rng.int(0, 59)) });
        return reviewed;
    };

    let status = V.SUBSCRIPTION_STATUS.ACTIVE, startedAt, expiresAt = null, lastRenewed = null;
    if (price <= 0) {
        startedAt = storeStart; // Free Starter plan: no expiry and no payments.
    } else {
        const expiry = scenario === "expired" ? addDays(today, -rng.int(15, 40))
            : scenario === "expiring" ? addDays(today, rng.int(3, 6)) : addDays(today, rng.int(20, 28));
        // Monthly renewals: one approved GCash payment per 30-day cycle.
        const cycles = Math.min(6, Math.max(1, Math.floor((Date.parse(expiry) - Date.parse(storeStart)) / (30 * 86400000))));
        for (let c = cycles; c >= 1; c -= 1) lastRenewed = await approvedPayment(addDays(expiry, -30 * c - 1));
        startedAt = addDays(expiry, -30);
        expiresAt = expiry;
        status = scenario === "expired" ? V.SUBSCRIPTION_STATUS.EXPIRED
            : scenario === "expiring" ? V.SUBSCRIPTION_STATUS.EXPIRING : V.SUBSCRIPTION_STATUS.ACTIVE;
        if (scenario === "expiring") {
            // Renewal waiting for the platform admin to review (Admin → Subscription payments).
            const submitted = addDays(today, -1);
            payments.push({ id: await ids.take("subscription_payments"), store_id: storeId, plan_id: plan.id, subscription_id: id,
                amount: price, payment_method: "GCash", reference_number: tenDigits(),
                receipt_storage_key: `seed/${CONFIG.runTag}/store${n}/receipt-pending.png`, receipt_data: placeholderReceipt(),
                receipt_mime_type: "image/png", status: V.SUBSCRIPTION_PAYMENT_STATUS.PENDING, rejection_reason: null,
                submitted_at: dt(submitted, 14, rng.int(0, 59)), reviewed_by: null, reviewed_at: null });
        }
        if (scenario === "expired") {
            // A rejected renewal attempt, so the admin "Rejected" filter has data.
            const submitted = addDays(expiresAt, -2);
            payments.push({ id: await ids.take("subscription_payments"), store_id: storeId, plan_id: plan.id, subscription_id: id,
                amount: price, payment_method: "GCash", reference_number: tenDigits(),
                receipt_storage_key: `seed/${CONFIG.runTag}/store${n}/receipt-rejected.png`, receipt_data: placeholderReceipt(),
                receipt_mime_type: "image/png", status: V.SUBSCRIPTION_PAYMENT_STATUS.REJECTED,
                rejection_reason: "The GCash reference number does not match the uploaded receipt.",
                submitted_at: dt(submitted, 10, 15), reviewed_by: admin.id, reviewed_at: dt(addDays(submitted, 1), 11, 0) });
        }
    }
    const subscription = { id, store_id: storeId, plan_id: plan.id, status, started_at: dt(startedAt, 9, 0),
        expires_at: expiresAt ? dt(expiresAt, 23, 59, 59) : null, last_renewed_at: lastRenewed ? dt(lastRenewed, 12, 0) : null,
        scheduled_plan_id: null, scheduled_change_at: null, expiring_notice_sent_at: null, expired_notice_sent_at: null,
        created_at: dt(storeStart, 9, 0), updated_at: dt(lastRenewed || storeStart, 12, 0) };
    return { subscription, payments };
}

module.exports = { buildStore, STORE_NAMES };
