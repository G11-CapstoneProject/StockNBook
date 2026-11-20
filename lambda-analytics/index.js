/*
 * StockNBook Analytics Lambda — V2 (stocknbook_v2 database)
 *
 * Supports:
 * 1. Sales Performance & Trends
 * 2. Product & Category Demand
 * 3. Booking & Rental Trends
 * 4. Package Demand Analysis
 * 5. Owner Branch Performance
 *
 * Database and JWT settings come from environment variables (same names as the Bookings Lambda):
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT (optional), JWT_SECRET
 * Never write passwords or secrets in this file.
 */

const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const {
    buildRange,
    buildAnalyticsPayloadV2,
} = require("./analyticsEngine");

const {
    toPositiveInteger,
    ensureStoreExists,
    ensureBranchBelongsToStore,
    getAnalyticsSales,
    getAnalyticsProducts,
    getAnalyticsBookings,
    getAnalyticsBookingItems,
    getAnalyticsRentalItems,
    getRolePermissions,
    hasExplicitAnalyticsDenial,
    hasAnalyticsAccess,
} = require("./analyticsRepository");

/* -------------------------------------------------------
 * ENVIRONMENT CONFIGURATION
 * ------------------------------------------------------- */

const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "JWT_SECRET"];

function missingEnvironment() {
    return REQUIRED_ENV.filter((name) => {
        const value = process.env[name];
        return typeof value !== "string" || !value.trim();
    });
}

let dbPool = null;

function getPool() {
    if (!dbPool) {
        dbPool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: Number(process.env.DB_PORT || 3306),
            // Same as the Bookings Lambda (works for local MySQL and AWS RDS).
            ssl: { rejectUnauthorized: false },
            waitForConnections: true,
            connectionLimit: Number(process.env.DB_POOL_SIZE || 8),
            queueLimit: 0,
            enableKeepAlive: true,
            decimalNumbers: true,
        });
    }

    return dbPool;
}

/* -------------------------------------------------------
 * HTTP RESPONSE HELPERS
 * ------------------------------------------------------- */

const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
    "Access-Control-Allow-Methods":
        "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
};

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body),
    };
}

function readMethod(event) {
    return String(
        event?.requestContext?.http?.method ||
        event?.httpMethod ||
        "POST"
    ).toUpperCase();
}

function parseBody(event) {
    if (!event?.body) return {};

    if (typeof event.body === "object") {
        return event.body;
    }

    try {
        const parsed = JSON.parse(event.body);

        if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
        ) {
            throw new Error("Invalid JSON body.");
        }

        return parsed;
    } catch {
        throw new Error("Invalid JSON body.");
    }
}

