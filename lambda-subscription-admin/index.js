// COMPATIBLE VERSION: your subscription_plans primary key is id,
// and the price column is monthly_price.
//
// lambda-subscription-admin/index.js
//
// Required environment variables:
// DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET
//
// Required npm packages:
// mysql2, jsonwebtoken

const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

// FIXED: Use fallback secret to match login and prevent token verification failures
const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";

const PAYMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

const MANUALLY_CHANGEABLE_SUBSCRIPTION_STATUSES = [
    "SUSPENDED",
    "ACTIVE",
    "CANCELLED",
];

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
    password: "020820@Steph",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

const pool = mysql.createPool(dbConfig);

function getOrigin(event) {
    const requestOrigin =
        event.headers?.origin ||
        event.headers?.Origin ||
        "";

    if (allowedOrigins.includes(requestOrigin)) {
        return requestOrigin;
    }

    return allowedOrigins[0] || "*";
}

function response(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": getOrigin(event),
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
    if (!event.body) {
        return {};
    }

    const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;

    try {
        return JSON.parse(rawBody);
    } catch {
        throw httpError(400, "Invalid JSON request body.");
    }
}

function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function requireNumber(value, label) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw httpError(
            400,
            `${label} must be a valid positive number.`
        );
    }

    return parsed;
}

function optionalTrimmedText(value, maxLength = 500) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function getBearerToken(headers = {}) {
    const value =
        headers.Authorization ||
        headers.authorization ||
        "";

    return value.replace(/^Bearer\s+/i, "").trim();
}

async function requirePlatformAdmin(event, connection) {
    const token = getBearerToken(event.headers);

    if (!token) {
        throw httpError(401, "Missing authorization token.");
    }

    let payload;

    try {
        // FIXED: Use JWT_SECRET fallback variable instead of strict process.env lookup
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        throw httpError(401, "Invalid or expired token.");
    }

    if (payload.role !== "PLATFORM_ADMIN") {
        throw httpError(
            403,
            "Platform Administrator access is required."
        );
    }

    const adminId = Number(
        payload.platform_admin_id ||
        payload.platformAdminId ||
        payload.user_id ||
        payload.id
    );

    if (!Number.isInteger(adminId) || adminId <= 0) {
        throw httpError(
            403,
            "Platform Administrator identity is missing."
        );
    }

    const [adminRows] = await connection.execute(
        `
            SELECT
                platform_admin_id,
                full_name,
                email,
                role,
                is_active
            FROM platform_admins
            WHERE platform_admin_id = ?
                LIMIT 1
        `,
        [adminId]
    );

    const admin = adminRows[0];

    if (
        !admin ||
        !admin.is_active ||
        admin.role !== "PLATFORM_ADMIN"
    ) {
        throw httpError(
            403,
            "Platform Administrator account is inactive."
        );
    }

    return admin;
}

function normalizeDateOnly(value) {
    if (!value) {
        return null;
    }

    const match = String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})/
    );

    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        throw httpError(400, "Invalid date value.");
    }

    return parsed.toISOString().slice(0, 10);
}

function todayDateOnly() {
    return new Date().toISOString().slice(0, 10);
}

function compareDateOnly(left, right) {
    return String(left).localeCompare(String(right));
}

function addMonthsSafely(dateOnly, months) {
    const [year, month, day] = String(dateOnly)
        .split("-")
        .map(Number);

    const totalMonthIndex = month - 1 + Number(months);
    const targetYear =
        year + Math.floor(totalMonthIndex / 12);

    const targetMonthIndex =
        ((totalMonthIndex % 12) + 12) % 12;

    const lastDayOfTargetMonth = new Date(
        Date.UTC(targetYear, targetMonthIndex + 1, 0)
    ).getUTCDate();

    const targetDay = Math.min(day, lastDayOfTargetMonth);

    return new Date(
        Date.UTC(targetYear, targetMonthIndex, targetDay)
    )
        .toISOString()
        .slice(0, 10);
}

function addDays(dateOnly, days) {
    const date = new Date(
        `${dateOnly}T00:00:00.000Z`
    );

    date.setUTCDate(date.getUTCDate() + Number(days));

    return date.toISOString().slice(0, 10);
}

