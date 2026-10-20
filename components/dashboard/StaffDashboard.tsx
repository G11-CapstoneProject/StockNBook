"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    Activity,
    CalendarCheck,
    CalendarX2,
    Download,
    LogIn,
    LogOut,
    Search,
    Package,
    Loader2,
    AlertTriangle,
    BarChart3,
    CalendarClock,
    CalendarDays,
    CheckCircle2,
    ChevronRight,
    CreditCard,
    ClipboardList,
    Clock3,
    Eye,
    ListChecks,
    PackageCheck,
    PackageX,
    RefreshCw,
    ShoppingCart,
    Store,
    TriangleAlert,
    X,
    Zap,
} from "lucide-react";
import DashboardExportMenu from "./DashboardExportMenu";
import type { ExportContext, ExportTable } from "./_shared";

// Keep the very large Reports/_shared module out of the initial dashboard bundle.
// It is loaded only if the user actually exports a dashboard table.
function exportTableAsPdf(
    table: ExportTable,
    context: ExportContext,
    filenamePrefix: string,
) {
    void import("./_shared")
        .then((module) => module.exportTableAsPdf(table, context, filenamePrefix))
        .catch((error) => console.error("Dashboard PDF export failed:", error));
}

function exportTableAsExcel(
    table: ExportTable,
    context: ExportContext,
    filenamePrefix: string,
    sheetName = "Report",
) {
    void import("./_shared")
        .then((module) =>
            module.exportTableAsExcel(table, context, filenamePrefix, sheetName),
        )
        .catch((error) => console.error("Dashboard XLSX export failed:", error));
}

function exportTableAsDoc(
    table: ExportTable,
    context: ExportContext,
    filenamePrefix: string,
) {
    void import("./_shared")
        .then((module) => module.exportTableAsDoc(table, context, filenamePrefix))
        .catch((error) => console.error("Dashboard DOC export failed:", error));
}


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

type ProductVariant = {
    id?: number;
    variantNumber?: string | null;
    variant_number?: string | null;
    originalPrice?: number;
    salesPrice?: number;
    pricingMethod?: "manual" | "markup";
    markupPercentage?: number | null;
    variantValues?: Record<string, string>;
    variant_values?: Record<string, string>;
    stock?: number;
    alertLevel?: number;
    alert_level?: number;
    expirationDate?: string | null;
    expiration_date?: string | null;
};

type Product = {
    id: number;
    productNumber?: string | null;
    product_number?: string | null;
    hasVariants?: boolean;
    storeId?: number | null;
    pricingMethod?: "manual" | "markup";
    markupPercentage?: number | null;
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
    expirationDate?: string | null;
    expiration_date?: string | null;
    variants?: ProductVariant[];
};

type ExpirationAlertStatus = "Expired" | "Expiring";

type ExpirationAlertItem = {
    id: string;
    productId: number;
    variantId?: number | null;
    productName: string;
    branchName: string;
    variantName: string;
    stock: number;
    expirationDate: string;
    daysRemaining: number;
    status: ExpirationAlertStatus;
};

type StockAlertStatus = "Low Stock" | "Out of Stock";

type StockAlertItem = {
    id: string;
    productId: number;
    variantId?: number | null;
    productName: string;
    branchName: string;
    variantName: string;
    currentStock: number;
    alertLevel: number;
    status: StockAlertStatus;
};



/**
 * Retry a transient browser network failure ONCE for dashboard read requests.
 * Not used for any operation that changes data (attendance or stock receiving).
 * HTTP errors are passed through and remain visible for proper diagnosis.
 */
async function fetchStaffDashboardRead(url: string, options: RequestInit): Promise<Response> {
    try {
        return await fetch(url, options);
    } catch (error) {
        if (!(error instanceof TypeError) ||
            (typeof navigator !== "undefined" && !navigator.onLine) ||
            (typeof document !== "undefined" && document.visibilityState === "hidden")) {
            throw error;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 700));
        return fetch(url, options);
    }
}

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
        getSavedItem("staff_branch_id")
    );
}

function getAssignedBranchName(user: unknown) {
    return (
        getUserValue(user, "branch_name") ||
        getUserValue(user, "branchName") ||
        getSavedItem("branch_name") ||
        getSavedItem("stocknbook_branch_name") ||
        getSavedItem("staff_branch_name") ||
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

type DashboardPermissionRecord = Record<string, unknown>;

function parseDashboardPermissions(
    value: unknown,
): DashboardPermissionRecord {
    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        return value as DashboardPermissionRecord;
    }

    if (typeof value === "string" && value.trim()) {
        try {
            const parsed = JSON.parse(value);

            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed as DashboardPermissionRecord;
            }
        } catch {
            return {};
        }
    }

    return {};
}

function dashboardPermissionAllowsWrite(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;

    if (typeof value === "string") {
        const normalized = value
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ");

        if (
            [
                "true",
                "full",
                "full access",
                "manage",
                "manage access",
                "write",
                "edit",
                "update",
                "restock",
                "allowed",
            ].includes(normalized)
        ) {
            return true;
        }

        if (
            [
                "false",
                "none",
                "no access",
                "view",
                "view only",
                "read",
                "read only",
            ].includes(normalized)
        ) {
            return false;
        }
    }

    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        const permission = value as DashboardPermissionRecord;

        const level =
            permission.level ??
            permission.access ??
            permission.permission ??
            permission.mode;

        if (level !== undefined) {
            return dashboardPermissionAllowsWrite(level);
        }

        return Boolean(
            permission.manage ??
            permission.write ??
            permission.edit ??
            permission.update ??
            permission.restock ??
            permission.create ??
            permission.confirm ??
            permission.prepare ??
            permission.transact ??
            permission.fullAccess ??
            permission.full_access
        );
    }

    return false;
}

function hasDashboardInventoryRestockPermission(user: unknown) {
    // StockNBook Staff Management controls this permission. The server checks
    // the active staff assignment against the database before changing stock.
    const value = getDashboardPermissionValue(user, [
        "inventory_access", "inventoryAccess", "inventory_manage", "inventory_write",
        "manage_inventory", "inventory",
    ]);
    return dashboardPermissionAllowsRead(value);
}

function dashboardPermissionAllowsRead(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;

    if (typeof value === "string") {
        const normalized = value
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ");

        if (
            [
                "false",
                "none",
                "no access",
                "disabled",
                "denied",
            ].includes(normalized)
        ) {
            return false;
        }

        if (
            [
                "true",
                "view",
                "view only",
                "read",
                "read only",
                "full",
                "full access",
                "manage",
                "manage access",
                "write",
                "edit",
                "update",
                "allowed",
            ].includes(normalized)
        ) {
            return true;
        }
    }

    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        const permission = value as DashboardPermissionRecord;
        const level =
            permission.level ??
            permission.access ??
            permission.permission ??
            permission.mode;

        if (level !== undefined) {
            return dashboardPermissionAllowsRead(level);
        }

        return Boolean(
            permission.enabled ??
            permission.allowed ??
            permission.view ??
            permission.read ??
            permission.manage ??
            permission.write ??
            permission.edit ??
            permission.update ??
            permission.create ??
            permission.fullAccess ??
            permission.full_access
        );
    }

    return false;
}

function getDashboardPermissionValue(
    user: unknown,
    keys: string[],
): unknown | undefined {
    const userRecord =
        user &&
        typeof user === "object" &&
        !Array.isArray(user)
            ? (user as DashboardPermissionRecord)
            : {};

    const permissionSources: unknown[] = [
        userRecord.permissions,
        userRecord.permission,
        getSavedItem("permissions"),
        getSavedItem("user_permissions"),
        getSavedItem("stocknbook_permissions"),
    ];

    for (const source of permissionSources) {
        const permissions = parseDashboardPermissions(source);

        for (const key of keys) {
            if (permissions[key] !== undefined) {
                return permissions[key];
            }
        }
    }

    for (const key of keys) {
        if (userRecord[key] !== undefined) {
            return userRecord[key];
        }
    }

    return undefined;
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

    if (!raw || raw === "pending" || raw === "pending review") {
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

    const rawVariants = firstDefined(raw, [
        "variants",
        "productVariants",
        "product_variants",
    ]);

    const variants: ProductVariant[] = Array.isArray(rawVariants)
        ? rawVariants.map((value) => {
            const variant = toRecord(value);
            const rawVariantValues = firstDefined(variant, [
                "variantValues",
                "variant_values",
                "values",
            ]);

            let parsedVariantValues: Record<string, string> = {};

            if (
                rawVariantValues &&
                typeof rawVariantValues === "object" &&
                !Array.isArray(rawVariantValues)
            ) {
                parsedVariantValues =
                    rawVariantValues as Record<string, string>;
            } else if (typeof rawVariantValues === "string") {
                try {
                    const parsed = JSON.parse(rawVariantValues);

                    if (
                        parsed &&
                        typeof parsed === "object" &&
                        !Array.isArray(parsed)
                    ) {
                        parsedVariantValues =
                            parsed as Record<string, string>;
                    }
                } catch {
                    parsedVariantValues = {};
                }
            }

            const variantAlertLevel = readNumber(variant, [
                "alertLevel",
                "alert_level",
                "alert",
            ]);

            return {
                id: readNumber(variant, ["id"]),
                variantValues: parsedVariantValues,
                variant_values: parsedVariantValues,
                stock: readNumber(variant, [
                    "stock",
                    "quantity",
                    "qty",
                ]),
                alertLevel: variantAlertLevel,
                alert_level: variantAlertLevel,
                expirationDate:
                    readText(variant, [
                        "expirationDate",
                        "expiration_date",
                        "expiryDate",
                        "expiry_date",
                    ]) || null,
                expiration_date:
                    readText(variant, [
                        "expiration_date",
                        "expirationDate",
                        "expiry_date",
                        "expiryDate",
                    ]) || null,
            };
        })
        : [];

    const expirationDate =
        readText(raw, [
            "expirationDate",
            "expiration_date",
            "expiryDate",
            "expiry_date",
        ]) || null;

    return {
        id: readNumber(raw, ["id"]),
        productNumber: readText(raw, ["productNumber", "product_number"]) || null,
        product_number: readText(raw, ["product_number", "productNumber"]) || null,
        hasVariants: Boolean(firstDefined(raw, ["hasVariants", "has_variants"])) || variants.length > 0,
        storeId: readNullableNumber(raw, ["storeId", "store_id"]),
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
        expirationDate,
        expiration_date: expirationDate,
        variants,
    };
}

const EXPIRING_SOON_DAYS = 30;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function parseDashboardExpirationDate(value?: string | null) {
    const rawValue = String(value || "").trim();

    if (!rawValue) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
        const [year, month, day] = rawValue.split("-").map(Number);
        const date = new Date(year, month - 1, day);
        date.setHours(0, 0, 0, 0);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsedDate = new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) return null;

    parsedDate.setHours(0, 0, 0, 0);
    return parsedDate;
}

