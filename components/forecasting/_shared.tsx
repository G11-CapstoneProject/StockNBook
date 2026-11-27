"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    AccuracyPanel,
    Badge,
    C,
    Card,
    Empty,
    ErrorBox,
    EventsPanel,
    ItemName,
    Kpi,
    LineChart,
    LinkButton,
    Loading,
    Row,
    SERIES,
    ShowMore,
    StockPlanPanel,
    Table,
    Tabs,
    Trend,
    buttonStyle,
    grid,
    inputStyle,
    monthText,
    stack,
} from "./_planning";

export type ForecastTab = "inventory" | "seasonal" | "plan" | "booking" | "events" | "accuracy";

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

function isStockActionItem(item: ForecastItem) {
    const status = String(item.status || "").toUpperCase();

    return (
        status === "LOW" ||
        status === "RISK" ||
        numberValue(item.suggestedRestock) > 0 ||
        Boolean(item.reorderNow)
    );
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

// The last N complete months. The current month is left out because it is not over yet.
function getLastMonthsRange(monthCount = 36): SeasonalDateRange {
    const current = new Date();
    const end = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)
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
    const fallback = getLastMonthsRange(36);
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
            errorPayload.error || "The forecast could not be loaded.";
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
        getLastMonthsRange(36)
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
                    "You are signed out. Please sign in again.";

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
                        "Busy months could not be loaded."
                    );
                }
            } catch (requestError) {
                setSeasonalError(
                    requestError instanceof Error
                        ? requestError.message
                        : "Busy months could not be loaded."
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
                "You are signed out. Please sign in again.";

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

        /*
          Load the main inventory forecast first. The old implementation fired
          three Lambda requests at the same time. That made the heaviest request
          compete with the seasonal and booking requests for RDS connections
          during a cold start.
        */
        try {
            const inventory =
                await requestForecastApi<ForecastApiResponse>(
                    token,
                    "get_inventory_forecast"
                );

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
                    "The forecast could not be loaded."
                );
            }
        } catch (requestError) {
            setData(null);
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "The forecast could not be loaded."
            );
        } finally {
            setLoading(false);
        }

        // Secondary panels can load together after the heavy inventory query.
        const [seasonalResult, bookingResult] =
            await Promise.allSettled([
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

        if (seasonalResult.status === "fulfilled") {
            const seasonal = seasonalResult.value;

            if (seasonal.success && seasonal.seasonal) {
                setSeasonalData(seasonal);
            } else {
                setSeasonalData(null);
                setSeasonalError(
                    "Busy months could not be loaded."
                );
            }
        } else {
            setSeasonalData(null);
            setSeasonalError(
                seasonalResult.reason instanceof Error
                    ? seasonalResult.reason.message
                    : "Busy months could not be loaded."
            );
        }

        if (bookingResult.status === "fulfilled") {
            const booking = bookingResult.value;

            if (booking.success && booking.booking) {
                setBookingData(booking);
            } else {
                setBookingData(null);
                setBookingError(
                    "Bookings could not be loaded."
                );
            }
        } else {
            setBookingData(null);
            setBookingError(
                bookingResult.reason instanceof Error
                    ? bookingResult.reason.message
                    : "Bookings could not be loaded."
            );
        }

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
                name: branchItems[0]?.branchName || "Branch",
                demand,
                alerts,
                highDemandItems,
                growingItems,
                topItem:
                    topDemandItem &&
                    numberValue(topDemandItem.forecastedDemand) > 0
                        ? topDemandItem.itemName
                        : "No recent sales",
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

/* -------------------------------------------------------
 * LABELS
 * ------------------------------------------------------- */

type Tone = "red" | "amber" | "green" | "purple" | "gray" | "blue";

function stockStatus(item: ForecastItem): { label: string; tone: Tone } {
    const timeAlert = String(item.timeAlert || "").toUpperCase();
    const status = String(item.status || "STABLE").toUpperCase();
    if (timeAlert === "OUT_OF_STOCK") return { label: "Out of stock", tone: "red" };
    if (timeAlert === "MAY_RUN_OUT_WITHIN_3_DAYS") return { label: "Runs out in 3 days", tone: "red" };
    if (timeAlert === "MAY_RUN_OUT_WITHIN_7_DAYS") return { label: "Runs out this week", tone: "amber" };
    if (status === "LOW") return { label: "Low stock", tone: "red" };
    if (status === "RISK") return { label: "Running low", tone: "amber" };
    return { label: "OK", tone: "green" };
}

function demandLevel(level: string | undefined): { label: string; tone: Tone } {
    const normalized = String(level || "").toUpperCase();
    if (normalized === "HIGH") return { label: "High", tone: "purple" };
    if (normalized === "MODERATE") return { label: "Medium", tone: "blue" };
    if (normalized === "LOW") return { label: "Low", tone: "gray" };
    return { label: "None", tone: "gray" };
}

function DemandTrend({ item }: { item: ForecastItem }) {
    const trend = String(item.growthTrend || "").toUpperCase();
    if (trend === "NEW_DEMAND") return <Badge tone="green">New</Badge>;
    if (trend === "NO_ACTIVITY") return <span style={{ color: C.muted }}>–</span>;
    return <Trend value={item.growthPercent ?? null} />;
}

function runsOutText(item: ForecastItem) {
    const days = item.daysUntilStockout;
    if (days === null || days === undefined || !Number.isFinite(Number(days))) return "–";
    if (Number(days) <= 0) return "Now";
    const rounded = Math.max(1, Math.round(Number(days)));
    return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

// "13:30" -> "1:30 PM"
function timeText(value: string) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
    if (!match) return value || "";
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

function packageText(name: string | null | undefined) {
    return !name || /custom|unspecified/i.test(name) ? "Custom" : name;
}

function getMonthSpan(startMonth: string, endMonth: string) {
    if (!isMonthInputValue(startMonth) || !isMonthInputValue(endMonth)) return 0;
    const [startYear, startIndex] = startMonth.split("-").map(Number);
    const [endYear, endIndex] = endMonth.split("-").map(Number);
    return (endYear - startYear) * 12 + (endIndex - startIndex) + 1;
}

/* -------------------------------------------------------
 * PAGE STATES AND SMALL PIECES
 * ------------------------------------------------------- */

export function ForecastLoadingState() {
    return <ModuleSkeleton variant="forecasting" />;
}

export function ForecastErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return <ErrorBox message={`The forecast could not be loaded. ${message}`} onRetry={onRetry} />;
}

export function ForecastEmptyState() {
    return <Empty>No forecast yet. It appears once the branch has POS sales and stock records.</Empty>;
}

/** Kept for pages that import it: one number with a short label. */
export function SummaryCard({ title, value, detail }: {
    icon?: ReactNode; title: string; value: ReactNode; detail: string; tone?: "purple" | "gold" | "red" | "green";
}) {
    return <Kpi label={title} value={value} sub={detail} />;
}

/** Kept for pages that import it. */
export function ForecastTabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={active}
                style={{ ...buttonStyle(active), height: 38 }}>
            {label}
        </button>
    );
}

