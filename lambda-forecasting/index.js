/*
 * StockNBook Forecasting Lambda (stocknbook_v2 database)
 *
 * Database and JWT settings come from environment variables (same names as the Bookings Lambda):
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT (optional), JWT_SECRET
 * Never write passwords or secrets in this file.
 */

const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");

const {
    buildInventoryForecast,
    assignDemandLevels,
    buildSeasonalAnalysis,
    buildBookingForecast,
} = require("./forecastingEngine");

const {
    ensureBranchBelongsToStore,
    getUserPermissions,
    getWeekWindows,
    getMonthRange,
    getUpcomingBookingRange,
    getInventoryItems,
    getHistoricalSales,
    getMonthlySalesSummary,
    getUpcomingBookings,
    getUpcomingBookingAllocationSummary,
    buildWeeklyDemandMap,
} = require("./forecastingRepository");

const planning = require("./planningRepository");
const {
    addDays: planAddDays,
    addMonthKey,
    monthRange,
    buildStockPlan,
    buildAccuracy,
    matchPastEvent,
    buildEventForecast,
} = require("./planningEngine");

const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "JWT_SECRET"];

function missingEnvironment() {
    return REQUIRED_ENV.filter((name) => {
        const value = process.env[name];
        return typeof value !== "string" || !value.trim();
    });
}

// Reuse one connection pool across warm invocations; Promise.all() uses separate pooled connections.
let databasePool;

function getDatabasePool() {
    if (!databasePool) {
        databasePool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: Number(process.env.DB_PORT || 3306),
            // Same as the Bookings Lambda (works for local MySQL and AWS RDS).
            ssl: { rejectUnauthorized: false },
            waitForConnections: true,
            connectionLimit: 4,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0,
            connectTimeout: 10000,
            decimalNumbers: true,
        });
    }

    return databasePool;
}

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

function forbidden(headers, message) {
    return jsonResponse(403, headers, { error: message });
}

