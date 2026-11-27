/*
 * StockNBook Analytics Engine — Revised V2
 *
 * Sections:
 * 1. Sales Performance & Trends
 * 2. Product & Category Demand
 * 3. Booking & Rental Trends
 * 4. Package Demand Analysis
 * 5. Branch Performance (Owner only)
 *
 * Analytics describes historical activity only.
 * Forecasting remains a separate module.
 */

// Accepted = down payment paid or later (same statuses as the Bookings module's sales).
const ACCEPTED_BOOKING_STATUSES = new Set([
    "confirmed",
    "preparing",
    "released",
    "return inspection",
    "pending settlement",
    "completed",
]);

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const MONTH_FORMATTER = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
});

function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

function normalizeText(value) {
    return String(value ?? "").trim();
}

function normalizeStatus(value) {
    return normalizeText(value).toLowerCase();
}

function toDateOnly(value) {
    const text = normalizeText(value).slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return null;
    }

    const date = new Date(`${text}T00:00:00.000Z`);

    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== text
    ) {
        return null;
    }

    return text;
}

function parseDate(value) {
    const dateOnly = toDateOnly(value);

    return dateOnly
        ? new Date(`${dateOnly}T00:00:00.000Z`)
        : null;
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const result = new Date(date.getTime());
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function addMonths(date, months) {
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth() + months,
            1
        )
    );
}

function monthKey(dateOnly) {
    const date = toDateOnly(dateOnly);
    return date ? date.slice(0, 7) : null;
}

function monthLabel(key) {
    const date = parseDate(`${key}-01`);
    return date ? MONTH_FORMATTER.format(date) : key;
}

function monthKeys(startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (!start || !end || start > end) return [];

    const result = [];
    let cursor = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
    );

    const last = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)
    );

    while (cursor <= last) {
        result.push(isoDate(cursor).slice(0, 7));
        cursor = addMonths(cursor, 1);
    }

    return result;
}

function inRange(date, startDate, endDate) {
    const normalized = toDateOnly(date);

    return Boolean(
        normalized &&
        normalized >= startDate &&
        normalized <= endDate
    );
}

function percentChange(current, previous) {
    const currentValue = toNumber(current);
    const previousValue = toNumber(previous);

    if (previousValue <= 0) {
        return null;
    }

    return round(
        ((currentValue - previousValue) / previousValue) * 100,
        1
    );
}

function changeDetails(current, previous) {
    const currentValue = toNumber(current);
    const previousValue = toNumber(previous);

    if (previousValue <= 0) {
        return {
            percentage: null,
            direction:
                currentValue > 0 ? "new-activity" : "no-activity",
            label:
                currentValue > 0 ? "New activity" : "No activity",
        };
    }

    const percentage = percentChange(
        currentValue,
        previousValue
    );

    return {
        percentage,
        direction:
            percentage > 0
                ? "increasing"
                : percentage < 0
                    ? "decreasing"
                    : "unchanged",
        label:
            percentage > 0
                ? `+${percentage}%`
                : `${percentage}%`,
    };
}

function salesComparison(current, previous) {
    const currentValue = toNumber(current);
    const previousValue = toNumber(previous);

    // A percentage change cannot be calculated
    // when the previous period has zero qualifying sales.
    if (previousValue <= 0) {
        return {
            percentage: null,
            direction: "unavailable",
            label: "N/A",
            explanation:
                "No qualifying sales recorded in the comparison period.",
        };
    }

    const result = changeDetails(
        currentValue,
        previousValue
    );

    return {
        ...result,
        explanation:
            "Calculated against recorded sales in the comparison period.",
    };
}

function sum(rows, field) {
    return rows.reduce(
        (total, row) => total + toNumber(row[field]),
        0
    );
}

function groupSum(rows, keyFunction, valueFunction) {
    const result = new Map();

    for (const row of rows) {
        const key = keyFunction(row);

        if (key === null || key === undefined || key === "") {
            continue;
        }

        result.set(
            key,
            (result.get(key) || 0) + toNumber(valueFunction(row))
        );
    }

    return result;
}

function createMonthlySeries(
    rows,
    startDate,
    endDate,
    dateField,
    valueField
) {
    const sums = groupSum(
        rows.filter(row =>
            inRange(row[dateField], startDate, endDate)
        ),
        row => monthKey(row[dateField]),
        row => row[valueField]
    );

    return monthKeys(startDate, endDate).map(key => ({
        key,
        label: monthLabel(key),
        value: round(sums.get(key) || 0),
    }));
}

function highestAndLowest(items) {
    if (!items.length) {
        return { highest: null, lowest: null };
    }

    const sorted = [...items].sort(
        (a, b) => b.value - a.value
    );

    return {
        highest: sorted[0],
        lowest: sorted[sorted.length - 1],
    };
}

