"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    AlertTriangle,
    BarChart3,
    Box,
    CalendarClock,
    CalendarDays,
    ArrowRight,
    LogIn,
    LogOut,
    Info,
    PackageX,
    RefreshCw,
    Sparkles,
    TriangleAlert,
    Wrench as MdWrench, Wallet as MdWallet, Users as MdUsers, Bell as MdBell,
    X as MdX, CheckCircle2 as MdCheckCircle, Download as MdDownload, Search as MdSearch,
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
    createdAt?: string;
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
        createdAt: readText(raw, ["createdAt", "created_at"]),
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
    const rawItems = firstDefined(raw, ["items", "orderItems", "order_items"]);
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
                variantNumber: readText(variant, ["variantNumber", "variant_number"]) || null,
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



/* ----------------------------------------------------------------------- */
/* Initial dashboard skeleton                                               */
/* ----------------------------------------------------------------------- */

function ManagerSkeletonBar({ className = "" }: { className?: string }) {
    return <div className={`rounded-full bg-[#ECE7F0] ${className}`} />;
}

function ManagerMetricSkeleton() {
    return (
        <div className="flex min-h-[128px] items-center gap-4 rounded-2xl border border-[#E9E0EF] bg-white px-5 py-4 shadow-sm">
            <div className="h-14 w-14 shrink-0 rounded-full bg-[#EEE9F4]" />
            <div className="min-w-0 flex-1">
                <ManagerSkeletonBar className="h-3 w-28" />
                <ManagerSkeletonBar className="mt-3 h-7 w-12" />
                <ManagerSkeletonBar className="mt-3 h-2.5 w-36 max-w-full" />
            </div>
        </div>
    );
}

