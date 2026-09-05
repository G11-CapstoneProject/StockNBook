"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    BarChart3,
    Building2,
    CalendarDays,
    ChevronDown,
    Clock3,
    Info,
    Lightbulb,
    Maximize2,
    Minus,
    TrendingDown,
    TrendingUp,
    UsersRound,
    X,
} from "lucide-react";

export type AnalyticsRole = "owner" | "manager" | "staff";

type AnalyticsPeriodMode = "30" | "60" | "90" | "12m" | "custom";

type ExpandedAnalyticsPanel =
    | "sales-growth"
    | "sales-trend"
    | "peak-bookings"
    | "product-revenue"
    | "package-revenue"
    | "insights";

export type AnalyticsBranch = {
    id: number;
    name: string;
};

type ChartPoint = {
    label: string;
    value: number;
    key?: string;
    hasComparison?: boolean;
};

type RevenueItem = {
    name: string;
    value: number;
};

type AnalyticsData = {
    success: boolean;
    generatedAt: string;
    hasData: boolean;
    scope: {
        storeId: number;
        branchId: number | null;
        branchName: string;
        role: AnalyticsRole;
        isOverall: boolean;
    };
    period: {
        kind: "preset" | "custom";
        days: number;
        startDate: string;
        endDate: string;
        previousStartDate: string;
        previousEndDate: string;
        label: string;
    };
    salesGrowth: {
        value: number;
        currentSales: number;
        previousSales: number;
        comparisonLabel: string;
        monthlyGrowthLabel?: string;
        monthlyGrowthDescription?: string;
        monthlyGrowth: ChartPoint[];
    };
    salesTrend: {
        latestMonthlySales: number;
        previousMonthSales: number;
        monthlySales: ChartPoint[];
        dailySalesByMonth: Record<string, ChartPoint[]>;
        salesOrderCount: number;
    };
    peakBookings: {
        totalBookings: number;
        confirmed: number;
        preparing: number;
        completed: number;
        peakDay: string;
        peakTime: string;
        weekendPercentage: number;
        peakMonth: string;
        weekdayPeak: string;
        weekdayPeakTime: string;
        monthlyBookings: ChartPoint[];
        dailyBookings: ChartPoint[];
        topPackages: RevenueItem[];
    };
    productRevenue: RevenueItem[];
    packageRevenue: RevenueItem[];
    insights: string[];
    dataNotes: {
        sales: string;
        bookings: string;
        products: string;
        packages: string;
    };
};

const REVENUE_COLORS = [
    "#7C3AED",
    "#F5A623",
    "#3B9EEA",
    "#8CCB45",
    "#EC5AA7",
    "#5A8DEE",
    "#A569BD",
    "#4CB391",
];

function getToken() {
    if (typeof window === "undefined") {
        return "";
    }

    return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
}


function peso(value: number) {
    return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 0,
    }).format(Number(value || 0));
}

function pesoShort(value: number) {
    const safe = Number(value || 0);

    if (Math.abs(safe) >= 1_000_000) {
        return `₱${(safe / 1_000_000).toFixed(1)}M`;
    }

    if (Math.abs(safe) >= 1_000) {
        return `₱${Math.round(safe / 1_000)}K`;
    }

    return peso(safe);
}

function formatNumber(value: number) {
    return new Intl.NumberFormat("en-PH").format(Number(value || 0));
}

function formatAnalyticsDateRange(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return "Selected reporting period";
    }

    const sameYear = start.getFullYear() === end.getFullYear();
    const startLabel = start.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    });
    const endLabel = end.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });

    return `${startLabel} – ${endLabel}`;
}

function monthlyGroupingDescription(
    period: AnalyticsData["period"],
    calendarMonthCount: number
) {
    const dateRange = formatAnalyticsDateRange(period.startDate, period.endDate);
    const monthWord = calendarMonthCount === 1 ? "month" : "months";
    const coverage =
        period.kind === "preset"
            ? `Rolling ${period.days}-day period: ${dateRange}.`
            : `Selected date range: ${dateRange}.`;

    return `${coverage} Sales are grouped by calendar month, so ${calendarMonthCount} calendar ${monthWord} are shown. A ₱0 point means no completed POS sale was recorded in that month.`;
}

function isoDate(value: Date) {
    return value.toISOString().slice(0, 10);
}

function defaultRange(days = 30) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));

    return {
        start: isoDate(start),
        end: isoDate(end),
    };
}

/*
  Analytics accepts a custom range up to 366 days. Starting on the first day
  of the month eleven months ago gives a clear calendar-month view, such as
  Jul 1, 2025 – Jun 30, 2026, while staying inside that limit.
*/
function lastTwelveMonthsRange() {
    /*
      Use complete calendar months. This prevents a partial current month from
      appearing as an artificial low point in the monthly trend chart.
      Example on July 1, 2026: July 1, 2025 to June 30, 2026.
    */
    const today = new Date();
    const end = new Date(
        Date.UTC(today.getFullYear(), today.getMonth(), 0)
    );
    const start = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1)
    );

    return {
        start: isoDate(start),
        end: isoDate(end),
    };
}

function total(items: RevenueItem[]) {
    return items.reduce((sum, item) => sum + Number(item.value || 0), 0);
}

function trendDetails(value: number) {
}