function sameCalendarPeriodPreviousYear(startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (!start || !end) {
        throw new Error("Invalid comparison dates.");
    }

    function previousYear(date) {
        const year = date.getUTCFullYear() - 1;
        const month = date.getUTCMonth();
        const day = date.getUTCDate();

        const lastDay = new Date(
            Date.UTC(year, month + 1, 0)
        ).getUTCDate();

        return new Date(
            Date.UTC(year, month, Math.min(day, lastDay))
        );
    }

    return {
        startDate: isoDate(previousYear(start)),
        endDate: isoDate(previousYear(end)),
    };
}

/*
 * Reporting range
 *
 * Default: last 12 completed calendar months.
 *
 * Presets:
 * 30, 60, 90, 180 days
 * 12m (12 completed months)
 * Custom: maximum 366 days
 */
function buildRange(input = {}, now = new Date()) {
    const today = new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
        )
    );

    let start;
    let end;
    let kind;
    let label;

    const requestedStart = input.startDate ?? input.start_date;
    const requestedEnd = input.endDate ?? input.end_date;

    if (requestedStart || requestedEnd) {
        start = parseDate(requestedStart);
        end = parseDate(requestedEnd);
        kind = "custom";

        if (!start || !end || start > end) {
            throw new Error("Invalid analytics date range.");
        }

        label = `${isoDate(start)} to ${isoDate(end)}`;
    } else if (
        String(input.period ?? input.periodDays ?? "12m") === "12m"
    ) {
        end = new Date(
            Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)
        );

        start = new Date(
            Date.UTC(
                end.getUTCFullYear(),
                end.getUTCMonth() - 11,
                1
            )
        );

        kind = "preset";
        label = "Last 12 complete months";
    } else {
        const requestedDays = Number(
            input.period ?? input.periodDays ?? 30
        );

        if (![30, 60, 90, 180].includes(requestedDays)) {
            throw new Error("Invalid analytics reporting period.");
        }

        start = addDays(today, -(requestedDays - 1));
        end = today;
        kind = "preset";
        label = `Last ${requestedDays} days`;
    }

    const days =
        Math.round(
            (end.getTime() - start.getTime()) / 86400000
        ) + 1;

    if (days > 366) {
        throw new Error(
            "Analytics date range cannot exceed 366 days."
        );
    }

    const previousEnd = addDays(start, -1);
    const previousStart = addDays(previousEnd, -(days - 1));

    const previousYear = sameCalendarPeriodPreviousYear(
        isoDate(start),
        isoDate(end)
    );

    return {
        kind,
        label,
        days,
        startDate: isoDate(start),
        endDate: isoDate(end),
        previousStartDate: isoDate(previousStart),
        previousEndDate: isoDate(previousEnd),
        previousYearStartDate: previousYear.startDate,
        previousYearEndDate: previousYear.endDate,
    };
}

/* -------------------------------------------------------
 * 1. SALES PERFORMANCE & TRENDS
 * ------------------------------------------------------- */

function buildSalesAnalytics(rows, range) {
    const allRows = Array.isArray(rows) ? rows : [];

    const current = allRows.filter(row =>
        inRange(row.day, range.startDate, range.endDate)
    );

    const previous = allRows.filter(row =>
        inRange(
            row.day,
            range.previousStartDate,
            range.previousEndDate
        )
    );

    const lastYear = allRows.filter(row =>
        inRange(
            row.day,
            range.previousYearStartDate,
            range.previousYearEndDate
        )
    );

    const currentSales = sum(current, "value");
    const previousSales = sum(previous, "value");
    const previousYearSales = sum(lastYear, "value");

    const monthlySales = createMonthlySeries(
        allRows,
        range.startDate,
        range.endDate,
        "day",
        "value"
    );

    const monthlyPreviousYear = createMonthlySeries(
        allRows,
        range.previousYearStartDate,
        range.previousYearEndDate,
        "day",
        "value"
    );

    const branchMap = groupSum(
        current,
        row => String(row.branchId || ""),
        row => row.value
    );

    const branchNames = new Map();

    for (const row of current) {
        branchNames.set(
            String(row.branchId),
            row.branchName || `Branch ${row.branchId}`
        );
    }

    return {
        totalSales: round(currentSales),
        previousSales: round(previousSales),
        previousYearSales: round(previousYearSales),
        orderCount: sum(current, "orders"),

        periodChange: salesComparison(
            currentSales,
            previousSales
        ),
        yearOverYearChange: salesComparison(
            currentSales,
            previousYearSales
        ),
        monthlySales,
        monthlyPreviousYear,
        highlights: highestAndLowest(monthlySales),
        salesByBranch: Array.from(branchMap.entries()).map(
            ([branchId, value]) => ({
                branchId: Number(branchId),
                branchName: branchNames.get(branchId),
                value: round(value),
            })
        ),
    };
}

/* -------------------------------------------------------
 * 2. PRODUCT & CATEGORY DEMAND
 * ------------------------------------------------------- */

