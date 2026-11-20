"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    AlertTriangle,
    BarChart3,
    PieChart,
    CalendarClock,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    ArrowRight,
    Info,
    PackageX,
    RefreshCw,
    Sparkles,
    TriangleAlert,
    Wrench as MdWrench, Wallet as MdWallet,
    X as MdX, CheckCircle2 as MdCheckCircle, Download as MdDownload, Search as MdSearch,
} from "lucide-react";
import DashboardExportMenu from "./DashboardExportMenu";
import type { ExportContext, ExportTable } from "./_shared";

// Keep the very large Reports/_shared module out of the initial dashboard bundle.
// It is loaded only if the user actually exports a dashboard table.
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
    reservationDate?: string;
    eventEndDate?: string;
    createdAt?: string;
    time?: string;
    status?: string;
    packageName?: string;
    eventName?: string;
    bookingNumber?: string;
    requiredDownPayment?: number | null;

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
        reservationDate: readText(raw, ["eventDate", "event_date", "date"]),
        eventEndDate: readText(raw, ["eventEndDate", "event_end_date"]),
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
        status: readText(raw, ["status"]) ? normalizeDashboardBookingStatus(readText(raw, ["status"])) : "Unknown",
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
        requiredDownPayment: readNullableNumber(raw, ["requiredDownPayment", "required_down_payment"]),
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
        <div className="flex min-h-[146px] min-w-0 items-center gap-4 rounded-[16px] border border-[#E6DDF0] bg-white px-5 py-4 shadow-sm">
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
    return <div className="space-y-4 animate-pulse" role="status" aria-label="Loading manager dashboard">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0,1,2,3].map(item=><div key={item} className={managerKpiCardClass}><span className="h-12 w-12 shrink-0 rounded-xl bg-[#EEE8F3]"/><span className="min-w-0 flex-1 space-y-2"><span className="block h-3.5 w-24 rounded bg-[#EEE8F3]"/><span className="block h-7 w-12 rounded bg-[#EEE8F3]"/></span></div>)}</div>
        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
                <div className={`${managerPanelClass} min-h-[220px] p-4`}><ManagerSkeletonBar className="h-4 w-40"/><div className="mt-5 flex flex-wrap items-center gap-4"><div className="mx-auto h-[132px] w-[132px] rounded-full border-[22px] border-[#EEE8F3]"/><div className="min-w-[120px] flex-1 space-y-2">{[0,1,2,3].map(i=><ManagerSkeletonBar key={i} className="h-6 w-full"/>)}</div></div></div>
                <div className={`${managerPanelClass} min-h-[200px] flex-1 p-4`}><ManagerSkeletonBar className="h-4 w-40"/><div className="mt-6 space-y-5">{[0,1,2].map(row=><ManagerSkeletonBar key={row} className="h-3 w-full"/>)}</div></div>
            </div>
            <div className={`${managerPanelClass} flex min-h-[360px] flex-col p-4`}><ManagerSkeletonBar className="h-4 w-40"/><div className="mt-5 grid flex-1 grid-cols-7 gap-1">{Array.from({length:35},(_,i)=><div key={i} className="min-h-9 rounded-md bg-[#F1EDF4]"/>)}</div><ManagerSkeletonBar className="mt-3 h-4 w-32"/><ManagerSkeletonBar className="mt-3 h-3 w-full"/></div>
        </div>
        <div className={`${managerPanelClass} min-h-[270px] p-4`}><ManagerSkeletonBar className="h-4 w-36"/><div className="mt-5 flex h-[150px] items-end justify-around gap-4">{[40,25,70,52,62,90].map((h,i)=><div key={i} className="w-[8%] rounded-t-md bg-[#EEE8F3]" style={{height:`${h}%`}}/>)}</div></div>
    </div>;
}

// Manager dashboard visual tokens match the Owner dashboard and booking KPI cards.
const managerKpiCardClass = "flex min-h-[108px] min-w-0 w-full items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-[#B6A1D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]";
const managerDashboardTones = {
    purple: "bg-[#F3EBFF] text-[#6C3AD6]",
    green: "bg-[#EAF7F0] text-[#25865B]",
    amber: "bg-[#FFF7E9] text-[#B7832E]",
    blue: "bg-[#E8F1FF] text-[#2169CF]",
    indigo: "bg-[#ECEEFF] text-[#4F57C5]",
    teal: "bg-[#E5F7F5] text-[#147D77]",
    rose: "bg-[#FCECF1] text-[#B74470]",
    orange: "bg-[#FFF0E5] text-[#C36A28]",
    cyan: "bg-[#E7F5FB] text-[#237C9B]",
} as const;
type ManagerDashboardTone = keyof typeof managerDashboardTones;
const managerPanelClass = "min-w-0 rounded-2xl border border-[#E7DFEC] bg-white shadow-sm";