function ManagerDonutSkeleton() {
    return (
        <div className="h-full min-h-[350px] rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#EEE9F4]" />
                    <div>
                        <ManagerSkeletonBar className="h-3.5 w-28" />
                        <ManagerSkeletonBar className="mt-2 h-2.5 w-40" />
                    </div>
                </div>
                <div className="h-8 w-20 rounded-lg bg-[#F1EDF4]" />
            </div>

            <div className="mt-12 flex items-center justify-center gap-8">
                <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full border-[20px] border-[#EEE9F2]">
                    <div className="space-y-2 text-center">
                        <ManagerSkeletonBar className="mx-auto h-6 w-10" />
                        <ManagerSkeletonBar className="mx-auto h-2.5 w-16" />
                    </div>
                </div>
                <div className="w-full max-w-[150px] space-y-4">
                    {[0, 1, 2, 3].map((item) => (
                        <div key={item} className="flex items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-full bg-[#E7E1EC]" />
                            <ManagerSkeletonBar className="h-2.5 flex-1" />
                            <ManagerSkeletonBar className="h-2.5 w-7" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ManagerAttentionSkeleton() {
    return (
        <div className="h-full min-h-[350px] overflow-hidden rounded-2xl border border-[#E9E0EF] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#EEE7F2] p-4">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#F3EDEE]" />
                    <div>
                        <ManagerSkeletonBar className="h-3.5 w-36" />
                        <ManagerSkeletonBar className="mt-2 h-2.5 w-44" />
                    </div>
                </div>
                <div className="h-8 w-16 rounded-lg bg-[#F1EDF4]" />
            </div>
            <div className="grid grid-cols-[1.4fr_.8fr_.7fr] gap-3 border-b border-[#F0EAF3] px-4 py-3">
                <ManagerSkeletonBar className="h-2.5 w-16" />
                <ManagerSkeletonBar className="h-2.5 w-14" />
                <ManagerSkeletonBar className="h-2.5 w-12" />
            </div>
            <div className="divide-y divide-[#F3EEF5]">
                {[0, 1, 2, 3, 4].map((item) => (
                    <div key={item} className="grid grid-cols-[1.4fr_.8fr_.7fr] items-center gap-3 px-4 py-4">
                        <div>
                            <ManagerSkeletonBar className="h-2.5 w-32 max-w-full" />
                            <ManagerSkeletonBar className="mt-2 h-2 w-20" />
                        </div>
                        <ManagerSkeletonBar className="h-2.5 w-16" />
                        <div className="h-5 w-16 rounded-full bg-[#F1EDEF]" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function ManagerTrendSkeleton() {
    return (
        <div className="min-h-[300px] rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#EEE9F4]" />
                    <div>
                        <ManagerSkeletonBar className="h-3.5 w-32" />
                        <ManagerSkeletonBar className="mt-2 h-2.5 w-48" />
                    </div>
                </div>
                <div className="h-8 w-24 rounded-lg bg-[#F1EDF4]" />
            </div>
            <div className="relative mt-6 h-[185px] overflow-hidden rounded-xl">
                {[20, 60, 100, 140].map((top) => (
                    <div key={top} className="absolute left-8 right-3 h-px bg-[#F0EBF3]" style={{ top }} />
                ))}
                <svg viewBox="0 0 700 180" className="absolute inset-0 h-full w-full" aria-hidden="true">
                    <path d="M35 130 L120 112 L205 124 L290 92 L375 105 L460 70 L545 95 L665 78" fill="none" stroke="#E4DEE9" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M35 145 L120 138 L205 142 L290 126 L375 130 L460 110 L545 120 L665 115" fill="none" stroke="#EEE8F2" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="absolute bottom-1 left-8 right-3 flex justify-between">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((item) => (
                        <div key={item} className="h-2 w-8 rounded-full bg-[#EEE9F2]" />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ManagerForecastSkeleton() {
    return (
        <div className="min-h-[300px] rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#EEE9F4]" />
                    <div>
                        <ManagerSkeletonBar className="h-3.5 w-32" />
                        <ManagerSkeletonBar className="mt-2 h-2.5 w-44" />
                    </div>
                </div>
                <div className="h-8 w-20 rounded-lg bg-[#F1EDF4]" />
            </div>
            <div className="mt-5 divide-y divide-[#F2EDF4]">
                {[0, 1, 2].map((item) => (
                    <div key={item} className="grid grid-cols-[1.45fr_.65fr_.65fr_.55fr] items-center gap-3 py-4">
                        <div>
                            <ManagerSkeletonBar className="h-2.5 w-44 max-w-full" />
                            <ManagerSkeletonBar className="mt-2 h-2 w-28" />
                        </div>
                        <div className="h-5 w-16 rounded-full bg-[#F1EDF4]" />
                        <div>
                            <ManagerSkeletonBar className="h-2 w-10" />
                            <ManagerSkeletonBar className="mt-2 h-3 w-14" />
                        </div>
                        <div>
                            <ManagerSkeletonBar className="h-2 w-10" />
                            <ManagerSkeletonBar className="mt-2 h-3 w-12" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ManagerDashboardSkeleton() {
    return (
        <div className="mx-auto max-w-none space-y-4 animate-pulse" role="status" aria-label="Loading manager dashboard">
            <span className="sr-only">Loading manager dashboard data</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
                {[0, 1, 2, 3].map((item) => <ManagerMetricSkeleton key={item} />)}
            </div>
            <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-hidden="true">
                <ManagerDonutSkeleton />
                <ManagerDonutSkeleton />
                <ManagerAttentionSkeleton />
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" aria-hidden="true">
                <ManagerAttentionSkeleton />
                <ManagerAttentionSkeleton />
            </div>
        </div>
    );
}

export default function ManagerDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();
    const [, setBookings] = useState<Booking[]>([]);
    const [bookingsError, setBookingsError] = useState("");
    const [, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);
    const [showStockAlertsModal, setShowStockAlertsModal] = useState(false);
    const [stockAlertFilter, setStockAlertFilter] = useState<"all" | "low" | "out">("all");
    const [rentalMaintenance, setRentalMaintenance] = useState<number | null>(null);
    const [staffSummary, setStaffSummary] = useState<MDStaffSummary | null>(null);
    const [mayReviewLeave, setMayReviewLeave] = useState(false);
    const [staffRecords, setStaffRecords] = useState<MDStaffAttendance[]>([]);
    const [managerAttendance, setManagerAttendance] = useState<MDManagerAttendance[]>([]);
    const [teamAttendance, setTeamAttendance] = useState<MDTeamAttendance[]>([]);
    const [myLogsOpen, setMyLogsOpen] = useState(false);
    const [teamAttendanceFilter, setTeamAttendanceFilter] = useState("month");
    const [teamAttendanceSearch, setTeamAttendanceSearch] = useState("");
    const [managerClockToday, setManagerClockToday] = useState<MDManagerAttendance | null>(null);
    const [managerClockBusy, setManagerClockBusy] = useState(false);
    const [managerClockFilter, setManagerClockFilter] = useState("month");
    // Match the Staff Attendance Log UI without changing the manager API workflow.
    const [managerAttendanceTab, setManagerAttendanceTab] = useState<"worked" | "exceptions">("worked");
    const [managerAttendanceRange, setManagerAttendanceRange] = useState<"month" | "90" | "all" | "day" | "custom">("month");
    const [managerAttendanceDay, setManagerAttendanceDay] = useState(() => mdLocalDay(new Date()));
    const [managerAttendanceStart, setManagerAttendanceStart] = useState(() => mdLocalDay(new Date()));
    const [managerAttendanceEnd, setManagerAttendanceEnd] = useState(() => mdLocalDay(new Date()));
    const [managerClockError, setManagerClockError] = useState("");
    const [managerLeaveOpen, setManagerLeaveOpen] = useState(false);
    const [managerLeaveMode, setManagerLeaveMode] = useState<"single" | "range">("single");
    const [managerLeaveDate, setManagerLeaveDate] = useState("");
    const [managerLeaveEndDate, setManagerLeaveEndDate] = useState("");
    const [managerLeaveType, setManagerLeaveType] = useState("Personal");
    const [managerLeaveReason, setManagerLeaveReason] = useState("");
    const [managerLeaveBusy, setManagerLeaveBusy] = useState(false);
    const [managerLeaveError, setManagerLeaveError] = useState("");
    const [leaveRows, setLeaveRows] = useState<MDLeaveRow[]>([]);
    const [staffError, setStaffError] = useState("");
    const [payables, setPayables] = useState<MDPayable[]>([]);
    const [payablesError, setPayablesError] = useState("");
    const [stockSearch, setStockSearch] = useState("");
    const [stockStatusFilter, setStockStatusFilter] = useState("all");
    const [leaveStatusFilter, setLeaveStatusFilter] = useState("all");
    const [leaveTypeFilter, setLeaveTypeFilter] = useState("all");
    const [payableSearch, setPayableSearch] = useState("");
    const [selectedLeave, setSelectedLeave] = useState<MDLeaveGroup | null>(null);
    const [decisionReason, setDecisionReason] = useState("");
    const [decisionBusy, setDecisionBusy] = useState(false);
    const [decisionError, setDecisionError] = useState("");
    const [selectedPayable, setSelectedPayable] = useState<MDPayable | null>(null);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentBusy, setPaymentBusy] = useState(false);
    const paymentKeyRef = useRef("");
    const payingRef = useRef(false);
    const [paymentError, setPaymentError] = useState("");
    const [toast, setToast] = useState<{ title: string; message: string; error?: boolean } | null>(null);
    const dashboardStoreId = getUserValue(user, "store_id") || getUserValue(user, "storeId") ||
        getSavedItem("store_id") || getSavedItem("stocknbook_store_id");
    const dashboardBranchId = getAssignedBranchId(user);
    const loadInFlightRef = useRef(false);
    useEffect(() => {
        const timer = window.setInterval(() => setCurrentDateTime(new Date()), 30_000);
        return () => window.clearInterval(timer);
    }, []);
    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), 5500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const loadManagerDashboard = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const token = getSavedItem("token");
        if (!token || !dashboardBranchId) {
            setBookingsError("No valid manager session or branch assignment was found.");
            setIsRefreshing(false);
            setHasLoadedDashboard(true);
            return;
        }
        if (loadInFlightRef.current) return;
        loadInFlightRef.current = true;
        if (!silent) setIsRefreshing(true);
        setBookingsError("");
        try {
            const now = new Date();
            const ordersStart = new Date(now);
            ordersStart.setDate(ordersStart.getDate() - 30);
            // All dashboard read operations run together, not sequentially.
            const [bookingsResult, productsResult, ordersResult, staffResult, rentalResult] =
                await Promise.allSettled([
                    fetch("/api/bookings", {
                        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_booking_page_bookings", role: "manager",
                            store_id: dashboardStoreId ? Number(dashboardStoreId) : undefined,
                            branch_id: Number(dashboardBranchId) }), cache: "no-store",
                    }),
                    fetch("/api/products", { method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_products", branch_id: Number(dashboardBranchId) }),
                        cache: "no-store",
                    }),
                    fetch("/api/pos", { method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_orders", branch_id: Number(dashboardBranchId),
                            include_order_items: true, date_from: mdLocalDay(ordersStart), date_to: mdLocalDay(now) }),
                        cache: "no-store",
                    }),
                    fetch("/api/manager-staff-overview", {
                        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
                    }),
                    fetch("/api/rental-inventory", { method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_manager_inventory", branch_id: Number(dashboardBranchId) }),
                        cache: "no-store",
                    }),
                ]);
            if (bookingsResult.status === "fulfilled") {
                try {
                    const result = bookingsResult.value;
                    const payload = await result.json().catch(() => ({}));
                    if (result.ok && Array.isArray(payload.bookings)) {
                        setBookings((payload.bookings as unknown[]).map(normalizeBooking)
                            .filter(booking => belongsToAssignedBranch(booking, dashboardBranchId)));
                    } else { setBookingsError(String(payload.error || "Unable to load bookings.")); }
                } catch { setBookingsError("Unable to read booking records."); }
            } else { setBookingsError("Unable to connect to bookings."); }
            if (productsResult.status === "fulfilled") {
                try {
                    const response = productsResult.value;
                    const payload = await response.json().catch(() => ({}));
                    if (response.ok && Array.isArray(payload.products)) {
                        setProducts((payload.products as unknown[]).map(normalizeProduct)
                            .filter(product => belongsToAssignedBranch(product, dashboardBranchId)));
                    }
                } catch (error) { console.warn("Manager products response failed:", error); }
            }
            if (ordersResult.status === "fulfilled") {
                try {
                    const result = ordersResult.value;
                    const payload = await result.json().catch(() => ({}));
                    if (result.ok && Array.isArray(payload.orders)) {
                        setOrders((payload.orders as unknown[]).map(normalizeOrder)
                            .filter(order => belongsToAssignedBranch(order, dashboardBranchId)));
                    }
                } catch (error) { console.warn("Manager POS response failed:", error); }
            }
            if (staffResult.status === "fulfilled") {
                try {
                    const result = staffResult.value;
                    const payload = await result.json().catch(() => ({}));
                    if (!result.ok || payload.success !== true) throw new Error(payload.error || "Unable to load employee records.");
                    setStaffSummary(payload.attendanceSummary as MDStaffSummary);
                    setMayReviewLeave(payload.mayReviewLeave === true);
                    setStaffRecords(Array.isArray(payload.attendance) ? payload.attendance : []);
                    setManagerAttendance(Array.isArray(payload.managerAttendance) ? payload.managerAttendance : []);
                    setTeamAttendance(Array.isArray(payload.teamAttendance) ? payload.teamAttendance : []);
                    setManagerClockToday(payload.managerAttendanceToday || null);
                    setManagerClockError("");
                    setLeaveRows(Array.isArray(payload.leaves) ? payload.leaves : []);
                    setStaffError("");
                } catch (error) { setStaffError(error instanceof Error ? error.message : "Employee records unavailable."); }
            } else { setStaffError("Employee attendance service could not be reached."); }
            if (rentalResult.status === "fulfilled") {
                try {
                    const response = rentalResult.value;
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok || data.success !== true || !Array.isArray(data.equipment)) {
                        throw new Error("Rental maintenance data unavailable.");
                    }
                    const counts = data.equipment.map((item: Record<string, unknown>) => item.maintenanceUnits);
                    if (counts.some((value: unknown) => value === null || value === undefined ||
                        !Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
                        throw new Error("Incomplete rental maintenance counts.");
                    }
                    setRentalMaintenance(counts.reduce((sum: number, value: unknown) => sum + Number(value), 0));
                } catch { setRentalMaintenance(null); }
            } else { setRentalMaintenance(null); }
        } finally {
            loadInFlightRef.current = false;
            if (!silent) setIsRefreshing(false);
            setHasLoadedDashboard(true);
        }
    }, [dashboardStoreId, dashboardBranchId]);
    useEffect(() => { void loadManagerDashboard(); }, [loadManagerDashboard]);
    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible" && navigator.onLine) void loadManagerDashboard({ silent: true });
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [loadManagerDashboard]);

    const stockAlerts = useMemo(() => getDashboardStockAlertItems(products), [products]);
    const expiryAlerts = useMemo(() => getExpirationAlertItems(products), [products]);
    const lowCount = stockAlerts.filter(item => item.status === "Low Stock").length;
    const outCount = stockAlerts.filter(item => item.status === "Out of Stock").length;
    const inventoryHealth = useMemo(() => buildInventoryHealth(products, stockAlerts, expiryAlerts), [products, stockAlerts, expiryAlerts]);
    const attentionItems = useMemo(() => buildManagerAttentionItems(stockAlerts, expiryAlerts), [stockAlerts, expiryAlerts]);
    const stockRows = attentionItems.map(item => {
        const product = products.find(entry => entry.name === item.productName);
        const variant = product?.variants?.find(entry => getDashboardVariantName(entry) === item.variantName);
        const matchingStock = stockAlerts.find(entry => entry.productName === item.productName &&
            (entry.variantName || "—") === item.variantName);
        const matchingExpiry = expiryAlerts.find(entry => entry.productName === item.productName &&
            (entry.variantName || "—") === item.variantName);
        return { ...item, sku: variant?.variantNumber || product?.productNumber || "—",
            currentStock: matchingStock?.currentStock ?? matchingExpiry?.stock ??
                (variant ? Number(variant.stock || 0) : Number(product?.stock || 0)) };
    }).filter(item => `${item.productName} ${item.sku} ${item.status}`.toLowerCase().includes(stockSearch.toLowerCase()) &&
        (stockStatusFilter === "all" || item.status === stockStatusFilter));
    const openPayables = payables.filter(item => Number(item.outstandingBalance) > 0.005)
        .sort((a, b) => String(a.paymentDueDate || "9999-12-31").localeCompare(String(b.paymentDueDate || "9999-12-31")));
    const filteredPayables = openPayables.filter(row => `${row.purchaseNumber} ${row.supplier}`.toLowerCase().includes(payableSearch.toLowerCase()));
    const today = mdLocalDay(currentDateTime);
    const pendingLeaveEmployeeCount = useMemo(() => new Set(leaveRows
        .filter(row => row.approvalStatus === "Pending")
        .map(row => String(row.employeeId))).size, [leaveRows]);
    const leaveGroups = useMemo(() => mdGroupLeaveRequests(leaveRows), [leaveRows]);
    const pendingLeaveApplicationCount = leaveGroups.filter(row => row.status === "Pending").length;
    // Present actual staff attendance and approved leave only. Never invent
    // absence or clock-in records for employees who have not submitted any.
    const teamAttendanceRows = useMemo(() => {
        const rows: MDTeamAttendance[] = [...teamAttendance];
        const alreadyRecorded = new Set(rows.map(row => `${row.employeeId}:${row.date}`));
        const earliest = mdDatePlusDays(today, -90);
        for (const leave of leaveRows) {
            if (leave.approvalStatus !== "Approved") continue;
            const start = leave.leaveDate;
            const end = leave.leaveEndDate && leave.leaveEndDate >= start ? leave.leaveEndDate : start;
            if (end < earliest || start > today) continue;
            let day = start < earliest ? earliest : start;
            const last = end > today ? today : end;
            let index = 0;
            while (day <= last && index < 91) {
                const key = `${leave.employeeId}:${day}`;
                if (!alreadyRecorded.has(key)) {
                    rows.push({ id: -(leave.id * 100 + index + 1), employeeId: leave.employeeId,
                        employeeName: leave.employeeName, date: day, timeIn: null,
                        timeOut: null, hoursWorked: null, status: "On Leave" });
                    alreadyRecorded.add(key);
                }
                day = mdDatePlusDays(day, 1);
                index += 1;
            }
        }
        return rows.sort((a,b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
    }, [teamAttendance, leaveRows, today]);
    const visibleMyAttendance = managerAttendance.filter(row => mdAttendanceInPeriod(row.date, managerClockFilter, today));
    // Only use manager records returned by the existing manager-staff-overview API.
    // Never generate attendance, absence, or leave records that do not exist.
    const myWorkedAttendance = managerAttendance.filter(row => Boolean(row.timeIn || row.timeOut));
    const myAttendanceExceptions = managerAttendance.filter(row => /absent|leave/i.test(row.status || ""));
    const myAttendanceTabRecords = managerAttendanceTab === "worked" ? myWorkedAttendance : myAttendanceExceptions;
    const myAttendanceLogRows = myAttendanceTabRecords.filter(row => {
        const day = String(row.date || "").slice(0, 10);
        if (managerAttendanceRange === "90") return day >= mdDatePlusDays(today, -89) && day <= today;
        if (managerAttendanceRange === "day") return day === managerAttendanceDay;
        if (managerAttendanceRange === "custom") return Boolean(managerAttendanceStart && managerAttendanceEnd &&
            managerAttendanceStart <= managerAttendanceEnd && day >= managerAttendanceStart && day <= managerAttendanceEnd);
        return mdAttendanceInPeriod(day, managerAttendanceRange === "all" ? "all" : "month", today);
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
    const visibleTeamAttendance = teamAttendanceRows.filter(row =>
        mdAttendanceInPeriod(row.date, teamAttendanceFilter, today) &&
        `${row.employeeName} ${row.employeeId} ${row.status}`.toLowerCase().includes(teamAttendanceSearch.trim().toLowerCase())
    );
    const duePayables = openPayables.filter(row => Boolean(row.paymentDueDate && row.paymentDueDate <= mdOffsetDay(currentDateTime, 7))).length;
    const leaveTypes = useMemo(() => Array.from(new Set(leaveGroups.map(row => row.leaveType).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b)), [leaveGroups]);
    const filteredLeaveGroups = useMemo(() => leaveGroups.filter(row =>
            (leaveStatusFilter === "all" || row.status.toLowerCase() === leaveStatusFilter) &&
            (leaveTypeFilter === "all" || row.leaveType === leaveTypeFilter)),
        [leaveGroups, leaveStatusFilter, leaveTypeFilter]);
    const selectedLeaveIsPending = selectedLeave?.status === "Pending";
    const assignedBranchName = getAssignedBranchName(user);
    const activeStockAlerts = stockAlerts.filter(item => stockAlertFilter === "all" ||
        (stockAlertFilter === "low" && item.status === "Low Stock") ||
        (stockAlertFilter === "out" && item.status === "Out of Stock"));
    const donutSegments: ManagerSegment[] = [
        { label: "Present", value: staffSummary?.present || 0, color: "#159455" },
        { label: "On Leave", value: staffSummary?.onLeave || 0, color: "#F59E0B" },
        { label: "Absent", value: staffSummary?.absent || 0, color: "#EF4444" },
        { label: "Not Recorded", value: staffSummary?.notRecorded || 0, color: "#A39AB0" },
    ];
    const inventorySegments: ManagerSegment[] = inventoryHealth.segments.map(segment =>
        segment.label === "Expiring Soon" ? { ...segment, label: "Expiring / Expired" } : segment);

    const decideLeave = async (decision: "Approved" | "Rejected") => {
        if (!selectedLeave || decisionBusy) return;
        setDecisionBusy(true);
        setDecisionError("");
        try {
            const response = await fetch("/api/manager-staff-overview", {
                method: "POST", cache: "no-store",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSavedItem("token")}` },
                body: JSON.stringify({ action: "review_leave", decision, requestIds: selectedLeave.ids, decisionReason }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) throw new Error(result.error || "Unable to review leave request.");
            setLeaveRows(previous => previous.map(row => selectedLeave.ids.includes(row.id)
                ? { ...row, approvalStatus: decision, decisionReason: decisionReason || null } : row));
            setSelectedLeave(null);
            setDecisionReason("");
            setToast({ title: `Leave ${decision.toLowerCase()}`, message: `${selectedLeave.employeeName}'s request has been ${decision.toLowerCase()}.` });
            await loadManagerDashboard({ silent: true });
        } catch (error) {
            setDecisionError(error instanceof Error ? error.message : "Unable to save the decision.");
        } finally { setDecisionBusy(false); }
    };
    const paySupplier = async () => {
        if (!selectedPayable || payingRef.current) return;
        const amount = Number(paymentAmount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > Number(selectedPayable.outstandingBalance)) {
            setPaymentError("Enter a payment greater than zero, up to the outstanding balance."); return;
        }
        payingRef.current = true;
        setPaymentBusy(true); setPaymentError("");
        try {
            const response = await fetch("/api/products", {
                method: "POST", cache: "no-store",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSavedItem("token")}` },
                body: JSON.stringify({ action: "pay_supplier_purchase", purchaseId: selectedPayable.purchaseId,
                    amount, paymentDate: mdLocalDay(new Date()), requestKey: paymentKeyRef.current }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) throw new Error(result.error || "Unable to pay supplier.");
            setToast({ title: "Supplier payment recorded", message: `${selectedPayable.purchaseNumber}: ${peso(amount)} recorded.` });
            setPayables(previous => previous.map(row => row.purchaseId === selectedPayable.purchaseId
                ? { ...row, outstandingBalance: Math.max(0, Number(row.outstandingBalance) - amount) } : row));
            setSelectedPayable(null); setPaymentAmount(""); paymentKeyRef.current = "";
            await loadManagerDashboard({ silent: true });
        } catch (error) { setPaymentError(error instanceof Error ? error.message : "Unable to pay supplier."); }
        finally { setPaymentBusy(false); payingRef.current = false; }
    };
    const submitManagerLeave = async () => {
        if (managerLeaveBusy) return;
        const start = managerLeaveDate;
        const end = managerLeaveMode === "range" ? managerLeaveEndDate : managerLeaveDate;
        if (!start || !end || end < start || start < today || managerLeaveReason.trim().length < 3) {
            setManagerLeaveError("Choose future or current dates and enter a reason (at least 3 characters).");
            return;
        }
        setManagerLeaveBusy(true);
        setManagerLeaveError("");
        try {
            const response = await fetch("/api/manager-staff-overview", {
                method: "POST", cache: "no-store",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSavedItem("token")}` },
                body: JSON.stringify({ action: "request_leave", start_date: start, end_date: end,
                    leave_type: managerLeaveType, reason: managerLeaveReason.trim() }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success !== true) {
                throw new Error(payload.error || "Unable to submit manager leave request.");
            }
            setManagerLeaveOpen(false);
            setManagerLeaveDate(""); setManagerLeaveEndDate(""); setManagerLeaveReason("");
            setManagerAttendanceTab("exceptions");
            setToast({ title: "Leave request submitted", message: "Your leave is pending approval and is now in Absent / Leave." });
            await loadManagerDashboard({ silent: true });
        } catch (error) {
            setManagerLeaveError(error instanceof Error ? error.message : "Unable to request leave.");
        } finally { setManagerLeaveBusy(false); }
    };
    const managerClockAction = async (action: "time_in" | "time_out") => {
        if (managerClockBusy) return;
        setManagerClockBusy(true); setManagerClockError("");
        try {
            const response = await fetch("/api/manager-staff-overview", {
                method: "POST", cache: "no-store",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSavedItem("token")}` },
                body: JSON.stringify({ action }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to record attendance.");
            setToast({ title: action === "time_in" ? "Time In recorded" : "Time Out recorded",
                message: "Your manager attendance was saved successfully." });
            await loadManagerDashboard({ silent: true });
        } catch (error) { setManagerClockError(error instanceof Error ? error.message : "Attendance could not be recorded."); }
        finally { setManagerClockBusy(false); }
    };
    const exportTeamAttendance = () => mdExportRows(
        "Team Attendance Log", ["Employee", "Employee ID", "Date", "Time In", "Time Out", "Hours", "Status"],
        visibleTeamAttendance.map(row => [row.employeeName, String(row.employeeId), mdDisplayDate(row.date),
            mdClockTime(row.timeIn), mdClockTime(row.timeOut), mdHours(row.hoursWorked), row.status]),
        "manager_team_attendance", assignedBranchName, today);
    const exportMyAttendance = (rows: MDManagerAttendance[] = visibleMyAttendance) => mdExportRows(
        "My Manager Attendance", ["Employee ID", "Date", "Time In", "Time Out", "Hours Worked", "Status"],
        rows.map(row => [
            String(getUserValue(user, "manager_id") || getUserValue(user, "id") || getSavedItem("manager_id")),
            mdDisplayDate(row.date), mdClockTime(row.timeIn), mdClockTime(row.timeOut),
            mdHours(row.hoursWorked), row.status]),
        "manager_my_attendance", assignedBranchName, today);
    const exportStaffAttendance = () => {
        const rows = staffRecords.map(record => [
            String(record.employeeId), record.employeeName, record.status,
            record.timeIn || "—", record.timeOut || "—",
        ]);
        mdExportRows("Employee Attendance", ["Employee ID", "Employee Name", "Status", "Time In", "Time Out"], rows,
            `manager_attendance_${today}`, assignedBranchName, today);
    };
    const exportLeave = () => mdExportRows("Employee Requests", ["Employee", "Leave Type", "Date(s)", "Status", "Reason"],
        filteredLeaveGroups.map(r => [r.employeeName, r.leaveType, mdLeaveDatesLabel(r), r.status, r.reason]),
        "manager_employee_requests", assignedBranchName, today);
    const exportPayables = () => mdExportRows("Supplier Payables", ["Purchase", "Supplier", "Due Date", "Outstanding"],
        openPayables.map(r => [r.purchaseNumber, r.supplier, r.paymentDueDate || "—", peso(Number(r.outstandingBalance))]),
        "manager_supplier_payables", assignedBranchName, today);
    const exportStock = () => mdExportRows("Stock Action Center", ["Product", "Variant", "Status", "Description"],
        attentionItems.map(r => [r.productName, r.variantName, r.status, r.detail]), "manager_stock_actions", assignedBranchName, today);
    const exportFilteredStock = () => mdExportRows("Stock Action Center", ["Product", "SKU", "Current Stock", "Status", "Description"],
        stockRows.map(r => [r.productName, r.sku, String(r.currentStock), r.status, r.detail]),
        "manager_stock_actions_filtered", assignedBranchName, today);

    return <>
        <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
            <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                <div className="min-w-0">
                    <h1 className="text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">Manager Dashboard</h1>
                    <p className="mt-1 text-[12px] text-[#7A6A84]">Operational stock and employee overview for {assignedBranchName}.</p>
                </div>
                <div className="flex gap-2.5">
                    <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm"><CalendarDays size={15} className="mr-2 text-[#6D35D4]"/>{formatCurrentDashboardDateTime(currentDateTime)}</span>
                    <button type="button" onClick={() => void loadManagerDashboard()} disabled={isRefreshing} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"><RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""}/>{isRefreshing ? "Refreshing..." : "Refresh"}</button>
                </div>
            </div>
        </header>
        <section className="px-6 py-5 font-sans" aria-busy={!hasLoadedDashboard}>
            {!hasLoadedDashboard ? <ManagerDashboardSkeleton/> : <div className="space-y-4">
                {bookingsError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{bookingsError}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <ManagerMetricCard title="Low Stock" value={lowCount} subtitle="Items below reorder level" icon={<AlertTriangle size={24}/>} tone="orange" onClick={() => { setStockAlertFilter("low"); setShowStockAlertsModal(true); }}/>
                    <ManagerMetricCard title="Out of Stock" value={outCount} subtitle="Products without available stock" icon={<PackageX size={24}/>} tone="red" onClick={() => { setStockAlertFilter("out"); setShowStockAlertsModal(true); }}/>
                    <div className="flex min-h-[116px] items-center gap-4 rounded-2xl border border-[#E6DDF0] bg-white px-5 py-4 shadow-sm">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#EAF1FF] text-[#2563EB]"><MdWrenchIcon/></span>
                        <div><p className="text-[14px] font-semibold text-[#4B3E55]">Under Maintenance</p><p className="mt-1 text-[28px] font-bold text-[#1A1220]">{rentalMaintenance === null ? "—" : rentalMaintenance}</p><p className="mt-2 text-[11px] text-[#8A7D92]">{rentalMaintenance === null ? "Rental condition data not connected" : "Rental units requiring maintenance"}</p></div>
                    </div>
                    <ManagerMetricCard title="Employees Requesting Leave" value={pendingLeaveEmployeeCount} subtitle={`${pendingLeaveApplicationCount} pending leave application(s)`} icon={<MDBellIcon/>} tone="violet" onClick={() => router.push("/manager/staff-management#employee-requests")}/>
                </div>
                <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                    <MDChartCard title="Inventory Health" subtitle="Current sales stock, including product variants"
                                 icon={<Box size={18}/>} segments={inventorySegments} total={inventoryHealth.total}
                                 centerLabel="Stock Lines" exportClick={exportStock}/>
                    <div className="relative min-w-0">
                        <MDChartCard title="Employee Attendance" subtitle="Today's attendance for your branch staff"
                                     icon={<MDPeopleIcon/>} segments={donutSegments} total={staffSummary?.total ?? null}
                                     centerLabel="Total Staff" exportClick={exportStaffAttendance} error={staffError} reserveFooter/>
                        <button type="button" onClick={() => router.push("/manager/staff-management#employee-requests")}
                                className="absolute bottom-2.5 left-4 right-4 flex items-center justify-between gap-2 rounded-lg border border-[#E9DDF4] bg-[#FAF7FE] px-3 py-2 text-[11px] font-semibold text-[#5D2DAB] hover:bg-[#F1E8FB]">
                            <span className="truncate">Employees requesting leave</span>
                            <span className="shrink-0 rounded-full bg-[#ECE0FC] px-2 py-0.5">{pendingLeaveEmployeeCount}</span>
                        </button>
                    </div>
                    <section className="flex h-[360px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-sm lg:col-span-2 2xl:col-span-1" aria-label="My Attendance Log">
                        {/* Same Attendance Log design language as the Staff Dashboard. */}
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#E9E1EE] px-4 py-3.5">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><CalendarClock size={19}/></span>
                                <div className="min-w-0"><h2 className="text-[15px] font-bold text-[#21132E]">Attendance Log</h2><p className="mt-0.5 text-[11px] text-[#86778F]">Your attendance and leave history</p></div>
                            </div>
                            <button type="button" onClick={() => exportMyAttendance(myAttendanceLogRows)}
                                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#D9CDF0] bg-white px-3 text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC]">
                                <MdDownload size={14}/>Export
                            </button>
                        </div>
                        <div className="mx-4 mt-3 grid shrink-0 grid-cols-3 gap-2 rounded-xl border border-[#E2EDE6] bg-[#F5FBF6] px-3 py-3">
                            <div className="min-w-0"><p className="text-[10px] text-[#86778F]">Current Status</p>
                                <p className={`mt-1 text-xs font-bold ${managerClockToday?.timeIn && !managerClockToday.timeOut ? "text-[#168449]" : "text-[#5A476A]"}`}>
                                    {managerClockToday?.timeIn && !managerClockToday.timeOut ? "● On Duty" : managerClockToday?.timeOut ? "Completed" : "Not Clocked In"}
                                </p>
                            </div>
                            <div className="min-w-0 border-l border-[#E0E7E0] pl-3"><p className="text-[10px] text-[#86778F]">Time In</p><p className="mt-1 text-xs font-bold text-[#21132E]">{mdClockTime(managerClockToday?.timeIn)}</p></div>
                            <div className="min-w-0 border-l border-[#E0E7E0] pl-3"><p className="text-[10px] text-[#86778F]">Hours Worked</p><p className="mt-1 text-xs font-bold text-[#21132E]">{managerClockToday?.timeOut ? mdHours(managerClockToday.hoursWorked) : mdLiveHours(managerClockToday?.timeIn, currentDateTime)}</p></div>
                        </div>
                        <div className="grid shrink-0 grid-cols-3 gap-2 px-4 py-3">
                            <button type="button" disabled={managerClockBusy || Boolean(managerClockToday?.timeIn)} onClick={() => void managerClockAction("time_in")}
                                    className="inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-xl bg-[#E6F7EE] px-1 text-[11px] font-semibold text-[#148447] hover:bg-[#D7F0E1] disabled:cursor-not-allowed disabled:opacity-50"><LogIn size={15}/>Time In</button>
                            <button type="button" disabled={managerClockBusy || !managerClockToday?.timeIn || Boolean(managerClockToday?.timeOut)} onClick={() => void managerClockAction("time_out")}
                                    className="inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-xl bg-[#FDECEC] px-1 text-[11px] font-semibold text-[#B42318] hover:bg-[#FBE0E0] disabled:cursor-not-allowed disabled:opacity-50"><LogOut size={15}/>Time Out</button>
                            <button type="button" onClick={() => { setManagerLeaveError(""); setManagerLeaveOpen(true); }}
                                    className="inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-xl border border-[#D9CDF0] bg-[#F9F6FC] px-1 text-[11px] font-semibold text-[#5A35A5] hover:bg-[#F1EBFF]"><CalendarDays size={15}/>Request Leave</button>
                        </div>
                        {managerClockError && <p role="alert" className="mx-4 mb-2 rounded-lg bg-[#FFF0F0] px-3 py-2 text-[11px] text-[#B42318]">{managerClockError}</p>}
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#EEE8F2] px-4 py-2">
                            <div className="flex items-center gap-3 text-[11px]">
                                <button type="button" aria-pressed={managerAttendanceTab === "worked"} onClick={() => setManagerAttendanceTab("worked")}
                                        className={`pb-1 font-semibold ${managerAttendanceTab === "worked" ? "border-b-2 border-[#2B174C] text-[#2B174C]" : "text-[#86778F]"}`}>Attendance ({myWorkedAttendance.length})</button>
                                <button type="button" aria-pressed={managerAttendanceTab === "exceptions"} onClick={() => setManagerAttendanceTab("exceptions")}
                                        className={`pb-1 font-semibold ${managerAttendanceTab === "exceptions" ? "border-b-2 border-[#2B174C] text-[#2B174C]" : "text-[#86778F]"}`}>Absent / Leave ({myAttendanceExceptions.length})</button>
                            </div>
                            <select aria-label="Manager attendance date range" value={managerAttendanceRange}
                                    onChange={e => setManagerAttendanceRange(e.target.value as "month" | "90" | "all" | "day" | "custom")}
                                    className="h-8 rounded-lg border border-[#E3D8EA] bg-white px-2 text-[10px] font-semibold text-[#2B174C]">
                                <option value="month">This Month</option><option value="90">Last 90 Days</option><option value="all">Available History</option>
                                <option value="day">Specific Date</option><option value="custom">Date Range</option>
                            </select>
                        </div>
                        {(managerAttendanceRange === "day" || managerAttendanceRange === "custom") && <div className="flex shrink-0 flex-wrap gap-2 border-t border-[#EEE8F2] px-4 py-2 text-[11px] text-[#5A476A]">
                            <label className="flex items-center gap-2">{managerAttendanceRange === "day" ? "Date" : "From"}
                                <input type="date" aria-label={managerAttendanceRange === "day" ? "Specific manager attendance date" : "Manager attendance start date"}
                                       value={managerAttendanceRange === "day" ? managerAttendanceDay : managerAttendanceStart}
                                       onChange={e => managerAttendanceRange === "day" ? setManagerAttendanceDay(e.target.value) : setManagerAttendanceStart(e.target.value)}
                                       className="h-8 rounded-lg border border-[#E3D8EA] bg-white px-2 text-[11px]"/>
                            </label>
                            {managerAttendanceRange === "custom" && <label className="flex items-center gap-2">To
                                <input type="date" aria-label="Manager attendance end date" min={managerAttendanceStart} value={managerAttendanceEnd}
                                       onChange={e => setManagerAttendanceEnd(e.target.value)} className="h-8 rounded-lg border border-[#E3D8EA] bg-white px-2 text-[11px]"/>
                            </label>}
                        </div>}
                        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                            <table className="w-full min-w-[410px] text-left text-[10px]">
                                <thead className="sticky top-0 z-10 border-y border-[#EEE8F2] bg-[#FBF9FC] uppercase tracking-[0.04em] text-[#806A8C]">
                                {managerAttendanceTab === "worked" ?
                                    <tr>{["Date", "Time In", "Time Out", "Hours", "Status"].map(label => <th key={label} className="px-3 py-2 font-semibold">{label}</th>)}</tr> :
                                    <tr>{["Date", "Type", "Status"].map(label => <th key={label} className="px-3 py-2 font-semibold">{label}</th>)}</tr>}
                                </thead>
                                <tbody>
                                {myAttendanceLogRows.length === 0 ?
                                    <tr><td colSpan={managerAttendanceTab === "worked" ? 5 : 3} className="px-3 py-10 text-center text-[#86778F]">
                                        {managerAttendanceTab === "worked" ? "No attendance records for this period." : "No absences or leave records for this period."}
                                    </td></tr> :
                                    myAttendanceLogRows.map(row => <tr key={`${row.id}-${row.date}`} className="border-b border-[#F1ECF4] last:border-0 hover:bg-[#FCFAFE]">
                                        <td className="whitespace-nowrap px-3 py-2 text-[#5A476A]">{mdDisplayDate(row.date)}</td>
                                        {managerAttendanceTab === "worked" ? <>
                                            <td className="whitespace-nowrap px-3 py-2">{mdClockTime(row.timeIn)}</td>
                                            <td className="whitespace-nowrap px-3 py-2">{mdClockTime(row.timeOut)}</td>
                                            <td className="whitespace-nowrap px-3 py-2">{row.timeOut ? mdHours(row.hoursWorked) : "—"}</td>
                                            <td className="px-3 py-2"><MDAttendanceBadge status={row.status}/></td>
                                        </> : <>
                                            <td className="px-3 py-2 font-semibold">{/absent/i.test(row.status) ? "Absent" : (row.leaveType || "Leave")}</td>
                                            <td className="px-3 py-2">{row.approvalStatus ? <MDStatusBadge status={row.approvalStatus}/> : <MDAttendanceBadge status={row.status}/>}</td>
                                        </>}
                                    </tr>)}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
                <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                    <MDPanel title="Stock Action Center" subtitle="Stock items needing immediate action" tall icon={<TriangleAlert size={19}/>} onExport={exportFilteredStock} search={stockSearch} setSearch={setStockSearch} searchPlaceholder="Search products..." headerActions={
                        <select aria-label="Filter stock actions by status" value={stockStatusFilter} onChange={e => setStockStatusFilter(e.target.value)} className="h-8 w-[136px] rounded-lg border border-[#E6DDF0] bg-white px-2 text-[10px] font-semibold text-[#5F4E75] outline-none focus:border-[#8B65B9]">
                            <option value="all">All Statuses</option><option value="Expired">Expired</option><option value="Expiring Soon">Expiring Soon</option>
                            <option value="Out of Stock">Out of Stock</option><option value="Very Low Stock">Very Low Stock</option><option value="Low Stock">Low Stock</option>
                        </select>}>
                        <div className="min-h-0 flex-1 overflow-auto"><table className="w-full table-fixed text-left text-[11px]"><colgroup><col className="w-[30%]"/><col className="w-[20%]"/><col className="w-[15%]"/><col className="w-[19%]"/><col className="w-[16%]"/></colgroup>
                            <thead className="sticky top-0 bg-[#FFFCF7] text-[9px] uppercase text-[#806A8C]"><tr>{["Product", "SKU", "Current Stock", "Status", "Action"].map(h => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
                            <tbody>{stockRows.map(row => <tr key={row.key} className="border-t border-[#EEE7F2] hover:bg-[#FFFCF7]">
                                <td className="px-3 py-2 font-semibold text-[#2B174C]">{row.productName}<span className="mt-0.5 block text-[9px] font-normal text-[#8A7D92]">{row.detail}</span></td>
                                <td className="break-all px-3 py-2 text-[#806A8C]">{row.sku}</td><td className="px-3 py-2 font-semibold text-[#2B174C]">{row.currentStock}</td><td className="px-3 py-2"><MDStockBadge status={row.status}/></td>
                                <td className="px-3 py-2"><button type="button" onClick={() => router.push("/inventory")} className="rounded-lg border border-[#D9C9EA] bg-[#F7F1FF] px-3 py-1.5 text-[10px] font-semibold text-[#5D2DAB] hover:bg-[#ECE3F8]">{row.status === "Expired" ? "Review" : row.status === "Out of Stock" || row.status.includes("Low") ? "Restock" : "View"}</button></td>
                            </tr>)}{stockRows.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-[#8A7D92]">No matching stock alerts.</td></tr>}</tbody>
                        </table></div><p className="border-t border-[#EEE7F2] px-4 py-2 text-right text-[10px] text-[#8A7D92]">Showing {stockRows.length} of {attentionItems.length} items</p>
                    </MDPanel>
                    <MDPanel title="Team Attendance" subtitle="Recorded staff attendance and approved leave" tall icon={<MDPeopleIcon/>}
                             onExport={exportTeamAttendance} search={teamAttendanceSearch} setSearch={setTeamAttendanceSearch}
                             searchPlaceholder="Search employees..." headerActions={
                        <select aria-label="Filter team attendance by date" value={teamAttendanceFilter} onChange={e => setTeamAttendanceFilter(e.target.value)}
                                className="h-8 w-[113px] rounded-lg border border-[#E6DDF0] bg-white px-2 text-[10px] font-semibold text-[#5F4E75] outline-none focus:border-[#8B65B9]">
                            <option value="today">Today</option><option value="month">This Month</option><option value="previous">Last Month</option><option value="all">Available History</option>
                        </select>}>
                        <div className="min-h-0 flex-1 overflow-auto">
                            <table className="w-full min-w-[610px] text-left text-[11px]">
                                <thead className="sticky top-0 bg-[#FFFCF7] text-[9px] uppercase text-[#806A8C]"><tr>{["Employee", "Date", "Time In", "Time Out", "Hours", "Status"].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
                                <tbody>{visibleTeamAttendance.map(row => <tr key={`${row.employeeId}-${row.id}-${row.date}`} className="border-t border-[#EEE7F2] hover:bg-[#FFFCF7]">
                                    <td className="px-3 py-2 font-semibold text-[#2B174C]">{row.employeeName}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-[#5F4E75]">{mdDisplayDate(row.date)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-[#5F4E75]">{mdClockTime(row.timeIn)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-[#5F4E75]">{mdClockTime(row.timeOut)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-[#5F4E75]">{mdHours(row.hoursWorked)}</td>
                                    <td className="px-3 py-2"><MDAttendanceBadge status={row.status}/></td>
                                </tr>)}{visibleTeamAttendance.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-[#8A7D92]">No recorded attendance or approved leave for this period.</td></tr>}</tbody>
                            </table>
                        </div>
                        <p className="border-t border-[#EEE7F2] px-4 py-2 text-right text-[10px] text-[#8A7D92]">Showing {visibleTeamAttendance.length} records</p>
                    </MDPanel>
                </div>
            </div>}
        </section>
        {managerLeaveOpen && <div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-[#160C24]/50 p-4 font-sans" onMouseDown={event => { if (event.target === event.currentTarget && !managerLeaveBusy) setManagerLeaveOpen(false); }}>
            <form onSubmit={event => { event.preventDefault(); void submitManagerLeave(); }}
                  className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
                <div>
                    <h2 className="text-base font-bold text-[#21132E]">Request Manager Leave</h2>
                    <p className="mt-1 text-xs text-[#86778F]">Your request will be marked Pending. Managers cannot approve their own leave.</p>
                </div>
                <div className="flex gap-2 rounded-xl bg-[#F7F1FF] p-1 text-xs font-semibold">
                    <button type="button" onClick={() => setManagerLeaveMode("single")}
                            className={`flex-1 rounded-lg px-3 py-2 ${managerLeaveMode === "single" ? "bg-[#2B174C] text-white" : "text-[#5A476A]"}`}>Specific Date</button>
                    <button type="button" onClick={() => setManagerLeaveMode("range")}
                            className={`flex-1 rounded-lg px-3 py-2 ${managerLeaveMode === "range" ? "bg-[#2B174C] text-white" : "text-[#5A476A]"}`}>Date Range</button>
                </div>
                <div className={`grid gap-3 ${managerLeaveMode === "range" ? "sm:grid-cols-2" : ""}`}>
                    <label className="block text-xs font-semibold text-[#5A476A]">{managerLeaveMode === "range" ? "From" : "Leave Date"}
                        <input required type="date" min={today} value={managerLeaveDate}
                               onChange={event => setManagerLeaveDate(event.target.value)}
                               className="mt-1 h-10 w-full rounded-xl border border-[#E3D8EA] px-3 text-sm"/>
                    </label>
                    {managerLeaveMode === "range" && <label className="block text-xs font-semibold text-[#5A476A]">To
                        <input required type="date" min={managerLeaveDate || today} value={managerLeaveEndDate}
                               onChange={event => setManagerLeaveEndDate(event.target.value)}
                               className="mt-1 h-10 w-full rounded-xl border border-[#E3D8EA] px-3 text-sm"/>
                    </label>}
                </div>
                <label className="block text-xs font-semibold text-[#5A476A]">Leave Type
                    <select value={managerLeaveType} onChange={event => setManagerLeaveType(event.target.value)}
                            className="mt-1 h-10 w-full rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm">
                        {['Personal','Sick','Emergency','Vacation','Other'].map(type => <option key={type}>{type}</option>)}
                    </select>
                </label>
                <label className="block text-xs font-semibold text-[#5A476A]">Reason
                    <textarea required minLength={3} maxLength={1000} rows={3} value={managerLeaveReason}
                              onChange={event => setManagerLeaveReason(event.target.value)}
                              placeholder="State the reason for your leave"
                              className="mt-1 w-full rounded-xl border border-[#E3D8EA] p-3 text-sm"/>
                </label>
                {managerLeaveError && <p role="alert" className="rounded-lg bg-[#FFF0F0] px-3 py-2 text-xs text-[#B42318]">{managerLeaveError}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" disabled={managerLeaveBusy} onClick={() => setManagerLeaveOpen(false)}
                            className="rounded-xl border border-[#E3D8EA] px-4 py-2 text-xs font-semibold text-[#2B174C]">Cancel</button>
                    <button type="submit" disabled={managerLeaveBusy || !managerLeaveDate || (managerLeaveMode === "range" && (!managerLeaveEndDate || managerLeaveEndDate < managerLeaveDate)) || managerLeaveReason.trim().length < 3}
                            className="rounded-xl bg-[#2B174C] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{managerLeaveBusy ? "Submitting..." : "Submit Request"}</button>
                </div>
            </form>
        </div>}
        {myLogsOpen && <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 px-4 py-6 font-sans" onMouseDown={() => setMyLogsOpen(false)}>
            <section role="dialog" aria-modal="true" aria-label="My Attendance Logs" onMouseDown={event => event.stopPropagation()}
                     className="flex max-h-[80vh] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEE7F2] px-5 py-4">
                    <div className="flex items-center gap-3"><span className="rounded-lg bg-[#F1EBFF] p-2 text-[#6D35D4]"><CalendarClock size={19}/></span>
                        <div><h2 className="text-[17px] font-bold text-[#1A1220]">My Attendance Logs</h2><p className="text-xs text-[#806A8C]">Your saved manager attendance history</p></div></div>
                    <div className="flex items-center gap-2"><select aria-label="Filter my attendance logs" value={managerClockFilter} onChange={e => setManagerClockFilter(e.target.value)} className="h-9 rounded-lg border border-[#E6DDF0] bg-white px-2 text-xs text-[#2B174C]">
                        <option value="today">Today</option><option value="month">This Month</option><option value="previous">Last Month</option><option value="all">Available History</option>
                    </select><button type="button" onClick={() => exportMyAttendance()} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#E6DDF0] px-3 text-xs font-semibold text-[#6D35D4] hover:bg-[#F7F1FF]"><MdDownload size={15}/>Export PDF</button>
                        <button type="button" onClick={() => setMyLogsOpen(false)} aria-label="Close my attendance logs" className="rounded-lg border border-[#E6DDF0] p-2 text-[#806A8C] hover:bg-[#F7F1FF]"><MdX size={17}/></button></div>
                </div>
                <div className="min-h-0 overflow-auto"><table className="w-full min-w-[570px] text-left text-[12px]"><thead className="sticky top-0 bg-[#FFFCF7] text-[10px] uppercase text-[#806A8C]"><tr>{["Date", "Time In", "Time Out", "Hours Worked", "Status"].map(x => <th className="px-4 py-3" key={x}>{x}</th>)}</tr></thead>
                    <tbody>{visibleMyAttendance.map(row => <tr key={row.id} className="border-t border-[#EEE7F2]"><td className="px-4 py-3">{mdDisplayDate(row.date)}</td><td className="px-4 py-3">{mdClockTime(row.timeIn)}</td><td className="px-4 py-3">{mdClockTime(row.timeOut)}</td><td className="px-4 py-3">{row.timeOut ? mdHours(row.hoursWorked) : "—"}</td><td className="px-4 py-3"><MDAttendanceBadge status={row.status}/></td></tr>)}
                    {visibleMyAttendance.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-[#8A7D92]">No attendance records for this period.</td></tr>}</tbody></table></div>
                <div className="border-t border-[#EEE7F2] px-5 py-3 text-right text-xs text-[#806A8C]">Showing {visibleMyAttendance.length} records</div>
            </section>
        </div>}
        {showStockAlertsModal && <ManagerStockAlertsModal items={activeStockAlerts} activeFilter={stockAlertFilter}
                                                          totalCount={stockAlerts.length} lowStockCount={lowCount} outOfStockCount={outCount}
                                                          onChangeFilter={setStockAlertFilter} onClose={() => setShowStockAlertsModal(false)}/>}
        {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[180] flex w-[min(360px,calc(100vw-2rem))] items-center gap-3 rounded-2xl border bg-white p-4 shadow-xl ${toast.error ? "border-[#F4BFC5]" : "border-[#BCE8CA]"}`}><span className={`rounded-full p-2 ${toast.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{toast.error ? <AlertTriangle size={19}/> : <MdCheckIcon/>}</span><div className="flex-1"><p className="text-sm font-bold text-[#1A1220]">{toast.title}</p><p className="mt-0.5 text-xs text-[#806A8C]">{toast.message}</p></div><button onClick={() => setToast(null)} aria-label="Dismiss"><MdCloseIcon/></button></div>}
    </>;
}

/* Dashboard overview panels and staff leave workflow. Manager Inventory is unchanged. */
type MDStaffSummary = { total: number; present: number; absent: number; onLeave: number; notRecorded: number };
type MDStaffAttendance = { employeeId: number; employeeName: string; status: string; timeIn: string | null; timeOut: string | null };
type MDManagerAttendance = { id: number; date: string; timeIn: string | null; timeOut: string | null; hoursWorked: number | null; status: string; leaveType?: string; approvalStatus?: string; reason?: string };
type MDTeamAttendance = MDManagerAttendance & { employeeId: number; employeeName: string };
function mdClockTime(value?: string | null): string {
    if (!value) return "—";
    const match = value.match(/T(\d{2}):(\d{2})/);
    if (!match) return "—";
    const h = Number(match[1]);
    return `${h % 12 || 12}:${match[2]} ${h < 12 ? "AM" : "PM"}`;
}
function mdLiveHours(timeIn: string | null | undefined, now: Date): string {
    if (!timeIn) return "—";
    const parsed = new Date(`${timeIn}+08:00`);
    if (Number.isNaN(parsed.getTime())) return "—";
    return mdHours(Math.max(0, (now.getTime() - parsed.getTime()) / 3600000));
}
function mdHours(value?: number | null): string {
    if (value === undefined || value === null) return "—";
    const total = Math.max(0, Math.round(Number(value) * 60));
    return `${Math.floor(total / 60)}h ${total % 60}m`;
}
type MDLeaveRow = { id: number; employeeId: number; employeeName: string; employeeNumber: string;
    leaveDate: string; leaveEndDate?: string; leaveType: string; reason: string; approvalStatus: string;
    decisionReason: string | null; createdAt: string; reviewedAt?: string | null };
type MDLeaveGroup = { key: string; ids: number[]; employeeName: string; employeeNumber: string;
    leaveType: string; dates: string[]; reason: string; status: string; decisionReason: string | null; createdAt: string };
type MDPayable = { purchaseId: number; purchaseNumber: string; supplier: string; purchaseTotal: number;
    outstandingBalance: number; paymentDueDate: string | null };

function mdLocalDay(date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (name: string) => parts.find(p => p.type === name)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}
function mdOffsetDay(value: Date, offsetDays: number) {
    const date = new Date(value);
    date.setDate(date.getDate() + offsetDays);
    return mdLocalDay(date);
}
function mdGroupLeaveRequests(rows: MDLeaveRow[]): MDLeaveGroup[] {
    // The original staff leave API stores one row per day, not one row per
    // request. Combine only contiguous dates from the SAME exact submission
    // timestamp, employee, type, reason and status; otherwise keep them separate.
    const sorted = [...rows].sort((a, b) =>
        a.employeeId - b.employeeId || a.createdAt.localeCompare(b.createdAt) || a.leaveDate.localeCompare(b.leaveDate));
    const groups: MDLeaveGroup[] = [];
    for (const row of sorted) {
        const last = groups[groups.length - 1];
        const sameRequest = last && last.employeeNumber === String(row.employeeNumber) &&
            last.leaveType === row.leaveType && last.reason === row.reason &&
            last.createdAt === row.createdAt && last.status === row.approvalStatus;
        const rangeEnd = row.leaveEndDate && row.leaveEndDate >= row.leaveDate
            ? row.leaveEndDate : row.leaveDate;
        const previous = sameRequest ? last.dates[last.dates.length - 1] : undefined;
        const contiguous = previous && mdDatePlusOne(previous) === row.leaveDate;
        if (sameRequest && contiguous) {
            last.ids.push(row.id);
            last.dates.push(rangeEnd);
        } else {
            groups.push({ key: String(row.id), ids: [row.id], employeeName: row.employeeName,
                employeeNumber: String(row.employeeNumber), leaveType: row.leaveType,
                dates: row.leaveDate === rangeEnd ? [row.leaveDate] : [row.leaveDate, rangeEnd],
                reason: row.reason, status: row.approvalStatus,
                decisionReason: row.decisionReason, createdAt: row.createdAt });
        }
    }
    return groups.sort((a, b) =>
        Number(b.status === "Pending") - Number(a.status === "Pending") ||
        b.createdAt.localeCompare(a.createdAt));
}
function mdDatePlusOne(value: string) {
    const d = new Date(`${value}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}
function mdDatePlusDays(value: string, days: number) {
    const result = new Date(value + "T00:00:00.000Z");
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
}
function mdAttendanceInPeriod(day: string, period: string, today: string) {
    if (period === "all") return true;
    if (period === "today") return day === today;
    if (period === "month") return day.slice(0,7) === today.slice(0,7);
    if (period === "previous") {
        const [year, month] = today.slice(0,7).split("-").map(Number);
        const lastMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0,7);
        return day.slice(0,7) === lastMonth;
    }
    return false;
}
function mdDisplayDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(value + "T12:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"});
}
function mdLeaveDatesLabel(row: MDLeaveGroup) {
    const first = row.dates[0], last = row.dates[row.dates.length - 1];
    return first === last ? mdDisplayDate(first) : `${mdDisplayDate(first)} – ${mdDisplayDate(last)}`;
}
function mdExportRows(title: string, headers: string[], rows: string[][], filename: string, branch: string, date: string) {
    // Reuse the existing StockNBook dashboard PDF generator, loaded only on export.
    // No separate PDF component, extra file, or duplicate document renderer.
    exportTableAsPdf({ title, headers, rows }, {
        storeName: getSavedItem("store_name") || getSavedItem("stocknbook_store_name") || "StockNBook",
        branch,
        dateRange: date,
    }, filename);
}

function MdWrenchIcon() { return <MdWrench size={24}/>; }
function MDWalletIcon() { return <MdWallet size={24}/>; }
function MDPeopleIcon() { return <MdUsers size={18}/>; }
function MDBellIcon() { return <MdBell size={18}/>; }
function MdCloseIcon() { return <MdX size={18}/>; }
function MdCheckIcon() { return <MdCheckCircle size={20}/>; }
function MDStatusBadge({ status }: { status: string }) {
    const key = status.toLowerCase();
    const colors = key === "approved" ? "bg-[#E6F7EE] text-[#16834A]" :
        key === "rejected" ? "bg-[#FFF0F0] text-[#D52B2B]" : "bg-[#FFF3D8] text-[#B66A00]";
    return <span className={`inline-flex max-w-full rounded-full px-2 py-1 text-[9px] font-bold uppercase ${colors}`}>{status}</span>;
}
function MDAttendanceBadge({ status }: { status: string }) {
    const label = String(status || "Not Recorded");
    const classes = label === "On Duty" || label === "Completed" || label === "Present"
        ? "bg-[#E6F7EE] text-[#16834A]"
        : label === "On Leave" ? "bg-[#FFF3D8] text-[#A56607]"
            : label === "Absent" ? "bg-[#FFF0F0] text-[#D52B2B]" : "bg-[#F2EFF5] text-[#806A8C]";
    return <span className={`inline-flex max-w-full whitespace-nowrap rounded-full px-2 py-1 text-[9px] font-semibold ${classes}`}>{label}</span>;
}
function MDStockBadge({ status }: { status: string }) {
    const colors = status === "Expired" || status === "Out of Stock" ? "bg-[#FFF0F0] text-[#D52B2B]" :
        status.includes("Low") ? "bg-[#FFF3D8] text-[#B66A00]" : "bg-[#F1EBFF] text-[#6D35D4]";
    return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase ${colors}`}>{status}</span>;
}
function MDPanel({ title, subtitle, icon, children, onExport, search, setSearch, searchPlaceholder, headerActions, tall = false }: {
    title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode;
    onExport: () => void; search?: string; setSearch?: (value: string) => void; searchPlaceholder?: string;
    headerActions?: React.ReactNode; tall?: boolean;
}) {
    return <section className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E9E0EF] bg-white shadow-sm ${tall ? "h-[380px]" : "h-[320px]"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#EEE7F2] px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">{icon}</span><div className="min-w-0"><h2 className="text-[15px] font-bold text-[#1A1220]">{title}</h2><p className="mt-0.5 text-[11px] text-[#9A8DA8]">{subtitle}</p></div></div>
            <div className="flex flex-wrap items-center gap-2">{setSearch && <div className="relative hidden sm:block"><MdSearch size={13} className="absolute left-2 top-2.5 text-[#806A8C]"/><input aria-label={`Search ${title}`} value={search || ""} onChange={e => setSearch(e.target.value)} className="h-8 w-40 rounded-lg border border-[#E6DDF0] pl-7 pr-2 text-[10px] outline-none focus:border-[#8B65B9]" placeholder={searchPlaceholder}/></div>}
                {headerActions}
                <button type="button" title={`Export ${title} as PDF`} aria-label={`Export ${title} as PDF`} onClick={onExport} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E6DDF0] text-[#6D35D4] hover:bg-[#F7F1FF]"><MdDownload size={16}/></button>
            </div>
        </div>{children}
    </section>;
}
function MDChartCard({title, subtitle, icon, total, centerLabel, segments, exportClick, error, reserveFooter = false}: {
    title: string; subtitle: string; icon: React.ReactNode; total: number | null; centerLabel: string;
    segments: ManagerSegment[]; exportClick: () => void; error?: string; reserveFooter?: boolean;
}) {
    const sum = segments.reduce((a, b) => a + b.value, 0);
    let cursor = 0;
    const stops = segments.map(seg => {
        const start = sum ? cursor / sum * 100 : 0;
        cursor += seg.value;
        const end = sum ? cursor / sum * 100 : 0;
        return `${seg.color} ${start}% ${end}%`;
    });
    const background = sum ? `conic-gradient(${stops.join(",")})` : "#F2EDF6";
    return <section className="flex h-[360px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E9E0EF] bg-white shadow-sm">
        <div className="flex items-start justify-between gap-2 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">{icon}</span><div className="min-w-0"><h2 className="text-[15px] font-bold text-[#1A1220]">{title}</h2><p className="mt-0.5 text-[11px] text-[#9A8DA8]">{subtitle}</p></div></div>
            <button type="button" title={`Export ${title} as PDF`} aria-label={`Export ${title} as PDF`} onClick={exportClick} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E6DDF0] text-[#6D35D4] hover:bg-[#F7F1FF]"><MdDownload size={16}/></button>
        </div>
        {error ? <p role="alert" className="mx-4 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}
        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 sm:flex-row sm:gap-4 ${reserveFooter ? "pb-12" : "pb-4"}`}>
            <div className="relative flex h-[158px] w-[158px] shrink-0 items-center justify-center rounded-full" style={{ background }} role="img" aria-label={`${title}: ${segments.map(s => `${s.label} ${s.value}`).join(", ")}`}>
                <div className="absolute inset-[23%] flex flex-col items-center justify-center rounded-full bg-white text-center"><span className="text-[25px] font-bold leading-none text-[#1A1220]">{total === null ? "—" : total.toLocaleString("en-PH")}</span><span className="mt-1 text-[10px] text-[#806A8C]">{centerLabel}</span></div>
            </div>
            <div className="grid w-full min-w-0 max-w-[235px] grid-cols-1 gap-3">{segments.map(seg => <div key={seg.label} className="flex min-w-0 items-center justify-between gap-2 text-[10px]"><span className="flex min-w-0 items-center gap-1.5 font-semibold text-[#4B3E55]"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{backgroundColor:seg.color}}/><span className="truncate">{seg.label}</span></span><span className="shrink-0 font-bold text-[#2B174C]">{seg.value}</span></div>)}</div>
        </div>
    </section>;
}

/* ----------------------------------------------------------------------- */
/* Manager role dashboard helpers                                           */
/* ----------------------------------------------------------------------- */

type ManagerSegment = {
    label: string;
    value: number;
    color: string;
};

type ManagerAttentionItem = {
    key: string;
    productName: string;
    variantName: string;
    status: "Expired" | "Out of Stock" | "Very Low Stock" | "Expiring Soon" | "Low Stock";
    detail: string;
    priority: number;
};

type BookingTrendRange = "8w" | "3m" | "6m" | "12m";

type BookingTrendRangeOption = {
    value: BookingTrendRange;
    label: string;
};

const BOOKING_TREND_RANGE_OPTIONS: BookingTrendRangeOption[] = [
    { value: "8w", label: "Last 8 Weeks" },
    { value: "3m", label: "Last 3 Months" },
    { value: "6m", label: "Last 6 Months" },
    { value: "12m", label: "Last 12 Months" },
];

const BOOKING_TREND_RANGE_CONFIG: Record<
    BookingTrendRange,
    { subtitle: string; bucket: "week" | "month"; bucketCount: number }
> = {
    "8w": {
        subtitle: "Weekly booking status over the last 8 weeks",
        bucket: "week",
        bucketCount: 8,
    },
    "3m": {
        subtitle: "Weekly booking status over the last 3 months",
        bucket: "week",
        bucketCount: 13,
    },
    "6m": {
        subtitle: "Monthly booking status over the last 6 months",
        bucket: "month",
        bucketCount: 6,
    },
    "12m": {
        subtitle: "Monthly booking status over the last 12 months",
        bucket: "month",
        bucketCount: 12,
    },
};

type ManagerTrendPoint = {
    label: string;
    [key: string]: string | number;
};

type ManagerLineSeries = {
    key: string;
    label: string;
    color: string;
    info?: string;
};

type InventoryForecastRisk = "High" | "Medium" | "Low";

type ManagerInventoryForecastRow = {
    key: string;
    productName: string;
    currentStock: number;
    averageDailyUsage: number;
    estimatedStockoutDays: number;
    suggestedRestock: number;
    risk: InventoryForecastRisk;
};

function parseManagerDate(value?: string | null) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function managerAttentionKey(productName: string, variantName: string) {
    return `${productName.trim().toLowerCase()}::${variantName.trim().toLowerCase()}`;
}

function buildManagerAttentionItems(
    stockAlerts: StockAlertItem[],
    expirationAlerts: ExpirationAlertItem[],
): ManagerAttentionItem[] {
    const map = new Map<string, ManagerAttentionItem>();

    stockAlerts.forEach((item) => {
        const key = managerAttentionKey(item.productName, item.variantName);
        const isOut = item.status === "Out of Stock";
        const veryLowThreshold = Math.max(1, Math.ceil(item.alertLevel * 0.5));
        const isVeryLow =
            !isOut &&
            item.currentStock > 0 &&
            item.currentStock <= veryLowThreshold;

        const status: ManagerAttentionItem["status"] =
            isOut
                ? "Out of Stock"
                : isVeryLow
                    ? "Very Low Stock"
                    : "Low Stock";

        const priority =
            status === "Out of Stock"
                ? 4
                : status === "Very Low Stock"
                    ? 3
                    : 1;

        map.set(key, {
            key,
            productName: item.productName,
            variantName: item.variantName || "—",
            status,
            detail: isOut
                ? "0 remaining"
                : `${item.currentStock} remaining · reorder at ${item.alertLevel}`,
            priority,
        });
    });

    expirationAlerts.forEach((item) => {
        const key = managerAttentionKey(item.productName, item.variantName);
        const expired = item.status === "Expired";
        const next: ManagerAttentionItem = {
            key,
            productName: item.productName,
            variantName: item.variantName || "—",
            status: expired ? "Expired" : "Expiring Soon",
            detail: formatExpirationDistance(item.daysRemaining),
            priority: expired ? 5 : 2,
        };

        const existing = map.get(key);
        if (!existing || next.priority > existing.priority) {
            map.set(key, next);
        }
    });

    return Array.from(map.values()).sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;

        // Keep ties deterministic and useful: lower remaining stock first.
        return a.productName.localeCompare(b.productName);
    });
}

function buildBookingOverview(bookings: Booking[], reference: Date) {
    const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
    const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);

    const counts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };

    bookings.forEach((booking) => {
        const date = parseManagerDate(booking.date);
        if (!date || date < start || date >= end) return;

        const status = normalizeDashboardBookingStatus(booking.status);
        if (status === "Completed") counts.completed += 1;
        else if (status === "Cancelled") counts.cancelled += 1;
        else if (status === "Confirmed" || status === "Preparing") counts.confirmed += 1;
        else counts.pending += 1;
    });

    const total = counts.pending + counts.confirmed + counts.completed + counts.cancelled;

    return {
        total,
        segments: [
            { label: "Pending", value: counts.pending, color: "#F5B51B" },
            { label: "Confirmed", value: counts.confirmed, color: "#159455" },
            { label: "Completed", value: counts.completed, color: "#2F7BEA" },
            { label: "Cancelled", value: counts.cancelled, color: "#EF4444" },
        ] satisfies ManagerSegment[],
    };
}

function getManagerInventoryUnitIds(products: Product[]) {
    return products.flatMap((product) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.length > 0) {
            return variants.map(
                (variant, index) =>
                    `${product.id}-variant-${variant.id || index}`,
            );
        }
        return [`${product.id}-regular`];
    });
}

function buildInventoryHealth(
    products: Product[],
    stockAlerts: StockAlertItem[],
    expirationAlerts: ExpirationAlertItem[],
) {
    const allIds = getManagerInventoryUnitIds(products);
    const outIds = new Set(
        stockAlerts.filter((item) => item.status === "Out of Stock").map((item) => item.id),
    );
    const lowIds = new Set(
        stockAlerts.filter((item) => item.status === "Low Stock").map((item) => item.id),
    );
    const expiryIds = new Set(expirationAlerts.map((item) => item.id));

    let out = 0;
    let low = 0;
    let expiring = 0;
    let healthy = 0;

    allIds.forEach((id) => {
        if (outIds.has(id)) out += 1;
        else if (lowIds.has(id)) low += 1;
        else if (expiryIds.has(id)) expiring += 1;
        else healthy += 1;
    });

    const total = allIds.length;

    return {
        total,
        segments: [
            { label: "Healthy Stock", value: healthy, color: "#159455" },
            { label: "Low Stock", value: low, color: "#F59E0B" },
            { label: "Out of Stock", value: out, color: "#EF4444" },
            { label: "Expiring Soon", value: expiring, color: "#6D35D4" },
        ] satisfies ManagerSegment[],
    };
}

function startOfManagerWeek(value: Date) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const distanceFromMonday = (day + 6) % 7;
    date.setDate(date.getDate() - distanceFromMonday);
    return date;
}

function getManagerWeeklyBuckets(reference: Date, count: number) {
    const currentWeek = startOfManagerWeek(reference);

    return Array.from({ length: count }, (_, index) => {
        const start = new Date(currentWeek);
        start.setDate(start.getDate() - (count - 1 - index) * 7);

        const end = new Date(start);
        end.setDate(end.getDate() + 7);

        return {
            start,
            end,
            label: start.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
            }),
        };
    });
}

function getManagerMonthlyBuckets(reference: Date, count: number) {
    return Array.from({ length: count }, (_, index) => {
        const monthsBack = count - 1 - index;
        const start = new Date(
            reference.getFullYear(),
            reference.getMonth() - monthsBack,
            1,
        );
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);

        return {
            start,
            end,
            label: start.toLocaleDateString("en-US", {
                month: "short",
                ...(count >= 12 ? { year: "2-digit" as const } : {}),
            }),
        };
    });
}

function buildBookingStatusTrend(
    bookings: Booking[],
    reference: Date,
    range: BookingTrendRange,
): ManagerTrendPoint[] {
    const config = BOOKING_TREND_RANGE_CONFIG[range];
    const buckets =
        config.bucket === "week"
            ? getManagerWeeklyBuckets(reference, config.bucketCount)
            : getManagerMonthlyBuckets(reference, config.bucketCount);

    return buckets.map((bucket) => {
        const point: ManagerTrendPoint = {
            label: bucket.label,
            pending: 0,
            confirmed: 0,
            completed: 0,
            cancelled: 0,
        };

        bookings.forEach((booking) => {
            const date = parseManagerDate(booking.createdAt || booking.date);
            if (!date || date < bucket.start || date >= bucket.end) return;

            const status = normalizeDashboardBookingStatus(booking.status);
            if (status === "Completed") point.completed = Number(point.completed) + 1;
            else if (status === "Cancelled") point.cancelled = Number(point.cancelled) + 1;
            else if (status === "Confirmed" || status === "Preparing") {
                point.confirmed = Number(point.confirmed) + 1;
            } else {
                point.pending = Number(point.pending) + 1;
            }
        });

        return point;
    });
}

function isManagerReleasedOrder(order: Order) {
    const type = String(order.orderType || "").trim().toLowerCase().replace(/_/g, "-");
    const status = String(order.status || "").trim().toLowerCase();
    const scheduled = [
        "scheduled",
        "schedule",
        "scheduled-order",
        "future",
        "future-order",
        "advance-order",
        "pre-order",
        "preorder",
    ].includes(type);
    const excluded = [
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
    return !scheduled && !excluded;
}

function managerForecastName(value?: string | null) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function getManagerProductStock(product: Product) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length > 0) {
        return variants.reduce(
            (sum, variant) => sum + Math.max(0, Number(variant.stock || 0)),
            0,
        );
    }
    return Math.max(0, Number(product.stock || 0));
}

