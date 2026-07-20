"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import * as XLSX from "xlsx";
import {
    AlertTriangle,
    CalendarClock,
    CalendarDays,
    ClipboardList,
    Download,
    PackageCheck,
    PackageX,
    RefreshCw,
    ShoppingCart,
    Store,
    TriangleAlert,
} from "lucide-react";

type Branch = {
    id: number;
    branchName: string;
    managerName?: string;
};

type Booking = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string | null;
    branch_name?: string | null;
    name: string;
    date?: string;
    time?: string;
    status?: string;
    packageName?: string;
    eventName?: string;
    bookingNumber?: string;

    bookingType?: string;
    booking_type?: string;
    customOrder?: string;
    custom_order?: string;

    agreed_price?: number | string | null;
    agreedPrice?: number | string | null;
    package_price?: number | string | null;
    packagePrice?: number | string | null;

    amount_paid?: number | string | null;
    amountPaid?: number | string | null;
    total?: number;
};

type OrderItem = {
    name?: string;
    quantity?: number;
    salesPrice?: number;
    sales_price?: number;
    sellingPrice?: number;
    selling_price?: number;
    price?: number;
    originalPrice?: number;
    original_price?: number;
    costPrice?: number;
    cost_price?: number;
};

type Order = {
    id?: string;
    orderId?: string;
    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string | null;
    branch_name?: string | null;
    total?: number;
    date?: string;
    orderDate?: string;
    createdAt?: string;
    time?: string;
    item?: string;
    items?: OrderItem[];
    status?: string;
    orderNumber?: string;
    orderType?: string;
};

type Product = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string | null;
    branch_name?: string | null;
    name: string;
    category?: string;
    stock?: number;
    alertLevel?: number;
    salesPrice?: number;
    sales_price?: number;
    sellingPrice?: number;
    selling_price?: number;
    price?: number;
    originalPrice?: number;
    original_price?: number;
    costPrice?: number;
    cost_price?: number;
};


function getSavedItem(key: string) {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
}

function getAssignedBranchId(user: unknown) {
    return (
        getUserValue(user, "branch_id") ||
        getUserValue(user, "branchId") ||
        getSavedItem("branch_id") ||
        getSavedItem("stocknbook_branch_id") ||
        getSavedItem("manager_branch_id")
    );
}

function getAssignedBranchName(user: unknown) {
    return (
        getUserValue(user, "branch_name") ||
        getUserValue(user, "branchName") ||
        getSavedItem("branch_name") ||
        getSavedItem("stocknbook_branch_name") ||
        getSavedItem("manager_branch_name") ||
        "Assigned Branch"
    );
}

function belongsToAssignedBranch<
    T extends { branchId?: number | null; branch_id?: number | null }
>(item: T, branchId: string) {
    if (!branchId) return false;

    const itemBranchId = item.branchId ?? item.branch_id;

    return itemBranchId !== null &&
        itemBranchId !== undefined &&
        String(itemBranchId) === String(branchId);
}

function getUserValue(user: unknown, key: string) {
    if (!user || typeof user !== "object") return "";
    return String((user as Record<string, unknown>)[key] ?? "");
}

