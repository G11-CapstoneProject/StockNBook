function toSafeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function round(value, decimals = 2) {
    const multiplier = 10 ** decimals;
    return Math.round((toSafeNumber(value) + Number.EPSILON) * multiplier) / multiplier;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function totalDemand(weeks = []) {
    return weeks.reduce((total, value) => total + toSafeNumber(value), 0);
}

function calculateWeightedMovingAverage(weeklyDemand = []) {
    const recentWeeks = weeklyDemand.slice(-3);

    if (recentWeeks.length === 0) {
        return 0;
    }

    const baseWeights = [0.2, 0.3, 0.5];
    const weights = baseWeights.slice(3 - recentWeeks.length);

    const weightedTotal = recentWeeks.reduce(
        (total, demand, index) =>
            total + toSafeNumber(demand) * weights[index],
        0
    );

    const totalWeight = weights.reduce(
        (total, weight) => total + weight,
        0
    );

    return totalWeight > 0 ? weightedTotal / totalWeight : 0;
}

/*
  Compares the latest 4 weeks with the preceding 4 weeks.

  The growth factor is intentionally limited to 0.70–1.30. This prevents a
  single unusual transaction from making the 30-day forecast unrealistic.
*/
function calculateGrowthMetrics(weeklyDemand = []) {
    const recentFourWeekDemand = totalDemand(weeklyDemand.slice(-4));
    const previousFourWeekDemand = totalDemand(weeklyDemand.slice(-8, -4));

    if (previousFourWeekDemand <= 0 && recentFourWeekDemand > 0) {
        return {
            recentFourWeekDemand,
            previousFourWeekDemand,
            growthPercent: null,
            growthFactor: 1,
            growthTrend: "NEW_DEMAND",
        };
    }

    if (previousFourWeekDemand <= 0) {
        return {
            recentFourWeekDemand,
            previousFourWeekDemand,
            growthPercent: 0,
            growthFactor: 1,
            growthTrend: "NO_ACTIVITY",
        };
    }

    const rawGrowthRate =
        (recentFourWeekDemand - previousFourWeekDemand) /
        previousFourWeekDemand;

    const growthPercent = round(rawGrowthRate * 100, 2);
    const growthFactor = round(clamp(1 + rawGrowthRate, 0.7, 1.3), 2);

    let growthTrend = "STABLE";

    if (growthPercent >= 5) {
        growthTrend = "GROWING";
    } else if (growthPercent <= -5) {
        growthTrend = "DECLINING";
    }

    return {
        recentFourWeekDemand,
        previousFourWeekDemand,
        growthPercent,
        growthFactor,
        growthTrend,
    };
}

/*
  Classifies movement using the number of weeks with at least one POS sale
  within the current 12-week history window.
*/
function classifyMovement(weeklyDemand = []) {
    const activeSalesWeeks = weeklyDemand.filter(
        (quantity) => toSafeNumber(quantity) > 0
    ).length;

    const totalUnitsSold = totalDemand(weeklyDemand);
    const averageWeeklyDemand =
        weeklyDemand.length > 0
            ? totalUnitsSold / weeklyDemand.length
            : 0;

    let movementClass = "NO_MOVEMENT";

    if (activeSalesWeeks >= 5) {
        movementClass = "FAST_MOVING";
    } else if (activeSalesWeeks >= 3) {
        movementClass = "REGULAR_MOVING";
    } else if (activeSalesWeeks >= 1) {
        movementClass = "SLOW_MOVING";
    }

    return {
        totalUnitsSold,
        activeSalesWeeks,
        averageWeeklyDemand: round(averageWeeklyDemand, 2),
        movementClass,
    };
}


/*
  Demand Level is intentionally separate from stock risk.
  It ranks each item by its projected 30-day customer demand within the same
  branch, so a product is not labelled "High demand" merely because it is low
  in stock.
*/
function assignDemandLevels(items = []) {
    const branchGroups = new Map();

    items.forEach((item) => {
        const branchKey = String(item.branchId || "unassigned");
        const current = branchGroups.get(branchKey) || [];
        current.push(item);
        branchGroups.set(branchKey, current);
    });

    const output = [];

    branchGroups.forEach((branchItems) => {
        const rankedItems = [...branchItems]
            .filter((item) => toSafeNumber(item.forecastedDemand) > 0)
            .sort(
                (first, second) =>
                    toSafeNumber(second.forecastedDemand) -
                    toSafeNumber(first.forecastedDemand) ||
                    String(first.itemName || "").localeCompare(
                        String(second.itemName || "")
                    )
            );

        const trackedDemandItems = rankedItems.length;
        const highDemandCount = Math.max(
            1,
            Math.ceil(trackedDemandItems * 0.25)
        );
        const moderateDemandLimit = Math.max(
            highDemandCount,
            Math.ceil(trackedDemandItems * 0.7)
        );

        const rankedIndexById = new Map(
            rankedItems.map((item, index) => [item.id, index])
        );

        branchItems.forEach((item) => {
            const projectedDemand = toSafeNumber(item.forecastedDemand);
            const rankIndex = rankedIndexById.get(item.id);

            let demandLevel = "NO_RECENT_DEMAND";
            let demandRank = null;
            let demandLevelReason =
                "No completed POS demand was recorded in the current 12-week history window.";

            if (rankIndex !== undefined && projectedDemand > 0) {
                demandRank = rankIndex + 1;

                if (rankIndex < highDemandCount) {
                    demandLevel = "HIGH";
                } else if (rankIndex < moderateDemandLimit) {
                    demandLevel = "MODERATE";
                } else {
                    demandLevel = "LOW";
                }

                demandLevelReason =
                    `Ranked ${demandRank} of ${trackedDemandItems} items in this branch by projected 30-day demand.`;
            }

            output.push({
                ...item,
                demandLevel,
                demandRank,
                demandPopulation: trackedDemandItems,
                demandLevelReason,
            });
        });
    });

    return output;
}

/*
  Evaluates an item's current calendar-month demand against its own monthly
  POS history. It is deliberately labelled as preliminary when only one year
  of history exists; this prevents the UI from overstating a seasonal pattern.
*/
function buildItemSeasonality(
    monthlySales = [],
    {
        currentMonthNumber = new Date().getUTCMonth() + 1,
        minimumHistoryMonths = 6,
    } = {}
) {
    const normalizedRows = monthlySales
        .map((row) => ({
            monthKey: String(row.monthKey || ""),
            totalUnits: Math.max(0, toSafeNumber(row.totalUnits)),
        }))
        .filter((row) => /^\d{4}-\d{2}$/.test(row.monthKey))
        .sort((first, second) => first.monthKey.localeCompare(second.monthKey));

    const historyMonthsAvailable = normalizedRows.length;
    const totalUnitsSold = normalizedRows.reduce(
        (total, row) => total + row.totalUnits,
        0
    );

    const monthBuckets = Array.from({ length: 12 }, (_, index) => ({
        monthNumber: index + 1,
        month: getMonthLabel(index + 1),
        totalUnits: 0,
        observations: 0,
    }));

    normalizedRows.forEach((row) => {
        const monthNumber = Number(row.monthKey.slice(5, 7));

        if (monthNumber >= 1 && monthNumber <= 12) {
            const bucket = monthBuckets[monthNumber - 1];
            bucket.totalUnits += row.totalUnits;
            bucket.observations += 1;
        }
    });

    const seasonalMonths = monthBuckets.map((month) => ({
        ...month,
        averageUnits: round(
            month.observations > 0
                ? month.totalUnits / month.observations
                : 0,
            2
        ),
    }));

    const currentIndex = clamp(
        Math.floor(toSafeNumber(currentMonthNumber)) - 1,
        0,
        11
    );
    const currentMonth = seasonalMonths[currentIndex];
    const averageMonthlyDemand = round(totalUnitsSold / 12, 2);
    const rankedMonths = [...seasonalMonths]
        .filter((month) => month.totalUnits > 0)
        .sort(
            (first, second) =>
                second.averageUnits - first.averageUnits ||
                first.monthNumber - second.monthNumber
        );

    const peakMonths = rankedMonths
        .filter(
            (month) =>
                averageMonthlyDemand > 0 &&
                month.averageUnits >= averageMonthlyDemand * 1.15
        )
        .slice(0, 2);

    if (peakMonths.length === 0 && rankedMonths.length > 0) {
        peakMonths.push(rankedMonths[0]);
    }

    const historyYearsAvailable = currentMonth.observations;
    const historyLabel =
        historyYearsAvailable > 1
            ? `${historyYearsAvailable} years of ${currentMonth.month} sales`
            : historyYearsAvailable === 1
                ? `1 year of ${currentMonth.month} sales`
                : "No sales recorded for this month";

    if (historyMonthsAvailable === 0) {
        return {
            status: "NO_HISTORY",
            isReady: false,
            label: "No seasonal signal yet",
            detail:
                "No completed POS sales are available for this item in the 12-month seasonal history.",
            currentMonth: currentMonth.month,
            currentMonthUnits: 0,
            averageMonthlyDemand: 0,
            historyMonthsAvailable,
            historyYearsAvailable: 0,
            historyLabel,
            peakMonths: [],
            seasonalMonths,
        };
    }

    if (historyMonthsAvailable < minimumHistoryMonths) {
        return {
            status: "LIMITED_HISTORY",
            isReady: false,
            label: "Limited seasonal history",
            detail:
                `Only ${historyMonthsAvailable} selling month(s) are available. The product needs at least ${minimumHistoryMonths} months of POS history before the system labels a seasonal pattern.`,
            currentMonth: currentMonth.month,
            currentMonthUnits: currentMonth.totalUnits,
            averageMonthlyDemand,
            historyMonthsAvailable,
            historyYearsAvailable,
            historyLabel,
            peakMonths: peakMonths.map((month) => month.month),
            seasonalMonths,
        };
    }

    const currentMonthUnits = currentMonth.totalUnits;
    const highSeasonThreshold = averageMonthlyDemand * 1.25;
    const lowSeasonThreshold = averageMonthlyDemand * 0.75;

    let status = "TYPICAL_SEASON";
    let label = `Typical demand in ${currentMonth.month}`;
    let detail =
        `${currentMonth.month} has ${formatSeasonalNumber(currentMonthUnits)} recorded units compared with a typical monthly level of ${formatSeasonalNumber(averageMonthlyDemand)} units.`;

    if (currentMonthUnits >= highSeasonThreshold && currentMonthUnits > 0) {
        status = "PEAK_SEASON";
        label = `Peak demand in ${currentMonth.month}`;
        detail =
            `${currentMonth.month} has ${formatSeasonalNumber(currentMonthUnits)} recorded units, above this item's typical monthly level of ${formatSeasonalNumber(averageMonthlyDemand)} units.`;
    } else if (currentMonthUnits <= lowSeasonThreshold && averageMonthlyDemand > 0) {
        status = "OFF_PEAK";
        label = `Lower demand in ${currentMonth.month}`;
        detail =
            `${currentMonth.month} has ${formatSeasonalNumber(currentMonthUnits)} recorded units, below this item's typical monthly level of ${formatSeasonalNumber(averageMonthlyDemand)} units.`;
    }

    const isPreliminary = historyYearsAvailable < 2;

    return {
        status,
        isReady: true,
        isPreliminary,
        label: isPreliminary ? `Preliminary: ${label}` : label,
        detail: isPreliminary
            ? `${detail} This is a preliminary signal because only one historical ${currentMonth.month} record is available.`
            : detail,
        currentMonth: currentMonth.month,
        currentMonthUnits,
        averageMonthlyDemand,
        historyMonthsAvailable,
        historyYearsAvailable,
        historyLabel,
        peakMonths: peakMonths.map((month) => month.month),
        seasonalMonths,
    };
}

function formatSeasonalNumber(value) {
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
    }).format(toSafeNumber(value));
}

