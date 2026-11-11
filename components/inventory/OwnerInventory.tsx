"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import {
    BarChart3, Box, Building2,
    Download,
    RefreshCw, ShoppingCart, TrendingUp, X,
} from "lucide-react";

type Branch = { id: number; branchName: string };
type Amount = number | null;
type TrendPoint = { date: string; consumableSales: Amount; rentalRevenue: Amount };
type BranchRevenue = { branchId: number | null; branchName: string; consumableSales: Amount; rentalRevenue: Amount };
type ConsumablePerformance = { key: string; name: string; unitsSold: number; sales: number; grossProfit: Amount };
type RentalPerformance = { key: string; name: string; revenue: number; share: number };
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

const cardClass = "min-w-0 overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm";
const scrollPanel = "min-h-0 w-full overflow-auto overscroll-contain border-t border-[#E9E1EE]";
const headerCell = "truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
const bodyCell = "px-2 py-2 text-center text-xs text-[#4F3A5A]";
const firstBodyCell = "px-4 py-2 text-left text-xs text-[#4F3A5A]";

function businessDateString() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" });
}
// Revenue figures cover the 1st of the current month up to today (Philippine time),
// the same default period the inventory report API uses when no dates are sent.
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
    return <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5] [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
        <div className="min-w-0"><h2 className="text-[15px] font-bold text-[#21132E]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-[#86778F]">{subtitle}</p>}</div>
    </div>;
}
function MetricCard({ label, value, helper, icon, loading = false, tone = "purple" }: {
    label: string; value: string; helper: string; icon: React.ReactNode;
    loading?: boolean; tone?: "purple" | "green" | "blue" | "red";
}) {
    const iconClassName = {
        purple: "bg-[#F1ECFF] text-[#5F35D8]",
        green: "bg-[#E5F8EC] text-[#23834A]",
        blue: "bg-[#E9F2FF] text-[#1E6FE8]",
        red: "bg-[#FFE8E8] text-[#E23B4A]",
    }[tone];
    return (
        <article aria-busy={loading} className="flex min-h-[116px] min-w-0 w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm">
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
                    <span className="mt-1 block break-words text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#1A1220] tabular-nums">{value}</span>
                    <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">{helper}</span>
                </span>
            </>}
        </article>
    );
}
function OwnerTableLoadingRow({ columns, label }: { columns: number; label: string }) {
    return <tr><td colSpan={columns} className="px-4 py-7 text-center text-xs text-[#86778F]" role="status">
        <span className="block">{label}</span>
        <span className="mx-auto mt-3 block h-3 w-2/3 max-w-[330px] animate-pulse rounded-full bg-[#F1EBF8]" aria-hidden="true"/>
    </td></tr>;
}

const compactControl = "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F8F5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B31D4] disabled:opacity-50";

