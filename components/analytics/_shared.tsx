"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    BarList,
    BuyingTimes,
    C,
    Card,
    ChangeChip,
    Empty,
    ErrorBox,
    ItemInsightSection,
    Kpi,
    LineChart,
    MonthComparisonSection,
    RentalMonthHeatmap,
    SERIES,
    Segmented,
    Tabs,
    buttonStyle,
    dateRangeText,
    fmt,
    grid,
    inputStyle,
    peso,
    type Change,
} from "./extras";

/* -------------------------------------------------------
 * TYPES
 * ------------------------------------------------------- */

export type AnalyticsRole = "owner" | "manager" | "staff";

export type AnalyticsBranch = {
    id: number;
    name: string;
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
    scope: { storeId: number; branchId: number | null; branchName: string; role: AnalyticsRole; isOverall: boolean };
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
        categories: { name: string; units: number; change: Change }[];
        products: DemandItem[];
        hourlyDemand: { hour: number; label: string; units: number }[];
        monthlyDemand: MonthlyPoint[];
        highestDemandProducts: DemandItem[];
        lowestDemandProducts: DemandItem[];
        categoryHourly?: { name: string; units: number; peakHour: number; hours: number[] }[];
        weekdayHourly?: { weekday: number; label: string; units: number; hours: number[] }[];
    };
    bookings: {
        totalBookings: number;
        change: Change;
        monthlyBookings: MonthlyPoint[];
        bookingTypes: { name: string; count: number }[];
        bookedItems: { name: string; units: number }[];
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
        topEquipment: { name: string; units: number }[];
        monthlyBookedUnits: MonthlyPoint[];
        equipmentByMonth?: { months: { key: string; label: string }[]; items: { name: string; units: number[]; total: number }[] };
    } | null;
    packages: {
        totalPackageBookings: number;
        packages: { name: string; bookings: number; change: Change }[];
        monthlyPackageBookings: MonthlyPoint[];
        highestDemandPackages: { name: string; bookings: number; change: Change }[];
        lowestDemandPackages: { name: string; bookings: number; change: Change }[];
    };
    branches: {
        branches: { branchId: number; branchName: string; totalSales: number; monthlySales: MonthlyPoint[] }[];
    } | null;
    insights: { section: string; message: string }[];
};

type Period = "month" | "3" | "6" | "12";
type TabId = "sales" | "products" | "compare" | "bookings" | "rentals" | "item";

const TABS: { id: TabId; label: string }[] = [
    { id: "sales", label: "Sales" },
    { id: "products", label: "Products" },
    { id: "compare", label: "Compare months" },
    { id: "bookings", label: "Bookings" },
    { id: "rentals", label: "Rentals" },
    { id: "item", label: "Look up an item" },
];

const PERIODS: { id: Period; label: string }[] = [
    { id: "month", label: "This month" },
    { id: "3", label: "Last 3 months" },
    { id: "6", label: "Last 6 months" },
    { id: "12", label: "Last 12 months" },
];

/* -------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------- */

function getToken() {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
}

// "Last N months" means the N complete months before this one.
function getLastCompleteMonths(count: number) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - count, 1));
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
    return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function getThisMonth() {
    const now = new Date();
    return {
        startDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10),
        endDate: new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10),
    };
}

const TAB_KEY = "stocknbook-analytics-tab";

function readSavedTab(): TabId {
    if (typeof window === "undefined") return "sales";
    try {
        const saved = window.localStorage.getItem(TAB_KEY) as TabId | null;
        return saved && TABS.some((t) => t.id === saved) ? saved : "sales";
    } catch {
        return "sales";
    }
}

async function fetchAnalytics(period: Period, branchId: number | null): Promise<AnalyticsData> {
    const authToken = getToken();
    if (!authToken) throw new Error("You are signed out. Please sign in again.");
    const dates = period === "month" ? getThisMonth() : getLastCompleteMonths(Number(period));
    const body: Record<string, string | number> = { action: "get_analytics_v2", start_date: dates.startDate, end_date: dates.endDate };
    if (branchId !== null) body.branch_id = branchId;
    const response = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
        cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success || payload.version !== 2) {
        throw new Error(payload.error || "Analytics could not be loaded.");
    }
    return payload as AnalyticsData;
}

