"use client";

/**
 * Owner Dashboard — strategic, store-wide view.
 *
 * Redesign notes (per adviser feedback):
 * - This dashboard is now DIFFERENT from Manager/Staff. It intentionally drops
 *   the operational widgets (upcoming bookings table, inventory/expiration
 *   alerts) that used to be duplicated across all three role dashboards.
 *   Those belong on the Manager dashboard (day-to-day reports: inventory,
 *   bookings, restock, staff activity) and the Staff dashboard (today's
 *   queue). The Owner only sees sales, profit, and trend-level insight.
 * - 4 KPI cards: Total Sales, POS Gross Profit, POS Profit Margin, and
 *   Forecasted Sales (next month).
 * - The lower summary area intentionally focuses on Top Products / Packages
 *   and Sales Forecast. Revenue by Channel was removed to keep the layout
 *   compact, focused, and visually balanced.
 * - POS profit is read from the POS backend, which calculates totalCost and
 *   profit from order_items joined to products/product_variants. No artificial
 *   40% fallback is used anymore. Booking revenue remains separate because the
 *   lightweight bookings endpoint does not expose booking cost/profit yet.
 * - IMPORTANT: "POS Gross Profit" / "POS Profit Margin" keep their "POS"
 *   qualifier on purpose. Bookings are 70%+ of revenue but have no recorded
 *   cost, so a store-wide "Gross Profit" figure would be fabricated. Do not
 *   rename these to drop "POS" unless a real booking-cost field is added
 *   upstream (see aggregateBranchPerformance/buildOwnerAnalytics — booking
 *   profit is intentionally never computed there).
 * - The "Forecasted Sales" KPI badge and the "Sales Forecast" panel below
 *   both read from the SAME predictedNextMonthSales/forecastGrowthPct values,
 *   so they can never drift out of sync with each other.
 * - "Sales Forecast" is a lightweight linear-trend projection over the
 *   last completed months of real sales data (not a hosted ML model). It's honest
 *   about being a trend projection in the UI copy ("Trend-based projection")
 *   and keeps the Forecast Basis / Method disclosure — that transparency is
 *   what the adviser's "should have science" requirement is asking for.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    BarChart3,
    Building2,
    Info,
    Lightbulb,
    Percent,
    RefreshCw,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Trophy,
    Wallet,
} from "lucide-react";

/* ----------------------------------------------------------------------- */
/* Types                                                                    */
/* ----------------------------------------------------------------------- */

type Branch = {
    id: number;
    branchName: string;
};

type Booking = {
    id: number;
    branchId?: number | null;
    date?: string;
    status?: string;
    packageName?: string;
    bookingType?: string;
    booking_type?: string;
    customOrder?: string;
    custom_order?: string;
    agreed_price?: number | string | null;
    agreedPrice?: number | string | null;
    package_price?: number | string | null;
    packagePrice?: number | string | null;
    total?: number;
};

type OrderItem = {
    name?: string;
    quantity?: number;
    price?: number;
    unitPrice?: number;
    unit_price?: number;
    lineTotal?: number;
    line_total?: number;
    sellingPrice?: number;
    selling_price?: number;
    salesPrice?: number;
    sales_price?: number;
    costPrice?: number;
    cost_price?: number;
    originalPrice?: number;
    original_price?: number;
};

type Order = {
    branchId?: number | null;
    total?: number;
    totalCost?: number | null;
    profit?: number | null;
    date?: string;
    createdAt?: string;
    items?: OrderItem[];
    status?: string;
    orderType?: string;
};

type PeriodOption = "month" | "quarter" | "year";
type TrendRange = 6 | 12;

/* ----------------------------------------------------------------------- */
/* Generic parsing helpers (kept consistent with the rest of the app)      */
/* ----------------------------------------------------------------------- */

function getSavedItem(key: string) {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
}

function getUserValue(user: unknown, key: string) {
    if (!user || typeof user !== "object") return "";
    return String((user as Record<string, unknown>)[key] ?? "");
}

function peso(value: number) {
    return `₱${Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

function pesoCompact(value: number) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
        return `₱${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    }
    if (abs >= 1_000) {
        return `₱${(value / 1_000).toFixed(0)}K`;
    }
    return `₱${Math.round(value)}`;
}

function formatCurrentDashboardDateTime(value: Date) {
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

type ApiRecord = Record<string, unknown>;

function toRecord(value: unknown): ApiRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as ApiRecord)
        : {};
}

function firstDefined(record: ApiRecord, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (value !== null && value !== undefined) return value;
    }
    return undefined;
}

function readText(record: ApiRecord, keys: string[], fallback = "") {
    const value = firstDefined(record, keys);
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return fallback;
}

function readNumber(record: ApiRecord, keys: string[], fallback = 0) {
    const value = firstDefined(record, keys);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function readNullableNumber(record: ApiRecord, keys: string[]) {
    const value = firstDefined(record, keys);
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/* ----------------------------------------------------------------------- */
/* Normalizers (trimmed to sales/profit-relevant fields only)              */
/* ----------------------------------------------------------------------- */

function normalizeBranch(value: unknown): Branch {
    const raw = toRecord(value);
    return {
        id: readNumber(raw, ["id", "branch_id", "branchId"]),
        branchName: readText(
            raw,
            ["branchName", "branch_name", "name", "branch"],
            "Unnamed Branch",
        ),
    };
}

function normalizeDashboardBookingStatus(value?: string | null) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw || raw === "pending") return "Pending";
    if (
        raw === "awaiting down payment" ||
        raw === "waiting down payment" ||
        raw === "awaiting payment" ||
        raw === "down payment required"
    ) {
        return "Awaiting Down Payment";
    }
    if (raw === "confirmed") return "Confirmed";
    if (raw === "preparing") return "Preparing";
    if (raw === "completed") return "Completed";
    if (raw === "cancelled" || raw === "canceled") return "Cancelled";
    return value || "Pending";
}

function normalizeBooking(value: unknown): Booking {
    const raw = toRecord(value);
    return {
        id: readNumber(raw, ["id", "booking_id"]),
        branchId: readNullableNumber(raw, ["branchId", "branch_id"]),
        date: readText(raw, [
            "date",
            "event_date",
            "eventDate",
            "booking_date",
            "bookingDate",
            "scheduled_at",
            "scheduledAt",
            "start_at",
            "startAt",
            "created_at",
            "createdAt",
        ]),
        status: normalizeDashboardBookingStatus(readText(raw, ["status"])),
        packageName: readText(raw, [
            "packageName",
            "package_name",
            "package",
            "package_title",
            "service_name",
        ]),
        bookingType: readText(raw, ["bookingType", "booking_type"]),
        booking_type: readText(raw, ["booking_type", "bookingType"]),
        customOrder: readText(raw, ["customOrder", "custom_order"]),
        custom_order: readText(raw, ["custom_order", "customOrder"]),
        agreed_price: firstDefined(raw, ["agreed_price", "agreedPrice"]) as
            | number
            | string
            | null
            | undefined,
        agreedPrice: firstDefined(raw, ["agreedPrice", "agreed_price"]) as
            | number
            | string
            | null
            | undefined,
        package_price: firstDefined(raw, ["package_price", "packagePrice"]) as
            | number
            | string
            | null
            | undefined,
        packagePrice: firstDefined(raw, ["packagePrice", "package_price"]) as
            | number
            | string
            | null
            | undefined,
        total: readNumber(raw, [
            "total",
            "total_amount",
            "booking_total",
            "amount",
            "grand_total",
        ]),
    };
}

