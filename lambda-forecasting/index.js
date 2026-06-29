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
  IMPORTANT:
  Copy the SAME JWT_SECRET and dbConfig values from your working
  lambda-pos/index.js file into the two placeholders below.

  Do not use a different JWT secret. It must match your login/auth Lambda.
*/
const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";
const dbConfig = {
    host: "stocknbook-db.clyuqe48evd0.ap-southeast-1.rds.amazonaws.com",
    user: "admin",
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
    return Number.isInteger(number) && number > 0 ? number : null;
}

function parseMonthInput(value) {
    const raw = String(value ?? "").trim();

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
        return null;
    }

    const [year, month] = raw.split("-").map(Number);

    if (!Number.isInteger(year) || !Number.isInteger(month)) {
        return null;
    }

    return {
        year,
        month,
        key: raw,
    };
}

function toUtcDateKey(date) {
    return date.toISOString().slice(0, 10);
}

function getCurrentMonthKey() {
    const today = new Date();

    return `${today.getUTCFullYear()}-${String(
        today.getUTCMonth() + 1
    ).padStart(2, "0")}`;
}

function getLastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0));
}

function countMonthsInclusive(startMonth, endMonth) {
    return (
        (endMonth.year - startMonth.year) * 12 +
        (endMonth.month - startMonth.month) +
        1
    );
}

/*
  Accepts:
  {
    seasonalStartMonth: "YYYY-MM",
    seasonalEndMonth: "YYYY-MM"
  }

  This keeps the date filter limited to full calendar months. It prevents
  accidental future periods and protects the Lambda from very large requests.
*/
function resolveSeasonalDateRange(body = {}) {
    const rawStart =
        body.seasonalStartMonth ??
        body.seasonal_start_month ??
        body.startMonth ??
        body.start_month;

    const rawEnd =
        body.seasonalEndMonth ??
        body.seasonal_end_month ??
        body.endMonth ??
        body.end_month;

    if (!rawStart && !rawEnd) {
        const range = getMonthRange(12);

        return {
            startDate: range.startDate,
            endDate: range.endDate,
            historyMonths: 12,
        };
    }

    const startMonth = parseMonthInput(rawStart);
    const endMonth = parseMonthInput(rawEnd);

    if (!startMonth || !endMonth) {
        return {
            error:
                "seasonalStartMonth and seasonalEndMonth must use YYYY-MM format.",
        };
    }

    if (startMonth.key > endMonth.key) {
        return {
            error:
                "seasonalStartMonth must not be later than seasonalEndMonth.",
        };
    }

    const currentMonthKey = getCurrentMonthKey();

    if (endMonth.key > currentMonthKey) {
        return {
            error:
                "The selected seasonal end month cannot be later than the current month.",
        };
    }

    const historyMonths = countMonthsInclusive(startMonth, endMonth);

    if (historyMonths < 1 || historyMonths > 60) {
        return {
            error:
                "Choose a seasonal sales period between 1 and 60 calendar months.",
        };
    }

    const today = new Date();
    const todayKey = toUtcDateKey(today);
    const endDate =
        endMonth.key === currentMonthKey
            ? todayKey
            : toUtcDateKey(getLastDayOfMonth(endMonth.year, endMonth.month));

    return {
        startDate: `${startMonth.key}-01`,
        endDate,
        historyMonths,
    };
}

function getTokenFromHeader(event) {
    return (
        event?.headers?.authorization ||
        event?.headers?.Authorization ||
        ""
    );
}

function getRole(decoded) {
    return String(decoded?.role || "").trim().toLowerCase();
}

function getBranchIdFromToken(decoded) {
    return toPositiveInteger(decoded?.branch_id);
}

function getStoreIdFromToken(decoded) {
    return toPositiveInteger(decoded?.store_id);
}

function normalizeAction(action) {
    if (action === "get_seasonal_analysis") {
        return "get_seasonal_forecast";
    }

    return action;
}

