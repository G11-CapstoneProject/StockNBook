"use client";

import * as React from "react";
import {
    AlertTriangle, CalendarDays, ChevronDown, ClipboardList,
    Package, PackagePlus, RefreshCw, Search, ShoppingCart, X, Truck,
} from "lucide-react";
import { useInventoryController } from "@/hooks/useInventory";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import { SuccessToast, labelClass, fieldClass, formatInventoryBalance, type Product } from "./_shared";
import StaffRentalInventory from "./StaffRentalInventory";

/* Staff inventory only: the existing product hook remains the authoritative
   sales-stock source. No manager catalog editor or financial controls are mounted. */

type StockLine = {
    key: string;
    variantId: number | null;
    product: Product;
    reference: string;
    name: string;
    category: string;
    stock: number;
    reorder: number;
    expirationDate?: string | null;
    status: "In Stock" | "Low Stock" | "Out of Stock";
};
type ActivityRow = {
    id: string;
    at: string;
    item: string;
    kind: string;
    quantity: number | null;
    reference: string;
    actorName: string;
};
type ReceivingTask = {
    id: number;
    productId: number;
    variantId: number | null;
    productName: string;
    variantValues?: Record<string, string> | string;
    quantity: number; // Remaining authorized units waiting for physical receipt.
    authorizedQuantity?: number;
    alreadyReceived?: number;
    deliveryReference: string;
    expirationDate?: string | null;
    notes?: string | null;
};
type SalesBookingItem = {
    itemId:number; productName:string; variantName:string; quantity:number;
    prepared:boolean; issued:boolean;
};
type SalesBooking = {
    bookingId:number; reference:string; clientName:string; bookingType:string;
    packageName:string; eventDate:string; eventTime:string; bookingStatus?:string|null;
    booking_status?:string|null; status?:string|null;
    bookingTotal:number; amountPaid:number; balance:number;
    items:SalesBookingItem[];
};
type SalesQueueFilter = "all" | "prepare" | "release";

// Prioritize today's scheduled bookings, then the most recent past dates, and
// finally upcoming dates (nearest first). Keep date strings in YYYY-MM-DD form.
function compareQueueEventDates(first: string, second: string, today: string): number {
    const bucket = (date: string) => !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 3 :
        date === today ? 0 : date < today ? 1 : 2;
    const difference = bucket(first) - bucket(second);
    if (difference) return difference;
    if (bucket(first) === 1) return second.localeCompare(first);
    return first.localeCompare(second);
}

// Display the actual booking lifecycle status, like the Rental queue.
// Support common API field names without inferring an incorrect status from task progress.
function salesQueueBookingStatus(booking: SalesBooking): string {
    const raw = String(booking.bookingStatus || booking.booking_status || booking.status || "").trim();
    switch (raw.toLowerCase()) {
        case "pending": case "pending review": return "Pending Review";
        case "approved": case "awaiting down payment": case "waiting down payment":
        case "awaiting payment": case "down payment required": return "Approved";
        case "confirmed": return "Confirmed";
        case "preparing": return "Preparing";
        case "released": return "Released";
        case "return inspection": return "Return Inspection";
        case "pending settlement": return "Pending Settlement";
        case "completed": return "Completed";
        case "cancelled": case "canceled": return "Cancelled";
        default: return raw || "Status unavailable";
    }
}
const salesQueueStatusStyles: Record<string, string> = {
    "Pending Review": "text-[#A56607]",
    "Approved": "text-[#A56607]",
    "Confirmed": "text-[#1D4ED8]",
    "Preparing": "text-[#4E2C66]",
    "Released": "text-[#1D4ED8]",
    "Return Inspection": "text-[#A56607]",
    "Pending Settlement": "text-[#A56607]",
    "Completed": "text-[#138342]",
    "Cancelled": "text-[#C32F2F]",
    "Status unavailable": "text-[#806A8C]",
};
function displaySalesBookingDate(date:string) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return date || "—";
    return new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US",{
        timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric"});
}
function salesBookingType(type:string) {
    if(type.toLowerCase().includes("package"))return "Package Booking";
    if(type.toLowerCase().includes("custom"))return "Custom Inventory Booking";
    return type || "Booking";
}
function salesBookingFullyPaid(booking:SalesBooking) {
    return Number.isFinite(booking.bookingTotal)&&booking.bookingTotal>0&&
        Number.isFinite(booking.amountPaid)&&Number.isFinite(booking.balance)&&
        booking.amountPaid+0.005>=booking.bookingTotal&&booking.balance<=0.005;
}
type ShortageReport = { id: number; productId: number; variantId: number | null; stockSnapshot: number; notes: string; };
type ConditionReport = { id: number; productId: number; variantId: number | null; issueType: "expired" | "expiring" | "damaged"; notes: string; };
type StockMovement = { id: number; at: string; productName: string; variantValues?: Record<string,string> | string;
    kind: string; quantity: number; reference?: string; actorName?: string; };
function variantLabel(raw?: Record<string,string> | string) {
    if (!raw) return "";
    try {
        const value = typeof raw === "string" ? JSON.parse(raw) as Record<string,string> : raw;
        return Object.values(value).filter(Boolean).join(" / ");
    } catch { return ""; }
}

const card = "min-w-0 overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const outline = "inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F7F1FF]";
const primary = "inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]";
const filterClass = "h-[40px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-xs text-[#2B174C] outline-none focus:border-[#2B174C]";
const headClass = "truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
// Manager Inventory Restock button design.
const staffRestockAction = "inline-flex items-center gap-1 rounded-lg bg-[#E5F8EC] px-2 py-1.5 text-[10px] font-semibold text-[#23834A] hover:bg-[#D5F0DF] disabled:cursor-not-allowed disabled:opacity-40";
// Same filter control as the Manager Inventory (ManagerInventoryFilterSelect).
function StaffInventoryFilterSelect({ containerClassName = "", className = "", children, ...props }:
                                        React.ComponentProps<"select"> & { containerClassName?: string }) {
    return (
        <span className={`relative inline-flex min-w-0 ${containerClassName}`}>
            <select {...props} className={`h-9 w-full min-w-0 appearance-none rounded-xl border border-[#E3D8EA] bg-white py-1 pl-3 pr-9 text-xs font-semibold text-[#2B174C] outline-none focus:border-[#BFA8E2] focus-visible:ring-2 focus-visible:ring-[#F1EBFF] ${className}`}>
                {children}
            </select>
            <ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#806A8C]" />
        </span>
    );
}
function dateInManila(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(value);
    const part = (type: string) => parts.find(p => p.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}
function formatClock(value: Date) {
    return value.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }) + " | " +
        value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" }).toLowerCase();
}
function safeDate(value: string) {
    if (!value) return "—";
    const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-PH", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila",
    });
}

function staffExpirationRisk(value?: string | null): "Expired" | "Expiring Soon" | null {
    const date = String(value || "").slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const today = dateInManila();
    if (date < today) return "Expired";
    const [year,month,day] = today.split("-").map(Number);
    const limit = new Date(Date.UTC(year, month-1, day+30)).toISOString().slice(0,10);
    return date <= limit ? "Expiring Soon" : null;
}
function inventoryExpirationLabel(value?: string | null) {
    if (!value) return "—";
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
    });
}
function toStockLines(products: Product[]): StockLine[] {
    return products.flatMap(product => {
        const from = (stockValue: number, reorderValue: number, name: string, reference: string, key: string, variantId: number | null, expirationDate?: string | null): StockLine => {
            const stock = Math.max(0, Number(stockValue || 0));
            const reorder = Math.max(0, Number(reorderValue || 0));
            return {
                key, variantId, product, reference: reference || "—", name, category: product.category || "Uncategorized", stock, reorder, expirationDate,
                status: stock <= 0 ? "Out of Stock" : stock <= reorder ? "Low Stock" : "In Stock",
            };
        };
        if (product.hasVariants && product.variants?.length) {
            return product.variants.map(variant => {
                const label = Object.values(variant.variantValues || {}).filter(Boolean).join(", ") || "Variant";
                return from(variant.sellableStock ?? variant.stock, variant.alertLevel, `${product.name} – ${label}`,
                    variant.variantNumber || product.productNumber || "", `${product.id}:${variant.id}`, variant.id, variant.expirationDate);
            });
        }
        return [from(product.sellableStock ?? product.stock, product.alertLevel, product.name, product.productNumber || "", `${product.id}:regular`, null, product.expirationDate)];
    });
}
function stockBadge(status: StockLine["status"]) {
    return status === "Out of Stock" ? "text-[#BF2438]" :
        status === "Low Stock" ? "text-[#B07408]" : "text-[#218246]";
}

