const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const {
    buildInventoryForecast,
    assignDemandLevels,
    buildItemSeasonality,
    buildSeasonalAnalysis,
    buildBookingForecast,
} = require("./forecastingEngine");

const {
    ensureBranchBelongsToStore,
    getWeekWindows,
    getMonthRange,
    getUpcomingBookingRange,
    getInventoryItems,
    getHistoricalSales,
    getMonthlySalesSummary,
    getItemMonthlySalesSummary,
    getUpcomingBookings,
    buildWeeklyDemandMap,
    buildItemMonthlySalesMap,
} = require("./forecastingRepository");

/*
  Configure these in AWS Lambda Environment Variables:

  DB_HOST
  DB_PORT
  DB_USER
  DB_PASSWORD
  DB_NAME
  DB_SSL
  JWT_SECRET
*/
const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";

const dbConfig = {
    host: "stocknbook-db.ctc4eeuyq62e.ap-southeast-1.rds.amazonaws.com",    user: "admin",
    password: "2qJivedWDxCQS6TLjjEl",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

function jsonResponse(statusCode, headers, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body),
    };
}

function badRequest(headers, message) {
    return jsonResponse(400, headers, { error: message });
}

function unauthorized(headers, message) {
    return jsonResponse(401, headers, { error: message });
}

function serverError(headers, error) {
    console.error("Forecasting Lambda error:", error);

    return jsonResponse(500, headers, {
        error:
            error instanceof Error
                ? error.message
                : "Internal server error",
    });
}

function toPositiveInteger(value) {
    const number = Number(value);

    return Number.isInteger(number) && number > 0
        ? number
        : null;
}

function getTokenFromHeader(event) {
    return (
        event?.headers?.authorization ||
        event?.headers?.Authorization ||
        ""
    );
}

function getRole(decoded) {
    return String(decoded?.role || "")
        .trim()
        .toLowerCase();
}

function getScopeFromToken(decoded, body, headers) {
    const storeId = toPositiveInteger(decoded?.store_id);
    const role = getRole(decoded);
    const tokenBranchId = toPositiveInteger(decoded?.branch_id);
    const requestedBranchId = toPositiveInteger(body.branch_id);

    const isBranchUser =
        role === "manager" ||
        role === "staff";

    if (!storeId) {
        return {
            error: unauthorized(
                headers,
                "Invalid store in token."
            ),
        };
    }

    if (isBranchUser && !tokenBranchId) {
        return {
            error: badRequest(
                headers,
                "Missing branch_id in token for this user."
            ),
        };
    }

    return {
        storeId,
        role,
        selectedBranchId: isBranchUser
            ? tokenBranchId
            : role === "owner"
                ? requestedBranchId
                : null,
    };
}

function normalizeAction(action) {
    return action === "get_seasonal_analysis"
        ? "get_seasonal_forecast"
        : action;
}

function parseMonth(value) {
    const key = String(value || "").trim();

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
        return null;
    }

    const [year, month] = key.split("-").map(Number);

    return {
        key,
        year,
        month,
    };
}

function toDateKey(date) {
    return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0));
}

function resolveSeasonalDateRange(body) {
    const start = parseMonth(
        body.seasonalStartMonth ??
        body.seasonal_start_month ??
        body.startMonth
    );

    const end = parseMonth(
        body.seasonalEndMonth ??
        body.seasonal_end_month ??
        body.endMonth
    );

    if (!start && !end) {
        const range = getMonthRange(12);

        return {
            ...range,
            historyMonths: 12,
        };
    }

    if (!start || !end || start.key > end.key) {
        return {
            error:
                "Choose valid start and end months using YYYY-MM format.",
        };
    }

    const historyMonths =
        (end.year - start.year) * 12 +
        (end.month - start.month) +
        1;

    if (historyMonths < 1 || historyMonths > 60) {
        return {
            error:
                "Choose a seasonal sales period between 1 and 60 months.",
        };
    }

    const today = new Date();

    const currentMonth = `${today.getUTCFullYear()}-${String(
    today.getUTCMonth() + 1
).padStart(2, "0")}`;

    if (end.key > currentMonth) {
        return {
            error:
                "The selected seasonal end month cannot be in the future.",
        };
    }

    return {
        startDate: `${start.key}-01`,
        endDate:
            end.key === currentMonth
                ? toDateKey(today)
                : toDateKey(lastDayOfMonth(end.year, end.month)),
        historyMonths,
    };
}

