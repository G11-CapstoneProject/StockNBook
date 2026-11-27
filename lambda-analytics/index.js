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
    monthComparisonRanges,
    buildMonthComparison,
    buildItemInsight,
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
    getMonthComparisonProducts,
    getMonthComparisonRentals,
    getItemOptions,
    getProductItem,
    getEquipmentItem,
    getProductInsightRows,
    getRentalInsightRows,
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
 * THIS MONTH VS LAST YEAR, AND ITEM INSIGHT
 * ------------------------------------------------------- */

const ANALYTICS_ACTIONS = new Set(["get_analytics", "get_analytics_v2", "get_month_comparison", "get_item_options", "get_item_insight"]);

// Today in the Philippines (the store's business day), YYYY-MM-DD.
function manilaToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function firstOfMonthsAgo(today, months) {
    const [y, m] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 10);
}

function addDaysText(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

async function monthComparisonResponse(pool, scope, body) {
    const today = manilaToday();
    const month = String(body.month || today.slice(0, 7)).trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7) || month < "2000-01") {
        throw new Error("Invalid analytics month. Choose a month up to the current month (YYYY-MM).");
    }
    const ranges = monthComparisonRanges(month, today);
    const [productRows, rentalRows] = await Promise.all([
        getMonthComparisonProducts(pool, { storeId: scope.storeId, branchId: scope.branchId, ranges }),
        getMonthComparisonRentals(pool, { storeId: scope.storeId, branchId: scope.branchId, ranges }),
    ]);
    return { ...buildMonthComparison({ month, ranges, productRows, rentalRows }), scope };
}

async function itemInsightResponse(pool, scope, body) {
    const kind = String(body.kind || body.item_kind || "product").toLowerCase() === "rental" ? "rental" : "product";
    const itemId = toPositiveInteger(body.item_id ?? body.itemId);
    if (!itemId) throw new Error("Invalid analytics item. Choose a product or rental item.");
    const item = kind === "product"
        ? await getProductItem(pool, { storeId: scope.storeId, productId: itemId })
        : await getEquipmentItem(pool, { storeId: scope.storeId, equipmentId: itemId });
    if (!item) throw new Error("The selected item does not belong to this store.");

    const today = manilaToday();
    // Three full years before this month, plus this month so far.
    const historyStart = firstOfMonthsAgo(today, 36);
    const mtdRanges = monthComparisonRanges(today.slice(0, 7), today);
    const mtd = { ...mtdRanges, label: `${mtdRanges.label.split(" ")[0]} 1–${Number(today.slice(8, 10))}, ${today.slice(0, 4)}` };
    const timelineStart = addDaysText(today, -89);
    const rows = kind === "product"
        ? await getProductInsightRows(pool, { storeId: scope.storeId, branchId: scope.branchId, productId: itemId, historyStart, today, mtd, timelineStart })
        : await getRentalInsightRows(pool, { storeId: scope.storeId, branchId: scope.branchId, equipmentId: itemId, historyStart, mtd,
            timelineStart, timelineEnd: addDaysText(today, 60) });
    return {
        ...buildItemInsight({ kind, item: { id: Number(item.id), name: String(item.name), category: String(item.category) },
            today, historyStart, ...rows, monthToDate: { ...rows.monthToDate, label: mtd.label } }),
        scope,
    };
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
        if (!ANALYTICS_ACTIONS.has(action)) {
            return jsonResponse(400, {
                error:
                    "Invalid Analytics action. " +
                    `Use ${[...ANALYTICS_ACTIONS].join(", ")}.`,
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

        // Release the connection after authentication and scope checks.
        connection.release();
        connection = null;

        if (action === "get_month_comparison") {
            return jsonResponse(200, await monthComparisonResponse(pool, scope, body));
        }

        if (action === "get_item_options") {
            const options = await getItemOptions(pool, { storeId: scope.storeId });
            return jsonResponse(200, { success: true, version: 2, action, scope, ...options });
        }

        if (action === "get_item_insight") {
            return jsonResponse(200, await itemInsightResponse(pool, scope, body));
        }

        const range = buildRange(body);

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
            /invalid analytics|date range|cannot exceed|required|invalid json|does not belong to this store/i
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
