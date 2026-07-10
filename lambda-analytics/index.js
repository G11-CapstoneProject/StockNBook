/* eslint-disable @typescript-eslint/no-require-imports */
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const {
    buildRange,
    buildAnalyticsPayload,
} = require("./analyticsEngine");

const {
    toPositiveInteger,
    ensureStoreExists,
    ensureBranchBelongsToStore,
    getBranchName,
    getSalesRows,
    getProductRevenueRows,
    getBookings,
    getRolePermissions,
    hasExplicitAnalyticsDenial,
} = require("./analyticsRepository");

const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";

const dbConfig = {
    host: "stocknbook-db.ctc4eeuyq62e.ap-southeast-1.rds.amazonaws.com",
    user: "admin",
    password: "2qJivedWDxCQS6TLjjEl",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};


const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
};

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body),
    };
}

function readMethod(event) {
    return event?.requestContext?.http?.method || event?.httpMethod || "POST";
}

function parseBody(event) {
    if (!event?.body) {
        return {};
    }

    if (typeof event.body === "object") {
        return event.body;
    }

    try {
        return JSON.parse(event.body);
    } catch {
        throw new Error("Invalid JSON body.");
    }
}

function getAuthHeader(event) {
    return (
        event?.headers?.authorization ||
        event?.headers?.Authorization ||
        ""
    );
}

function normalizeAction(value) {
    return String(value || "")
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[-\s]+/g, "_")
        .toLowerCase();
}

function getRequestedBranchId(body) {
    return toPositiveInteger(
        body.branch_id ??
        body.branchId ??
        body.selected_branch_id ??
        body.selectedBranchId
    );
}

function missingDatabaseConfiguration() {
    return !dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database;
}

function parseToken(event) {
    const authHeader = getAuthHeader(event);

    if (!authHeader) {
        throw new Error("No token provided.");
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");

    if (!token) {
        throw new Error("No token provided.");
    }

    return jwt.verify(token, JWT_SECRET);
}

async function resolveScope(connection, decoded, requestedBranchId) {
    const storeId = toPositiveInteger(decoded.store_id ?? decoded.storeId);
    const role = String(decoded.role || "").trim().toLowerCase();
    const tokenBranchId = toPositiveInteger(decoded.branch_id ?? decoded.branchId);

    if (!storeId) {
        throw new Error("Invalid store in token.");
    }

    if (!["owner", "manager", "staff"].includes(role)) {
        throw new Error("Your account role is not allowed to view analytics.");
    }

    const storeExists = await ensureStoreExists(connection, storeId);

    if (!storeExists) {
        throw new Error("Store account was not found.");
    }

    if (role === "owner") {
        if (requestedBranchId) {
            const branch = await ensureBranchBelongsToStore(
                connection,
                requestedBranchId,
                storeId
            );

            if (!branch) {
                throw new Error("The selected branch does not belong to this store.");
            }

            return {
                storeId,
                branchId: requestedBranchId,
                branchName: String(branch.branch_name || "Selected Branch"),
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

    if (!tokenBranchId) {
        throw new Error("Your account has no assigned branch.");
    }

    const branch = await ensureBranchBelongsToStore(
        connection,
        tokenBranchId,
        storeId
    );

    if (!branch) {
        throw new Error("Your assigned branch is not valid for this store.");
    }

    const permissions = await getRolePermissions(connection, decoded);

    if (hasExplicitAnalyticsDenial(permissions)) {
        throw new Error("You do not have permission to view analytics.");
    }

    return {
        storeId,
        branchId: tokenBranchId,
        branchName: String(branch.branch_name || "Assigned Branch"),
        role,
        isOverall: false,
    };
}

exports.handler = async (event) => {
    if (readMethod(event) === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: "",
        };
    }

    if (missingDatabaseConfiguration()) {
        return jsonResponse(500, {
            error:
                "Analytics database environment variables are missing. Configure DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME in Lambda.",
        });
    }

    let connection;

    try {
        const body = parseBody(event);
        const action = normalizeAction(body.action || "get_analytics");

        if (action !== "get_analytics") {
            return jsonResponse(400, {
                error: "Invalid action. Use get_analytics.",
            });
        }

        let decoded;

        try {
            decoded = parseToken(event);
        } catch {
            return jsonResponse(401, {
                error: "Invalid or missing authorization token.",
            });
        }

        connection = await mysql.createConnection(dbConfig);

        const requestedBranchId = getRequestedBranchId(body);
        const scope = await resolveScope(
            connection,
            decoded,
            requestedBranchId
        );
        const range = buildRange(body);

        // The sales query starts at the previous comparison period so the engine can
        // calculate current-period growth against an equal earlier period.
        const [salesRows, productRevenueRows, bookingRows] = await Promise.all([
            getSalesRows(connection, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: range.previousStartDate,
                endDate: range.endDate,
            }),
            getProductRevenueRows(connection, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: range.startDate,
                endDate: range.endDate,
            }),
            getBookings(connection, {
                storeId: scope.storeId,
                branchId: scope.branchId,
                startDate: range.startDate,
                endDate: range.endDate,
            }),
        ]);

        return jsonResponse(
            200,
            buildAnalyticsPayload({
                range,
                scope,
                salesRows,
                productRevenueRows,
                bookingRows,
            })
        );
    } catch (error) {
        console.error("ANALYTICS LAMBDA ERROR:", error);

        const message =
            error instanceof Error
                ? error.message
                : "Analytics service failed.";

        const statusCode =
            /token|permission|assigned branch|not allowed/i.test(message)
                ? 403
                : /invalid|required|cannot exceed|date range/i.test(message)
                    ? 400
                    : 500;

        return jsonResponse(statusCode, { error: message });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};
