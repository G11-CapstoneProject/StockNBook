"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    Activity,
    AlertTriangle,
    BarChart3,
    CalendarClock,
    CalendarDays,
    CheckCircle2,
    ChevronRight,
    CreditCard,
    ClipboardList,
    Clock3,
    ListChecks,
    PackageCheck,
    PackageX,
    RefreshCw,
    ShoppingCart,
    Store,
    TriangleAlert,
    Zap,
} from "lucide-react";
import {
    DashboardExportMenu,
    exportTableAsDoc,
    exportTableAsExcel,
    exportTableAsPdf,
    type ExportContext,
    type ExportTable,
} from "./_shared";

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

type ProductVariant = {
    id?: number;
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
    productName: string;
    branchName: string;
    variantName: string;
    currentStock: number;
    alertLevel: number;
    status: StockAlertStatus;
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
            permission.fullAccess ??
            permission.full_access
        );
    }

    return false;
}

function hasDashboardInventoryRestockPermission(user: unknown) {
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

        const inventoryPermission =
            permissions.inventory_manage ??
            permissions.inventory_write ??
            permissions.manage_inventory ??
            permissions.inventory;

        if (inventoryPermission !== undefined) {
            return dashboardPermissionAllowsWrite(
                inventoryPermission,
            );
        }
    }

    const directPermission =
        userRecord.inventory_manage ??
        userRecord.inventory_write ??
        userRecord.manage_inventory ??
        userRecord.inventory;

    return dashboardPermissionAllowsWrite(directPermission);
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
    task: string;
    relatedTo: string;
    priority: StaffTaskPriority;
    status: "Pending" | "Completed";
};

type StaffOperationRow = {
    id: string;
    at: Date;
    time: string;
    title: string;
    detail: string;
    status: string;
    source: "booking" | "pos";
};

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

