"use client";

import * as React from "react";
import {
    BarChart3, Boxes, CalendarClock, ChevronDown,
    Download, RefreshCw, Search, ShoppingCart, X,
} from "lucide-react";
import { useRentalInventory, type RentalEquipment } from "@/hooks/useRentalInventory";

type Branch = { id: number; branchName: string };
type Amount = number | null;
type TrendPoint = { date: string; consumableSales: Amount; rentalRevenue: Amount };
type BranchRevenue = { branchId: number | null; branchName: string; consumableSales: Amount; rentalRevenue: Amount };
type ConsumablePerformance = { key: string; name: string; unitsSold: number; sales: number; grossProfit: Amount };
type RentalPerformance = { key: string; name: string; revenue: number; share: number };
// The Owner product list is read from the existing authenticated get_products action.
// Sold counts come separately from the selected date-range performance report.
type OwnerCatalogProduct = {
    id: number; productNumber: string | null; name: string;
    category: string | null; branchId: number | null; branchName: string | null;
    availableStock: number | null;
};
type ConsumableCatalogRow = OwnerCatalogProduct & { unitsSold: number | null };
type OwnerPerformance = {
    dateRange: { startDate: string; endDate: string };
    asOfDate: string;
    storeName: string;
    branches: Branch[];
    totals: {
        consumableSales: Amount; consumableGrossProfit: Amount;
        rentalRevenue: Amount; totalRevenue: Amount;
        // Recorded rental costs are not part of the V2 schema.
        rentalCostOfSales?: Amount;
    };
    trend: TrendPoint[];
    branchRevenue: BranchRevenue[];
    consumables: ConsumablePerformance[];
    rentals: RentalPerformance[];
    warnings: string[];
    branchConsumables?: Array<{ branchId: number; key: string; unitsSold: Amount; sales: Amount; grossProfit: Amount }>;
    branchRentals?: Array<{ branchId: number; key: string; revenue: Amount; estimatedCost?: Amount }>;
    branchRentalUnits?: Array<{ branchId: number; key: string; unitsRented: Amount }>;
};
type DateRange = { startDate: string; endDate: string };
type DatePreset = "Today" | "This Week" | "This Month" | "This Year" | "All Time" | "Custom Date Range";
const datePresets: DatePreset[] = ["Today", "This Week", "This Month", "This Year", "All Time", "Custom Date Range"];
type OwnerKpi = { label: string; value: Amount | undefined; unit: "money" | "count" };
type RentalBranchData = {
    items: RentalEquipment[];
    loading: boolean;
    error: string;
};
type RentalListRow = { branchId: number; branchName: string; item: RentalEquipment };

const cardClass = "min-w-0 overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm";
const scrollPanel = "min-h-0 w-full overflow-auto overscroll-contain border-t border-[#E9E1EE]";
const headerCell = "px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
const bodyCell = "px-2 py-2 text-center text-[#5F4E75]";
const firstBodyCell = "whitespace-nowrap px-4 py-2 text-left font-semibold text-[#2B174C]";
const compactControl = "h-9 min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none focus:border-[#BFA8E2] focus-visible:ring-2 focus-visible:ring-[#F1EBFF]";

