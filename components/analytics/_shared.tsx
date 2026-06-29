"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    BarChart3,
    Building2,
    Check,
    ChevronDown,
    CalendarDays,
    Clock3,
    Info,
    Lightbulb,
    Minus,
    RefreshCw,
    Search,
    TrendingDown,
    TrendingUp,
    UsersRound,
} from "lucide-react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";

type ChartPoint = {
    label: string;
    value: number;
};

type RevenueItem = {
    name: string;
    value: number;
    color: string;
};

function formatCurrentDateTime(value: Date) {
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

type AnalyticsData = {
    periodDays: number;
    periodLabel: string;
    monthLabel: string;
    generatedAt: string;
    salesGrowth: {
        value: number;
        monthlyGrowth: ChartPoint[];
    };
    salesTrend: {
        latestMonthlySales: number;
        previousMonthSales: number;
        monthlySales: ChartPoint[];
        dailySalesByMonth: Record<string, ChartPoint[]>;
    };
    peakBookings: {
        peakDay: string;
        peakTime: string;
        weekendPercentage: number;
        weekdayPeak: string;
        weekdayPeakTime: string;
        dailyBookings: ChartPoint[];
    };
    productRevenue: RevenueItem[];
    packageRevenue: RevenueItem[];
};


function createDailySalesByMonth(monthlySales: ChartPoint[]) {
    const dailyWeights = [
        0.88, 0.92, 1.05, 1.12, 0.96, 1.18, 1.26, 1.08, 0.91, 1.14,
        1.21, 1.02, 0.97, 1.29, 1.17, 1.09, 0.95, 1.24, 1.31, 1.04,
        0.98, 1.16, 1.23, 1.07, 0.94, 1.19, 1.28, 1.11, 1.01, 1.22,
    ];

    const totalWeight = dailyWeights.reduce((sum, weight) => sum + weight, 0);

    return Object.fromEntries(
        monthlySales.map((month) => {
            const values = dailyWeights.map((weight, index) => ({
                label: String(index + 1),
                value: Math.round((month.value * weight) / totalWeight),
            }));

            return [month.label, values];
        })
    ) as Record<string, ChartPoint[]>;
}


function createFallbackAnalyticsData(periodDays: number): AnalyticsData {
    const multiplier = periodDays / 30;

    const productRevenue: RevenueItem[] = [
        { name: "Balloons & Decor", value: Math.round(222800 * multiplier), color: "#7C3AED" },
        { name: "Party Furniture", value: Math.round(158300 * multiplier), color: "#F5A623" },
        { name: "Lighting & Effects", value: Math.round(117200 * multiplier), color: "#3B9EEA" },
        { name: "Tableware & Supplies", value: Math.round(88100 * multiplier), color: "#8CCB45" },
    ];

    const monthlySales: ChartPoint[] = [
        { label: "Jan", value: 320000 },
        { label: "Feb", value: 350000 },
        { label: "Mar", value: 280000 },
        { label: "Apr", value: 410000 },
        { label: "May", value: 435000 },
        { label: "Jun", value: 512300 },
    ];

    const packageRevenue: RevenueItem[] = [
        { name: "Wedding Package", value: Math.round(210000 * multiplier), color: "#7C3AED" },
        { name: "Birthday Package", value: Math.round(98000 * multiplier), color: "#F5A623" },
        { name: "Debut Package", value: Math.round(60000 * multiplier), color: "#3B9EEA" },
        { name: "Corporate Package", value: Math.round(38800 * multiplier), color: "#8CCB45" },
        { name: "Christening Package", value: Math.round(20000 * multiplier), color: "#EC5AA7" },
    ];

    return {
        periodDays,
        periodLabel: `Next ${periodDays} Days`,
        monthLabel: new Intl.DateTimeFormat("en-PH", {
            month: "long",
            year: "numeric",
        }).format(new Date()),
        generatedAt: new Date().toISOString(),
        salesGrowth: {
            value: 20,
            monthlyGrowth: [
                { label: "Jan", value: 12 },
                { label: "Feb", value: 5 },
                { label: "Mar", value: -8 },
                { label: "Apr", value: 15 },
                { label: "May", value: 10 },
                { label: "Jun", value: 20 },
            ],
        },
        salesTrend: {
            latestMonthlySales: monthlySales[monthlySales.length - 1].value,
            previousMonthSales: monthlySales[monthlySales.length - 2].value,
            monthlySales,
            dailySalesByMonth: createDailySalesByMonth(monthlySales),
        },
        peakBookings: {
            peakDay: "Saturday",
            peakTime: "2:00 PM – 5:00 PM",
            weekendPercentage: 63,
            weekdayPeak: "Friday",
            weekdayPeakTime: "4:00 PM – 7:00 PM",
            dailyBookings: [
                { label: "Mon", value: 34 },
                { label: "Tue", value: 38 },
                { label: "Wed", value: 36 },
                { label: "Thu", value: 40 },
                { label: "Fri", value: 57 },
                { label: "Sat", value: 92 },
                { label: "Sun", value: 65 },
            ],
        },
        productRevenue,
        packageRevenue,
    };
}

function peso(value: number) {
    return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 0,
    }).format(value);
}