// Dashboard-only projections of the existing branch-scoped APIs.
const MD_BOOKING_STAGES = ["Pending", "Approved", "Confirmed", "Preparing", "Released", "Completed"] as const;
type MDStage = typeof MD_BOOKING_STAGES[number];
type MDAlert = { key: string; product: string; status: string };
function mdStatus(booking: Booking) { return String(booking.status || "").trim().toLowerCase(); }
function mdStage(booking: Booking): MDStage | null {
    switch (mdStatus(booking)) {
        case "pending": case "pending review": return "Pending";
        case "approved": case "awaiting down payment": return "Approved";
        case "confirmed": return "Confirmed";
        case "preparing": return "Preparing";
        case "released": case "return inspection": case "pending settlement": return "Released";
        case "completed": return "Completed";
        default: return null; // Cancelled and unknown statuses are not active workflow stages.
    }
}
function mdBookingDay(value?: string) {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(raw)) return raw.slice(0, 10);
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? "" : mdLocalDay(date);
}
function mdBookingStatusLabel(booking: Booking) {
    switch (mdStatus(booking)) {
        case "pending": return "Pending";
        case "pending review": return "Pending Review";
        case "approved": return "Approved";
        case "awaiting down payment": return "Awaiting Down Payment";
        case "pending settlement": return "Pending Settlement";
        default: return mdStage(booking) || "Unknown";
    }
}
function mdBookingStatusColor(booking: Booking) {
    return mdStage(booking) === "Approved" ? "text-[#2169CF]" :
        mdStatus(booking) === "pending settlement" ? "text-[#C36A28]" : "text-[#A66A00]";
}
function mdReference(booking: Booking) { return booking.bookingNumber || `#${booking.id}`; }
function mdRentalAlerts(equipment: unknown[]): MDAlert[] {
    return equipment.flatMap((value, index) => {
        const item = toRecord(value);
        if (item.active === false || item.active === 0) return [];
        const bookable = readNullableNumber(item, ["bookableToday"]);
        const total = readNullableNumber(item, ["totalUnits"]);
        const maintenance = readNullableNumber(item, ["maintenanceUnits"]);
        const missing = readNullableNumber(item, ["missingUnits"]);
        const threshold = readNullableNumber(item, ["alertLevel"]);
        if ([bookable, total, maintenance, missing, threshold].some(n => n === null || n < 0)) return [];
        const usable = Math.max(0, total! - maintenance! - missing!);
        const status = bookable! <= 0 ? (usable > 0 ? "Fully Booked" : "Unavailable") :
            threshold! > 0 && bookable! <= threshold! ? "Low Availability" : "";
        return status ? [{ key: `rental-${readText(item, ["id"], String(index))}`, product: readText(item, ["name"], "Rental equipment"), status }] : [];
    });
}
function mdUnderRepairCount(equipment: unknown[]): number {
    return equipment.reduce<number>((count, value) => {
        const item = toRecord(value);
        if (item.active === false || item.active === 0) return count;
        const maintenance = readNullableNumber(item, ["maintenanceUnits"]);
        return count + ((maintenance ?? 0) > 0 ? 1 : 0);
    }, 0);
}

function mdAlertClass(status: string) {
    return ["Out of Stock", "Unavailable", "Expired"].includes(status) ? "text-[#D52B2B]" :
        ["Low Stock", "Low Availability", "Very Low Stock", "Expiring Soon"].includes(status) ? "text-[#A66A00]" : "text-[#6D35D4]";
}

type MDTableRow = { key: string; left: string; right: string; statusColor?: string };
function MDCompactPanel({ title, description, icon, tone, headers, rows, unavailable, empty, onViewAll }: {
    title: string; description: string; icon: React.ReactNode; tone: ManagerDashboardTone; headers: [string, string]; rows: MDTableRow[];
    unavailable: boolean; empty: string; onViewAll: () => void;
}) {
    return <section className={`${managerPanelClass} flex min-h-[200px] flex-1 flex-col overflow-hidden`}>
        <div className="flex min-h-[56px] min-w-0 items-center gap-2.5 px-4 pt-3.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${managerDashboardTones[tone]}`} aria-hidden="true">{icon}</span>
            <div className="min-w-0 flex-1">
                <h2 className="break-words text-[15px] font-bold leading-5 text-[#1A1220]">{title}</h2>
                <p className="mt-0.5 text-[11px] leading-4 text-[#86778F]">{description}</p>
            </div>
        </div>
        <div className="mt-3 max-h-[180px] min-h-0 flex-1 overflow-auto"><table className="w-full table-fixed text-[11px]">
            <thead className="bg-[#FFFCF7] text-[10px] font-semibold uppercase text-[#806A8C]"><tr><th className="w-[56%] px-3 py-2 text-left font-semibold">{headers[0]}</th><th className="px-3 py-2 text-right font-semibold">{headers[1]}</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.key} className="border-t border-[#F1ECF4]"><td className="break-words px-3 py-2 font-semibold text-[#392648]">{row.left}</td><td className={`break-words px-3 py-2 text-right font-semibold ${row.statusColor || "text-[#6D35D4]"}`}>{row.right}</td></tr>)}
            {!rows.length && <tr><td colSpan={2} className="h-[76px] px-4 text-center text-[#86778F]">{unavailable ? "Data unavailable. Refresh to try again." : empty}</td></tr>}</tbody>
        </table></div>
        <button type="button" onClick={onViewAll} className="border-t border-[#F1ECF4] px-4 py-2 text-right text-[11px] font-semibold text-[#6D35D4] hover:bg-[#FAF7FE]">View all</button>
    </section>;
}
type MDPieSlice = {
    key: string;
    label: string;
    value: number;
    color: string;
    bg: string;
};

