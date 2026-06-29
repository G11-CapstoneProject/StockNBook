"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    CalendarDays,
    ChevronDown,
    ChevronRight,
    LoaderCircle,
    PackageSearch,
    TrendingUp,
    TriangleAlert,
} from "lucide-react";

export type ForecastTab = "inventory" | "seasonal" | "booking";

export type SeasonalDateRange = {
    startMonth: string;
    endMonth: string;
};

export type ItemSeasonality = {
    status:
        | "PEAK_SEASON"
        | "TYPICAL_SEASON"
        | "OFF_PEAK"
        | "LIMITED_HISTORY"
        | "NO_HISTORY"
        | string;
    isReady: boolean;
    isPreliminary?: boolean;
    label: string;
    detail: string;
    currentMonth: string;
    currentMonthUnits: number;
    averageMonthlyDemand: number;
    historyMonthsAvailable: number;
    historyYearsAvailable: number;
    historyLabel: string;
    peakMonths: string[];
};

export type ForecastItem = {
    id: string;
    productId: number;
    variantId: number | null;
    productName: string;
    variantName: string | null;
    itemName: string;
    category: string;
    branchId: number;
    branchName: string;
    isVariant: boolean;

    currentStock: number;
    onHandQuantity: number;
    allocatedQuantity: number;
    availableQuantity: number;
    lowStockThreshold: number;

    historyWeeks: number;
    weeklyDemand: number[];
    weeklyForecast: number;
    baseWeeklyForecast?: number;
    forecastedDemand: number;
    suggestedRestock: number;
    status: string;

    recentFourWeekDemand?: number;
    previousFourWeekDemand?: number;
    growthPercent?: number | null;
    growthFactor?: number;
    growthTrend?: string;

    totalUnitsSold?: number;
    activeSalesWeeks?: number;
    movementClass?: string;
    averageWeeklyDemand?: number;

    dailyDemand?: number;
    daysUntilStockout?: number | null;
    reorderPoint?: number;
    reorderNow?: boolean;
    timeAlert?: string;
    alertSeverity?: string;

    demandLevel?: "HIGH" | "MODERATE" | "LOW" | "NO_RECENT_DEMAND" | string;
    demandRank?: number | null;
    demandPopulation?: number;
    demandLevelReason?: string;
    seasonality?: ItemSeasonality;
};

export type ForecastSummary = {
    projectedDemand: number;
    expectedBookings: number;
    confirmedBookings?: number;
    preparingBookings?: number;

    trackedItems: number;
    restockAlerts: number;
    lowStockItems: number;
    riskItems: number;

    criticalStockoutAlerts?: number;
    stockoutWithin7Days?: number;
    reorderNowItems?: number;

    fastMovingItems?: number;
    slowMovingItems?: number;
    highDemandItems?: number;
    growingDemandItems?: number;
    peakSeasonItems?: number;
    limitedSeasonalHistoryItems?: number;

    bookingAllocatedUnits?: number;
    bookingsWithoutAllocation?: number;
};

export type ForecastScope = {
    storeId: number;
    branchId: number | null;
    role: string;
    periodDays: number;
    historyWeeks: number;
    historyStartDate: string;
    historyEndDate: string;
    bookingStartDate?: string;
    bookingEndDate?: string;
};

export type ForecastApiResponse = {
    success: boolean;
    action: string;
    generatedAt: string;
    scope: ForecastScope;
    summary: ForecastSummary;
    notes?: {
        dataSource?: string;
        demandLevel?: string;
        seasonality?: string;
        bookingForecast?: string;
        allocatedQuantity?: string;
        growthCalculation?: string;
        movementClassification?: string;
        timeBasedAlerts?: string;
    };
    items: ForecastItem[];
};

export type SeasonalMonthHistory = {
    monthKey: string;
    label: string;
    totalUnits: number;
    orderCount: number;
};

export type SeasonalMonth = {
    monthNumber: number;
    month: string;
    totalUnits: number;
    observations: number;
    averageUnits: number;
};

export type SeasonalAnalysis = {
    status: "READY" | "INSUFFICIENT_HISTORY" | string;
    isReady: boolean;
    minimumHistoryMonths: number;
    historyMonthsAvailable: number;
    totalUnitsSold: number;
    monthlyHistory: SeasonalMonthHistory[];
    seasonalMonths: SeasonalMonth[];
    peakMonths: SeasonalMonth[];
    recentTrend: string;
    recentTrendPercent?: number | null;
    message: string;
};

export type SeasonalApiResponse = {
    success: boolean;
    action: string;
    generatedAt: string;
    scope: {
        storeId: number;
        branchId: number | null;
        role: string;
        historyMonths: number;
        historyStartDate: string;
        historyEndDate: string;
    };
    notes?: {
        dataSource?: string;
        requirement?: string;
    };
    seasonal: SeasonalAnalysis;
};

export type UpcomingBooking = {
    id: number;
    bookingReference: string;
    branchId: number | null;
    branchName: string;
    eventDate: string;
    eventDateLabel: string;
    eventTime: string;
    customerName: string;
    packageName: string;
    status: string;
    allocationCount: number;
};

export type BookingPackageDemand = {
    packageName: string;
    bookings: number;
};

export type BookingPeakDate = {
    date: string;
    label: string;
    bookings: number;
};

export type BookingPeakTime = {
    time: string;
    bookings: number;
};

export type BookingPeakDay = {
    weekday: string;
    bookings: number;
};

export type BookingForecast = {
    status: "READY" | string;
    isReady: boolean;
    periodDays: number;
    forecastBasis: string;
    expectedBookings: number;
    confirmedBookings: number;
    preparingBookings: number;
    peakBookingDate: BookingPeakDate | null;
    peakBookingTime: BookingPeakTime | null;
    peakBookingDay: BookingPeakDay | null;
    topPackages: BookingPackageDemand[];
    upcomingBookings: UpcomingBooking[];
    allocationSummary: {
        allocatedUnits: number;
        allocationItems: number;
        bookingsWithoutAllocation: number;
        unlinkedAllocationEntries: number;
    };
    allocatedInventory: Array<{
        productId: number;
        variantId: number | null;
        itemName: string;
        quantity: number;
    }>;
};

export type BookingApiResponse = {
    success: boolean;
    action: string;
    generatedAt: string;
    scope: {
        storeId: number;
        branchId: number | null;
        role: string;
        periodDays: number;
        startDate: string;
        endDate: string;
    };
    notes?: {
        dataSource?: string;
        includedStatuses?: string[];
        allocationRule?: string;
    };
    booking: BookingForecast;
};

export type LiveForecastProps = {
    data: ForecastApiResponse | null;
    loading: boolean;
    error: string | null;
    lastUpdated: Date | null;

    seasonalData: SeasonalApiResponse | null;
    seasonalLoading: boolean;
    seasonalError: string | null;
    seasonalRange: SeasonalDateRange;
    applySeasonalRange: (range: SeasonalDateRange) => Promise<void>;

    bookingData: BookingApiResponse | null;
    bookingLoading: boolean;
    bookingError: string | null;

    refresh: () => Promise<void>;
};

export type BranchForecastSummary = {
    id: number;
    name: string;
    demand: number;
    alerts: number;
    highDemandItems: number;
    growingItems: number;
    topItem: string;
};

function numberValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function safeText(value: unknown, fallback = "—") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function titleCase(value: string) {
    return String(value || "")
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isStockActionItem(item: ForecastItem) {
    const status = String(item.status || "").toUpperCase();

    return (
        status === "LOW" ||
        status === "RISK" ||
        numberValue(item.suggestedRestock) > 0 ||
        Boolean(item.reorderNow)
    );
}

function stockRiskLabel(item: ForecastItem) {
    const timeAlert = String(item.timeAlert || "").toUpperCase();
    const status = String(item.status || "STABLE").toUpperCase();

    if (timeAlert === "OUT_OF_STOCK") return "Out of stock";
    if (timeAlert === "MAY_RUN_OUT_WITHIN_3_DAYS") return "May run out within 3 days";
    if (timeAlert === "MAY_RUN_OUT_WITHIN_7_DAYS") return "May run out within 7 days";
    if (status === "LOW") return "Low stock";
    if (status === "RISK") return "Stock attention";
    return "Stock adequate";
}

function stockRiskClass(item: ForecastItem) {
    const timeAlert = String(item.timeAlert || "").toUpperCase();
    const status = String(item.status || "STABLE").toUpperCase();

    if (
        timeAlert === "OUT_OF_STOCK" ||
        timeAlert === "MAY_RUN_OUT_WITHIN_3_DAYS" ||
        status === "LOW"
    ) {
        return "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]";
    }

    if (
        timeAlert === "MAY_RUN_OUT_WITHIN_7_DAYS" ||
        status === "RISK"
    ) {
        return "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";
    }

    return "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]";
}

function demandLevelLabel(level: string | undefined) {
    const normalized = String(level || "").toUpperCase();

    if (normalized === "HIGH") return "High demand";
    if (normalized === "MODERATE") return "Moderate demand";
    if (normalized === "LOW") return "Lower demand";
    return "No recent demand";
}

function demandLevelClass(level: string | undefined) {
    const normalized = String(level || "").toUpperCase();

    if (normalized === "HIGH") {
        return "border-[#D9C7F0] bg-[#F4EEFC] text-[#4E2C66]";
    }

    if (normalized === "MODERATE") {
        return "border-[#CFE8DA] bg-[#F1FBF5] text-[#138342]";
    }

    if (normalized === "LOW") {
        return "border-[#E6DDF0] bg-[#FBF9FD] text-[#6B5B78]";
    }

    return "border-[#E6DDF0] bg-[#FBF9FD] text-[#806A8C]";
}

function growthTrendLabel(item: ForecastItem) {
    const normalized = String(item.growthTrend || "").toUpperCase();
    const growthPercent = item.growthPercent;

    let label = "Stable demand";

    if (normalized === "GROWING") label = "Demand rising";
    if (normalized === "DECLINING") label = "Demand declining";
    if (normalized === "NEW_DEMAND") label = "New demand";
    if (normalized === "NO_ACTIVITY") label = "No recent activity";

    if (
        growthPercent !== undefined &&
        growthPercent !== null &&
        Number.isFinite(Number(growthPercent))
    ) {
        const formatted = `${Number(growthPercent) >= 0 ? "+" : ""}${Number(
            growthPercent
        ).toFixed(0)}%`;

        return `${label} · ${formatted}`;
    }

    return label;
}

function growthTrendClass(item: ForecastItem) {
    const normalized = String(item.growthTrend || "").toUpperCase();

    if (normalized === "GROWING" || normalized === "NEW_DEMAND") {
        return "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]";
    }

    if (normalized === "DECLINING") {
        return "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";
    }

    return "border-[#E6DDF0] bg-[#FBF9FD] text-[#6B5B78]";
}

function seasonalityClass(seasonality: ItemSeasonality | undefined) {
    const status = String(seasonality?.status || "").toUpperCase();

    if (status === "PEAK_SEASON") {
        return "border-[#D9C7F0] bg-[#F4EEFC] text-[#4E2C66]";
    }

    if (status === "OFF_PEAK") {
        return "border-[#E6DDF0] bg-[#FBF9FD] text-[#6B5B78]";
    }

    if (status === "LIMITED_HISTORY" || status === "NO_HISTORY") {
        return "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";
    }

    return "border-[#CFE8DA] bg-[#F1FBF5] text-[#138342]";
}

function seasonalityLabel(seasonality: ItemSeasonality | undefined) {
    if (!seasonality) return "Seasonal signal loading";

    return safeText(seasonality.label, "No seasonal signal yet");
}

function movementLabel(value: string | undefined) {
    const normalized = String(value || "").toUpperCase();

    if (normalized === "FAST_MOVING") return "Fast-moving";
    if (normalized === "REGULAR_MOVING") return "Regular-moving";
    if (normalized === "SLOW_MOVING") return "Slow-moving";
    return "No movement";
}

function stockoutLabel(item: ForecastItem) {
    if (
        item.daysUntilStockout === null ||
        item.daysUntilStockout === undefined ||
        !Number.isFinite(Number(item.daysUntilStockout))
    ) {
        return "No estimate";
    }

    if (Number(item.daysUntilStockout) <= 0) return "Out of stock";

    return `${Number(item.daysUntilStockout).toFixed(1)} days`;
}

function bookingAllocationLabel(item: ForecastItem) {
    const quantity = numberValue(item.allocatedQuantity);

    return quantity > 0 ? `${formatNumber(quantity)} items reserved` : "No booking allocation";
}

export function formatCurrentDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const timeLabel = value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();

    return `${dateLabel} | ${timeLabel}`;
}