function businessDateString() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
}
function monthToDateRange(): DateRange {
    const today = businessDateString();
    return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
}
function presetRange(preset: DatePreset, custom: DateRange, today = businessDateString()): DateRange {
    if (preset === "Custom Date Range") return custom;
    if (preset === "All Time") return { startDate: "all", endDate: today };
    if (preset === "Today") return { startDate: today, endDate: today };
    if (preset === "This Month") return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
    if (preset === "This Year") return { startDate: `${today.slice(0, 4)}-01-01`, endDate: today };
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return { startDate: monday.toISOString().slice(0, 10), endDate: today };
}
function sumKnown(values: Array<Amount | undefined>, monetary = true): Amount {
    if (values.some(value => value == null || !Number.isFinite(value))) return null;
    return values.reduce<number>((sum, value) => sum + (monetary ? Math.round(value! * 100) : value!), 0) / (monetary ? 100 : 1);
}
function shownKpi(kpi: OwnerKpi) {
    return kpi.unit === "money" ? shownMoney(kpi.value) : kpi.value == null || !Number.isFinite(kpi.value) ? "—" : formatNumber(kpi.value);
}
function dateRangeLabel(range: DateRange) {
    return range.startDate === range.endDate ? shortDate(range.startDate) : `${shortDate(range.startDate)} – ${shortDate(range.endDate)}`;
}
function formatPeso(value: number) {
    return value.toLocaleString("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatNumber(value: number) {
    return value.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}
function shortDate(value?: string | null, year = true) {
    if (!value) return "—";
    const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", ...(year ? { year: "numeric" as const } : {}),
    });
}
function shownMoney(value: Amount | undefined) {
    return value == null || !Number.isFinite(value) ? "—" : formatPeso(value);
}
// Only derive financial values when both source amounts are actually available.
function moneyDifference(left: Amount | undefined, right: Amount | undefined): Amount {
    if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) return null;
    return (Math.round(left * 100) - Math.round(right * 100)) / 100;
}
function validDateRange(start: string, end: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return false;
    const startDay = Date.parse(`${start}T00:00:00Z`);
    const endDay = Date.parse(`${end}T00:00:00Z`);
    return Number.isFinite(startDay) && Number.isFinite(endDay) &&
        new Date(startDay).toISOString().slice(0, 10) === start && new Date(endDay).toISOString().slice(0, 10) === end;
}
async function ownerRequest<T>(endpoint: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body), cache: "no-store", signal,
    });
    const payload = await response.json().catch(() => {
        throw new Error(`The inventory API returned an invalid response (HTTP ${response.status}).`);
    }) as T & { success?: boolean; error?: string };
    if (!response.ok || payload.success === false) throw new Error(payload.error || `Inventory request failed (HTTP ${response.status}).`);
    return payload;
}
function SectionHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
    return <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5] [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
        <div className="min-w-0"><h2 className="text-[15px] font-bold text-[#21132E]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-[#86778F]">{subtitle}</p>}</div>
    </div>;
}
function MetricCard({ label, value, helper, icon, loading = false, tone = "purple" }: {
    label: string; value: string; helper: string; icon: React.ReactNode;
    loading?: boolean; tone?: "purple" | "green" | "blue";
}) {
    const iconClassName = {
        purple: "bg-[#F1ECFF] text-[#5F35D8]",
        green: "bg-[#E5F8EC] text-[#23834A]",
        blue: "bg-[#E9F2FF] text-[#1E6FE8]",
    }[tone];
    return <section aria-busy={loading} className="flex min-h-[146px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm">
        {loading ? <>
            <span className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-[#EEE8F3]" aria-hidden="true"/>
            <span className="min-w-0 flex-1 space-y-2.5" role="status" aria-label={`Loading ${label}`}>
                <span className="block h-3.5 w-32 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                <span className="block h-7 w-24 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                <span className="block h-2.5 w-40 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
            </span>
        </> : <>
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconClassName}`} aria-hidden="true">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">{label}</span>
                <span className={`mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] tabular-nums ${value.startsWith("-")||value.startsWith("−")?"text-[#B42318]":"text-[#1A1220]"}`}>{value}</span>
                <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{helper}</span>
            </span>
        </>}
    </section>;
}
function OwnerTableLoadingRow({ columns, label }: { columns: number; label: string }) {
    return <tr><td colSpan={columns} className="px-4 py-10 text-center text-xs text-[#86778F]" role="status">{label}</td></tr>;
}
function FilterSelect({ value, onChange, label, children, width = "w-[145px]" }: {
    value: string; onChange: (value: string) => void; label: string; children: React.ReactNode; width?: string;
}) {
    return <span className={`relative inline-flex shrink-0 ${width}`}>
        <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}
                className={`${compactControl} w-full appearance-none py-1 pl-3 pr-9`}>{children}</select>
        <ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#806A8C]"/>
    </span>;
}
function DatePresetFilter({ preset, onPreset, custom, onCustom, label }: {
    preset: DatePreset; onPreset: (value: DatePreset) => void; custom: DateRange;
    onCustom: React.Dispatch<React.SetStateAction<DateRange>>; label: string;
}) {
    return <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label={`${label} date filter`} value={preset} onChange={value => onPreset(value as DatePreset)} width="w-[172px]">
            {datePresets.map(option => <option key={option} value={option}>{option}</option>)}
        </FilterSelect>
        {preset === "Custom Date Range" && <>
            <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5F4E75]">From
                <input aria-label={`${label} start date`} type="date" className={`${compactControl} w-[138px]`} value={custom.startDate}
                       max={custom.endDate || undefined} onChange={event => onCustom(prev => ({ ...prev, startDate: event.target.value }))}/>
            </label>
            <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5F4E75]">To
                <input aria-label={`${label} end date`} type="date" className={`${compactControl} w-[138px]`} value={custom.endDate}
                       min={custom.startDate || undefined} onChange={event => onCustom(prev => ({ ...prev, endDate: event.target.value }))}/>
            </label>
        </>}
    </div>;
}
function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: () => void }) {
    return <button type="button" disabled={disabled} onClick={onExport}
                   aria-label="Download filtered inventory PDF" title={disabled ? "Verified data unavailable" : "Download PDF"}
                   className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#D9CDF0] bg-white text-[#2B174C] hover:bg-[#F8F3FC] disabled:cursor-not-allowed disabled:opacity-40">
        <Download size={16} aria-hidden="true"/>
    </button>;
}

// Uses the EXISTING authorized owner read on the rental Lambda through the
// working rental hook. This does not add or modify any backend inventory action.
// Each branch has its own hook because hooks cannot be called inside a loop.
function RentalBranchFeed({ branchId, onUpdate }: {
    branchId: number;
    onUpdate: (branchId: number, change: Partial<RentalBranchData>) => void;
}) {
    const rental = useRentalInventory(branchId);
    React.useEffect(() => {
        onUpdate(branchId, {
            items: rental.equipment,
            loading: rental.loading,
            error: rental.error || "",
        });
    }, [branchId, onUpdate, rental.equipment, rental.loading, rental.error]);
    return null;
}

export default function OwnerInventory() {
    const [clock, setClock] = React.useState("");
    React.useEffect(() => {
        const update = () => {
            const now = new Date();
            const date = now.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" });
            const time = now.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
            setClock(`${date} | ${time}`);
        };
        update(); const timer = window.setInterval(update, 30_000); return () => window.clearInterval(timer);
    }, []);
    const [activeTab, setActiveTab] = React.useState<"consumable" | "rental">("consumable");
    const [consumableBranch, setConsumableBranch] = React.useState("");
    const [rentalBranch, setRentalBranch] = React.useState("");
    const [consumableCategory, setConsumableCategory] = React.useState("All Categories");
    const [consumablePreset, setConsumablePreset] = React.useState<DatePreset>("This Month");
    const [rentalPreset, setRentalPreset] = React.useState<DatePreset>("This Month");
    const [consumableCustom, setConsumableCustom] = React.useState<DateRange>(monthToDateRange);
    const [rentalCustom, setRentalCustom] = React.useState<DateRange>(monthToDateRange);
    const [rentalCategory, setRentalCategory] = React.useState("All Categories");
    const [consumableSearch, setConsumableSearch] = React.useState("");
    const [rentalSearch, setRentalSearch] = React.useState("");
    const [refresh, setRefresh] = React.useState(0);
    const [branches, setBranches] = React.useState<Branch[] | null>(null);
    const [report, setReport] = React.useState<{ key: string; data: OwnerPerformance | null; error: string } | null>(null);
    const isConsumable = activeTab === "consumable";
    const activePreset = isConsumable ? consumablePreset : rentalPreset;
    const activeBranch = isConsumable ? consumableBranch : rentalBranch;
    const range = presetRange(activePreset, isConsumable ? consumableCustom : rentalCustom);
    const rangeValid = activePreset === "All Time" || (validDateRange(range.startDate, range.endDate) &&
        (Date.parse(`${range.endDate}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) / 86400000 <= 365);
    const reportKey = `${activeTab}:${activeBranch}:${range.startDate}:${range.endDate}:${refresh}`;
    const performance = report?.key === reportKey ? report.data : null;
    const performanceLoading = rangeValid && report?.key !== reportKey;
    const performanceError = !rangeValid ? "Choose a valid custom date range of 366 days or fewer." : report?.key === reportKey ? report.error : "";
    const resolvedRange = activePreset === "All Time" ? performance?.dateRange : range;
    const from = resolvedRange?.startDate || "";
    const to = resolvedRange?.endDate || "";
    const [catalogProducts, setCatalogProducts] = React.useState<OwnerCatalogProduct[] | null>(null);
    const [catalogLoading, setCatalogLoading] = React.useState(true);
    const [catalogError, setCatalogError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    const [rentalByBranch, setRentalByBranch] = React.useState<Record<number, Partial<RentalBranchData>>>({});
    const onRentalUpdate = React.useCallback((branchId: number, change: Partial<RentalBranchData>) => {
        setRentalByBranch(previous => {
            const existing = previous[branchId] || {};
            // React hooks may produce equivalent arrays with different references.
            // Avoid an effect -> parent state -> effect render loop.
            const unchanged = (Object.keys(change) as Array<keyof RentalBranchData>).every(key => {
                if (key === "items") return JSON.stringify(existing.items || []) === JSON.stringify(change.items || []);
                return existing[key] === change[key];
            });
            if (unchanged) return previous;
            return { ...previous, [branchId]: { ...existing, ...change } };
        });
    }, []);

    // Owner-only read of the full V2 consumable catalog, including unsold products.
    // get_products is already authorized for Owners and scoped by the JWT store_id;
    // no new backend actions, schema changes, or inventory mutations are needed.
    React.useEffect(() => {
        const abort = new AbortController();
        setCatalogLoading(true);
        setCatalogError("");
        setCatalogProducts(null);
        void ownerRequest<{ products: Array<{
                id: number; productNumber?: string | null; name: string; category?: string | null;
                branchId?: number | null; branchName?: string | null; sellableStock?: number | null;
            }> }>("/api/products", { action: "get_products" }, abort.signal).then(result => {
            if (!Array.isArray(result.products)) throw new Error("The product inventory API did not return a product list.");
            if (abort.signal.aborted) return;
            setCatalogProducts(result.products.map(product => ({
                id: Number(product.id),
                productNumber: product.productNumber == null ? null : String(product.productNumber),
                name: String(product.name),
                category: product.category == null ? null : String(product.category),
                branchId: product.branchId == null ? null : Number(product.branchId),
                branchName: product.branchName == null ? null : String(product.branchName),
                // Sellable stock excludes reserved, unavailable and expired stock.
                // Physical on-hand quantities must NOT be used as a fallback.
                availableStock: product.sellableStock == null || !Number.isFinite(Number(product.sellableStock))
                    ? null : Math.max(0, Number(product.sellableStock)),
            })));
        }).catch(error => {
            if (!abort.signal.aborted) setCatalogError(error instanceof Error ? error.message : "Unable to load products.");
        }).finally(() => { if (!abort.signal.aborted) setCatalogLoading(false); });
        return () => abort.abort();
    }, [refresh]);

    // One financial request for the active tab, branch and reporting period.
    // Category and search are applied to branch/item breakdowns below.
    React.useEffect(() => {
        if (!rangeValid) return;
        const abort = new AbortController();
        void ownerRequest<{ performance: OwnerPerformance }>("/api/products", {
            action: "get_owner_inventory_performance", date_from: range.startDate, date_to: range.endDate,
            ...(activeBranch ? { branch_id: Number(activeBranch) } : {}),
        }, abort.signal).then(result => {
            const data = result.performance;
            if (!data || !Array.isArray(data.branches) || !Array.isArray(data.branchConsumables) || !Array.isArray(data.branchRentals))
                throw new Error("Deploy the updated Products Lambda to enable filtered KPI reporting.");
            if (!validDateRange(data.dateRange?.startDate, data.dateRange?.endDate)) throw new Error("Invalid report dates returned by the API.");
            if (abort.signal.aborted) return;
            setReport({ key: reportKey, data, error: "" });
            setBranches(previous => JSON.stringify(previous) === JSON.stringify(data.branches) ? previous : data.branches);
        }).catch(error => {
            if (!abort.signal.aborted) setReport({ key: reportKey, data: null, error: error instanceof Error ? error.message : "Unable to load sales totals." });
        });
        return () => abort.abort();
    }, [reportKey, rangeValid, range.startDate, range.endDate, activeBranch]);
    // Branch discovery also works when the sales aggregation is temporarily unavailable.
    React.useEffect(() => {
        const abort = new AbortController();
        const load = async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Session expired.");
                const response = await fetch("/api/branches", {
                    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: abort.signal,
                });
                const payload = await response.json() as { branches?: Array<{
                        id?: number; branch_id?: number; branchId?: number; branchName?: string; branch_name?: string; name?: string;
                    }>; error?: string };
                if (!response.ok || !Array.isArray(payload.branches)) throw new Error(payload.error || "Branch list unavailable.");
                const loaded = payload.branches.map(item => ({
                    id: Number(item.id ?? item.branch_id ?? item.branchId),
                    branchName: item.branchName || item.branch_name || item.name || "Unnamed branch",
                })).filter(item => Number.isSafeInteger(item.id) && item.id > 0);
                if (!abort.signal.aborted) setBranches(previous => previous ?? loaded);
            } catch (error) {
                if (!abort.signal.aborted) console.warn("Unable to load branches", error);
            }
        };
        void load(); return () => abort.abort();
    }, [refresh]);
    React.useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(""), 6000);
        return () => window.clearTimeout(timer);
    }, [notice]);

    const selectedBranches = (branches || []).filter(item => !rentalBranch || String(item.id) === rentalBranch);
    const consumableSource = isConsumable ? performance : null;
    const consumablesLoading = catalogLoading || performanceLoading;
    const consumablesError = [catalogError, performanceError].filter(Boolean).join(" · ");
    const consumableBranchName = consumableBranch
        ? branches?.find(item => String(item.id) === consumableBranch)?.branchName || "Selected branch" : "All branches";
    const rentalBranchName = rentalBranch
        ? branches?.find(item => String(item.id) === rentalBranch)?.branchName || "Selected branch" : "All branches";
    const activeBranchName = isConsumable ? consumableBranchName : rentalBranchName;
    const activeCategory = isConsumable ? consumableCategory : rentalCategory;
    const activeSearch = isConsumable ? consumableSearch : rentalSearch;
    const selectedLabel = resolvedRange ? dateRangeLabel(resolvedRange) : "All Time";
    const periodLabel = `${activePreset} · ${selectedLabel}`;
    const productPerformance = new Map((consumableSource?.branchConsumables || []).map(item => [`${item.branchId}:${item.key}`, item]));
    const rentalPerformance = new Map((!isConsumable ? performance?.branchRentals || [] : []).map(item => [`${item.branchId}:${item.key}`, item]));
    const consumables: ConsumableCatalogRow[] = (catalogProducts || []).map(product => {
        const row = productPerformance.get(`${product.branchId}:product:${product.id}`);
        return { ...product, unitsSold: !consumableSource ? null : row ? row.unitsSold : 0 };
    });
    const consumableCategories = [...new Set(consumables
        .filter(item => !consumableBranch || String(item.branchId) === consumableBranch)
        .map(item => item.category).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b));
    const visibleConsumables = consumables.filter(item =>
        (!consumableBranch || String(item.branchId) === consumableBranch) &&
        (consumableCategory === "All Categories" || item.category === consumableCategory) &&
        [item.name, item.productNumber, item.category, item.branchName].join(" ").toLowerCase().includes(consumableSearch.toLowerCase().trim()));
    const rentalRows: RentalListRow[] = selectedBranches.flatMap(selected => {
        const data = rentalByBranch[selected.id];
        const activeItems = [...new Map((data?.items || []).filter(item => item.active).map(item => [item.id, item])).values()];
        return activeItems.map(item => ({ branchId: selected.id, branchName: selected.branchName, item }));
    });
    const categories = [...new Set(rentalRows.map(row => row.item.category))].sort((a, b) => a.localeCompare(b));
    const visibleRentals = rentalRows.filter(row =>
        (rentalCategory === "All Categories" || row.item.category === rentalCategory) &&
        [row.item.equipmentNumber, row.item.name, row.item.category, row.branchName]
            .join(" ").toLowerCase().includes(rentalSearch.toLowerCase().trim()));
    const rentalRangeValid = rangeValid && validDateRange(from, to);
    const rentalsLoading = performanceLoading || branches === null || selectedBranches.some(selected => {
        return rentalByBranch[selected.id]?.loading !== false;
    });
    const rentalErrors = selectedBranches.flatMap(selected => {
        const error = rentalByBranch[selected.id]?.error;
        return error ? [`${selected.branchName}: ${error}`] : [];
    });
    // Financial and quantity KPIs use exactly the currently visible branch/item rows.
    // Current stock remains a live quantity, not historical stock.
    const kpiLoading = isConsumable ? consumablesLoading : rentalsLoading;
    const ready = !!performance && !kpiLoading && (isConsumable ? catalogProducts !== null && !catalogError : rentalRangeValid && !rentalErrors.length);
    const matchedProducts = [...new Set(visibleConsumables.map(row => `${row.branchId}:product:${row.id}`))].map(key => productPerformance.get(key));
    const rentalKeys = [...new Set(visibleRentals.map(row => `${row.branchId}:equipment:${row.item.id}`))];
    const matchedRentals = rentalKeys.map(key => rentalPerformance.get(key));
    const hasRentalUnits = Array.isArray(performance?.branchRentalUnits);
    const rentalUnitsByKey = new Map((hasRentalUnits ? performance!.branchRentalUnits! : []).map(row => [`${row.branchId}:${row.key}`, row.unitsRented]));
    // The table, KPI and PDF share the same per-equipment release count.
    const rentedUnitsFor = (row: RentalListRow): Amount => {
        if (!ready || isConsumable || !hasRentalUnits) return null;
        const key = `${row.branchId}:equipment:${row.item.id}`;
        const count = rentalUnitsByKey.has(key) ? rentalUnitsByKey.get(key) : 0;
        return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
    };
    const kpiPrefix = isConsumable ? "Consumable" : "Rental";
    const kpiSales = !ready ? null : isConsumable
        ? sumKnown(matchedProducts.map(row => row ? row.sales : 0))
        : performance?.totals.rentalRevenue == null ? null : sumKnown(matchedRentals.map(row => row ? row.revenue : 0));
    const consumableGross = ready && isConsumable
        ? sumKnown(matchedProducts.map(row => row ? row.grossProfit : 0)) : null;
    const consumableCost = moneyDifference(kpiSales, consumableGross);
    const consumableUnits = ready && isConsumable
        ? sumKnown(matchedProducts.map(row => row ? row.unitsSold : 0), false) : null;
    const currentRentalStock = [...new Map(visibleRentals.map(row => [`${row.branchId}:${row.item.id}`, row.item])).values()];
    // Current stock value is an investment measure, not a rental transaction expense.
    const equipmentCost = ready && !isConsumable ? sumKnown(currentRentalStock.map(item => {
        const units = item.totalUnits;
        const cost = item.averageUnitCost;
        if (!Number.isSafeInteger(units) || units < 0) return null;
        if (units === 0) return 0;
        if (cost == null || !Number.isFinite(cost) || cost < 0) return null;
        const cents = Math.round(cost * 100) * units;
        return Number.isSafeInteger(cents) ? cents / 100 : null;
    })) : null;
    const totalOwnedUnits = ready && !isConsumable ? sumKnown(currentRentalStock.map(item =>
        Number.isSafeInteger(item.totalUnits) && item.totalUnits >= 0 ? item.totalUnits : null), false) : null;
    // Count actual releases, not peak reserved units. Older API versions must not look like zero activity.
    const unitsRented = ready && !isConsumable && hasRentalUnits
        ? sumKnown(visibleRentals.map(rentedUnitsFor), false) : null;
    const kpis: OwnerKpi[] = isConsumable ? [
        { label: "Consumable Sales", value: kpiSales, unit: "money" },
        { label: "Consumable Cost", value: consumableCost, unit: "money" },
        { label: "Consumable Gross Profit", value: consumableGross, unit: "money" },
        { label: "Units Sold", value: consumableUnits, unit: "count" },
    ] : [
        { label: "Rental Sales", value: kpiSales, unit: "money" },
        { label: "Equipment Cost", value: equipmentCost, unit: "money" },
        { label: "Total Units", value: totalOwnedUnits, unit: "count" },
        { label: "Units Rented", value: unitsRented, unit: "count" },
    ];
    const kpiScope = `${activeBranchName} | ${activeCategory} | ${periodLabel} | Search: ${activeSearch.trim() || "All"}`;

    const exportList = (type: "consumables" | "rentals") => {
        const consumableTable: OwnerReportTable = {
            headers: ["Product No.", "Product", "Branch", "Category", "Available Stock", "Sold"],
            rows: visibleConsumables.map(item => [item.productNumber || "—", item.name,
                item.branchName || "—", item.category || "—",
                item.availableStock == null ? "—" : item.availableStock,
                item.unitsSold == null ? "—" : item.unitsSold]),
            columnWidths: [150, 190, 118, 125, 108, 85], moneyColumns: [],
        };
        const rentalTable: OwnerReportTable = {
            headers: ["Equipment No.", "Rental Product", "Category", "Branch", "Total Units", "Units Rented"],
            rows: visibleRentals.map(row => [row.item.equipmentNumber, row.item.name, row.item.category, row.branchName,
                row.item.totalUnits, rentedUnitsFor(row) ?? "—"]),
            columnWidths: [165, 180, 112, 105, 90, 105], moneyColumns: [],
        };
        const isRental = type === "rentals";
        const report = isRental ? rentalTable : consumableTable;
        // Use the same filtered KPI snapshot and currently visible rows as the dashboard.
        if (!ready || !rangeValid || isRental === isConsumable) return;
        const details: OwnerReportDetails = {
            title: isRental ? "Rental Equipment List" : "Consumable Product List",
            fileTag: isRental ? "Rental_Equipment_List" : "Consumable_Product_List",
            storeName: performance?.storeName || sessionStorage.getItem("store_name") || "StockNBook",
            branchName: isRental ? rentalBranchName : consumableBranchName, generatedAt: new Date(),
            kpiScope,
            kpis,
            kpiNote: isRental ? "Equipment Cost = current average unit cost × owned stock. Total Units = current stock. Units Rented = recorded releases. — = unavailable." : "— = required financial data was not recorded or could not be loaded.",
            filters: isRental ? ["Branch: " + rentalBranchName, "Category: " + rentalCategory,
                    `Reporting dates: ${activePreset} (${from} to ${to})`, `Search: ${rentalSearch || "All"}`,
                    "Total Units is current stock, not historical stock.", "Units Rented counts quantities released in the selected period, including repeat rentals. Rental Sales uses recorded rental charges by return/reporting date."] :
                ["Branch: " + consumableBranchName, "Category: " + consumableCategory,
                    `Sold dates: ${periodLabel}`, `Search: ${consumableSearch || "All"}`,
                    "Available Stock is today's sellable stock; Sold is the selected period's recorded POS units. Financial KPIs use visible item sales, excluding unallocated order adjustments."],
        };
        try {
            exportOwnerTablePdf(report, details);
        } catch (error) {
            setNotice(error instanceof Error ? `Export failed: ${error.message}` : "Unable to export list.");
        }
    };

    return <div className="min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
        {/* Existing manager-style Inventory header and card treatment. */}
        <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <div><h1 className="text-[25px] font-bold text-[#1A1220]">Inventory</h1><p className="mt-0.5 text-xs text-[#766983]">View consumable products and rental equipment across your branches.</p></div>
                <div className="flex items-center gap-2.5">
                    <time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{clock || "Asia/Manila"}</time>
                    <button type="button" onClick={() => { setRentalByBranch({}); setRefresh(value => value + 1); }}
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"><RefreshCw size={16}/>Refresh</button>
                </div>
            </div>
        </header>
        <main className="space-y-4 px-5 py-5 font-sans">
            {/* Match the Manager/Staff rental-consumable switch; each tab has its own filters. */}
            <section aria-label="Inventory type" className="flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-[#F1F3FF] to-[#F7F5FF] px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#5A35A5]">
                        {activeTab === "consumable" ? <ShoppingCart size={22}/> : <CalendarClock size={22}/>}
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-[25px] font-bold text-[#1A1220]">{activeTab === "consumable" ? "Consumable Inventory" : "Rental Inventory"}</h2>
                        <p className="mt-0.5 text-xs text-[#766983]">{activeTab === "consumable"
                            ? "Read-only product stock and sold units across branches."
                            : "Read-only rental equipment and rented quantities across branches."}</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Inventory type">
                    <button type="button" role="tab" aria-selected={activeTab === "consumable"} onClick={() => setActiveTab("consumable")}
                            className={`inline-flex h-[42px] min-w-[145px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B31D4] ${activeTab === "consumable" ? "bg-[#2B174C] text-white hover:bg-[#1B0D31]" : "border border-[#E2DCF2] bg-white text-[#24164D] hover:bg-[#F8F5FF]"}`}>
                        <ShoppingCart size={17}/> Consumable
                    </button>
                    <button type="button" role="tab" aria-selected={activeTab === "rental"} onClick={() => { if (activeTab !== "rental") setRentalByBranch({}); setActiveTab("rental"); }}
                            className={`inline-flex h-[42px] min-w-[145px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B31D4] ${activeTab === "rental" ? "bg-[#2B174C] text-white hover:bg-[#1B0D31]" : "border border-[#E2DCF2] bg-white text-[#24164D] hover:bg-[#F8F5FF]"}`}>
                        <CalendarClock size={17}/> Rental
                    </button>
                </div>
            </section>
            {performanceError && <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] p-3 text-xs text-[#C32F2F]">{performanceError}</p>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {kpis.map((kpi, index) => <MetricCard key={kpi.label} label={kpi.label} value={shownKpi(kpi)} loading={kpiLoading}
                                                      helper={kpi.value == null ? (!isConsumable && index === 3 && !Array.isArray(performance?.branchRentalUnits) && ready ? "Update Products Lambda" : "Required data unavailable")
                                                          : !isConsumable && index === 1 ? "Current stock × Average Unit Cost"
                                                              : !isConsumable && index === 2 ? "Current owned equipment"
                                                                  : !isConsumable && index === 3 ? `Released units · ${periodLabel}`
                                                                      : `${activeBranchName} · ${periodLabel}`}
                                                      icon={index === 0 ? (isConsumable ? <ShoppingCart size={20}/> : <Boxes size={20}/>) : index === 2 ? <BarChart3 size={20}/> : <Boxes size={20}/>}
                                                      tone={index === 1 || index === 3 ? "blue" : index === 2 ? "green" : "purple"}/>)}
            </div>
            {performance?.warnings?.length ? <p role="note" className="text-[11px] text-[#806A8C]">{performance.warnings.join(" ")}</p> : null}
            {activeTab === "consumable" ? <section role="tabpanel" aria-label="Consumable products" className={cardClass}>
                <div className="flex flex-col gap-3 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
                    <SectionHeading icon={<ShoppingCart/>} title="Consumable Product List" subtitle="All registered products, current available stock, and units sold in the selected period"/>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterSelect label="Filter consumable category" value={consumableCategory} onChange={setConsumableCategory} width="w-[154px]">
                            <option>All Categories</option>{consumableCategories.map(category => <option key={category}>{category}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter consumable branch" value={consumableBranch} onChange={value => { setConsumableBranch(value); setConsumableCategory("All Categories"); }} width="w-[155px]">
                            <option value="">All Branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
                        </FilterSelect>
                        <DatePresetFilter preset={consumablePreset} onPreset={setConsumablePreset} custom={consumableCustom} onCustom={setConsumableCustom} label="Consumable"/>
                        <ExportMenu disabled={!ready} onExport={() => exportList("consumables")}/>
                    </div>
                </div>
                <div className="px-4 pb-4">
                    <div className="relative"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                        <input aria-label="Search consumable products" value={consumableSearch} onChange={event => setConsumableSearch(event.target.value)}
                               placeholder="Search product no., product, branch, or category..."
                               className="h-[44px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"/>
                    </div>
                </div>
                {consumablesError && <p role="alert" className="border-t border-[#F2C4C4] bg-[#FFF0F0] px-4 py-2 text-xs text-[#C32F2F]">{consumablesError}</p>}
                <div className={`${scrollPanel} max-h-[360px]`} role="region" aria-label="Consumable inventory list" tabIndex={0}>
                    <table className="w-full min-w-0 table-auto text-center text-[10px] xl:text-[11px] [&_th]:align-middle [&_td]:align-middle [&_td]:leading-snug">
                        <colgroup><col className="w-[19%]"/><col className="w-[22%]"/><col className="w-[17%]"/>
                            <col className="w-[16%]"/><col className="w-[15%]"/><col className="w-[11%]"/></colgroup>
                        <thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr>
                            {(["Product No.", "Product", "Branch", "Category", "Available Stock", "Sold"] as const).map(label => <th key={label} className={headerCell}>{label}</th>)}
                        </tr></thead>
                        <tbody>{visibleConsumables.map(row => <tr key={`${row.branchId ?? "none"}-${row.id}`} className="h-12 border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]">
                            <td className={firstBodyCell}>{row.productNumber || "—"}</td>
                            <td className="break-words px-2 py-2 font-semibold text-[#2B174C]">{row.name}</td>
                            <td className={bodyCell}>{row.branchName || "—"}</td>
                            <td className={bodyCell}>{row.category || "—"}</td>
                            <td className={`${bodyCell} tabular-nums`}>{row.availableStock == null ? "—" : formatNumber(row.availableStock)}</td>
                            <td className={`${bodyCell} tabular-nums`}>{row.unitsSold == null ? "—" : formatNumber(row.unitsSold)}</td>
                        </tr>)}
                        {visibleConsumables.length === 0 && (consumablesLoading ? <OwnerTableLoadingRow columns={6} label="Loading consumable products..."/> :
                            <tr><td colSpan={6} className="px-4 py-12 text-xs text-[#806A8C]">{consumablesError ? "Unable to load consumable report." : "No consumable products match these filters."}</td></tr>)}
                        </tbody>
                    </table>
                </div>
            </section> : <section role="tabpanel" aria-label="Rental equipment" className={cardClass}>
                {/* Existing authorized read-only rental hook for each selected branch. */}
                {selectedBranches.map(item => <RentalBranchFeed key={`${item.id}-${refresh}-${rentalBranch}`} branchId={item.id}
                                                                onUpdate={onRentalUpdate}/>)}
                <div className="flex flex-col gap-3 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
                    <SectionHeading icon={<Boxes/>} title="Rental Equipment List" subtitle="Total owned units and units rented during the selected period"/>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterSelect label="Filter rental equipment category" value={rentalCategory} onChange={setRentalCategory} width="w-[154px]">
                            <option>All Categories</option>{categories.map(category => <option key={category}>{category}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter rental equipment branch" value={rentalBranch} onChange={value => { setRentalByBranch({}); setRentalBranch(value); setRentalCategory("All Categories"); }} width="w-[155px]">
                            <option value="">All Branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
                        </FilterSelect>
                        <DatePresetFilter preset={rentalPreset} onPreset={setRentalPreset} custom={rentalCustom} onCustom={setRentalCustom} label="Rental"/>
                        <ExportMenu disabled={!ready} onExport={() => exportList("rentals")}/>
                    </div>
                </div>
                <div className="px-4 pb-4"><div className="relative"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                    <input aria-label="Search rental equipment" value={rentalSearch} onChange={event => setRentalSearch(event.target.value)}
                           placeholder="Search equipment no., rental product, branch, or category..."
                           className="h-[44px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"/>
                </div></div>
                {!rangeValid && <p role="alert" className="bg-[#FFF4F4] px-4 py-2 text-[11px] text-[#C32F2F]">Choose a valid custom date range of 366 days or fewer.</p>}
                {rentalErrors.length > 0 && <p role="alert" className="bg-[#FFF4F4] px-4 py-2 text-[11px] text-[#C32F2F]">{rentalErrors.join(" · ")}</p>}
                <div className={`${scrollPanel} max-h-[360px]`} role="region" aria-label="Rental equipment inventory list" tabIndex={0}>
                    <table className="w-full min-w-0 table-auto text-center text-[11px] [&_th]:align-middle [&_td]:align-middle [&_td]:leading-snug">
                        <colgroup><col className="w-[20%]"/><col className="w-[23%]"/><col className="w-[16%]"/>
                            <col className="w-[17%]"/><col className="w-[12%]"/><col className="w-[12%]"/></colgroup>
                        <thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr>
                            {(["Equipment No.", "Rental Product", "Category", "Branch", "Total Units", "Units Rented"] as const)
                                .map(label => <th key={label} title={label === "Units Rented" ? "Total units released during the selected period, including repeat rentals" : undefined} className={headerCell}>{label}</th>)}
                        </tr></thead>
                        <tbody>{visibleRentals.map(row => <tr key={`${row.branchId}-${row.item.id}`} className="h-12 border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]">
                            <td className={firstBodyCell}>{row.item.equipmentNumber || "—"}</td>
                            <td className="break-words px-2 py-2 font-semibold text-[#2B174C]">{row.item.name}</td>
                            <td className={bodyCell}>{row.item.category}</td>
                            <td className={bodyCell}>{row.branchName}</td>
                            <td className={`${bodyCell} tabular-nums`}>{formatNumber(row.item.totalUnits)}</td>
                            <td className={`${bodyCell} tabular-nums`}>{rentedUnitsFor(row) == null ? "—" : formatNumber(rentedUnitsFor(row)!)}</td>
                        </tr>)}
                        {visibleRentals.length === 0 && (rentalsLoading ? <OwnerTableLoadingRow columns={6} label="Loading rental equipment..."/> :
                            <tr><td colSpan={6} className="px-4 py-12 text-xs text-[#806A8C]">{rentalErrors.length ? "Rental inventory unavailable for the selected branches." : "No rental equipment matches these filters."}</td></tr>)}
                        </tbody>
                    </table>
                </div>
            </section>}
        </main>
        {notice && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[150] flex max-w-[min(420px,calc(100vw-40px))] items-start gap-3 rounded-xl border border-[#E6DDF0] bg-white p-4 text-sm text-[#5F4E75] shadow-xl">
            <p>{notice}</p><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></button>
        </div>}
    </div>;
}

type OwnerReportTable = {
    headers: string[];
    rows: Array<Array<string | number>>;
    columnWidths: number[];
    moneyColumns: number[];
};

type OwnerReportDetails = {
    title: string;
    fileTag: string;
    storeName: string;
    branchName: string;
    filters: string[];
    generatedAt: Date;
    kpiScope: string;
    kpis: OwnerKpi[];
    kpiNote: string;
};

function ownerReportDate(date: Date) {
    return date.toLocaleString("en-PH", {
        timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
    });
}

function ownerReportFilename(details: OwnerReportDetails) {
    const slug = (value: string) => String(value || "Unknown")
        .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "Unknown";
    const date = details.generatedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
    return `StockNBook_${details.fileTag}_${slug(details.storeName)}_${slug(details.branchName)}_${date}.pdf`;
}

function exportOwnerTablePdf(table: OwnerReportTable, details: OwnerReportDetails) {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const scale = 1.7;
    const margin = 23;
    const availableWidth = pageWidth - margin * 2;
    const widthSum = table.columnWidths.reduce((sum, width) => sum + width, 0);
    const widths = table.columnWidths.map(width => width / widthSum * availableWidth);
    const tableHeadHeight = 29;
    const tableBottom = 555;
    const rowLineHeight = 10;
    const paddingX = 4;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(pageWidth * scale);
    canvas.height = Math.round(pageHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create a PDF canvas in this browser.");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const wrapCell = (value: string | number, maximumWidth: number): string[] => {
        const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ");
        const lines: string[] = [];
        let line = "";
        for (const word of words) {
            const combined = line ? `${line} ${word}` : word;
            if (ctx.measureText(combined).width <= maximumWidth) {
                line = combined;
            } else {
                if (line) lines.push(line);
                line = "";
                for (const letter of word) {
                    if (ctx.measureText(line + letter).width > maximumWidth && line) {
                        lines.push(line);
                        line = "";
                    }
                    line += letter;
                }
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : ["—"];
    };
    // Reserve space for the complete filter text, then the KPI summary, on every page.
    ctx.font = "8.6px Arial, sans-serif";
    const filterLines = wrapCell(`Filters: ${details.filters.join(" | ") || "None"}`, availableWidth);
    const recordsY = 103 + filterLines.length * 12 + 9;
    const summaryY = recordsY + 18;
    const kpiY = summaryY + 24;
    const kpiHeight = 46;
    const tableTop = kpiY + kpiHeight + 26;
    const shownRows = table.rows.map(row => row.map((value, column) =>
        table.moneyColumns.includes(column) && typeof value === "number" ? formatPeso(value) : value
    ));
    const mappedRows = shownRows.map(row => {
        ctx.font = "8px Arial, sans-serif";
        const wrapped = row.map((cell, col) => wrapCell(cell, widths[col] - paddingX * 2));
        return { wrapped, height: Math.max(21, Math.max(...wrapped.map(lines => lines.length)) * rowLineHeight + 8) };
    });
    const pages: Array<typeof mappedRows> = [[]];
    let used = tableTop + tableHeadHeight;
    mappedRows.forEach(row => {
        if (used + row.height > tableBottom && pages[pages.length - 1].length) {
            pages.push([]);
            used = tableTop + tableHeadHeight;
        }
        pages[pages.length - 1].push(row);
        used += row.height;
    });

    const drawRow = (cells: string[][], y: number, height: number, header: boolean, shaded: boolean) => {
        let x = margin;
        cells.forEach((lines, index) => {
            ctx.fillStyle = header ? "#F1EBFF" : shaded ? "#FAF8FD" : "#FFFFFF";
            ctx.fillRect(x, y, widths[index], height);
            ctx.strokeStyle = "#E3D8EA";
            ctx.lineWidth = 0.45;
            ctx.strokeRect(x, y, widths[index], height);
            ctx.fillStyle = header ? "#4E2C66" : "#21132E";
            ctx.font = header ? "bold 7.4px Arial, sans-serif" : "8px Arial, sans-serif";
            lines.forEach((line, indexLine) => ctx.fillText(line, x + paddingX, y + 12 + indexLine * rowLineHeight));
            x += widths[index];
        });
    };

    const jpegPages: Uint8Array[] = [];
    pages.forEach((pageRows, pageIndex) => {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, pageWidth, pageHeight);
        ctx.fillStyle = "#2B174C";
        ctx.font = "bold 16px Arial, sans-serif";
        ctx.fillText(`StockNBook - ${details.title}`, margin, 29);
        ctx.font = "9.5px Arial, sans-serif";
        ctx.fillText(`Store: ${details.storeName}`, margin, 51);
        ctx.fillText(`Branch: ${details.branchName}`, margin, 67);
        ctx.fillText(`Report Date: ${ownerReportDate(details.generatedAt)}`, margin, 83);
        ctx.fillStyle = "#5F4E75";
        ctx.font = "8.6px Arial, sans-serif";
        filterLines.forEach((line, index) => ctx.fillText(line, margin, 103 + index * 12));
        ctx.fillText(`Total Records: ${table.rows.length}`, margin, recordsY);
        ctx.fillStyle = "#2B174C";
        ctx.font = "bold 10px Arial, sans-serif";
        ctx.fillText("Financial Summary", margin, summaryY);
        ctx.font = "8.6px Arial, sans-serif";
        ctx.fillStyle = "#5F4E75";
        ctx.fillText(details.kpiScope, margin, summaryY + 12, availableWidth);
        const kpiGap = 8;
        const kpiWidth = (availableWidth - kpiGap * (details.kpis.length - 1)) / details.kpis.length;
        const kpiColors = ["#5F35D8", "#1E6FE8", "#23834A", "#1E6FE8"];
        details.kpis.forEach((kpi, index) => {
            const { label } = kpi;
            const x = margin + index * (kpiWidth + kpiGap);
            ctx.fillStyle = "#FAF8FD";
            ctx.fillRect(x, kpiY, kpiWidth, kpiHeight);
            ctx.strokeStyle = "#E3D8EA";
            ctx.lineWidth = 0.7;
            ctx.strokeRect(x, kpiY, kpiWidth, kpiHeight);
            ctx.fillStyle = kpiColors[index] || "#5F4E75";
            ctx.fillRect(x, kpiY, 3, kpiHeight);
            ctx.font = "bold 9px Arial, sans-serif";
            ctx.fillStyle = "#5F4E75";
            ctx.fillText(label, x + 11, kpiY + 15, kpiWidth - 22);
            ctx.font = "bold 15px Arial, sans-serif";
            ctx.fillStyle = kpi.value != null && kpi.value < 0 ? "#B42318" : "#21132E";
            ctx.fillText(shownKpi(kpi), x + 11, kpiY + 34, kpiWidth - 22);
        });
        ctx.font = "8px Arial, sans-serif";
        ctx.fillStyle = "#5F4E75";
        ctx.fillText(details.kpiNote, margin, kpiY + kpiHeight + 13, availableWidth);
        ctx.font = "bold 7.4px Arial, sans-serif";
        const headerCells = table.headers.map((label, index) => wrapCell(label, widths[index] - 8));
        drawRow(headerCells, tableTop, tableHeadHeight, true, false);
        let y = tableTop + tableHeadHeight;
        pageRows.forEach((row, index) => {
            drawRow(row.wrapped, y, row.height, false, index % 2 === 1);
            y += row.height;
        });
        ctx.fillStyle = "#806A8C";
        ctx.font = "9px Arial, sans-serif";
        ctx.fillText(`StockNBook | ${details.title}`, margin, pageHeight - 21);
        ctx.textAlign = "right";
        ctx.fillText(`Page ${pageIndex + 1} of ${pages.length}`, pageWidth - margin, pageHeight - 21);
        ctx.textAlign = "left";
        const base64 = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
        const binary = atob(base64);
        const jpeg = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) jpeg[i] = binary.charCodeAt(i);
        jpegPages.push(jpeg);
    });

    const encoder = new TextEncoder();
    const chunks: BlobPart[] = [];
    const offsets: number[] = [];
    let byteCount = 0;
    const write = (content: string | Uint8Array) => {
        const bytes = typeof content === "string" ? encoder.encode(content) : content;
        chunks.push(bytes as BlobPart);
        byteCount += bytes.length;
    };
    const obj = (id: number, body: () => void) => {
        offsets[id] = byteCount;
        write(`${id} 0 obj\n`);
        body();
        write("\nendobj\n");
    };
    write("%PDF-1.4\n%StockNBook\n");
    obj(1, () => write("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => write(`<< /Type /Pages /Kids [${jpegPages.map((_,i) => `${3 + i*3} 0 R`).join(" ")}] /Count ${jpegPages.length} >>`));
    jpegPages.forEach((jpeg, index) => {
        const pageId = 3 + index * 3;
        const imageId = pageId + 1;
        const contentsId = pageId + 2;
        obj(pageId, () => write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /PageImage ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>`));
        obj(imageId, () => {
            write(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
            write(jpeg);
            write("\nendstream");
        });
        const draw = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/PageImage Do\nQ\n`;
        obj(contentsId, () => write(`<< /Length ${encoder.encode(draw).length} >>\nstream\n${draw}endstream`));
    });
    const xref = byteCount;
    const totalObjects = 2 + jpegPages.length * 3;
    write(`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= totalObjects; id++) write(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    write(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const blob = new Blob(chunks, { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = ownerReportFilename(details);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}