function normalizeAction(value) {
    return String(value || "")
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

function getAuthHeader(event) {
    return (
        event?.headers?.authorization ||
        event?.headers?.Authorization ||
        ""
    );
}

function parseToken(event) {
    const authHeader = getAuthHeader(event);

    const match = String(authHeader).match(
        /^Bearer\s+(.+)$/i
    );

    if (!match) {
        throw new Error(
            "Missing or invalid authorization token."
        );
    }

    return jwt.verify(match[1], process.env.JWT_SECRET, {
        algorithms: ["HS256"],
    });
}

function getRequestedBranchId(body) {
    return toPositiveInteger(
        body.branch_id ??
        body.branchId ??
        body.selected_branch_id ??
        body.selectedBranchId
    );
}

/* -------------------------------------------------------
 * ROLE-BASED DATA ACCESS
 * ------------------------------------------------------- */

async function resolveScope(
    connection,
    decoded,
    requestedBranchId
) {
    const storeId = toPositiveInteger(
        decoded.store_id ?? decoded.storeId
    );

    const role = String(
        decoded.role || ""
    ).trim().toLowerCase();

    const tokenBranchId = toPositiveInteger(
        decoded.branch_id ?? decoded.branchId
    );

    if (!storeId) {
        throw new Error("Invalid store in token.");
    }

    if (!["owner", "manager", "staff"].includes(role)) {
        throw new Error(
            "Your account role is not allowed to view analytics."
        );
    }

    const storeExists = await ensureStoreExists(
        connection,
        storeId
    );

    if (!storeExists) {
        throw new Error(
            "Store account was not found."
        );
    }

    // Owner can view all store branches or one authorized branch.
    if (role === "owner") {
        if (requestedBranchId !== null) {
            const branch =
                await ensureBranchBelongsToStore(
                    connection,
                    requestedBranchId,
                    storeId
                );

            if (!branch) {
                throw new Error(
                    "The selected branch does not belong to this store."
                );
            }

            return {
                storeId,
                branchId: requestedBranchId,
                branchName: String(
                    branch.branch_name || "Selected Branch"
                ),
                role,
                isOverall: false,
            };
        }

        return {
            storeId,
            branchId: null,
            branchName: "All Branches",
            role,
            isOverall: true,
        };
    }

    // Manager and Staff are restricted to their assigned branch.
    if (!tokenBranchId) {
        throw new Error(
            "Your account has no assigned branch."
        );
    }

    const branch =
        await ensureBranchBelongsToStore(
            connection,
            tokenBranchId,
            storeId
        );

    if (!branch) {
        throw new Error(
            "Your assigned branch is invalid."
        );
    }

    const permissions = await getRolePermissions(
        connection,
        decoded
    );

    if (hasExplicitAnalyticsDenial(permissions)) {
        throw new Error(
            "You do not have permission to view analytics."
        );
    }

    // A Staff member must explicitly have Analytics access (true, "full" or "view").
    if (role === "staff" && !hasAnalyticsAccess(permissions)) {
        throw new Error(
            "You do not have permission to view analytics."
        );
    }

    return {
        storeId,
        branchId: tokenBranchId,
        branchName: String(
            branch.branch_name || "Assigned Branch"
        ),
        role,
        isOverall: false,
    };
}

/* -------------------------------------------------------
 * HISTORICAL QUERY RANGE
 * ------------------------------------------------------- */

/*
 * Fetch enough records to calculate:
 * - the current reporting period
 * - the previous equivalent period
 * - the same period during the previous year
 * The engine filters records into each comparison period.
 */
function earliestRequiredDate(range) {
    return [
        range.startDate,
        range.previousStartDate,
        range.previousYearStartDate,
    ].filter(Boolean).sort()[0];
}

/* -------------------------------------------------------
 * ANALYTICS LAMBDA HANDLER
 * ------------------------------------------------------- */

exports.handler = async (event) => {
    const method = readMethod(event);

    if (method === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: "",
        };
    }

    if (method !== "POST") {
        return jsonResponse(405, {
            error: "Method not allowed. Use POST.",
        });
    }

    const missing = missingEnvironment();

    if (missing.length) {
        return jsonResponse(500, {
            error:
                "Analytics server configuration is incomplete. " +
                `Set ${missing.join(", ")} in the environment (.env.local or the Lambda settings).`,
        });
    }

    let connection = null;

    try {
        const body = parseBody(event);

        const action = normalizeAction(
            body.action || "get_analytics_v2"
        );

        // The old action name still works; both return the V2 response.
        if (
            action !== "get_analytics" &&
            action !== "get_analytics_v2"
        ) {
            return jsonResponse(400, {
                error:
                    "Invalid Analytics action. " +
                    "Use get_analytics_v2.",
            });
        }

        let decoded;

        try {
            decoded = parseToken(event);
        } catch {
            return jsonResponse(401, {
                error:
                    "Invalid or missing authorization token.",
            });
        }

        const pool = getPool();

        connection = await pool.getConnection();

        const requestedBranchId =
            getRequestedBranchId(body);

        const scope = await resolveScope(
            connection,
            decoded,
            requestedBranchId
        );

        const range = buildRange(body);

        // Release the connection after authentication and scope checks.
        connection.release();
        connection = null;

        const historicalStart =
            earliestRequiredDate(range);

        // Sales and products use order dates; bookings use event dates.
        const [
            salesRows,
            productRows,
            bookingRows,
            bookingItemRows,
            rentalRows,
        ] = await Promise.all([
            getAnalyticsSales(pool, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: historicalStart,
                endDate: range.endDate,
            }),

            getAnalyticsProducts(pool, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: historicalStart,
                endDate: range.endDate,
            }),

            getAnalyticsBookings(pool, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: historicalStart,
                endDate: range.endDate,
            }),

            getAnalyticsBookingItems(pool, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: historicalStart,
                endDate: range.endDate,
            }),
            getAnalyticsRentalItems(pool, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: range.startDate,
                endDate: range.endDate,
            }),
        ]);

        const payload = buildAnalyticsPayloadV2({
            range,
            scope,
            salesRows,
            productRows,
            bookingRows,
            bookingItemRows,
            rentalRows,
        });

        return jsonResponse(200, payload);

    } catch (error) {
        console.error(
            "STOCKNBOOK ANALYTICS V2 ERROR:",
            error
        );

        const message =
            error instanceof Error
                ? error.message
                : "Analytics service failed.";

        const isAccessError =
            /permission|assigned branch|not allowed|invalid store in token|store account was not found|does not belong/i
                .test(message);

        const isInputError =
            /invalid analytics|date range|cannot exceed|required|invalid json/i
                .test(message);

        const statusCode = isAccessError
            ? 403
            : isInputError
                ? 400
                : 500;

        return jsonResponse(statusCode, {
            error: statusCode === 500 ? "Analytics service failed. Check the server log for details." : message,
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
};