export function formatNumber(value: number) {
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
    }).format(numberValue(value));
}

function isMonthInputValue(value: string) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function monthInputValueFromDate(value: Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(
        2,
        "0"
    )}`;
}

function getLastMonthsRange(monthCount = 12): SeasonalDateRange {
    const current = new Date();
    const end = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)
    );
    const start = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (monthCount - 1), 1)
    );

    return {
        startMonth: monthInputValueFromDate(start),
        endMonth: monthInputValueFromDate(end),
    };
}

function normalizeSeasonalRange(
    range: SeasonalDateRange
): SeasonalDateRange {
    const fallback = getLastMonthsRange(12);
    const startMonth = isMonthInputValue(range.startMonth)
        ? range.startMonth
        : fallback.startMonth;
    const endMonth = isMonthInputValue(range.endMonth)
        ? range.endMonth
        : fallback.endMonth;

    return startMonth <= endMonth
        ? { startMonth, endMonth }
        : { startMonth: endMonth, endMonth: startMonth };
}

async function requestForecastApi<T>(
    token: string,
    action: string,
    payload: Record<string, unknown> = {}
): Promise<T> {
    const response = await fetch("/api/forecasting", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            action,
            ...payload,
        }),
        cache: "no-store",
    });

    const responsePayload = (await response.json().catch(() => ({}))) as
        | T
        | { error?: string; details?: string };

    if (!response.ok) {
        const errorPayload = responsePayload as {
            error?: string;
            details?: string;
        };

        const message =
            errorPayload.error || "Unable to load forecast data.";
        const details = errorPayload.details
            ? ` ${errorPayload.details}`
            : "";

        throw new Error(`${message}${details}`);
    }

    return responsePayload as T;
}

export function useLiveForecasting() {
    const [data, setData] = useState<ForecastApiResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const [seasonalData, setSeasonalData] =
        useState<SeasonalApiResponse | null>(null);
    const [seasonalLoading, setSeasonalLoading] = useState(true);
    const [seasonalError, setSeasonalError] = useState<string | null>(null);
    const [seasonalRange, setSeasonalRange] = useState<SeasonalDateRange>(() =>
        getLastMonthsRange(12)
    );

    const [bookingData, setBookingData] =
        useState<BookingApiResponse | null>(null);
    const [bookingLoading, setBookingLoading] = useState(true);
    const [bookingError, setBookingError] = useState<string | null>(null);

    const initialLoadStarted = useRef(false);

    const applySeasonalRange = useCallback(
        async (nextRange: SeasonalDateRange) => {
            const selectedRange = normalizeSeasonalRange(nextRange);

            setSeasonalRange(selectedRange);
            setSeasonalLoading(true);
            setSeasonalError(null);

            const token =
                typeof window !== "undefined"
                    ? sessionStorage.getItem("token")
                    : null;

            if (!token) {
                const sessionMessage =
                    "Your login session is missing. Please log in again.";

                setSeasonalData(null);
                setSeasonalError(sessionMessage);
                setSeasonalLoading(false);
                return;
            }

            try {
                const seasonal = await requestForecastApi<SeasonalApiResponse>(
                    token,
                    "get_seasonal_analysis",
                    {
                        seasonalStartMonth: selectedRange.startMonth,
                        seasonalEndMonth: selectedRange.endMonth,
                    }
                );

                if (seasonal.success && seasonal.seasonal) {
                    setSeasonalData(seasonal);
                } else {
                    setSeasonalError(
                        "The Seasonal Demand Patterns service returned an invalid response."
                    );
                }
            } catch (requestError) {
                setSeasonalError(
                    requestError instanceof Error
                        ? requestError.message
                        : "Unable to load the Seasonal Demand Patterns."
                );
            } finally {
                setSeasonalLoading(false);
            }
        },
        []
    );

    const refresh = useCallback(async () => {
        const token =
            typeof window !== "undefined"
                ? sessionStorage.getItem("token")
                : null;

        if (!token) {
            const sessionMessage =
                "Your login session is missing. Please log in again.";

            setData(null);
            setError(sessionMessage);
            setSeasonalData(null);
            setSeasonalError(sessionMessage);
            setBookingData(null);
            setBookingError(sessionMessage);
            setLoading(false);
            setSeasonalLoading(false);
            setBookingLoading(false);
            return;
        }

        setLoading(true);
        setSeasonalLoading(true);
        setBookingLoading(true);
        setError(null);
        setSeasonalError(null);
        setBookingError(null);

        const [inventoryResult, seasonalResult, bookingResult] =
            await Promise.allSettled([
                requestForecastApi<ForecastApiResponse>(
                    token,
                    "get_inventory_forecast"
                ),
                requestForecastApi<SeasonalApiResponse>(
                    token,
                    "get_seasonal_analysis",
                    {
                        seasonalStartMonth: seasonalRange.startMonth,
                        seasonalEndMonth: seasonalRange.endMonth,
                    }
                ),
                requestForecastApi<BookingApiResponse>(
                    token,
                    "get_booking_forecast"
                ),
            ]);

        if (inventoryResult.status === "fulfilled") {
            const inventory = inventoryResult.value;

            if (inventory.success && Array.isArray(inventory.items)) {
                setData(inventory);

                const generatedAt = new Date(inventory.generatedAt);
                setLastUpdated(
                    Number.isNaN(generatedAt.getTime())
                        ? new Date()
                        : generatedAt
                );
            } else {
                setData(null);
                setError(
                    "The Product Demand Forecast service returned an invalid response."
                );
            }
        } else {
            setData(null);
            setError(
                inventoryResult.reason instanceof Error
                    ? inventoryResult.reason.message
                    : "Unable to load the Product Demand Forecast."
            );
        }

        if (seasonalResult.status === "fulfilled") {
            const seasonal = seasonalResult.value;

            if (seasonal.success && seasonal.seasonal) {
                setSeasonalData(seasonal);
            } else {
                setSeasonalData(null);
                setSeasonalError(
                    "The Seasonal Demand Patterns service returned an invalid response."
                );
            }
        } else {
            setSeasonalData(null);
            setSeasonalError(
                seasonalResult.reason instanceof Error
                    ? seasonalResult.reason.message
                    : "Unable to load the Seasonal Demand Patterns."
            );
        }

        if (bookingResult.status === "fulfilled") {
            const booking = bookingResult.value;

            if (booking.success && booking.booking) {
                setBookingData(booking);
            } else {
                setBookingData(null);
                setBookingError(
                    "The Upcoming Booking Demand service returned an invalid response."
                );
            }
        } else {
            setBookingData(null);
            setBookingError(
                bookingResult.reason instanceof Error
                    ? bookingResult.reason.message
                    : "Unable to load the Upcoming Booking Demand."
            );
        }

        setLoading(false);
        setSeasonalLoading(false);
        setBookingLoading(false);
    }, [seasonalRange]);

    useEffect(() => {
        if (initialLoadStarted.current) {
            return;
        }

        initialLoadStarted.current = true;
        void refresh();
    }, [refresh]);

    return {
        data,
        loading,
        error,
        lastUpdated,
        seasonalData,
        seasonalLoading,
        seasonalError,
        seasonalRange,
        applySeasonalRange,
        bookingData,
        bookingLoading,
        bookingError,
        refresh,
    };
}

export function getDemandItems(items: ForecastItem[]) {
    const levelPriority: Record<string, number> = {
        HIGH: 0,
        MODERATE: 1,
        LOW: 2,
        NO_RECENT_DEMAND: 3,
    };

    return [...items]
        .filter((item) => numberValue(item.forecastedDemand) > 0)
        .sort(
            (first, second) =>
                (levelPriority[String(first.demandLevel || "NO_RECENT_DEMAND")] ??
                    4) -
                (levelPriority[
                    String(second.demandLevel || "NO_RECENT_DEMAND")
                    ] ?? 4) ||
                numberValue(second.forecastedDemand) -
                numberValue(first.forecastedDemand) ||
                String(first.itemName).localeCompare(String(second.itemName))
        );
}

export function getStockActionItems(items: ForecastItem[]) {
    return [...items]
        .filter(isStockActionItem)
        .sort(
            (first, second) =>
                numberValue(second.suggestedRestock) -
                numberValue(first.suggestedRestock) ||
                numberValue(second.forecastedDemand) -
                numberValue(first.forecastedDemand)
        );
}

export function buildBranchForecasts(items: ForecastItem[]) {
    const branchMap = new Map<number, ForecastItem[]>();

    items.forEach((item) => {
        const current = branchMap.get(item.branchId) || [];
        current.push(item);
        branchMap.set(item.branchId, current);
    });

    return Array.from(branchMap.entries())
        .map(([branchId, branchItems]): BranchForecastSummary => {
            const demand = branchItems.reduce(
                (total, item) => total + numberValue(item.forecastedDemand),
                0
            );

            const alerts = branchItems.filter(isStockActionItem).length;
            const highDemandItems = branchItems.filter(
                (item) => String(item.demandLevel).toUpperCase() === "HIGH"
            ).length;
            const growingItems = branchItems.filter((item) => {
                const trend = String(item.growthTrend || "").toUpperCase();
                return trend === "GROWING" || trend === "NEW_DEMAND";
            }).length;

            const topDemandItem = getDemandItems(branchItems)[0];

            return {
                id: branchId,
                name: branchItems[0]?.branchName || "Unnamed Branch",
                demand,
                alerts,
                highDemandItems,
                growingItems,
                topItem:
                    topDemandItem &&
                    numberValue(topDemandItem.forecastedDemand) > 0
                        ? topDemandItem.itemName
                        : "No recent POS demand",
            };
        })
        .sort(
            (first, second) =>
                second.demand - first.demand ||
                second.highDemandItems - first.highDemandItems ||
                first.name.localeCompare(second.name)
        );
}

export function buildScopedForecast(
    data: ForecastApiResponse,
    branchId: number
): ForecastApiResponse {
    const items = data.items.filter((item) => item.branchId === branchId);
    const stockActionItems = items.filter(isStockActionItem);
    const highDemandItems = items.filter(
        (item) => String(item.demandLevel).toUpperCase() === "HIGH"
    );
    const growingDemandItems = items.filter((item) => {
        const trend = String(item.growthTrend || "").toUpperCase();
        return trend === "GROWING" || trend === "NEW_DEMAND";
    });
    const peakSeasonItems = items.filter(
        (item) => item.seasonality?.status === "PEAK_SEASON"
    );

    return {
        ...data,
        scope: {
            ...data.scope,
            branchId,
        },
        summary: {
            ...data.summary,
            projectedDemand: items.reduce(
                (total, item) => total + numberValue(item.forecastedDemand),
                0
            ),
            expectedBookings: 0,
            restockAlerts: stockActionItems.length,
            lowStockItems: items.filter(
                (item) => String(item.status).toUpperCase() === "LOW"
            ).length,
            riskItems: items.filter(
                (item) => String(item.status).toUpperCase() === "RISK"
            ).length,
            trackedItems: items.length,
            highDemandItems: highDemandItems.length,
            growingDemandItems: growingDemandItems.length,
            peakSeasonItems: peakSeasonItems.length,
        },
        items,
    };
}

export function buildScopedBookingForecast(
    bookingData: BookingApiResponse | null,
    branchId: number
): BookingApiResponse | null {
    if (!bookingData?.booking) {
        return null;
    }

    const upcomingBookings = bookingData.booking.upcomingBookings.filter(
        (booking) => booking.branchId === branchId
    );

    const confirmedBookings = upcomingBookings.filter(
        (booking) => String(booking.status).toLowerCase() !== "preparing"
    ).length;

    const preparingBookings = upcomingBookings.filter(
        (booking) => String(booking.status).toLowerCase() === "preparing"
    ).length;

    const byDate = new Map<string, BookingPeakDate>();
    const byTime = new Map<string, BookingPeakTime>();
    const byWeekday = new Map<string, BookingPeakDay>();
    const byPackage = new Map<string, BookingPackageDemand>();

    upcomingBookings.forEach((booking) => {
        if (booking.eventDate) {
            const date = byDate.get(booking.eventDate) || {
                date: booking.eventDate,
                label: booking.eventDateLabel || booking.eventDate,
                bookings: 0,
            };

            date.bookings += 1;
            byDate.set(booking.eventDate, date);

            const dateValue = new Date(`${booking.eventDate}T00:00:00.000Z`);
            const weekday = Number.isNaN(dateValue.getTime())
                ? "Unscheduled"
                : new Intl.DateTimeFormat("en-US", {
                    weekday: "long",
                }).format(dateValue);

            const day = byWeekday.get(weekday) || {
                weekday,
                bookings: 0,
            };

            day.bookings += 1;
            byWeekday.set(weekday, day);
        }

        if (booking.eventTime) {
            const time = byTime.get(booking.eventTime) || {
                time: booking.eventTime,
                bookings: 0,
            };

            time.bookings += 1;
            byTime.set(booking.eventTime, time);
        }

        const packageName = booking.packageName || "Custom / Unspecified";
        const packageDemand = byPackage.get(packageName) || {
            packageName,
            bookings: 0,
        };

        packageDemand.bookings += 1;
        byPackage.set(packageName, packageDemand);
    });

    const sortByBookingCount = <T extends { bookings: number }>(
        first: T,
        second: T
    ) => second.bookings - first.bookings;

    const peakBookingDate =
        [...byDate.values()].sort(sortByBookingCount)[0] || null;
    const peakBookingTime =
        [...byTime.values()].sort(sortByBookingCount)[0] || null;
    const peakBookingDay =
        [...byWeekday.values()].sort(sortByBookingCount)[0] || null;

    return {
        ...bookingData,
        scope: {
            ...bookingData.scope,
            branchId,
        },
        booking: {
            ...bookingData.booking,
            expectedBookings: upcomingBookings.length,
            confirmedBookings,
            preparingBookings,
            peakBookingDate,
            peakBookingTime,
            peakBookingDay,
            topPackages: [...byPackage.values()]
                .sort(sortByBookingCount)
                .slice(0, 8),
            upcomingBookings,
            allocationSummary: {
                ...bookingData.booking.allocationSummary,
                allocatedUnits: 0,
                allocationItems: 0,
                bookingsWithoutAllocation: upcomingBookings.filter(
                    (booking) => booking.allocationCount === 0
                ).length,
                unlinkedAllocationEntries: 0,
            },
            allocatedInventory: [],
        },
    };
}

export function ForecastLoadingState() {
    return (
        <div className="flex min-h-[260px] items-center justify-center rounded-[14px] border border-[#E6DDF0] bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-sm font-semibold text-[#5F4E75]">
                <LoaderCircle size={19} className="animate-spin text-[#4E2C66]" />
                Loading live demand forecast data...
            </div>
        </div>
    );
}

export function ForecastErrorState({ message }: { message: string }) {
    return (
        <div className="rounded-[14px] border border-[#F2C4C4] bg-[#FFF6F6] p-5 text-sm text-[#8E2D2D] shadow-sm">
            <p className="font-semibold">Unable to load the live demand forecast.</p>
            <p className="mt-1 leading-6">{message}</p>
            <p className="mt-2 text-xs text-[#A65A5A]">
                Use the Refresh button after checking the Forecasting API connection.
            </p>
        </div>
    );
}

export function ForecastEmptyState() {
    return (
        <div className="rounded-[14px] border border-dashed border-[#D8CBE7] bg-white p-8 text-center shadow-sm">
            <PackageSearch size={28} className="mx-auto text-[#806A8C]" />
            <p className="mt-3 text-sm font-semibold text-[#2B174C]">
                No demand forecast data is available yet.
            </p>
            <p className="mt-1 text-sm text-[#7A6A84]">
                Record completed POS sales and keep product stock records updated to
                generate a demand forecast.
            </p>
        </div>
    );
}

export function SummaryCard({
                                icon,
                                title,
                                value,
                                detail,
                                tone,
                            }: {
    icon: ReactNode;
    title: string;
    value: ReactNode;
    detail: string;
    tone: "purple" | "gold" | "red" | "green";
}) {
    const toneStyles = {
        purple: "bg-[#EFE8F8] text-[#4E2C66]",
        gold: "bg-[#FFF4D8] text-[#A56607]",
        red: "bg-[#FFF0F0] text-[#C32F2F]",
        green: "bg-[#EDFBF1] text-[#138342]",
    };

    return (
        <div className="min-h-[112px] rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
            <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneStyles[tone]}`}
            >
                {icon}
            </div>
            <p className="mt-3 text-sm font-semibold text-[#2B174C]">{title}</p>
            <p className="mt-1 text-[24px] font-bold leading-tight text-[#1A1220]">
                {value}
            </p>
            <p className="mt-1 text-xs text-[#7A6A84]">{detail}</p>
        </div>
    );
}