function getScopeFromToken(decoded, body, headers) {
    const storeId = getStoreIdFromToken(decoded);
    const tokenBranchId = getBranchIdFromToken(decoded);
    const role = getRole(decoded);
    const isBranchUser = role === "manager" || role === "staff";
    const requestedBranchId = toPositiveInteger(body.branch_id);

    if (!storeId) {
        return {
            error: unauthorized(headers, "Invalid store in token."),
        };
    }

    let selectedBranchId = null;

    if (isBranchUser) {
        if (!tokenBranchId) {
            return {
                error: badRequest(
                    headers,
                    "Missing branch_id in token for this user."
                ),
            };
        }

        selectedBranchId = tokenBranchId;
    } else if (role === "owner" && requestedBranchId) {
        selectedBranchId = requestedBranchId;
    }

    return {
        storeId,
        role,
        selectedBranchId,
    };
}

function alertSortPriority(item) {
    const alertPriority = {
        OUT_OF_STOCK: 0,
        MAY_RUN_OUT_WITHIN_3_DAYS: 1,
        MAY_RUN_OUT_WITHIN_7_DAYS: 2,
        REORDER_POINT_REACHED: 3,
        NONE: 4,
    };

    const statusPriority = {
        LOW: 0,
        RISK: 1,
        STABLE: 2,
    };

    const timeAlert = String(item.timeAlert || "NONE");
    const status = String(item.status || "STABLE");

    return (
        (alertPriority[timeAlert] ?? 5) * 10 +
        (statusPriority[status] ?? 3)
    );
}