function buildManagerInventoryForecast(
    products: Product[],
    orders: Order[],
    reference: Date,
): ManagerInventoryForecastRow[] {
    const HISTORY_DAYS = 30;
    const TARGET_COVERAGE_DAYS = 30;
    const historyStart = new Date(reference);
    historyStart.setHours(0, 0, 0, 0);
    historyStart.setDate(historyStart.getDate() - HISTORY_DAYS);

    const productIndex = products
        .map((product) => ({
            product,
            normalizedName: managerForecastName(product.name),
        }))
        .filter((item) => item.normalizedName);

    const releasedByProductId = new Map<number, number>();

    orders.filter(isManagerReleasedOrder).forEach((order) => {
        const date = parseManagerDate(order.orderDate || order.date || order.createdAt);
        if (!date || date < historyStart || date > reference) return;

        (order.items || []).forEach((item) => {
            const quantity = Math.max(0, Number(item.quantity || 0));
            if (quantity <= 0) return;

            const itemName = managerForecastName(item.name);
            if (!itemName) return;

            let matched = productIndex.find(
                (entry) => entry.normalizedName === itemName,
            );

            if (!matched) {
                matched = productIndex
                    .filter(
                        (entry) =>
                            itemName.includes(entry.normalizedName) ||
                            entry.normalizedName.includes(itemName),
                    )
                    .sort(
                        (first, second) =>
                            second.normalizedName.length - first.normalizedName.length,
                    )[0];
            }

            if (!matched) return;

            releasedByProductId.set(
                matched.product.id,
                (releasedByProductId.get(matched.product.id) || 0) + quantity,
            );
        });
    });

    return products
        .map((product) => {
            const releasedUnits = releasedByProductId.get(product.id) || 0;
            const averageDailyUsage = releasedUnits / HISTORY_DAYS;
            const currentStock = getManagerProductStock(product);

            if (averageDailyUsage <= 0) return null;

            const estimatedStockoutDays =
                currentStock <= 0 ? 0 : currentStock / averageDailyUsage;
            const suggestedRestock = Math.max(
                0,
                Math.ceil(averageDailyUsage * TARGET_COVERAGE_DAYS - currentStock),
            );

            const risk: InventoryForecastRisk =
                estimatedStockoutDays <= 7
                    ? "High"
                    : estimatedStockoutDays <= 14
                        ? "Medium"
                        : "Low";

            return {
                key: `forecast-${product.id}`,
                productName: product.name,
                currentStock,
                averageDailyUsage,
                estimatedStockoutDays,
                suggestedRestock,
                risk,
            } satisfies ManagerInventoryForecastRow;
        })
        .filter(
            (row): row is ManagerInventoryForecastRow =>
                Boolean(row) &&
                (row!.estimatedStockoutDays <= TARGET_COVERAGE_DAYS ||
                    row!.suggestedRestock > 0),
        )
        .sort((first, second) => {
            if (first.risk !== second.risk) {
                const priority: Record<InventoryForecastRisk, number> = {
                    High: 3,
                    Medium: 2,
                    Low: 1,
                };
                return priority[second.risk] - priority[first.risk];
            }
            return first.estimatedStockoutDays - second.estimatedStockoutDays;
        })
        .slice(0, 3);
}