function isCustomDashboardBooking(booking: Booking) {
    const type = String(booking.bookingType || booking.booking_type || "")
        .trim()
        .toLowerCase();
    const packageLabel = String(booking.packageName || "").trim().toLowerCase();
    const customText = String(booking.customOrder || booking.custom_order || "").trim();
    return type.includes("custom") || packageLabel.includes("custom") || Boolean(customText);
}

function getDashboardBookingTotalPrice(booking: Booking) {
    const rawValue = isCustomDashboardBooking(booking)
        ? booking.agreed_price ?? booking.agreedPrice
        : booking.package_price ??
        booking.packagePrice ??
        booking.agreed_price ??
        booking.agreedPrice ??
        booking.total;

    const value = Number(rawValue || 0);
    return Number.isFinite(value) ? value : 0;
}

function normalizeOrderItem(value: unknown): OrderItem {
    const raw = toRecord(value);
    return {
        name: readText(raw, ["name", "productName", "product_name"]),
        quantity: readNumber(raw, ["quantity", "qty"]),
        price: readNumber(raw, ["price", "unitPrice", "unit_price"]),
        unitPrice: readNumber(raw, ["unitPrice", "unit_price", "price"]),
        unit_price: readNumber(raw, ["unit_price", "unitPrice", "price"]),
        lineTotal: readNumber(raw, ["lineTotal", "line_total"]),
        line_total: readNumber(raw, ["line_total", "lineTotal"]),
        sellingPrice: readNumber(raw, ["sellingPrice", "selling_price"]),
        selling_price: readNumber(raw, ["selling_price", "sellingPrice"]),
        salesPrice: readNumber(raw, ["salesPrice", "sales_price"]),
        sales_price: readNumber(raw, ["sales_price", "salesPrice"]),
        costPrice: readNumber(raw, ["costPrice", "cost_price"]),
        cost_price: readNumber(raw, ["cost_price", "costPrice"]),
        originalPrice: readNumber(raw, ["originalPrice", "original_price"]),
        original_price: readNumber(raw, ["original_price", "originalPrice"]),
    };
}

function parseOrderItems(itemText?: string): OrderItem[] {
    if (!itemText) return [];
    return itemText
        .split(",")
        .map((item) => {
            const [name, qty] = item.split(" x");
            return { name: name?.trim() || "", quantity: Number(qty || 0) };
        })
        .filter((item) => item.name);
}

function normalizeOrder(value: unknown): Order {
    const raw = toRecord(value);
    const itemText = readText(raw, ["item"]);
    const rawItems = firstDefined(raw, ["items", "orderItems", "order_items"]);
    const items = Array.isArray(rawItems)
        ? rawItems.map(normalizeOrderItem).filter((item) => item.name)
        : parseOrderItems(itemText);

    return {
        branchId: readNullableNumber(raw, ["branchId", "branch_id"]),
        total: readNumber(raw, ["total"]),
        totalCost: readNullableNumber(raw, ["totalCost", "total_cost"]),
        profit: readNullableNumber(raw, ["profit"]),
        date: readText(raw, [
            "date",
            "orderDate",
            "order_date",
            "createdAt",
            "created_at",
        ]),
        createdAt: readText(raw, ["createdAt", "created_at"]),
        items,
        status: readText(raw, ["status", "order_status"]),
        orderType: readText(raw, ["orderType", "order_type", "type", "source"]),
    };
}


/* ----------------------------------------------------------------------- */
/* Date / period helpers                                                   */
/* ----------------------------------------------------------------------- */

function parseFlexibleDate(value?: string | null): Date | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getOrderDate(order: Order) {
    return parseFlexibleDate(order.date) || parseFlexibleDate(order.createdAt);
}

function monthKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelWithYear(date: Date) {
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function getLastNMonthBuckets(reference: Date, n: number) {
    const buckets: { key: string; date: Date; label: string }[] = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(reference.getFullYear(), reference.getMonth() - i, 1);
        buckets.push({ key: monthKey(d), date: d, label: monthLabelWithYear(d) });
    }
    return buckets;
}

function getPeriodStart(period: PeriodOption, reference: Date) {
    if (period === "month") {
        return new Date(reference.getFullYear(), reference.getMonth(), 1);
    }
    if (period === "quarter") {
        const quarterStartMonth = Math.floor(reference.getMonth() / 3) * 3;
        return new Date(reference.getFullYear(), quarterStartMonth, 1);
    }
    return new Date(reference.getFullYear(), 0, 1);
}

function formatPeriodLabel(period: PeriodOption, reference: Date) {
    if (period === "month") {
        return reference.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    if (period === "quarter") {
        const quarter = Math.floor(reference.getMonth() / 3) + 1;
        return `Q${quarter} ${reference.getFullYear()}`;
    }
    return String(reference.getFullYear());
}

/* ----------------------------------------------------------------------- */
/* Core business logic                                                     */
/* ----------------------------------------------------------------------- */

const SCHEDULED_ORDER_TYPES = [
    "scheduled",
    "schedule",
    "scheduled-order",
    "future",
    "future-order",
    "advance-order",
    "pre-order",
    "preorder",
];

const EXCLUDED_ORDER_STATUSES = [
    "pending",
    "pending payment",
    "unpaid",
    "cancelled",
    "canceled",
    "refunded",
    "void",
    "draft",
    "failed",
];

function isPosSaleOrder(order: Order) {
    const type = String(order.orderType || "").trim().toLowerCase().replace(/_/g, "-");
    const status = String(order.status || "").trim().toLowerCase();
    return !SCHEDULED_ORDER_TYPES.includes(type) && !EXCLUDED_ORDER_STATUSES.includes(status);
}

function isRealizedBooking(booking: Booking) {
    const status = normalizeDashboardBookingStatus(booking.status);
    return status === "Confirmed" || status === "Completed";
}

type MonthlyPoint = {
    key: string;
    label: string;
    posSales: number;
    bookingSales: number;
    sales: number;
    profit: number;
};

/**
 * Owner analytics use only authoritative values returned by the APIs.
 *
 * - Total Sales = POS Sales + realized Booking Sales.
 * - Profit = POS backend profit (orders.total - SQL-computed totalCost).
 * - Booking profit is intentionally NOT estimated. The current lightweight
 *   booking endpoint exposes booking revenue but not booking cost/profit.
 *
 * This removes the old hard-coded 40% margin fallback and prevents fabricated
 * gross-profit values from appearing on the Owner dashboard.
 */
function buildOwnerAnalytics(
    orders: Order[],
    bookings: Booking[],
    monthsBack: number,
    reference: Date,
) {
    const buckets = getLastNMonthBuckets(reference, monthsBack).map((bucket) => ({
        ...bucket,
        posSales: 0,
        posProfit: 0,
        bookingSales: 0,
    }));
    const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

    orders.filter(isPosSaleOrder).forEach((order) => {
        const date = getOrderDate(order);
        if (!date) return;
        const bucket = bucketByKey.get(monthKey(date));
        if (!bucket) return;

        const revenue = Number(order.total || 0);
        const backendProfit = order.profit;
        const backendCost = order.totalCost;

        bucket.posSales += Number.isFinite(revenue) ? revenue : 0;

        if (backendProfit !== null && backendProfit !== undefined && Number.isFinite(backendProfit)) {
            bucket.posProfit += backendProfit;
        } else if (backendCost !== null && backendCost !== undefined && Number.isFinite(backendCost)) {
            bucket.posProfit += revenue - backendCost;
        }
    });

    bookings.filter(isRealizedBooking).forEach((booking) => {
        const date = parseFlexibleDate(booking.date);
        if (!date) return;
        const bucket = bucketByKey.get(monthKey(date));
        if (!bucket) return;
        bucket.bookingSales += getDashboardBookingTotalPrice(booking);
    });

    const monthly: MonthlyPoint[] = buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        posSales: bucket.posSales,
        bookingSales: bucket.bookingSales,
        sales: bucket.posSales + bucket.bookingSales,
        profit: bucket.posProfit,
    }));

    return { monthly };
}