function buildProductAnalytics(rows, range) {
    const allRows = Array.isArray(rows) ? rows : [];

    const current = allRows.filter(row =>
        inRange(row.day, range.startDate, range.endDate)
    );

    const previous = allRows.filter(row =>
        inRange(
            row.day,
            range.previousStartDate,
            range.previousEndDate
        )
    );

    const categoryName = row =>
        normalizeText(row.category) || "Uncategorized";

    const productKey = row =>
        `${row.productId ?? "unknown"}:${row.variantId ?? "base"}`;

    const categoryUnits = groupSum(
        current,
        categoryName,
        row => row.units
    );

    const categoryPrevious = groupSum(
        previous,
        categoryName,
        row => row.units
    );

    const categories = Array.from(categoryUnits.entries())
        .map(([name, units]) => ({
            name,
            units: round(units),
            change: changeDetails(
                units,
                categoryPrevious.get(name) || 0
            ),
        }))
        .sort((a, b) => b.units - a.units);

    const productUnits = groupSum(
        current,
        productKey,
        row => row.units
    );

    const previousProductUnits = groupSum(
        previous,
        productKey,
        row => row.units
    );

    const productNames = new Map();

    for (const row of current) {
        productNames.set(productKey(row), {
            productId: row.productId,
            variantId: row.variantId,
            name: normalizeText(row.productName) ||
                `Product ${row.productId}`,
            category: categoryName(row),
        });
    }

    const products = Array.from(productUnits.entries())
        .map(([key, units]) => ({
            key,
            ...productNames.get(key),
            units: round(units),
            change: changeDetails(
                units,
                previousProductUnits.get(key) || 0
            ),
        }))
        .sort((a, b) => b.units - a.units);

    const hourlyMap = groupSum(
        current.filter(row =>
            Number.isInteger(Number(row.purchaseHour)) &&
            row.purchaseHour !== null &&
            Number(row.purchaseHour) >= 0 &&
            Number(row.purchaseHour) <= 23
        ),
        row => Number(row.purchaseHour),
        row => row.units
    );

    const hourlyDemand = Array.from(
        { length: 24 },
        (_, hour) => ({
            hour,
            label: `${String(hour).padStart(2, "0")}:00`,
            units: round(hourlyMap.get(hour) || 0),
        })
    );

    // When each category is bought (units per hour), and which weekday + hour is busiest.
    const categoryHours = new Map();
    const weekdayHours = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const row of current) {
        const hour = Number(row.purchaseHour);
        if (row.purchaseHour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        const units = toNumber(row.units);
        const name = categoryName(row);
        if (!categoryHours.has(name)) categoryHours.set(name, Array(24).fill(0));
        categoryHours.get(name)[hour] += units;
        const day = parseDate(row.day);
        if (day) weekdayHours[day.getUTCDay()][hour] += units;
    }
    const peakIndex = (values) => values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
    const categoryHourly = Array.from(categoryHours.entries())
        .map(([name, hours]) => ({
            name,
            units: round(hours.reduce((a, b) => a + b, 0)),
            peakHour: peakIndex(hours),
            hours: hours.map((v) => round(v)),
        }))
        .sort((a, b) => b.units - a.units);
    const weekdayHourly = weekdayHours.map((hours, weekday) => ({
        weekday,
        label: WEEKDAY_LABELS[weekday],
        units: round(hours.reduce((a, b) => a + b, 0)),
        hours: hours.map((v) => round(v)),
    }));

    return {
        totalUnits: round(sum(current, "units")),
        categories,
        products,
        hourlyDemand,
        categoryHourly,
        weekdayHourly,
        monthlyDemand: createMonthlySeries(
            current,
            range.startDate,
            range.endDate,
            "day",
            "units"
        ),
        highestDemandProducts: products.slice(0, 5),
        lowestDemandProducts: [...products]
            .reverse()
            .slice(0, 5),
    };
}

/* -------------------------------------------------------
 * 3. BOOKING & RENTAL TRENDS
 * ------------------------------------------------------- */