function buildBookingAllocationMap(bookingForecast) {
    const allocationMap = new Map();

    const allocations = Array.isArray(bookingForecast?.allocatedInventory)
        ? bookingForecast.allocatedInventory
        : [];

    allocations.forEach((allocation) => {
        const productId = Number(allocation.productId || 0);

        if (!productId) {
            return;
        }

        const variantId = Number(allocation.variantId || 0) || null;
        const key = `${productId}:${variantId || "product"}`;
        const current = Number(allocationMap.get(key) || 0);

        allocationMap.set(key, current + Number(allocation.quantity || 0));
    });

    return allocationMap;
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
    const historyEndDate = weekWindows[weekWindows.length - 1].endDate;

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

    const bookingForecast = buildBookingForecast(upcomingBookings, {
        periodDays,
    });

    const bookingAllocationMap = buildBookingAllocationMap(bookingForecast);

    const weeklyDemandMap = buildWeeklyDemandMap(
        inventoryItems,
        historicalSales,
        weekWindows
    );

    const itemMonthlySalesMap = buildItemMonthlySalesMap(
        inventoryItems,
        itemMonthlySales
    );

    const rawItems = inventoryItems
        .map((item) => {
            const weeklyDemand =
                weeklyDemandMap.get(item.id) ||
                Array.from({ length: historyWeeks }, () => 0);

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
                id: item.id,
                productId: item.productId,
                variantId: item.variantId,
                productName: item.productName,
                variantName: item.variantName,
                itemName: item.itemName,
                category: item.category,
                branchId: item.branchId,
                branchName: item.branchName,
                isVariant: item.isVariant,

                currentStock: forecast.onHandQuantity,
                onHandQuantity: forecast.onHandQuantity,
                allocatedQuantity: forecast.allocatedQuantity,
                availableQuantity: forecast.availableQuantity,
                lowStockThreshold: item.lowStockThreshold,

                historyWeeks,
                weeklyDemand,

                weeklyForecast: forecast.weeklyForecast,
                baseWeeklyForecast: forecast.baseWeeklyForecast,
                forecastedDemand: forecast.forecastedDemand,
                suggestedRestock: forecast.suggestedRestock,
                status: forecast.status,

                recentFourWeekDemand: forecast.recentFourWeekDemand,
                previousFourWeekDemand: forecast.previousFourWeekDemand,
                growthPercent: forecast.growthPercent,
                growthFactor: forecast.growthFactor,
                growthTrend: forecast.growthTrend,

                totalUnitsSold: forecast.totalUnitsSold,
                activeSalesWeeks: forecast.activeSalesWeeks,
                averageWeeklyDemand: forecast.averageWeeklyDemand,
                movementClass: forecast.movementClass,

                dailyDemand: forecast.dailyDemand,
                daysUntilStockout: forecast.daysUntilStockout,
                reorderPoint: forecast.reorderPoint,
                reorderNow: forecast.reorderNow,
                leadTimeDays: forecast.leadTimeDays,
                timeAlert: forecast.timeAlert,
                alertSeverity: forecast.alertSeverity,

                seasonality: buildItemSeasonality(
                    itemMonthlySalesMap.get(item.id) || [],
                    {
                        currentMonthNumber: new Date().getUTCMonth() + 1,
                        minimumHistoryMonths: 6,
                    }
                ),
            };
        });

    const items = assignDemandLevels(rawItems)
        .sort((first, second) => {
            const priorityDifference =
                alertSortPriority(first) - alertSortPriority(second);

            if (priorityDifference !== 0) {
                return priorityDifference;
            }

            return (
                Number(second.suggestedRestock || 0) -
                Number(first.suggestedRestock || 0) ||
                Number(second.forecastedDemand || 0) -
                Number(first.forecastedDemand || 0)
            );
        });

    const lowItems = items.filter((item) => item.status === "LOW");
    const riskItems = items.filter((item) => item.status === "RISK");
    const restockItems = items.filter(
        (item) => item.status === "LOW" || item.status === "RISK"
    );

    const criticalStockoutAlerts = items.filter(
        (item) =>
            item.timeAlert === "OUT_OF_STOCK" ||
            item.timeAlert === "MAY_RUN_OUT_WITHIN_3_DAYS"
    );

    const stockoutWithin7Days = items.filter(
        (item) => item.timeAlert === "MAY_RUN_OUT_WITHIN_7_DAYS"
    );

    const reorderNowItems = items.filter((item) => item.reorderNow);

    const fastMovingItems = items.filter(
        (item) => item.movementClass === "FAST_MOVING"
    );

    const slowMovingItems = items.filter(
        (item) => item.movementClass === "SLOW_MOVING"
    );

    const highDemandItems = items.filter(
        (item) => item.demandLevel === "HIGH"
    );

    const growingDemandItems = items.filter(
        (item) =>
            item.growthTrend === "GROWING" ||
            item.growthTrend === "NEW_DEMAND"
    );

    const peakSeasonItems = items.filter(
        (item) => item.seasonality?.status === "PEAK_SEASON"
    );

    const limitedSeasonalHistoryItems = items.filter(
        (item) =>
            item.seasonality?.status === "LIMITED_HISTORY" ||
            item.seasonality?.status === "NO_HISTORY"
    );

    const projectedDemand = items.reduce(
        (total, item) => total + Number(item.forecastedDemand || 0),
        0
    );

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
            projectedDemand,
            expectedBookings: bookingForecast.expectedBookings,
            confirmedBookings: bookingForecast.confirmedBookings,
            preparingBookings: bookingForecast.preparingBookings,
            restockAlerts: restockItems.length,
            lowStockItems: lowItems.length,
            riskItems: riskItems.length,
            trackedItems: items.length,

            criticalStockoutAlerts: criticalStockoutAlerts.length,
            stockoutWithin7Days: stockoutWithin7Days.length,
            reorderNowItems: reorderNowItems.length,
            fastMovingItems: fastMovingItems.length,
            slowMovingItems: slowMovingItems.length,
            highDemandItems: highDemandItems.length,
            growingDemandItems: growingDemandItems.length,
            peakSeasonItems: peakSeasonItems.length,
            limitedSeasonalHistoryItems: limitedSeasonalHistoryItems.length,

            bookingAllocatedUnits:
            bookingForecast.allocationSummary.allocatedUnits,
            bookingsWithoutAllocation:
            bookingForecast.allocationSummary.bookingsWithoutAllocation,
        },

        notes: {
            dataSource:
                "Completed POS sales, current inventory, and confirmed or preparing bookings scheduled in the next 30 days.",
            demandLevel:
                "High, Moderate, and Low demand levels compare each item's projected 30-day demand with other items in the same branch. Stock quantity does not determine demand level.",
            seasonality:
                "Item-level seasonality compares the current calendar month with the item's own 12-month POS history. Signals based on one year are labelled preliminary.",
            growthCalculation:
                "Latest 4 weeks compared with the previous 4 weeks. The growth adjustment is limited from 0.70 to 1.30.",
            movementClassification:
                "Fast-moving: 5+ active sales weeks; Regular-moving: 3–4; Slow-moving: 1–2; No movement: 0.",
            timeBasedAlerts:
                "Uses the projected daily demand to estimate stockout within 3 or 7 days.",
            bookingForecast:
                "Counts confirmed and preparing bookings scheduled within the next 30 days. Package inclusion allocations are subtracted only when the saved package JSON contains product IDs.",
            allocatedQuantity:
                "Reserved quantity from matching upcoming booking package inclusions.",
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
    const monthRange = seasonalRange || getMonthRange(12);
    const historyMonths = Number(monthRange.historyMonths || 12);

    const monthlySales = await getMonthlySalesSummary(connection, {
        storeId,
        branchId: selectedBranchId,
        startDate: monthRange.startDate,
        endDate: monthRange.endDate,
    });

    const seasonal = buildSeasonalAnalysis(monthlySales, 12);

    return {
        success: true,
        action: "get_seasonal_forecast",
        generatedAt: new Date().toISOString(),
        scope: {
            storeId,
            branchId: selectedBranchId,
            role,
            historyMonths,
            historyStartDate: monthRange.startDate,
            historyEndDate: monthRange.endDate,
        },
        notes: {
            dataSource: "Completed POS sales only",
            requirement:
                "At least 12 distinct months of completed POS history are required before the system labels seasonal results as ready. The selected date range may include up to 60 calendar months.",
        },
        seasonal,
    };
}