function downloadExcel(
    filename: string,
    sheetName: string,
    headers: string[],
    rows: Array<Array<string | number | null | undefined>>,
) {
    const worksheetData = [
        headers,
        ...rows.map((row) => row.map((value) => value ?? "")),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet["!cols"] = headers.map((header, columnIndex) => {
        const longestValue = worksheetData.reduce((maxLength, row) => {
            const value = String(row[columnIndex] ?? "");
            return Math.max(maxLength, value.length);
        }, header.length);

        return {
            wch: Math.min(Math.max(longestValue + 2, 12), 38),
        };
    });

    worksheet["!autofilter"] = {
        ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${worksheetData.length}`,
    };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        sheetName.slice(0, 31),
    );

    XLSX.writeFile(
        workbook,
        filename.toLowerCase().endsWith(".xlsx")
            ? filename
            : `${filename}.xlsx`,
        {
            bookType: "xlsx",
            compression: true,
        },
    );
}

function peso(value: number) {
    return `₱${Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
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

        if (value !== null && value !== undefined) {
            return value;
        }
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

    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBranch(value: unknown): Branch {
    const raw = toRecord(value);

    return {
        id: readNumber(raw, ["id", "branch_id", "branchId"]),
        branchName: readText(
            raw,
            ["branchName", "branch_name", "name", "branch"],
            "Unnamed Branch",
        ),
        managerName: readText(raw, ["managerName", "manager_name", "manager"]),
    };
}

function normalizeBooking(value: unknown): Booking {
    const raw = toRecord(value);
    const rawBranchId = readNullableNumber(raw, ["branchId", "branch_id"]);

    return {
        id: readNumber(raw, ["id", "booking_id"]),
        branchId: rawBranchId,
        branch_id: rawBranchId,
        branchName: readText(raw, ["branchName", "branch_name"]) || null,
        branch_name: readText(raw, ["branch_name", "branchName"]) || null,
        name: readText(raw, ["name", "customer_name"], "Unnamed Client"),
        date: readText(raw, [
            "date",
            "event_date",
            "eventDate",
            "booking_date",
            "bookingDate",
            "event_datetime",
            "eventDateTime",
            "booking_datetime",
            "bookingDateTime",
            "scheduled_at",
            "scheduledAt",
            "start_at",
            "startAt",
            "created_at",
            "createdAt",
        ]),
        time: readText(raw, [
            "time",
            "event_time",
            "eventTime",
            "booking_time",
            "bookingTime",
            "start_time",
            "startTime",
            "scheduled_time",
            "scheduledTime",
            "time_slot",
            "timeSlot",
        ]),
        status: normalizeDashboardBookingStatus(readText(raw, ["status"])),
        packageName: readText(raw, [
            "packageName",
            "package_name",
            "package",
            "package_title",
            "service_name",
        ]),
        eventName: readText(raw, [
            "eventName",
            "event_name",
            "event",
            "event_type",
        ]),
        bookingNumber: readText(raw, [
            "bookingNumber",
            "booking_number",
            "booking_no",
            "reference_number",
            "reference",
            "bookingReference",
            "booking_reference",
        ]),
        bookingType: readText(raw, ["bookingType", "booking_type"]),
        booking_type: readText(raw, ["booking_type", "bookingType"]),
        customOrder: readText(raw, ["customOrder", "custom_order"]),
        custom_order: readText(raw, ["custom_order", "customOrder"]),
        agreed_price:
            firstDefined(raw, ["agreed_price", "agreedPrice"]) as
                | number
                | string
                | null
                | undefined,
        agreedPrice:
            firstDefined(raw, ["agreedPrice", "agreed_price"]) as
                | number
                | string
                | null
                | undefined,
        package_price:
            firstDefined(raw, ["package_price", "packagePrice"]) as
                | number
                | string
                | null
                | undefined,
        packagePrice:
            firstDefined(raw, ["packagePrice", "package_price"]) as
                | number
                | string
                | null
                | undefined,
        amount_paid:
            firstDefined(raw, ["amount_paid", "amountPaid"]) as
                | number
                | string
                | null
                | undefined,
        amountPaid:
            firstDefined(raw, ["amountPaid", "amount_paid"]) as
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

function normalizeDashboardBookingStatus(value?: string | null) {
    const raw = String(value || "").trim().toLowerCase();

    if (!raw || raw === "pending" || raw === "pending") {
        return "Pending";
    }

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

function isCustomDashboardBooking(booking: Booking) {
    const type = String(booking.bookingType || booking.booking_type || "")
        .trim()
        .toLowerCase();

    const packageLabel = String(booking.packageName || "")
        .trim()
        .toLowerCase();

    const customText = String(booking.customOrder || booking.custom_order || "")
        .trim();

    return (
        type.includes("custom") ||
        packageLabel.includes("custom") ||
        Boolean(customText)
    );
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

function parseOrderItems(itemText?: string): OrderItem[] {
    if (!itemText) return [];

    return itemText
        .split(",")
        .map((item) => {
            const [name, qty] = item.split(" x");

            return {
                name: name?.trim() || "",
                quantity: Number(qty || 0),
            };
        })
        .filter((item) => item.name);
}

function normalizeOrderItem(value: unknown): OrderItem {
    const raw = toRecord(value);

    return {
        name: readText(raw, ["name", "productName", "product_name"]),
        quantity: readNumber(raw, ["quantity", "qty"]),
        salesPrice: readNumber(raw, ["salesPrice", "sales_price"]),
        sales_price: readNumber(raw, ["sales_price", "salesPrice"]),
        sellingPrice: readNumber(raw, ["sellingPrice", "selling_price"]),
        selling_price: readNumber(raw, ["selling_price", "sellingPrice"]),
        price: readNumber(raw, ["price"]),
        originalPrice: readNumber(raw, ["originalPrice", "original_price"]),
        original_price: readNumber(raw, ["original_price", "originalPrice"]),
        costPrice: readNumber(raw, ["costPrice", "cost_price"]),
        cost_price: readNumber(raw, ["cost_price", "costPrice"]),
    };
}

function normalizeOrder(value: unknown): Order {
    const raw = toRecord(value);
    const rawBranchId = readNullableNumber(raw, ["branchId", "branch_id"]);
    const itemText = readText(raw, ["item"]);
    const rawItems = firstDefined(raw, ["items"]);
    const items = Array.isArray(rawItems)
        ? rawItems.map(normalizeOrderItem).filter((item) => item.name)
        : parseOrderItems(itemText);

    return {
        id: readText(raw, ["id", "orderId", "order_id"]) || undefined,
        orderId: readText(raw, ["orderId", "order_id", "id"]) || undefined,
        branchId: rawBranchId,
        branch_id: rawBranchId,
        branchName: readText(raw, ["branchName", "branch_name"]) || null,
        branch_name: readText(raw, ["branch_name", "branchName"]) || null,
        total: readNumber(raw, ["total"]),
        date: readText(raw, [
            "date",
            "orderDate",
            "order_date",
            "scheduled_date",
            "scheduledDate",
            "pickup_date",
            "pickupDate",
            "delivery_date",
            "deliveryDate",
            "scheduled_at",
            "scheduledAt",
            "pickup_at",
            "pickupAt",
            "delivery_at",
            "deliveryAt",
            "createdAt",
            "created_at",
        ]),
        orderDate: readText(raw, [
            "orderDate",
            "order_date",
            "scheduled_date",
            "scheduledDate",
            "pickup_date",
            "pickupDate",
            "delivery_date",
            "deliveryDate",
            "date",
        ]),
        createdAt: readText(raw, ["createdAt", "created_at"]),
        time: readText(raw, [
            "time",
            "order_time",
            "orderTime",
            "scheduled_time",
            "scheduledTime",
            "pickup_time",
            "pickupTime",
            "delivery_time",
            "deliveryTime",
            "time_slot",
            "timeSlot",
        ]),
        item: itemText,
        items,
        status: readText(raw, ["status", "order_status"]),
        orderNumber: readText(raw, [
            "orderNumber",
            "order_number",
            "order_no",
            "reference_number",
            "reference",
            "orderId",
            "order_id",
            "id",
        ]),
        orderType: readText(raw, ["orderType", "order_type", "type", "source"]),
    };
}

function normalizeProduct(value: unknown): Product {
    const raw = toRecord(value);
    const rawBranchId = readNullableNumber(raw, ["branchId", "branch_id"]);

    const sellingPrice = readNumber(raw, [
        "salesPrice",
        "sales_price",
        "sellingPrice",
        "selling_price",
        "price",
    ]);

    const originalPrice = readNumber(raw, [
        "originalPrice",
        "original_price",
        "costPrice",
        "cost_price",
        "origPrice",
        "orig_price",
    ]);

    return {
        id: readNumber(raw, ["id"]),
        branchId: rawBranchId,
        branch_id: rawBranchId,
        branchName: readText(raw, ["branchName", "branch_name"]) || null,
        branch_name: readText(raw, ["branch_name", "branchName"]) || null,
        name: readText(raw, ["name"]),
        category: readText(raw, ["category"]),
        stock: readNumber(raw, ["stock"]),
        alertLevel: readNumber(raw, ["alertLevel", "alert_level"]),
        salesPrice: sellingPrice,
        sales_price: sellingPrice,
        sellingPrice: sellingPrice,
        selling_price: sellingPrice,
        price: sellingPrice,
        originalPrice,
        original_price: originalPrice,
        costPrice: originalPrice,
        cost_price: originalPrice,
    };
}

function compactDashboardReference(
    prefix: "BK" | "SO",
    explicitReference: string | undefined,
    fallbackValue: string | number,
) {
    const explicit = String(explicitReference || "").trim();

    // Keep already-short references such as BK-162665 or SO-102341.
    if (explicit && explicit.length <= 12) {
        return explicit;
    }

    // Prefer the last numeric group from an existing long reference.
    const numericGroups = explicit.match(/\d+/g);
    const lastNumericGroup = numericGroups?.[numericGroups.length - 1];

    if (lastNumericGroup) {
        return `${prefix}-${lastNumericGroup.slice(-6).padStart(6, "0")}`;
    }

    const fallback = String(fallbackValue || "").replace(/\D/g, "");
    const numberPart = fallback.slice(-6).padStart(6, "0");

    return `${prefix}-${numberPart}`;
}


function formatDashboardTime(dateValue?: string, explicitTime?: string) {
    const format = (value: Date) =>
        value.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });

    const rawTime = String(explicitTime || "").trim();

    if (rawTime) {
        const timeOnlyMatch = rawTime.match(
            /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?\s*(AM|PM)?(?:Z|[+-]\d{2}:?\d{2})?$/i,
        );

        if (timeOnlyMatch) {
            let hour = Number(timeOnlyMatch[1]);
            const minute = Number(timeOnlyMatch[2]);
            const period = timeOnlyMatch[3]?.toUpperCase();

            if (period === "PM" && hour < 12) hour += 12;
            if (period === "AM" && hour === 12) hour = 0;

            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                return format(new Date(2000, 0, 1, hour, minute));
            }
        }

        const parsedExplicit = new Date(rawTime);
        if (!Number.isNaN(parsedExplicit.getTime())) {
            return format(parsedExplicit);
        }
    }

    const rawDate = String(dateValue || "").trim();
    const containsTime = /(?:T|\s)\d{1,2}:\d{2}/.test(rawDate);

    if (!containsTime) return "—";

    const parsedDate = new Date(rawDate);
    return Number.isNaN(parsedDate.getTime()) ? "—" : format(parsedDate);
}

export default function ManagerDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [bookingsError, setBookingsError] = useState("");
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showStockAlertsModal, setShowStockAlertsModal] = useState(false);
    const [stockAlertFilter, setStockAlertFilter] = useState<
        "all" | "low" | "out"
    >("all");

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentDateTime(new Date());
        }, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const loadManagerDashboard = useCallback(async () => {
        const token = getSavedItem("token");
        const storeId =
            getUserValue(user, "store_id") ||
            getUserValue(user, "storeId") ||
            getSavedItem("store_id") ||
            getSavedItem("stocknbook_store_id");
        const branchId = getAssignedBranchId(user);
        const assignedBranchName = getAssignedBranchName(user);

        if (!token || !branchId) {
            setBranches([]);
            setBookings([]);
            setOrders([]);
            setProducts([]);
            setBookingsError("No assigned branch was found for this account.");
            return;
        }

        setIsRefreshing(true);

        try {
            try {
                const branchesRes = await fetch("/api/branches", {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const branchesData = await branchesRes.json().catch(() => ({}));

                if (branchesRes.ok && Array.isArray(branchesData.branches)) {
                    const normalizedBranches: Branch[] = (branchesData.branches as unknown[]).map(normalizeBranch);
                    const assignedBranches = normalizedBranches.filter(
                        (branch) => String(branch.id) === String(branchId),
                    );

                    setBranches(
                        assignedBranches.length > 0
                            ? assignedBranches
                            : [
                                {
                                    id: Number(branchId),
                                    branchName: assignedBranchName,
                                },
                            ],
                    );
                }
            } catch (error) {
                console.warn("Manager dashboard branches fetch failed:", error);
            }

            try {
                setBookingsError("");

                const bookingsRes = await fetch("/api/bookings", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_booking_page_bookings",
                        role: "manager",
                        store_id: storeId ? Number(storeId) : undefined,
                        branch_id: Number(branchId),
                    }),
                    cache: "no-store",
                });

                const bookingsText = await bookingsRes.text();
                const bookingsData: {
                    bookings?: unknown[];
                    error?: unknown;
                    message?: unknown;
                    details?: unknown;
                } = bookingsText ? JSON.parse(bookingsText) : {};

                if (!bookingsRes.ok) {
                    const message = String(
                        bookingsData.error ||
                        bookingsData.message ||
                        "Unable to load booking data.",
                    );

                    console.error("Manager dashboard bookings request failed:", {
                        status: bookingsRes.status,
                        response: bookingsData,
                    });
                    setBookings([]);
                    setBookingsError(message);
                } else if (Array.isArray(bookingsData.bookings)) {
                    const normalizedBookings = bookingsData.bookings.map(normalizeBooking);
                    setBookings(
                        normalizedBookings.filter((booking) =>
                            belongsToAssignedBranch(booking, branchId),
                        ),
                    );
                } else {
                    setBookings([]);
                    setBookingsError("Bookings API returned an invalid response.");
                }
            } catch (error) {
                console.error("Manager dashboard bookings fetch failed:", error);
                setBookings([]);
                setBookingsError(
                    error instanceof Error
                        ? error.message
                        : "Unable to load booking data.",
                );
            }

            try {
                const productsRes = await fetch("/api/products", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_products",
                        branch_id: Number(branchId),
                    }),
                });

                const productsData = await productsRes.json().catch(() => ({}));

                if (productsRes.ok && Array.isArray(productsData.products)) {
                    const normalizedProducts: Product[] = (productsData.products as unknown[]).map(normalizeProduct);
                    setProducts(
                        normalizedProducts.filter((product) =>
                            belongsToAssignedBranch(product, branchId),
                        ),
                    );
                }
            } catch (error) {
                console.warn("Manager dashboard products fetch failed:", error);
            }

            try {
                const ordersRes = await fetch("/api/pos", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        action: "get_orders",
                        branch_id: Number(branchId),
                    }),
                });

                const ordersData = await ordersRes.json().catch(() => ({}));

                if (ordersRes.ok && Array.isArray(ordersData.orders)) {
                    const normalizedOrders: Order[] = (ordersData.orders as unknown[]).map(normalizeOrder);
                    setOrders(
                        normalizedOrders.filter((order) =>
                            belongsToAssignedBranch(order, branchId),
                        ),
                    );
                }
            } catch (error) {
                console.warn("Manager dashboard orders fetch failed:", error);
            }
        } finally {
            setIsRefreshing(false);
        }
    }, [user]);

    useEffect(() => {
        // Load the dashboard once when the page opens.
        // After that, data refreshes only when the user presses Refresh.
        void loadManagerDashboard();
    }, [loadManagerDashboard]);

    const scheduledOrders = useMemo(
        () =>
            orders.filter((order) => {
                const type = String(order.orderType || "")
                    .trim()
                    .toLowerCase()
                    .replace(/_/g, "-");

                return [
                    "scheduled",
                    "schedule",
                    "scheduled-order",
                    "future",
                    "future-order",
                    "advance-order",
                    "pre-order",
                    "preorder",
                ].includes(type);
            }),
        [orders],
    );

    const posSales = useMemo(() => {
        return orders
            .filter((order) => {
                const type = String(order.orderType || "")
                    .trim()
                    .toLowerCase()
                    .replace(/_/g, "-");

                const status = String(order.status || "").trim().toLowerCase();

                const isScheduledOrder = [
                    "scheduled",
                    "schedule",
                    "scheduled-order",
                    "future",
                    "future-order",
                    "advance-order",
                    "pre-order",
                    "preorder",
                ].includes(type);

                const isExcludedStatus = [
                    "pending",
                    "pending payment",
                    "unpaid",
                    "cancelled",
                    "canceled",
                    "refunded",
                    "void",
                    "draft",
                    "failed",
                ].includes(status);

                // Records returned by /api/pos without an order type are treated
                // as normal POS transactions. Scheduled orders and transactions
                // that are not yet successfully completed are excluded.
                return !isScheduledOrder && !isExcludedStatus;
            })
            .reduce((sum, order) => sum + Number(order.total || 0), 0);
    }, [orders]);

    const bookingSales = useMemo(
        () =>
            bookings
                .filter((booking) => {
                    const status = normalizeDashboardBookingStatus(booking.status);

                    return status === "Confirmed" || status === "Completed";
                })
                .reduce(
                    (sum, booking) =>
                        sum + getDashboardBookingTotalPrice(booking),
                    0,
                ),
        [bookings],
    );
    const scheduledOrderSales = scheduledOrders.reduce(
        (sum, order) => sum + Number(order.total || 0),
        0,
    );
    const totalBusinessSales = posSales + bookingSales + scheduledOrderSales;

    const allUpcomingBookings = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return [...bookings]
            .filter((booking) => {
                const status = String(booking.status || "").toLowerCase();
                const schedule = new Date(booking.date || "");

                return (
                    !["completed", "cancelled", "canceled"].includes(status) &&
                    !Number.isNaN(schedule.getTime()) &&
                    schedule.getTime() >= today.getTime()
                );
            })
            .sort(
                (first, second) =>
                    new Date(first.date || 0).getTime() -
                    new Date(second.date || 0).getTime(),
            );
    }, [bookings]);

    const upcomingBookings = allUpcomingBookings.slice(0, 3);

    const pendingBookingCount = bookings.filter((booking) => {
        const status = String(booking.status || "").toLowerCase();
        return status.includes("pending") || status === "new";
    }).length;

    const allUpcomingOrders = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return [...scheduledOrders]
            .filter((order) => {
                const status = String(order.status || "").toLowerCase();
                const schedule = new Date(
                    order.orderDate || order.date || order.createdAt || "",
                );

                return (
                    !["completed", "cancelled", "canceled"].includes(status) &&
                    !Number.isNaN(schedule.getTime()) &&
                    schedule.getTime() >= today.getTime()
                );
            })
            .sort(
                (first, second) =>
                    new Date(first.orderDate || first.date || 0).getTime() -
                    new Date(second.orderDate || second.date || 0).getTime(),
            );
    }, [scheduledOrders]);

    const upcomingOrders = allUpcomingOrders.slice(0, 3);

    const pendingOrderCount = scheduledOrders.filter((order) => {
        const status = String(order.status || "").toLowerCase();
        return status.includes("pending") || status === "new";
    }).length;

    const allInventoryAlerts = useMemo(
        () =>
            products
                .filter(
                    (product) =>
                        Number(product.stock || 0) <= Number(product.alertLevel || 0),
                )
                .sort(
                    (first, second) =>
                        Number(first.stock || 0) - Number(second.stock || 0),
                ),
        [products],
    );

    const inventoryAlerts = allInventoryAlerts.slice(0, 3);
    const lowStockAlertCount = allInventoryAlerts.filter(
        (product) => Number(product.stock || 0) > 0,
    ).length;
    const outOfStockAlertCount = allInventoryAlerts.filter(
        (product) => Number(product.stock || 0) <= 0,
    ).length;
    const visibleStockAlerts = allInventoryAlerts.filter((product) => {
        if (stockAlertFilter === "low") return Number(product.stock || 0) > 0;
        if (stockAlertFilter === "out") return Number(product.stock || 0) <= 0;
        return true;
    });

    const currentMonthLabel = currentDateTime.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">
                            Dashboard
                        </h1>
                        <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                            Here&apos;s an overview of {getAssignedBranchName(user)} branch performance for {currentMonthLabel}.
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
              {formatCurrentDashboardDateTime(currentDateTime)}
            </span>

                        <button
                            type="button"
                            onClick={() => void loadManagerDashboard()}
                            disabled={isRefreshing}
                            aria-label="Refresh dashboard details"
                            title="Refresh dashboard details"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw
                                size={16}
                                className={isRefreshing ? "animate-spin" : ""}
                            />
                            {isRefreshing ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-6 py-5 font-sans">
                <div className="mx-auto max-w-none space-y-3.5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <SalesSummaryCard
                            title="Total Branch Sales"
                            value={peso(totalBusinessSales)}
                            subtitle="All sales channels"
                            icon={<Store size={25} />}
                            tone="violet"
                        />
                        <SalesSummaryCard
                            title="Total POS Sales"
                            value={peso(posSales)}
                            subtitle="Point-of-sale transactions"
                            icon={<ShoppingCart size={25} />}
                            tone="green"
                        />
                        <SalesSummaryCard
                            title="Total Booking Sales"
                            value={peso(bookingSales)}
                            subtitle="Sales from bookings"
                            icon={<CalendarDays size={25} />}
                            tone="blue"
                        />
                        <SalesSummaryCard
                            title="Total Scheduled Order Sales"
                            value={peso(scheduledOrderSales)}
                            subtitle="Sales from scheduled orders"
                            icon={<ClipboardList size={25} />}
                            tone="orange"
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                        <GlanceCard
                            title="Out of Stock"
                            value={outOfStockAlertCount}
                            label="Products"
                            icon={<PackageX size={22} />}
                            tone="red"
                        />
                        <GlanceCard
                            title="Low Stock"
                            value={lowStockAlertCount}
                            label="Products"
                            icon={<AlertTriangle size={22} />}
                            tone="orange"
                        />
                        <GlanceCard
                            title="Pending Bookings"
                            value={pendingBookingCount}
                            label="Bookings"
                            icon={<CalendarClock size={22} />}
                            tone="blue"
                        />
                        <GlanceCard
                            title="Upcoming Bookings"
                            value={upcomingBookings.length}
                            label="Bookings"
                            icon={<CalendarDays size={22} />}
                            tone="green"
                        />
                        <GlanceCard
                            title="Pending Orders"
                            value={pendingOrderCount}
                            label="Orders"
                            icon={<ClipboardList size={22} />}
                            tone="violet"
                        />
                        <GlanceCard
                            title="Upcoming Orders"
                            value={upcomingOrders.length}
                            label="Orders"
                            icon={<PackageCheck size={22} />}
                            tone="cyan"
                        />
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-3">
                        <CompactDashboardTable
                            title="Upcoming Bookings"
                            subtitle="Next 3 upcoming bookings"
                            icon={<CalendarDays size={18} />}
                            action={() => router.push("/bookings")}
                            onDownload={() =>
                                downloadExcel(
                                    "upcoming-bookings.xlsx",
                                    "Upcoming Bookings",
                                    ["Date", "Booking Number", "Time", "Status"],
                                    allUpcomingBookings.map((booking) => [
                                        booking.date || "",
                                        booking.bookingNumber ||
                                        `BK-${String(booking.id).padStart(6, "0")}`,
                                        formatDashboardTime(booking.date, booking.time),
                                        booking.status || "Pending",
                                    ]),
                                )
                            }
                            totalRecords={allUpcomingBookings.length}
                            headers={["Date", "Booking #", "Time", "Status"]}
                            emptyText={bookingsError || "No upcoming bookings yet."}
                            rows={upcomingBookings.map((booking) => ({
                                date: booking.date,
                                reference: compactDashboardReference(
                                    "BK",
                                    booking.bookingNumber,
                                    booking.id,
                                ),
                                time: formatDashboardTime(booking.date, booking.time),
                                status: booking.status || "Pending",
                            }))}
                        />

                        <CompactDashboardTable
                            title="Upcoming Orders"
                            subtitle="Next 3 scheduled orders"
                            icon={<ClipboardList size={18} />}
                            action={() => router.push("/orders")}
                            onDownload={() =>
                                downloadExcel(
                                    "upcoming-orders.xlsx",
                                    "Upcoming Orders",
                                    ["Date", "Order Number", "Time", "Status"],
                                    allUpcomingOrders.map((order, index) => {
                                        const orderDate =
                                            order.orderDate || order.date || order.createdAt || "";

                                        return [
                                            orderDate,
                                            compactDashboardReference(
                                                "SO",
                                                order.orderNumber || order.orderId || order.id,
                                                index + 1,
                                            ),
                                            formatDashboardTime(orderDate, order.time),
                                            order.status || "Pending",
                                        ];
                                    }),
                                )
                            }
                            totalRecords={allUpcomingOrders.length}
                            headers={["Date", "Order #", "Time", "Status"]}
                            emptyText="No upcoming scheduled orders yet."
                            rows={upcomingOrders.map((order, index) => {
                                const orderDate =
                                    order.orderDate || order.date || order.createdAt;

                                return {
                                    date: orderDate,
                                    reference: compactDashboardReference(
                                        "SO",
                                        order.orderNumber || order.orderId || order.id,
                                        index + 1,
                                    ),
                                    time: formatDashboardTime(orderDate, order.time),
                                    status: order.status || "Pending",
                                };
                            })}
                        />

                        <InventoryAlertPanel
                            items={inventoryAlerts}
                            totalAlerts={allInventoryAlerts.length}
                            onDownload={() =>
                                downloadExcel(
                                    "inventory-alerts.xlsx",
                                    "Inventory Alerts",
                                    ["Product", "Stock Level", "Status"],
                                    allInventoryAlerts.map((product) => [
                                        product.name,
                                        Number(product.stock || 0),
                                        Number(product.stock || 0) <= 0
                                            ? "Out of Stock"
                                            : "Low Stock",
                                    ]),
                                )
                            }
                            onViewAll={() => {
                                setStockAlertFilter("all");
                                setShowStockAlertsModal(true);
                            }}
                        />
                    </div>
                </div>
            </section>

            {showStockAlertsModal && (
                <ManagerStockAlertsModal
                    items={visibleStockAlerts}
                    activeFilter={stockAlertFilter}
                    totalCount={allInventoryAlerts.length}
                    lowStockCount={lowStockAlertCount}
                    outOfStockCount={outOfStockAlertCount}
                    onChangeFilter={setStockAlertFilter}
                    onClose={() => setShowStockAlertsModal(false)}
                />
            )}
        </>
    );
}