/*
  Creates a complete month-by-month timeline.

  Missing months become zero instead of being removed, so the Forecasting
  graph always displays a real 12-month sequence.
*/
function buildMonthlyDemandHistory(
    monthlyRows = [],
    startDate,
    endDate
) {
    const savedRows = new Map();

    monthlyRows.forEach((row) => {
        const monthKey = String(row.monthKey || "");

        if (!/^\d{4}-\d{2}$/.test(monthKey)) {
            return;
        }

        savedRows.set(monthKey, {
            totalUnits: Math.max(
                0,
                Number(row.totalUnits || 0)
            ),
            orderCount: Math.max(
                0,
                Number(row.orderCount || 0)
            ),
        });
    });

    const start = parseMonth(
        String(startDate || "").slice(0, 7)
    );

    const end = parseMonth(
        String(endDate || "").slice(0, 7)
    );

    if (!start || !end) {
        return [];
    }

    const cursor = new Date(
        Date.UTC(start.year, start.month - 1, 1)
    );

    const lastMonth = new Date(
        Date.UTC(end.year, end.month - 1, 1)
    );

    const history = [];

    while (cursor <= lastMonth) {
        const monthKey = `${cursor.getUTCFullYear()}-${String(
    cursor.getUTCMonth() + 1
).padStart(2, "0")}`;

        const row = savedRows.get(monthKey) || {
            totalUnits: 0,
            orderCount: 0,
        };

        history.push({
            monthKey,
            label: new Intl.DateTimeFormat("en-US", {
                month: "short",
                year: "2-digit",
                timeZone: "UTC",
            }).format(cursor),
            totalUnits: row.totalUnits,
            orderCount: row.orderCount,
        });

        cursor.setUTCMonth(
            cursor.getUTCMonth() + 1
        );
    }

    return history;
}

function buildBookingAllocationMap(bookingForecast) {
    const allocationMap = new Map();

    for (const allocation of bookingForecast?.allocatedInventory || []) {
        const productId = Number(
            allocation.productId || 0
        );

        if (!productId) {
            continue;
        }

        const variantId =
            Number(allocation.variantId || 0) || null;

        const key = `${productId}:${variantId || "product"}`;

        allocationMap.set(
            key,
            Number(allocationMap.get(key) || 0) +
                Number(allocation.quantity || 0)
        );
    }

    return allocationMap;
}

function alertPriority(item) {
    const timeAlert = String(
        item.timeAlert || "NONE"
    );

    const status = String(
        item.status || "STABLE"
    );

    const timeRank = {
        OUT_OF_STOCK: 0,
        MAY_RUN_OUT_WITHIN_3_DAYS: 1,
        MAY_RUN_OUT_WITHIN_7_DAYS: 2,
        REORDER_POINT_REACHED: 3,
        NONE: 4,
    };

    const statusRank = {
        LOW: 0,
        RISK: 1,
        STABLE: 2,
    };

    return (
        (timeRank[timeAlert] ?? 5) * 10 +
        (statusRank[status] ?? 3)
    );
}

