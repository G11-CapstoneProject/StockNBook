"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    AlertTriangle,
    BarChart3,
    Box,
    CalendarClock,
    CalendarDays,
    Info,
    PackageX,
    RefreshCw,
    Sparkles,
    TriangleAlert,
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

export default function ManagerDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();

    const [bookings, setBookings] = useState<Booking[]>([]);
    const [bookingsError, setBookingsError] = useState("");
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [, setRestockMovements] = useState<RestockMovementRecord[]>([]);
    const [, setAdjustmentMovements] = useState<AdjustmentMovementRecord[]>([]);
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showStockAlertsModal, setShowStockAlertsModal] = useState(false);
    const [stockAlertFilter, setStockAlertFilter] = useState<"all" | "low" | "out">("all");

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentDateTime(new Date());
        }, 30_000);

        return () => window.clearInterval(timer);
    }, []);

    const loadManagerDashboard = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const token = getSavedItem("token");
        const storeId =
            getUserValue(user, "store_id") ||
            getUserValue(user, "storeId") ||
            getSavedItem("store_id") ||
            getSavedItem("stocknbook_store_id");
        const branchId = getAssignedBranchId(user);
        const assignedBranchName = getAssignedBranchName(user);

        if (!token || !branchId) {
            setBookings([]);
            setOrders([]);
            setProducts([]);
            setRestockMovements([]);
            setAdjustmentMovements([]);
            setBookingsError("No assigned branch was found for this account.");
            return;
        }

        if (!silent) setIsRefreshing(true);
        setBookingsError("");

        try {
            const now = new Date();
            const movementStart = new Date(now);
            movementStart.setDate(movementStart.getDate() - 56);

            const reportQuery = new URLSearchParams({
                branch: assignedBranchName,
                month: movementStart.toISOString().slice(0, 7),
                startDate: movementStart.toISOString().slice(0, 10),
                endDate: now.toISOString().slice(0, 10),
                role: "manager",
                assignedBranch: assignedBranchName,
                branch_id: String(branchId),
            });

            const [bookingsResult, productsResult, ordersResult, reportsResult] =
                await Promise.allSettled([
                    fetch("/api/bookings", {
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
                    }),
                    fetch("/api/products", {
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
                    fetch("/api/pos", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_orders",
                            branch_id: Number(branchId),
                            include_order_items: true,
                            date_from: movementStart.toISOString().slice(0, 10),
                            date_to: now.toISOString().slice(0, 10),
                        }),
                        cache: "no-store",
                    }),
                    fetch(`/api/reports?${reportQuery.toString()}`, {
                        headers: { Authorization: `Bearer ${token}` },
                        cache: "no-store",
                    }),
                ]);

            if (bookingsResult.status === "fulfilled") {
                try {
                    const response = bookingsResult.value;
                    const payload = await response.json().catch(() => ({}));
                    if (response.ok && Array.isArray(payload.bookings)) {
                        const normalized = (payload.bookings as unknown[]).map(normalizeBooking);
                        setBookings(
                            normalized.filter((booking) =>
                                belongsToAssignedBranch(booking, branchId),
                            ),
                        );
                    } else {
                        setBookings([]);
                        setBookingsError(
                            String(payload.error || payload.message || "Unable to load booking data."),
                        );
                    }
                } catch (error) {
                    console.warn("Manager dashboard bookings parsing failed:", error);
                    setBookings([]);
                    setBookingsError("Unable to load booking data.");
                }
            } else {
                console.warn("Manager dashboard bookings fetch failed:", bookingsResult.reason);
                setBookingsError("Unable to load booking data.");
            }

            if (productsResult.status === "fulfilled") {
                try {
                    const response = productsResult.value;
                    const payload = await response.json().catch(() => ({}));
                    if (response.ok && Array.isArray(payload.products)) {
                        const normalized = (payload.products as unknown[]).map(normalizeProduct);
                        setProducts(
                            normalized.filter((product) =>
                                belongsToAssignedBranch(product, branchId),
                            ),
                        );
                    }
                } catch (error) {
                    console.warn("Manager dashboard products parsing failed:", error);
                }
            } else {
                console.warn("Manager dashboard products fetch failed:", productsResult.reason);
            }

            if (ordersResult.status === "fulfilled") {
                try {
                    const response = ordersResult.value;
                    const payload = await response.json().catch(() => ({}));
                    if (response.ok && Array.isArray(payload.orders)) {
                        const normalized = (payload.orders as unknown[]).map(normalizeOrder);
                        setOrders(
                            normalized.filter((order) =>
                                belongsToAssignedBranch(order, branchId),
                            ),
                        );
                    }
                } catch (error) {
                    console.warn("Manager dashboard orders parsing failed:", error);
                }
            } else {
                console.warn("Manager dashboard orders fetch failed:", ordersResult.reason);
            }

            if (reportsResult.status === "fulfilled") {
                try {
                    const response = reportsResult.value;
                    const payload = await response.json().catch(() => ({}));
                    const reportData = payload?.data && typeof payload.data === "object" ? payload.data : {};

                    if (response.ok && payload?.success) {
                        const rawRestocks = firstDefined(toRecord(reportData), [
                            "restockHistory",
                            "restock_history",
                            "restocks",
                            "inventoryRestocks",
                            "inventory_restocks",
                        ]);
                        const restocks = Array.isArray(rawRestocks)
                            ? rawRestocks.map(normalizeRestockMovement)
                            : [];
                        setRestockMovements(
                            restocks.filter((item) =>
                                !item.branchId || String(item.branchId) === String(branchId),
                            ),
                        );

                        setAdjustmentMovements(extractAdjustmentMovements(reportData, branchId));
                    } else {
                        setRestockMovements([]);
                        setAdjustmentMovements([]);
                    }
                } catch (error) {
                    console.warn("Manager dashboard reports parsing failed:", error);
                    setRestockMovements([]);
                    setAdjustmentMovements([]);
                }
            } else {
                console.warn("Manager dashboard reports fetch failed:", reportsResult.reason);
                setRestockMovements([]);
                setAdjustmentMovements([]);
            }
        } finally {
            if (!silent) setIsRefreshing(false);
        }
    }, [user]);

    useEffect(() => {
        void loadManagerDashboard();
    }, [loadManagerDashboard]);

    useEffect(() => {
        /*
         * Near-real-time Manager dashboard refresh.
         * Re-fetch the same authoritative branch-scoped APIs every 60 seconds
         * without showing the manual Refresh spinner.
         */
        const autoRefreshTimer = window.setInterval(() => {
            void loadManagerDashboard({ silent: true });
        }, 60_000);

        return () => window.clearInterval(autoRefreshTimer);
    }, [loadManagerDashboard]);

    const allInventoryAlerts = useMemo(
        () => getDashboardStockAlertItems(products),
        [products],
    );

    const allExpirationAlertItems = useMemo(
        () => getExpirationAlertItems(products),
        [products],
    );

    const lowStockAlertCount = allInventoryAlerts.filter(
        (item) => item.status === "Low Stock",
    ).length;

    const outOfStockAlertCount = allInventoryAlerts.filter(
        (item) => item.status === "Out of Stock",
    ).length;

    const expiringSoonAlertCount = allExpirationAlertItems.filter(
        (item) => item.status === "Expiring",
    ).length;

    const pendingBookingCount = bookings.filter((booking) => {
        const status = normalizeDashboardBookingStatus(booking.status);
        return status === "Pending" || status === "Awaiting Down Payment";
    }).length;

    const bookingOverview = useMemo(
        () => buildBookingOverview(bookings, currentDateTime),
        [bookings, currentDateTime],
    );

    const inventoryHealth = useMemo(
        () => buildInventoryHealth(products, allInventoryAlerts, allExpirationAlertItems),
        [products, allInventoryAlerts, allExpirationAlertItems],
    );

    const attentionItems = useMemo(
        () => buildManagerAttentionItems(allInventoryAlerts, allExpirationAlertItems),
        [allInventoryAlerts, allExpirationAlertItems],
    );

    const bookingTrend = useMemo(
        () => buildBookingStatusTrend(bookings, currentDateTime),
        [bookings, currentDateTime],
    );

    const inventoryForecast = useMemo(
        () => buildManagerInventoryForecast(products, orders, currentDateTime),
        [products, orders, currentDateTime],
    );

    const currentMonthLabel = currentDateTime.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    const assignedBranchName = getAssignedBranchName(user);

    const visibleStockAlerts = allInventoryAlerts.filter((item) => {
        if (stockAlertFilter === "low") return item.status === "Low Stock";
        if (stockAlertFilter === "out") return item.status === "Out of Stock";
        return true;
    });

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">
                            Manager Dashboard
                        </h1>
                        <p className="mt-1 truncate text-[12px] text-[#7A6A84]">
                            Operational overview for {assignedBranchName} for {currentMonthLabel}.
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
                    {bookingsError && (
                        <div className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs font-medium text-[#C32F2F]">
                            {bookingsError}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <ManagerMetricCard
                            title="Pending Bookings"
                            value={pendingBookingCount}
                            subtitle="Bookings waiting for confirmation"
                            icon={<CalendarClock size={24} />}
                            tone="violet"
                            onClick={() => router.push("/bookings?status=pending")}
                        />
                        <ManagerMetricCard
                            title="Low Stock"
                            value={lowStockAlertCount}
                            subtitle="Items below reorder level"
                            icon={<AlertTriangle size={24} />}
                            tone="orange"
                            onClick={() => {
                                setStockAlertFilter("low");
                                setShowStockAlertsModal(true);
                            }}
                        />
                        <ManagerMetricCard
                            title="Out of Stock"
                            value={outOfStockAlertCount}
                            subtitle="Items with no stock remaining"
                            icon={<PackageX size={24} />}
                            tone="red"
                            onClick={() => {
                                setStockAlertFilter("out");
                                setShowStockAlertsModal(true);
                            }}
                        />
                        <ManagerMetricCard
                            title="Expiring Soon"
                            value={expiringSoonAlertCount}
                            subtitle={`Items expiring within ${EXPIRING_SOON_DAYS} days`}
                            icon={<CalendarDays size={24} />}
                            tone="blue"
                            onClick={() => router.push("/inventory?filter=expiring-soon")}
                        />
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-12">
                        <div className="xl:col-span-4">
                            <ManagerDonutPanel
                                title="Booking Overview"
                                subtitle="Status of bookings this month"
                                icon={<CalendarDays size={18} />}
                                centerValue={bookingOverview.total}
                                centerLabel="Total Bookings"
                                periodLabel="This Month"
                                segments={bookingOverview.segments}
                            />
                        </div>

                        <div className="xl:col-span-4">
                            <ManagerDonutPanel
                                title="Inventory Health"
                                subtitle="Current stock status across all products"
                                icon={<Box size={18} />}
                                centerValue={inventoryHealth.total}
                                centerLabel="Total Items"
                                periodLabel="This Month"
                                segments={inventoryHealth.segments}
                            />
                        </div>

                        <div className="xl:col-span-4">
                            <ItemsRequiringAttentionPanel
                                items={attentionItems.slice(0, 5)}
                                total={attentionItems.length}
                                onViewAll={() => router.push("/inventory")}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                        <ManagerLineChartPanel
                            title="Booking Status Trend"
                            subtitle="Weekly booking status over the last 8 weeks"
                            icon={<BarChart3 size={18} />}
                            periodLabel="Last 8 Weeks"
                            data={bookingTrend}
                            series={[
                                { key: "pending", label: "Pending", color: "#F5B51B" },
                                { key: "confirmed", label: "Confirmed", color: "#159455" },
                                { key: "completed", label: "Completed", color: "#2F7BEA" },
                                { key: "cancelled", label: "Cancelled", color: "#EF4444" },
                            ]}
                        />

                        <ManagerInventoryForecastPanel
                            rows={inventoryForecast}
                            onViewInventory={() => router.push("/inventory")}
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

/* ----------------------------------------------------------------------- */
/* Manager role dashboard helpers                                           */
/* ----------------------------------------------------------------------- */

type RestockMovementRecord = {
    date: string;
    quantityAdded: number;
    branchId?: string | number;
};

type AdjustmentMovementRecord = {
    date: string;
    quantityChanged: number;
    branchId?: string | number;
};

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

function normalizeRestockMovement(value: unknown): RestockMovementRecord {
    const raw = toRecord(value);
    return {
        date: readText(raw, ["date", "createdAt", "created_at", "restockDate", "restock_date"]),
        quantityAdded: Math.max(
            0,
            readNumber(raw, ["quantityAdded", "quantity_added", "quantity", "qty"], 0),
        ),
        branchId:
            firstDefined(raw, ["branchId", "branch_id"]) as string | number | undefined,
    };
}

function normalizeAdjustmentMovement(value: unknown): AdjustmentMovementRecord {
    const raw = toRecord(value);
    const rawQuantity = readNullableNumber(raw, [
        "quantityChanged",
        "quantity_changed",
        "quantityChange",
        "quantity_change",
        "adjustmentQuantity",
        "adjustment_quantity",
        "difference",
        "delta",
    ]);

    return {
        date: readText(raw, ["date", "createdAt", "created_at", "updatedAt", "updated_at"]),
        quantityChanged: Math.abs(Number(rawQuantity || 0)),
        branchId:
            firstDefined(raw, ["branchId", "branch_id"]) as string | number | undefined,
    };
}

function extractAdjustmentMovements(reportData: unknown, branchId: string) {
    const raw = toRecord(reportData);
    const direct = firstDefined(raw, [
        "inventoryAdjustments",
        "inventory_adjustments",
        "stockAdjustments",
        "stock_adjustments",
        "adjustmentHistory",
        "adjustment_history",
        "inventoryAdjustmentHistory",
    ]);

    if (Array.isArray(direct)) {
        return direct
            .map(normalizeAdjustmentMovement)
            .filter(
                (item) =>
                    item.quantityChanged > 0 &&
                    (!item.branchId || String(item.branchId) === String(branchId)),
            );
    }

    const employeeActions = firstDefined(raw, ["employeeActions", "employee_actions"]);
    if (!Array.isArray(employeeActions)) return [];

    return employeeActions
        .filter((value) => {
            const action = toRecord(value);
            const moduleName = readText(action, ["module"]);
            const text = [
                readText(action, ["action"]),
                readText(action, ["details"]),
                readText(action, ["description"]),
            ]
                .join(" ")
                .toLowerCase();
            const actionBranchId = firstDefined(action, ["branchId", "branch_id"]);

            return (
                moduleName.toLowerCase().includes("inventory") &&
                /(adjust|correction|damag|missing|return|expire)/.test(text) &&
                (!actionBranchId || String(actionBranchId) === String(branchId))
            );
        })
        .map(normalizeAdjustmentMovement)
        .filter((item) => item.quantityChanged > 0);
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

function getLastEightManagerWeeks(reference: Date) {
    const currentWeek = startOfManagerWeek(reference);
    return Array.from({ length: 8 }, (_, index) => {
        const start = new Date(currentWeek);
        start.setDate(start.getDate() - (7 - index) * 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return {
            start,
            end,
            label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        };
    });
}

function buildBookingStatusTrend(bookings: Booking[], reference: Date): ManagerTrendPoint[] {
    const weeks = getLastEightManagerWeeks(reference);

    return weeks.map((week) => {
        const point: ManagerTrendPoint = {
            label: week.label,
            pending: 0,
            confirmed: 0,
            completed: 0,
            cancelled: 0,
        };

        bookings.forEach((booking) => {
            const date = parseManagerDate(booking.createdAt || booking.date);
            if (!date || date < week.start || date >= week.end) return;

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
                                   periodLabel,
                                   data,
                                   series,
                               }: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    periodLabel: string;
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
                <span className="shrink-0 rounded-lg border border-[#E6DDF0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#5F4E75] shadow-sm">
                    {periodLabel}
                </span>
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
                            title={total === 0 ? `${item.label}: no recorded movement in this period` : `${item.label}: ${total.toLocaleString("en-PH")} units in this period`}
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

            {data.map((point, index) => (
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
            ))}
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