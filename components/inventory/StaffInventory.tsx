"use client";

import * as React from "react";
import {
    AlertTriangle, ArrowLeftRight, CalendarDays, ClipboardList, Clock3, Eye,
    Package, PackagePlus, RefreshCw, Search, ShoppingCart, X, CheckCircle2,
} from "lucide-react";
import { useInventoryController } from "@/hooks/useInventory";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import type { Product } from "./_shared";
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

const card = "overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const outline = "inline-flex h-[42px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F7F1FF]";
const primary = "inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]";
const filterClass = "h-[40px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-xs text-[#2B174C] outline-none focus:border-[#2B174C]";
const headClass = "px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]";

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

// Keep the compact activity panel limited to the current Philippine business day.
// The View All Activity dialog retains its existing selectable date range.
function isActivityFromToday(value: string, today: string) {
    if (!value) return false;
    const parsed = new Date(value.includes(" ") ? value.replace(" ", "T") : value);
    return !Number.isNaN(parsed.getTime()) && dateInManila(parsed) === today;
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
                return from(variant.stock, variant.alertLevel, `${product.name} – ${label}`,
                    variant.variantNumber || product.productNumber || "", `${product.id}:${variant.id}`, variant.id, variant.expirationDate);
            });
        }
        return [from(product.stock, product.alertLevel, product.name, product.productNumber || "", `${product.id}:regular`, null, product.expirationDate)];
    });
}
function stockBadge(status: StockLine["status"]) {
    return status === "Out of Stock" ? "bg-[#FFE7EA] text-[#BF2438]" :
        status === "Low Stock" ? "bg-[#FFF3D8] text-[#B07408]" : "bg-[#E5F7ED] text-[#218246]";
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
    if (kind === "POS Sale") return "bg-[#F3F0F8] text-[#5A476A]";
    if (kind === "Stock Received") return "bg-[#E5F7ED] text-[#218246]";
    if (kind === "POS Void") return "bg-[#E9F2FF] text-[#2861A8]";
    return "bg-[#F2EDF8] text-[#5A476A]";
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
function Stat({label,value,helper,icon,color}: {label:string;value:number|null;helper:string;icon:React.ReactNode;color:string}) {
    return <div className="flex h-[132px] flex-col rounded-[18px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2"><p className="pt-1 text-sm font-semibold text-[#1A1220]">{label}</p>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${color}`}>{icon}</span></div>
        <p className="mt-3 text-[23px] font-bold leading-tight text-[#2B174C]">{value == null ? "—" : value.toLocaleString("en-PH")}</p>
        <p className="mt-1 text-[11px] leading-4 text-[#8A7D90]">{helper}</p>
    </div>;
}

export default function StaffInventory() {
    const inv = useInventoryController();
    const refreshAll = inv.refreshAll;
    const [now, setNow] = React.useState<Date | null>(null);
    const [tab, setTab] = React.useState<"sales" | "rental">("sales");
    const [search, setSearch] = React.useState("");
    const [category, setCategory] = React.useState("all");
    const [status, setStatus] = React.useState("all");
    const [taskFilter, setTaskFilter] = React.useState("all");
    const [details, setDetails] = React.useState<StockLine | null>(null);
    const [showReceivingInfo, setShowReceivingInfo] = React.useState(false);
    const [canReceive, setCanReceive] = React.useState(false);
    const [receivingTasks, setReceivingTasks] = React.useState<ReceivingTask[]>([]);
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
    const [saving, setSaving] = React.useState(false);
    const [actionError, setActionError] = React.useState("");
    const [actionNotice, setActionNotice] = React.useState("");
    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [activityKey, setActivityKey] = React.useState(0);
    const [rentalKey, setRentalKey] = React.useState(0);
    const lastFocusSync = React.useRef(0);
    const previousDay = React.useRef<string | null>(null);
    const [activities, setActivities] = React.useState<ActivityRow[]>([]);
    const [todayMovementCount, setTodayMovementCount] = React.useState<number | null>(null);
    const [showActivityHistory, setShowActivityHistory] = React.useState(false);
    const [activityFilter, setActivityFilter] = React.useState<"all" | "sales" | "receiving" | "adjustments">("all");
    const [activityPeriod, setActivityPeriod] = React.useState<"today" | "week" | "all">("week");
    const [activityPage, setActivityPage] = React.useState(1);
    const [activityHistory, setActivityHistory] = React.useState<ActivityRow[]>([]);
    const [activityHistoryHasMore, setActivityHistoryHasMore] = React.useState(false);
    const [activityHistoryLoading, setActivityHistoryLoading] = React.useState(false);
    const [activityHistoryError, setActivityHistoryError] = React.useState("");
    const [historyRetry, setHistoryRetry] = React.useState(0);
    const [activityError, setActivityError] = React.useState<string | null>(null);
    const [activityLoading, setActivityLoading] = React.useState(true);
    const isRental = tab === "rental";
    const lines = React.useMemo(() => toStockLines(inv.baseProducts), [inv.baseProducts]);
    const {low, out, attention} = React.useMemo(() => {
        const low = lines.filter(line => line.status === "Low Stock");
        const out = lines.filter(line => line.status === "Out of Stock");
        return {low, out, attention:[...out, ...low]};
    }, [lines]);
    const categories = React.useMemo(() => [...new Set(lines.map(item => item.category))].sort(), [lines]);
    const visible = React.useMemo(() => lines.filter(line =>
            [line.name, line.reference, line.category].join(" ").toLowerCase().includes(search.toLowerCase()) &&
            (category === "all" || line.category === category) && (status === "all" || line.status === status)),
        [lines, search, category, status]);
    const tasks = React.useMemo(() => attention.filter(line => taskFilter === "all" || line.status === taskFilter),
        [attention, taskFilter]);
    const reportsByKey = React.useMemo(() => new Set(shortageReports.map(r=>`${r.productId}:${r.variantId ?? "regular"}`)),
        [shortageReports]);
    const conditionAlreadyReported = (line: StockLine, issueType: string) =>
        conditionReports.some(report => report.productId === line.product.id &&
            (report.variantId ?? null) === line.variantId && report.issueType === issueType);
    const openProductReview = (line: StockLine) => {
        setDetails(line);setActionError("");setReportNotes("");setConditionNotes("");
        const risk = staffExpirationRisk(line.expirationDate);
        setConditionIssueType(risk === "Expired" ? "expired" : risk === "Expiring Soon" ? "expiring" : "damaged");
    };
    const branch = inv.assignedBranchName || "Assigned Branch";
    const todayActivities = React.useMemo(() => {
        const today = dateInManila(now ?? new Date());
        return activities.filter(item => isActivityFromToday(item.at, today));
    }, [activities, now]);

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
            setActivityLoading(true); setActivityError(null);
            const token = sessionStorage.getItem("token");
            if (!token) {setActivityError("Session expired.");setActivityLoading(false);return;}
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
                setActivities(fromMovements(Array.isArray(data.movements) ? data.movements : []));
                setTodayMovementCount(Number.isSafeInteger(data.todayMovementCount) && data.todayMovementCount >= 0
                    ? data.todayMovementCount : null);
            } catch (error) {
                if (controller.signal.aborted) return;
                setCanReceive(false); setPartialReceiptSupported(false); setReceivingTasks([]); setShortageReports([]); setConditionReports([]); setConditionReportingSupported(false); setActivities([]);
                setTodayMovementCount(null);
                setActivityError(error instanceof Error ? error.message : "Unable to load stock activity.");
            } finally {if (!controller.signal.aborted) setActivityLoading(false);}
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
                <div className="flex items-center gap-3"><h1 className="text-[25px] font-bold text-[#1A1220]">Inventory</h1>
                    <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">{branch}</span></div>
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
                    <div><h2 className="text-[25px] font-bold text-[#1A1220]">{isRental ? "Rental Inventory" : "Sales Inventory"}</h2>
                        <p className="mt-0.5 text-xs text-[#766983]">{isRental ? "Daily equipment preparation, releases, returns and inspections." : "Daily stock handling for products sold to customers."}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-3" aria-label="Select inventory view">
                    <button type="button" aria-pressed={!isRental} onClick={()=>setTab("sales")} className={`${!isRental ? primary : outline} min-w-[145px]`}><ShoppingCart size={17}/> Sales Inventory</button>
                    <button type="button" aria-pressed={isRental} onClick={()=>setTab("rental")} className={`${isRental ? primary : outline} min-w-[145px]`}><CalendarDays size={17}/> Rental Inventory</button>
                </div>
            </section>
            {isRental ? <StaffRentalInventory key={rentalKey} branchName={branch}/> : inv.productsLoading ?
                <ModuleSkeleton variant="inventory"/> : inv.productsError ?
                    <section role="alert" className={`${card} space-y-2 p-6`}><p className="font-semibold text-[#B92727]">Inventory could not be loaded.</p><p className="text-sm text-[#806A8C]">{inv.productsError}</p>
                        <button type="button" className={outline} onClick={()=>void refresh()}>Try Again</button></section> :
                    <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <Stat label="Items to Restock" value={attention.length} helper="Products at or below their reorder point" color="bg-[#FFF3DE] text-[#E68A00]" icon={<PackagePlus size={19}/>}/>
                            <Stat label="Low Stock Alerts" value={low.length} helper="Product variants approaching shortage" color="bg-[#FFF3DE] text-[#E68A00]" icon={<AlertTriangle size={19}/>}/>
                            <Stat label="Out of Stock" value={out.length} helper="Product variants with no available stock" color="bg-[#FFE7EB] text-[#CF3348]" icon={<Package size={19}/>}/>
                            <Stat label="Today's Stock Movements" value={activityLoading || activityError ? null : todayMovementCount} helper="Actual branch inventory movements today (PH time)" color="bg-[#E9F2FF] text-[#1E6FE8]" icon={<ArrowLeftRight size={19}/>}/>
                        </div>
                        {canReceive && receivingTasks.length > 0 && <section aria-label="Deliveries to receive" className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7DFEC] bg-[#F5F1FF] px-4 py-3 shadow-sm">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ECE3FF] text-[#5A35A5]"><PackagePlus size={19}/></span>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-bold text-[#21132E]">Deliveries to Receive ({receivingTasks.length})</h3>
                                <p className="mt-0.5 text-[11px] text-[#86778F]">Verify Manager-authorized products and record only the quantity physically received.</p>
                            </div>
                            <button type="button" className={`${outline} h-9 px-3 text-xs`} onClick={()=>{setActionError("");chooseReceipt(null);setShowReceivingInfo(true);}}>View Deliveries</button>
                        </section>}
                        <div className="grid items-stretch gap-4 xl:grid-cols-[1.15fr_1fr]">
                            {/* Manager-inspired table sizing, with Staff-only review actions. */}
                            <section className={`${card} flex h-[470px] min-h-0 min-w-0 flex-col`}>
                                <SectionHead icon={<ClipboardList size={18}/>} title="Stock Alerts to Review" subtitle="Low and out-of-stock products to verify or report.">
                                    <select aria-label="Filter sales tasks" value={taskFilter} onChange={e=>setTaskFilter(e.target.value)}
                                            className="h-9 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none">
                                        <option value="all">All Tasks</option><option value="Low Stock">Low Stock</option><option value="Out of Stock">Out of Stock</option>
                                    </select>
                                </SectionHead>
                                <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
                                    <table className="w-full table-fixed text-[10px] xl:text-[11px]">
                                        <colgroup><col className="w-[36%]"/><col className="w-[11%]"/><col className="w-[12%]"/><col className="w-[23%]"/><col className="w-[18%]"/></colgroup>
                                        <thead className="sticky top-0 z-10 bg-[#FFFCF8]"><tr className="border-b border-[#E9E1EE]">
                                            <th className="break-words px-2 py-2.5 text-left text-[9px] font-semibold uppercase text-[#806A8C]">Product</th>
                                            <th className="break-words px-1 py-2.5 text-center text-[9px] font-semibold uppercase text-[#806A8C]">Current Stock</th>
                                            <th className="break-words px-1 py-2.5 text-center text-[9px] font-semibold uppercase text-[#806A8C]">Reorder Point</th>
                                            <th className="px-1 py-2.5 text-center text-[9px] font-semibold uppercase text-[#806A8C]">Task</th>
                                            <th className="px-1 py-2.5 text-center text-[9px] font-semibold uppercase text-[#806A8C]">Action</th>
                                        </tr></thead>
                                        <tbody>{tasks.slice(0,30).map(item=><tr key={item.key} className="border-b border-[#EFE8F2] text-[#2B174C] last:border-b-0">
                                            <td className="break-words px-3 py-2.5 font-semibold">{item.name}</td>
                                            <td className="px-1 py-2.5 text-center font-semibold">{item.stock}</td>
                                            <td className="px-1 py-2.5 text-center text-[#5F4E75]">{item.reorder}</td>
                                            <td className="px-1 py-2.5 text-center">
                                                <span className={`inline-flex max-w-full items-center justify-center break-words rounded-full px-2 py-1 text-center text-[10px] font-semibold leading-4 ${stockBadge(item.status)}`}>
                                                    {reportsByKey.has(item.key) ? "Reported" : item.status === "Out of Stock" ? "Report Shortage" : "Check / Report"}
                                                </span>
                                            </td>
                                            <td className="px-1.5 py-2.5 text-center">
                                                <button type="button" onClick={()=>openProductReview(item)} className="inline-flex w-full max-w-[110px] items-center justify-center rounded-lg border border-[#D9CDF0] bg-[#F5F0FF] px-2 py-1.5 text-[10px] font-semibold text-[#5330B6] hover:bg-[#ECE3FF]">Review</button>
                                            </td>
                                        </tr>)}</tbody>
                                    </table>
                                    {tasks.length===0 && <p className="px-5 py-8 text-center text-sm text-[#8A7D90]">No stock tasks match this filter.</p>}
                                    {tasks.length>30 && <p className="border-t border-[#F0EAF4] px-4 py-2 text-xs text-[#806A8C]">Showing first 30 of {tasks.length} stock alerts. Use the branch inventory list to find more.</p>}
                                </div>
                            </section>
                            <section className={`${card} flex h-[470px] min-h-0 min-w-0 flex-col`}>
                                <SectionHead icon={<Clock3 size={18}/>} title="Recent Stock Activity" subtitle="Today's branch stock movements (Philippine time).">
                                    <button type="button" onClick={()=>{setActivityPage(1);setShowActivityHistory(true);}}
                                            disabled={activityLoading || !!activityError}
                                            className={`${outline} h-9 px-3 text-xs disabled:opacity-40`}>View All Activity</button>
                                </SectionHead>
                                {activityError && <div role="alert" className="flex items-center justify-between gap-2 px-4 pt-3 text-xs text-[#A56607]">
                                    <span>Unable to load recent activity: {activityError}</span>
                                    <button type="button" className="underline" onClick={()=>setActivityKey(key=>key+1)}>Retry</button>
                                </div>}
                                {activityLoading ? <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading recent stock activity">{[1,2,3,4].map(x=><div key={x} className="h-8 animate-pulse rounded-lg bg-[#F2EDF8]"/>)}</div> :
                                    <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
                                        <table className="w-full table-fixed text-[10px] xl:text-[11px]">
                                            <colgroup><col className="w-[22%]"/><col className="w-[29%]"/><col className="w-[23%]"/><col className="w-[10%]"/><col className="w-[16%]"/></colgroup>
                                            <thead className="sticky top-0 z-10 bg-[#FFFCF8]"><tr className="border-b border-[#E9E1EE]">
                                                <th className="break-words px-2 py-2.5 text-left text-[9px] font-semibold uppercase text-[#806A8C]">Date &amp; Time</th>
                                                <th className="break-words px-2 py-2.5 text-left text-[9px] font-semibold uppercase text-[#806A8C]">Product</th>
                                                <th className="break-words px-1 py-2.5 text-center text-[9px] font-semibold uppercase text-[#806A8C]">Movement</th>
                                                <th className="px-1 py-2.5 text-center text-[9px] font-semibold uppercase text-[#806A8C]">Qty</th>
                                                <th className="break-words px-1 py-2.5 text-center text-[9px] font-semibold uppercase text-[#806A8C]">Reference No.</th>
                                            </tr></thead>
                                            <tbody>{todayActivities.map(item=><tr key={item.id} className="border-b border-[#EFE8F2] text-[#2B174C] last:border-b-0">
                                                <td className="break-words px-2 py-2.5 text-[#5F4E75]">{safeDate(item.at)}</td>
                                                <td className="break-words px-2 py-2.5"><span className="block font-semibold" title={item.item}>{item.item}</span>
                                                    <span className="mt-0.5 block break-words text-[10px] text-[#8A7D90]" title={item.actorName}>By {item.actorName}</span></td>
                                                <td className="px-1 py-2.5 text-center"><span className={`inline-flex max-w-full items-center justify-center break-words rounded-full px-2 py-1 text-center text-[10px] font-semibold leading-4 ${activityBadge(item.kind)}`}>{item.kind}</span></td>
                                                <td className={`px-1 py-2.5 text-center font-semibold ${item.quantity != null && item.quantity > 0 ? "text-[#23834A]" : item.quantity != null && item.quantity < 0 ? "text-[#D92C3F]" : "text-[#5A476A]"}`}>{quantityLabel(item.quantity)}</td>
                                                <td className="break-all px-1 py-2.5 text-center text-[#5F4E75]" title={item.reference}>{item.reference}</td>
                                            </tr>)}</tbody>
                                        </table>
                                        {!activityError && todayActivities.length===0 && <p className="px-5 py-8 text-center text-sm text-[#8A7D90]">No stock movements recorded today.</p>}
                                    </div>}
                            </section>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="relative min-w-[200px] flex-1"><span className="sr-only">Search sales inventory</span>
                                <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product no., name, category or variant..." className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-white pl-10 pr-4 text-sm text-[#2B174C] shadow-sm outline-none focus:border-[#2B174C]"/></label>
                            <button type="button" className={outline} onClick={()=>{setStatus("Low Stock");document.getElementById("staff-sales-list")?.scrollIntoView({behavior:"smooth"});}}><Eye size={16}/> View Low Stock</button>
                            {canReceive && <button type="button" className={primary} onClick={()=>{setActionError("");setShowReceivingInfo(true);}}><PackagePlus size={16}/> Record Stock In{receivingTasks.length ? ` (${receivingTasks.length})` : ""}</button>}
                        </div>
                        <section id="staff-sales-list" className={card}>
                            <SectionHead icon={<Package size={18}/>} title="Branch Sales Inventory List" subtitle={`Products available for daily stock operations · ${branch}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <select aria-label="Filter categories" className="h-9 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All Categories</option>
                                        {categories.map(cat=><option key={cat} value={cat}>{cat}</option>)}
                                    </select>
                                    <select aria-label="Filter stock statuses" className="h-9 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All Status</option><option value="In Stock">In Stock</option><option value="Low Stock">Low Stock</option><option value="Out of Stock">Out of Stock</option></select>
                                </div>
                            </SectionHead>
                            <div className="max-h-[360px] w-full overflow-auto overscroll-contain" role="region" aria-label="Branch sales inventory list" tabIndex={0}>
                                <table className="w-full min-w-[970px] table-fixed text-[10px] xl:text-[11px]">
                                    <colgroup><col className="w-[12%]"/><col className="w-[23%]"/><col className="w-[15%]"/><col className="w-[11%]"/><col className="w-[11%]"/><col className="w-[12%]"/><col className="w-[10%]"/><col className="w-[6%]"/></colgroup>
                                    <thead className="sticky top-0 z-10 bg-[#FFFCF8]"><tr className="border-b border-[#E9E1EE]">
                                        {['Product No.','Product','Category','Available Stock','Reorder Point','Expiration','Status','Action'].map((label,index)=><th key={label} className={`break-words px-2 py-2.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C] ${index===1||index===2?'text-left':'text-center'}`}>{label}</th>)}
                                    </tr></thead>
                                    <tbody>{visible.map(item=><tr key={item.key} className="h-14 border-b border-[#EFE8F2] text-[#2B174C] last:border-b-0 hover:bg-[#FFFCF8]">
                                        <td className="break-all px-2 py-2.5 text-center font-mono text-[9px] font-semibold text-[#5F4E75] xl:text-[10px]">{item.reference}</td>
                                        <td className="break-words px-3 py-2.5 font-semibold">{item.name}</td>
                                        <td className="break-words px-2 py-2.5 text-[#5F4E75]">{item.category}</td>
                                        <td className="px-2 py-2.5 text-center font-semibold">{item.stock}</td>
                                        <td className="px-2 py-2.5 text-center text-[#5F4E75]">{item.reorder}</td>
                                        <td className="break-words px-2 py-2.5 text-center text-[#5F4E75]">{inventoryExpirationLabel(item.expirationDate)}</td>
                                        <td className="px-1 py-2.5 text-center"><span className={`inline-flex max-w-full items-center justify-center rounded-full px-2 py-1 text-center text-[10px] font-semibold leading-4 ${stockBadge(item.status)}`}>{item.status}</span>
                                            {staffExpirationRisk(item.expirationDate) && <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${staffExpirationRisk(item.expirationDate)==="Expired"?"bg-[#FFE7EA] text-[#BF2438]":"bg-[#FFF3D8] text-[#A56607]"}`}>{staffExpirationRisk(item.expirationDate)}</span>}</td>
                                        <td className="px-1 py-2.5 text-center"><button type="button" className="inline-flex max-w-full items-center justify-center rounded-lg border border-[#D9CDF0] bg-[#F5F0FF] px-2 py-1.5 text-[10px] font-semibold text-[#5330B6] hover:bg-[#ECE3FF]" onClick={()=>openProductReview(item)}>View</button></td>
                                    </tr>)}</tbody>
                                </table>
                                {visible.length===0 && <p className="py-10 text-center text-sm text-[#806A8C]">No products match your search or filters.</p>}
                            </div>
                        </section>
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
                <div className="min-h-[200px] flex-1 overflow-auto">
                    {activityHistoryLoading ? <div aria-busy="true" className="space-y-3 p-5">{[1,2,3,4,5].map(x=><div key={x} className="h-10 animate-pulse rounded-lg bg-[#F2EDF8]"/>)}</div> :
                        activityHistoryError ? <div role="alert" className="p-5 text-sm text-red-700">{activityHistoryError}
                                <button type="button" className="ml-3 underline" onClick={()=>setHistoryRetry(x=>x+1)}>Retry</button></div> :
                            <table className="w-full min-w-[720px] text-left text-xs"><thead className="sticky top-0 bg-[#FFFDF8]"><tr>
                                {['Date & Time','Product / Variant','Activity','Qty','Reference','Recorded By'].map(label=><th key={label} className={headClass}>{label}</th>)}</tr></thead>
                                <tbody>{activityHistory.map(item=><tr key={item.id} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                    <td className="whitespace-nowrap px-3 py-3">{safeDate(item.at)}</td>
                                    <td className="max-w-[240px] px-3 py-3 font-medium" title={item.item}>{item.item}</td>
                                    <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-lg px-2 py-1 ${activityBadge(item.kind)}`}>{item.kind}</span></td>
                                    <td className="px-3 py-3 font-semibold">{quantityLabel(item.quantity)}</td>
                                    <td className="max-w-[190px] break-all px-3 py-3">{item.reference}</td>
                                    <td className="px-3 py-3">{item.actorName}</td>
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
        {actionNotice && <p role="status" className="fixed bottom-5 right-5 z-[110] max-w-sm rounded-xl border border-green-200 bg-white p-4 text-sm text-green-800 shadow-lg"><CheckCircle2 size={16} className="mr-2 inline"/>{actionNotice}<button className="ml-2 underline" onClick={()=>setActionNotice("")}>Dismiss</button></p>}
        {(details || showReceivingInfo) && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#21132E]/50 p-4" onMouseDown={event=>{if(event.target===event.currentTarget && !saving){setDetails(null);setShowReceivingInfo(false);setActionError("");}}}>
            <section role="dialog" aria-modal="true" aria-label={details ? "Stock review" : "Authorized stock receiving"} className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-4"><h3 className="text-lg font-bold text-[#21132E]">{details ? "Stock Review" : "Record Stock In"}</h3>
                    <button aria-label="Close" type="button" disabled={saving} onClick={()=>{setDetails(null);setShowReceivingInfo(false);setActionError("");setActiveReceipt(null);}} className="rounded-lg p-1 text-[#6A5D6F] hover:bg-[#F7F1FF]"><X size={20}/></button></div>
                {actionError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
                {details ? <div className="mt-4 space-y-3 text-sm"><p className="font-semibold">{details.name}</p><p className="text-[#806A8C]">{details.reference} · {details.category}</p>
                    <div className="grid grid-cols-2 gap-2"><p>Available: <strong>{details.stock}</strong></p><p>Reorder point: <strong>{details.reorder}</strong></p></div>
                    <p>Status: <span className={`rounded-lg px-2 py-1 ${stockBadge(details.status)}`}>{details.status}</span>
                        {staffExpirationRisk(details.expirationDate) && <span className={`ml-2 rounded-lg px-2 py-1 ${staffExpirationRisk(details.expirationDate)==="Expired" ? "bg-[#FFE7EA] text-[#BF2438]":"bg-[#FFF3D8] text-[#A56607]"}`}>{staffExpirationRisk(details.expirationDate)}</span>}</p>
                    {details.status!=="In Stock" ? <>
                        {reportsByKey.has(details.key) ? <p className="rounded-xl bg-[#F7F3FC] p-3 text-xs text-[#6A5D6F]">A shortage report for this item is already open with the Manager.</p> : <>
                            <p className="rounded-xl bg-[#F7F3FC] p-3 text-xs leading-5 text-[#6A5D6F]">Verify the shelf or storage area and submit a shortage report. Staff cannot directly change inventory quantities or supplier payments.</p>
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
                    <p className="text-[#5F4E75]">Confirm only deliveries physically received and already authorized by the Manager. Stock, POS batches and audit movements are updated together. Supplier pricing and payments cannot be changed here.</p>
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