function peakAndLow(points: MonthlyPoint[]) {
    if (!points.length) return null;
    const sorted = [...points].sort((a, b) => b.value - a.value);
    const latest = points[points.length - 1];
    const before = points.length > 1 ? points[points.length - 2] : null;
    return { best: sorted[0], worst: sorted[sorted.length - 1], latest, before };
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
 * TABS
 * ------------------------------------------------------- */

function SalesTab({ data, isOwner, onPickBranch }: { data: AnalyticsData; isOwner: boolean; onPickBranch: (id: number) => void }) {
    const months = data.sales.monthlySales;
    const lastYear = data.sales.monthlyPreviousYear;
    const summary = peakAndLow(months);
    const branchRows = data.branches?.branches || [];
    const branchTotal = branchRows.reduce((sum, b) => sum + b.totalSales, 0);
    return (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Card title="Sales by month" sub="Completed POS sales. The dashed line is the same months last year.">
                {months.some((m) => m.value > 0) ? (
                    <>
                        <LineChart ariaLabel="Sales per month this period and last year" format={peso}
                                   labels={months.map((m) => m.label)}
                                   series={[
                                       { name: "This period", color: SERIES[0], values: months.map((m) => m.value) },
                                       ...(lastYear.length === months.length ? [{ name: "Last year", color: SERIES[1], values: lastYear.map((m) => m.value), dashed: true }] : []),
                                   ]} />
                        {summary && months.length > 1 && (
                            <div style={{ ...grid(150), marginTop: 12 }}>
                                <Kpi label="Best month" value={peso(summary.best.value)} sub={summary.best.label} />
                                <Kpi label="Slowest month" value={peso(summary.worst.value)} sub={summary.worst.label} />
                                {summary.before && (
                                    <Kpi label={`${summary.latest.label} vs ${summary.before.label}`}
                                         value={`${summary.latest.value >= summary.before.value ? "+" : "−"}${peso(Math.abs(summary.latest.value - summary.before.value))}`}
                                         sub={summary.latest.value >= summary.before.value ? "More than the month before" : "Less than the month before"} />
                                )}
                            </div>
                        )}
                    </>
                ) : <Empty>No sales in this period.</Empty>}
            </Card>

            {isOwner && branchRows.length > 1 && (
                <Card title="Sales by branch" sub="Click a branch to see only that branch.">
                    <BarList format={peso} onPick={(key) => onPickBranch(Number(key))}
                             items={[...branchRows].sort((a, b) => b.totalSales - a.totalSales).map((b) => ({
                                 key: String(b.branchId), name: b.branchName, value: b.totalSales,
                                 extra: <span style={{ color: C.muted }}>{branchTotal > 0 ? `${fmt((b.totalSales / branchTotal) * 100)}%` : ""}</span>,
                             }))} />
                </Card>
            )}
        </div>
    );
}

function ProductsTab({ data }: { data: AnalyticsData }) {
    const [category, setCategory] = useState("All");
    const [view, setView] = useState<"best" | "slow">("best");
    const products = useMemo(
        () => data.products.products.filter((p) => category === "All" || p.category === category),
        [data, category]
    );
    const ranked = view === "best" ? products.slice(0, 10) : [...products].reverse().slice(0, 10);
    return (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div style={grid(340, 16)}>
                <Card title="Best and slowest sellers"
                      sub={view === "slow" ? "Only products with at least one sale. Low sales can also mean the item was out of stock." : "Units sold. The % compares with the period before."}
                      action={<Segmented label="Show" value={view} onChange={setView} options={[{ id: "best", label: "Best" }, { id: "slow", label: "Slowest" }]} />}>
                    <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 12 }}>
                        <option value="All">All categories</option>
                        {data.products.categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <BarList format={(v) => `${fmt(v)} units`} empty="No sales in this category."
                             items={ranked.map((p) => ({ key: p.key, name: p.name, value: p.units, extra: <ChangeChip change={p.change} compact /> }))} />
                </Card>
                <Card title="Categories" sub="Units sold. The % compares with the period before.">
                    <BarList format={(v) => `${fmt(v)} units`} color={SERIES[3]}
                             items={data.products.categories.slice(0, 10).map((c) => ({ name: c.name, value: c.units, extra: <ChangeChip change={c.change} compact /> }))} />
                </Card>
            </div>
            <BuyingTimes categoryHourly={data.products.categoryHourly} weekdayHourly={data.products.weekdayHourly} />
        </div>
    );
}