function getDashboardDaysUntilExpiration(value?: string | null) {
    const expirationDate = parseDashboardExpirationDate(value);

    if (!expirationDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Math.round(
        (expirationDate.getTime() - today.getTime()) /
        DAY_IN_MILLISECONDS,
    );
}

function formatDashboardExpirationDate(value: string) {
    const expirationDate = parseDashboardExpirationDate(value);

    if (!expirationDate) return value || "";

    return expirationDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatDashboardBookingDate(value?: string | null) {
    const bookingDate = parseDashboardExpirationDate(value);

    if (!bookingDate) return value || "";

    return bookingDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function formatExpirationDistance(daysRemaining: number) {
    if (daysRemaining < -1) {
        return `${Math.abs(daysRemaining)} days ago`;
    }

    if (daysRemaining === -1) {
        return "1 day ago";
    }

    if (daysRemaining === 0) {
        return "Expires today";
    }

    if (daysRemaining === 1) {
        return "1 day left";
    }

    return `${daysRemaining} days left`;
}

function getDashboardVariantName(variant: ProductVariant) {
    const values =
        variant.variantValues ||
        variant.variant_values ||
        {};

    return (
        Object.values(values)
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(" / ") || "Variant"
    );
}

function getDashboardStockAlertItems(
    products: Product[],
): StockAlertItem[] {
    return products
        .flatMap((product) => {
            const variants = Array.isArray(product.variants)
                ? product.variants
                : [];

            if (variants.length > 0) {
                return variants.flatMap((variant, index) => {
                    const currentStock = Number(variant.stock || 0);
                    const alertLevel = Number(
                        variant.alertLevel ??
                        variant.alert_level ??
                        0,
                    );

                    const status: StockAlertStatus | null =
                        currentStock <= 0
                            ? "Out of Stock"
                            : currentStock <= alertLevel
                                ? "Low Stock"
                                : null;

                    if (!status) return [];

                    return [
                        {
                            id: `${product.id}-variant-${variant.id || index}`,
                            productId: product.id,
                            variantId: variant.id ?? null,
                            productName: product.name,
                            branchName:
                                product.branchName ||
                                product.branch_name ||
                                "Branch",
                            variantName:
                                getDashboardVariantName(variant),
                            currentStock,
                            alertLevel,
                            status,
                        },
                    ];
                });
            }

            const currentStock = Number(product.stock || 0);
            const alertLevel = Number(product.alertLevel || 0);

            const status: StockAlertStatus | null =
                currentStock <= 0
                    ? "Out of Stock"
                    : currentStock <= alertLevel
                        ? "Low Stock"
                        : null;

            if (!status) return [];

            return [
                {
                    id: `${product.id}-regular`,
                    productId: product.id,
                    variantId: null,
                    productName: product.name,
                    branchName:
                        product.branchName ||
                        product.branch_name ||
                        "Branch",
                    variantName: "",
                    currentStock,
                    alertLevel,
                    status,
                },
            ];
        })
        .sort(
            (first, second) =>
                first.currentStock - second.currentStock,
        );
}


function getExpirationAlertItems(
    products: Product[],
): ExpirationAlertItem[] {
    return products
        .flatMap((product) => {
            const variants = Array.isArray(product.variants)
                ? product.variants
                : [];

            const variantItems = variants.flatMap((variant, index) => {
                const expirationDate =
                    variant.expirationDate ||
                    variant.expiration_date ||
                    "";

                const daysRemaining =
                    getDashboardDaysUntilExpiration(expirationDate);

                if (
                    daysRemaining === null ||
                    daysRemaining > EXPIRING_SOON_DAYS
                ) {
                    return [];
                }

                return [
                    {
                        id: `${product.id}-variant-${variant.id || index}`,
                        productId: product.id,
                        variantId: variant.id || null,
                        productName: product.name,
                        branchName:
                            product.branchName ||
                            product.branch_name ||
                            "Branch",
                        variantName: getDashboardVariantName(variant),
                        stock: Number(variant.stock || 0),
                        expirationDate,
                        daysRemaining,
                        status:
                            daysRemaining < 0
                                ? "Expired"
                                : "Expiring",
                    } satisfies ExpirationAlertItem,
                ];
            });

            if (variantItems.length > 0) {
                return variantItems;
            }

            const expirationDate =
                product.expirationDate ||
                product.expiration_date ||
                "";

            const daysRemaining =
                getDashboardDaysUntilExpiration(expirationDate);

            if (
                daysRemaining === null ||
                daysRemaining > EXPIRING_SOON_DAYS
            ) {
                return [];
            }

            return [
                {
                    id: `${product.id}-regular`,
                    productId: product.id,
                    variantId: null,
                    productName: product.name,
                    branchName:
                        product.branchName ||
                        product.branch_name ||
                        "Branch",
                    variantName: "",
                    stock: Number(product.stock || 0),
                    expirationDate,
                    daysRemaining,
                    status:
                        daysRemaining < 0
                            ? "Expired"
                            : "Expiring",
                } satisfies ExpirationAlertItem,
            ];
        })
        .sort((first, second) => {
            if (first.status !== second.status) {
                return first.status === "Expired" ? -1 : 1;
            }

            if (first.status === "Expired") {
                // Recently expired items appear first.
                return second.daysRemaining - first.daysRemaining;
            }

            // Items expiring soonest appear first.
            return first.daysRemaining - second.daysRemaining;
        });
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

    if (!containsTime) return "";

    const parsedDate = new Date(rawDate);
    return Number.isNaN(parsedDate.getTime()) ? "" : format(parsedDate);
}



type StaffTaskPriority = "High" | "Medium" | "Low";

type StaffTaskRow = {
    id: string;
    productId?: number;
    variantId?: number | null;
    expirationAlertId?: string;
    task: string;
    relatedTo: string;
    priority: StaffTaskPriority;
    status: "Pending" | "Completed";
    dueAt?: Date | null;
    displayStatus?: string;
    bookingId?: number;
};

type StaffOperationRow = {
    id: string;
    productId?: number;
    variantId?: number | null;
    expirationAlertId?: string;
    at: Date;
    time: string;
    title: string;
    detail: string;
    reference?: string;
    status: string;
    source: "booking" | "pos" | "inventory" | "package" | "rental";
    bookingId?: number;
    priority?: StaffTaskPriority;
};

type StaffEmployeeAction = {
    id: string;
    employeeName: string;
    employeeRole: string;
    action: string;
    module: string;
    referenceNumber?: string;
    referenceId?: string;
    details?: string;
    branch?: string;
    branchId?: string | number;
    date: string;
    time?: string;
};

function formatLocalIsoDate(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function normalizeStaffEmployeeAction(value: unknown): StaffEmployeeAction {
    const raw = toRecord(value);

    return {
        id:
            readText(raw, ["id", "actionId", "action_id"]) ||
            `action-${Math.random().toString(36).slice(2)}`,
        employeeName: readText(raw, [
            "employeeName",
            "employee_name",
            "staffName",
            "staff_name",
            "userName",
            "user_name",
            "performedBy",
            "performed_by",
        ]),
        employeeRole: readText(raw, [
            "employeeRole",
            "employee_role",
            "role",
        ]),
        action: readText(raw, [
            "action",
            "actionName",
            "action_name",
            "description",
        ], "Recorded action"),
        module: readText(raw, ["module", "moduleName", "module_name"], "Inventory"),
        referenceNumber:
            readText(raw, [
                "referenceNumber",
                "reference_number",
                "reference",
            ]) || undefined,
        referenceId:
            readText(raw, [
                "referenceId",
                "reference_id",
                "entityId",
                "entity_id",
            ]) || undefined,
        details:
            readText(raw, [
                "details",
                "detail",
                "description",
                "notes",
            ]) || undefined,
        branch:
            readText(raw, [
                "branch",
                "branchName",
                "branch_name",
            ]) || undefined,
        branchId:
            firstDefined(raw, ["branchId", "branch_id"]) as
                | string
                | number
                | undefined,
        date: readText(raw, [
            "date",
            "createdAt",
            "created_at",
            "updatedAt",
            "updated_at",
            "timestamp",
        ]),
        time:
            readText(raw, [
                "time",
                "createdTime",
                "created_time",
            ]) || undefined,
    };
}

function normalizeActivityIdentity(value: string) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getEmployeeActionSource(
    moduleName: string,
): StaffOperationRow["source"] {
    const normalized = String(moduleName || "").trim().toLowerCase();

    if (normalized.includes("inventory")) return "inventory";
    if (normalized.includes("sales") || normalized.includes("pos")) return "pos";
    if (normalized.includes("package")) return "package";
    return "booking";
}

function parseOperationalDateTime(
    dateValue?: string | null,
    explicitTime?: string | null,
) {
    const rawDate = String(dateValue || "").trim();
    if (!rawDate) return null;

    let parsedDate: Date;

    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        const [year, month, day] = rawDate.split("-").map(Number);
        parsedDate = new Date(year, month - 1, day);
    } else {
        parsedDate = new Date(rawDate);
    }

    if (Number.isNaN(parsedDate.getTime())) return null;

    const rawTime = String(explicitTime || "").trim();
    if (rawTime) {
        const match = rawTime.match(
            /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i,
        );

        if (match) {
            let hour = Number(match[1]);
            const minute = Number(match[2]);
            const period = match[3]?.toUpperCase();

            if (period === "PM" && hour < 12) hour += 12;
            if (period === "AM" && hour === 12) hour = 0;

            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                parsedDate.setHours(hour, minute, 0, 0);
            }
        }
    }

    return parsedDate;
}

function isSameOperationalDay(value: Date | null, reference: Date) {
    if (!value) return false;

    return (
        value.getFullYear() === reference.getFullYear() &&
        value.getMonth() === reference.getMonth() &&
        value.getDate() === reference.getDate()
    );
}

function isSuccessfulPosTransaction(order: Order) {
    const type = String(order.orderType || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");
    const status = String(order.status || "").trim().toLowerCase();

    const scheduledTypes = [
        "scheduled",
        "schedule",
        "scheduled-order",
        "future",
        "future-order",
        "advance-order",
        "pre-order",
        "preorder",
    ];

    const excludedStatuses = [
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

    return !scheduledTypes.includes(type) && !excludedStatuses.includes(status);
}

function bookingNeedsPreparation(booking: Booking) {
    const status = normalizeDashboardBookingStatus(booking.status).toLowerCase();

    return (
        status === "confirmed" ||
        status === "preparing" ||
        status.includes("for preparation")
    );
}

function bookingPreparationIsDone(booking: Booking) {
    const status = normalizeDashboardBookingStatus(booking.status).toLowerCase();

    return (
        status === "completed" ||
        status.includes("ready") ||
        status.includes("prepared")
    );
}

function getStaffBookingAction(booking: Booking) {
    const status = normalizeDashboardBookingStatus(booking.status).toLowerCase();

    if (status === "pending" || status.includes("awaiting")) return "Confirm";
    if (
        status === "confirmed" ||
        status === "preparing" ||
        status.includes("for preparation")
    ) {
        return "Prepare";
    }
    if (status.includes("ready") || status.includes("prepared")) return "Release";
    return "View";
}

function getStaffTaskPriority(at: Date | null, reference: Date): StaffTaskPriority {
    if (!at) return "Medium";
    const hours = (at.getTime() - reference.getTime()) / (60 * 60 * 1000);
    if (hours <= 2) return "High";
    if (hours <= 4) return "Medium";
    return "Low";
}

function clampPercentage(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function formatNextBookingCountdown(target: Date | null, reference: Date) {
    if (!target) return "No more bookings today";

    const minutes = Math.max(
        0,
        Math.ceil((target.getTime() - reference.getTime()) / (60 * 1000)),
    );

    if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes > 0
        ? `in ${hours}h ${remainingMinutes}m`
        : `in ${hours} hour${hours === 1 ? "" : "s"}`;
}



/* ----------------------------------------------------------------------- */
/* Initial dashboard skeleton                                               */
/* ----------------------------------------------------------------------- */

function StaffSkeletonBar({ className = "" }: { className?: string }) {
    return <div className={`rounded-full bg-[#ECE7F0] ${className}`} />;
}

function StaffMetricSkeleton() {
    return (
        <div className="flex min-h-[114px] items-center gap-3 rounded-[16px] border border-[#E7DFEC] bg-white px-4 py-4 shadow-sm">
            <div className="h-14 w-14 shrink-0 rounded-full bg-[#EEE9F4]" />
            <div className="min-w-0 flex-1">
                <StaffSkeletonBar className="h-[14px] w-28" />
                <StaffSkeletonBar className="mt-2 h-7 w-12" />
                <StaffSkeletonBar className="mt-2 h-[11px] w-36 max-w-full" />
            </div>
        </div>
    );
}

function StaffTodayWorkSkeleton() {
    return (
        <section
            className="grid h-[540px] max-h-[540px] min-h-[540px] grid-rows-[auto_minmax(0,1fr)_24px] overflow-hidden rounded-2xl bg-white shadow-sm"
            style={{ height: 540, minHeight: 540, maxHeight: 540 }}
        >
            <div className="border-b border-[#EEE8F2] px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="h-9 w-9 shrink-0 rounded-lg bg-[#EEE9F4]" />
                        <div className="min-w-0">
                            <StaffSkeletonBar className="h-[18px] w-28" />
                            <StaffSkeletonBar className="mt-2 h-[11px] w-48 max-w-full" />
                        </div>
                    </div>
                    <div className="h-7 w-32 shrink-0 rounded-full bg-[#F1EDF4]" />
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <div className="h-7 w-16 rounded-full bg-[#E8E2EC]" />
                    <div className="h-7 w-24 rounded-full bg-[#F1EDF4]" />
                    <div className="h-7 w-24 rounded-full bg-[#F1EDF4]" />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[13%]" />
                        <col className="w-[25%]" />
                        <col className="w-[20%]" />
                        <col className="w-[18%]" />
                        <col className="w-[24%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[34px] border-b border-[#EEE8F2]">
                        <th className="px-4 py-2"><StaffSkeletonBar className="mx-auto h-2.5 w-8" /></th>
                        <th className="px-4 py-2"><StaffSkeletonBar className="h-2.5 w-16" /></th>
                        <th className="px-3 py-2"><StaffSkeletonBar className="h-2.5 w-14" /></th>
                        <th className="px-4 py-2"><StaffSkeletonBar className="mx-auto h-2.5 w-12" /></th>
                        <th className="px-4 py-2"><StaffSkeletonBar className="mx-auto h-2.5 w-10" /></th>
                    </tr>
                    </thead>
                    <tbody>
                    {[0, 1, 2, 3].map((item) => (
                        <tr key={item} className="h-[45px] border-b border-[#F1ECF4] last:border-b-0">
                            <td className="px-4 py-2.5"><StaffSkeletonBar className="mx-auto h-2.5 w-12" /></td>
                            <td className="px-4 py-2.5"><StaffSkeletonBar className="h-2.5 w-[82%]" /></td>
                            <td className="px-3 py-2.5"><StaffSkeletonBar className="h-2.5 w-[76%]" /></td>
                            <td className="px-3 py-2.5"><div className="mx-auto h-5 w-16 rounded-full bg-[#F1EDF4]" /></td>
                            <td className="px-4 py-2.5"><StaffSkeletonBar className="mx-auto h-2.5 w-12" /></td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            <div className="h-6 shrink-0 border-t border-[#EEE8F2] bg-[#FCFAFE]" />
        </section>
    );
}

function StaffQuickActionsSkeleton() {
    return (
        <section className="flex h-[540px] min-h-[540px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="shrink-0 px-4 pt-4">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-[#EEE9F4]" />
                    <div className="min-w-0 flex-1">
                        <StaffSkeletonBar className="h-[15px] w-24" />
                        <StaffSkeletonBar className="mt-2 h-[11px] w-40 max-w-full" />
                    </div>
                </div>
            </div>

            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4 pt-1">
                {[0, 1, 2, 3, 4].map((item) => (
                    <div key={item} className="flex h-10 shrink-0 items-center justify-between rounded-lg bg-[#F8F5FB] px-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="h-7 w-7 shrink-0 rounded-md bg-[#EDE7F2]" />
                            <StaffSkeletonBar className="h-2.5 w-28 max-w-full" />
                        </div>
                        <div className="h-3.5 w-3.5 rounded-full bg-[#E9E3EE]" />
                    </div>
                ))}
            </div>
        </section>
    );
}

function StaffTasksSkeleton() {
    return (
        <section
            className="grid h-[344px] max-h-[344px] min-h-[344px] grid-rows-[auto_minmax(0,1fr)_24px] overflow-hidden rounded-2xl bg-white shadow-sm"
            style={{ height: 344, minHeight: 344, maxHeight: 344 }}
        >
            <div className="border-b border-[#EEE8F2] px-5 py-4">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-[#EEE9F4]" />
                    <div className="min-w-0 flex-1">
                        <StaffSkeletonBar className="h-[15px] w-28" />
                        <StaffSkeletonBar className="mt-2 h-[11px] w-40 max-w-full" />
                    </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <div className="h-7 w-16 rounded-full bg-[#E8E2EC]" />
                    <div className="h-7 w-24 rounded-full bg-[#F1EDF4]" />
                    <div className="h-7 w-24 rounded-full bg-[#F1EDF4]" />
                </div>
            </div>

            <div className="min-h-0 overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[8%]" />
                        <col className="w-[32%]" />
                        <col className="w-[24%]" />
                        <col className="w-[16%]" />
                        <col className="w-[20%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[34px] border-b border-[#EEE8F2]">
                        <th className="px-2 py-2"><div className="mx-auto h-3 w-3 rounded-full bg-[#E7E0EC]" /></th>
                        <th className="px-3 py-2"><StaffSkeletonBar className="h-2.5 w-20" /></th>
                        <th className="px-3 py-2"><StaffSkeletonBar className="h-2.5 w-14" /></th>
                        <th className="px-3 py-2"><StaffSkeletonBar className="mx-auto h-2.5 w-8" /></th>
                        <th className="px-3 py-2"><StaffSkeletonBar className="mx-auto h-2.5 w-10" /></th>
                    </tr>
                    </thead>
                    <tbody>
                    {[0, 1, 2, 3].map((item) => (
                        <tr key={item} className="h-[45px] border-b border-[#F1ECF4] last:border-b-0">
                            <td className="px-2 py-2.5"><div className="mx-auto h-4 w-4 rounded-full bg-[#EAE4EF]" /></td>
                            <td className="px-3 py-2.5"><StaffSkeletonBar className="h-2.5 w-[82%]" /></td>
                            <td className="px-3 py-2.5"><StaffSkeletonBar className="h-2.5 w-[74%]" /></td>
                            <td className="px-3 py-2.5"><StaffSkeletonBar className="mx-auto h-2.5 w-10" /></td>
                            <td className="px-3 py-2.5"><StaffSkeletonBar className="mx-auto h-2.5 w-11" /></td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            <div className="h-6 border-t border-[#EEE8F2] bg-[#FCFAFE]" />
        </section>
    );
}

function StaffEfficiencySkeleton() {
    return (
        <section className="flex h-[344px] max-h-[344px] min-h-[344px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-[#EEE8F2] px-5 py-3.5">
                <div className="h-9 w-9 shrink-0 rounded-lg bg-[#EEE9F4]" />
                <div className="min-w-0 flex-1">
                    <StaffSkeletonBar className="h-[15px] w-28" />
                    <StaffSkeletonBar className="mt-2 h-[11px] w-40 max-w-full" />
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-2.5">
                {[0, 1, 2].map((item) => (
                    <div key={item}>
                        <div className="flex items-center justify-between gap-3">
                            <StaffSkeletonBar className="h-2.5 w-28" />
                            <StaffSkeletonBar className="h-2.5 w-10" />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#F1ECF6]">
                                <div className="h-full rounded-full bg-[#DDD5E5]" style={{ width: `${72 - item * 14}%` }} />
                            </div>
                            <StaffSkeletonBar className="h-2 w-8" />
                        </div>
                    </div>
                ))}

                <div className="flex items-center justify-between border-t border-[#F1ECF4] pt-2">
                    <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-[#EEE9F4]" />
                        <StaffSkeletonBar className="h-2.5 w-32" />
                    </div>
                    <StaffSkeletonBar className="h-3 w-6" />
                </div>

                <div className="mt-auto rounded-xl bg-[#F8F5FC] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-white shadow-sm" />
                            <div>
                                <StaffSkeletonBar className="h-2 w-16" />
                                <StaffSkeletonBar className="mt-2 h-3 w-24" />
                            </div>
                        </div>
                        <div className="text-right">
                            <StaffSkeletonBar className="ml-auto h-2.5 w-12" />
                            <StaffSkeletonBar className="ml-auto mt-2 h-2 w-16" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="h-6 shrink-0 border-t border-[#EEE8F2] bg-[#FCFAFE]" />
        </section>
    );
}

function StaffActivitySkeleton() {
    return (
        <section className="grid h-[344px] max-h-[344px] min-h-[344px] grid-rows-[auto_minmax(0,1fr)_24px] overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-[#EEE8F2] px-5 py-4">
                <div className="h-9 w-9 shrink-0 rounded-lg bg-[#EEE9F4]" />
                <div className="min-w-0 flex-1">
                    <StaffSkeletonBar className="h-[15px] w-28" />
                    <StaffSkeletonBar className="mt-2 h-[11px] w-36 max-w-full" />
                </div>
            </div>

            <div className="min-h-0 overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[14%]" />
                        <col className="w-[46%]" />
                        <col className="w-[18%]" />
                        <col className="w-[22%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[30px] border-b border-[#EEE8F2]">
                        <th className="px-2.5 py-1"><StaffSkeletonBar className="mx-auto h-2 w-7" /></th>
                        <th className="px-2.5 py-1"><StaffSkeletonBar className="h-2 w-14" /></th>
                        <th className="px-2.5 py-1"><StaffSkeletonBar className="h-2 w-8" /></th>
                        <th className="px-2.5 py-1"><StaffSkeletonBar className="h-2 w-10" /></th>
                    </tr>
                    </thead>
                    <tbody>
                    {[0, 1, 2, 3, 4].map((item) => (
                        <tr key={item} className="h-[43px]">
                            <td className="px-2.5 py-2.5"><div className="mx-auto h-7 w-7 rounded-full bg-[#EEE9F4]" /></td>
                            <td className="px-2.5 py-2.5"><StaffSkeletonBar className="h-2.5 w-[82%]" /></td>
                            <td className="px-2.5 py-2.5"><StaffSkeletonBar className="h-2.5 w-10" /></td>
                            <td className="px-2.5 py-2.5"><div className="h-5 w-14 rounded-full bg-[#F1EDF4]" /></td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            <div className="h-6 border-t border-[#EEE8F2] bg-[#FCFAFE]" />
        </section>
    );
}

function StaffDashboardSkeleton() {
    return (
        <div className="mx-auto max-w-none space-y-4 animate-pulse" role="status" aria-label="Loading staff dashboard">
            <span className="sr-only">Loading staff dashboard data</span>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
                {[0, 1, 2, 3].map((item) => <StaffMetricSkeleton key={item} />)}
            </div>

            <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-hidden="true">
                <StaffTodayWorkSkeleton />
                <StaffQuickActionsSkeleton />
            </div>
        </div>
    );
}

type StaffActionToastMessage = {
    title: string;
    message: string;
    tone?: "success" | "error";
};

/** Same placement, colors, dismiss and fade timing as Manager Inventory notifications. */
function StaffActionToast({ toast, onClose }: {
    toast: StaffActionToastMessage | null;
    onClose: () => void;
}) {
    const [isFadingOut, setIsFadingOut] = React.useState(false);
    React.useEffect(() => {
        if (!toast) { setIsFadingOut(false); return; }
        setIsFadingOut(false);
        const fadeTimer = window.setTimeout(() => setIsFadingOut(true), 5000);
        const closeTimer = window.setTimeout(onClose, 5600);
        return () => { window.clearTimeout(fadeTimer); window.clearTimeout(closeTimer); };
    }, [toast, onClose]);
    if (!toast) return null;
    const isError = toast.tone === "error";
    return <div role="status" aria-live="polite" className={[
        "fixed bottom-5 right-5 z-[160] flex w-[min(360px,calc(100vw-2.5rem))] items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_18px_42px_rgba(43,23,76,0.22)] transition-all duration-700 ease-out",
        isError ? "border-[#F4BFC5]" : "border-[#BCE8CA]",
        isFadingOut ? "translate-y-3 opacity-0" : "translate-y-0 opacity-100",
    ].join(" ")}>
        <span className={[
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            isError ? "bg-[#FFE7EA] text-[#D92C3F]" : "bg-[#E5F8EC] text-[#23834A]",
        ].join(" ")}>
            {isError ? <AlertTriangle size={20} strokeWidth={2.4} /> : <CheckCircle2 size={20} strokeWidth={2.4} />}
        </span>
        <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[#1A1220]">{toast.title}</p>
            <p className="mt-0.5 text-xs leading-5 text-[#6A5D6F]">{toast.message}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss notification"
                className="shrink-0 text-lg leading-none text-[#9B8AAA] transition hover:text-[#2B174C]">×</button>
    </div>;
}

export default function StaffDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();

    const [bookings, setBookings] = useState<Booking[]>([]);
    const [bookingsError, setBookingsError] = useState("");
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [employeeActions, setEmployeeActions] = useState<StaffEmployeeAction[]>([]);
    const [employeeActionsLoaded, setEmployeeActionsLoaded] = useState(false);
    const [selectedBookingDetails, setSelectedBookingDetails] = useState<Booking | null>(null);
    const [authorizedReceipt, setAuthorizedReceipt] = useState<{ product: Product; task: StaffAuthorizedReceipt } | null>(null);
    const [directRestock, setDirectRestock] = useState<{ product: Product; variantId: number | null } | null>(null);
    const [expiryReview, setExpiryReview] = useState<ExpirationAlertItem | null>(null);
    const [staffToast, setStaffToast] = useState<StaffActionToastMessage | null>(null);
    const closeStaffToast = useCallback(() => setStaffToast(null), []);
    const showStaffToast = useCallback((notice: StaffActionToastMessage) => setStaffToast(notice), []);
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(true);
    const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);

    const dashboardStoreId =
        getUserValue(user, "store_id") ||
        getUserValue(user, "storeId") ||
        getSavedItem("store_id") ||
        getSavedItem("stocknbook_store_id");
    const dashboardBranchId = getAssignedBranchId(user);
    const dashboardBranchName = getAssignedBranchName(user);
    const loadInFlightRef = useRef(false);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentDateTime(new Date());
        }, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const loadStaffDashboard = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const token = getSavedItem("token");
        const storeId = dashboardStoreId;
        const branchId = dashboardBranchId;
        const assignedBranchName = dashboardBranchName;

        if (!token || !branchId) {
            setBookings([]);
            setOrders([]);
            setProducts([]);
            setEmployeeActions([]);
            setEmployeeActionsLoaded(false);
            setBookingsError("No assigned branch was found for this account.");
            setIsRefreshing(false);
            setHasLoadedDashboard(true);
            return;
        }

        // In development, React Strict Mode runs effects twice. Without this
        // guard that creates two simultaneous bookings/products/POS/report loads.
        if (loadInFlightRef.current) return;
        loadInFlightRef.current = true;

        if (!silent) setIsRefreshing(true);
        setBookingsError("");

        const now = new Date();
        const today = formatLocalIsoDate(now);
        const reportQuery = new URLSearchParams({
            branch: assignedBranchName,
            month: today.slice(0, 7),
            startDate: today,
            endDate: today,
            role: "staff",
            assignedBranch: assignedBranchName,
            branch_id: String(branchId),
            scope: "employee_actions",
        });

        // Employee actions are useful, but they are not required for the first
        // dashboard paint. Start that request now and finish it in the background.
        const reportsPromise = fetchStaffDashboardRead(`/api/reports?${reportQuery.toString()}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
        });

        void reportsPromise
            .then(async (reportsRes) => {
                const reportsData = await reportsRes.json().catch(() => ({}));
                const reportPayload =
                    reportsData?.data && typeof reportsData.data === "object"
                        ? reportsData.data
                        : {};
                const rawEmployeeActions =
                    reportPayload.employeeActions ?? reportPayload.employee_actions;

                if (
                    reportsRes.ok &&
                    reportsData?.success !== false &&
                    Array.isArray(rawEmployeeActions)
                ) {
                    setEmployeeActions(
                        rawEmployeeActions.map(normalizeStaffEmployeeAction),
                    );
                    setEmployeeActionsLoaded(true);
                } else {
                    console.warn(
                        "Staff dashboard employee actions were not available from Reports API.",
                        { status: reportsRes.status, response: reportsData },
                    );
                }
            })
            .catch((error) => {
                console.warn("Staff dashboard employee actions fetch failed:", error);
            });

        try {
            // These requests used to run one-by-one. Run them together so total
            // wait time is approximately the slowest request, not their sum.
            const [bookingsResult, productsResult, ordersResult] =
                await Promise.allSettled([
                    fetchStaffDashboardRead("/api/bookings", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_booking_page_bookings",
                            role: "staff",
                            store_id: storeId ? Number(storeId) : undefined,
                            branch_id: Number(branchId),
                            date_from: today,
                            date_to: today,
                        }),
                        cache: "no-store",
                    }),
                    fetchStaffDashboardRead("/api/products", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_products",
                            branch_id: Number(branchId),
                        }),
                        cache: "no-store",
                    }),
                    fetchStaffDashboardRead("/api/pos", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_orders",
                            branch_id: Number(branchId),
                            include_order_items: true,
                            // Staff dashboard calculations only use today's POS
                            // transactions, so do not download the entire order history.
                            date_from: today,
                            date_to: today,
                        }),
                        cache: "no-store",
                    }),
                ]);

            if (bookingsResult.status === "fulfilled") {
                try {
                    const bookingsRes = bookingsResult.value;
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
                        console.error("Staff dashboard bookings request failed:", {
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
                    console.error("Staff dashboard bookings parsing failed:", error);
                    setBookings([]);
                    setBookingsError("Unable to load booking data.");
                }
            } else {
                console.error("Staff dashboard bookings fetch failed:", bookingsResult.reason);
                if (!silent) setBookingsError("Unable to load booking data. Check your network and try Refresh.");
            }

            if (productsResult.status === "fulfilled") {
                try {
                    const productsRes = productsResult.value;
                    const productsData = await productsRes.json().catch(() => ({}));
                    if (productsRes.ok && Array.isArray(productsData.products)) {
                        const normalizedProducts: Product[] =
                            (productsData.products as unknown[]).map(normalizeProduct);
                        setProducts(
                            normalizedProducts.filter((product) => {
                                const productBranchId = product.branchId ?? product.branch_id;
                                return (
                                    productBranchId === null ||
                                    productBranchId === undefined ||
                                    String(productBranchId) === String(branchId)
                                );
                            }),
                        );
                    }
                } catch (error) {
                    console.warn("Staff dashboard products parsing failed:", error);
                }
            } else {
                console.warn("Staff dashboard products fetch failed:", productsResult.reason);
            }

            if (ordersResult.status === "fulfilled") {
                try {
                    const ordersRes = ordersResult.value;
                    const ordersData = await ordersRes.json().catch(() => ({}));
                    if (ordersRes.ok && Array.isArray(ordersData.orders)) {
                        const normalizedOrders: Order[] =
                            (ordersData.orders as unknown[]).map(normalizeOrder);
                        setOrders(
                            normalizedOrders.filter((order) =>
                                belongsToAssignedBranch(order, branchId),
                            ),
                        );
                    }
                } catch (error) {
                    console.warn("Staff dashboard orders parsing failed:", error);
                }
            } else {
                console.warn("Staff dashboard orders fetch failed:", ordersResult.reason);
            }

            // Primary dashboard data is ready. Do not keep the whole page blank
            // while the secondary employee-actions request finishes.
            setHasLoadedDashboard(true);
            if (!silent) setIsRefreshing(false);

        } finally {
            loadInFlightRef.current = false;
            // Covers early parsing errors before the normal primary-ready path.
            if (!silent) setIsRefreshing(false);
            setHasLoadedDashboard(true);
        }
    }, [dashboardStoreId, dashboardBranchId, dashboardBranchName]);

    useEffect(() => {
        void loadStaffDashboard();
    }, [loadStaffDashboard]);

    useEffect(() => {
        /*
         * Near-real-time Staff dashboard synchronization.
         * Re-fetch current branch data every 60 seconds without showing
         * the manual Refresh spinner.
         */
        const autoRefreshTimer = window.setInterval(() => {
            // Reduce unnecessary POST traffic and errors from browser security
            // wrappers while the page is in the background or offline.
            if (document.visibilityState !== "visible" || !navigator.onLine) return;
            void loadStaffDashboard({ silent: true });
        }, 60_000);

        return () => window.clearInterval(autoRefreshTimer);
    }, [loadStaffDashboard]);

    const allInventoryAlerts = useMemo(
        () => getDashboardStockAlertItems(products),
        [products],
    );

    const allExpirationAlertItems = useMemo(
        () => getExpirationAlertItems(products),
        [products],
    );

    const dashboardBranchLabel =
        dashboardBranchName;

    const bookingPermissionValue = getDashboardPermissionValue(user, [
        "booking_access",
        "bookings_access",
        "booking_view",
        "bookings_view",
        "booking_read",
        "bookings_read",
        "booking_manage",
        "bookings_manage",
        "booking_write",
        "bookings_write",
        "manage_bookings",
        "booking",
        "bookings",
    ]);
    const posPermissionValue = getDashboardPermissionValue(user, [
        "pos_access",
        "sales_pos_access",
        "pos_view",
        "pos_read",
        "pos_manage",
        "pos_write",
        "manage_pos",
        "sales_pos",
        "sales",
        "pos",
    ]);
    const inventoryPermissionValue = getDashboardPermissionValue(user, [
        "inventory_access",
        "inventory_view",
        "inventory_read",
        "inventory_manage",
        "inventory_write",
        "manage_inventory",
        "inventory",
    ]);

    /*
     * Bookings are part of the Staff sidebar in the current role design, so
     * preserve booking access when no granular booking permission is stored.
     * POS is hidden by default unless the account explicitly has POS access,
     * matching the Staff sidebar behavior shown in the current application.
     */
    const canAccessBookings =
        bookingPermissionValue === undefined
            ? true
            : dashboardPermissionAllowsRead(bookingPermissionValue);
    const canManageBookings =
        bookingPermissionValue === undefined
            ? true
            : dashboardPermissionAllowsWrite(bookingPermissionValue);
    const canAccessPos =
        posPermissionValue === undefined
            ? false
            : dashboardPermissionAllowsRead(posPermissionValue);
    const canManagePos =
        posPermissionValue === undefined
            ? false
            : dashboardPermissionAllowsWrite(posPermissionValue);
    const hasInventoryRestockPermission =
        hasDashboardInventoryRestockPermission(user);
    const canAccessInventory =
        inventoryPermissionValue === undefined
            ? true
            : dashboardPermissionAllowsRead(inventoryPermissionValue);
    const canOpenInventory =
        canAccessInventory || hasInventoryRestockPermission;

    const todayLabel = currentDateTime.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const todayBookings = useMemo(() => {
        return bookings
            .filter((booking) => {
                const status = normalizeDashboardBookingStatus(booking.status).toLowerCase();
                if (status === "cancelled" || status === "canceled") return false;

                const at = parseOperationalDateTime(booking.date, booking.time);
                return isSameOperationalDay(at, currentDateTime);
            })
            .sort((first, second) => {
                const firstAt = parseOperationalDateTime(first.date, first.time)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                const secondAt = parseOperationalDateTime(second.date, second.time)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                return firstAt - secondAt;
            });
    }, [bookings, currentDateTime]);

    const bookingsToPrepare = useMemo(
        () => todayBookings.filter(bookingNeedsPreparation),
        [todayBookings],
    );

    const todayPosTransactions = useMemo(() => {
        return orders
            .filter(isSuccessfulPosTransaction)
            .filter((order) => {
                const at = parseOperationalDateTime(
                    order.date || order.orderDate || order.createdAt,
                    order.time,
                );
                return isSameOperationalDay(at, currentDateTime);
            })
            .sort((first, second) => {
                const firstAt = parseOperationalDateTime(
                    first.date || first.orderDate || first.createdAt,
                    first.time,
                )?.getTime() ?? 0;
                const secondAt = parseOperationalDateTime(
                    second.date || second.orderDate || second.createdAt,
                    second.time,
                )?.getTime() ?? 0;
                return firstAt - secondAt;
            });
    }, [orders, currentDateTime]);

    const bookingTaskRows = useMemo<StaffTaskRow[]>(() => {
        return todayBookings.map((booking) => {
            const status = normalizeDashboardBookingStatus(booking.status);
            const normalized = status.toLowerCase();
            const reference = compactDashboardReference(
                "BK",
                booking.bookingNumber,
                booking.id,
            );
            const at = parseOperationalDateTime(booking.date, booking.time);

            if (normalized === "completed") {
                return {
                    id: `booking-completed-${booking.id}`,
                    task: `Complete ${reference}`,
                    relatedTo: reference,
                    priority: getStaffTaskPriority(at, currentDateTime),
                    status: "Completed",
                    dueAt: at,
                    displayStatus: status,
                    bookingId: booking.id,
                };
            }

            let task = `Review ${reference}`;
            if (normalized === "pending" || normalized.includes("awaiting")) {
                task = `Confirm ${reference}`;
            } else if (bookingNeedsPreparation(booking)) {
                task = `Prepare ${reference}`;
            } else if (normalized.includes("ready") || normalized.includes("prepared")) {
                task = `Release ${reference}`;
            }

            return {
                id: `booking-${booking.id}`,
                task,
                relatedTo: reference,
                priority: getStaffTaskPriority(at, currentDateTime),
                status: "Pending",
                dueAt: at,
                displayStatus: status,
                bookingId: booking.id,
            };
        });
    }, [todayBookings, currentDateTime]);

    const inventoryTaskRows = useMemo<StaffTaskRow[]>(() => {
        const stockTasks = allInventoryAlerts.map((item) => ({
            id: `stock-${item.id}`,
            productId: item.productId,
            variantId: item.variantId,
            task: `Verify stock: ${item.productName}`,
            relatedTo: "Inventory",
            priority: (item.status === "Out of Stock" ? "High" : "Medium") as StaffTaskPriority,
            status: "Pending" as const,
            displayStatus: item.status,
        }));

        const expiryTasks = allExpirationAlertItems
            .filter((item) => item.status === "Expired" || item.daysRemaining <= 7)
            .map((item) => ({
                id: `expiry-${item.id}`,
                productId: item.productId,
                variantId: item.variantId,
                expirationAlertId: item.id,
                task: `Review expiry: ${item.productName}`,
                relatedTo: "Inventory",
                priority: (item.status === "Expired" || item.daysRemaining <= 2 ? "High" : "Medium") as StaffTaskPriority,
                status: "Pending" as const,
                displayStatus: item.status === "Expired" ? "Expired" : "Expiring Soon",
            }));

        return [...stockTasks, ...expiryTasks];
    }, [allInventoryAlerts, allExpirationAlertItems]);

    const allStaffTasks = useMemo(() => {
        return [...bookingTaskRows, ...inventoryTaskRows].filter((task) => {
            const isInventoryTask =
                task.relatedTo.trim().toLowerCase() === "inventory";

            if (isInventoryTask) {
                return canOpenInventory;
            }

            const needsBookingManagePermission =
                /^(Confirm|Prepare|Release)\b/i.test(task.task);

            if (needsBookingManagePermission) {
                return canManageBookings;
            }

            return canAccessBookings;
        });
    }, [
        bookingTaskRows,
        inventoryTaskRows,
        canOpenInventory,
        canAccessBookings,
        canManageBookings,
    ]);

    const pendingStaffTasks = useMemo(() => {
        const priorityRank: Record<StaffTaskPriority, number> = {
            High: 0,
            Medium: 1,
            Low: 2,
        };

        const severityRank = (task: StaffTaskRow) => {
            const status = String(task.displayStatus || "")
                .trim()
                .toLowerCase();

            if (
                status.includes("out of stock") ||
                status === "expired"
            ) {
                return 0;
            }

            if (status.includes("expiring")) {
                return 1;
            }

            if (status.includes("low stock")) {
                return 2;
            }

            return 3;
        };

        return allStaffTasks
            .filter((task) => task.status === "Pending")
            .sort((first, second) => {
                const priorityDifference =
                    priorityRank[first.priority] - priorityRank[second.priority];

                if (priorityDifference !== 0) {
                    return priorityDifference;
                }

                const severityDifference =
                    severityRank(first) - severityRank(second);

                if (severityDifference !== 0) {
                    return severityDifference;
                }

                const firstDue =
                    first.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
                const secondDue =
                    second.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

                if (firstDue !== secondDue) {
                    return firstDue - secondDue;
                }

                return first.task.localeCompare(second.task);
            });
    }, [allStaffTasks]);

    const todayWorkOperations = useMemo<StaffOperationRow[]>(() => {
        const endOfToday = new Date(
            currentDateTime.getFullYear(),
            currentDateTime.getMonth(),
            currentDateTime.getDate(),
            23,
            59,
            59,
            999,
        );

        return pendingStaffTasks.map((task) => {
            const isInventoryTask =
                task.relatedTo.trim().toLowerCase() === "inventory";
            const at = task.dueAt || endOfToday;

            if (isInventoryTask) {
                const [rawTitle, ...rawDetailParts] = task.task.split(":");
                const itemDetail = rawDetailParts.join(":").trim();

                return {
                    id: `today-work-${task.id}`,
                    productId: task.productId,
                    variantId: task.variantId,
                    expirationAlertId: task.expirationAlertId,
                    at,
                    time: task.dueAt
                        ? task.dueAt.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                        })
                        : "Today",
                    title: rawTitle.trim() || "Inventory Review",
                    detail: itemDetail || "Inventory item",
                    reference: products.find((product) => product.id === task.productId)?.productNumber ||
                        products.find((product) => product.id === task.productId)?.product_number || "—",
                    status: task.displayStatus || "Pending",
                    source: "inventory",
                    priority: task.priority,
                };
            }

            const booking = todayBookings.find(
                (item) =>
                    compactDashboardReference(
                        "BK",
                        item.bookingNumber,
                        item.id,
                    ) === task.relatedTo,
            );
            const action = getCompactTaskAction(task);

            return {
                id: `today-work-${task.id}`,
                at,
                time: booking
                    ? formatDashboardTime(booking.date, booking.time) || "Today"
                    : task.dueAt
                        ? task.dueAt.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                        })
                        : "Today",
                title:
                    action === "Prepare"
                        ? "Booking Preparation"
                        : action === "Release"
                            ? "Booking Release"
                            : action === "Confirm"
                                ? "Booking Confirmation"
                                : "Booking Review",
                detail: booking
                    ? booking.eventName || booking.packageName || "Booking"
                    : "Booking",
                reference: booking
                    ? String(booking.bookingNumber || "").trim() || "—"
                    : "—",
                status:
                    task.displayStatus ||
                    (booking
                        ? normalizeDashboardBookingStatus(booking.status)
                        : "Pending"),
                source: "booking",
                bookingId: booking?.id ?? task.bookingId,
                priority: task.priority,
            };
        });
    }, [pendingStaffTasks, todayBookings, currentDateTime, products]);

    const todayOperations = useMemo<StaffOperationRow[]>(() => {
        const bookingOperations: StaffOperationRow[] = todayBookings.map((booking) => {
            const at =
                parseOperationalDateTime(booking.date, booking.time) ||
                new Date(
                    currentDateTime.getFullYear(),
                    currentDateTime.getMonth(),
                    currentDateTime.getDate(),
                    23,
                    59,
                );
            const status = normalizeDashboardBookingStatus(booking.status);
            const reference = compactDashboardReference(
                "BK",
                booking.bookingNumber,
                booking.id,
            );
            const action = getStaffBookingAction(booking);

            return {
                id: `booking-operation-${booking.id}`,
                at,
                time: formatDashboardTime(booking.date, booking.time) || "Today",
                title:
                    action === "Prepare"
                        ? "Booking Preparation"
                        : action === "Release"
                            ? "Booking Release"
                            : action === "Confirm"
                                ? "Booking Confirmation"
                                : "Booking",
                detail: `${reference}${booking.eventName || booking.packageName ? ` • ${booking.eventName || booking.packageName}` : ""}`,
                status,
                source: "booking",
                bookingId: booking.id,
            };
        });

        const posOperations: StaffOperationRow[] = todayPosTransactions.map((order, index) => {
            const at =
                parseOperationalDateTime(
                    order.date || order.orderDate || order.createdAt,
                    order.time,
                ) || currentDateTime;
            const reference = compactDashboardReference(
                "SO",
                order.orderNumber,
                order.orderId || order.id || index + 1,
            );

            return {
                id: `pos-operation-${order.orderId || order.id || index}`,
                at,
                time:
                    formatDashboardTime(
                        order.date || order.orderDate || order.createdAt,
                        order.time,
                    ) || "Today",
                title: "POS Transaction",
                detail: `${reference}${Number(order.total || 0) > 0 ? ` • ${peso(order.total || 0)}` : ""}`,
                status: "Completed",
                source: "pos",
            };
        });

        const sorted = [...bookingOperations, ...posOperations].sort(
            (first, second) => first.at.getTime() - second.at.getTime(),
        );

        if (sorted.length <= 5) return sorted;

        const firstUpcomingIndex = sorted.findIndex(
            (operation) => operation.at.getTime() >= currentDateTime.getTime(),
        );

        const startIndex =
            firstUpcomingIndex < 0
                ? Math.max(0, sorted.length - 5)
                : Math.max(0, Math.min(firstUpcomingIndex - 2, sorted.length - 5));

        return sorted.slice(startIndex, startIndex + 5);
    }, [todayBookings, todayPosTransactions, currentDateTime]);

    const completedTaskCount = allStaffTasks.filter(
        (task) => task.status === "Completed",
    ).length;
    const taskCompletionPct = clampPercentage(
        allStaffTasks.length > 0
            ? (completedTaskCount / allStaffTasks.length) * 100
            : 0,
    );

    const preparationRelevantBookings = todayBookings.filter(
        (booking) =>
            bookingNeedsPreparation(booking) || bookingPreparationIsDone(booking),
    );
    const preparedBookingCount = preparationRelevantBookings.filter(
        bookingPreparationIsDone,
    ).length;
    const preparationProgressPct = clampPercentage(
        preparationRelevantBookings.length > 0
            ? (preparedBookingCount / preparationRelevantBookings.length) * 100
            : 0,
    );

    const completedBookingCount = todayBookings.filter(
        (booking) =>
            normalizeDashboardBookingStatus(booking.status).toLowerCase() ===
            "completed",
    ).length;
    const bookingCompletionPct = clampPercentage(
        todayBookings.length > 0
            ? (completedBookingCount / todayBookings.length) * 100
            : 0,
    );

    const nextBooking = todayBookings
        .map((booking) => ({
            booking,
            at: parseOperationalDateTime(booking.date, booking.time),
        }))
        .filter(
            (entry) =>
                entry.at &&
                entry.at.getTime() >= currentDateTime.getTime() &&
                normalizeDashboardBookingStatus(entry.booking.status).toLowerCase() !==
                "completed",
        )
        .sort(
            (first, second) =>
                (first.at?.getTime() || 0) - (second.at?.getTime() || 0),
        )[0];

    const nextBookingReference = nextBooking
        ? compactDashboardReference(
            "BK",
            nextBooking.booking.bookingNumber,
            nextBooking.booking.id,
        )
        : "";

    const staffDisplayName =
        getUserValue(user, "name") ||
        getUserValue(user, "full_name") ||
        getUserValue(user, "fullName") ||
        getUserValue(user, "first_name") ||
        getUserValue(user, "firstName");
    const staffFirstName = staffDisplayName.trim().split(/\s+/)[0] || "there";
    const greeting =
        currentDateTime.getHours() < 12
            ? "Good morning"
            : currentDateTime.getHours() < 18
                ? "Good afternoon"
                : "Good evening";

    const loggedRecentActivityOperations = useMemo<StaffOperationRow[]>(() => {
        const currentStaffName = normalizeActivityIdentity(staffDisplayName);
        const assignedBranchId = String(getAssignedBranchId(user) || "");
        const assignedBranchName = normalizeActivityIdentity(
            getAssignedBranchName(user),
        );

        return employeeActions
            .filter((item) => {
                const at = parseOperationalDateTime(item.date, item.time);
                if (!isSameOperationalDay(at, currentDateTime)) return false;
                if (at && at.getTime() > currentDateTime.getTime()) return false;

                const itemBranchId = String(item.branchId ?? "");
                if (
                    assignedBranchId &&
                    itemBranchId &&
                    itemBranchId !== assignedBranchId
                ) {
                    return false;
                }

                const itemBranchName = normalizeActivityIdentity(item.branch || "");
                if (
                    !itemBranchId &&
                    itemBranchName &&
                    assignedBranchName &&
                    itemBranchName !== assignedBranchName
                ) {
                    return false;
                }

                // A Staff dashboard should primarily show the activity of the
                // logged-in Staff member, not another employee in the branch.
                const employeeName = normalizeActivityIdentity(item.employeeName);
                if (
                    currentStaffName &&
                    employeeName &&
                    employeeName !== currentStaffName
                ) {
                    return false;
                }

                return true;
            })
            .map((item) => {
                const at =
                    parseOperationalDateTime(item.date, item.time) ||
                    currentDateTime;
                const reference =
                    item.referenceNumber ||
                    item.referenceId ||
                    "";
                const detailParts = [reference, item.details]
                    .map((value) => String(value || "").trim())
                    .filter(Boolean);

                return {
                    id: `employee-action-${item.id}`,
                    at,
                    time:
                        formatDashboardTime(item.date, item.time) ||
                        at.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                        }),
                    title: item.action || "Recorded action",
                    detail:
                        detailParts.join(" • ") ||
                        item.module ||
                        "Activity recorded",
                    status: "Completed",
                    source: getEmployeeActionSource(item.module),
                };
            })
            .sort((first, second) => second.at.getTime() - first.at.getTime());
    }, [employeeActions, currentDateTime, staffDisplayName, user]);

    const inferredRecentActivityOperations = [...todayOperations]
        .filter((operation) => operation.at.getTime() <= currentDateTime.getTime())
        .filter((operation) => {
            const normalizedStatus = String(operation.status || "")
                .trim()
                .toLowerCase();

            return normalizedStatus === "completed";
        })
        .sort((first, second) => second.at.getTime() - first.at.getTime());

    const recentActivityOperations = employeeActionsLoaded
        ? loggedRecentActivityOperations
        : inferredRecentActivityOperations;

    const todayWorkAttentionCount = pendingStaffTasks.length;

    const openBookingDetails = (bookingId: number) => {
        const booking = bookings.find((item) => item.id === bookingId);
        if (booking) {
            setSelectedBookingDetails(booking);
        }
    };

    const openExpiryReview = useCallback((alertId: string) => {
        const selected = allExpirationAlertItems.find(item => item.id === alertId);
        if (selected) setExpiryReview(selected);
        else showStaffToast({ title: "Stock record unavailable", message: "Refresh the dashboard to load the latest expiration status.", tone: "error" });
    }, [allExpirationAlertItems, showStaffToast]);

    const startStaffRestock = useCallback((productId: number, variantId?: number | null) => {
        if (!hasInventoryRestockPermission) {
            showStaffToast({ title: "Inventory access required", message: "Your manager must assign Inventory access before you can restock.", tone: "error" });
            return;
        }
        const product = products.find(entry => entry.id === productId);
        if (!product) {
            showStaffToast({ title: "Product unavailable", message: "Refresh the dashboard and try again.", tone: "error" });
            return;
        }
        // Use the same Receive Stock dialog as Manager Inventory. The backend
        // verifies the staff member's assigned Inventory access and branch.
        setDirectRestock({ product, variantId: variantId ?? null });
    }, [hasInventoryRestockPermission, products, showStaffToast]);

    // The dashboard uses the same cream / plum palette and compact card styling
    // as Manager Inventory. All operational actions retain their existing routes.
    const storeDisplayName =
        getUserValue(user, "store_name") ||
        getUserValue(user, "storeName") ||
        getSavedItem("store_name") ||
        getSavedItem("stocknbook_store_name") ||
        "Store not provided";
    const staffEmployeeNumber =
        getUserValue(user, "staff_number") ||
        getUserValue(user, "staffNumber") ||
        getUserValue(user, "employee_number") ||
        getUserValue(user, "employeeNumber") ||
        getSavedItem("staff_number") ||
        "Not provided";
    const confirmedForAllocation = canManageBookings
        ? todayBookings.filter((booking) =>
            normalizeDashboardBookingStatus(booking.status).toLowerCase() === "confirmed",
        ).length
        : null;
    const needsReview = canManageBookings
        ? todayBookings.filter((booking) => {
            const value = normalizeDashboardBookingStatus(booking.status).toLowerCase();
            return value.includes("pending") || value.includes("awaiting");
        }).length
        : null;
    const showInventoryAlerts = canOpenInventory ? allInventoryAlerts.length : null;

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E1EE] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[85px] flex-wrap items-center justify-between gap-3 px-5 py-3 lg:px-6">
                    <div className="min-w-0">
                        <h1 className="text-[25px] font-bold tracking-tight text-[#21132E]">Staff Dashboard</h1>
                        <p className="mt-0.5 text-xs text-[#86778F]">{greeting}, {staffFirstName}. Work requiring attention in your branch, based on your access.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] shadow-sm">
                            <CalendarDays size={15}/>{formatCurrentDashboardDateTime(currentDateTime)}
                        </span>
                        <button type="button" onClick={() => void loadStaffDashboard()} disabled={isRefreshing}
                                title="Refresh dashboard" aria-label="Refresh dashboard"
                                className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#2B174C] px-3 text-xs font-semibold text-white hover:bg-[#432764] disabled:opacity-50">
                            <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""}/> Refresh
                        </button>
                    </div>
                </div>
            </header>
            <main aria-busy={!hasLoadedDashboard} className="min-h-[calc(100vh-85px)] bg-[#FFFDF8] px-5 py-5 font-sans lg:px-6">
                {!hasLoadedDashboard ? <StaffDashboardSkeleton /> : (
                    <div className="mx-auto space-y-4">
                        {bookingsError && <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] p-3 text-xs text-[#B42318]">{bookingsError}</p>}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <SalesSummaryCard title="Products to Allocate" value={confirmedForAllocation === null ? "—" : String(confirmedForAllocation)} subtitle={confirmedForAllocation === null ? "Booking access not granted" : "Confirmed bookings needing preparation"} icon={<Package size={23}/>} tone="violet"/>
                            <SalesSummaryCard title="Stock Alerts" value={showInventoryAlerts === null ? "—" : String(showInventoryAlerts)} subtitle={showInventoryAlerts === null ? "Inventory access not granted" : "Low and out-of-stock items"} icon={<AlertTriangle size={23}/>} tone="red"/>
                            <SalesSummaryCard title="Rental Inspections" value="—" subtitle="Connect assigned return inspections" icon={<Search size={23}/>} tone="blue"/>
                            <SalesSummaryCard title="Bookings to Review" value={needsReview === null ? "—" : String(needsReview)} subtitle={needsReview === null ? "Booking access not granted" : "Pending booking requirements"} icon={<CalendarCheck size={23}/>} tone="green"/>
                        </div>
                        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                            <StaffWorkTable
                                operations={todayWorkOperations}
                                canAccessBookings={canAccessBookings}
                                canManageBookings={canManageBookings}
                                canOpenInventory={canOpenInventory}
                                canRestockInventory={hasInventoryRestockPermission}
                                onViewBooking={openBookingDetails}
                                onOpenBooking={() => router.push("/bookings")}
                                onOpenInventory={() => router.push("/inventory")}
                                onRestock={startStaffRestock}
                                onReviewExpiry={openExpiryReview}
                            />
                            <StaffAttendancePanel
                                storeName={storeDisplayName}
                                branchName={dashboardBranchName}
                                staffName={staffDisplayName || "Staff member"}
                                employeeNumber={staffEmployeeNumber}
                                currentDateTime={currentDateTime}
                                onNotify={showStaffToast}
                            />
                        </div>
                    </div>
                )}
            </main>
            <StaffActionToast toast={staffToast} onClose={closeStaffToast} />
            {expiryReview && (() => {
                const product = products.find(entry => entry.id === expiryReview.productId);
                return product ? <StaffExpiredStockReviewDialog
                    alert={expiryReview} product={product} onClose={() => setExpiryReview(null)}
                    onNotify={showStaffToast} /> : null;
            })()}
            {directRestock && <StaffReceiveStockDialog
                product={directRestock.product}
                onClose={() => setDirectRestock(null)}
                onSaved={async quantity => {
                    const name = directRestock.product.name;
                    setDirectRestock(null);
                    showStaffToast({ title: "Stock restocked successfully", message: `“${name}” received +${quantity.toLocaleString("en-PH")} units in inventory.` });
                    await loadStaffDashboard({ silent: true });
                    window.dispatchEvent(new Event("stocknbook:stock-activity-refresh"));
                }} />}
            {authorizedReceipt && <StaffAuthorizedReceiptDialog
                product={authorizedReceipt.product} task={authorizedReceipt.task}
                onClose={() => setAuthorizedReceipt(null)}
                onSaved={async quantity => {
                    const name = authorizedReceipt.product.name;
                    setAuthorizedReceipt(null);
                    showStaffToast({ title: "Stock restocked successfully", message: `“${name}” received +${quantity.toLocaleString("en-PH")} units in inventory.` });
                    await loadStaffDashboard({ silent: true });
                    window.dispatchEvent(new Event("stocknbook:stock-activity-refresh"));
                }} />}
            {selectedBookingDetails && <StaffBookingDetailsModal booking={selectedBookingDetails} onClose={() => setSelectedBookingDetails(null)} />}
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
        <div className="flex min-h-[116px] items-center gap-4 rounded-[16px] bg-white px-5 py-4 shadow-sm">
      <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${style.background} ${style.icon}`}
      >
        {icon}
      </span>
            <div className="min-w-0">
                <p className="text-[12px] font-semibold leading-5 text-[#4B3E55]">
                    {title}
                </p>
                <p className="mt-1 truncate text-[25px] font-bold leading-none tracking-tight text-[#21132E]">
                    {value}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-[#86778F]">{subtitle}</p>
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
        <div className="flex min-h-[124px] items-center gap-3 rounded-[16px] bg-white px-4 py-5 shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
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



type StaffBookingSchedulePanelProps = {
    bookings: Booking[];
    onViewAll: () => void;
};

function StaffBookingSchedulePanel({
                                       bookings,
                                       onViewAll,
                                   }: StaffBookingSchedulePanelProps) {
    const visible = bookings.slice(0, 5);

    return (
        <section className="flex h-full min-h-[344px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
            <div className="flex min-h-[62px] items-center justify-between gap-3 border-b border-[#EEE8F2] px-4 py-2.5">
                <div className="flex min-w-0 items-start gap-2 text-[#6D35D4]">
                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center">
                        <CalendarDays size={18} />
                    </span>
                    <div className="min-w-0">
                        <h2 className="truncate text-[15px] font-bold leading-5 text-[#1A1220]">
                            Today&apos;s Booking Schedule
                        </h2>
                        <p className="truncate text-[9px] leading-5 text-[#8A7D92]">
                            Bookings scheduled for today
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onViewAll}
                    className="shrink-0 rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4]"
                >
                    View all
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-x-auto">
                <table className="w-full min-w-[690px] table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[14%]" />
                        <col className="w-[19%]" />
                        <col className="w-[29%]" />
                        <col className="w-[20%]" />
                        <col className="w-[18%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[42px] border-b border-[#EEE8F2]">
                        {["Time", "Booking #", "Customer / Event", "Status", "Next Action"].map((header) => (
                            <th
                                key={header}
                                className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.04em] text-[#806A8C]"
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {visible.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="px-4 py-12 text-center text-[12px] text-[#8A7D92]">
                                No bookings scheduled for today.
                            </td>
                        </tr>
                    ) : (
                        visible.map((booking) => {
                            const reference = compactDashboardReference(
                                "BK",
                                booking.bookingNumber,
                                booking.id,
                            );
                            const status = normalizeDashboardBookingStatus(booking.status);
                            const action = getStaffBookingAction(booking);

                            return (
                                <tr key={booking.id} className="border-b border-[#F1ECF4] last:border-b-0">
                                    <td className="px-3 py-3 text-[11px] font-semibold text-[#2B174C]">
                                        {formatDashboardTime(booking.date, booking.time) || "—"}
                                    </td>
                                    <td className="px-3 py-3 text-[11px] font-bold text-[#24152F]">
                                        {reference}
                                    </td>
                                    <td className="px-3 py-3">
                                        <p className="truncate text-[11px] font-semibold text-[#24152F]" title={booking.name}>
                                            {booking.name}
                                        </p>
                                        <p className="truncate text-[9px] text-[#8A7D92]" title={booking.eventName || booking.packageName || ""}>
                                            {booking.eventName || booking.packageName || "Booking"}
                                        </p>
                                    </td>
                                    <td className="px-3 py-3">
                                        <StaffStatusBadge status={status} />
                                    </td>
                                    <td className="px-3 py-3">
                                        <span className="inline-flex min-w-[68px] justify-center rounded-lg bg-[#F1EBFF] px-2.5 py-1.5 text-[10px] font-semibold text-[#6D35D4]">
                                            {action}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>

            <div className="border-t border-[#EEE8F2] px-4 py-1.5 text-center text-[9px] font-medium text-[#8A7D92]">
                Showing {visible.length} of {bookings.length} booking{bookings.length === 1 ? "" : "s"}
            </div>
        </section>
    );
}

function StaffStatusBadge({ status }: { status: string }) {
    const normalized = status.toLowerCase();

    let className = "bg-[#FFF4D8] text-[#8A5A00]";
    if (
        normalized.includes("out of stock") ||
        normalized === "expired"
    ) {
        className = "bg-[#FFE5E5] text-[#9A2424]";
    } else if (
        normalized.includes("low stock") ||
        normalized.includes("expiring")
    ) {
        className = "bg-[#FFF4D8] text-[#8A5A00]";
    } else if (normalized.includes("complete") || normalized.includes("ready")) {
        className = "bg-[#E6F6EA] text-[#226B36]";
    } else if (normalized.includes("confirm") || normalized.includes("prepar")) {
        className = "bg-[#EAF1FF] text-[#2563EB]";
    } else if (normalized.includes("cancel")) {
        className = "bg-[#FFE5E5] text-[#9A2424]";
    }

    return (
        <span className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-[10px] font-semibold ${className}`}>
            <span className="truncate">{status}</span>
        </span>
    );
}

function StaffOperationsPanel({ operations }: { operations: StaffOperationRow[] }) {
    return (
        <section className="flex h-full min-h-[344px] flex-col rounded-[14px] bg-white shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
            <div className="flex min-h-[62px] items-center gap-2 border-b border-[#EEE8F2] px-4 py-2.5 text-[#6D35D4]">
                <span className="flex h-6 w-6 items-center justify-center">
                    <Activity size={18} />
                </span>
                <div className="min-w-0">
                    <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">
                        Today&apos;s Operations
                    </h2>
                    <p className="truncate text-[9px] leading-5 text-[#8A7D92]">
                        Recent activity and upcoming schedule
                    </p>
                </div>
            </div>

            <div className="min-h-0 flex-1 px-4 py-3">
                {operations.length === 0 ? (
                    <div className="flex h-full min-h-[220px] items-center justify-center text-center text-[12px] text-[#8A7D92]">
                        No operational activity recorded for today yet.
                    </div>
                ) : (
                    <div className="relative h-full">
                        <span className="absolute bottom-3 left-[7px] top-3 w-px bg-[#E9E0EF]" aria-hidden />
                        <div className="space-y-3">
                            {operations.map((operation) => {
                                const completed = operation.status.toLowerCase().includes("complete");
                                const pending =
                                    operation.status.toLowerCase().includes("pending") ||
                                    operation.status.toLowerCase().includes("awaiting");
                                const dotClass = completed
                                    ? "border-[#159455] bg-[#E6F7EE]"
                                    : pending
                                        ? "border-[#E66B20] bg-[#FFF0E5]"
                                        : "border-[#6D35D4] bg-[#F1EBFF]";

                                return (
                                    <div key={operation.id} className="relative grid grid-cols-[20px_58px_minmax(0,1fr)_auto] items-start gap-2">
                                        <span className={`relative z-10 mt-1 h-3.5 w-3.5 rounded-full border-[3px] ${dotClass}`} />
                                        <span className="pt-0.5 text-[10px] font-semibold text-[#5F4E75]">
                                            {operation.time}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="truncate text-[11px] font-semibold text-[#1A1220]">
                                                {operation.title}
                                            </p>
                                            <p className="truncate text-[9px] text-[#8A7D92]" title={operation.detail}>
                                                {operation.detail}
                                            </p>
                                        </div>
                                        <StaffStatusBadge status={operation.status} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <div className="border-t border-[#EEE8F2] px-4 py-1.5 text-center text-[9px] font-medium text-[#8A7D92]">
                Showing activity closest to the current time
            </div>
        </section>
    );
}

function StaffEfficiencyPanel({
                                  taskCompleted,
                                  taskTotal,
                                  taskPercent,
                                  preparationCompleted,
                                  preparationTotal,
                                  preparationPercent,
                                  bookingCompleted,
                                  bookingTotal,
                                  bookingPercent,
                                  transactionsProcessed,
                                  nextBookingTime,
                                  nextBookingReference,
                                  nextBookingCountdown,
                              }: {
    taskCompleted: number;
    taskTotal: number;
    taskPercent: number;
    preparationCompleted: number;
    preparationTotal: number;
    preparationPercent: number;
    bookingCompleted: number;
    bookingTotal: number;
    bookingPercent: number;
    transactionsProcessed: number;
    nextBookingTime: string;
    nextBookingReference: string;
    nextBookingCountdown: string;
}) {
    return (
        <section className="flex h-[344px] max-h-[344px] min-h-[344px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-[#EEE8F2] px-5 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                    <BarChart3 size={17} />
                </span>
                <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-bold text-[#1A1220]">
                        Today&apos;s Efficiency
                    </h2>
                    <p className="mt-1 truncate text-[11px] text-[#9A8DA8]">
                        Progress for today&apos;s operations.
                    </p>
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-2.5">
                <StaffProgressMetric
                    label="Task Completion"
                    valueLabel={`${taskCompleted} of ${taskTotal}`}
                    percent={taskPercent}
                    tone="green"
                />
                <StaffProgressMetric
                    label="Booking Preparation"
                    valueLabel={`${preparationCompleted} of ${preparationTotal}`}
                    percent={preparationPercent}
                    tone="blue"
                />
                <StaffProgressMetric
                    label="Booking Completion"
                    valueLabel={`${bookingCompleted} of ${bookingTotal}`}
                    percent={bookingPercent}
                    tone="violet"
                />

                <div className="flex items-center justify-between border-t border-[#F1ECF4] pt-2">
                    <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                            <ShoppingCart size={14} />
                        </span>
                        <span className="text-[10px] font-semibold text-[#4B3E55]">Transactions Processed</span>
                    </div>
                    <span className="text-[12px] font-bold text-[#24152F]">{transactionsProcessed}</span>
                </div>

                <div className="mt-auto rounded-xl bg-[#F8F5FC] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#6D35D4] shadow-sm">
                                <Clock3 size={14} />
                            </span>
                            <div>
                                <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-[#8A7D92]">
                                    Next Booking
                                </p>
                                <p className="text-[12px] font-bold text-[#6D35D4]">{nextBookingCountdown}</p>
                            </div>
                        </div>
                        {(nextBookingTime || nextBookingReference) && (
                            <div className="text-right">
                                <p className="text-[10px] font-semibold text-[#24152F]">{nextBookingTime}</p>
                                <p className="text-[9px] text-[#8A7D92]">{nextBookingReference}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div
                className="h-6 shrink-0 border-t border-[#EEE8F2] bg-[#FCFAFE]"
                aria-hidden="true"
            />
        </section>
    );
}

function StaffProgressMetric({
                                 label,
                                 valueLabel,
                                 percent,
                                 tone,
                             }: {
    label: string;
    valueLabel: string;
    percent: number;
    tone: "green" | "blue" | "violet";
}) {
    const fillClass =
        tone === "green"
            ? "bg-[#159455]"
            : tone === "blue"
                ? "bg-[#2563EB]"
                : "bg-[#6D35D4]";

    return (
        <div>
            <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold text-[#4B3E55]">{label}</span>
                <span className="text-[10px] font-bold text-[#24152F]">{valueLabel}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#F1ECF6]">
                    <div
                        className={`h-full rounded-full ${fillClass}`}
                        style={{ width: `${percent}%` }}
                    />
                </div>
                <span className="w-8 text-right text-[9px] font-semibold text-[#5F4E75]">
                    {Math.round(percent)}%
                </span>
            </div>
        </div>
    );
}

function StaffPendingTasksPanel({
                                    tasks,
                                    total,
                                }: {
    tasks: StaffTaskRow[];
    total: number;
}) {
    return (
        <section className="flex min-h-[290px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
            <div className="flex min-h-[62px] items-center gap-2 border-b border-[#EEE8F2] px-4 py-2.5 text-[#6D35D4]">
                <span className="flex h-6 w-6 items-center justify-center">
                    <ListChecks size={18} />
                </span>
                <div className="min-w-0">
                    <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">
                        Pending Task List
                    </h2>
                    <p className="truncate text-[9px] leading-5 text-[#8A7D92]">
                        Actions generated from today&apos;s bookings and stock checks
                    </p>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-x-auto">
                <table className="w-full min-w-[650px] table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[48%]" />
                        <col className="w-[20%]" />
                        <col className="w-[16%]" />
                        <col className="w-[16%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[40px] border-b border-[#EEE8F2]">
                        {["Task", "Related To", "Priority", "Status"].map((header) => (
                            <th key={header} className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.04em] text-[#806A8C]">
                                {header}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {tasks.length === 0 ? (
                        <tr>
                            <td colSpan={4} className="px-4 py-10 text-center text-[12px] text-[#8A7D92]">
                                No pending operational tasks right now.
                            </td>
                        </tr>
                    ) : (
                        tasks.map((task) => (
                            <tr key={task.id} className="border-b border-[#F1ECF4] last:border-b-0">
                                <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] border border-[#D9CDE7] bg-white" aria-hidden />
                                        <span className="truncate text-[11px] font-medium text-[#24152F]" title={task.task}>
                                            {task.task}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-3 py-2.5 text-[10px] font-medium text-[#5F4E75]">{task.relatedTo}</td>
                                <td className="px-3 py-2.5">
                                    <StaffPriorityBadge priority={task.priority} />
                                </td>
                                <td className="px-3 py-2.5">
                                    <span className="inline-flex rounded-full bg-[#FFF4D9] px-2.5 py-1 text-[9px] font-semibold text-[#A96700]">
                                        Pending
                                    </span>
                                </td>
                            </tr>
                        ))
                    )}
                    </tbody>
                </table>
            </div>

            <div className="border-t border-[#EEE8F2] px-4 py-1.5 text-center text-[9px] font-medium text-[#8A7D92]">
                Showing {tasks.length} of {total} pending task{total === 1 ? "" : "s"}
            </div>
        </section>
    );
}

function StaffPriorityBadge({ priority }: { priority: StaffTaskPriority }) {
    const className =
        priority === "High"
            ? "bg-[#FDECEC] text-[#DC2626]"
            : priority === "Medium"
                ? "bg-[#EAF1FF] text-[#2563EB]"
                : "bg-[#E6F7EE] text-[#159455]";

    return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-semibold ${className}`}>
            {priority}
        </span>
    );
}

function StaffQuickActionsPanel({
                                    onNewBooking,
                                    onPos,
                                    onInventory,
                                    onTodayBookings,
                                }: {
    onNewBooking: () => void;
    onPos: () => void;
    onInventory: () => void;
    onTodayBookings: () => void;
}) {
    return (
        <section className="flex min-h-[290px] flex-col rounded-[14px] bg-white p-4 shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
            <div className="flex items-center gap-2 text-[#6D35D4]">
                <span className="flex h-6 w-6 items-center justify-center">
                    <CheckCircle2 size={18} />
                </span>
                <div>
                    <h2 className="text-[18px] font-bold leading-6 text-[#24152F]">Quick Actions</h2>
                    <p className="text-[9px] leading-5 text-[#8A7D92]">Common tasks for daily operations</p>
                </div>
            </div>

            <div className="mt-4 grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <StaffQuickActionButton
                    title="New Booking"
                    subtitle="Create or manage a booking"
                    icon={<CalendarDays size={20} />}
                    tone="violet"
                    onClick={onNewBooking}
                />
                <StaffQuickActionButton
                    title="POS Transaction"
                    subtitle="Process a customer sale"
                    icon={<ShoppingCart size={20} />}
                    tone="blue"
                    onClick={onPos}
                />
                <StaffQuickActionButton
                    title="Check Inventory"
                    subtitle="Verify stock items"
                    icon={<PackageCheck size={20} />}
                    tone="green"
                    onClick={onInventory}
                />
                <StaffQuickActionButton
                    title="Today&apos;s Bookings"
                    subtitle="Open today&apos;s booking list"
                    icon={<CalendarClock size={20} />}
                    tone="violetSoft"
                    onClick={onTodayBookings}
                />
            </div>
        </section>
    );
}

function StaffQuickActionButton({
                                    title,
                                    subtitle,
                                    icon,
                                    tone,
                                    onClick,
                                }: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    tone: "violet" | "blue" | "green" | "violetSoft";
    onClick: () => void;
}) {
    const styles = {
        violet: "bg-[#6D35D4] text-white hover:bg-[#5D2BBE]",
        blue: "bg-[#EAF1FF] text-[#2563EB] hover:bg-[#DFEAFF]",
        green: "bg-[#E6F7EE] text-[#159455] hover:bg-[#DCF2E6]",
        violetSoft: "bg-[#F1EBFF] text-[#6D35D4] hover:bg-[#E8DEFA]",
    }[tone];

    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex min-h-[88px] items-center gap-3 rounded-xl px-4 py-3 text-left transition ${styles}`}
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70 shadow-sm">
                {icon}
            </span>
            <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold">{title}</span>
                <span className={`mt-1 block truncate text-[9px] ${tone === "violet" ? "text-white/75" : "text-[#7A6A84]"}`}>
                    {subtitle}
                </span>
            </span>
        </button>
    );
}


function getStaffOperationActionLabel(operation: StaffOperationRow) {
    if (operation.source === "pos") return "View";
    if (operation.source === "inventory") return "Review";

    const status = operation.status.toLowerCase();
    if (status.includes("pending") || status.includes("awaiting")) return "Confirm";
    if (status.includes("confirm") || status.includes("prepar")) return "Prepare";
    if (status.includes("ready") || status.includes("prepared")) return "Release";
    return "View";
}

function getStaffActionTextClass(action: string) {
    const normalized = String(action || "").trim().toLowerCase();

    if (normalized === "confirm") {
        return "text-[#159455] hover:text-[#117A46]";
    }

    if (normalized === "prepare") {
        return "text-[#E66B20] hover:text-[#C45716]";
    }

    if (normalized === "release") {
        return "text-[#2563EB] hover:text-[#1D4ED8]";
    }

    return "text-[#6D35D4] hover:text-[#5D2BBE]";
}

function StaffTodayWorkPanel({
                                 operations,
                                 attentionCount,
                                 canAccessBookings,
                                 canManageBookings,
                                 canAccessPos,
                                 canAccessInventory,
                                 onViewBooking,
                                 onOpenBooking,
                                 onOpenPos,
                                 onOpenInventory,
                             }: {
    operations: StaffOperationRow[];
    attentionCount: number;
    canAccessBookings: boolean;
    canManageBookings: boolean;
    canAccessPos: boolean;
    canAccessInventory: boolean;
    onViewBooking: (bookingId: number) => void;
    onOpenBooking: () => void;
    onOpenPos: () => void;
    onOpenInventory: () => void;
}) {
    const [workFilter, setWorkFilter] = useState<"all" | "booking" | "inventory">("all");

    const bookingOperationsCount = operations.filter(
        (operation) => operation.source === "booking",
    ).length;
    const inventoryOperationsCount = operations.filter(
        (operation) => operation.source === "inventory",
    ).length;

    const visibleOperations = operations.filter((operation) => {
        if (workFilter === "booking") return operation.source === "booking";
        if (workFilter === "inventory") return operation.source === "inventory";
        return true;
    });

    const workFilterClass = (filter: "all" | "booking" | "inventory") => {
        const isActive = workFilter === filter;

        if (filter === "all") {
            return isActive
                ? "border-[#2B174C] bg-[#2B174C] text-white"
                : "border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#FAF8FF]";
        }

        if (filter === "booking") {
            return isActive
                ? "border-[#D8C5F3] bg-[#F1EBFF] text-[#6D35D4]"
                : "border-[#D8C5F3] bg-white text-[#6D35D4] hover:bg-[#F7F1FF]";
        }

        return isActive
            ? "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
            : "border-[#F4D79A] bg-white text-[#A56607] hover:bg-[#FFFBF0]";
    };

    return (
        <section
            className="grid h-[540px] max-h-[540px] min-h-[540px] grid-rows-[auto_minmax(0,1fr)_24px] overflow-hidden rounded-2xl bg-white shadow-sm"
            style={{ height: 540, minHeight: 540, maxHeight: 540 }}
        >
            <div className="border-b border-[#EEE8F2] px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                            <ClipboardList size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">
                                Today&apos;s Work
                            </h2>
                            <p className="mt-1 truncate text-[11px] text-[#9A8DA8]">
                                Here are the things you need to do today.
                            </p>
                        </div>
                    </div>

                    {attentionCount > 0 && (
                        <span className="shrink-0 rounded-full bg-[#FFF0F0] px-3 py-1.5 text-[10px] font-semibold text-[#D92D20]">
                            {attentionCount} item{attentionCount === 1 ? "" : "s"} require attention
                        </span>
                    )}
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setWorkFilter("all")}
                        aria-pressed={workFilter === "all"}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${workFilterClass("all")}`}
                    >
                        All ({operations.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setWorkFilter("booking")}
                        aria-pressed={workFilter === "booking"}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${workFilterClass("booking")}`}
                    >
                        Bookings ({bookingOperationsCount})
                    </button>
                    <button
                        type="button"
                        onClick={() => setWorkFilter("inventory")}
                        aria-pressed={workFilter === "inventory"}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${workFilterClass("inventory")}`}
                    >
                        Inventory ({inventoryOperationsCount})
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[13%]" />
                        <col className="w-[25%]" />
                        <col className="w-[20%]" />
                        <col className="w-[18%]" />
                        <col className="w-[24%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-[#FBFAFD]">
                    <tr className="h-[34px] border-b border-[#EEE8F2]">
                        <th className="px-4 py-2 text-center text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Time
                        </th>
                        <th className="px-4 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Work Item
                        </th>
                        <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Reference
                        </th>
                        <th className="px-4 py-2 text-center text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Status
                        </th>
                        <th className="px-4 py-2 text-center text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Action
                        </th>
                    </tr>
                    </thead>
                    <tbody>
                    {visibleOperations.length === 0 ? (
                        <tr className="!border-0">
                            <td colSpan={5} className="!border-0 px-5 py-16 text-center text-[12px] text-[#8A7D92]">
                                {workFilter === "all"
                                    ? "No pending work items require your attention right now."
                                    : `No ${workFilter === "booking" ? "booking" : "inventory"} work items to show right now.`}
                            </td>
                        </tr>
                    ) : (
                        visibleOperations.map((operation) => {
                            const actionLabel = getStaffOperationActionLabel(operation);
                            const isPos = operation.source === "pos";
                            const isInventory = operation.source === "inventory";
                            const normalizedStatus = operation.status.toLowerCase();
                            const completed = normalizedStatus.includes("complete");
                            const inventoryCritical =
                                normalizedStatus.includes("out of stock") ||
                                normalizedStatus.includes("expired");

                            const bookingActionAllowed =
                                actionLabel === "View"
                                    ? canAccessBookings
                                    : canManageBookings;

                            const actionAllowed = isInventory
                                ? canAccessInventory
                                : isPos
                                    ? canAccessPos
                                    : bookingActionAllowed;

                            return (
                                <tr
                                    key={operation.id}
                                    className="border-b border-[#F1ECF4] transition last:border-b-0 hover:bg-[#FCFAFE]"
                                >
                                    <td className="!border-0 px-4 py-2.5 text-center align-middle text-[10px] font-semibold text-[#5F4E75]">
                                        {operation.time}
                                    </td>
                                    <td className="!border-0 px-4 py-2.5 align-middle">
                                        <p
                                            className="truncate text-[11px] font-semibold leading-4 text-[#24152F]"
                                            title={operation.title}
                                        >
                                            {operation.title}
                                        </p>
                                    </td>
                                    <td className="!border-0 px-3 py-2.5 align-middle">
                                        <p
                                            className="truncate text-[11px] font-semibold leading-4 text-[#24152F]"
                                            title={operation.detail}
                                        >
                                            {operation.detail}
                                        </p>
                                    </td>
                                    <td className="!border-0 px-3 py-2.5 text-center align-middle">
                                        <div className="flex justify-center">
                                            <StaffStatusBadge status={operation.status} />
                                        </div>
                                    </td>
                                    <td className="!border-0 px-4 py-2.5 text-center align-middle">
                                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                                            {actionAllowed ? (
                                                <button
                                                    type="button"
                                                    onClick={
                                                        isInventory
                                                            ? onOpenInventory
                                                            : isPos
                                                                ? onOpenPos
                                                                : onOpenBooking
                                                    }
                                                    className={`shrink-0 text-left text-[12px] font-semibold transition hover:underline ${getStaffActionTextClass(actionLabel)}`}
                                                >
                                                    {actionLabel}
                                                </button>
                                            ) : (
                                                <span className="text-[9px] font-medium text-[#B0A4B8]">—</span>
                                            )}

                                            {((isInventory && canAccessInventory) ||
                                                (isPos && canAccessPos) ||
                                                (!isInventory &&
                                                    !isPos &&
                                                    operation.bookingId &&
                                                    canAccessBookings)) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (isInventory) {
                                                            onOpenInventory();
                                                            return;
                                                        }

                                                        if (isPos) {
                                                            onOpenPos();
                                                            return;
                                                        }

                                                        if (operation.bookingId) {
                                                            onViewBooking(operation.bookingId);
                                                        }
                                                    }}
                                                    title={
                                                        isInventory
                                                            ? "View inventory item"
                                                            : isPos
                                                                ? "View transaction details"
                                                                : "View booking details"
                                                    }
                                                    aria-label={
                                                        isInventory
                                                            ? "View inventory item"
                                                            : isPos
                                                                ? "View transaction details"
                                                                : "View booking details"
                                                    }
                                                    className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[#6D35D4] transition hover:text-[#5D2BBE]"
                                                >
                                                    <Eye size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>

            <div className="flex h-6 items-center justify-center border-t border-[#EEE8F2] bg-[#FCFAFE] text-[9px] font-medium text-[#8A7D92]">
                {visibleOperations.length > 4 ? "Scroll to view remaining work items" : ""}
            </div>
        </section>
    );
}

function StaffBookingDetailsModal({
                                      booking,
                                      onClose,
                                  }: {
    booking: Booking;
    onClose: () => void;
}) {
    const reference =
        String(booking.bookingNumber || "").trim() ||
        compactDashboardReference("BK", booking.bookingNumber, booking.id);
    const eventLabel =
        String(booking.eventName || "").trim() ||
        String(booking.packageName || "").trim() ||
        String(booking.customOrder || booking.custom_order || "").trim() ||
        "Not specified";
    const packageLabel =
        String(booking.packageName || "").trim() ||
        String(booking.customOrder || booking.custom_order || "").trim() ||
        "Not specified";
    const scheduleDate =
        formatDashboardBookingDate(booking.date) || "Today";
    const scheduleTime =
        formatDashboardTime(booking.date, booking.time) || "Time not specified";
    const status = normalizeDashboardBookingStatus(booking.status);
    const action = getStaffBookingAction(booking);
    const title =
        action === "Confirm"
            ? "Booking Confirmation Details"
            : action === "Prepare"
                ? "Booking Preparation Details"
                : action === "Release"
                    ? "Booking Release Details"
                    : "Booking Details";

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-[#160C24]/40 px-4 py-6 backdrop-blur-[1px]"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="staff-booking-details-title"
                className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_70px_rgba(23,12,48,0.28)]"
            >
                <div className="flex items-center justify-between gap-4 border-b border-[#EEE8F2] px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                            <Eye size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2
                                id="staff-booking-details-title"
                                className="truncate text-[16px] font-bold text-[#1A1220]"
                            >
                                {title}
                            </h2>
                            <p className="mt-0.5 text-[11px] text-[#9A8DA8]">
                                Quick booking information for today&apos;s task.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close booking details"
                        title="Close"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#7A6A84] transition hover:bg-[#F5F0F8] hover:text-[#2B174C]"
                    >
                        <X size={17} />
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-x-5 gap-y-4 px-5 py-5 sm:grid-cols-2">
                    <BookingDetailItem label="Client" value={booking.name || "Unnamed Client"} />
                    <BookingDetailItem label="Reference" value={reference} />
                    <BookingDetailItem label="Event" value={eventLabel} />
                    <BookingDetailItem label="Package / Selection" value={packageLabel} />
                    <BookingDetailItem
                        label="Schedule"
                        value={`${scheduleDate} • ${scheduleTime}`}
                    />
                    <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-[#8A7D92]">
                            Status
                        </p>
                        <div className="mt-1.5">
                            <StaffStatusBadge status={status} />
                        </div>
                    </div>
                </div>

                <div className="border-t border-[#EEE8F2] bg-[#FCFAFE] px-5 py-3 text-[10px] leading-4 text-[#7A6A84]">
                    This view uses the booking already loaded in the Staff dashboard, so you do not need to copy and search the booking number manually.
                </div>
            </div>
        </div>
    );
}

function BookingDetailItem({
                               label,
                               value,
                           }: {
    label: string;
    value: string;
}) {
    return (
        <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.05em] text-[#8A7D92]">
                {label}
            </p>
            <p
                className="mt-1.5 break-words text-[12px] font-semibold leading-5 text-[#24152F]"
                title={value}
            >
                {value}
            </p>
        </div>
    );
}

function StaffReferenceQuickActionsPanel({
                                             canNewPos,
                                             canCreateBooking,
                                             canConfirmBooking,
                                             canPrepareBooking,
                                             canFindBooking,
                                             onNewPos,
                                             onCreateBooking,
                                             onConfirmBooking,
                                             onPrepareBooking,
                                             onFindBooking,
                                         }: {
    canNewPos: boolean;
    canCreateBooking: boolean;
    canConfirmBooking: boolean;
    canPrepareBooking: boolean;
    canFindBooking: boolean;
    onNewPos: () => void;
    onCreateBooking: () => void;
    onConfirmBooking: () => void;
    onPrepareBooking: () => void;
    onFindBooking: () => void;
}) {
    const actions: {
        title: string;
        icon: React.ReactNode;
        className: string;
        iconClassName: string;
        onClick: () => void;
    }[] = [];

    if (canNewPos) {
        actions.push({
            title: "New POS Transaction",
            icon: <ShoppingCart size={17} />,
            className: "bg-[#F1EBFF] text-[#6D35D4]",
            iconClassName: "bg-[#F1EBFF] text-[#6D35D4]",
            onClick: onNewPos,
        });
    }

    if (canCreateBooking) {
        actions.push({
            title: "Create Booking",
            icon: <CalendarDays size={17} />,
            className: "bg-[#EAF1FF] text-[#2563EB]",
            iconClassName: "bg-[#EAF1FF] text-[#2563EB]",
            onClick: onCreateBooking,
        });
    }

    if (canConfirmBooking) {
        actions.push({
            title: "Confirm Booking",
            icon: <CheckCircle2 size={17} />,
            className: "bg-[#E6F7EE] text-[#159455]",
            iconClassName: "bg-[#E6F7EE] text-[#159455]",
            onClick: onConfirmBooking,
        });
    }

    if (canPrepareBooking) {
        actions.push({
            title: "Prepare Booking",
            icon: <PackageCheck size={17} />,
            className: "bg-[#FFF0E5] text-[#E66B20]",
            iconClassName: "bg-[#FFF0E5] text-[#E66B20]",
            onClick: onPrepareBooking,
        });
    }

    if (canFindBooking) {
        actions.push({
            title: "Find Booking",
            icon: <CalendarClock size={17} />,
            className: "bg-[#F1EBFF] text-[#6D35D4]",
            iconClassName: "bg-[#F1EBFF] text-[#6D35D4]",
            onClick: onFindBooking,
        });
    }

    return (
        <section className="flex h-[540px] min-h-[540px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="shrink-0 px-4 pt-4">
                <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                        <Zap size={18} />
                    </span>
                    <div>
                        <h2 className="text-[15px] font-bold leading-5 text-[#1A1220]">Quick Actions</h2>
                        <p className="mt-1 text-[11px] leading-4 text-[#9A8DA8]">
                            Only actions available to your account.
                        </p>
                    </div>
                </div>
            </div>

            {actions.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[11px] leading-5 text-[#8A7D92]">
                    No quick actions are available with your current permissions.
                </div>
            ) : (
                <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4 pt-1">
                    {actions.map((action) => (
                        <button
                            key={action.title}
                            type="button"
                            onClick={action.onClick}
                            className={`flex h-10 shrink-0 items-center justify-between rounded-lg px-3 text-left transition hover:brightness-[0.98] ${action.className}`}
                        >
                            <span className="flex min-w-0 items-center gap-3">
                                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${action.iconClassName}`}>
                                    {action.icon}
                                </span>
                                <span className="truncate text-[10px] font-semibold">{action.title}</span>
                            </span>
                            <ChevronRight size={15} className="shrink-0" />
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}

function getCompactTaskAction(task: StaffTaskRow) {
    const normalized = task.task.toLowerCase();
    if (normalized.startsWith("confirm")) return "Confirm";
    if (normalized.startsWith("prepare")) return "Prepare";
    if (normalized.startsWith("release")) return "Release";
    if (task.relatedTo.toLowerCase() === "inventory") return "Review";
    return "Open";
}

function StaffPendingTasksCompactPanel({
                                           tasks,
                                           total,
                                           bookings,
                                           canAccessBookings,
                                           canManageBookings,
                                           canOpenInventory,
                                           onViewBooking,
                                           onOpenBooking,
                                           onOpenInventory,
                                       }: {
    tasks: StaffTaskRow[];
    total: number;
    bookings: Booking[];
    canAccessBookings: boolean;
    canManageBookings: boolean;
    canOpenInventory: boolean;
    onViewBooking: (bookingId: number) => void;
    onOpenBooking: () => void;
    onOpenInventory: () => void;
}) {
    const [taskFilter, setTaskFilter] = useState<"all" | "booking" | "inventory">("all");

    const isInventoryRelatedTask = (task: StaffTaskRow) =>
        task.relatedTo.trim().toLowerCase() === "inventory";

    const bookingTaskCount = tasks.filter(
        (task) => !isInventoryRelatedTask(task),
    ).length;
    const inventoryTaskCount = tasks.filter((task) =>
        isInventoryRelatedTask(task),
    ).length;

    const visibleTasks = tasks.filter((task) => {
        if (taskFilter === "booking") return !isInventoryRelatedTask(task);
        if (taskFilter === "inventory") return isInventoryRelatedTask(task);
        return true;
    });

    const taskFilterClass = (filter: "all" | "booking" | "inventory") => {
        const isActive = taskFilter === filter;

        if (filter === "all") {
            return isActive
                ? "border-[#2B174C] bg-[#2B174C] text-white"
                : "border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#FAF8FF]";
        }

        if (filter === "booking") {
            return isActive
                ? "border-[#D8C5F3] bg-[#F1EBFF] text-[#6D35D4]"
                : "border-[#D8C5F3] bg-white text-[#6D35D4] hover:bg-[#F7F1FF]";
        }

        return isActive
            ? "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
            : "border-[#F4D79A] bg-white text-[#A56607] hover:bg-[#FFFBF0]";
    };

    const getDue = (task: StaffTaskRow) => {
        const booking = bookings.find(
            (item) =>
                compactDashboardReference("BK", item.bookingNumber, item.id) === task.relatedTo,
        );
        return booking
            ? formatDashboardTime(booking.date, booking.time) || "Today"
            : "Today";
    };

    const getTaskDisplayLabel = (task: StaffTaskRow) => {
        const inventoryTask =
            task.relatedTo.trim().toLowerCase() === "inventory";

        if (inventoryTask) {
            const [rawAction] = task.task.split(":");
            return rawAction.trim() || "Inventory Review";
        }

        const action = getCompactTaskAction(task);
        if (action === "Confirm") return "Confirm Booking";
        if (action === "Prepare") return "Prepare Booking";
        if (action === "Release") return "Release Booking";
        return "Review Booking";
    };

    const getTaskEventLabel = (task: StaffTaskRow) => {
        const inventoryTask =
            task.relatedTo.trim().toLowerCase() === "inventory";

        if (inventoryTask) {
            const [, ...detailParts] = task.task.split(":");
            const itemName = detailParts.join(":").trim();
            return itemName || "Inventory item";
        }

        const booking =
            bookings.find((item) => item.id === task.bookingId) ||
            bookings.find(
                (item) =>
                    compactDashboardReference(
                        "BK",
                        item.bookingNumber,
                        item.id,
                    ) === task.relatedTo,
            );

        return (
            booking?.eventName ||
            booking?.packageName ||
            "Booking"
        );
    };

    return (
        <section
            id="staff-pending-tasks"
            className="grid h-[344px] max-h-[344px] min-h-[344px] grid-rows-[auto_minmax(0,1fr)_24px] overflow-hidden rounded-2xl bg-white shadow-sm"
            style={{ height: 344, minHeight: 344, maxHeight: 344 }}
        >
            <div className="border-b border-[#EEE8F2] px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                            <ListChecks size={17} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="truncate text-[15px] font-bold text-[#1A1220]">
                                Pending Tasks
                            </h2>
                            <p className="mt-1 truncate text-[11px] text-[#9A8DA8]">
                                {total} task{total === 1 ? "" : "s"} require your attention.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setTaskFilter("all")}
                        aria-pressed={taskFilter === "all"}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${taskFilterClass("all")}`}
                    >
                        All ({tasks.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setTaskFilter("booking")}
                        aria-pressed={taskFilter === "booking"}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${taskFilterClass("booking")}`}
                    >
                        Bookings ({bookingTaskCount})
                    </button>
                    <button
                        type="button"
                        onClick={() => setTaskFilter("inventory")}
                        aria-pressed={taskFilter === "inventory"}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${taskFilterClass("inventory")}`}
                    >
                        Inventory ({inventoryTaskCount})
                    </button>
                </div>
            </div>

            <div className="min-h-0 max-h-full overflow-y-auto overscroll-contain">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[8%]" />
                        <col className="w-[32%]" />
                        <col className="w-[24%]" />
                        <col className="w-[16%]" />
                        <col className="w-[20%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-[#FBFAFD]">
                    <tr className="h-[34px] border-b border-[#EEE8F2]">
                        <th className="px-2 py-2 text-center text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">

                        </th>
                        <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Required Action
                        </th>
                        <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Reference
                        </th>
                        <th className="px-3 py-2 text-center text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Due
                        </th>
                        <th className="px-3 py-2 text-center text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]">
                            Action
                        </th>
                    </tr>
                    </thead>
                    <tbody>
                    {visibleTasks.length === 0 ? (
                        <tr className="!border-0">
                            <td colSpan={5} className="!border-0 px-4 py-14 text-center text-[11px] text-[#8A7D92]">
                                {taskFilter === "all"
                                    ? "No pending tasks right now."
                                    : `No ${taskFilter === "booking" ? "booking" : "inventory"} tasks to show right now.`}
                            </td>
                        </tr>
                    ) : (
                        visibleTasks.map((task) => {
                            const action = getCompactTaskAction(task);
                            const inventoryTask = task.relatedTo.toLowerCase() === "inventory";
                            const bookingActionNeedsManage =
                                action === "Confirm" ||
                                action === "Prepare" ||
                                action === "Release";
                            const actionAllowed = inventoryTask
                                ? canOpenInventory
                                : bookingActionNeedsManage
                                    ? canManageBookings
                                    : canAccessBookings;

                            return (
                                <tr
                                    key={task.id}
                                    className="border-b border-[#F1ECF4] transition last:border-b-0 hover:bg-[#FCFAFE]"
                                >
                                    <td className="!border-0 px-2 py-2.5 text-center align-middle">
                                        {(inventoryTask && canOpenInventory) ||
                                        (!inventoryTask &&
                                            task.bookingId &&
                                            canAccessBookings) ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (inventoryTask) {
                                                        onOpenInventory();
                                                        return;
                                                    }

                                                    if (task.bookingId) {
                                                        onViewBooking(task.bookingId);
                                                    }
                                                }}
                                                title={
                                                    inventoryTask
                                                        ? "View inventory item"
                                                        : "View booking details"
                                                }
                                                aria-label={
                                                    inventoryTask
                                                        ? "View inventory item"
                                                        : "View booking details"
                                                }
                                                className="inline-flex items-center justify-center text-[#6D35D4] transition hover:text-[#5D2BBE]"
                                            >
                                                <Eye size={14} />
                                            </button>
                                        ) : (
                                            <span className="text-[9px] font-medium text-[#B0A4B8]">—</span>
                                        )}
                                    </td>
                                    <td className="!border-0 px-3 py-2.5 align-middle">
                                        <p
                                            className="whitespace-normal break-words text-[10px] font-semibold leading-4 text-[#24152F]"
                                            title={getTaskDisplayLabel(task)}
                                        >
                                            {getTaskDisplayLabel(task)}
                                        </p>
                                    </td>
                                    <td className="!border-0 px-3 py-2.5 align-middle text-[10px] font-medium leading-4 text-[#6F617A]">
                                        <span
                                            className="block whitespace-normal break-words"
                                            title={getTaskEventLabel(task)}
                                        >
                                            {getTaskEventLabel(task)}
                                        </span>
                                    </td>
                                    <td className="!border-0 px-3 py-2.5 text-center align-middle text-[9px] font-semibold text-[#5F4E75]">
                                        {getDue(task)}
                                    </td>
                                    <td className="!border-0 px-3 py-2.5 text-center align-middle">
                                        {actionAllowed ? (
                                            <button
                                                type="button"
                                                onClick={inventoryTask ? onOpenInventory : onOpenBooking}
                                                className={`text-[12px] font-semibold transition hover:underline ${getStaffActionTextClass(action)}`}
                                            >
                                                {action}
                                            </button>
                                        ) : (
                                            <span className="text-[9px] font-medium text-[#B0A4B8]">—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>

            <div className="flex h-6 items-center justify-center border-t border-[#EEE8F2] bg-[#FCFAFE] text-[9px] font-medium text-[#8A7D92]">
                {visibleTasks.length > 3 ? "Scroll to review remaining tasks" : ""}
            </div>
        </section>
    );
}


function StaffRecentActivityPanel({ operations }: { operations: StaffOperationRow[] }) {
    return (
        <section className="grid h-[344px] max-h-[344px] min-h-[344px] grid-rows-[auto_minmax(0,1fr)_24px] overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-[#EEE8F2] px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                    <Clock3 size={17} />
                </span>
                <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-bold text-[#1A1220]">
                        Recent Activity
                    </h2>
                    <p className="mt-1 truncate text-[11px] text-[#9A8DA8]">
                        Latest transactions and updates.
                    </p>
                </div>
            </div>

            <div className="min-h-0 overflow-y-auto overscroll-contain">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[14%]" />
                        <col className="w-[46%]" />
                        <col className="w-[18%]" />
                        <col className="w-[22%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-[#FBFAFD]">
                    <tr className="h-[30px] border-b border-[#EEE8F2]">
                        {["Type", "Activity", "Time", "Status"].map((header) => (
                            <th
                                key={header}
                                className="px-2.5 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]"
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {operations.length === 0 ? (
                        <tr className="!border-0">
                            <td colSpan={4} className="!border-0 px-4 py-14 text-center text-[11px] text-[#8A7D92]">
                                No completed activity recorded yet today.
                            </td>
                        </tr>
                    ) : (
                        operations.map((operation) => {
                            const isPos = operation.source === "pos";
                            const isInventory = operation.source === "inventory";
                            const isPackage = operation.source === "package";
                            const activityType = isPos
                                ? "POS"
                                : isInventory
                                    ? "Inventory"
                                    : isPackage
                                        ? "Package"
                                        : "Booking";

                            const activityTone = isPos
                                ? "bg-[#E6F7EE] text-[#159455]"
                                : isInventory
                                    ? "bg-[#FFF0E5] text-[#E66B20]"
                                    : isPackage
                                        ? "bg-[#F1EBFF] text-[#6D35D4]"
                                        : "bg-[#EAF1FF] text-[#2563EB]";

                            return (
                                <tr
                                    key={operation.id}
                                    className="!border-0 transition hover:bg-[#FCFAFE]"
                                >
                                    <td className="!border-0 px-2.5 py-2.5 text-center align-middle">
                                        <span
                                            className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full ${activityTone}`}
                                            title={activityType}
                                            aria-label={activityType}
                                        >
                                            {isPos ? (
                                                <ShoppingCart size={13} />
                                            ) : isInventory ? (
                                                <PackageX size={13} />
                                            ) : isPackage ? (
                                                <PackageCheck size={13} />
                                            ) : (
                                                <CalendarDays size={13} />
                                            )}
                                        </span>
                                    </td>
                                    <td className="!border-0 px-2.5 py-2.5 align-middle">
                                        <p
                                            className="truncate text-[10px] font-semibold leading-4 text-[#24152F]"
                                            title={operation.title}
                                        >
                                            {operation.title}
                                        </p>
                                    </td>
                                    <td className="!border-0 px-2.5 py-2.5 align-middle text-[9px] font-semibold text-[#5F4E75]">
                                        {operation.time}
                                    </td>
                                    <td className="!border-0 px-2.5 py-2.5 align-middle">
                                        <StaffStatusBadge status={operation.status} />
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>

            <div className="flex h-6 items-center justify-center border-t border-[#EEE8F2] bg-[#FCFAFE] text-[9px] font-medium text-[#8A7D92]">
                {operations.length > 4 ? "Scroll to view remaining activities" : ""}
            </div>
        </section>
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
                                   onExportPdf,
                                   onExportXlsx,
                                   onExportDoc,
                                   totalRecords,
                                   headers,
                                   rows,
                                   emptyText,
                               }: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    action: () => void;
    onExportPdf: () => void;
    onExportXlsx: () => void;
    onExportDoc: () => void;
    totalRecords: number;
    headers: [string, string, string, string];
    rows: CompactTableRow[];
    emptyText: string;
}) {
    return (
        <section className="flex min-h-[310px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
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
                    <DashboardExportMenu
                        label={title}
                        onExportPdf={onExportPdf}
                        onExportXlsx={onExportXlsx}
                        onExportDoc={onExportDoc}
                    />

                    <button
                        type="button"
                        onClick={action}
                        className="rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4]"
                    >
                        View all
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[22%]" />
                        <col className="w-[31%]" />
                        <col className="w-[22%]" />
                        <col className="w-[25%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[46px] border-b border-[#EEE8F2]">
                        {headers.map((header) => (
                            <th
                                key={header}
                                className="whitespace-nowrap px-3 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]"
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
                                className="px-4 pt-6 text-center align-top text-[13px] text-[#8A7D92]"
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
            </div>
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
        : "";
    const day = validDate ? parsed.getDate() : "";
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
                                 onExportPdf,
                                 onExportXlsx,
                                 onExportDoc,
                                 onViewAll,
                             }: {
    items: StockAlertItem[];
    totalAlerts: number;
    onExportPdf: () => void;
    onExportXlsx: () => void;
    onExportDoc: () => void;
    onViewAll: () => void;
}) {
    return (
        <section className="flex min-h-[310px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
            <div className="flex min-h-[62px] items-center justify-between gap-3 border-b border-[#EEE8F2] px-4 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                    <TriangleAlert
                        size={18}
                        className="mt-0.5 shrink-0 text-[#EF4444]"
                    />
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
                    <DashboardExportMenu
                        label="Inventory Alerts"
                        onExportPdf={onExportPdf}
                        onExportXlsx={onExportXlsx}
                        onExportDoc={onExportDoc}
                    />

                    <button
                        type="button"
                        onClick={onViewAll}
                        className="rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4]"
                    >
                        View all
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[58%]" />
                        <col className="w-[18%]" />
                        <col className="w-[24%]" />
                    </colgroup>

                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[46px] border-b border-[#EEE8F2]">
                        <th className="whitespace-nowrap px-3 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]">
                            Product
                        </th>
                        <th className="whitespace-nowrap px-3 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]">
                            Stock Level
                        </th>
                        <th className="whitespace-nowrap px-3 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]">
                            Stock Alert
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    {items.length === 0 ? (
                        <tr>
                            <td
                                colSpan={3}
                                className="px-4 pt-6 text-center align-top text-[13px] text-[#8A7D92]"
                            >
                                All products and variants are well stocked.
                            </td>
                        </tr>
                    ) : (
                        items.map((item) => {
                            const isOutOfStock =
                                item.status === "Out of Stock";

                            return (
                                <tr
                                    key={item.id}
                                    className="h-[58px] border-b border-[#F1EDF5] last:border-b-0 hover:bg-[#FFFCFC]"
                                >
                                    <td className="px-3 py-2">
                                        <p
                                            title={item.productName}
                                            className="line-clamp-1 text-[13px] font-semibold leading-5 text-[#30243A]"
                                        >
                                            {item.productName}
                                        </p>
                                        <p
                                            title={item.variantName}
                                            className="truncate text-[10px] font-medium text-[#806A8C]"
                                        >
                                            {item.variantName}
                                        </p>
                                    </td>

                                    <td className="px-3 py-2">
                                    <span
                                        className={`whitespace-nowrap text-[13px] font-semibold ${
                                            isOutOfStock
                                                ? "text-[#DC2626]"
                                                : "text-[#B7791F]"
                                        }`}
                                    >
                                        {item.currentStock} left
                                    </span>
                                    </td>

                                    <td className="px-3 py-2">
                                    <span
                                        className={`whitespace-nowrap text-[13px] font-semibold ${
                                            isOutOfStock
                                                ? "text-[#DC2626]"
                                                : "text-[#B7791F]"
                                        }`}
                                    >
                                        {item.status}
                                    </span>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>

            <div className="border-t border-[#EEE8F2] px-4 py-1.5 text-center text-[9px] font-medium text-[#8A7D92]">
                Showing {items.length} of {totalAlerts} alert
                {totalAlerts === 1 ? "" : "s"}
            </div>
        </section>
    );
}
function ExpirationAlertsPanel({
                                   items,
                                   totalItems,
                                   showBranch = false,
                                   onExportPdf,
                                   onExportXlsx,
                                   onExportDoc,
                                   onViewAll,
                               }: {
    items: ExpirationAlertItem[];
    totalItems: number;
    showBranch?: boolean;
    onExportPdf: () => void;
    onExportXlsx: () => void;
    onExportDoc: () => void;
    onViewAll: () => void;
}) {
    const columnCount = showBranch ? 4 : 3;

    return (
        <section className="flex min-h-[310px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
            <div className="flex min-h-[62px] items-center justify-between gap-3 border-b border-[#EEE8F2] px-4 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                    <CalendarClock
                        size={18}
                        className="mt-0.5 shrink-0 text-[#7C3AED]"
                    />
                    <div className="min-w-0">
                        <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">
                            Expiration Alerts
                        </h2>
                        <p className="truncate text-[9px] leading-5 text-[#8A7D92]">
                            Expired and expiring items
                        </p>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <DashboardExportMenu
                        label="Expiration Alerts"
                        onExportPdf={onExportPdf}
                        onExportXlsx={onExportXlsx}
                        onExportDoc={onExportDoc}
                    />

                    <button
                        type="button"
                        onClick={onViewAll}
                        className="rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] px-4 py-2 text-[10px] font-semibold text-[#6D35D4]"
                    >
                        View all
                    </button>
                </div>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className={showBranch ? "w-[23%]" : "w-[48%]"} />
                        {showBranch ? <col className="w-[33%]" /> : null}
                        <col className={showBranch ? "w-[18%]" : "w-[20%]"} />
                        <col className={showBranch ? "w-[26%]" : "w-[32%]"} />
                    </colgroup>

                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[46px] border-b border-[#EEE8F2]">
                        <th className="whitespace-nowrap px-2 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]">
                            Product
                        </th>
                        {showBranch ? (
                            <th className="whitespace-nowrap px-2 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]">
                                Branch
                            </th>
                        ) : null}
                        <th className="whitespace-nowrap px-2 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]">
                            Stock Level
                        </th>
                        <th className="whitespace-nowrap px-2 py-2 text-left align-middle text-[10px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#806A8C]">
                            Expiration Date
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    {items.length === 0 ? (
                        <tr>
                            <td
                                colSpan={columnCount}
                                className="px-4 pt-6 text-center align-top text-[13px] text-[#8A7D92]"
                            >
                                No expiration alerts found.
                            </td>
                        </tr>
                    ) : (
                        items.map((item) => {
                            const isExpired = item.status === "Expired";

                            return (
                                <tr
                                    key={item.id}
                                    className="h-[58px] border-b border-[#F1EDF5] last:border-b-0 hover:bg-[#FCFAFF]"
                                >
                                    <td className="px-2 py-2 align-middle">
                                        <p
                                            title={item.productName}
                                            className="line-clamp-2 text-[13px] font-semibold leading-5 text-[#30243A]"
                                        >
                                            {item.productName}
                                        </p>
                                        {item.variantName ? (
                                            <p
                                                title={item.variantName}
                                                className="truncate text-[10px] font-medium text-[#806A8C]"
                                            >
                                                {item.variantName}
                                            </p>
                                        ) : null}
                                    </td>

                                    {showBranch ? (
                                        <td className="px-2 py-2 align-middle">
                                            <p
                                                title={item.branchName}
                                                className="whitespace-nowrap text-[12px] font-semibold tracking-[-0.04em] text-[#6D35D4]"
                                            >
                                                {item.branchName}
                                            </p>
                                        </td>
                                    ) : null}

                                    <td className="px-2 py-2 align-middle">
                                        <span className="whitespace-nowrap text-[12px] font-semibold text-[#30243A]">
                                            {item.stock} left
                                        </span>
                                    </td>

                                    <td className="px-2 py-2 align-middle">
                                        <p
                                            className={`whitespace-nowrap text-[12px] font-semibold tracking-[-0.01em] ${
                                                isExpired
                                                    ? "text-[#DC2626]"
                                                    : "text-[#6D35D4]"
                                            }`}
                                        >
                                            {formatDashboardExpirationDate(
                                                item.expirationDate,
                                            )}
                                        </p>
                                        <p
                                            className={`whitespace-nowrap text-[10px] font-semibold ${
                                                isExpired ||
                                                item.daysRemaining <= 7
                                                    ? "text-[#DC2626]"
                                                    : "text-[#806A8C]"
                                            }`}
                                        >
                                            {formatExpirationDistance(
                                                item.daysRemaining,
                                            )}
                                        </p>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>

            <div className="border-t border-[#EEE8F2] px-4 py-1.5 text-center text-[9px] font-medium text-[#8A7D92]">
                Showing {items.length} of {totalItems} alert
                {totalItems === 1 ? "" : "s"}
            </div>
        </section>
    );
}

function ExpirationAlertsModal({
                                   items,
                                   showBranch = false,
                                   onClose,
                               }: {
    items: ExpirationAlertItem[];
    showBranch?: boolean;
    onClose: () => void;
}) {
    const [activeFilter, setActiveFilter] = useState<
        "all" | "expiring" | "expired"
    >("all");

    const columnCount = showBranch ? 4 : 3;
    const expiredCount = items.filter(
        (item) => item.status === "Expired",
    ).length;
    const expiringCount = items.filter(
        (item) => item.status === "Expiring",
    ).length;

    const visibleItems = items.filter((item) => {
        if (activeFilter === "expired") {
            return item.status === "Expired";
        }

        if (activeFilter === "expiring") {
            return item.status === "Expiring";
        }

        return true;
    });

    const filterClass = (
        filter: "all" | "expiring" | "expired",
    ) => {
        const isActive = activeFilter === filter;

        if (filter === "all") {
            return isActive
                ? "border-[#2B174C] bg-[#2B174C] text-white"
                : "border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#FAF8FF]";
        }

        if (filter === "expiring") {
            return isActive
                ? "border-[#D8C5F3] bg-[#F1EBFF] text-[#6D35D4]"
                : "border-[#D8C5F3] bg-white text-[#6D35D4] hover:bg-[#F7F1FF]";
        }

        return isActive
            ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
            : "border-[#F2C4C4] bg-white text-[#C32F2F] hover:bg-[#FFF5F5]";
    };

    return (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 px-4 py-6 font-sans text-[#1A1220] backdrop-blur-[2px]">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="dashboard-expiration-alerts-title"
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4 border-b border-[#E9E0EF] px-6 py-5">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                            <CalendarClock size={21} strokeWidth={2} />
                        </span>

                        <div>
                            <h2
                                id="dashboard-expiration-alerts-title"
                                className="text-[20px] font-bold leading-6 text-[#1A1220]"
                            >
                                Expiration Alerts
                            </h2>
                            <p className="mt-1 text-sm leading-5 text-[#7A6A84]">
                                Expired items appear first, followed by items expiring within 30 days.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close expiration alerts"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[22px] leading-none text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C]"
                    >
                        ×
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-[#E9E0EF] px-6 py-3">
                    <button
                        type="button"
                        onClick={() => setActiveFilter("all")}
                        aria-pressed={activeFilter === "all"}
                        className={`rounded-xl border px-4 py-2 text-xs font-semibold transition ${filterClass(
                            "all",
                        )}`}
                    >
                        All ({items.length})
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter("expiring")}
                        aria-pressed={activeFilter === "expiring"}
                        className={`rounded-xl border px-4 py-2 text-xs font-semibold transition ${filterClass(
                            "expiring",
                        )}`}
                    >
                        Expiring ({expiringCount})
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter("expired")}
                        aria-pressed={activeFilter === "expired"}
                        className={`rounded-xl border px-4 py-2 text-xs font-semibold transition ${filterClass(
                            "expired",
                        )}`}
                    >
                        Expired ({expiredCount})
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[720px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#FFFCF7]">
                        <tr className="border-b border-[#E9E0EF]">
                            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Product
                            </th>
                            {showBranch ? (
                                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                    Branch
                                </th>
                            ) : null}
                            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Stock Level
                            </th>
                            <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
                                Expiration Date
                            </th>
                        </tr>
                        </thead>

                        <tbody>
                        {visibleItems.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columnCount}
                                    className="px-5 py-14 text-center text-sm text-[#7A6A84]"
                                >
                                    {activeFilter === "expired"
                                        ? "No expired items found."
                                        : activeFilter === "expiring"
                                            ? "No expiring items found."
                                            : "No expiration alerts found."}
                                </td>
                            </tr>
                        ) : (
                            visibleItems.map((item) => {
                                const isExpired =
                                    item.status === "Expired";

                                return (
                                    <tr
                                        key={item.id}
                                        className="border-b border-[#EEE7F2] transition hover:bg-[#FFFCF7] last:border-b-0"
                                    >
                                        <td className="px-5 py-3.5">
                                            <p className="text-sm font-semibold leading-5 text-[#1A1220]">
                                                {item.productName}
                                            </p>
                                            {item.variantName ? (
                                                <p className="mt-0.5 text-xs font-medium text-[#806A8C]">
                                                    {item.variantName}
                                                </p>
                                            ) : null}
                                        </td>

                                        {showBranch ? (
                                            <td className="px-5 py-3.5 text-sm font-medium text-[#6D35D4]">
                                                {item.branchName}
                                            </td>
                                        ) : null}

                                        <td className="px-5 py-3.5 text-sm font-semibold text-[#30243A]">
                                            {item.stock} left
                                        </td>

                                        <td className="px-5 py-3.5">
                                            <p
                                                className={`text-sm font-semibold ${
                                                    isExpired
                                                        ? "text-[#DC2626]"
                                                        : "text-[#2B174C]"
                                                }`}
                                            >
                                                {formatDashboardExpirationDate(
                                                    item.expirationDate,
                                                )}
                                            </p>
                                            <p
                                                className={`mt-0.5 text-xs font-semibold ${
                                                    isExpired ||
                                                    item.daysRemaining <= 7
                                                        ? "text-[#DC2626]"
                                                        : "text-[#806A8C]"
                                                }`}
                                            >
                                                {formatExpirationDistance(
                                                    item.daysRemaining,
                                                )}
                                            </p>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-[#E9E0EF] bg-[#FFFCF7] px-6 py-3 text-xs leading-5 text-[#7A6A84]">
                    Expired items have dates before today. Expiring items have dates from today through the next 30 days.
                </div>
            </div>
        </div>
    );
}

function StaffStockAlertsModal({
                                   items,
                                   activeFilter,
                                   totalCount,
                                   lowStockCount,
                                   outOfStockCount,
                                   canRestock,
                                   onChangeFilter,
                                   onRestock,
                                   onClose,
                               }: {
    items: StockAlertItem[];
    activeFilter: "all" | "low" | "out";
    totalCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    canRestock: boolean;
    onChangeFilter: (filter: "all" | "low" | "out") => void;
    onRestock: (item: StockAlertItem) => void;
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
                aria-labelledby="staff-stock-alerts-title"
                className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4 border-b border-[#E9E0EF] px-6 py-5">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFF4D8] text-[#B7791F]">
                            <TriangleAlert size={21} strokeWidth={2} />
                        </span>

                        <div className="min-w-0">
                            <h2
                                id="staff-stock-alerts-title"
                                className="!text-[20px] !font-bold !leading-6 text-[#1A1220]"
                            >
                                Stock Alerts
                            </h2>
                            <p className="mt-1 !text-sm !font-normal !leading-5 text-[#7A6A84]">
                                Low-stock and out-of-stock products and variants.
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

                    <span
                        className={`!text-xs !font-semibold ${
                            canRestock
                                ? "text-[#16834A]"
                                : "text-[#806A8C]"
                        }`}
                    >
                        {canRestock
                            ? "Restock access"
                            : "View only"}
                    </span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <table
                        className={`w-full table-fixed border-collapse ${
                            canRestock
                                ? "min-w-[850px]"
                                : "min-w-[760px]"
                        }`}
                    >
                        <colgroup>
                            <col
                                className={
                                    canRestock
                                        ? "w-[29%]"
                                        : "w-[34%]"
                                }
                            />
                            <col
                                className={
                                    canRestock
                                        ? "w-[24%]"
                                        : "w-[28%]"
                                }
                            />
                            <col
                                className={
                                    canRestock
                                        ? "w-[13%]"
                                        : "w-[14%]"
                                }
                            />
                            <col
                                className={
                                    canRestock
                                        ? "w-[11%]"
                                        : "w-[12%]"
                                }
                            />
                            <col
                                className={
                                    canRestock
                                        ? "w-[13%]"
                                        : "w-[12%]"
                                }
                            />
                            {canRestock ? (
                                <col className="w-[10%]" />
                            ) : null}
                        </colgroup>

                        <thead className="sticky top-0 z-10 bg-[#FFFCF7]">
                        <tr className="border-b border-[#E9E0EF]">
                            {[
                                "Product",
                                "Variant",
                                "Current Stock",
                                "Alert Level",
                                "Status",
                                ...(canRestock ? ["Action"] : []),
                            ].map((header) => (
                                <th
                                    key={header}
                                    className={`${header === "Product" ? "text-left" : "text-center"} px-4 py-3 !text-[11px] !font-semibold uppercase tracking-[0.08em] text-[#806A8C]`}
                                >
                                    {header}
                                </th>
                            ))}
                        </tr>
                        </thead>

                        <tbody>
                        {items.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={canRestock ? 6 : 5}
                                    className="px-5 py-14 text-center text-sm text-[#7A6A84]"
                                >
                                    No stock alerts found for this filter.
                                </td>
                            </tr>
                        ) : (
                            items.map((item) => {
                                const isOut =
                                    item.status === "Out of Stock";

                                return (
                                    <tr
                                        key={item.id}
                                        className="border-b border-[#EEE7F2] transition hover:bg-[#FFFCF7] last:border-b-0"
                                    >
                                        <td className="px-4 py-3.5">
                                            <p className="line-clamp-2 !text-sm !font-semibold !leading-5 text-[#1A1220]">
                                                {item.productName}
                                            </p>
                                            <p
                                                className={`mt-0.5 !text-xs !font-medium !leading-4 ${
                                                    isOut
                                                        ? "text-[#D92D20]"
                                                        : "text-[#A56607]"
                                                }`}
                                            >
                                                {item.status}
                                            </p>
                                        </td>

                                        <td className="px-4 py-3.5 text-center !text-sm !font-normal !leading-5 text-[#806A8C]">
                                            <span className="block truncate">
                                                {item.variantName}
                                            </span>
                                        </td>

                                        <td
                                            className={`px-4 py-3.5 text-center !text-sm !font-semibold !leading-5 ${
                                                isOut
                                                    ? "text-[#D92D20]"
                                                    : "text-[#A56607]"
                                            }`}
                                        >
                                            {item.currentStock}
                                        </td>

                                        <td className="px-4 py-3.5 text-center !text-sm !font-normal !leading-5 text-[#665875]">
                                            {item.alertLevel}
                                        </td>

                                        <td className="px-4 py-3.5 text-center">
                                            <span
                                                className={`inline-flex rounded-full border px-3 py-1 !text-xs !font-semibold !leading-4 ${
                                                    isOut
                                                        ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
                                                        : "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]"
                                                }`}
                                            >
                                                {item.status}
                                            </span>
                                        </td>

                                        {canRestock ? (
                                            <td className="px-4 py-3.5 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onRestock(item)
                                                    }
                                                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[#2B174C] bg-white px-3 !text-xs !font-semibold text-[#2B174C] transition hover:bg-[#2B174C] hover:text-white"
                                                >
                                                    Restock
                                                </button>
                                            </td>
                                        ) : null}
                                    </tr>
                                );
                            })
                        )}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-[#E9E0EF] bg-[#FFFCF7] px-6 py-3 text-xs leading-5 text-[#7A6A84]">
                    {canRestock
                        ? "Staff accounts with Inventory permission can open Inventory using the Restock action."
                        : "Staff accounts without Inventory management permission can review these alerts only."}
                </div>
            </div>
        </div>
    );
}
/* -------------------------------------------------------------------------- */
/* Staff dashboard: clean operational work and database-backed attendance      */
/* -------------------------------------------------------------------------- */

function StaffWorkTable({
                            operations, canAccessBookings, canManageBookings, canOpenInventory, canRestockInventory,
                            onViewBooking, onOpenBooking, onOpenInventory, onRestock, onReviewExpiry,
                        }: {
    operations: StaffOperationRow[];
    canAccessBookings: boolean;
    canManageBookings: boolean;
    canOpenInventory: boolean;
    canRestockInventory: boolean;
    onViewBooking: (bookingId: number) => void;
    onOpenBooking: () => void;
    onOpenInventory: () => void;
    onRestock: (productId: number, variantId?: number | null) => void;
    onReviewExpiry: (alertId: string) => void;
}) {
    const [moduleFilter, setModuleFilter] = useState("all");
    const [priorityFilter, setPriorityFilter] = useState("all");
    const filtered = useMemo(() => operations
        .filter((item) => moduleFilter === "all" || item.source === moduleFilter)
        .filter((item) => priorityFilter === "all" || (item.priority || "Medium") === priorityFilter)
        .sort((a, b) => {
            const rank: Record<StaffTaskPriority, number> = { High: 0, Medium: 1, Low: 2 };
            return (rank[a.priority || "Medium"] - rank[b.priority || "Medium"]) || (a.at.getTime() - b.at.getTime());
        }), [operations, moduleFilter, priorityFilter]);
    const modules = [...new Set(operations.map((item) => item.source))];

    return <section className="flex h-[540px] min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><ClipboardList size={18}/></span>
                <div><h2 className="text-[15px] font-bold text-[#21132E]">Today&apos;s Work</h2>
                    <p className="mt-0.5 text-[11px] text-[#86778F]">Inventory and booking tasks requiring staff action.</p></div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[10px] font-medium text-[#806A8C]">Module
                    <select aria-label="Filter today's work by module" value={moduleFilter} onChange={event => setModuleFilter(event.target.value)}
                            className="h-9 min-w-[110px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none focus:border-[#2B174C]">
                        <option value="all">All Modules</option>
                        {modules.map(module => <option key={module} value={module}>{module === "booking" ? "Bookings" : module === "inventory" ? "Inventory" : module === "rental" ? "Rentals" : module === "pos" ? "Sales / POS" : "Packages"}</option>)}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-medium text-[#806A8C]">Priority
                    <select aria-label="Filter today's work by priority" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}
                            className="h-9 min-w-[119px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none focus:border-[#2B174C]">
                        <option value="all">All Priorities</option><option>High</option><option>Medium</option><option>Low</option>
                    </select>
                </label>
            </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <table className="w-full min-w-[605px] table-fixed text-[10px] xl:text-[11px]">
                <colgroup><col className="w-[31%]"/><col className="w-[15%]"/><col className="w-[21%]"/><col className="w-[14%]"/><col className="w-[19%]"/></colgroup>
                <thead className="sticky top-0 z-10 bg-[#FFFCF8]">
                <tr className="border-b border-[#E9E1EE]">
                    {[["Task", false], ["Module", false], ["Reference No.", false], ["Priority", true], ["Action", true]].map(([label, center]) =>
                        <th key={String(label)} className={`px-2.5 py-2.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C] ${center ? "text-center" : "text-left"}`}>{label}</th>)}
                </tr>
                </thead>
                <tbody>
                {filtered.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-xs text-[#86778F]">No work items match your filters.</td></tr> : filtered.map(item => {
                    const booking = item.source === "booking";
                    const inventory = item.source === "inventory";
                    const expiry = inventory && /expir/i.test(item.status);
                    const canAct = booking ? canAccessBookings : inventory ? canOpenInventory : false;
                    const mayChange = booking ? canManageBookings : inventory && !expiry ? canRestockInventory : false;
                    const isExpired = expiry && /expired/i.test(item.status);
                    const action = booking ? /pending|awaiting/i.test(item.status) ? "Review" : /confirm/i.test(item.status) ? "Allocate" : "Prepare"
                        : isExpired ? "Review / Remove" : expiry ? "Prioritize Sale" : "Restock";
                    const moduleName = booking ? "Bookings" : item.source === "rental" ? "Rentals" : inventory ? "Inventory" : "Sales / POS";
                    const priority = item.priority || "Medium";
                    const badge = priority === "High" ? "bg-[#FFE7EA] text-[#D92C3F]" : priority === "Medium" ? "bg-[#FFF2D3] text-[#C77A00]" : "bg-[#E8F2FF] text-[#3372BA]";
                    const taskText = booking ? action === "Allocate" ? "Allocate products for confirmed booking" : action === "Review" ? "Review booking requirements" : "Prepare booking items"
                        : isExpired ? "Review / remove expired stock" : expiry ? "Review expiring stock" : "Restock low-stock item";
                    const referenceNo = String(item.reference || "").trim();
                    const onAction = () => {
                        if (booking) {
                            if (!canManageBookings && item.bookingId) onViewBooking(item.bookingId);
                            else onOpenBooking();
                        } else if (inventory && expiry && item.expirationAlertId) {
                            onReviewExpiry(item.expirationAlertId);
                        } else if (inventory && !expiry && canRestockInventory && item.productId) {
                            onRestock(item.productId, item.variantId);
                        } else onOpenInventory();
                    };
                    return <tr key={item.id} className="border-b border-[#EFE8F2] last:border-b-0 hover:bg-[#FFFCF8]">
                        <td className="break-words px-3 py-2.5 align-middle">
                            <p className="font-semibold leading-4 text-[#2B174C]">{taskText}</p>
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[#8A7D90]" title={item.detail}>{item.detail}</p>
                        </td>
                        <td className="px-2 py-2.5 align-middle"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${booking ? "bg-[#EEE8FF] text-[#6944C9]" : "bg-[#F4E9F8] text-[#8E4AA6]"}`}>{moduleName}</span></td>
                        <td className="break-all px-2 py-2.5 align-middle font-semibold text-[#4F3A5A]" title={referenceNo}>{referenceNo && referenceNo !== "Inventory" ? referenceNo : "—"}</td>
                        <td className="px-1.5 py-2.5 text-center align-middle"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${badge}`}>{priority}</span></td>
                        <td className="px-2 py-2.5 text-center align-middle">
                            {canAct ? <button type="button" onClick={onAction} disabled={inventory && !expiry && canRestockInventory && !item.productId}
                                              className="inline-flex w-full max-w-[118px] items-center justify-center rounded-lg border border-[#D9CDF0] bg-[#F5F0FF] px-2 py-1.5 text-center text-[10px] font-semibold leading-4 text-[#5330B6] transition hover:bg-[#ECE3FF] disabled:opacity-50">
                                {mayChange || expiry ? action : "View"}</button> : <span className="text-[#9A8DA8]">—</span>}
                        </td>
                    </tr>;
                })}
                </tbody>
            </table>
        </div>
        <div className="shrink-0 border-t border-[#EEE8F2] bg-[#FFFCF8] px-4 py-2 text-[10px] text-[#86778F]">{filtered.length} of {operations.length} tasks · Scroll to view more</div>
    </section>;
}

type StaffAuthorizedReceipt = {
    id: number | string;
    productId: number | string;
    variantId?: number | string | null;
    productName?: string;
    productNumber?: string;
    variantValues?: Record<string, unknown> | string | null;
    quantity: number | string;
    deliveryReference: string;
    expirationDate?: string | null;
    notes?: string | null;
};

// Staff are allowed to inspect expired SALES inventory but only a Manager/Owner
// may archive or permanently delete it. This is the same review visual as Manager
// Stock Action Center without exposing privileged delete API calls to Staff.
function StaffExpiredStockReviewDialog({ alert, product, onClose, onNotify }: {
    alert: ExpirationAlertItem;
    product: Product;
    onClose: () => void;
    onNotify: (notification: StaffActionToastMessage) => void;
}) {
    const variant = alert.variantId == null ? null : (product.variants || []).find(value => value.id === alert.variantId);
    const salesPrice = variant?.salesPrice ?? product.salesPrice;
    const alertLevel = variant?.alertLevel ?? variant?.alert_level ?? product.alertLevel;
    const expired = alert.status === "Expired";
    const date = formatDashboardExpirationDate(alert.expirationDate);
    const moneyOrDash = (value?: number | null) => value == null ? "—" : `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const itemLabel = `${alert.productName}${alert.variantName ? ` — ${alert.variantName}` : ""}`;
    return <div role="presentation" className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 px-3 py-5 font-sans"
                onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="staff-stock-review-title"
                 className="flex max-h-[92vh] w-full max-w-[738px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E9E1EE] px-6 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#5A35A5]"><ClipboardList size={20}/></span>
                    <div><h2 id="staff-stock-review-title" className="text-lg font-bold text-[#21132E]">
                        {expired ? "Review / Remove Affected Item" : "Prioritize Sale — Affected Item Review"}</h2>
                        <p className="mt-1 text-xs text-[#806A8C]">Review the affected inventory before taking action.</p></div>
                </div>
                <button type="button" onClick={onClose} aria-label="Close stock review" className="text-xl text-[#806A8C] hover:text-[#2B174C]"><X size={18}/></button>
            </header>
            <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
                <div className={`rounded-xl border p-4 ${expired ? "border-[#F2C7CC] bg-[#FFF3F4]" : "border-[#E3D8EA] bg-[#F8F3FF]"}`}>
                    <p className={`text-sm font-bold ${expired ? "text-[#B42335]" : "text-[#4E2C66]"}`}>
                        {expired ? "Expired stock — do not sell" : "Expiring soon — prioritize sale"}</p>
                    <p className="mt-1 text-xs leading-5 text-[#5A476A]">{expired
                        ? "This item is past its recorded expiration date. Review the stock and follow the business's disposal procedure before any removal."
                        : "This item is approaching its recorded expiration date. Review it for lawful prioritization or appropriate stock handling."}</p>
                </div>
                <div><h3 className="text-base font-bold text-[#21132E]">{itemLabel}</h3>
                    <p className="mt-1 text-xs text-[#806A8C]">Product No. {getStaffProductNumber(product) || "—"}</p></div>
                <div className="grid grid-cols-1 gap-x-5 gap-y-4 rounded-xl border border-[#E9E1EE] bg-[#FFFCF8] p-4 sm:grid-cols-2">
                    {[
                        ["Category", product.category || "—"], ["Branch", alert.branchName],
                        ["Affected Stock", `${alert.stock.toLocaleString("en-PH")} pcs`], ["Reorder Point", alertLevel != null ? `${alertLevel} pcs` : "—"],
                        ["Expiration Date", date], ["Expiration Status", expired ? `${Math.abs(alert.daysRemaining)} day(s) overdue` : `${alert.daysRemaining} day(s) left`],
                        ["Unit Cost", "Manager only"], ["Selling Price", moneyOrDash(salesPrice)],
                        ["Sales Velocity", "—"], ["Affected Stock Value (Cost)", "Manager only"],
                    ].map(([label, value]) => <div key={label}>
                        <p className="text-[11px] text-[#806A8C]">{label}</p>
                        <p className="mt-1 text-sm font-semibold text-[#2B174C]">{value}</p>
                    </div>)}
                </div>
                <p className="rounded-xl border border-[#E9E1EE] bg-[#FAF8FD] p-3 text-xs leading-5 text-[#806A8C]">
                    Staff may review affected sales inventory. Only an authorized Manager or Owner may delete or archive products or variants.
                </p>
            </div>
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E9E1EE] bg-white px-6 py-4">
                <button type="button" onClick={onClose} className="rounded-xl border border-[#E3D8EA] px-4 py-2.5 text-sm font-semibold text-[#2B174C]">Keep Item</button>
                <button type="button" onClick={() => onNotify({ title: "Manager approval required", message: "Staff cannot delete or archive inventory. Ask your manager to review this affected item.", tone: "error" })}
                        className="rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1B0D31]">
                    Review Delete / Archive
                </button>
            </footer>
        </section>
    </div>;
}

// Stock receipt is limited to the manager-authorized quantity, variant, and
// delivery reference. There are no Staff purchasing or supplier payment edits.
/** Staff-only operational restock. Manager Inventory and supplier purchasing are unaffected. */
function StaffDirectRestockDialog({ product, variantId, onClose, onSaved }: {
    product: Product;
    variantId: number | null;
    onClose: () => void;
    onSaved: (quantity: number) => Promise<void>;
}) {
    const [quantityText, setQuantityText] = useState("");
    const [expirationDate, setExpirationDate] = useState("");
    const [deliveryReference, setDeliveryReference] = useState("");
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const requestKey = useRef(crypto.randomUUID());
    const variant = variantId == null ? null : (product.variants || []).find(v => Number(v.id) === variantId);
    const currentStock = variantId == null ? Number(product.stock || 0) : Number(variant?.stock || 0);
    const quantity = Number(quantityText);
    const validQty = /^\d+$/.test(quantityText) && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1000000;
    const variantLabel = variantId == null ? "Regular" : variant ? getDashboardVariantName(variant) : "Variant unavailable";

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy || !validQty) return;
        setBusy(true);
        setError("");
        try {
            const token = getSavedItem("token");
            if (!token) throw new Error("Your staff session expired. Sign in again.");
            const response = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                cache: "no-store",
                body: JSON.stringify({
                    action: "staff_restock_product",
                    productId: product.id,
                    variantId,
                    quantity,
                    expirationDate: expirationDate || null,
                    deliveryReference: deliveryReference.trim(),
                    notes: notes.trim(),
                    requestKey: requestKey.current,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success !== true) throw new Error(result.error || "Could not restock this product.");
            await onSaved(Number(result.quantity || quantity));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to record the stock receipt.");
        } finally {
            setBusy(false);
        }
    };

    return <div role="presentation" className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-3 py-5 font-sans">
        <section role="dialog" aria-modal="true" aria-label="Receive Stock" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex shrink-0 items-center justify-between border-b border-[#E9E1EE] px-6 py-4">
                <h2 className="text-xl font-bold text-[#21132E]">Receive Stock</h2>
                <button type="button" disabled={busy} onClick={onClose} aria-label="Close Receive Stock" className="text-[#806A8C] hover:text-[#2B174C] disabled:opacity-50"><X size={20}/></button>
            </header>
            <form onSubmit={submit} className="flex min-h-0 flex-col">
                <div className="space-y-5 overflow-y-auto px-6 py-5">
                    <div>
                        <h3 className="text-base font-bold text-[#21132E]">{product.name}</h3>
                        <p className="mt-1 text-xs text-[#806A8C]">Product No. {getStaffProductNumber(product) || "—"} · {product.category || "Uncategorized"}</p>
                        <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-[#F7F1FF] p-4">
                            <div><p className="text-xs text-[#806A8C]">Current Total Stock</p><p className="mt-1 text-xl font-bold text-[#2B174C]">{currentStock} pcs</p></div>
                            <div><p className="text-xs text-[#806A8C]">Stock After Receiving</p><p className="mt-1 text-xl font-bold text-[#2B174C]">{currentStock + (validQty ? quantity : 0)} pcs</p></div>
                        </div>
                    </div>
                    <section className="space-y-3">
                        <h3 className="text-sm font-bold text-[#21132E]">1. Stock to Receive</h3>
                        <p className="text-xs text-[#806A8C]">Record only stock physically received for your assigned branch.</p>
                        <div className="rounded-xl border border-[#E3D8EA] p-4">
                            <p className="text-sm font-semibold text-[#2B174C]">{variantLabel}</p>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <label className="text-xs font-semibold text-[#5A476A]">Quantity to Add
                                    <input type="number" min={1} max={1000000} step={1} required value={quantityText}
                                           onChange={event => setQuantityText(event.target.value)}
                                           className="mt-1 w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#21132E]" placeholder="Enter units received" />
                                </label>
                                <label className="text-xs font-semibold text-[#5A476A]">Expiration Date (Optional)
                                    <input type="date" value={expirationDate} onChange={event => setExpirationDate(event.target.value)}
                                           className="mt-1 w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#21132E]" />
                                </label>
                            </div>
                        </div>
                    </section>
                    <section className="space-y-3 border-t border-[#EEE8F2] pt-4">
                        <h3 className="text-sm font-bold text-[#21132E]">2. Receiving Information</h3>
                        <label className="block text-xs font-semibold text-[#5A476A]">Delivery Reference (Optional)
                            <input maxLength={100} value={deliveryReference} onChange={event => setDeliveryReference(event.target.value)}
                                   className="mt-1 w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#21132E]" placeholder="Delivery note or reference" />
                        </label>
                        <label className="block text-xs font-semibold text-[#5A476A]">Receiving Notes (Optional)
                            <textarea maxLength={500} rows={2} value={notes} onChange={event => setNotes(event.target.value)}
                                      className="mt-1 w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#21132E]" placeholder="Any receiving observations" />
                        </label>
                        <p className="rounded-xl bg-[#F8F3FF] px-4 py-3 text-xs leading-5 text-[#5A476A]">Your manager assigned you Inventory access. This operation adds received quantities only; it does not change purchase costs, supplier payments, or selling prices.</p>
                    </section>
                    {error && <p role="alert" className="rounded-xl bg-[#FFF0F0] px-4 py-3 text-xs text-[#B42318]">{error}</p>}
                </div>
                <footer className="flex shrink-0 justify-end gap-2 border-t border-[#E9E1EE] bg-white px-6 py-4">
                    <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-[#E3D8EA] px-4 py-2.5 text-sm font-semibold text-[#2B174C]">Cancel</button>
                    <button type="submit" disabled={busy || !validQty || (variantId != null && !variant)} className="rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Receiving..." : "Confirm Stock In"}</button>
                </footer>
            </form>
        </section>
    </div>;
}

function StaffAuthorizedReceiptDialog({ product, task, onClose, onSaved }: {
    product: Product;
    task: StaffAuthorizedReceipt;
    onClose: () => void;
    onSaved: (quantity: number) => Promise<void>;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const requestKey = useRef<string>(crypto.randomUUID());
    const quantity = Number(task.quantity);
    const variants = product.variants || [];
    const currentStock = task.variantId == null ? Number(product.stock || 0)
        : Number(variants.find(variant => Number(variant.id) === Number(task.variantId))?.stock || 0);
    const variant = task.variantId == null ? "Regular" :
        getDashboardVariantName(variants.find(value => Number(value.id) === Number(task.variantId)) || {});
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError("");
        try {
            const token = getSavedItem("token");
            if (!token) throw new Error("Please sign in again.");
            const response = await fetch("/api/products", {
                method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: "complete_staff_stock_receipt", taskId: Number(task.id), requestKey: requestKey.current }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to complete authorized stock receipt.");
            await onSaved(Number(result.quantity || quantity));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Stock receipt failed.");
        } finally { setBusy(false); }
    };
    return <div role="presentation" className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-3 py-5 font-sans">
        <section role="dialog" aria-modal="true" aria-label="Receive Stock" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex shrink-0 items-center justify-between border-b border-[#E9E1EE] px-6 py-4">
                <h2 className="text-xl font-bold text-[#21132E]">Receive Stock</h2>
                <button type="button" onClick={onClose} disabled={busy} aria-label="Close Receive Stock" className="text-[#806A8C] hover:text-[#2B174C] disabled:opacity-50"><X size={20}/></button>
            </header>
            <form onSubmit={submit} className="flex min-h-0 flex-col">
                <div className="space-y-5 overflow-y-auto px-6 py-5">
                    <div><h3 className="text-base font-bold text-[#21132E]">{product.name}</h3>
                        <p className="mt-1 text-xs text-[#806A8C]">Product No. {getStaffProductNumber(product) || "—"} · {product.category}</p>
                        <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-[#F7F1FF] p-4">
                            <div><p className="text-xs text-[#806A8C]">Current Total Stock</p><p className="mt-1 text-xl font-bold text-[#2B174C]">{currentStock}</p></div>
                            <div><p className="text-xs text-[#806A8C]">Stock After Receiving</p><p className="mt-1 text-xl font-bold text-[#2B174C]">{currentStock + quantity}</p></div>
                        </div>
                    </div>
                    <section className="space-y-3"><h3 className="text-sm font-bold text-[#21132E]">1. Stock to Receive</h3>
                        <p className="text-xs text-[#806A8C]">Quantity and variant authorized by your manager; not editable by staff.</p>
                        <div className="rounded-xl border border-[#E3D8EA] p-4"><p className="text-sm font-semibold text-[#2B174C]">{variant}</p>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="text-xs font-semibold text-[#5A476A]">Quantity to Add<input readOnly value={quantity} className="mt-1 w-full rounded-xl border border-[#E3D8EA] bg-[#FAF8FD] p-3 text-sm"/></label>
                                <label className="text-xs font-semibold text-[#5A476A]">Approved Expiration Date<input readOnly value={task.expirationDate?.slice(0, 10) || "Not specified"} className="mt-1 w-full rounded-xl border border-[#E3D8EA] bg-[#FAF8FD] p-3 text-sm"/></label>
                            </div>
                        </div>
                    </section>
                    <section className="space-y-3 border-t border-[#EEE8F2] pt-4"><h3 className="text-sm font-bold text-[#21132E]">2. Supplier & Receiving Information</h3>
                        <label className="block text-xs font-semibold text-[#5A476A]">Delivery Reference<input readOnly value={task.deliveryReference || "—"} className="mt-1 w-full rounded-xl border border-[#E3D8EA] bg-[#FAF8FD] p-3 text-sm"/></label>
                        {task.notes && <p className="rounded-xl bg-[#F8F3FF] p-3 text-xs text-[#5A476A]">{task.notes}</p>}
                    </section>
                    <p className="rounded-xl bg-[#F8F3FF] px-4 py-3 text-xs leading-5 text-[#5A476A]">Supplier payments, unit costs, and purchase approval remain under the Manager/Owner. This staff action only records the authorized delivery and inventory movement.</p>
                    {error && <p role="alert" className="rounded-xl bg-[#FFF0F0] px-4 py-3 text-xs text-[#B42318]">{error}</p>}
                </div>
                <footer className="flex shrink-0 justify-end gap-2 border-t border-[#E9E1EE] bg-white px-6 py-4">
                    <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[#E3D8EA] px-4 py-2.5 text-sm font-semibold text-[#2B174C]">Cancel</button>
                    <button disabled={busy || !Number.isSafeInteger(quantity) || quantity < 1} className="rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Receiving..." : "Confirm Stock In"}</button>
                </footer>
            </form>
        </section>
    </div>;
}

type StaffAttendanceRecord = {
    id: string;
    storeName: string;
    branchName: string;
    employeeName: string;
    employeeNumber: string;
    date: string;
    endDate?: string;
    requestCreatedAt?: string;
    timeIn: string | null;
    timeOut: string | null;
    hoursWorked: number | null;
    status: string;
    reason: string;
    leaveType: string;
    approvalStatus: string;
};

function formatAttendanceRecord(value: unknown): StaffAttendanceRecord {
    const raw = toRecord(value);
    const get = (fields: string[]) => readText(raw, fields);
    const timeIn = get(["timeIn", "time_in", "clock_in"]);
    const timeOut = get(["timeOut", "time_out", "clock_out"]);
    const rawHours = firstDefined(raw, ["hoursWorked", "hours_worked"]);
    const hours = rawHours === null || rawHours === undefined || rawHours === "" ? null : Number(rawHours);
    return {
        id: get(["id", "attendanceId", "attendance_id", "request_id"]),
        storeName: get(["storeName", "store_name"]),
        branchName: get(["branchName", "branch_name"]),
        employeeName: get(["employeeName", "employee_name", "staff_name"]),
        employeeNumber: get(["employeeNumber", "employee_number", "staff_number"]),
        date: get(["date", "attendanceDate", "attendance_date", "leave_date"]),
        endDate: get(["endDate", "end_date", "leave_end_date"]) || undefined,
        requestCreatedAt: get(["requestCreatedAt", "createdAt", "created_at"]) || undefined,
        timeIn: timeIn || null, timeOut: timeOut || null,
        hoursWorked: hours !== null && Number.isFinite(hours) ? hours : null,
        status: get(["status", "attendance_status"]) || "Unknown",
        reason: get(["reason", "leave_reason", "absence_reason"]),
        leaveType: get(["leaveType", "leave_type"]),
        approvalStatus: get(["approvalStatus", "approval_status"]),
    };
}


// Older StockNBook versions saved one row per day for one leave application.
// Collapse only contiguous daily rows from the same submission, matching the
// manager's request grouping without deleting or editing historical SQL rows.
function groupStaffLeaveHistory(records: StaffAttendanceRecord[]): StaffAttendanceRecord[] {
    const attendance = records.filter((record) => !record.id.startsWith("L-"));
    const leaves = records.filter((record) => record.id.startsWith("L-"))
        .sort((a, b) =>
            a.employeeNumber.localeCompare(b.employeeNumber) ||
            String(a.requestCreatedAt || "").localeCompare(String(b.requestCreatedAt || "")) ||
            a.date.localeCompare(b.date));
    const groups: StaffAttendanceRecord[] = [];
    for (const record of leaves) {
        const last = groups[groups.length - 1];
        const endOfLast = last?.endDate || last?.date || "";
        const previous = new Date(`${endOfLast}T00:00:00.000Z`);
        if (!Number.isNaN(previous.getTime())) previous.setUTCDate(previous.getUTCDate() + 1);
        const consecutiveDay = !Number.isNaN(previous.getTime()) &&
            previous.toISOString().slice(0, 10) === record.date;
        const sameSubmission = last && Boolean(last.requestCreatedAt && record.requestCreatedAt) &&
            last.requestCreatedAt === record.requestCreatedAt &&
            last.employeeNumber === record.employeeNumber &&
            last.leaveType === record.leaveType && last.reason === record.reason &&
            last.approvalStatus === record.approvalStatus;
        if (sameSubmission && consecutiveDay) {
            last.endDate = record.endDate && record.endDate >= record.date
                ? record.endDate : record.date;
        } else {
            groups.push({ ...record });
        }
    }
    return [...attendance, ...groups].sort((a, b) =>
        b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function staffLeaveStatus(record: StaffAttendanceRecord): string {
    return record.approvalStatus ||
        (record.status.toLowerCase() === "absent" ? "Absent" : "—");
}

function staffLeaveStatusStyle(status: string): string {
    switch (status.toLowerCase()) {
        case "approved": return "bg-[#E7F7ED] text-[#147D43]";
        case "pending": return "bg-[#FFF4DF] text-[#A86905]";
        case "rejected": case "disapproved": case "absent":
            return "bg-[#FFE8E9] text-[#C72D36]";
        default: return "bg-[#F2EDF7] text-[#5A476A]";
    }
}

function staffAttendanceDay(raw: string) {
    const key = String(raw || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return raw || "—";
    return new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function staffAttendanceClock(raw: string | null) {
    if (!raw) return "—";
    const candidate = /^\d{4}-\d{2}-\d{2} /.test(raw) ? raw.replace(" ", "T") : raw;
    const date = new Date(candidate);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function staffAttendanceDuration(hours: number | null) {
    if (hours === null || !Number.isFinite(hours)) return "—";
    const minutes = Math.max(0, Math.round(hours * 60));
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function staffAttendanceStatus(record: StaffAttendanceRecord) {
    const status = record.status.toLowerCase().replace(/[\s_-]+/g, " ");
    if (status === "on duty" || (record.timeIn && !record.timeOut && status !== "absent")) return "On Duty";
    if (status === "absent") return "Absent";
    if (status.includes("leave")) return "Leave";
    if (status === "pending") return "Leave";
    if (status === "rejected") return "Leave";
    if (record.timeIn && record.timeOut) return "Completed";
    return record.status;
}

/* -------------------------------------------------------------------------- */
/* Staff attendance PDF export is intentionally defined in StaffDashboard.tsx  */
/* (no StaffAttendancePdf.ts import or additional PDF component is required).   */
/* -------------------------------------------------------------------------- */

/** Staff attendance PDF export: browser-only, no new npm dependencies.
 * A4 landscape multipage report. Only the signed-in staff member's API-scoped
 * records are supplied by StaffDashboard; never make up absent days.
 */
type StaffAttendancePdfRecord = {
    id: string;
    storeName: string;
    branchName: string;
    employeeName: string;
    employeeNumber: string;
    date: string;
    endDate?: string;
    timeIn: string | null;
    timeOut: string | null;
    hoursWorked: number | null;
    status: string;
    reason: string;
    leaveType: string;
    approvalStatus: string;
};

type StaffAttendancePdfOptions = {
    storeName: string;
    branchName: string;
    staffName: string;
    employeeNumber: string;
    startDate: string;
    endDate: string;
    generatedAt: Date;
    records: StaffAttendancePdfRecord[];
};

type ReportSection = {
    title: string;
    headers: string[];
    widths: number[];
    rows: string[][];
};
type PrintRow = { cells: string[][]; height: number };
type PrintPage = { section: ReportSection; rows: PrintRow[] };

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const SCALE = 2;
const TABLE_X = 31;
const TABLE_Y = 167;
const HEADING_HEIGHT = 27;
const FOOTER_Y = 550;
const LINE_HEIGHT = 11;

function dateLabel(raw: string) {
    const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!matched) return raw || "—";
    const d = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 12));
    return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function clockLabel(raw: string | null): string {
    if (!raw) return "—";
    // Stored server dates are already Manila-local DATETIME values.
    const parsed = new Date(raw.replace(" ", "T"));
    if (Number.isNaN(parsed.valueOf())) return raw;
    return parsed.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
}
function hoursLabel(raw: number | null) {
    if (raw === null || !Number.isFinite(raw)) return "—";
    const minutes = Math.round(raw * 60);
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function statusLabel(record: StaffAttendancePdfRecord) {
    if (record.timeIn && record.timeOut) return "Completed";
    if (record.timeIn) return "On Duty";
    if (/leave/i.test(record.status)) return "Leave";
    return record.status || "—";
}
function safeFilePart(text: string) {
    return text.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Employee";
}

function wrapCell(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
    const normalized = (value || "—").replace(/\s+/g, " ").trim() || "—";
    const lines: string[] = [];
    let line = "";
    for (const word of normalized.split(" ")) {
        const combined = line ? `${line} ${word}` : word;
        if (ctx.measureText(combined).width <= width) {
            line = combined;
            continue;
        }
        if (line) { lines.push(line); line = ""; }
        for (const letter of word) {
            if (line && ctx.measureText(line + letter).width > width) {
                lines.push(line);
                line = "";
            }
            line += letter;
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ["—"];
}

function sectionsFor(options: StaffAttendancePdfOptions): ReportSection[] {
    const attendance = options.records.filter(r => Boolean(r.timeIn) || Boolean(r.timeOut) || r.status.toLowerCase() === "absent");
    const leaves = options.records.filter(r => /leave|pending|rejected/i.test(r.status));
    const general = attendance.map(r => [
        r.storeName || options.storeName,
        r.branchName || options.branchName,
        r.employeeName || options.staffName,
        // Employee number ALWAYS uses staff.id, supplied in employeeNumber from API.
        r.employeeNumber || options.employeeNumber,
        dateLabel(r.date), clockLabel(r.timeIn), clockLabel(r.timeOut), hoursLabel(r.hoursWorked), statusLabel(r),
    ]);
    const leaveRows = leaves.map(r => [
        r.storeName || options.storeName,
        r.branchName || options.branchName,
        r.employeeName || options.staffName,
        r.employeeNumber || options.employeeNumber,
        dateLabel(r.date) + (r.endDate && r.endDate !== r.date ? ` – ${dateLabel(r.endDate)}` : ""),
        r.leaveType || "Leave", r.approvalStatus || "—", r.reason || "—",
    ]);
    return [
        {
            title: `Attendance and Absences (${general.length})`,
            headers: ["Store", "Branch", "Employee", "Employee ID", "Date", "Time In", "Time Out", "Hours", "Status"],
            widths: [116, 100, 103, 75, 75, 75, 75, 56, 75], rows: general,
        },
        {
            title: `Leave Requests (${leaveRows.length})`,
            headers: ["Store", "Branch", "Employee", "Employee ID", "Date", "Leave Type", "Approval", "Reason"],
            widths: [105, 94, 93, 75, 75, 77, 76, 155], rows: leaveRows,
        },
    ];
}

function renderPages(ctx: CanvasRenderingContext2D, sections: ReportSection[]): PrintPage[] {
    const pages: PrintPage[] = [];
    for (const section of sections) {
        let page: PrintPage = { section, rows: [] };
        let usedHeight = TABLE_Y + HEADING_HEIGHT;
        const input = section.rows.length ? section.rows : [
            ["No records for the selected dates.", ...Array(section.headers.length - 1).fill("")],
        ];
        for (const data of input) {
            ctx.font = "8px Arial, sans-serif";
            const wrapped = data.map((value, index) => wrapCell(ctx, value, section.widths[index] - 10));
            let offset = 0;
            const maxLines = Math.max(...wrapped.map(value => value.length));
            // Large leave reasons continue on subsequent rows/pages rather than being truncated.
            while (offset < maxLines) {
                const cells = wrapped.map(lines => lines.slice(offset, offset + 24));
                const height = Math.max(24, Math.max(...cells.map(v => v.length)) * LINE_HEIGHT + 10);
                if (usedHeight + height > FOOTER_Y && page.rows.length > 0) {
                    pages.push(page);
                    page = { section, rows: [] };
                    usedHeight = TABLE_Y + HEADING_HEIGHT;
                }
                page.rows.push({ cells, height });
                usedHeight += height;
                offset += 24;
            }
        }
        pages.push(page);
    }
    return pages;
}

function drawPage(ctx: CanvasRenderingContext2D, page: PrintPage, pageIndex: number, totalPages: number, info: StaffAttendancePdfOptions) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.fillStyle = "#2B174C";
    ctx.font = "bold 17px Arial, sans-serif";
    ctx.fillText("StockNBook  |  Staff Attendance Report", TABLE_X, 31);
    ctx.font = "10px Arial, sans-serif";
    ctx.fillText(`Store: ${info.storeName}`, TABLE_X, 54);
    ctx.fillText(`Branch: ${info.branchName}`, TABLE_X, 70);
    ctx.fillText(`Employee: ${info.staffName}  |  Employee ID: ${info.employeeNumber}`, TABLE_X, 86);
    ctx.fillText(`Period: ${dateLabel(info.startDate)} - ${dateLabel(info.endDate)}`, TABLE_X, 102);
    ctx.fillStyle = "#6E597C";
    ctx.font = "9px Arial, sans-serif";
    ctx.fillText(`Generated: ${info.generatedAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}`, TABLE_X, 119);
    ctx.strokeStyle = "#D9CDF0";
    ctx.beginPath(); ctx.moveTo(TABLE_X, 128); ctx.lineTo(PAGE_WIDTH - TABLE_X, 128); ctx.stroke();
    ctx.fillStyle = "#21132E";
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.fillText(page.section.title, TABLE_X, 149);

    let y = TABLE_Y;
    const drawGridRow = (cells: string[][], height: number, heading: boolean, shaded: boolean) => {
        const totalWidth = page.section.widths.reduce((sum, n) => sum + n, 0);
        ctx.fillStyle = heading ? "#F1EBFF" : shaded ? "#FAF8FD" : "#FFFFFF";
        ctx.fillRect(TABLE_X, y, totalWidth, height);
        let x = TABLE_X;
        cells.forEach((lines, i) => {
            const width = page.section.widths[i];
            ctx.strokeStyle = "#E3D8EA";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x, y, width, height);
            ctx.font = heading ? "bold 7.5px Arial, sans-serif" : "8px Arial, sans-serif";
            ctx.fillStyle = heading ? "#4E2C66" : "#21132E";
            lines.forEach((line, index) => ctx.fillText(line, x + 5, y + 12 + index * LINE_HEIGHT));
            x += width;
        });
        y += height;
    };
    ctx.font = "bold 7.5px Arial, sans-serif";
    const wrappedHeaders = page.section.headers.map((header, index) => wrapCell(ctx, header, page.section.widths[index] - 10));
    drawGridRow(wrappedHeaders, HEADING_HEIGHT, true, false);
    page.rows.forEach((row, i) => drawGridRow(row.cells, row.height, false, i % 2 === 1));
    ctx.fillStyle = "#806A8C";
    ctx.font = "9px Arial, sans-serif";
    ctx.fillText("StockNBook  |  Attendance records from the database", TABLE_X, PAGE_HEIGHT - 19);
    ctx.textAlign = "right";
    ctx.fillText(`Page ${pageIndex + 1} of ${totalPages}`, PAGE_WIDTH - TABLE_X, PAGE_HEIGHT - 19);
    ctx.textAlign = "left";
}

function saveJpegPagesAsPdf(images: Uint8Array[], imageWidth: number, imageHeight: number, filename: string) {
    const encoder = new TextEncoder();
    const pieces: BlobPart[] = [];
    let cursor = 0;
    const put = (content: string | Uint8Array) => {
        const bytes = typeof content === "string" ? encoder.encode(content) : content;
        pieces.push(bytes as BlobPart);
        cursor += bytes.byteLength;
    };
    const offsets: number[] = [];
    const obj = (id: number, writeContents: () => void) => {
        offsets[id] = cursor;
        put(`${id} 0 obj\n`);
        writeContents();
        put("\nendobj\n");
    };
    put("%PDF-1.4\n%StockNBook\n");
    obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => put(`<< /Type /Pages /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${images.length} >>`));
    images.forEach((jpeg, i) => {
        const base = 3 + i * 3;
        obj(base, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /PgImg ${base + 1} 0 R >> >> /Contents ${base + 2} 0 R >>`));
        obj(base + 1, () => {
            put(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
            put(jpeg);
            put("\nendstream");
        });
        const stream = `q\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm\n/PgImg Do\nQ\n`;
        obj(base + 2, () => put(`<< /Length ${encoder.encode(stream).byteLength} >>\nstream\n${stream}endstream`));
    });
    const xref = cursor;
    const count = 2 + 3 * images.length;
    put(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= count; id++) put(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    put(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const blob = new Blob(pieces, { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const element = document.createElement("a");
    element.href = url;
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    element.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportStaffAttendancePdf(options: StaffAttendancePdfOptions): Promise<void> {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(PAGE_WIDTH * SCALE);
    canvas.height = Math.round(PAGE_HEIGHT * SCALE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDF export is not supported by your browser.");
    context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    const pages = renderPages(context, sectionsFor(options));
    const images = pages.map((page, index) => {
        drawPage(context, page, index, pages.length, options);
        const raw = canvas.toDataURL("image/jpeg", 0.87).split(",")[1];
        const binary = atob(raw);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    });
    const filename = `StockNBook_Attendance_${safeFilePart(options.staffName)}_${options.startDate}_to_${options.endDate}.pdf`;
    saveJpegPagesAsPdf(images, canvas.width, canvas.height, filename);
}

function StaffAttendancePanel({ storeName, branchName, staffName, employeeNumber, currentDateTime, onNotify }: {
    storeName: string;
    branchName: string;
    staffName: string;
    employeeNumber: string;
    currentDateTime: Date;
    onNotify: (message: StaffActionToastMessage) => void;
}) {
    const [records, setRecords] = useState<StaffAttendanceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionPending, setActionPending] = useState(false);
    const [exportPending, setExportPending] = useState(false);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<"worked" | "exceptions">("worked");
    const [range, setRange] = useState<"month" | "90" | "all" | "day" | "custom">("month");
    const [filterDay, setFilterDay] = useState(() => formatLocalIsoDate(new Date()));
    const [filterStart, setFilterStart] = useState(() => formatLocalIsoDate(new Date()));
    const [filterEnd, setFilterEnd] = useState(() => formatLocalIsoDate(new Date()));
    const [todayAttendance, setTodayAttendance] = useState<StaffAttendanceRecord | null>(null);
    const [leaveOpen, setLeaveOpen] = useState(false);
    const [leaveMode, setLeaveMode] = useState<"single" | "range">("single");
    const [leaveDate, setLeaveDate] = useState("");
    const [leaveEndDate, setLeaveEndDate] = useState("");
    const [leaveReason, setLeaveReason] = useState("");
    const [leaveType, setLeaveType] = useState("Personal");
    const [refreshKey, setRefreshKey] = useState(0);

    const getDates = useCallback(() => {
        const now = new Date();
        const endDate = formatLocalIsoDate(now);
        if (range === "all") return { endDate, startDate: "2000-01-01" };
        if (range === "day") return { startDate: filterDay, endDate: filterDay };
        if (range === "custom") return { startDate: filterStart, endDate: filterEnd };
        const start = range === "month" ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);
        return { startDate: formatLocalIsoDate(start), endDate };
    }, [range, filterDay, filterStart, filterEnd]);
    const loadAttendance = useCallback(async () => {
        const token = getSavedItem("token");
        if (!token) { setLoading(false); setError("Please sign in to load attendance."); return; }
        const { startDate, endDate } = getDates();
        if (startDate > endDate) { setLoading(false); setError("Start date cannot be after end date."); return; }
        setLoading(true);
        try {
            const response = await fetch(`/api/staff-attendance?${new URLSearchParams({startDate, endDate})}`, {
                headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            const list = data.records ?? data.data?.records;
            if (!response.ok || data.success === false || !Array.isArray(list)) throw new Error(data.error || "Attendance service is unavailable.");
            setRecords(groupStaffLeaveHistory(list.map(formatAttendanceRecord)));
            setTodayAttendance(data.todayRecord ? formatAttendanceRecord(data.todayRecord) : null);
            setError("");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not load attendance records.");
            setRecords([]);
            setTodayAttendance(null);
        } finally { setLoading(false); }
    }, [getDates]);
    useEffect(() => { void loadAttendance(); }, [loadAttendance, refreshKey]);

    const today = formatLocalIsoDate(currentDateTime);
    const todayRecord = todayAttendance ?? records.find((record) => record.date.slice(0, 10) === today && Boolean(record.timeIn));
    const onDuty = Boolean(todayRecord?.timeIn && !todayRecord?.timeOut);
    const workedHours = todayRecord?.hoursWorked ?? (onDuty && todayRecord?.timeIn ? Math.max(0, (currentDateTime.getTime() - new Date(todayRecord.timeIn.replace(" ", "T")).getTime()) / 3_600_000) : null);
    const worked = records.filter((record) => Boolean(record.timeIn) || Boolean(record.timeOut));
    const exceptions = records.filter((record) => {
        const status = record.status.toLowerCase();
        return status.includes("absent") || status.includes("leave") || status === "pending" || status === "rejected";
    });
    const filtered = tab === "worked" ? worked : exceptions;

    const postAction = async (action: "time_in" | "time_out" | "request_leave") => {
        const token = getSavedItem("token");
        if (!token) { setError("Please sign in again."); onNotify({title:"Sign in required",message:"Please sign in again.",tone:"error"}); return; }
        setActionPending(true); setError("");
        try {
            const response = await fetch("/api/staff-attendance", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(action === "request_leave"
                    ? { action, start_date: leaveDate, end_date: leaveMode === "range" ? leaveEndDate : leaveDate,
                        reason: leaveReason.trim(), leave_type: leaveType }
                    : { action }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success === false) throw new Error(result.error || "Could not record attendance action.");
            if (action === "time_in") {
                onNotify({ title: "Time in recorded successfully", message: "Your attendance time in has been saved for today." });
            } else if (action === "time_out") {
                onNotify({ title: "Time out recorded successfully", message: "Your attendance time out has been saved for today." });
            } else {
                const selectedDates = leaveMode === "range" ? `${staffAttendanceDay(leaveDate)} – ${staffAttendanceDay(leaveEndDate)}` : staffAttendanceDay(leaveDate);
                onNotify({ title: "Leave request submitted", message: `Your ${leaveType.toLowerCase()} leave request for ${selectedDates} is pending approval.` });
            }
            setLeaveOpen(false); setLeaveReason(""); setLeaveDate(""); setLeaveEndDate("");
            setRefreshKey((value) => value + 1);
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : "Attendance request failed.";
            setError(message);
            onNotify({ title: "Action could not be completed", message, tone: "error" });
        } finally { setActionPending(false); }
    };

    const exportAttendance = async () => {
        const token = getSavedItem("token");
        if (!token) { setError("Please sign in again."); onNotify({title:"Sign in required",message:"Please sign in again.",tone:"error"}); return; }
        setExportPending(true); setError("");
        try {
            const { startDate, endDate } = getDates();
            if (startDate > endDate) throw new Error("Select a valid report date or range.");
            // Attendance is limited to the chosen period; leave requests include full history.
            // Export the full server-scoped range, not only visible scroll rows.
            const response = await fetch(`/api/staff-attendance?${new URLSearchParams({ startDate, endDate, export: "1" })}`, {
                headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
            });
            const payload = await response.json().catch(() => ({}));
            const list = payload.records ?? payload.data?.records;
            if (!response.ok || payload.success === false || !Array.isArray(list))
                throw new Error(payload.error || "Unable to fetch the complete attendance report.");
            const allRecords = groupStaffLeaveHistory(list.map(formatAttendanceRecord) as StaffAttendanceRecord[]);
            await exportStaffAttendancePdf({
                storeName, branchName, staffName, employeeNumber,
                startDate, endDate, generatedAt: new Date(),
                records: allRecords,
            });
            onNotify({ title: "Attendance PDF generated", message: `Prepared the attendance report for ${staffAttendanceDay(startDate)} – ${staffAttendanceDay(endDate)} (${allRecords.length} records).` });
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : "Attendance PDF export failed.";
            setError(message);
            onNotify({ title: "PDF export failed", message, tone: "error" });
        } finally { setExportPending(false); }
    };

    return <section className="flex h-[540px] min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9E1EE] px-4 py-3.5">
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><Clock3 size={18}/></span>
                <div><h2 className="text-[15px] font-bold text-[#21132E]">Attendance Log</h2><p className="mt-0.5 text-[11px] text-[#86778F]">Your attendance and leave history</p></div>
            </div>
            <button type="button" onClick={() => void exportAttendance()} disabled={exportPending || loading || Boolean(error)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D9CDF0] bg-white px-3 text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC] disabled:opacity-50">
                {exportPending ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>} Export
            </button>
        </div>
        <div className="mx-4 mt-3 grid grid-cols-3 gap-2 rounded-xl border border-[#E2EDE6] bg-[#F5FBF6] px-3 py-3">
            <div className="min-w-0"><p className="text-[10px] text-[#86778F]">Current Status</p><p className={`mt-1 text-xs font-bold ${onDuty ? "text-[#168449]" : "text-[#5A476A]"}`}>{loading ? "Loading..." : onDuty ? "● On Duty" : todayRecord?.timeOut ? "Completed" : "Not Clocked In"}</p></div>
            <div className="min-w-0 border-l border-[#E0E7E0] pl-3"><p className="text-[10px] text-[#86778F]">Time In</p><p className="mt-1 text-xs font-bold text-[#21132E]">{staffAttendanceClock(todayRecord?.timeIn || null)}</p></div>
            <div className="min-w-0 border-l border-[#E0E7E0] pl-3"><p className="text-[10px] text-[#86778F]">Hours Worked</p><p className="mt-1 text-xs font-bold text-[#21132E]">{staffAttendanceDuration(workedHours)}</p></div>
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 py-3">
            <button type="button" onClick={() => void postAction("time_in")} disabled={actionPending || loading || onDuty || Boolean(todayRecord) || Boolean(error)}
                    className="inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-[#E6F7EE] px-1 text-[11px] font-semibold text-[#148447] hover:bg-[#D7F0E1] disabled:opacity-50"><LogIn size={15}/>Time In</button>
            <button type="button" onClick={() => void postAction("time_out")} disabled={actionPending || loading || !onDuty || Boolean(error)}
                    className="inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-[#FDECEC] px-1 text-[11px] font-semibold text-[#B42318] hover:bg-[#FBE0E0] disabled:opacity-50"><LogOut size={15}/>Time Out</button>
            <button type="button" onClick={() => {setError(""); setLeaveOpen(true);}} disabled={actionPending}
                    className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-[#D9CDF0] bg-[#F9F6FC] px-1 text-[11px] font-semibold text-[#5A35A5] hover:bg-[#F1EBFF]"><CalendarX2 size={15}/>Request Leave</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEE8F2] px-4 py-2">
            <div className="flex items-center gap-3 text-[11px]">
                <button type="button" onClick={() => setTab("worked")} aria-pressed={tab === "worked"} className={`pb-1 font-semibold ${tab === "worked" ? "border-b-2 border-[#2B174C] text-[#2B174C]" : "text-[#86778F]"}`}>Attendance ({worked.length})</button>
                <button type="button" onClick={() => setTab("exceptions")} aria-pressed={tab === "exceptions"} className={`pb-1 font-semibold ${tab === "exceptions" ? "border-b-2 border-[#2B174C] text-[#2B174C]" : "text-[#86778F]"}`}>Absent / Leave ({exceptions.length})</button>
            </div>
            {tab === "exceptions" ?
                <span className="rounded-lg border border-[#E3D8EA] bg-[#F8F5FC] px-2.5 py-2 text-[10px] font-semibold text-[#5A476A]" title="All leave applications, including past and upcoming requests">All Leave Requests</span> :
                <select aria-label="Attendance date range" value={range} onChange={(event) => setRange(event.target.value as "month" | "90" | "all" | "day" | "custom")}
                        className="h-8 rounded-lg border border-[#E3D8EA] bg-white px-2 text-[10px] font-semibold text-[#2B174C]"><option value="month">This Month</option><option value="90">Last 90 Days</option><option value="all">All Records</option><option value="day">Specific Date</option><option value="custom">Date Range</option></select>}
        </div>
        {tab === "worked" && (range === "day" || range === "custom") && <div className="flex flex-wrap gap-2 border-t border-[#EEE8F2] px-4 py-2 text-[11px] text-[#5A476A]">
            <label className="flex items-center gap-2">{range === "day" ? "Date" : "From"}<input aria-label={range === "day" ? "Specific attendance date" : "Attendance start date"} type="date" value={range === "day" ? filterDay : filterStart}
                                                                                                 onChange={(event) => range === "day" ? setFilterDay(event.target.value) : setFilterStart(event.target.value)} className="h-8 rounded-lg border border-[#E3D8EA] bg-white px-2 text-[11px]"/></label>
            {range === "custom" && <label className="flex items-center gap-2">To<input aria-label="Attendance end date" type="date" min={filterStart} value={filterEnd} onChange={(event) => setFilterEnd(event.target.value)} className="h-8 rounded-lg border border-[#E3D8EA] bg-white px-2 text-[11px]"/></label>}
        </div>}
        {error && <div role="alert" className="mx-4 mb-2 rounded-lg bg-[#FFF0F0] px-3 py-2 text-[11px] text-[#B42318]">{error} <button type="button" className="ml-1 underline" onClick={() => void loadAttendance()}>Retry</button></div>}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <table className="w-full min-w-[410px] text-left text-[10px]">
                <thead className="sticky top-0 z-10 border-y border-[#EEE8F2] bg-[#FBF9FC] uppercase tracking-[0.04em] text-[#806A8C]">
                {tab === "worked" ? <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Time In</th><th className="px-3 py-2 font-semibold">Time Out</th><th className="px-3 py-2 font-semibold">Hours</th><th className="px-3 py-2 font-semibold">Status</th></tr>
                    : <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Reason</th><th className="px-3 py-2 font-semibold">Status</th></tr>}
                </thead>
                <tbody>
                {loading ? <tr><td colSpan={5} className="px-3 py-10 text-center text-[#86778F]">Loading attendance...</td></tr> : filtered.length === 0 ? <tr><td colSpan={5} className="px-3 py-10 text-center text-[#86778F]">{tab === "worked" ? "No attendance records for this period." : "No absences or leave requests recorded."}</td></tr>
                    : filtered.map((record, index) => <tr key={`${record.id}-${record.date}-${index}`} className="border-b border-[#F1ECF4] last:border-0 hover:bg-[#FCFAFE]">
                        {tab === "worked" ? <>
                            <td className="whitespace-nowrap px-3 py-2 text-[#5A476A]">{staffAttendanceDay(record.date)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{staffAttendanceClock(record.timeIn)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{staffAttendanceClock(record.timeOut)}</td>
                            <td className="px-3 py-2">{staffAttendanceDuration(record.hoursWorked)}</td>
                            <td className="px-3 py-2"><span className={`rounded-lg px-2 py-1 font-semibold ${record.timeOut ? "bg-[#E7F7ED] text-[#147D43]" : "bg-[#FFF4DF] text-[#A86905]"}`}>{staffAttendanceStatus(record)}</span></td>
                        </> : <>
                            <td className="whitespace-nowrap px-3 py-2 text-[#5A476A]">{staffAttendanceDay(record.date)}{record.endDate && record.endDate !== record.date ? ` – ${staffAttendanceDay(record.endDate)}` : ""}</td>
                            <td className="px-3 py-2 font-semibold">{record.leaveType || staffAttendanceStatus(record)}</td>
                            <td className="max-w-[190px] break-words px-3 py-2" title={record.reason}>{record.reason || "—"}</td>
                            <td className="px-3 py-2"><span className={`inline-flex rounded-lg px-2 py-1 font-semibold ${staffLeaveStatusStyle(staffLeaveStatus(record))}`}>{staffLeaveStatus(record)}</span></td>
                        </>}
                    </tr>)}
                </tbody>
            </table>
        </div>
        {leaveOpen && <div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-[#160C24]/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setLeaveOpen(false); }}>
            <form onSubmit={(event) => { event.preventDefault(); if (leaveDate && (leaveMode === "single" || (leaveEndDate && leaveEndDate >= leaveDate)) && leaveReason.trim()) void postAction("request_leave"); }}
                  className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
                <div><h3 className="text-base font-bold text-[#21132E]">Request Leave</h3><p className="mt-1 text-xs text-[#86778F]">Your request is submitted for approval, not automatically approved.</p></div>
                <div className="flex gap-2 rounded-xl bg-[#F7F1FF] p-1 text-xs font-semibold">
                    <button type="button" onClick={() => setLeaveMode("single")}
                            className={`flex-1 rounded-lg px-3 py-2 ${leaveMode === "single" ? "bg-[#2B174C] text-white" : "text-[#5A476A]"}`}>Specific Date</button>
                    <button type="button" onClick={() => setLeaveMode("range")}
                            className={`flex-1 rounded-lg px-3 py-2 ${leaveMode === "range" ? "bg-[#2B174C] text-white" : "text-[#5A476A]"}`}>Date Range</button>
                </div>
                <div className={`grid gap-3 ${leaveMode === "range" ? "sm:grid-cols-2" : ""}`}>
                    <label className="block text-xs font-semibold text-[#5A476A]">{leaveMode === "range" ? "From" : "Leave Date"}<input required type="date" min={today} value={leaveDate} onChange={(event) => setLeaveDate(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-[#E3D8EA] px-3 text-sm"/></label>
                    {leaveMode === "range" && <label className="block text-xs font-semibold text-[#5A476A]">To<input required type="date" min={leaveDate || today} value={leaveEndDate} onChange={(event) => setLeaveEndDate(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-[#E3D8EA] px-3 text-sm"/></label>}
                </div>
                <p className="text-[11px] text-[#86778F]">{leaveMode === "range" ? "Every date in the selected range will be submitted for approval." : "One leave date will be submitted for approval."}</p>
                <label className="block text-xs font-semibold text-[#5A476A]">Leave Type<select value={leaveType} onChange={(event) => setLeaveType(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-[#E3D8EA] px-3 text-sm"><option>Personal</option><option>Sick</option><option>Emergency</option><option>Vacation</option><option>Other</option></select></label>
                <label className="block text-xs font-semibold text-[#5A476A]">Reason<textarea required maxLength={1000} rows={3} value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} placeholder="State the reason for your leave" className="mt-1 w-full rounded-xl border border-[#E3D8EA] p-3 text-sm"/></label>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setLeaveOpen(false)} className="rounded-xl border border-[#E3D8EA] px-4 py-2 text-xs font-semibold text-[#2B174C]">Cancel</button><button type="submit" disabled={actionPending || !leaveDate || (leaveMode === "range" && (!leaveEndDate || leaveEndDate < leaveDate)) || leaveReason.trim().length < 3} className="rounded-xl bg-[#2B174C] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{actionPending ? "Submitting..." : "Submit Request"}</button></div>
            </form>
        </div>}
    </section>;
}

/* Staff-only receiving dialog mirrors the manager's validated receive_stock workflow.
 * Only StockNBook's products API decides whether the staff account can submit.
 * ManagerInventory.tsx is intentionally not modified. */
type InventoryPricingMethod = "manual" | "markup";
const staffReceiveLabelClass = "text-xs font-semibold text-[#5A476A]";
const staffReceiveFieldClass = "w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]";
function formatStaffNumber(value: number | string) { return Number(value || 0).toLocaleString("en-PH"); }
function formatStaffMoney(value: number | string) { return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function getStaffProductNumber(product: Product) { return String(product.productNumber ?? product.product_number ?? "").trim(); }
type ReceiveStockPricingDecision = "keep" | "suggested" | "manual";

type ReceiveStockLine = {
    variantId: number | null;
    variantNumber?: string | null;
    variantName: string;
    currentStock: number;
    currentAverageCost: number;
    currentSellingPrice: number;
    pricingMethod: InventoryPricingMethod;
    markupPercentage: number | null;
    pricingDecision: ReceiveStockPricingDecision;
    pricingMarkupInput: string;
    manualSellingPrice: string;
    quantity: string;
    unitPurchaseCost: string;
    expirationDate: string;
};

// This is the moving weighted average of remaining stock plus the new receipt,
// NOT the weighted moving average used by StockNBook demand forecasting.
function getStaffReceiveStockPriceReview(line: ReceiveStockLine) {
    const quantity = Math.max(0, Number(line.quantity) || 0);
    const currentStock = Math.max(0, line.currentStock);
    const incomingUnitCost = Math.max(0, Number(line.unitPurchaseCost) || 0);
    const totalUnits = currentStock + quantity;
    // Moving weighted-average inventory cost; when no stock remains the new
    // purchase becomes the entire cost basis. This is not WMA demand forecasting.
    const newAverageCost = totalUnits > 0
        ? Math.round(((currentStock * line.currentAverageCost + quantity * incomingUnitCost) /
        totalUnits + Number.EPSILON) * 100) / 100
        : incomingUnitCost;
    const markup = Number(line.pricingMarkupInput || 0);
    const suggestedPrice = Math.round((newAverageCost * (1 + markup / 100) + Number.EPSILON) * 100) / 100;
    const finalPrice = line.pricingDecision === "suggested"
        ? suggestedPrice
        : line.pricingDecision === "manual"
            ? Number(line.manualSellingPrice || 0)
            : line.currentSellingPrice;
    return { newAverageCost, markup, suggestedPrice, finalPrice };
}

function staffReceiveStockInitialMarkup(cost: number, sellingPrice: number, savedMarkup?: number | null) {
    if (savedMarkup !== null && savedMarkup !== undefined &&
        Number.isFinite(Number(savedMarkup)) && Number(savedMarkup) >= 0) {
        return String(savedMarkup);
    }
    // For products previously configured as manual, an implied markup provides
    // an editable starting suggestion; it does not force a change in pricing.
    return cost > 0 ? String(Number(Math.max(0, (sellingPrice / cost - 1) * 100).toFixed(4))) : "0";
}

function StaffReceiveStockDialog({ product, onClose, onSaved }: {
    product: Product;
    onClose: () => void;
    onSaved: (receivedQuantity: number) => Promise<void>;
}) {
    const [details, setDetails] = React.useState<Product>(product);
    const [lines, setLines] = React.useState<ReceiveStockLine[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const savingRef = React.useRef(false);
    const receivingRequestKey = React.useRef(crypto.randomUUID());
    const [error, setError] = React.useState("");
    const [supplier, setSupplier] = React.useState("");
    const [supplierOptions, setSupplierOptions] = React.useState<string[]>([]);
    const [invoice, setInvoice] = React.useState("");
    const [receivedDate, setReceivedDate] = React.useState(() =>
        new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Manila" })
    );
    const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "credit">("cash");
    const [amountPaid, setAmountPaid] = React.useState("0");
    const [dueDate, setDueDate] = React.useState("");

    React.useEffect(() => {
        const abort = new AbortController();
        setLoading(true);
        (async () => {
            try {
                const token = getSavedItem("token");
                if (!token) throw new Error("Session expired. Please sign in again.");
                // Fetch the authoritative cost/variant identifiers, not the redacted list view.
                const response = await fetch("/api/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_product_editor_details", id: product.id }),
                    cache: "no-store",
                    signal: abort.signal,
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.product) {
                    throw new Error(result.error || "Unable to load product receiving details.");
                }
                if (abort.signal.aborted) return;
                const current = result.product as Product;
                setDetails(current);
                const stockLines: ReceiveStockLine[] = current.hasVariants && (current.variants || []).length
                    ? (current.variants || []).map(v => ({
                        variantId: Number(v.id), variantNumber: v.variantNumber || null, variantName: getDashboardVariantName(v),
                        currentStock: Number(v.stock || 0),
                        currentAverageCost: Number(v.originalPrice || 0),
                        currentSellingPrice: Number(v.salesPrice || 0),
                        pricingMethod: v.pricingMethod === "markup" ? "markup" : "manual",
                        markupPercentage: v.markupPercentage == null ? null : Number(v.markupPercentage),
                        pricingDecision: Number(v.stock || 0) > 0 ? "keep" :
                            v.pricingMethod === "markup" ? "suggested" : "manual",
                        pricingMarkupInput: staffReceiveStockInitialMarkup(Number(v.originalPrice || 0),
                            Number(v.salesPrice || 0), v.markupPercentage),
                        manualSellingPrice: String(v.salesPrice ?? 0), quantity: "",
                        unitPurchaseCost: String(v.originalPrice ?? 0), expirationDate: "",
                    }))
                    : [{
                        variantId: null, variantName: "Regular",
                        currentStock: Number(current.stock || 0),
                        currentAverageCost: Number(current.originalPrice || 0),
                        currentSellingPrice: Number(current.salesPrice || 0),
                        pricingMethod: current.pricingMethod === "markup" ? "markup" : "manual",
                        markupPercentage: current.markupPercentage == null ? null : Number(current.markupPercentage),
                        pricingDecision: Number(current.stock || 0) > 0 ? "keep" :
                            current.pricingMethod === "markup" ? "suggested" : "manual",
                        pricingMarkupInput: staffReceiveStockInitialMarkup(Number(current.originalPrice || 0),
                            Number(current.salesPrice || 0), current.markupPercentage),
                        manualSellingPrice: String(current.salesPrice ?? 0), quantity: "",
                        unitPurchaseCost: String(current.originalPrice ?? 0), expirationDate: "",
                    }];
                setLines(stockLines);
                if (result.purchase?.supplier) setSupplier(String(result.purchase.supplier));
                // Optional suggestions only: users may also enter a new supplier.
                try {
                    const supplierResponse = await fetch("/api/products", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_stock_suppliers", branch_id: current.branchId }),
                        cache: "no-store", signal: abort.signal,
                    });
                    const supplierResult = await supplierResponse.json().catch(() => ({}));
                    if (!abort.signal.aborted && supplierResponse.ok && Array.isArray(supplierResult.suppliers)) {
                        setSupplierOptions(supplierResult.suppliers.filter((v: unknown): v is string => typeof v === "string"));
                    }
                } catch { /* Supplier suggestions are optional. */ }
            } catch (e) {
                if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load product.");
            } finally {
                if (!abort.signal.aborted) setLoading(false);
            }
        })();
        return () => abort.abort();
    }, [product.id]);

    const updateLine = (index: number, field: "quantity" | "unitPurchaseCost" | "expirationDate" |
        "pricingDecision" | "manualSellingPrice" | "pricingMarkupInput", value: string) => {
        setLines(previous => previous.map((line, i) => i === index ? { ...line, [field]: value } : line));
    };
    const totalQuantity = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    const totalCost = Math.round((lines.reduce((sum, line) => sum +
        (Number(line.quantity) || 0) * (Number(line.unitPurchaseCost) || 0), 0) + Number.EPSILON) * 100) / 100;
    const paid = paymentMethod === "cash" ? totalCost : Number(amountPaid || 0);
    const outstanding = Math.max(0, Math.round((totalCost - paid + Number.EPSILON) * 100) / 100);
    const stockBefore = details.hasVariants && (details.variants || []).length
        ? (details.variants || []).reduce((sum, v) => sum + Number(v.stock || 0), 0)
        : Number(details.stock || 0);

    const saveReceiving = async (event: React.SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (savingRef.current || loading) return;
        setError("");
        const selected = lines.filter(line => line.quantity.trim() !== "" && Number(line.quantity) > 0);
        if (!selected.length || lines.some(line => line.quantity.trim() !== "" &&
            (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 0))) {
            setError("Enter a positive whole quantity for at least one product or variant."); return;
        }
        if (selected.some(line => line.unitPurchaseCost.trim() === "" || !Number.isFinite(Number(line.unitPurchaseCost)) || Number(line.unitPurchaseCost) < 0)) {
            setError("Each selected item requires a valid nonnegative unit purchase cost."); return;
        }
        if (selected.some(line => line.pricingDecision === "manual" &&
            (!/^(?:\d+)(?:\.\d{1,2})?$/.test(line.manualSellingPrice.trim()) ||
                !Number.isFinite(Number(line.manualSellingPrice)) || Number(line.manualSellingPrice) > 100000000))) {
            setError("Final Selling Price must be a nonnegative peso amount with at most two decimal places."); return;
        }
        if (selected.some(line => line.pricingDecision === "suggested" &&
            (!/^(?:\d+)(?:\.\d{1,4})?$/.test(line.pricingMarkupInput.trim()) ||
                !Number.isFinite(Number(line.pricingMarkupInput)) || Number(line.pricingMarkupInput) > 99999 ||
                !Number.isFinite(getStaffReceiveStockPriceReview(line).suggestedPrice) ||
                getStaffReceiveStockPriceReview(line).suggestedPrice > 100000000))) {
            setError("Markup Percentage must be between 0 and 99999 (up to four decimal places) and produce a valid selling price."); return;
        }
        if (!supplier.trim() || !receivedDate) { setError("Supplier and Date Received are required."); return; }
        if (paymentMethod === "credit" && (!Number.isFinite(paid) || paid < 0 || paid > totalCost)) {
            setError("Amount Paid must be between zero and the total purchase cost."); return;
        }
        if (paymentMethod === "credit" && outstanding > 0 && !dueDate) {
            setError("Enter a Payment Due Date for the outstanding balance."); return;
        }
        if (dueDate && paymentMethod === "credit" && dueDate < receivedDate) {
            setError("Payment Due Date cannot be earlier than Date Received."); return;
        }
        if (selected.some(line => line.expirationDate && line.expirationDate < receivedDate)) {
            setError("A received batch cannot already be expired on its receiving date."); return;
        }
        savingRef.current = true;
        setSaving(true);
        try {
            const token = getSavedItem("token");
            if (!token) throw new Error("Session expired. Please sign in again.");
            const response = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    action: "receive_stock", requestKey: receivingRequestKey.current,
                    product_id: details.id,
                    branch_id: details.branchId,
                    supplier: supplier.trim(), supplierInvoiceNumber: invoice.trim() || null,
                    receivedDate, paymentMethod, amountPaid: paid,
                    paymentDueDate: paymentMethod === "credit" && outstanding > 0 ? dueDate : null,
                    lines: selected.map(line => ({
                        variantId: line.variantId, quantity: Number(line.quantity),
                        unitPurchaseCost: Number(line.unitPurchaseCost),
                        expirationDate: line.expirationDate || null,
                        pricingDecision: line.pricingDecision,
                        ...(line.pricingDecision === "manual" ? {
                            manualSellingPrice: Number(line.manualSellingPrice),
                        } : {}),
                        ...(line.pricingDecision === "suggested" ? {
                            pricingMarkupPercentage: Number(line.pricingMarkupInput),
                        } : {}),
                        expectedPricing: {
                            stock: line.currentStock,
                            averageCost: line.currentAverageCost,
                            sellingPrice: line.currentSellingPrice,
                            pricingMethod: line.pricingMethod,
                            markupPercentage: line.markupPercentage,
                        },
                    })),
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success !== true) {
                throw new Error(result.error || `Receive Stock failed (HTTP ${response.status}).`);
            }
            await onSaved(totalQuantity);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to receive stock.");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <div role="dialog" aria-modal="true" aria-label="Receive Stock"
             className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-3 py-5 font-sans">
            <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#E9E1EE] px-6 py-4">
                    <h2 className="text-xl font-bold text-[#21132E]">Receive Stock</h2>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close Receive Stock"
                            className="text-2xl text-[#806A8C] hover:text-[#2B174C] disabled:opacity-50">×</button>
                </div>
                <form onSubmit={saveReceiving} className="flex min-h-0 flex-col">
                    <div className="space-y-5 overflow-y-auto px-6 py-5">
                        <div>
                            <h3 className="text-base font-bold text-[#21132E]">{details.name}</h3>
                            <p className="mt-1 text-xs text-[#806A8C]">Product No. {getStaffProductNumber(details) || "—"} · {details.category}</p>
                            <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-[#F7F1FF] p-4">
                                <div><div className="text-xs text-[#806A8C]">Current Total Stock</div>
                                    <div className="mt-1 text-xl font-bold text-[#2B174C]">{formatStaffNumber(stockBefore)}</div></div>
                                <div><div className="text-xs text-[#806A8C]">Stock After Receiving</div>
                                    <div className="mt-1 text-xl font-bold text-[#2B174C]">{formatStaffNumber(stockBefore + totalQuantity)}</div></div>
                            </div>
                        </div>
                        {loading ? <p className="text-sm text-[#806A8C]">Loading receiving details...</p> : (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-bold text-[#21132E]">1. {details.hasVariants ? "Variants to Restock" : "Stock to Receive"}</h3>
                                    <p className="text-xs text-[#806A8C]">Enter received quantities and unit purchase costs. Leave other variants blank to keep them unchanged.</p>
                                    {lines.map((line, i) => (
                                        <div key={String(line.variantId ?? "regular")} className="space-y-3 rounded-xl border border-[#E3D8EA] p-4">
                                            <div className="flex justify-between gap-3">
                                                <div><strong className="text-sm text-[#2B174C]">{line.variantName}</strong>
                                                    {line.variantNumber && <p className="mt-1 text-[11px] text-[#806A8C]">Variant No. {line.variantNumber}</p>}</div>
                                                <span className="text-xs text-[#806A8C]">Current: {formatStaffNumber(line.currentStock)} pcs</span>
                                            </div>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="space-y-1"><label className={staffReceiveLabelClass}>Quantity to Add</label>
                                                    <input type="number" min="0" step="1" value={line.quantity}
                                                           onChange={e => updateLine(i, "quantity", e.target.value)}
                                                           placeholder="0" className={staffReceiveFieldClass}/></div>
                                                <div className="space-y-1"><label className={staffReceiveLabelClass}>Unit Purchase Cost (₱)</label>
                                                    <input type="number" min="0" step="0.01" value={line.unitPurchaseCost}
                                                           onChange={e => updateLine(i, "unitPurchaseCost", e.target.value)}
                                                           className={staffReceiveFieldClass}/></div>
                                            </div>
                                            <div className="space-y-1"><label className={staffReceiveLabelClass}>Expiration Date (Optional)</label>
                                                <input type="date" value={line.expirationDate}
                                                       onChange={e => updateLine(i, "expirationDate", e.target.value)}
                                                       className={staffReceiveFieldClass}/></div>
                                            <p className="text-xs text-[#806A8C]">Stock after receiving: {formatStaffNumber(line.currentStock + (Number(line.quantity) || 0))} pcs</p>
                                        </div>
                                    ))}
                                    <div className="flex justify-between border-t border-[#E3D8EA] pt-3 text-sm font-semibold text-[#2B174C]">
                                        <span>Total Stock to Add</span><span>+{formatStaffNumber(totalQuantity)} pcs</span>
                                    </div>
                                </section>
                                {lines.some(line => Number(line.quantity) > 0) && (
                                    <section className="space-y-4 border-t border-[#E3D8EA] pt-5">
                                        <h3 className="text-sm font-bold text-[#21132E]">Selling Price &amp; Pricing Method</h3>
                                        <p className="text-xs text-[#806A8C]">Review the pricing for each item being received. Changes are applied only after Confirm Stock In.</p>
                                        {lines.map((line, index) => {
                                            if (Number(line.quantity) <= 0) return null;
                                            const review = getStaffReceiveStockPriceReview(line);
                                            const hasRemainingStock = line.currentStock > 0;
                                            return (
                                                <div key={`price-${String(line.variantId ?? "regular")}`} className="space-y-4 rounded-xl border border-[#E3D8EA] bg-[#FDFBFF] p-4">
                                                    <h4 className="text-sm font-bold text-[#2B174C]">{details.hasVariants ? line.variantName : details.name}</h4>
                                                    {hasRemainingStock ? (
                                                        <>
                                                            <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#F7F1FF] p-3">
                                                                <div><p className="text-xs text-[#806A8C]">Current Selling Price</p>
                                                                    <strong className="text-lg text-[#2B174C]">{formatStaffMoney(line.currentSellingPrice)}</strong></div>
                                                                <div><p className="text-xs text-[#806A8C]">Suggested Selling Price</p>
                                                                    <strong className="text-lg text-[#2B174C]">{formatStaffMoney(review.suggestedPrice)}</strong></div>
                                                            </div>
                                                            <div className="space-y-1 text-xs text-[#5A476A]">
                                                                <div className="flex justify-between"><span>Existing / incoming stock</span><span>{formatStaffNumber(line.currentStock)} / +{formatStaffNumber(Number(line.quantity))} pcs</span></div>
                                                                <div className="flex justify-between"><span>Previous Average Unit Cost</span><span>{formatStaffMoney(line.currentAverageCost)}</span></div>
                                                                <div className="flex justify-between"><span>New Purchase Unit Cost</span><span>{formatStaffMoney(Number(line.unitPurchaseCost))}</span></div>
                                                                <div className="flex justify-between font-semibold"><span>New Weighted Average Unit Cost</span><span>{formatStaffMoney(review.newAverageCost)}</span></div>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <p className="rounded-lg bg-[#F7F1FF] p-3 text-xs text-[#5A476A]">
                                                            No remaining stock. The new unit cost is {formatStaffMoney(review.newAverageCost)}; choose the selling price for this receipt.
                                                        </p>
                                                    )}
                                                    <div className="grid gap-3 sm:grid-cols-2">
                                                        <div className="space-y-1">
                                                            <label className={staffReceiveLabelClass} htmlFor={`receiving-method-${index}`}>Pricing Method</label>
                                                            <select id={`receiving-method-${index}`} className={staffReceiveFieldClass}
                                                                    value={line.pricingDecision === "suggested" ? "markup" : "manual"}
                                                                    onChange={e => updateLine(index, "pricingDecision", e.target.value === "markup" ? "suggested" : "manual")}>
                                                                <option value="manual">Manual Selling Price</option>
                                                                <option value="markup">Percentage Markup</option>
                                                            </select>
                                                        </div>
                                                        {line.pricingDecision === "suggested" && (
                                                            <div className="space-y-1">
                                                                <label className={staffReceiveLabelClass} htmlFor={`receiving-markup-${index}`}>Markup Percentage (%)</label>
                                                                <input id={`receiving-markup-${index}`} type="number" min="0" max="99999" step="0.0001"
                                                                       value={line.pricingMarkupInput} required className={staffReceiveFieldClass}
                                                                       onChange={e => updateLine(index, "pricingMarkupInput", e.target.value)}/>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {hasRemainingStock && (
                                                        <fieldset className="space-y-2 text-sm text-[#2B174C]">
                                                            <legend className="mb-2 font-semibold">Selling Price Decision</legend>
                                                            <label className="flex items-center gap-2"><input type="radio" name={`receive-price-${index}`}
                                                                                                              checked={line.pricingDecision === "keep"} onChange={() => updateLine(index, "pricingDecision", "keep")}/>
                                                                Keep Current Selling Price — {formatStaffMoney(line.currentSellingPrice)}</label>
                                                            <label className="flex items-center gap-2"><input type="radio" name={`receive-price-${index}`}
                                                                                                              checked={line.pricingDecision === "suggested"} onChange={() => updateLine(index, "pricingDecision", "suggested")}/>
                                                                Apply Suggested Selling Price — {formatStaffMoney(review.suggestedPrice)}</label>
                                                            <label className="flex items-center gap-2"><input type="radio" name={`receive-price-${index}`}
                                                                                                              checked={line.pricingDecision === "manual"} onChange={() => updateLine(index, "pricingDecision", "manual")}/>
                                                                Set a Manual Selling Price</label>
                                                        </fieldset>
                                                    )}
                                                    <div className="space-y-1">
                                                        <label className={staffReceiveLabelClass} htmlFor={`receiving-final-price-${index}`}>Final Selling Price (₱)</label>
                                                        <input id={`receiving-final-price-${index}`} type="number" min="0" max="100000000" step="0.01"
                                                               value={line.pricingDecision === "manual" ? line.manualSellingPrice : String(review.finalPrice)}
                                                               readOnly={line.pricingDecision !== "manual"}
                                                               required={line.pricingDecision === "manual"}
                                                               onChange={e => updateLine(index, "manualSellingPrice", e.target.value)}
                                                               className={`${staffReceiveFieldClass} ${line.pricingDecision !== "manual" ? "bg-[#F7F1FF]" : ""}`}/>
                                                        {line.pricingDecision === "suggested" && (
                                                            <p className="text-xs text-[#806A8C]">Selling price = {formatStaffMoney(review.newAverageCost)} × (1 + {line.pricingMarkupInput || "0"} ÷ 100).</p>
                                                        )}
                                                        {hasRemainingStock && line.pricingDecision === "keep" && (
                                                            <p className="text-xs text-[#806A8C]">The current selling price stays unchanged. If it no longer matches the markup formula, the saved method becomes Manual.</p>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </section>
                                )}
                                <section className="space-y-3 border-t border-[#E3D8EA] pt-5">
                                    <h3 className="text-sm font-bold text-[#21132E]">2. Supplier &amp; Receiving Information</h3>
                                    <div className="space-y-1"><label className={staffReceiveLabelClass}>Supplier</label>
                                        <input list={`receive-stock-suppliers-${product.id}`} value={supplier} onChange={e => setSupplier(e.target.value)}
                                               maxLength={150} required placeholder="Select or enter supplier" className={staffReceiveFieldClass}/>
                                        <datalist id={`receive-stock-suppliers-${product.id}`}>
                                            {supplierOptions.map(name => <option key={name} value={name}/>) }
                                        </datalist></div>
                                    <div className="space-y-1"><label className={staffReceiveLabelClass}>Date Received</label>
                                        <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} required className={staffReceiveFieldClass}/></div>
                                    <div className="space-y-1"><label className={staffReceiveLabelClass}>Supplier Invoice Number (Optional)</label>
                                        <input value={invoice} onChange={e => setInvoice(e.target.value)} maxLength={80}
                                               placeholder="Enter invoice or receipt number" className={staffReceiveFieldClass}/></div>
                                </section>
                                <section className="space-y-3 border-t border-[#E3D8EA] pt-5">
                                    <h3 className="text-sm font-bold text-[#21132E]">3. Purchase Payment Details</h3>
                                    <div className="space-y-1"><label className={staffReceiveLabelClass}>Payment Method</label>
                                        <div className="flex gap-5 text-sm text-[#2B174C]">
                                            <label className="flex items-center gap-2"><input type="radio" checked={paymentMethod === "cash"}
                                                                                              onChange={() => setPaymentMethod("cash")}/>Cash</label>
                                            <label className="flex items-center gap-2"><input type="radio" checked={paymentMethod === "credit"}
                                                                                              onChange={() => setPaymentMethod("credit")}/>Credit (Utang)</label>
                                        </div></div>
                                    {paymentMethod === "credit" && (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <div className="space-y-1"><label className={staffReceiveLabelClass}>Amount Paid (₱)</label>
                                                <input type="number" value={amountPaid} min="0" step="0.01"
                                                       onChange={e => setAmountPaid(e.target.value)} className={staffReceiveFieldClass}/></div>
                                            <div className="space-y-1"><label className={staffReceiveLabelClass}>Payment Due Date</label>
                                                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={staffReceiveFieldClass}/></div>
                                        </div>
                                    )}
                                </section>
                                <section className="space-y-2 rounded-xl bg-[#F7F1FF] p-4 text-sm text-[#2B174C]">
                                    <h3 className="font-bold">Stock Receiving Summary</h3>
                                    <div className="flex justify-between"><span>Total Units Received</span><strong>{formatStaffNumber(totalQuantity)} pcs</strong></div>
                                    <div className="flex justify-between"><span>Total Purchase Cost</span><strong>{formatStaffMoney(totalCost)}</strong></div>
                                    <div className="flex justify-between"><span>Amount Paid</span><strong>{formatStaffMoney(paid)}</strong></div>
                                    <div className="flex justify-between border-t border-[#E3D8EA] pt-2"><strong>Outstanding Balance</strong><strong>{formatStaffMoney(outstanding)}</strong></div>
                                </section>
                            </>
                        )}
                        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                    </div>
                    <div className="flex justify-end gap-2 border-t border-[#E3D8EA] bg-white px-6 py-4">
                        <button type="button" onClick={onClose} disabled={saving}
                                className="rounded-xl border border-[#E3D8EA] px-5 py-2.5 text-sm font-semibold text-[#2B174C]">Cancel</button>
                        <button type="submit" disabled={loading || saving || totalQuantity <= 0}
                                className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                            {saving ? "Saving..." : "Confirm Stock In"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