function calculateStockoutMetrics({
                                      availableQuantity = 0,
                                      forecastedDemand = 0,
                                      periodDays = 30,
                                      safetyStock = 0,
                                      leadTimeDays = 3,
                                  }) {
    const available = Math.max(0, toSafeNumber(availableQuantity));
    const demand = Math.max(0, toSafeNumber(forecastedDemand));
    const safePeriodDays = Math.max(1, toSafeNumber(periodDays) || 30);
    const safeSafetyStock = Math.max(0, toSafeNumber(safetyStock));
    const safeLeadTimeDays = Math.max(0, toSafeNumber(leadTimeDays));

    const dailyDemand = demand / safePeriodDays;
    const reorderPoint = Math.ceil(
        dailyDemand * safeLeadTimeDays + safeSafetyStock
    );

    let daysUntilStockout = null;

    if (available <= 0) {
        daysUntilStockout = 0;
    } else if (dailyDemand > 0) {
        daysUntilStockout = round(available / dailyDemand, 1);
    }

    const reorderNow =
        available <= safeSafetyStock ||
        (dailyDemand > 0 && available <= reorderPoint);

    let timeAlert = "NONE";
    let alertSeverity = "NONE";

    if (available <= 0) {
        timeAlert = "OUT_OF_STOCK";
        alertSeverity = "CRITICAL";
    } else if (
        daysUntilStockout !== null &&
        daysUntilStockout <= 3
    ) {
        timeAlert = "MAY_RUN_OUT_WITHIN_3_DAYS";
        alertSeverity = "CRITICAL";
    } else if (
        daysUntilStockout !== null &&
        daysUntilStockout <= 7
    ) {
        timeAlert = "MAY_RUN_OUT_WITHIN_7_DAYS";
        alertSeverity = "WARNING";
    } else if (reorderNow) {
        timeAlert = "REORDER_POINT_REACHED";
        alertSeverity = "NOTICE";
    }

    return {
        dailyDemand: round(dailyDemand, 2),
        daysUntilStockout,
        reorderPoint,
        reorderNow,
        timeAlert,
        alertSeverity,
        leadTimeDays: safeLeadTimeDays,
    };
}