function moneyToCents(value) {
    return Math.round(Number(value || 0) * 100);
}

async function getSubscriptionSummary(connection) {
    const [[paymentCounts]] = await connection.execute(`
        SELECT
            SUM(
                    CASE
                        WHEN status = 'PENDING' THEN 1
                        ELSE 0
                        END
            ) AS pending_verification,

            SUM(
                    CASE
                        WHEN status = 'APPROVED' THEN 1
                        ELSE 0
                        END
            ) AS approved_payments,

            SUM(
                    CASE
                        WHEN status = 'REJECTED' THEN 1
                        ELSE 0
                        END
            ) AS rejected_payments
        FROM payment_submissions
    `);

    const [[subscriptionCounts]] = await connection.execute(`
        SELECT
            SUM(
                    CASE
                        WHEN status = 'ACTIVE'
                            AND expiration_date >= CURDATE()
                            THEN 1
                        ELSE 0
                        END
            ) AS active_subscriptions,

            SUM(
                    CASE
                        WHEN status = 'ACTIVE'
                            AND expiration_date BETWEEN
                                 CURDATE()
                                 AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                            THEN 1
                        ELSE 0
                        END
            ) AS expiring_soon,

            SUM(
                    CASE
                        WHEN status = 'EXPIRED'
                            OR (
                                 status = 'ACTIVE'
                                     AND expiration_date IS NOT NULL
                                     AND expiration_date < CURDATE()
                                 )
                            THEN 1
                        ELSE 0
                        END
            ) AS expired_subscriptions
        FROM business_subscriptions
    `);

    return {
        pending_verification: Number(
            paymentCounts.pending_verification || 0
        ),
        active_subscriptions: Number(
            subscriptionCounts.active_subscriptions || 0
        ),
        expiring_soon: Number(
            subscriptionCounts.expiring_soon || 0
        ),
        expired_subscriptions: Number(
            subscriptionCounts.expired_subscriptions || 0
        ),
        approved_payments: Number(
            paymentCounts.approved_payments || 0
        ),
        rejected_payments: Number(
            paymentCounts.rejected_payments || 0
        ),
    };
}

async function listPaymentSubmissions(
    connection,
    status,
    search
) {
    const requestedStatus = String(
        status || "PENDING"
    ).toUpperCase();

    const filters = [];
    const values = [];

    if (requestedStatus !== "ALL") {
        if (!PAYMENT_STATUSES.includes(requestedStatus)) {
            throw httpError(
                400,
                "Invalid payment status filter."
            );
        }

        filters.push("ps.status = ?");
        values.push(requestedStatus);
    }

    const cleanSearch = optionalTrimmedText(search, 120);

    if (cleanSearch) {
        const likeValue = `%${cleanSearch}%`;

        filters.push(`
(
    ps.store_name_snapshot LIKE ?
    OR ps.owner_name_snapshot LIKE ?
    OR ps.reference_number LIKE ?
    OR ps.business_code_snapshot LIKE ?
)
`);

        values.push(
            likeValue,
            likeValue,
            likeValue,
            likeValue
        );
    }

    const whereClause = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

    const [rows] = await connection.execute(
        `
            SELECT
                ps.payment_submission_id,
                ps.business_id,
                ps.store_name_snapshot,
                ps.owner_name_snapshot,
                ps.business_code_snapshot,
                ps.current_plan_name_snapshot,
                ps.requested_plan_name_snapshot,
                ps.required_amount,
                ps.amount_submitted,
                ps.reference_number,
                ps.payment_date,
                ps.proof_file_url,
                ps.status,
                ps.submitted_at,
                ps.verified_at,
                ps.rejection_reason,
                ps.rejection_explanation,
                pa.full_name AS verified_by
            FROM payment_submissions ps
                     LEFT JOIN platform_admins pa
                               ON pa.platform_admin_id =
                                  ps.verified_by_admin_id
                ${whereClause}
            ORDER BY
                CASE ps.status
                WHEN 'PENDING' THEN 1
                WHEN 'APPROVED' THEN 2
                WHEN 'REJECTED' THEN 3
                ELSE 4
            END,
    ps.submitted_at DESC
        `,
        values
    );

    return rows;
}