function buildBookingAnalytics(
    bookingRows,
    bookingItemRows,
    range
) {
    const validBookings = (
        Array.isArray(bookingRows) ? bookingRows : []
    ).filter(row =>
        ACCEPTED_BOOKING_STATUSES.has(
            normalizeStatus(row.status)
        )
    );

    const current = validBookings.filter(row =>
        inRange(row.day, range.startDate, range.endDate)
    );

    const previous = validBookings.filter(row =>
        inRange(
            row.day,
            range.previousStartDate,
            range.previousEndDate
        )
    );

    const bookingTypes = groupSum(
        current,
        row => normalizeText(row.bookingType) || "Unspecified",
        () => 1
    );

    const currentBookingIds = new Set(
        current.map(row => String(row.bookingId))
    );

    const bookingItems = (
        Array.isArray(bookingItemRows) ? bookingItemRows : []
    ).filter(row =>
        currentBookingIds.has(String(row.bookingId))
    );

    const itemDemand = groupSum(
        bookingItems,
        row => normalizeText(row.productName) ||
            `Product ${row.productId}`,
        row => row.bookedUnits
    );

    return {
        totalBookings: current.length,
        change: changeDetails(
            current.length,
            previous.length
        ),
        monthlyBookings: createMonthlySeries(
            current.map(row => ({
                ...row,
                bookingCount: 1,
            })),
            range.startDate,
            range.endDate,
            "day",
            "bookingCount"
        ),
        bookingTypes: Array.from(bookingTypes.entries())
            .map(([name, count]) => ({
                name,
                count,
            }))
            .sort((a, b) => b.count - a.count),
        bookedItems: Array.from(itemDemand.entries())
            .map(([name, units]) => ({
                name,
                units: round(units),
            }))
            .sort((a, b) => b.units - a.units),
        totalBookedItemUnits: round(
            sum(bookingItems, "bookedUnits")
        ),
    };
}

function buildRentalAnalytics(rows, range) {
    const all = Array.isArray(rows) ? rows : [];
    const eligible = all.filter(row =>
        ACCEPTED_BOOKING_STATUSES.has(normalizeStatus(row.bookingStatus)) &&
        normalizeStatus(row.itemStatus) !== "cancelled"
    );
    const booked = eligible.filter(row => inRange(row.bookingDay, range.startDate, range.endDate));
    const released = eligible.filter(row => inRange(row.releaseDay, range.startDate, range.endDate));
    const returned = eligible.filter(row => inRange(row.returnDay, range.startDate, range.endDate));
    const sumSafe = (items, field) => round(items.reduce((total, row) => total + Math.max(0, toNumber(row[field])), 0));
    const uniqueBookings = new Set(booked.map(row => String(row.bookingId))).size;
    const byEquipment = new Map();
    for (const row of booked) {
        const key = String(row.equipmentId ?? row.equipmentName ?? row.bookingItemId);
        const previous = byEquipment.get(key) || {name: normalizeText(row.equipmentName) || "Unnamed equipment", units: 0};
        previous.units += Math.max(0, toNumber(row.bookedUnits));
        byEquipment.set(key, previous);
    }
    return {
        bookingCount: uniqueBookings,
        bookedUnits: sumSafe(booked, "bookedUnits"),
        releasedUnits: sumSafe(released, "bookedUnits"),
        returnedUnits: sumSafe(returned, "returnedUnits"),
        damagedUnits: sumSafe(returned, "damagedUnits"),
        missingUnits: sumSafe(returned, "missingUnits"),
        returnRecords: returned.length,
        topEquipment: [...byEquipment.values()].sort((a,b) => b.units-a.units).slice(0,8),
        equipmentByMonth: buildEquipmentByMonth(booked, range),
        monthlyBookedUnits: createMonthlySeries(booked.map(row => ({day: row.bookingDay, units: Math.max(0,toNumber(row.bookedUnits))})),range.startDate,range.endDate,"day","units"),
    };
}

/* Booked units of each rental item per month (the 12 most booked items). */
function buildEquipmentByMonth(bookedRows, range) {
    const keys = monthKeys(range.startDate, range.endDate);
    const byItem = new Map();
    for (const row of bookedRows) {
        const key = monthKey(row.bookingDay);
        const index = keys.indexOf(key);
        if (index < 0) continue;
        const id = String(row.equipmentId ?? row.equipmentName);
        if (!byItem.has(id)) byItem.set(id, { name: normalizeText(row.equipmentName) || "Unnamed equipment", units: Array(keys.length).fill(0), total: 0 });
        const item = byItem.get(id);
        const units = Math.max(0, toNumber(row.bookedUnits));
        item.units[index] += units;
        item.total += units;
    }
    return {
        months: keys.map((key) => ({ key, label: monthLabel(key) })),
        items: [...byItem.values()].sort((a, b) => b.total - a.total).slice(0, 12)
            .map((item) => ({ ...item, total: round(item.total), units: item.units.map((v) => round(v)) })),
    };
}

/* -------------------------------------------------------
 * 4. PACKAGE DEMAND ANALYSIS
 * ------------------------------------------------------- */