export default function StaffDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [bookingsError, setBookingsError] = useState("");
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(true);
    const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentDateTime(new Date());
        }, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const loadStaffDashboard = useCallback(async () => {
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
            setIsRefreshing(false);
            setHasLoadedDashboard(true);
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
                console.warn("Staff dashboard branches fetch failed:", error);
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
                        role: "staff",
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
                console.error("Staff dashboard bookings fetch failed:", error);
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
                console.warn("Staff dashboard products fetch failed:", error);
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
                console.warn("Staff dashboard orders fetch failed:", error);
            }
        } finally {
            setIsRefreshing(false);
            setHasLoadedDashboard(true);
        }
    }, [user]);

    useEffect(() => {
        // Load the dashboard once when the page opens.
        // After that, data refreshes only when the user presses Refresh.
        void loadStaffDashboard();
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
        branches[0]?.branchName || getAssignedBranchName(user);

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
            };
        });
    }, [todayBookings, currentDateTime]);

    const inventoryTaskRows = useMemo<StaffTaskRow[]>(() => {
        const stockTasks = allInventoryAlerts.slice(0, 3).map((item) => ({
            id: `stock-${item.id}`,
            task: `Verify stock: ${item.productName}`,
            relatedTo: "Inventory",
            priority: (item.status === "Out of Stock" ? "High" : "Medium") as StaffTaskPriority,
            status: "Pending" as const,
        }));

        const expiryTasks = allExpirationAlertItems
            .filter((item) => item.status === "Expired" || item.daysRemaining <= 7)
            .slice(0, 2)
            .map((item) => ({
                id: `expiry-${item.id}`,
                task: `Check expiry: ${item.productName}`,
                relatedTo: "Inventory",
                priority: (item.status === "Expired" || item.daysRemaining <= 2 ? "High" : "Medium") as StaffTaskPriority,
                status: "Pending" as const,
            }));

        return [...stockTasks, ...expiryTasks];
    }, [allInventoryAlerts, allExpirationAlertItems]);

    const allStaffTasks = useMemo(
        () => [...bookingTaskRows, ...inventoryTaskRows],
        [bookingTaskRows, inventoryTaskRows],
    );

    const pendingStaffTasks = useMemo(
        () => allStaffTasks.filter((task) => task.status === "Pending"),
        [allStaffTasks],
    );

    const visiblePendingTasks = pendingStaffTasks.slice(0, 5);

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

    const recentActivityOperations = [...todayOperations]
        .filter((operation) => operation.at.getTime() <= currentDateTime.getTime())
        .sort((first, second) => second.at.getTime() - first.at.getTime())
        .slice(0, 4);

    // Visual-only redesign: Staff data, actions, RBAC checks, routes, and calculations remain unchanged.
    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">
                            Staff Dashboard
                        </h1>
                        <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                            {greeting}, {staffFirstName}! Here&apos;s what you need to do today.
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {formatCurrentDashboardDateTime(currentDateTime)}
                        </span>

                        <button
                            type="button"
                            onClick={() => void loadStaffDashboard()}
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

            <section
                aria-busy={isRefreshing}
                className="min-h-[calc(100vh-88px)] bg-[#FFFDF8] px-6 py-5 font-sans"
            >
                <div className={`mx-auto max-w-none space-y-4 ${!hasLoadedDashboard ? "hidden" : ""}`}>
                    {bookingsError && (
                        <div className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs font-medium text-[#C32F2F]">
                            {bookingsError}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <SalesSummaryCard
                            title="Today&apos;s Bookings"
                            value={String(todayBookings.length)}
                            subtitle="Bookings scheduled today"
                            icon={<CalendarDays size={25} />}
                            tone="violet"
                        />
                        <SalesSummaryCard
                            title="Bookings to Prepare"
                            value={String(bookingsToPrepare.length)}
                            subtitle="Still require preparation"
                            icon={<ClipboardList size={25} />}
                            tone="green"
                        />
                        <SalesSummaryCard
                            title="Today&apos;s Transactions"
                            value={String(todayPosTransactions.length)}
                            subtitle="POS transactions processed today"
                            icon={<CreditCard size={25} />}
                            tone="blue"
                        />
                        <SalesSummaryCard
                            title="Pending Tasks"
                            value={String(pendingStaffTasks.length)}
                            subtitle="Tasks requiring action"
                            icon={<ListChecks size={25} />}
                            tone="red"
                        />
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-3">
                        <div className="min-w-0 xl:col-span-2">
                            <StaffTodayWorkPanel
                                operations={todayOperations}
                                attentionCount={pendingStaffTasks.length}
                                onOpenBooking={() => router.push("/bookings")}
                                onOpenPos={() => router.push("/pos")}
                            />
                        </div>

                        <div className="min-w-0">
                            <StaffReferenceQuickActionsPanel
                                onNewPos={() => router.push("/pos")}
                                onCreateBooking={() => router.push("/bookings")}
                                onConfirmBooking={() => router.push("/bookings")}
                                onPrepareBooking={() => router.push("/bookings")}
                                onFindBooking={() => router.push("/bookings")}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-3">
                        <div className="min-w-0">
                            <StaffPendingTasksCompactPanel
                                tasks={pendingStaffTasks.slice(0, 4)}
                                total={pendingStaffTasks.length}
                                bookings={todayBookings}
                                onOpenBooking={() => router.push("/bookings")}
                                onOpenInventory={() => router.push("/inventory")}
                            />
                        </div>

                        <div className="min-w-0">
                            <StaffBookingScheduleCompactPanel
                                bookings={todayBookings}
                                onOpenBooking={() => router.push("/bookings")}
                            />
                        </div>

                        <div className="min-w-0">
                            <StaffRecentActivityPanel operations={recentActivityOperations} />
                        </div>
                    </div>
                </div>
            </section>
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
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${style.background} ${style.icon}`}
      >
        {icon}
      </span>
            <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-5 text-[#4B3E55]">
                    {title}
                </p>
                <p className="mt-1 truncate text-[28px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">
                    {value}
                </p>
                <p className="mt-2 text-[11px] leading-4 text-[#8A7D92]">{subtitle}</p>
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

    let className = "bg-[#FFF4D9] text-[#A96700]";
    if (normalized.includes("complete") || normalized.includes("ready")) {
        className = "bg-[#E6F7EE] text-[#159455]";
    } else if (normalized.includes("confirm") || normalized.includes("prepar")) {
        className = "bg-[#EAF1FF] text-[#2563EB]";
    } else if (normalized.includes("cancel")) {
        className = "bg-[#FDECEC] text-[#DC2626]";
    }

    return (
        <span className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-[9px] font-semibold ${className}`}>
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
        <section className="flex h-full min-h-[344px] flex-col rounded-[14px] bg-white shadow-[0_1px_2px_rgba(23,12,48,0.04),0_10px_24px_-16px_rgba(23,12,48,0.28)]">
            <div className="flex min-h-[62px] items-center gap-2 border-b border-[#EEE8F2] px-4 py-2.5 text-[#6D35D4]">
                <span className="flex h-6 w-6 items-center justify-center">
                    <BarChart3 size={18} />
                </span>
                <div className="min-w-0">
                    <h2 className="truncate text-[18px] font-bold leading-6 text-[#24152F]">
                        Today&apos;s Efficiency
                    </h2>
                    <p className="truncate text-[9px] leading-5 text-[#8A7D92]">
                        Data-driven progress for today&apos;s operations
                    </p>
                </div>
            </div>

            <div className="flex flex-1 flex-col gap-3 px-4 py-3">
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

                <div className="flex items-center justify-between border-t border-[#F1ECF4] pt-2.5">
                    <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                            <ShoppingCart size={14} />
                        </span>
                        <span className="text-[10px] font-semibold text-[#4B3E55]">Transactions Processed</span>
                    </div>
                    <span className="text-[12px] font-bold text-[#24152F]">{transactionsProcessed}</span>
                </div>

                <div className="mt-auto rounded-xl bg-[#F8F5FC] px-3 py-2.5">
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

    const status = operation.status.toLowerCase();
    if (status.includes("pending") || status.includes("awaiting")) return "Confirm";
    if (status.includes("confirm") || status.includes("prepar")) return "Prepare";
    if (status.includes("ready") || status.includes("prepared")) return "Release";
    return "View";
}

function StaffTodayWorkPanel({
                                 operations,
                                 attentionCount,
                                 onOpenBooking,
                                 onOpenPos,
                             }: {
    operations: StaffOperationRow[];
    attentionCount: number;
    onOpenBooking: () => void;
    onOpenPos: () => void;
}) {
    const visible = operations.slice(0, 3);

    return (
        <section className="flex h-full min-h-[318px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-[#EEE8F2] px-5 py-4">
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

            <div className="min-h-0 flex-1 overflow-x-auto">
                <table className="w-full min-w-[760px] table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[9%]" />
                        <col className="w-[13%]" />
                        <col className="w-[43%]" />
                        <col className="w-[16%]" />
                        <col className="w-[19%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[35px] border-b border-[#EEE8F2]">
                        {["Type", "Time", "Work Item", "Status", "Action"].map((header) => (
                            <th
                                key={header}
                                className="px-4 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]"
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {visible.length === 0 ? (
                        <tr className="!border-0">
                            <td colSpan={5} className="!border-0 px-5 py-16 text-center text-[12px] text-[#8A7D92]">
                                No work items are scheduled for today yet.
                            </td>
                        </tr>
                    ) : (
                        visible.map((operation) => {
                            const actionLabel = getStaffOperationActionLabel(operation);
                            const isPos = operation.source === "pos";
                            const completed = operation.status.toLowerCase().includes("complete");
                            const iconTone = isPos
                                ? "bg-[#E6F7EE] text-[#159455]"
                                : completed
                                    ? "bg-[#EAF1FF] text-[#2563EB]"
                                    : "bg-[#F1EBFF] text-[#6D35D4]";
                            const isPrimary = actionLabel === "Confirm";

                            return (
                                <tr
                                    key={operation.id}
                                    className="!border-0 transition hover:bg-[#FCFAFE]"
                                >
                                    <td className="!border-0 px-4 py-3.5">
                                        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${iconTone}`}>
                                            {isPos ? (
                                                <ShoppingCart size={15} />
                                            ) : actionLabel === "Prepare" ? (
                                                <PackageCheck size={15} />
                                            ) : (
                                                <CalendarDays size={15} />
                                            )}
                                        </span>
                                    </td>
                                    <td className="!border-0 px-4 py-3.5 text-[10px] font-semibold text-[#5F4E75]">
                                        {operation.time}
                                    </td>
                                    <td className="!border-0 px-4 py-3.5">
                                        <p className="truncate text-[11px] font-semibold leading-4 text-[#24152F]">
                                            {operation.title}
                                        </p>
                                        <p
                                            className="mt-1.5 truncate text-[9px] leading-4 text-[#8A7D92]"
                                            title={operation.detail}
                                        >
                                            {operation.detail}
                                        </p>
                                    </td>
                                    <td className="!border-0 px-4 py-3.5">
                                        <StaffStatusBadge status={operation.status} />
                                    </td>
                                    <td className="!border-0 px-4 py-3.5">
                                        <button
                                            type="button"
                                            onClick={isPos ? onOpenPos : onOpenBooking}
                                            className={
                                                isPrimary
                                                    ? "inline-flex h-8 min-w-[86px] items-center justify-center rounded-lg bg-[#6D35D4] px-3 text-[9px] font-semibold text-white transition hover:bg-[#5D2BBE]"
                                                    : "inline-flex h-8 min-w-[86px] items-center justify-center rounded-lg bg-[#F1EBFF] px-3 text-[9px] font-semibold text-[#6D35D4] transition hover:bg-[#E8DEFA]"
                                            }
                                        >
                                            <span>{actionLabel}</span>
                                            <ChevronRight size={12} className="ml-1" />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function StaffReferenceQuickActionsPanel({
                                             onNewPos,
                                             onCreateBooking,
                                             onConfirmBooking,
                                             onPrepareBooking,
                                             onFindBooking,
                                         }: {
    onNewPos: () => void;
    onCreateBooking: () => void;
    onConfirmBooking: () => void;
    onPrepareBooking: () => void;
    onFindBooking: () => void;
}) {
    const actions = [
        {
            title: "New POS Transaction",
            icon: <ShoppingCart size={17} />,
            className: "bg-[#F1EBFF] text-[#6D35D4]",
            iconClassName: "bg-[#F1EBFF] text-[#6D35D4]",
            onClick: onNewPos,
        },
        {
            title: "Create Booking",
            icon: <CalendarDays size={17} />,
            className: "bg-[#EAF1FF] text-[#2563EB]",
            iconClassName: "bg-[#EAF1FF] text-[#2563EB]",
            onClick: onCreateBooking,
        },
        {
            title: "Confirm Booking",
            icon: <CheckCircle2 size={17} />,
            className: "bg-[#E6F7EE] text-[#159455]",
            iconClassName: "bg-[#E6F7EE] text-[#159455]",
            onClick: onConfirmBooking,
        },
        {
            title: "Prepare Booking",
            icon: <PackageCheck size={17} />,
            className: "bg-[#FFF0E5] text-[#E66B20]",
            iconClassName: "bg-[#FFF0E5] text-[#E66B20]",
            onClick: onPrepareBooking,
        },
        {
            title: "Find Booking",
            icon: <CalendarClock size={17} />,
            className: "bg-[#F1EBFF] text-[#6D35D4]",
            iconClassName: "bg-[#F1EBFF] text-[#6D35D4]",
            onClick: onFindBooking,
        },
    ];

    return (
        <section className="flex h-full min-h-[318px] flex-col rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                    <Zap size={18} />
                </span>
                <div>
                    <h2 className="text-[15px] font-bold leading-5 text-[#1A1220]">Quick Actions</h2>
                    <p className="mt-0.5 text-[11px] text-[#9A8DA8]">Get things done faster.</p>
                </div>
            </div>

            <div className="mt-3 flex flex-1 flex-col justify-between gap-2">
                {actions.map((action) => (
                    <button
                        key={action.title}
                        type="button"
                        onClick={action.onClick}
                        className={`flex min-h-[44px] items-center justify-between rounded-lg px-3 py-2 text-left transition hover:brightness-[0.98] ${action.className}`}
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
                                           onOpenBooking,
                                           onOpenInventory,
                                       }: {
    tasks: StaffTaskRow[];
    total: number;
    bookings: Booking[];
    onOpenBooking: () => void;
    onOpenInventory: () => void;
}) {
    const getDue = (task: StaffTaskRow) => {
        const booking = bookings.find(
            (item) =>
                compactDashboardReference("BK", item.bookingNumber, item.id) === task.relatedTo,
        );
        return booking
            ? formatDashboardTime(booking.date, booking.time) || "Today"
            : "Today";
    };

    return (
        <section
            id="staff-pending-tasks"
            className="flex h-full min-h-[292px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm"
        >
            <div className="flex items-center justify-between gap-4 border-b border-[#EEE8F2] px-5 py-4">
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

                <button
                    type="button"
                    onClick={
                        tasks.some((task) => task.relatedTo.toLowerCase() === "inventory")
                            ? onOpenInventory
                            : onOpenBooking
                    }
                    className="shrink-0 rounded-lg bg-[#F7F2FC] px-3 py-2 text-[10px] font-semibold text-[#6D35D4] transition hover:bg-[#F1EBFF]"
                >
                    View All →
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-x-auto">
                <table className="w-full min-w-[560px] table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[17%]" />
                        <col className="w-[31%]" />
                        <col className="w-[20%]" />
                        <col className="w-[15%]" />
                        <col className="w-[17%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[35px] border-b border-[#EEE8F2]">
                        {["Priority", "Task", "Related To", "Due", "Action"].map((header) => (
                            <th
                                key={header}
                                className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]"
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {tasks.length === 0 ? (
                        <tr className="!border-0">
                            <td colSpan={5} className="!border-0 px-4 py-14 text-center text-[11px] text-[#8A7D92]">
                                No pending tasks right now.
                            </td>
                        </tr>
                    ) : (
                        tasks.map((task) => {
                            const action = getCompactTaskAction(task);
                            const inventoryTask = task.relatedTo.toLowerCase() === "inventory";

                            return (
                                <tr
                                    key={task.id}
                                    className="!border-0 transition hover:bg-[#FCFAFE]"
                                >
                                    <td className="!border-0 px-3 py-3.5">
                                        <StaffPriorityBadge priority={task.priority} />
                                    </td>
                                    <td className="!border-0 px-3 py-3.5">
                                        <p
                                            className="truncate text-[10px] font-semibold leading-4 text-[#24152F]"
                                            title={task.task}
                                        >
                                            {task.task}
                                        </p>
                                    </td>
                                    <td className="!border-0 px-3 py-3.5 text-[9px] font-medium text-[#6F617A]">
                                        <span className="block truncate" title={task.relatedTo}>
                                            {task.relatedTo}
                                        </span>
                                    </td>
                                    <td className="!border-0 px-3 py-3.5 text-[9px] font-semibold text-[#5F4E75]">
                                        {getDue(task)}
                                    </td>
                                    <td className="!border-0 px-3 py-3.5">
                                        <button
                                            type="button"
                                            onClick={inventoryTask ? onOpenInventory : onOpenBooking}
                                            className="inline-flex min-w-[62px] justify-center rounded-lg bg-[#F1EBFF] px-2.5 py-2 text-[9px] font-semibold text-[#6D35D4] transition hover:bg-[#E8DEFA]"
                                        >
                                            {action}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function StaffBookingScheduleCompactPanel({
                                              bookings,
                                              onOpenBooking,
                                          }: {
    bookings: Booking[];
    onOpenBooking: () => void;
}) {
    const visible = bookings.slice(0, 3);

    return (
        <section className="flex h-full min-h-[292px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex min-h-[62px] items-center gap-2.5 border-b border-[#EEE8F2] px-4 py-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                    <CalendarDays size={17} />
                </span>
                <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-bold text-[#1A1220]">Today&apos;s Booking Schedule</h2>
                    <p className="mt-0.5 truncate text-[11px] text-[#9A8DA8]">Your schedule for today.</p>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-x-auto">
                <table className="w-full table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[16%]" />
                        <col className="w-[39%]" />
                        <col className="w-[22%]" />
                        <col className="w-[23%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[35px] border-b border-[#EEE8F2]">
                        {['Time', 'Customer / Event', 'Status', 'Next Action'].map((header) => (
                            <th key={header} className="px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.04em] text-[#806A8C]">
                                {header}
                            </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {visible.length === 0 ? (
                        <tr>
                            <td colSpan={4} className="px-4 py-12 text-center text-[11px] text-[#8A7D92]">
                                No bookings scheduled for today.
                            </td>
                        </tr>
                    ) : (
                        visible.map((booking) => {
                            const status = normalizeDashboardBookingStatus(booking.status);
                            const action = getStaffBookingAction(booking);
                            return (
                                <tr key={booking.id} className="border-b border-[#F1ECF4] last:border-b-0">
                                    <td className="px-2 py-2.5 text-[10px] font-semibold text-[#2B174C]">{formatDashboardTime(booking.date, booking.time) || '—'}</td>
                                    <td className="px-2 py-2.5">
                                        <p className="truncate text-[10px] font-semibold text-[#24152F]" title={booking.name}>{booking.name}</p>
                                        <p className="truncate text-[9px] text-[#8A7D92]" title={booking.eventName || booking.packageName || ''}>{booking.eventName || booking.packageName || 'Booking'}</p>
                                    </td>
                                    <td className="px-2 py-2.5"><StaffStatusBadge status={status} /></td>
                                    <td className="px-2 py-2.5">
                                        <button
                                            type="button"
                                            onClick={onOpenBooking}
                                            className="inline-flex min-w-[60px] justify-center rounded-lg bg-[#FAF8FF] px-2 py-1.5 text-[8px] font-semibold text-[#6D35D4] transition hover:bg-[#F1EBFF]"
                                        >
                                            {action}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function StaffRecentActivityPanel({ operations }: { operations: StaffOperationRow[] }) {
    return (
        <section className="flex h-full min-h-[292px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
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

            <div className="min-h-0 flex-1 overflow-x-auto">
                <table className="w-full min-w-[430px] table-fixed border-collapse">
                    <colgroup>
                        <col className="w-[21%]" />
                        <col className="w-[39%]" />
                        <col className="w-[18%]" />
                        <col className="w-[22%]" />
                    </colgroup>
                    <thead className="bg-[#FBFAFD]">
                    <tr className="h-[35px] border-b border-[#EEE8F2]">
                        {["Type", "Activity", "Time", "Status"].map((header) => (
                            <th
                                key={header}
                                className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.05em] text-[#806A8C]"
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

                            return (
                                <tr
                                    key={operation.id}
                                    className="!border-0 transition hover:bg-[#FCFAFE]"
                                >
                                    <td className="!border-0 px-3 py-3.5">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                                                    isPos
                                                        ? "bg-[#E6F7EE] text-[#159455]"
                                                        : "bg-[#F1EBFF] text-[#6D35D4]"
                                                }`}
                                            >
                                                {isPos ? <ShoppingCart size={13} /> : <CalendarDays size={13} />}
                                            </span>
                                            <span className="truncate text-[9px] font-semibold text-[#5F4E75]">
                                                {isPos ? "POS" : "Booking"}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="!border-0 px-3 py-3.5">
                                        <p className="truncate text-[10px] font-semibold leading-4 text-[#24152F]">
                                            {operation.title}
                                        </p>
                                        <p
                                            className="mt-1.5 truncate text-[9px] leading-4 text-[#8A7D92]"
                                            title={operation.detail}
                                        >
                                            {operation.detail}
                                        </p>
                                    </td>
                                    <td className="!border-0 px-3 py-3.5 text-[9px] font-semibold text-[#5F4E75]">
                                        {operation.time}
                                    </td>
                                    <td className="!border-0 px-3 py-3.5">
                                        <StaffStatusBadge status={operation.status} />
                                    </td>
                                </tr>
                            );
                        })
                    )}
                    </tbody>
                </table>
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