function buildInventoryForecast({
                                    weeklyDemand = [],
                                    onHandQuantity = 0,
                                    allocatedQuantity = 0,
                                    lowStockThreshold = 0,
                                    safetyStock = 0,
                                    periodDays = 30,
                                    leadTimeDays = 3,
                                }) {
    const baseWeeklyForecast = calculateWeightedMovingAverage(weeklyDemand);
    const growth = calculateGrowthMetrics(weeklyDemand);
    const movement = classifyMovement(weeklyDemand);

    const adjustedWeeklyForecast =
        baseWeeklyForecast * growth.growthFactor;

    const forecastedDemand = Math.ceil(
        adjustedWeeklyForecast * (toSafeNumber(periodDays) / 7)
    );

    const onHand = Math.max(0, toSafeNumber(onHandQuantity));
    const allocated = Math.max(0, toSafeNumber(allocatedQuantity));
    const availableQuantity = Math.max(0, onHand - allocated);

    const safeSafetyStock = Math.max(0, toSafeNumber(safetyStock));
    const safeLowStockThreshold = Math.max(
        0,
        toSafeNumber(lowStockThreshold)
    );

    const suggestedRestock = Math.max(
        0,
        forecastedDemand + safeSafetyStock - availableQuantity
    );

    const stockout = calculateStockoutMetrics({
        availableQuantity,
        forecastedDemand,
        periodDays,
        safetyStock: safeSafetyStock,
        leadTimeDays,
    });

    /*
      Keep LOW / RISK / STABLE for backward compatibility with the current UI.
      More precise time-based alerts are returned separately in timeAlert.
    */
    let status = "STABLE";

    if (
        availableQuantity <= safeLowStockThreshold ||
        stockout.timeAlert === "OUT_OF_STOCK" ||
        stockout.timeAlert === "MAY_RUN_OUT_WITHIN_3_DAYS"
    ) {
        status = "LOW";
    } else if (
        suggestedRestock > 0 ||
        stockout.reorderNow ||
        stockout.timeAlert === "MAY_RUN_OUT_WITHIN_7_DAYS"
    ) {
        status = "RISK";
    }

    return {
        weeklyForecast: round(adjustedWeeklyForecast, 2),
        baseWeeklyForecast: round(baseWeeklyForecast, 2),

        onHandQuantity: onHand,
        allocatedQuantity: allocated,
        availableQuantity,

        forecastedDemand,
        suggestedRestock,
        status,

        ...growth,
        ...movement,
        ...stockout,
    };
}