function buildPackageAnalytics(bookingRows, range) {
    const rows = (
        Array.isArray(bookingRows) ? bookingRows : []
    ).filter(row =>
        ACCEPTED_BOOKING_STATUSES.has(
            normalizeStatus(row.status)
        )
    );

    const packageName = row =>
        normalizeText(row.packageName);

    const current = rows.filter(row =>
        inRange(row.day, range.startDate, range.endDate) &&
        packageName(row)
    );

    const previous = rows.filter(row =>
        inRange(
            row.day,
            range.previousStartDate,
            range.previousEndDate
        ) && packageName(row)
    );

    const currentCounts = groupSum(
        current,
        packageName,
        () => 1
    );

    const previousCounts = groupSum(
        previous,
        packageName,
        () => 1
    );

    const packages = Array.from(currentCounts.entries())
        .map(([name, count]) => ({
            name,
            bookings: count,
            change: changeDetails(
                count,
                previousCounts.get(name) || 0
            ),
        }))
        .sort((a, b) => b.bookings - a.bookings);

    return {
        totalPackageBookings: current.length,
        packages,
        monthlyPackageBookings: createMonthlySeries(
            current.map(row => ({
                ...row,
                count: 1,
            })),
            range.startDate,
            range.endDate,
            "day",
            "count"
        ),
        highestDemandPackages: packages.slice(0, 5),
        lowestDemandPackages: [...packages]
            .reverse()
            .slice(0, 5),
    };
}

/* -------------------------------------------------------
 * 5. OWNER BRANCH PERFORMANCE
 * ------------------------------------------------------- */

function buildBranchAnalytics(salesRows, range, scope) {
    if (scope.role !== "owner") {
        return null;
    }

    const allRows = Array.isArray(salesRows)
        ? salesRows
        : [];

    const current = allRows.filter(row =>
        inRange(row.day, range.startDate, range.endDate)
    );

    const branchMap = new Map();

    for (const row of current) {
        const branchId = Number(row.branchId);

        if (!branchId) continue;

        if (!branchMap.has(branchId)) {
            branchMap.set(branchId, {
                branchId,
                branchName:
                    row.branchName || `Branch ${branchId}`,
                totalSales: 0,
                rows: [],
            });
        }

        const branch = branchMap.get(branchId);
        branch.totalSales += toNumber(row.value);
        branch.rows.push(row);
    }

    const branches = Array.from(branchMap.values())
        .map(branch => ({
            branchId: branch.branchId,
            branchName: branch.branchName,
            totalSales: round(branch.totalSales),
            monthlySales: createMonthlySeries(
                branch.rows,
                range.startDate,
                range.endDate,
                "day",
                "value"
            ),
        }))
        .sort((a, b) => b.totalSales - a.totalSales);

    return { branches };
}

/* -------------------------------------------------------
 * INSIGHTS
 * ------------------------------------------------------- */

function buildInsights({
                           sales,
                           products,
                           bookings,
                           packages,
                       }) {
    const insights = [];

    if (sales.periodChange.percentage !== null) {
        insights.push({
            section: "sales",
            message:
                `Sales changed by ` +
                `${sales.periodChange.label} compared with ` +
                `the previous equivalent period.`,
        });
    }

    if (products.products.length > 0) {
        const top = products.products[0];

        insights.push({
            section: "products",
            message:
                `${top.name} recorded the highest number ` +
                `of units sold during the selected period.`,
        });
    }

    if (bookings.monthlyBookings.length > 0) {
        const months = bookings.monthlyBookings;
        const maximum = Math.max(...months.map(month => month.value));
        const peakMonths = months.filter(month => month.value === maximum);

        if (maximum > 0) {
            let message;
            if (peakMonths.length === months.length && months.length > 1) {
                message = `Booking activity remained consistent at ${maximum} ` +
                    `accepted scheduled bookings per month throughout the selected period.`;
            } else if (peakMonths.length > 1) {
                message = `${peakMonths.map(month => month.label).join(", ")} ` +
                    `tied for the highest number of accepted scheduled bookings ` +
                    `(${maximum} each).`;
            } else {
                message = `${peakMonths[0].label} recorded the highest ` +
                    `number of accepted scheduled bookings.`;
            }
            insights.push({ section: "bookings", message });
        }
    }

    if (packages.packages.length > 0) {
        insights.push({
            section: "packages",
            message:
                `${packages.packages[0].name} recorded the ` +
                `highest package booking count.`,
        });
    }

    return insights;
}

/* -------------------------------------------------------
 * FINAL API RESPONSE — ANALYTICS V2
 * ------------------------------------------------------- */

function buildAnalyticsPayloadV2({
                                     range,
                                     scope,
                                     salesRows = [],
                                     productRows = [],
                                     bookingRows = [],
                                     bookingItemRows = [],
                                     rentalRows = [],
                                 }) {
    const sales = buildSalesAnalytics(salesRows, range);

    const products = buildProductAnalytics(
        productRows,
        range
    );

    const bookings = buildBookingAnalytics(
        bookingRows,
        bookingItemRows,
        range
    );

    const rentals = buildRentalAnalytics(rentalRows, range);

    const packages = buildPackageAnalytics(
        bookingRows,
        range
    );

    const branches = buildBranchAnalytics(
        salesRows,
        range,
        scope
    );

    const hasData =
        sales.orderCount > 0 ||
        products.totalUnits > 0 ||
        bookings.totalBookings > 0;

    return {
        success: true,
        version: 2,
        generatedAt: new Date().toISOString(),
        scope,
        period: range,
        hasData,
        sales,
        products,
        bookings,
        rentals,
        packages,
        branches,
        insights: buildInsights({
            sales,
            products,
            bookings,
            packages,
        }),
    };
}