function BookingsTab({ data }: { data: AnalyticsData }) {
    const packages = data.packages.packages;
    return (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div style={grid(150)}>
                <Kpi label="Bookings" value={fmt(data.bookings.totalBookings)} sub={<><ChangeChip change={data.bookings.change} /> vs the period before</>} />
                <Kpi label="Package bookings" value={fmt(data.packages.totalPackageBookings)} sub={`${fmt(packages.length)} packages booked`} />
                <Kpi label="Items booked" value={fmt(data.bookings.totalBookedItemUnits)} sub="Products and rental units" />
            </div>
            <Card title="Bookings by month" sub="Accepted bookings, counted on the event date.">
                {data.bookings.monthlyBookings.some((m) => m.value > 0) ? (
                    <LineChart ariaLabel="Bookings per month" labels={data.bookings.monthlyBookings.map((m) => m.label)}
                               series={[
                                   { name: "All bookings", color: SERIES[0], values: data.bookings.monthlyBookings.map((m) => m.value) },
                                   ...(data.packages.monthlyPackageBookings.length === data.bookings.monthlyBookings.length
                                       ? [{ name: "Package bookings", color: SERIES[2], values: data.packages.monthlyPackageBookings.map((m) => m.value) }] : []),
                               ]} />
                ) : <Empty>No bookings in this period.</Empty>}
            </Card>
            <div style={grid(340, 16)}>
                <Card title="Popular packages" sub="The % compares with the period before.">
                    <BarList format={(v) => `${fmt(v)} booked`} empty="No package bookings in this period."
                             items={packages.slice(0, 8).map((p) => ({ name: p.name, value: p.bookings, extra: <ChangeChip change={p.change} compact /> }))} />
                </Card>
                <Card title="Booking types">
                    <BarList format={(v) => fmt(v)} color={SERIES[3]} empty="No bookings in this period."
                             items={data.bookings.bookingTypes.map((t) => ({ name: t.name, value: t.count }))} />
                </Card>
            </div>
        </div>
    );
}

function RentalsTab({ data }: { data: AnalyticsData }) {
    const rentals = data.rentals;
    if (!rentals) return <Empty>No rental records in this period.</Empty>;
    const problems = rentals.damagedUnits + rentals.missingUnits;
    return (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div style={grid(150)}>
                <Kpi label="Units booked" value={fmt(rentals.bookedUnits)} sub={`${fmt(rentals.bookingCount)} bookings with rentals`} />
                <Kpi label="Units sent out" value={fmt(rentals.releasedUnits)} />
                <Kpi label="Units returned" value={fmt(rentals.returnedUnits)} />
                <Kpi label="Damaged or missing" value={fmt(problems)}
                     sub={problems ? `${fmt(rentals.damagedUnits)} damaged · ${fmt(rentals.missingUnits)} missing` : "None"} />
            </div>
            <RentalMonthHeatmap data={rentals.equipmentByMonth} />
            <Card title="Most booked rental items">
                <BarList format={(v) => `${fmt(v)} units`} empty="No rental bookings in this period."
                         items={rentals.topEquipment.slice(0, 10).map((e) => ({ name: e.name, value: e.units }))} />
            </Card>
        </div>
    );
}