function getMonthLabel(monthNumber) {
    return new Intl.DateTimeFormat("en-US", {
        month: "long",
    }).format(new Date(Date.UTC(2026, monthNumber - 1, 1)));
}

/*
  A seasonal result is only marked READY when at least 12 distinct months of
  completed POS history are available. This prevents the UI from claiming a
  real seasonal pattern from a short history.
*/
function buildSeasonalAnalysis(monthlySales = [], minimumHistoryMonths = 12) {
    const normalizedRows = monthlySales
        .map((row) => ({
            monthKey: String(row.monthKey || ""),
            totalUnits: Math.max(0, toSafeNumber(row.totalUnits)),
            orderCount: Math.max(0, toSafeNumber(row.orderCount)),
        }))
        .filter((row) => /^\d{4}-\d{2}$/.test(row.monthKey))
        .sort((first, second) =>
            first.monthKey.localeCompare(second.monthKey)
        );

    const historyMonthsAvailable = normalizedRows.length;
    const totalUnitsSold = normalizedRows.reduce(
        (total, row) => total + row.totalUnits,
        0
    );

    const monthlyHistory = normalizedRows.map((row) => {
        const [year, month] = row.monthKey.split("-").map(Number);

        return {
            monthKey: row.monthKey,
            label: new Intl.DateTimeFormat("en-US", {
                month: "short",
                year: "numeric",
            }).format(new Date(Date.UTC(year, month - 1, 1))),
            totalUnits: row.totalUnits,
            orderCount: row.orderCount,
        };
    });

    if (historyMonthsAvailable < minimumHistoryMonths) {
        return {
            status: "INSUFFICIENT_HISTORY",
            isReady: false,
            minimumHistoryMonths,
            historyMonthsAvailable,
            totalUnitsSold,
            monthlyHistory,
            message: `Seasonal analysis needs at least ${minimumHistoryMonths} months of POS history. Only ${historyMonthsAvailable} month(s) are currently available.`,
            seasonalMonths: [],
            peakMonths: [],
            recentTrend: "INSUFFICIENT_HISTORY",
        };
    }

    const monthBuckets = Array.from({ length: 12 }, (_, index) => ({
        monthNumber: index + 1,
        month: getMonthLabel(index + 1),
        totalUnits: 0,
        observations: 0,
    }));

    normalizedRows.forEach((row) => {
        const monthNumber = Number(row.monthKey.slice(5, 7));

        if (monthNumber >= 1 && monthNumber <= 12) {
            const bucket = monthBuckets[monthNumber - 1];
            bucket.totalUnits += row.totalUnits;
            bucket.observations += 1;
        }
    });

    const seasonalMonths = monthBuckets.map((bucket) => ({
        ...bucket,
        averageUnits: round(
            bucket.observations > 0
                ? bucket.totalUnits / bucket.observations
                : 0,
            2
        ),
    }));

    const peakMonths = [...seasonalMonths]
        .filter((month) => month.observations > 0)
        .sort(
            (first, second) =>
                second.averageUnits - first.averageUnits
        )
        .slice(0, 3);

    const recentThreeMonths = totalDemand(
        normalizedRows.slice(-3).map((row) => row.totalUnits)
    );
    const previousThreeMonths = totalDemand(
        normalizedRows.slice(-6, -3).map((row) => row.totalUnits)
    );

    let recentTrend = "STABLE";
    let recentTrendPercent = 0;

    if (previousThreeMonths > 0) {
        recentTrendPercent = round(
            ((recentThreeMonths - previousThreeMonths) /
                previousThreeMonths) *
            100,
            2
        );

        if (recentTrendPercent >= 5) {
            recentTrend = "GROWING";
        } else if (recentTrendPercent <= -5) {
            recentTrend = "DECLINING";
        }
    } else if (recentThreeMonths > 0) {
        recentTrend = "NEW_DEMAND";
        recentTrendPercent = null;
    }

    return {
        status: "READY",
        isReady: true,
        minimumHistoryMonths,
        historyMonthsAvailable,
        totalUnitsSold,
        monthlyHistory,
        seasonalMonths,
        peakMonths,
        recentTrend,
        recentTrendPercent,
        message:
            "Seasonal analysis is based on completed POS sales grouped by calendar month.",
    };
}
function toDateKey(value) {
    const raw = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function formatDateLabel(dateValue) {
    const dateKey = toDateKey(dateValue);

    if (!dateKey) {
        return "Unscheduled";
    }

    const date = new Date(`${dateKey}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
        return dateKey;
    }

    return new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

function formatWeekdayLabel(dateValue) {
    const dateKey = toDateKey(dateValue);

    if (!dateKey) {
        return "Unscheduled";
    }

    const date = new Date(`${dateKey}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
        return "Unscheduled";
    }

    return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
    }).format(date);
}