function MDInventoryAlertsPie({ slices, unavailable, onViewAll }: {
    slices: MDPieSlice[];
    unavailable: boolean;
    onViewAll: () => void;
}) {
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const segments = slices.map((slice, index) => {
        const previousTotal = slices.slice(0, index).reduce((sum, previous) => sum + previous.value, 0);
        return {
            ...slice,
            length: total > 0 ? (slice.value / total) * circumference : 0,
            offset: total > 0 ? (previousTotal / total) * circumference : 0,
        };
    }).filter(slice => slice.value > 0);

    return <section className={`${managerPanelClass} flex min-h-[220px] shrink-0 flex-col overflow-hidden`}>
        <div className="flex min-h-[56px] min-w-0 items-center gap-2.5 px-4 pt-3.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${managerDashboardTones.rose}`} aria-hidden="true"><PieChart size={18}/></span>
            <div className="min-w-0 flex-1">
                <h2 className="break-words text-[15px] font-bold leading-5 text-[#1A1220]">Inventory Alert Summary</h2>
                <p className="mt-0.5 text-[11px] leading-4 text-[#86778F]">Alert distribution for consumable inventory items</p>
            </div>
        </div>
        <div className="mt-2 flex min-h-0 flex-1 flex-col px-4 pb-3">
            {unavailable ? <p className="flex flex-1 items-center justify-center text-center text-xs text-[#8A7D92]">Inventory alert summary unavailable.</p> : total === 0 ? <p className="flex flex-1 items-center justify-center text-center text-xs text-[#8A7D92]">No inventory alerts.</p> : <div className="flex flex-1 flex-col justify-center gap-3 sm:flex-row sm:items-center">
                <div className="mx-auto flex shrink-0 items-center justify-center">
                    <div className="relative h-[132px] w-[132px]">
                        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-label={slices.map(slice => `${slice.label}: ${slice.value}`).join(', ')} role="img">
                            <circle cx="80" cy="80" r={radius} fill="none" stroke="#F2ECF6" strokeWidth="22" />
                            {segments.map(segment => (
                                <circle key={segment.key} cx="80" cy="80" r={radius} fill="none" stroke={segment.color} strokeWidth="22" strokeLinecap="butt" strokeDasharray={`${segment.length} ${circumference - segment.length}`} strokeDashoffset={-segment.offset} />
                            ))}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-[#86778F]">Alerts</span>
                            <span className="mt-1 text-[24px] font-bold leading-none text-[#1A1220]">{total}</span>
                        </div>
                    </div>
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                    {slices.map(slice => <div key={slice.key} className={`flex items-center justify-between rounded-xl border border-[#EFE7F4] ${slice.bg} px-3 py-1`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                            <span className="truncate text-[12px] font-medium text-[#392648]">{slice.label}</span>
                        </div>
                        <span className="ml-3 text-[13px] font-bold text-[#1A1220]">{slice.value}</span>
                    </div>)}
                </div>
            </div>}
        </div>
        <button type="button" onClick={onViewAll} className="border-t border-[#F1ECF4] px-4 py-2 text-right text-[11px] font-semibold text-[#6D35D4] hover:bg-[#FAF7FE]">View all</button>
    </section>;
}

function MDBookingOverview({ counts, unavailable }: { counts: Record<MDStage, number>; unavailable: boolean }) {
    const max = Math.max(1, ...MD_BOOKING_STAGES.map(stage => counts[stage]));
    const step = Math.max(1, Math.ceil(max / 4));
    const axisMax = step * 4;
    return <section className={`${managerPanelClass} flex min-h-[270px] flex-col p-4`}>
        <div className="flex min-w-0 items-center gap-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${managerDashboardTones.indigo}`} aria-hidden="true"><BarChart3 size={18}/></span>
            <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold leading-5 text-[#1A1220]">Booking Overview</h2>
                <p className="mt-0.5 text-[11px] leading-4 text-[#86778F]">Booking status breakdown for the current month</p>
            </div>
        </div>
        {unavailable ? <p className="flex min-h-[150px] flex-1 items-center justify-center text-xs text-[#8A7D92]">Booking overview unavailable.</p> : <div className="flex min-h-0 flex-1 flex-col overflow-x-auto px-1 pb-1 pt-5"><div className="flex min-w-[420px] flex-1 flex-col"><div className="relative min-h-[150px] flex-1 pl-9" role="img" aria-label={`This month by event date: ${MD_BOOKING_STAGES.map(stage => `${stage} ${counts[stage]}`).join(", ")}. Released includes return inspection and pending settlement.`}>
            {[0,1,2,3,4].map(tick => <div key={tick} className="pointer-events-none absolute left-9 right-0 flex items-center border-t border-[#EEE7F2]" style={{bottom: `${tick * 25}%`}}><span className="absolute right-full mr-2 -translate-y-1/2 text-[10px] text-[#806A8C]">{tick * step}</span></div>)}
            <div className="absolute inset-y-0 left-9 right-0 flex items-end justify-around gap-2">{MD_BOOKING_STAGES.map(stage => <div key={stage} className="relative flex h-full min-w-0 flex-1 items-end justify-center"><div className="relative w-[54%] max-w-[70px] rounded-t-md bg-[#9670D9] transition-all" style={{height: `${counts[stage] / axisMax * 100}%`}} title={`${stage}: ${counts[stage]}${stage === "Released" ? " (includes return inspection and pending settlement)" : ""}`}><span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-[11px] font-semibold text-[#2B174C]">{counts[stage]}</span></div></div>)}</div>
        </div><div className="ml-9 flex shrink-0 justify-around gap-2 pt-2">{MD_BOOKING_STAGES.map(stage => <span key={stage} className="min-w-0 flex-1 text-center text-[10px] text-[#806A8C]">{stage}</span>)}</div></div></div>}
    </section>;
}

// Event-date calendar, independent of the current-month Booking Overview chart.
// Use UTC for calendar arithmetic on date-only values, with Manila's date as today.
function mdCalendarDate(value?: string): string {
    const raw = String(value || "").trim();
    const match = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/.exec(raw);
    if (!match) return "";
    const date = new Date(`${match[1]}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === match[1] ? match[1] : "";
}
function mdCalendarMonthShift(month: string, offset: number) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0,7);
}
function mdCalendarLabel(day: string, options: Intl.DateTimeFormatOptions) {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {...options, timeZone:"UTC"});
}
function mdCalendarDays(month: string): (string | null)[] {
    const first = new Date(`${month}-01T00:00:00Z`);
    const next = new Date(`${mdCalendarMonthShift(month,1)}-01T00:00:00Z`);
    const days = Math.round((next.getTime()-first.getTime()) / 86_400_000);
    const offset = first.getUTCDay();
    const cellCount = Math.ceil((offset+days)/7)*7;
    return Array.from({length:cellCount},(_,i)=>i<offset || i>=offset+days ? null : `${month}-${String(i-offset+1).padStart(2,"0")}`);
}
function mdCalendarBookings(bookings: Booking[], days: (string|null)[]) {
    const result: Record<string, Booking[]> = {};
    for (const day of days) if(day) result[day]=[];
    for (const booking of bookings) {
        // Pending/approved requests are shown with their actual status; cancelled bookings are excluded.
        if (!mdStage(booking)) continue;
        const start=mdCalendarDate(booking.reservationDate);
        if (!start) continue;
        const end=mdCalendarDate(booking.eventEndDate);
        const last=end && end>=start ? end : start;
        for (const day of days) if(day && day>=start && day<=last) result[day].push(booking);
    }
    for (const day of Object.keys(result)) result[day].sort((a,b)=>(a.time || "99:99").localeCompare(b.time || "99:99") || mdReference(a).localeCompare(mdReference(b)));
    return result;
}
// Calendar reservation indicators are intentionally limited to these two workflow stages.
function mdCalendarReservationType(booking: Booking): "tentative" | "reserved" | null {
    const stage = mdStage(booking);
    return stage === "Approved" ? "tentative" : stage === "Confirmed" ? "reserved" : null;
}
function mdCalendarReservationCounts(bookings: Booking[]) {
    let tentative = 0, reserved = 0;
    for (const booking of bookings) {
        const type = mdCalendarReservationType(booking);
        if (type === "tentative") tentative++;
        if (type === "reserved") reserved++;
    }
    return { tentative, reserved };
}
function mdCalendarStatusColor(booking: Booking) {
    const type = mdCalendarReservationType(booking);
    return type === "tentative" ? "text-[#A66A00]" : type === "reserved" ? "text-[#25865B]" : "text-[#86778F]";
}
function mdCalendarStatusLabel(booking: Booking) {
    const type = mdCalendarReservationType(booking);
    return type === "tentative" ? "Tentative" : type === "reserved" ? "Reserved" : mdBookingStatusLabel(booking);
}
function MDBookingCalendar({bookings, today}: {bookings: Booking[] | null | undefined; today: string}) {
    const [month,setMonth]=useState(()=>today.slice(0,7));
    const [selected,setSelected]=useState(today);
    const days=useMemo(()=>mdCalendarDays(month),[month]);
    const byDay=useMemo(()=>mdCalendarBookings(bookings || [],days),[bookings,days]);
    const selectedBookings=byDay[selected] || [];
    const changeMonth=(offset:number)=>{
        const next=mdCalendarMonthShift(month,offset);
        setMonth(next); setSelected(next===today.slice(0,7)?today:`${next}-01`);
    };
    const navClass="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#5A35A5] hover:bg-[#F5F0FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]";
    return <section className={`${managerPanelClass} flex min-h-[360px] flex-col p-4`}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-1 basis-[210px] items-center gap-2.5">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${managerDashboardTones.cyan}`} aria-hidden="true"><CalendarDays size={18}/></span>
                <div className="min-w-0 flex-1"><h2 className="text-[15px] font-bold leading-5 text-[#1A1220]">Booking Reservation Calendar</h2><p className="mt-0.5 text-[11px] leading-4 text-[#86778F]">View scheduled bookings by event date</p></div>
            </div>
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
                <div className="flex items-center gap-1.5"><button type="button" aria-label="Previous month" onClick={()=>changeMonth(-1)} className={navClass}><ChevronLeft size={15}/></button><span className="min-w-[100px] text-center text-xs font-semibold text-[#2B174C]" aria-live="polite">{mdCalendarLabel(`${month}-01`,{month:"long",year:"numeric"})}</span><button type="button" aria-label="Next month" onClick={()=>changeMonth(1)} className={navClass}><ChevronRight size={15}/></button></div>
            </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium" aria-label="Reservation status legend">
            <span className="inline-flex items-center gap-1.5 text-[#A66A00]"><span className="h-2.5 w-2.5 rounded-sm border border-[#E7C27A] bg-[#FFF3D9]" aria-hidden="true"/>Tentative</span>
            <span className="inline-flex items-center gap-1.5 text-[#25865B]"><span className="h-2.5 w-2.5 rounded-sm border border-[#A7D8B9] bg-[#EAF7F0]" aria-hidden="true"/>Reserved</span>
        </div>
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-7 gap-1" style={{gridTemplateRows: `auto repeat(${days.length / 7}, minmax(36px, 1fr))`}} aria-label="Monthly reservation calendar">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day=><div key={day} className="py-1 text-center text-[10px] font-semibold text-[#806A8C]">{day}</div>)}
            {days.map((day,i)=>{
                if(!day) return <div key={`blank-${i}`} className="min-h-[36px]" aria-hidden="true"/>;
                const {tentative,reserved}=mdCalendarReservationCounts(byDay[day] || []);
                const active=day===selected;
                // When both statuses occur on the same date, keep both visible.
                const dayTone = tentative && reserved
                    ? "border-[#D9D6AA] bg-gradient-to-r from-[#FFF7E9] to-[#EAF7F0] text-[#392648]"
                    : tentative ? "border-[#E7C27A] bg-[#FFF7E9] text-[#A66A00]"
                        : reserved ? "border-[#A7D8B9] bg-[#EAF7F0] text-[#25865B]"
                            : "border-transparent bg-white text-[#5F4E75] hover:border-[#E6DDF0] hover:bg-[#FAF8FF]";
                return <button key={day} type="button" onClick={()=>setSelected(day)} aria-pressed={active} aria-current={day===today?"date":undefined} aria-label={`${mdCalendarLabel(day,{month:"long",day:"numeric",year:"numeric"})}: ${bookings ? `${tentative} tentative, ${reserved} reserved` : "booking data unavailable"}`} className={`relative flex min-h-[36px] min-w-0 flex-col items-center justify-center rounded-lg border text-[11px] font-semibold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA] ${dayTone} ${active?"ring-1 ring-inset ring-[#7651BA]":""}`}>
                    <span>{Number(day.slice(-2))}</span>
                    {(tentative>0 || reserved>0) && <span className="mt-0.5 flex max-w-full items-center justify-center gap-0.5" aria-hidden="true">
                        {tentative>0 && <span className="min-w-0 truncate rounded-full bg-[#A66A00] px-1 py-px text-[9px] leading-none text-white" title={`${tentative} tentative`}>T {tentative}</span>}
                        {reserved>0 && <span className="min-w-0 truncate rounded-full bg-[#25865B] px-1 py-px text-[9px] leading-none text-white" title={`${reserved} reserved`}>R {reserved}</span>}
                    </span>}
                </button>;
            })}
        </div>
        <div className="mt-3 shrink-0 border-t border-[#E9E1EE] pt-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1"><h3 className="text-xs font-bold text-[#2B174C]">{mdCalendarLabel(selected,{month:"short",day:"numeric",year:"numeric"})}</h3><span className="text-[11px] text-[#86778F]" aria-live="polite">{bookings ? `${selectedBookings.length} booking${selectedBookings.length===1?"":"s"}` : "Unavailable"}</span></div>
            {!bookings ? <p className="py-3 text-[11px] text-[#86778F]">Booking data unavailable. Refresh to try again.</p> : selectedBookings.length===0 ? <p className="py-3 text-[11px] text-[#86778F]">No bookings scheduled for this date.</p> : <ul className="mt-1 max-h-[160px] divide-y divide-[#F1ECF4] overflow-y-auto" aria-label="Bookings for selected date">{selectedBookings.map(booking=><li key={booking.id} className="flex items-start justify-between gap-2 py-1.5 text-[11px]"><div className="min-w-0 flex-1"><p className="break-words font-semibold text-[#392648]">{mdReference(booking)}</p><p className="mt-0.5 break-words text-[#86778F]">{[booking.name,booking.packageName || booking.eventName,booking.time].filter(Boolean).join(" · ")}</p></div><span className={`shrink-0 text-right font-semibold ${mdCalendarStatusColor(booking)}`}>{mdCalendarStatusLabel(booking)}</span></li>)}</ul>}
        </div>
    </section>;
}

export default function ManagerDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [data, setData] = useState<{ scope: string; bookings: Booking[] | null; products: Product[] | null; equipment: unknown[] | null; errors: string[] } | null>(null);
    const dashboardStoreId = getUserValue(user, "store_id") || getUserValue(user, "storeId") || getSavedItem("store_id") || getSavedItem("stocknbook_store_id");
    const dashboardBranchId = getAssignedBranchId(user);
    const scope = `${dashboardStoreId}:${dashboardBranchId}`;
    const request = useRef<AbortController | null>(null);
    const loadManagerDashboard = useCallback(async ({silent = false}: {silent?: boolean} = {}) => {
        if (silent && request.current) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const token = getSavedItem("token");
        if (!silent) setIsRefreshing(true);
        try {
            if (!token || !dashboardBranchId) {
                setData({scope, bookings:null, products:null, equipment:null, errors:["No valid manager session or branch assignment was found."]});
                return;
            }
            const post = async (url: string, body: Record<string, unknown>) => {
                const response = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`}, body:JSON.stringify(body), cache:"no-store", signal:controller.signal});
                const payload = await response.json();
                if (!response.ok) throw new Error("Request failed");
                return toRecord(payload);
            };
            const branch = Number(dashboardBranchId);
            const [b,p,r] = await Promise.allSettled([
                post("/api/bookings", {action:"get_booking_page_bookings", role:"manager", store_id:dashboardStoreId ? Number(dashboardStoreId):undefined, branch_id:branch}),
                post("/api/products", {action:"get_products", branch_id:branch}),
                post("/api/rental-inventory", {action:"get_manager_inventory", branch_id:branch}),
            ]);
            if (controller.signal.aborted) return;
            const bookings = b.status === "fulfilled" && Array.isArray(b.value.bookings) ? b.value.bookings.map(normalizeBooking).filter(item => belongsToAssignedBranch(item,dashboardBranchId)) : null;
            const products = p.status === "fulfilled" && Array.isArray(p.value.products) ? p.value.products.map(normalizeProduct).filter(item => belongsToAssignedBranch(item,dashboardBranchId)) : null;
            const equipment = r.status === "fulfilled" && r.value.success === true && String(r.value.branchId) === dashboardBranchId && Array.isArray(r.value.equipment) ? r.value.equipment : null;
            const errors = [!bookings && "Booking data unavailable.", !products && "Consumable stock data unavailable.", !equipment && "Rental availability data unavailable."].filter((x):x is string => Boolean(x));
            if (!controller.signal.aborted) setData({scope, bookings, products, equipment, errors});
        } finally {
            if (request.current === controller) { request.current = null; setIsRefreshing(false); }
        }
    }, [scope, dashboardBranchId, dashboardStoreId]);
    useEffect(() => { const timer=window.setInterval(()=>setCurrentDateTime(new Date()),30_000); return ()=>window.clearInterval(timer); },[]);
    useEffect(() => {
        void loadManagerDashboard();
        const timer = window.setInterval(()=>{if(document.visibilityState === "visible" && navigator.onLine) void loadManagerDashboard({silent:true});},60_000);
        return () => { window.clearInterval(timer); request.current?.abort(); request.current = null; };
    },[loadManagerDashboard]);
    const current = data?.scope === scope ? data : null;
    const today = mdLocalDay(currentDateTime);
    const bookings = current?.bookings;
    const branchName = getAssignedBranchName(user);
    const pending = (bookings || []).filter(b => mdStage(b) === "Pending");
    const awaiting = (bookings || []).filter(b => mdStage(b) === "Approved");
    const settlements = (bookings || []).filter(b => mdStatus(b) === "pending settlement");
    const counts = Object.fromEntries(MD_BOOKING_STAGES.map(s=>[s,0])) as Record<MDStage,number>;
    (bookings || []).forEach(b => {const stage=mdStage(b); if(stage && mdBookingDay(b.date).startsWith(today.slice(0,7))) counts[stage]++;});
    const stockAlerts = useMemo<MDAlert[]>(()=>[
        ...getDashboardStockAlertItems(current?.products || []).map(item=>({key:`consumable-${item.id}`,product:item.variantName ? `${item.productName} (${item.variantName})`:item.productName,status:item.status})),
        ...mdRentalAlerts(current?.equipment || []),
    ],[current?.products,current?.equipment]);
    const expirationAlerts = useMemo<ExpirationAlertItem[]>(() => getExpirationAlertItems(current?.products || []), [current?.products]);
    const stockUnavailable = !current?.products || !current?.equipment;
    const actions = [...pending,...awaiting].map(b=>({key:`action-${String(b.id)}`,left:mdReference(b),right:mdBookingStatusLabel(b),statusColor:mdBookingStatusColor(b)}));
    const settlementRows = settlements.slice(0,5).map(b=>({key:`settlement-${String(b.id)}`,left:mdReference(b),right:mdBookingStatusLabel(b),statusColor:mdBookingStatusColor(b)}));
    const combinedActionRows = [...actions, ...settlementRows].slice(0, 8);
    const inventoryPieSlices: MDPieSlice[] = [
        { key: "expiring", label: "Soon to Expire", value: expirationAlerts.filter(item => item.status === "Expiring").length, color: "#E19A21", bg: "bg-[#FFF8EA]" },
        { key: "expired", label: "Expired", value: expirationAlerts.filter(item => item.status === "Expired").length, color: "#D64545", bg: "bg-[#FFF1F1]" },
        { key: "low-stock", label: "Low Stock", value: getDashboardStockAlertItems(current?.products || []).filter(item => item.status === "Low Stock").length, color: "#8A63D2", bg: "bg-[#F6F0FF]" },
        { key: "out-stock", label: "Out of Stock", value: getDashboardStockAlertItems(current?.products || []).filter(item => item.status === "Out of Stock").length, color: "#237C9B", bg: "bg-[#ECF8FB]" },
        { key: "under-repair", label: "Under Repair", value: mdUnderRepairCount(current?.equipment || []), color: "#1FA87A", bg: "bg-[#ECFAF4]" },
    ];
    const navigate = (href:string)=>router.push(href);
    return <>
        <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur"><div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"><div className="min-w-0"><h1 className="text-[25px] font-bold text-[#1A1220]">Manager Dashboard</h1><p className="mt-0.5 text-xs text-[#766983]">Booking and inventory overview for {branchName}.</p></div><div className="flex flex-wrap items-center gap-2.5"><time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{formatCurrentDashboardDateTime(currentDateTime)}</time><button type="button" onClick={()=>void loadManagerDashboard()} disabled={isRefreshing} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"><RefreshCw size={16} className={isRefreshing?"animate-spin":""}/>{isRefreshing?"Refreshing...":"Refresh"}</button></div></div></header>
        <section className="px-5 py-5 font-sans" aria-busy={!current || isRefreshing}>
            {!current ? <ManagerDashboardSkeleton/> : <div className="space-y-4">
                {current.errors.length>0 && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{current.errors.join(" ")}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <ManagerMetricCard title="Pending Bookings" value={bookings?pending.length:null} subtitle="Needs price or approval" icon={<CalendarClock size={23}/>} tone="purple" onClick={()=>navigate("/bookings")}/>
                    <ManagerMetricCard title="Awaiting Confirmation" value={bookings?awaiting.length:null} subtitle="Approved · awaiting payment review" icon={<MdCheckCircle size={23}/>} tone="blue" onClick={()=>navigate("/bookings")}/>
                    <ManagerMetricCard title="Stock Alerts" value={stockUnavailable?null:stockAlerts.length} subtitle="Consumable and rental alerts" icon={<AlertTriangle size={23}/>} tone="amber" onClick={()=>navigate("/inventory")}/>
                    <ManagerMetricCard title="Pending Settlements" value={bookings?settlements.length:null} subtitle="Awaiting deposit settlement" icon={<MdWallet size={23}/>} tone="green" onClick={()=>navigate("/bookings")}/>
                </div>
                {/* Desktop: two compact panels in the left column, one tall calendar on the right. */}
                <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-3">
                        <MDInventoryAlertsPie slices={inventoryPieSlices} unavailable={stockUnavailable} onViewAll={()=>navigate("/inventory")}/>
                        <MDCompactPanel title="Booking Action Center" description="Bookings awaiting approval, payment review, or deposit settlement" tone="teal" icon={<CalendarClock size={18}/>} headers={["Booking","Status"]} rows={combinedActionRows} unavailable={!bookings} empty="No booking actions or settlements." onViewAll={()=>navigate("/bookings")}/>
                    </div>
                    <MDBookingCalendar key={scope} bookings={bookings} today={today}/>
                </div>
                {/* Full-width booking chart below both columns. */}
                <MDBookingOverview counts={counts} unavailable={!bookings}/>
            </div>}
        </section>
    </>;
}

/* Dashboard overview panels. Manager Inventory is unchanged. */
function mdLocalDay(date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (name: string) => parts.find(p => p.type === name)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}
function MdWrenchIcon() { return <MdWrench size={24}/>; }
function MDWalletIcon() { return <MdWallet size={24}/>; }
function MdCloseIcon() { return <MdX size={18}/>; }
function MdCheckIcon() { return <MdCheckCircle size={20}/>; }
function MDStockBadge({ status }: { status: string }) {
    const colors = status === "Expired" || status === "Out of Stock" ? "bg-[#FFF0F0] text-[#D52B2B]" :
        status.includes("Low") ? "bg-[#FFF3D8] text-[#B66A00]" : "bg-[#F1EBFF] text-[#6D35D4]";
    return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase ${colors}`}>{status}</span>;
}
function MDPanel({ title, subtitle, icon, children, onExport, search, setSearch, searchPlaceholder, headerActions, tall = false, inlineHeader = false }: {
    title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode;
    onExport: () => void; search?: string; setSearch?: (value: string) => void; searchPlaceholder?: string;
    headerActions?: React.ReactNode; tall?: boolean; inlineHeader?: boolean;
}) {
    return <section className={`flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm ${tall ? "h-[380px]" : "h-[320px]"}`}>
        <div className={`flex flex-wrap items-start justify-between gap-2 border-b border-[#E9E1EE] px-4 py-3.5 ${inlineHeader ? "xl:flex-nowrap xl:items-center" : ""}`}>
            <div className={`flex min-w-0 items-center gap-2.5 ${inlineHeader ? "xl:flex-1" : ""}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">{icon}</span><div className="min-w-0"><h2 className={`text-[15px] font-bold text-[#21132E] ${inlineHeader ? "xl:whitespace-nowrap" : ""}`}>{title}</h2><p className={`mt-0.5 text-[11px] text-[#86778F] ${inlineHeader ? "xl:truncate" : ""}`}>{subtitle}</p></div></div>
            <div className={`flex flex-wrap items-center gap-2 ${inlineHeader ? "xl:shrink-0 xl:flex-nowrap" : ""}`}>{setSearch && <div className="relative"><MdSearch size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/><input aria-label={`Search ${title}`} value={search || ""} onChange={e => setSearch(e.target.value)} className={`h-[44px] rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-4 text-sm text-[#1A1220] shadow-sm outline-none placeholder:text-[#9B8AAA] focus:border-[#2B174C] ${inlineHeader ? "w-48" : "w-56 max-w-full"}`} placeholder={searchPlaceholder}/></div>}
                {headerActions}
                <button type="button" title={`Export ${title} as PDF`} aria-label={`Export ${title} as PDF`} onClick={onExport} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#D9CDF0] bg-white text-[#5A35A5] hover:bg-[#F7F1FF]"><MdDownload size={16}/></button>
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
    return <section className="flex h-[360px] min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E7DFEC] bg-white shadow-sm">
        <div className="flex items-start justify-between gap-2 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">{icon}</span><div className="min-w-0"><h2 className="text-[15px] font-bold text-[#21132E]">{title}</h2><p className="mt-0.5 text-[11px] text-[#86778F]">{subtitle}</p></div></div>
            <button type="button" title={`Export ${title} as PDF`} aria-label={`Export ${title} as PDF`} onClick={exportClick} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#D9CDF0] bg-white text-[#5A35A5] hover:bg-[#F7F1FF]"><MdDownload size={16}/></button>
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

function ManagerMetricCard({ title, value, subtitle, icon, tone, onClick }: {
    title: string;
    value: number | null;
    subtitle: string;
    icon: React.ReactNode;
    tone: ManagerDashboardTone;
    onClick?: () => void;
}) {
    return <button type="button" onClick={onClick} className={managerKpiCardClass}>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${managerDashboardTones[tone]}`} aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{title}</span>
            <span className="mt-1 block break-words text-[24px] font-bold leading-none tabular-nums text-[#25153D]">{value === null ? "—" : value.toLocaleString("en-PH")}</span>
            <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{subtitle}</span>
        </span>
    </button>;
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
        violet: { icon: "text-[#5F35D8]", background: "bg-[#F1ECFF]" },
        green: { icon: "text-[#159455]", background: "bg-[#E6F7EE]" },
        blue: { icon: "text-[#1E6FE8]", background: "bg-[#E9F2FF]" },
        orange: { icon: "text-[#E68A00]", background: "bg-[#FFF3DE]" },
        red: { icon: "text-[#E23B4A]", background: "bg-[#FFE8E8]" },
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

        </section>
    );
}
function ExpirationAlertsPanel({
                                   items,
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