export function ForecastTabButton({
                                      active,
                                      onClick,
                                      label,
                                  }: {
    active: boolean;
    onClick: () => void;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`h-[42px] rounded-xl px-4 text-sm font-semibold transition ${
                active
                    ? "bg-[#2B174C] text-white shadow-sm"
                    : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]"
            }`}
        >
            {label}
        </button>
    );
}

function SignalBadge({
                         label,
                         className,
                     }: {
    label: string;
    className: string;
}) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}
        >
            {label}
        </span>
    );
}

function ForecastMetric({
                            label,
                            value,
                            accent,
                        }: {
    label: string;
    value: string;
    accent?: "purple" | "green" | "gold" | "red";
}) {
    const accentClass =
        accent === "green"
            ? "text-[#138342]"
            : accent === "gold"
                ? "text-[#A56607]"
                : accent === "red"
                    ? "text-[#C32F2F]"
                    : accent === "purple"
                        ? "text-[#4E2C66]"
                        : "text-[#1A1220]";

    return (
        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                {label}
            </p>
            <p className={`mt-1 text-sm font-bold ${accentClass}`}>{value}</p>
        </div>
    );
}

function ProductDemandCard({
                               item,
                               canViewInventory,
                           }: {
    item: ForecastItem;
    canViewInventory: boolean;
}) {
    const demandReason =
        item.demandLevelReason ||
        "Projected from completed POS sales in the current history window.";

    const seasonalDetail =
        item.seasonality?.detail ||
        "Seasonal comparison is not available for this item yet.";

    return (
        <article className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="truncate text-[16px] font-bold text-[#1A1220]">
                        {item.itemName}
                    </h3>
                    <p className="mt-1 truncate text-xs text-[#7A6A84]">
                        {item.category} · {item.branchName}
                    </p>
                </div>

                <SignalBadge
                    label={demandLevelLabel(item.demandLevel)}
                    className={demandLevelClass(item.demandLevel)}
                />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                <SignalBadge
                    label={growthTrendLabel(item)}
                    className={growthTrendClass(item)}
                />
                <SignalBadge
                    label={seasonalityLabel(item.seasonality)}
                    className={seasonalityClass(item.seasonality)}
                />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
                <ForecastMetric
                    label="30-day demand forecast"
                    value={`${formatNumber(item.forecastedDemand)} items expected`}
                    accent="purple"
                />
                <ForecastMetric
                    label="12-week movement"
                    value={movementLabel(item.movementClass)}
                    accent="green"
                />
                <ForecastMetric
                    label="Recent POS items sold"
                    value={`${formatNumber(
                        numberValue(item.recentFourWeekDemand)
                    )} vs ${formatNumber(
                        numberValue(item.previousFourWeekDemand)
                    )} items`}
                />
                <ForecastMetric
                    label="Peak selling months"
                    value={
                        item.seasonality?.peakMonths?.length
                            ? item.seasonality.peakMonths.slice(0, 2).join(", ")
                            : "Not enough history"
                    }
                />
            </div>

            <div className="mt-4 rounded-xl border border-[#E6DDF0] bg-[#FAF7FE] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                    Why this product is in demand
                </p>
                <p className="mt-1 text-xs leading-5 text-[#5F4E75]">
                    {demandReason}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#5F4E75]">
                    Seasonal signal: {seasonalDetail}
                </p>
            </div>

            <div className="mt-4 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-[#2B174C]">
                        Stock planning response
                    </p>
                    <SignalBadge
                        label={stockRiskLabel(item)}
                        className={stockRiskClass(item)}
                    />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                        <p className="text-[#806A8C]">Available now</p>
                        <p className="mt-1 font-bold text-[#1A1220]">
                            {formatNumber(item.availableQuantity)} items
                        </p>
                    </div>
                    <div>
                        <p className="text-[#806A8C]">Items reserved for bookings</p>
                        <p className="mt-1 font-bold text-[#1A1220]">
                            {bookingAllocationLabel(item)}
                        </p>
                    </div>
                    <div>
                        <p className="text-[#806A8C]">Stockout estimate</p>
                        <p className="mt-1 font-bold text-[#1A1220]">
                            {stockoutLabel(item)}
                        </p>
                    </div>
                </div>

                {numberValue(item.suggestedRestock) > 0 && (
                    <p className="mt-3 border-t border-[#E6DDF0] pt-3 text-xs text-[#A56607]">
                        Suggested stock action: add{" "}
                        <span className="font-bold">
                            {formatNumber(item.suggestedRestock)} items
                        </span>{" "}
                        to cover the expected demand and safety stock.
                    </p>
                )}
            </div>

            {canViewInventory && (
                <a
                    href="/inventory"
                    className="mt-4 inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#E6DDF0] bg-white text-xs font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                >
                    View inventory
                    <ChevronRight size={15} />
                </a>
            )}
        </article>
    );
}

