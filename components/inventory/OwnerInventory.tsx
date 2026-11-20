"use client";

import * as React from "react";
import {
    BarChart3, Boxes, CalendarClock, ChevronDown,
    Download, RefreshCw, Search, ShoppingCart, X,
} from "lucide-react";
import { useRentalInventory, type RentalEquipment } from "@/hooks/useRentalInventory";
import { normalizeProduct, type Product, type ProductVariant } from "./_shared";

type Branch = { id: number; branchName: string };
type Amount = number | null;
type TrendPoint = { date: string; consumableSales: Amount; rentalRevenue: Amount };
type BranchRevenue = { branchId: number | null; branchName: string; consumableSales: Amount; rentalRevenue: Amount };
type ConsumablePerformance = { key: string; name: string; unitsSold: number; sales: number; grossProfit: Amount };
type RentalPerformance = { key: string; name: string; revenue: number; share: number };
// The Owner product list is read from the existing authenticated get_products action.
// Sold counts come separately from the selected date-range performance report.
type OwnerStockLine = {
    availableStock: number | null;
    // Match Manager status calculation; keep missing sellable quantities distinct in the table.
    statusStock: number | null;
    alertLevel: number;
    expirationDate: string | null;
};
type OwnerCatalogVariant = OwnerStockLine & {
    id: number; variantNumber: string | null; name: string;
};
function ownerSellableStock(value: number | null | undefined): number | null {
    return value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
}
function ownerStockLine(line: Product | ProductVariant): OwnerStockLine {
    return {
        availableStock: ownerSellableStock(line.sellableStock),
        // Manager displays sellable stock for status and falls back to catalog stock
        // when the API omits sellableStock. Never use this fallback as the Owner's
        // displayed available quantity.
        statusStock: ownerSellableStock(line.sellableStock ?? line.stock),
        alertLevel: Number(line.alertLevel || 0),
        expirationDate: line.expirationDate ?? null,
    };
}
function ownerCatalogVariants(variants?: ProductVariant[]): OwnerCatalogVariant[] {
    if (!Array.isArray(variants)) return [];
    return variants.filter(variant => Number.isSafeInteger(Number(variant.id)) && Number(variant.id) > 0)
        .map(variant => ({
            ...ownerStockLine(variant),
            id: Number(variant.id),
            variantNumber: variant.variantNumber == null ? null : String(variant.variantNumber),
            name: Object.values(variant.variantValues || {}).map(value => String(value ?? "").trim()).filter(Boolean).join(", ") || "Variant",
        }));
}
type OwnerCatalogProduct = OwnerStockLine & {
    id: number; productNumber: string | null; name: string;
    category: string | null; branchId: number | null; branchName: string | null;
    variants: OwnerCatalogVariant[];
};
// Use exactly the existing inventory normalizer used by the Manager's hook.
// This recognizes camelCase and snake_case expiration/reorder fields, and parses
// variant metadata without requiring any change to the shared component or API.
function normalizeOwnerCatalogProduct(raw: unknown): OwnerCatalogProduct {
    const product = normalizeProduct(raw);
    return {
        ...ownerStockLine(product),
        id: Number(product.id),
        productNumber: product.productNumber == null ? null : String(product.productNumber),
        name: String(product.name),
        category: product.category == null ? null : String(product.category),
        branchId: product.branchId == null ? null : Number(product.branchId),
        branchName: product.branchName == null ? null : String(product.branchName),
        variants: product.hasVariants ? ownerCatalogVariants(product.variants) : [],
    };
}
// Same expiration priority, reorder threshold and parent aggregation as Manager Inventory.
// Use the same status stock basis as the Manager table; missing displayed quantities stay unknown.
type OwnerConsumableStatus = "In Stock" | "Low Stock" | "Out of Stock" | "Expiring Soon" | "Expired" | "Unknown";
const ownerConsumableStatusOptions = ["All Status", "In Stock", "Low Stock", "Out of Stock", "Expiring Soon", "Expired"] as const;
const ownerRentalStatusOptions = ["All Status", "Available", "Unavailable"] as const;
function ownerLineStatus(line: OwnerStockLine, now = new Date()): OwnerConsumableStatus {
    const raw = String(line.expirationDate || "").trim();
    if (raw) {
        const expiry = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
        if (!Number.isNaN(expiry.getTime())) {
            expiry.setHours(0, 0, 0, 0);
            const today = new Date(now.getTime());
            today.setHours(0, 0, 0, 0);
            const days = Math.round((expiry.getTime() - today.getTime()) / 86400000);
            if (days < 0) return "Expired";
            if (days <= 30) return "Expiring Soon";
        }
    }
    if (line.statusStock == null || !Number.isFinite(line.statusStock)) return "Unknown";
    if (line.statusStock <= 0) return "Out of Stock";
    if (line.statusStock <= line.alertLevel) return "Low Stock";
    return "In Stock";
}
function ownerProductStatus(product: OwnerCatalogProduct, now = new Date()): OwnerConsumableStatus {
    const statuses = (product.variants.length ? product.variants : [product]).map(line => ownerLineStatus(line, now));
    if (statuses.includes("Expired")) return "Expired";
    if (statuses.includes("Expiring Soon")) return "Expiring Soon";
    if (statuses.every(status => status === "Out of Stock")) return "Out of Stock";
    if (statuses.includes("Unknown")) return "Unknown";
    if (statuses.includes("Out of Stock") || statuses.includes("Low Stock")) return "Low Stock";
    return "In Stock";
}
// Owner reports show current availability (today), not availability on historical sales dates.
type OwnerRentalStatus = "Available" | "Unavailable";
function ownerRentalStatusGroup(item: RentalEquipment): OwnerRentalStatus | null {
    // Missing availability is not a confirmed zero; archived items are excluded from the list.
    if (!item.active || item.bookableToday == null || !Number.isFinite(item.bookableToday)) return null;
    return item.bookableToday > 0 ? "Available" : "Unavailable";
}
function OwnerConsumableStatusText({status}: {status: OwnerConsumableStatus}) {
    const color: Record<OwnerConsumableStatus, string> = {
        "In Stock": "text-[#23834A]", "Low Stock": "text-[#C77A00]", "Out of Stock": "text-[#D92C3F]",
        "Expiring Soon": "text-[#6944C9]", "Expired": "text-[#8E4AA6]", "Unknown": "text-[#6B6174]",
    };
    return <span className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 ${color[status]}`}>{status}</span>;
}
function OwnerRentalStatusText({status}: {status: OwnerRentalStatus | null}) {
    const color = status === "Available" ? "text-[#23834A]" : status === "Unavailable" ? "text-[#D92C3F]" : "text-[#6B6174]";
    return <span title={status === null ? "Availability data unavailable" : undefined} className={`inline-block text-[10px] font-semibold ${color}`}>{status ?? "—"}</span>;
}
type ConsumableCatalogRow = OwnerCatalogProduct & { unitsSold: number | null };
type BranchVariantUnits = { branchId: number | null; productId: number; variantId: number; unitsSold: Amount };
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
    branchVariantUnits?: BranchVariantUnits[] | null;
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
function formatPeso(value: number) {
    return value.toLocaleString("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatNumber(value: number) {
    return value.toLocaleString("en-PH", { maximumFractionDigits: 0 });
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
    loading?: boolean; tone?: "purple" | "green" | "blue" | "amber";
}) {
    const iconClassName = {
        purple: "bg-[#F3EBFF] text-[#6C3AD6]",
        green: "bg-[#EAF7F0] text-[#25865B]",
        blue: "bg-[#E8F1FF] text-[#2169CF]",
        amber: "bg-[#FFF7E9] text-[#B7832E]",
    }[tone];
    return <section aria-busy={loading} className="flex min-h-[108px] min-w-0 w-full items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm">
        {loading ? <>
            <span className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-[#EEE8F3]" aria-hidden="true"/>
            <span className="min-w-0 flex-1 space-y-2" role="status" aria-label={`Loading ${label}`}>
                <span className="block h-3.5 w-32 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                <span className="block h-6 w-24 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
                <span className="block h-2.5 w-40 max-w-full animate-pulse rounded-lg bg-[#EEE8F3]"/>
            </span>
        </> : <>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconClassName}`} aria-hidden="true">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{label}</span>
                <span className={`mt-1 block break-words text-[24px] font-bold leading-none tabular-nums ${value.startsWith("-")||value.startsWith("−")?"text-[#B42318]":"text-[#25153D]"}`}>{value}</span>
                <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{helper}</span>
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
    const [consumableStatus, setConsumableStatus] = React.useState("All Status");
    const [rentalStatus, setRentalStatus] = React.useState("All Status");
    const [consumableSearch, setConsumableSearch] = React.useState("");
    const [expandedProducts, setExpandedProducts] = React.useState<Record<string, boolean>>({});
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
        let pending = false;
        setCatalogLoading(true);
        setCatalogError("");
        setCatalogProducts(null);
        const load = async () => {
            if (pending || abort.signal.aborted) return;
            pending = true;
            try {
                const result = await ownerRequest<{ products: unknown[] }>("/api/products", {
                    action: "get_products", include_variants: true,
                }, abort.signal);
                if (!Array.isArray(result.products)) throw new Error("The product inventory API did not return a product list.");
                if (abort.signal.aborted) return;
                setCatalogProducts(result.products.map(normalizeOwnerCatalogProduct));
                setCatalogError("");
            } catch (error) {
                if (!abort.signal.aborted) setCatalogError(error instanceof Error ? error.message : "Unable to load products.");
            } finally {
                pending = false;
                if (!abort.signal.aborted) setCatalogLoading(false);
            }
        };
        void load();
        // Match Manager inventory freshness without clearing the table every poll.
        const refreshVisible = () => {
            if (document.visibilityState === "visible") void load();
        };
        const timer = window.setInterval(refreshVisible, 15_000);
        window.addEventListener("focus", refreshVisible);
        document.addEventListener("visibilitychange", refreshVisible);
        return () => {
            abort.abort();
            window.clearInterval(timer);
            window.removeEventListener("focus", refreshVisible);
            document.removeEventListener("visibilitychange", refreshVisible);
        };
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
    const activeStatus = isConsumable ? consumableStatus : rentalStatus;
    const productPerformance = new Map((consumableSource?.branchConsumables || []).map(item => [`${item.branchId}:${item.key}`, item]));
    const variantSalesAvailable = Array.isArray(consumableSource?.branchVariantUnits);
    const variantUnits = new Map((consumableSource?.branchVariantUnits || []).map(item =>
        [`${item.branchId}:${item.productId}:${item.variantId}`, item.unitsSold]));
    const soldForVariant = (product: OwnerCatalogProduct, variant: OwnerCatalogVariant): Amount => {
        if (!variantSalesAvailable || product.branchId == null) return null;
        const key = `${product.branchId}:${product.id}:${variant.id}`;
        const count = variantUnits.has(key) ? variantUnits.get(key) : 0;
        return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
    };
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
        (consumableStatus === "All Status" || ownerProductStatus(item) === consumableStatus) &&
        [item.name, item.productNumber, item.category, item.branchName,
            ...item.variants.flatMap(variant => [variant.name, variant.variantNumber])].join(" ").toLowerCase().includes(consumableSearch.toLowerCase().trim()));
    const rentalRows: RentalListRow[] = selectedBranches.flatMap(selected => {
        const data = rentalByBranch[selected.id];
        const activeItems = [...new Map((data?.items || []).filter(item => item.active).map(item => [item.id, item])).values()];
        return activeItems.map(item => ({ branchId: selected.id, branchName: selected.branchName, item }));
    });
    const categories = [...new Set(rentalRows.map(row => row.item.category))].sort((a, b) => a.localeCompare(b));
    const visibleRentals = rentalRows.filter(row =>
        (rentalCategory === "All Categories" || row.item.category === rentalCategory) &&
        (rentalStatus === "All Status" || ownerRentalStatusGroup(row.item) === rentalStatus) &&
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
    const kpiDescriptions = isConsumable
        ? ["Sales for the selected period", "Cost of items sold", "Sales less product cost", "Units sold in the selected period"]
        : ["Rental revenue for the selected period", "Current equipment stock value", "Total owned equipment units", "Units released in the selected period"];
    const exportList = (type: "consumables" | "rentals") => {
        const isRental = type === "rentals";
        if (!ready || !rangeValid || isRental === isConsumable) return;
        const title = isRental ? "Rental Equipment List" : "Consumable Product List";
        const headers = isRental ? ["Equipment No.", "Rental Product", "Category", "Branch", "Total Units", "Units Rented", "Current Status"]
            : ["Product No.", "Product", "Branch", "Category", "Available Stock", "Sold", "Current Status"];
        const rows = isRental ? visibleRentals.map(row => [row.item.equipmentNumber || "—", row.item.name, row.item.category, row.branchName,
                String(row.item.totalUnits), String(rentedUnitsFor(row) ?? "—"), ownerRentalStatusGroup(row.item) ?? "—"])
            : visibleConsumables.flatMap(item => {
                const parent = [item.productNumber || "—", item.name, item.branchName || "—", item.category || "—",
                    String(item.availableStock ?? "—"), item.variants.length ? "" : String(item.unitsSold ?? "—"), ownerProductStatus(item)];
                return [parent, ...item.variants.map(variant => [variant.variantNumber || "—", `${item.name} - ${variant.name}`,
                    item.branchName || "—", item.category || "—", String(variant.availableStock ?? "—"),
                    String(soldForVariant(item, variant) ?? "—"), ownerLineStatus(variant)])];
            });
        try {
            downloadInventoryPdf({title, headers, rows}, {
                storeName: performance?.storeName || sessionStorage.getItem("store_name") || "StockNBook", branch: activeBranchName,
                dateRange: `${activePreset} (${from} to ${to})`,
                filters: [`Category: ${activeCategory} | Current Status: ${activeStatus}`, `Stock as of: ${inventoryTodayLabel()}`],
                kpis: kpis.map((kpi, index): InventoryPdfKpi => ({ label: kpi.label, value: shownKpi(kpi),
                    tone: index === 0 ? "purple" : index === 1 ? "amber" : index === 2 ? "green" : "blue" })),
                kpiTitle: "Inventory Summary",
                summary: [isRental ? "Equipment cost and total units: current stock. Rental sales and units rented: selected dates."
                    : "Stock: current sellable units. Sales and units sold: selected dates. Unallocated adjustments excluded.",
                    ...(!isRental && visibleConsumables.some(item => item.variants.length > 0) ? [
                        "Variant rows show individual sales. Parent sold totals are omitted. Totals may include archived variants.",
                        ...(!variantSalesAvailable ? ["Variant sales unavailable; update the Products backend."] : []),
                    ] : []),
                    ...(kpis.some(kpi => kpi.value == null) ? ["- = data unavailable."] : [])],
            }, isRental ? "stocknbook_rental_equipment_list" : "stocknbook_consumable_product_list");
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
                                                      helper={kpi.value == null ? (!isConsumable && index === 3 && !Array.isArray(performance?.branchRentalUnits) && ready ? "Update Products Lambda" : "Data unavailable") : kpiDescriptions[index]}
                                                      icon={index === 0 ? (isConsumable ? <ShoppingCart size={20}/> : <Boxes size={20}/>) : index === 2 ? <BarChart3 size={20}/> : <Boxes size={20}/>}
                                                      tone={index === 1 ? "amber" : index === 3 ? "blue" : index === 2 ? "green" : "purple"}/>)}
            </div>
            {performance?.warnings?.length ? <p role="note" className="text-[11px] text-[#806A8C]">{performance.warnings.join(" ")}</p> : null}
            {activeTab === "consumable" ? <section role="tabpanel" aria-label="Consumable products" className={cardClass}>
                <div className="flex flex-col gap-3 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
                    <SectionHeading icon={<ShoppingCart/>} title="Consumable Product List" subtitle="Current sellable stock and status; units sold in the selected period"/>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterSelect label="Filter consumable category" value={consumableCategory} onChange={setConsumableCategory} width="w-[154px]">
                            <option>All Categories</option>{consumableCategories.map(category => <option key={category}>{category}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter consumable branch" value={consumableBranch} onChange={value => { setConsumableBranch(value); setConsumableCategory("All Categories"); }} width="w-[155px]">
                            <option value="">All Branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter consumable current status" value={consumableStatus} onChange={setConsumableStatus} width="w-[140px]">
                            {ownerConsumableStatusOptions.map(status => <option key={status}>{status}</option>)}
                        </FilterSelect>
                        <DatePresetFilter preset={consumablePreset} onPreset={setConsumablePreset} custom={consumableCustom} onCustom={setConsumableCustom} label="Consumable"/>
                        <ExportMenu disabled={!ready} onExport={() => exportList("consumables")}/>
                    </div>
                </div>
                <div className="px-4 pb-4">
                    <div className="relative"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                        <input aria-label="Search consumable products" value={consumableSearch} onChange={event => setConsumableSearch(event.target.value)}
                               placeholder="Search product no., product, variant, branch, or category..."
                               className="h-[44px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"/>
                    </div>
                </div>
                {consumableSource && !variantSalesAvailable && visibleConsumables.some(item => item.variants.length > 0) &&
                    <p role="status" className="border-t border-[#E9E1EE] px-4 py-2 text-[11px] text-[#806A8C]">Variant sales are unavailable. Update the Products backend.</p>}
                {consumablesError && <p role="alert" className="border-t border-[#F2C4C4] bg-[#FFF0F0] px-4 py-2 text-xs text-[#C32F2F]">{consumablesError}</p>}
                <div className={`${scrollPanel} max-h-[360px]`} role="region" aria-label="Consumable inventory list" tabIndex={0}>
                    <table className="w-full min-w-0 table-auto text-center text-[10px] xl:text-[11px] [&_th]:align-middle [&_td]:align-middle [&_td]:leading-snug">
                        <colgroup><col className="w-[16%]"/><col className="w-[20%]"/><col className="w-[15%]"/>
                            <col className="w-[15%]"/><col className="w-[12%]"/><col className="w-[10%]"/><col className="w-[12%]"/></colgroup>
                        <thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr>
                            {(["Product No.", "Product", "Branch", "Category", "Available Stock", "Sold", "Current Status"] as const).map(label => <th key={label} className={headerCell}>{label}</th>)}
                        </tr></thead>
                        <tbody>{visibleConsumables.map(row => {
                            const productKey = `${row.branchId ?? "none"}-${row.id}`;
                            const expandable = row.variants.length > 0;
                            const expanded = Boolean(expandedProducts[productKey]);
                            return <React.Fragment key={productKey}>
                                <tr className="h-12 border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]">
                                    <td className={firstBodyCell}>
                                        <div className="flex items-center gap-1.5">
                                            {expandable ? <button type="button" aria-expanded={expanded}
                                                                  aria-label={`${expanded ? "Hide" : "Show"} variants of ${row.name}`}
                                                                  onClick={() => setExpandedProducts(current => ({...current, [productKey]: !current[productKey]}))}
                                                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#5A35A5] hover:bg-[#F1EBFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5A35A5]">
                                                <ChevronDown size={13} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`}/>
                                            </button> : <span className="inline-block w-6 shrink-0" aria-hidden="true"/>}
                                            <span>{row.productNumber || "—"}</span>
                                        </div>
                                    </td>
                                    <td className="break-words px-2 py-2 font-semibold text-[#2B174C]">{row.name}</td>
                                    <td className={bodyCell}>{row.branchName || "—"}</td>
                                    <td className={bodyCell}>{row.category || "—"}</td>
                                    <td className={`${bodyCell} tabular-nums`}>{row.availableStock == null ? "—" : formatNumber(row.availableStock)}</td>
                                    <td className={`${bodyCell} tabular-nums`}>{expandable ? "" : row.unitsSold == null ? "—" : formatNumber(row.unitsSold)}</td>
                                    <td className={bodyCell}><OwnerConsumableStatusText status={ownerProductStatus(row)}/></td>
                                </tr>
                                {expandable && expanded && row.variants.map(variant => <tr key={`${productKey}-variant-${variant.id}`} className="h-10 border-b border-[#EFE8F2] bg-[#FCF9FF]">
                                    <td className="whitespace-nowrap py-2 pl-10 pr-4 text-left text-[10px] font-semibold text-[#5F3D82]" title="Variant Number">{variant.variantNumber || "—"}</td>
                                    <td className="break-words px-2 py-2 text-[10px] font-semibold text-[#5F3D82]">↳ {variant.name}</td>
                                    <td className={bodyCell}>{row.branchName || "—"}</td>
                                    <td className={bodyCell}>{row.category || "—"}</td>
                                    <td className={`${bodyCell} tabular-nums`}>{variant.availableStock == null ? "—" : formatNumber(variant.availableStock)}</td>
                                    <td className={`${bodyCell} tabular-nums`} title={!variantSalesAvailable ? "Variant sales unavailable. Update the Products backend." : undefined}>{soldForVariant(row, variant) == null ? "—" : formatNumber(soldForVariant(row, variant)!)}</td>
                                    <td className={bodyCell}><OwnerConsumableStatusText status={ownerLineStatus(variant)}/></td>
                                </tr>)}
                            </React.Fragment>;
                        })}
                        {visibleConsumables.length === 0 && (consumablesLoading ? <OwnerTableLoadingRow columns={7} label="Loading consumable products..."/> :
                            <tr><td colSpan={7} className="px-4 py-12 text-xs text-[#806A8C]">{consumablesError ? "Unable to load consumable report." : "No consumable products match these filters."}</td></tr>)}
                        </tbody>
                    </table>
                </div>
            </section> : <section role="tabpanel" aria-label="Rental equipment" className={cardClass}>
                {/* Existing authorized read-only rental hook for each selected branch. */}
                {selectedBranches.map(item => <RentalBranchFeed key={`${item.id}-${refresh}-${rentalBranch}`} branchId={item.id}
                                                                onUpdate={onRentalUpdate}/>)}
                <div className="flex flex-col gap-3 px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
                    <SectionHeading icon={<Boxes/>} title="Rental Equipment List" subtitle="Current rental availability status; units rented in the selected period"/>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterSelect label="Filter rental equipment category" value={rentalCategory} onChange={setRentalCategory} width="w-[154px]">
                            <option>All Categories</option>{categories.map(category => <option key={category}>{category}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter rental equipment branch" value={rentalBranch} onChange={value => { setRentalByBranch({}); setRentalBranch(value); setRentalCategory("All Categories"); }} width="w-[155px]">
                            <option value="">All Branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter rental current status" value={rentalStatus} onChange={setRentalStatus} width="w-[140px]">
                            {ownerRentalStatusOptions.map(status => <option key={status}>{status}</option>)}
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
                        <colgroup><col className="w-[17%]"/><col className="w-[20%]"/><col className="w-[14%]"/>
                            <col className="w-[15%]"/><col className="w-[10%]"/><col className="w-[12%]"/><col className="w-[12%]"/></colgroup>
                        <thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr>
                            {(["Equipment No.", "Rental Product", "Category", "Branch", "Total Units", "Units Rented", "Current Status"] as const)
                                .map(label => <th key={label} title={label === "Units Rented" ? "Total units released during the selected period, including repeat rentals" : undefined} className={headerCell}>{label}</th>)}
                        </tr></thead>
                        <tbody>{visibleRentals.map(row => <tr key={`${row.branchId}-${row.item.id}`} className="h-12 border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]">
                            <td className={firstBodyCell}>{row.item.equipmentNumber || "—"}</td>
                            <td className="break-words px-2 py-2 font-semibold text-[#2B174C]">{row.item.name}</td>
                            <td className={bodyCell}>{row.item.category}</td>
                            <td className={bodyCell}>{row.branchName}</td>
                            <td className={`${bodyCell} tabular-nums`}>{formatNumber(row.item.totalUnits)}</td>
                            <td className={`${bodyCell} tabular-nums`}>{rentedUnitsFor(row) == null ? "—" : formatNumber(rentedUnitsFor(row)!)}</td>
                            <td className={bodyCell}><OwnerRentalStatusText status={ownerRentalStatusGroup(row.item)}/></td>
                        </tr>)}
                        {visibleRentals.length === 0 && (rentalsLoading ? <OwnerTableLoadingRow columns={7} label="Loading rental equipment..."/> :
                            <tr><td colSpan={7} className="px-4 py-12 text-xs text-[#806A8C]">{rentalErrors.length ? "Rental inventory unavailable for the selected branches." : "No rental equipment matches these filters."}</td></tr>)}
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

// Inventory-only copy of the existing Dashboard PDF layout; dashboard source remains unchanged.
function normalizePdfText(value: string) {
    return String(value)
        .replace(/₱/g, "PHP ")
        .replace(/[–—−]/g, "-").replace(/×/g, "x").replace(/·/g, " | ")
        .replace(/•/g, "-")
        .replace(/↳/g, "-")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[^\x20-\x7E]/g, "");
}

function escapePdf(value: string) {
    return normalizePdfText(value)
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
}

function downloadFile(filename: string, mimeType: string, content: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function getPdfColumnWeight(header: string) {
    const key = header.toLowerCase();

    if (
        key.includes("product") ||
        key.includes("package") ||
        key.includes("customer") ||
        key.includes("details") ||
        key.includes("inclusion")
    ) {
        return 1.7;
    }

    if (
        key.includes("reference") ||
        key.includes("branch") ||
        key.includes("category") ||
        key.includes("suggested")
    ) {
        return 1.35;
    }

    if (key.includes("equipment no.")) return 1.45;
    if (key.includes("cost / rate")) return 1.3;
    if (key.includes("date") || key.includes("schedule")) return 1.15;
    if (key.includes("current") || key.includes("forecast")) return 1.1;
    if (key.includes("status") || key.includes("risk")) return 0.95;

    return 1;
}

function isPdfNumericColumn(header: string) {
    const key = header.toLowerCase();

    return [
        "stock",
        "level",
        "quantity",
        "sales",
        "revenue",
        "price",
        "value",
        "count",
        "added",
        "amount",
        "bookings",
        "downpayment",
        "discount",
    ].some((word) => key.includes(word));
}

function wrapPdfText(value: string, maxCharacters: number, maxLines = 3) {
    const text = normalizePdfText(value) || "-";
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (let word of words) {
        while (word.length > maxCharacters) {
            if (currentLine) {
                lines.push(currentLine);
                currentLine = "";
            }

            lines.push(word.slice(0, maxCharacters));
            word = word.slice(maxCharacters);

            if (lines.length >= maxLines) break;
        }

        if (lines.length >= maxLines) break;

        const candidate = currentLine ? `${currentLine} ${word}` : word;

        if (candidate.length <= maxCharacters) {
            currentLine = candidate;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }

        if (lines.length >= maxLines) break;
    }

    if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
    }

    const result = lines.length ? lines.slice(0, maxLines) : ["-"];

    if (
        lines.length > maxLines ||
        result.join(" ").length < text.length
    ) {
        const finalIndex = result.length - 1;
        result[finalIndex] =
            result[finalIndex].slice(0, Math.max(1, maxCharacters - 3)) + "...";
    }

    return result;
}

function formatDashboardPdfTitle(title: string) {
    const cleaned = normalizePdfText(title)
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) return "Dashboard Report";

    return cleaned
        .split(" ")
        .map((word) => {
            if (!word) return word;
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(" ");
}

/** Opt-in report layout; default dashboard/report exports retain their existing styling. */
type InventoryPdfKpi = { label: string; value: string; tone: "purple" | "green" | "blue" | "amber" | "red" };

type DashboardPdfOptions = {
    kpis?: InventoryPdfKpi[];
    kpiTitle?: string;
    filters?: string[];
    summary?: string[];
    centerColumns?: boolean;
    totalRow?: string[];
    currencyNote?: boolean;
};

function createTablePdf({
                            title,
                            storeName,
                            branch,
                            dateRange,
                            headers,
                            rows,
                            options,
                        }: {
    title: string;
    storeName: string;
    branch: string;
    dateRange: string;
    headers: string[];
    rows: string[][];
    options?: DashboardPdfOptions;
}) {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const outerMargin = 25;
    const pageInset = 24;
    const marginX = 42;
    const marginBottom = 54;
    const contentWidth = pageWidth - marginX * 2;
    const regularFont = "F1";
    const boldFont = "F2";
    const titleText = formatDashboardPdfTitle(title);
    const fontSize = headers.length >= 6 ? 7 : headers.length >= 5 ? 7.6 : 8.2;
    const headerFontSize = Math.max(7, fontSize - 0.1);
    const metaFontSize = 10.2;
    const lineHeight = fontSize + 2.8;
    const cellPaddingX = 5;
    const cellPaddingY = 5;

    const cream: [number, number, number] = [0.992, 0.98, 0.956];
    const white: [number, number, number] = [1, 1, 1];
    const purple: [number, number, number] = [0.169, 0.09, 0.298];
    const purpleText: [number, number, number] = [0.169, 0.09, 0.298];
    const ink: [number, number, number] = [0.102, 0.071, 0.125];
    const muted: [number, number, number] = [0.373, 0.306, 0.459];
    const border: [number, number, number] = [0.902, 0.866, 0.941];
    const tint: [number, number, number] = [0.976, 0.965, 0.992];
    const divider: [number, number, number] = [0.9, 0.86, 0.94];
    const altRow: [number, number, number] = [0.989, 0.984, 0.995];

    const centered = options?.centerColumns === true;
    const weights = headers.map(header => centered && header === "Weeks" ? 2.1 : centered && header === "Rank" ? 0.65 : getPdfColumnWeight(header));
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);

    let runningX = marginX;
    const columns = headers.map((header, index) => {
        const width = (contentWidth * weights[index]) / totalWeight;
        const column = {
            header,
            x: runningX,
            width,
            numeric: isPdfNumericColumn(header),
        };

        runningX += width;
        return column;
    });

    const point = (value: number) => Number(value.toFixed(2));
    const pages: string[] = [];
    let commands: string[] = [];
    let cursorY = 0;

    // Helvetica ASCII glyph widths, for exact centered alignment and wrapping.
    const regularWidths = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
    const boldWidths = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
    function measure(value: string, size: number, font: string) {
        const text = normalizePdfText(value);
        if (!centered) return text.length * size * 0.52;
        const widths = font === boldFont ? boldWidths : regularWidths;
        return Array.from(text).reduce((n,c)=>n+(widths[c.charCodeAt(0)-32] ?? 600),0)*size/1000;
    }
    function wrapCentered(value: string, width: number, size: number, font: string) {
        const text = normalizePdfText(value);
        if (!text) return [""];
        const lines: string[] = [];
        let line = "";
        for(const word of text.split(" ")) {
            if(line && measure(`${line} ${word}`,size,font)>width) {lines.push(line);line="";}
            if(measure(word,size,font)>width) {
                for(const char of word) {
                    if(line && measure(line+char,size,font)>width) {lines.push(line);line="";}
                    line+=char;
                }
            } else line=line ? `${line} ${word}` : word;
        }
        if(line) lines.push(line);
        return lines.length?lines:[""];
    }

    function addText(
        value: string,
        x: number,
        y: number,
        size: number,
        font: string,
        color: [number, number, number],
        align: "left" | "center" | "right" = "left"
    ) {
        const normalized = normalizePdfText(value);
        if (centered && !normalized) return;
        const text = normalized || "-";
        const textWidth = measure(text, size, font);
        const adjustedX =
            align === "center" ? x - textWidth / 2 : align === "right" ? x - textWidth : x;

        commands.push(
            `q ${color.join(" ")} rg BT /${font} ${point(size)} Tf 1 0 0 1 ${point(
                adjustedX
            )} ${point(y)} Tm (${escapePdf(text)}) Tj ET Q`
        );
    }

    function fillRect(
        x: number,
        y: number,
        width: number,
        height: number,
        color: [number, number, number]
    ) {
        commands.push(
            `q ${color.join(" ")} rg ${point(x)} ${point(y)} ${point(width)} ${point(
                height
            )} re f Q`
        );
    }

    function strokeRect(
        x: number,
        y: number,
        width: number,
        height: number,
        color: [number, number, number],
        lineWidth = 0.7
    ) {
        commands.push(
            `q ${color.join(" ")} RG ${point(lineWidth)} w ${point(x)} ${point(y)} ${point(
                width
            )} ${point(height)} re S Q`
        );
    }

    function drawDivider(y: number, color: [number, number, number] = divider, lineWidth = 0.7) {
        commands.push(
            `q ${color.join(" ")} RG ${point(lineWidth)} w ${point(marginX)} ${point(y)} m ${point(
                pageWidth - marginX
            )} ${point(y)} l S Q`
        );
    }

    function wrapCellText(value: string, columnWidth: number, linesLimit = 4) {
        const headerTightness = headers.length >= 6 ? 0.94 : 1;
        const maxCharacters = Math.max(
            4,
            Math.floor(((columnWidth - cellPaddingX * 2) / (fontSize * 0.52)) * headerTightness)
        );
        return wrapPdfText(value, maxCharacters, linesLimit);
    }

    function drawTableHeader() {
        const headerLines = headers.map((header, index) => {
            const limit = Math.max(
                4,
                Math.floor((columns[index].width - cellPaddingX * 2) / (headerFontSize * 0.52))
            );
            return centered ? wrapCentered(header, columns[index].width - cellPaddingX * 2, headerFontSize, boldFont) : wrapPdfText(header, limit, 3);
        });
        const headerLineCount = Math.max(...headerLines.map((lines) => lines.length));
        const headerHeight = Math.max(26, headerLineCount * (headerFontSize + 2) + cellPaddingY * 2);
        const bottomY = cursorY - headerHeight;

        fillRect(marginX, bottomY, contentWidth, headerHeight, tint);
        strokeRect(marginX, bottomY, contentWidth, headerHeight, border, 0.75);

        columns.forEach((column, index) => {
            if (index > 0) {
                commands.push(
                    `q ${border.join(" ")} RG 0.45 w ${point(column.x)} ${point(bottomY)} m ${point(
                        column.x
                    )} ${point(cursorY)} l S Q`
                );
            }

            const lines = headerLines[index];
            lines.forEach((line, lineIndex) => {
                const textWidth = line.length * headerFontSize * 0.52;
                const textX = centered ? column.x + column.width / 2 : column.numeric
                    ? column.x + column.width - cellPaddingX - textWidth
                    : column.x + cellPaddingX;
                const baseline = centered ? cursorY - (headerHeight - lines.length*(headerFontSize+2))/2 - headerFontSize : cursorY - cellPaddingY - headerFontSize;
                addText(line, textX, baseline - lineIndex*(headerFontSize+2), headerFontSize, boldFont, purpleText, centered ? "center" : "left");
            });
        });

        cursorY = bottomY;
    }

    function drawPageTitle(continued: boolean) {
        const cardX = outerMargin;
        const cardY = pageInset;
        const cardWidth = pageWidth - outerMargin * 2;
        const cardHeight = pageHeight - pageInset * 2;

        fillRect(0, 0, pageWidth, pageHeight, cream);
        fillRect(cardX, cardY, cardWidth, cardHeight, white);
        fillRect(cardX, pageHeight - pageInset - 6, cardWidth, 6, purple);

        let topY = pageHeight - 58;
        addText(storeName || "Store", pageWidth / 2, topY, 21, boldFont, purpleText, "center");
        topY -= 17;

        if (branch) {
            addText(`Branch: ${branch}`, pageWidth / 2, topY, 11.5, boldFont, purpleText, "center");
            topY -= 16;
        }

        for (const line of wrapCentered(`Date range: ${dateRange}`, contentWidth, metaFontSize, regularFont)) {
            addText(line, pageWidth / 2, topY, metaFontSize, regularFont, muted, "center"); topY -= 12;
        }
        for (const filter of options?.filters || []) {
            for (const line of wrapCentered(filter, contentWidth, 9, regularFont)) {
                addText(line, pageWidth / 2, topY, 9, regularFont, muted, "center"); topY -= 11;
            }
        }
        drawDivider(topY, border, 0.7);

        topY -= continued ? 24 : 28;
        addText(
            continued ? `${titleText} (continued)` : titleText,
            pageWidth / 2,
            topY,
            continued ? 16 : 18,
            boldFont,
            purpleText,
            "center"
        );

        topY -= 16;
        addText(
            rows.length
                ? `${rows.length.toLocaleString("en-PH")} row(s) exported${options?.currencyNote ? " | Amounts in Philippine pesos" : ""}`
                : "No records available for the selected period",
            pageWidth / 2,
            topY,
            9,
            regularFont,
            muted,
            "center"
        );

        if (options?.kpis?.length) {
            topY -= 22;
            addText(options.kpiTitle || "Inventory Summary", pageWidth / 2, topY, 11, boldFont, purpleText, "center");
            const gap = 8;
            const width = (contentWidth - gap * (options.kpis.length - 1)) / options.kpis.length;
            const colors: Record<InventoryPdfKpi["tone"], [number, number, number]> = {
                purple: [0.424, 0.227, 0.839], green: [0.145, 0.525, 0.357],
                blue: [0.129, 0.412, 0.812], amber: [0.718, 0.514, 0.18], red: [0.812, 0.2, 0.282],
            };
            const backgrounds: Record<InventoryPdfKpi["tone"], [number, number, number]> = {
                purple: [0.974, 0.955, 0.995], green: [0.95, 0.982, 0.963],
                blue: [0.95, 0.973, 0.998], amber: [0.995, 0.979, 0.945], red: [0.998, 0.951, 0.956],
            };
            const labelSize = 9;
            const labelStep = 11;
            const valueWidth = width - 16;
            // Preserve complete monetary values; shrink long amounts rather than truncating them.
            const valueSize = Math.max(9, Math.min(15, ...options.kpis.map(kpi =>
                15 * (valueWidth - 1) / Math.max(1, measure(kpi.value, 15, boldFont)))));
            const valueStep = valueSize + 3;
            const cards = options.kpis.map(kpi => ({ ...kpi,
                labels: wrapCentered(kpi.label, valueWidth, labelSize, boldFont),
                values: wrapCentered(kpi.value, valueWidth, valueSize, boldFont),
            }));
            const labelHeight = Math.max(2, ...cards.map(card => card.labels.length)) * labelStep;
            const valueHeight = Math.max(1, ...cards.map(card => card.values.length)) * valueStep;
            const height = 10 + labelHeight + 5 + valueHeight + 10;
            const cardTop = topY - 12;
            const bottom = cardTop - height;
            cards.forEach((card, index) => {
                const x = marginX + index * (width + gap);
                fillRect(x, bottom, width, height, backgrounds[card.tone]);
                strokeRect(x, bottom, width, height, border, 0.7);
                fillRect(x, cardTop - 2.5, width, 2.5, colors[card.tone]);
                // Center each label and value in their own fixed-height band.
                const labelCenter = cardTop - 10 - labelHeight / 2;
                const valueCenter = cardTop - 10 - labelHeight - 5 - valueHeight / 2;
                const firstLabel = labelCenter + (card.labels.length - 1) * labelStep / 2 - labelSize * 0.32;
                const firstValue = valueCenter + (card.values.length - 1) * valueStep / 2 - valueSize * 0.32;
                const valueColor = /^[-−]\s*\d/.test(card.value) || /^[-−]\s*(₱|PHP)/.test(card.value) ? colors.red : purpleText;
                card.labels.forEach((line, i) => addText(line, x + width / 2, firstLabel - i * labelStep, labelSize, boldFont, muted, "center"));
                card.values.forEach((line, i) => addText(line, x + width / 2, firstValue - i * valueStep, valueSize, boldFont, valueColor, "center"));
            });
            topY = bottom - 4;
        }

        for (const summary of options?.summary || []) {
            topY -= 12;
            const lines = wrapCentered(summary, contentWidth, 8.5, regularFont);
            for (const [index, line] of lines.entries()) {
                addText(line, pageWidth / 2, topY, 8.5, regularFont, muted, "center");
                if (index < lines.length - 1) topY -= 10;
            }
        }
        cursorY = topY - 18;
        drawTableHeader();
    }

    function finishPage() {
        if (commands.length > 0) {
            pages.push(commands.join("\n"));
            commands = [];
        }
    }

    function startPage(continued: boolean) {
        if (commands.length > 0) finishPage();
        drawPageTitle(continued);
    }

    function drawTableRow(row: string[], rowIndex: number, isTotal = false) {
        const rowFont = isTotal ? boldFont : regularFont;
        const cellLines = columns.map((column, index) => centered
            ? wrapCentered(row[index] ?? "-", column.width - cellPaddingX * 2, fontSize, rowFont)
            : wrapCellText(row[index] ?? "-", column.width, headers.length >= 6 ? 5 : 4)
        );
        const maxLines = Math.max(...cellLines.map((lines) => lines.length));
        const rowHeight = Math.max(24, maxLines * lineHeight + cellPaddingY * 2);

        if (cursorY - rowHeight < marginBottom + 30) {
            startPage(true);
        }

        const rowBottom = cursorY - rowHeight;
        fillRect(marginX, rowBottom, contentWidth, rowHeight, isTotal ? tint : rowIndex % 2 === 0 ? white : altRow);
        strokeRect(marginX, rowBottom, contentWidth, rowHeight, border, 0.45);

        columns.forEach((column, index) => {
            if (index > 0) {
                commands.push(
                    `q ${border.join(" ")} RG 0.3 w ${point(column.x)} ${point(rowBottom)} m ${point(
                        column.x
                    )} ${point(cursorY)} l S Q`
                );
            }

            cellLines[index].forEach((line, lineIndex) => {
                const textWidth = line.length * fontSize * 0.52;
                const textX = centered ? column.x + column.width / 2 : column.numeric
                    ? column.x + column.width - cellPaddingX - textWidth
                    : column.x + cellPaddingX;
                const baseline = centered ? cursorY - (rowHeight - cellLines[index].length*lineHeight)/2 - fontSize : cursorY - cellPaddingY - fontSize;
                addText(line, textX, baseline - lineIndex*lineHeight, fontSize, rowFont, isTotal ? purpleText : ink, centered ? "center" : "left");
            });
        });

        cursorY = rowBottom;
    }

    startPage(false);

    if (rows.length === 0) {
        addText(
            "No records found for the selected report period.",
            pageWidth / 2,
            cursorY - 26,
            10,
            regularFont,
            muted,
            "center"
        );
    } else {
        rows.forEach((row, index) => drawTableRow(row, index));
        if (options?.totalRow) drawTableRow(options.totalRow, rows.length, true);
    }

    finishPage();

    const pageStreams = pages.map((stream, index) => {
        const footerText = `Powered by StockNBook | Page ${index + 1} of ${pages.length}`;
        return `${stream}
q ${divider.join(" ")} RG 0.6 w ${point(marginX)} 42 m ${point(
            pageWidth - marginX
        )} 42 l S Q
q ${muted.join(" ")} rg BT /F1 8 Tf 1 0 0 1 ${point(
            pageWidth / 2 - footerText.length * 2.05
        )} 26 Tm (${escapePdf(footerText)}) Tj ET Q`;
    });

    const pageObjectIds = pageStreams.map((_, index) => 5 + index * 2);
    const contentObjectIds = pageStreams.map((_, index) => 6 + index * 2);

    const objects: Record<number, string> = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: `<< /Type /Pages /Kids [${pageObjectIds
            .map((id) => `${id} 0 R`)
            .join(" ")}] /Count ${pageObjectIds.length} >>`,
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    };

    pageStreams.forEach((stream, index) => {
        const pageId = pageObjectIds[index];
        const contentId = contentObjectIds[index];

        objects[pageId] =
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
            `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;

        objects[contentId] = `<< /Length ${stream.length} >>
stream
${stream}
endstream`;
    });

    const maxObjectId = Math.max(...Object.keys(objects).map(Number));
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [0];

    for (let id = 1; id <= maxObjectId; id += 1) {
        offsets[id] = pdf.length;
        pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${maxObjectId + 1}\n`;
    pdf += "0000000000 65535 f \n";

    for (let id = 1; id <= maxObjectId; id += 1) {
        pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF`;

    return pdf;
}


function downloadInventoryPdf(table: { title: string; headers: string[]; rows: string[][] }, context: {
    storeName: string; branch: string; dateRange: string; filters?: string[]; summary?: string[]; kpis?: InventoryPdfKpi[]; kpiTitle?: string;
}, filename: string) {
    const pdf = createTablePdf({ ...table, storeName: context.storeName, branch: context.branch,
        dateRange: context.dateRange, options: { centerColumns: true, filters: context.filters, summary: context.summary, kpis: context.kpis, kpiTitle: context.kpiTitle } });
    downloadFile(`${filename.replace(/\.pdf$/i, "")}.pdf`, "application/pdf", pdf);
}
function inventoryTodayLabel() {
    return `Today (${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" })})`;
}