async function buildInventoryForecastResponse({
    connection,
    storeId,
    role,
    selectedBranchId,
}) {
    const historyWeeks = 12;
    const historyMonths = 12;
    const periodDays = 30;
    const leadTimeDays = 3;

    const weekWindows = getWeekWindows(historyWeeks);
    const monthRange = getMonthRange(historyMonths);
    const bookingRange = getUpcomingBookingRange(periodDays);

    const historyStartDate = weekWindows[0].startDate;
    const historyEndDate =
        weekWindows[weekWindows.length - 1].endDate;

    const [
        inventoryItems,
        historicalSales,
        itemMonthlySales,
        upcomingBookings,
    ] = await Promise.all([
        getInventoryItems(connection, {
            storeId,
            branchId: selectedBranchId,
        }),

        getHistoricalSales(connection, {
            storeId,
            branchId: selectedBranchId,
            startDate: historyStartDate,
            endDate: historyEndDate,
        }),

        getItemMonthlySalesSummary(connection, {
            storeId,
            branchId: selectedBranchId,
            startDate: monthRange.startDate,
            endDate: monthRange.endDate,
        }),

        getUpcomingBookings(connection, {
            storeId,
            branchId: selectedBranchId,
            startDate: bookingRange.startDate,
            endDate: bookingRange.endDate,
        }),
    ]);

    const bookingForecast = buildBookingForecast(
        upcomingBookings,
        { periodDays }
    );

    const weeklyDemandMap = buildWeeklyDemandMap(
        inventoryItems,
        historicalSales,
        weekWindows
    );

    const monthlySalesMap = buildItemMonthlySalesMap(
        inventoryItems,
        itemMonthlySales
    );

    const bookingAllocationMap = buildBookingAllocationMap(
        bookingForecast
    );

    const rawItems = inventoryItems.map((item) => {
        const weeklyDemand =
            weeklyDemandMap.get(item.id) ||
            Array(historyWeeks).fill(0);

        const itemMonthlyHistory =
            monthlySalesMap.get(item.id) || [];

        const monthlyDemand = buildMonthlyDemandHistory(
            itemMonthlyHistory,
            monthRange.startDate,
            monthRange.endDate
        );

        const allocatedQuantity = Number(
            bookingAllocationMap.get(item.id) || 0
        );

        const forecast = buildInventoryForecast({
            weeklyDemand,
            onHandQuantity: item.onHandQuantity,
            allocatedQuantity,
            lowStockThreshold: item.lowStockThreshold,
            safetyStock: item.lowStockThreshold,
            periodDays,
            leadTimeDays,
        });

        return {
            ...item,

            currentStock: forecast.onHandQuantity,
            onHandQuantity: forecast.onHandQuantity,
            allocatedQuantity: forecast.allocatedQuantity,
            availableQuantity: forecast.availableQuantity,

            historyWeeks,
            weeklyDemand,
            monthlyDemand,

            weeklyForecast: forecast.weeklyForecast,
            baseWeeklyForecast: forecast.baseWeeklyForecast,
            forecastedDemand: forecast.forecastedDemand,
            suggestedRestock: forecast.suggestedRestock,
            status: forecast.status,

            recentFourWeekDemand:
                forecast.recentFourWeekDemand,

            previousFourWeekDemand:
                forecast.previousFourWeekDemand,

            growthPercent: forecast.growthPercent,
            growthFactor: forecast.growthFactor,
            growthTrend: forecast.growthTrend,

            totalUnitsSold: forecast.totalUnitsSold,
            activeSalesWeeks: forecast.activeSalesWeeks,

            averageWeeklyDemand:
                forecast.averageWeeklyDemand,

            movementClass: forecast.movementClass,
            dailyDemand: forecast.dailyDemand,

            daysUntilStockout:
                forecast.daysUntilStockout,

            reorderPoint: forecast.reorderPoint,
            reorderNow: forecast.reorderNow,
            leadTimeDays: forecast.leadTimeDays,

            timeAlert: forecast.timeAlert,
            alertSeverity: forecast.alertSeverity,

            seasonality: buildItemSeasonality(
                itemMonthlyHistory,
                {
                    currentMonthNumber:
                        new Date().getUTCMonth() + 1,
                    minimumHistoryMonths: 6,
                }
            ),
        };
    });

    const items = assignDemandLevels(rawItems).sort((first, second) => {
        const alertDifference =
            alertPriority(first) -
            alertPriority(second);

        if (alertDifference !== 0) {
            return alertDifference;
        }

        return (
            Number(second.suggestedRestock || 0) -
                Number(first.suggestedRestock || 0) ||
            Number(second.forecastedDemand || 0) -
                Number(first.forecastedDemand || 0)
        );
    });

    const count = (predicate) =>
        items.filter(predicate).length;

    return {
        success: true,
        action: "get_inventory_forecast",
        generatedAt: new Date().toISOString(),

        scope: {
            storeId,
            branchId: selectedBranchId,
            role,
            periodDays,
            historyWeeks,
            historyStartDate,
            historyEndDate,
            bookingStartDate: bookingRange.startDate,
            bookingEndDate: bookingRange.endDate,
        },

        summary: {
            projectedDemand: items.reduce(
                (total, item) =>
                    total + Number(item.forecastedDemand || 0),
                0
            ),

            expectedBookings:
                bookingForecast.expectedBookings,

            confirmedBookings:
                bookingForecast.confirmedBookings,

            preparingBookings:
                bookingForecast.preparingBookings,

            trackedItems: items.length,

            restockAlerts: count(
                (item) =>
                    item.status === "LOW" ||
                    item.status === "RISK"
            ),

            lowStockItems: count(
                (item) => item.status === "LOW"
            ),

            riskItems: count(
                (item) => item.status === "RISK"
            ),

            highDemandItems: count(
                (item) => item.demandLevel === "HIGH"
            ),

            growingDemandItems: count(
                (item) =>
                    item.growthTrend === "GROWING" ||
                    item.growthTrend === "NEW_DEMAND"
            ),

            peakSeasonItems: count(
                (item) =>
                    item.seasonality?.status === "PEAK_SEASON"
            ),

            bookingAllocatedUnits:
                bookingForecast.allocationSummary
                    .allocatedUnits,

            bookingsWithoutAllocation:
                bookingForecast.allocationSummary
                    .bookingsWithoutAllocation,
        },

        notes: {
            dataSource:
                "Completed POS sales, inventory, and upcoming confirmed/preparing bookings.",

            monthlyDemand:
                "Each monthlyDemand point is one complete calendar month of completed POS item quantity.",
        },

        bookingSummary: bookingForecast,
        items,
    };
}