function serverError(headers, error) {
    console.error("Forecasting Lambda error:", error);

    return jsonResponse(500, headers, {
        error: "Forecasting service failed. Check the server log for details.",
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
    const storeId = toPositiveInteger(decoded?.store_id ?? decoded?.storeId);
    const role = getRole(decoded);
    const tokenBranchId = toPositiveInteger(decoded?.branch_id ?? decoded?.branchId);
    const requestedBranchId = toPositiveInteger(body.branch_id ?? body.branchId);

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

    if (!["owner", "manager", "staff"].includes(role)) {
        return {
            error: forbidden(
                headers,
                "Your account role is not allowed to view forecasting."
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
            : requestedBranchId,
    };
}

// v2 permissions are saved as true / "full" / "view" (or "none" / false).
function forecastingAccess(permissions) {
    const value = permissions?.forecasting_access ?? permissions?.forecasting;

    if ([true, 1, "1", "true", "full", "view", "view_only"].includes(value)) return "allowed";
    if ([false, 0, "0", "false", "none"].includes(value)) return "denied";
    return "unset";
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
    const periodDays = 30;
    const leadTimeDays = 3;

    const weekWindows = getWeekWindows(historyWeeks);
    const bookingRange = getUpcomingBookingRange(periodDays);

    const historyStartDate = weekWindows[0].startDate;
    const historyEndDate =
        weekWindows[weekWindows.length - 1].endDate;

    /*
      Keep the main Product Demand request small and fast.
      Seasonal history and detailed upcoming bookings have their own actions.
    */
    const [
        inventoryItems,
        historicalSales,
        bookingAllocationSummary,
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

        getUpcomingBookingAllocationSummary(connection, {
            storeId,
            branchId: selectedBranchId,
            startDate: bookingRange.startDate,
            endDate: bookingRange.endDate,
        }),
    ]);

    const weeklyDemandMap = buildWeeklyDemandMap(
        inventoryItems,
        historicalSales,
        weekWindows
    );

    const rawItems = inventoryItems.map((item) => {
        const weeklyDemand =
            weeklyDemandMap.get(item.id) ||
            Array(historyWeeks).fill(0);

        /*
          Units already held for confirmed bookings come straight from the Inventory
          module (branch_inventory.reserved_quantity), so "available" here matches
          the Inventory page: usable stock − reserved.
        */
        const allocatedQuantity = Number(item.reservedQuantity || 0);

        const forecast = buildInventoryForecast({
            weeklyDemand,
            onHandQuantity: item.onHandQuantity,
            allocatedQuantity,
            lowStockThreshold: item.lowStockThreshold,
            safetyStock: item.lowStockThreshold,
            periodDays,
            leadTimeDays,
        });

        // Only the fields used by the Product Demand interface.
        return {
            ...item,

            currentStock: forecast.onHandQuantity,
            onHandQuantity: forecast.onHandQuantity,
            allocatedQuantity: forecast.allocatedQuantity,
            availableQuantity: forecast.availableQuantity,

            historyWeeks,
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
            averageWeeklyDemand: forecast.averageWeeklyDemand,

            movementClass: forecast.movementClass,
            dailyDemand: forecast.dailyDemand,
            daysUntilStockout: forecast.daysUntilStockout,

            reorderPoint: forecast.reorderPoint,
            reorderNow: forecast.reorderNow,
            leadTimeDays: forecast.leadTimeDays,

            timeAlert: forecast.timeAlert,
            alertSeverity: forecast.alertSeverity,
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
            bookingAllocationSummary.expectedBookings,

            confirmedBookings:
            bookingAllocationSummary.confirmedBookings,

            preparingBookings:
            bookingAllocationSummary.preparingBookings,

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

            // Branch-level seasonality is returned by get_seasonal_forecast.
            peakSeasonItems: 0,

            bookingAllocatedUnits:
            bookingAllocationSummary.allocationSummary
                .allocatedUnits,

            bookingsWithoutAllocation:
            bookingAllocationSummary.allocationSummary
                .bookingsWithoutAllocation,
        },

        notes: {
            dataSource:
                "Completed POS sales, current branch inventory, and stock already reserved for confirmed bookings.",

            seasonality:
                "Branch seasonal patterns are loaded separately by get_seasonal_forecast.",

            bookingForecast:
                "Detailed booking demand is loaded separately by get_booking_forecast.",
        },

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

        notes: {
            dataSource: "Bookings with an event date in the next 30 days.",
            includedStatuses: ["Confirmed", "Preparing", "Released"],
            allocationRule: "Consumables and rental equipment booked for each booking (package lines and cancelled lines excluded).",
        },

        booking: buildBookingForecast(bookings, {
            periodDays,
        }),
    };
}

/* -------------------------------------------------------
 * STOCK PLAN, FORECAST ACCURACY AND EVENTS
 * ------------------------------------------------------- */

const PLANNING_ACTIONS = [
    "get_seasonal_stock_plan",
    "get_forecast_accuracy",
    "list_store_events",
    "save_store_event",
    "delete_store_event",
    "get_event_forecast",
];

function userError(message, statusCode = 400) {
    const error = new Error(message);
    error.userMessage = message;
    error.statusCode = statusCode;
    return error;
}

// Today in the Philippines (the store's business day), YYYY-MM-DD.
function manilaToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Inventory numbers (stock on hand, units owned, how much to prepare) are hidden from Staff, like the Product Demand tab.
const canViewStock = (role) => role === "owner" || role === "manager";

// Owners, and Managers whose Forecasting access is not view-only, can add and change events.
function canEditEvents(role, permissions) {
    if (role === "owner") return true;
    if (role !== "manager") return false;
    const value = permissions?.forecasting_access ?? permissions?.forecasting;
    return !["view", "view_only"].includes(value);
}

function validDate(value, label) {
    const text = String(value || "").trim();
    const date = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text)
        throw userError(`Enter a valid ${label} (YYYY-MM-DD).`);
    return text;
}

async function planningResponse({ action, body, decoded, scope, permissions, connection, headers }) {
    const today = manilaToday();
    const { storeId, role, selectedBranchId } = scope;
    const responseScope = { storeId, branchId: selectedBranchId, role };
    const currentKey = today.slice(0, 7);
    // Up to three years of complete months before this month.
    const historyKeys = monthRange(addMonthKey(currentKey, -36), addMonthKey(currentKey, -1));
    const lastComplete = `${historyKeys[historyKeys.length - 1]}-${String(new Date(Date.UTC(...historyKeys[historyKeys.length - 1].split("-").map(Number), 0)).getUTCDate()).padStart(2, "0")}`;

    if (action === "get_seasonal_stock_plan") {
        const monthsAhead = Math.min(3, Math.max(1, Number(body.months_ahead ?? body.monthsAhead ?? 3) || 3));
        const horizonEnd = planAddDays(`${addMonthKey(currentKey, monthsAhead + 1)}-01`, -1);
        const [productMonthly, productStock, equipmentOwned, rentalPeriods] = await Promise.all([
            planning.getMonthlyProductUnits(connection, { storeId, branchId: selectedBranchId, startDate: `${historyKeys[0]}-01`, endDate: lastComplete }),
            planning.getProductStock(connection, { storeId, branchId: selectedBranchId }),
            planning.getEquipmentOwned(connection, { storeId, branchId: selectedBranchId }),
            planning.getRentalPeriods(connection, { storeId, branchId: selectedBranchId, startDate: `${historyKeys[0]}-01`, endDate: horizonEnd }),
        ]);
        // Only months the store actually has sales for count as history.
        const firstSales = productMonthly.reduce((min, r) => (r.monthKey < min ? r.monthKey : min), currentKey);
        const keys = historyKeys.filter((k) => k >= firstSales);
        return jsonResponse(200, headers, buildStockPlan({ today, monthsAhead, historyKeys: keys.length ? keys : historyKeys,
            productMonthly, productStock, equipmentOwned, rentalPeriods, canViewStock: canViewStock(role), scope: responseScope }));
    }

    if (action === "get_forecast_accuracy") {
        const firstTest = addMonthKey(currentKey, -6);
        const [productMonthly, weeklyUnits] = await Promise.all([
            planning.getMonthlyProductUnits(connection, { storeId, branchId: selectedBranchId,
                startDate: `${addMonthKey(firstTest, -36)}-01`, endDate: lastComplete }),
            planning.getWeeklyProductUnits(connection, { storeId, branchId: selectedBranchId,
                startDate: planAddDays(`${firstTest}-01`, -91), endDate: lastComplete }),
        ]);
        const stock = await planning.getProductStock(connection, { storeId, branchId: selectedBranchId });
        const categories = new Map(stock.map((r) => [Number(r.productId), String(r.category)]));
        return jsonResponse(200, headers, buildAccuracy({ today, testMonths: 6, productMonthly, weeklyUnits, categories, scope: responseScope }));
    }

    if (action === "list_store_events") {
        const events = await planning.listEvents(connection, { storeId, branchId: role === "owner" ? null : selectedBranchId });
        return jsonResponse(200, headers, { success: true, action, scope: responseScope, today,
            canEdit: canEditEvents(role, permissions), types: planning.EVENT_TYPES,
            events: events.map((e) => ({ ...e, status: e.endDate < today ? "past" : e.startDate <= today ? "ongoing" : "upcoming" })) });
    }

    if (action === "save_store_event" || action === "delete_store_event") {
        if (!canEditEvents(role, permissions)) throw userError("Only the Owner or a Manager can change events.", 403);
        const eventId = Number(body.id ?? body.event_id) || null;
        const existing = eventId ? await planning.getEvent(connection, { storeId, eventId }) : null;
        if (eventId && !existing) throw userError("Event not found.", 404);
        // Managers change only their own branch's events.
        if (role === "manager" && existing && Number(existing.branchId) !== Number(selectedBranchId))
            throw userError("Managers can change only their own branch's events.", 403);
        if (action === "delete_store_event") {
            await planning.deleteEvent(connection, { storeId, eventId });
            return jsonResponse(200, headers, { success: true, action, deleted: eventId });
        }
        const name = String(body.name ?? body.event_name ?? "").trim();
        if (name.length < 3 || name.length > 150) throw userError("Enter an event name (3–150 characters).");
        const type = String(body.type ?? body.event_type ?? "other").trim().toLowerCase();
        if (!planning.EVENT_TYPES.includes(type)) throw userError(`Choose an event type: ${planning.EVENT_TYPES.join(", ")}.`);
        const startDate = validDate(body.start_date ?? body.startDate, "start date");
        const endDate = validDate(body.end_date ?? body.endDate, "end date");
        if (endDate < startDate) throw userError("The end date must be on or after the start date.");
        if (planAddDays(startDate, 366) < endDate) throw userError("An event can last at most one year.");
        const notes = String(body.notes ?? "").trim().slice(0, 500) || null;
        let branchId = role === "manager" ? selectedBranchId : (Number(body.branch_id ?? body.branchId) || null);
        if (role === "owner" && branchId) {
            const ok = await ensureBranchBelongsToStore(connection, branchId, storeId);
            if (!ok) throw userError("Invalid branch for this store.");
        }
        if (role === "owner" && body.all_branches === true) branchId = null;
        const userId = Number(decoded.user_id ?? decoded.userId ?? decoded.id ?? decoded.sub) || null;
        const id = await planning.saveEvent(connection, { storeId, eventId, branchId, name, type, startDate, endDate, notes, userId });
        return jsonResponse(200, headers, { success: true, action, id });
    }

    // get_event_forecast: every ongoing or upcoming event in the next two years (or one event).
    const events = await planning.listEvents(connection, { storeId, branchId: role === "owner" ? null : selectedBranchId });
    const horizon = planAddDays(today, 730);
    const wanted = Number(body.event_id ?? body.eventId) || null;
    const upcoming = events.filter((e) => (wanted ? Number(e.id) === wanted : e.endDate >= today && e.startDate <= horizon))
        .filter((e) => !selectedBranchId || !e.branchId || Number(e.branchId) === Number(selectedBranchId));
    const results = [];
    for (const event of upcoming.slice(0, 8)) {
        const past = matchPastEvent(event, events, today);
        if (!past) { results.push(buildEventForecast({ event, past: null, today, data: null })); continue; }
        // Normal demand: the 12 months before the past event (the engine scales it to the event's length).
        const baseStart = planAddDays(past.startDate, -365), baseEnd = planAddDays(past.startDate, -1);
        const q = { storeId, branchId: selectedBranchId };
        const [pastProducts, baselineProducts, pastSales, baselineSales, salesRecent, salesBefore, pastActivity, baselineActivity, stock, owned] = await Promise.all([
            planning.getProductUnitsBetween(connection, { ...q, startDate: past.startDate, endDate: past.endDate }),
            planning.getProductUnitsBetween(connection, { ...q, startDate: baseStart, endDate: baseEnd }),
            planning.getSalesTotalBetween(connection, { ...q, startDate: past.startDate, endDate: past.endDate }),
            planning.getSalesTotalBetween(connection, { ...q, startDate: baseStart, endDate: baseEnd }),
            planning.getSalesTotalBetween(connection, { ...q, startDate: planAddDays(today, -365), endDate: planAddDays(today, -1) }),
            planning.getSalesTotalBetween(connection, { ...q, startDate: planAddDays(past.endDate, -364), endDate: past.endDate }),
            planning.getBookingActivityBetween(connection, { ...q, startDate: past.startDate, endDate: past.endDate }),
            planning.getBookingActivityBetween(connection, { ...q, startDate: baseStart, endDate: baseEnd }),
            planning.getProductStock(connection, q),
            planning.getEquipmentOwned(connection, q),
        ]);
        results.push(buildEventForecast({ event, past, today, canViewStock: canViewStock(role), data: {
                pastProducts, baselineProducts, pastSales, baselineSales, salesRecent, salesBefore,
                pastEquipment: pastActivity.equipment, baselineEquipment: baselineActivity.equipment,
                pastTypes: pastActivity.types, baselineTypes: baselineActivity.types, stock, owned } }));
    }
    return jsonResponse(200, headers, { success: true, action, scope: responseScope, today, events: results });
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

    const missing = missingEnvironment();

    if (missing.length) {
        return jsonResponse(500, headers, {
            error:
                "Forecasting server configuration is incomplete. " +
                `Set ${missing.join(", ")} in the environment (.env.local or the Lambda settings).`,
        });
    }

    let body;

    try {
        body = typeof event?.body === "object" && event.body !== null
            ? event.body
            : JSON.parse(event?.body || "{}");
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
        ...PLANNING_ACTIONS,
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
            process.env.JWT_SECRET
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

    try {
        const connection = getDatabasePool();

        // Managers and Staff: the account must be active, and Staff need Forecasting access.
        let permissions = null;
        if (scope.role !== "owner") {
            permissions = await getUserPermissions(
                connection,
                decoded,
                scope.storeId,
                scope.role
            );

            if (!permissions) {
                return forbidden(
                    headers,
                    "Your account was not found or is inactive in this store."
                );
            }

            const access = forecastingAccess(permissions);

            if (access === "denied" || (scope.role === "staff" && access !== "allowed")) {
                return forbidden(
                    headers,
                    "You do not have permission to view forecasting."
                );
            }
        }

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

        if (PLANNING_ACTIONS.includes(action)) {
            return await planningResponse({ action, body, decoded, scope, permissions, connection, headers });
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
        if (error && error.code === "ER_NO_SUCH_TABLE" && /store_events/.test(String(error.message))) {
            return jsonResponse(409, headers, {
                error: "Events are not set up in this database yet. Run store-events-migration.sql in MySQL Workbench first.",
            });
        }
        if (error && error.userMessage) {
            return jsonResponse(error.statusCode || 400, headers, { error: error.userMessage });
        }
        return serverError(headers, error);
    }
};
