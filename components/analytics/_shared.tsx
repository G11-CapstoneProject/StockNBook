
"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";

import {
    BarChart3,
    CalendarDays,
    Package,
    TrendingUp,
    Building2,
    ShoppingBag,
    RefreshCw,
    AlertCircle,
} from "lucide-react";

/* -------------------------------------------------------
 * TYPES
 * ------------------------------------------------------- */

export type AnalyticsRole = "owner" | "manager" | "staff";

export type AnalyticsBranch = {
    id: number;
    name: string;
};


type Change = {
    percentage: number | null;
    direction: string;
    label: string;
    explanation?: string;
};

type MonthlyPoint = {
    key: string;
    label: string;
    value: number;
};

type DemandItem = {
    key: string;
    name: string;
    category: string;
    units: number;
    change: Change;
};

type AnalyticsData = {
    success: boolean;
    version: number;
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
        label: string;
        startDate: string;
        endDate: string;
        previousStartDate: string;
        previousEndDate: string;
        previousYearStartDate: string;
        previousYearEndDate: string;
    };

    sales: {
        totalSales: number;
        previousSales: number;
        previousYearSales: number;
        orderCount: number;
        periodChange: Change;
        yearOverYearChange: Change;
        monthlySales: MonthlyPoint[];
        monthlyPreviousYear: MonthlyPoint[];
    };

    products: {
        totalUnits: number;
        categories: {
            name: string;
            units: number;
            change: Change;
        }[];
        products: DemandItem[];
        hourlyDemand: {
            hour: number;
            label: string;
            units: number;
        }[];
        monthlyDemand: MonthlyPoint[];
        highestDemandProducts: DemandItem[];
        lowestDemandProducts: DemandItem[];
    };

    bookings: {
        totalBookings: number;
        change: Change;
        monthlyBookings: MonthlyPoint[];
        bookingTypes: {
            name: string;
            count: number;
        }[];
        bookedItems: {
            name: string;
            units: number;
        }[];
        totalBookedItemUnits: number;
    };

    rentals: {
        bookingCount: number;
        bookedUnits: number;
        releasedUnits: number;
        returnedUnits: number;
        damagedUnits: number;
        missingUnits: number;
        returnRecords: number;
        topEquipment: {name: string; units: number}[];
        monthlyBookedUnits: MonthlyPoint[];
    };

    packages: {
        totalPackageBookings: number;
        packages: {
            name: string;
            bookings: number;
            change: Change;
        }[];
        monthlyPackageBookings: MonthlyPoint[];
        highestDemandPackages: {
            name: string;
            bookings: number;
            change: Change;
        }[];
        lowestDemandPackages: {
            name: string;
            bookings: number;
            change: Change;
        }[];
    };

    branches: {
        branches: {
            branchId: number;
            branchName: string;
            totalSales: number;
            monthlySales: MonthlyPoint[];
        }[];
    } | null;

    insights: {
        section: string;
        message: string;
    }[];
};

/* -------------------------------------------------------
 * FORMATTING HELPERS
 * ------------------------------------------------------- */

const money = (value: number) =>
    new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 0,
    }).format(value || 0);

const number = (value: number) =>
    new Intl.NumberFormat("en-PH", {
        maximumFractionDigits: 0,
    }).format(value || 0);

function getChangeLabel(change?: Change | null) {
    if (!change) return "N/A";
    return change.label || "N/A";
}

function getToken() {
    if (typeof window === "undefined") return "";

    return (
        sessionStorage.getItem("token") ||
        localStorage.getItem("token") ||
        ""
    );
}

function getLastCompleteMonths(count: number) {
    const now = new Date();

    const start = new Date(
        Date.UTC(
            now.getFullYear(),
            now.getMonth() - count,
            1
        )
    );

    const end = new Date(
        Date.UTC(
            now.getFullYear(),
            now.getMonth(),
            0
        )
    );

    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
    };
}

/* -------------------------------------------------------
 * SHARED UI
 * ------------------------------------------------------- */

const PANEL =
    "rounded-2xl border border-[#E8E0EE] !bg-white " +
    "!text-[#302044] p-5 shadow-sm";

const SELECT =
    "mt-1 block w-full rounded-lg border border-[#DDD2E8] " +
    "!bg-white px-3 py-2 text-sm !text-[#392650] " +
    "outline-none focus:border-[#9274BC]";