function normalizeBookingStatus(value) {
    return String(value || "").trim().toUpperCase();
}

function createBookingAllocationKey(productId, variantId) {
    return `${productId}:${variantId || "product"}`;
}

/*
  Booking Forecast Version 1 is schedule-based:
  it uses confirmed and preparing bookings already scheduled in the next
  30 days. This is intentionally not a guessed historical booking number.
*/
function buildBookingForecast(bookings = [], { periodDays = 30 } = {}) {
    const activeBookings = bookings
        .filter((booking) => {
            const status = normalizeBookingStatus(booking.status);

            return (
                status === "CONFIRMED" ||
                status === "PREPARING" ||
                status === "APPROVED"
            );
        })
        .sort((first, second) => {
            const firstDate = `${first.eventDate || ""} ${first.eventTime || ""}`;
            const secondDate = `${second.eventDate || ""} ${second.eventTime || ""}`;

            return firstDate.localeCompare(secondDate);
        });

    const byDate = new Map();
    const byTime = new Map();
    const byWeekday = new Map();
    const packages = new Map();
    const allocatedInventory = new Map();

    let confirmedBookings = 0;
    let preparingBookings = 0;
    let bookingsWithoutAllocation = 0;
    let unlinkedAllocationEntries = 0;
    let allocatedUnits = 0;

    activeBookings.forEach((booking) => {
        const status = normalizeBookingStatus(booking.status);

        if (status === "PREPARING") {
            preparingBookings += 1;
        } else {
            confirmedBookings += 1;
        }

        const dateKey = toDateKey(booking.eventDate);
        const timeKey = String(booking.eventTime || "").trim();
        const weekday = formatWeekdayLabel(dateKey);
        const packageName =
            String(booking.packageName || "").trim() || "Custom / Unspecified";

        if (dateKey) {
            const current = byDate.get(dateKey) || {
                date: dateKey,
                label: formatDateLabel(dateKey),
                bookings: 0,
            };

            current.bookings += 1;
            byDate.set(dateKey, current);
        }

        if (timeKey) {
            const current = byTime.get(timeKey) || {
                time: timeKey,
                bookings: 0,
            };

            current.bookings += 1;
            byTime.set(timeKey, current);
        }

        const weekdayCurrent = byWeekday.get(weekday) || {
            weekday,
            bookings: 0,
        };

        weekdayCurrent.bookings += 1;
        byWeekday.set(weekday, weekdayCurrent);

        const packageCurrent = packages.get(packageName) || {
            packageName,
            bookings: 0,
        };

        packageCurrent.bookings += 1;
        packages.set(packageName, packageCurrent);

        const allocations = Array.isArray(booking.allocations)
            ? booking.allocations
            : [];

        if (allocations.length === 0) {
            bookingsWithoutAllocation += 1;
        }

        allocations.forEach((allocation) => {
            const quantity = Math.max(0, toSafeNumber(allocation.quantity));

            if (quantity <= 0) {
                return;
            }

            allocatedUnits += quantity;

            const productId = Number(allocation.productId || 0);
            const variantId = Number(allocation.variantId || 0) || null;

            if (!productId) {
                unlinkedAllocationEntries += 1;
                return;
            }

            const key = createBookingAllocationKey(productId, variantId);
            const current = allocatedInventory.get(key) || {
                productId,
                variantId,
                itemName:
                    String(allocation.itemName || "").trim() ||
                    `Product ${productId}`,
                quantity: 0,
            };

            current.quantity += quantity;
            allocatedInventory.set(key, current);
        });
    });

    const peakBookingDate = [...byDate.values()]
        .sort(
            (first, second) =>
                second.bookings - first.bookings ||
                first.date.localeCompare(second.date)
        )[0] || null;

    const peakBookingTime = [...byTime.values()]
        .sort(
            (first, second) =>
                second.bookings - first.bookings ||
                first.time.localeCompare(second.time)
        )[0] || null;

    const peakBookingDay = [...byWeekday.values()]
        .sort(
            (first, second) =>
                second.bookings - first.bookings ||
                first.weekday.localeCompare(second.weekday)
        )[0] || null;

    const topPackages = [...packages.values()]
        .sort(
            (first, second) =>
                second.bookings - first.bookings ||
                first.packageName.localeCompare(second.packageName)
        )
        .slice(0, 8);

    const allocationItems = [...allocatedInventory.values()]
        .sort(
            (first, second) =>
                second.quantity - first.quantity ||
                first.itemName.localeCompare(second.itemName)
        );

    return {
        status: "READY",
        isReady: true,
        periodDays: Math.max(1, toSafeNumber(periodDays) || 30),
        forecastBasis:
            "Confirmed and preparing bookings already scheduled within the selected period.",
        expectedBookings: activeBookings.length,
        confirmedBookings,
        preparingBookings,
        peakBookingDate,
        peakBookingTime,
        peakBookingDay,
        topPackages,
        upcomingBookings: activeBookings.map((booking) => ({
            id: Number(booking.id || 0),
            bookingReference: String(booking.bookingReference || ""),
            branchId: Number(booking.branchId || 0) || null,
            branchName: String(booking.branchName || "Unnamed Branch"),
            eventDate: toDateKey(booking.eventDate),
            eventDateLabel: formatDateLabel(booking.eventDate),
            eventTime: String(booking.eventTime || ""),
            customerName: String(booking.customerName || "Customer"),
            packageName:
                String(booking.packageName || "").trim() ||
                "Custom / Unspecified",
            status: String(booking.status || ""),
            allocationCount: Array.isArray(booking.allocations)
                ? booking.allocations.length
                : 0,
        })),
        allocationSummary: {
            allocatedUnits,
            allocationItems: allocationItems.length,
            bookingsWithoutAllocation,
            unlinkedAllocationEntries,
        },
        allocatedInventory: allocationItems,
    };
}

module.exports = {
    calculateWeightedMovingAverage,
    calculateGrowthMetrics,
    classifyMovement,
    calculateStockoutMetrics,
    buildInventoryForecast,
    assignDemandLevels,
    buildItemSeasonality,
    buildSeasonalAnalysis,
    buildBookingForecast,
};