function ManagerMetricCard({
                               title,
                               value,
                               subtitle,
                               icon,
                               tone,
                               onClick,
                           }: {
    title: string;
    value: number;
    subtitle: string;
    icon: React.ReactNode;
    tone: DashboardTone;
    onClick?: () => void;
}) {
    const style = toneStyles[tone];

    return (
        <button
            type="button"
            onClick={onClick}
            className="flex min-h-[116px] w-full items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm transition hover:border-[#D7C9E3] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#D9C6F5]"
        >
            <span
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${style.background} ${style.icon}`}
            >
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-5 text-[#4B3E55]">
                    {title}
                </span>
                <span className="mt-1 block text-[28px] font-bold leading-none tracking-[-0.03em] text-[#1A1220]">
                    {value.toLocaleString("en-PH")}
                </span>
                <span className="mt-2 block text-[11px] leading-4 text-[#8A7D92]">
                    {subtitle}
                </span>
            </span>
        </button>
    );
}

function ManagerDonutPanel({
                               title,
                               subtitle,
                               icon,
                               centerValue,
                               centerLabel,
                               periodLabel,
                               segments,
                           }: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    centerValue: number;
    centerLabel: string;
    periodLabel: string;
    segments: ManagerSegment[];
}) {
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    let cursor = 0;
    const stops = segments.map((segment) => {
        const start = total > 0 ? (cursor / total) * 100 : 0;
        cursor += segment.value;
        const end = total > 0 ? (cursor / total) * 100 : 0;
        return `${segment.color} ${start}% ${end}%`;
    });
    const background = total > 0 ? `conic-gradient(${stops.join(", ")})` : "#F2EDF6";

    return (
        <div className="flex h-[318px] min-w-0 flex-col rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                        {icon}
                    </span>
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-[#1A1220]">{title}</h3>
                        <p className="truncate text-[11px] text-[#9A8DA8]">{subtitle}</p>
                    </div>
                </div>
                <span className="shrink-0 rounded-lg border border-[#E6DDF0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#5F4E75] shadow-sm">
                    {periodLabel}
                </span>
            </div>

            <div className="mt-4 grid flex-1 grid-cols-[150px_minmax(0,1fr)] items-center gap-4">
                <div className="relative mx-auto h-[150px] w-[150px] rounded-full" style={{ background }}>
                    <div className="absolute inset-[28px] flex flex-col items-center justify-center rounded-full bg-white text-center">
                        <span className="text-[24px] font-bold leading-none text-[#1A1220]">
                            {centerValue.toLocaleString("en-PH")}
                        </span>
                        <span className="mt-1 text-[10px] font-medium text-[#8A7D92]">{centerLabel}</span>
                    </div>
                </div>

                <div className="min-w-0 space-y-3">
                    {segments.map((segment) => {
                        const pct = total > 0 ? (segment.value / total) * 100 : 0;
                        return (
                            <div key={segment.label} className="grid grid-cols-[minmax(0,1fr)_36px_46px] items-center gap-2 text-[11px]">
                                <span className="flex min-w-0 items-center gap-2 font-semibold text-[#4B3E55]">
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                                    <span className="truncate">{segment.label}</span>
                                </span>
                                <span className="text-right font-bold text-[#2B174C]">{segment.value}</span>
                                <span className="text-right text-[#8A7D92]">{pct.toFixed(1)}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function attentionStatusClasses(status: ManagerAttentionItem["status"]) {
    if (status === "Expired") {
        return "bg-[#FDECEC] text-[#B42318]";
    }
    if (status === "Out of Stock") {
        return "bg-[#FFF0F0] text-[#D52B2B]";
    }
    if (status === "Very Low Stock") {
        return "bg-[#FFF0E5] text-[#C45100]";
    }
    if (status === "Expiring Soon") {
        return "bg-[#F1EBFF] text-[#6D35D4]";
    }
    return "bg-[#FFF3D8] text-[#B66A00]";
}

function attentionStatusLabel(status: ManagerAttentionItem["status"]) {
    if (status === "Expired") return "EXPIRED";
    if (status === "Out of Stock") return "OUT OF STOCK";
    if (status === "Very Low Stock") return "VERY LOW";
    if (status === "Expiring Soon") return "EXPIRING SOON";
    return "LOW STOCK";
}

function ItemsRequiringAttentionPanel({
                                          items,
                                          total,
                                          onViewAll,
                                      }: {
    items: ManagerAttentionItem[];
    total: number;
    onViewAll: () => void;
}) {
    return (
        <div className="flex h-[318px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E9E0EF] bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FDECEC] text-[#DC2626]">
                        <TriangleAlert size={18} />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-[15px] font-bold leading-5 text-[#1A1220]">
                            Items Requiring Attention
                        </h3>
                        <p className="text-[11px] leading-4 text-[#9A8DA8]">
                            Prioritized by urgency: expired items appear first
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onViewAll}
                    className="shrink-0 rounded-lg border border-[#E6DDF0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#5F4E75] shadow-sm"
                >
                    View All
                </button>
            </div>

            <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(72px,.75fr)_minmax(104px,.9fr)] gap-2 border-y border-[#EEE7F5] bg-[#FCFAFE] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.04em] text-[#6D5B79]">
                <span>Product</span>
                <span>Variant</span>
                <span>Status</span>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-[#F0EAF4] overflow-hidden">
                {items.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-[#9A8DA8]">
                        No inventory items currently need immediate attention.
                    </div>
                ) : (
                    items.map((item) => (
                        <div
                            key={item.key}
                            className="grid min-h-[46px] grid-cols-[minmax(0,1.45fr)_minmax(72px,.75fr)_minmax(104px,.9fr)] items-center gap-2 px-4 py-2"
                        >
                            <div className="min-w-0">
                                <p className="truncate text-[11px] font-semibold text-[#2B174C]" title={item.productName}>
                                    {item.productName}
                                </p>
                            </div>

                            <p className="truncate text-[10px] font-medium text-[#6D5B79]" title={item.variantName}>
                                {item.variantName || "—"}
                            </p>

                            <div className="min-w-0">
                                <span
                                    className={`inline-flex max-w-full whitespace-nowrap rounded-full px-2 py-1 text-[8px] font-bold leading-none ${attentionStatusClasses(item.status)}`}
                                >
                                    {attentionStatusLabel(item.status)}
                                </span>
                                <p className="mt-1 truncate text-[9px] text-[#9A8DA8]" title={item.detail}>
                                    {item.detail}
                                </p>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="border-t border-[#EEE7F5] px-4 py-2 text-right text-[9px] text-[#9A8DA8]">
                Showing {Math.min(items.length, 5)} of {total} items
            </div>
        </div>
    );
}

function managerForecastRiskClasses(risk: InventoryForecastRisk) {
    if (risk === "High") return "bg-[#FDECEC] text-[#D52B2B]";
    if (risk === "Medium") return "bg-[#FFF3D8] text-[#B66A00]";
    return "bg-[#E8F6EC] text-[#17733A]";
}

function formatManagerStockoutDays(value: number) {
    if (!Number.isFinite(value)) return "—";
    if (value <= 0) return "Now";
    if (value < 1) return "<1 day";
    return `${Math.ceil(value)} ${Math.ceil(value) === 1 ? "day" : "days"}`;
}

function ManagerForecastInfoTooltip({
                                        label,
                                        formula,
                                        note,
                                        align = "center",
                                    }: {
    label: string;
    formula: string;
    note: string;
    align?: "left" | "center" | "right";
}) {
    const tooltipPositionClass =
        align === "left"
            ? "left-0"
            : align === "right"
                ? "right-0"
                : "left-1/2 -translate-x-1/2";

    return (
        <span className="group relative inline-flex shrink-0 align-middle">
            <button
                type="button"
                aria-label={`${label} explanation`}
                className="inline-flex h-[15px] w-[15px] items-center justify-center rounded-full border border-[#D9CDE7] bg-[#FAF7FF] text-[#6D35D4] transition hover:border-[#BCA7DB] hover:bg-[#F1EBFF] focus:outline-none focus:ring-2 focus:ring-[#D9C6F5]"
            >
                <Info size={9} strokeWidth={2.2} />
            </button>

            {/*
             * The arrow is anchored to the INFO BUTTON wrapper itself instead
             * of to the tooltip box. This guarantees that its tip stays exactly
             * centered under the icon even when the tooltip box is left- or
             * right-aligned to avoid overflowing the panel.
             */}
            <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-full z-[51] hidden h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[5px] border-x-transparent border-b-[#2B174C] group-hover:block group-focus-within:block"
            />

            <span
                role="tooltip"
                className={`pointer-events-none absolute top-full z-50 mt-[5px] hidden w-[245px] max-w-[calc(100vw-2rem)] rounded-lg border border-[#E5DAEE] bg-[#2B174C] px-3 py-2 text-left text-[10px] font-medium leading-4 text-white shadow-lg group-hover:block group-focus-within:block ${tooltipPositionClass}`}
            >
                <span className="block font-bold">{label}</span>
                <span className="mt-0.5 block">{formula}</span>
                <span className="mt-1 block text-[#E8DFF2]">{note}</span>
            </span>
        </span>
    );
}

function ManagerInventoryForecastPanel({
                                           rows,
                                           onViewInventory,
                                       }: {
    rows: ManagerInventoryForecastRow[];
    onViewInventory: () => void;
}) {
    return (
        <div className="flex h-[320px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                        <Sparkles size={18} />
                    </span>
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-[#1A1220]">
                            Inventory Forecast
                        </h3>
                        <p className="truncate text-[11px] text-[#9A8DA8]">
                            Projected stock needs based on recent POS usage
                        </p>
                    </div>
                </div>
                <span className="shrink-0 rounded-lg border border-[#E6DDF0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#5F4E75] shadow-sm">
                    Next 30 Days
                </span>
            </div>

            <div className="mt-3 min-h-0 flex-1">
                {rows.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EAF7F0] text-[#159455]">
                            <Sparkles size={20} />
                        </span>
                        <p className="mt-3 text-[12px] font-semibold text-[#2B174C]">
                            No immediate restock risk detected
                        </p>
                        <p className="mt-1 max-w-[360px] text-[10px] leading-4 text-[#9A8DA8]">
                            The dashboard needs recent released POS quantities before it can project a meaningful stockout risk.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#F0EAF4]">
                        {rows.map((row) => (
                            <div
                                key={row.key}
                                className="grid grid-cols-[minmax(0,1.55fr)_70px_84px_96px] items-center gap-3 py-3"
                            >
                                <div className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <p
                                            className="truncate text-[11px] font-semibold text-[#2B174C]"
                                            title={row.productName}
                                        >
                                            {row.productName}
                                        </p>
                                        <span
                                            className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold ${managerForecastRiskClasses(row.risk)}`}
                                        >
                                            {row.risk.toUpperCase()} RISK
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 text-[9px] text-[#9A8DA8]">
                                        <span>
                                            {row.currentStock.toLocaleString("en-PH")} in stock · {row.averageDailyUsage.toFixed(1)} avg. units/day
                                        </span>
                                        <ManagerForecastInfoTooltip
                                            label="Average Daily Usage"
                                            formula="Units Released ÷ 30 days"
                                            note="Average units released per day from recent POS transactions."
                                            align="left"
                                        />
                                    </div>
                                </div>

                                <div className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <p className="text-[8px] font-bold uppercase tracking-[0.04em] text-[#9A8DA8]">
                                            Stockout
                                        </p>
                                        <ManagerForecastInfoTooltip
                                            label="Estimated Stockout"
                                            formula="Current Stock ÷ Avg. Daily Usage"
                                            note="Estimated days until stock reaches zero if recent usage continues."
                                            align="right"
                                        />
                                    </div>
                                    <p className="mt-1 text-[11px] font-bold text-[#2B174C]">
                                        {formatManagerStockoutDays(row.estimatedStockoutDays)}
                                    </p>
                                </div>

                                <div className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <p className="text-[8px] font-bold uppercase tracking-[0.04em] text-[#9A8DA8]">
                                            Restock
                                        </p>
                                        <ManagerForecastInfoTooltip
                                            label="Suggested Restock"
                                            formula="(Avg. Daily Usage × 30) − Current Stock"
                                            note="Suggested units needed to restore approximately 30 days of stock coverage."
                                            align="right"
                                        />
                                    </div>
                                    <p className="mt-1 text-[11px] font-bold text-[#159455]">
                                        +{row.suggestedRestock.toLocaleString("en-PH")} units
                                    </p>
                                </div>

                                <div className="text-right">
                                    <p className="text-[8px] font-bold uppercase tracking-[0.04em] text-[#9A8DA8]">
                                        Current
                                    </p>
                                    <p className="mt-1 text-[11px] font-bold text-[#2B174C]">
                                        {row.currentStock.toLocaleString("en-PH")} units
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-[#F0EAF4] pt-2">
                <p className="text-[9px] text-[#9A8DA8]">
                    Based on the last 30 days of released POS quantities; target coverage is 30 days.
                </p>
                <button
                    type="button"
                    onClick={onViewInventory}
                    className="shrink-0 text-[10px] font-semibold text-[#6D35D4] hover:underline"
                >
                    View Inventory →
                </button>
            </div>
        </div>
    );
}

function managerNiceStep(value: number) {
    if (value <= 0) return 1;
    const exponent = Math.floor(Math.log10(value));
    const base = 10 ** exponent;
    const fraction = value / base;
    if (fraction <= 1) return base;
    if (fraction <= 2) return 2 * base;
    if (fraction <= 2.5) return 2.5 * base;
    if (fraction <= 5) return 5 * base;
    return 10 * base;
}

function ManagerLineChartPanel({
                                   title,
                                   subtitle,
                                   icon,
                                   periodValue,
                                   periodOptions,
                                   onPeriodChange,
                                   data,
                                   series,
                               }: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    periodValue: BookingTrendRange;
    periodOptions: BookingTrendRangeOption[];
    onPeriodChange: (value: BookingTrendRange) => void;
    data: ManagerTrendPoint[];
    series: ManagerLineSeries[];
}) {
    return (
        <div className="flex h-[320px] min-w-0 flex-col rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                        {icon}
                    </span>
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-[#1A1220]">{title}</h3>
                        <p className="truncate text-[11px] text-[#9A8DA8]">{subtitle}</p>
                    </div>
                </div>
                <label className="relative shrink-0">
                    <span className="sr-only">Booking trend period</span>
                    <select
                        value={periodValue}
                        onChange={(event) =>
                            onPeriodChange(event.target.value as BookingTrendRange)
                        }
                        className="h-8 cursor-pointer rounded-lg border border-[#E6DDF0] bg-white px-2.5 pr-7 text-[11px] font-semibold text-[#5F4E75] shadow-sm outline-none transition focus:border-[#BCA7D7] focus:ring-2 focus:ring-[#EDE4FA]"
                    >
                        {periodOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="mt-2 min-h-0 flex-1">
                <ManagerMultiLineChart data={data} series={series} />
            </div>

            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[10px] font-semibold text-[#5F4E75]">
                {series.map((item) => {
                    const total = data.reduce(
                        (sum, point) => sum + Math.max(0, Number(point[item.key] || 0)),
                        0,
                    );

                    return (
                        <span
                            key={item.key}
                            className="inline-flex items-center gap-1.5"
                            title={total === 0 ? `${item.label}: no recorded movement in this period` : `${item.label}: ${total.toLocaleString("en-PH")} bookings in this period`}
                        >
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: item.color }}
                            />
                            {item.label}
                            {total === 0 && (
                                <span className="rounded-full bg-[#F5F1F8] px-1.5 py-0.5 text-[8px] font-bold text-[#8A7D92]">
                                    0
                                </span>
                            )}
                            {item.info && (
                                <span title={item.info} className="inline-flex cursor-help text-[#6D35D4]">
                                    <Info size={11} />
                                </span>
                            )}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

function ManagerMultiLineChart({
                                   data,
                                   series,
                               }: {
    data: ManagerTrendPoint[];
    series: ManagerLineSeries[];
}) {
    const width = 700;
    const height = 220;
    const margin = { top: 12, right: 14, bottom: 34, left: 42 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const allValues = data.flatMap((point) =>
        series.map((item) => Math.max(0, Number(point[item.key] || 0))),
    );
    const maxValue = Math.max(0, ...allValues);
    const step = managerNiceStep(Math.max(1, maxValue) / 4);
    const axisMax = Math.max(step * 4, maxValue || 1);
    const ticks = [0, 1, 2, 3, 4].map((index) => step * index);

    const xFor = (index: number) =>
        margin.left + (data.length > 1 ? (index / (data.length - 1)) * innerW : innerW / 2);
    const yFor = (value: number) => margin.top + innerH - (value / axisMax) * innerH;
    const baselineY = yFor(0);

    const seriesValues = new Map(
        series.map((item) => [
            item.key,
            data.map((point) => Math.max(0, Number(point[item.key] || 0))),
        ]),
    );

    const zeroSeries = series.filter((item) =>
        (seriesValues.get(item.key) || []).every((value) => value === 0),
    );
    const zeroSeriesIndex = new Map(zeroSeries.map((item, index) => [item.key, index]));

    const safeGradientId = (key: string) =>
        `managerFill-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

    const areaPath = (points: { x: number; y: number }[]) => {
        if (points.length === 0) return "";
        const line = points
            .map(
                (point, index) =>
                    `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
            )
            .join(" ");
        const first = points[0];
        const last = points[points.length - 1];
        return `${line} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;
    };

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-full w-full"
            role="img"
            aria-label="Dashboard trend chart"
        >
            <defs>
                {series.map((item) => (
                    <linearGradient
                        key={item.key}
                        id={safeGradientId(item.key)}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                    >
                        <stop offset="0%" stopColor={item.color} stopOpacity="0.16" />
                        <stop offset="72%" stopColor={item.color} stopOpacity="0.045" />
                        <stop offset="100%" stopColor={item.color} stopOpacity="0" />
                    </linearGradient>
                ))}
                <filter id="managerLineSoftShadow" x="-10%" y="-25%" width="120%" height="150%">
                    <feDropShadow dx="0" dy="1.4" stdDeviation="1.8" floodColor="#2B174C" floodOpacity="0.10" />
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
                        fontSize="10"
                        fill="#9A8DA8"
                    >
                        {Math.round(tick)}
                    </text>
                </g>
            ))}

            {/* Soft area shadows, matching the Owner dashboard chart treatment. */}
            {series.map((item) => {
                const values = seriesValues.get(item.key) || [];
                const isZeroSeries = values.every((value) => value === 0);
                if (isZeroSeries) return null;

                const points = values.map((value, index) => ({
                    x: xFor(index),
                    y: yFor(value),
                }));

                return (
                    <path
                        key={`area-${item.key}`}
                        d={areaPath(points)}
                        fill={`url(#${safeGradientId(item.key)})`}
                        stroke="none"
                        pointerEvents="none"
                    />
                );
            })}

            {series.map((item) => {
                const values = seriesValues.get(item.key) || [];
                const isZeroSeries = values.every((value) => value === 0);
                const zeroIndex = zeroSeriesIndex.get(item.key) ?? 0;

                const points = values.map((value, index) => ({
                    x: xFor(index),
                    y: yFor(value),
                }));
                const path = points
                    .map(
                        (point, index) =>
                            `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
                    )
                    .join(" ");

                /*
                 * When two series are both 0, they occupy the exact same baseline.
                 * Keep both values mathematically at 0, but use different stroke widths /
                 * dash patterns so one line does not completely hide the other.
                 */
                const zeroStrokeWidth = zeroIndex === 0 ? 4.6 : 2.4;
                const zeroDash = zeroIndex === 0 ? undefined : zeroIndex === 1 ? "6 4" : "2 4";

                return (
                    <g key={item.key}>
                        <path
                            d={path}
                            fill="none"
                            stroke={item.color}
                            strokeWidth={isZeroSeries ? zeroStrokeWidth : 2.4}
                            strokeDasharray={isZeroSeries ? zeroDash : undefined}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={isZeroSeries ? 0.9 : 1}
                            filter={isZeroSeries ? undefined : "url(#managerLineSoftShadow)"}
                        />
                        {points.map((point, index) => (
                            <circle
                                key={`${item.key}-${index}`}
                                cx={point.x}
                                cy={point.y}
                                r={isZeroSeries ? (zeroIndex === 0 ? 3.4 : 2.2) : 3}
                                fill={item.color}
                                stroke="white"
                                strokeWidth={isZeroSeries ? 0.8 : 0.6}
                            >
                                <title>
                                    {`${data[index]?.label}: ${item.label} ${Number(data[index]?.[item.key] || 0)}`}
                                </title>
                            </circle>
                        ))}
                    </g>
                );
            })}

            {data.map((point, index) => {
                const shouldShowLabel =
                    data.length <= 10 ||
                    index % 2 === 0 ||
                    index === data.length - 1;

                if (!shouldShowLabel) return null;

                return (
                    <text
                        key={`${point.label}-${index}`}
                        x={xFor(index)}
                        y={height - 9}
                        textAnchor="middle"
                        fontSize="9.5"
                        fill="#9A8DA8"
                    >
                        {point.label}
                    </text>
                );
            })}
        </svg>
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
        <section className="flex min-h-[310px] flex-col overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
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
        <section className="flex min-h-[310px] flex-col overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
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
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl"
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

function ManagerStockAlertsModal({
                                     items,
                                     activeFilter,
                                     totalCount,
                                     lowStockCount,
                                     outOfStockCount,
                                     onChangeFilter,
                                     onClose,
                                 }: {
    items: StockAlertItem[];
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

                    <span className="!text-xs !font-semibold text-[#806A8C]">
                        View only
                    </span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[760px] table-fixed border-collapse">
                        <colgroup>
                            <col className="w-[34%]" />
                            <col className="w-[28%]" />
                            <col className="w-[14%]" />
                            <col className="w-[12%]" />
                            <col className="w-[12%]" />
                        </colgroup>

                        <thead className="sticky top-0 z-10 bg-[#FFFCF7]">
                        <tr className="border-b border-[#E9E0EF]">
                            {[
                                "Product",
                                "Variant",
                                "Current Stock",
                                "Alert Level",
                                "Status",
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
                                    colSpan={5}
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
                                    </tr>
                                );
                            })
                        )}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-[#E9E0EF] bg-[#FFFCF7] px-6 py-3 text-xs leading-5 text-[#7A6A84]">
                    Manager accounts can review stock alerts for their assigned branch here.
                </div>
            </div>
        </div>
    );
}