function Section({
                     title,
                     description,
                     icon,
                     children,
                 }: {
    title: string;
    description: string;
    icon: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className={PANEL}>
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-xl bg-[#F4EEF9] p-2.5 text-[#7852A5]">
                    {icon}
                </div>

                <div>
                    <h2 className="text-base font-bold text-[#302044]">
                        {title}
                    </h2>

                    <p className="mt-1 text-xs leading-5 text-[#81718D]">
                        {description}
                    </p>
                </div>
            </div>

            {children}
        </section>
    );
}

function Metric({
                    label,
                    value,
                    subtitle,
                }: {
    label: string;
    value: string;
    subtitle?: string;
}) {
    return (
        <div className="rounded-xl border border-[#EEE7F4] !bg-[#FCFAFD] !text-[#302044] p-4">
            <p className="text-xs text-[#81718D]">
                {label}
            </p>

            <p className="mt-2 text-xl font-bold text-[#38244D]">
                {value}
            </p>

            {subtitle && (
                <p className="mt-1 text-xs text-[#887994]">
                    {subtitle}
                </p>
            )}
        </div>
    );
}

function EmptyState({
                        message = "No qualifying records in this reporting period.",
                    }: {
    message?: string;
}) {
    return (
        <div className="rounded-xl border border-dashed border-[#E4DAED] p-6 text-center text-sm text-[#897995]">
            {message}
        </div>
    );
}

/* -------------------------------------------------------
 * CHARTS
 * ------------------------------------------------------- */

function LineChart({
                       points,
                       previousPoints,
                       isMoney = false,
                   }: {
    points: MonthlyPoint[];
    previousPoints?: MonthlyPoint[];
    isMoney?: boolean;
}) {
    if (!points.length) {
        return <EmptyState />;
    }

    const width = 720;
    const height = 230;

    const left = 52;
    const right = 18;
    const top = 18;
    const bottom = 45;

    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;

    const values = [
        ...points.map((p) => p.value),
        ...(previousPoints || []).map((p) => p.value),
    ];

    const maximum = Math.max(1, ...values);

    const x = (index: number) =>
        left +
        (index * chartWidth) /
        Math.max(1, points.length - 1);

    const y = (value: number) =>
        top +
        chartHeight -
        (Math.max(0, value) / maximum) * chartHeight;

    const path = (series: MonthlyPoint[]) =>
        series
            .map(
                (point, index) =>
                    `${index === 0 ? "M" : "L"} ` +
                    `${x(index)} ${y(point.value)}`
            )
            .join(" ");

    const formatValue = (value: number) =>
        isMoney ? money(value) : number(value);

    return (
        <div>
            <div className="overflow-x-auto">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="min-w-[500px] w-full"
                    role="img"
                    aria-label="Monthly historical trend chart"
                >
                    {[0, 0.5, 1].map((step) => (
                        <g key={step}>
                            <line
                                x1={left}
                                x2={width - right}
                                y1={y(maximum * step)}
                                y2={y(maximum * step)}
                                stroke="#EEE8F3"
                                strokeDasharray="4 4"
                            />

                            <text
                                x={left - 8}
                                y={y(maximum * step) + 4}
                                textAnchor="end"
                                fontSize="10"
                                fill="#8A7B96"
                            >
                                {isMoney
                                    ? number(maximum * step)
                                    : number(maximum * step)}
                            </text>
                        </g>
                    ))}

                    {previousPoints &&
                        previousPoints.length === points.length && (
                            <path
                                d={path(previousPoints)}
                                fill="none"
                                stroke="#C9A46B"
                                strokeWidth="2.5"
                                strokeDasharray="6 5"
                                strokeLinejoin="round"
                            />
                        )}

                    <path
                        d={path(points)}
                        fill="none"
                        stroke="#8058AD"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />

                    {points.map((point, index) => (
                        <g key={point.key}>
                            <circle
                                cx={x(index)}
                                cy={y(point.value)}
                                r="4"
                                fill="#8058AD"
                            >
                                <title>
                                    {point.label}: {formatValue(point.value)}
                                </title>
                            </circle>

                            <text
                                x={x(index)}
                                y={height - 12}
                                textAnchor="middle"
                                fontSize="10"
                                fill="#81718D"
                            >
                                {points.length <= 12 ||
                                index % Math.ceil(points.length / 12) === 0
                                    ? point.label
                                    : ""}
                            </text>
                        </g>
                    ))}
                </svg>
            </div>

            <div className="mt-2 flex flex-wrap gap-5 text-xs text-[#81718D]">
                <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#8058AD]" />
                    Selected period
                </span>

                {previousPoints && (
                    <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-[#C9A46B]" />
                        Same period last year
                    </span>
                )}
            </div>
        </div>
    );
}

function HorizontalBars({
                            items,
                            unit = "",
                        }: {
    items: { name: string; value: number }[];
    unit?: string;
}) {
    if (!items.length) {
        return <EmptyState />;
    }

    const maximum = Math.max(
        1,
        ...items.map((item) => item.value)
    );


    return (
        <div className="space-y-3">
            {items.map((item, index) => (
                <div key={`${item.name}-${index}`}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span
                        title={item.name}
                        className="min-w-0 truncate !text-[#5A486C]"
                    >
                        {item.name}
                    </span>

                        <span className="shrink-0 font-semibold !text-[#38244D]">
                        {unit === "PHP"
                            ? money(item.value)
                            : `${number(item.value)} ${unit}`}
                    </span>
                    </div>

                    <div className="h-3 overflow-hidden rounded-full !bg-[#F0EAF5]">
                        <div
                            className="h-full rounded-full !bg-[#8464B5]"
                            style={{
                                width: `${
                                    (Math.max(0, item.value) / maximum) * 100
                                }%`,
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );

}

function SectionInsight({
                            message,
                        }: {
    message?: string;
}) {
    if (!message) return null;

    return (
        <p className="mt-4 border-t border-[#EEE8F3] pt-3 text-xs leading-5 text-[#6E5A80]">
            <span className="font-semibold">Historical insight: </span>
            {message}
        </p>
    );
}

/* -------------------------------------------------------
 * HISTORICAL PRODUCT DEMAND MOVEMENT
 * ------------------------------------------------------- */

function DemandMovement({
                            items,
                            valueLabel = "units",
                        }: {
    items: { name: string; units: number; change: Change }[];
    valueLabel?: string;
}) {
    if (!items.length) return <EmptyState />;

    return (
        <div className="space-y-2">
            {items.map((item, index) => (
                <div
                    key={`${item.name}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#EEE7F4] bg-[#FCFAFD] px-3 py-2 text-xs"
                >
                    <span className="min-w-0 flex-1 font-medium text-[#49365C]" title={item.name}>
                        {item.name}
                    </span>
                    <span className="text-[#81718D]">
                        {number(item.units)} {valueLabel}
                    </span>
                    <span className="min-w-[100px] text-right font-semibold text-[#7651A5]">
                        {item.change?.direction === "new-activity"
                            ? "New activity"
                            : item.change?.direction === "no-activity"
                                ? "No activity"
                                : item.change?.percentage === null || item.change?.percentage === undefined
                                    ? "N/A"
                                    : item.change.percentage > 0
                                        ? `+${item.change.percentage}%`
                                        : `${item.change.percentage}%`}
                    </span>
                </div>
            ))}
        </div>
    );
}

function summarizeMonths(points: MonthlyPoint[]) {
    if (!points.length) return null;
    const peak = Math.max(...points.map((point) => point.value));
    const low = Math.min(...points.map((point) => point.value));
    const peaks = points.filter((point) => point.value === peak).map((point) => point.label);
    const lows = points.filter((point) => point.value === low).map((point) => point.label);
    const latest = points[points.length - 1];
    const preceding = points.length > 1 ? points[points.length - 2] : null;
    const difference = preceding ? latest.value - preceding.value : null;
    const describe = (months: string[]) =>
        months.length === points.length ? "All displayed months are tied" :
            months.length > 3 ? `${months.length} months tied` : months.join(", ");
    return { peak, low, peakLabel: describe(peaks), lowLabel: describe(lows), latest, preceding, difference };
}

function HistoricalMonthlySummary({
                                      points, isMoney = false, label = "activity",
                                  }: {
    points: MonthlyPoint[];
    isMoney?: boolean;
    label?: string;
}) {
    const summary = summarizeMonths(points);
    if (!summary) return <EmptyState message="No months available for historical comparison." />;
    const format = (value: number) => isMoney ? money(value) : number(value);
    const movement = summary.difference === null
        ? "Not available"
        : `${summary.difference > 0 ? "+" : summary.difference < 0 ? "−" : ""}${format(Math.abs(summary.difference))}`;
    return (
        <div className="mt-5 space-y-2">
            <div className="grid gap-3 sm:grid-cols-3">
                <Metric label={`Highest monthly ${label}`} value={format(summary.peak)} subtitle={summary.peakLabel} />
                <Metric label={`Lowest monthly ${label}`} value={format(summary.low)} subtitle={summary.lowLabel} />
                <Metric label="Latest month vs preceding month" value={movement}
                        subtitle={summary.preceding ? `${summary.latest.label} vs ${summary.preceding.label}` : "At least two months required"} />
            </div>
            <p className="text-xs text-[#81718D]">These comparisons describe the selected historical months, not future predictions.</p>
        </div>
    );
}

/* -------------------------------------------------------
 * LOADING
 * ------------------------------------------------------- */

export function AnalyticsLoadingScreen() {
    return (
        <div className="bg-[#FDFAF4] p-6">
            <ModuleSkeleton variant="analytics" />
        </div>
    );
}

/* -------------------------------------------------------
 * MAIN ANALYTICS WORKSPACE
 * ------------------------------------------------------- */

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
    const isOwner = role === "owner";

    const [branchId, setBranchId] =
        useState<number | null>(null);

    const [period, setPeriod] = useState("12");

    const [data, setData] =
        useState<AnalyticsData | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadAnalytics = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const authToken = getToken();

            if (!authToken) {
                throw new Error(
                    "Authentication token missing. Sign in again."
                );
            }

            const dates = getLastCompleteMonths(
                Number(period)
            );

            const body: Record<string, string | number> = {
                action: "get_analytics_v2",
                start_date: dates.startDate,
                end_date: dates.endDate,
            };

            if (isOwner && branchId !== null) {
                body.branch_id = branchId;
            }

            const response = await fetch("/api/analytics", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify(body),
                cache: "no-store",
            });

            const payload = await response.json();

            if (
                !response.ok ||
                !payload.success ||
                payload.version !== 2
            ) {
                throw new Error(
                    payload.error ||
                    "Analytics service returned an invalid response."
                );
            }

            setData(payload as AnalyticsData);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load Analytics."
            );

            setData(null);
        } finally {
            setLoading(false);
        }
    }, [period, isOwner, branchId]);

    useEffect(() => {
        void loadAnalytics();
    }, [loadAnalytics]);

    useEffect(() => {
        window.addEventListener(
            "stocknbook-refresh-analytics",
            loadAnalytics
        );

        return () => {
            window.removeEventListener(
                "stocknbook-refresh-analytics",
                loadAnalytics
            );
        };
    }, [loadAnalytics]);

    const [categoryFilter, setCategoryFilter] =
        useState("All");

    const filteredProducts = useMemo(() => {
        if (!data) return [];

        return data.products.products.filter(
            (product) =>
                categoryFilter === "All" ||
                product.category === categoryFilter
        );
    }, [data, categoryFilter]);

    const categories = useMemo(() => {
        if (!data) return ["All"];

        return [
            "All",
            ...data.products.categories.map(
                (category) => category.name
            ),
        ];
    }, [data]);

    const packageTrend = useMemo(() => {
        const months = data?.packages.monthlyPackageBookings ?? [];
        const activeMonths = months.filter((month) => month.value > 0);
        const peak = activeMonths.length
            ? Math.max(...activeMonths.map((month) => month.value))
            : 0;
        const low = months.length
            ? Math.min(...months.map((month) => month.value))
            : 0;
        const peakMonths = months.filter((month) => month.value === peak && peak > 0);
        const lowMonths = months.filter((month) => month.value === low);
        const latest = months[months.length - 1];
        const prior = months[months.length - 2];
        const difference = latest && prior ? latest.value - prior.value : null;

        return { months, peak, low, peakMonths, lowMonths, latest, prior, difference };
    }, [data]);

    const sameComparisonPeriods = Boolean(
        data &&
        data.period.previousStartDate ===
        data.period.previousYearStartDate &&
        data.period.previousEndDate ===
        data.period.previousYearEndDate
    );

    const insightFor = (section: string) =>
        data?.insights.find(
            (insight) => insight.section === section
        )?.message;

    return (
        <div className="analytics-workspace space-y-5 text-[#302044]">

            {/* FILTERS */}

            <div className={PANEL}>
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h2 className="font-semibold text-[#38244D]">
                            Analytics Reporting
                        </h2>

                        <p className="mt-1 text-xs text-[#81718D]">
                            {isOwner
                                ? "Review all branches or select an individual branch."
                                : `Assigned branch: ${
                                    assignedBranch || "Current branch"
                                }`}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                        {isOwner && (
                            <label className="text-xs font-medium text-[#69577A]">
                                Branch

                                <select
                                    className={SELECT}
                                    value={branchId ?? ""}
                                    disabled={ownerBranchesLoading}
                                    onChange={(event) =>
                                        setBranchId(
                                            event.target.value
                                                ? Number(event.target.value)
                                                : null
                                        )
                                    }
                                >
                                    <option value="">
                                        All branches
                                    </option>

                                    {ownerBranches.map((branch) => (
                                        <option
                                            key={branch.id}
                                            value={branch.id}
                                        >
                                            {branch.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}

                        <label className="text-xs font-medium text-[#69577A]">
                            Reporting period

                            <select
                                className={SELECT}
                                value={period}
                                onChange={(event) =>
                                    setPeriod(event.target.value)
                                }
                            >
                                <option value="3">
                                    Last 3 complete months
                                </option>

                                <option value="6">
                                    Last 6 complete months
                                </option>

                                <option value="12">
                                    Last 12 complete months
                                </option>
                            </select>
                        </label>

                        <button
                            type="button"
                            onClick={() => void loadAnalytics()}
                            disabled={loading}
                            className="flex h-10 items-center gap-2 rounded-lg bg-[#7651A5] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            <RefreshCw
                                size={15}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </div>

                {data && (
                    <p className="mt-3 text-xs text-[#81718D]">
                        {data.period.label} ·{" "}
                        {data.scope.branchName}
                    </p>
                )}
            </div>

            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
                >
                    <AlertCircle size={18} />
                    {error}
                </div>
            )}

            {loading && <AnalyticsLoadingScreen />}

            {!loading && data && (
                <>
                    {!data.hasData && (
                        <EmptyState message="No qualifying sales or accepted bookings in the selected period." />
                    )}

                    {/* SECTION 1: SALES PERFORMANCE */}

                    <Section
                        title="1. Sales Performance & Trends"
                        description="Historical POS sales, monthly movement, period changes, and year-over-year comparisons."
                        icon={<TrendingUp size={19} />}
                    >
                        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <Metric
                                label="Total sales"
                                value={money(data.sales.totalSales)}
                            />

                            <Metric
                                label="Completed orders"
                                value={number(data.sales.orderCount)}
                            />


                            {!sameComparisonPeriods && (
                                <Metric
                                    label="vs previous equivalent period"
                                    value={getChangeLabel(
                                        data.sales.periodChange
                                    )}
                                    subtitle={
                                        data.sales.periodChange.explanation
                                    }
                                />
                            )}

                            <Metric
                                label="Year-over-Year Sales Change"
                                value={getChangeLabel(
                                    data.sales.yearOverYearChange
                                )}
                                subtitle={
                                    data.sales.yearOverYearChange.explanation
                                }
                            />

                        </div>

                        <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                            Monthly Sales Performance
                        </h3>

                        <LineChart
                            points={data.sales.monthlySales}
                            previousPoints={
                                data.sales.monthlyPreviousYear
                            }
                            isMoney
                        />

                        <HistoricalMonthlySummary points={data.sales.monthlySales} isMoney label="sales" />
                        <p className="mt-3 text-xs text-[#81718D]">
                            Previous-period and year-over-year percentage changes require qualifying sales in the comparison period.
                            An N/A value is not a 0% change.
                        </p>

                        <SectionInsight
                            message={insightFor("sales")}
                        />
                    </Section>

                    {/* SECTION 2: PRODUCT DEMAND */}

                    <Section
                        title="2. Product & Category Demand"
                        description="Which products and categories customers purchase most, and when purchasing activity occurs."
                        icon={<ShoppingBag size={19} />}
                    >
                        <div className="mb-5 grid gap-3 sm:grid-cols-2">
                            <Metric
                                label="Total units sold"
                                value={number(
                                    data.products.totalUnits
                                )}
                            />

                            <Metric
                                label="Products with recorded sales"
                                value={number(
                                    data.products.products.length
                                )}
                            />
                        </div>

                        <div className="grid gap-6 xl:grid-cols-2">
                            <div>
                                <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                    Monthly Unit Demand
                                </h3>

                                <LineChart
                                    points={
                                        data.products.monthlyDemand
                                    }
                                />
                            </div>

                            <div>
                                <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                    Category Demand
                                </h3>

                                <HorizontalBars
                                    items={data.products.categories
                                        .slice(0, 8)
                                        .map((item) => ({
                                            name: item.name,
                                            value: item.units,
                                        }))}
                                    unit="units"
                                />
                            </div>
                        </div>

                        <div className="mt-6 border-t border-[#EEE8F3] pt-5">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                <h3 className="text-sm font-semibold text-[#49365C]">
                                    Product Demand Ranking
                                </h3>

                                <label className="text-xs text-[#81718D]">
                                    Category filter

                                    <select
                                        className={SELECT}
                                        value={categoryFilter}
                                        onChange={(event) =>
                                            setCategoryFilter(
                                                event.target.value
                                            )
                                        }
                                    >
                                        {categories.map((category) => (
                                            <option
                                                key={category}
                                                value={category}
                                            >
                                                {category}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <div className="grid gap-5 lg:grid-cols-2">
                                <div>
                                    <p className="mb-3 text-xs font-semibold text-[#6E5A80]">
                                        Highest recorded demand
                                    </p>

                                    <HorizontalBars
                                        items={filteredProducts
                                            .slice(0, 5)
                                            .map((product) => ({
                                                name: product.name,
                                                value: product.units,
                                            }))}
                                        unit="units"
                                    />
                                </div>

                                <div>
                                    <p className="mb-3 text-xs font-semibold text-[#6E5A80]">
                                        Lowest recorded demand
                                    </p>

                                    <HorizontalBars
                                        items={[...filteredProducts]
                                            .reverse()
                                            .slice(0, 5)
                                            .map((product) => ({
                                                name: product.name,
                                                value: product.units,
                                            }))}
                                        unit="units"
                                    />
                                </div>
                            </div>

                            <p className="mt-3 text-xs text-[#81718D]">
                                Rankings include products with recorded sales.
                                Unsold products are not included, and low
                                recorded demand may reflect stockouts.
                            </p>
                        </div>

                        <div className="mt-6 border-t border-[#EEE8F3] pt-5">
                            <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                Historical Demand Movement
                            </h3>
                            <p className="mb-4 text-xs leading-5 text-[#81718D]">
                                Unit demand compared with the preceding equivalent reporting period.
                                New activity means no recorded demand in the comparison period;
                                it is not a calculated percentage increase.
                            </p>
                            <div className="grid gap-5 xl:grid-cols-2">
                                <div>
                                    <h4 className="mb-3 text-xs font-semibold text-[#6E5A80]">
                                        Category movement
                                    </h4>
                                    <DemandMovement
                                        items={data.products.categories.slice(0, 8)}
                                    />
                                </div>
                                <div>
                                    <h4 className="mb-3 text-xs font-semibold text-[#6E5A80]">
                                        Product movement (selected category)
                                    </h4>
                                    <DemandMovement
                                        items={filteredProducts.slice(0, 8)}
                                    />
                                </div>
                            </div>
                            <p className="mt-3 text-xs leading-5 text-[#81718D]">
                                Movement is based on recorded POS units, not inventory availability.
                                Categories and products with no current-period sales are not listed.
                            </p>
                        </div>

                        <div className="mt-6 border-t border-[#EEE8F3] pt-5">
                            <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                Purchasing Activity by Hour
                            </h3>

                            {(() => {
                                const hourly = [...data.products.hourlyDemand]
                                    .filter((item) => item.units > 0)
                                    .sort((a, b) => b.units - a.units || a.hour - b.hour);
                                if (!hourly.length) return null;
                                const peak = hourly[0].units;
                                const peakHours = hourly.filter((item) => item.units === peak);
                                return (
                                    <p className="mb-3 rounded-lg bg-[#F7F1FB] px-3 py-2 text-xs text-[#6E5A80]">
                                        <span className="font-semibold">Peak recorded purchasing {peakHours.length === 1 ? "hour" : "hours"}: </span>
                                        {peakHours.map((item) => item.label).join(", ")}
                                        {` (${number(peak)} units${peakHours.length > 1 ? " each" : ""})`}
                                    </p>
                                );
                            })()}

                            <HorizontalBars
                                items={[...data.products.hourlyDemand]
                                    .filter((item) => item.units > 0)
                                    .sort((a, b) => b.units - a.units)
                                    .slice(0, 8)
                                    .map((item) => ({
                                        name: item.label,
                                        value: item.units,
                                    }))}
                                unit="units"
                            />

                            <p className="mt-3 text-xs text-[#81718D]">
                                Based on qualifying POS item quantities
                                grouped by recorded order-creation hour.
                                This chart covers all products in the
                                selected reporting scope.
                            </p>
                        </div>

                        <SectionInsight
                            message={insightFor("products")}
                        />
                    </Section>

                    {/* SECTION 3: BOOKINGS AND RENTALS */}

                    <Section
                        title="3. Booking & Rental Trends"
                        description="Accepted booking schedules, booking types, and item quantities associated with bookings."
                        icon={<CalendarDays size={19} />}
                    >
                        <div className="mb-5 grid gap-3 sm:grid-cols-3">
                            <Metric
                                label="Accepted bookings"
                                value={number(
                                    data.bookings.totalBookings
                                )}
                            />

                            <Metric
                                label="Change vs previous period"
                                value={getChangeLabel(
                                    data.bookings.change
                                )}
                            />

                            <Metric
                                label="Booked item units"
                                value={number(
                                    data.bookings.totalBookedItemUnits
                                )}
                            />
                        </div>

                        <div className="mb-5 rounded-xl border border-[#EEE7F4] bg-[#FCFAFD] p-4">
                            <p className="text-sm font-semibold text-[#49365C]">Booking commitments vs completed rentals</p>
                            <p className="mt-1 text-xs leading-5 text-[#81718D]">
                                Accepted bookings and booked item units describe scheduled commitments only.
                                Booking commitments are not proof of equipment release or return. Rental lifecycle activity is reported separately below.
                            </p>
                            {data.bookings.totalBookings > 0 && data.bookings.totalBookedItemUnits === 0 && (
                                <p className="mt-2 text-xs font-medium text-[#7852A5]">
                                    No linked booked-item quantities were returned for these accepted bookings. Verify booking-item integration later.
                                </p>
                            )}
                        </div>
                        <div className="grid gap-6 xl:grid-cols-2">
                            <div>
                                <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                    Monthly Booking Activity
                                </h3>

                                <LineChart
                                    points={
                                        data.bookings.monthlyBookings
                                    }
                                />
                            </div>

                            <div>
                                <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                    Bookings by Type
                                </h3>

                                <HorizontalBars
                                    items={data.bookings.bookingTypes.map(
                                        (item) => ({
                                            name: item.name,
                                            value: item.count,
                                        })
                                    )}
                                    unit="bookings"
                                />
                            </div>
                        </div>

                        <div className="mt-6 border-t border-[#EEE8F3] pt-5">
                            <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                Most Booked Items
                            </h3>

                            <HorizontalBars
                                items={data.bookings.bookedItems
                                    .slice(0, 8)
                                    .map((item) => ({
                                        name: item.name,
                                        value: item.units,
                                    }))}
                                unit="units"
                            />

                            <p className="mt-3 text-xs text-[#81718D]">
                                Item quantities represent booking
                                commitments, not verified completed
                                rentals or returns. Booking activity
                                uses scheduled event dates.
                            </p>
                        </div>

                        <HistoricalMonthlySummary points={data.bookings.monthlyBookings} label="accepted bookings" />
                        <SectionInsight
                            message={insightFor("bookings")}
                        />
                    </Section>

                    {/* Rental lifecycle — read-only historical metrics */}
                    <Section
                        title="Rental Equipment Activity"
                        description="Booked units by event date; releases and returns by their recorded timestamps within the selected period."
                        icon={<Package size={19} />}
                    >
                        {data.rentals ? (
                            <>
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    <Metric label="Bookings containing rental items" value={number(data.rentals.bookingCount)} />
                                    <Metric label="Rental units booked" value={number(data.rentals.bookedUnits)} />
                                    <Metric label="Rental units released" value={number(data.rentals.releasedUnits)} />
                                    <Metric label="Rental units returned" value={number(data.rentals.returnedUnits)} />
                                    <Metric label="Returned units marked damaged" value={number(data.rentals.damagedUnits)} />
                                    <Metric label="Missing units recorded at return" value={number(data.rentals.missingUnits)} />
                                </div>
                                <div className="mt-5 grid gap-6 xl:grid-cols-2">
                                    <div>
                                        <h3 className="mb-3 text-sm font-semibold text-[#49365C]">Monthly Rental Units Booked</h3>
                                        <LineChart points={data.rentals.monthlyBookedUnits} />
                                    </div>
                                    <div>
                                        <h3 className="mb-3 text-sm font-semibold text-[#49365C]">Most Booked Rental Equipment</h3>
                                        <HorizontalBars items={data.rentals.topEquipment.map(item => ({name:item.name,value:item.units}))} unit="units" />
                                    </div>
                                </div>
                                <p className="mt-3 text-xs leading-5 text-[#81718D]">
                                    These are separate event-based totals, not a stock balance. Damaged units are included in returned units where recorded. Historical overdue counts are intentionally not inferred from current item statuses.
                                </p>
                            </>
                        ) : <EmptyState message="Rental lifecycle metrics are unavailable in this response." />}
                    </Section>

                    {/* SECTION 4: PACKAGES */}

                    <Section
                        title="4. Package Demand Analysis"
                        description="Package booking counts and historical changes, rather than package revenue alone."
                        icon={<Package size={19} />}
                    >
                        <div className="mb-5 grid gap-3 sm:grid-cols-2">
                            <Metric
                                label="Accepted package bookings"
                                value={number(
                                    data.packages.totalPackageBookings
                                )}
                            />

                            <Metric
                                label="Packages with recorded bookings"
                                value={number(
                                    data.packages.packages.length
                                )}
                            />
                        </div>

                        <div className="grid gap-6 xl:grid-cols-2">
                            <div>
                                <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                    Monthly Package Demand
                                </h3>

                                <LineChart
                                    points={
                                        data.packages.monthlyPackageBookings
                                    }
                                />
                            </div>

                            <div>
                                <h3 className="mb-3 text-sm font-semibold text-[#49365C]">
                                    Package Booking Rankings
                                </h3>

                                <HorizontalBars
                                    items={data.packages.packages
                                        .slice(0, 8)
                                        .map((item) => ({
                                            name: item.name,
                                            value: item.bookings,
                                        }))}
                                    unit="bookings"
                                />
                            </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-3">
                            <Metric
                                label="Highest monthly booking count"
                                value={packageTrend.peak > 0 ? number(packageTrend.peak) : "N/A"}
                                subtitle={packageTrend.peakMonths.length
                                    ? packageTrend.peakMonths.length === packageTrend.months.length
                                        ? "All displayed months are tied"
                                        : packageTrend.peakMonths.map((month) => month.label).join(", ")
                                    : "No accepted package bookings"}
                            />
                            <Metric
                                label="Lowest monthly booking count"
                                value={packageTrend.months.length ? number(packageTrend.low) : "N/A"}
                                subtitle={packageTrend.lowMonths.length === packageTrend.months.length
                                    ? "All displayed months are tied"
                                    : packageTrend.lowMonths.map((month) => month.label).join(", ")}
                            />
                            <Metric
                                label="Latest month vs preceding month"
                                value={packageTrend.difference === null
                                    ? "N/A"
                                    : `${packageTrend.difference > 0 ? "+" : ""}${number(packageTrend.difference)} bookings`}
                                subtitle={packageTrend.latest && packageTrend.prior
                                    ? `${packageTrend.latest.label} vs ${packageTrend.prior.label}`
                                    : "At least two months required"}
                            />
                        </div>

                        <p className="mt-3 text-xs leading-5 text-[#81718D]">
                            These figures describe the selected historical months only.
                            A single reporting period does not establish recurring seasonal demand.
                        </p>

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <div className="rounded-xl bg-[#FCFAFD] p-4">
                                <p className="mb-2 text-xs font-semibold text-[#6E5A80]">
                                    Highest recorded package demand
                                </p>

                                <p className="font-semibold text-[#38244D]">
                                    {data.packages.packages[0]?.name ||
                                        "No package records"}
                                </p>

                                <p className="mt-1 text-xs text-[#81718D]">
                                    {number(
                                        data.packages.packages[0]
                                            ?.bookings || 0
                                    )}{" "}
                                    accepted bookings
                                </p>
                            </div>

                            <div className="rounded-xl bg-[#FCFAFD] p-4">
                                <p className="mb-2 text-xs font-semibold text-[#6E5A80]">
                                    Lowest recorded package demand
                                </p>

                                <p className="font-semibold text-[#38244D]">
                                    {data.packages.packages.length === 1
                                        ? "Only one package recorded"
                                        : data.packages.packages.length
                                            ? data.packages.packages[
                                            data.packages.packages.length - 1
                                                ].name
                                            : "No package records"}
                                </p>

                                <p className="mt-1 text-xs text-[#81718D]">
                                    {data.packages.packages.length === 1 ? (
                                        "No distinct lowest-ranked package"
                                    ) : number(
                                        data.packages.packages.length
                                            ? data.packages.packages[
                                            data.packages.packages.length - 1
                                                ].bookings
                                            : 0
                                    )}{data.packages.packages.length === 1 ? "" : " accepted bookings"}
                                </p>
                            </div>
                        </div>

                        <p className="mt-3 text-xs text-[#81718D]">
                            Packages are currently grouped by saved
                            booking names. Package identity must be
                            verified against the booking workflow
                            before treating these as unique catalog
                            packages.
                        </p>

                        <SectionInsight
                            message={insightFor("packages")}
                        />
                    </Section>

                    {/* SECTION 5: OWNER BRANCHES */}

                    {isOwner && data.branches && (
                        <Section
                            title="5. Branch Performance"
                            description="Owner-only comparison of qualifying POS sales across branches in the selected reporting scope."
                            icon={<Building2 size={19} />}
                        >
                            {data.branches.branches.length ? (
                                <>
                                    <HorizontalBars
                                        items={data.branches.branches.map((branch) => ({
                                            name: branch.branchName,
                                            value: branch.totalSales,
                                        }))}
                                        unit="PHP"
                                    />

                                    <div className="mt-5 grid gap-3 lg:grid-cols-2">
                                        {data.branches.branches.map((branch) => {
                                            const summary = summarizeMonths(branch.monthlySales);
                                            return (
                                                <div key={branch.branchId} className="rounded-xl border border-[#EEE7F4] bg-[#FCFAFD] p-4">
                                                    <p className="text-sm font-semibold text-[#49365C]">{branch.branchName}</p>
                                                    <p className="mt-1 text-xs text-[#81718D]">{money(branch.totalSales)} in selected-period sales</p>
                                                    {summary && (
                                                        <>
                                                            <p className="mt-2 text-xs text-[#6E5A80]">Peak: {money(summary.peak)} · {summary.peakLabel}</p>
                                                            <p className="mt-1 text-xs text-[#6E5A80]">Lowest: {money(summary.low)} · {summary.lowLabel}</p>
                                                            <p className="mt-1 text-xs text-[#6E5A80]">
                                                                Latest monthly movement: {summary.difference === null ? "N/A" :
                                                                `${summary.difference > 0 ? "+" : summary.difference < 0 ? "−" : ""}${money(Math.abs(summary.difference))}`}
                                                            </p>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <p className="mt-3 text-xs text-[#81718D]">
                                        Branch growth here compares adjacent months only. Branch-specific product and booking comparisons
                                        require additional backend aggregation and are not yet shown.
                                    </p>

                                    <p className="mt-3 text-xs text-[#81718D]">
                                        Values represent sales in PHP.
                                        Select All branches above for
                                        a store-wide comparison.
                                    </p>
                                </>
                            ) : (
                                <EmptyState message="No qualifying branch sales in this period." />
                            )}
                        </Section>
                    )}

                    <div className="flex items-center justify-end gap-2 text-xs text-[#94859F]">
                        <BarChart3 size={14} />

                        Last generated:{" "}
                        {new Date(
                            data.generatedAt
                        ).toLocaleString("en-PH")}
                    </div>
                </>
            )}
        </div>
    );
}