function aggregateBranchPerformance(
    orders: Order[],
    bookings: Booking[],
    branches: Branch[],
    period: PeriodOption,
    reference: Date,
) {
    const start = getPeriodStart(period, reference);
    const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
    const nameById = new Map(branches.map((branch) => [String(branch.id), branch.branchName]));
    const totals = new Map<string, number>();

    orders.filter(isPosSaleOrder).forEach((order) => {
        const date = getOrderDate(order);
        if (!date || date < start || date >= end) return;
        const key = order.branchId !== null && order.branchId !== undefined ? String(order.branchId) : "unassigned";
        totals.set(key, (totals.get(key) || 0) + Number(order.total || 0));
    });

    bookings.filter(isRealizedBooking).forEach((booking) => {
        const date = parseFlexibleDate(booking.date);
        if (!date || date < start || date >= end) return;
        const key = booking.branchId !== null && booking.branchId !== undefined ? String(booking.branchId) : "unassigned";
        totals.set(key, (totals.get(key) || 0) + getDashboardBookingTotalPrice(booking));
    });

    return Array.from(totals.entries())
        .map(([key, amount]) => ({
            key,
            name: key === "unassigned" ? "Unassigned" : nameById.get(key) || `Branch #${key}`,
            amount,
        }))
        .sort((a, b) => b.amount - a.amount);
}

type TopItemRow = { key: string; name: string; sales: number; units: number };

