const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const tls = require("tls");
const fs = require("fs");

/*
 * Shared subscription entitlement checks.
 *
 * Subscription management belongs to the store owner, but plan limits are
 * enforced at the API boundary so managers/staff (and public booking pages)
 * cannot bypass the active store plan.
 */

function normalizeLimit(value) {
    if (value === null || value === undefined || Number(value) === 0) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// Legacy stores.plan is a display cache, not the source of subscription entitlement.
// Reconcile it only if it differs from the currently effective (paid/grace/free) plan.
async function syncStorePlanLabel(connection, storeId, effectivePlanName) {
    if (!effectivePlanName) return;
    await connection.execute(
        "UPDATE stores SET plan = ? WHERE id = ? AND (plan IS NULL OR plan <> ?)",
        [effectivePlanName, Number(storeId), effectivePlanName]
    );
}

// Paid subscriptions remain usable through their displayed expiration date.
// A single eligible payment submitted before expiry can retain paid access for
// up to 48 hours while the administrator reviews it. No records are deleted.
async function getActivePlan(connection, storeId) {
    await processDueSubscriptionPlanChange(connection, Number(storeId));
    const [rows] = await connection.execute(
        `SELECT p.id, p.name, p.price, p.max_inventory, p.max_bookings,
                p.max_staff, p.max_branches, p.has_low_stock_alerts,
                p.has_analytics, p.has_forecasting, p.has_multi_store,
                s.expires_at, s.status,
                CASE WHEN s.expires_at IS NOT NULL AND DATE(s.expires_at) < CURDATE()
             THEN 1 ELSE 0 END AS is_past_expiry
         FROM subscriptions s INNER JOIN plans p ON p.id = s.plan_id
         WHERE s.store_id = ? AND LOWER(s.status) IN ('active','expiring')
         ORDER BY s.id DESC LIMIT 1`, [Number(storeId)]
    );
    const paid = rows[0] || null;
    const normalized = (plan, accessStatus) => ({
        id: Number(plan.id), name: String(plan.name || 'Starter'),
        price: Number(plan.price || 0),
        max_inventory: normalizeLimit(plan.max_inventory),
        max_bookings: normalizeLimit(plan.max_bookings),
        max_staff: normalizeLimit(plan.max_staff),
        max_branches: normalizeLimit(plan.max_branches),
        has_low_stock_alerts: Boolean(plan.has_low_stock_alerts),
        has_analytics: Boolean(plan.has_analytics),
        has_forecasting: Boolean(plan.has_forecasting),
        has_multi_store: Boolean(plan.has_multi_store),
        access_status: accessStatus,
    });
    if (paid && !Number(paid.is_past_expiry)) {
        await syncStorePlanLabel(connection, storeId, paid.name);
        return normalized(paid, 'PAID');
    }
    if (paid && Number(paid.price) > 0) {
        // Two calendar days after the expiration day, pending review only.
        // A submission made after expiration cannot create a new grace period.
        const paymentColumns = await getPlanColumnsForOwner(connection);
        // Older payment schemas may call this column submitted_at or payment_date.
        // Never grant grace without verifiable pre-expiry submission time.
        if (paymentColumns.createdAt) {
            const [eligible] = await connection.execute(
                `SELECT p.id FROM payments p
                 WHERE p.store_id = ? AND UPPER(p.status) = 'PENDING'
                   AND DATE(p.${paymentColumns.createdAt}) <= DATE(?)
                   AND CURDATE() <= DATE_ADD(DATE(?), INTERVAL 2 DAY)
                 ORDER BY p.id ASC LIMIT 1`,
                [Number(storeId), paid.expires_at, paid.expires_at]
            );
            if (eligible.length > 0) {
                await syncStorePlanLabel(connection, storeId, paid.name);
                return normalized(paid, 'GRACE');
            }
        }
    }
    const [starterRows] = await connection.execute(
        `SELECT id, name, price, max_inventory, max_bookings, max_staff,
                max_branches, has_low_stock_alerts, has_analytics,
                has_forecasting, has_multi_store
         FROM plans WHERE is_archived = 0 AND (LOWER(name) = 'starter' OR price = 0)
         ORDER BY price ASC, id ASC LIMIT 1`
    );
    if (!starterRows.length) return null;
    await syncStorePlanLabel(connection, storeId, starterRows[0].name);
    return normalized(starterRows[0], 'STARTER_FALLBACK');
}

async function getStoreUsage(connection, storeId) {
    const [inventoryRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM products
         WHERE store_id = ?
           AND deleted_at IS NULL`,
        [Number(storeId)]
    );

    const [bookingRows] = await connection.execute(
        `SELECT COUNT(*) AS total FROM bookings
         WHERE store_id = ? AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           AND created_at < DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')`,
        [Number(storeId)]
    );

    const [staffRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM staff
         WHERE store_id = ?
           AND status IN ('active', 'pending')`,
        [Number(storeId)]
    );

    const [branchRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM branches
         WHERE store_id = ?
           AND COALESCE(status, 'active') <> 'deleted'`,
        [Number(storeId)]
    );

    return {
        inventory: Number(inventoryRows[0]?.total || 0),
        bookings: Number(bookingRows[0]?.total || 0),
        staff: Number(staffRows[0]?.total || 0),
        branches: Number(branchRows[0]?.total || 0),
    };
}

function makeLimitError(resource, plan, current, limit, increment = 1, role = "") {
    const labels = {
        inventory: "inventory items",
        bookings: "bookings",
        staff: "staff accounts",
        branches: "branches",
    };

    const label = labels[resource] || resource;
    const isOwner = role === "owner";
    const ownerAction = isOwner
        ? "Upgrade your plan to add more."
        : "Contact your account owner to upgrade.";

    const error = new Error(
        `Plan limit reached: your ${plan?.name || "current"} plan allows up to ${limit} ${label}. ${ownerAction}`
    );
    error.statusCode = 409;
    error.code = `${String(resource).toUpperCase()}_LIMIT_REACHED`;
    error.plan_name = plan?.name || "Current plan";
    error.resource = resource;
    error.current = current;
    error.limit = limit;
    error.requested = current + increment;
    return error;
}

async function assertPlanLimit(
    connection,
    storeId,
    resource,
    increment = 1,
    role = ""
) {
    const plan = await getActivePlan(connection, storeId);

    if (!plan) {
        const error = new Error("No active subscription plan is configured for this store.");
        error.statusCode = 500;
        error.code = "PLAN_NOT_CONFIGURED";
        throw error;
    }

    const usage = await getStoreUsage(connection, storeId);
    const current = Number(usage[resource] || 0);
    const limit = plan[`max_${resource}`];

    if (limit !== null && current + Number(increment) > limit) {
        throw makeLimitError(resource, plan, current, limit, Number(increment), role);
    }

    return { plan, usage, current, limit };
}

module.exports = {
    getActivePlan,
    getStoreUsage,
    assertPlanLimit,
};


const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";

const OTP_EXPIRY_SECONDS = 90;
const MANAGER_INVITE_OTP_EXPIRY_SECONDS = OTP_EXPIRY_SECONDS;
const STAFF_INVITE_OTP_EXPIRY_SECONDS = OTP_EXPIRY_SECONDS;
const PAYMENT_OTP_EXPIRY_SECONDS = 300;
// Separate limits for accepted OTP emails and failed email-delivery attempts.
const PAYMENT_OTP_MAX_SENT_PER_WINDOW = 5;
const PAYMENT_OTP_MAX_FAILED_PER_WINDOW = 3;
const PAYMENT_OTP_RATE_WINDOW_MINUTES = 10;

// Local subscription-payment OTP terminal fallback is explicit opt-in only.
// A normal `npm run dev` must not silently treat failed Gmail delivery as success.
// For isolated local debugging, explicitly set PAYMENT_OTP_TERMINAL_DEBUG=true.
// Never enable this flag in production: it prints private OTP codes to logs.
const PAYMENT_OTP_TERMINAL_DEBUG =
    String(process.env.PAYMENT_OTP_TERMINAL_DEBUG || "").toLowerCase() === "true" &&
    String(process.env.NODE_ENV || "").toLowerCase() !== "production";

// Local invitation testing / recovery.
// Invitation links remain usable even when SMTP cannot deliver a demo email.
// In development, failed Manager/Staff invitations are also printed to the
// server terminal so activation can still be tested safely.
const INVITATION_TERMINAL_DEBUG =
    String(process.env.INVITATION_TERMINAL_DEBUG || "").toLowerCase() === "true" ||
    String(process.env.NODE_ENV || "").toLowerCase() === "development";

const SMTP_NETWORK_ERROR_CODES = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
]);

function isSmtpNetworkError(error) {
    return SMTP_NETWORK_ERROR_CODES.has(String(error?.code || "").toUpperCase());
}

function logDevelopmentInvitationFallback({
                                              role,
                                              email,
                                              name,
                                              storeName,
                                              branchName,
                                              inviteLink,
                                              errorMessage,
                                          }) {
    if (!INVITATION_TERMINAL_DEBUG) return;

    console.warn(
        `[StockNBook DEV INVITE] ${role} invitation email was not delivered. ` +
        `Use the backup invitation link for local testing.`,
        {
            role,
            name: name || "",
            email: email || "",
            store: storeName || "",
            branch: branchName || "",
            invite_link: inviteLink || "",
            email_error: errorMessage || "",
        }
    );
}

const SMTP_USER = "noreplystocknbook@gmail.com";

// Replace this value with a CURRENT 16-character Google App Password
// generated for the same Gmail account used in SMTP_USER.
// Do not use the normal Gmail account password.
const SMTP_PASS = "xokj flbi mavr shyt"
    .replace(/\s/g, "");

const EMAIL_FROM =
    `"StockNBook" <${SMTP_USER}>`;

const EMAIL_REPLY_TO = SMTP_USER;

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT_MS = 20000;

const APP_BASE_URL =
    String(
        process.env.APP_BASE_URL ||
        process.env.APP_URL ||
        "http://localhost:3000"
    ).replace(/\/+$/, "");
function generateOtp() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashOtp(otp) {
    return crypto
        .createHash("sha256")
        .update(String(otp))
        .digest("hex");
}

async function ensureSignupOtpsTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS signup_otps (
                                                   id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                   email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_signup_otps_email (email),
            INDEX idx_signup_otps_lookup (
                                             email,
                                             otp_hash,
                                             used,
                                             expires_at
                                         )
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}


async function ensurePaymentOtpsTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS payment_otps (
                                                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                    store_id BIGINT NOT NULL,
                                                    email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_payment_otps_store (store_id),
            INDEX idx_payment_otps_lookup (
                                              store_id,
                                              otp_hash,
                                              used,
                                              expires_at
                                          )
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}