function pesoShort(value: number) {
    if (value >= 1000000) return `₱${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `₱${Math.round(value / 1000)}K`;
    return peso(value);
}

function trendDetails(value: number) {
    if (value > 0) {
        return {
            label: "Increasing Trend",
            className: "text-[#5B21B6]",
            icon: TrendingUp,
        };
    }

    if (value < 0) {
        return {
            label: "Declining Trend",
            className: "text-[#C2410C]",
            icon: TrendingDown,
        };
    }

    return {
        label: "Stable Trend",
        className: "text-[#7A6E88]",
        icon: Minus,
    };
}

function total(items: RevenueItem[]) {
    return items.reduce((sum, item) => sum + item.value, 0);
}

function Card({
                  title,
                  children,
                  action,
                  className = "",
              }: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={`rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm ${className}`}
        >
            <div className="mb-3 flex items-start justify-between gap-3">
                <h2 className="flex items-center gap-1.5 text-[16px] font-bold text-[#1A1220]">
                    {title}
                    <Info size={14} className="text-[#A58DBF]" />
                </h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function GrowthBarChart({ data }: { data: ChartPoint[] }) {
    const maxAbsoluteValue = Math.max(...data.map((item) => Math.abs(item.value)), 1);

    return (
        <div className="relative mt-1 h-[182px] border-b border-[#EDE7F4]">
            <div className="absolute inset-x-0 top-[16%] border-t border-dashed border-[#ECE4F1]" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#D8CBE6]" />
            <div className="absolute inset-x-0 bottom-[16%] border-t border-dashed border-[#ECE4F1]" />

            <div className="absolute inset-0 flex">
                <div className="flex w-9 flex-col justify-between py-[7px] text-[10px] text-[#8A769C]">
                    <span>40%</span>
                    <span>20%</span>
                    <span>0%</span>
                    <span>-20%</span>
                    <span>-40%</span>
                </div>

                <div className="relative ml-1 flex flex-1 items-stretch justify-around">
                    {data.map((item) => {
                        const height = Math.max((Math.abs(item.value) / maxAbsoluteValue) * 43, 5);
                        const positive = item.value >= 0;

                        return (
                            <div key={item.label} className="relative h-full flex-1">
                                <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-[#D8CBE6]" />
                                <div
                                    className={`absolute left-1/2 w-4 -translate-x-1/2 rounded-t-sm ${
                                        positive ? "bg-[#7B3FE4]" : "rounded-b-sm bg-[#9A6BCC]"
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
                                <span
                                    className={`absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#553273] ${
                                        positive ? "" : ""
                                    }`}
                                    style={positive ? { bottom: `calc(50% + ${height}% + 5px)` } : { top: `calc(50% + ${height}% + 5px)` }}
                                >
                                    {item.value}%
                                </span>
                                <span className="absolute bottom-[-23px] left-1/2 -translate-x-1/2 text-[10px] font-medium text-[#806D91]">
                                    {item.label}
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
                        }: {
    data: ChartPoint[];
    ariaLabel: string;
}) {
    if (data.length === 0) {
        return (
            <div className="flex h-[190px] items-center justify-center text-sm text-[#806D91]">
                No sales data is available for this selection.
            </div>
        );
    }

    const values = data.map((item) => item.value);
    const highest = Math.max(...values, 1);
    const lowest = Math.min(...values, 0);
    const padding = Math.max((highest - lowest) * 0.12, 50000);
    const graphMin = Math.max(0, lowest - padding);
    const graphMax = highest + padding;
    const graphRange = graphMax - graphMin || 1;

    const leftPadding = 54;
    const rightPadding = 554;
    const plot = data.map((item, index) => {
        const x =
            leftPadding +
            (index * (rightPadding - leftPadding)) / Math.max(data.length - 1, 1);
        const y = 136 - ((item.value - graphMin) / graphRange) * 102;

        return { ...item, x, y };
    });

    const linePoints = plot.map((point) => `${point.x},${point.y}`).join(" ");
    const fillPoints = `${leftPadding},142 ${linePoints} ${rightPadding},142`;
    const showEvery = data.length > 10 ? 5 : 1;

    return (
        <div className="overflow-x-auto">
            <svg
                viewBox="0 0 590 182"
                className="h-[190px] min-w-[560px] w-full font-sans"
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

                {[graphMax, graphMin + (graphRange * 2) / 3, graphMin + graphRange / 3, graphMin].map(
                    (value, index) => (
                        <text
                            key={index}
                            x="0"
                            y={[38, 72, 106, 140][index]}
                            fontSize="10"
                            fill="#8A769C"
                        >
                            {pesoShort(value)}
                        </text>
                    )
                )}

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
                    const isDailyView = data.length > 10;
                    const showLabel =
                        index === 0 ||
                        index === plot.length - 1 ||
                        index % showEvery === 0;

                    return (
                        <g key={`${point.label}-${index}`}>
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r={isDailyView ? "2.2" : "4.5"}
                                fill="#7B3FE4"
                                stroke={isDailyView ? "none" : "#ffffff"}
                                strokeWidth={isDailyView ? "0" : "1.6"}
                            />

                            {showLabel && (
                                <>
                                    {!isDailyView && (
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
                                    <text
                                        x={point.x}
                                        y="166"
                                        textAnchor="middle"
                                        fontSize="10"
                                        fill="#806D91"
                                    >
                                        {point.label}
                                    </text>
                                </>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}
function BookingBars({ data }: { data: ChartPoint[] }) {
    const highest = Math.max(...data.map((item) => item.value), 1);

    return (
        <div className="mt-3 h-[142px]">
            <div className="flex h-full items-end gap-4 border-b border-[#EDE7F4] px-4">
                {data.map((item) => {
                    const height = Math.max((item.value / highest) * 100, 7);

                    return (
                        <div key={item.label} className="flex h-full flex-1 flex-col items-center justify-end">
                            <span className="mb-1 text-[10px] font-semibold text-[#8C6A33]">{item.value}%</span>
                            <div
                                className="w-full max-w-9 rounded-t-md bg-[#F4A52B]"
                                style={{ height: `${height}%` }}
                            />
                            <span className="mt-2 text-[10px] font-medium text-[#806D91]">{item.label}</span>
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
                    }: {
    items: RevenueItem[];
    totalLabel: string;
    centerLabel: string;
}) {
    const overallTotal = total(items);

    const background = useMemo(() => {
        let offset = 0;
        const segments = items.map((item) => {
            const percentage = overallTotal > 0 ? (item.value / overallTotal) * 100 : 0;
            const start = offset;
            offset += percentage;
            return `${item.color} ${start}% ${offset}%`;
        });

        return `conic-gradient(${segments.join(", ")})`;
    }, [items, overallTotal]);

    return (
        <div
            className="relative flex h-[156px] w-[156px] shrink-0 items-center justify-center rounded-full"
            style={{ background }}
            aria-label={centerLabel}
        >
            <div className="flex h-[99px] w-[99px] flex-col items-center justify-center rounded-full bg-white px-2 text-center">
                <p className="text-[18px] font-bold leading-tight text-[#281448]">{totalLabel}</p>
                <p className="mt-1 text-[10px] leading-tight text-[#806D91]">{centerLabel}</p>
            </div>
        </div>
    );
}

function RevenueLegend({ items }: { items: RevenueItem[] }) {
    const overallTotal = total(items);

    return (
        <div className="min-w-0 flex-1">
            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 text-[9px] font-semibold uppercase tracking-wide text-[#9A86AC]">
                <span>Category</span>
                <span>Revenue</span>
                <span>%</span>
            </div>

            <div className="space-y-2">
                {items.map((item) => {
                    const percentage = overallTotal > 0 ? Math.round((item.value / overallTotal) * 100) : 0;

                    return (
                        <div
                            key={item.name}
                            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-[11px]"
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                />
                                <span className="truncate font-medium text-[#4D2A74]">{item.name}</span>
                            </div>
                            <span className="font-medium text-[#5F4A73]">{peso(item.value)}</span>
                            <span className="font-medium text-[#5F4A73]">{percentage}%</span>
                        </div>
                    );
                })}
            </div>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-t border-[#EEE8F3] pt-2 text-[11px] font-semibold text-[#4D2A74]">
                <span>Total</span>
                <span>{peso(overallTotal)}</span>
                <span>100%</span>
            </div>
        </div>
    );
}

function AnalyticsShell({ children }: { children: ReactNode }) {
    return (
        <RequirePermission>
            <div
                className="flex min-h-screen overflow-x-hidden font-sans text-[#1A1220]"
                style={{ backgroundColor: "#FDFAF4" }}
            >
                <RoleSidebar />
                <div className="min-w-0 flex-1 overflow-x-hidden font-sans">
                    {children}
                </div>
            </div>
        </RequirePermission>
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
    const selectedBranch =
        branches.find((branch) => branch.id === selectedBranchId) ?? null;

    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const selectorRef = useRef<HTMLDivElement>(null);

    const matchingBranches = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();

        if (!normalizedQuery) {
            return branches;
        }

        return branches.filter((branch) =>
            branch.name.toLowerCase().includes(normalizedQuery)
        );
    }, [branches, query]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (
                selectorRef.current &&
                !selectorRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
                setQuery("");
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, []);

    const inputValue = isOpen
        ? query
        : selectedBranch?.name || "All Branches";

    return (
        <div ref={selectorRef} className="relative w-full lg:w-[320px]">
            <div className="relative">
                <Search
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#806A8C]"
                />

                <input
                    value={inputValue}
                    disabled={loading}
                    onFocus={() => {
                        setIsOpen(true);
                        setQuery("");
                    }}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setIsOpen(true);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            setIsOpen(false);
                            setQuery("");
                            event.currentTarget.blur();
                        }
                    }}
                    placeholder={
                        loading
                            ? "Loading branches..."
                            : "Search or select branch..."
                    }
                    aria-label="Search or select analytics branch"
                    aria-expanded={isOpen}
                    aria-haspopup="listbox"
                    className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-white px-10 pr-10 text-sm font-semibold text-[#1A1220] outline-none shadow-sm transition placeholder:font-normal placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:cursor-not-allowed disabled:opacity-60"
                />

                <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                        setIsOpen((open) => !open);
                        setQuery("");
                    }}
                    aria-label="Show analytics branch choices"
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <ChevronDown
                        size={16}
                        className={
                            isOpen
                                ? "rotate-180 transition-transform"
                                : "transition-transform"
                        }
                    />
                </button>
            </div>

            {isOpen && !loading && (
                <div
                    role="listbox"
                    className="absolute z-30 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-lg"
                >
                    <button
                        type="button"
                        role="option"
                        aria-selected={selectedBranchId === null}
                        onClick={() => {
                            onSelectBranch(null);
                            setIsOpen(false);
                            setQuery("");
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                            selectedBranchId === null
                                ? "bg-[#F0EAFE] font-semibold text-[#2B174C]"
                                : "text-[#1A1220] hover:bg-[#F7F1FF]"
                        }`}
                    >
                        <span>All Branches</span>
                        {selectedBranchId === null && (
                            <Check size={15} className="shrink-0" />
                        )}
                    </button>

                    {matchingBranches.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-[#7A6A84]">
                            No matching branch found.
                        </p>
                    ) : (
                        matchingBranches.map((branch) => {
                            const isSelected = branch.id === selectedBranchId;

                            return (
                                <button
                                    key={branch.id}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => {
                                        onSelectBranch(branch.id);
                                        setIsOpen(false);
                                        setQuery("");
                                    }}
                                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                                        isSelected
                                            ? "bg-[#F0EAFE] font-semibold text-[#2B174C]"
                                            : "text-[#1A1220] hover:bg-[#F7F1FF]"
                                    }`}
                                >
                                    <span className="truncate">{branch.name}</span>
                                    {isSelected && (
                                        <Check size={15} className="shrink-0" />
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

export type AnalyticsRole = "owner" | "manager" | "staff";

export type AnalyticsBranch = {
    id: number;
    name: string;
};

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
    const period = "30";
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [salesView, setSalesView] = useState<"month" | "day">("month");
    const [selectedSalesMonth, setSelectedSalesMonth] = useState("Jun");
    const [data, setData] = useState<AnalyticsData>(() => createFallbackAnalyticsData(30));
    const [loading, setLoading] = useState(false);

    const isOwner = role === "owner";
    const [selectedOwnerBranchId, setSelectedOwnerBranchId] =
        useState<number | null>(null);

    const selectedOwnerBranch = useMemo(
        () =>
            ownerBranches.find(
                (branch) => branch.id === selectedOwnerBranchId
            ) ?? null,
        [ownerBranches, selectedOwnerBranchId]
    );

    const loadAnalytics = useCallback(async () => {
        const selectedPeriod = Number(period) || 30;

        try {
            setLoading(true);

            const params = new URLSearchParams({
                period: String(selectedPeriod),
            });

            if (isOwner && selectedOwnerBranchId !== null) {
                params.set("branch_id", String(selectedOwnerBranchId));
            }

            const response = await fetch(`/api/analytics?${params.toString()}`, {
                cache: "no-store",
            });

            if (!response.ok) {
                throw new Error("Analytics API is not available yet.");
            }

            const result = (await response.json()) as AnalyticsData;
            setData(result);
        } catch (caughtError) {
            // Keep the complete Analytics dashboard visible while the API is
            // unavailable. The same structure will automatically use live
            // data when the route is ready.
            console.warn("Using Analytics fallback data:", caughtError);
            setData(createFallbackAnalyticsData(selectedPeriod));
        } finally {
            setLoading(false);
        }
    }, [isOwner, period, selectedOwnerBranchId]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();

        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        void loadAnalytics();
    }, [loadAnalytics]);

    const growth = trendDetails(data.salesGrowth.value);
    const GrowthIcon = growth.icon;
    const latestSalesGrowth =
        data.salesTrend.previousMonthSales > 0
            ? Math.round(
                ((data.salesTrend.latestMonthlySales - data.salesTrend.previousMonthSales) /
                    data.salesTrend.previousMonthSales) *
                100
            )
            : 0;

    const availableSalesMonths = data.salesTrend.monthlySales.map((item) => item.label);
    const resolvedSalesMonth = availableSalesMonths.includes(selectedSalesMonth)
        ? selectedSalesMonth
        : availableSalesMonths[availableSalesMonths.length - 1] || "";

    const dailySales = data.salesTrend.dailySalesByMonth[resolvedSalesMonth] || [];
    const activeSalesData =
        salesView === "day" ? dailySales : data.salesTrend.monthlySales;
    const activeSalesTotal =
        salesView === "day"
            ? dailySales.reduce((sum, item) => sum + item.value, 0)
            : data.salesTrend.latestMonthlySales;

    const scopeLabel = isOwner
        ? selectedOwnerBranch?.name || "All Branches"
        : assignedBranch || "Assigned Branch";

    const scopeDescription = isOwner
        ? selectedOwnerBranch
            ? `Business performance for ${selectedOwnerBranch.name} from inventory sales and booking activity.`
            : "Overall business performance from inventory sales and booking activity across all branches."
        : `Business performance for ${scopeLabel} from inventory sales and booking activity.`;

    return (
        <AnalyticsShell>
            <main className="min-h-screen bg-[#FDFAF4]">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <div className="flex items-center">
                            <h1 className="text-[25px] font-bold text-[#1A1220]">
                                Analytics
                            </h1>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime
                                    ? formatCurrentDateTime(currentDateTime)
                                    : "Loading date..."}
                            </span>

                            <button
                                type="button"
                                onClick={loadAnalytics}
                                disabled={loading}
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                                Refresh
                            </button>
                        </div>
                    </div>
                </header>

                <div className="space-y-3 px-6 py-4">
                    {isOwner && (
                        <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="flex min-w-0 items-start gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                                        <Building2 size={18} />
                                    </div>

                                    <div>
                                        <h2 className="text-[16px] font-bold text-[#1A1220]">
                                            Analytics Scope
                                        </h2>
                                        <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                                            All Branches is the default. Search or select a branch to view its analytics.
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

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-[#7A6A84]">
                            {scopeDescription}
                        </p>
                        <p className="text-xs text-[#806A8C]">
                            Updated {new Date(data.generatedAt).toLocaleTimeString("en-PH", {
                            hour: "2-digit",
                            minute: "2-digit",
                        })}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <Card title="Sales Growth">
                            <div className="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
                                <div className="border-b border-[#EEE8F3] pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4">
                                    <p className="text-[11px] text-[#806D91]">Current Growth</p>
                                    <p className="mt-2 text-[28px] font-bold tracking-tight text-[#7B3FE4]">
                                        {data.salesGrowth.value > 0 ? "+" : ""}
                                        {data.salesGrowth.value}%
                                    </p>
                                    <div className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${growth.className}`}>
                                        <GrowthIcon size={16} />
                                        {growth.label}
                                    </div>

                                    <div className="mt-5 border-t border-[#EEE8F3] pt-3">
                                        <p className="text-[10px] font-semibold text-[#806D91]">Trend Guide</p>
                                        <div className="mt-2 space-y-1.5 text-[10px] text-[#6F5A82]">
                                            <p><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#7B3FE4]" />Sales Growth: 20% — Increasing Trend</p>
                                            <p><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#F4A52B]" />Sales Growth: 0% — Stable Trend</p>
                                            <p><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#E95858]" />Sales Growth: -12% — Declining Trend</p>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <p className="mb-1 text-center text-[10px] font-medium text-[#806D91]">
                                        Sales Growth <span className="text-[#A38FB4]">(vs Previous Month)</span>
                                    </p>
                                    <GrowthBarChart data={data.salesGrowth.monthlyGrowth} />
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="Sales Trend"
                            action={
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <div className="flex rounded-xl border border-[#E6DDF0] bg-white p-1 text-xs font-semibold shadow-sm">
                                        <button
                                            type="button"
                                            onClick={() => setSalesView("month")}
                                            className={`rounded-md px-2.5 py-1.5 transition ${
                                                salesView === "month"
                                                    ? "bg-[#2D1B4E] text-white"
                                                    : "text-[#765D8B] hover:bg-[#F0E9F8]"
                                            }`}
                                        >
                                            By Month
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
                                            By Day
                                        </button>
                                    </div>

                                    {salesView === "day" && (
                                        <select
                                            value={resolvedSalesMonth}
                                            onChange={(event) =>
                                                setSelectedSalesMonth(event.target.value)
                                            }
                                            className="rounded-xl border border-[#E6DDF0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#2B174C] outline-none shadow-sm"
                                            aria-label="Select month for daily sales chart"
                                        >
                                            {availableSalesMonths.map((month) => (
                                                <option key={month} value={month}>
                                                    {month}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            }
                        >
                            <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
                                <p className="text-[11px] text-[#806D91]">
                                    {salesView === "month"
                                        ? "Monthly Sales (₱)"
                                        : `Daily Sales (₱) — ${resolvedSalesMonth}`}
                                </p>

                                <div className="text-right">
                                    <p className="text-[10px] text-[#806D91]">
                                        {salesView === "month"
                                            ? "Latest Monthly Sales"
                                            : `${resolvedSalesMonth} Total Sales`}
                                    </p>
                                    <p className="text-[19px] font-bold text-[#7B3FE4]">
                                        {peso(activeSalesTotal)}
                                    </p>
                                    {salesView === "month" && (
                                        <p className="text-[10px] font-semibold text-emerald-700">
                                            ▲ {latestSalesGrowth}% vs previous month
                                        </p>
                                    )}
                                </div>
                            </div>

                            <SalesLineChart
                                data={activeSalesData}
                                ariaLabel={
                                    salesView === "month"
                                        ? "Monthly sales trend"
                                        : `Daily sales trend for ${resolvedSalesMonth}`
                                }
                            />
                        </Card>
                    </div>

                    <Card title="Peak Bookings">
                        <div className="grid divide-y divide-[#EEE8F3] rounded-xl border border-[#E8DDF4] md:grid-cols-4 md:divide-x md:divide-y-0">
                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]">
                                    <CalendarDays size={20} />
                                </span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Peak Day</p>
                                    <p className="text-[16px] font-bold text-[#6B2AC6]">{data.peakBookings.peakDay}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]">
                                    <Clock3 size={20} />
                                </span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Peak Time</p>
                                    <p className="text-[16px] font-bold text-[#6B2AC6]">{data.peakBookings.peakTime}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]">
                                    <UsersRound size={20} />
                                </span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Weekend Peak</p>
                                    <p className="text-[16px] font-bold text-[#6B2AC6]">{data.peakBookings.weekendPercentage}%</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-3.5">
                                <span className="rounded-full bg-[#F1E9FE] p-2.5 text-[#7B3FE4]">
                                    <BarChart3 size={20} />
                                </span>
                                <div>
                                    <p className="text-[10px] text-[#806D91]">Weekday Peak</p>
                                    <p className="text-[16px] font-bold text-[#6B2AC6]">{data.peakBookings.weekdayPeak}</p>
                                    <p className="text-[9px] text-[#806D91]">{data.peakBookings.weekdayPeakTime}</p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
                            <div>
                                <p className="text-[11px] text-[#806D91]">Bookings by Day</p>
                                <BookingBars data={data.peakBookings.dailyBookings} />
                            </div>

                            <div className="flex gap-3 rounded-xl border border-[#F0DFC1] bg-[#FFFDF8] p-4">
                                <span className="h-fit rounded-full bg-[#FFF0CB] p-2.5 text-[#C88812]">
                                    <Lightbulb size={18} />
                                </span>
                                <div>
                                    <p className="text-xs font-semibold text-[#7A4B09]">Insights</p>
                                    <p className="mt-1 text-[11px] leading-5 text-[#806D91]">
                                        Saturdays have the highest booking volume. Consider allocating more
                                        resources during peak hours on weekends.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </Card>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <Card title="Product Revenue Analytics">
                            <div className="grid items-center gap-4 sm:grid-cols-[166px_minmax(0,1fr)]">
                                <DonutChart
                                    items={data.productRevenue}
                                    totalLabel={peso(total(data.productRevenue))}
                                    centerLabel="Total Revenue This Month"
                                />
                                <RevenueLegend items={data.productRevenue} />
                            </div>
                        </Card>

                        <Card
                            title="Package Revenue Analytics"
                            action={
                                <span className="rounded-xl border border-[#E6DDF0] bg-white px-3 py-1.5 text-xs font-medium text-[#2B174C] shadow-sm">
                                    {data.periodLabel}
                                </span>
                            }
                        >
                            <div className="grid items-center gap-4 sm:grid-cols-[166px_minmax(0,1fr)]">
                                <DonutChart
                                    items={data.packageRevenue}
                                    totalLabel={peso(total(data.packageRevenue))}
                                    centerLabel="Total Forecasted Revenue"
                                />
                                <RevenueLegend items={data.packageRevenue} />
                            </div>
                        </Card>
                    </div>
                </div>
            </main>
        </AnalyticsShell>
    );
}