async function buildSeasonalForecastResponse({
    connection,
    storeId,
    role,
    selectedBranchId,
    seasonalRange,
}) {
    const range =
        seasonalRange || {
            ...getMonthRange(12),
            historyMonths: 12,
        };

    const monthlySales = await getMonthlySalesSummary(
        connection,
        {
            storeId,
            branchId: selectedBranchId,
            startDate: range.startDate,
            endDate: range.endDate,
        }
    );

    return {
        success: true,
        action: "get_seasonal_forecast",
        generatedAt: new Date().toISOString(),

        scope: {
            storeId,
            branchId: selectedBranchId,
            role,
            historyMonths: Number(
                range.historyMonths || 12
            ),
            historyStartDate: range.startDate,
            historyEndDate: range.endDate,
        },

        notes: {
            dataSource: "Completed POS sales only",
        },

        seasonal: buildSeasonalAnalysis(
            monthlySales,
            12
        ),
    };
}

async function buildBookingForecastResponse({
    connection,
    storeId,
    role,
    selectedBranchId,
}) {
    const periodDays = 30;

    const range = getUpcomingBookingRange(
        periodDays
    );

    const bookings = await getUpcomingBookings(
        connection,
        {
            storeId,
            branchId: selectedBranchId,
            startDate: range.startDate,
            endDate: range.endDate,
        }
    );

    return {
        success: true,
        action: "get_booking_forecast",
        generatedAt: new Date().toISOString(),

        scope: {
            storeId,
            branchId: selectedBranchId,
            role,
            periodDays,
            startDate: range.startDate,
            endDate: range.endDate,
        },

        booking: buildBookingForecast(bookings, {
            periodDays,
        }),
    };
}

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "Content-Type, Authorization",

        "Access-Control-Allow-Methods":
            "GET, POST, OPTIONS",

        "Content-Type": "application/json",
    };

    const method =
        event?.requestContext?.http?.method ||
        event?.httpMethod;

    if (method === "OPTIONS") {
        return {
            statusCode: 204,
            headers,
            body: "",
        };
    }

    let body;

    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return badRequest(
            headers,
            "Invalid JSON body."
        );
    }

    const action = normalizeAction(body.action);

    const validActions = [
        "get_inventory_forecast",
        "get_seasonal_forecast",
        "get_booking_forecast",
        "get_forecast_report",
    ];

    if (!validActions.includes(action)) {
        return badRequest(
            headers,
            "Invalid or missing action."
        );
    }

    const authorization = getTokenFromHeader(event);

    if (!authorization) {
        return unauthorized(
            headers,
            "No token provided."
        );
    }

    let decoded;

    try {
        decoded = jwt.verify(
            authorization.replace(/^Bearer\s+/i, ""),
            JWT_SECRET
        );
    } catch {
        return unauthorized(
            headers,
            "Invalid token."
        );
    }

    const scope = getScopeFromToken(
        decoded,
        body,
        headers
    );

    if (scope.error) {
        return scope.error;
    }

    let connection;

    try {
        connection = await mysql.createConnection(
            dbConfig
        );

        if (scope.selectedBranchId) {
            const allowed =
                await ensureBranchBelongsToStore(
                    connection,
                    scope.selectedBranchId,
                    scope.storeId
                );

            if (!allowed) {
                return badRequest(
                    headers,
                    "Invalid branch for this store."
                );
            }
        }

        if (action === "get_seasonal_forecast") {
            const range = resolveSeasonalDateRange(
                body
            );

            if (range.error) {
                return badRequest(
                    headers,
                    range.error
                );
            }

            const response =
                await buildSeasonalForecastResponse({
                    connection,
                    ...scope,
                    seasonalRange: range,
                });

            return jsonResponse(
                200,
                headers,
                response
            );
        }

        if (action === "get_booking_forecast") {
            const response =
                await buildBookingForecastResponse({
                    connection,
                    ...scope,
                });

            return jsonResponse(
                200,
                headers,
                response
            );
        }

        const response =
            await buildInventoryForecastResponse({
                connection,
                ...scope,
            });

        if (action === "get_forecast_report") {
            response.action = "get_forecast_report";
        }

        return jsonResponse(
            200,
            headers,
            response
        );
    } catch (error) {
        return serverError(headers, error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};