// Track SMTP failures separately so undelivered OTPs do not exhaust the
// five-email allowance, while repeated failed attempts remain rate-limited.
// Auto-created on first payment-OTP request; no changes to existing tables.
async function ensurePaymentOtpEmailFailuresTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS payment_otp_email_failures (
                                                                  id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                                  store_id BIGINT NOT NULL,
                                                                  smtp_error_code VARCHAR(50) NOT NULL,
            attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_payment_otp_email_failures_store_time (store_id, attempted_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

function paymentOtpRetrySeconds(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

// Display the remaining wait in readable units instead of only minutes.
function formatPaymentOtpWaitTime(seconds) {
    const totalMinutes = Math.max(1, Math.ceil(Number(seconds) / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    if (minutes === 0) return hourText;
    return `${hourText} and ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function paymentOtpCooldownResponse(headers, message, retryAfterSeconds, code) {
    return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": String(retryAfterSeconds) },
        body: JSON.stringify({
            error: message,
            code,
            retry_after_seconds: retryAfterSeconds,
        }),
    };
}


function hashInviteToken(inviteToken) {
    return crypto
        .createHash("sha256")
        .update(String(inviteToken))
        .digest("hex");
}

async function ensureManagerInviteOtpsTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS manager_invite_otps (
                                                           id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                           invite_token_hash CHAR(64) NOT NULL,
            email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            verified_at DATETIME NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_manager_invite_otp_email (email),
            INDEX idx_manager_invite_otp_lookup (
                                                    invite_token_hash,
                                                    email,
                                                    used,
                                                    expires_at
                                                ),
            INDEX idx_manager_invite_otp_verified (
                                                      invite_token_hash,
                                                      email,
                                                      verified_at
                                                  )
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function getManagerInviteRecord(connection, inviteToken) {
    if (!inviteToken) {
        const error = new Error("Missing invitation token.");
        error.statusCode = 400;
        throw error;
    }

    let decoded;

    try {
        decoded = jwt.verify(inviteToken, JWT_SECRET);
    } catch {
        const error = new Error("Invalid or expired invitation.");
        error.statusCode = 401;
        throw error;
    }

    if (decoded.type !== "manager_invite") {
        const error = new Error("Invalid invitation type.");
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await connection.execute(
        `SELECT
             managers.id AS manager_id,
             managers.manager_name,
             managers.manager_email,
             managers.permissions,
             managers.status,
             managers.store_id,
             managers.branch_id,
             branches.branch_name,
             stores.store_name
         FROM managers
                  JOIN branches ON managers.branch_id = branches.id
                  JOIN stores ON managers.store_id = stores.id
         WHERE managers.invite_token = ?
           AND managers.manager_email = ?
           AND managers.store_id = ?
           AND managers.branch_id = ?
           AND managers.status = 'pending'
             LIMIT 1`,
        [
            inviteToken,
            String(decoded.email || "").toLowerCase(),
            decoded.store_id,
            decoded.branch_id,
        ]
    );

    if (rows.length === 0) {
        const error = new Error("Invitation not found or already used.");
        error.statusCode = 404;
        throw error;
    }

    const manager = rows[0];

    return {
        decoded,
        manager: {
            manager_id: manager.manager_id,
            manager_name: manager.manager_name || "",
            manager_email: manager.manager_email || "",
            store_id: manager.store_id,
            store_name: manager.store_name || "",
            branch_id: manager.branch_id,
            branch_name: manager.branch_name || "",
            role: "manager",
            status: manager.status || "pending",
            permissions:
                typeof manager.permissions === "string"
                    ? JSON.parse(manager.permissions || "{}")
                    : manager.permissions || {},
        },
    };
}

async function requireVerifiedManagerInvite(connection, inviteToken, email) {
    await ensureManagerInviteOtpsTable(connection);

    const inviteTokenHash = hashInviteToken(inviteToken);
    const [rows] = await connection.execute(
        `SELECT id
         FROM manager_invite_otps
         WHERE invite_token_hash = ?
           AND email = ?
           AND verified_at IS NOT NULL
           AND verified_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
         ORDER BY id DESC
             LIMIT 1`,
        [inviteTokenHash, String(email || "").toLowerCase()]
    );

    if (rows.length === 0) {
        const error = new Error(
            "Verify the invited email before continuing."
        );
        error.statusCode = 403;
        throw error;
    }
}


async function ensureStaffInviteOtpsTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS staff_invite_otps (
                                                         id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                         invite_token_hash CHAR(64) NOT NULL,
            email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            verified_at DATETIME NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_staff_invite_otp_email (email),
            INDEX idx_staff_invite_otp_lookup (
                                                  invite_token_hash,
                                                  email,
                                                  used,
                                                  expires_at
                                              ),
            INDEX idx_staff_invite_otp_verified (
                                                    invite_token_hash,
                                                    email,
                                                    verified_at
                                                )
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function ensureBranchOperationalColumns(connection) {
    const [statusColumns] = await connection.execute(
        "SHOW COLUMNS FROM branches LIKE 'status'"
    );

    if (statusColumns.length === 0) {
        await connection.execute(
            `ALTER TABLE branches
                ADD COLUMN status ENUM('active', 'inactive')
             NOT NULL DEFAULT 'active'
             AFTER address`
        );
    }

    const [reasonColumns] = await connection.execute(
        "SHOW COLUMNS FROM branches LIKE 'inactive_reason'"
    );

    if (reasonColumns.length === 0) {
        await connection.execute(
            `ALTER TABLE branches
                ADD COLUMN inactive_reason VARCHAR(255) NULL
             AFTER status`
        );
    }
}

async function getStaffInviteRecord(connection, inviteToken) {
    if (!inviteToken) {
        const error = new Error("Missing invitation token.");
        error.statusCode = 400;
        throw error;
    }

    let decoded;

    try {
        decoded = jwt.verify(inviteToken, JWT_SECRET);
    } catch {
        const error = new Error("Invalid or expired invitation.");
        error.statusCode = 401;
        throw error;
    }

    if (decoded.type !== "staff_invite") {
        const error = new Error("Invalid invitation type.");
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await connection.execute(
        `SELECT
             staff.id AS staff_id,
             staff.staff_name,
             staff.staff_email,
             staff.permissions,
             staff.status,
             staff.store_id,
             staff.branch_id,
             staff.manager_id,
             branches.branch_name,
             stores.store_name,
             COALESCE(managers.manager_name, '') AS manager_name
         FROM staff
                  JOIN branches ON staff.branch_id = branches.id
                  JOIN stores ON staff.store_id = stores.id
                  LEFT JOIN managers ON staff.manager_id = managers.id
         WHERE staff.invite_token = ?
           AND staff.staff_email = ?
           AND staff.store_id = ?
           AND staff.branch_id = ?
           AND staff.manager_id = ?
           AND staff.status = 'pending'
             LIMIT 1`,
        [
            inviteToken,
            String(decoded.email || "").toLowerCase(),
            decoded.store_id,
            decoded.branch_id,
            decoded.manager_id,
        ]
    );

    if (rows.length === 0) {
        const error = new Error("Invitation not found or already used.");
        error.statusCode = 404;
        throw error;
    }

    const staffMember = rows[0];

    return {
        decoded,
        staff: {
            staff_id: staffMember.staff_id,
            staff_name: staffMember.staff_name || "",
            staff_email: staffMember.staff_email || "",
            manager_id: staffMember.manager_id,
            manager_name: staffMember.manager_name || "",
            store_id: staffMember.store_id,
            store_name: staffMember.store_name || "",
            branch_id: staffMember.branch_id,
            branch_name: staffMember.branch_name || "",
            role: "staff",
            status: staffMember.status || "pending",
            permissions:
                typeof staffMember.permissions === "string"
                    ? JSON.parse(staffMember.permissions || "{}")
                    : staffMember.permissions || {},
        },
    };
}

async function requireVerifiedStaffInvite(connection, inviteToken, email) {
    await ensureStaffInviteOtpsTable(connection);

    const inviteTokenHash = hashInviteToken(inviteToken);
    const [rows] = await connection.execute(
        `SELECT id
         FROM staff_invite_otps
         WHERE invite_token_hash = ?
           AND email = ?
           AND verified_at IS NOT NULL
           AND verified_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
         ORDER BY id DESC
             LIMIT 1`,
        [inviteTokenHash, String(email || "").toLowerCase()]
    );

    if (rows.length === 0) {
        const error = new Error(
            "Verify the invited email before continuing."
        );
        error.statusCode = 403;
        throw error;
    }
}

function createSmtpResponseReader(socket) {
    let buffer = "";
    const waiting = [];

    const flush = () => {
        while (waiting.length > 0) {
            const lines = buffer.split(/\r?\n/);
            let responseEnd = -1;

            for (let index = 0; index < lines.length; index += 1) {
                if (/^\d{3} /.test(lines[index])) {
                    responseEnd = index;
                    break;
                }
            }

            if (responseEnd === -1) {
                return;
            }

            const responseLines = lines.slice(0, responseEnd + 1);
            buffer = lines.slice(responseEnd + 1).join("\r\n");

            const finalLine = responseLines[responseLines.length - 1];
            const code = Number(finalLine.slice(0, 3));
            const waiter = waiting.shift();

            waiter.resolve({
                code,
                message: responseLines.join("\n"),
            });
        }
    };

    socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        flush();
    });

    socket.on("error", (error) => {
        while (waiting.length > 0) {
            waiting.shift().reject(error);
        }
    });

    socket.on("close", () => {
        while (waiting.length > 0) {
            waiting.shift().reject(
                new Error("SMTP connection closed unexpectedly.")
            );
        }
    });

    return () =>
        new Promise((resolve, reject) => {
            waiting.push({ resolve, reject });
            flush();
        });
}

async function expectSmtpResponse(readResponse, expectedCodes) {
    const response = await readResponse();

    if (!expectedCodes.includes(response.code)) {
        const error = new Error(
            `Gmail SMTP error ${response.code}: ${response.message}`
        );

        error.code =
            response.code === 535
                ? "GMAIL_AUTH_FAILED"
                : "GMAIL_SMTP_ERROR";

        throw error;
    }

    return response;
}

async function sendSmtpCommand(
    socket,
    readResponse,
    command,
    expectedCodes
) {
    socket.write(`${command}\r\n`);
    return expectSmtpResponse(readResponse, expectedCodes);
}

function buildOtpEmail(toEmail, otp) {
    const html = `
        <div style="font-family: Arial, sans-serif; background:#FDFAF4; padding:24px;">
            <div style="max-width:520px; margin:auto; background:#ffffff; border:1px solid #EBE4F0; border-radius:16px; padding:28px;">
                <h2 style="margin:0; color:#2D1B4E;">StockNBook</h2>

                <p style="margin-top:18px; color:#3F354C;">Hello,</p>

                <p style="color:#3F354C;">
                    Use the verification code below to continue creating your
                    StockNBook account.
                </p>

                <div style="margin:24px 0; padding:18px; text-align:center; background:#F8F5FF; border-radius:12px;">
                    <div style="font-size:32px; font-weight:bold; letter-spacing:6px; color:#2D1B4E;">
                        ${otp}
                    </div>
                </div>

                <p style="color:#7A6E88;">
                    This OTP will expire in <strong>1 minute and 30 seconds</strong>.
                </p>

                <p style="margin-top:24px; color:#7A6E88; font-size:13px;">
                    If you did not request this code, you can safely ignore this
                    email.
                </p>

                <p style="margin-top:24px; color:#2D1B4E; font-weight:bold;">
                    — StockNBook Team
                </p>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `To: ${toEmail}`,
        "Subject: StockNBook Email Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function buildPaymentOtpEmail(toEmail, otp, planName) {
    const planLabel = planName ? escapeHtml(planName) : "your selected";

    const html = `
        <div style="font-family: Arial, sans-serif; background:#FDFAF4; padding:24px;">
            <div style="max-width:520px; margin:auto; background:#ffffff; border:1px solid #EBE4F0; border-radius:16px; padding:28px;">
                <h2 style="margin:0; color:#2D1B4E;">StockNBook</h2>

                <p style="margin-top:18px; color:#3F354C;">Hello,</p>

                <p style="color:#3F354C;">
                    Use the verification code below to confirm your subscription
                    payment submission for the <strong>${planLabel}</strong> plan.
                </p>

                <div style="margin:24px 0; padding:18px; text-align:center; background:#F8F5FF; border-radius:12px;">
                    <div style="font-size:32px; font-weight:bold; letter-spacing:6px; color:#2D1B4E;">
                        ${otp}
                    </div>
                </div>

                <p style="color:#7A6E88;">
                    This code will expire in <strong>5 minutes</strong>.
                </p>

                <p style="margin-top:24px; color:#7A6E88; font-size:13px;">
                    If you did not request this, you can safely ignore this email
                    — no changes will be made to your account or subscription.
                </p>

                <p style="margin-top:24px; color:#2D1B4E; font-weight:bold;">
                    — StockNBook Team
                </p>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `To: ${toEmail}`,
        "Subject: StockNBook Payment Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function sanitizeEmailHeader(value) {
    return String(value ?? "")
        .replace(/[\r\n]+/g, " ")
        .trim();
}

function permissionLabel(permission) {
    const labels = {
        dashboard: "Dashboard",
        bookings: "Bookings",
        packages: "Packages",
        packages_manage: "Manage Packages",
        inventory: "Inventory",
        pos: "Sales / POS",
        reports: "Reports",
        analytics: "Analytics",
        forecasting: "Forecasting",
        staff_management: "Staff Management",
        branch_settings: "Branch Settings",
    };

    return labels[permission] || permission;
}

// Normalizes a raw permission value (which may be a boolean flag like
// `staff_management: true`, or a granular access-mode string like
// `"full" | "view" | "none"`) into a display-ready access level.
// Returns null when the module is set to no access at all, so callers
// can filter those out instead of showing them as granted.
function permissionAccessLevel(value) {
    if (value === true || value === "full" || value === "true") {
        return "Full Access";
    }

    if (value === "view" || value === "view_only" || value === "viewOnly") {
        return "View Only";
    }

    // Explicitly covers false, "none", undefined, null, "", 0, etc.
    return null;
}


function buildManagerInviteOtpEmail(toEmail, otp, managerName) {
    const safeName = escapeHtml(managerName || "Manager");
    const safeOtp = escapeHtml(otp);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#F7F4FB;padding:28px 14px;color:#21172C;">
            <div style="max-width:560px;margin:auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:20px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:26px 30px;color:#FFFFFF;">
                    <div style="font-size:22px;font-weight:800;">Stock<span style="color:#D4A126;">N</span>Book</div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">Manager invitation verification</div>
                </div>
                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:25px;color:#21172C;">Verify your invited email</h1>
                    <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeName}</strong>, use the code below to continue accepting your StockNBook manager invitation.
                    </p>
                    <div style="margin:24px 0;padding:20px;text-align:center;border-radius:14px;background:#F3ECFF;">
                        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#4B2380;">${safeOtp}</div>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#7A6E88;">
                        This code expires in 1 minute and 30 seconds. Do not share it with anyone.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook Manager Invitation Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function buildStaffInviteOtpEmail(toEmail, otp, staffName) {
    const safeName = escapeHtml(staffName || "Staff member");
    const safeOtp = escapeHtml(otp);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#F7F4FB;padding:28px 14px;color:#21172C;">
            <div style="max-width:560px;margin:auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:20px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:26px 30px;color:#FFFFFF;">
                    <div style="font-size:22px;font-weight:800;">Stock<span style="color:#D4A126;">N</span>Book</div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">Staff invitation verification</div>
                </div>
                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:25px;color:#21172C;">Verify your invited email</h1>
                    <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeName}</strong>, use the code below to continue accepting your StockNBook staff invitation.
                    </p>
                    <div style="margin:24px 0;padding:20px;text-align:center;border-radius:14px;background:#F3ECFF;">
                        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#4B2380;">${safeOtp}</div>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#7A6E88;">
                        This code expires in 1 minute and 30 seconds. Do not share it with anyone.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook Staff Invitation Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}

function buildManagerInvitationEmail({
                                         toEmail,
                                         managerName,
                                         storeName,
                                         branchName,
                                         inviteLink,
                                         permissions,
                                     }) {
    const safeManagerName = escapeHtml(managerName || "Manager");
    const safeStoreName = escapeHtml(storeName || "StockNBook Store");
    const safeBranchName = escapeHtml(branchName || "Assigned Branch");
    const safeInviteLink = escapeHtml(inviteLink);
    const safeRecipient = escapeHtml(toEmail);

    const subject = "StockNBook Manager Invitation";

    const html = `
        <div style="margin:0;background:#F7F4FB;padding:30px 14px;font-family:Arial,Helvetica,sans-serif;color:#21172C;">
            <div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:22px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:28px 30px;color:#FFFFFF;">
                    <div style="font-size:23px;font-weight:800;letter-spacing:-.6px;">
                        Stock<span style="color:#D4A126;">N</span>Book
                    </div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">
                        Secure branch manager invitation
                    </div>
                </div>

                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:27px;line-height:1.25;color:#21172C;">
                        You have been invited
                    </h1>

                    <p style="margin:16px 0 0;font-size:15px;line-height:1.75;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeManagerName}</strong>,
                        the owner of <strong style="color:#2D1B4E;">${safeStoreName}</strong>
                        invited you to manage the
                        <strong style="color:#2D1B4E;">${safeBranchName}</strong> branch.
                    </p>

                    <div style="margin:24px 0;padding:18px;border:1px solid #E8DFF0;border-radius:16px;background:#FCFAFD;">
                        <table role="presentation" style="width:100%;border-collapse:collapse;">
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Store</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeStoreName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Branch</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeBranchName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 0 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Role</td>
                                <td style="padding:4px 0 0;color:#2D1B4E;font-size:14px;font-weight:700;">Branch Manager</td>
                            </tr>
                        </table>
                    </div>

                    <a href="${safeInviteLink}"
                       style="display:block;border-radius:12px;background:#2D1B4E;padding:15px 20px;text-align:center;font-size:15px;font-weight:800;color:#FFFFFF;text-decoration:none;">
                        Review and accept invitation
                    </a>

                    <p style="margin:20px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        This invitation is intended only for <strong>${safeRecipient}</strong>.
                        Do not forward this email or share the invitation link.
                    </p>

                    <p style="margin:14px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        The invitation expires after 7 days. If you were not expecting this invitation,
                        you may safely ignore this email.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function buildStaffInvitationEmail({
                                       toEmail,
                                       staffName,
                                       managerName,
                                       storeName,
                                       branchName,
                                       inviteLink,
                                       permissions,
                                   }) {
    const safeStaffName = escapeHtml(staffName || "Staff member");
    const safeManagerName = escapeHtml(managerName || "Branch Manager");
    const safeStoreName = escapeHtml(storeName || "StockNBook Store");
    const safeBranchName = escapeHtml(branchName || "Assigned Branch");
    const safeInviteLink = escapeHtml(inviteLink);
    const safeRecipient = escapeHtml(toEmail);

    const enabledPermissions = Object.entries(permissions || {})
        .map(([permission, value]) => ({
            label: permissionLabel(permission),
            access: permissionAccessLevel(value),
        }))
        .filter((entry) => entry.access !== null);

    const permissionItems =
        enabledPermissions.length > 0
            ? enabledPermissions
                .map(({ label, access }) => {
                    const isFullAccess = access === "Full Access";
                    const background = isFullAccess ? "#F1E9FF" : "#FDF3E3";
                    const color = isFullAccess ? "#4B2380" : "#946617";

                    return `<span style="display:inline-block;margin:4px 6px 4px 0;padding:7px 10px;border-radius:999px;background:${background};color:${color};font-size:12px;font-weight:700;">✓ ${escapeHtml(label)} — ${escapeHtml(access)}</span>`;
                })
                .join("")
            : `<span style="color:#7A6E88;font-size:13px;">Your access will be configured by your branch manager.</span>`;

    const subject = "StockNBook Staff Invitation";

    const html = `
        <div style="margin:0;background:#F7F4FB;padding:30px 14px;font-family:Arial,Helvetica,sans-serif;color:#21172C;">
            <div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:22px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:28px 30px;color:#FFFFFF;">
                    <div style="font-size:23px;font-weight:800;letter-spacing:-.6px;">
                        Stock<span style="color:#D4A126;">N</span>Book
                    </div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">
                        Secure staff invitation
                    </div>
                </div>

                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:27px;line-height:1.25;color:#21172C;">
                        You have been invited
                    </h1>

                    <p style="margin:16px 0 0;font-size:15px;line-height:1.75;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeStaffName}</strong>,
                        <strong style="color:#2D1B4E;">${safeManagerName}</strong>
                        invited you to join
                        <strong style="color:#2D1B4E;">${safeStoreName}</strong>
                        at the <strong style="color:#2D1B4E;">${safeBranchName}</strong> branch.
                    </p>

                    <div style="margin:24px 0;padding:18px;border:1px solid #E8DFF0;border-radius:16px;background:#FCFAFD;">
                        <table role="presentation" style="width:100%;border-collapse:collapse;">
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Store</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeStoreName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Branch</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeBranchName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 0 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Role</td>
                                <td style="padding:4px 0 0;color:#2D1B4E;font-size:14px;font-weight:700;">Staff Member</td>
                            </tr>
                        </table>
                    </div>

                    <div style="margin:0 0 22px;">
                        <div style="margin-bottom:9px;color:#2D1B4E;font-size:13px;font-weight:800;">Access assigned to you</div>
                        <div>${permissionItems}</div>
                    </div>

                    <a href="${safeInviteLink}"
                       style="display:block;border-radius:12px;background:#2D1B4E;padding:15px 20px;text-align:center;font-size:15px;font-weight:800;color:#FFFFFF;text-decoration:none;">
                        Review and accept invitation
                    </a>

                    <p style="margin:20px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        This invitation is intended only for <strong>${safeRecipient}</strong>.
                        Do not forward this email or share the invitation link.
                    </p>

                    <p style="margin:14px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        The invitation expires after 7 days. If you were not expecting this invitation,
                        you may safely ignore this email.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}

async function sendGmailHtmlEmail(toEmail, rawMessage, logLabel) {
    if (
        !SMTP_USER ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SMTP_USER)
    ) {
        const configError = new Error(
            "Email sending is not configured. Set a valid SMTP_USER directly in index.js."
        );
        configError.code = "SMTP_NOT_CONFIGURED";
        throw configError;
    }

    if (
        !SMTP_PASS ||
        SMTP_PASS === "PASTE_NEW_GOOGLE_APP_PASSWORD_HERE"
    ) {
        const configError = new Error(
            "Email sending is not configured. Replace PASTE_NEW_GOOGLE_APP_PASSWORD_HERE in index.js with a valid Google App Password."
        );
        configError.code = "SMTP_NOT_CONFIGURED";
        throw configError;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        const emailError = new Error("Invalid email recipient.");
        emailError.code = "INVALID_RECIPIENT";
        throw emailError;
    }

    const socket = tls.connect({
        host: SMTP_HOST,
        port: SMTP_PORT,
        servername: SMTP_HOST,
        rejectUnauthorized: true,
    });

    socket.setTimeout(SMTP_TIMEOUT_MS);

    const readResponse = createSmtpResponseReader(socket);

    try {
        await new Promise((resolve, reject) => {
            socket.once("secureConnect", resolve);
            socket.once("error", reject);
            socket.once("timeout", () => {
                const timeoutError = new Error(
                    "Lambda could not connect to Gmail SMTP."
                );
                timeoutError.code = "GMAIL_NETWORK_FAILED";
                reject(timeoutError);
            });
        });

        await expectSmtpResponse(readResponse, [220]);

        await sendSmtpCommand(
            socket,
            readResponse,
            "EHLO stocknbook.local",
            [250]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            "AUTH LOGIN",
            [334]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            Buffer.from(SMTP_USER).toString("base64"),
            [334]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            Buffer.from(SMTP_PASS).toString("base64"),
            [235]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            `MAIL FROM:<${SMTP_USER}>`,
            [250]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            `RCPT TO:<${toEmail}>`,
            [250, 251]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            "DATA",
            [354]
        );

        socket.write(`${rawMessage}\r\n.\r\n`);

        const dataResponse = await expectSmtpResponse(
            readResponse,
            [250]
        );

        socket.write("QUIT\r\n");

        console.log(`[stocknbook-auth] ${logLabel} email accepted:`, {
            to: toEmail,
            smtpResponse: dataResponse.message,
        });

        return {
            accepted: [toEmail],
            response: dataResponse.message,
        };
    } catch (error) {
        console.error(`[stocknbook-auth] ${logLabel} Gmail SMTP error:`, {
            code: error?.code,
            message: error?.message,
        });

        if (error?.code === "GMAIL_AUTH_FAILED") {
            const authError = new Error(
                "Gmail rejected the sender credentials. Replace SMTP_PASS in index.js with a current Google App Password generated for the same Gmail account used in SMTP_USER."
            );
            authError.code = "GMAIL_AUTH_FAILED";
            throw authError;
        }

        if (isSmtpNetworkError(error)) {
            const networkError = new Error(
                "The invitation email service is temporarily unreachable. The invitation itself is still valid; use the backup invite link or try Resend later."
            );
            networkError.code = "GMAIL_NETWORK_FAILED";
            networkError.cause = error;
            throw networkError;
        }

        throw error;
    } finally {
        if (!socket.destroyed) {
            socket.end();
        }
    }
}

async function sendSignupOtpEmail(toEmail, otp) {
    return sendGmailHtmlEmail(
        toEmail,
        buildOtpEmail(toEmail, otp),
        "OTP"
    );
}

async function sendManagerInvitationEmail(invite) {
    return sendGmailHtmlEmail(
        invite.manager_email,
        buildManagerInvitationEmail({
            toEmail: invite.manager_email,
            managerName: invite.manager_name,
            storeName: invite.store_name,
            branchName: invite.branch_name,
            inviteLink: invite.invite_link,
            permissions: invite.permissions,
        }),
        "manager invitation"
    );
}


async function sendStaffInvitationEmail(invite) {
    return sendGmailHtmlEmail(
        invite.staff_email,
        buildStaffInvitationEmail({
            toEmail: invite.staff_email,
            staffName: invite.staff_name,
            managerName: invite.manager_name,
            storeName: invite.store_name,
            branchName: invite.branch_name,
            inviteLink: invite.invite_link,
            permissions: invite.permissions,
        }),
        "staff invitation"
    );
}


function getInvitationEmailFailureMessage(error) {
    const code = String(error?.code || "").toUpperCase();

    if (code === "GMAIL_NETWORK_FAILED" || isSmtpNetworkError(error)) {
        return "The email service is temporarily unreachable. The invitation is still valid; use the backup invite link or try Resend later.";
    }

    if (code === "GMAIL_AUTH_FAILED") {
        return "The email service could not authenticate. The invitation is still valid; use the backup invite link while the SMTP account is being fixed.";
    }

    if (code === "SMTP_NOT_CONFIGURED") {
        return "Email delivery is not configured yet. The invitation is still valid; use the backup invite link.";
    }

    if (code === "INVALID_RECIPIENT") {
        return "The invitation email address is invalid. Check the address or use the backup invite link.";
    }

    if (code === "GMAIL_SMTP_ERROR") {
        return "Gmail did not accept the invitation email. The invitation is still valid; use the backup invite link or try Resend later.";
    }

    return "The invitation email could not be delivered. The invitation is still valid; use the backup invite link or try Resend later.";
}

async function deliverInvitationEmail({
                                          role,
                                          email,
                                          name,
                                          storeName,
                                          branchName,
                                          inviteLink,
                                          send,
                                      }) {
    try {
        await send();

        return {
            email_sent: true,
            email_status: "sent",
            email_error: "",
        };
    } catch (sendError) {
        const emailError = getInvitationEmailFailureMessage(sendError);

        console.error(
            `[stocknbook-auth] ${role} invitation was created, but email delivery failed:`,
            {
                email,
                branch: branchName || "",
                code: sendError?.code || "EMAIL_SEND_FAILED",
                error: emailError,
            }
        );

        logDevelopmentInvitationFallback({
            role,
            email,
            name,
            storeName,
            branchName,
            inviteLink,
            errorMessage: emailError,
        });

        return {
            email_sent: false,
            email_status: "failed",
            email_error: emailError,
        };
    }
}


async function sendManagerInviteOtpEmail(toEmail, otp, managerName) {
    return sendGmailHtmlEmail(
        toEmail,
        buildManagerInviteOtpEmail(toEmail, otp, managerName),
        "manager invitation OTP"
    );
}


async function sendStaffInviteOtpEmail(toEmail, otp, staffName) {
    return sendGmailHtmlEmail(
        toEmail,
        buildStaffInviteOtpEmail(toEmail, otp, staffName),
        "staff invitation OTP"
    );
}

async function sendPaymentOtpEmail(toEmail, otp, planName) {
    return sendGmailHtmlEmail(
        toEmail,
        buildPaymentOtpEmail(toEmail, otp, planName),
        "payment verification OTP"
    );
}


// Sent only after the payment submission has been saved successfully.
// Acknowledgment does NOT mean that GCash funds have been verified.
function buildPaymentSubmissionAcknowledgmentEmail(toEmail, details) {
    const storeName = escapeHtml(details.store_name || "your store");
    const planName = escapeHtml(details.plan_name || "selected");
    const amount = Number(details.amount || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const paymentId = escapeHtml(details.payment_submission_id);

    const html = `
        <div style="font-family:Arial,sans-serif;background:#FDFAF4;padding:24px;color:#3F354C;">
          <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #E7DCEB;border-radius:16px;padding:28px;">
            <h2 style="color:#2D1B4E;margin:0;">StockNBook</h2>
            <p>Thank you for choosing StockNBook, <strong>${storeName}</strong>!</p>
            <p>We have <strong>received your GCash payment details and proof</strong> for the
              <strong>${planName}</strong> plan. Your submission is now <strong>Pending Review</strong>.</p>
            <div style="background:#F6F1FB;border-radius:12px;padding:16px;margin:20px 0;">
              <p style="margin:6px 0;">Plan: <strong>${planName}</strong></p>
              <p style="margin:6px 0;">Submitted amount: <strong>PHP ${amount}</strong></p>
              <p style="margin:6px 0;">Submission ID: <strong>#${paymentId}</strong></p>
              <p style="margin:6px 0;">Status: <strong>Pending Review</strong></p>
            </div>
            <p>Please allow <strong>up to 24 hours</strong> for the Platform Admin to review your payment.
              Reviews may take longer if extra verification is necessary.</p>
            <p><strong>Your plan is not yet activated by this email.</strong> We'll email you again if
              the payment is approved and your subscription is activated.</p>
            <p>If you did not submit this payment, contact StockNBook support.</p>
            <p style="margin-top:24px;color:#2D1B4E;font-weight:bold;">— StockNBook Team</p>
          </div>
        </div>`;
    return [
        `From: ${EMAIL_FROM}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook - We received your subscription payment proof",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n").replace(/^\./gm, "..");
}

async function sendPaymentSubmissionAcknowledgmentEmail(toEmail, details) {
    return sendGmailHtmlEmail(
        toEmail,
        buildPaymentSubmissionAcknowledgmentEmail(toEmail, details),
        "subscription payment submission acknowledgment"
    );
}

function generateSlug(storeName) {
    return storeName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

/*
 * MySQL connection stored directly in this Lambda code.
 *
 * The previous error said "using password: NO" because
 * password: process.env.DB_PASSWORD was undefined.
 */

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



function getBearerTokenFromEvent(event) {
    const authHeader =
        event.headers?.Authorization || event.headers?.authorization || "";
    return String(authHeader).replace(/^Bearer\s+/i, "").trim();
}

async function getPlanColumnsForOwner(connection) {
    const [rows] = await connection.query("SHOW COLUMNS FROM payments");
    const names = new Set(rows.map((row) => row.Field));
    const pick = (candidates, required = true) => {
        const found = candidates.find((candidate) => names.has(candidate));
        if (!found && required) {
            const error = new Error(
                `payments table is missing a required column. Expected one of: ${candidates.join(", ")}`
            );
            error.statusCode = 500;
            throw error;
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
        createdAt: pick(["created_at", "submitted_at", "payment_date"], false),
    };
}

function normalizePlanLimit(value) {
    if (value === null || value === undefined || Number(value) === 0) return null;
    return Number(value);
}

// These defaults mirror the Platform Admin dashboard. Database values always
// win, so an admin edit is reflected in the owner's checkout immediately.
const DEFAULT_PLATFORM_GCASH_SETTINGS = {
    account_name: "StockNBook Admin",
    gcash_number: "0917 123 4567",
    instruction: "Include your store name",
    qr_image: "",
};

async function getPlatformGcashPaymentSettings(connection) {
    const [rows] = await connection.execute(
        `SELECT \`key\`, value
         FROM platform_settings
         WHERE \`key\` IN ('gcash_account_name', 'gcash_number', 'gcash_instruction', 'gcash_qr_image')`
    );

    const values = {};
    for (const row of rows) {
        values[String(row.key)] = String(row.value ?? "");
    }

    const paymentSettings = {
        account_name:
            values.gcash_account_name?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.account_name,
        gcash_number:
            values.gcash_number?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.gcash_number,
        instruction:
            values.gcash_instruction?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.instruction,
        qr_image:
            values.gcash_qr_image?.trim() ||
            DEFAULT_PLATFORM_GCASH_SETTINGS.qr_image,
    };

    return {
        ...paymentSettings,
        configured: Boolean(paymentSettings.account_name && paymentSettings.gcash_number),
    };
}

const BUILT_IN_SUBSCRIPTION_PLAN_TIER = {
    starter: 1,
    growth: 2,
    scale: 3,
};

function getSubscriptionPlanTier(plan) {
    if (!plan) return null;

    const explicitTier = Number(plan.tier_order);
    if (Number.isInteger(explicitTier) && explicitTier > 0) {
        return explicitTier;
    }

    return (
        BUILT_IN_SUBSCRIPTION_PLAN_TIER[
            String(plan.name || "").trim().toLowerCase()
            ] ?? null
    );
}

function getSubscriptionPlanDirection(currentPlan, targetPlan) {
    if (!currentPlan || !targetPlan) return null;
    if (Number(currentPlan.id) === Number(targetPlan.id)) return "current";

    const currentTier = getSubscriptionPlanTier(currentPlan);
    const targetTier = getSubscriptionPlanTier(targetPlan);

    if (currentTier !== null && targetTier !== null) {
        return targetTier > currentTier ? "upgrade" : "downgrade";
    }

    // Compatibility fallback for any custom plan that has no explicit/built-in tier.
    const currentPrice = Number(currentPlan.price || 0);
    const targetPrice = Number(targetPlan.price || 0);
    return targetPrice > currentPrice ? "upgrade" : "downgrade";
}

function dateOnlyUtc(value = new Date()) {
    return new Date(value).toISOString().slice(0, 10);
}

function addUtcDays(dateOnly, days) {
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + Number(days));
    return date.toISOString().slice(0, 10);
}

async function ensureSubscriptionPlanChangesTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS subscription_plan_changes (
                                                                 id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                                 subscription_id BIGINT NULL,
                                                                 store_id BIGINT NOT NULL,
                                                                 current_plan_id BIGINT NOT NULL,
                                                                 target_plan_id BIGINT NOT NULL,
                                                                 change_type VARCHAR(20) NOT NULL DEFAULT 'DOWNGRADE',
            status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
            requested_by_role VARCHAR(30) NOT NULL DEFAULT 'owner',
            requested_by_email VARCHAR(255) NULL,
            requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            effective_at DATE NOT NULL,
            cancelled_at DATETIME NULL,
            applied_at DATETIME NULL,
            notes VARCHAR(500) NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_subscription_plan_changes_store_status (store_id, status),
            INDEX idx_subscription_plan_changes_subscription_status (subscription_id, status),
            INDEX idx_subscription_plan_changes_effective (status, effective_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function getPendingSubscriptionPlanChange(connection, storeId) {
    await ensureSubscriptionPlanChangesTable(connection);

    const [rows] = await connection.execute(
        `SELECT
             spc.id,
             spc.subscription_id,
             spc.store_id,
             spc.current_plan_id,
             spc.target_plan_id,
             spc.change_type,
             spc.status,
             spc.requested_by_role,
             spc.requested_by_email,
             spc.requested_at,
             spc.effective_at,
             spc.cancelled_at,
             spc.applied_at,
             spc.notes,
             current_plan.name AS current_plan_name,
             target_plan.name AS target_plan_name,
             target_plan.price AS target_plan_price,
             target_plan.max_inventory AS target_max_inventory,
             target_plan.max_bookings AS target_max_bookings,
             target_plan.max_staff AS target_max_staff,
             target_plan.max_branches AS target_max_branches
         FROM subscription_plan_changes spc
                  LEFT JOIN plans current_plan ON current_plan.id = spc.current_plan_id
                  LEFT JOIN plans target_plan ON target_plan.id = spc.target_plan_id
         WHERE spc.store_id = ?
           AND UPPER(spc.status) IN ('SCHEDULED', 'AWAITING_PAYMENT')
         ORDER BY spc.id DESC
             LIMIT 1`,
        [storeId]
    );

    return rows[0] || null;
}

function serializeSubscriptionPlanChange(row) {
    if (!row) return null;

    return {
        id: Number(row.id),
        subscription_id:
            row.subscription_id == null ? null : Number(row.subscription_id),
        current_plan_id: Number(row.current_plan_id),
        current_plan_name: row.current_plan_name || null,
        target_plan_id: Number(row.target_plan_id),
        target_plan_name: row.target_plan_name || null,
        target_plan_price: Number(row.target_plan_price || 0),
        change_type: String(row.change_type || "DOWNGRADE").toUpperCase(),
        status: String(row.status || "SCHEDULED").toUpperCase(),
        requested_at: row.requested_at || null,
        effective_at: row.effective_at
            ? dateOnlyUtc(row.effective_at)
            : null,
    };
}

async function processDueSubscriptionPlanChange(connection, storeId) {
    const change = await getPendingSubscriptionPlanChange(connection, storeId);
    if (!change) return null;

    const status = String(change.status || "").toUpperCase();
    if (status !== "SCHEDULED") return change;

    const effectiveAt = change.effective_at
        ? dateOnlyUtc(change.effective_at)
        : null;

    if (!effectiveAt || effectiveAt > dateOnlyUtc()) {
        return change;
    }

    const [targetRows] = await connection.execute(
        `SELECT * FROM plans WHERE id = ? LIMIT 1`,
        [change.target_plan_id]
    );
    const targetPlan = targetRows[0] || null;

    if (!targetPlan || Number(targetPlan.is_archived) === 1) {
        await connection.execute(
            `UPDATE subscription_plan_changes
             SET status = 'CANCELLED',
                 cancelled_at = NOW(),
                 notes = ?
             WHERE id = ? AND UPPER(status) = 'SCHEDULED'`,
            ["Scheduled downgrade cancelled because the target plan is no longer available.", change.id]
        );
        return null;
    }

    // Paid lower-tier plans still require the owner's normal GCash payment and
    // platform-admin verification. The scheduled record simply makes that lower
    // plan eligible for payment after the current paid period ends.
    if (Number(targetPlan.price || 0) > 0) {
        await connection.execute(
            `UPDATE subscription_plan_changes
             SET status = 'AWAITING_PAYMENT'
             WHERE id = ? AND UPPER(status) = 'SCHEDULED'`,
            [change.id]
        );
        return getPendingSubscriptionPlanChange(connection, storeId);
    }

    // A free target plan (Starter) needs no GCash payment. Apply it automatically
    // when the current paid period has fully ended.
    await connection.beginTransaction();
    try {
        const [subscriptionRows] = await connection.execute(
            `SELECT * FROM subscriptions
             WHERE store_id = ?
             ORDER BY id DESC
                 LIMIT 1
             FOR UPDATE`,
            [storeId]
        );
        const subscription = subscriptionRows[0] || null;

        if (!subscription) {
            throw Object.assign(
                new Error("The current subscription record could not be found."),
                { statusCode: 409 }
            );
        }

        await connection.execute(
            `UPDATE subscriptions
             SET plan_id = ?,
                 status = 'active',
                 started_at = ?,
                 expires_at = NULL,
                 auto_renew = 0
             WHERE id = ?`,
            [targetPlan.id, effectiveAt, subscription.id]
        );

        await syncStorePlanLabel(connection, storeId, targetPlan.name);

        await connection.execute(
            `UPDATE subscription_plan_changes
             SET status = 'APPLIED',
                 applied_at = NOW()
             WHERE id = ? AND UPPER(status) = 'SCHEDULED'`,
            [change.id]
        );

        // subscription_plan_changes is the authoritative downgrade audit record.
        // Also write to the existing history table when its schema allows a
        // system-generated (NULL admin) entry, but never fail the downgrade just
        // because an older history table requires an administrator ID.
        try {
            await connection.execute(
                `INSERT INTO subscription_history
                 (subscription_id, store_id, old_plan_id, new_plan_id, change_type, changed_by)
                 VALUES (?, ?, ?, ?, 'downgrade', NULL)`,
                [
                    subscription.id,
                    storeId,
                    subscription.plan_id,
                    targetPlan.id,
                ]
            );
        } catch (historyError) {
            console.warn(
                "Unable to add automatic downgrade to subscription_history:",
                historyError.message
            );
        }

        await connection.commit();
        return null;
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

function getDowngradeUsageIssues(snapshot, targetPlan) {
    const checks = [
        {
            key: "inventory",
            label: "Inventory",
            current: Number(snapshot.usage.inventory || 0),
            limit: normalizePlanLimit(targetPlan.max_inventory),
        },
        {
            key: "bookings",
            label: "Bookings",
            current: Number(snapshot.usage.bookings || 0),
            limit: normalizePlanLimit(targetPlan.max_bookings),
        },
        {
            key: "staff",
            label: "Staff",
            current: Number(snapshot.usage.staff || 0),
            limit: normalizePlanLimit(targetPlan.max_staff),
        },
        {
            key: "branches",
            label: "Branches",
            current: Number(snapshot.usage.branches || 0),
            limit: normalizePlanLimit(targetPlan.max_branches),
        },
    ];

    return checks.filter(
        (item) => item.limit !== null && item.current > Number(item.limit)
    );
}

async function getStoreSubscriptionSnapshot(connection, storeId) {
    const [subscriptionRows] = await connection.execute(
        `SELECT
             s.id AS subscription_id,
             s.plan_id,
             s.status,
             s.started_at,
             s.expires_at,
             p.id AS plan_id_joined,
             p.name,
             p.price,
             p.max_inventory,
             p.max_bookings,
             p.max_staff,
             p.max_branches,
             p.has_low_stock_alerts,
             p.has_analytics,
             p.has_forecasting,
             p.has_multi_store,
             p.is_archived
         FROM subscriptions s
                  INNER JOIN plans p ON p.id = s.plan_id
         WHERE s.store_id = ?
         ORDER BY s.id DESC
             LIMIT 1`,
        [storeId]
    );

    let subscription = subscriptionRows[0] || null;

    if (!subscription) {
        const [starterRows] = await connection.execute(
            `SELECT
                 id AS plan_id,
                 name,
                 price,
                 max_inventory,
                 max_bookings,
                 max_staff,
                 max_branches,
                 has_low_stock_alerts,
                 has_analytics,
                 has_forecasting,
                 has_multi_store,
                 is_archived
             FROM plans
             WHERE is_archived = 0
               AND (LOWER(name) = 'starter' OR price = 0)
             ORDER BY price ASC, id ASC
                 LIMIT 1`
        );

        subscription = starterRows[0]
            ? {
                ...starterRows[0],
                subscription_id: null,
                status: "active",
                started_at: null,
                expires_at: null,
            }
            : null;
    }

    if (!subscription) {
        const error = new Error("No active plan is configured for this platform.");
        error.statusCode = 500;
        throw error;
    }

    // Use the same usage calculation as the plan-enforcement layer so a
    // downgrade cannot be approved by the Subscription page while another
    // module would still consider the store above the target plan limit.
    const usage = await getStoreUsage(connection, storeId);

    const [pendingPaymentRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM payments
         WHERE store_id = ?
           AND UPPER(status) = 'PENDING'`,
        [storeId]
    );

    const expiresAt = subscription.expires_at
        ? dateOnlyUtc(subscription.expires_at)
        : null;

    let displayStatus = String(subscription.status || "active").toUpperCase();
    if (
        displayStatus !== "CANCELLED" &&
        expiresAt &&
        expiresAt < dateOnlyUtc()
    ) {
        displayStatus = "EXPIRED";
    }

    return {
        subscription_id:
            subscription.subscription_id == null
                ? null
                : Number(subscription.subscription_id),
        status: displayStatus,
        started_at: subscription.started_at || null,
        expires_at: expiresAt,
        plan: {
            id: Number(subscription.plan_id || subscription.plan_id_joined),
            name: subscription.name,
            price: Number(subscription.price || 0),
            max_inventory: normalizePlanLimit(subscription.max_inventory),
            max_bookings: normalizePlanLimit(subscription.max_bookings),
            max_staff: normalizePlanLimit(subscription.max_staff),
            max_branches: normalizePlanLimit(subscription.max_branches),
            has_low_stock_alerts: Boolean(subscription.has_low_stock_alerts),
            has_analytics: Boolean(subscription.has_analytics),
            has_forecasting: Boolean(subscription.has_forecasting),
            has_multi_store: Boolean(subscription.has_multi_store),
        },
        usage: {
            inventory: Number(usage.inventory || 0),
            bookings: Number(usage.bookings || 0),
            staff: Number(usage.staff || 0),
            branches: Number(usage.branches || 0),
        },
        pending_payment: Number(pendingPaymentRows[0]?.total || 0) > 0,
    };
}

async function getOwnerSubscription(connection, storeId) {
    await ensureSubscriptionPlanChangesTable(connection);
    await processDueSubscriptionPlanChange(connection, storeId);

    const snapshot = await getStoreSubscriptionSnapshot(connection, storeId);
    const pendingChange = await getPendingSubscriptionPlanChange(connection, storeId);

    const [planRows] = await connection.execute(
        `SELECT
             id,
             name,
             price,
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
         ORDER BY
             CASE LOWER(name)
                 WHEN 'starter' THEN 1
                 WHEN 'growth' THEN 2
                 WHEN 'scale' THEN 3
                 ELSE 100
                 END ASC,
             price ASC,
             id ASC`
    );

    const effectivePlan = await getActivePlan(connection, storeId);
    const expiryDay = snapshot.expires_at;
    const dateToday = dateOnlyUtc();
    const daysUntilExpiration = expiryDay
        ? Math.round((Date.parse(`${expiryDay}T00:00:00Z`) - Date.parse(`${dateToday}T00:00:00Z`)) / 86400000)
        : null;
    const status = String(snapshot.status || '').toUpperCase();
    const displayStatus = status === 'ACTIVE' && daysUntilExpiration !== null &&
    daysUntilExpiration >= 0 && daysUntilExpiration <= 7 && Number(snapshot.plan.price) > 0
        ? 'EXPIRING' : status;
    return {
        ...snapshot,
        status: displayStatus,
        effective_plan: effectivePlan,
        access_status: effectivePlan?.access_status || 'STARTER_FALLBACK',
        days_until_expiration: daysUntilExpiration,
        scheduled_change: serializeSubscriptionPlanChange(pendingChange),
        available_plans: planRows.map((row) => ({
            id: Number(row.id),
            name: row.name,
            price: Number(row.price || 0),
            max_inventory: normalizePlanLimit(row.max_inventory),
            max_bookings: normalizePlanLimit(row.max_bookings),
            max_staff: normalizePlanLimit(row.max_staff),
            max_branches: normalizePlanLimit(row.max_branches),
            has_low_stock_alerts: Boolean(row.has_low_stock_alerts),
            has_analytics: Boolean(row.has_analytics),
            has_forecasting: Boolean(row.has_forecasting),
            has_multi_store: Boolean(row.has_multi_store),
        })),
    };
}

async function requestOwnerSubscriptionDowngrade(connection, decoded, body) {
    if (decoded.role !== "owner" || !decoded.store_id) {
        const error = new Error("Only the store owner can request a downgrade.");
        error.statusCode = 403;
        throw error;
    }

    const storeId = Number(decoded.store_id);
    const targetPlanId = Number(body.plan_id);

    if (!Number.isInteger(targetPlanId) || targetPlanId <= 0) {
        const error = new Error("Select a valid downgrade plan.");
        error.statusCode = 400;
        throw error;
    }

    await ensureSubscriptionPlanChangesTable(connection);
    await processDueSubscriptionPlanChange(connection, storeId);

    const snapshot = await getStoreSubscriptionSnapshot(connection, storeId);
    if (!snapshot.subscription_id) {
        const error = new Error("The current plan does not have a lower subscription tier to schedule.");
        error.statusCode = 409;
        throw error;
    }

    if (snapshot.pending_payment) {
        const error = new Error("Finish the payment request that is already awaiting review before scheduling another plan change.");
        error.statusCode = 409;
        throw error;
    }

    const [targetRows] = await connection.execute(
        `SELECT * FROM plans WHERE id = ? AND is_archived = 0 LIMIT 1`,
        [targetPlanId]
    );
    const targetPlan = targetRows[0] || null;

    if (!targetPlan) {
        const error = new Error("The selected downgrade plan is no longer available.");
        error.statusCode = 404;
        throw error;
    }

    const direction = getSubscriptionPlanDirection(snapshot.plan, {
        id: Number(targetPlan.id),
        name: targetPlan.name,
        price: Number(targetPlan.price || 0),
    });

    if (direction !== "downgrade") {
        const error = new Error("The selected plan is not a lower subscription tier.");
        error.statusCode = 409;
        throw error;
    }

    const issues = getDowngradeUsageIssues(snapshot, targetPlan);
    if (issues.length) {
        const details = issues
            .map(
                (item) =>
                    `${item.label}: ${item.current} / ${item.limit}`
            )
            .join("; ");
        const error = new Error(
            `Your current usage exceeds the ${targetPlan.name} plan limits. ${details}`
        );
        error.statusCode = 409;
        error.usage_issues = issues;
        throw error;
    }

    const existingChange = await getPendingSubscriptionPlanChange(connection, storeId);
    if (existingChange) {
        const error = new Error(
            `A ${String(existingChange.target_plan_name || "lower-tier")} downgrade is already ${String(existingChange.status || "scheduled").toLowerCase().replace(/_/g, " ")}. Cancel it before requesting another downgrade.`
        );
        error.statusCode = 409;
        throw error;
    }

    const currentExpiry = snapshot.expires_at;
    const effectiveAt = currentExpiry
        ? addUtcDays(currentExpiry, 1)
        : dateOnlyUtc();

    const [result] = await connection.execute(
        `INSERT INTO subscription_plan_changes
         (subscription_id, store_id, current_plan_id, target_plan_id,
          change_type, status, requested_by_role, requested_by_email,
          effective_at, notes)
         VALUES (?, ?, ?, ?, 'DOWNGRADE', 'SCHEDULED', 'owner', ?, ?, ?)`,
        [
            snapshot.subscription_id,
            storeId,
            snapshot.plan.id,
            targetPlan.id,
            String(decoded.email || "").trim() || null,
            effectiveAt,
            `Owner requested downgrade from ${snapshot.plan.name} to ${targetPlan.name}.`,
        ]
    );

    // If the current period is already over, immediately advance the scheduled
    // record to the correct next state (automatic Starter or awaiting paid plan).
    await processDueSubscriptionPlanChange(connection, storeId);
    const scheduled = await getPendingSubscriptionPlanChange(connection, storeId);

    return {
        message:
            Number(targetPlan.price || 0) > 0
                ? `Downgrade to ${targetPlan.name} scheduled. Your current plan remains active through its paid period; payment for ${targetPlan.name} will be requested when the downgrade becomes effective.`
                : `Downgrade to ${targetPlan.name} scheduled. It will apply automatically after the current paid period ends.`,
        change_id: Number(result.insertId),
        scheduled_change: serializeSubscriptionPlanChange(scheduled),
    };
}

async function cancelOwnerSubscriptionDowngrade(connection, decoded) {
    if (decoded.role !== "owner" || !decoded.store_id) {
        const error = new Error("Only the store owner can cancel a scheduled downgrade.");
        error.statusCode = 403;
        throw error;
    }

    const storeId = Number(decoded.store_id);
    await ensureSubscriptionPlanChangesTable(connection);
    await processDueSubscriptionPlanChange(connection, storeId);

    const change = await getPendingSubscriptionPlanChange(connection, storeId);
    if (!change) {
        const error = new Error("There is no scheduled downgrade to cancel.");
        error.statusCode = 404;
        throw error;
    }

    const changeStatus = String(change.status || "").toUpperCase();
    const effectiveAt = change.effective_at ? dateOnlyUtc(change.effective_at) : null;

    if (changeStatus !== "SCHEDULED" || (effectiveAt && effectiveAt <= dateOnlyUtc())) {
        const error = new Error(
            "This downgrade has already reached its effective date and can no longer be cancelled from the owner screen."
        );
        error.statusCode = 409;
        throw error;
    }

    const [pendingPaymentRows] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM payments
         WHERE store_id = ?
           AND UPPER(status) = 'PENDING'`,
        [storeId]
    );

    if (Number(pendingPaymentRows[0]?.total || 0) > 0) {
        const error = new Error("A subscription payment is already awaiting review. Resolve that payment before cancelling the downgrade.");
        error.statusCode = 409;
        throw error;
    }

    await connection.execute(
        `UPDATE subscription_plan_changes
         SET status = 'CANCELLED',
             cancelled_at = NOW(),
             notes = CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE ' ' END, 'Cancelled by owner.')
         WHERE id = ?
           AND UPPER(status) = 'SCHEDULED'`,
        [change.id]
    );

    return {
        message: "Scheduled downgrade cancelled.",
        cancelled_change_id: Number(change.id),
    };
}

async function submitOwnerPlanPayment(connection, decoded, body) {
    if (decoded.role !== "owner" || !decoded.store_id) {
        const error = new Error("Only the store owner can change the subscription.");
        error.statusCode = 403;
        throw error;
    }

    const storeId = Number(decoded.store_id);
    const planId = Number(body.plan_id);
    const referenceNumber = String(body.reference_number || "").trim();
    const receiptUrl = String(body.receipt_url || "").trim();

    if (!Number.isInteger(planId) || planId <= 0) {
        const error = new Error("Select a valid plan.");
        error.statusCode = 400;
        throw error;
    }

    if (!referenceNumber || referenceNumber.length < 4 || referenceNumber.length > 120) {
        const error = new Error("Enter a valid GCash reference number.");
        error.statusCode = 400;
        throw error;
    }

    await ensureSubscriptionPlanChangesTable(connection);
    await processDueSubscriptionPlanChange(connection, storeId);

    const [planRows] = await connection.execute(
        `SELECT * FROM plans WHERE id = ? AND is_archived = 0 LIMIT 1`,
        [planId]
    );
    const targetPlan = planRows[0];

    if (!targetPlan) {
        const error = new Error("The selected plan is no longer available.");
        error.statusCode = 404;
        throw error;
    }

    if (Number(targetPlan.price || 0) <= 0) {
        const error = new Error("Starter does not require a payment submission.");
        error.statusCode = 400;
        throw error;
    }

    const snapshot = await getStoreSubscriptionSnapshot(connection, storeId);
    const direction = getSubscriptionPlanDirection(snapshot.plan, {
        id: Number(targetPlan.id),
        name: targetPlan.name,
        price: Number(targetPlan.price || 0),
    });

    // Once the previous paid term has expired, a new paid plan may be chosen
    // freely; there is no remaining paid period to schedule a downgrade for.
    if (direction === "downgrade" && snapshot.status !== "EXPIRED") {
        const scheduled = await getPendingSubscriptionPlanChange(connection, storeId);
        const validScheduledDowngrade =
            scheduled &&
            String(scheduled.status || "").toUpperCase() === "AWAITING_PAYMENT" &&
            Number(scheduled.target_plan_id) === Number(targetPlan.id);

        if (!validScheduledDowngrade) {
            const error = new Error(
                "Lower-tier paid plans must first be requested as a downgrade and become due at the end of the current paid period."
            );
            error.statusCode = 409;
            throw error;
        }
    }

    const columns = await getPlanColumnsForOwner(connection);

    const [pendingRows] = await connection.execute(
        `SELECT ${columns.id} AS payment_id
         FROM payments
         WHERE ${columns.storeId} = ?
           AND UPPER(${columns.status}) = 'PENDING'
             LIMIT 1`,
        [storeId]
    );

    if (pendingRows.length) {
        const error = new Error("You already have a payment awaiting platform admin review.");
        error.statusCode = 409;
        throw error;
    }

    const [duplicateRows] = await connection.execute(
        `SELECT ${columns.id} AS payment_id
         FROM payments
         WHERE ${columns.reference} = ?
           AND UPPER(${columns.status}) IN ('PENDING', 'APPROVED')
             LIMIT 1`,
        [referenceNumber]
    );

    if (duplicateRows.length) {
        const error = new Error("That GCash reference number has already been submitted.");
        error.statusCode = 409;
        throw error;
    }

    await ensurePaymentOtpsTable(connection);

    const otp = String(body.otp || "").trim();

    if (!/^\d{6}$/.test(otp)) {
        const error = new Error("Enter the 6-digit verification code sent to your email.");
        error.statusCode = 400;
        throw error;
    }

    const otpHash = hashOtp(otp);

    await connection.execute(
        `UPDATE payment_otps
         SET used = 1
         WHERE store_id = ?
           AND used = 0
           AND expires_at <= UTC_TIMESTAMP()`,
        [storeId]
    );

    const [otpRows] = await connection.execute(
        `SELECT id
         FROM payment_otps
         WHERE store_id = ?
           AND otp_hash = ?
           AND used = 0
           AND expires_at > UTC_TIMESTAMP()
         ORDER BY id DESC
             LIMIT 1`,
        [storeId, otpHash]
    );

    if (!otpRows.length) {
        const error = new Error("That verification code is invalid or has expired. Request a new one.");
        error.statusCode = 400;
        throw error;
    }

    await connection.execute(`UPDATE payment_otps SET used = 1 WHERE id = ?`, [otpRows[0].id]);

    const insertColumns = [
        columns.storeId,
        columns.planId,
        columns.amount,
        columns.reference,
        columns.status,
    ];
    const insertValues = [
        storeId,
        planId,
        Number(targetPlan.price),
        referenceNumber,
        "pending",
    ];

    if (columns.receipt && receiptUrl) {
        insertColumns.push(columns.receipt);
        insertValues.push(receiptUrl);
    }

    if (columns.createdAt) {
        insertColumns.push(columns.createdAt);
        insertValues.push(new Date());
    }

    const placeholders = insertColumns.map(() => "?").join(", ");
    const [result] = await connection.execute(
        `INSERT INTO payments (${insertColumns.join(", ")}) VALUES (${placeholders})`,
        insertValues
    );

    return {
        message: "Payment submitted for platform admin review.",
        payment_submission_id: Number(result.insertId),
        plan_name: targetPlan.name,
        amount: Number(targetPlan.price),
    };
}

module.exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json",
    };

    const method =
        event?.requestContext?.http?.method ||
        event?.httpMethod;

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    let body = {};

    try {
        body = JSON.parse(event.body || "{}");
    } catch (err) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Invalid JSON body" }),
        };
    }

    const { action, store_name, email, password } = body;

    let connection;

    try {
        connection = await dbPool.getConnection();

        if (action === "get_subscription") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const subscriptionRole = String(decoded.role || "").toLowerCase();
            const allowedSubscriptionRoles = ["owner", "manager", "staff"];

            if (!allowedSubscriptionRoles.includes(subscriptionRole) || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have access to this store's plan and usage details.",
                        code: "SUBSCRIPTION_VIEW_FORBIDDEN",
                    }),
                };
            }

            // Managers and staff receive the same store-level plan snapshot for
            // visibility, but only the owner receives management permission.
            const subscription = await getOwnerSubscription(connection, Number(decoded.store_id));
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    role: subscriptionRole,
                    can_manage_subscription: subscriptionRole === "owner",
                    subscription,
                }),
            };
        }

        if (action === "get_payment_settings") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            if (String(decoded.role || "").toLowerCase() !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can access subscription payment details.",
                    }),
                };
            }

            const paymentSettings = await getPlatformGcashPaymentSettings(connection);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ payment_settings: paymentSettings }),
            };
        }

        // SEND PAYMENT VERIFICATION OTP
        // Triggered when the owner opens the "Upgrade" payment-proof modal, before
        // they can submit a GCash reference number. Confirms it is really the
        // account owner (not just whoever is holding an open session) submitting
        // the proof of payment.
        if (action === "send_payment_otp") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can submit a subscription payment.",
                    }),
                };
            }

            const storeId = Number(decoded.store_id);
            await ensurePaymentOtpsTable(connection);

            let ownerEmail = String(decoded.email || "").trim().toLowerCase();
            if (!ownerEmail) {
                const [storeRows] = await connection.execute(
                    "SELECT email FROM stores WHERE id = ? LIMIT 1",
                    [storeId]
                );
                ownerEmail = String(storeRows[0]?.email || "").trim().toLowerCase();
            }

            if (!ownerEmail) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: "No email is on file for this account." }),
                };
            }

            await ensurePaymentOtpEmailFailuresTable(connection);

            // Count accepted or still-in-progress OTP requests. A failed SMTP
            // request deletes its pending OTP and is counted separately below.
            const [recentRows] = await connection.execute(
                `SELECT COUNT(*) AS total,
                        TIMESTAMPDIFF(SECOND, NOW(),
                                              DATE_ADD(MIN(created_at), INTERVAL ? MINUTE)) AS retry_after_seconds
                 FROM payment_otps
                 WHERE store_id = ?
                   AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
                [PAYMENT_OTP_RATE_WINDOW_MINUTES, storeId, PAYMENT_OTP_RATE_WINDOW_MINUTES]
            );

            if (Number(recentRows[0]?.total || 0) >= PAYMENT_OTP_MAX_SENT_PER_WINDOW) {
                const retrySeconds = paymentOtpRetrySeconds(recentRows[0]?.retry_after_seconds);
                return paymentOtpCooldownResponse(
                    headers,
                    `Too many verification emails requested. Please try again in ${formatPaymentOtpWaitTime(retrySeconds)}.`,
                    retrySeconds,
                    "PAYMENT_OTP_RATE_LIMIT"
                );
            }

            // A broken Gmail connection must not permit unlimited retries.
            // Failed attempts have their own independent 10-minute allowance.
            const [failureRows] = await connection.execute(
                `SELECT COUNT(*) AS total,
                        TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(),
                                              DATE_ADD(MIN(attempted_at), INTERVAL ? MINUTE)) AS retry_after_seconds
                 FROM payment_otp_email_failures
                 WHERE store_id = ?
                   AND attempted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
                [PAYMENT_OTP_RATE_WINDOW_MINUTES, storeId, PAYMENT_OTP_RATE_WINDOW_MINUTES]
            );

            if (Number(failureRows[0]?.total || 0) >= PAYMENT_OTP_MAX_FAILED_PER_WINDOW) {
                const retrySeconds = paymentOtpRetrySeconds(failureRows[0]?.retry_after_seconds);
                return paymentOtpCooldownResponse(
                    headers,
                    `Email delivery has failed repeatedly. Please wait ${formatPaymentOtpWaitTime(retrySeconds)} before trying again. If the issue persists, check the Auth Lambda Gmail SMTP connection.`,
                    retrySeconds,
                    "PAYMENT_OTP_EMAIL_COOLDOWN"
                );
            }

            let planName = null;
            if (body.plan_id) {
                const [planRows] = await connection.execute(
                    "SELECT name FROM plans WHERE id = ? LIMIT 1",
                    [Number(body.plan_id)]
                );
                planName = planRows[0]?.name || null;
            }

            const otp = generateOtp();
            const otpHash = hashOtp(otp);

            // Keep this OTP unusable until the SMTP server accepts the email.
            // In particular, do not invalidate the owner's previous active code
            // when delivery of this replacement code fails.
            const [insertResult] = await connection.execute(
                `INSERT INTO payment_otps (store_id, email, otp_hash, expires_at, used)
                 VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), 1)`,
                [storeId, ownerEmail, otpHash, PAYMENT_OTP_EXPIRY_SECONDS]
            );
            const newOtpId = Number(insertResult.insertId);

            try {
                await sendPaymentOtpEmail(ownerEmail, otp, planName);
            } catch (emailError) {
                // Remove the code that was never delivered. It will not count
                // toward the five accepted-email OTP requests.
                try {
                    await connection.execute(
                        "DELETE FROM payment_otps WHERE id = ? AND store_id = ? AND used = 1",
                        [newOtpId, storeId]
                    );
                } catch (cleanupError) {
                    console.error("[stocknbook-auth] Unable to clean up undelivered OTP:", {
                        store_id: storeId,
                        message: cleanupError?.message,
                    });
                }

                const smtpErrorCode = String(emailError?.code || "SMTP_DELIVERY_FAILED")
                    .replace(/[^A-Za-z0-9_]/g, "_").slice(0, 50);
                try {
                    await connection.execute(
                        `INSERT INTO payment_otp_email_failures
                             (store_id, smtp_error_code, attempted_at)
                         VALUES (?, ?, UTC_TIMESTAMP())`,
                        [storeId, smtpErrorCode]
                    );
                } catch (trackingError) {
                    console.error("[stocknbook-auth] Unable to track OTP email failure:", {
                        store_id: storeId,
                        message: trackingError?.message,
                    });
                }

                console.error("[stocknbook-auth] Subscription OTP was not delivered:", {
                    store_id: storeId,
                    code: smtpErrorCode,
                    message: emailError?.message || "Unknown SMTP failure",
                });

                const deliveryError = new Error(
                    smtpErrorCode === "GMAIL_AUTH_FAILED" || smtpErrorCode === "SMTP_NOT_CONFIGURED"
                        ? "StockNBook could not authenticate its email sender. Ask the administrator to check the Auth Lambda Gmail App Password before retrying."
                        : "StockNBook could not send the verification email. No new code was activated. Please try again shortly or check the Auth Lambda email-service logs."
                );
                deliveryError.statusCode = 503;
                deliveryError.code = "PAYMENT_OTP_EMAIL_FAILED";
                throw deliveryError;
            }

            // Gmail accepted the message: now activate the new code atomically
            // and invalidate only the previously active code(s).
            await connection.beginTransaction();
            try {
                await connection.execute(
                    "UPDATE payment_otps SET used = 1 WHERE store_id = ? AND used = 0",
                    [storeId]
                );
                const [activation] = await connection.execute(
                    `UPDATE payment_otps
                     SET used = 0, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)
                     WHERE id = ? AND store_id = ? AND used = 1`,
                    [PAYMENT_OTP_EXPIRY_SECONDS, newOtpId, storeId]
                );
                if (Number(activation.affectedRows || 0) !== 1) {
                    throw new Error("The emailed OTP could not be activated in the database.");
                }
                await connection.commit();
            } catch (activationError) {
                await connection.rollback();
                throw activationError;
            }

            // Explicit local debug remains optional, but a failed email never
            // silently turns into a successful terminal-only OTP.
            if (PAYMENT_OTP_TERMINAL_DEBUG) {
                console.log(
                    `[StockNBook DEV OTP] Subscription payment verification | ` +
                    `Store ID: ${storeId} | ` +
                    `Plan: ${planName || "Selected plan"} | ` +
                    `Email: ${ownerEmail} | ` +
                    `OTP: ${otp} | ` +
                    `Expires in: ${PAYMENT_OTP_EXPIRY_SECONDS}s`
                );
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Verification code sent to your email.",
                    delivery: "email",
                    expires_in: PAYMENT_OTP_EXPIRY_SECONDS,
                    email_hint: ownerEmail.replace(/^(.{2}).+(@.+)$/, "$1***$2"),
                }),
            };
        }

        if (action === "submit_subscription_payment") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const result = await submitOwnerPlanPayment(connection, decoded, body);

            // The payment INSERT succeeded. Email delivery is best-effort so an
            // SMTP outage never causes the owner to re-submit an existing payment.
            let confirmationEmailStatus = "failed";
            try {
                const [storeRows] = await connection.execute(
                    "SELECT store_name, email FROM stores WHERE id = ? LIMIT 1",
                    [Number(decoded.store_id)]
                );
                const store = storeRows[0];
                const ownerEmail = String(store?.email || "").trim().toLowerCase();
                if (ownerEmail) {
                    await sendPaymentSubmissionAcknowledgmentEmail(ownerEmail, {
                        ...result,
                        store_name: store.store_name,
                    });
                    confirmationEmailStatus = "sent";
                } else {
                    confirmationEmailStatus = "no_email_on_file";
                }
            } catch (notificationError) {
                console.error("[stocknbook-auth] Payment saved, but acknowledgment email failed:", {
                    payment_submission_id: result.payment_submission_id,
                    message: notificationError?.message || "Unknown email error",
                });
            }
            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    ...result,
                    confirmation_email_status: confirmationEmailStatus,
                }),
            };
        }

        if (action === "request_subscription_downgrade") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const result = await requestOwnerSubscriptionDowngrade(
                connection,
                decoded,
                body
            );
            return { statusCode: 201, headers, body: JSON.stringify(result) };
        }

        if (action === "cancel_subscription_downgrade") {
            const token = getBearerTokenFromEvent(event);
            if (!token) {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Missing token" }) };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid token" }) };
            }

            const result = await cancelOwnerSubscriptionDowngrade(
                connection,
                decoded
            );
            return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        // SEND SIGNUP OTP
        if (action === "send_signup_otp") {
            await ensureSignupOtpsTable(connection);

            const ownerName = String(
                body.owner_name ?? body.ownerName ?? ""
            ).trim();

            const storeName = String(
                body.store_name ?? body.storeName ?? ""
            ).trim();

            const phoneNumber = String(
                body.phone_number ?? body.phoneNumber ?? body.phone ?? ""
            ).trim();

            const emailAddress = String(body.email ?? "").trim().toLowerCase();
            const accountPassword = String(body.password ?? "");

            if (!ownerName || !storeName || !phoneNumber || !emailAddress || !accountPassword) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Owner name, business name, phone number, email, and password are required.",
                    }),
                };
            }

            const phoneDigits = phoneNumber.replace(/\D/g, "");

            if (phoneDigits.length < 10 || phoneDigits.length > 15) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid phone number." }),
                };
            }

            if (!/^\S+@\S+\.\S+$/.test(emailAddress)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid email address." }),
                };
            }

            if (accountPassword.length < 8) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Password must contain at least 8 characters." }),
                };
            }

            const slug = generateSlug(storeName);

            if (!slug) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Business name must contain letters or numbers." }),
                };
            }

            const [phoneColumnRows] = await connection.execute(
                "SHOW COLUMNS FROM stores LIKE 'phone_number'"
            );

            if (phoneColumnRows.length === 0) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: "Database setup is incomplete. Add stores.phone_number before creating new accounts.",
                    }),
                };
            }

            const [existing] = await connection.execute(
                "SELECT id FROM stores WHERE email = ? LIMIT 1",
                [emailAddress]
            );

            if (existing.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Email already exists" }),
                };
            }

            const otp = generateOtp();
            const otpHash = hashOtp(otp);

            await connection.execute(
                `UPDATE signup_otps
                 SET used = 1
                 WHERE email = ?
                   AND used = 0`,
                [emailAddress]
            );

            await connection.execute(
                `INSERT INTO signup_otps
                     (email, otp_hash, expires_at, used)
                 VALUES
                     (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), 0)`,
                [emailAddress, otpHash, OTP_EXPIRY_SECONDS]
            );

            try {
                await sendSignupOtpEmail(emailAddress, otp);
            } catch (emailError) {
                await connection.execute(
                    `UPDATE signup_otps
                     SET used = 1
                     WHERE email = ?
                       AND otp_hash = ?
                       AND used = 0`,
                    [emailAddress, otpHash]
                );

                throw emailError;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "OTP sent successfully",
                    expires_in: OTP_EXPIRY_SECONDS,
                }),
            };
        }

        // VERIFY SIGNUP OTP AND CREATE OWNER ACCOUNT
        if (action === "verify_signup_otp") {
            await ensureSignupOtpsTable(connection);

            const otp = String(body.otp ?? "").trim();
            const otpEmail = String(body.email ?? "").trim().toLowerCase();

            if (!otp || !otpEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "OTP and email are required." }),
                };
            }

            if (!/^\d{6}$/.test(otp)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "OTP must be exactly 6 digits." }),
                };
            }

            const otpHash = hashOtp(otp);

            // Explicitly invalidate every expired OTP for this email.
            await connection.execute(
                `UPDATE signup_otps
                 SET used = 1
                 WHERE email = ?
                   AND used = 0
                   AND expires_at <= UTC_TIMESTAMP()`,
                [otpEmail]
            );

            // Accept only an unused OTP that has not expired.
            const [otpRows] = await connection.execute(
                `SELECT id
                 FROM signup_otps
                 WHERE email = ?
                   AND otp_hash = ?
                   AND used = 0
                   AND expires_at > UTC_TIMESTAMP()
                 ORDER BY id DESC
                     LIMIT 1`,
                [otpEmail, otpHash]
            );

            if (otpRows.length === 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Invalid or expired OTP." }),
                };
            }

            // Accept both snake_case and camelCase because the Create Account modal
            // may submit either naming style. The current modal submits owner_name
            // and phone, which are both supported here.
            const ownerName = String(
                body.owner_name ?? body.ownerName ?? ""
            ).trim();
            const storeName = String(
                body.store_name ?? body.storeName ?? ""
            ).trim();
            const phoneNumber = String(
                body.phone_number ?? body.phoneNumber ?? body.phone ?? ""
            ).trim();
            const emailAddress = String(body.email ?? "").trim().toLowerCase();
            const accountPassword = String(body.password ?? "");

            if (!ownerName || !storeName || !phoneNumber || !emailAddress || !accountPassword) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Owner name, business name, phone number, email, and password are required.",
                    }),
                };
            }

            const phoneDigits = phoneNumber.replace(/\D/g, "");
            if (phoneDigits.length < 10 || phoneDigits.length > 15) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid phone number." }),
                };
            }

            if (!/^\S+@\S+\.\S+$/.test(emailAddress)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid email address." }),
                };
            }

            if (accountPassword.length < 8) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Password must contain at least 8 characters." }),
                };
            }

            const slug = generateSlug(storeName);
            if (!slug) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Business name must contain letters or numbers." }),
                };
            }

            // The migration in database/01_add_phone_number.sql must be run once.
            const [phoneColumnRows] = await connection.execute(
                "SHOW COLUMNS FROM stores LIKE 'phone_number'"
            );

            if (phoneColumnRows.length === 0) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: "Database setup is incomplete. Add stores.phone_number before creating new accounts.",
                    }),
                };
            }

            const [existing] = await connection.execute(
                "SELECT id FROM stores WHERE email = ? LIMIT 1",
                [emailAddress]
            );

            if (existing.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Email already exists" }),
                };
            }

            await connection.execute(
                `UPDATE signup_otps
                 SET used = 1
                 WHERE email = ?
                   AND used = 0`,
                [emailAddress]
            );

            const hashed = await bcrypt.hash(accountPassword, 10);

            const [result] = await connection.execute(
                `INSERT INTO stores
                     (store_name, owner_name, phone_number, email, password, slug)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [storeName, ownerName, phoneNumber, emailAddress, hashed, slug]
            );

            const token = jwt.sign(
                {
                    store_id: result.insertId,
                    email: emailAddress,
                    role: "owner",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    token,
                    role: "owner",
                    store_id: result.insertId,
                    store_name: storeName,
                    store_slug: slug,
                    owner_name: ownerName,
                    phone_number: phoneNumber,
                }),
            };
        }

        // GET STORE BY SLUG
        if (action === "get_store_by_slug") {
            const { slug } = body;

            if (!slug) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing slug" }),
                };
            }

            let [rows] = await connection.execute(
                `SELECT id, store_name, slug
                 FROM stores
                 WHERE slug = ?
                     LIMIT 1`,
                [slug]
            );

            /*
             * Compatibility fallback for older/demo store records.
             *
             * Some existing records use seeded slugs such as
             * "demo-v1-party-store-001", while older customer links were
             * generated from the store name, for example:
             * "happy-party-supplies-quezon-city".
             *
             * Keep the database slug as the primary lookup. Only when it does
             * not match do we compare the requested URL slug with a slug
             * generated from each existing store name.
             */
            if (!rows.length) {
                const [storeRows] = await connection.execute(
                    `SELECT id, store_name, slug
                     FROM stores
                     ORDER BY id ASC`
                );

                const fallbackStore = storeRows.find(
                    (store) => generateSlug(store.store_name || "") === slug
                );

                if (fallbackStore) {
                    rows = [fallbackStore];
                }
            }

            if (!rows.length) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Store not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ store: rows[0] }),
            };
        }

        // GET PUBLIC BRANCHES BY STORE
        if (action === "get_public_branches") {
            const { storeId } = body;

            if (!storeId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing storeId" }),
                };
            }

            const [branchRows] = await connection.execute(
                `SELECT
                     id,
                     branch_name,
                     contact_number,
                     address
                 FROM branches
                 WHERE store_id = ?
                 ORDER BY branch_name ASC`,
                [Number(storeId)]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    branches: branchRows.map((branch) => ({
                        id: branch.id,
                        branch_name: branch.branch_name,
                        contact_number: branch.contact_number || "",
                        address: branch.address || "",
                        branch_slug: generateSlug(branch.branch_name || ""),
                    })),
                }),
            };
        }
        // SAVE ONBOARDING
        if (action === "save_onboarding") {
            await ensureBranchOperationalColumns(connection);

            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can complete onboarding",
                    }),
                };
            }

            const storeId = decoded.store_id;
            const { branches = [] } = body;
            const shouldSendInvitationEmails =
                body.send_invitation_emails !== false;

            if (!Array.isArray(branches) || branches.length === 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "No branches provided" }),
                };
            }

            // Enforce the branch entitlement using the current active plan.
            // This covers both first-time onboarding and later single-branch
            // additions because the endpoint receives the new branch list.
            try {
                await assertPlanLimit(
                    connection,
                    Number(storeId),
                    "branches",
                    branches.length,
                    decoded.role
                );
            } catch (limitError) {
                return {
                    statusCode: limitError?.statusCode || 409,
                    headers,
                    body: JSON.stringify({
                        error: limitError?.message || "Plan limit reached.",
                        code: limitError?.code || "BRANCHES_LIMIT_REACHED",
                        plan_name: limitError?.plan_name,
                        current: limitError?.current,
                        limit: limitError?.limit,
                    }),
                };
            }

            const [storeRows] = await connection.execute(
                `SELECT store_name
                 FROM stores
                 WHERE id = ?
                     LIMIT 1`,
                [storeId]
            );

            if (storeRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Store not found" }),
                };
            }

            const storeName = storeRows[0].store_name || "StockNBook Store";
            const inviteLinks = [];

            await connection.beginTransaction();

            try {
                for (const branch of branches) {
                    const branchName = String(
                        branch.branch_name || ""
                    ).trim();

                    const contactNumber = String(
                        branch.contact_number || ""
                    ).trim();

                    const address = String(
                        branch.address || ""
                    ).trim();

                    const branchStatus = String(
                        branch.status ||
                        branch.branch_status ||
                        "active"
                    )
                        .trim()
                        .toLowerCase();

                    const inactiveReason =
                        branchStatus === "inactive"
                            ? String(
                                branch.inactive_reason ||
                                branch.branch_inactive_reason ||
                                ""
                            ).trim()
                            : "";

                    if (
                        branchStatus !== "active" &&
                        branchStatus !== "inactive"
                    ) {
                        throw new Error(
                            `Invalid branch status for ${branchName}.`
                        );
                    }

                    if (
                        branchStatus === "inactive" &&
                        !inactiveReason
                    ) {
                        throw new Error(
                            `Select an inactive reason for ${branchName}.`
                        );
                    }

                    const managerName = String(
                        branch.manager_name || ""
                    ).trim();

                    const managerEmail = String(
                        branch.manager_email || ""
                    )
                        .trim()
                        .toLowerCase();

                    if (!branchName) {
                        throw new Error("Every branch must have a branch name.");
                    }

                    if (
                        managerEmail &&
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)
                    ) {
                        throw new Error(
                            `Invalid manager email for ${branchName}.`
                        );
                    }

                    const [branchResult] = await connection.execute(
                        `INSERT INTO branches
                         (
                             store_id,
                             branch_name,
                             contact_number,
                             address,
                             status,
                             inactive_reason
                         )
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            storeId,
                            branchName,
                            contactNumber || null,
                            address || null,
                            branchStatus,
                            inactiveReason || null,
                        ]
                    );

                    const branchId = branchResult.insertId;

                    if (managerEmail) {
                        const [existingManagerRows] =
                            await connection.execute(
                                `SELECT id
                                 FROM managers
                                 WHERE manager_email = ?
                                   AND store_id = ?
                                     LIMIT 1`,
                                [managerEmail, storeId]
                            );

                        if (existingManagerRows.length > 0) {
                            throw new Error(
                                `${managerEmail} is already assigned as a manager in this store.`
                            );
                        }

                        const inviteToken = jwt.sign(
                            {
                                store_id: storeId,
                                branch_id: branchId,
                                email: managerEmail,
                                type: "manager_invite",
                            },
                            JWT_SECRET,
                            { expiresIn: "7d" }
                        );

                        const inviteLink =
                            `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

                        const permissions = branch.permissions || {};

                        await connection.execute(
                            `INSERT INTO managers
                             (
                                 store_id,
                                 branch_id,
                                 manager_name,
                                 manager_email,
                                 invite_token,
                                 permissions,
                                 status
                             )
                             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [
                                storeId,
                                branchId,
                                managerName || null,
                                managerEmail,
                                inviteToken,
                                JSON.stringify(permissions),
                                "pending",
                            ]
                        );

                        inviteLinks.push({
                            manager_email: managerEmail,
                            manager_name: managerName,
                            store_name: storeName,
                            branch_name: branchName,
                            invite_link: inviteLink,
                            permissions,
                            email_sent: false,
                            email_status: "pending",
                            email_error: "",
                        });
                    }
                }

                await connection.commit();
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: err?.message || "Unable to save onboarding",
                    }),
                };
            }

            let invitationEmailsSent = 0;
            let invitationEmailsFailed = 0;

            if (shouldSendInvitationEmails) {
                for (const invite of inviteLinks) {
                    const delivery = await deliverInvitationEmail({
                        role: "Manager",
                        email: invite.manager_email,
                        name: invite.manager_name,
                        storeName: invite.store_name,
                        branchName: invite.branch_name,
                        inviteLink: invite.invite_link,
                        send: () => sendManagerInvitationEmail(invite),
                    });

                    invite.email_sent = delivery.email_sent;
                    invite.email_status = delivery.email_status;
                    invite.email_error = delivery.email_error;

                    if (delivery.email_sent) {
                        invitationEmailsSent += 1;
                    } else {
                        invitationEmailsFailed += 1;
                    }
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Onboarding saved successfully",
                    invite_links: inviteLinks,
                    invitation_emails_sent: invitationEmailsSent,
                    invitation_emails_failed: invitationEmailsFailed,
                }),
            };
        }

        // GET MANAGER INVITATION DETAILS
        if (action === "get_manager_invite") {
            try {
                const { manager } = await getManagerInviteRecord(
                    connection,
                    body.invite_token
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(manager),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to load the invitation.",
                    }),
                };
            }
        }

        // SEND MANAGER INVITATION OTP
        if (action === "send_manager_invite_otp") {
            try {
                await ensureManagerInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                if (manager.status !== "pending") {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "This invitation is no longer pending.",
                        }),
                    };
                }

                const otp = generateOtp();
                const otpHash = hashOtp(otp);
                const inviteTokenHash = hashInviteToken(inviteToken);

                await connection.execute(
                    `UPDATE manager_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0`,
                    [inviteTokenHash, manager.manager_email]
                );

                await connection.execute(
                    `INSERT INTO manager_invite_otps
                     (
                         invite_token_hash,
                         email,
                         otp_hash,
                         expires_at,
                         used
                     )
                     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), 0)`,
                    [
                        inviteTokenHash,
                        manager.manager_email,
                        otpHash,
                        MANAGER_INVITE_OTP_EXPIRY_SECONDS,
                    ]
                );

                if (INVITATION_TERMINAL_DEBUG) {
                    console.log(
                        `[StockNBook DEV OTP] Manager invitation verification | ` +
                        `Email: ${manager.manager_email} | ` +
                        `OTP: ${otp} | ` +
                        `Expires in: ${MANAGER_INVITE_OTP_EXPIRY_SECONDS}s`
                    );
                }

                let managerOtpDelivery = "email";

                try {
                    await sendManagerInviteOtpEmail(
                        manager.manager_email,
                        otp,
                        manager.manager_name
                    );
                } catch (emailError) {
                    if (INVITATION_TERMINAL_DEBUG) {
                        managerOtpDelivery = "terminal";
                        console.warn(
                            "[StockNBook DEV OTP] Manager invitation OTP email could not be delivered. " +
                            "The OTP remains active for local testing and is shown in the IDE terminal.",
                            {
                                email: manager.manager_email,
                                error: emailError?.message || "Email delivery failed",
                            }
                        );
                    } else {
                        await connection.execute(
                            `UPDATE manager_invite_otps
                             SET used = 1
                             WHERE invite_token_hash = ?
                               AND email = ?
                               AND otp_hash = ?
                               AND used = 0`,
                            [inviteTokenHash, manager.manager_email, otpHash]
                        );
                        throw emailError;
                    }
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message:
                            managerOtpDelivery === "terminal"
                                ? "Verification code generated for local testing. Check the IDE terminal."
                                : "Verification code sent successfully.",
                        expires_in: MANAGER_INVITE_OTP_EXPIRY_SECONDS,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to send the verification code.",
                    }),
                };
            }
        }

        // VERIFY MANAGER INVITATION OTP
        if (action === "verify_manager_invite_otp") {
            try {
                await ensureManagerInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const otp = String(body.otp || "").replace(/\D/g, "");
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                if (!/^\d{6}$/.test(otp)) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter the complete 6-digit verification code.",
                        }),
                    };
                }

                const inviteTokenHash = hashInviteToken(inviteToken);
                const otpHash = hashOtp(otp);

                await connection.execute(
                    `UPDATE manager_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0
                       AND expires_at <= UTC_TIMESTAMP()`,
                    [inviteTokenHash, manager.manager_email]
                );

                const [otpRows] = await connection.execute(
                    `SELECT id
                     FROM manager_invite_otps
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND otp_hash = ?
                       AND used = 0
                       AND expires_at > UTC_TIMESTAMP()
                     ORDER BY id DESC
                         LIMIT 1`,
                    [
                        inviteTokenHash,
                        manager.manager_email,
                        otpHash,
                    ]
                );

                if (otpRows.length === 0) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Invalid or expired verification code.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE manager_invite_otps
                     SET used = 1,
                         verified_at = UTC_TIMESTAMP()
                     WHERE id = ?`,
                    [otpRows[0].id]
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Invited email verified successfully.",
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to verify the invitation code.",
                    }),
                };
            }
        }

        // UPDATE MANAGER INVITATION DETAILS
        if (action === "update_manager_invite_details") {
            try {
                const inviteToken = String(body.invite_token || "");
                const managerName = String(body.manager_name || "").trim();
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedManagerInvite(
                    connection,
                    inviteToken,
                    manager.manager_email
                );

                if (managerName.length < 2 || managerName.length > 120) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter a valid manager name.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE managers
                     SET manager_name = ?
                     WHERE id = ?
                       AND invite_token = ?
                       AND status = 'pending'`,
                    [managerName, manager.manager_id, inviteToken]
                );

                const refreshed = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(refreshed.manager),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to update the manager details.",
                    }),
                };
            }
        }

        // ACCEPT MANAGER INVITE
        if (action === "accept_manager_invite") {
            try {
                const inviteToken = String(body.invite_token || "");
                const accountPassword = String(body.password || "");
                const requestedManagerName = String(
                    body.manager_name || ""
                ).trim();

                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedManagerInvite(
                    connection,
                    inviteToken,
                    manager.manager_email
                );

                const passwordValid =
                    accountPassword.length >= 8 &&
                    /[A-Z]/.test(accountPassword) &&
                    /\d/.test(accountPassword) &&
                    /[^A-Za-z0-9]/.test(accountPassword);

                if (!passwordValid) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error:
                                "Password must contain at least 8 characters, one uppercase letter, one number, and one special character.",
                        }),
                    };
                }

                const finalManagerName =
                    requestedManagerName || manager.manager_name || "Manager";
                const hashedPassword = await bcrypt.hash(
                    accountPassword,
                    10
                );

                const [result] = await connection.execute(
                    `UPDATE managers
                     SET manager_name = ?,
                         password = ?,
                         status = 'active',
                         invite_token = NULL
                     WHERE id = ?
                       AND invite_token = ?
                       AND manager_email = ?
                       AND status = 'pending'`,
                    [
                        finalManagerName,
                        hashedPassword,
                        manager.manager_id,
                        inviteToken,
                        manager.manager_email,
                    ]
                );

                if (result.affectedRows === 0) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Invitation not found or already accepted.",
                        }),
                    };
                }

                await ensureManagerInviteOtpsTable(connection);
                await connection.execute(
                    `UPDATE manager_invite_otps
                     SET used = 1,
                         verified_at = NULL
                     WHERE invite_token_hash = ?
                       AND email = ?`,
                    [
                        hashInviteToken(inviteToken),
                        manager.manager_email,
                    ]
                );

                const sessionToken = jwt.sign(
                    {
                        manager_id: manager.manager_id,
                        store_id: manager.store_id,
                        branch_id: manager.branch_id,
                        email: manager.manager_email,
                        role: "manager",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Manager account activated successfully.",
                        token: sessionToken,
                        manager_id: manager.manager_id,
                        manager_name: finalManagerName,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        role: "manager",
                        status: "active",
                        permissions: manager.permissions,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to activate the manager account.",
                    }),
                };
            }
        }

        // INVITE STAFF
        if (action === "invite_staff") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only branch managers can invite staff",
                    }),
                };
            }

            const staffName = String(body.staff_name || "").trim();
            const staffEmail = String(body.staff_email || "")
                .trim()
                .toLowerCase();
            const permissions = body.permissions || {};

            if (!staffName || !staffEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Missing staff name or email",
                    }),
                };
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Enter a valid staff email address",
                    }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.permissions,
                     managers.manager_name,
                     branches.branch_name,
                     stores.store_name
                 FROM managers
                          JOIN branches
                               ON branches.id = managers.branch_id
                                   AND branches.store_id = managers.store_id
                          JOIN stores
                               ON stores.id = managers.store_id
                 WHERE managers.id = ?
                   AND managers.store_id = ?
                   AND managers.branch_id = ?
                   AND managers.status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const manager = managerRows[0];

            const managerPermissions =
                typeof manager.permissions === "string"
                    ? JSON.parse(manager.permissions || "{}")
                    : manager.permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to invite staff",
                    }),
                };
            }

            const [existingStaff] = await connection.execute(
                `SELECT id
                 FROM staff
                 WHERE staff_email = ?
                   AND store_id = ?
                   AND branch_id = ?
                     LIMIT 1`,
                [staffEmail, storeId, branchId]
            );

            if (existingStaff.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Staff email already exists in this branch",
                    }),
                };
            }

            try {
                await assertPlanLimit(
                    connection,
                    Number(storeId),
                    "staff",
                    1,
                    decoded.role
                );
            } catch (limitError) {
                return {
                    statusCode: limitError?.statusCode || 409,
                    headers,
                    body: JSON.stringify({
                        error: limitError?.message || "Plan limit reached.",
                        code: limitError?.code || "STAFF_LIMIT_REACHED",
                        plan_name: limitError?.plan_name,
                        current: limitError?.current,
                        limit: limitError?.limit,
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: branchId,
                    manager_id: managerId,
                    email: staffEmail,
                    type: "staff_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const inviteLink =
                `${APP_BASE_URL}/accept-staff-invite?token=${encodeURIComponent(inviteToken)}`;

            await connection.execute(
                `INSERT INTO staff
                 (
                     store_id,
                     branch_id,
                     manager_id,
                     staff_name,
                     staff_email,
                     invite_token,
                     status,
                     permissions
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    branchId,
                    managerId,
                    staffName,
                    staffEmail,
                    inviteToken,
                    "pending",
                    JSON.stringify(permissions),
                ]
            );

            const invitation = {
                staff_email: staffEmail,
                staff_name: staffName,
                manager_name: manager.manager_name || "Branch Manager",
                store_name: manager.store_name || "StockNBook Store",
                branch_name: manager.branch_name || "Assigned Branch",
                invite_link: inviteLink,
                permissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Staff",
                email: staffEmail,
                name: staffName,
                storeName: manager.store_name || "StockNBook Store",
                branchName: manager.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendStaffInvitationEmail(invitation),
            });

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Staff invitation created and emailed successfully."
                        : "Staff invitation created successfully, but the email could not be delivered. Copy the backup invite link or use Resend later.",
                    invite_link: inviteLink,
                    staff_email: staffEmail,
                    staff_name: staffName,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // PLATFORM ADMIN LOGIN
        // Platform administrators are stored in platform_admins,
        // which uses the `password` column for the bcrypt hash.
        if (action === "platform_admin_login") {
            if (!email || !password) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Missing email or password",
                    }),
                };
            }

            const adminEmail = String(email).trim().toLowerCase();

            const [adminRows] = await connection.execute(
                `SELECT
                     platform_admin_id,
                     full_name,
                     email,
                     password,
                     status,
                     role,
                     is_active
                 FROM platform_admins
                 WHERE LOWER(email) = ?
                     LIMIT 1`,
                [adminEmail]
            );

            if (adminRows.length === 0) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Invalid email or password",
                    }),
                };
            }

            const admin = adminRows[0];
            const adminStatus = String(admin.status || "")
                .trim()
                .toLowerCase();

            if (adminStatus !== "active" || Number(admin.is_active) !== 1) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Platform administrator account is inactive.",
                        code: "ACCOUNT_INACTIVE",
                    }),
                };
            }

            if (!admin.password) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Invalid email or password",
                    }),
                };
            }

            const passwordMatches = await bcrypt.compare(
                String(password),
                admin.password
            );

            if (!passwordMatches) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Invalid email or password",
                    }),
                };
            }

            const token = jwt.sign(
                {
                    platform_admin_id: admin.platform_admin_id,
                    email: admin.email,
                    full_name: admin.full_name,
                    role: "PLATFORM_ADMIN",
                },
                JWT_SECRET,
                { expiresIn: "8h" }
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    token,
                    role: "PLATFORM_ADMIN",
                    user: {
                        id: admin.platform_admin_id,
                        platform_admin_id: admin.platform_admin_id,
                        full_name: admin.full_name,
                        email: admin.email,
                        role: "PLATFORM_ADMIN",
                    },
                }),
            };
        }

        // LOGIN
        if (action === "login") {
            if (!email || !password) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing email or password" }),
                };
            }

            // 1. Try owner login first
            const [storeRows] = await connection.execute(
                "SELECT * FROM stores WHERE email = ?",
                [email]
            );

            if (storeRows.length > 0) {
                const store = storeRows[0];
                const match = await bcrypt.compare(password, store.password);

                if (!match) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({ error: "Invalid email or password" }),
                    };
                }



                const token = jwt.sign(
                    {
                        store_id: store.id,
                        email: store.email,
                        role: "owner",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "owner",
                        store_id: store.id,
                        owner_name: store.owner_name,
                        store_name: store.store_name,
                        store_slug: store.slug,
                    }),
                };
            }

            // 2. Try manager login
            const [managerRows] = await connection.execute(
                `SELECT
                     managers.*,
                     branches.branch_name,
                     stores.store_name
                 FROM managers
                          JOIN branches ON managers.branch_id = branches.id
                          JOIN stores ON managers.store_id = stores.id
                 WHERE managers.manager_email = ?
                     LIMIT 1`,
                [email]
            );

            if (managerRows.length > 0) {
                const manager = managerRows[0];
                const managerStatus = String(
                    manager.status || ""
                ).trim().toLowerCase();

                if (managerStatus === "inactive") {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error:
                                "Your branch manager account has already been deactivated. Please contact the store owner if you think this was a mistake.",
                            code: "ACCOUNT_DEACTIVATED",
                            message:
                                "Your branch manager account has already been deactivated. Please contact the store owner if you think this was a mistake.",
                        }),
                    };
                }

                if (managerStatus === "pending" || !manager.password) {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Account activation required",
                            code: "ACCOUNT_PENDING",
                            message:
                                "Your manager invitation has not been accepted yet. Open the invitation email and complete the account activation first.",
                        }),
                    };
                }

                if (managerStatus !== "active") {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Account unavailable",
                            code: "ACCOUNT_UNAVAILABLE",
                            message:
                                "Your branch manager account is not currently active. Please contact the store owner.",
                        }),
                    };
                }

                const managerMatch = await bcrypt.compare(
                    password,
                    manager.password
                );

                if (!managerMatch) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({
                            error: "Invalid email or password",
                        }),
                    };
                }

                const token = jwt.sign(
                    {
                        manager_id: manager.id,
                        store_id: manager.store_id,
                        branch_id: manager.branch_id,
                        email: manager.manager_email,
                        role: "manager",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "manager",
                        manager_id: manager.id,
                        manager_name: manager.manager_name,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        permissions:
                            typeof manager.permissions === "string"
                                ? JSON.parse(manager.permissions || "{}")
                                : manager.permissions || {},
                    }),
                };
            }

            // 3. Try staff login
            const [staffRows] = await connection.execute(
                `SELECT
                     staff.*,
                     branches.branch_name,
                     stores.store_name
                 FROM staff
                          JOIN branches ON staff.branch_id = branches.id
                          JOIN stores ON staff.store_id = stores.id
                 WHERE staff.staff_email = ?
                   AND staff.status = 'active'
                     LIMIT 1`,
                [email]
            );

            if (staffRows.length > 0) {
                const staff = staffRows[0];

                if (!staff.password) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({
                            error: "Staff invitation has not been accepted yet",
                        }),
                    };
                }

                const staffMatch = await bcrypt.compare(password, staff.password);

                if (!staffMatch) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({ error: "Invalid email or password" }),
                    };
                }

                const token = jwt.sign(
                    {
                        staff_id: staff.id,
                        store_id: staff.store_id,
                        branch_id: staff.branch_id,
                        manager_id: staff.manager_id,
                        email: staff.staff_email,
                        role: "staff",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "staff",
                        staff_id: staff.id,
                        staff_name: staff.staff_name,
                        staff_email: staff.staff_email,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        permissions:
                            typeof staff.permissions === "string"
                                ? JSON.parse(staff.permissions || "{}")
                                : staff.permissions || {},
                    }),
                };
            }

            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: "Invalid email or password" }),
            };
        }

        // GET STAFF INVITATION DETAILS
        if (action === "get_staff_invite") {
            try {
                const { staff } = await getStaffInviteRecord(
                    connection,
                    body.invite_token
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(staff),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to load the invitation.",
                    }),
                };
            }
        }

        // SEND STAFF INVITATION OTP
        if (action === "send_staff_invite_otp") {
            try {
                await ensureStaffInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                if (staff.status !== "pending") {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "This invitation is no longer pending.",
                        }),
                    };
                }

                const otp = generateOtp();
                const otpHash = hashOtp(otp);
                const inviteTokenHash = hashInviteToken(inviteToken);

                await connection.execute(
                    `UPDATE staff_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0`,
                    [inviteTokenHash, staff.staff_email]
                );

                await connection.execute(
                    `INSERT INTO staff_invite_otps
                     (
                         invite_token_hash,
                         email,
                         otp_hash,
                         expires_at,
                         used
                     )
                     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), 0)`,
                    [
                        inviteTokenHash,
                        staff.staff_email,
                        otpHash,
                        STAFF_INVITE_OTP_EXPIRY_SECONDS,
                    ]
                );

                if (INVITATION_TERMINAL_DEBUG) {
                    console.log(
                        `[StockNBook DEV OTP] Staff invitation verification | ` +
                        `Email: ${staff.staff_email} | ` +
                        `OTP: ${otp} | ` +
                        `Expires in: ${STAFF_INVITE_OTP_EXPIRY_SECONDS}s`
                    );
                }

                let staffOtpDelivery = "email";

                try {
                    await sendStaffInviteOtpEmail(
                        staff.staff_email,
                        otp,
                        staff.staff_name
                    );
                } catch (emailError) {
                    if (INVITATION_TERMINAL_DEBUG) {
                        staffOtpDelivery = "terminal";
                        console.warn(
                            "[StockNBook DEV OTP] Staff invitation OTP email could not be delivered. " +
                            "The OTP remains active for local testing and is shown in the IDE terminal.",
                            {
                                email: staff.staff_email,
                                error: emailError?.message || "Email delivery failed",
                            }
                        );
                    } else {
                        await connection.execute(
                            `UPDATE staff_invite_otps
                             SET used = 1
                             WHERE invite_token_hash = ?
                               AND email = ?
                               AND otp_hash = ?
                               AND used = 0`,
                            [inviteTokenHash, staff.staff_email, otpHash]
                        );
                        throw emailError;
                    }
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message:
                            staffOtpDelivery === "terminal"
                                ? "Verification code generated for local testing. Check the IDE terminal."
                                : "Verification code sent successfully.",
                        expires_in: STAFF_INVITE_OTP_EXPIRY_SECONDS,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to send the verification code.",
                    }),
                };
            }
        }

        // VERIFY STAFF INVITATION OTP
        if (action === "verify_staff_invite_otp") {
            try {
                await ensureStaffInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const otp = String(body.otp || "").replace(/\D/g, "");
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                if (!/^\d{6}$/.test(otp)) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter the complete 6-digit verification code.",
                        }),
                    };
                }

                const inviteTokenHash = hashInviteToken(inviteToken);
                const otpHash = hashOtp(otp);

                await connection.execute(
                    `UPDATE staff_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0
                       AND expires_at <= UTC_TIMESTAMP()`,
                    [inviteTokenHash, staff.staff_email]
                );

                const [otpRows] = await connection.execute(
                    `SELECT id
                     FROM staff_invite_otps
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND otp_hash = ?
                       AND used = 0
                       AND expires_at > UTC_TIMESTAMP()
                     ORDER BY id DESC
                         LIMIT 1`,
                    [
                        inviteTokenHash,
                        staff.staff_email,
                        otpHash,
                    ]
                );

                if (otpRows.length === 0) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Invalid or expired verification code.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE staff_invite_otps
                     SET used = 1,
                         verified_at = UTC_TIMESTAMP()
                     WHERE id = ?`,
                    [otpRows[0].id]
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Invited email verified successfully.",
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to verify the invitation code.",
                    }),
                };
            }
        }

        // UPDATE STAFF INVITATION DETAILS
        if (action === "update_staff_invite_details") {
            try {
                const inviteToken = String(body.invite_token || "");
                const staffName = String(body.staff_name || "").trim();
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedStaffInvite(
                    connection,
                    inviteToken,
                    staff.staff_email
                );

                if (staffName.length < 2 || staffName.length > 120) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter a valid staff name.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE staff
                     SET staff_name = ?
                     WHERE id = ?
                       AND invite_token = ?
                       AND status = 'pending'`,
                    [staffName, staff.staff_id, inviteToken]
                );

                const refreshed = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(refreshed.staff),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to update the staff details.",
                    }),
                };
            }
        }

        // ACCEPT STAFF INVITE
        if (action === "accept_staff_invite") {
            try {
                const inviteToken = String(body.invite_token || "");
                const accountPassword = String(body.password || "");
                const requestedStaffName = String(
                    body.staff_name || ""
                ).trim();

                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedStaffInvite(
                    connection,
                    inviteToken,
                    staff.staff_email
                );

                const passwordValid =
                    accountPassword.length >= 8 &&
                    /[A-Z]/.test(accountPassword) &&
                    /\d/.test(accountPassword) &&
                    /[^A-Za-z0-9]/.test(accountPassword);

                if (!passwordValid) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error:
                                "Password must contain at least 8 characters, one uppercase letter, one number, and one special character.",
                        }),
                    };
                }

                const finalStaffName =
                    requestedStaffName || staff.staff_name || "Staff";
                const hashedPassword = await bcrypt.hash(
                    accountPassword,
                    10
                );

                try {
                    // The pending invitation already occupies one staff slot.
                    // Activating it changes the existing row from pending -> active,
                    // so it must NOT consume a second plan slot.
                    //
                    // We still validate with increment 0 so a downgrade or other
                    // plan change that leaves current usage above the limit can
                    // correctly block activation.
                    await assertPlanLimit(
                        connection,
                        Number(staff.store_id),
                        "staff",
                        0,
                        "staff"
                    );
                } catch (limitError) {
                    return {
                        statusCode: limitError?.statusCode || 409,
                        headers,
                        body: JSON.stringify({
                            error: limitError?.message || "Plan limit reached.",
                            code: limitError?.code || "STAFF_LIMIT_REACHED",
                            plan_name: limitError?.plan_name,
                            current: limitError?.current,
                            limit: limitError?.limit,
                        }),
                    };
                }

                const [result] = await connection.execute(
                    `UPDATE staff
                     SET staff_name = ?,
                         password = ?,
                         status = 'active',
                         invite_token = NULL
                     WHERE id = ?
                       AND invite_token = ?
                       AND staff_email = ?
                       AND status = 'pending'`,
                    [
                        finalStaffName,
                        hashedPassword,
                        staff.staff_id,
                        inviteToken,
                        staff.staff_email,
                    ]
                );

                if (result.affectedRows === 0) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Invitation not found or already accepted.",
                        }),
                    };
                }

                await ensureStaffInviteOtpsTable(connection);
                await connection.execute(
                    `UPDATE staff_invite_otps
                     SET used = 1,
                         verified_at = NULL
                     WHERE invite_token_hash = ?
                       AND email = ?`,
                    [
                        hashInviteToken(inviteToken),
                        staff.staff_email,
                    ]
                );

                const sessionToken = jwt.sign(
                    {
                        staff_id: staff.staff_id,
                        manager_id: staff.manager_id,
                        store_id: staff.store_id,
                        branch_id: staff.branch_id,
                        email: staff.staff_email,
                        role: "staff",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Staff account activated successfully.",
                        token: sessionToken,
                        staff_id: staff.staff_id,
                        staff_name: finalStaffName,
                        staff_email: staff.staff_email,
                        manager_id: staff.manager_id,
                        manager_name: staff.manager_name,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        role: "staff",
                        status: "active",
                        permissions: staff.permissions,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to activate the staff account.",
                    }),
                };
            }
        }

        // GET STAFF BY MANAGER BRANCH
        if (action === "get_staff") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only managers can view branch staff" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;

            const [managerRows] = await connection.execute(
                `SELECT permissions
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                typeof managerRows[0].permissions === "string"
                    ? JSON.parse(managerRows[0].permissions || "{}")
                    : managerRows[0].permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to view staff",
                    }),
                };
            }

            const [staffRows] = await connection.execute(
                `SELECT
                     id,
                     staff_name,
                     staff_email,
                     status,
                     permissions,
                     invite_token,
                     NULL AS created_at
                 FROM staff
                 WHERE store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?
                 ORDER BY id DESC`,
                [storeId, branchId, managerId]
            );

            const staff = [];
            const pendingInvites = [];

            for (const row of staffRows) {
                const parsedPermissions =
                    typeof row.permissions === "string"
                        ? JSON.parse(row.permissions || "{}")
                        : row.permissions || {};

                if (
                    row.status === "active" ||
                    row.status === "inactive"
                ) {
                    staff.push({
                        id: row.id,
                        name: row.staff_name || "Unnamed staff",
                        email: row.staff_email || "",
                        status:
                            row.status === "inactive"
                                ? "Inactive"
                                : "Accepted",
                        permissions: parsedPermissions,
                    });
                } else if (row.status === "pending") {
                    pendingInvites.push({
                        id: row.id,
                        email: row.staff_email || "",
                        invitedAt: row.created_at || "Recently",
                        expiresAt: "7 days after invite",
                        status: "Pending",
                        permissions: parsedPermissions,
                    });
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    staff,
                    pending_invites: pendingInvites,
                }),
            };
        }

        // DEACTIVATE OR REACTIVATE STAFF
        if (
            action === "deactivate_staff" ||
            action === "reactivate_staff"
        ) {
            const authHeader =
                event.headers?.Authorization ||
                event.headers?.authorization ||
                "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Missing token",
                    }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Invalid token",
                    }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Only managers can update staff account status",
                    }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const staffId = Number(body.staff_id);
            const staffEmail = String(
                body.staff_email || ""
            )
                .trim()
                .toLowerCase();

            if (!staffId && !staffEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Missing staff id or email",
                    }),
                };
            }

            const [managerRows] =
                await connection.execute(
                    `SELECT permissions
                     FROM managers
                     WHERE id = ?
                       AND store_id = ?
                       AND branch_id = ?
                       AND status = 'active'
                         LIMIT 1`,
                    [managerId, storeId, branchId]
                );

            if (managerRows.length === 0) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Your manager account is not active",
                    }),
                };
            }

            const managerPermissions =
                typeof managerRows[0].permissions ===
                "string"
                    ? JSON.parse(
                        managerRows[0].permissions ||
                        "{}"
                    )
                    : managerRows[0].permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error:
                            "You do not have permission to update staff accounts",
                    }),
                };
            }

            const nextStatus =
                action === "reactivate_staff"
                    ? "active"
                    : "inactive";

            if (nextStatus === "active") {
                try {
                    // Re-activation consumes a staff seat too. This prevents
                    // an inactive account from being used to bypass the plan.
                    await assertPlanLimit(
                        connection,
                        Number(storeId),
                        "staff",
                        1,
                        decoded.role
                    );
                } catch (limitError) {
                    return {
                        statusCode: limitError?.statusCode || 409,
                        headers,
                        body: JSON.stringify({
                            error: limitError?.message || "Plan limit reached.",
                            code: limitError?.code || "STAFF_LIMIT_REACHED",
                            plan_name: limitError?.plan_name,
                            current: limitError?.current,
                            limit: limitError?.limit,
                        }),
                    };
                }
            }

            let result;

            if (staffId) {
                [result] = await connection.execute(
                    `UPDATE staff
                     SET status = ?
                     WHERE id = ?
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?
                       AND status IN ('active', 'inactive')`,
                    [
                        nextStatus,
                        staffId,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            } else {
                [result] = await connection.execute(
                    `UPDATE staff
                     SET status = ?
                     WHERE staff_email = ?
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?
                       AND status IN ('active', 'inactive')`,
                    [
                        nextStatus,
                        staffEmail,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            }

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Staff account was not found or is still pending activation",
                    }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message:
                        nextStatus === "active"
                            ? "Staff account reactivated successfully"
                            : "Staff account deactivated successfully",
                    staff_status: nextStatus,
                    staff_updated: result.affectedRows,
                }),
            };
        }

        // UPDATE STAFF PERMISSIONS
        if (action === "update_staff_permissions") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only managers can update staff access" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const { staff_id, staff_email, permissions = {} } = body;

            if (!staff_id && !staff_email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing staff id or email" }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT permissions
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                typeof managerRows[0].permissions === "string"
                    ? JSON.parse(managerRows[0].permissions || "{}")
                    : managerRows[0].permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to update staff access",
                    }),
                };
            }

            let result;

            if (staff_id) {
                [result] = await connection.execute(
                    `UPDATE staff
                     SET permissions = ?
                     WHERE id = ?
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?`,
                    [
                        JSON.stringify(permissions || {}),
                        staff_id,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            } else {
                [result] = await connection.execute(
                    `UPDATE staff
                     SET permissions = ?
                     WHERE staff_email = ?
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?`,
                    [
                        JSON.stringify(permissions || {}),
                        staff_email,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            }

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Staff not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Staff permissions updated successfully",
                    staff_updated: result.affectedRows,
                }),
            };
        }

        // RESEND STAFF INVITE
        if (action === "resend_staff_invite") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only managers can resend staff invites",
                    }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const staffEmail = String(body.staff_email || "")
                .trim()
                .toLowerCase();

            if (!staffEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing staff email" }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.permissions,
                     managers.manager_name,
                     branches.branch_name,
                     stores.store_name
                 FROM managers
                          JOIN branches
                               ON branches.id = managers.branch_id
                                   AND branches.store_id = managers.store_id
                          JOIN stores
                               ON stores.id = managers.store_id
                 WHERE managers.id = ?
                   AND managers.store_id = ?
                   AND managers.branch_id = ?
                   AND managers.status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const manager = managerRows[0];

            const managerPermissions =
                typeof manager.permissions === "string"
                    ? JSON.parse(manager.permissions || "{}")
                    : manager.permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to resend staff invites",
                    }),
                };
            }

            const [staffRows] = await connection.execute(
                `SELECT
                     id,
                     staff_name,
                     staff_email,
                     status,
                     permissions
                 FROM staff
                 WHERE staff_email = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?
                     LIMIT 1`,
                [staffEmail, storeId, branchId, managerId]
            );

            if (staffRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Pending staff invite not found",
                    }),
                };
            }

            const staff = staffRows[0];

            if (staff.status !== "pending") {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "This staff account is already accepted or inactive",
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: branchId,
                    manager_id: managerId,
                    email: staff.staff_email,
                    type: "staff_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const inviteLink =
                `${APP_BASE_URL}/accept-staff-invite?token=${encodeURIComponent(inviteToken)}`;

            await connection.execute(
                `UPDATE staff
                 SET invite_token = ?
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?`,
                [inviteToken, staff.id, storeId, branchId, managerId]
            );

            const staffPermissions =
                typeof staff.permissions === "string"
                    ? JSON.parse(staff.permissions || "{}")
                    : staff.permissions || {};

            const resendInvitation = {
                staff_email: staff.staff_email,
                staff_name: staff.staff_name,
                manager_name: manager.manager_name || "Branch Manager",
                store_name: manager.store_name || "StockNBook Store",
                branch_name: manager.branch_name || "Assigned Branch",
                invite_link: inviteLink,
                permissions: staffPermissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Staff",
                email: staff.staff_email,
                name: staff.staff_name,
                storeName: manager.store_name || "StockNBook Store",
                branchName: manager.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendStaffInvitationEmail(resendInvitation),
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Staff invitation emailed successfully."
                        : "The staff invitation link was refreshed, but the email could not be delivered. Copy the backup link or try Resend later.",
                    invite_link: inviteLink,
                    staff_email: staff.staff_email,
                    staff_name: staff.staff_name,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // ADD MANAGER TO AN EXISTING BRANCH
        if (action === "add_manager_to_branch") {
            const authHeader =
                event.headers?.Authorization ||
                event.headers?.authorization ||
                "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (
                decoded.role !== "owner" ||
                !decoded.store_id
            ) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Only the store owner can add a branch manager",
                    }),
                };
            }

            const storeId = Number(decoded.store_id);
            const branchId = Number(body.branch_id);
            const managerName = String(
                body.manager_name || ""
            ).trim();
            const managerEmail = String(
                body.manager_email || ""
            )
                .trim()
                .toLowerCase();

            const permissions =
                body.permissions &&
                typeof body.permissions === "object" &&
                !Array.isArray(body.permissions)
                    ? body.permissions
                    : {};

            if (!branchId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Select a branch",
                    }),
                };
            }

            if (!managerName) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Manager name is required",
                    }),
                };
            }

            if (
                !managerEmail ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                    managerEmail
                )
            ) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Enter a valid manager email address",
                    }),
                };
            }

            const [branchRows] = await connection.execute(
                `SELECT
                     branches.id,
                     branches.branch_name,
                     stores.store_name
                 FROM branches
                          JOIN stores
                               ON stores.id = branches.store_id
                 WHERE branches.id = ?
                   AND branches.store_id = ?
                     LIMIT 1`,
                [branchId, storeId]
            );

            if (branchRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error:
                            "The selected branch was not found",
                    }),
                };
            }

            const branch = branchRows[0];

            const [branchManagerRows] =
                await connection.execute(
                    `SELECT id
                     FROM managers
                     WHERE branch_id = ?
                       AND store_id = ?
                         LIMIT 1`,
                    [branchId, storeId]
                );

            if (branchManagerRows.length > 0) {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({
                        error:
                            "This branch already has an assigned or pending manager",
                    }),
                };
            }

            const [existingEmailRows] =
                await connection.execute(
                    `SELECT id
                     FROM managers
                     WHERE manager_email = ?
                       AND store_id = ?
                         LIMIT 1`,
                    [managerEmail, storeId]
                );

            if (existingEmailRows.length > 0) {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({
                        error:
                            "This email is already assigned to a manager in your store",
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: branchId,
                    email: managerEmail,
                    type: "manager_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const inviteLink =
                `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(
                    inviteToken
                )}`;

            const [managerResult] =
                await connection.execute(
                    `INSERT INTO managers
                     (
                         store_id,
                         branch_id,
                         manager_name,
                         manager_email,
                         invite_token,
                         permissions,
                         status
                     )
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        storeId,
                        branchId,
                        managerName,
                        managerEmail,
                        inviteToken,
                        JSON.stringify(permissions),
                        "pending",
                    ]
                );

            const invitation = {
                manager_email: managerEmail,
                manager_name: managerName,
                store_name:
                    branch.store_name ||
                    "StockNBook Store",
                branch_name:
                    branch.branch_name ||
                    "Assigned Branch",
                invite_link: inviteLink,
                permissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Manager",
                email: managerEmail,
                name: managerName,
                storeName: branch.store_name || "StockNBook Store",
                branchName: branch.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendManagerInvitationEmail(invitation),
            });

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Manager added and invitation email sent successfully."
                        : "Manager added successfully, but the invitation email could not be delivered. Copy the backup invite link or use Resend later.",
                    manager: {
                        id: managerResult.insertId,
                        name: managerName,
                        email: managerEmail,
                        branch:
                            branch.branch_name ||
                            "No branch assigned",
                        status: "pending",
                        permissions,
                    },
                    invite_link: inviteLink,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // RESEND MANAGER INVITATION
        if (action === "resend_manager_invite") {
            const token = getBearerTokenFromEvent(event);

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can resend a manager invitation.",
                    }),
                };
            }

            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);
            const managerEmail = String(body.manager_email || "")
                .trim()
                .toLowerCase();

            if ((!Number.isInteger(managerId) || managerId <= 0) && !managerEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Select a pending manager invitation to resend.",
                    }),
                };
            }

            const whereClause =
                Number.isInteger(managerId) && managerId > 0
                    ? "managers.id = ?"
                    : "LOWER(managers.manager_email) = ?";

            const lookupValue =
                Number.isInteger(managerId) && managerId > 0
                    ? managerId
                    : managerEmail;

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.id,
                     managers.manager_name,
                     managers.manager_email,
                     managers.permissions,
                     managers.status,
                     managers.branch_id,
                     branches.branch_name,
                     stores.store_name
                 FROM managers
                          JOIN branches
                               ON branches.id = managers.branch_id
                                   AND branches.store_id = managers.store_id
                          JOIN stores
                               ON stores.id = managers.store_id
                 WHERE managers.store_id = ?
                   AND ${whereClause}
                     LIMIT 1`,
                [storeId, lookupValue]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Pending manager invitation not found.",
                    }),
                };
            }

            const manager = managerRows[0];

            if (String(manager.status || "").toLowerCase() !== "pending") {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({
                        error: "Only pending manager invitations can be resent.",
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: manager.branch_id,
                    email: manager.manager_email,
                    type: "manager_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            const inviteLink =
                `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

            await connection.execute(
                `UPDATE managers
                 SET invite_token = ?
                 WHERE id = ?
                   AND store_id = ?
                   AND status = 'pending'`,
                [inviteToken, manager.id, storeId]
            );

            const permissions =
                typeof manager.permissions === "string"
                    ? JSON.parse(manager.permissions || "{}")
                    : manager.permissions || {};

            const invitation = {
                manager_email: manager.manager_email,
                manager_name: manager.manager_name,
                store_name: manager.store_name || "StockNBook Store",
                branch_name: manager.branch_name || "Assigned Branch",
                invite_link: inviteLink,
                permissions,
            };

            const delivery = await deliverInvitationEmail({
                role: "Manager",
                email: manager.manager_email,
                name: manager.manager_name,
                storeName: manager.store_name || "StockNBook Store",
                branchName: manager.branch_name || "Assigned Branch",
                inviteLink,
                send: () => sendManagerInvitationEmail(invitation),
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: delivery.email_sent
                        ? "Manager invitation emailed successfully."
                        : "The manager invitation link was refreshed, but the email could not be delivered. Copy the backup link or try Resend later.",
                    manager_id: Number(manager.id),
                    manager_email: manager.manager_email,
                    manager_name: manager.manager_name,
                    invite_link: inviteLink,
                    email_sent: delivery.email_sent,
                    email_status: delivery.email_status,
                    email_error: delivery.email_error,
                }),
            };
        }

        // GET BRANCH MANAGERS
        if (action === "get_branch_managers") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (!decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only store owners can view branch managers" }),
                };
            }

            const storeId = decoded.store_id;

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.id,
                     managers.manager_name AS name,
                     managers.manager_email AS email,
                     managers.status,
                     managers.permissions,
                     branches.branch_name AS branch
                 FROM managers
                          JOIN branches ON managers.branch_id = branches.id
                 WHERE managers.store_id = ?
                 ORDER BY branches.branch_name ASC, managers.manager_name ASC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    managers: managerRows.map((manager) => ({
                        id: manager.id,
                        name: manager.name || "Unnamed manager",
                        email: manager.email || "",
                        branch: manager.branch || "No branch assigned",
                        status: manager.status || "pending",
                        permissions:
                            typeof manager.permissions === "string"
                                ? JSON.parse(manager.permissions || "{}")
                                : manager.permissions || {},
                    })),
                }),
            };
        }

        // GET BRANCHES
        if (action === "get_branches") {
            await ensureBranchOperationalColumns(connection);

            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;

            if (!storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Missing store access" }),
                };
            }

            const [branchRows] = await connection.execute(
                `SELECT
                     branches.id,
                     branches.branch_name,
                     branches.contact_number,
                     branches.address,
                     COALESCE(branches.status, 'active') AS branch_status,
                     COALESCE(branches.inactive_reason, '') AS inactive_reason,
                     COALESCE(managers.manager_name, '') AS manager_name,
                     COALESCE(managers.manager_email, '') AS manager_email,
                     COALESCE(managers.status, 'setup_pending') AS manager_status,
                     managers.permissions,
                     COUNT(
                             DISTINCT CASE
                                          WHEN staff.status = 'active' THEN staff.id
                                          ELSE NULL
                         END
                     ) AS staff_count
                 FROM branches
                          LEFT JOIN managers ON managers.branch_id = branches.id
                          LEFT JOIN staff ON staff.branch_id = branches.id
                 WHERE branches.store_id = ?
                 GROUP BY
                     branches.id,
                     branches.branch_name,
                     branches.contact_number,
                     branches.address,
                     branches.status,
                     branches.inactive_reason,
                     managers.manager_name,
                     managers.manager_email,
                     managers.status,
                     managers.permissions
                 ORDER BY branches.id ASC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    branches: branchRows.map((branch) => ({
                        id: branch.id,
                        branch_name: branch.branch_name,
                        contact_number: branch.contact_number || "",
                        address: branch.address || "",
                        branch_status:
                            branch.branch_status || "active",
                        status:
                            branch.branch_status || "active",
                        inactive_reason:
                            branch.inactive_reason || "",
                        branch_inactive_reason:
                            branch.inactive_reason || "",
                        manager_name: branch.manager_name || "",
                        manager_email: branch.manager_email || "",
                        manager_status: branch.manager_status || "setup_pending",
                        staff_count: Number(branch.staff_count || 0),
                        revenue: 0,
                        bookings: 0,
                        permissions:
                            typeof branch.permissions === "string"
                                ? JSON.parse(branch.permissions || "{}")
                                : branch.permissions || {},
                    }))
                }),
            };
        }

        // UPDATE BRANCH
        if (action === "update_branch") {
            await ensureBranchOperationalColumns(connection);

            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;

            // Only the store owner may change branch details or manager permissions.
            if (decoded.role !== "owner" || !storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only the store owner can update branches." }),
                };
            }

            const {
                branch_id,
                branch_name,
                contact_number,
                address,
                status,
                branch_status,
                inactive_reason,
                branch_inactive_reason,
                manager_name,
                manager_email,
                permissions = {},
            } = body;

            if (!branch_id || !branch_name) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing branch id or branch name" }),
                };
            }

            const normalizedBranchStatus = String(
                status || branch_status || "active"
            )
                .trim()
                .toLowerCase();

            const normalizedInactiveReason =
                normalizedBranchStatus === "inactive"
                    ? String(
                        inactive_reason ||
                        branch_inactive_reason ||
                        ""
                    ).trim()
                    : "";

            if (
                normalizedBranchStatus !== "active" &&
                normalizedBranchStatus !== "inactive"
            ) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Branch status must be active or inactive",
                    }),
                };
            }

            if (
                normalizedBranchStatus === "inactive" &&
                !normalizedInactiveReason
            ) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error:
                            "Select a reason before marking the branch inactive",
                    }),
                };
            }

            await connection.beginTransaction();

            try {
                const [branchResult] = await connection.execute(
                    `UPDATE branches
                     SET branch_name = ?,
                         contact_number = ?,
                         address = ?,
                         status = ?,
                         inactive_reason = ?
                     WHERE id = ?
                       AND store_id = ?`,
                    [
                        branch_name,
                        contact_number || null,
                        address || null,
                        normalizedBranchStatus,
                        normalizedInactiveReason || null,
                        branch_id,
                        storeId,
                    ]
                );

                if (branchResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Branch not found" }),
                    };
                }

                const [managerResult] = await connection.execute(
                    `UPDATE managers
                     SET manager_name = ?,
                         manager_email = ?,
                         permissions = ?
                     WHERE branch_id = ?
                       AND store_id = ?`,
                    [
                        manager_name || null,
                        manager_email || null,
                        JSON.stringify(permissions || {}),
                        branch_id,
                        storeId,
                    ]
                );

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Branch updated successfully",
                        branch_updated: branchResult.affectedRows,
                        manager_updated: managerResult.affectedRows,
                        branch_status: normalizedBranchStatus,
                        inactive_reason:
                        normalizedInactiveReason,
                        saved_permissions: permissions,
                    }),
                };
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: err.message }),
                };
            }
        }