function Card({
                  title,
                  children,
                  action,
                  onExpand,
                  className = "",
              }: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
    onExpand?: () => void;
    className?: string;
}) {
    return (
        <section className={`rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm ${className}`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <h2 className="flex items-center gap-1.5 text-[16px] font-bold text-[#1A1220]">
                    {title}
                    <Info size={14} className="text-[#A58DBF]" />
                </h2>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    {action}

                    {onExpand && (
                        <button
                            type="button"
                            onClick={onExpand}
                            title={`Expand ${title}`}
                            aria-label={`Expand ${title}`}
                            className="inline-flex h-[32px] items-center gap-1.5 rounded-lg border border-[#DED0EB] bg-[#FFFEFC] px-2.5 text-[11px] font-semibold text-[#4D2A74] shadow-sm transition hover:border-[#BFA4DD] hover:bg-[#F5EEFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B3FE4] focus-visible:ring-offset-2"
                        >
                            <Maximize2 size={14} />
                            <span className="hidden sm:inline">Expand</span>
                        </button>
                    )}
                </div>
            </div>
            {children}
        </section>
    );
}

function AnalyticsExpandDialog({
                                   open,
                                   title,
                                   subtitle,
                                   onClose,
                                   children,
                               }: {
    open: boolean;
    title: string;
    subtitle: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        const originalOverflow = document.body.style.overflow;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKeyDown);

        const frameId = window.requestAnimationFrame(() => {
            contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
        });

        return () => {
            window.cancelAnimationFrame(frameId);
            document.body.style.overflow = originalOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [onClose, open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[120] bg-[#FDFAF4]"
            role="dialog"
            aria-modal="true"
            aria-label={`${title} expanded view`}
        >
            <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#FDFAF4]">
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-[#E8DDF2] bg-white px-5 py-4 sm:px-6">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1E9FE] text-[#6B2AC6]">
                            <Maximize2 size={19} />
                        </span>

                        <div className="min-w-0">
                            <h2 className="truncate text-xl font-bold text-[#1A1220] sm:text-2xl">
                                {title}
                            </h2>
                            <p className="mt-1 text-xs leading-5 text-[#7A6A84] sm:text-sm">
                                {subtitle}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm font-semibold text-[#4D2A74] shadow-sm transition hover:bg-[#F5EEFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B3FE4] focus-visible:ring-offset-2"
                        aria-label="Close expanded analytics view"
                    >
                        <X size={17} />
                        Close
                    </button>
                </div>

                <div
                    ref={contentRef}
                    className="min-h-0 flex-1 overflow-y-auto px-5 py-7 sm:px-8 sm:py-8 xl:px-10 xl:py-10"
                >
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}

function EmptyPanel({
                        title,
                        message,
                    }: {
    title: string;
    message: string;
}) {
    return (
        <div className="rounded-xl border border-dashed border-[#D8CBE7] bg-[#FFFEFC] px-4 py-7 text-center">
            <p className="text-sm font-semibold text-[#3D255C]">{title}</p>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-[#7A6A84]">{message}</p>
        </div>
    );
}

function GrowthBarChart({
                            data,
                            expanded = false,
                        }: {
    data: ChartPoint[];
    expanded?: boolean;
}) {
    if (data.length === 0) {
        return (
            <EmptyPanel
                title="No month-to-month comparison is available."
                message="Record completed POS orders in more than one calendar month to view monthly sales change."
            />
        );
    }

    const comparablePoints = data.filter(
        (item) => item.hasComparison !== false
    );
    const maxAbsolute = Math.max(
        ...comparablePoints.map((item) => Math.abs(Number(item.value || 0))),
        1
    );
    const isDenseRegularView = !expanded && data.length >= 7;

    const shortMonthLabel = (label: string) => {
        const parts = String(label || "").trim().split(/\s+/);
        const month = parts[0] || "";

        /*
          A 12-month chart fits inside the standard dashboard card. Use only
          the month abbreviation there; the title and tooltip retain the full
          month/year, while expanded view keeps the year visible on every tick.
        */
        if (isDenseRegularView) {
            return month;
        }

        return parts.length > 1
            ? `${month} '${parts[1].slice(-2)}`
            : String(label || "");
    };

    return (
        <div
            className={`relative mt-2 border-b border-[#EDE7F4] ${
                expanded ? "h-[340px]" : "h-[185px]"
            }`}
        >
            <div className="absolute inset-x-0 top-[16%] border-t border-dashed border-[#ECE4F1]" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#D8CBE6]" />
            <div className="absolute inset-x-0 bottom-[16%] border-t border-dashed border-[#ECE4F1]" />

            <div className="absolute inset-0 flex">
                <div className="flex w-10 flex-col justify-between py-[7px] text-[10px] text-[#8A769C]">
                    <span>+{maxAbsolute}%</span>
                    <span>0%</span>
                    <span>-{maxAbsolute}%</span>
                </div>

                <div className="relative ml-1 flex flex-1 items-stretch justify-around">
                    {data.map((item) => {
                        const hasComparison = item.hasComparison !== false;
                        const change = Number(item.value || 0);
                        const height = hasComparison
                            ? Math.max(
                                (Math.abs(change) / maxAbsolute) * 43,
                                4
                            )
                            : 0;
                        const positive = change >= 0;

                        return (
                            <div
                                key={`${item.key || item.label}-${item.value}`}
                                className="relative h-full min-w-0 flex-1"
                                title={`${item.label}: ${hasComparison ? `${change > 0 ? "+" : ""}${change}%` : "No prior month in the selected period"}`}
                            >
                                <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-[#D8CBE6]" />

                                {hasComparison && (
                                    <div
                                        className={`absolute left-1/2 -translate-x-1/2 ${
                                            isDenseRegularView ? "w-3" : "w-4"
                                        } ${
                                            positive
                                                ? "rounded-t-sm bg-[#7B3FE4]"
                                                : "rounded-b-sm bg-[#A66BCF]"
                                        }`}
                                        style={
                                            positive
                                                ? {
                                                    bottom: "50%",
                                                    height: `${height}%`,
                                                }
                                                : {
                                                    top: "50%",
                                                    height: `${height}%`,
                                                }
                                        }
                                    />
                                )}

                                <span
                                    className="absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#553273]"
                                    style={
                                        hasComparison
                                            ? positive
                                                ? {
                                                    bottom: `calc(50% + ${height}% + 5px)`,
                                                }
                                                : {
                                                    top: `calc(50% + ${height}% + 5px)`,
                                                }
                                            : { bottom: "calc(50% + 7px)" }
                                    }
                                >
                                    {hasComparison
                                        ? `${change > 0 ? "+" : ""}${change}%`
                                        : "—"}
                                </span>

                                <span
                                    className={`absolute bottom-[-23px] left-1/2 w-full -translate-x-1/2 overflow-hidden text-center font-medium text-[#806D91] ${
                                        isDenseRegularView
                                            ? "text-[9px]"
                                            : "whitespace-nowrap text-[10px]"
                                    }`}
                                >
                                    {shortMonthLabel(item.label)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function SalesLineChart({
                            data,
                            ariaLabel,
                            granularity,
                            expanded = false,
                        }: {
    data: ChartPoint[];
    ariaLabel: string;
    granularity: "month" | "day";
    expanded?: boolean;
}) {
    if (data.length === 0) {
        return (
            <EmptyPanel
                title="No POS sales were recorded."
                message="The sales trend will appear after completed POS orders are recorded in the selected reporting period."
            />
        );
    }

    const values = data.map((item) => Number(item.value || 0));
    const highest = Math.max(...values, 1);
    const lowest = Math.min(...values, 0);
    const padding = Math.max((highest - lowest) * 0.12, 100);
    const graphMin = Math.max(0, lowest - padding);
    const graphMax = highest + padding;
    const graphRange = graphMax - graphMin || 1;

    /*
      Daily data intentionally receives more horizontal space. This prevents
      30 individual calendar days from being compressed into the same width as
      a 12-month overview and makes the selected month easier to read.
    */
    const chartWidth =
        granularity === "day"
            ? Math.max(760, data.length * 34 + 96)
            : 720;

    const leftPadding = 62;
    const rightPadding = chartWidth - 28;
    const baselineY = 141;

    const plot = data.map((item, index) => {
        const x =
            leftPadding +
            (index * (rightPadding - leftPadding)) /
            Math.max(data.length - 1, 1);

        const y =
            135 -
            ((Number(item.value || 0) - graphMin) / graphRange) * 102;

        return { ...item, x, y };
    });

    const linePoints = plot.map((point) => `${point.x},${point.y}`).join(" ");
    const fillPoints = `${leftPadding},${baselineY} ${linePoints} ${rightPadding},${baselineY}`;

    const highestPoint = plot.reduce(
        (current, point) =>
            Number(point.value) > Number(current.value) ? point : current,
        plot[0]
    );
    const lowestPoint = plot.reduce(
        (current, point) =>
            Number(point.value) < Number(current.value) ? point : current,
        plot[0]
    );

    const showEvery =
        granularity === "day"
            ? Math.max(1, Math.ceil(data.length / 8))
            : 1;

    function xAxisLabel(label: string) {
        if (granularity === "day") {
            return label;
        }

        const parts = String(label).split(" ");
        return parts.length > 1
            ? `${parts[0]} '${parts[1].slice(-2)}`
            : label;
    }

    return (
        <div className="overflow-x-auto pb-1">
            <svg
                viewBox={`0 0 ${chartWidth} 184`}
                className={`min-w-[680px] w-full font-sans ${
                    expanded ? "h-[360px] sm:min-w-[920px]" : "h-[202px]"
                }`}
                role="img"
                aria-label={ariaLabel}
            >
                {[34, 68, 102, 136].map((y) => (
                    <line
                        key={y}
                        x1={leftPadding}
                        x2={rightPadding}
                        y1={y}
                        y2={y}
                        stroke="#EFEAF3"
                        strokeWidth="1"
                    />
                ))}

                {[
                    graphMax,
                    graphMin + (graphRange * 2) / 3,
                    graphMin + graphRange / 3,
                    graphMin,
                ].map((value, index) => (
                    <text
                        key={index}
                        x="0"
                        y={[38, 72, 106, 140][index]}
                        fontSize="10"
                        fill="#8A769C"
                    >
                        {pesoShort(value)}
                    </text>
                ))}

                <polygon points={fillPoints} fill="#F1E8FF" opacity="0.78" />
                <polyline
                    points={linePoints}
                    fill="none"
                    stroke="#7B3FE4"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {plot.map((point, index) => {
                    const showXAxisLabel =
                        index === 0 ||
                        index === plot.length - 1 ||
                        index % showEvery === 0;

                    const showValueLabel =
                        granularity === "month" ||
                        point === highestPoint ||
                        point === lowestPoint;

                    return (
                        <g key={`${point.label}-${index}`}>
                            <title>
                                {`${point.label}: ${peso(point.value)}`}
                            </title>
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r={granularity === "day" ? "3" : "4.3"}
                                fill="#7B3FE4"
                                stroke="#ffffff"
                                strokeWidth="1.5"
                            />

                            {showValueLabel && (
                                <text
                                    x={point.x}
                                    y={Math.max(point.y - 11, 16)}
                                    textAnchor="middle"
                                    fontSize="10"
                                    fontWeight="600"
                                    fill="#5B3B76"
                                >
                                    {pesoShort(point.value)}
                                </text>
                            )}

                            {showXAxisLabel && (
                                <text
                                    x={point.x}
                                    y="168"
                                    textAnchor="middle"
                                    fontSize="10"
                                    fill="#806D91"
                                >
                                    {xAxisLabel(point.label)}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

function BookingBars({
                         data,
                         granularity = "weekday",
                         expanded = false,
                     }: {
    data: ChartPoint[];
    granularity?: "month" | "weekday";
    expanded?: boolean;
}) {
    const highest = Math.max(...data.map((item) => Number(item.value || 0)), 0);

    if (highest <= 0) {
        return (
            <EmptyPanel
                title="No accepted bookings were scheduled."
                message="Confirmed, Preparing, and Completed bookings in the selected reporting period are used for this chart."
            />
        );
    }

    const isDenseMonthView = granularity === "month" && data.length >= 7;
    const labelForPoint = (label: string) => {
        if (granularity === "weekday") {
            return label;
        }

        const parts = String(label || "").trim().split(/\s+/);
        const month = parts[0] || label;

        return isDenseMonthView && !expanded
            ? month
            : parts.length > 1
                ? `${month} '${parts[1].slice(-2)}`
                : month;
    };

    return (
        <div className={`mt-3 ${expanded ? "h-[280px]" : "h-[160px]"}`}>
            <div
                className={`flex h-full items-end border-b border-[#EDE7F4] ${
                    isDenseMonthView
                        ? "gap-1 px-1 sm:gap-2 sm:px-2"
                        : "gap-4 px-4"
                }`}
            >
                {data.map((item) => {
                    const height = Math.max((Number(item.value || 0) / highest) * 100, 5);

                    return (
                        <div
                            key={item.key || item.label}
                            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                            title={`${item.label}: ${formatNumber(item.value)} accepted booking${item.value === 1 ? "" : "s"}`}
                        >
                            <span className="mb-1 text-[10px] font-semibold text-[#8C6A33]">
                                {item.value}
                            </span>
                            <div
                                className={`w-full rounded-t-md bg-[#F4A52B] ${
                                    isDenseMonthView ? "max-w-7" : "max-w-9"
                                }`}
                                style={{ height: `${height}%` }}
                            />
                            <span
                                className={`mt-2 w-full overflow-hidden text-center font-medium text-[#806D91] ${
                                    isDenseMonthView ? "text-[9px]" : "text-[10px]"
                                } ${isDenseMonthView && !expanded ? "" : "whitespace-nowrap"}`}
                            >
                                {labelForPoint(item.label)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function DonutChart({
                        items,
                        totalLabel,
                        centerLabel,
                        expanded = false,
                    }: {
    items: RevenueItem[];
    totalLabel: string;
    centerLabel: string;
    expanded?: boolean;
}) {
    const overallTotal = total(items);

    const background = useMemo(() => {
        if (overallTotal <= 0 || items.length === 0) {
            return "#EFEAF3";
        }

        let offset = 0;
        const segments = items.map((item, index) => {
            const percentage = (item.value / overallTotal) * 100;
            const start = offset;
            offset += percentage;
            return `${REVENUE_COLORS[index % REVENUE_COLORS.length]} ${start}% ${offset}%`;
        });

        return `conic-gradient(${segments.join(", ")})`;
    }, [items, overallTotal]);

    return (
        <div
            className={`relative flex shrink-0 items-center justify-center rounded-full ${
                expanded ? "h-[230px] w-[230px]" : "h-[184px] w-[184px]"
            }`}
            style={{ background }}
            aria-label={centerLabel}
        >
            <div
                className={`flex flex-col items-center justify-center rounded-full bg-white px-2 text-center ${
                    expanded ? "h-[148px] w-[148px]" : "h-[116px] w-[116px]"
                }`}
            >
                <p className="text-[17px] font-bold leading-tight text-[#281448]">{totalLabel}</p>
                <p className="mt-1 text-[10px] leading-tight text-[#806D91]">{centerLabel}</p>
            </div>
        </div>
    );
}

function RevenueLegend({
                           items,
                           emptyMessage,
                           expanded = false,
                           maxVisibleItems,
                       }: {
    items: RevenueItem[];
    emptyMessage: string;
    expanded?: boolean;
    maxVisibleItems?: number;
}) {
    const overallTotal = total(items);
    const visibleItems =
        !expanded && maxVisibleItems
            ? items.slice(0, maxVisibleItems)
            : items;
    const hiddenItemCount = Math.max(items.length - visibleItems.length, 0);

    if (items.length === 0) {
        return <p className="text-sm leading-6 text-[#7A6A84]">{emptyMessage}</p>;
    }

    return (
        <div
            className={`min-w-0 flex-1 ${
                expanded ? "" : "flex w-full flex-col self-center"
            }`}
        >
            <div
                className={`mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 font-semibold uppercase tracking-wide text-[#9A86AC] ${
                    expanded ? "text-[12px]" : "text-[11px]"
                }`}
            >
                <span>Category</span>
                <span>Value</span>
                <span>%</span>
            </div>

            <div className={expanded ? "space-y-2.5" : "space-y-2"}>
                {visibleItems.map((item, index) => {
                    const percentage = overallTotal > 0 ? Math.round((item.value / overallTotal) * 100) : 0;

                    return (
                        <div
                            key={item.name}
                            className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 ${
                                expanded ? "text-[14px]" : "text-[13px]"
                            }`}
                        >
                            <div className="flex min-w-0 items-center gap-2.5">
                                <span
                                    className={expanded ? "h-3 w-3 shrink-0 rounded-full" : "h-2.5 w-2.5 shrink-0 rounded-full"}
                                    style={{
                                        backgroundColor:
                                            REVENUE_COLORS[index % REVENUE_COLORS.length],
                                    }}
                                />
                                <span
                                    title={item.name}
                                    className={`truncate font-semibold text-[#4D2A74] ${
                                        expanded ? "text-[15px]" : "text-[14px]"
                                    }`}
                                >
                                    {item.name}
                                </span>
                            </div>
                            <span className="font-medium text-[#5F4A73]">{peso(item.value)}</span>
                            <span className="font-medium text-[#5F4A73]">{percentage}%</span>
                        </div>
                    );
                })}
            </div>

            {!expanded && maxVisibleItems ? (
                <p className="mt-1.5 min-h-4 text-[10px] leading-4 text-[#806D91]">
                    {hiddenItemCount > 0
                        ? `Showing top ${visibleItems.length} of ${items.length} entries. Expand to view all.`
                        : `Showing all ${items.length} entries.`}
                </p>
            ) : null}

            <div
                className={`grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-t border-[#EEE8F3] pt-2 font-semibold text-[#4D2A74] ${
                    expanded ? "mt-3 text-[14px]" : "mt-3 text-[13px]"
                }`}
            >
                <span>Total</span>
                <span>{peso(overallTotal)}</span>
                <span>100%</span>
            </div>
        </div>
    );
}


function OwnerAnalyticsBranchSelector({
                                          branches,
                                          selectedBranchId,
                                          loading,
                                          onSelectBranch,
                                      }: {
    branches: AnalyticsBranch[];
    selectedBranchId: number | null;
    loading: boolean;
    onSelectBranch: (branchId: number | null) => void;
}) {
    return (
        <div className="relative w-full lg:w-[320px]">
            <select
                value={selectedBranchId ?? ""}
                disabled={loading}
                onChange={(event) => {
                    const value = event.target.value;
                    onSelectBranch(value ? Number(value) : null);
                }}
                className="h-[42px] w-full appearance-none rounded-xl border border-[#E6DDF0] bg-white px-3.5 pr-10 text-sm font-semibold text-[#1A1220] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Select analytics branch"
            >
                <option value="">All Branches</option>
                {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                        {branch.name}
                    </option>
                ))}
            </select>
            <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#5E4774]"
            />
        </div>
    );
}

function PeriodSelector({
                            periodMode,
                            customStart,
                            customEnd,
                            onPeriodChange,
                            onCustomStartChange,
                            onCustomEndChange,
                            onApplyCustomRange,
                            disabled,
                        }: {
    periodMode: AnalyticsPeriodMode;
    customStart: string;
    customEnd: string;
    onPeriodChange: (value: AnalyticsPeriodMode) => void;
    onCustomStartChange: (value: string) => void;
    onCustomEndChange: (value: string) => void;
    onApplyCustomRange: () => void;
    disabled: boolean;
}) {
    return (
        <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div>
                    <h2 className="text-[16px] font-bold text-[#1A1220]">Reporting Period</h2>
                    <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                        Analytics uses recorded POS orders and accepted booking schedules within the selected period.
                    </p>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                    <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                        Period
                        <select
                            value={periodMode}
                            disabled={disabled}
                            onChange={(event) =>
                                onPeriodChange(event.target.value as AnalyticsPeriodMode)
                            }
                            className="h-[38px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#2B174C] outline-none disabled:opacity-60"
                        >
                            <option value="30">Rolling last 30 days</option>
                            <option value="60">Rolling last 60 days</option>
                            <option value="90">Rolling last 90 days</option>
                            <option value="12m">Last 12 complete months</option>
                            <option value="custom">Custom dates</option>
                        </select>
                    </label>

                    {periodMode === "custom" && (
                        <>
                            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                                Start date
                                <input
                                    type="date"
                                    value={customStart}
                                    max={customEnd}
                                    onChange={(event) => onCustomStartChange(event.target.value)}
                                    className="h-[38px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm font-medium normal-case tracking-normal text-[#2B174C] outline-none"
                                />
                            </label>
                            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                                End date
                                <input
                                    type="date"
                                    value={customEnd}
                                    min={customStart}
                                    onChange={(event) => onCustomEndChange(event.target.value)}
                                    className="h-[38px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm font-medium normal-case tracking-normal text-[#2B174C] outline-none"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={onApplyCustomRange}
                                disabled={disabled || !customStart || !customEnd}
                                className="h-[38px] rounded-xl border border-[#2B174C] px-3 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F3ECFF] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Apply
                            </button>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}

export function AnalyticsLoadingScreen() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[#FDFAF4] text-[#1A1220]">
            <p className="text-sm text-[#7A6E88]">Loading analytics...</p>
        </main>
    );
}

export function AnalyticsWorkspace({
                                       role,
                                       assignedBranch = "",
                                       ownerBranches = [],
                                       ownerBranchesLoading = false,
                                   }: {
    role: AnalyticsRole;
    assignedBranch?: string;
    ownerBranches?: AnalyticsBranch[];
    ownerBranchesLoading?: boolean;
}) {
    const initialRange = useMemo(() => lastTwelveMonthsRange(), []);
    const [periodMode, setPeriodMode] = useState<AnalyticsPeriodMode>("12m");
    const [customStart, setCustomStart] = useState(initialRange.start);
    const [customEnd, setCustomEnd] = useState(initialRange.end);
    const [appliedCustomRange, setAppliedCustomRange] = useState(initialRange);
    const [salesView, setSalesView] = useState<"month" | "day">("month");
    const [bookingView, setBookingView] = useState<"month" | "weekday">("month");
    const [selectedSalesMonth, setSelectedSalesMonth] = useState("");
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [expandedPanel, setExpandedPanel] =
        useState<ExpandedAnalyticsPanel | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const isOwner = role === "owner";
    const [selectedOwnerBranchId, setSelectedOwnerBranchId] = useState<number | null>(null);

    const selectedOwnerBranch = useMemo(
        () => ownerBranches.find((branch) => branch.id === selectedOwnerBranchId) ?? null,
        [ownerBranches, selectedOwnerBranchId]
    );

    const loadAnalytics = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const token = getToken();

            if (!token) {
                throw new Error("Your login token is missing. Please log out and sign in again.");
            }

            const requestBody: Record<string, string | number> = {
                action: "get_analytics",
            };

            if (periodMode === "custom" || periodMode === "12m") {
                const range =
                    periodMode === "12m"
                        ? lastTwelveMonthsRange()
                        : appliedCustomRange;

                requestBody.start_date = range.start;
                requestBody.end_date = range.end;
            } else {
                requestBody.period = Number(periodMode);
            }

            if (isOwner && selectedOwnerBranchId !== null) {
                requestBody.branch_id = selectedOwnerBranchId;
            }

            // Mirrors the working Forecasting flow exactly:
            // browser -> Next.js POST route -> API Gateway -> Lambda.
            const response = await fetch("/api/analytics", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(requestBody),
                cache: "no-store",
            });

            const responseText = await response.text();
            let result: (AnalyticsData & { error?: string; details?: string }) | null = null;

            try {
                result = responseText
                    ? (JSON.parse(responseText) as AnalyticsData & { error?: string; details?: string })
                    : null;
            } catch {
                throw new Error(
                    responseText ||
                    `Analytics service returned status ${response.status}.`
                );
            }

            if (!response.ok) {
                throw new Error(
                    result?.error ||
                    result?.details ||
                    `Analytics service returned status ${response.status}.`
                );
            }

            if (!result?.success) {
                throw new Error(result?.error || "Analytics did not return a successful response.");
            }

            setData(result);
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Analytics data could not be loaded."
            );
        } finally {
            setLoading(false);
        }
    }, [appliedCustomRange, isOwner, periodMode, selectedOwnerBranchId]);


    useEffect(() => {
        void loadAnalytics();
    }, [loadAnalytics]);



    const availableSalesMonths = data?.salesTrend.monthlySales.map((item) => item.label) || [];
    const resolvedSalesMonth =
        availableSalesMonths.includes(selectedSalesMonth)
            ? selectedSalesMonth
            : availableSalesMonths[availableSalesMonths.length - 1] || "";

    const dailySales = data?.salesTrend.dailySalesByMonth[resolvedSalesMonth] || [];
    const monthlySales = data?.salesTrend.monthlySales || [];
    const activeSalesData =
        salesView === "day" ? dailySales : monthlySales;
    const activeSalesTotal = activeSalesData.reduce(
        (sum, item) => sum + Number(item.value || 0),
        0
    );

    const highestSalesPoint =
        activeSalesData.length > 0
            ? activeSalesData.reduce(
                (highest, item) =>
                    Number(item.value || 0) > Number(highest.value || 0)
                        ? item
                        : highest,
                activeSalesData[0]
            )
            : null;

    const lowestSalesPoint =
        activeSalesData.length > 0
            ? activeSalesData.reduce(
                (lowest, item) =>
                    Number(item.value || 0) < Number(lowest.value || 0)
                        ? item
                        : lowest,
                activeSalesData[0]
            )
            : null;

    const noSalesDays =
        salesView === "day"
            ? dailySales.filter((item) => Number(item.value || 0) <= 0).length
            : 0;

    const monthlyBookings = data?.peakBookings.monthlyBookings || [];
    const weekdayBookings = data?.peakBookings.dailyBookings || [];
    const activeBookingData =
        bookingView === "month" ? monthlyBookings : weekdayBookings;
    const selectedPeriodDateRange = data
        ? formatAnalyticsDateRange(data.period.startDate, data.period.endDate)
        : "Selected reporting period";
    const salesMonthGroupingNote = data
        ? monthlyGroupingDescription(data.period, monthlySales.length)
        : "";

    const scopeLabel = data?.scope.branchName ||
        (isOwner
            ? selectedOwnerBranch?.name || "All Branches"
            : assignedBranch || "Assigned Branch");

    const scopeDescription = data?.scope.isOverall
        ? "Overall business performance from authorized inventory sales and booking activity across all branches."
        : `Authorized business performance for ${scopeLabel}.`;

    function applyCustomRange() {
        if (!customStart || !customEnd || customStart > customEnd) {
            setError("Choose a valid custom start date and end date.");
            return;
        }

        setAppliedCustomRange({
            start: customStart,
            end: customEnd,
        });
    }

    return (
        <div className="space-y-3">
            {isOwner && (
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                                <Building2 size={18} />
                            </div>
                            <div>
                                <h2 className="text-[16px] font-bold text-[#1A1220]">Analytics Scope</h2>
                                <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                                    All Branches is the default. Select one branch to view only that branch’s authorized analytics.
                                </p>
                            </div>
                        </div>

                        <OwnerAnalyticsBranchSelector
                            branches={ownerBranches}
                            selectedBranchId={selectedOwnerBranchId}
                            loading={ownerBranchesLoading}
                            onSelectBranch={setSelectedOwnerBranchId}
                        />
                    </div>
                </section>
            )}

            <PeriodSelector
                periodMode={periodMode}
                customStart={customStart}
                customEnd={customEnd}
                onPeriodChange={setPeriodMode}
                onCustomStartChange={setCustomStart}
                onCustomEndChange={setCustomEnd}
                onApplyCustomRange={applyCustomRange}
                disabled={loading}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[#7A6A84]">{scopeDescription}</p>
                <p className="text-xs text-[#806A8C]">
                    {data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}` : ""}
                </p>
            </div>

            {error && (
                <div className="rounded-xl border border-[#F2C4C4] bg-[#FFF6F6] px-4 py-3 text-sm text-[#8E2D2D]">
                    <p className="font-semibold">Unable to load live analytics.</p>
                    <p className="mt-1">{error}</p>
                </div>
            )}

            {loading && !data ? (
                <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-8 text-center text-sm text-[#7A6A84] shadow-sm">
                    Loading live analytics records...
                </div>
            ) : data ? (
                <>
                    {!data.hasData && (
                        <EmptyPanel
                            title="No authorized analytics records are available."
                            message={`No POS orders or accepted booking records were found for ${data.scope.branchName} during ${data.period.label}. Choose another reporting period or record new transactions.`}
                        />
                    )}

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <Card
                            title="Sales Growth"
                            onExpand={() => setExpandedPanel("sales-growth")}
                        >
                            <div className="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
                                <div className="border-b border-[#EEE8F3] pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                                        Overall sales growth
                                    </p>
                                    <p className="mt-2 text-[28px] font-bold tracking-tight text-[#7B3FE4]">
                                        {data.salesGrowth.value > 0 ? "+" : ""}
                                        {data.salesGrowth.value}%
                                    </p>
                                    <p className="mt-1 text-[10px] leading-4 text-[#806D91]">
                                        {data.salesGrowth.comparisonLabel}
                                    </p>

                                    <div className="mt-5 border-t border-[#EEE8F3] pt-3 text-[11px] leading-5 text-[#6F5A82]">
                                        <p>Current sales: <strong>{peso(data.salesGrowth.currentSales)}</strong></p>
                                        <p>Previous period: <strong>{peso(data.salesGrowth.previousSales)}</strong></p>
                                    </div>
                                </div>

                                <div>
                                    <p className="mb-1 text-center text-[10px] font-semibold text-[#4D2A74]">
                                        {data.salesGrowth.monthlyGrowthLabel || "Selected reporting period only"}
                                    </p>
                                    <p className="mb-2 text-center text-[10px] font-medium text-[#806D91]">
                                        Monthly sales change <span className="text-[#A38FB4]">(vs prior month shown)</span>
                                    </p>
                                    <GrowthBarChart data={data.salesGrowth.monthlyGrowth} />
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="Sales Trend"
                            onExpand={() => setExpandedPanel("sales-trend")}
                            action={
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <div
                                        className="flex rounded-xl border border-[#E6DDF0] bg-white p-1 text-xs font-semibold shadow-sm"
                                        aria-label="Sales trend view"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setSalesView("month")}
                                            className={`rounded-md px-2.5 py-1.5 transition ${
                                                salesView === "month"
                                                    ? "bg-[#2D1B4E] text-white"
                                                    : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                            }`}
                                        >
                                            Monthly Overview
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSalesView("day")}
                                            className={`rounded-md px-2.5 py-1.5 transition ${
                                                salesView === "day"
                                                    ? "bg-[#2D1B4E] text-white"
                                                    : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                            }`}
                                        >
                                            Daily Breakdown
                                        </button>
                                    </div>

                                    {salesView === "day" && (
                                        <label className="grid gap-1 text-[9px] font-semibold uppercase tracking-wide text-[#806D91]">
                                            Month to inspect
                                            <select
                                                value={resolvedSalesMonth}
                                                onChange={(event) =>
                                                    setSelectedSalesMonth(event.target.value)
                                                }
                                                className="h-[32px] rounded-xl border border-[#E6DDF0] bg-white px-2.5 text-xs font-medium normal-case tracking-normal text-[#2B174C] outline-none shadow-sm"
                                                aria-label="Select month for daily sales chart"
                                            >
                                                {availableSalesMonths.map((month) => (
                                                    <option key={month} value={month}>
                                                        {month}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                </div>
                            }
                        >
                            <div className="mb-3">
                                <p className="text-[12px] font-semibold text-[#4D2A74]">
                                    {salesView === "month"
                                        ? `Monthly POS Sales — ${data.period.label}`
                                        : `Daily POS Sales — ${resolvedSalesMonth || data.period.label}`}
                                </p>
                                <p className="mt-1 text-[11px] leading-5 text-[#806D91]">
                                    {salesView === "month"
                                        ? salesMonthGroupingNote
                                        : `Each point represents one calendar day in ${resolvedSalesMonth || "the selected month"}. A ₱0 point means no completed POS sale was recorded on that day.`}
                                </p>
                            </div>

                            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <div className="rounded-lg border border-[#EEE8F3] bg-[#FFFEFC] px-3 py-2">
                                    <p className="text-[9px] font-semibold uppercase tracking-wide text-[#806D91]">
                                        {salesView === "month"
                                            ? "Period total"
                                            : "Selected month total"}
                                    </p>
                                    <p className="mt-1 text-[16px] font-bold text-[#2B174C]">
                                        {peso(activeSalesTotal)}
                                    </p>
                                </div>

                                <div className="rounded-lg border border-[#EEE8F3] bg-[#FFFEFC] px-3 py-2">
                                    <p className="text-[9px] font-semibold uppercase tracking-wide text-[#806D91]">
                                        {salesView === "month"
                                            ? "Highest-sales month"
                                            : "Highest-sales day"}
                                    </p>
                                    <p className="mt-1 text-[13px] font-bold text-[#2B174C]">
                                        {highestSalesPoint
                                            ? `${highestSalesPoint.label} · ${peso(highestSalesPoint.value)}`
                                            : "—"}
                                    </p>
                                </div>

                                <div className="rounded-lg border border-[#EEE8F3] bg-[#FFFEFC] px-3 py-2">
                                    <p className="text-[9px] font-semibold uppercase tracking-wide text-[#806D91]">
                                        {salesView === "month"
                                            ? "Lowest-sales month"
                                            : "No-sales days"}
                                    </p>
                                    <p className="mt-1 text-[13px] font-bold text-[#2B174C]">
                                        {salesView === "month"
                                            ? lowestSalesPoint
                                                ? `${lowestSalesPoint.label} · ${peso(lowestSalesPoint.value)}`
                                                : "—"
                                            : `${formatNumber(noSalesDays)} day(s)`}
                                    </p>
                                </div>
                            </div>

                            <SalesLineChart
                                data={activeSalesData}
                                granularity={salesView}
                                ariaLabel={
                                    salesView === "month"
                                        ? "Monthly completed POS sales trend"
                                        : `Daily completed POS sales trend for ${resolvedSalesMonth}`
                                }
                            />

                        </Card>
                    </div>
                    <Card
                        title="Booking Patterns"
                        onExpand={() => setExpandedPanel("peak-bookings")}
                        action={
                            <div
                                className="flex rounded-xl border border-[#E6DDF0] bg-white p-1 text-xs font-semibold shadow-sm"
                                aria-label="Booking pattern view"
                            >
                                <button
                                    type="button"
                                    onClick={() => setBookingView("month")}
                                    className={`rounded-md px-2.5 py-1.5 transition ${
                                        bookingView === "month"
                                            ? "bg-[#2D1B4E] text-white"
                                            : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                    }`}
                                >
                                    Monthly Overview
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBookingView("weekday")}
                                    className={`rounded-md px-2.5 py-1.5 transition ${
                                        bookingView === "weekday"
                                            ? "bg-[#2D1B4E] text-white"
                                            : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                    }`}
                                >
                                    Weekday Pattern
                                </button>
                            </div>
                        }
                    >
                        <div className="grid divide-y divide-[#EEE8F3] rounded-xl border border-[#E8DDF4] md:grid-cols-4 md:divide-x md:divide-y-0">
                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]"><CalendarDays size={20} /></span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Peak booking month</p>
                                    <p className="text-[15px] font-bold text-[#6B2AC6]">{data.peakBookings.peakMonth}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]"><CalendarDays size={20} /></span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Peak booking weekday</p>
                                    <p className="text-[15px] font-bold text-[#6B2AC6]">{data.peakBookings.peakDay}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]"><Clock3 size={20} /></span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Peak booking time</p>
                                    <p className="text-[15px] font-bold text-[#6B2AC6]">{data.peakBookings.peakTime}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]"><BarChart3 size={20} /></span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Accepted bookings</p>
                                    <p className="text-[15px] font-bold text-[#6B2AC6]">{data.peakBookings.totalBookings}</p>
                                    <p className="text-[9px] text-[#806D91]">Confirmed, Preparing, Completed</p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
                            <div>
                                <p className="text-[11px] font-semibold text-[#4D2A74]">
                                    {bookingView === "month"
                                        ? `Accepted bookings by event month · ${selectedPeriodDateRange}`
                                        : `Accepted bookings by event weekday · ${data.period.label}`}
                                </p>
                                <p className="mt-1 text-[10px] leading-5 text-[#806D91]">
                                    {bookingView === "month"
                                        ? "Every calendar month in the selected period is included. A 0 means no accepted booking was scheduled in that month."
                                        : `This pattern combines all accepted bookings from ${selectedPeriodDateRange} by their event weekday. It does not show booking volume by month.`}
                                </p>
                                <BookingBars
                                    data={activeBookingData}
                                    granularity={bookingView}
                                />
                            </div>

                            <div className="flex gap-3 rounded-xl border border-[#F0DFC1] bg-[#FFFDF8] p-4">
                                <span className="h-fit rounded-full bg-[#FFF0CB] p-2.5 text-[#C88812]"><Lightbulb size={18} /></span>
                                <div>
                                    <p className="text-xs font-semibold text-[#7A4B09]">Booking insight</p>
                                    <p className="mt-1 text-[11px] leading-5 text-[#806D91]">
                                        {data.peakBookings.totalBookings > 0
                                            ? bookingView === "month"
                                                ? `${data.peakBookings.peakMonth} has the highest accepted booking volume. Switch to Weekday Pattern to see the most frequently scheduled day.`
                                                : `${data.peakBookings.peakDay} is the most frequently scheduled booking weekday across the selected period. Weekend bookings account for ${data.peakBookings.weekendPercentage}% of accepted bookings.`
                                            : "No accepted bookings are available for this reporting period."}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </Card>

                    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                        <Card
                            title="Product Revenue Analytics"
                            onExpand={() => setExpandedPanel("product-revenue")}
                            className="min-h-[454px]"
                        >
                            <div className="flex min-h-[410px] flex-col">
                                <p className="min-h-[40px] text-xs leading-5 text-[#7A6A84]">
                                    {data.dataNotes.products}
                                </p>

                                <div className="mt-3 grid flex-1 items-center gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
                                    <div className="flex justify-center">
                                        <DonutChart
                                            items={data.productRevenue}
                                            totalLabel={peso(total(data.productRevenue))}
                                            centerLabel="POS product revenue"
                                        />
                                    </div>

                                    <RevenueLegend
                                        items={data.productRevenue}
                                        emptyMessage="No product revenue is available. POS orders must include order-item details with product prices."
                                        maxVisibleItems={12}
                                    />
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="Package Revenue Analytics"
                            onExpand={() => setExpandedPanel("package-revenue")}
                            className="min-h-[454px]"
                        >
                            <div className="flex min-h-[410px] flex-col">
                                <p className="min-h-[40px] text-xs leading-5 text-[#7A6A84]">
                                    {data.dataNotes.packages}
                                </p>

                                <div className="mt-3 grid flex-1 items-center gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
                                    <div className="flex justify-center">
                                        <DonutChart
                                            items={data.packageRevenue}
                                            totalLabel={peso(total(data.packageRevenue))}
                                            centerLabel="Accepted package booking value"
                                        />
                                    </div>

                                    <RevenueLegend
                                        items={data.packageRevenue}
                                        emptyMessage="No accepted package booking value is available for this reporting period."
                                        maxVisibleItems={12}
                                    />
                                </div>
                            </div>
                        </Card>
                    </div>


                    <Card
                        title="Analytics Insights"
                        onExpand={() => setExpandedPanel("insights")}
                    >
                        {data.insights.length > 0 ? (
                            <div className="grid gap-2 md:grid-cols-2">
                                {data.insights.map((insight) => (
                                    <div key={insight} className="rounded-xl border border-[#EAE2F1] bg-[#FFFEFC] px-3 py-3 text-sm leading-6 text-[#5F4A73]">
                                        {insight}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyPanel
                                title="No generated insight is available."
                                message="Record authorized POS sales or accepted bookings, then refresh analytics."
                            />
                        )}
                    </Card>

                    <AnalyticsExpandDialog
                        open={expandedPanel !== null}
                        title={
                            expandedPanel === "sales-growth"
                                ? "Sales Growth"
                                : expandedPanel === "sales-trend"
                                    ? "Sales Trend"
                                    : expandedPanel === "peak-bookings"
                                        ? "Booking Patterns"
                                        : expandedPanel === "product-revenue"
                                            ? "Product Revenue Analytics"
                                            : expandedPanel === "package-revenue"
                                                ? "Package Revenue Analytics"
                                                : "Analytics Insights"
                        }
                        subtitle={`${scopeLabel} · ${data.period.label}`}
                        onClose={() => setExpandedPanel(null)}
                    >
                        {expandedPanel === "sales-growth" && (
                            <div className="rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm sm:p-6">
                                <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                                    <div className="rounded-2xl border border-[#ECE3F5] bg-[#FFFEFC] p-5">
                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#806D91]">
                                            Sales change
                                        </p>
                                        <p className="mt-2 text-4xl font-bold tracking-tight text-[#7B3FE4]">
                                            {data.salesGrowth.value > 0 ? "+" : ""}
                                            {data.salesGrowth.value}%
                                        </p>
                                        <p className="mt-2 text-sm leading-6 text-[#6F5A82]">
                                            {data.salesGrowth.comparisonLabel}
                                        </p>

                                        <div className="mt-6 space-y-3 border-t border-[#EEE8F3] pt-4 text-sm text-[#5F4A73]">
                                            <div className="flex items-center justify-between gap-3">
                                                <span>Current sales</span>
                                                <strong className="text-[#2B174C]">
                                                    {peso(data.salesGrowth.currentSales)}
                                                </strong>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                                <span>Previous period</span>
                                                <strong className="text-[#2B174C]">
                                                    {peso(data.salesGrowth.previousSales)}
                                                </strong>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[#ECE3F5] bg-[#FFFEFC] p-4 sm:p-5">
                                        <p className="mb-1 text-center text-xs font-semibold text-[#4D2A74]">
                                            {data.salesGrowth.monthlyGrowthLabel || "Selected reporting period only"}
                                        </p>
                                        <p className="mb-2 text-center text-xs font-medium text-[#806D91]">
                                            Monthly sales change (vs prior month shown)
                                        </p>
                                        <GrowthBarChart
                                            data={data.salesGrowth.monthlyGrowth}
                                            expanded
                                        />
                                        <p className="mt-7 border-t border-[#EEE8F3] pt-3 text-xs leading-5 text-[#806D91]">
                                            {data.salesGrowth.monthlyGrowthDescription ||
                                                "Every calendar month in the selected reporting period is included. Months without completed POS sales appear as ₱0."}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {expandedPanel === "sales-trend" && (
                            <div className="space-y-4 rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm sm:p-6">
                                <div className="flex flex-col gap-3 border-b border-[#EEE8F3] pb-4 lg:flex-row lg:items-end lg:justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-[#4D2A74]">
                                            {salesView === "month"
                                                ? `Monthly POS Sales — ${data.period.label}`
                                                : `Daily POS Sales — ${resolvedSalesMonth || data.period.label}`}
                                        </p>
                                        <p className="mt-1 text-xs leading-5 text-[#806D91]">
                                            {salesView === "month"
                                                ? salesMonthGroupingNote
                                                : `Each point represents one calendar day in ${resolvedSalesMonth || "the selected month"}. A ₱0 point means no completed POS sale was recorded on that day.`}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap items-end gap-2">
                                        <div className="flex rounded-xl border border-[#E6DDF0] bg-white p-1 text-xs font-semibold shadow-sm">
                                            <button
                                                type="button"
                                                onClick={() => setSalesView("month")}
                                                className={`rounded-md px-3 py-2 transition ${
                                                    salesView === "month"
                                                        ? "bg-[#2D1B4E] text-white"
                                                        : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                                }`}
                                            >
                                                Monthly Overview
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSalesView("day")}
                                                className={`rounded-md px-3 py-2 transition ${
                                                    salesView === "day"
                                                        ? "bg-[#2D1B4E] text-white"
                                                        : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                                }`}
                                            >
                                                Daily Breakdown
                                            </button>
                                        </div>

                                        {salesView === "day" && (
                                            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                                                Month to inspect
                                                <select
                                                    value={resolvedSalesMonth}
                                                    onChange={(event) =>
                                                        setSelectedSalesMonth(event.target.value)
                                                    }
                                                    className="h-[38px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm font-medium normal-case tracking-normal text-[#2B174C] outline-none shadow-sm"
                                                >
                                                    {availableSalesMonths.map((month) => (
                                                        <option key={month} value={month}>
                                                            {month}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        )}
                                    </div>
                                </div>

                                <div className="grid gap-3 md:grid-cols-3">
                                    <div className="rounded-xl border border-[#EEE8F3] bg-[#FFFEFC] px-4 py-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                                            {salesView === "month"
                                                ? "Period total"
                                                : "Selected month total"}
                                        </p>
                                        <p className="mt-1 text-xl font-bold text-[#2B174C]">
                                            {peso(activeSalesTotal)}
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-[#EEE8F3] bg-[#FFFEFC] px-4 py-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                                            {salesView === "month"
                                                ? "Highest-sales month"
                                                : "Highest-sales day"}
                                        </p>
                                        <p className="mt-1 text-sm font-bold text-[#2B174C]">
                                            {highestSalesPoint
                                                ? `${highestSalesPoint.label} · ${peso(highestSalesPoint.value)}`
                                                : "—"}
                                        </p>
                                    </div>
                                    <div className="rounded-xl border border-[#EEE8F3] bg-[#FFFEFC] px-4 py-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#806D91]">
                                            {salesView === "month"
                                                ? "Lowest-sales month"
                                                : "No-sales days"}
                                        </p>
                                        <p className="mt-1 text-sm font-bold text-[#2B174C]">
                                            {salesView === "month"
                                                ? lowestSalesPoint
                                                    ? `${lowestSalesPoint.label} · ${peso(lowestSalesPoint.value)}`
                                                    : "—"
                                                : `${formatNumber(noSalesDays)} day(s)`}
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-[#ECE3F5] bg-[#FFFEFC] p-3 sm:p-5">
                                    <SalesLineChart
                                        data={activeSalesData}
                                        granularity={salesView}
                                        expanded
                                        ariaLabel={
                                            salesView === "month"
                                                ? "Monthly completed POS sales trend"
                                                : `Daily completed POS sales trend for ${resolvedSalesMonth}`
                                        }
                                    />
                                </div>
                            </div>
                        )}

                        {expandedPanel === "peak-bookings" && (
                            <div className="space-y-6 rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm sm:p-7 xl:min-h-[calc(100vh-190px)]">
                                <div className="flex flex-col gap-3 border-b border-[#EEE8F3] pb-5 lg:flex-row lg:items-end lg:justify-between">
                                    <div>
                                        <p className="text-base font-bold text-[#4D2A74]">Accepted booking patterns</p>
                                        <p className="mt-1 max-w-3xl text-xs leading-6 text-[#806D91]">
                                            Monthly Overview shows when accepted bookings occurred by event month. Weekday Pattern combines the full selected period by weekday to reveal the most commonly scheduled day.
                                        </p>
                                    </div>
                                    <div
                                        className="flex rounded-xl border border-[#E6DDF0] bg-white p-1 text-sm font-semibold shadow-sm"
                                        aria-label="Expanded booking pattern view"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setBookingView("month")}
                                            className={`rounded-md px-3 py-2 transition ${
                                                bookingView === "month"
                                                    ? "bg-[#2D1B4E] text-white"
                                                    : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                            }`}
                                        >
                                            Monthly Overview
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setBookingView("weekday")}
                                            className={`rounded-md px-3 py-2 transition ${
                                                bookingView === "weekday"
                                                    ? "bg-[#2D1B4E] text-white"
                                                    : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                            }`}
                                        >
                                            Weekday Pattern
                                        </button>
                                    </div>
                                </div>

                                <div className="grid divide-y divide-[#EEE8F3] rounded-2xl border border-[#E8DDF4] md:grid-cols-4 md:divide-x md:divide-y-0">
                                    <div className="flex items-center gap-3 p-4">
                                        <span className="rounded-full bg-[#F1E9FE] p-3 text-[#7B3FE4]"><CalendarDays size={22} /></span>
                                        <div>
                                            <p className="text-[11px] text-[#806D91]">Peak booking month</p>
                                            <p className="text-lg font-bold text-[#6B2AC6]">{data.peakBookings.peakMonth}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 p-4">
                                        <span className="rounded-full bg-[#F1E9FE] p-3 text-[#7B3FE4]"><CalendarDays size={22} /></span>
                                        <div>
                                            <p className="text-[11px] text-[#806D91]">Peak booking weekday</p>
                                            <p className="text-lg font-bold text-[#6B2AC6]">{data.peakBookings.peakDay}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 p-4">
                                        <span className="rounded-full bg-[#F1E9FE] p-3 text-[#7B3FE4]"><Clock3 size={22} /></span>
                                        <div>
                                            <p className="text-[11px] text-[#806D91]">Peak booking time</p>
                                            <p className="text-lg font-bold text-[#6B2AC6]">{data.peakBookings.peakTime}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 p-4">
                                        <span className="rounded-full bg-[#F1E9FE] p-3 text-[#7B3FE4]"><BarChart3 size={22} /></span>
                                        <div>
                                            <p className="text-[11px] text-[#806D91]">Accepted bookings</p>
                                            <p className="text-lg font-bold text-[#6B2AC6]">{data.peakBookings.totalBookings}</p>
                                            <p className="text-[10px] text-[#806D91]">Confirmed, Preparing, Completed</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-6 pt-2 xl:grid-cols-[minmax(0,1fr)_340px]">
                                    <div className="rounded-2xl border border-[#ECE3F5] bg-[#FFFEFC] p-5 sm:p-7">
                                        <p className="text-base font-bold text-[#4D2A74]">
                                            {bookingView === "month"
                                                ? `Accepted bookings by event month · ${selectedPeriodDateRange}`
                                                : `Accepted bookings by event weekday · ${data.period.label}`}
                                        </p>
                                        <p className="mt-1 text-xs leading-6 text-[#806D91]">
                                            {bookingView === "month"
                                                ? "Every calendar month in the selected period is included. A 0 means no accepted booking was scheduled in that month."
                                                : `This view combines all accepted bookings from ${selectedPeriodDateRange} by event weekday. It identifies scheduling preference, not monthly booking volume.`}
                                        </p>
                                        <BookingBars
                                            data={activeBookingData}
                                            granularity={bookingView}
                                            expanded
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex gap-3 rounded-2xl border border-[#F0DFC1] bg-[#FFFDF8] p-4">
                                            <span className="h-fit rounded-full bg-[#FFF0CB] p-2.5 text-[#C88812]"><Lightbulb size={18} /></span>
                                            <div>
                                                <p className="text-sm font-semibold text-[#7A4B09]">Booking insight</p>
                                                <p className="mt-1 text-xs leading-6 text-[#806D91]">
                                                    {data.peakBookings.totalBookings > 0
                                                        ? bookingView === "month"
                                                            ? `${data.peakBookings.peakMonth} recorded the most accepted bookings. Use this monthly view to plan capacity across the calendar.`
                                                            : `${data.peakBookings.peakDay} is the most frequently scheduled weekday across all accepted bookings in this period. Weekend bookings make up ${data.peakBookings.weekendPercentage}% of the total.`
                                                        : "No accepted bookings are available for this reporting period."}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="rounded-2xl border border-[#ECE3F5] bg-[#FFFEFC] p-4">
                                            <p className="text-sm font-bold text-[#4D2A74]">Top booked packages</p>
                                            {data.peakBookings.topPackages.length > 0 ? (
                                                <div className="mt-3 space-y-2">
                                                    {data.peakBookings.topPackages.map((item, index) => (
                                                        <div
                                                            key={item.name}
                                                            className="flex items-center justify-between gap-3 rounded-xl border border-[#EEE8F3] bg-white px-3 py-2.5 text-sm"
                                                        >
                                                                    <span className="flex min-w-0 items-center gap-2 font-medium text-[#5F4A73]">
                                                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1E9FE] text-[11px] font-bold text-[#6B2AC6]">
                                                                            {index + 1}
                                                                        </span>
                                                                        <span className="truncate">{item.name}</span>
                                                                    </span>
                                                            <strong className="shrink-0 text-[#2B174C]">
                                                                {formatNumber(item.value)}
                                                            </strong>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="mt-2 text-xs leading-5 text-[#806D91]">
                                                    No package bookings were recorded for this period.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {expandedPanel === "product-revenue" && (
                            <div className="rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm sm:p-8 xl:min-h-[calc(100vh-190px)]">
                                <p className="max-w-5xl text-base leading-7 text-[#7A6A84]">
                                    {data.dataNotes.products}
                                </p>
                                <div className="mt-8 grid items-center gap-10 lg:grid-cols-[300px_minmax(0,1fr)]">
                                    <div className="flex justify-center">
                                        <DonutChart
                                            items={data.productRevenue}
                                            totalLabel={peso(total(data.productRevenue))}
                                            centerLabel="POS product revenue"
                                            expanded
                                        />
                                    </div>
                                    <div className="rounded-2xl border border-[#ECE3F5] bg-[#FFFEFC] p-5 sm:p-6">
                                        <RevenueLegend
                                            items={data.productRevenue}
                                            emptyMessage="No product revenue is available. POS orders must include order-item details with product prices."
                                            expanded
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {expandedPanel === "package-revenue" && (
                            <div className="rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm sm:p-8 xl:min-h-[calc(100vh-190px)]">
                                <p className="max-w-5xl text-base leading-7 text-[#7A6A84]">
                                    {data.dataNotes.packages}
                                </p>
                                <div className="mt-8 grid items-center gap-10 lg:grid-cols-[300px_minmax(0,1fr)]">
                                    <div className="flex justify-center">
                                        <DonutChart
                                            items={data.packageRevenue}
                                            totalLabel={peso(total(data.packageRevenue))}
                                            centerLabel="Accepted package booking value"
                                            expanded
                                        />
                                    </div>
                                    <div className="rounded-2xl border border-[#ECE3F5] bg-[#FFFEFC] p-5 sm:p-6">
                                        <RevenueLegend
                                            items={data.packageRevenue}
                                            emptyMessage="No accepted package booking value is available for this reporting period."
                                            expanded
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {expandedPanel === "insights" && (
                            <div className="rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm sm:p-6">
                                {data.insights.length > 0 ? (
                                    <div className="grid gap-4 md:grid-cols-2">
                                        {data.insights.map((insight, index) => (
                                            <div
                                                key={insight}
                                                className="rounded-2xl border border-[#EAE2F1] bg-[#FFFEFC] p-5 text-sm leading-7 text-[#5F4A73] shadow-sm"
                                            >
                                                        <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F1E9FE] text-sm font-bold text-[#6B2AC6]">
                                                            {index + 1}
                                                        </span>
                                                {insight}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyPanel
                                        title="No generated insight is available."
                                        message="Record authorized POS sales or accepted bookings, then refresh analytics."
                                    />
                                )}
                            </div>
                        )}
                    </AnalyticsExpandDialog>
                </>
            ) : null}
        </div>
    );
}