/** Branch name, last update and (for the Owner) the branch picker. */
function ScopeBar({ title, updated, right }: { title: string; updated: Date | null; right?: ReactNode }) {
    return (
        <section style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: "12px 16px" }}>
            <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</p>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: C.muted }}>
                    {updated ? `Updated ${updated.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Loading…"}
                </p>
            </div>
            {right}
        </section>
    );
}

export function ProductDemandSummaryCards({ data, canViewInventory = true }: {
    data: ForecastApiResponse;
    canViewInventory?: boolean;
    seasonalData?: SeasonalApiResponse | null;
    seasonalLoading?: boolean;
}) {
    const demandItems = getDemandItems(data.items);
    const high = demandItems.filter((item) => String(item.demandLevel || "").toUpperCase() === "HIGH").length;
    const actions = getStockActionItems(data.items).length;
    const days = data.scope.periodDays || 30;
    return (
        <div style={grid(150)}>
            <Kpi label={`Expected sales, next ${days} days`} value={`${formatNumber(Math.round(data.summary.projectedDemand))} units`} sub={`${formatNumber(demandItems.length)} products`} />
            <Kpi label="High demand" value={`${formatNumber(high)} product${high === 1 ? "" : "s"}`} sub="Selling faster than most" />
            {canViewInventory && <Kpi label="Need restocking" value={`${formatNumber(actions)} product${actions === 1 ? "" : "s"}`} sub={actions ? "See the list below" : "Stock looks fine"} tone={actions ? "warn" : undefined} />}
        </div>
    );
}

/* -------------------------------------------------------
 * PRODUCT DEMAND (NEXT 30 DAYS)
 * ------------------------------------------------------- */

function InventoryForecastPanel({ data, canViewInventory, branches, onPickBranch }: {
    data: ForecastApiResponse;
    canViewInventory: boolean;
    branches?: BranchForecastSummary[];
    onPickBranch?: (branchId: number) => void;
}) {
    const demandItems = getDemandItems(data.items);
    const actionItems = getStockActionItems(data.items);
    const days = data.scope.periodDays || 30;
    const [query, setQuery] = useState("");
    const [showAll, setShowAll] = useState(false);
    const [showAllActions, setShowAllActions] = useState(false);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? demandItems.filter((item) => `${item.itemName} ${item.category}`.toLowerCase().includes(q)) : demandItems;
    }, [demandItems, query]);
    const multiBranch = new Set(data.items.map((item) => item.branchId)).size > 1;
    const maxBranch = Math.max(1, ...(branches || []).map((b) => b.demand));

    return (
        <div style={stack()}>
            <ProductDemandSummaryCards data={data} canViewInventory={canViewInventory} />

            {branches && branches.length > 1 && (
                <Card title="By branch" sub={`Expected units in the next ${days} days. Click a branch to open it.`}>
                    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                        {branches.map((branch) => (
                            <li key={branch.id}>
                                <button type="button" onClick={() => onPickBranch?.(branch.id)} title={`Open ${branch.name}`}
                                        style={{ all: "unset", display: "block", width: "100%", cursor: "pointer", boxSizing: "border-box" }}>
                                    <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                        <span style={{ color: C.ink, fontWeight: 600 }}>{branch.name}
                                            <span style={{ fontWeight: 400, color: C.muted }}> · {formatNumber(branch.alerts)} to restock · top: {branch.topItem}</span>
                                        </span>
                                        <strong style={{ color: C.ink, flexShrink: 0 }}>{formatNumber(Math.round(branch.demand))} units</strong>
                                    </span>
                                    <span aria-hidden style={{ display: "block", height: 8, borderRadius: 4, background: C.track, marginTop: 5, overflow: "hidden" }}>
                                        <span style={{ display: "block", height: "100%", width: `${(branch.demand / maxBranch) * 100}%`, background: C.accent, borderRadius: 4 }} />
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ol>
                </Card>
            )}

            {canViewInventory && (
                <Card title="Restock soon" sub="Products that may run out after expected sales and booked items.">
                    {actionItems.length ? (
                        <>
                            <Table minWidth={760} textCols={[1]} head={["Product", "Status", "Available", "Runs out in", `Next ${days} days`, "Suggested order"]}>
                                {(showAllActions ? actionItems : actionItems.slice(0, 10)).map((item) => {
                                    const status = stockStatus(item);
                                    return (
                                        <Row key={item.id} textCols={[1]} cells={[
                                            <ItemName key="n" name={item.itemName} detail={`${item.category}${multiBranch ? ` · ${item.branchName}` : ""}`} />,
                                            <Badge key="s" tone={status.tone}>{status.label}</Badge>,
                                            <span key="a">{formatNumber(item.availableQuantity)}{numberValue(item.allocatedQuantity) > 0 && <span style={{ display: "block", fontSize: 12, color: C.muted }}>{formatNumber(item.allocatedQuantity)} booked</span>}</span>,
                                            runsOutText(item),
                                            formatNumber(Math.round(item.forecastedDemand)),
                                            numberValue(item.suggestedRestock) > 0 ? <strong key="o" style={{ color: C.down }}>+{formatNumber(Math.ceil(item.suggestedRestock))}</strong> : <span key="o" style={{ color: C.muted }}>–</span>,
                                        ]} />
                                    );
                                })}
                            </Table>
                            <ShowMore total={actionItems.length} shown={showAllActions ? actionItems.length : Math.min(10, actionItems.length)} onToggle={() => setShowAllActions((v) => !v)} label="products" />
                        </>
                    ) : <Empty>Nothing needs restocking right now.</Empty>}
                </Card>
            )}

            <Card title={`Expected demand, next ${days} days`} sub={`Based on the last ${formatNumber(data.scope.historyWeeks || 12)} weeks of POS sales. Trend compares the last 4 weeks with the 4 before.`}>
                <input aria-label="Search products" placeholder="Search products" value={query} onChange={(e) => { setQuery(e.target.value); setShowAll(false); }}
                       style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
                {filtered.length ? (
                    <>
                        <Table minWidth={560} textCols={[1]} head={["Product", "Demand", "Trend", "Units"]}>
                            {(showAll ? filtered : filtered.slice(0, 15)).map((item) => {
                                const level = demandLevel(item.demandLevel);
                                return (
                                    <Row key={item.id} textCols={[1]} cells={[
                                        <ItemName key="n" name={item.itemName} detail={`${item.category}${multiBranch ? ` · ${item.branchName}` : ""}`} />,
                                        <Badge key="d" tone={level.tone}>{level.label}</Badge>,
                                        <DemandTrend key="t" item={item} />,
                                        <strong key="u" style={{ color: C.ink }}>{formatNumber(Math.round(item.forecastedDemand))}</strong>,
                                    ]} />
                                );
                            })}
                        </Table>
                        {filtered.length > 15 && (
                            <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...buttonStyle(), marginTop: 10 }}>
                                {showAll ? "Show fewer" : `Show all ${formatNumber(filtered.length)} products`}
                            </button>
                        )}
                    </>
                ) : <Empty>{query ? "No matching products." : "No POS sales in the last few weeks."}</Empty>}
            </Card>
        </div>
    );
}

/* -------------------------------------------------------
 * BUSY AND SLOW MONTHS
 * ------------------------------------------------------- */

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function SeasonalForecastPanel({ seasonalData, seasonalLoading, seasonalError, seasonalRange, onApplySeasonalRange, onOpenStockPlan }: {
    seasonalData: SeasonalApiResponse | null;
    seasonalLoading: boolean;
    seasonalError: string | null;
    seasonalRange: SeasonalDateRange;
    onApplySeasonalRange: (range: SeasonalDateRange) => Promise<void>;
    onOpenStockPlan?: () => void;
}) {
    const span = getMonthSpan(seasonalRange.startMonth, seasonalRange.endMonth);
    const preset = [12, 24, 36].includes(span) ? String(span) : "custom";
    const picker = (
        <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: C.text }}>
            Sales from
            <select value={preset} disabled={seasonalLoading} style={inputStyle}
                    onChange={(e) => { if (e.target.value !== "custom") void onApplySeasonalRange(getLastMonthsRange(Number(e.target.value))); }}>
                <option value="12">Last 12 months</option>
                <option value="24">Last 2 years</option>
                <option value="36">Last 3 years</option>
                {preset === "custom" && <option value="custom">{monthText(seasonalRange.startMonth)} – {monthText(seasonalRange.endMonth)}</option>}
            </select>
        </label>
    );

    if (seasonalLoading && !seasonalData) return <Loading label="busy months" />;
    if (seasonalError && !seasonalData) return <ErrorBox message={seasonalError} onRetry={() => void onApplySeasonalRange(seasonalRange)} />;
    const seasonal = seasonalData?.seasonal;
    if (!seasonal) return <ForecastEmptyState />;

    if (!seasonal.isReady) {
        return (
            <Card title="Busy and slow months" action={picker}
                  sub={`Shows after 12 months of POS sales. This branch has ${formatNumber(seasonal.historyMonthsAvailable)} so far.`}>
                <Empty>Not enough sales history yet. Try a longer period, or check back later.</Empty>
            </Card>
        );
    }

    const rows = seasonal.seasonalMonths
        .filter((m) => m.observations > 0)
        .sort((a, b) => a.monthNumber - b.monthNumber)
        .map((m) => ({ ...m, average: m.observations > 0 ? numberValue(m.totalUnits) / m.observations : 0 }));
    const usual = rows.length ? rows.reduce((sum, r) => sum + r.average, 0) / rows.length : 0;
    const vsUsual = (value: number) => (usual > 0 ? ((value - usual) / usual) * 100 : null);
    const byAverage = [...rows].sort((a, b) => b.average - a.average);
    const busiest = byAverage.slice(0, 2);
    const slowest = byAverage.slice(-2).reverse();
    const values = MONTH_SHORT.map((_, i) => rows.find((r) => r.monthNumber === i + 1)?.average ?? null);
    const oneYearOnly = rows.every((r) => r.observations <= 1);
    const years = (monthNumber: number) => Array.from(new Set(seasonal.monthlyHistory
        .filter((h) => Number(String(h.monthKey).slice(5, 7)) === monthNumber).map((h) => String(h.monthKey).slice(0, 4)))).sort().join(", ");
    const period = `${monthText(seasonalData?.scope.historyStartDate || seasonalRange.startMonth)} – ${monthText(seasonalData?.scope.historyEndDate || seasonalRange.endMonth)}`;

    return (
        <div style={{ ...stack(), opacity: seasonalLoading ? 0.6 : 1 }}>
            <Card title="Busy and slow months" sub={`Average units sold in each calendar month, ${period}.`} action={picker}>
                {seasonalError && <div style={{ marginBottom: 10 }}><ErrorBox message={`Could not update the period. ${seasonalError}`} /></div>}
                <LineChart ariaLabel="Average units sold per calendar month" labels={MONTH_SHORT}
                           format={(v) => `${formatNumber(Math.round(v))} units`}
                           series={[
                               { name: "Average units", color: SERIES[0], values },
                               { name: "Usual month", color: "#B9A7D8", values: MONTH_SHORT.map(() => usual), dashed: true },
                           ]} />
                {oneYearOnly && (
                    <p style={{ margin: "10px 0 0", fontSize: 13, color: C.text }}>
                        This uses one year of sales, so one unusual month can change the pattern.{" "}
                        {span < 36 && <LinkButton onClick={() => void onApplySeasonalRange(getLastMonthsRange(36))}>Use 3 years</LinkButton>}
                    </p>
                )}
            </Card>

            <div style={grid(150)}>
                <Kpi label="Busiest months" value={busiest.map((r) => MONTH_SHORT[r.monthNumber - 1]).join(", ") || "–"}
                     sub={busiest[0] ? <><Trend value={vsUsual(busiest[0].average)} /> vs a usual month</> : undefined} />
                <Kpi label="Slowest months" value={slowest.map((r) => MONTH_SHORT[r.monthNumber - 1]).join(", ") || "–"}
                     sub={slowest[0] ? <><Trend value={vsUsual(slowest[0].average)} /> vs a usual month</> : undefined} />
                <Kpi label="Last 3 months" value={<Trend value={seasonal.recentTrendPercent ?? null} />} sub="vs the 3 months before" />
            </div>

            {onOpenStockPlan && (
                <p style={{ margin: 0, fontSize: 13, color: C.text }}>
                    Ready to plan? <LinkButton onClick={onOpenStockPlan}>See what to stock for the next 3 months</LinkButton>
                </p>
            )}

            <details style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: "12px 16px" }}>
                <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 700, color: C.ink }}>Month by month</summary>
                <div style={{ marginTop: 10 }}>
                    <Table minWidth={480} head={["Month", "Average units", "vs usual", "Years"]}>
                        {rows.map((r) => (
                            <Row key={r.monthNumber} cells={[
                                <strong key="m" style={{ color: C.ink }}>{r.month}</strong>,
                                formatNumber(Math.round(r.average)),
                                <Trend key="v" value={vsUsual(r.average)} />,
                                <span key="y" style={{ color: C.muted }}>{years(r.monthNumber) || "–"}</span>,
                            ]} />
                        ))}
                    </Table>
                </div>
            </details>
        </div>
    );
}

/* -------------------------------------------------------
 * UPCOMING BOOKINGS
 * ------------------------------------------------------- */

function BookingDemandPanel({ bookingData, bookingLoading, bookingError, onOpenStockPlan }: {
    bookingData?: BookingApiResponse | null;
    bookingLoading?: boolean;
    bookingError?: string | null;
    onOpenStockPlan?: () => void;
}) {
    const [showAll, setShowAll] = useState(false);
    if (bookingLoading && !bookingData) return <Loading label="bookings" />;
    if (bookingError && !bookingData) return <ErrorBox message={bookingError} />;
    const booking = bookingData?.booking;
    if (!booking) return <Empty>No booking information for this branch.</Empty>;
    const upcoming = [...booking.upcomingBookings].sort((a, b) => `${a.eventDate} ${a.eventTime}`.localeCompare(`${b.eventDate} ${b.eventTime}`));
    const multiBranch = new Set(upcoming.map((b) => b.branchId)).size > 1;
    const unassigned = booking.allocationSummary?.bookingsWithoutAllocation || 0;
    const maxPackage = Math.max(1, ...booking.topPackages.map((p) => p.bookings));
    return (
        <div style={stack()}>
            <div style={grid(150)}>
                <Kpi label={`Bookings, next ${booking.periodDays} days`} value={formatNumber(booking.expectedBookings)} />
                <Kpi label="Confirmed" value={formatNumber(booking.confirmedBookings)} />
                <Kpi label="Being prepared" value={formatNumber(booking.preparingBookings)} />
                <Kpi label="Busiest date" value={booking.peakBookingDate ? booking.peakBookingDate.label : "–"}
                     sub={booking.peakBookingDate ? `${formatNumber(booking.peakBookingDate.bookings)} booking${booking.peakBookingDate.bookings === 1 ? "" : "s"}` : undefined} />
            </div>

            {unassigned > 0 && (
                <div role="status" style={{ border: "1px solid #F4D79A", background: "#FFF8E8", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#8A5A06" }}>
                    {formatNumber(unassigned)} upcoming booking{unassigned === 1 ? " has" : "s have"} no items assigned yet. Check them in Bookings.
                </div>
            )}

            <Card title="Next bookings">
                {upcoming.length ? (
                    <>
                        <Table minWidth={560} textCols={[1, 2, 3]} head={["Date", "Customer", "Package", "Status"]}>
                            {(showAll ? upcoming : upcoming.slice(0, 8)).map((b) => (
                                <Row key={b.id} textCols={[1, 2, 3]} cells={[
                                    <ItemName key="d" name={b.eventDateLabel || b.eventDate} detail={[timeText(b.eventTime), multiBranch ? b.branchName : ""].filter(Boolean).join(" · ") || undefined} />,
                                    b.customerName || "–",
                                    packageText(b.packageName),
                                    <Badge key="s" tone={String(b.status).toLowerCase() === "preparing" ? "amber" : "green"}>{String(b.status || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Badge>,
                                ]} />
                            ))}
                        </Table>
                        {upcoming.length > 8 && (
                            <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...buttonStyle(), marginTop: 10 }}>
                                {showAll ? "Show fewer" : `Show all ${formatNumber(upcoming.length)} bookings`}
                            </button>
                        )}
                    </>
                ) : <Empty>No bookings in the next {booking.periodDays} days.</Empty>}
            </Card>

            <Card title="Packages booked">
                {booking.topPackages.length ? (
                    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                        {booking.topPackages.slice(0, 8).map((p) => (
                            <li key={p.packageName}>
                                <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                                    <span style={{ color: C.text }}>{packageText(p.packageName)}</span>
                                    <strong style={{ color: C.ink }}>{formatNumber(p.bookings)}</strong>
                                </span>
                                <span aria-hidden style={{ display: "block", height: 8, borderRadius: 4, background: C.track, marginTop: 5, overflow: "hidden" }}>
                                    <span style={{ display: "block", height: "100%", width: `${(p.bookings / maxPackage) * 100}%`, background: SERIES[3], borderRadius: 4 }} />
                                </span>
                            </li>
                        ))}
                    </ol>
                ) : <Empty>No package bookings coming up.</Empty>}
            </Card>

            {onOpenStockPlan && (
                <p style={{ margin: 0, fontSize: 13, color: C.text }}>
                    Need to know if there are enough rental items? <LinkButton onClick={onOpenStockPlan}>Check the stock plan</LinkButton>
                </p>
            )}
        </div>
    );
}

/* -------------------------------------------------------
 * TABS
 * ------------------------------------------------------- */

const TAB_LABELS: Record<ForecastTab, string> = {
    plan: "Stock plan",
    inventory: "Product demand",
    seasonal: "Busy months",
    events: "Events",
    booking: "Bookings",
    accuracy: "Accuracy",
};

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
                                    canViewInventory,
                                    scopeBranchId = null,
                                    branches,
                                    onPickBranch,
                                    showAccuracy = true,
                                }: {
    data: ForecastApiResponse;
    seasonalData: SeasonalApiResponse | null;
    seasonalLoading: boolean;
    seasonalError: string | null;
    seasonalRange: SeasonalDateRange;
    applySeasonalRange: (range: SeasonalDateRange) => Promise<void>;
    bookingData?: BookingApiResponse | null;
    bookingLoading?: boolean;
    bookingError?: string | null;
    activeTab: ForecastTab;
    onTabChange: (tab: ForecastTab) => void;
    /** Not shown any more; kept so existing pages still compile. */
    title?: string;
    subtitle?: string;
    showProductSummaryCards?: boolean;
    canViewInventory: boolean;
    /** The Owner's selected branch (null = all branches). Managers and Staff always see their own branch. */
    scopeBranchId?: number | null;
    /** Owner, all branches: branch comparison on the Product demand tab. */
    branches?: BranchForecastSummary[];
    onPickBranch?: (branchId: number) => void;
    showAccuracy?: boolean;
}) {
    const order: ForecastTab[] = ["plan", "inventory", "seasonal", "events", "booking", ...(showAccuracy ? ["accuracy" as const] : [])];
    const tab = order.includes(activeTab) ? activeTab : order[0];
    const openPlan = () => onTabChange("plan");
    return (
        <div>
            <Tabs label="Forecast sections" idPrefix="forecast" value={tab} onChange={onTabChange} tabs={order.map((id) => ({ id, label: TAB_LABELS[id] }))} />
            <div id="forecast-panel" role="tabpanel" aria-labelledby={`forecast-tab-${tab}`} style={{ paddingTop: 16 }}>
                {tab === "plan" && <StockPlanPanel branchId={scopeBranchId} />}
                {tab === "inventory" && <InventoryForecastPanel data={data} canViewInventory={canViewInventory} branches={branches} onPickBranch={onPickBranch} />}
                {tab === "seasonal" && (
                    <SeasonalForecastPanel seasonalData={seasonalData} seasonalLoading={seasonalLoading} seasonalError={seasonalError}
                                           seasonalRange={seasonalRange} onApplySeasonalRange={applySeasonalRange} onOpenStockPlan={openPlan} />
                )}
                {tab === "events" && <EventsPanel branchId={scopeBranchId} canViewInventory={canViewInventory} onOpenStockPlan={openPlan} />}
                {tab === "booking" && <BookingDemandPanel bookingData={bookingData} bookingLoading={bookingLoading} bookingError={bookingError} onOpenStockPlan={openPlan} />}
                {tab === "accuracy" && <AccuracyPanel branchId={scopeBranchId} />}
            </div>
        </div>
    );
}

/* -------------------------------------------------------
 * MANAGER AND STAFF PAGE
 * ------------------------------------------------------- */

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
                                            refresh,
                                            canViewInventory,
                                        }: LiveForecastProps & {
    /** Not shown any more; kept so existing pages still compile. */
    title?: string;
    description?: string;
    canViewInventory: boolean;
}) {
    // Managers start on the stock plan; Staff (no stock figures) start on product demand.
    const [activeTab, setActiveTab] = useState<ForecastTab>(canViewInventory ? "plan" : "inventory");

    if (loading && !data) return <ForecastLoadingState />;
    if (error && !data) return <ForecastErrorState message={error} onRetry={() => void refresh()} />;
    if (!data) return <ForecastEmptyState />;

    const branchName = data.items[0]?.branchName || "Your branch";

    return (
        <div style={stack()}>
            {error && <ErrorBox message="Showing the last forecast that loaded. The latest update failed." onRetry={() => void refresh()} />}
            <ScopeBar title={branchName} updated={lastUpdated} />
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
                canViewInventory={canViewInventory}
                showAccuracy={canViewInventory}
            />
        </div>
    );
}

/** Owner branch picker: "All branches" or one branch. */
export function OwnerBranchPicker({ branches, selectedBranchId, onSelectBranch }: {
    branches: Array<{ id: number; name: string }>;
    selectedBranchId: number | null;
    onSelectBranch: (branchId: number | null) => void;
}) {
    return (
        <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: C.text }}>
            Branch
            <select value={selectedBranchId ?? ""} style={{ ...inputStyle, minWidth: 200 }}
                    onChange={(e) => onSelectBranch(e.target.value ? Number(e.target.value) : null)}>
                <option value="">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
        </label>
    );
}

/** Kept for pages that import it. */
export function BranchForecastSelector({ branches, selectedBranchId, onSelectBranch }: {
    branches: BranchForecastSummary[];
    selectedBranchId: number | null;
    onSelectBranch: (branchId: number) => void;
}) {
    return <OwnerBranchPicker branches={branches} selectedBranchId={selectedBranchId} onSelectBranch={(id) => { if (id !== null) onSelectBranch(id); }} />;
}

export { ScopeBar };