// DELETE BRANCH
        if (action === "delete_branch") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;
            const { branch_id } = body;

            // Branch deletion also removes assigned employees: owner approval is required.
            if (decoded.role !== "owner" || !storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only the store owner can delete branches." }),
                };
            }

            if (!branch_id) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing store or branch id" }),
                };
            }

            await connection.beginTransaction();

            try {
                await connection.execute(
                    `DELETE FROM staff
                     WHERE branch_id = ?
                       AND store_id = ?`,
                    [branch_id, storeId]
                );

                await connection.execute(
                    `DELETE FROM managers
                     WHERE branch_id = ?
                       AND store_id = ?`,
                    [branch_id, storeId]
                );

                const [branchResult] = await connection.execute(
                    `DELETE FROM branches
                     WHERE id = ?
                       AND store_id = ?`,
                    [branch_id, storeId]
                );

                if (branchResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Branch not found" }),
                    };
                }

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Branch deleted successfully",
                    }),
                };
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: err.message }),
                };
            }
        }

        // GET CURRENT USER
        if (action === "get_current_user") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            // Platform administrator sessions do not belong to a store.
            // Return the admin identity directly so the dashboard's
            // get_current_user check succeeds instead of treating the token
            // as an invalid/unknown role and redirecting to the landing page.
            if (decoded.role === "PLATFORM_ADMIN") {
                const platformAdminId = Number(decoded.platform_admin_id);

                if (!platformAdminId) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({ error: "Invalid platform admin token" }),
                    };
                }

                const [adminRows] = await connection.execute(
                    `SELECT
                         platform_admin_id,
                         full_name,
                         email,
                         role,
                         status,
                         is_active
                     FROM platform_admins
                     WHERE platform_admin_id = ?
                         LIMIT 1`,
                    [platformAdminId]
                );

                if (!adminRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Platform administrator not found" }),
                    };
                }

                const admin = adminRows[0];
                const adminStatus = String(admin.status || "")
                    .trim()
                    .toLowerCase();

                if (adminStatus !== "active" || Number(admin.is_active) !== 1) {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Platform administrator account is inactive.",
                            code: "ACCOUNT_INACTIVE",
                        }),
                    };
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "PLATFORM_ADMIN",
                        platform_admin_id: admin.platform_admin_id,
                        full_name: admin.full_name,
                        email: admin.email,
                    }),
                };
            }

            if (decoded.role === "owner") {
                const [storeRows] = await connection.execute(
                    `SELECT id, store_name, owner_name, email, slug
                     FROM stores
                     WHERE id = ?
                         LIMIT 1`,
                    [decoded.store_id]
                );

                if (!storeRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Owner store not found" }),
                    };
                }

                const store = storeRows[0];



                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "owner",
                        store_id: store.id,
                        store_name: store.store_name,
                        store_slug: store.slug,
                        owner_name: store.owner_name,
                        email: store.email,
                    }),
                };
            }

            if (decoded.role === "manager") {
                const [managerRows] = await connection.execute(
                    `SELECT
                         managers.id,
                         managers.manager_name,
                         managers.manager_email,
                         managers.permissions,
                         managers.status,
                         managers.store_id,
                         managers.branch_id,
                         branches.branch_name,
                         stores.store_name
                     FROM managers
                              JOIN branches ON managers.branch_id = branches.id
                              JOIN stores ON managers.store_id = stores.id
                     WHERE managers.id = ?
                       AND managers.store_id = ?
                       AND managers.branch_id = ?
                         LIMIT 1`,
                    [decoded.manager_id, decoded.store_id, decoded.branch_id]
                );

                if (!managerRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Manager not found" }),
                    };
                }

                const manager = managerRows[0];

                if (manager.status !== "active") {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Account deactivated",
                            code: "ACCOUNT_DEACTIVATED",
                            message:
                                "Your branch manager account has been deactivated. Please contact the store owner if you think this was a mistake.",
                        }),
                    };
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "manager",
                        manager_id: manager.id,
                        manager_name: manager.manager_name,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        permissions:
                            typeof manager.permissions === "string"
                                ? JSON.parse(manager.permissions || "{}")
                                : manager.permissions || {},
                    }),
                };
            }

            if (decoded.role === "staff") {
                const [staffRows] = await connection.execute(
                    `SELECT
                         staff.id,
                         staff.staff_name,
                         staff.staff_email,
                         staff.permissions,
                         staff.store_id,
                         staff.branch_id,
                         staff.manager_id,
                         branches.branch_name,
                         stores.store_name
                     FROM staff
                              JOIN branches ON staff.branch_id = branches.id
                              JOIN stores ON staff.store_id = stores.id
                     WHERE staff.id = ?
                       AND staff.store_id = ?
                       AND staff.branch_id = ?
                       AND staff.status = 'active'
                         LIMIT 1`,
                    [decoded.staff_id, decoded.store_id, decoded.branch_id]
                );

                if (!staffRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Staff not found" }),
                    };
                }

                const staff = staffRows[0];

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "staff",
                        staff_id: staff.id,
                        staff_name: staff.staff_name,
                        staff_email: staff.staff_email,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        manager_id: staff.manager_id,
                        permissions:
                            typeof staff.permissions === "string"
                                ? JSON.parse(staff.permissions || "{}")
                                : staff.permissions || {},
                    }),
                };
            }

            // DEACTIVATE MANAGER


            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Invalid role" }),
            };
        }
        // DELETE MANAGER ACCOUNT
        if (action === "delete_manager") {
            const authHeader =
                event.headers?.Authorization ||
                event.headers?.authorization ||
                "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Missing token",
                    }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: "Invalid token",
                    }),
                };
            }

            if (decoded.role !== "owner") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only owners can delete managers",
                    }),
                };
            }

            const storeId = Number(decoded.store_id);
            const managerId = Number(body.manager_id);

            if (!storeId || !managerId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Missing manager id",
                    }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT id, branch_id, manager_name, manager_email
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                     LIMIT 1`,
                [managerId, storeId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({
                        error: "Manager not found",
                    }),
                };
            }

            await connection.beginTransaction();

            try {
                // Staff accounts belong to this manager through staff.manager_id.
                // Remove them first so the manager can be deleted cleanly and
                // no staff account remains attached to a deleted manager.
                const [staffDeleteResult] = await connection.execute(
                    `DELETE FROM staff
                     WHERE manager_id = ?
                       AND store_id = ?`,
                    [managerId, storeId]
                );

                const [managerDeleteResult] = await connection.execute(
                    `DELETE FROM managers
                     WHERE id = ?
                       AND store_id = ?`,
                    [managerId, storeId]
                );

                if (managerDeleteResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Manager not found",
                        }),
                    };
                }

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Manager account deleted successfully",
                        manager_deleted: managerDeleteResult.affectedRows,
                        staff_deleted: staffDeleteResult.affectedRows,
                    }),
                };
            } catch (deleteError) {
                await connection.rollback();
                throw deleteError;
            }
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Invalid action" }),
        };
    } catch (err) {
        console.error("[stocknbook-auth] Error:", {
            action,
            message: err?.message,
            code: err?.code,
            stack: err?.stack,
        });

        return {
            statusCode: Number(err?.statusCode) || 500,
            headers,
            body: JSON.stringify({
                error: err?.message || "Internal server error",
                code: err?.code || "UNKNOWN_ERROR",
            }),
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
};