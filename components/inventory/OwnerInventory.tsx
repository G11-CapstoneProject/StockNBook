"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import {
    BarChart3, Boxes, CalendarDays, ChevronDown,
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
    totals: { consumableSales: Amount; consumableGrossProfit: Amount; rentalRevenue: Amount; totalRevenue: Amount };
    trend: TrendPoint[];
    branchRevenue: BranchRevenue[];
    consumables: ConsumablePerformance[];
    rentals: RentalPerformance[];
    warnings: string[];
};
type DateRange = { startDate: string; endDate: string };
type RentalBranchData = {
    items: RentalEquipment[];
    loading: boolean;
    error: string;
    availability: Map<number, number> | null;
    reserved: Map<number, number> | null;
    availabilityLoading: boolean;
    availabilityError: string;
};
type RentalListRow = { branchId: number; branchName: string; item: RentalEquipment; reservedOnDates: number | null };

const cardClass = "min-w-0 overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm";
const scrollPanel = "min-h-0 w-full overflow-auto overscroll-contain border-t border-[#E9E1EE]";
const headerCell = "px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
const bodyCell = "px-2 py-2 text-center text-xs text-[#4F3A5A]";
const firstBodyCell = "px-4 py-2 text-left text-xs font-semibold text-[#2B174C]";
const compactControl = "h-9 min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] shadow-sm outline-none focus:border-[#BFA8E2] focus-visible:ring-2 focus-visible:ring-[#F1EBFF]";