type DashboardTone = "violet" | "green" | "blue" | "orange" | "red" | "cyan";

const toneStyles: Record<DashboardTone, { icon: string; background: string }> =
    {
        violet: { icon: "text-[#6D35D4]", background: "bg-[#F1EBFF]" },
        green: { icon: "text-[#159455]", background: "bg-[#E6F7EE]" },
        blue: { icon: "text-[#2563EB]", background: "bg-[#EAF1FF]" },
        orange: { icon: "text-[#E66B20]", background: "bg-[#FFF0E5]" },
        red: { icon: "text-[#DC2626]", background: "bg-[#FDECEC]" },
        cyan: { icon: "text-[#138A96]", background: "bg-[#E8F8FA]" },
    };

function SalesSummaryCard({
                              title,
                              value,
                              subtitle,
                              icon,
                              tone,
                          }: {
    title: string;
    value: string;
    subtitle: string;
    icon: React.ReactNode;
    tone: DashboardTone;
}) {
    const style = toneStyles[tone];

    return (
        <div className="flex min-h-[128px] items-center gap-5 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-5 shadow-sm">
      <span
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${style.background} ${style.icon}`}
      >
        {icon}
      </span>
            <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-5 text-[#4B3E55]">
                    {title}
                </p>
                <p className="mt-2 truncate text-[26px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">
                    {value}
                </p>
                <p className="mt-2 text-[12px] leading-4 text-[#8A7D92]">{subtitle}</p>
            </div>
        </div>
    );
}

function GlanceCard({
                        title,
                        value,
                        label,
                        icon,
                        tone,
                    }: {
    title: string;
    value: number;
    label: string;
    icon: React.ReactNode;
    tone: DashboardTone;
}) {
    const style = toneStyles[tone];

    return (
        <div className="flex min-h-[124px] items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-4 py-5 shadow-sm">
      <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${style.background} ${style.icon}`}
      >
        {icon}
      </span>
            <div className="min-w-0 flex-1">
                <p className="whitespace-nowrap text-[12px] font-semibold leading-4 text-[#4B3E55]">
                    {title}
                </p>
                <p className={`mt-1 text-[25px] font-bold leading-none ${style.icon}`}>{value}</p>
                <p className="mt-1 text-[12px] text-[#8A7D92]">{label}</p>
            </div>
        </div>
    );
}