async function buildBookingForecastResponse({
                                                connection,
                                                storeId,
                                                role,
                                                selectedBranchId,
                                            }) {
    const periodDays = 30;
    const bookingRange = getUpcomingBookingRange(periodDays);

    const upcomingBookings = await getUpcomingBookings(connection, {
        storeId,
        branchId: selectedBranchId,
        startDate: bookingRange.startDate,
        endDate: bookingRange.endDate,
    });

    const booking = buildBookingForecast(upcomingBookings, {
        periodDays,
    });

    return {
        success: true,
        action: "get_booking_forecast",
        generatedAt: new Date().toISOString(),
        scope: {
            storeId,
            branchId: selectedBranchId,
            role,
            periodDays,
            startDate: bookingRange.startDate,
            endDate: bookingRange.endDate,
        },
        notes: {
            dataSource:
                "Confirmed and preparing booking records scheduled in the next 30 days.",
            includedStatuses: ["Confirmed", "Preparing", "Approved"],
            allocationRule:
                "Inventory allocation is shown only for package inclusions with saved product IDs. Custom or legacy package rows without product IDs remain visible but are not subtracted from stock.",
        },
        booking,
    };
}


exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    let body = {};

    try {
        body = JSON.parse(event.body || "{}");
    } catch {
        return badRequest(headers, "Invalid JSON body.");
    }

    const action = normalizeAction(body.action);

    const validActions = [
        "get_inventory_forecast",
        "get_seasonal_forecast",
        "get_booking_forecast",
        "get_forecast_report",
    ];

    if (!action || !validActions.includes(action)) {
        return badRequest(headers, "Invalid or missing action.");
    }

    const authHeader = getTokenFromHeader(event);

    if (!authHeader) {
        return unauthorized(headers, "No token provided.");
    }

    let decoded;

    try {
        const token = authHeader.replace(/^Bearer\s+/i, "");
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        return unauthorized(headers, "Invalid token.");
    }

    const scope = getScopeFromToken(decoded, body, headers);

    if (scope.error) {
        return scope.error;
    }

    const { storeId, role, selectedBranchId } = scope;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        if (selectedBranchId) {
            const branchExists = await ensureBranchBelongsToStore(
                connection,
                selectedBranchId,
                storeId
            );

            if (!branchExists) {
                return badRequest(headers, "Invalid branch for this store.");
            }
        }

        if (action === "get_seasonal_forecast") {
            const seasonalRange = resolveSeasonalDateRange(body);

            if (seasonalRange.error) {
                return badRequest(headers, seasonalRange.error);
            }

            const seasonalResponse = await buildSeasonalForecastResponse({
                connection,
                storeId,
                role,
                selectedBranchId,
                seasonalRange,
            });

            return jsonResponse(200, headers, seasonalResponse);
        }

        if (action === "get_booking_forecast") {
            const bookingResponse = await buildBookingForecastResponse({
                connection,
                storeId,
                role,
                selectedBranchId,
            });

            return jsonResponse(200, headers, bookingResponse);
        }

        const inventoryResponse = await buildInventoryForecastResponse({
            connection,
            storeId,
            role,
            selectedBranchId,
        });

        if (action === "get_forecast_report") {
            inventoryResponse.action = "get_forecast_report";
        }

        return jsonResponse(200, headers, inventoryResponse);
    } catch (error) {
        return serverError(headers, error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};