function businessDateString() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
}
function monthToDateRange(): DateRange {
    const today = businessDateString();
    return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
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
function validDateRange(start: string, end: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return false;
    const startDay = Date.parse(`${start}T00:00:00Z`);
    const endDay = Date.parse(`${end}T00:00:00Z`);
    return Number.isFinite(startDay) && Number.isFinite(endDay) &&
        new Date(startDay).toISOString().slice(0, 10) === start && new Date(endDay).toISOString().slice(0, 10) === end;
}
function validAvailabilityDates(start: string, end: string) {
    // The Owner can review historical booking dates as well as future reservations.
    // Keep the existing limit on the width of one request, but never reject past dates.
    return validDateRange(start, end) &&
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 <= 366;
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
    return <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[#F1EBFF] text-[#5A35A5] [&>svg]:h-[19px] [&>svg]:w-[19px]">{icon}</span>
        <div className="min-w-0"><h2 className="text-[15px] font-bold text-[#21132E]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] leading-4 text-[#86778F]">{subtitle}</p>}</div>
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
    return <article aria-busy={loading} className="flex min-h-[142px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm">
        {loading ? <>
            <span className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-[#EEE8F3]" aria-hidden="true"/>
            <span className="min-w-0 flex-1 space-y-3"><span className="block h-3 w-32 rounded bg-[#EEE8F3]"/><span className="block h-7 w-24 rounded bg-[#EEE8F3]"/></span>
        </> : <>
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconClassName}`}>{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">{label}</span>
                <span className="mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1A1220] tabular-nums">{value}</span>
                <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{helper}</span>
            </span>
        </>}
    </article>;
}
function OwnerTableLoadingRow({ columns, label }: { columns: number; label: string }) {
    return <tr><td colSpan={columns} className="px-4 py-10 text-center text-xs text-[#86778F]" role="status">{label}</td></tr>;
}
function FilterSelect({ value, onChange, label, children, width = "w-[145px]" }: {
    value: string; onChange: (value: string) => void; label: string; children: React.ReactNode; width?: string;
}) {
    return <span className={`relative inline-flex shrink-0 ${width}`}>
        <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}
                className={`${compactControl} w-full appearance-none pl-3 pr-8`}>{children}</select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-2.5 text-[#806A8C]"/>
    </span>;
}
function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (format: "xlsx" | "pdf") => void }) {
    return <details className="relative"><summary aria-label="Download filtered inventory list" title="Download PDF or Excel"
                                                  className={`${compactControl} flex w-9 cursor-pointer list-none items-center justify-center !px-0 [&::-webkit-details-marker]:hidden`}><Download size={16}/></summary>
        <div className="absolute right-0 top-full z-40 mt-1 w-36 rounded-xl border border-[#E3D8EA] bg-white p-1 shadow-lg">
            {(["xlsx", "pdf"] as const).map(format => <button type="button" key={format} disabled={disabled}
                                                              onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); onExport(format); }}
                                                              className="block w-full rounded px-3 py-2 text-left text-xs text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-40">
                {format === "xlsx" ? "Excel (.xlsx)" : "PDF (.pdf)"}</button>)}
        </div>
    </details>;
}

// Uses the EXISTING authorized owner read on the rental Lambda through the
// working rental hook. This does not add or modify any backend inventory action.
// Each branch has its own hook because hooks cannot be called inside a loop.
function RentalBranchFeed({ branchId, from, to, onUpdate }: {
    branchId: number; from: string; to: string;
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
    // Avoid repeated availability queries if the hook returns a new callback after
    // an unrelated parent render. The latest authorized function remains in this ref.
    const checkAvailabilityRef = React.useRef(rental.checkAvailability);
    checkAvailabilityRef.current = rental.checkAvailability;
    React.useEffect(() => {
        if (!rental.connected || rental.loading) return;
        if (!validAvailabilityDates(from, to)) {
            onUpdate(branchId, { availability: null, reserved: null, availabilityLoading: false,
                availabilityError: "Choose a valid date range (past, present, or future) up to 366 days." });
            return;
        }
        let active = true;
        onUpdate(branchId, { availability: null, reserved: null, availabilityLoading: true, availabilityError: "" });
        void checkAvailabilityRef.current(from, to).then(rows => {
            if (active) onUpdate(branchId, {
                availability: new Map(rows.map(row => [row.equipmentId, row.availableUnits])),
                reserved: new Map(rows.map(row => [row.equipmentId, row.reservedUnits])),
                availabilityLoading: false, availabilityError: "",
            });
        }).catch(error => {
            if (active) onUpdate(branchId, { availability: null, reserved: null, availabilityLoading: false,
                availabilityError: error instanceof Error ? error.message : "Date availability unavailable." });
        });
        return () => { active = false; };
    }, [branchId, from, to, rental.connected, rental.loading, onUpdate]);
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
    const [salesRange, setSalesRange] = React.useState<DateRange>(monthToDateRange);
    const [from, setFrom] = React.useState(businessDateString);
    const [to, setTo] = React.useState(businessDateString);
    const [rentalCategory, setRentalCategory] = React.useState("All Categories");
    const [consumableSearch, setConsumableSearch] = React.useState("");
    const [rentalSearch, setRentalSearch] = React.useState("");
    const [refresh, setRefresh] = React.useState(0);
    const [performance, setPerformance] = React.useState<OwnerPerformance | null>(null);
    const [branchPerformance, setBranchPerformance] = React.useState<OwnerPerformance | null>(null);
    const [branchPerformanceLoading, setBranchPerformanceLoading] = React.useState(false);
    const [branchPerformanceError, setBranchPerformanceError] = React.useState("");
    const [branches, setBranches] = React.useState<Branch[] | null>(null);
    const [performanceLoading, setPerformanceLoading] = React.useState(true);
    const [performanceError, setPerformanceError] = React.useState("");
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

    // Existing sales aggregation: totals are genuine recorded sales and rental revenue,
    // NOT inventory value or COGS (the supplied API has no rental cost-of-sales total).
    React.useEffect(() => {
        if (!validDateRange(salesRange.startDate, salesRange.endDate)) {
            setPerformance(null); setPerformanceError("Select a valid sales date range."); setPerformanceLoading(false);
            return;
        }
        const abort = new AbortController();
        setPerformanceLoading(true); setPerformanceError(""); setPerformance(null);
        void ownerRequest<{ performance: OwnerPerformance }>("/api/products", {
            action: "get_owner_inventory_performance", date_from: salesRange.startDate,
            date_to: salesRange.endDate,
        }, abort.signal).then(result => {
            if (!result.performance || !Array.isArray(result.performance.branches)) throw new Error("Owner inventory sales data is unavailable.");
            if (abort.signal.aborted) return;
            setPerformance(result.performance);
            setBranches(previous => JSON.stringify(previous) === JSON.stringify(result.performance.branches) ? previous : result.performance.branches);
        }).catch(error => { if (!abort.signal.aborted) setPerformanceError(error instanceof Error ? error.message : "Unable to load sales totals."); })
            .finally(() => { if (!abort.signal.aborted) setPerformanceLoading(false); });
        return () => abort.abort();
    }, [salesRange.startDate, salesRange.endDate, refresh]);
    // A separate read keeps the Consumable table's Branch filter independent of
    // the three store-wide sales cards and of the Rental table's Branch filter.
    React.useEffect(() => {
        if (!consumableBranch) {
            setBranchPerformance(null); setBranchPerformanceError(""); setBranchPerformanceLoading(false);
            return;
        }
        if (!validDateRange(salesRange.startDate, salesRange.endDate)) {
            setBranchPerformance(null); setBranchPerformanceError("Select a valid sales date range.");
            setBranchPerformanceLoading(false); return;
        }
        const abort = new AbortController();
        setBranchPerformanceLoading(true); setBranchPerformanceError(""); setBranchPerformance(null);
        void ownerRequest<{ performance: OwnerPerformance }>("/api/products", {
            action: "get_owner_inventory_performance", date_from: salesRange.startDate,
            date_to: salesRange.endDate, branch_id: Number(consumableBranch),
        }, abort.signal).then(result => {
            if (!result.performance || !Array.isArray(result.performance.consumables))
                throw new Error("Branch consumable report is unavailable.");
            if (!abort.signal.aborted) setBranchPerformance(result.performance);
        }).catch(error => {
            if (!abort.signal.aborted) setBranchPerformanceError(error instanceof Error ? error.message : "Unable to load branch consumables.");
        }).finally(() => { if (!abort.signal.aborted) setBranchPerformanceLoading(false); });
        return () => abort.abort();
    }, [consumableBranch, salesRange.startDate, salesRange.endDate, refresh]);
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
    const consumableSource = consumableBranch ? branchPerformance : performance;
    const consumablesLoading = catalogLoading || (consumableBranch ? branchPerformanceLoading : performanceLoading);
    const salesError = consumableBranch ? branchPerformanceError : performanceError;
    const consumablesError = [catalogError, salesError].filter(Boolean).join(" · ");
    const consumableBranchName = consumableBranch
        ? branches?.find(item => String(item.id) === consumableBranch)?.branchName || "Selected branch"
        : "All branches";
    const rentalBranchName = rentalBranch
        ? branches?.find(item => String(item.id) === rentalBranch)?.branchName || "Selected branch"
        : "All branches";
    const selectedLabel = salesRange.startDate === salesRange.endDate ? shortDate(salesRange.startDate) :
        `${shortDate(salesRange.startDate)} – ${shortDate(salesRange.endDate)}`;
    // Match sales by the saved product ID, never by name (names may repeat across branches).
    // Products without sales in the selected period remain visible with Sold = 0.
    // If sales failed to load, show an unknown Sold value instead of pretending it is zero.
    const soldByProduct = new Map((consumableSource?.consumables || [])
        .filter(item => /^product:\d+$/.test(item.key))
        .map(item => [Number(item.key.slice("product:".length)), item.unitsSold]));
    const consumables: ConsumableCatalogRow[] = (catalogProducts || []).map(product => ({
        ...product,
        unitsSold: !consumableSource ? null : (soldByProduct.get(product.id) ?? 0),
    }));
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
        return (data?.items || []).filter(item => item.active).map(item => ({
            branchId: selected.id, branchName: selected.branchName, item,
            reservedOnDates: data?.reserved?.get(item.id) ?? null,
        }));
    });
    const categories = [...new Set(rentalRows.map(row => row.item.category))].sort((a, b) => a.localeCompare(b));
    const visibleRentals = rentalRows.filter(row =>
        (rentalCategory === "All Categories" || row.item.category === rentalCategory) &&
        [row.item.equipmentNumber, row.item.name, row.item.category, row.branchName]
            .join(" ").toLowerCase().includes(rentalSearch.toLowerCase().trim()));
    const rentalsLoading = selectedBranches.some(selected =>
        rentalByBranch[selected.id]?.loading !== false || rentalByBranch[selected.id]?.availabilityLoading === true);
    const rentalErrors = selectedBranches.flatMap(selected => {
        const data = rentalByBranch[selected.id];
        return [data?.error, data?.availabilityError].filter(Boolean).map(message => `${selected.branchName}: ${message}`);
    });
    const availabilityValid = validAvailabilityDates(from, to);

    const exportList = (format: "xlsx" | "pdf", type: "consumables" | "rentals") => {
        const consumableTable: OwnerReportTable = {
            headers: ["Product No.", "Product", "Branch", "Category", "Available Stock", "Sold"],
            rows: visibleConsumables.map(item => [item.productNumber || "—", item.name,
                item.branchName || "—", item.category || "—",
                item.availableStock == null ? "—" : item.availableStock,
                item.unitsSold == null ? "—" : item.unitsSold]),
            columnWidths: [150, 190, 118, 125, 108, 85], moneyColumns: [],
        };
        const rentalTable: OwnerReportTable = {
            headers: ["Equipment No.", "Rental Product", "Category", "Branch", "Total Units", "Rented Booking"],
            rows: visibleRentals.map(row => [row.item.equipmentNumber, row.item.name, row.item.category, row.branchName,
                row.item.totalUnits, row.reservedOnDates == null ? "—" : row.reservedOnDates]),
            columnWidths: [165, 180, 112, 105, 90, 105], moneyColumns: [],
        };
        const isRental = type === "rentals";
        const report = isRental ? rentalTable : consumableTable;
        const details: OwnerReportDetails = {
            title: isRental ? "Rental Equipment List" : "Consumable Product List",
            fileTag: isRental ? "Rental_Equipment_List" : "Consumable_Product_List",
            sheetName: isRental ? "Rental Inventory" : "Consumable Inventory",
            storeName: performance?.storeName || sessionStorage.getItem("store_name") || "StockNBook",
            branchName: isRental ? rentalBranchName : consumableBranchName, generatedAt: new Date(),
            filters: isRental ? ["Branch: " + rentalBranchName, "Category: " + rentalCategory,
                    `Booking dates: ${from} to ${to}`, `Search: ${rentalSearch || "All"}`,
                    from < businessDateString()
                        ? "Past dates: peak units recorded against rental bookings, including completed returns; today/future: confirmed reservations not yet released. Total Units is current stock, not historical stock."
                        : "Rented Booking = peak confirmed reserved units not yet released during the selected dates"] :
                ["Branch: " + consumableBranchName, "Category: " + consumableCategory,
                    `Sold dates: ${selectedLabel}`, `Search: ${consumableSearch || "All"}`,
                    "Available Stock is today's sellable stock; Sold is the selected period's completed POS units"],
        };
        try {
            if (format === "pdf") exportOwnerTablePdf(report, details);
            else exportOwnerTableExcel(report, details);
        } catch (error) {
            setNotice(error instanceof Error ? `Export failed: ${error.message}` : "Unable to export list.");
        }
    };

    return <div className="min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
        {/* Existing manager-style Inventory header and card treatment. */}
        <header className="sticky top-0 z-20 flex min-h-[74px] flex-wrap items-center justify-between gap-4 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 px-6 py-3 backdrop-blur">
            <div><h1 className="text-[25px] font-bold">Inventory</h1><p className="mt-0.5 text-xs text-[#766983]">View consumable products and rental equipment across your branches.</p></div>
            <div className="flex flex-wrap items-center gap-2.5">
                <time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{clock || "Asia/Manila"}</time>
                <button type="button" onClick={() => { setRentalByBranch({}); setRefresh(value => value + 1); }}
                        className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"><RefreshCw size={16}/>Refresh</button>
            </div>
        </header>
        <main className="space-y-4 px-5 py-5">
            {/* Match the Manager/Staff rental-consumable switch; each tab has its own filters. */}
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#E8E1EF] bg-[#F5F2FF] px-5 py-5 shadow-sm">
                <div className="flex min-w-0 items-center gap-4">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#F1EBFF] text-[#5A35A5]">
                        {activeTab === "consumable" ? <ShoppingCart size={25}/> : <CalendarDays size={25}/>}
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-[24px] font-bold leading-7 text-[#21132E]">{activeTab === "consumable" ? "Consumable Inventory" : "Rental Inventory"}</h2>
                        <p className="mt-1 text-xs text-[#86778F]">{activeTab === "consumable"
                            ? "Read-only product stock and sold units across branches."
                            : "Read-only rental equipment and confirmed booking reservations across branches."}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3" role="tablist" aria-label="Inventory type">
                    <button type="button" role="tab" aria-selected={activeTab === "consumable"} onClick={() => setActiveTab("consumable")}
                            className={`inline-flex h-11 min-w-[155px] items-center justify-center gap-2 rounded-xl border px-5 text-sm font-semibold shadow-sm ${activeTab === "consumable" ? "border-[#2B174C] bg-[#2B174C] text-white" : "border-[#E3D8EA] bg-white text-[#2B174C] hover:bg-[#FCFAFF]"}`}>
                        <ShoppingCart size={17}/> Consumable
                    </button>
                    <button type="button" role="tab" aria-selected={activeTab === "rental"} onClick={() => setActiveTab("rental")}
                            className={`inline-flex h-11 min-w-[155px] items-center justify-center gap-2 rounded-xl border px-5 text-sm font-semibold shadow-sm ${activeTab === "rental" ? "border-[#2B174C] bg-[#2B174C] text-white" : "border-[#E3D8EA] bg-white text-[#2B174C] hover:bg-[#FCFAFF]"}`}>
                        <CalendarDays size={17}/> Rental
                    </button>
                </div>
            </section>
            {performanceError && <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] p-3 text-xs text-[#C32F2F]">{performanceError}</p>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard label="Total Sales" value={shownMoney(performance?.totals.totalRevenue)} loading={performanceLoading}
                            helper={`Consumable sales + rental revenue · ${selectedLabel}`} icon={<BarChart3 size={20}/>}/>
                <MetricCard label="Consumable Sales" value={shownMoney(performance?.totals.consumableSales)} loading={performanceLoading}
                            helper={`Recorded consumable sales · ${selectedLabel}`} icon={<ShoppingCart size={20}/>} tone="green"/>
                <MetricCard label="Rental Sales" value={shownMoney(performance?.totals.rentalRevenue)} loading={performanceLoading}
                            helper={`Recorded rental revenue · ${selectedLabel}`} icon={<Boxes size={20}/>} tone="blue"/>
            </div>
            {performance?.warnings?.length ? <p role="note" className="text-[11px] text-[#806A8C]">{performance.warnings.join(" ")}</p> : null}
            {activeTab === "consumable" ? <section role="tabpanel" aria-label="Consumable products" className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                    <SectionHeading icon={<ShoppingCart/>} title="Consumable Product List" subtitle="All registered products, current available stock, and units sold in the selected period"/>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterSelect label="Filter consumable category" value={consumableCategory} onChange={setConsumableCategory} width="w-[154px]">
                            <option>All Categories</option>{consumableCategories.map(category => <option key={category}>{category}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter consumable branch" value={consumableBranch} onChange={value => { setConsumableBranch(value); setConsumableCategory("All Categories"); }} width="w-[155px]">
                            <option value="">All Branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
                        </FilterSelect>
                        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5F4E75]">From
                            <input aria-label="Consumable sold start date" className={`${compactControl} w-[138px]`} type="date" value={salesRange.startDate}
                                   max={salesRange.endDate || undefined} onChange={event => setSalesRange(prev => ({ ...prev, startDate: event.target.value }))}/>
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5F4E75]">To
                            <input aria-label="Consumable sold end date" className={`${compactControl} w-[138px]`} type="date" value={salesRange.endDate}
                                   min={salesRange.startDate || undefined} onChange={event => setSalesRange(prev => ({ ...prev, endDate: event.target.value }))}/>
                        </label>
                        <ExportMenu disabled={consumablesLoading || catalogProducts === null || !consumableSource || !validDateRange(salesRange.startDate,salesRange.endDate)} onExport={format => exportList(format, "consumables")}/>
                    </div>
                </div>
                <div className="px-4 py-3">
                    <div className="relative"><Search size={16} className="absolute left-3 top-3 text-[#9B8AAA]"/>
                        <input aria-label="Search consumable products" value={consumableSearch} onChange={event => setConsumableSearch(event.target.value)}
                               placeholder="Search product no., product, branch, or category..."
                               className="h-10 w-full rounded-xl border border-[#E3D8EA] bg-white pl-10 pr-3 text-xs text-[#2B174C] outline-none focus:border-[#BFA8E2]"/>
                    </div>
                </div>
                {consumablesError && <p role="alert" className="border-t border-[#F2C4C4] bg-[#FFF0F0] px-4 py-2 text-xs text-[#C32F2F]">{consumablesError}</p>}
                <div className={`${scrollPanel} h-[440px]`} role="region" aria-label="Consumable inventory list" tabIndex={0}>
                    <table className="w-full min-w-[800px] table-fixed text-center text-xs">
                        <colgroup><col className="w-[19%]"/><col className="w-[22%]"/><col className="w-[17%]"/>
                            <col className="w-[16%]"/><col className="w-[15%]"/><col className="w-[11%]"/></colgroup>
                        <thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr>
                            {(["Product No.", "Product", "Branch", "Category", "Available Stock", "Sold"] as const).map(label => <th key={label} className={headerCell}>{label}</th>)}
                        </tr></thead>
                        <tbody>{visibleConsumables.map(row => <tr key={`${row.branchId ?? "none"}-${row.id}`} className="border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]">
                            <td className={`${firstBodyCell} break-all`}>{row.productNumber || "—"}</td>
                            <td className={bodyCell}>{row.name}</td>
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
                {selectedBranches.map(item => <RentalBranchFeed key={`${item.id}-${refresh}`} branchId={item.id}
                                                                from={from} to={to} onUpdate={onRentalUpdate}/>)}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                    <SectionHeading icon={<Boxes/>} title="Rental Equipment List" subtitle="Total owned units and confirmed booking reservations for the selected dates"/>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterSelect label="Filter rental equipment category" value={rentalCategory} onChange={setRentalCategory} width="w-[154px]">
                            <option>All Categories</option>{categories.map(category => <option key={category}>{category}</option>)}
                        </FilterSelect>
                        <FilterSelect label="Filter rental equipment branch" value={rentalBranch} onChange={value => { setRentalBranch(value); setRentalCategory("All Categories"); }} width="w-[155px]">
                            <option value="">All Branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
                        </FilterSelect>
                        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5F4E75]">From
                            <input aria-label="Rental booking start date" type="date" value={from}
                                   max={to || undefined} className={`${compactControl} w-[138px]`} onChange={event => setFrom(event.target.value)}/>
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5F4E75]">To
                            <input aria-label="Rental booking end date" type="date" min={from || undefined} value={to}
                                   className={`${compactControl} w-[138px]`} onChange={event => setTo(event.target.value)}/>
                        </label>
                        <ExportMenu disabled={rentalsLoading || selectedBranches.length === 0 || !availabilityValid || rentalErrors.length > 0} onExport={format => exportList(format, "rentals")}/>
                    </div>
                </div>
                <div className="px-4 py-3"><div className="relative"><Search size={16} className="absolute left-3 top-3 text-[#9B8AAA]"/>
                    <input aria-label="Search rental equipment" value={rentalSearch} onChange={event => setRentalSearch(event.target.value)}
                           placeholder="Search equipment no., rental product, branch, or category..."
                           className="h-10 w-full rounded-xl border border-[#E3D8EA] bg-white pl-10 pr-3 text-xs text-[#2B174C] outline-none focus:border-[#BFA8E2]"/>
                </div></div>
                {!availabilityValid && <p role="alert" className="bg-[#FFF4F4] px-4 py-2 text-[11px] text-[#C32F2F]">Choose a valid past, current, or future booking date range of no more than 366 days.</p>}
                {rentalErrors.length > 0 && <p role="alert" className="bg-[#FFF4F4] px-4 py-2 text-[11px] text-[#C32F2F]">{rentalErrors.join(" · ")}</p>}
                <div className={`${scrollPanel} h-[440px]`} role="region" aria-label="Rental equipment inventory list" tabIndex={0}>
                    <table className="w-full min-w-[800px] table-fixed text-center text-xs">
                        <colgroup><col className="w-[20%]"/><col className="w-[23%]"/><col className="w-[16%]"/>
                            <col className="w-[17%]"/><col className="w-[12%]"/><col className="w-[12%]"/></colgroup>
                        <thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr>
                            {(["Equipment No.", "Rental Product", "Category", "Branch", "Total Units", "Rented Booking"] as const)
                                .map(label => <th key={label} title={label === "Rented Booking" ? (from < businessDateString()
                                    ? "Past: peak rental units recorded in booking history; today/future: peak confirmed units not yet released"
                                    : "Peak units reserved by confirmed bookings, not yet released, in the selected date range") : undefined} className={headerCell}>{label}</th>)}
                        </tr></thead>
                        <tbody>{visibleRentals.map(row => <tr key={`${row.branchId}-${row.item.id}`} className="border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]">
                            <td className={`${firstBodyCell} break-all`}>{row.item.equipmentNumber || "—"}</td>
                            <td className={bodyCell}>{row.item.name}</td>
                            <td className={bodyCell}>{row.item.category}</td>
                            <td className={bodyCell}>{row.branchName}</td>
                            <td className={`${bodyCell} tabular-nums`}>{formatNumber(row.item.totalUnits)}</td>
                            <td className={`${bodyCell} tabular-nums`} title={from < businessDateString()
                                ? "Past: historical booked units based on retained booking records; today/future: confirmed reservations"
                                : "Confirmed reserved units not yet released during selected booking dates"}>{row.reservedOnDates == null ? "—" : formatNumber(row.reservedOnDates)}</td>
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
    sheetName: string;
    storeName: string;
    branchName: string;
    filters: string[];
    generatedAt: Date;
};

function ownerReportDate(date: Date) {
    return date.toLocaleString("en-PH", {
        timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
    });
}

function ownerReportFilename(extension: "pdf" | "xlsx", details: OwnerReportDetails) {
    const slug = (value: string) => String(value || "Unknown")
        .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "Unknown";
    const date = details.generatedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
    return `StockNBook_${details.fileTag}_${slug(details.storeName)}_${slug(details.branchName)}_${date}.${extension}`;
}

function exportOwnerTableExcel(table: OwnerReportTable, details: OwnerReportDetails) {
    const infoRows: Array<Array<string | number>> = [
        [`StockNBook - ${details.title}`],
        ["Store", details.storeName],
        ["Branch", details.branchName],
        ["Report Date", ownerReportDate(details.generatedAt)],
        ["Filters", details.filters.join(" | ") || "None"],
        ["Records", table.rows.length],
        [],
        table.headers,
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([...infoRows, ...table.rows]);
    worksheet["!cols"] = table.columnWidths.map(width => ({ wch: Math.max(13, Math.ceil(width / 6)) }));
    worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: table.headers.length - 1 } }];
    const excelColumn = (index: number) => {
        let value = index + 1;
        let letters = "";
        while (value > 0) {
            value--;
            letters = String.fromCharCode(65 + value % 26) + letters;
            value = Math.floor(value / 26);
        }
        return letters;
    };
    const lastColumn = excelColumn(table.headers.length - 1);
    worksheet["!autofilter"] = { ref: `A8:${lastColumn}${Math.max(8, 8 + table.rows.length)}` };
    // Keep monetary cells as numbers for Excel calculations/sorting.
    table.rows.forEach((row, rowIndex) => {
        table.moneyColumns.forEach(column => {
            if (typeof row[column] !== "number") return;
            const cell = worksheet[`${excelColumn(column)}${rowIndex + 9}`];
            if (cell) cell.z = '"₱"#,##0.00';
        });
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, details.sheetName);
    XLSX.writeFile(workbook, ownerReportFilename("xlsx", details), { bookType: "xlsx" });
}

function exportOwnerTablePdf(table: OwnerReportTable, details: OwnerReportDetails) {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const scale = 1.7;
    const margin = 23;
    const availableWidth = pageWidth - margin * 2;
    const widthSum = table.columnWidths.reduce((sum, width) => sum + width, 0);
    const widths = table.columnWidths.map(width => width / widthSum * availableWidth);
    const tableTop = 152;
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
        const filterText = `Filters: ${details.filters.join(" | ") || "None"}`;
        wrapCell(filterText, availableWidth).slice(0, 2).forEach((line, index) =>
            ctx.fillText(line, margin, 103 + index * 12));
        ctx.fillText(`Total Records: ${table.rows.length}`, margin, 136);
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
    link.download = ownerReportFilename("pdf", details);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}