type CompactTableRow = {
    date?: string;
    reference: string;
    time: string;
    status: string;
};

function CompactDashboardTable({
                                   title,
                                   subtitle,
                                   icon,
                                   action,
                                   onDownload,
                                   totalRecords,
                                   headers,
                                   rows,
                                   emptyText,
                               }: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    action: () => void;
    onDownload: () => void;
    totalRecords: number;
    headers: [string, string, string, string];
    rows: CompactTableRow[];
    emptyText: string;
}) {
    return (
        <section className="flex min-h-[310px] flex-col overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
            <div className="flex min-h-[62px] items-center justify-between gap-3 border-b border-[#EEE8F2] px-4 py-2.5">
                <div className="flex min-w-0 items-start gap-2 text-[#6D35D4]">
                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center">
                        {icon}
                    </span>
                    <div className="min-w-0">
                        <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">
                            {title}
                        </h2>
                        <p className="truncate text-[9px] leading-5 text-[#8A7D92]">
                            {subtitle}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onDownload}
                        aria-label={`Download ${title}`}
                        title={`Download ${title}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] text-[#6D35D4] transition hover:bg-[#F3EEFF]"
                    >
                        <Download size={16} strokeWidth={2} />
                    </button>

                    <button
                        type="button"
                        onClick={action}
                        className="rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4]"
                    >
                        View all
                    </button>
                </div>
            </div>

            <table className="w-full flex-1 table-fixed border-collapse">
                <colgroup>
                    <col className="w-[22%]" />
                    <col className="w-[31%]" />
                    <col className="w-[22%]" />
                    <col className="w-[25%]" />
                </colgroup>
                <thead className="bg-[#FBFAFD]">
                <tr className="border-b border-[#EEE8F2]">
                    {headers.map((header) => (
                        <th
                            key={header}
                            className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-[#806A8C]"
                        >
                            {header}
                        </th>
                    ))}
                </tr>
                </thead>
                <tbody>
                {rows.length === 0 ? (
                    <tr>
                        <td
                            colSpan={4}
                            className="h-[170px] px-4 text-center text-[13px] text-[#8A7D92]"
                        >
                            {emptyText}
                        </td>
                    </tr>
                ) : (
                    rows.map((row, index) => (
                        <CompactDashboardRow
                            key={`${row.reference}-${index}`}
                            row={row}
                        />
                    ))
                )}
                </tbody>
            </table>
            <div className="border-t border-[#EEE8F2] px-4 py-1.5 text-center text-[9px] font-medium text-[#8A7D92]">
                Showing {rows.length} of {totalRecords} record
                {totalRecords === 1 ? "" : "s"}
            </div>
        </section>
    );
}

function CompactDashboardRow({ row }: { row: CompactTableRow }) {
    const parsed = new Date(row.date || "");
    const validDate = !Number.isNaN(parsed.getTime());
    const month = validDate
        ? parsed.toLocaleDateString("en-US", { month: "short" }).toUpperCase()
        : "—";
    const day = validDate ? parsed.getDate() : "—";
    const normalized = row.status.toLowerCase();
    const statusClass =
        normalized.includes("confirm") || normalized.includes("complete")
            ? "text-[#16834A]"
            : normalized.includes("cancel")
                ? "text-[#C53030]"
                : "text-[#B66B00]";

    return (
        <tr className="h-[58px] border-b border-[#F1EDF5] last:border-b-0 hover:bg-[#FCFAFF]">
            <td className="px-3 py-2">
                <div className="flex h-10 w-10 flex-col items-center justify-center rounded-lg border border-[#E8E0F0] bg-[#FBF9FE] leading-none">
                    <span className="text-[7px] font-bold text-[#7C3AED]">{month}</span>
                    <span className="mt-1 text-[14px] font-bold text-[#342047]">
                        {day}
                    </span>
                </div>
            </td>
            <td className="px-3 py-2">
                <p
                    title={row.reference}
                    className="whitespace-nowrap text-[13px] font-semibold text-[#30243A]"
                >
                    {row.reference}
                </p>
            </td>
            <td className="px-3 py-2">
                <p className="whitespace-nowrap text-[13px] font-semibold text-[#5F4E75]">
                    {row.time}
                </p>
            </td>
            <td className="px-3 py-2">
                <span
                    className={`whitespace-nowrap text-[13px] font-semibold capitalize ${statusClass}`}
                >
                    {row.status}
                </span>
            </td>
        </tr>
    );
}

function InventoryAlertPanel({
                                 items,
                                 totalAlerts,
                                 onDownload,
                                 onViewAll,
                             }: {
    items: Product[];
    totalAlerts: number;
    onDownload: () => void;
    onViewAll: () => void;
}) {
    return (
        <section className="flex min-h-[310px] flex-col overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
            <div className="flex min-h-[62px] items-center justify-between gap-3 border-b border-[#EEE8F2] px-4 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                    <TriangleAlert size={18} className="mt-0.5 shrink-0 text-[#EF4444]" />
                    <div className="min-w-0">
                        <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">
                            Inventory Alerts
                        </h2>
                        <p className="truncate text-[9px] leading-5 text-[#8A7D92]">
                            Items that need attention
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onDownload}
                        aria-label="Download Inventory Alerts"
                        title="Download Inventory Alerts"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] text-[#6D35D4] transition hover:bg-[#F3EEFF]"
                    >
                        <Download size={16} strokeWidth={2} />
                    </button>

                    <button
                        type="button"
                        onClick={onViewAll}
                        className="rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4]"
                    >
                        View all
                    </button>
                </div>
            </div>

            <table className="w-full flex-1 table-fixed border-collapse">
                <colgroup>
                    <col className="w-[72%]" />
                    <col className="w-[28%]" />
                </colgroup>
                <thead className="bg-[#FBFAFD]">
                <tr className="border-b border-[#EEE8F2]">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-[#806A8C]">
                        Product
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-[#806A8C]">
                        Stock Level
                    </th>
                </tr>
                </thead>
                <tbody>
                {items.length === 0 ? (
                    <tr>
                        <td
                            colSpan={2}
                            className="h-[170px] px-4 text-center text-[13px] text-[#8A7D92]"
                        >
                            All products are well stocked.
                        </td>
                    </tr>
                ) : (
                    items.map((product) => {
                        const stock = Number(product.stock || 0);

                        return (
                            <tr
                                key={product.id}
                                className="h-[58px] border-b border-[#F1EDF5] last:border-b-0 hover:bg-[#FFFCFC]"
                            >
                                <td className="px-3 py-2">
                                    <p
                                        title={product.name}
                                        className="line-clamp-2 text-[13px] font-semibold leading-6 text-[#30243A]"
                                    >
                                        {product.name}
                                    </p>
                                </td>
                                <td className="px-3 py-2">
                                    <span
                                        className={`whitespace-nowrap text-[13px] font-semibold ${stock <= 0 ? "text-[#DC2626]" : "text-[#B7791F]"}`}
                                    >
                                        {stock} left
                                    </span>
                                </td>
                            </tr>
                        );
                    })
                )}
                </tbody>
            </table>
            <div className="border-t border-[#EEE8F2] px-4 py-1.5 text-center text-[9px] font-medium text-[#8A7D92]">
                Showing {items.length} of {totalAlerts} alert
                {totalAlerts === 1 ? "" : "s"}
            </div>
        </section>
    );
}

function ManagerStockAlertsModal({
                                     items,
                                     activeFilter,
                                     totalCount,
                                     lowStockCount,
                                     outOfStockCount,
                                     onChangeFilter,
                                     onClose,
                                 }: {
    items: Product[];
    activeFilter: "all" | "low" | "out";
    totalCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    onChangeFilter: (filter: "all" | "low" | "out") => void;
    onClose: () => void;
}) {
    const filterClass = (active: boolean, tone: "all" | "low" | "out") => {
        if (active && tone === "all") {
            return "border-[#2B174C] bg-[#2B174C] text-white";
        }

        if (active && tone === "low") {
            return "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";
        }

        if (active && tone === "out") {
            return "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]";
        }

        return "border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#FAF8FF]";
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-6 font-sans text-[#1A1220] backdrop-blur-[2px] [&_*]:font-sans">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="manager-stock-alerts-title"
                className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4 border-b border-[#E9E0EF] px-6 py-5">
                    <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFF4D8] text-[#B7791F]">
              <TriangleAlert size={21} strokeWidth={2} />
            </span>

                        <div className="min-w-0">
                            <h2
                                id="manager-stock-alerts-title"
                                className="!text-[20px] !font-bold !leading-6 text-[#1A1220]"
                            >
                                Stock Alerts
                            </h2>
                            <p className="mt-1 !text-sm !font-normal !leading-5 text-[#7A6A84]">
                                Low-stock and out-of-stock items for the current inventory view.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close stock alerts"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl !text-[22px] !font-normal !leading-none text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C]"
                    >
                        ×
                    </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E0EF] px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onChangeFilter("all")}
                            className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterClass(
                                activeFilter === "all",
                                "all",
                            )}`}
                        >
                            All ({totalCount})
                        </button>

                        <button
                            type="button"
                            onClick={() => onChangeFilter("low")}
                            className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterClass(
                                activeFilter === "low",
                                "low",
                            )}`}
                        >
                            Low Stock ({lowStockCount})
                        </button>

                        <button
                            type="button"
                            onClick={() => onChangeFilter("out")}
                            className={`h-9 rounded-xl border px-4 !text-xs !font-semibold transition ${filterClass(
                                activeFilter === "out",
                                "out",
                            )}`}
                        >
                            Out of Stock ({outOfStockCount})
                        </button>
                    </div>

                    <span className="!text-xs !font-semibold text-[#806A8C]">
            View only
          </span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[700px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#FFFCF7]">
                        <tr className="border-b border-[#E9E0EF]">
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Product
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Variant
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Current Stock
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Alert Level
                            </th>
                            <th className="px-5 py-3 text-left !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Status
                            </th>
                        </tr>
                        </thead>

                        <tbody>
                        {items.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={5}
                                    className="px-5 py-14 text-center text-sm text-[#7A6A84]"
                                >
                                    No stock alerts found for this filter.
                                </td>
                            </tr>
                        ) : (
                            items.map((product) => {
                                const stock = Number(product.stock || 0);
                                const isOut = stock <= 0;

                                return (
                                    <tr
                                        key={product.id}
                                        className="border-b border-[#EEE7F2] transition hover:bg-[#FFFCF7] last:border-b-0"
                                    >
                                        <td className="px-5 py-3.5">
                                            <p className="!text-sm !font-semibold !leading-5 text-[#1A1220]">
                                                {product.name}
                                            </p>
                                            <p
                                                className={`mt-0.5 !text-xs !font-medium !leading-4 ${
                                                    isOut ? "text-[#D92D20]" : "text-[#A56607]"
                                                }`}
                                            >
                                                {isOut ? "Out of Stock" : "Low Stock"}
                                            </p>
                                        </td>
                                        <td className="px-5 py-3.5 !text-sm !font-normal !leading-5 text-[#806A8C]">
                                            —
                                        </td>
                                        <td
                                            className={`px-5 py-3.5 !text-sm !font-semibold !leading-5 ${
                                                isOut ? "text-[#D92D20]" : "text-[#A56607]"
                                            }`}
                                        >
                                            {stock}
                                        </td>
                                        <td className="px-5 py-3.5 !text-sm !font-normal !leading-5 text-[#665875]">
                                            {Number(product.alertLevel || 0)}
                                        </td>
                                        <td className="px-5 py-3.5">
                        <span
                            className={`inline-flex rounded-full border px-3 py-1 !text-xs !font-semibold !leading-4 ${
                                isOut
                                    ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
                                    : "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
                            }`}
                        >
                          {isOut ? "Out of Stock" : "Low Stock"}
                        </span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-[#E9E0EF] bg-[#FFFCF7] px-6 py-3 text-xs leading-5 text-[#7A6A84]">
                    Manager accounts can review stock alerts for their assigned branch here. Restocking and inventory
                    changes are managed by authorized branch users.
                </div>
            </div>
        </div>
    );
}