/* -------------------------------------------------------
 * THIS MONTH VS THE SAME MONTH LAST YEAR
 * ------------------------------------------------------- */

/**
 * The selected month against the same month a year earlier. When the month is still
 * running, both sides cover the same days (for example Nov 1–25 vs Nov 1–25 last year).
 */
function monthComparisonRanges(month, today) {
    const [year, monthNo] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
    const current = today.slice(0, 7) === month;
    const endDay = current ? Number(today.slice(8, 10)) : lastDay;
    const lastYearDays = new Date(Date.UTC(year - 1, monthNo, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    return {
        partial: current && endDay < lastDay,
        startDate: `${month}-01`,
        endDate: `${month}-${pad(endDay)}`,
        lastYearStartDate: `${year - 1}-${pad(monthNo)}-01`,
        lastYearEndDate: `${year - 1}-${pad(monthNo)}-${pad(Math.min(endDay, lastYearDays))}`,
        label: `${MONTH_NAMES[monthNo - 1]} ${year}`,
        lastYearLabel: `${MONTH_NAMES[monthNo - 1]} ${year - 1}`,
        days: endDay,
    };
}

function buildMonthComparison({ month, ranges, productRows = [], rentalRows = [] }) {
    const products = productRows
        .map((row) => {
            const units = round(toNumber(row.units)), lastYearUnits = round(toNumber(row.lastYearUnits));
            return {
                productId: Number(row.productId),
                name: normalizeText(row.name) || "Product",
                category: normalizeText(row.category) || "Uncategorized",
                units,
                lastYearUnits,
                difference: round(units - lastYearUnits),
                revenue: round(toNumber(row.revenue)),
                lastYearRevenue: round(toNumber(row.lastYearRevenue)),
                change: changeDetails(units, lastYearUnits),
            };
        })
        .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
    const categoryMap = new Map();
    for (const p of products) {
        const c = categoryMap.get(p.category) || { name: p.category, units: 0, lastYearUnits: 0 };
        c.units += p.units;
        c.lastYearUnits += p.lastYearUnits;
        categoryMap.set(p.category, c);
    }
    const categories = [...categoryMap.values()]
        .map((c) => ({ ...c, units: round(c.units), lastYearUnits: round(c.lastYearUnits), change: changeDetails(c.units, c.lastYearUnits) }))
        .sort((a, b) => b.units - a.units);
    const sold = products.filter((p) => p.units > 0);
    const rentals = rentalRows
        .map((row) => {
            const units = round(toNumber(row.units)), lastYearUnits = round(toNumber(row.lastYearUnits));
            return { equipmentId: Number(row.equipmentId), name: normalizeText(row.name) || "Equipment",
                units, lastYearUnits, difference: round(units - lastYearUnits), change: changeDetails(units, lastYearUnits) };
        })
        .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
    const totalUnits = sum(products, "units"), totalLastYear = sum(products, "lastYearUnits");
    const totalRevenue = sum(products, "revenue"), totalLastYearRevenue = sum(products, "lastYearRevenue");
    return {
        success: true,
        version: 2,
        action: "get_month_comparison",
        month,
        ...ranges,
        totals: {
            units: round(totalUnits),
            lastYearUnits: round(totalLastYear),
            unitsChange: changeDetails(totalUnits, totalLastYear),
            revenue: round(totalRevenue),
            lastYearRevenue: round(totalLastYearRevenue),
            revenueChange: changeDetails(totalRevenue, totalLastYearRevenue),
        },
        categories,
        products,
        mostSold: sold.slice(0, 5),
        leastSold: [...sold].sort((a, b) => a.units - b.units || a.name.localeCompare(b.name)).slice(0, 5),
        biggestIncrease: products.filter((p) => p.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 5),
        biggestDecrease: products.filter((p) => p.difference < 0).sort((a, b) => a.difference - b.difference).slice(0, 5),
        rentals,
    };
}

/* -------------------------------------------------------
 * PRODUCT / RENTAL ITEM INSIGHT
 * ------------------------------------------------------- */

const hourLabel = (hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
const pesoText = (value) => `₱${Math.round(toNumber(value)).toLocaleString("en-PH")}`;
const unitsText = (value) => `${Math.round(toNumber(value)).toLocaleString("en-PH")} unit${Math.round(toNumber(value)) === 1 ? "" : "s"}`;

/**
 * One product or rental item over up to three years: each year's months side by side,
 * its usual best and slow months, when it is bought (products) or booked (rentals),
 * its 12-month trend, this month vs the same days last year, and a day-by-day timeline.
 */
function buildItemInsight({ kind, item, today, historyStart, monthly = [], hourWeekday = [], monthToDate = {},
                              daily = [], stock = null, movements = [], rentalPeriods = [], owned = 0 }) {
    const currentMonth = today.slice(0, 7);
    const byMonth = new Map(monthly.map((row) => [String(row.monthKey), row]));
    const firstMonth = historyStart.slice(0, 7);

    // Each year's 12 months (null = before the history starts or in the future).
    const years = [];
    for (let year = Number(firstMonth.slice(0, 4)); year <= Number(currentMonth.slice(0, 4)); year += 1) {
        const months = [];
        for (let m = 1; m <= 12; m += 1) {
            const key = `${year}-${String(m).padStart(2, "0")}`;
            months.push(key < firstMonth || key > currentMonth ? null : round(toNumber(byMonth.get(key)?.units)));
        }
        years.push({ year, months, total: round(months.reduce((a, b) => a + (b || 0), 0)) });
    }

    // Usual level of each calendar month (complete months only).
    const calendar = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: MONTH_NAMES[i], total: 0, years: 0 }));
    for (const y of years) {
        y.months.forEach((value, i) => {
            const key = `${y.year}-${String(i + 1).padStart(2, "0")}`;
            if (value === null || key === currentMonth) return;
            calendar[i].total += value;
            calendar[i].years += 1;
        });
    }
    const withData = calendar.filter((c) => c.years > 0);
    const overall = withData.length ? withData.reduce((s, c) => s + c.total / c.years, 0) / withData.length : 0;
    const calendarMonths = calendar.map((c) => {
        const average = c.years ? c.total / c.years : null;
        return { month: c.month, label: c.label, average: average === null ? null : round(average, 1), years: c.years,
            index: average === null || overall <= 0 ? null : round(average / overall, 2) };
    });
    const ranked = calendarMonths.filter((c) => c.average !== null && c.average > 0).sort((a, b) => b.average - a.average);
    const bestMonths = ranked.slice(0, 3);
    const slowMonths = [...calendarMonths.filter((c) => c.average !== null)].sort((a, b) => a.average - b.average).slice(0, 3);

    // 12-month trend (complete months).
    const completeKeys = [];
    for (let d = addMonths(parseDate(`${currentMonth}-01`), -24); completeKeys.length < 24; d = addMonths(d, 1)) completeKeys.push(isoDate(d).slice(0, 7));
    const unitsOf = (keys) => keys.reduce((s, k) => s + toNumber(byMonth.get(k)?.units), 0);
    const last12 = unitsOf(completeKeys.slice(12)), previous12 = unitsOf(completeKeys.slice(0, 12));
    const trendChange = changeDetails(last12, previous12);
    const trendLabel = trendChange.percentage === null ? (last12 > 0 ? "New" : "No sales")
        : trendChange.percentage >= 5 ? "Rising" : trendChange.percentage <= -5 ? "Falling" : "Steady";

    // When: hours (products) and weekdays.
    const hours = Array(24).fill(0), weekdays = Array(7).fill(0);
    for (const row of hourWeekday) {
        const h = Number(row.hour), d = Number(row.weekday), u = toNumber(row.units);
        if (Number.isInteger(h) && h >= 0 && h < 24) hours[h] += u;
        if (Number.isInteger(d) && d >= 0 && d < 7) weekdays[d] += u;
    }
    const peakHours = hours.map((units, hour) => ({ hour, label: hourLabel(hour), units: round(units) }))
        .filter((h) => h.units > 0).sort((a, b) => b.units - a.units || a.hour - b.hour).slice(0, 3);
    const peakWeekday = weekdays.some((v) => v > 0) ? weekdays.indexOf(Math.max(...weekdays)) : null;

    // This month so far vs the same days last year.
    const thisMonth = {
        label: monthToDate.label || "",
        units: round(toNumber(monthToDate.units)),
        lastYearUnits: round(toNumber(monthToDate.lastYearUnits)),
        change: changeDetails(toNumber(monthToDate.units), toNumber(monthToDate.lastYearUnits)),
    };

    // Day-by-day timeline.
    let timeline = [];
    let stockSummary = null;
    if (kind === "product") {
        const dailyMap = new Map(daily.map((row) => [String(row.day), toNumber(row.units)]));
        const moveMap = new Map(movements.map((row) => [String(row.day), row]));
        const days = [];
        for (let d = addDays(parseDate(today), -89); isoDate(d) <= today; d = addDays(d, 1)) days.push(isoDate(d));
        // Walk back from today's stock using each day's net change.
        let level = toNumber(stock?.onHand);
        const levels = new Map();
        for (let i = days.length - 1; i >= 0; i -= 1) {
            levels.set(days[i], level);
            level -= toNumber(moveMap.get(days[i])?.net);
        }
        timeline = days.map((day) => ({ date: day, sold: round(dailyMap.get(day) || 0),
            received: round(toNumber(moveMap.get(day)?.received)), stock: Math.max(0, round(levels.get(day))) }));
        stockSummary = stock ? {
            onHand: round(toNumber(stock.onHand)), reserved: round(toNumber(stock.reserved)),
            unavailable: round(toNumber(stock.unavailable)),
            available: Math.max(0, round(toNumber(stock.onHand) - toNumber(stock.reserved) - toNumber(stock.unavailable))),
            reorderLevel: round(toNumber(stock.reorderLevel)),
        } : null;
    } else {
        const start = addDays(parseDate(today), -89), end = addDays(parseDate(today), 60);
        const out = new Map();
        for (const p of rentalPeriods) {
            const from = parseDate(p.startDate), to = parseDate(p.endDate || p.startDate);
            if (!from || !to) continue;
            for (let d = from > start ? from : start; d <= to && d <= end; d = addDays(d, 1)) {
                const k = isoDate(d);
                out.set(k, (out.get(k) || 0) + Math.max(0, toNumber(p.quantity)));
            }
        }
        for (let d = start; d <= end; d = addDays(d, 1)) {
            const k = isoDate(d);
            timeline.push({ date: k, unitsOut: round(out.get(k) || 0), upcoming: k > today });
        }
        stockSummary = { owned: round(toNumber(owned)) };
    }

    // Plain-language findings.
    const insights = [];
    const unitWord = kind === "rental" ? "booked" : "sold";
    if (bestMonths.length) insights.push(`Best months: ${bestMonths.map((m) => `${m.label} (about ${unitsText(m.average)} ${unitWord})`).join(", ")}.`);
    if (slowMonths.length && bestMonths.length) insights.push(`Slowest months: ${slowMonths.map((m) => m.label).join(", ")}.`);
    const peakMonth = bestMonths[0];
    if (peakMonth && peakMonth.index >= 1.3)
        insights.push(kind === "rental"
            ? `${peakMonth.label} is about ${round(peakMonth.index, 1)}× a normal month, so make sure enough units are free (or arrange extra) before ${peakMonth.label}.`
            : `${peakMonth.label} is about ${round(peakMonth.index, 1)}× a normal month, so stock up before ${peakMonth.label}.`);
    if (kind === "product" && peakHours.length)
        insights.push(`Usually bought around ${peakHours.map((h) => h.label).join(", ")}${peakWeekday !== null ? `, most often on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][peakWeekday]}s` : ""}.`);
    if (kind === "rental" && peakWeekday !== null)
        insights.push(`Most bookings are for ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][peakWeekday]} events.`);
    if (trendChange.percentage !== null)
        insights.push(`Last 12 months: ${unitsText(last12)} ${unitWord}, ${trendChange.label} vs the 12 months before (${trendLabel.toLowerCase()}).`);
    if (thisMonth.label && (thisMonth.units > 0 || thisMonth.lastYearUnits > 0))
        insights.push(`${thisMonth.label}: ${unitsText(thisMonth.units)} vs ${unitsText(thisMonth.lastYearUnits)} in the same days last year${thisMonth.change.percentage === null ? "" : ` (${thisMonth.change.label})`}.`);
    if (kind === "rental" && stockSummary.owned >= 0) {
        const upcomingPeak = timeline.filter((d) => d.upcoming).reduce((m, d) => Math.max(m, d.unitsOut), 0);
        if (upcomingPeak > stockSummary.owned)
            insights.push(`Already booked ${unitsText(upcomingPeak)} on the busiest upcoming day, more than the ${unitsText(stockSummary.owned)} owned.`);
    }

    return {
        success: true,
        version: 2,
        action: "get_item_insight",
        kind,
        item,
        historyStart,
        today,
        years,
        calendarMonths,
        bestMonths,
        slowMonths,
        trend: { last12: round(last12), previous12: round(previous12), change: trendChange, label: trendLabel },
        thisMonth,
        hours: hours.map((v) => round(v)),
        peakHours,
        weekdays: weekdays.map((v) => round(v)),
        peakWeekday,
        totals: {
            units: round(monthly.reduce((s, r) => s + toNumber(r.units), 0)),
            revenue: round(monthly.reduce((s, r) => s + toNumber(r.revenue), 0)),
            revenueText: pesoText(monthly.reduce((s, r) => s + toNumber(r.revenue), 0)),
        },
        timeline,
        stock: stockSummary,
        insights,
    };
}

/*
 * Legacy compatibility note:
 * The old buildAnalyticsPayload API remains usable
 * only through the existing deployment until the
 * V2 Lambda handler and UI are installed together.
 */
function buildAnalyticsPayload() {
    throw new Error(
        "Legacy Analytics payload is unavailable in V2. " +
        "Install the revised Lambda handler and UI together."
    );
}

module.exports = {
    toNumber,
    toDateOnly,
    percentChange,
    buildRange,
    buildAnalyticsPayload,
    buildAnalyticsPayloadV2,
    monthComparisonRanges,
    buildMonthComparison,
    buildItemInsight,
};