async function getPaymentSubmission(
    connection,
    paymentSubmissionId
) {
    const [rows] = await connection.execute(
        `
            SELECT
                ps.*,
                pa.full_name AS verified_by,
                bs.subscription_id,
                bs.status AS subscription_status,
                bs.start_date,
                bs.expiration_date,
                sp.plan_name AS requested_plan_name,
                'MONTHLY' AS billing_period
            FROM payment_submissions ps
                     LEFT JOIN platform_admins pa
                               ON pa.platform_admin_id =
                                  ps.verified_by_admin_id
                     LEFT JOIN business_subscriptions bs
                               ON bs.business_id = ps.business_id
                     LEFT JOIN subscription_plans sp
                               ON sp.id = ps.requested_plan_id
            WHERE ps.payment_submission_id = ?
                LIMIT 1
        `,
        [paymentSubmissionId]
    );

    if (!rows[0]) {
        throw httpError(
            404,
            "Payment submission not found."
        );
    }

    return rows[0];
}

async function getBusinessSubscription(connection, businessId) {
    const [subscriptionRows] = await connection.execute(
        `
            SELECT
                bs.subscription_id,
                bs.business_id,
                bs.status,
                bs.start_date,
                bs.expiration_date,
                sp.id AS plan_id,
                sp.plan_name,
                sp.monthly_price AS price,
                'MONTHLY' AS billing_period,
                0 AS inventory_limit,
                sp.booking_limit AS monthly_booking_limit,
                0 AS staff_limit,
                0 AS reports_enabled,
                0 AS analytics_enabled,
                0 AS forecasting_enabled
            FROM business_subscriptions bs
                     INNER JOIN subscription_plans sp
                                ON sp.id = bs.plan_id
            WHERE bs.business_id = ?
                LIMIT 1
        `,
        [businessId]
    );

    const subscription = subscriptionRows[0] || null;

    const [latestPaymentRows] = await connection.execute(
        `
            SELECT
                ps.payment_submission_id,
                ps.status,
                ps.reference_number,
                ps.requested_plan_name_snapshot,
                ps.submitted_at,
                ps.verified_at,
                ps.rejection_reason,
                pa.full_name AS verified_by
            FROM payment_submissions ps
                     LEFT JOIN platform_admins pa
                               ON pa.platform_admin_id =
                                  ps.verified_by_admin_id
            WHERE ps.business_id = ?
            ORDER BY ps.submitted_at DESC
                LIMIT 1
        `,
        [businessId]
    );

    return {
        subscription,
        latest_payment: latestPaymentRows[0] || null,
    };
}

async function listBusinesses(connection, search) {
    const cleanSearch = optionalTrimmedText(search, 120);
    const values = [];
    let searchFilter = "";

    if (cleanSearch) {
        const likeValue = `%${cleanSearch}%`;

        searchFilter = `
WHERE (
    latest_payment.store_name_snapshot LIKE ?
    OR latest_payment.owner_name_snapshot LIKE ?
    OR latest_payment.business_code_snapshot LIKE ?
)
`;

        values.push(likeValue, likeValue, likeValue);
    }

    const [rows] = await connection.execute(
        `
            SELECT
                latest_payment.business_id,
                latest_payment.store_name_snapshot,
                latest_payment.owner_name_snapshot,
                latest_payment.business_code_snapshot,
                bs.subscription_id,
                bs.status AS subscription_status,
                bs.start_date,
                bs.expiration_date,
                sp.plan_name,
                latest_payment.status AS latest_payment_status,
                latest_payment.reference_number AS latest_reference_number,
                latest_payment.verified_at,
                pa.full_name AS verified_by
            FROM (
                     SELECT ps1.*
                     FROM payment_submissions ps1
                              INNER JOIN (
                         SELECT
                             business_id,
                             MAX(payment_submission_id)
                                 AS latest_payment_submission_id
                         FROM payment_submissions
                         GROUP BY business_id
                     ) latest
                                         ON latest.latest_payment_submission_id =
                                            ps1.payment_submission_id
                 ) latest_payment
                     LEFT JOIN business_subscriptions bs
                               ON bs.business_id = latest_payment.business_id
                     LEFT JOIN subscription_plans sp
                               ON sp.id = bs.plan_id
                     LEFT JOIN platform_admins pa
                               ON pa.platform_admin_id =
                                  latest_payment.verified_by_admin_id
                ${searchFilter}
            ORDER BY latest_payment.store_name_snapshot ASC
        `,
        values
    );

    return rows;
}