/* -------------------------------------------------------
 * PAGE
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
    const [branchId, setBranchId] = useState<number | null>(null);
    const [period, setPeriod] = useState<Period>("12");
    const [reloadTick, setReloadTick] = useState(0);
    // The tab list only shows after data loads (in the browser), so reading the saved tab here is safe.
    const [tab, setTab] = useState<TabId>(readSavedTab);

    // State changes only when a response arrives; "loading" means the shown data is not for the current filters.
    const scopeBranch = isOwner ? branchId : null;
    const requestKey = `${period}|${scopeBranch ?? "all"}|${reloadTick}`;
    const [result, setResult] = useState<{ key: string; data: AnalyticsData | null; period: Period; error: string }>({ key: "", data: null, period: "12", error: "" });
    const data = result.data;
    const loadedPeriod = result.period;
    const loading = result.key !== requestKey;
    const error = loading ? "" : result.error;
    const reload = () => setReloadTick((t) => t + 1);
    const changeTab = (next: TabId) => {
        setTab(next);
        try { window.localStorage.setItem(TAB_KEY, next); } catch { /* saving the tab is optional */ }
    };

    useEffect(() => {
        let cancelled = false;
        fetchAnalytics(period, scopeBranch)
            .then((payload) => { if (!cancelled) setResult({ key: requestKey, data: payload, period, error: "" }); })
            .catch((err) => {
                if (!cancelled) setResult((r) => ({ ...r, key: requestKey, error: err instanceof Error ? err.message : "Analytics could not be loaded." }));
            });
        return () => { cancelled = true; };
    }, [period, scopeBranch, requestKey]);

    // Other screens can ask Analytics to reload.
    useEffect(() => {
        const onRefresh = () => setReloadTick((t) => t + 1);
        window.addEventListener("stocknbook-refresh-analytics", onRefresh);
        return () => window.removeEventListener("stocknbook-refresh-analytics", onRefresh);
    }, []);

    const scopeName = isOwner
        ? (branchId === null ? "All branches" : ownerBranches.find((b) => b.id === branchId)?.name || data?.scope.branchName || "Branch")
        : assignedBranch || data?.scope.branchName || "Your branch";
    const topProduct = data?.products.products[0];
    const sameComparison = Boolean(data && data.period.previousStartDate === data.period.previousYearStartDate);

    return (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)", color: C.ink }}>
            {/* Filters */}
            <section style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12, border: `1px solid ${C.line}`, borderRadius: 14, background: "#fff", padding: "12px 16px" }}>
                <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>{scopeName}</p>
                    <p aria-live="polite" style={{ margin: "2px 0 0", fontSize: 13, color: C.muted }}>
                        {data ? dateRangeText(data.period.startDate, data.period.endDate) : "Loading…"}
                        {data && loadedPeriod === "month" ? " · month not over yet" : ""}
                        {loading && data ? " · updating…" : ""}
                    </p>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
                    {isOwner && (
                        <label style={{ display: "grid", gap: 4, gridTemplateColumns: "minmax(0, 1fr)", fontSize: 12, fontWeight: 600, color: C.text }}>
                            Branch
                            <select value={branchId ?? ""} disabled={ownerBranchesLoading} style={inputStyle}
                                    onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}>
                                <option value="">All branches</option>
                                {ownerBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </label>
                    )}
                    <label style={{ display: "grid", gap: 4, gridTemplateColumns: "minmax(0, 1fr)", fontSize: 12, fontWeight: 600, color: C.text }}>
                        Period
                        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} style={inputStyle}>
                            {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                    </label>
                    <button type="button" onClick={reload} disabled={loading} aria-label="Refresh analytics"
                            style={{ ...buttonStyle(true), height: 38, display: "inline-flex", alignItems: "center", gap: 6, opacity: loading ? 0.7 : 1 }}>
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </section>

            {error && <ErrorBox message={error} onRetry={reload} />}

            {!data && loading && <AnalyticsLoadingScreen />}

            {data && (
                <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)", opacity: loading ? 0.6 : 1, transition: "opacity 150ms" }}>
                    {/* At a glance */}
                    <div style={grid(150)}>
                        <Kpi label="Sales" value={peso(data.sales.totalSales)}
                             sub={<><ChangeChip change={data.sales.yearOverYearChange} /> vs same period last year</>} />
                        <Kpi label="Orders" value={fmt(data.sales.orderCount)}
                             sub={data.sales.orderCount ? `${peso(data.sales.totalSales / data.sales.orderCount)} per order` : "No orders"} />
                        <Kpi label="Units sold" value={fmt(data.products.totalUnits)}
                             sub={topProduct ? <>Top: <span title={topProduct.name}>{topProduct.name}</span></> : "No sales"} />
                        <Kpi label="Bookings" value={fmt(data.bookings.totalBookings)}
                             sub={<><ChangeChip change={data.bookings.change} /> vs {sameComparison ? "last year" : "the period before"}</>} />
                    </div>

                    {!data.hasData && <Empty>No sales or bookings in this period yet. Try a longer period.</Empty>}

                    <div>
                        <Tabs label="Analytics sections" idPrefix="analytics" tabs={TABS} value={tab} onChange={changeTab} />
                        <div id="analytics-panel" role="tabpanel" aria-labelledby={`analytics-tab-${tab}`} style={{ paddingTop: 16 }}>
                            {tab === "sales" && <SalesTab data={data} isOwner={isOwner} onPickBranch={(id) => setBranchId(id)} />}
                            {tab === "products" && <ProductsTab data={data} />}
                            {tab === "compare" && <MonthComparisonSection branchId={isOwner ? branchId : null} />}
                            {tab === "bookings" && <BookingsTab data={data} />}
                            {tab === "rentals" && <RentalsTab data={data} />}
                            {tab === "item" && <ItemInsightSection branchId={isOwner ? branchId : null} popular={data.products.products.slice(0, 4).map((p) => p.name)} />}
                        </div>
                    </div>

                    <p style={{ margin: 0, textAlign: "right", fontSize: 12, color: C.muted }}>
                        Updated {new Date(data.generatedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                </div>
            )}
        </div>
    );
}