// Manager-style parent rows remain read-only for Staff. Each variant has its own
// Restock action scoped to that SKU's authorized deliveries.
type StaffInventoryStatus = StockLine["status"] | "Expiring Soon" | "Expired";
function staffLineDisplayStatus(stock:number, reorder:number, expiration?:string|null): StaffInventoryStatus {
    const risk=staffExpirationRisk(expiration);
    if(risk)return risk;
    if(stock<=0)return "Out of Stock";
    if(stock<=reorder)return "Low Stock";
    return "In Stock";
}
function staffProductDisplayStatus(product:Product): StaffInventoryStatus {
    const variants=product.hasVariants && product.variants?.length ? product.variants : null;
    const statuses=(variants ? variants.map(variant=>staffLineDisplayStatus(variant.sellableStock ?? variant.stock,variant.alertLevel,variant.expirationDate)) :
        [staffLineDisplayStatus(product.sellableStock ?? product.stock,product.alertLevel,product.expirationDate)]);
    if(statuses.includes("Expired"))return "Expired";
    if(statuses.includes("Expiring Soon"))return "Expiring Soon";
    if(statuses.every(s=>s==="Out of Stock"))return "Out of Stock";
    if(statuses.some(s=>s==="Out of Stock"||s==="Low Stock"))return "Low Stock";
    return "In Stock";
}
function staffInventoryStatusClass(status:StaffInventoryStatus):string {
    if(status==="Expired")return "text-[#8E4AA6]";
    if(status==="Expiring Soon")return "text-[#6944C9]";
    return status==="Out of Stock" ? "text-[#D92C3F]" : status==="Low Stock" ? "text-[#C77A00]" : "text-[#23834A]";
}
function staffInventoryStatusBadge(status:StaffInventoryStatus) {
    return <span className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 ${staffInventoryStatusClass(status)}`}>{status}</span>;
}
function staffVariantDisplayName(values:Record<string,string>):string {
    return Object.values(values||{}).map(value=>String(value||"").trim()).filter(Boolean).join(", ")||"Variant";
}

function fromMovements(movements: StockMovement[]): ActivityRow[] {
    return movements.map(item => ({
        id: String(item.id), at: item.at,
        item: `${item.productName}${variantLabel(item.variantValues) ? ` — ${variantLabel(item.variantValues)}` : ""}`,
        kind: item.kind === "STAFF_RECEIPT" ? "Stock Received" :
            item.kind === "SALE" ? "POS Sale" : item.kind === "POS_VOID" ? "POS Void" :
                ["RECEIVE", "PURCHASE_RECEIPT", "RECEIPT", "RESTOCK", "STOCK_IN"].includes(item.kind) ? "Stock Received" :
                    item.kind.replace(/_/g," ").replace(/\b\w/g, letter => letter.toUpperCase()),
        quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
        reference: item.reference || "—", actorName: item.actorName || "System",
    }));
}
function activityBadge(kind: string) {
    if (kind === "POS Sale") return "text-[#5A476A]";
    if (kind === "Stock Received") return "text-[#218246]";
    if (kind === "POS Void") return "text-[#2861A8]";
    return "text-[#5A476A]";
}
function requireApiSuccess(response: Response, data: { success?: boolean; error?: string }, fallback: string) {
    if (!response.ok || !data.success) {
        throw new Error(data.error || fallback);
    }
}
function requireMovements(data: { movements?: unknown; error?: string }) {
    if (!Array.isArray(data.movements)) {
        throw new Error(data.error || "Unable to load inventory activity.");
    }
}
function quantityLabel(qty: number | null) {
    if (qty == null) return "—";
    return qty > 0 ? `+${qty}` : String(qty);
}
function SectionHead({ icon, title, subtitle, children }: {icon: React.ReactNode; title: string; subtitle: string; children?: React.ReactNode}) {
    return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
        <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">{icon}</span>
            <div><h3 className="text-[15px] font-bold text-[#21132E]">{title}</h3><p className="mt-0.5 text-[11px] text-[#86778F]">{subtitle}</p></div>
        </div>{children}
    </div>;
}
function Stat({label,value,helper,icon,color,loading=false}: {
    label:string;value:number|null;helper:string;icon:React.ReactNode;color:string;loading?:boolean;
}) {
    return (
        <div aria-busy={loading} className="flex min-h-[108px] min-w-0 w-full items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${loading ? "animate-pulse bg-[#EEE8F3]" : color}`} aria-hidden="true">{!loading && icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{label}</span>
                {loading ? <span className="mt-1 block h-6 w-12 animate-pulse rounded bg-[#EEE8F3]"/> :
                    <span className="mt-1 block break-words text-[24px] font-bold leading-none tabular-nums text-[#25153D]">{value == null ? "—" : value.toLocaleString("en-PH")}</span>}
                <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{helper}</span>
            </span>
        </div>
    );
}