function aggregateTopItems(
    orders: Order[],
    bookings: Booking[],
    period: PeriodOption,
    reference: Date,
): TopItemRow[] {
    const start = getPeriodStart(period, reference);
    const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
    const map = new Map<string, TopItemRow>();

    orders.filter(isPosSaleOrder).forEach((order) => {
        const date = getOrderDate(order);
        if (!date || date < start || date >= end) return;

        (order.items || []).forEach((item) => {
            const name = (item.name || "").trim();
            if (!name) return;

            const qty = Number(item.quantity || 0);
            const unitPrice = Number(
                item.unitPrice ??
                item.unit_price ??
                item.price ??
                item.sellingPrice ??
                item.selling_price ??
                item.salesPrice ??
                item.sales_price ??
                0,
            );
            const lineTotal = Number(item.lineTotal ?? item.line_total ?? qty * unitPrice);

            const key = `product:${name.toLowerCase()}`;
            const existing = map.get(key) || { key, name, sales: 0, units: 0 };
            existing.sales += Number.isFinite(lineTotal) ? lineTotal : qty * unitPrice;
            existing.units += qty;
            map.set(key, existing);
        });
    });

    bookings.filter(isRealizedBooking).forEach((booking) => {
        const date = parseFlexibleDate(booking.date);
        if (!date || date < start || date >= end) return;

        const name = (booking.packageName || (isCustomDashboardBooking(booking) ? "Custom Order" : "")).trim();
        if (!name) return;

        const key = `package:${name.toLowerCase()}`;
        const existing = map.get(key) || { key, name, sales: 0, units: 0 };
        existing.sales += getDashboardBookingTotalPrice(booking);
        existing.units += 1;
        map.set(key, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
}

function pctDelta(current: number, previous: number): number | null {
    if (!Number.isFinite(previous) || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

function linearForecastNext(values: number[], stepsAhead = 1) {
    const n = values.length;
    if (n === 0) return 0;
    if (n === 1) return values[0];

    const meanX = (n - 1) / 2;
    const meanY = values.reduce((sum, v) => sum + v, 0) / n;

    let numerator = 0;
    let denominator = 0;
    values.forEach((value, index) => {
        numerator += (index - meanX) * (value - meanY);
        denominator += (index - meanX) ** 2;
    });

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = meanY - slope * meanX;
    const targetIndex = n - 1 + Math.max(1, stepsAhead);
    return Math.max(0, slope * targetIndex + intercept);
}

function niceStep(value: number) {
    if (value <= 0) return 1;
    const exponent = Math.floor(Math.log10(value));
    const base = Math.pow(10, exponent);
    const fraction = value / base;
    let niceFraction = 10;
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    return niceFraction * base;
}

/* ----------------------------------------------------------------------- */
/* Main component                                                          */
/* ----------------------------------------------------------------------- */

export default function OwnerDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loadError, setLoadError] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [trendRange, setTrendRange] = useState<TrendRange>(12);
    const [branchPeriod, setBranchPeriod] = useState<PeriodOption>("month");
    const [topPeriod, setTopPeriod] = useState<PeriodOption>("month");


    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentDateTime(new Date());
        }, 30_000);

        return () => window.clearInterval(timer);
    }, []);

    async function loadOwnerDashboard({ silent = false }: { silent?: boolean } = {}) {
        const token = getSavedItem("token");
        const storeId =
            getUserValue(user, "store_id") ||
            getUserValue(user, "storeId") ||
            getSavedItem("store_id") ||
            getSavedItem("stocknbook_store_id");

        if (!token) {
            setLoadError("Unable to load the owner dashboard because no login token was found.");
            return;
        }

        if (!silent) setIsRefreshing(true);
        setLoadError("");

        try {
            /*
             * Load all dashboard sources at the same time, then commit the
             * resulting state together. The previous version loaded bookings,
             * and POS orders one after another and updated React state
             * after each request. That caused a temporary "booking-only" render
             * (POS = ₱0), followed by a second render when POS data arrived.
             * It is why the KPI values and chart changed while Refreshing...
             */
            const ordersDateFrom = new Date(
                currentDateTime.getFullYear(),
                currentDateTime.getMonth() - 12,
                1,
            ).toISOString().slice(0, 10);
            const ordersDateTo = currentDateTime.toISOString().slice(0, 10);

            const [branchesResult, bookingsResult, ordersResult] =
                await Promise.allSettled([
                    fetch("/api/branches", {
                        method: "GET",
                        headers: { Authorization: `Bearer ${token}` },
                        cache: "no-store",
                    }),
                    fetch("/api/bookings", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_booking_page_bookings",
                            role: "owner",
                            store_id: storeId ? Number(storeId) : undefined,
                        }),
                        cache: "no-store",
                    }),
                    fetch("/api/pos", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_orders",
                            include_order_items: true,
                            date_from: ordersDateFrom,
                            date_to: ordersDateTo,
                        }),
                        cache: "no-store",
                    }),
                ]);

            // Start from the currently displayed data. If one endpoint fails,
            // keep its previous value instead of clearing the dashboard and
            // producing another misleading intermediate state.
            let nextBranches = branches;
            let nextBookings = bookings;
            let nextOrders = orders;
            const errors: string[] = [];

            if (branchesResult.status === "fulfilled") {
                try {
                    const response = branchesResult.value;
                    const data = await response.json().catch(() => ({}));
                    if (response.ok && Array.isArray(data.branches)) {
                        nextBranches = (data.branches as unknown[]).map(normalizeBranch);
                    } else if (!response.ok) {
                        errors.push("Unable to load branch data.");
                    }
                } catch {
                    errors.push("Unable to parse branch data.");
                }
            } else {
                console.warn("Owner dashboard branches fetch failed:", branchesResult.reason);
                errors.push("Unable to load branch data.");
            }

            if (bookingsResult.status === "fulfilled") {
                try {
                    const response = bookingsResult.value;
                    const text = await response.text();
                    const data: { bookings?: unknown[]; error?: unknown; message?: unknown } =
                        text ? JSON.parse(text) : {};

                    if (response.ok && Array.isArray(data.bookings)) {
                        nextBookings = data.bookings.map(normalizeBooking);
                    } else if (!response.ok) {
                        errors.push(
                            String(data.error || data.message || "Unable to load booking data."),
                        );
                    }
                } catch (error) {
                    console.error("Owner dashboard bookings parse failed:", error);
                    errors.push("Unable to parse booking data.");
                }
            } else {
                console.error("Owner dashboard bookings fetch failed:", bookingsResult.reason);
                errors.push("Unable to load booking data.");
            }

            if (ordersResult.status === "fulfilled") {
                try {
                    const response = ordersResult.value;
                    const data = await response.json().catch(() => ({}));
                    if (response.ok && Array.isArray(data.orders)) {
                        nextOrders = (data.orders as unknown[]).map(normalizeOrder);
                    } else if (!response.ok) {
                        errors.push("Unable to load POS sales data.");
                    }
                } catch {
                    errors.push("Unable to parse POS sales data.");
                }
            } else {
                console.warn("Owner dashboard orders fetch failed:", ordersResult.reason);
                errors.push("Unable to load POS sales data.");
            }

            // React 18 batches these updates, so the UI changes from the old
            // complete snapshot to the new complete snapshot in one render.
            setBranches(nextBranches);
            setBookings(nextBookings);
            setOrders(nextOrders);
            setLoadError(errors.join(" "));
        } finally {
            if (!silent) setIsRefreshing(false);
        }
    }

    useEffect(() => {
        // Initial load. The Refresh button still works exactly as before.
        void loadOwnerDashboard();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        /*
         * Near-real-time dashboard refresh:
         * re-check the same authoritative APIs every 60 seconds while this page
         * remains open. This keeps KPI values, their data-aware tooltips, charts,
         * and the forecast current without adding WebSockets or changing the
         * existing backend/API contract.
         */
        const autoRefreshTimer = window.setInterval(() => {
            void loadOwnerDashboard({ silent: true });
        }, 60_000);

        return () => window.clearInterval(autoRefreshTimer);
        // Keep the timer closure aligned with the latest successfully displayed
        // snapshot so a partial API failure can still preserve existing data.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branches, bookings, orders, user]);

    const referenceDateKey = currentDateTime.toDateString();

    const analytics = useMemo(
        () => buildOwnerAnalytics(orders, bookings, 13, currentDateTime),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [orders, bookings, referenceDateKey],
    );

    const branchRows = useMemo(
        () => aggregateBranchPerformance(orders, bookings, branches, branchPeriod, currentDateTime),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [orders, bookings, branches, branchPeriod, referenceDateKey],
    );

    const topItems = useMemo(
        () => aggregateTopItems(orders, bookings, topPeriod, currentDateTime),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [orders, bookings, topPeriod, referenceDateKey],
    );

    const monthly = analytics.monthly;
    const current = monthly[monthly.length - 1] || { sales: 0, profit: 0, posSales: 0, bookingSales: 0 };
    const previous = monthly[monthly.length - 2] || { sales: 0, profit: 0, posSales: 0, bookingSales: 0 };

    const marginNow = current.posSales > 0 ? (current.profit / current.posSales) * 100 : 0;
    const marginPrev = previous.posSales > 0 ? (previous.profit / previous.posSales) * 100 : 0;

    const deltaSales = pctDelta(current.sales, previous.sales);
    const deltaProfit = pctDelta(current.profit, previous.profit);
    const deltaMarginPP = monthly.length > 1 ? marginNow - marginPrev : null;
    const trendChartData = monthly.slice(-trendRange).map((point) => ({
        label: point.label,
        sales: point.sales,
        profit: point.profit,
    }));

    /*
     * Forecast stability:
     * Use only COMPLETED months so an in-progress month (for example, September 9)
     * does not look artificially weak simply because the month is not finished yet.
     * The 6-month history window is rolling, so when the calendar month changes,
     * the forecast basis and displayed month range move forward automatically.
     *
     * Because the newest completed month is one month behind the current month,
     * forecasting the NEXT calendar month is two monthly steps ahead of that
     * completed-history endpoint.
     */
    const completedMonthly = monthly.slice(0, -1);
    const recentCompletedMonthsForForecast = completedMonthly.slice(-6);
    const recentSalesForForecast = recentCompletedMonthsForForecast.map((point) => point.sales);

    const forecastHistoryStartLabel =
        recentCompletedMonthsForForecast[0]?.label || "";
    const forecastHistoryEndLabel =
        recentCompletedMonthsForForecast[recentCompletedMonthsForForecast.length - 1]?.label || "";
    const forecastHistoryRangeLabel =
        forecastHistoryStartLabel && forecastHistoryEndLabel
            ? `${forecastHistoryStartLabel} – ${forecastHistoryEndLabel}`
            : "Completed-month history";

    const predictedNextMonthSales = linearForecastNext(recentSalesForForecast, 2);

    const forecastBaseline =
        recentCompletedMonthsForForecast[recentCompletedMonthsForForecast.length - 1] ||
        previous;
    const forecastGrowthPct = pctDelta(predictedNextMonthSales, forecastBaseline.sales);

    const nextMonthDate = new Date(currentDateTime.getFullYear(), currentDateTime.getMonth() + 1, 1);
    const nextMonthFullLabel = nextMonthDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
    const forecastBaselineDate = new Date(
        currentDateTime.getFullYear(),
        currentDateTime.getMonth() - 1,
        1,
    );
    const forecastBaselineLabel = forecastBaselineDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    const currentMonthLabel = currentDateTime.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    const forecastInsight =
        forecastGrowthPct === null
            ? `Forecast basis: ${forecastHistoryRangeLabel}. Partial ${currentMonthLabel} is excluded because it is still in progress.`
            : `Using completed months ${forecastHistoryRangeLabel} and excluding partial ${currentMonthLabel}, ${nextMonthFullLabel} sales are projected at ${peso(
                Math.round(predictedNextMonthSales),
            )}, ${Math.abs(forecastGrowthPct).toFixed(1)}% ${
                forecastGrowthPct >= 0 ? "higher" : "lower"
            } than ${forecastBaselineLabel}.`;

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">
                            Owner Dashboard
                        </h1>
                        <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                            Strategic business overview across all branches for {currentMonthLabel}.
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {formatCurrentDashboardDateTime(currentDateTime)}
                        </span>

                        <button
                            type="button"
                            onClick={() => void loadOwnerDashboard()}
                            disabled={isRefreshing}
                            aria-label="Refresh dashboard details"
                            title="Refresh dashboard details"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                            {isRefreshing ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-6 py-5 font-sans">
                <div className="mx-auto max-w-none space-y-4">
                    {loadError && (
                        <div className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs font-medium text-[#C32F2F]">
                            {loadError}
                        </div>
                    )}

                    {/* Owner KPI cards — same visual system as the existing dashboard reference */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <KpiCard
                            title="Total Sales"
                            value={peso(current.sales)}
                            delta={deltaSales}
                            info={`Current ${currentMonthLabel} total: ${peso(current.sales)} = ${peso(current.posSales)} POS sales + ${peso(current.bookingSales)} confirmed/completed booking revenue. ${
                                deltaSales === null
                                    ? "No prior-month comparison is available yet."
                                    : `${Math.abs(deltaSales).toFixed(1)}% ${deltaSales >= 0 ? "higher" : "lower"} than last month.`
                            } Auto-updates every 60 seconds while this dashboard is open.`}
                            icon={<BarChart3 size={25} />}
                            iconBg="bg-[#F1EBFF]"
                            iconColor="text-[#6D35D4]"
                        />
                        <KpiCard
                            title="POS Gross Profit"
                            value={peso(current.profit)}
                            delta={deltaProfit}
                            info={`Current ${currentMonthLabel} POS Gross Profit: ${peso(current.profit)} from ${peso(current.posSales)} in POS sales. It uses recorded POS product costs only. Booking profit is excluded because booking cost data is not currently recorded. ${
                                deltaProfit === null
                                    ? "No prior-month comparison is available yet."
                                    : `${Math.abs(deltaProfit).toFixed(1)}% ${deltaProfit >= 0 ? "higher" : "lower"} than last month.`
                            }`}
                            icon={<Wallet size={25} />}
                            iconBg="bg-[#E6F7EE]"
                            iconColor="text-[#159455]"
                        />
                        <KpiCard
                            title="POS Profit Margin"
                            value={`${marginNow.toFixed(1)}%`}
                            delta={deltaMarginPP}
                            deltaSuffix=" pp"
                            info={`Current ${currentMonthLabel} margin: ${marginNow.toFixed(1)}% = ${peso(current.profit)} POS Gross Profit ÷ ${peso(current.posSales)} POS Sales × 100. This measures POS profitability only; bookings are excluded. ${
                                deltaMarginPP === null
                                    ? "No prior-month comparison is available yet."
                                    : `${Math.abs(deltaMarginPP).toFixed(1)} percentage points ${deltaMarginPP >= 0 ? "higher" : "lower"} than last month.`
                            }`}
                            icon={<Percent size={25} />}
                            iconBg="bg-[#FFF0E5]"
                            iconColor="text-[#E66B20]"
                        />
                        <KpiCard
                            title="Forecasted Sales"
                            value={peso(Math.round(predictedNextMonthSales))}
                            delta={forecastGrowthPct}
                            comparisonText="vs last completed month"
                            info={`Projected ${nextMonthFullLabel} sales: ${peso(Math.round(predictedNextMonthSales))}. ${
                                forecastGrowthPct === null
                                    ? "No percentage comparison is available yet."
                                    : `${Math.abs(forecastGrowthPct).toFixed(1)}% ${forecastGrowthPct >= 0 ? "above" : "below"} ${forecastBaselineLabel} sales (${peso(forecastBaseline.sales)}).`
                            } Forecast basis: ${forecastHistoryRangeLabel}. Partial ${currentMonthLabel} is excluded to avoid incomplete-month bias. Linear-trend projection only; data updates every 60 seconds and the month range rolls forward automatically.`}
                            infoAlign="right"
                            icon={<BarChart3 size={25} />}
                            iconBg="bg-[#E6F7EE]"
                            iconColor="text-[#159455]"
                        />
                    </div>

                    {/* Trend chart + branch performance */}
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                        <div className="rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm xl:col-span-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                                        <BarChart3 size={18} />
                                    </span>
                                    <div>
                                        <h3 className="text-[15px] font-bold text-[#1A1220]">Sales &amp; POS Profit Trend</h3>
                                        <p className="text-[11px] text-[#9A8DA8]">
                                            Monthly total sales and POS gross profit across all branches
                                        </p>
                                    </div>
                                </div>

                                <select
                                    value={trendRange}
                                    onChange={(event) => setTrendRange(Number(event.target.value) as TrendRange)}
                                    className="h-8 rounded-lg border border-[#E6DDF0] bg-white px-2.5 text-xs font-semibold text-[#5F4E75] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#D9C6F5]"
                                >
                                    <option value={6}>Last 6 Months</option>
                                    <option value={12}>Last 12 Months</option>
                                </select>
                            </div>

                            <div className="mt-2">
                                <SalesTrendChart data={trendChartData} />
                            </div>

                            <div className="mt-1 flex flex-wrap items-center justify-center gap-6 text-[10px] font-semibold text-[#5F4E75]">
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#6D35D4]" />
                                    Total Sales
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#159455]" />
                                    POS Gross Profit
                                </span>
                            </div>
                        </div>

                        <BranchPerformancePanel
                            rows={branchRows}
                            period={branchPeriod}
                            onPeriodChange={setBranchPeriod}
                            periodLabel={formatPeriodLabel(branchPeriod, currentDateTime)}
                        />
                    </div>

                    {/* Clean summary area — top products + forecast */}
                    <div className="grid grid-cols-[1.45fr_1fr] items-stretch gap-4">
                        <TopProductsPanel
                            rows={topItems}
                            period={topPeriod}
                            onPeriodChange={setTopPeriod}
                            onViewAll={() => router.push("/reports")}
                        />

                        <DemandForecastPanel
                            nextMonthLabel={nextMonthFullLabel}
                            currentMonthLabel={currentMonthLabel}
                            comparisonMonthLabel={forecastBaselineLabel}
                            predicted={predictedNextMonthSales}
                            comparisonSales={forecastBaseline.sales}
                            growthPct={forecastGrowthPct}
                            historyMonths={recentSalesForForecast.length}
                            historyRangeLabel={forecastHistoryRangeLabel}
                            insight={forecastInsight}
                        />
                    </div>
                </div>
            </section>
        </>
    );
}


/* ----------------------------------------------------------------------- */
/* Presentational components                                               */
/* ----------------------------------------------------------------------- */

function KpiCard({
                     title,
                     value,
                     delta,
                     deltaSuffix = "%",
                     comparisonText = "vs last month",
                     info,
                     infoAlign = "center",
                     icon,
                     iconBg,
                     iconColor,
                 }: {
    title: string;
    value: string;
    delta: number | null;
    deltaSuffix?: string;
    comparisonText?: string;
    info?: string;
    infoAlign?: "center" | "right";
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
}) {
    const isUp = delta !== null && delta >= 0;
    const tooltipPositionClass =
        infoAlign === "right"
            ? "right-0"
            : "left-1/2 -translate-x-1/2";
    const tooltipArrowClass =
        infoAlign === "right"
            ? "right-[5px]"
            : "left-1/2 -translate-x-1/2";

    return (
        <div className="flex min-h-[116px] items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 shadow-sm">
            <span
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}
            >
                {icon}
            </span>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <p className="text-[14px] font-semibold leading-5 text-[#4B3E55]">
                        {title}
                    </p>

                    {info && (
                        <span className="group relative inline-flex shrink-0">
                            <button
                                type="button"
                                aria-label={`${title} information`}
                                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#D9CDE7] bg-[#FAF7FF] text-[#6D35D4] transition hover:border-[#BCA7DB] hover:bg-[#F1EBFF] focus:outline-none focus:ring-2 focus:ring-[#D9C6F5]"
                            >
                                <Info size={11} strokeWidth={2.2} />
                            </button>

                            <span
                                role="tooltip"
                                className={`pointer-events-none absolute top-full z-40 mt-2 hidden w-[280px] max-w-[calc(100vw-2rem)] rounded-lg border border-[#E5DAEE] bg-[#2B174C] px-3 py-2 text-[11px] font-medium leading-4 text-white shadow-lg group-hover:block group-focus-within:block ${tooltipPositionClass}`}
                            >
                                {info}
                                <span
                                    className={`absolute bottom-full h-0 w-0 border-x-[5px] border-b-[5px] border-x-transparent border-b-[#2B174C] ${tooltipArrowClass}`}
                                />
                            </span>
                        </span>
                    )}
                </div>

                <p className="mt-2 truncate text-[25px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">
                    {value}
                </p>

                {delta === null ? (
                    <p className="mt-2 text-[12px] font-medium leading-4 text-[#8A7D92]">
                        No prior month to compare
                    </p>
                ) : (
                    <p
                        className={`mt-2 flex items-center gap-1 text-[12px] font-semibold leading-4 ${
                            isUp ? "text-[#159455]" : "text-[#D92D20]"
                        }`}
                    >
                        {isUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {isUp ? "+" : ""}
                        {delta.toFixed(1)}
                        {deltaSuffix} {comparisonText}
                    </p>
                )}
            </div>
        </div>
    );
}

function SalesTrendChart({ data }: { data: { label: string; sales: number; profit: number }[] }) {
    const width = 960;
    const height = 245;
    const margin = { top: 14, right: 16, bottom: 32, left: 58 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    if (data.length === 0) {
        return (
            <div className="flex h-[205px] items-center justify-center text-sm text-[#9A8DA8]">
                No sales history yet. Once orders and bookings come in, this trend will populate automatically.
            </div>
        );
    }

    const maxRaw = Math.max(1, ...data.map((d) => d.sales), ...data.map((d) => d.profit));
    const step = niceStep(maxRaw / 5);
    const axisMax = step * 5;
    const ticks = [0, 1, 2, 3, 4, 5].map((i) => step * i);

    const xFor = (index: number) =>
        margin.left + (data.length > 1 ? (index / (data.length - 1)) * innerW : innerW / 2);
    const yFor = (value: number) => margin.top + innerH - (axisMax > 0 ? (value / axisMax) * innerH : 0);

    const salesPoints = data.map((d, index) => ({ x: xFor(index), y: yFor(d.sales) }));
    const profitPoints = data.map((d, index) => ({ x: xFor(index), y: yFor(d.profit) }));

    const linePath = (points: { x: number; y: number }[]) =>
        points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    const areaPath = (points: { x: number; y: number }[]) => {
        const baseline = margin.top + innerH;
        return `${linePath(points)} L${points[points.length - 1].x.toFixed(1)},${baseline.toFixed(
            1,
        )} L${points[0].x.toFixed(1)},${baseline.toFixed(1)} Z`;
    };

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Total sales and POS gross profit trend chart">
            <defs>
                <linearGradient id="ownerSalesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6D35D4" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#6D35D4" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="ownerProfitFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#159455" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#159455" stopOpacity="0" />
                </linearGradient>
            </defs>

            {ticks.map((tick) => (
                <g key={tick}>
                    <line
                        x1={margin.left}
                        x2={width - margin.right}
                        y1={yFor(tick)}
                        y2={yFor(tick)}
                        stroke="#EEE7F5"
                        strokeWidth={1}
                    />
                    <text x={margin.left - 10} y={yFor(tick) + 4} textAnchor="end" fontSize="10" fill="#9A8DA8">
                        {pesoCompact(tick)}
                    </text>
                </g>
            ))}

            <path d={areaPath(salesPoints)} fill="url(#ownerSalesFill)" stroke="none" />
            <path d={areaPath(profitPoints)} fill="url(#ownerProfitFill)" stroke="none" />
            <path
                d={linePath(salesPoints)}
                fill="none"
                stroke="#6D35D4"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d={linePath(profitPoints)}
                fill="none"
                stroke="#159455"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />

            {salesPoints.map((p, i) => (
                <circle key={`sales-${i}`} cx={p.x} cy={p.y} r={3} fill="#6D35D4" />
            ))}
            {profitPoints.map((p, i) => (
                <circle key={`profit-${i}`} cx={p.x} cy={p.y} r={3} fill="#159455" />
            ))}

            {data.map((point, index) => (
                <text
                    key={point.label + index}
                    x={xFor(index)}
                    y={height - 12}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill="#9A8DA8"
                >
                    {point.label}
                </text>
            ))}
        </svg>
    );
}

function BranchPerformancePanel({
                                    rows,
                                    period,
                                    onPeriodChange,
                                    periodLabel,
                                }: {
    rows: { key: string; name: string; amount: number }[];
    period: PeriodOption;
    onPeriodChange: (period: PeriodOption) => void;
    periodLabel: string;
}) {
    const visible = rows.slice(0, 6);
    const width = 440;
    const height = 260;
    const margin = { top: 30, right: 20, bottom: 78, left: 54 };

    const chartBranchLabel = (name: string) => {
        const compact = String(name || "")
            .trim()
            .replace(/\s+Retail\s+Branch$/i, "")
            .replace(/\s+Retail$/i, "")
            .trim();

        return compact || name;
    };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const maxRaw = Math.max(1, ...visible.map((row) => row.amount));
    const step = niceStep(maxRaw / 4);
    const axisMax = step * 4;
    const ticks = [0, 1, 2, 3, 4].map((index) => step * index);
    const slotWidth = visible.length > 0 ? innerW / visible.length : innerW;
    const barWidth = Math.min(56, Math.max(28, slotWidth * 0.52));
    const yFor = (value: number) =>
        margin.top + innerH - (axisMax > 0 ? (Math.max(0, value) / axisMax) * innerH : 0);

    return (
        <div className="h-full rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF1FF] text-[#2563EB]">
                        <Building2 size={18} />
                    </span>
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-[#1A1220]">Branch Performance</h3>
                        <p className="truncate text-[11px] text-[#9A8DA8]">Total sales per branch for {periodLabel}</p>
                    </div>
                </div>

                <select
                    value={period}
                    onChange={(event) => onPeriodChange(event.target.value as PeriodOption)}
                    className="h-8 shrink-0 rounded-lg border border-[#E6DDF0] bg-white px-2.5 text-xs font-semibold text-[#5F4E75] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#D9C6F5]"
                >
                    <option value="month">This Month</option>
                    <option value="quarter">This Quarter</option>
                    <option value="year">This Year</option>
                </select>
            </div>

            {visible.length === 0 ? (
                <div className="flex min-h-[245px] items-center justify-center text-sm text-[#9A8DA8]">
                    No branch sales recorded for this period yet.
                </div>
            ) : (
                <div className="mt-3">
                    <svg
                        viewBox={`0 0 ${width} ${height}`}
                        className="w-full"
                        role="img"
                        aria-label={`Branch sales bar chart for ${periodLabel}`}
                    >
                        <defs>
                            <linearGradient id="branchBarFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#7C45E8" />
                                <stop offset="100%" stopColor="#5C2BC5" />
                            </linearGradient>
                            <filter id="branchBarShadow" x="-20%" y="-20%" width="140%" height="160%">
                                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#6D35D4" floodOpacity="0.16" />
                            </filter>
                        </defs>

                        {ticks.map((tick) => (
                            <g key={tick}>
                                <line
                                    x1={margin.left}
                                    x2={width - margin.right}
                                    y1={yFor(tick)}
                                    y2={yFor(tick)}
                                    stroke="#EEE7F5"
                                    strokeWidth={1}
                                />
                                <text
                                    x={margin.left - 9}
                                    y={yFor(tick) + 4}
                                    textAnchor="end"
                                    fontSize="9.5"
                                    fill="#9A8DA8"
                                >
                                    {pesoCompact(tick)}
                                </text>
                            </g>
                        ))}

                        {visible.map((row, index) => {
                            const x = margin.left + index * slotWidth + (slotWidth - barWidth) / 2;
                            const y = yFor(row.amount);
                            const barHeight = margin.top + innerH - y;

                            return (
                                <g key={row.key}>
                                    <title>{`${row.name}: ${peso(row.amount)}`}</title>
                                    <rect
                                        x={x}
                                        y={y}
                                        width={barWidth}
                                        height={Math.max(2, barHeight)}
                                        rx={7}
                                        fill="url(#branchBarFill)"
                                        filter="url(#branchBarShadow)"
                                    />
                                    <text
                                        x={x + barWidth / 2}
                                        y={Math.max(14, y - 7)}
                                        textAnchor="middle"
                                        fontSize="9.5"
                                        fontWeight="700"
                                        fill="#1A1220"
                                    >
                                        {pesoCompact(row.amount)}
                                    </text>
                                    <text
                                        x={x + barWidth / 2}
                                        y={height - 48}
                                        textAnchor="middle"
                                        fontSize="10"
                                        fontWeight="700"
                                        fill="#5F4E75"
                                        stroke="#FFFFFF"
                                        strokeWidth="1.6"
                                        paintOrder="stroke"
                                        transform={`rotate(-30 ${x + barWidth / 2} ${height - 48})`}
                                    >
                                        {chartBranchLabel(row.name)}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                </div>
            )}
        </div>
    );
}

function TopProductsPanel({
                              rows,
                              period,
                              onPeriodChange,
                              onViewAll,
                          }: {
    rows: TopItemRow[];
    period: PeriodOption;
    onPeriodChange: (period: PeriodOption) => void;
    onViewAll: () => void;
}) {
    const top = rows.slice(0, 5);
    const hasMore = rows.length > 5;
    const chartColors = ["#6D35D4", "#2563EB", "#159455", "#F59E0B", "#EC4899"];
    const total = top.reduce((sum, row) => sum + Math.max(0, row.sales), 0);

    const radius = 48;
    const center = 60;
    let accumulated = 0;

    const polar = (angle: number) => {
        const radians = ((angle - 90) * Math.PI) / 180;
        return {
            x: center + radius * Math.cos(radians),
            y: center + radius * Math.sin(radians),
        };
    };

    const piePath = (value: number, offset: number) => {
        if (total <= 0 || value <= 0) return "";
        const startAngle = (offset / total) * 360;
        const endAngle = ((offset + value) / total) * 360;
        const startPoint = polar(startAngle);
        const endPoint = polar(endAngle);
        const largeArc = endAngle - startAngle > 180 ? 1 : 0;

        return [
            `M ${center} ${center}`,
            `L ${startPoint.x} ${startPoint.y}`,
            `A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y}`,
            "Z",
        ].join(" ");
    };

    return (
        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]">
                        <Trophy size={17} />
                    </span>
                    <div className="min-w-0">
                        <h3 className="truncate text-[14px] font-bold leading-5 text-[#1A1220]">
                            Top Products / Packages
                        </h3>
                        <p className="truncate text-[10px] leading-4 text-[#9A8DA8]">
                            Best-performing items by sales amount
                        </p>
                    </div>
                </div>

                <select
                    value={period}
                    onChange={(event) => onPeriodChange(event.target.value as PeriodOption)}
                    className="h-8 shrink-0 rounded-lg border border-[#E6DDF0] bg-white px-2.5 text-xs font-semibold text-[#5F4E75] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#D9C6F5]"
                >
                    <option value="month">This Month</option>
                    <option value="quarter">This Quarter</option>
                    <option value="year">This Year</option>
                </select>
            </div>

            {top.length === 0 ? (
                <div className="flex flex-1 min-h-[220px] items-center justify-center text-[11px] font-medium text-[#9A8DA8]">
                    No sales recorded for this period yet.
                </div>
            ) : (
                <div className="mt-4 flex flex-1 items-center gap-6">
                    <div className="relative h-[190px] w-[190px] shrink-0">
                        <svg viewBox="0 0 120 120" className="h-full w-full" role="img" aria-label="Top products by sales">
                            {top.map((row, index) => {
                                const value = Math.max(0, row.sales);
                                const path = piePath(value, accumulated);
                                accumulated += value;

                                return (
                                    <path
                                        key={row.key}
                                        d={path}
                                        fill={chartColors[index]}
                                        stroke="#FFFFFF"
                                        strokeWidth="1.5"
                                    />
                                );
                            })}
                        </svg>

                        <div className="absolute inset-[25%] flex flex-col items-center justify-center rounded-full bg-white text-center">
                            <span className="text-[19px] font-bold leading-none tracking-[-0.04em] text-[#1A1220]">
                                {pesoCompact(total)}
                            </span>
                            <span className="mt-1 text-[9px] font-medium text-[#8A7D92]">
                                Top 5 sales
                            </span>
                        </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                        {top.map((row, index) => {
                            const share = total > 0 ? (Math.max(0, row.sales) / total) * 100 : 0;

                            return (
                                <div key={row.key} className="min-w-0">
                                    <div className="flex items-center gap-2.5">
                                        <span
                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                            style={{ backgroundColor: chartColors[index] }}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span
                                                    className="truncate text-[10px] font-semibold text-[#2A1B33]"
                                                    title={row.name}
                                                >
                                                    {index + 1}. {row.name}
                                                </span>
                                                <span className="shrink-0 text-[10px] font-bold text-[#1A1220]">
                                                    {peso(row.sales)}
                                                </span>
                                            </div>
                                            <div className="mt-1 h-1 rounded-full bg-[#F1ECF6]">
                                                <div
                                                    className="h-full rounded-full"
                                                    style={{
                                                        width: `${Math.max(2, Math.min(100, share))}%`,
                                                        backgroundColor: chartColors[index],
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {(top.length > 0 || hasMore) && (
                <button
                    type="button"
                    onClick={onViewAll}
                    className="mt-3 text-[10px] font-semibold text-[#6D35D4] transition hover:text-[#4E24A8]"
                >
                    View full sales report →
                </button>
            )}
        </div>
    );
}

function DemandForecastPanel({
                                 nextMonthLabel,
                                 currentMonthLabel,
                                 comparisonMonthLabel,
                                 predicted,
                                 comparisonSales,
                                 growthPct,
                                 historyMonths,
                                 historyRangeLabel,
                                 insight,
                             }: {
    nextMonthLabel: string;
    currentMonthLabel: string;
    comparisonMonthLabel: string;
    predicted: number;
    comparisonSales: number;
    growthPct: number | null;
    historyMonths: number;
    historyRangeLabel: string;
    insight: string;
}) {
    const hasComparison = growthPct !== null;
    const isUp = hasComparison && growthPct >= 0;

    const forecastTone = !hasComparison
        ? {
            container: "border border-[#DDE5F2] bg-[#F5F8FC]",
            icon: "bg-white text-[#64748B]",
            amount: "text-[#334155]",
            direction: "text-[#64748B]",
            label: "Trend projection",
        }
        : isUp
            ? {
                container: "border border-[#CFEBDD] bg-[#EAF8F1]",
                icon: "bg-[#D8F2E5] text-[#159455]",
                amount: "text-[#0E7B47]",
                direction: "text-[#159455]",
                label: "Higher sales projected",
            }
            : {
                container: "border border-[#F4D2D2] bg-[#FFF2F2]",
                icon: "bg-[#FDE2E2] text-[#D92D20]",
                amount: "text-[#B42318]",
                direction: "text-[#D92D20]",
                label: "Lower sales projected",
            };

    return (
        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EAF1FF] text-[#2563EB]">
                        <Sparkles size={17} />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-[14px] font-bold leading-5 text-[#1A1220]">Sales Forecast</h3>
                        <p className="text-[10px] leading-4 text-[#9A8DA8]">
                            Next-month sales projection for {nextMonthLabel}
                        </p>
                    </div>
                </div>

                <span className={`shrink-0 rounded-full px-2 py-1 text-[8.5px] font-bold ${forecastTone.direction} bg-white`}>
                    {forecastTone.label}
                </span>
            </div>

            <div className="mt-3 flex flex-1 flex-col justify-center gap-3">
                <div className={`rounded-xl px-3 py-2.5 ${forecastTone.container}`}>
                    <div className="flex items-center gap-2.5">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${forecastTone.icon}`}>
                            <BarChart3 size={16} />
                        </span>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[9px] font-semibold text-[#5F4E75]">
                                    Forecasted Sales ({nextMonthLabel})
                                </p>

                                {growthPct !== null && (
                                    <span className={`inline-flex shrink-0 items-center gap-1 text-[9.5px] font-bold ${forecastTone.direction}`}>
                                        {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                                        {isUp ? "+" : ""}
                                        {growthPct.toFixed(1)}%
                                    </span>
                                )}
                            </div>

                            <p className={`mt-0.5 text-[20px] font-bold leading-none tracking-[-0.03em] ${forecastTone.amount}`}>
                                {peso(Math.round(predicted))}
                            </p>

                            <p className="mt-1 text-[8px] font-medium text-[#7F7289]">
                                Compared with last completed month ({comparisonMonthLabel}): {peso(comparisonSales)}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl bg-[#F4F8FE] px-3.5 py-3">
                    <div className="flex items-start gap-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[#2563EB] shadow-sm">
                            <Lightbulb size={14} />
                        </span>

                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <p className="text-[9px] font-bold text-[#2563EB]">Key Insight</p>
                                <span className="text-[8px] font-medium text-[#7A86A0]">
                                    {historyRangeLabel} • {historyMonths} completed months • Linear trend • Auto-refresh 60s
                                </span>
                            </div>

                            <p
                                className="mt-1 overflow-hidden text-[9px] font-medium leading-3.5 text-[#50617C]"
                                style={{
                                    display: "-webkit-box",
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: "vertical",
                                }}
                            >
                                {insight}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