function BranchPicker({ branches, value, onChange, label }: { branches: Branch[] | null; value: string; onChange: (value: string) => void; label: string }) {
    return <label className={`${compactControl} relative max-w-full`}><Building2 size={15}/>
        <select aria-label={`${label} branch (updates all reports)`} value={value} onChange={event => onChange(event.target.value)} className="min-w-0 max-w-[150px] bg-transparent pr-1 outline-none">
            <option value="">All branches</option>{branches?.map(item => <option key={item.id} value={item.id}>{item.branchName}</option>)}
        </select>
    </label>;
}
function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (format: 'xlsx' | 'pdf') => void }) {
    return <details className="relative"><summary aria-label="Export options" title="Export to Excel or PDF" className={`${compactControl} w-9 shrink-0 !px-0 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Download size={16}/></summary>
        <div className="absolute right-0 top-full z-40 mt-1 w-36 rounded-xl border border-[#E3D8EA] bg-white p-1 shadow-lg">
            {(['xlsx', 'pdf'] as const).map(format => <button type="button" key={format} disabled={disabled} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onExport(format); }} className="block w-full rounded px-3 py-2 text-left text-xs text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-40">{format === 'xlsx' ? 'Excel (.xlsx)' : 'PDF (.pdf)'}</button>)}
        </div>
    </details>;
}
export default function OwnerInventory() {
    const [clock, setClock] = React.useState('');
    React.useEffect(() => {
        const update = () => {
            const now = new Date();
            const dateLabel = now.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
            const timeLabel = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
            setClock(`${dateLabel} | ${timeLabel}`);
        };
        update(); const timer = window.setInterval(update, 30000); return () => window.clearInterval(timer);
    }, []);
    const [branch, setBranch] = React.useState("");
    const [range, setRange] = React.useState<DateRange>(monthToDateRange);
    const [refresh, setRefresh] = React.useState(0);
    const [performance, setPerformance] = React.useState<OwnerPerformance | null>(null);
    const [branches, setBranches] = React.useState<Branch[] | null>(null);
    const [performanceLoading, setPerformanceLoading] = React.useState(true);
    const [performanceError, setPerformanceError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    React.useEffect(() => {
        const abort = new AbortController();
        setPerformanceLoading(true); setPerformanceError(""); setPerformance(null);
        void ownerRequest<{ performance: OwnerPerformance }>("/api/products", {
            action: "get_owner_inventory_performance", date_from: range.startDate, date_to: range.endDate,
            ...(branch ? { branch_id: Number(branch) } : {}),
        }, abort.signal).then(result => {
            if (!result.performance || !Array.isArray(result.performance.branches)) throw new Error("The owner inventory report is unavailable.");
            if (abort.signal.aborted) return;
            setPerformance(result.performance);
            setBranches(previous => JSON.stringify(previous) === JSON.stringify(result.performance.branches) ? previous : result.performance.branches);
        }).catch(reason => { if (!abort.signal.aborted) setPerformanceError(reason instanceof Error ? reason.message : "Unable to load the owner inventory report."); })
            .finally(() => { if (!abort.signal.aborted) setPerformanceLoading(false); });
        return () => abort.abort();
    }, [branch, range.startDate, range.endDate, refresh]);
    // Keep the branch pickers available even if the sales report is unavailable.
    React.useEffect(() => {
        const abort = new AbortController();
        const load = async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Your session has expired. Please sign in again.");
                const response = await fetch("/api/branches", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: abort.signal });
                const payload = await response.json() as { branches?: Array<{ id?: number; branch_id?: number; branchId?: number; branchName?: string; branch_name?: string; name?: string }>; error?: string };
                if (!response.ok || !Array.isArray(payload.branches)) throw new Error(payload.error || "Branch information is unavailable.");
                const loaded = payload.branches.map(item => ({ id: Number(item.id ?? item.branch_id ?? item.branchId), branchName: item.branchName || item.branch_name || item.name || "Unnamed branch" })).filter(item => Number.isSafeInteger(item.id) && item.id > 0);
                if (!abort.signal.aborted) setBranches(previous => previous ?? loaded);
            } catch (reason) {
                if (!abort.signal.aborted) console.warn("Unable to load branch information.", reason);
            }
        };
        void load();
        return () => abort.abort();
    }, [refresh]);
    React.useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 6000); return () => window.clearTimeout(timer); }, [notice]);

    const consumables = performance?.consumables || [];
    const rentals = performance?.rentals || [];
    const branchName = branch ? branches?.find(item => String(item.id) === branch)?.branchName || "Selected branch" : "All branches";
    const selectedLabel = range.startDate === range.endDate ? shortDate(range.endDate) : `${shortDate(range.startDate, false)} – ${shortDate(range.endDate)}`;
    const periodLabel = `This month to date · ${selectedLabel}`;
    const exportReport = (format: "xlsx" | "pdf", scope: "all" | "consumables" | "rentals" = "all") => {
        if (!performance) return;

        const unavailable = "Not recorded yet";
        const value = (amount: Amount) => amount === null ? unavailable : amount;
        let report: OwnerReportTable = {
            headers: ["Section / Item", "Branch / Details", "Units", "Revenue (PHP)", "Gross profit (PHP)"],
            rows: [
                ["Total sales & rental revenue", selectedLabel, "", value(performance.totals.totalRevenue), ""],
                ["Consumable sales", selectedLabel, "", value(performance.totals.consumableSales), value(performance.totals.consumableGrossProfit)],
                ["Rental revenue", selectedLabel, "", value(performance.totals.rentalRevenue), ""],
                ...performance.branchRevenue.map(row => ["Branch consumable sales", row.branchName, "", value(row.consumableSales), ""] as Array<string | number>),
                ...performance.branchRevenue.map(row => ["Branch rental revenue", row.branchName, "", value(row.rentalRevenue), ""] as Array<string | number>),
                ...consumables.map(row => [row.name, "Consumables", row.unitsSold, row.sales, row.grossProfit === null ? "Historical cost unavailable" : row.grossProfit] as Array<string | number>),
                ...rentals.map(row => [row.name, "Rentals", "", row.revenue, ""] as Array<string | number>),
            ], columnWidths: [180, 210, 55, 100, 110], moneyColumns: [3, 4],
        };
        const details: OwnerReportDetails = {
            title: "Owner Inventory Performance", fileTag: "Owner_Inventory_Performance", sheetName: "Business Performance",
            storeName: performance.storeName || "Store", branchName, generatedAt: new Date(),
            filters: [`Revenue: ${periodLabel}`, "Gross profit = recorded POS sales less recorded cost at sale, before operating expenses; POS totals include VAT where applicable", ...performance.warnings],
        };
        if (scope === 'consumables') report = { headers: ['Item', 'Units sold', 'Sales', 'Gross profit'], rows: consumables.map(row => [row.name, row.unitsSold, row.sales, value(row.grossProfit)]), columnWidths: [220, 80, 140, 140], moneyColumns: [2, 3] };
        if (scope === 'rentals') report = { headers: ['Item', 'Rental revenue', 'Revenue share (%)'], rows: rentals.map(row => [row.name, row.revenue, row.share]), columnWidths: [220, 140, 140], moneyColumns: [1] };
        if (scope !== 'all') {
            const titles = { consumables: 'Consumable Sales Performance', rentals: 'Rental Revenue Performance' };
            details.title = titles[scope]; details.fileTag = titles[scope].replace(/ /g, '_'); details.sheetName = titles[scope].slice(0, 31);
        }
        try { if (format === "pdf") exportOwnerTablePdf(report, details); else exportOwnerTableExcel(report, details); }
        catch (reason) { setNotice(reason instanceof Error ? `Export failed: ${reason.message}` : "Unable to export this report."); }
    };

    return <div className="min-h-screen bg-[#FFFDF8] font-sans text-[#1A1220]">
        <div>
            <header className="sticky top-0 z-20 flex min-h-[74px] flex-wrap items-center justify-between gap-4 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 px-6 py-3 backdrop-blur">
                <div><h1 className="text-[25px] font-bold text-[#1A1220]">Inventory</h1><p className="mt-0.5 text-xs text-[#766983]">Sales performance for this month to date ({selectedLabel}) across your business.</p></div>
                <div className="flex flex-wrap items-center gap-2.5"><time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{clock || 'Asia/Manila'}</time>
                    <button type="button" onClick={() => { setRange(monthToDateRange()); setRefresh(value => value + 1); }} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"><RefreshCw size={16} className={performanceLoading ? 'animate-spin' : ''}/>Refresh</button>
                </div>
            </header>
            <main className="space-y-4 px-5 py-5">
                {performanceError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] p-4 text-sm text-[#C32F2F]"><p>Could not load the owner report: {performanceError}</p><button type="button" onClick={() => setRefresh(value => value + 1)} className="rounded-lg border border-current px-3 py-1.5 text-xs font-semibold">Retry</button></div>}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <MetricCard label="Total sales & rental revenue" value={shownMoney(performance?.totals.totalRevenue)} loading={performanceLoading} helper={performanceLoading ? "Loading recorded revenue…" : performance?.totals.rentalRevenue === null ? "Total available once rentals are recorded" : periodLabel} icon={<BarChart3 size={19}/>}/>
                    <MetricCard label="Consumable sales" value={shownMoney(performance?.totals.consumableSales)} loading={performanceLoading} helper={`Gross profit: ${shownMoney(performance?.totals.consumableGrossProfit)} · this month to date`} icon={<TrendingUp size={19}/>} tone="green"/>
                    <MetricCard label="Rental revenue" value={shownMoney(performance?.totals.rentalRevenue)} loading={performanceLoading} helper={performanceLoading ? "Loading recorded revenue…" : performance?.totals.rentalRevenue === null ? "No itemized charges" : periodLabel} icon={<Box size={19}/>} tone="blue"/>
                </div>
                {performance && performance.warnings.length > 0 && <p role="note" className="rounded-lg bg-[#F7F1FF] px-3 py-2 text-[11px] leading-5 text-[#806A8C]">{performance.warnings.join(" ")}</p>}
                <div className="grid gap-4 xl:grid-cols-2">
                    <section className={cardClass}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5"><SectionHeading icon={<ShoppingCart size={23}/>} title="Consumable sales performance" subtitle={periodLabel}/><div className="flex gap-2"><BranchPicker branches={branches} value={branch} onChange={setBranch} label="Consumable sales performance"/><ExportMenu disabled={!performance || performanceLoading} onExport={format => exportReport(format, "consumables")}/></div></div>
                        <div className={`${scrollPanel} h-[360px]`} role="region" aria-label="Consumable sales performance scrollable table" tabIndex={0}><table className="w-full min-w-0 table-fixed text-center [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[40%]"/><col className="w-[18%]"/><col className="w-[21%]"/><col className="w-[21%]"/></colgroup><thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr><th className={`${headerCell}`}>Item</th><th className={`${headerCell} text-center`}>Units sold</th><th className={`${headerCell} text-center`}>Sales</th><th className={`${headerCell} text-center`}>Gross profit</th></tr></thead><tbody>
                        {consumables.map(row => <tr key={row.key} className="border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]"><td className={firstBodyCell}>{row.name}</td><td className={`${bodyCell} text-center tabular-nums`}>{formatNumber(row.unitsSold)}</td><td className={`${bodyCell} text-center tabular-nums`}>{formatPeso(row.sales)}</td><td title={row.grossProfit === null ? "Historical cost is not available for every sold item." : undefined} className={`${bodyCell} text-center tabular-nums`}>{shownMoney(row.grossProfit)}</td></tr>)}
                        {consumables.length === 0 && (performanceLoading ? <OwnerTableLoadingRow columns={4} label="Loading consumable sales..."/> : <tr><td colSpan={4} className="h-[123px] px-3 text-center text-xs text-[#7A6A84]">{performanceError ? "Sales report unavailable." : "No completed consumable sales in this period."}</td></tr>)}
                        </tbody></table></div>
                    </section>
                    <section className={cardClass}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5"><SectionHeading icon={<Box size={23}/>} title="Rental revenue performance" subtitle={periodLabel}/><div className="flex gap-2"><BranchPicker branches={branches} value={branch} onChange={setBranch} label="Rental revenue performance"/><ExportMenu disabled={!performance || performanceLoading} onExport={format => exportReport(format, "rentals")}/></div></div>
                        <div className={`${scrollPanel} h-[360px]`} role="region" aria-label="Rental revenue performance scrollable table" tabIndex={0}><table className="w-full min-w-0 table-fixed text-center [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[46%]"/><col className="w-[27%]"/><col className="w-[27%]"/></colgroup><thead className="sticky top-0 z-10 border-b border-[#E9E1EE] bg-[#FFFCF8]"><tr><th className={`${headerCell}`}>Item</th><th className={`${headerCell} text-center`}>Rental revenue</th><th className={`${headerCell} text-center`}>Revenue share</th></tr></thead><tbody>
                        {rentals.map(row => <tr key={row.key} className="border-b border-[#EFE8F2] last:border-0 hover:bg-[#FFFCF8]"><td className={firstBodyCell}>{row.name}</td><td className={`${bodyCell} text-center tabular-nums`}>{formatPeso(row.revenue)}</td><td className={`${bodyCell} text-center tabular-nums`}>{row.share.toFixed(1)}%</td></tr>)}
                        {rentals.length === 0 && (performanceLoading ? <OwnerTableLoadingRow columns={3} label="Loading rental revenue..."/> : <tr><td colSpan={3} className="h-[123px] px-5 text-center text-xs leading-5 text-[#7A6A84]">{performanceError ? "Rental report unavailable." : performance?.totals.rentalRevenue === null ? "No recorded itemized rental charges are available yet. Rental stock and daily rates alone are not rental revenue." : "No rental revenue recorded in this period."}</td></tr>)}
                        </tbody></table></div>
                    </section>
                </div>
            </main>
        </div>
        {notice && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[150] flex max-w-[min(420px,calc(100vw-40px))] items-start gap-3 rounded-xl border border-[#E6DDF0] bg-white p-4 text-sm text-[#5F4E75] shadow-xl"><p>{notice}</p><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></button></div>}
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