export default function StaffInventory() {
    const inv = useInventoryController();
    // Same UI check as Staff Rental Inventory; the Products Lambda enforces Full access again.
    const { user } = useCurrentUser();
    const inventoryPermission = user?.permissions?.inventory_access ?? user?.permissions?.inventory;
    const canRestock = inventoryPermission === true || inventoryPermission === "true" || inventoryPermission === "full";
    const refreshAll = inv.refreshAll;
    const [now, setNow] = React.useState<Date | null>(null);
    const [tab, setTab] = React.useState<"sales" | "rental">("sales");
    // Support links from the Staff Dashboard without changing the default tab.
    // Read after mounting to keep the server and initial client render consistent.
    React.useEffect(() => {
        const requestedTab = new URLSearchParams(window.location.search).get("tab");
        if (requestedTab === "rental") setTab("rental");
    }, []);
    const [search, setSearch] = React.useState("");
    const [category, setCategory] = React.useState("all");
    const [status, setStatus] = React.useState("all");
    const [expandedProductIds,setExpandedProductIds]=React.useState<Record<number,boolean>>({});
    const [taskFilter, setTaskFilter] = React.useState("all");
    const [details, setDetails] = React.useState<StockLine | null>(null);
    const [showReceivingInfo, setShowReceivingInfo] = React.useState(false);
    const [canReceive, setCanReceive] = React.useState(false);
    const [receivingTasks, setReceivingTasks] = React.useState<ReceivingTask[]>([]);
    // Staff Restock dialog: same layout as the Manager's Receive Stock (quantity only).
    const [restockTarget, setRestockTarget] = React.useState<Product | null>(null);
    const [restockQuantities, setRestockQuantities] = React.useState<Record<string, string>>({});
    const [restockExpirations, setRestockExpirations] = React.useState<Record<string, string>>({});
    // Kept across a network retry so one physical restock cannot be recorded twice.
    const restockRequestKey = React.useRef("");
    const [shortageReports, setShortageReports] = React.useState<ShortageReport[]>([]);
    const [conditionReports, setConditionReports] = React.useState<ConditionReport[]>([]);
    const [conditionReportingSupported, setConditionReportingSupported] = React.useState(false);
    const [conditionIssueType, setConditionIssueType] = React.useState<"expired"|"expiring"|"damaged">("damaged");
    const [conditionNotes, setConditionNotes] = React.useState("");
    const [reportNotes, setReportNotes] = React.useState("");
    const [activeReceipt, setActiveReceipt] = React.useState<ReceivingTask | null>(null);
    const [partialReceiptSupported, setPartialReceiptSupported] = React.useState(false);
    const [receivingQuantity, setReceivingQuantity] = React.useState("");
    const [receivingNotes, setReceivingNotes] = React.useState("");
    // Keep the same key on a network retry so one physical receipt cannot be recorded twice.
    const receiptRequestKey = React.useRef("");
    const chooseReceipt = (task: ReceivingTask | null) => {
        setActiveReceipt(task);
        setReceivingQuantity(task ? String(task.quantity) : "");
        setReceivingNotes("");
        setActionError("");
        receiptRequestKey.current = "";
    };
    // Staff Restock: quantity-only receiving through receive_stock (Full Inventory access, own
    // branch). The server ignores cost and price fields from Staff, so average cost and selling
    // price stay unchanged. Available for every product and variant, at any stock level.
    const openRestock = (product: Product) => {
        setRestockTarget(product);
        setRestockQuantities({});
        setRestockExpirations({});
        restockRequestKey.current = "";
        setActionError("");
    };
    const [saving, setSaving] = React.useState(false);
    const [actionError, setActionError] = React.useState("");
    const [actionNotice, setActionNotice] = React.useState("");
    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [activityKey, setActivityKey] = React.useState(0);
    const [rentalKey, setRentalKey] = React.useState(0);
    const lastFocusSync = React.useRef(0);
    const previousDay = React.useRef<string | null>(null);
    const [showActivityHistory, setShowActivityHistory] = React.useState(false);
    const [activityFilter, setActivityFilter] = React.useState<"all" | "sales" | "receiving" | "adjustments">("all");
    const [activityPeriod, setActivityPeriod] = React.useState<"today" | "week" | "all">("week");
    const [activityPage, setActivityPage] = React.useState(1);
    const [activityHistory, setActivityHistory] = React.useState<ActivityRow[]>([]);
    const [activityHistoryHasMore, setActivityHistoryHasMore] = React.useState(false);
    const [activityHistoryLoading, setActivityHistoryLoading] = React.useState(false);
    const [activityHistoryError, setActivityHistoryError] = React.useState("");
    const [historyRetry, setHistoryRetry] = React.useState(0);
    const closeStaffNotice = React.useCallback(() => setActionNotice(""), []);
    const [activityError, setActivityError] = React.useState<string | null>(null);
    const isRental = tab === "rental";
    const lines = React.useMemo(() => toStockLines(inv.baseProducts), [inv.baseProducts]);
    const {low, out, attention} = React.useMemo(() => {
        const low = lines.filter(line => line.status === "Low Stock");
        const out = lines.filter(line => line.status === "Out of Stock");
        return {low, out, attention:[...out, ...low]};
    }, [lines]);
    const categories = React.useMemo(() => [...new Set(lines.map(item => item.category))].sort(), [lines]);
    const visibleProducts=React.useMemo(()=>inv.baseProducts.filter(product=>{
        if(category!=="all"&&product.category!==category)return false;
        const q=search.trim().toLowerCase();
        const values=[product.name,product.productNumber||"",product.category||"",
            ...(product.variants||[]).flatMap(variant=>[variant.variantNumber||"",staffVariantDisplayName(variant.variantValues)])];
        if(q&&!values.join(" ").toLowerCase().includes(q))return false;
        return status==="all"||staffProductDisplayStatus(product)===status;
    }),[inv.baseProducts,search,category,status]);
    // Status filter plus the inventory search (product, product no., category).
    const tasks = React.useMemo(() => {
        const query = search.trim().toLowerCase();
        return attention.filter(line => (taskFilter === "all" || line.status === taskFilter) &&
            (!query || [line.name, line.reference, line.category].join(" ").toLowerCase().includes(query)));
    }, [attention, taskFilter, search]);
    const reportsByKey = React.useMemo(() => new Set(shortageReports.map(r=>`${r.productId}:${r.variantId ?? "regular"}`)),
        [shortageReports]);
    const conditionAlreadyReported = (line: StockLine, issueType: string) =>
        conditionReports.some(report => report.productId === line.product.id &&
            (report.variantId ?? null) === line.variantId && report.issueType === issueType);
    const branch = inv.assignedBranchName || "Assigned Branch";
    React.useEffect(() => {
        setNow(new Date());
        const interval = window.setInterval(() => setNow(new Date()), 30000);
        return () => window.clearInterval(interval);
    }, []);

    React.useEffect(() => {
        if (!now) return;
        const day = dateInManila(now);
        if (previousDay.current && previousDay.current !== day) setActivityKey(key=>key+1);
        previousDay.current = day;
    }, [now]);
    // Sync when employees return to the application, but throttle refetches.
    // The existing manual Refresh remains available for immediate updates.
    React.useEffect(() => {
        if (isRental) return;
        const onFocus = () => {
            if (document.visibilityState !== "visible" || Date.now() - lastFocusSync.current < 60_000) return;
            lastFocusSync.current = Date.now();
            setActivityKey(key=>key+1);
            void refreshAll();
        };
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [isRental, refreshAll]);
    React.useEffect(() => {
        if (!showActivityHistory) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setShowActivityHistory(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [showActivityHistory]);


    // Single server-validated, branch-scoped activity/task request; avoid
    // separate POS order and employee audit requests (which may expose costs).
    React.useEffect(() => {
        if (isRental) return;
        const controller = new AbortController();
        const load = async () => {
            setActivityError(null);
            const token = sessionStorage.getItem("token");
            if (!token) {setActivityError("Session expired.");return;}
            try {
                const response = await fetch("/api/products", {method:"POST",cache:"no-store",signal:controller.signal,
                    headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
                    body:JSON.stringify({action:"get_staff_inventory_workspace"})});
                const data = await response.json().catch(()=>({}));
                requireApiSuccess(response, data, "Unable to load stock activity.");
                if (controller.signal.aborted) return;
                setCanReceive(data.canReceiveStock === true);
                // Older backends process the entire task even when a quantity is supplied.
                // Enable the quantity input ONLY after the server advertises partial support.
                setPartialReceiptSupported(data.supportsPartialReceiving === true);
                setReceivingTasks(Array.isArray(data.receivingTasks) ? data.receivingTasks : []);
                setShortageReports(Array.isArray(data.shortages) ? data.shortages : []);
                setConditionReports(Array.isArray(data.conditionReports) ? data.conditionReports : []);
                setConditionReportingSupported(data.supportsConditionReports === true);
            } catch (error) {
                if (controller.signal.aborted) return;
                setCanReceive(false); setPartialReceiptSupported(false); setReceivingTasks([]); setShortageReports([]); setConditionReports([]); setConditionReportingSupported(false);
                setActivityError(error instanceof Error ? error.message : "Unable to load stock activity.");
            }
        };
        void load();
        return ()=>controller.abort();
    }, [activityKey, isRental]);


    // Load the full branch history only when requested. Keep the main workspace
    // light: one summary request, 8 newest movements, and an indexed daily count.
    React.useEffect(() => {
        if (!showActivityHistory || isRental) return;
        const controller = new AbortController();
        const loadHistory = async () => {
            setActivityHistoryLoading(true); setActivityHistoryError("");
            const token = sessionStorage.getItem("token");
            if (!token) {
                setActivityHistoryError("Session expired. Please sign in again.");
                setActivityHistoryLoading(false);
                return;
            }
            try {
                const response = await fetch("/api/products", {
                    method:"POST", cache:"no-store", signal:controller.signal,
                    headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
                    body:JSON.stringify({action:"get_staff_inventory_activity", filter:activityFilter,
                        period:activityPeriod, page:activityPage}),
                });
                const data = await response.json().catch(()=>({}));
                requireApiSuccess(response, data, "Unable to load inventory activity.");
                requireMovements(data);
                if (controller.signal.aborted) return;
                setActivityHistory(fromMovements(data.movements));
                setActivityHistoryHasMore(data.hasMore === true);
            } catch(error) {
                if (controller.signal.aborted) return;
                setActivityHistoryError(error instanceof Error ? error.message : "Unable to load inventory activity.");
                setActivityHistory([]); setActivityHistoryHasMore(false);
            } finally { if (!controller.signal.aborted) setActivityHistoryLoading(false); }
        };
        void loadHistory();
        return () => controller.abort();
    }, [showActivityHistory, isRental, activityFilter, activityPeriod, activityPage, activityKey, historyRetry]);


    const sendInventoryAction = async (payload: Record<string,unknown>) => {
        const token = sessionStorage.getItem("token");
        if (!token) throw new Error("Session expired. Please sign in again.");
        const response = await fetch("/api/products", {method:"POST",cache:"no-store",headers:{
                "Authorization":`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
        const data = await response.json().catch(()=>({}));
        if (!response.ok || !data.success) throw new Error(String(data.error || "Unable to save action."));
        return data;
    };
    const submitShortage = async (line: StockLine) => {
        if (saving) return;
        setSaving(true);setActionError("");setActionNotice("");
        try {
            await sendInventoryAction({action:"report_staff_stock_shortage",productId:line.product.id,
                variantId:line.variantId,notes:reportNotes.trim()});
            setActionNotice("Shortage reported to the Manager's inventory queue.");
            setReportNotes(""); setDetails(null); setActivityKey(k=>k+1);
        } catch (error) {setActionError(error instanceof Error ? error.message : "Unable to report shortage.");}
        finally {setSaving(false);}
    };
    const submitCondition = async (line: StockLine) => {
        if (saving || !conditionReportingSupported || conditionAlreadyReported(line, conditionIssueType)) return;
        if (conditionNotes.trim().length < 5) {setActionError("Provide at least 5 characters of notes.");return;}
        setSaving(true);setActionError("");setActionNotice("");
        try {
            await sendInventoryAction({action:"report_staff_stock_condition",productId:line.product.id,
                variantId:line.variantId,issueType:conditionIssueType,notes:conditionNotes.trim()});
            setActionNotice("Product condition reported to the Manager's inventory queue. Inventory quantities were not changed.");
            setConditionNotes("");setDetails(null);setActivityKey(key=>key+1);
        } catch(e) {setActionError(e instanceof Error ? e.message : "Unable to report condition.");}
        finally {setSaving(false);}
    };
    const confirmReceipt = async (task: ReceivingTask) => {
        if (saving || !canReceive) return;
        const remaining = Number(task.quantity);
        const received = partialReceiptSupported ? Number(receivingQuantity) : remaining;
        if (!Number.isSafeInteger(remaining) || remaining < 1 ||
            !Number.isSafeInteger(received) || received < 1 || received > remaining ||
            (partialReceiptSupported && receivingQuantity.trim() === "")) {
            setActionError(`Enter a whole-number quantity from 1 to ${remaining}.`);
            return;
        }
        if (received < remaining && receivingNotes.trim().length < 5) {
            setActionError("Explain the partial delivery in at least 5 characters. Unreceived units remain pending.");
            return;
        }
        if (!receiptRequestKey.current) receiptRequestKey.current = crypto.randomUUID();
        setSaving(true);setActionError("");setActionNotice("");
        try {
            const result = await sendInventoryAction({action:"complete_staff_stock_receipt", taskId:task.id,
                requestKey:receiptRequestKey.current,
                ...(partialReceiptSupported ? {receivedQuantity:received, receivingNotes:receivingNotes.trim()} : {})});
            const outstanding = partialReceiptSupported ? Number(result.remainingQuantity ?? (remaining - received)) : 0;
            setActionNotice(result.alreadyProcessed
                ? `This receipt was already recorded for ${task.deliveryReference}.`
                : `Received ${received} units for ${task.deliveryReference}.${outstanding > 0 ? ` ${outstanding} units remain pending.` : " Delivery completed."}`);
            chooseReceipt(null);setShowReceivingInfo(false);
            await refreshAll();setActivityKey(k=>k+1);
        } catch (error) {setActionError(error instanceof Error ? error.message : "Stock receiving failed.");}
        finally {setSaving(false);}
    };
    // Lines and totals use the same rules as the Manager's Receive Stock dialog.
    const restockLines = !restockTarget ? [] : restockTarget.hasVariants && restockTarget.variants?.length
        ? restockTarget.variants.map(variant => ({key: String(variant.id), variantId: variant.id as number | null,
            name: staffVariantDisplayName(variant.variantValues), variantNumber: String(variant.variantNumber || ""),
            stock: Number(variant.stock ?? 0), sellable: Number(variant.sellableStock ?? variant.stock ?? 0)}))
        : [{key: "regular", variantId: null as number | null, name: "Regular", variantNumber: "",
            stock: Number(restockTarget.stock ?? 0), sellable: Number(restockTarget.sellableStock ?? restockTarget.stock ?? 0)}];
    const restockTotal = restockLines.reduce((sum, line) => sum + (Number(restockQuantities[line.key]) || 0), 0);
    const restockAvailableBefore = restockLines.reduce((sum, line) => sum + line.sellable, 0);
    const restockNeedsReconciliation = restockLines.some(line => line.stock !== line.sellable);
    const submitRestock = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!restockTarget || saving) return;
        if (!canRestock) {setActionError("Full Inventory access is required to restock.");return;}
        const receivedDate = dateInManila();
        const selected = restockLines.map(line => ({...line, raw: (restockQuantities[line.key] || "").trim()}))
            .filter(line => line.raw !== "" && Number(line.raw) > 0);
        if (selected.length === 0 || selected.some(line => !/^\d+$/.test(line.raw) || Number(line.raw) > 1000000)) {
            setActionError("Enter a positive whole quantity for at least one product or variant.");return;
        }
        if (selected.some(line => restockExpirations[line.key] && restockExpirations[line.key] < receivedDate)) {
            setActionError("Do not add stock that has already expired.");return;
        }
        if (!restockRequestKey.current) restockRequestKey.current = crypto.randomUUID();
        const total = selected.reduce((sum, line) => sum + Number(line.raw), 0);
        setSaving(true);setActionError("");setActionNotice("");
        try {
            const result = await sendInventoryAction({action:"receive_stock", requestKey:restockRequestKey.current,
                product_id:restockTarget.id, receivedDate,
                // Quantity only: no cost or pricing fields are sent (the server ignores them for Staff).
                lines:selected.map(line => ({variantId:line.variantId, quantity:Number(line.raw),
                    expirationDate:restockExpirations[line.key] || null}))});
            setActionNotice(result.alreadyProcessed
                ? `This restock of “${restockTarget.name}” was already recorded.`
                : `“${restockTarget.name}” received +${total.toLocaleString("en-PH")} units in inventory.`);
            setRestockTarget(null);restockRequestKey.current = "";
            await refreshAll();setActivityKey(k=>k+1);
        } catch (error) {setActionError(error instanceof Error ? error.message : "Unable to receive stock.");}
        finally {setSaving(false);}
    };
    const refresh = async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            if (isRental) setRentalKey(k=>k+1);
            else { await refreshAll(); setActivityKey(k=>k+1); }
        } finally { setIsRefreshing(false); }
    };

    return <>
        <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                <div>
                    <div className="flex items-center gap-3"><h1 className="text-[25px] font-bold text-[#1A1220]">Inventory</h1>
                        <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">{branch}</span></div>
                    <p className="mt-0.5 text-xs text-[#766983]">Manage products for sales and equipment for rentals.</p>
                </div>
                <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{now ? formatClock(now) : "Loading date..."}</span>
                    <button type="button" onClick={() => void refresh()} disabled={isRefreshing} className={primary}>
                        <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""}/> {isRefreshing ? "Refreshing..." : "Refresh"}
                    </button>
                </div>
            </div>
        </header>
        <main className="space-y-4 px-5 py-5 font-sans">
            <section className="flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-[#F1F3FF] to-[#F7F5FF] px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#5A35A5]">{isRental ? <CalendarDays size={22}/> : <ShoppingCart size={22}/>}</span>
                    <div><h2 className="text-[25px] font-bold text-[#1A1220]">{isRental ? "Rental Inventory" : "Consumable Inventory"}</h2>
                        <p className="mt-0.5 text-xs text-[#766983]">{isRental ? "Daily equipment preparation, releases, returns and inspections." : "Daily stock handling for products sold to customers."}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3" aria-label="Select inventory view">
                    <button type="button" aria-pressed={!isRental} onClick={()=>setTab("sales")} className={`${!isRental ? primary : outline} min-w-[145px]`}><ShoppingCart size={17}/> Consumable</button>
                    <button type="button" aria-pressed={isRental} onClick={()=>setTab("rental")} className={`${isRental ? primary : outline} min-w-[145px]`}><CalendarDays size={17}/> Rental</button>
                </div>
            </section>
            {isRental ? <StaffRentalInventory key={rentalKey} branchName={branch}/> : inv.productsLoading ?
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Stat label="Items to Restock" value={null} helper="Products at or below their reorder point" color="bg-[#F3EBFF] text-[#6C3AD6]" icon={<PackagePlus size={23}/>} loading/>
                        <Stat label="Low Stock Alerts" value={null} helper="Product variants approaching shortage" color="bg-[#FFF7E9] text-[#B7832E]" icon={<AlertTriangle size={23}/>} loading/>
                        <Stat label="Out of Stock" value={null} helper="Product variants with no available stock" color="bg-[#FFE7EB] text-[#CF3348]" icon={<Package size={23}/>} loading/>
                    </div>
                    <ModuleSkeleton variant="inventory"/>
                </div> : inv.productsError ?
                    <section role="alert" className={`${card} space-y-2 p-6`}><p className="font-semibold text-[#B92727]">Inventory could not be loaded.</p><p className="text-sm text-[#806A8C]">{inv.productsError}</p>
                        <button type="button" className={outline} onClick={()=>void refresh()}>Try Again</button></section> :
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Stat label="Items to Restock" value={attention.length} helper="Products at or below their reorder point" color="bg-[#F3EBFF] text-[#6C3AD6]" icon={<PackagePlus size={23}/>}/>
                            <Stat label="Low Stock Alerts" value={low.length} helper="Product variants approaching shortage" color="bg-[#FFF7E9] text-[#B7832E]" icon={<AlertTriangle size={23}/>}/>
                            <Stat label="Out of Stock" value={out.length} helper="Product variants with no available stock" color="bg-[#FFE7EB] text-[#CF3348]" icon={<Package size={23}/>}/>
                        </div>
                        {canReceive && receivingTasks.length > 0 && <section aria-label="Deliveries to receive" className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7DFEC] bg-[#F5F1FF] px-4 py-3 shadow-sm">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ECE3FF] text-[#5A35A5]"><PackagePlus size={19}/></span>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-bold text-[#21132E]">Deliveries to Receive ({receivingTasks.length})</h3>
                                <p className="mt-0.5 text-[11px] text-[#86778F]">Verify Manager-authorized products and record only the quantity physically received.</p>
                            </div>
                            <button type="button" className={`${outline} h-9 px-3 text-xs`} onClick={()=>{setActionError("");chooseReceipt(null);setShowReceivingInfo(true);}}>View Deliveries</button>
                        </section>}
                        <div className="grid min-w-0 grid-cols-1 gap-4">
                            {/* Same container, header, filter and table design as the Manager Stock Action Center. */}
                            <section className="flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
                                <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                                    <div className="flex items-start gap-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><ClipboardList size={18}/></span>
                                        <div>
                                            <h2 className="text-[15px] font-bold text-[#21132E]">Stock Alerts to Review</h2>
                                            <p className="mt-0.5 text-[11px] text-[#86778F]">Low and out-of-stock products to verify or report.</p>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <StaffInventoryFilterSelect containerClassName="w-[165px]" aria-label="Filter stock alerts by status" value={taskFilter} onChange={e=>setTaskFilter(e.target.value)}>
                                            <option value="all">All Status</option><option value="Low Stock">Low Stock</option><option value="Out of Stock">Out of Stock</option>
                                        </StaffInventoryFilterSelect>

                                    </div>
                                </div>

                                {tasks.length===0 ? (
                                    <div className="px-5 py-8 text-center text-sm text-[#8A7D90]">No stock alerts match the selected filters.</div>
                                ) : (
                                    <div className="max-h-[220px] w-full overflow-auto overscroll-contain" role="region" tabIndex={0} aria-label="Stock alerts to review">
                                        <table className="w-full min-w-[430px] table-fixed text-center text-[10px] xl:text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                                            <colgroup><col className="w-[32%]"/><col className="w-[17%]"/><col className="w-[16%]"/><col className="w-[17%]"/><col className="w-[18%]"/></colgroup>
                                            <thead className="sticky top-0 z-10 bg-[#FFFCF8]"><tr className="border-b border-[#E9E1EE]">
                                                {["Product","Current Stock","Reorder Point","Status","Action"].map(label=><th key={label} className={headClass}>{label}</th>)}
                                            </tr></thead>
                                            <tbody>{tasks.map(item=><tr key={item.key} className="border-b border-[#EFE8F2] last:border-b-0">
                                                <td className="break-words py-2 font-semibold text-[#2B174C] px-4 text-left">{item.name}</td>
                                                <td className="px-2 py-2 text-center font-semibold text-[#4F3A5A]">{item.stock}</td>
                                                <td className="px-2 py-2 text-center text-[#5F4E75]">{item.reorder}</td>
                                                <td className="px-2 py-2 text-center">
                                                    <span className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 ${item.status === "Out of Stock" ? "text-[#D92C3F]" : "text-[#C77A00]"}`}>{item.status}</span>
                                                </td>
                                                <td className="px-2 py-2 text-center">
                                                    <button type="button" onClick={()=>openRestock(item.product)} disabled={!canRestock} title={canRestock ? undefined : "Full Inventory access is required to restock."} className="inline-flex w-full max-w-[118px] items-center justify-center rounded-lg border border-[#D9CDF0] bg-[#F5F0FF] px-2 py-1.5 text-center text-[10px] font-semibold leading-4 text-[#5330B6] transition hover:bg-[#ECE3FF] disabled:cursor-not-allowed disabled:opacity-40">{item.status === "Out of Stock" ? "Restock Now" : "Restock"}</button>
                                                </td>
                                            </tr>)}</tbody>
                                        </table>
                                    </div>
                                )}
                            </section>
                            {/* Same container, header, filters and search layout as the Manager Branch Inventory List (Staff actions only). */}
                            <section id="staff-sales-list" className="flex h-[470px] min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
                                <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                                    <div className="flex items-start gap-3">
                                        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><Package size={18}/></span>
                                        <div>
                                            <h2 className="text-[15px] font-bold text-[#21132E]">Branch Sales Inventory List</h2>
                                            <p className="mt-0.5 text-[11px] text-[#86778F]">Products available for daily stock operations · {branch}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <StaffInventoryFilterSelect containerClassName="w-[168px]" aria-label="Filter categories" value={category} onChange={e=>setCategory(e.target.value)}>
                                            <option value="all">All Categories</option>{categories.map(cat=><option key={cat} value={cat}>{cat}</option>)}
                                        </StaffInventoryFilterSelect>
                                        <StaffInventoryFilterSelect containerClassName="w-[140px]" aria-label="Filter stock statuses" value={status} onChange={e=>setStatus(e.target.value)}>
                                            <option value="all">All Status</option>{["In Stock","Low Stock","Out of Stock","Expiring Soon","Expired"].map(value=><option key={value} value={value}>{value}</option>)}
                                        </StaffInventoryFilterSelect>
                                    </div>
                                </div>
                                <div className="shrink-0 border-b border-[#E9E1EE] px-4 pb-4">
                                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                                        <label className="relative min-w-0"><span className="sr-only">Search sales inventory</span>
                                            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                                            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product no., products, variants, or categories..." className="h-[44px] w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C]"/>
                                        </label>
                                        {canReceive && <button type="button" className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-5 text-sm font-semibold text-[#5330B6] shadow-sm transition hover:bg-[#ECE3FF]" onClick={()=>{setActionError("");setShowReceivingInfo(true);}}><PackagePlus size={16}/> Record Stock In{receivingTasks.length ? ` (${receivingTasks.length})` : ""}</button>}
                                    </div>
                                </div>
                                <div className="min-h-0 w-full flex-1 overflow-auto overscroll-contain" role="region" aria-label="Branch sales inventory list" tabIndex={0}>
                                    <table className="w-full min-w-[950px] table-auto text-center text-[10px] xl:text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                                        <colgroup><col className="w-[14%]"/><col className="w-[19%]"/><col className="w-[11%]"/><col className="w-[9%]"/><col className="w-[9%]"/><col className="w-[9%]"/><col className="w-[10%]"/><col className="w-[10%]"/><col className="w-[9%]"/></colgroup>
                                        <thead className="sticky top-0 z-10 bg-[#FFFCF8]"><tr className="border-b border-[#E9E1EE]">
                                            {['Product No.','Product','Category','Total Stock','Available','Reserved','Expiration','Status','Action'].map(label=><th key={label} className={headClass}>{label}</th>)}
                                        </tr></thead>
                                        <tbody>{visibleProducts.map(product=>{
                                            const variants=product.hasVariants&&product.variants?.length?product.variants:[];
                                            const expandable=variants.length>0;
                                            const expanded=Boolean(expandedProductIds[product.id]);
                                            const expirations=(expandable?variants.map(v=>v.expirationDate):[product.expirationDate]).filter((v):v is string=>!!v);
                                            const expiration=expirations.map(v=>v.slice(0,10)).sort()[0]||null;
                                            const sellableProduct={...product,
                                                stock:product.sellableStock ?? product.stock,
                                                variants:variants.map(v=>({...v,stock:v.sellableStock ?? v.stock}))};
                                            const availableStock=expandable
                                                ? variants.reduce((total,v)=>total+Number(v.sellableStock ?? v.stock),0)
                                                : Number(product.sellableStock ?? product.stock);
                                            return <React.Fragment key={product.id}>
                                                <tr className={`h-12 border-b border-[#EFE8F2] text-[#2B174C] hover:bg-[#FFFCF8] ${expandable?'cursor-pointer':''}`}
                                                    onClick={expandable?()=>setExpandedProductIds(old=>({...old,[product.id]:!old[product.id]})):undefined}>
                                                    <td className="whitespace-nowrap py-2 px-4 text-left font-semibold">
                                                        <div className="flex items-center justify-start gap-1.5">{expandable?<ChevronDown size={13} className={`shrink-0 transition ${expanded?'rotate-180':''}`}/>:<span className="inline-block w-[13px] shrink-0" aria-hidden="true"/>}<span>{product.productNumber||"—"}</span></div>
                                                    </td>
                                                    <td className="break-words px-2 py-2 font-semibold">{product.name}</td>
                                                    <td className="break-words px-2 py-2 text-[#5F4E75]">{product.category||"—"}</td>
                                                    <td className="px-2 py-2 text-center font-semibold">{formatInventoryBalance(product.branchStock)}</td>
                                                    <td className="px-2 py-2 text-center font-semibold">{availableStock.toLocaleString('en-PH')}</td>
                                                    <td className="px-2 py-2 text-center font-semibold text-[#5F4E75]">{formatInventoryBalance(product.reservedStock)}</td>
                                                    <td className="px-2 py-2 text-center text-[#5F4E75]">{inventoryExpirationLabel(expiration)}</td>
                                                    <td className="px-2 py-2 text-center">{staffInventoryStatusBadge(staffProductDisplayStatus(sellableProduct))}</td>
                                                    <td className="px-2 py-2 text-center"><button type="button" disabled={!canRestock} aria-label={`Restock ${product.name}`}
                                                                                                  title={canRestock?undefined:"Full Inventory access is required to restock."} className={staffRestockAction}
                                                                                                  onClick={e=>{e.stopPropagation();openRestock(product);}}><PackagePlus size={11}/> Restock</button></td>
                                                </tr>
                                                {expandable&&expanded&&variants.map(variant=>{
                                                    return <tr key={variant.id} className="h-12 border-b border-[#EFE8F2] bg-[#FCF9FF] text-[#2B174C]">
                                                        <td className="whitespace-nowrap py-2 pr-4 pl-[35px] text-left text-[10px] font-semibold text-[#5F3D82]" title="Variant Number">{variant.variantNumber||"—"}</td>
                                                        <td className="break-words px-2 py-2 pl-8 text-[10px] font-semibold text-[#5F3D82]">↳ {staffVariantDisplayName(variant.variantValues)}</td>
                                                        <td className="px-2 py-2 text-[#8A7D90]">Variant</td>
                                                        <td className="px-2 py-2 text-center font-semibold">{formatInventoryBalance(variant.branchStock)}</td>
                                                        <td className="px-2 py-2 text-center font-semibold">{Number(variant.sellableStock ?? variant.stock ?? 0).toLocaleString('en-PH')}</td>
                                                        <td className="px-2 py-2 text-center font-semibold text-[#5F4E75]">{formatInventoryBalance(variant.reservedStock)}</td>
                                                        <td className="px-2 py-2 text-center text-[#5F4E75]">{inventoryExpirationLabel(variant.expirationDate)}</td>
                                                        <td className="px-2 py-2 text-center">{staffInventoryStatusBadge(staffLineDisplayStatus(Number(variant.sellableStock ?? variant.stock),Number(variant.alertLevel),variant.expirationDate))}</td>
                                                        <td className="px-2 py-2 text-center"><button type="button" disabled={!canRestock} aria-label={`Restock ${product.name} variant`} title={canRestock?undefined:"Full Inventory access is required to restock."} onClick={()=>openRestock(product)} className={staffRestockAction}><PackagePlus size={11}/> Restock</button></td>
                                                    </tr>;
                                                })}
                                            </React.Fragment>;
                                        })}</tbody>
                                    </table>
                                    {visibleProducts.length===0&&<p className="py-10 text-center text-sm text-[#806A8C]">No products match your search or filters.</p>}
                                </div>
                            </section>
                        </div>
                    </div>}
        </main>
        {showActivityHistory && !isRental && <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#21132E]/50 p-4"
                                                  onMouseDown={event=>{if(event.target===event.currentTarget)setShowActivityHistory(false);}}>
            <section role="dialog" aria-modal="true" aria-labelledby="staff-activity-title"
                     className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] p-4">
                    <div><h3 id="staff-activity-title" className="text-lg font-bold text-[#21132E]">Branch Stock Activity</h3>
                        <p className="text-xs text-[#806A8C]">Read-only inventory movements · {branch}. Opening balances and demo setup entries are excluded.</p></div>
                    <button type="button" aria-label="Close stock activity" onClick={()=>setShowActivityHistory(false)}
                            className="rounded-lg p-2 text-[#6A5D6F] hover:bg-[#F7F1FF]"><X size={20}/></button>
                </div>
                <div className="flex flex-wrap gap-2 border-b border-[#E9E1EE] px-4 py-3">
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#5A476A]">Activity
                        <select value={activityFilter} onChange={e=>{setActivityFilter(e.target.value as typeof activityFilter);setActivityPage(1);}} className={filterClass}>
                            <option value="all">All Movements</option><option value="sales">POS Sales / Voids</option>
                            <option value="receiving">Stock Received</option><option value="adjustments">Other Adjustments</option>
                        </select></label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#5A476A]">When
                        <select value={activityPeriod} onChange={e=>{setActivityPeriod(e.target.value as typeof activityPeriod);setActivityPage(1);}} className={filterClass}>
                            <option value="today">Today (PH)</option><option value="week">Last 7 Days (PH)</option><option value="all">All Dates</option>
                        </select></label>
                </div>
                <div className="min-h-[200px] flex-1 overflow-y-auto overflow-x-hidden">
                    {activityHistoryLoading ? <div aria-busy="true" className="space-y-3 p-5">{[1,2,3,4,5].map(x=><div key={x} className="h-10 animate-pulse rounded-lg bg-[#F2EDF8]"/>)}</div> :
                        activityHistoryError ? <div role="alert" className="p-5 text-sm text-red-700">{activityHistoryError}
                                <button type="button" className="ml-3 underline" onClick={()=>setHistoryRetry(x=>x+1)}>Retry</button></div> :
                            <table className="w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                                <colgroup><col className="w-[17%]"/><col className="w-[27%]"/><col className="w-[18%]"/><col className="w-[8%]"/><col className="w-[19%]"/><col className="w-[11%]"/></colgroup><thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>
                                {['Date & Time','Product / Variant','Activity','Qty','Reference','Recorded By'].map(label=><th key={label} className={headClass}>{label}</th>)}</tr></thead>
                                <tbody>{activityHistory.map(item=><tr key={item.id} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                    <td className="break-words py-2 px-4 text-left">{safeDate(item.at)}</td>
                                    <td className="max-w-[240px] px-2 py-2 font-medium" title={item.item}>{item.item}</td>
                                    <td className="px-2 py-2 text-center"><span className={`inline-block max-w-full break-words font-semibold ${activityBadge(item.kind)}`}>{item.kind}</span></td>
                                    <td className="px-2 py-2 text-center font-semibold">{quantityLabel(item.quantity)}</td>
                                    <td className="max-w-[190px] break-all px-2 py-2">{item.reference}</td>
                                    <td className="px-2 py-2 text-center">{item.actorName}</td>
                                </tr>)}</tbody>
                            </table>}
                    {!activityHistoryLoading && !activityHistoryError && activityHistory.length === 0 &&
                        <p className="p-8 text-center text-sm text-[#806A8C]">No inventory movements match these filters.</p>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E9E1EE] px-4 py-3">
                    <p className="text-xs text-[#806A8C]">Page {activityPage} · Showing at most 20 entries per page</p>
                    <div className="flex gap-2">
                        <button type="button" className={`${outline} h-9 disabled:opacity-40`} disabled={activityHistoryLoading || activityPage===1}
                                onClick={()=>setActivityPage(page=>Math.max(1,page-1))}>Previous</button>
                        <button type="button" className={`${outline} h-9 disabled:opacity-40`}
                                disabled={activityHistoryLoading || !activityHistoryHasMore}
                                onClick={()=>setActivityPage(page=>page+1)}>Next</button>
                    </div>
                </div>
            </section>
        </div>}
        {!isRental && <SuccessToast
            toast={actionNotice ? {title:"Inventory task completed", message:actionNotice} : null}
            onClose={closeStaffNotice}
        />}
        {restockTarget && <div role="dialog" aria-modal="true" aria-label="Receive Stock"
                               className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-3 py-5">
            {/* Same layout and wording as the Manager's Receive Stock dialog. */}
            <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#E9E1EE] px-6 py-4">
                    <h2 className="text-xl font-bold text-[#21132E]">Receive Stock</h2>
                    <button type="button" onClick={()=>{setRestockTarget(null);setActionError("");}} disabled={saving} aria-label="Close Receive Stock"
                            className="text-2xl text-[#806A8C] hover:text-[#2B174C] disabled:opacity-50">×</button>
                </div>
                <form onSubmit={submitRestock} className="flex min-h-0 flex-col">
                    <div className="space-y-5 overflow-y-auto px-6 py-5">
                        <div>
                            <h3 className="text-base font-bold text-[#21132E]">{restockTarget.name}</h3>
                            <p className="mt-1 text-xs text-[#806A8C]">Product No. {restockTarget.productNumber || "—"} · {restockTarget.category}</p>
                            <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-[#F7F1FF] p-4">
                                <div><div className="text-xs text-[#806A8C]">Available Now (POS / Bookings)</div>
                                    <div className="mt-1 text-xl font-bold text-[#2B174C]">{restockAvailableBefore.toLocaleString("en-PH")}</div></div>
                                <div><div className="text-xs text-[#806A8C]">Available After Receiving</div>
                                    <div className="mt-1 text-xl font-bold text-[#2B174C]">{restockNeedsReconciliation ? "—" : (restockAvailableBefore + restockTotal).toLocaleString("en-PH")}</div></div>
                            </div>
                        </div>
                        <section className="space-y-3">
                            <h3 className="text-sm font-bold text-[#21132E]">{restockTarget.hasVariants ? "Variants to Restock" : "Stock to Receive"}</h3>
                            <p className="text-xs text-[#806A8C]">Enter the quantity to add. Leave other variants blank to keep them unchanged.</p>
                            {restockLines.map(line => (
                                <div key={line.key} className="space-y-3 rounded-xl border border-[#E3D8EA] p-4">
                                    <div className="flex justify-between gap-3">
                                        <div><strong className="text-sm text-[#2B174C]">{line.name}</strong>
                                            {line.variantNumber && <p className="mt-1 text-[11px] text-[#806A8C]">Variant No. {line.variantNumber}</p>}</div>
                                        <span className="text-xs text-[#806A8C]">Available: {line.sellable.toLocaleString("en-PH")} pcs</span>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1"><label className={labelClass}>Quantity to Add</label>
                                            <input type="number" min="0" step="1" value={restockQuantities[line.key] || ""}
                                                   onChange={e=>{setRestockQuantities(old=>({...old,[line.key]:e.target.value}));restockRequestKey.current="";}}
                                                   placeholder="0" className={fieldClass}/></div>
                                        <div className="space-y-1"><label className={labelClass}>Expiration Date (Optional)</label>
                                            <input type="date" value={restockExpirations[line.key] || ""}
                                                   onChange={e=>{setRestockExpirations(old=>({...old,[line.key]:e.target.value}));restockRequestKey.current="";}}
                                                   className={fieldClass}/></div>
                                    </div>
                                    <p className="text-xs text-[#806A8C]">Available after receiving: {line.stock !== line.sellable ? "Reconciliation required" : `${(line.sellable + (Number(restockQuantities[line.key]) || 0)).toLocaleString("en-PH")} pcs`}</p>
                                </div>
                            ))}
                            <div className="flex justify-between border-t border-[#E3D8EA] pt-3 text-sm font-semibold text-[#2B174C]">
                                <span>Total Stock to Add</span><span>+{restockTotal.toLocaleString("en-PH")} pcs</span>
                            </div>
                        </section>
                        {actionError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
                    </div>
                    <div className="flex justify-end gap-2 border-t border-[#E3D8EA] bg-white px-6 py-4">
                        <button type="button" onClick={()=>{setRestockTarget(null);setActionError("");}} disabled={saving}
                                className="rounded-xl border border-[#E3D8EA] px-5 py-2.5 text-sm font-semibold text-[#2B174C]">Cancel</button>
                        <button type="submit" disabled={saving || restockTotal <= 0 || !canRestock}
                                className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                            {saving ? "Saving..." : "Confirm Stock In"}
                        </button>
                    </div>
                </form>
            </div>
        </div>}
        {(details || showReceivingInfo) && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#21132E]/50 p-4" onMouseDown={event=>{if(event.target===event.currentTarget && !saving){setDetails(null);setShowReceivingInfo(false);setActionError("");}}}>
            <section role="dialog" aria-modal="true" aria-label={details ? "Stock review" : "Authorized stock receiving"} className="max-h-[90vh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-4"><h3 className="text-lg font-bold text-[#21132E]">{details ? "Stock Review" : "Record Stock In"}</h3>
                    <button aria-label="Close" type="button" disabled={saving} onClick={()=>{setDetails(null);setShowReceivingInfo(false);setActionError("");setActiveReceipt(null);}} className="rounded-lg p-1 text-[#6A5D6F] hover:bg-[#F7F1FF]"><X size={20}/></button></div>
                {actionError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
                {details ? <div className="mt-4 space-y-3 text-sm"><p className="font-semibold">{details.name}</p><p className="text-[#806A8C]">{details.reference} · {details.category}</p>
                    <div className="grid grid-cols-2 gap-2"><p>Available: <strong>{details.stock}</strong></p><p>Reorder point: <strong>{details.reorder}</strong></p></div>
                    <p>Status: <span className={`rounded-lg px-2 py-1 ${stockBadge(details.status)}`}>{details.status}</span>
                        {staffExpirationRisk(details.expirationDate) && <span className={`ml-2 rounded-lg px-2 py-1 ${staffExpirationRisk(details.expirationDate)==="Expired" ? "bg-[#FFE7EA] text-[#BF2438]":"bg-[#FFF3D8] text-[#A56607]"}`}>{staffExpirationRisk(details.expirationDate)}</span>}</p>
                    {details.status!=="In Stock" ? <>
                        {reportsByKey.has(details.key) ? <p className="rounded-xl bg-[#F7F3FC] p-3 text-xs text-[#6A5D6F]">A shortage report for this item is already open with the Manager.</p> : <>
                            <p className="rounded-xl bg-[#F7F3FC] p-3 text-xs leading-5 text-[#6A5D6F]">Verify the shelf or storage area and submit a shortage report. Staff cannot directly change inventory quantities.</p>
                            <label className="block text-xs font-semibold">Shortage Notes<textarea value={reportNotes} onChange={e=>setReportNotes(e.target.value)} maxLength={500} rows={3} placeholder="What did you verify? (5+ characters)" className="mt-1 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/></label>
                            <button type="button" disabled={saving || reportNotes.trim().length<5 || !!activityError} className={`${primary} disabled:opacity-40`} onClick={()=>void submitShortage(details)}>{saving ? "Reporting..." : "Report Shortage"}</button></>}
                    </> : <p className="rounded-xl bg-[#F7F3FC] p-3 text-xs text-[#6A5D6F]">This item is currently above its reorder point. Contact a Manager for corrections or catalog changes.</p>}
                    <div className="space-y-2 border-t border-[#E9E1EE] pt-3">
                        <h4 className="text-xs font-bold text-[#2B174C]">Report product condition</h4>
                        <p className="text-[11px] text-[#806A8C]">Use this to report expired, expiring or damaged items. Reporting does not delete products or adjust stock; isolate unsafe items and alert the Manager.</p>
                        {!conditionReportingSupported && <p className="rounded-lg bg-[#FFF3D8] p-2 text-[11px] text-[#926400]">Condition reporting needs the accompanying API update and migration before submission is enabled.</p>}
                        <label className="block text-xs font-semibold">Condition
                            <select value={conditionIssueType} onChange={e=>setConditionIssueType(e.target.value as typeof conditionIssueType)} className="mt-1 w-full rounded-xl border border-[#E6DDF0] bg-white p-2.5 text-sm">
                                {staffExpirationRisk(details.expirationDate)==="Expired" && <option value="expired">Expired</option>}
                                {staffExpirationRisk(details.expirationDate)==="Expiring Soon" && <option value="expiring">Expiring Soon</option>}
                                <option value="damaged">Damaged / Unsellable</option>
                            </select>
                        </label>
                        {conditionAlreadyReported(details,conditionIssueType) ? <p className="rounded-lg bg-[#F7F3FC] p-3 text-xs text-[#806A8C]">This type of condition report is already open with the Manager.</p> : <>
                            <label className="block text-xs font-semibold">Inspection Notes
                                <textarea value={conditionNotes} onChange={e=>setConditionNotes(e.target.value)} maxLength={500} rows={2} placeholder="What did you observe? (5+ characters)" className="mt-1 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/>
                            </label>
                            <button type="button" onClick={()=>void submitCondition(details)} disabled={!conditionReportingSupported || saving || conditionNotes.trim().length<5 || !!activityError} className={`${outline} h-9 px-3 text-xs disabled:opacity-40`}>Report Condition</button>
                        </>}
                    </div>
                </div> : <div className="mt-4 space-y-3 text-sm">
                    <p className="text-[#5F4E75]">Confirm only deliveries physically received and already authorized by the Manager. Stock, POS batches and audit movements are updated together. Pricing cannot be changed here.</p>
                    {!canReceive ? <p role="alert">Your staff account is not authorized for stock receiving.</p> : receivingTasks.length===0 ?
                        <p className="rounded-xl bg-[#F7F3FC] p-3 text-xs">No Manager-authorized deliveries are waiting for receiving.</p> : <>
                            <label className="block text-xs font-semibold">Pending Delivery<select className="mt-1 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm" value={activeReceipt?.id || ""} onChange={event=>chooseReceipt(receivingTasks.find(t=>String(t.id)===event.target.value)||null)}><option value="">Select authorized delivery</option>{receivingTasks.map(t=><option key={t.id} value={t.id}>{t.deliveryReference} — {t.productName} ({t.quantity} remaining)</option>)}</select></label>
                            {activeReceipt && <div className="space-y-3">
                                <div className="space-y-1 rounded-xl bg-[#F7F3FC] p-3 text-xs">
                                    <p className="font-semibold">{activeReceipt.productName}{variantLabel(activeReceipt.variantValues) ? ` — ${variantLabel(activeReceipt.variantValues)}` : ""}</p>
                                    <p>Delivery: {activeReceipt.deliveryReference}</p>
                                    <div className="mt-2 grid grid-cols-3 gap-2">
                                        <p>Authorized: <strong>{activeReceipt.authorizedQuantity ?? activeReceipt.quantity}</strong></p>
                                        <p>Previously received: <strong>{activeReceipt.alreadyReceived ?? 0}</strong></p>
                                        <p>Remaining: <strong>{activeReceipt.quantity}</strong></p>
                                    </div>
                                    {activeReceipt.expirationDate && <p>Batch expiry: {String(activeReceipt.expirationDate).slice(0,10)}</p>}
                                    {activeReceipt.notes && <p>Instructions: {activeReceipt.notes}</p>}
                                </div>
                                <label className="block text-xs font-semibold text-[#2B174C]">Actual Acceptable Units Received
                                    <input type="number" min="1" max={activeReceipt.quantity} step="1" required
                                           disabled={!partialReceiptSupported || saving} value={partialReceiptSupported ? receivingQuantity : String(activeReceipt.quantity)}
                                           onChange={e=>{setReceivingQuantity(e.target.value);receiptRequestKey.current="";}}
                                           className="mt-1 w-full rounded-xl border border-[#E6DDF0] bg-white px-3 py-2.5 text-sm text-[#2B174C] disabled:bg-[#F8F6FC]"/>
                                </label>
                                {!partialReceiptSupported && <p className="text-[11px] text-[#806A8C]">The current server supports full deliveries only. Apply the accompanying partial-receipt migration and API update to enter a smaller amount.</p>}
                                {partialReceiptSupported && <>
                                    <p className="text-[11px] text-[#806A8C]">Only count goods that arrived in sellable condition. Leave missing, damaged, or expired units unreceived; do not place those units in available stock.</p>
                                    <label className="block text-xs font-semibold text-[#2B174C]">Receiving / discrepancy notes {Number(receivingQuantity) < activeReceipt.quantity ? "(required for partial receipt)" : "(optional)"}
                                        <textarea maxLength={500} rows={2} value={receivingNotes}
                                                  onChange={e=>{setReceivingNotes(e.target.value);receiptRequestKey.current="";}}
                                                  placeholder="e.g. 5 units not yet delivered; notify Manager"
                                                  className="mt-1 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/>
                                    </label>
                                    {receivingQuantity.trim() !== "" && Number.isSafeInteger(Number(receivingQuantity)) && Number(receivingQuantity)>0 && Number(receivingQuantity)<activeReceipt.quantity && <p className="rounded-lg bg-[#FFF3D8] px-3 py-2 text-xs text-[#926400]">Partial delivery: {activeReceipt.quantity-Number(receivingQuantity)} units will remain pending for the Manager to track.</p>}
                                </>}
                            </div>}
                            <button type="button" disabled={!activeReceipt || saving ||
                                (partialReceiptSupported && (receivingQuantity.trim()==="" || !Number.isSafeInteger(Number(receivingQuantity)) || Number(receivingQuantity)<1 || Number(receivingQuantity)>Number(activeReceipt.quantity) ||
                                    (Number(receivingQuantity)<Number(activeReceipt.quantity) && receivingNotes.trim().length<5)))}
                                    className={`${primary} disabled:opacity-40`} onClick={()=>activeReceipt && void confirmReceipt(activeReceipt)}>{saving ? "Recording..." : "Confirm Physical Receipt"}</button>
                        </>}
                </div>}
            </section>
        </div>}
    </>;
}

/* Sales Operations Queue, moved from Staff Inventory to Staff Bookings. The state, Booking
   Lambda actions, validations, dialogs and permissions below are the original queue code;
   `search` comes from the Staff Bookings search bar. */
export function StaffSalesOperationsQueue({ search = "" }: { search?: string }) {
    const [now, setNow] = React.useState<Date | null>(null);
    React.useEffect(() => {
        setNow(new Date());
        const interval = window.setInterval(() => setNow(new Date()), 30000);
        return () => window.clearInterval(interval);
    }, []);
    const [salesBookings,setSalesBookings]=React.useState<SalesBooking[]>([]);
    const [salesQueueFilter,setSalesQueueFilter]=React.useState<SalesQueueFilter>("all");
    const [selectedSalesBookingRef,setSelectedSalesBookingRef]=React.useState<string|null>(null);
    const [salesQueueLoading,setSalesQueueLoading]=React.useState(false);
    const [canOperateSalesQueue,setCanOperateSalesQueue]=React.useState(false);
    const [salesQueueSaving,setSalesQueueSaving]=React.useState(false);
    const [salesQueueError,setSalesQueueError]=React.useState("");
    const [salesQueueNotice,setSalesQueueNotice]=React.useState("");
    const closeSalesNotice = React.useCallback(() => setSalesQueueNotice(""), []);
    const [confirmSalesRelease,setConfirmSalesRelease]=React.useState(false);
    const [salesQueueKey,setSalesQueueKey]=React.useState(0);
    const salesToday=dateInManila(now??new Date());
    const visibleSalesBookings=React.useMemo(()=>salesBookings.filter(booking=>{
            const query=search.trim().toLowerCase();
            if(query&&![booking.reference,booking.clientName,booking.bookingType,booking.packageName,
                ...booking.items.flatMap(item=>[item.productName,item.variantName])].join(" ").toLowerCase().includes(query))return false;
            // Filter by operational stage only; event dates still govern actual release eligibility.
            if(salesQueueFilter==="prepare" && !booking.items.some(item=>!item.prepared&&!item.issued))return false;
            if(salesQueueFilter==="release" && !(booking.items.length>0 && booking.items.every(item=>item.prepared&&!item.issued)))return false;
            return true;
        }).sort((a,b)=>compareQueueEventDates(a.eventDate,b.eventDate,salesToday)||a.reference.localeCompare(b.reference)),
        [salesBookings,salesQueueFilter,search,salesToday]);
    const selectedSalesBooking=salesBookings.find(booking=>booking.reference===selectedSalesBookingRef)||null;
    const selectedSalesReady=!!selectedSalesBooking && selectedSalesBooking.items.length>0 &&
        selectedSalesBooking.items.every(item=>item.prepared&&!item.issued);
    const selectedSalesReleaseEligible=selectedSalesReady && !!selectedSalesBooking &&
        salesBookingFullyPaid(selectedSalesBooking) && selectedSalesBooking.eventDate<=salesToday && canOperateSalesQueue && !salesQueueSaving;
    // Dedicated operational queue: the Booking Lambda returns only the Sales inclusions
    // reserved for confirmed/preparing bookings in this Staff member's branch.
    React.useEffect(()=>{
        const abort=new AbortController();
        const load=async()=>{
            setSalesQueueLoading(true);setSalesQueueError("");
            try{
                const token=sessionStorage.getItem("token");
                if(!token)throw new Error("Your session has expired. Please sign in again.");
                const response=await fetch("/api/bookings",{method:"POST",cache:"no-store",signal:abort.signal,
                    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
                    body:JSON.stringify({action:"get_staff_sales_booking_queue"})});
                const data=await response.json().catch(()=>({}));
                if(!response.ok||data.success!==true||!Array.isArray(data.bookings))
                    throw new Error(String(data.error||"Unable to load Sales booking tasks."));
                if(!abort.signal.aborted){setSalesBookings(data.bookings as SalesBooking[]);setCanOperateSalesQueue(data.canOperateSalesQueue===true);}
            }catch(error){
                if(!abort.signal.aborted){setSalesQueueError(error instanceof Error?error.message:"Unable to load Sales booking tasks.");setSalesBookings([]);setCanOperateSalesQueue(false);}
            }finally{if(!abort.signal.aborted)setSalesQueueLoading(false);}
        };
        void load();return()=>abort.abort();
    },[salesQueueKey]);
    React.useEffect(()=>{
        if(!selectedSalesBookingRef)return;
        const close=(event:KeyboardEvent)=>{
            if(event.key==="Escape"&&!salesQueueSaving){setSelectedSalesBookingRef(null);setConfirmSalesRelease(false);}
        };
        window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);
    },[selectedSalesBookingRef,salesQueueSaving]);
    const sendSalesBookingAction=async(actionName:"prepare_staff_sales_booking_item"|"release_staff_sales_booking",booking:SalesBooking,itemId?:number)=>{
        if(salesQueueSaving)return;
        setSalesQueueSaving(true);setSalesQueueError("");setSalesQueueNotice("");
        try{
            const token=sessionStorage.getItem("token");
            if(!token)throw new Error("Your session has expired. Please sign in again.");
            const response=await fetch("/api/bookings",{method:"POST",cache:"no-store",
                headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
                body:JSON.stringify({action:actionName,booking_id:booking.bookingId,...(itemId?{item_id:itemId}:{})})});
            const result=await response.json().catch(()=>({}));
            if(!response.ok||result.success!==true)throw new Error(String(result.error||"Unable to record booking operation."));
            setSalesQueueNotice(actionName==="release_staff_sales_booking"?
                `Sales inclusions released for ${booking.reference}.`:`Product preparation recorded for ${booking.reference}.`);
            if(actionName==="release_staff_sales_booking"){
                setSelectedSalesBookingRef(null);setConfirmSalesRelease(false);
            }
            setSalesQueueKey(key=>key+1);
        }catch(error){setSalesQueueError(error instanceof Error?error.message:"Unable to process booking.");}
        finally{setSalesQueueSaving(false);}
    };

    return <>
        <section className={`${card} flex h-[340px] min-h-0 min-w-0 flex-col`}>
            <SectionHead icon={<ClipboardList size={18}/>} title="Sales Operations Queue"
                         subtitle="Booking inclusions to prepare and hand over · no rental equipment">
                <select aria-label="Filter sales booking tasks" value={salesQueueFilter}
                        onChange={e=>setSalesQueueFilter(e.target.value as SalesQueueFilter)}
                        className="h-9 w-[104px] rounded-xl border border-[#E6DDF0] bg-white px-2 text-[11px] font-semibold text-[#2B174C] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus:border-[#E6DDF0]">
                    <option value="all">All Tasks</option>
                    <option value="prepare">Prepare</option>
                    <option value="release">Release</option>
                </select>
            </SectionHead>
            {salesQueueError&&<p role="alert" className="px-3 py-2 text-[11px] text-red-700">{salesQueueError}
                <button type="button" className="ml-2 underline" onClick={()=>setSalesQueueKey(key=>key+1)}>Retry</button></p>}
            {salesQueueLoading?<div className="space-y-3 p-4" aria-busy="true">{[1,2,3,4].map(x=><div key={x} className="h-8 animate-pulse rounded-lg bg-[#F2EDF8]"/>)}</div>:
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" role="region" aria-label="Sales operations booking queue" tabIndex={0}>
                    <table className="w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                        <colgroup><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/></colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>
                            {["Client / Booking Ref","Schedule","Booking Type","Status","Action"].map(label=><th key={label} className={headClass}>{label}</th>)}
                        </tr></thead>
                        <tbody>{visibleSalesBookings.map(booking=>{
                            const active=selectedSalesBookingRef===booking.reference;
                            const statusLabel=salesQueueBookingStatus(booking);
                            const open=()=>{setSelectedSalesBookingRef(booking.reference);setSalesQueueError("");};
                            return <tr key={booking.bookingId} tabIndex={0} aria-selected={active}
                                       onClick={open}
                                       onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();open();}}}
                                       className={`cursor-pointer border-t border-[#F0EAF4] text-[#2B174C] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] ${active?"":"hover:bg-[#FCF9FF]"}`}>
                                <td className={`py-2 text-left align-middle ${active?"border-l-4 border-[#6F3FD3] px-3":"px-4"}`}>
                                    <span className="block break-words font-semibold">{booking.clientName}</span>
                                    <span className="mt-1 block break-all text-[10px] text-[#806A8C]">{booking.reference}</span>
                                </td>
                                <td className="px-2 py-2 text-center align-middle">
                                    <span className="block font-medium">{displaySalesBookingDate(booking.eventDate)}</span>
                                    {booking.eventTime&&<span className="mt-1 block text-[10px] text-[#806A8C]">{booking.eventTime}</span>}
                                </td>
                                <td className="px-2 py-2 text-center align-middle">
                                    <span className="block break-words font-medium">{salesBookingType(booking.bookingType)}</span>
                                    <span className="mt-1 block text-[10px] text-[#806A8C]">{booking.items.length} product {booking.items.length===1?"line":"lines"}</span>
                                </td>
                                <td className="px-2 py-2 text-center align-middle">
                                    <span className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 break-words ${salesQueueStatusStyles[statusLabel]||"text-[#2B174C]"}`}>
                                        {statusLabel}
                                    </span>
                                </td>
                                <td className="px-2 py-2 text-center align-middle">
                                    <button type="button" aria-haspopup="dialog"
                                            onClick={e=>{e.stopPropagation();open();}}
                                            className="inline-flex min-h-[32px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50">
                                        View Items
                                    </button>
                                </td>
                            </tr>;
                        })}</tbody>
                    </table>
                    {visibleSalesBookings.length===0&&<p className="p-5 text-center text-xs text-[#806A8C]">No Sales product preparation tasks match this filter.</p>}
                </div>}
        </section>
        {selectedSalesBooking&&<div role="presentation" className="fixed inset-0 z-[85] flex items-center justify-center bg-[#21132E]/55 p-4"
                                    onMouseDown={e=>{if(e.target===e.currentTarget&&!salesQueueSaving)setSelectedSalesBookingRef(null);}}>
            <section role="dialog" aria-modal="true" aria-label="Sales products for this booking"
                     className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-xl">
                <header className="flex items-center justify-between gap-3 border-b border-[#E9E1EE] px-5 py-4">
                    <div><h3 className="text-lg font-bold text-[#21132E]">Sales Products for this Booking</h3>
                        <p className="mt-1 break-all text-xs text-[#806A8C]">{selectedSalesBooking.reference}</p></div>
                    <button type="button" className={`${outline} h-9 px-3 text-xs`} disabled={salesQueueSaving} onClick={()=>setSelectedSalesBookingRef(null)}><X size={15}/> Close</button>
                </header>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div className="grid gap-3 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-4 text-xs sm:grid-cols-3">
                        <div><p className="text-[10px] font-semibold uppercase text-[#806A8C]">Client</p><p className="mt-1 font-semibold text-[#21132E]">{selectedSalesBooking.clientName}</p></div>
                        <div><p className="text-[10px] font-semibold uppercase text-[#806A8C]">Schedule</p><p className="mt-1 font-semibold text-[#21132E]">{displaySalesBookingDate(selectedSalesBooking.eventDate)}{selectedSalesBooking.eventTime?` · ${selectedSalesBooking.eventTime}`:""}</p></div>
                        <div><p className="text-[10px] font-semibold uppercase text-[#806A8C]">Booking Type</p><p className="mt-1 font-semibold text-[#21132E]">{salesBookingType(selectedSalesBooking.bookingType)}</p>
                            {selectedSalesBooking.packageName&&<p className="mt-1 text-[#806A8C]">{selectedSalesBooking.packageName}</p>}</div>
                    </div>
                    <section className="overflow-hidden rounded-xl border border-[#E6DDF0]">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3">
                            <div><h4 className="text-sm font-bold text-[#21132E]">Sales Product Checklist</h4>
                                <p className="mt-1 text-[11px] text-[#806A8C]">{selectedSalesBooking.items.length} product {selectedSalesBooking.items.length===1?"line":"lines"} · {selectedSalesBooking.items.reduce((s,i)=>s+i.quantity,0)} booked units</p>
                                <p className="text-[11px] text-[#806A8C]">{selectedSalesBooking.items.filter(i=>i.prepared).length} of {selectedSalesBooking.items.length} prepared</p></div>
                            <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${salesBookingFullyPaid(selectedSalesBooking)?"bg-[#E5F7ED] text-[#218246]":"bg-[#FFF3D8] text-[#926400]"}`}>
                                {salesBookingFullyPaid(selectedSalesBooking)?"Fully Paid":"Balance Pending"}</span>
                        </div>
                        <div className="max-h-[320px] min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain"><table className="w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[42%]"/><col className="w-[10%]"/><col className="w-[20%]"/><col className="w-[28%]"/></colgroup>
                            <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>{["Product / Variant","Qty","Status","Action"].map(label=><th className={headClass} key={label}>{label}</th>)}</tr></thead>
                            <tbody>{selectedSalesBooking.items.map(item=><tr key={item.itemId} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                <td className="break-words py-2 font-medium px-4 text-left">{item.productName}{item.variantName?` — ${item.variantName}`:""}</td>
                                <td className="px-2 py-2 text-center font-semibold">{item.quantity}</td>
                                <td className={`px-2 py-2 text-center text-[10px] font-semibold ${item.issued?"text-[#1D4ED8]":item.prepared?"text-[#23834A]":"text-[#A56607]"}`}>{item.issued?"Handed Over":item.prepared?"Prepared":"Needs Preparation"}</td>
                                <td className="px-2 py-2 text-center">{!item.prepared&&!item.issued?
                                    <button type="button" className={`${outline} h-9 w-full px-2 text-xs disabled:opacity-40`}
                                            disabled={!canOperateSalesQueue||salesQueueSaving} onClick={()=>void sendSalesBookingAction("prepare_staff_sales_booking_item",selectedSalesBooking,item.itemId)}>
                                        {salesQueueSaving?"Saving...":"Mark Prepared"}</button>:
                                    <span className="text-[11px] text-[#806A8C]">{item.issued?"Released":"Ready for booking release"}</span>}</td>
                            </tr>)}</tbody>
                        </table></div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EAF4] px-4 py-3">
                            <p className="max-w-lg text-[11px] text-[#806A8C]">All Sales inclusions must be physically prepared and the full booking balance recorded before handover. Confirmed reservations already reduced available stock.</p>
                            <button type="button" className={`${primary} h-10 text-xs disabled:cursor-not-allowed disabled:opacity-40`}
                                    disabled={!selectedSalesReleaseEligible} onClick={()=>setConfirmSalesRelease(true)}><Truck size={16}/> Release Sales Products</button>
                        </div>
                        {!selectedSalesReady&&<p className="px-4 pb-3 text-[11px] text-[#926400]">Prepare every Sales product line first.</p>}
                        {!canOperateSalesQueue&&<p className="px-4 pb-3 text-[11px] text-[#926400]">Full Inventory permission is required to prepare or hand over Sales products.</p>}
                        {selectedSalesReady&&!salesBookingFullyPaid(selectedSalesBooking)&&<p className="px-4 pb-3 text-[11px] text-[#926400]">Full booking payment is required before release.</p>}
                        {selectedSalesReady&&salesBookingFullyPaid(selectedSalesBooking)&&selectedSalesBooking.eventDate>salesToday&&<p className="px-4 pb-3 text-[11px] text-[#926400]">Wait until the scheduled event date before releasing products.</p>}
                    </section>
                    {salesQueueError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{salesQueueError}</p>}
                </div>
                <div className="flex justify-end border-t border-[#E9E1EE] px-5 py-3"><button type="button" className={`${outline} h-9 text-xs`} onClick={()=>setSelectedSalesBookingRef(null)}>Close</button></div>
            </section>
        </div>}
        {confirmSalesRelease&&selectedSalesBooking&&<div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#21132E]/55 p-3 sm:p-4">
            <section role="alertdialog" aria-modal="true" aria-label="Confirm Sales booking handover" className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <h3 className="text-lg font-bold text-[#21132E]">Release Sales Products</h3>
                <p className="text-xs text-[#5A476A]">Confirm the physical handover of all {selectedSalesBooking.items.reduce((sum,item)=>sum+item.quantity,0)} Sales units under {selectedSalesBooking.reference}. This action does not deduct inventory a second time.</p>
                {salesQueueError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{salesQueueError}</p>}
                <div className="flex justify-end gap-2"><button type="button" className={outline} disabled={salesQueueSaving} onClick={()=>setConfirmSalesRelease(false)}>Cancel</button>
                    <button type="button" className={`${primary} disabled:opacity-40`} disabled={!selectedSalesReleaseEligible}
                            onClick={()=>void sendSalesBookingAction("release_staff_sales_booking",selectedSalesBooking)}>
                        {salesQueueSaving?"Saving...":"Confirm Handover"}</button></div>
            </section>
        </div>}
        <SuccessToast toast={salesQueueNotice ? {title:"Sales queue updated", message:salesQueueNotice} : null} onClose={closeSalesNotice}/>
    </>;
}