function ForecastTableHeader({ children }: { children: ReactNode }) {
    return (
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
            {children}
        </th>
    );
}

function ForecastTableCell({
                               children,
                               strong = false,
                           }: {
    children: ReactNode;
    strong?: boolean;
}) {
    return (
        <td
            className={`px-4 py-3 align-top text-sm ${
                strong ? "font-semibold text-[#1A1220]" : "text-[#5F4E75]"
            }`}
        >
            {children}
        </td>
    );
}

function PanelLoading({ label }: { label: string }) {
    return (
        <div className="flex min-h-[200px] items-center justify-center rounded-[14px] border border-[#E6DDF0] bg-white p-6">
            <div className="flex items-center gap-3 text-sm font-semibold text-[#5F4E75]">
                <LoaderCircle size={18} className="animate-spin text-[#4E2C66]" />
                Loading live {label}...
            </div>
        </div>
    );
}

function PanelError({
                        title,
                        message,
                    }: {
    title: string;
    message: string;
}) {
    return (
        <section className="rounded-[14px] border border-[#F2C4C4] bg-[#FFF6F6] p-5">
            <h2 className="text-[16px] font-bold text-[#8E2D2D]">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-[#A65A5A]">{message}</p>
        </section>
    );
}

function InsightValue({
                          label,
                          value,
                          detail,
                          accent,
                      }: {
    label: string;
    value: string;
    detail?: string;
    accent?: "purple" | "green" | "gold" | "red" | "blue";
}) {
    const valueClass =
        accent === "green"
            ? "text-[#138342]"
            : accent === "gold"
                ? "text-[#A56607]"
                : accent === "red"
                    ? "text-[#C32F2F]"
                    : accent === "blue"
                        ? "text-[#3376B1]"
                        : accent === "purple"
                            ? "text-[#4E2C66]"
                            : "text-[#1A1220]";

    return (
        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#806A8C]">
                {label}
            </p>
            <p className={`mt-1 text-sm font-bold ${valueClass}`}>{value}</p>
            {detail && <p className="mt-1 text-xs leading-5 text-[#7A6A84]">{detail}</p>}
        </div>
    );
}

function InventoryForecastPanel({
                                    data,
                                    canViewInventory,
                                }: {
    data: ForecastApiResponse;
    canViewInventory: boolean;
}) {
    const demandItems = getDemandItems(data.items);
    const stockActionItems = getStockActionItems(data.items);
    const focusItems = demandItems.slice(0, 3);
    const highDemandItems =
        data.summary.highDemandItems ??
        demandItems.filter((item) => item.demandLevel === "HIGH").length;
    const growingDemandItems =
        data.summary.growingDemandItems ??
        demandItems.filter((item) => {
            const trend = String(item.growthTrend || "").toUpperCase();
            return trend === "GROWING" || trend === "NEW_DEMAND";
        }).length;
    const peakSeasonItems =
        data.summary.peakSeasonItems ??
        demandItems.filter(
            (item) => item.seasonality?.status === "PEAK_SEASON"
        ).length;

    return (
        <div className="space-y-4">
            <section className="rounded-[14px] border border-[#D8CBE7] bg-[#F7F1FF] p-4">
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2B174C] text-white">
                        <TrendingUp size={18} />
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-[#2B174C]">
                            Product Demand Forecast
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-[#5F4E75]">
                            This view explains estimated customer demand first. Demand
                            Level compares each product&apos;s projected 30-day demand
                            with other items in the same branch. Demand Trend compares
                            recent four-week sales with the four weeks before it.
                            Seasonality compares the current month with the product&apos;s
                            own monthly POS history. Stock actions are shown separately
                            below.
                        </p>
                    </div>
                </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <InsightValue
                    label="Products with high demand"
                    value={`${formatNumber(highDemandItems)} item${
                        highDemandItems === 1 ? "" : "s"
                    }`}
                    detail="Top projected demand within this branch"
                />
                <InsightValue
                    label="Demand rising or new"
                    value={`${formatNumber(growingDemandItems)} item${
                        growingDemandItems === 1 ? "" : "s"
                    }`}
                    detail="Recent four weeks compared with prior four weeks"
                />
                <InsightValue
                    label="Peak-season signals"
                    value={`${formatNumber(peakSeasonItems)} item${
                        peakSeasonItems === 1 ? "" : "s"
                    }`}
                    detail="Current month is above this product's usual monthly demand"
                />
                <InsightValue
                    label="Products tracked"
                    value={`${formatNumber(data.summary.trackedItems)} item${
                        data.summary.trackedItems === 1 ? "" : "s"
                    }`}
                    detail={`${data.scope.historyWeeks} weeks of completed POS history`}
                />
            </div>

            {focusItems.length > 0 ? (
                <section>
                    <div className="mb-3">
                        <h3 className="text-[16px] font-bold text-[#1A1220]">
                            Highest projected product demand
                        </h3>
                        <p className="mt-1 text-xs text-[#7A6A84]">
                            These products have the strongest projected demand signal,
                            regardless of their current stock quantity.
                        </p>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-3">
                        {focusItems.map((item) => (
                            <ProductDemandCard
                                key={item.id}
                                item={item}
                                canViewInventory={canViewInventory}
                            />
                        ))}
                    </div>
                </section>
            ) : (
                <ForecastEmptyState />
            )}

            <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                <div className="flex flex-col gap-2 border-b border-[#E6DDF0] px-4 py-3.5 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-[16px] font-bold text-[#1A1220]">
                            Demand signals by product
                        </h3>
                        <p className="mt-1 text-xs text-[#7A6A84]">
                            A product&apos;s demand signal is based on predicted demand,
                            recent sales movement, and its own seasonal history—not on
                            low stock alone.
                        </p>
                    </div>
                    <span className="w-fit rounded-full border border-[#D8CBE7] bg-[#F7F1FF] px-2.5 py-1 text-xs font-semibold text-[#4E2C66]">
                        Next {data.scope.periodDays} days
                    </span>
                </div>

                {demandItems.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1120px] border-collapse">
                            <thead className="bg-[#FFFCF7]">
                            <tr className="border-b border-[#E6DDF0]">
                                <ForecastTableHeader>Product</ForecastTableHeader>
                                <ForecastTableHeader>Demand Level</ForecastTableHeader>
                                <ForecastTableHeader>Demand Trend</ForecastTableHeader>
                                <ForecastTableHeader>Seasonal Signal</ForecastTableHeader>
                                <ForecastTableHeader>30-Day Demand</ForecastTableHeader>
                                <ForecastTableHeader>Movement</ForecastTableHeader>
                            </tr>
                            </thead>
                            <tbody>
                            {demandItems.slice(0, 30).map((item) => (
                                <tr
                                    key={item.id}
                                    className="border-b border-[#EEE7F2] last:border-b-0"
                                >
                                    <ForecastTableCell strong>
                                        <p>{item.itemName}</p>
                                        <p className="mt-1 text-xs font-normal text-[#806A8C]">
                                            {item.category} · {item.branchName}
                                        </p>
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        <SignalBadge
                                            label={demandLevelLabel(item.demandLevel)}
                                            className={demandLevelClass(item.demandLevel)}
                                        />
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        <SignalBadge
                                            label={growthTrendLabel(item)}
                                            className={growthTrendClass(item)}
                                        />
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        <div>
                                            <SignalBadge
                                                label={seasonalityLabel(item.seasonality)}
                                                className={seasonalityClass(item.seasonality)}
                                            />
                                            <p className="mt-1 max-w-[260px] text-xs leading-5 text-[#806A8C]">
                                                {item.seasonality?.peakMonths?.length
                                                    ? `Highest recorded months: ${item.seasonality.peakMonths
                                                        .slice(0, 2)
                                                        .join(", ")}`
                                                    : "No item-level seasonal pattern yet"}
                                            </p>
                                        </div>
                                    </ForecastTableCell>
                                    <ForecastTableCell strong>
                                        {formatNumber(item.forecastedDemand)} items expected
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        {movementLabel(item.movementClass)}
                                    </ForecastTableCell>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-6 text-center text-sm text-[#7A6A84]">
                        No completed POS demand is available in the current forecast
                        window.
                    </div>
                )}
            </section>

            <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                <div className="flex flex-col gap-2 border-b border-[#E6DDF0] px-4 py-3.5 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-[16px] font-bold text-[#1A1220]">
                            Stock planning actions
                        </h3>
                        <p className="mt-1 text-xs text-[#7A6A84]">
                            These are inventory actions after comparing demand with
                            available stock and confirmed booking allocations. A stock
                            alert does not mean that an item is automatically high
                            demand.
                        </p>
                    </div>
                    <span className="w-fit rounded-full border border-[#F4D79A] bg-[#FFF8E8] px-2.5 py-1 text-xs font-semibold text-[#A56607]">
                        {formatNumber(stockActionItems.length)} action item
                        {stockActionItems.length === 1 ? "" : "s"}
                    </span>
                </div>

                {stockActionItems.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1040px] border-collapse">
                            <thead className="bg-[#FFFCF7]">
                            <tr className="border-b border-[#E6DDF0]">
                                <ForecastTableHeader>Product</ForecastTableHeader>
                                <ForecastTableHeader>Stock Risk</ForecastTableHeader>
                                <ForecastTableHeader>Available After Bookings</ForecastTableHeader>
                                <ForecastTableHeader>Stockout Estimate</ForecastTableHeader>
                                <ForecastTableHeader>30-Day Demand</ForecastTableHeader>
                                <ForecastTableHeader>Suggested Stock Action</ForecastTableHeader>
                            </tr>
                            </thead>
                            <tbody>
                            {stockActionItems.slice(0, 25).map((item) => (
                                <tr
                                    key={item.id}
                                    className="border-b border-[#EEE7F2] last:border-b-0"
                                >
                                    <ForecastTableCell strong>
                                        {item.itemName}
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        <SignalBadge
                                            label={stockRiskLabel(item)}
                                            className={stockRiskClass(item)}
                                        />
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        {formatNumber(item.availableQuantity)} items
                                        {numberValue(item.allocatedQuantity) > 0 && (
                                            <p className="mt-1 text-xs text-[#806A8C]">
                                                {formatNumber(item.allocatedQuantity)} booked
                                            </p>
                                        )}
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        {stockoutLabel(item)}
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        {formatNumber(item.forecastedDemand)} items expected
                                    </ForecastTableCell>
                                    <ForecastTableCell strong>
                                        {numberValue(item.suggestedRestock) > 0
                                            ? `Add ${formatNumber(
                                                item.suggestedRestock
                                            )} items`
                                            : "No immediate action"}
                                    </ForecastTableCell>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-6 text-center text-sm text-[#7A6A84]">
                        Current stock can cover the recorded demand signal. No stock
                        action is required right now.
                    </div>
                )}
            </section>
        </div>
    );
}

function trendLabel(value: string) {
    const normalized = String(value || "").replaceAll("_", " ").toLowerCase();

    return normalized
        ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
        : "No trend available";
}

function formatSeasonalMonthYear(value?: string) {
    const dateKey = String(value || "").slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return "—";
    }

    const date = new Date(`${dateKey}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
        return dateKey;
    }

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
    }).format(date);
}

function getSeasonalSourceYears(
    monthNumber: number,
    monthlyHistory: SeasonalMonthHistory[]
) {
    const years = Array.from(
        new Set(
            monthlyHistory
                .filter(
                    (entry) =>
                        Number(String(entry.monthKey || "").slice(5, 7)) ===
                        monthNumber
                )
                .map((entry) => String(entry.monthKey || "").slice(0, 4))
                .filter((year) => /^\d{4}$/.test(year))
        )
    ).sort();

    return years.length > 0 ? years.join(", ") : "—";
}

function getSeasonalMonthWithSourceYears(
    month: SeasonalMonth,
    monthlyHistory: SeasonalMonthHistory[]
) {
    const sourceYears = getSeasonalSourceYears(month.monthNumber, monthlyHistory);

    return sourceYears === "—"
        ? month.month
        : `${month.month} (${sourceYears})`;
}

type SeasonalDisplayRow = SeasonalMonth & {
    sourceYears: string;
    changeFromAverage: number | null;
    changeFromPrevious: number | null;
};

function formatSeasonalPercentage(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "—";
    }

    const rounded = Math.round(value);
    return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function seasonalPercentageDifference(value: number, baseline: number) {
    if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) {
        return null;
    }

    return ((value - baseline) / baseline) * 100;
}

function getSeasonalDemandLevel(value: number, average: number) {
    const ratio = average > 0 ? value / average : 0;

    if (ratio >= 2) {
        return {
            label: "Very High",
            className: "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
        };
    }

    if (ratio >= 1.5) {
        return {
            label: "High",
            className: "border-[#F7D7A1] bg-[#FFF5E8] text-[#B45A06]",
        };
    }

    if (ratio >= 1.15) {
        return {
            label: "Moderate",
            className: "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
        };
    }

    if (ratio >= 0.75) {
        return {
            label: "Low",
            className: "border-[#D8E7F7] bg-[#F1F8FF] text-[#3376B1]",
        };
    }

    return {
        label: "Very Low",
        className: "border-[#D8E7F7] bg-[#F1F8FF] text-[#3376B1]",
    };
}

function getSeasonalityStrength(rows: SeasonalDisplayRow[]) {
    if (rows.length < 3) {
        return {
            label: "Not enough data",
            detail: "More monthly POS history is needed.",
        };
    }

    const mean =
        rows.reduce((total, row) => total + numberValue(row.totalUnits), 0) /
        rows.length;

    if (mean <= 0) {
        return {
            label: "No demand pattern",
            detail: "No completed POS item sales were found.",
        };
    }

    const variance =
        rows.reduce(
            (total, row) =>
                total + Math.pow(numberValue(row.totalUnits) - mean, 2),
            0
        ) / rows.length;

    const coefficientOfVariation = Math.sqrt(variance) / mean;

    if (coefficientOfVariation >= 0.65) {
        return {
            label: "Strong",
            detail: "High variation across calendar months.",
        };
    }

    if (coefficientOfVariation >= 0.35) {
        return {
            label: "Moderate",
            detail: "Noticeable variation across calendar months.",
        };
    }

    return {
        label: "Steady",
        detail: "Demand is relatively consistent across months.",
    };
}

function SeasonalDemandChart({
                                 rows,
                                 average,
                             }: {
    rows: SeasonalDisplayRow[];
    average: number;
}) {
    if (rows.length === 0) {
        return null;
    }

    /*
      A taller chart uses the full height of the dashboard card instead of
      leaving unused space under the plotted monthly demand line.
    */
    const width = 900;
    const height = 360;
    const left = 50;
    const right = 24;
    const top = 18;
    const bottom = 42;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const maximum = Math.max(
        average,
        ...rows.map((row) => numberValue(row.totalUnits)),
        1
    );
    const roundedMaximum = Math.max(25, Math.ceil(maximum / 25) * 25);
    const safeAverage = Math.max(0, average);

    const points = rows.map((row, index) => {
        const x =
            left +
            (rows.length === 1 ? chartWidth / 2 : (chartWidth / (rows.length - 1)) * index);
        const y = top + chartHeight - (numberValue(row.totalUnits) / roundedMaximum) * chartHeight;

        return { x, y, row };
    });

    const linePath = points
        .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(" ");

    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)} ${(top + chartHeight).toFixed(1)} L${points[0].x.toFixed(1)} ${(top + chartHeight).toFixed(1)} Z`;
    const averageY = top + chartHeight - (safeAverage / roundedMaximum) * chartHeight;
    const gridValues = [0, 0.25, 0.5, 0.75, 1];

    return (
        <div className="overflow-x-auto">
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="block min-w-[720px] w-full"
                role="img"
                aria-label="Monthly completed POS items sold compared with the twelve-month average"
            >
                <defs>
                    <linearGradient id="seasonalDemandArea" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#6D3DF5" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#6D3DF5" stopOpacity="0.01" />
                    </linearGradient>
                </defs>

                {gridValues.map((fraction) => {
                    const y = top + chartHeight - chartHeight * fraction;
                    const value = Math.round(roundedMaximum * fraction);

                    return (
                        <g key={fraction}>
                            <line
                                x1={left}
                                x2={width - right}
                                y1={y}
                                y2={y}
                                stroke="#EEE7F2"
                                strokeWidth="1"
                            />
                            <text
                                x={left - 10}
                                y={y + 4}
                                textAnchor="end"
                                fontSize="11"
                                fill="#806A8C"
                            >
                                {value}
                            </text>
                        </g>
                    );
                })}

                <line
                    x1={left}
                    x2={width - right}
                    y1={averageY}
                    y2={averageY}
                    stroke="#B9A7D8"
                    strokeDasharray="7 6"
                    strokeWidth="2"
                />

                <path d={areaPath} fill="url(#seasonalDemandArea)" />
                <path
                    d={linePath}
                    fill="none"
                    stroke="#6D3DF5"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {points.map((point) => (
                    <g key={point.row.monthNumber}>
                        <circle
                            cx={point.x}
                            cy={point.y}
                            r="4.5"
                            fill="#6D3DF5"
                            stroke="#FFFFFF"
                            strokeWidth="2"
                        />
                        <text
                            x={point.x}
                            y={height - 16}
                            textAnchor="middle"
                            fontSize="11"
                            fill="#5F4E75"
                            fontWeight="600"
                        >
                            {point.row.month.slice(0, 3)}
                        </text>
                    </g>
                ))}
            </svg>
        </div>
    );
}

function SeasonalBreakdownTable({
                                    rows,
                                    average,
                                }: {
    rows: SeasonalDisplayRow[];
    average: number;
}) {
    if (rows.length === 0) {
        return null;
    }

    const midpoint = Math.ceil(rows.length / 2);
    const groups = [rows.slice(0, midpoint), rows.slice(midpoint)].filter(
        (group) => group.length > 0
    );

    return (
        <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
            <div className="border-b border-[#E6DDF0] px-4 py-3.5">
                <h3 className="text-[16px] font-bold text-[#1A1220]">
                    Monthly Demand Breakdown
                </h3>
                <p className="mt-1 text-xs text-[#7A6A84]">
                    Every value is based on completed POS item quantities. The source year for each calendar month is shown below the month name.
                </p>
            </div>

            <div className="grid divide-y divide-[#E6DDF0] 2xl:grid-cols-2 2xl:divide-x 2xl:divide-y-0">
                {groups.map((group, groupIndex) => (
                    <div key={groupIndex} className="min-w-0">
                        <table className="w-full table-fixed border-collapse">
                            <colgroup>
                                <col className="w-[28%]" />
                                <col className="w-[17%]" />
                                <col className="w-[16%]" />
                                <col className="w-[17%]" />
                                <col className="w-[22%]" />
                            </colgroup>
                            <thead className="bg-[#FFFCF7]">
                            <tr className="border-b border-[#E6DDF0]">
                                <th className="px-2.5 py-2.5 text-left text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-[#806A8C] sm:px-3">
                                    Month
                                </th>
                                <th className="px-2.5 py-2.5 text-left text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-[#806A8C] sm:px-3">
                                    Items sold
                                </th>
                                <th className="px-2.5 py-2.5 text-left text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-[#806A8C] sm:px-3">
                                    Vs average
                                </th>
                                <th className="px-2.5 py-2.5 text-left text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-[#806A8C] sm:px-3">
                                    Vs prior month
                                </th>
                                <th className="px-2.5 py-2.5 text-left text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] text-[#806A8C] sm:px-3">
                                    Demand level
                                </th>
                            </tr>
                            </thead>
                            <tbody>
                            {group.map((row) => {
                                const demandLevel = getSeasonalDemandLevel(
                                    numberValue(row.totalUnits),
                                    average
                                );

                                return (
                                    <tr
                                        key={row.monthNumber}
                                        className="border-b border-[#EEE7F2] last:border-b-0"
                                    >
                                        <td className="px-2.5 py-2.5 align-top text-xs font-semibold text-[#1A1220] sm:px-3 sm:text-sm">
                                            <p>{row.month}</p>
                                            <p className="mt-0.5 text-[10px] font-normal text-[#806A8C] sm:text-xs">
                                                Year: {row.sourceYears}
                                            </p>
                                        </td>
                                        <td className="px-2.5 py-2.5 align-top text-xs font-semibold text-[#1A1220] sm:px-3 sm:text-sm">
                                            {formatNumber(row.totalUnits)} items
                                        </td>
                                        <td className="px-2.5 py-2.5 align-top text-xs sm:px-3 sm:text-sm">
                                                <span
                                                    className={
                                                        (row.changeFromAverage || 0) >= 0
                                                            ? "font-semibold text-[#138342]"
                                                            : "font-semibold text-[#806A8C]"
                                                    }
                                                >
                                                    {formatSeasonalPercentage(
                                                        row.changeFromAverage
                                                    )}
                                                </span>
                                        </td>
                                        <td className="px-2.5 py-2.5 align-top text-xs sm:px-3 sm:text-sm">
                                            {row.changeFromPrevious === null ? (
                                                "—"
                                            ) : (
                                                <span
                                                    className={
                                                        row.changeFromPrevious >= 0
                                                            ? "font-semibold text-[#138342]"
                                                            : "font-semibold text-[#806A8C]"
                                                    }
                                                >
                                                        {formatSeasonalPercentage(
                                                            row.changeFromPrevious
                                                        )}
                                                    </span>
                                            )}
                                        </td>
                                        <td className="px-2.5 py-2.5 align-top sm:px-3">
                                            <SignalBadge
                                                label={demandLevel.label}
                                                className={`${demandLevel.className} whitespace-normal text-center leading-4`}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>
                    </div>
                ))}
            </div>
        </section>
    );
}

function formatMonthInputLabel(value: string) {
    if (!isMonthInputValue(value)) {
        return "—";
    }

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
    }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function getMonthSpan(startMonth: string, endMonth: string) {
    if (!isMonthInputValue(startMonth) || !isMonthInputValue(endMonth)) {
        return 0;
    }

    const [startYear, startIndex] = startMonth.split("-").map(Number);
    const [endYear, endIndex] = endMonth.split("-").map(Number);

    return (endYear - startYear) * 12 + (endIndex - startIndex) + 1;
}

function SeasonalPeriodPicker({
                                  range,
                                  onApply,
                                  loading,
                              }: {
    range: SeasonalDateRange;
    onApply: (range: SeasonalDateRange) => Promise<void>;
    loading: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [draftRange, setDraftRange] = useState<SeasonalDateRange>(range);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [applying, setApplying] = useState(false);

    const latestMonth = monthInputValueFromDate(new Date());

    useEffect(() => {
        setDraftRange(range);
        setValidationError(null);
    }, [range.startMonth, range.endMonth]);

    const usePreset = (months: number) => {
        setDraftRange(getLastMonthsRange(months));
        setValidationError(null);
    };

    const handleApply = async () => {
        const startMonth = String(draftRange.startMonth || "");
        const endMonth = String(draftRange.endMonth || "");

        if (!isMonthInputValue(startMonth) || !isMonthInputValue(endMonth)) {
            setValidationError("Choose both a start month and an end month.");
            return;
        }

        if (startMonth > endMonth) {
            setValidationError("The start month must be before the end month.");
            return;
        }

        if (endMonth > latestMonth) {
            setValidationError("The end month cannot be later than the current month.");
            return;
        }

        if (getMonthSpan(startMonth, endMonth) > 60) {
            setValidationError("Choose a range of 60 months or fewer.");
            return;
        }

        setApplying(true);
        setValidationError(null);

        try {
            await onApply({ startMonth, endMonth });
            setIsOpen(false);
        } finally {
            setApplying(false);
        }
    };

    return (
        <div className="relative shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                disabled={loading}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                className="flex min-w-[230px] items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] bg-white px-3.5 py-2.5 text-left shadow-sm transition hover:border-[#CDB8F5] hover:bg-[#FCFAFF] disabled:cursor-wait disabled:opacity-70"
            >
                <span>
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                        Sales period
                    </span>
                    <span className="mt-0.5 block text-sm font-semibold text-[#2B174C]">
                        {formatMonthInputLabel(range.startMonth)} –{" "}
                        {formatMonthInputLabel(range.endMonth)}
                    </span>
                </span>
                <span className="flex items-center gap-1.5 text-[#6D3DF5]">
                    <CalendarDays size={17} />
                    <ChevronDown
                        size={16}
                        className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
                    />
                </span>
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label="Choose seasonal sales period"
                    className="absolute right-0 z-30 mt-2 w-[350px] max-w-[calc(100vw-3rem)] rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-xl"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-bold text-[#1A1220]">
                                Select sales period
                            </h3>
                            <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                Choose the completed POS sales months to analyse.
                                At least 12 months of recorded sales are needed for
                                a seasonal pattern.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="text-xs font-semibold text-[#6D3DF5] hover:text-[#4E2C66]"
                        >
                            Close
                        </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold text-[#5F4E75]">
                                From month
                            </span>
                            <input
                                type="month"
                                value={draftRange.startMonth}
                                max={latestMonth}
                                onChange={(event) => {
                                    setDraftRange((current) => ({
                                        ...current,
                                        startMonth: event.target.value,
                                    }));
                                    setValidationError(null);
                                }}
                                className="h-10 w-full rounded-lg border border-[#E6DDF0] bg-white px-2.5 text-sm font-medium text-[#2B174C] outline-none transition focus:border-[#8A67E8] focus:ring-2 focus:ring-[#E8DEFF]"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold text-[#5F4E75]">
                                To month
                            </span>
                            <input
                                type="month"
                                value={draftRange.endMonth}
                                max={latestMonth}
                                onChange={(event) => {
                                    setDraftRange((current) => ({
                                        ...current,
                                        endMonth: event.target.value,
                                    }));
                                    setValidationError(null);
                                }}
                                className="h-10 w-full rounded-lg border border-[#E6DDF0] bg-white px-2.5 text-sm font-medium text-[#2B174C] outline-none transition focus:border-[#8A67E8] focus:ring-2 focus:ring-[#E8DEFF]"
                            />
                        </label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        {[12, 24, 36].map((months) => (
                            <button
                                key={months}
                                type="button"
                                onClick={() => usePreset(months)}
                                className="rounded-lg border border-[#E6DDF0] bg-[#FCFAFF] px-2.5 py-1.5 text-xs font-semibold text-[#5F4E75] transition hover:border-[#CDB8F5] hover:text-[#4E2C66]"
                            >
                                Last {months} months
                            </button>
                        ))}
                    </div>

                    <p className="mt-3 text-xs text-[#806A8C]">
                        Selected range: {getMonthSpan(
                        draftRange.startMonth,
                        draftRange.endMonth
                    ) || 0} month(s)
                    </p>

                    {validationError && (
                        <p className="mt-2 rounded-lg border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs leading-5 text-[#B3261E]">
                            {validationError}
                        </p>
                    )}

                    <div className="mt-4 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setDraftRange(range);
                                setValidationError(null);
                            }}
                            className="h-9 rounded-lg border border-[#E6DDF0] bg-white px-3 text-xs font-semibold text-[#5F4E75] transition hover:bg-[#FCFAFF]"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleApply()}
                            disabled={applying || loading}
                            className="h-9 rounded-lg bg-[#2B174C] px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-wait disabled:opacity-70"
                        >
                            {applying || loading ? "Updating..." : "Apply period"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SeasonalPanelHeader({
                                 range,
                                 onApplyRange,
                                 loading,
                             }: {
    range: SeasonalDateRange;
    onApplyRange: (range: SeasonalDateRange) => Promise<void>;
    loading: boolean;
}) {
    return (
        <div className="flex flex-col gap-4 border-b border-[#E6DDF0] pb-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2ECFF] text-[#5C35CC]">
                    <TrendingUp size={20} />
                </div>
                <div>
                    <h2 className="text-[17px] font-bold text-[#1A1220]">
                        Branch Seasonal Demand Overview
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-[#7A6A84]">
                        Understand how customer demand changes throughout the year
                        based on the quantity of completed POS items sold. This view
                        shows item quantity, not peso revenue and not the number of
                        orders.
                    </p>
                </div>
            </div>

            <SeasonalPeriodPicker
                range={range}
                onApply={onApplyRange}
                loading={loading}
            />
        </div>
    );
}

function SeasonalForecastPanel({
                                   seasonalData,
                                   seasonalLoading,
                                   seasonalError,
                                   seasonalRange,
                                   onApplySeasonalRange,
                               }: {
    seasonalData: SeasonalApiResponse | null;
    seasonalLoading: boolean;
    seasonalError: string | null;
    seasonalRange: SeasonalDateRange;
    onApplySeasonalRange: (range: SeasonalDateRange) => Promise<void>;
}) {
    if (seasonalLoading && !seasonalData) {
        return <PanelLoading label="Seasonal Demand Patterns" />;
    }

    if (seasonalError && !seasonalData) {
        return (
            <PanelError
                title="Seasonal Demand Patterns could not load"
                message={seasonalError}
            />
        );
    }

    const seasonal = seasonalData?.seasonal;

    if (!seasonal) {
        return <ForecastEmptyState />;
    }

    const seasonalHeader = (
        <SeasonalPanelHeader
            range={seasonalRange}
            onApplyRange={onApplySeasonalRange}
            loading={seasonalLoading}
        />
    );

    if (!seasonal.isReady) {
        return (
            <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                {seasonalHeader}

                <div className="mt-5 rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-3">
                    <h3 className="text-sm font-bold text-[#6E4300]">
                        Seasonal Demand Patterns need more history
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[#8A5A06]">
                        {seasonal.message}
                    </p>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <InsightValue
                        label="POS sales months available"
                        value={`${formatNumber(
                            seasonal.historyMonthsAvailable
                        )} of ${formatNumber(seasonal.minimumHistoryMonths)} months`}
                    />
                    <InsightValue
                        label="Completed POS items sold"
                        value={`${formatNumber(seasonal.totalUnitsSold)} items sold`}
                    />
                    <InsightValue
                        label="Why it is not ready"
                        value="Not enough monthly history"
                        detail="At least 12 distinct months of completed POS sales are needed for branch-level seasonal patterns."
                    />
                </div>

                {seasonal.monthlyHistory.length > 0 && (
                    <div className="mt-5 overflow-x-auto rounded-xl border border-[#E6DDF0]">
                        <table className="w-full min-w-[620px]">
                            <thead className="border-b border-[#E6DDF0] bg-[#FFFCF7]">
                            <tr>
                                <ForecastTableHeader>Recorded Month</ForecastTableHeader>
                                <ForecastTableHeader>Items Sold in POS</ForecastTableHeader>
                                <ForecastTableHeader>Number of POS Orders</ForecastTableHeader>
                            </tr>
                            </thead>
                            <tbody>
                            {seasonal.monthlyHistory.map((month) => (
                                <tr
                                    key={month.monthKey}
                                    className="border-b border-[#EEE7F2] last:border-b-0"
                                >
                                    <ForecastTableCell strong>
                                        {month.label}
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        {formatNumber(month.totalUnits)} items
                                    </ForecastTableCell>
                                    <ForecastTableCell>
                                        {formatNumber(month.orderCount)}
                                    </ForecastTableCell>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <p className="mt-4 text-xs leading-5 text-[#806A8C]">
                    This branch-wide seasonal view is separate from the product-level
                    seasonal signals in the Product Demand tab.
                </p>
            </section>
        );
    }

    const rows: SeasonalDisplayRow[] = seasonal.seasonalMonths
        .filter((month) => month.observations > 0)
        .sort((first, second) => first.monthNumber - second.monthNumber)
        .map((month, index, allMonths) => {
            const average = numberValue(month.averageUnits);
            const previous = index > 0 ? numberValue(allMonths[index - 1].totalUnits) : null;

            return {
                ...month,
                sourceYears: getSeasonalSourceYears(
                    month.monthNumber,
                    seasonal.monthlyHistory
                ),
                changeFromAverage: seasonalPercentageDifference(
                    numberValue(month.totalUnits),
                    average
                ),
                changeFromPrevious:
                    previous === null
                        ? null
                        : seasonalPercentageDifference(
                            numberValue(month.totalUnits),
                            previous
                        ),
            };
        });

    const averageMonthlyItems =
        rows.length > 0
            ? rows.reduce((total, row) => total + numberValue(row.totalUnits), 0) /
            rows.length
            : 0;

    const peakRows = [...rows]
        .sort((first, second) => second.totalUnits - first.totalUnits)
        .slice(0, 2);
    const lowestRows = [...rows]
        .sort((first, second) => first.totalUnits - second.totalUnits)
        .slice(0, Math.min(4, rows.length));
    const seasonality = getSeasonalityStrength(rows);
    const highestRow = peakRows[0];
    const highestVsAverage = highestRow
        ? seasonalPercentageDifference(highestRow.totalUnits, averageMonthlyItems)
        : null;
    const oneYearOnly = rows.every((row) => row.observations === 1);
    const periodLabel = `${formatSeasonalMonthYear(
        seasonalData?.scope.historyStartDate
    )} – ${formatSeasonalMonthYear(seasonalData?.scope.historyEndDate)}`;
    const sourceYears = Array.from(
        new Set(rows.flatMap((row) => row.sourceYears.split(", ").filter((year) => year && year !== "—")))
    ).join(", ");
    const peakNames = peakRows.map((row) => row.month).join(" and ");
    const lowestNames = lowestRows.map((row) => row.month).join(", ");
    const recentTrendValue =
        seasonal.recentTrendPercent === null ||
        seasonal.recentTrendPercent === undefined
            ? trendLabel(seasonal.recentTrend)
            : `${formatSeasonalPercentage(
                seasonal.recentTrendPercent
            )} · ${trendLabel(seasonal.recentTrend)}`;

    return (
        <section className="rounded-[14px] border border-[#E6DDF0] bg-[#FCFBFE] p-4 shadow-sm sm:p-5">
            {seasonalHeader}

            {seasonalError && (
                <div className="mt-3 rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-3 py-2 text-xs leading-5 text-[#8A5A06]">
                    The selected period could not be refreshed. Showing the most recently loaded seasonal data. {seasonalError}
                </div>
            )}

            {seasonalLoading && (
                <p className="mt-3 text-xs font-medium text-[#6D3DF5]">
                    Updating the selected sales period...
                </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <InsightValue
                    label="Peak demand months"
                    value={peakNames || "No peak month yet"}
                    detail="Highest completed POS item quantities"
                    accent="purple"
                />
                <InsightValue
                    label="Lowest demand months"
                    value={lowestNames || "No low month yet"}
                    detail="Lowest completed POS item quantities"
                    accent="blue"
                />
                <InsightValue
                    label="Recent demand trend"
                    value={recentTrendValue}
                    detail="Latest 3 months compared with previous 3 months"
                    accent={
                        String(seasonal.recentTrend || "").toUpperCase() === "GROWING"
                            ? "green"
                            : "purple"
                    }
                />
                <InsightValue
                    label="Average monthly items sold"
                    value={`${formatNumber(Math.round(averageMonthlyItems))} items`}
                    detail="Average across this selected sales period"
                    accent="purple"
                />
                <InsightValue
                    label="Seasonality strength"
                    value={oneYearOnly ? `Preliminary · ${seasonality.label}` : seasonality.label}
                    detail={
                        oneYearOnly
                            ? "One 12-month sales period analysed"
                            : seasonality.detail
                    }
                    accent="purple"
                />
            </div>

            <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
                <section className="flex min-h-[420px] flex-col rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h3 className="text-[16px] font-bold text-[#1A1220]">
                                Monthly Demand Pattern
                            </h3>
                            <p className="mt-1 text-xs text-[#7A6A84]">
                                Completed POS item quantities across {periodLabel}.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-medium text-[#6A5976]">
                            <span className="inline-flex items-center gap-1.5">
                                <span className="h-0.5 w-5 rounded bg-[#6D3DF5]" />
                                Items sold per month
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <span className="h-0 w-5 border-t-2 border-dashed border-[#B9A7D8]" />
                                12-month average
                            </span>
                        </div>
                    </div>
                    <div className="mt-3 flex min-h-0 flex-1 items-end">
                        <SeasonalDemandChart rows={rows} average={averageMonthlyItems} />
                    </div>
                </section>

                <section className="flex min-h-[420px] flex-col rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                    <h3 className="text-[16px] font-bold text-[#1A1220]">
                        Seasonal Insights
                    </h3>
                    <div className="mt-3 space-y-2.5">
                        <div className="flex gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EDFBF1] text-[#138342]">
                                <TrendingUp size={15} />
                            </div>
                            <div>
                                <p className="text-[13px] font-semibold text-[#2B174C]">Peak Demand Months</p>
                                <p className="mt-0.5 text-[11px] leading-4 text-[#5F4E75]">
                                    {peakNames || "No peak month"} had the highest recorded demand. The highest month was {highestVsAverage === null ? "—" : `${formatSeasonalPercentage(highestVsAverage)} above`} the selected-period average.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F2ECFF] text-[#5C35CC]">
                                <TrendingUp size={15} />
                            </div>
                            <div>
                                <p className="text-[13px] font-semibold text-[#2B174C]">Recent Demand Change</p>
                                <p className="mt-0.5 text-[11px] leading-4 text-[#5F4E75]">
                                    {recentTrendValue}. This compares recent completed POS item sales with the three months before them.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F1F8FF] text-[#3376B1]">
                                <TriangleAlert size={15} />
                            </div>
                            <div>
                                <p className="text-[13px] font-semibold text-[#2B174C]">Lower Demand Months</p>
                                <p className="mt-0.5 text-[11px] leading-4 text-[#5F4E75]">
                                    {lowestNames || "No lower-demand month"} had the lowest completed POS item quantities in this sales period.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFF4D8] text-[#A56607]">
                                <CalendarDays size={15} />
                            </div>
                            <div>
                                <p className="text-[13px] font-semibold text-[#2B174C]">Planning Recommendation</p>
                                <p className="mt-0.5 text-[11px] leading-4 text-[#5F4E75]">
                                    Review product availability and booking capacity 2–3 weeks before peak months, especially for products with high-demand or low-stock signals.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-auto rounded-xl border border-[#E5DCF5] bg-[#F7F1FF] p-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#6D3DF5]">
                            Key takeaway
                        </p>
                        <p className="mt-1 text-xs leading-4 text-[#4D3862]">
                            This branch shows a {oneYearOnly ? "preliminary " : ""}{seasonality.label.toLowerCase()} seasonal demand pattern. {peakNames || "The highest-demand months"} recorded the most completed POS item sales during {periodLabel}.
                        </p>
                    </div>
                </section>
            </div>

            <div className="mt-4">
                <SeasonalBreakdownTable rows={rows} average={averageMonthlyItems} />
            </div>

            <div className="mt-4 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-3 text-xs leading-5 text-[#5F4E75]">
                <p className="font-semibold text-[#2B174C]">Data clarity</p>
                <p className="mt-1">
                    This view uses completed POS sales only. The sales record years represented in this pattern are {sourceYears || "not available"}. A month&apos;s demand level compares its item quantity with the average month in this selected period.
                </p>
                {oneYearOnly && (
                    <p className="mt-1 text-[#806A8C]">
                        Only one historical record is currently available for each calendar month, so this seasonal pattern is preliminary. It becomes more reliable as additional years of POS sales are collected.
                    </p>
                )}
            </div>
        </section>
    );
}

function BookingForecastPanel({
                                  bookingData,
                                  bookingLoading,
                                  bookingError,
                              }: {
    bookingData: BookingApiResponse | null;
    bookingLoading: boolean;
    bookingError: string | null;
}) {
    if (bookingLoading) {
        return <PanelLoading label="Upcoming Booking Demand" />;
    }

    if (bookingError) {
        return (
            <PanelError
                title="Upcoming Booking Demand could not load"
                message={bookingError}
            />
        );
    }

    const booking = bookingData?.booking;

    if (!booking) {
        return <ForecastEmptyState />;
    }

    return (
        <section className="space-y-4">
            <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F7F1FF] text-[#4E2C66]">
                        <CalendarDays size={20} />
                    </div>
                    <div>
                        <h2 className="text-[16px] font-bold text-[#1A1220]">
                            Upcoming Booking Demand
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-[#7A6A84]">
                            These are scheduled Confirmed and Preparing bookings, not
                            guessed demand. Linked package items are included in stock
                            planning when their product or variant IDs are saved.
                        </p>
                    </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                    <InsightValue
                        label="Scheduled bookings"
                        value={`${formatNumber(booking.expectedBookings)} booking${
                            booking.expectedBookings === 1 ? "" : "s"
                        }`}
                        detail={`Next ${booking.periodDays} days`}
                    />
                    <InsightValue
                        label="Confirmed"
                        value={`${formatNumber(booking.confirmedBookings)} booking${
                            booking.confirmedBookings === 1 ? "" : "s"
                        }`}
                    />
                    <InsightValue
                        label="Preparing"
                        value={`${formatNumber(booking.preparingBookings)} booking${
                            booking.preparingBookings === 1 ? "" : "s"
                        }`}
                    />
                    <InsightValue
                        label="Booking items linked to inventory"
                        value={`${formatNumber(
                            booking.allocationSummary.allocatedUnits
                        )} items reserved`}
                        detail="Counted in stock planning when linked to inventory"
                    />
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.75fr)]">
                <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                    <div className="border-b border-[#E6DDF0] px-4 py-3.5">
                        <h3 className="text-[16px] font-bold text-[#1A1220]">
                            Upcoming booking schedule
                        </h3>
                        <p className="mt-1 text-xs text-[#7A6A84]">
                            Known booking demand scheduled in the next{" "}
                            {booking.periodDays} days.
                        </p>
                    </div>

                    {booking.upcomingBookings.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px]">
                                <thead className="border-b border-[#E6DDF0] bg-[#FFFCF7]">
                                <tr>
                                    <ForecastTableHeader>Event Date</ForecastTableHeader>
                                    <ForecastTableHeader>Time</ForecastTableHeader>
                                    <ForecastTableHeader>Customer</ForecastTableHeader>
                                    <ForecastTableHeader>Package</ForecastTableHeader>
                                    <ForecastTableHeader>Status</ForecastTableHeader>
                                </tr>
                                </thead>
                                <tbody>
                                {booking.upcomingBookings.slice(0, 20).map((item) => (
                                    <tr
                                        key={item.id}
                                        className="border-b border-[#EEE7F2] last:border-b-0"
                                    >
                                        <ForecastTableCell strong>
                                            {item.eventDateLabel}
                                        </ForecastTableCell>
                                        <ForecastTableCell>
                                            {item.eventTime || "Not set"}
                                        </ForecastTableCell>
                                        <ForecastTableCell>
                                            {item.customerName}
                                        </ForecastTableCell>
                                        <ForecastTableCell>
                                            {item.packageName}
                                        </ForecastTableCell>
                                        <ForecastTableCell>
                                                <span className="rounded-full border border-[#D8CBE7] bg-[#F7F1FF] px-2.5 py-1 text-xs font-semibold text-[#4E2C66]">
                                                    {item.status}
                                                </span>
                                        </ForecastTableCell>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="p-7 text-center text-sm text-[#7A6A84]">
                            No Confirmed or Preparing bookings are scheduled in this
                            period.
                        </div>
                    )}
                </section>

                <div className="space-y-4">
                    <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                        <h3 className="text-[16px] font-bold text-[#1A1220]">
                            Most concentrated booking demand
                        </h3>
                        <div className="mt-4 grid gap-3">
                            <InsightValue
                                label="Busiest event date"
                                value={
                                    booking.peakBookingDate
                                        ? `${booking.peakBookingDate.label} · ${formatNumber(
                                            booking.peakBookingDate.bookings
                                        )}`
                                        : "No scheduled peak"
                                }
                            />
                            <InsightValue
                                label="Busiest event time"
                                value={
                                    booking.peakBookingTime
                                        ? `${booking.peakBookingTime.time} · ${formatNumber(
                                            booking.peakBookingTime.bookings
                                        )}`
                                        : "No time data"
                                }
                            />
                            <InsightValue
                                label="Busiest weekday"
                                value={
                                    booking.peakBookingDay
                                        ? `${booking.peakBookingDay.weekday} · ${formatNumber(
                                            booking.peakBookingDay.bookings
                                        )}`
                                        : "No weekday data"
                                }
                            />
                        </div>
                    </section>

                    <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                        <h3 className="text-[16px] font-bold text-[#1A1220]">
                            Most scheduled packages
                        </h3>

                        {booking.topPackages.length > 0 ? (
                            <div className="mt-3 divide-y divide-[#EEE7F2]">
                                {booking.topPackages.map((item) => (
                                    <div
                                        key={item.packageName}
                                        className="flex items-center justify-between gap-3 py-2.5"
                                    >
                                        <p className="min-w-0 truncate text-sm font-semibold text-[#1A1220]">
                                            {item.packageName}
                                        </p>
                                        <span className="shrink-0 text-sm font-bold text-[#4E2C66]">
                                            {formatNumber(item.bookings)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-3 text-sm text-[#7A6A84]">
                                No package demand is recorded for the selected period.
                            </p>
                        )}
                    </section>
                </div>
            </div>

            {(booking.allocationSummary.bookingsWithoutAllocation > 0 ||
                booking.allocationSummary.unlinkedAllocationEntries > 0) && (
                <div className="rounded-[14px] border border-[#F4D79A] bg-[#FFF8E8] px-4 py-3 text-sm leading-6 text-[#8A5A06]">
                    {formatNumber(
                        booking.allocationSummary.bookingsWithoutAllocation
                    )} booking(s) do not have saved package inclusions, and{" "}
                    {formatNumber(
                        booking.allocationSummary.unlinkedAllocationEntries
                    )} package inclusion(s) do not have a product ID. They are
                    included as scheduled booking demand but are not deducted from
                    inventory to prevent an incorrect stock allocation.
                </div>
            )}
        </section>
    );
}

export function ForecastDetails({
                                    data,
                                    seasonalData,
                                    seasonalLoading,
                                    seasonalError,
                                    seasonalRange,
                                    applySeasonalRange,
                                    bookingData,
                                    bookingLoading,
                                    bookingError,
                                    activeTab,
                                    onTabChange,
                                    title,
                                    subtitle,
                                    canViewInventory,
                                }: {
    data: ForecastApiResponse;
    seasonalData: SeasonalApiResponse | null;
    seasonalLoading: boolean;
    seasonalError: string | null;
    seasonalRange: SeasonalDateRange;
    applySeasonalRange: (range: SeasonalDateRange) => Promise<void>;
    bookingData: BookingApiResponse | null;
    bookingLoading: boolean;
    bookingError: string | null;
    activeTab: ForecastTab;
    onTabChange: (tab: ForecastTab) => void;
    title: string;
    subtitle: string;
    canViewInventory: boolean;
}) {
    return (
        <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#E6DDF0] pb-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="text-[16px] font-bold text-[#1A1220]">
                        {title}
                    </h2>
                    <p className="mt-1 text-xs text-[#7A6A84]">{subtitle}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <ForecastTabButton
                        active={activeTab === "inventory"}
                        onClick={() => onTabChange("inventory")}
                        label="Product Demand"
                    />
                    <ForecastTabButton
                        active={activeTab === "seasonal"}
                        onClick={() => onTabChange("seasonal")}
                        label="Seasonal Patterns"
                    />
                    <ForecastTabButton
                        active={activeTab === "booking"}
                        onClick={() => onTabChange("booking")}
                        label="Upcoming Booking Demand"
                    />
                </div>
            </div>

            <div className="mt-4">
                {activeTab === "inventory" && (
                    <InventoryForecastPanel
                        data={data}
                        canViewInventory={canViewInventory}
                    />
                )}

                {activeTab === "seasonal" && (
                    <SeasonalForecastPanel
                        seasonalData={seasonalData}
                        seasonalLoading={seasonalLoading}
                        seasonalError={seasonalError}
                        seasonalRange={seasonalRange}
                        onApplySeasonalRange={applySeasonalRange}
                    />
                )}

                {activeTab === "booking" && (
                    <BookingForecastPanel
                        bookingData={bookingData}
                        bookingLoading={bookingLoading}
                        bookingError={bookingError}
                    />
                )}
            </div>
        </section>
    );
}

export function BranchForecastWorkspace({
                                            data,
                                            loading,
                                            error,
                                            lastUpdated,
                                            seasonalData,
                                            seasonalLoading,
                                            seasonalError,
                                            seasonalRange,
                                            applySeasonalRange,
                                            bookingData,
                                            bookingLoading,
                                            bookingError,
                                            title,
                                            description,
                                            canViewInventory,
                                        }: LiveForecastProps & {
    title: string;
    description: string;
    canViewInventory: boolean;
}) {
    const [activeTab, setActiveTab] = useState<ForecastTab>("inventory");

    if (loading && !data) {
        return <ForecastLoadingState />;
    }

    if (error && !data) {
        return <ForecastErrorState message={error} />;
    }

    if (!data) {
        return <ForecastEmptyState />;
    }

    const branchName = data.items[0]?.branchName || "Assigned Branch";
    const expectedBookings =
        bookingData?.booking?.expectedBookings ??
        data.summary.expectedBookings;
    const highDemandItems =
        data.summary.highDemandItems ??
        data.items.filter((item) => item.demandLevel === "HIGH").length;

    return (
        <div className="space-y-4">
            {error && (
                <div className="rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-3 text-sm text-[#8A5A06]">
                    Showing the most recently loaded forecast. Refresh again to retry
                    the latest request.
                </div>
            )}

            <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                            <TrendingUp size={18} />
                        </div>

                        <div>
                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                {title}
                            </h2>
                            <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                                {description}
                            </p>
                        </div>
                    </div>

                    <p className="text-xs text-[#806A8C]">
                        Last updated:{" "}
                        <span className="font-semibold text-[#4E2C66]">
                            {lastUpdated
                                ? formatCurrentDateTime(lastUpdated)
                                : "Loading..."}
                        </span>
                    </p>
                </div>
            </section>

            <div className="grid gap-3 md:grid-cols-3">
                <SummaryCard
                    icon={<PackageSearch size={18} />}
                    title="30-Day Customer Demand"
                    value={`${formatNumber(data.summary.projectedDemand)} items expected`}
                    detail={`${branchName} · projected from completed POS sales`}
                    tone="purple"
                />
                <SummaryCard
                    icon={<TrendingUp size={18} />}
                    title="High-Demand Products"
                    value={`${formatNumber(highDemandItems)} item${
                        highDemandItems === 1 ? "" : "s"
                    }`}
                    detail="Ranked by projected demand within this branch"
                    tone="green"
                />
                <SummaryCard
                    icon={<CalendarDays size={18} />}
                    title="Upcoming Booking Demand"
                    value={`${formatNumber(expectedBookings)} booking${
                        expectedBookings === 1 ? "" : "s"
                    }`}
                    detail={`Confirmed or preparing · next ${data.scope.periodDays} days`}
                    tone="gold"
                />
            </div>

            <ForecastDetails
                data={data}
                seasonalData={seasonalData}
                seasonalLoading={seasonalLoading}
                seasonalError={seasonalError}
                seasonalRange={seasonalRange}
                applySeasonalRange={applySeasonalRange}
                bookingData={bookingData}
                bookingLoading={bookingLoading}
                bookingError={bookingError}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                title={`${branchName} Demand Forecast Details`}
                subtitle={`Uses ${data.scope.historyWeeks} weeks of completed POS sales. Seasonal and booking demand use live backend records.`}
                canViewInventory={canViewInventory}
            />
        </div>
    );
}

export function BranchForecastSelector({
                                           branches,
                                           selectedBranchId,
                                           onSelectBranch,
                                       }: {
    branches: BranchForecastSummary[];
    selectedBranchId: number | null;
    onSelectBranch: (branchId: number) => void;
}) {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);

    const selectedBranch = branches.find(
        (branch) => branch.id === selectedBranchId
    );

    const filteredBranches = useMemo(
        () =>
            branches.filter((branch) =>
                branch.name.toLowerCase().includes(query.trim().toLowerCase())
            ),
        [branches, query]
    );

    return (
        <div className="relative w-full lg:w-[320px]">
            <div className="relative">
                <input
                    value={isOpen ? query : selectedBranch?.name || ""}
                    onFocus={() => {
                        setIsOpen(true);
                        setQuery("");
                    }}
                    onBlur={() => {
                        window.setTimeout(() => setIsOpen(false), 150);
                    }}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setIsOpen(true);
                    }}
                    placeholder="Search or select branch"
                    aria-label="Search or select branch demand forecast"
                    className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-white px-4 pr-10 text-sm font-medium text-[#1A1220] outline-none transition placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                />

                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                        setIsOpen((value) => !value);
                        setQuery("");
                    }}
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#806A8C] hover:bg-[#F7F1FF]"
                    aria-label="Toggle branch list"
                >
                    <ChevronDown
                        size={16}
                        className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
                    />
                </button>
            </div>

            {isOpen && (
                <div className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-lg">
                    {filteredBranches.length > 0 ? (
                        filteredBranches.map((branch) => (
                            <button
                                key={branch.id}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    onSelectBranch(branch.id);
                                    setIsOpen(false);
                                    setQuery("");
                                }}
                                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
                                    branch.id === selectedBranchId
                                        ? "bg-[#F2EBFB] font-semibold text-[#2B174C]"
                                        : "text-[#5F4E75] hover:bg-[#F7F1FF]"
                                }`}
                            >
                                {branch.name}
                            </button>
                        ))
                    ) : (
                        <p className="px-3 py-2.5 text-sm text-[#806A8C]">
                            No matching branch.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