async function listAuditLogs(connection, businessId) {
    const filters = [];
    const values = [];

    if (businessId) {
        filters.push("sal.business_id = ?");
        values.push(
            requireNumber(businessId, "business_id")
        );
    }

    const whereClause = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

    const [rows] = await connection.execute(
        `
            SELECT
                sal.audit_log_id,
                sal.business_id,
                sal.subscription_id,
                sal.payment_submission_id,
                sal.action,
                sal.previous_status,
                sal.new_status,
                sal.reason,
                sal.created_at,
                pa.full_name AS performed_by
            FROM subscription_audit_logs sal
                     LEFT JOIN platform_admins pa
                               ON pa.platform_admin_id =
                                  sal.performed_by_admin_id
                ${whereClause}
            ORDER BY sal.created_at DESC
                LIMIT 200
        `,
        values
    );

    return rows;
}

async function approvePaymentSubmission(
    connection,
    paymentSubmissionId,
    admin
) {
    await connection.beginTransaction();

    try {
        const [paymentRows] = await connection.execute(
            `
                SELECT *
                FROM payment_submissions
                WHERE payment_submission_id = ?
                    FOR UPDATE
            `,
            [paymentSubmissionId]
        );

        const payment = paymentRows[0];

        if (!payment) {
            throw httpError(
                404,
                "Payment submission not found."
            );
        }

        if (payment.status !== "PENDING") {
            throw httpError(
                409,
                "Only pending payments can be approved."
            );
        }

        if (
            moneyToCents(payment.amount_submitted) !==
            moneyToCents(payment.required_amount)
        ) {
            throw httpError(
                409,
                "Submitted amount does not match the required payment amount."
            );
        }

        const [duplicateReferenceRows] =
            await connection.execute(
                `
                    SELECT payment_submission_id
                    FROM payment_submissions
                    WHERE reference_number = ?
                      AND status = 'APPROVED'
                      AND payment_submission_id <> ?
                        LIMIT 1
                `,
                [
                    payment.reference_number,
                    paymentSubmissionId,
                ]
            );

        if (duplicateReferenceRows.length > 0) {
            throw httpError(
                409,
                "This reference number is already used by an approved payment."
            );
        }

        const [subscriptionRows] = await connection.execute(
            `
                SELECT *
                FROM business_subscriptions
                WHERE business_id = ?
                    FOR UPDATE
            `,
            [payment.business_id]
        );

        const existingSubscription =
            subscriptionRows[0] || null;

        const approvalDate = todayDateOnly();

        const isPlanChange =
            !existingSubscription ||
            Number(existingSubscription.plan_id) !==
            Number(payment.requested_plan_id);

        let startDate;
        let expirationDate;
        let subscriptionId;

        const previousStatus =
            existingSubscription?.status || "FREE";

        if (isPlanChange) {
            startDate = approvalDate;
            expirationDate = addMonthsSafely(
                approvalDate,
                1
            );
        } else if (
            existingSubscription.status === "ACTIVE" &&
            existingSubscription.expiration_date &&
            compareDateOnly(
                normalizeDateOnly(
                    existingSubscription.expiration_date
                ),
                approvalDate
            ) >= 0
        ) {
            startDate = normalizeDateOnly(
                existingSubscription.start_date
            );

            expirationDate = addMonthsSafely(
                normalizeDateOnly(
                    existingSubscription.expiration_date
                ),
                1
            );
        } else {
            startDate = approvalDate;
            expirationDate = addMonthsSafely(
                approvalDate,
                1
            );
        }

        if (existingSubscription) {
            await connection.execute(
                `
                    UPDATE business_subscriptions
                    SET
                        plan_id = ?,
                        status = 'ACTIVE',
                        start_date = ?,
                        expiration_date = ?,
                        updated_at = NOW()
                    WHERE subscription_id = ?
                `,
                [
                    payment.requested_plan_id,
                    startDate,
                    expirationDate,
                    existingSubscription.subscription_id,
                ]
            );

            subscriptionId =
                existingSubscription.subscription_id;
        } else {
            const [insertResult] = await connection.execute(
                `
                    INSERT INTO business_subscriptions (
                        business_id,
                        plan_id,
                        status,
                        start_date,
                        expiration_date
                    )
                    VALUES (?, ?, 'ACTIVE', ?, ?)
                `,
                [
                    payment.business_id,
                    payment.requested_plan_id,
                    startDate,
                    expirationDate,
                ]
            );

            subscriptionId = insertResult.insertId;
        }

        await connection.execute(
            `
                UPDATE payment_submissions
                SET
                    status = 'APPROVED',
                    verified_by_admin_id = ?,
                    verified_at = NOW(),
                    rejection_reason = NULL,
                    rejection_explanation = NULL,
                    updated_at = NOW()
                WHERE payment_submission_id = ?
            `,
            [admin.platform_admin_id, paymentSubmissionId]
        );

        await connection.execute(
            `
                INSERT INTO subscription_audit_logs (
                    business_id,
                    subscription_id,
                    payment_submission_id,
                    action,
                    previous_status,
                    new_status,
                    performed_by_admin_id,
                    reason
                )
                VALUES (?, ?, ?, 'PAYMENT_APPROVED', ?, 'ACTIVE', ?, ?)
            `,
            [
                payment.business_id,
                subscriptionId,
                paymentSubmissionId,
                previousStatus,
                admin.platform_admin_id,
                `Approved ${payment.requested_plan_name_snapshot} plan payment.`,
            ]
        );

        await connection.execute(
            `
                INSERT INTO subscription_notifications (
                    business_id,
                    recipient_role,
                    notification_type,
                    title,
                    message,
                    related_payment_submission_id
                )
                VALUES (?, 'OWNER', 'PAYMENT_APPROVED', ?, ?, ?)
            `,
            [
                payment.business_id,
                "Payment Approved",
                `The ${payment.requested_plan_name_snapshot} Plan has been activated for ${payment.store_name_snapshot}. Start Date: ${startDate}. Expiration Date: ${expirationDate}.`,
                paymentSubmissionId,
            ]
        );

        await connection.commit();

        return {
            message: "Payment Approved",
            store_name: payment.store_name_snapshot,
            plan_name: payment.requested_plan_name_snapshot,
            start_date: startDate,
            expiration_date: expirationDate,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function rejectPaymentSubmission(
    connection,
    paymentSubmissionId,
    admin,
    rejectionReason,
    rejectionExplanation
) {
    if (!REJECTION_REASONS.includes(rejectionReason)) {
        throw httpError(
            400,
            "Select a valid rejection reason."
        );
    }

    await connection.beginTransaction();

    try {
        const [paymentRows] = await connection.execute(
            `
                SELECT *
                FROM payment_submissions
                WHERE payment_submission_id = ?
                    FOR UPDATE
            `,
            [paymentSubmissionId]
        );

        const payment = paymentRows[0];

        if (!payment) {
            throw httpError(
                404,
                "Payment submission not found."
            );
        }

        if (payment.status !== "PENDING") {
            throw httpError(
                409,
                "Only pending payments can be rejected."
            );
        }

        await connection.execute(
            `
                UPDATE payment_submissions
                SET
                    status = 'REJECTED',
                    verified_by_admin_id = ?,
                    verified_at = NOW(),
                    rejection_reason = ?,
                    rejection_explanation = ?,
                    updated_at = NOW()
                WHERE payment_submission_id = ?
            `,
            [
                admin.platform_admin_id,
                rejectionReason,
                rejectionExplanation || null,
                paymentSubmissionId,
            ]
        );

        await connection.execute(
            `
                INSERT INTO subscription_audit_logs (
                    business_id,
                    payment_submission_id,
                    action,
                    previous_status,
                    new_status,
                    performed_by_admin_id,
                    reason
                )
                VALUES (?, ?, 'PAYMENT_REJECTED', 'PENDING', 'REJECTED', ?, ?)
            `,
            [
                payment.business_id,
                paymentSubmissionId,
                admin.platform_admin_id,
                [rejectionReason, rejectionExplanation]
                    .filter(Boolean)
                    .join(": "),
            ]
        );

        await connection.execute(
            `
                INSERT INTO subscription_notifications (
                    business_id,
                    recipient_role,
                    notification_type,
                    title,
                    message,
                    related_payment_submission_id
                )
                VALUES (?, 'OWNER', 'PAYMENT_REJECTED', ?, ?, ?)
            `,
            [
                payment.business_id,
                "Payment Verification Rejected",
                `Your payment for the ${payment.requested_plan_name_snapshot} Plan could not be verified. Reason: ${rejectionReason}. Submit a new payment proof to continue.`,
                paymentSubmissionId,
            ]
        );

        await connection.commit();

        return {
            message: "Payment Verification Rejected",
            store_name: payment.store_name_snapshot,
            reason: rejectionReason,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function changeSubscriptionStatus(
    connection,
    businessId,
    admin,
    nextStatus,
    reason
) {
    if (
        !MANUALLY_CHANGEABLE_SUBSCRIPTION_STATUSES.includes(
            nextStatus
        )
    ) {
        throw httpError(
            400,
            "Invalid subscription status action."
        );
    }

    if (!reason) {
        throw httpError(400, "A reason is required.");
    }

    await connection.beginTransaction();

    try {
        const [subscriptionRows] = await connection.execute(
            `
                SELECT *
                FROM business_subscriptions
                WHERE business_id = ?
                    FOR UPDATE
            `,
            [businessId]
        );

        const subscription = subscriptionRows[0];

        if (!subscription) {
            throw httpError(
                404,
                "Business subscription not found."
            );
        }

        const today = todayDateOnly();

        if (
            nextStatus === "ACTIVE" &&
            subscription.expiration_date &&
            compareDateOnly(
                normalizeDateOnly(subscription.expiration_date),
                today
            ) < 0
        ) {
            throw httpError(
                409,
                "An expired subscription must be renewed or extended before it can be reactivated."
            );
        }

        await connection.execute(
            `
                UPDATE business_subscriptions
                SET
                    status = ?,
                    updated_at = NOW()
                WHERE subscription_id = ?
            `,
            [nextStatus, subscription.subscription_id]
        );

        await connection.execute(
            `
                INSERT INTO subscription_audit_logs (
                    business_id,
                    subscription_id,
                    action,
                    previous_status,
                    new_status,
                    performed_by_admin_id,
                    reason
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                businessId,
                subscription.subscription_id,
                `SUBSCRIPTION_${nextStatus}`,
                subscription.status,
                nextStatus,
                admin.platform_admin_id,
                reason,
            ]
        );

        await connection.commit();

        return {
            message: `Subscription status changed to ${nextStatus}.`,
            status: nextStatus,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function extendSubscription(
    connection,
    businessId,
    admin,
    extensionDays,
    reason
) {
    const days = Number(extensionDays);

    if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw httpError(
            400,
            "extension_days must be from 1 to 365."
        );
    }

    if (!reason) {
        throw httpError(400, "A reason is required.");
    }

    await connection.beginTransaction();

    try {
        const [subscriptionRows] = await connection.execute(
            `
                SELECT *
                FROM business_subscriptions
                WHERE business_id = ?
                    FOR UPDATE
            `,
            [businessId]
        );

        const subscription = subscriptionRows[0];

        if (!subscription) {
            throw httpError(
                404,
                "Business subscription not found."
            );
        }

        const today = todayDateOnly();

        const baseDate =
            subscription.expiration_date &&
            compareDateOnly(
                normalizeDateOnly(subscription.expiration_date),
                today
            ) >= 0
                ? normalizeDateOnly(subscription.expiration_date)
                : today;

        const expirationDate = addDays(baseDate, days);

        await connection.execute(
            `
                UPDATE business_subscriptions
                SET
                    expiration_date = ?,
                    updated_at = NOW()
                WHERE subscription_id = ?
            `,
            [expirationDate, subscription.subscription_id]
        );

        await connection.execute(
            `
                INSERT INTO subscription_audit_logs (
                    business_id,
                    subscription_id,
                    action,
                    previous_status,
                    new_status,
                    performed_by_admin_id,
                    reason
                )
                VALUES (?, ?, 'SUBSCRIPTION_EXTENDED', ?, ?, ?, ?)
            `,
            [
                businessId,
                subscription.subscription_id,
                subscription.status,
                subscription.status,
                admin.platform_admin_id,
                `${days} day(s): ${reason}`,
            ]
        );

        await connection.commit();

        return {
            message: "Subscription extended.",
            expiration_date: expirationDate,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

exports.handler = async (event) => {
    let connection;

    try {
        if (getHttpMethod(event) === "OPTIONS") {
            return response(event, 204, {});
        }

        if (getHttpMethod(event) !== "POST") {
            return response(event, 405, {
                message: "Only POST requests are allowed.",
            });
        }

        const body = parseBody(event);
        const action = optionalTrimmedText(body.action, 80);

        if (!action) {
            throw httpError(400, "Missing action.");
        }

        connection = await pool.getConnection();

        const admin = await requirePlatformAdmin(
            event,
            connection
        );

        switch (action) {
            case "get_subscription_summary":
                return response(event, 200, {
                    summary: await getSubscriptionSummary(
                        connection
                    ),
                });

            case "list_payment_submissions":
                return response(event, 200, {
                    payments: await listPaymentSubmissions(
                        connection,
                        body.status,
                        body.search
                    ),
                });

            case "get_payment_submission":
                return response(event, 200, {
                    payment: await getPaymentSubmission(
                        connection,
                        requireNumber(
                            body.payment_submission_id,
                            "payment_submission_id"
                        )
                    ),
                });

            case "approve_payment_submission":
                return response(
                    event,
                    200,
                    await approvePaymentSubmission(
                        connection,
                        requireNumber(
                            body.payment_submission_id,
                            "payment_submission_id"
                        ),
                        admin
                    )
                );

            case "reject_payment_submission":
                return response(
                    event,
                    200,
                    await rejectPaymentSubmission(
                        connection,
                        requireNumber(
                            body.payment_submission_id,
                            "payment_submission_id"
                        ),
                        admin,
                        optionalTrimmedText(
                            body.rejection_reason,
                            100
                        ),
                        optionalTrimmedText(
                            body.rejection_explanation,
                            500
                        )
                    )
                );

            case "get_business_subscription":
                return response(event, 200, {
                    ...(await getBusinessSubscription(
                        connection,
                        requireNumber(
                            body.business_id,
                            "business_id"
                        )
                    )),
                });

            case "list_businesses":
                return response(event, 200, {
                    businesses: await listBusinesses(
                        connection,
                        body.search
                    ),
                });

            case "list_audit_logs":
                return response(event, 200, {
                    audit_logs: await listAuditLogs(
                        connection,
                        body.business_id
                    ),
                });

            case "suspend_subscription":
                return response(
                    event,
                    200,
                    await changeSubscriptionStatus(
                        connection,
                        requireNumber(
                            body.business_id,
                            "business_id"
                        ),
                        admin,
                        "SUSPENDED",
                        optionalTrimmedText(body.reason, 500)
                    )
                );

            case "reactivate_subscription":
                return response(
                    event,
                    200,
                    await changeSubscriptionStatus(
                        connection,
                        requireNumber(
                            body.business_id,
                            "business_id"
                        ),
                        admin,
                        "ACTIVE",
                        optionalTrimmedText(body.reason, 500)
                    )
                );

            case "cancel_subscription":
                return response(
                    event,
                    200,
                    await changeSubscriptionStatus(
                        connection,
                        requireNumber(
                            body.business_id,
                            "business_id"
                        ),
                        admin,
                        "CANCELLED",
                        optionalTrimmedText(body.reason, 500)
                    )
                );

            case "extend_subscription":
                return response(
                    event,
                    200,
                    await extendSubscription(
                        connection,
                        requireNumber(
                            body.business_id,
                            "business_id"
                        ),
                        admin,
                        body.extension_days,
                        optionalTrimmedText(body.reason, 500)
                    )
                );

            default:
                throw httpError(400, "Unsupported action.");
        }
    } catch (error) {
        console.error(
            "Subscription admin Lambda error:",
            error
        );

        return response(event, error.statusCode || 500, {
            message:
                error.message ||
                "Subscription administrator request failed.",
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};