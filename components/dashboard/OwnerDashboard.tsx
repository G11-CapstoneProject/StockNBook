"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    BarChart3,
    Building2,
    Lightbulb,
    RefreshCw,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Trophy,
    Wallet,
    PieChart,
    FileText,
    Package,
    Gift,
    Armchair,
    Users,
    Download,
} from "lucide-react";
import type { ExportContext, ExportTable } from "./_shared";

/* ----------------------------------------------------------------------- */
/* Types                                                                    */
/* ----------------------------------------------------------------------- */

type Branch = {
    id: number;
    branchName: string;
};

type Booking = {
    id: number;
    packageId?: number | null;
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
    costOfSales?: number | null;
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

type InventoryVariant = {
    id?: number;
    name?: string;
    costPrice?: number;
    salesPrice?: number;
    sales_price?: number;
    cost_price?: number;
    variantValues?: Record<string, string>;
    variant_values?: Record<string, string>;
};

type InventoryProduct = {
    id: number;
    category?: string;
    branchId?: number | null;
    branch_id?: number | null;
    name: string;
    costPrice?: number;
    salesPrice?: number;
    sales_price?: number;
    cost_price?: number;
    variants?: InventoryVariant[];
};

type PackageInclusion = {
    name: string;
    productId?: number | null;
    product_id?: number | null;
    variantId?: number | null;
    variant_id?: number | null;
    quantity: number;
    costPrice?: number;
    cost_price?: number;
};

type PackageRecord = {
    id?: string | number;
    name: string;
    branchId?: number | null;
    branch_id?: number | null;
    inclusions: PackageInclusion[];
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

type OwnerPosDailyMetric = {
    date: string;
    sales: number;
    cost: number;
};

type OwnerPosBranchRow = {
    key: string;
    name: string;
    amount: number;
};

type OwnerPosTopProduct = {
    key: string;
    name: string;
    sales: number;
    units: number;
};

type OwnerPosSummary = {
    daily: OwnerPosDailyMetric[];
    branchPerformance: Record<PeriodOption, OwnerPosBranchRow[]>;
    topProducts: Record<PeriodOption, OwnerPosTopProduct[]>;
};

const EMPTY_OWNER_POS_SUMMARY: OwnerPosSummary = {
    daily: [],
    branchPerformance: { month: [], quarter: [], year: [] },
    topProducts: { month: [], quarter: [], year: [] },
};

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

function formatDashboardIsoDate(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
        packageId: readNullableNumber(raw, ["packageId", "package_id"]),
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
        costOfSales: readNullableNumber(raw, [
            "costOfSales",
            "cost_of_sales",
            "bookingCost",
            "booking_cost",
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
    // agreed_price is the transaction-level selling price and can include
    // package discounts plus additional/custom items. Fall back to package
    // price for older records where agreed_price is missing or zero.
    const candidates = [
        booking.agreed_price,
        booking.agreedPrice,
        booking.package_price,
        booking.packagePrice,
        booking.total,
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return value;
    }

    return 0;
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

function normalizeInventoryProduct(value: unknown): InventoryProduct {
    const raw = toRecord(value);
    const rawVariants = firstDefined(raw, ["variants", "productVariants", "product_variants"]);

    const variants: InventoryVariant[] = Array.isArray(rawVariants)
        ? rawVariants.map((value) => {
            const variant = toRecord(value);
            const variantValues = firstDefined(variant, ["variantValues", "variant_values", "values"]);
            let parsedValues: Record<string, string> = {};
            if (variantValues && typeof variantValues === "object" && !Array.isArray(variantValues)) {
                parsedValues = variantValues as Record<string, string>;
            } else if (typeof variantValues === "string") {
                try {
                    const parsed = JSON.parse(variantValues);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        parsedValues = parsed as Record<string, string>;
                    }
                } catch {
                    parsedValues = {};
                }
            }

            return {
                id: readNumber(variant, ["id"]),
                name: readText(variant, ["name", "variantName", "variant_name"]),
                costPrice: readNullableNumber(variant, ["costPrice", "cost_price", "unitCost", "unit_cost"]) ?? undefined,
                cost_price: readNullableNumber(variant, ["cost_price", "costPrice", "unit_cost", "unitCost"]) ?? undefined,
                salesPrice: readNullableNumber(variant, ["salesPrice", "sales_price", "price"]) ?? undefined,
                sales_price: readNullableNumber(variant, ["sales_price", "salesPrice", "price"]) ?? undefined,
                variantValues: parsedValues,
                variant_values: parsedValues,
            };
        })
        : [];

    return {
        id: readNumber(raw, ["id", "product_id"]),
        branchId: readNullableNumber(raw, ["branchId", "branch_id"]),
        branch_id: readNullableNumber(raw, ["branch_id", "branchId"]),
        name: readText(raw, ["name", "productName", "product_name"]),
        category: readText(raw, ["category", "categoryName", "category_name"]),
        costPrice: readNullableNumber(raw, ["costPrice", "cost_price", "unitCost", "unit_cost"]) ?? undefined,
        cost_price: readNullableNumber(raw, ["cost_price", "costPrice", "unit_cost", "unitCost"]) ?? undefined,
        salesPrice: readNullableNumber(raw, ["salesPrice", "sales_price", "price"]) ?? undefined,
        sales_price: readNullableNumber(raw, ["sales_price", "salesPrice", "price"]) ?? undefined,
        variants,
    };
}

function normalizePackageRecord(value: unknown): PackageRecord {
    const raw = toRecord(value);
    let rawInclusions: unknown[] = [];
    const source = firstDefined(raw, ["inclusions", "items", "packageItems", "package_items"]);

    if (Array.isArray(source)) {
        rawInclusions = source;
    } else if (typeof source === "string" && source.trim().startsWith("[")) {
        try { rawInclusions = JSON.parse(source) as unknown[]; } catch { rawInclusions = []; }
    }

    const inclusions = rawInclusions.map((item) => {
        if (typeof item === "string") return { name: item.trim(), quantity: 1 };
        const inc = toRecord(item);
        const productId = readNullableNumber(inc, ["productId", "product_id"]);
        const variantId = readNullableNumber(inc, ["variantId", "variant_id"]);
        return {
            name: readText(inc, ["name", "itemName", "item_name", "productName", "product_name", "item", "title"]),
            productId,
            product_id: productId,
            variantId,
            variant_id: variantId,
            quantity: Math.max(1, readNumber(inc, ["quantity", "qty", "itemQuantity", "item_quantity"], 1)),
            costPrice: readNullableNumber(inc, ["costPrice", "cost_price", "unitCost", "unit_cost"]) ?? undefined,
            cost_price: readNullableNumber(inc, ["cost_price", "costPrice", "unit_cost", "unitCost"]) ?? undefined,
        };
    }).filter((item) => item.name);

    return {
        id: firstDefined(raw, ["id", "packageId", "package_id"]) as string | number | undefined,
        name: readText(raw, ["name", "packageName", "package_name"]),
        branchId: readNullableNumber(raw, ["branchId", "branch_id"]),
        branch_id: readNullableNumber(raw, ["branch_id", "branchId"]),
        inclusions,
    };
}

function normalizeOwnerPosSummary(value: unknown): OwnerPosSummary {
    const raw = toRecord(value);

    const normalizeDaily = (source: unknown): OwnerPosDailyMetric[] =>
        Array.isArray(source)
            ? source.map((item) => {
                const row = toRecord(item);
                return {
                    date: readText(row, ["date"]),
                    sales: readNumber(row, ["sales"]),
                    cost: readNumber(row, ["cost"]),
                };
            }).filter((row) => row.date)
            : [];

    const normalizeBranchRows = (source: unknown): OwnerPosBranchRow[] =>
        Array.isArray(source)
            ? source.map((item) => {
                const row = toRecord(item);
                return {
                    key: readText(row, ["key"], "unassigned"),
                    name: readText(row, ["name"], "Unassigned"),
                    amount: readNumber(row, ["amount"]),
                };
            })
            : [];

    const normalizeTopRows = (source: unknown): OwnerPosTopProduct[] =>
        Array.isArray(source)
            ? source.map((item) => {
                const row = toRecord(item);
                return {
                    key: readText(row, ["key"]),
                    name: readText(row, ["name"], "Unnamed Product"),
                    sales: readNumber(row, ["sales"]),
                    units: readNumber(row, ["units"]),
                };
            }).filter((row) => row.name)
            : [];

    const branchPerformance = toRecord(raw.branchPerformance);
    const topProducts = toRecord(raw.topProducts);

    return {
        daily: normalizeDaily(raw.daily),
        branchPerformance: {
            month: normalizeBranchRows(branchPerformance.month),
            quarter: normalizeBranchRows(branchPerformance.quarter),
            year: normalizeBranchRows(branchPerformance.year),
        },
        topProducts: {
            month: normalizeTopRows(topProducts.month),
            quarter: normalizeTopRows(topProducts.quarter),
            year: normalizeTopRows(topProducts.year),
        },
    };
}

function normalizeName(value: string) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getInventoryCostForItem(
    itemName: string,
    branchId: number | null | undefined,
    products: InventoryProduct[],
) {
    const target = normalizeName(itemName);
    if (!target) return null;

    const candidates = products.filter((product) => {
        const sameName = normalizeName(product.name) === target;
        if (!sameName) return false;
        if (branchId === null || branchId === undefined) return true;
        const productBranchId = product.branchId ?? product.branch_id;
        return productBranchId === null || productBranchId === undefined || String(productBranchId) === String(branchId);
    });

    for (const product of candidates) {
        const directCost = Number(product.costPrice ?? product.cost_price);
        if (Number.isFinite(directCost) && directCost > 0) return directCost;

        const variantCosts = (product.variants || [])
            .map((variant) => Number(variant.costPrice ?? variant.cost_price))
            .filter((value) => Number.isFinite(value) && value > 0);
        if (variantCosts.length > 0) {
            return variantCosts.reduce((sum, value) => sum + value, 0) / variantCosts.length;
        }
    }

    return null;
}

function getPackageCost(
    booking: Booking,
    packages: PackageRecord[],
    products: InventoryProduct[],
) {
    // Preferred source: backend-calculated cost from the actual booking_items
    // rows. This supports package and custom bookings and uses product/variant
    // IDs instead of fragile product-name matching.
    if (booking.costOfSales !== null && booking.costOfSales !== undefined) {
        const directCost = Number(booking.costOfSales);
        if (Number.isFinite(directCost) && directCost >= 0) return directCost;
    }

    const packageName = normalizeName(booking.packageName || "");
    if (!packageName || isCustomDashboardBooking(booking)) return null;

    const matchingPackages = packages.filter((pkg) => {
        if (normalizeName(pkg.name) !== packageName) return false;
        const packageBranchId = pkg.branchId ?? pkg.branch_id;
        const bookingBranchId = booking.branchId;
        if (bookingBranchId === null || bookingBranchId === undefined || packageBranchId === null || packageBranchId === undefined) {
            return true;
        }
        return String(packageBranchId) === String(bookingBranchId);
    });

    const pkg = matchingPackages[0];
    if (!pkg || pkg.inclusions.length === 0) return null;

    let total = 0;
    for (const inclusion of pkg.inclusions) {
        const explicitCost = Number(inclusion.costPrice ?? inclusion.cost_price);
        let unitCost = Number.isFinite(explicitCost) && explicitCost > 0
            ? explicitCost
            : null;

        if (unitCost === null && inclusion.productId) {
            const product = products.find((candidate) =>
                Number(candidate.id) === Number(inclusion.productId) &&
                (candidate.branchId === null ||
                    candidate.branchId === undefined ||
                    booking.branchId === null ||
                    booking.branchId === undefined ||
                    String(candidate.branchId) === String(booking.branchId))
            );

            if (product) {
                const variantId = inclusion.variantId ?? inclusion.variant_id;
                const variant = variantId
                    ? (product.variants || []).find((candidate) => Number(candidate.id) === Number(variantId))
                    : undefined;
                unitCost = Number(variant?.costPrice ?? variant?.cost_price ?? product.costPrice ?? product.cost_price);
                if (!Number.isFinite(unitCost) || unitCost < 0) unitCost = null;
            }
        }

        if (unitCost === null) {
            unitCost = getInventoryCostForItem(inclusion.name, booking.branchId, products);
        }

        if (unitCost === null) return null;
        total += unitCost * Math.max(1, inclusion.quantity);
    }

    return total;
}

/* Optional finance and operational summaries from the existing owner modules.
 * These are never filled with screenshot sample values. A null collection means
 * the corresponding endpoint has not supplied a recognizable dataset.
 */
type OwnerSupplierRow = {
    id: string;
    purchaseNumber: string;
    supplier: string;
    branch: string;
    balance: number;
    dueDate: string;
    status: string;
    items: { name: string; quantity: number }[] | null;
    source?: "sales" | "rental";
};
type OwnerManagerRequest = {
    id: string;
    manager: string;
    branch: string;
    leaveType: string;
    dateLabel: string;
    status: string;
    reason?: string;
};
type OwnerRentalRow = { key: string; name: string; units: number; revenue: number; date?: string; period?: PeriodOption };
type OwnerRevenueAllocation = { consumable: number; rental: number; unallocated: number; partial: boolean; periodKey: string };

function ownerArrayAt(value: unknown, keys: string[]): unknown[] | null {
    const record = toRecord(value);
    const nested = toRecord(record.data);
    for (const key of keys) {
        if (Array.isArray(record[key])) return record[key] as unknown[];
        if (Array.isArray(nested[key])) return nested[key] as unknown[];
    }
    return null;
}
function ownerSupplierRows(value: unknown): OwnerSupplierRow[] | null {
    const items = ownerArrayAt(value, ["payables", "supplierPayables", "supplier_payables", "purchases", "supplierPurchases"]);
    if (!items) return null;
    const balanceKeys = ["outstandingBalance", "outstanding_balance", "remainingBalance", "balance", "amountDue", "amount_due"];
    // A purchase list without unpaid balances is NOT a payables summary.
    if (items.some(item => firstDefined(toRecord(item), balanceKeys) === undefined)) return null;
    return items.map((item, index) => {
        const r = toRecord(item);
        const balance = readNumber(r, balanceKeys);
        return {
            id: readText(r, ["purchaseId", "purchase_id", "id"], String(index)),
            purchaseNumber: readText(r, ["purchaseNumber", "purchase_number", "purchaseNo", "purchase_no", "referenceNo", "reference_no"], "—"),
            supplier: readText(r, ["supplierName", "supplier_name", "supplier"], "—"),
            branch: readText(r, ["branchName", "branch_name", "branch"], "—"),
            balance, dueDate: readText(r, ["paymentDueDate", "payment_due_date", "dueDate", "due_date"]),
            status: (() => {
                const existing = readText(r, ["status", "paymentStatus", "payment_status"], "Pending");
                const due = readText(r, ["paymentDueDate", "payment_due_date", "dueDate", "due_date"]);
                // The purchasing API calls an unpaid credit balance "Unpaid".
                // Display it as Pending; past-due balances take priority even
                // when a purchase has already been partially paid.
                if (/^\d{4}-\d{2}-\d{2}/.test(due) && due.slice(0, 10) < formatDashboardIsoDate(new Date())) return "Overdue";
                return existing.toLowerCase() === "unpaid" ? "Pending" : existing;
            })(),
            items: (() => {
                const source = firstDefined(r, ["items", "purchaseItems", "purchase_items"]);
                return Array.isArray(source) ? source.map(item => {
                    const product = toRecord(item);
                    return {name: readText(product, ["productName", "product_name", "name"], "Product"), quantity: readNumber(product, ["qty", "quantity"], 0)};
                }) : null;
            })(),
        };
    }).filter(r => r.balance > 0.005);
}
function ownerManagerRows(value: unknown): OwnerManagerRequest[] | null {
    const items = ownerArrayAt(value, ["managerRequests", "manager_requests", "leaveRequests", "leave_requests", "requests"]);
    if (!items) return null;

    // The owner API returns one database row per requested day. Show one row
    // per leave application, as the Branch Managers screen does. Only group
    // rows when their shared identity, submission timestamp and request details
    // establish that they belong to the same application.
    const grouped = new Map<string, { request: OwnerManagerRequest; dates: string[] }>();
    items.forEach((item, index) => {
        const r = toRecord(item);
        const id = readText(r, ["id", "requestId", "request_id"], String(index));
        const managerId = readText(r, ["managerId", "manager_id", "employeeId", "employee_id"]);
        const branchId = readText(r, ["branchId", "branch_id"]);
        const createdAt = readText(r, ["createdAt", "created_at"]);
        const leaveType = readText(r, ["leaveType", "leave_type", "type"], "Leave");
        const reason = readText(r, ["reason", "leaveReason", "leave_reason"]);
        const status = readText(r, ["approvalStatus", "approval_status", "status"], "Pending");
        const date = readText(r, ["leaveDate", "leave_date", "startDate", "start_date", "date"]);
        const explicitEnd = readText(r, ["leaveEndDate", "leave_end_date", "endDate", "end_date"]);
        const key = managerId && branchId && createdAt
            ? JSON.stringify([managerId, branchId, createdAt, leaveType, reason, status])
            : `single:${id}:${index}`;
        const found = grouped.get(key);
        if (found) {
            if (date) found.dates.push(date);
            if (explicitEnd) found.dates.push(explicitEnd);
        } else {
            grouped.set(key, {
                request: {
                    id,
                    manager: readText(r, ["managerName", "manager_name", "employeeName", "employee_name", "name"], "—"),
                    branch: readText(r, ["branchName", "branch_name", "branch"], "—"),
                    leaveType,
                    dateLabel: "—",
                    status,
                    reason,
                },
                dates: [date, explicitEnd].filter(Boolean),
            });
        }
    });
    return Array.from(grouped.values()).map(({request, dates}) => {
        const sorted = [...new Set(dates)].sort();
        const start = sorted[0] || "";
        const end = sorted[sorted.length - 1] || "";
        return {
            ...request,
            dateLabel: start && end && end !== start
                ? `${ownerDisplayShortDate(start)} – ${ownerDisplayShortDate(end)}`
                : ownerDisplayShortDate(start),
        };
    });
}
function ownerRentalRows(value: unknown): OwnerRentalRow[] | null {
    const raw = toRecord(value);
    const nested = toRecord(raw.data);
    const possible = [raw.topRentedProducts, raw.top_rented_products, raw.topRentalProducts,
        raw.rentalSales, raw.rental_sales, nested.topRentedProducts, nested.top_rented_products];
    const source = possible.find(item => item !== undefined);
    if (!source) return null;
    const allowedPeriods: PeriodOption[] = ["month", "quarter", "year"];
    const parseRows = (items: unknown[], sourcePeriod?: PeriodOption): OwnerRentalRow[] =>
        items.map((item, index) => {
            const record = toRecord(item);
            const periodText = readText(record, ["period", "periodType", "period_type"]).toLowerCase();
            const period = allowedPeriods.find(option => option === periodText) || sourcePeriod;
            return {
                key: readText(record, ["id", "productId", "product_id", "key"], String(index)),
                name: readText(record, ["productName", "product_name", "name"], "—"),
                units: readNumber(record, ["totalRentals", "total_rentals", "rentals", "bookings", "quantity", "units"]),
                revenue: readNumber(record, ["revenue", "totalRevenue", "total_revenue", "amount"]),
                date: readText(record, ["date", "created_at", "periodDate"]),
                period,
            };
        });
    if (Array.isArray(source)) {
        const rows = parseRows(source);
        // Without dates or a declared aggregation period, month/quarter/year filtering
        // cannot be correct. Do not quietly label all-time totals as this month.
        return rows.every(row => row.period || row.date) ? rows : null;
    }
    const object = toRecord(source);
    const rows = allowedPeriods.flatMap(period => Array.isArray(object[period])
        ? parseRows(object[period] as unknown[], period) : []);
    return rows.length || allowedPeriods.some(period => Array.isArray(object[period])) ? rows : null;
}

/** Only accept an allocated product-type split reported for the CURRENT month.
 * POS vs booking is not equivalent to consumable vs rental revenue.
 * Both allocated shares must reconcile to total realized revenue.
 */
function ownerVerifiedAllocation(payload: unknown, total: number, expectedMonth: string, posRevenue = 0): OwnerRevenueAllocation | null {
    const record = toRecord(payload);
    const booking = toRecord(record.bookingRevenueAllocation);
    if (booking.month === expectedMonth && booking.verified === true) {
        const bookingConsumable = readNullableNumber(booking, ["bookingConsumable"]);
        const bookingRental = readNullableNumber(booking, ["bookingRental"]);
        const bookingRevenue = readNullableNumber(booking, ["bookingRevenue"]);
        if (bookingConsumable !== null && bookingRental !== null && bookingRevenue !== null &&
            bookingConsumable >= 0 && bookingRental >= 0 &&
            Math.abs(bookingConsumable + bookingRental - bookingRevenue) <= 0.01) {
            const consumable = posRevenue + bookingConsumable;
            const rental = bookingRental;
            if (Math.abs(consumable + rental - total) <= Math.max(1, total * 0.00001)) {
                return {consumable, rental, unallocated: 0, partial: false, periodKey: expectedMonth};
            }
        }
    }
    // A few historical completed bookings do not have a persisted financial
    // snapshot. Never infer their consumable/rental allocation from the package
    // total. Show only proved components and label the remainder unallocated.
    if (booking.month === expectedMonth && booking.verified === false) {
        const knownConsumable = readNullableNumber(booking, ["verifiedBookingConsumable"]);
        const knownRental = readNullableNumber(booking, ["verifiedBookingRental"]);
        const unknown = readNullableNumber(booking, ["unallocatedBookingRevenue"]);
        const bookingRevenue = readNullableNumber(booking, ["bookingRevenue"]);
        if (knownConsumable !== null && knownRental !== null && unknown !== null && bookingRevenue !== null &&
            knownConsumable >= 0 && knownRental >= 0 && unknown >= 0 &&
            Math.abs(knownConsumable + knownRental + unknown - bookingRevenue) <= 0.01) {
            const consumable = posRevenue + knownConsumable;
            const rental = knownRental;
            if (Math.abs(consumable + rental + unknown - total) <= Math.max(1, total * 0.00001)) {
                return { consumable, rental, unallocated: unknown, partial: true, periodKey: expectedMonth };
            }
        }
    }

    const data = toRecord(record.data);
    const candidates = [record.revenueBreakdown, record.revenue_breakdown,
        data.revenueBreakdown, data.revenue_breakdown,
        toRecord(record.summary).revenueBreakdown, toRecord(record.summary).revenue_breakdown];
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const info = toRecord(candidate);
        const periodKey = readText(info, ["month", "period", "periodKey", "period_key"]);
        const consumable = readNullableNumber(info, ["consumableGoods", "consumable_goods", "consumableRevenue", "consumable_revenue"]);
        const rental = readNullableNumber(info, ["rentalGoods", "rental_goods", "rentalRevenue", "rental_revenue"]);
        if (periodKey.slice(0, 7) !== expectedMonth || consumable === null || rental === null || consumable < 0 || rental < 0) continue;
        // Must reconcile exactly (up to rounding) with the displayed Total Revenue.
        if (Math.abs((consumable + rental) - total) > Math.max(1, total * 0.00001)) continue;
        return {consumable, rental, unallocated: 0, partial: false, periodKey: expectedMonth};
    }
    return null;
}

function ownerDisplayShortDate(value: string): string {
    if (!value) return "—";
    const dt = new Date(value.length === 10 ? value + "T12:00:00" : value);
    return Number.isNaN(dt.getTime()) ? value : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
    // Owner financial KPIs use realized/fulfilled revenue only. Confirmed
    // bookings remain pipeline, not completed sales.
    return status === "Completed";
}

type MonthlyPoint = {
    key: string;
    label: string;
    posSales: number;
    posCost: number;
    bookingSales: number;
    bookingCost: number;
    sales: number;
    cost: number;
    profit: number | null;
    uncostedSales: number;
    costCoveragePct: number;
};

function getOrderCost(order: Order): number | null {
    const backendCost = order.totalCost;
    if (backendCost !== null && backendCost !== undefined && Number.isFinite(backendCost)) {
        return Math.max(0, backendCost);
    }

    const itemCost = (order.items || []).reduce((sum, item) => {
        const quantity = Number(item.quantity || 0);
        const costPrice = Number(item.costPrice ?? item.cost_price ?? NaN);
        if (!Number.isFinite(quantity) || !Number.isFinite(costPrice)) return sum;
        return sum + Math.max(0, quantity) * Math.max(0, costPrice);
    }, 0);

    if (itemCost > 0) return itemCost;

    const revenue = Number(order.total || 0);
    const backendProfit = order.profit;
    if (backendProfit !== null && backendProfit !== undefined && Number.isFinite(backendProfit)) {
        return Math.max(0, revenue - backendProfit);
    }

    return null;
}

function getInventoryPortfolioCostRatio(products: InventoryProduct[]) {
    let weightedCost = 0;
    let weightedSales = 0;

    for (const product of products) {
        const variants = product.variants || [];
        if (variants.length > 0) {
            for (const variant of variants) {
                const cost = Number(variant.costPrice ?? variant.cost_price);
                const sales = Number(variant.salesPrice ?? variant.sales_price);
                if (Number.isFinite(cost) && cost >= 0 && Number.isFinite(sales) && sales > 0) {
                    weightedCost += cost;
                    weightedSales += sales;
                }
            }
            continue;
        }

        const cost = Number(product.costPrice ?? product.cost_price);
        const sales = Number(product.salesPrice ?? product.sales_price);
        if (Number.isFinite(cost) && cost >= 0 && Number.isFinite(sales) && sales > 0) {
            weightedCost += cost;
            weightedSales += sales;
        }
    }

    if (weightedSales <= 0) return 0.5;
    return Math.max(0.05, Math.min(0.95, weightedCost / weightedSales));
}

function buildOwnerAnalytics(
    posSummary: OwnerPosSummary,
    bookings: Booking[],
    packages: PackageRecord[],
    products: InventoryProduct[],
    monthsBack: number,
    reference: Date,
) {
    const buckets = getLastNMonthBuckets(reference, monthsBack).map((bucket) => ({
        ...bucket,
        posSales: 0,
        posCost: 0,
        bookingSales: 0,
        bookingCost: 0,
        uncostedSales: 0,
    }));
    const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

    // POS data is already aggregated server-side. This keeps the browser from
    // downloading and reducing thousands of historical order/order-item rows.
    posSummary.daily.forEach((point) => {
        const date = parseFlexibleDate(point.date);
        if (!date) return;
        const bucket = bucketByKey.get(monthKey(date));
        if (!bucket) return;

        bucket.posSales += Math.max(0, Number(point.sales || 0));
        bucket.posCost += Math.max(0, Number(point.cost || 0));
    });

    bookings.filter(isRealizedBooking).forEach((booking) => {
        const date = parseFlexibleDate(booking.date);
        if (!date) return;
        const bucket = bucketByKey.get(monthKey(date));
        if (!bucket) return;

        const revenue = getDashboardBookingTotalPrice(booking);
        bucket.bookingSales += revenue;

        const cost = getPackageCost(booking, packages, products);
        if (cost !== null) bucket.bookingCost += cost;
        else bucket.uncostedSales += Math.max(0, revenue);
    });

    const costedSalesTotal = buckets.reduce(
        (sum, bucket) => sum + Math.max(0, bucket.posSales + bucket.bookingSales - bucket.uncostedSales),
        0,
    );
    const costedCostTotal = buckets.reduce(
        (sum, bucket) => sum + Math.max(0, bucket.posCost + bucket.bookingCost),
        0,
    );
    const portfolioCostRatio = costedSalesTotal > 0
        ? Math.max(0.05, Math.min(0.95, costedCostTotal / costedSalesTotal))
        : getInventoryPortfolioCostRatio(products);

    const monthly: MonthlyPoint[] = buckets.map((bucket) => {
        const sales = bucket.posSales + bucket.bookingSales;
        const cost = bucket.posCost + bucket.bookingCost;
        const costCoveragePct = sales > 0
            ? Math.max(0, Math.min(100, ((sales - bucket.uncostedSales) / sales) * 100))
            : 100;

        // Legacy booking rows without an item-level cost use the portfolio's
        // observed COGS ratio from costed sales. POS cost is already aggregated
        // from the same order-item/product cost sources used by the prior API.
        const fallbackCost = bucket.uncostedSales > 0
            ? bucket.uncostedSales * portfolioCostRatio
            : 0;
        const reportedCost = cost + fallbackCost;

        return {
            key: bucket.key,
            label: bucket.label,
            posSales: bucket.posSales,
            posCost: bucket.posCost,
            bookingSales: bucket.bookingSales,
            bookingCost: bucket.bookingCost,
            sales,
            cost: reportedCost,
            profit: sales - reportedCost,
            uncostedSales: bucket.uncostedSales,
            costCoveragePct,
        };
    });

    return { monthly, portfolioCostRatio };
}

function getMonthToDateMetrics(
    posSummary: OwnerPosSummary,
    bookings: Booking[],
    packages: PackageRecord[],
    products: InventoryProduct[],
    reference: Date,
    monthOffset: number,
    fallbackCostRatio = 0.5,
) {
    const targetMonth = new Date(reference.getFullYear(), reference.getMonth() - monthOffset, 1);
    const daysElapsed = reference.getDate();
    const monthStart = targetMonth;
    const monthEnd = new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        Math.min(daysElapsed, new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()) + 1,
    );

    let sales = 0;
    let cost = 0;
    let uncostedSales = 0;

    posSummary.daily.forEach((point) => {
        const date = parseFlexibleDate(point.date);
        if (!date || date < monthStart || date >= monthEnd) return;
        sales += Math.max(0, Number(point.sales || 0));
        cost += Math.max(0, Number(point.cost || 0));
    });

    bookings.filter(isRealizedBooking).forEach((booking) => {
        const date = parseFlexibleDate(booking.date);
        if (!date || date < monthStart || date >= monthEnd) return;
        const revenue = Math.max(0, getDashboardBookingTotalPrice(booking));
        sales += revenue;
        const bookingCost = getPackageCost(booking, packages, products);
        if (bookingCost === null) uncostedSales += revenue;
        else cost += bookingCost;
    });

    const costRatio = sales > 0 && uncostedSales < sales
        ? Math.max(0.05, Math.min(0.95, cost / Math.max(0.01, sales - uncostedSales)))
        : Math.max(0.05, Math.min(0.95, fallbackCostRatio));
    const reportedCost = cost + uncostedSales * costRatio;

    return {
        sales,
        cost: reportedCost,
        profit: sales - reportedCost,
        uncostedSales,
    };
}

function aggregateBranchPerformance(
    posSummary: OwnerPosSummary,
    bookings: Booking[],
    branches: Branch[],
    period: PeriodOption,
    reference: Date,
) {
    const start = getPeriodStart(period, reference);
    const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
    const nameById = new Map(branches.map((branch) => [String(branch.id), branch.branchName]));
    const totals = new Map<string, number>();

    posSummary.branchPerformance[period].forEach((row) => {
        totals.set(row.key, (totals.get(row.key) || 0) + Number(row.amount || 0));
    });

    bookings.filter(isRealizedBooking).forEach((booking) => {
        const date = parseFlexibleDate(booking.date);
        if (!date || date < start || date >= end) return;
        const key = booking.branchId !== null && booking.branchId !== undefined ? String(booking.branchId) : "unassigned";
        totals.set(key, (totals.get(key) || 0) + getDashboardBookingTotalPrice(booking));
    });

    const backendNames = new Map(
        posSummary.branchPerformance[period].map((row) => [row.key, row.name]),
    );

    return Array.from(totals.entries())
        .map(([key, amount]) => ({
            key,
            name:
                key === "unassigned"
                    ? "Unassigned"
                    : backendNames.get(key) || nameById.get(key) || `Branch #${key}`,
            amount,
        }))
        .sort((a, b) => b.amount - a.amount);
}

type TopItemRow = { key: string; name: string; sales: number; units: number };

function aggregateTopItems(
    posSummary: OwnerPosSummary,
    bookings: Booking[],
    period: PeriodOption,
    reference: Date,
): TopItemRow[] {
    const start = getPeriodStart(period, reference);
    const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
    const map = new Map<string, TopItemRow>();

    posSummary.topProducts[period].forEach((row) => {
        map.set(row.key, {
            key: row.key,
            name: row.name,
            sales: Number(row.sales || 0),
            units: Number(row.units || 0),
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



/* ----------------------------------------------------------------------- */
/* Initial dashboard skeleton                                               */
/* ----------------------------------------------------------------------- */

function OwnerSkeletonBar({ className = "" }: { className?: string }) {
    return <div className={`rounded-full bg-[#ECE7F0] ${className}`} />;
}

function OwnerMetricSkeleton() {
    return (
        <div className="flex min-h-[126px] items-center gap-4 rounded-2xl border border-[#E9E0EF] bg-white px-5 py-4 shadow-sm">
            <div className="h-14 w-14 shrink-0 rounded-full bg-[#EEE9F4]" />
            <div className="min-w-0 flex-1">
                <OwnerSkeletonBar className="h-3 w-24" />
                <OwnerSkeletonBar className="mt-3 h-7 w-28" />
                <OwnerSkeletonBar className="mt-3 h-2.5 w-36 max-w-full" />
            </div>
        </div>
    );
}

function OwnerTrendSkeleton() {
    return (
        <div className="min-h-[330px] rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#EEE9F4]" />
                    <div>
                        <OwnerSkeletonBar className="h-3.5 w-44" />
                        <OwnerSkeletonBar className="mt-2 h-2.5 w-72 max-w-full" />
                    </div>
                </div>
                <div className="h-8 w-28 rounded-lg bg-[#F1EDF4]" />
            </div>
            <div className="relative mt-5 h-[215px] overflow-hidden rounded-xl">
                {[25, 70, 115, 160].map((top) => (
                    <div key={top} className="absolute left-10 right-3 h-px bg-[#F0EBF3]" style={{ top }} />
                ))}
                <svg viewBox="0 0 760 210" className="absolute inset-0 h-full w-full" aria-hidden="true">
                    <path d="M40 122 L105 102 L170 135 L235 145 L300 118 L365 120 L430 90 L495 122 L560 122 L625 130 L700 126" fill="none" stroke="#E2DCE8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M40 150 L105 136 L170 158 L235 163 L300 145 L365 146 L430 125 L495 145 L560 145 L625 151 L700 149" fill="none" stroke="#ECE6F0" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M40 172 L105 158 L170 175 L235 179 L300 165 L365 166 L430 148 L495 164 L560 164 L625 168 L700 167" fill="none" stroke="#F1ECF4" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="absolute bottom-1 left-10 right-3 flex justify-between">
                    {[0, 1, 2, 3, 4, 5, 6].map((item) => (
                        <div key={item} className="h-2 w-9 rounded-full bg-[#EEE9F2]" />
                    ))}
                </div>
            </div>
            <div className="mt-2 flex justify-center gap-6">
                {[0, 1, 2].map((item) => (
                    <div key={item} className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-[#E5DFEA]" />
                        <OwnerSkeletonBar className="h-2.5 w-16" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function OwnerBranchSkeleton() {
    return (
        <div className="min-h-[330px] rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#EEE9F4]" />
                    <div>
                        <OwnerSkeletonBar className="h-3.5 w-32" />
                        <OwnerSkeletonBar className="mt-2 h-2.5 w-40" />
                    </div>
                </div>
                <div className="h-8 w-20 rounded-lg bg-[#F1EDF4]" />
            </div>
            <div className="mt-7 space-y-5">
                {[0, 1, 2, 3].map((item) => (
                    <div key={item}>
                        <div className="flex items-center justify-between gap-3">
                            <OwnerSkeletonBar className="h-2.5 w-28" />
                            <OwnerSkeletonBar className="h-3 w-16" />
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-[#F2EEF5]">
                            <div className="h-full rounded-full bg-[#E3DCE9]" style={{ width: `${78 - item * 13}%` }} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function OwnerTopItemsSkeleton() {
    return (
        <div className="min-h-[290px] rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#EEE9F4]" />
                    <div>
                        <OwnerSkeletonBar className="h-3.5 w-36" />
                        <OwnerSkeletonBar className="mt-2 h-2.5 w-44" />
                    </div>
                </div>
                <div className="h-8 w-20 rounded-lg bg-[#F1EDF4]" />
            </div>
            <div className="mt-5 divide-y divide-[#F2EDF4]">
                {[0, 1, 2, 3].map((item) => (
                    <div key={item} className="grid grid-cols-[32px_1fr_auto] items-center gap-3 py-3.5">
                        <div className="h-7 w-7 rounded-full bg-[#EEE9F4]" />
                        <div>
                            <OwnerSkeletonBar className="h-2.5 w-48 max-w-full" />
                            <OwnerSkeletonBar className="mt-2 h-2 w-24" />
                        </div>
                        <OwnerSkeletonBar className="h-3 w-16" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function OwnerForecastSkeleton() {
    return (
        <div className="min-h-[290px] rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-[#EEE9F4]" />
                    <div>
                        <OwnerSkeletonBar className="h-3.5 w-28" />
                        <OwnerSkeletonBar className="mt-2 h-2.5 w-44" />
                    </div>
                </div>
                <OwnerSkeletonBar className="h-2.5 w-20" />
            </div>
            <div className="mt-7 rounded-xl border border-[#EFE8F3] bg-[#FBF9FC] p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <OwnerSkeletonBar className="h-2.5 w-36" />
                        <OwnerSkeletonBar className="mt-3 h-7 w-32" />
                        <OwnerSkeletonBar className="mt-3 h-2.5 w-44" />
                    </div>
                    <div className="h-12 w-12 rounded-full bg-[#EEE9F4]" />
                </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
                {[0, 1].map((item) => (
                    <div key={item} className="rounded-xl bg-[#FAF8FC] p-3">
                        <OwnerSkeletonBar className="h-2.5 w-20" />
                        <OwnerSkeletonBar className="mt-3 h-4 w-24" />
                        <OwnerSkeletonBar className="mt-2 h-2 w-16" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function OwnerDashboardSkeleton() {
    return (
        <div className="mx-auto max-w-none space-y-4 animate-pulse" role="status" aria-label="Loading owner dashboard">
            <span className="sr-only">Loading owner dashboard data</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
                {[0, 1, 2, 3].map((item) => <OwnerMetricSkeleton key={item} />)}
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3" aria-hidden="true">
                <div className="xl:col-span-2"><OwnerTrendSkeleton /></div>
                <OwnerBranchSkeleton />
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,25fr)_minmax(0,40fr)_minmax(0,35fr)]" aria-hidden="true">
                <OwnerMetricSkeleton/><OwnerTopItemsSkeleton/><OwnerTopItemsSkeleton/>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
                <OwnerTopItemsSkeleton/><OwnerTopItemsSkeleton/><OwnerTopItemsSkeleton/>
            </div>
        </div>
    );
}

export default function OwnerDashboard() {
    const router = useRouter();
    const { user } = useCurrentUser();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [posSummary, setPosSummary] = useState<OwnerPosSummary>(EMPTY_OWNER_POS_SUMMARY);
    const [inventoryProducts, setInventoryProducts] = useState<InventoryProduct[]>([]);
    const [packages, setPackages] = useState<PackageRecord[]>([]);
    const [supplierPayables, setSupplierPayables] = useState<OwnerSupplierRow[] | null>(null);
    const [rentalSupplierPayables, setRentalSupplierPayables] = useState<OwnerSupplierRow[] | null>(null);
    const [managerRequests, setManagerRequests] = useState<OwnerManagerRequest[] | null>(null);
    const [topRentalProducts, setTopRentalProducts] = useState<OwnerRentalRow[] | null>(null);
    const [topBookingSummary, setTopBookingSummary] = useState<OwnerRentalRow[] | null>(null);
    const [consumablePeriod, setConsumablePeriod] = useState<PeriodOption>("month");
    const [packagePeriod, setPackagePeriod] = useState<PeriodOption>("month");
    const [rentalPeriod, setRentalPeriod] = useState<PeriodOption>("month");
    const [selectedPurchase, setSelectedPurchase] = useState<OwnerSupplierRow | null>(null);
    const [selectedManagerRequest, setSelectedManagerRequest] = useState<OwnerManagerRequest | null>(null);
    const [selectedKpi, setSelectedKpi] = useState<OwnerKpiKey | null>(null);
    const [allocationData, setAllocationData] = useState<unknown>(null);

    const [loadError, setLoadError] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false);
    const loadInFlightRef = useRef(false);
    const posRefreshInFlightRef = useRef(false);

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
            setHasLoadedDashboard(true);
            return;
        }

        // Prevent React Strict Mode/Fast Refresh from starting a duplicate copy
        // of the owner dashboard requests while one is in flight.
        if (loadInFlightRef.current) return;
        loadInFlightRef.current = true;

        if (!silent) setIsRefreshing(true);
        setLoadError("");

        try {
            /*
             * Load the independent dashboard sources at the same time. POS uses
             * a dashboard-specific aggregate action instead of downloading full
             * historical orders and order items into the browser. This preserves
             * the same KPI/chart behavior while drastically reducing server work,
             * JSON size, transfer time, and client-side aggregation.
             */
            const ordersDateFrom = formatDashboardIsoDate(
                new Date(
                    currentDateTime.getFullYear(),
                    currentDateTime.getMonth() - 12,
                    1,
                ),
            );
            const ordersDateTo = formatDashboardIsoDate(currentDateTime);

            const [branchesResult, bookingsResult, bookingCostsResult, posSummaryResult, productsResult, packagesResult, supplierResult, managerRequestsResult, rentalsResult, rentalSuppliersResult] =
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
                            date_from: ordersDateFrom,
                            date_to: ordersDateTo,
                        }),
                        cache: "no-store",
                    }),
                    fetch("/api/bookings", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_booking_costs",
                            role: "owner",
                            store_id: storeId ? Number(storeId) : undefined,
                            date_from: ordersDateFrom,
                            date_to: ordersDateTo,
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
                            action: "get_owner_dashboard_summary",
                            date_from: ordersDateFrom,
                            date_to: ordersDateTo,
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
                            include_variants: true,
                            store_id: storeId ? Number(storeId) : undefined,
                        }),
                        cache: "no-store",
                    }),
                    fetch("/api/packages", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "get_packages",
                            store_id: storeId ? Number(storeId) : undefined,
                        }),
                        cache: "no-store",
                    }),
                    // Optional sources: use existing owner supplier and leave endpoints.
                    // Rental dashboard analytics still require an action in lambda-rental-inventory.
                    // Never replace unsupported financial data with example amounts.
                    fetch("/api/products", {
                        method: "POST", cache: "no-store",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_supplier_payables", store_id: storeId ? Number(storeId) : undefined }),
                    }),
                    fetch("/api/branch-managers?view=manager_requests", {
                        method: "GET", cache: "no-store",
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                    // Read-only owner booking financial summary. Returns authoritative
                    // package and rental rankings plus a verified product-type allocation.
                    fetch("/api/bookings", {
                        method: "POST", cache: "no-store",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_owner_dashboard_financial_summary" }),
                    }),
                    // Read-only rental purchase balances across every branch.
                    fetch("/api/rental-inventory", {
                        method: "POST", cache: "no-store",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: "get_owner_supplier_payables" }),
                    }),
                ]);

            // Start from the currently displayed data. If one endpoint fails,
            // keep its previous value instead of clearing the dashboard and
            // producing another misleading intermediate state.
            let nextBranches = branches;
            let nextBookings = bookings;
            let nextPosSummary = posSummary;
            let nextInventoryProducts = inventoryProducts;
            let nextPackages = packages;
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

            if (bookingCostsResult.status === "fulfilled") {
                try {
                    const response = bookingCostsResult.value;
                    const data = await response.json().catch(() => ({}));
                    if (response.ok && data.costs && typeof data.costs === "object") {
                        const costs = data.costs as Record<string, unknown>;
                        nextBookings = nextBookings.map((booking) => ({
                            ...booking,
                            costOfSales: Number.isFinite(Number(costs[String(booking.id)]))
                                ? Number(costs[String(booking.id)])
                                : booking.costOfSales ?? null,
                        }));
                    } else if (!response.ok) {
                        errors.push("Unable to load booking inventory cost data.");
                    }
                } catch {
                    errors.push("Unable to parse booking inventory cost data.");
                }
            } else {
                console.warn("Owner dashboard booking costs fetch failed:", bookingCostsResult.reason);
                errors.push("Unable to load booking inventory cost data.");
            }

            if (posSummaryResult.status === "fulfilled") {
                try {
                    const response = posSummaryResult.value;
                    const data = await response.json().catch(() => ({}));

                    if (response.ok && data?.summary && typeof data.summary === "object") {
                        nextPosSummary = normalizeOwnerPosSummary(data.summary);

                        if (data?.meta?.queryTimingsMs) {
                            console.info(
                                "Owner dashboard POS summary timings:",
                                data.meta.queryTimingsMs,
                            );
                        }
                    } else {
                        const backendMessage = String(
                            data?.error ||
                            data?.message ||
                            `POS dashboard summary returned HTTP ${response.status}.`,
                        );

                        console.error("Owner dashboard POS summary request failed:", {
                            status: response.status,
                            response: data,
                        });

                        errors.push(`Unable to load POS dashboard summary: ${backendMessage}`);
                    }
                } catch (error) {
                    console.error("Owner dashboard POS summary processing failed:", error);
                    errors.push(
                        error instanceof Error
                            ? `Unable to load POS dashboard summary: ${error.message}`
                            : "Unable to load POS dashboard summary.",
                    );
                }
            } else {
                console.warn("Owner dashboard POS summary fetch failed:", posSummaryResult.reason);
                errors.push(
                    posSummaryResult.reason instanceof Error
                        ? `Unable to load POS dashboard summary: ${posSummaryResult.reason.message}`
                        : "Unable to load POS dashboard summary.",
                );
            }

            if (productsResult.status === "fulfilled") {
                try {
                    const response = productsResult.value;
                    const data = await response.json().catch(() => ({}));
                    if (response.ok && Array.isArray(data.products)) {
                        nextInventoryProducts = (data.products as unknown[]).map(normalizeInventoryProduct);
                    } else if (!response.ok) {
                        errors.push("Unable to load live inventory cost data.");
                    }
                } catch {
                    errors.push("Unable to parse live inventory cost data.");
                }
            } else {
                console.warn("Owner dashboard products fetch failed:", productsResult.reason);
                errors.push("Unable to load live inventory cost data.");
            }

            if (packagesResult.status === "fulfilled") {
                try {
                    const response = packagesResult.value;
                    const data = await response.json().catch(() => ({}));
                    const rawPackages = Array.isArray(data.packages)
                        ? data.packages
                        : Array.isArray(data.data)
                            ? data.data
                            : Array.isArray(data.records)
                                ? data.records
                                : [];
                    if (response.ok && Array.isArray(rawPackages)) {
                        nextPackages = rawPackages.map(normalizePackageRecord);
                    } else if (!response.ok) {
                        errors.push("Unable to load package cost data.");
                    }
                } catch {
                    errors.push("Unable to parse package cost data.");
                }
            } else {
                console.warn("Owner dashboard packages fetch failed:", packagesResult.reason);
                errors.push("Unable to load package cost data.");
            }

            // Keep last known good optional data if a single endpoint is offline.
            // In particular, never treat an HTTP error as an empty/zero balance.
            if (supplierResult.status === "fulfilled") {
                const response = supplierResult.value;
                const payload = await response.json().catch(() => ({}));
                if (response.ok) {
                    const rows = ownerSupplierRows(payload);
                    if (rows !== null) setSupplierPayables(rows.map(row => ({ ...row, source: "sales" as const })));
                    else console.warn("Owner supplier API did not return a usable payables array.");
                } else {
                    console.warn("Owner supplier payables request failed:", response.status, toRecord(payload).error);
                }
            }
            if (managerRequestsResult.status === "fulfilled") {
                const response = managerRequestsResult.value;
                const payload = await response.json().catch(() => ({}));
                if (response.ok) {
                    const rows = ownerManagerRows(payload);
                    if (rows !== null) setManagerRequests(rows);
                    else console.warn("Owner manager-request API did not return a requests array.");
                } else {
                    console.warn("Owner manager leave requests failed:", response.status, toRecord(payload).error);
                }
            }
            if (rentalsResult.status === "fulfilled") {
                const response = rentalsResult.value;
                const payload = await response.json().catch(() => ({}));
                if (response.ok && toRecord(payload).success === true) {
                    const rentalRows = ownerRentalRows(payload);
                    const packageRows = ownerRentalRows({topRentedProducts: toRecord(payload).topBookingPackages});
                    if (rentalRows !== null) setTopRentalProducts(rentalRows);
                    if (packageRows !== null) setTopBookingSummary(packageRows);
                    setAllocationData(payload);
                } else {
                    console.warn("Owner booking financial summary failed:", response.status, toRecord(payload).error);
                    errors.push(`Unable to load booking financial summary (${response.status}).`);
                }
            } else {
                console.warn("Owner booking financial summary request failed:", rentalsResult.reason);
                errors.push("Unable to load booking financial summary.");
            }

            if (rentalSuppliersResult.status === "fulfilled") {
                const response = rentalSuppliersResult.value;
                const payload = await response.json().catch(() => ({}));
                if (response.ok) {
                    const rows = ownerSupplierRows(payload);
                    if (rows !== null) {
                        setRentalSupplierPayables(rows.map(row => ({
                            ...row, id: `rental:${row.id}`, source: "rental" as const,
                        })));
                    } else {
                        console.warn("Rental supplier payables response was not recognized.");
                    }
                } else {
                    console.warn("Rental supplier payables request failed:", response.status, toRecord(payload).error);
                }
            } else {
                console.warn("Rental supplier payables fetch failed:", rentalSuppliersResult.reason);
            }

            // React 18 batches these updates, so the UI changes from the old
            // complete snapshot to the new complete snapshot in one render.
            setBranches(nextBranches);
            setBookings(nextBookings);
            setPosSummary(nextPosSummary);
            setInventoryProducts(nextInventoryProducts);
            setPackages(nextPackages);
            setLoadError(errors.join(" "));
        } finally {
            loadInFlightRef.current = false;
            if (!silent) setIsRefreshing(false);
            setHasLoadedDashboard(true);
        }
    }

    async function refreshOwnerPosSummary() {
        if (posRefreshInFlightRef.current) return;

        const token = getSavedItem("token");
        if (!token) return;

        posRefreshInFlightRef.current = true;

        try {
            const now = new Date();
            const dateFrom = formatDashboardIsoDate(
                new Date(now.getFullYear(), now.getMonth() - 12, 1),
            );
            const dateTo = formatDashboardIsoDate(now);

            const response = await fetch("/api/pos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_owner_dashboard_summary",
                    date_from: dateFrom,
                    date_to: dateTo,
                }),
                cache: "no-store",
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok && data?.summary && typeof data.summary === "object") {
                setPosSummary(normalizeOwnerPosSummary(data.summary));

                if (data?.meta?.queryTimingsMs) {
                    console.info(
                        "Owner POS near-real-time refresh timings:",
                        data.meta.queryTimingsMs,
                    );
                }
            }
        } catch (error) {
            // Keep the last successful POS snapshot. A transient background
            // refresh failure should never blank or interrupt the dashboard.
            console.warn("Owner POS background refresh failed:", error);
        } finally {
            posRefreshInFlightRef.current = false;
        }
    }

    useEffect(() => {
        // Initial load. The Refresh button still works exactly as before.
        void loadOwnerDashboard();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        /*
         * POS is the most time-sensitive Owner metric. Refresh only the compact
         * POS summary every 15 seconds instead of re-downloading bookings,
         * products, packages and branches at the same rate. Pause while the tab
         * is hidden and refresh once when the user comes back.
         */
        const refreshIfVisible = () => {
            if (document.visibilityState === "visible") {
                void refreshOwnerPosSummary();
            }
        };

        const posTimer = window.setInterval(refreshIfVisible, 15_000);
        document.addEventListener("visibilitychange", refreshIfVisible);

        return () => {
            window.clearInterval(posTimer);
            document.removeEventListener("visibilitychange", refreshIfVisible);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        /*
         * Near-real-time dashboard refresh:
         * re-check the same authoritative APIs every 60 seconds while this page
         * remains open. This keeps KPI values and charts current without
         * introducing WebSockets or changing the existing backend contracts.
         */
        const autoRefreshTimer = window.setInterval(() => {
            void loadOwnerDashboard({ silent: true });
        }, 60_000);

        return () => window.clearInterval(autoRefreshTimer);
        // Keep the timer closure aligned with the latest successfully displayed
        // snapshot so a partial API failure can still preserve existing data.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branches, bookings, user]);

    const referenceDateKey = currentDateTime.toDateString();

    const analytics = useMemo(
        () => buildOwnerAnalytics(posSummary, bookings, packages, inventoryProducts, 13, currentDateTime),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [posSummary, bookings, packages, inventoryProducts, referenceDateKey],
    );

    const branchRows = useMemo(
        () => aggregateBranchPerformance(posSummary, bookings, branches, branchPeriod, currentDateTime),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [posSummary, bookings, branches, branchPeriod, referenceDateKey],
    );

    const topItems = useMemo(
        () => aggregateTopItems(posSummary, bookings, topPeriod, currentDateTime),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [posSummary, bookings, topPeriod, referenceDateKey],
    );

    const monthly = analytics.monthly;
    const current = monthly[monthly.length - 1] || { sales: 0, posCost: 0, bookingSales: 0, bookingCost: 0, cost: 0, profit: null, posSales: 0, uncostedSales: 0, costCoveragePct: 100 };
    const previous = monthly[monthly.length - 2] || { sales: 0, posCost: 0, bookingSales: 0, bookingCost: 0, cost: 0, profit: null, posSales: 0, uncostedSales: 0, costCoveragePct: 100 };

    // Growth badges compare the same elapsed number of days against the prior month,
    // rather than comparing a partial current month with the previous full month.
    const currentMtd = getMonthToDateMetrics(
        posSummary,
        bookings,
        packages,
        inventoryProducts,
        currentDateTime,
        0,
        analytics.portfolioCostRatio,
    );
    const previousMtd = getMonthToDateMetrics(
        posSummary,
        bookings,
        packages,
        inventoryProducts,
        currentDateTime,
        1,
        analytics.portfolioCostRatio,
    );
    const deltaSales = pctDelta(currentMtd.sales, previousMtd.sales);
    const deltaCost = pctDelta(currentMtd.cost, previousMtd.cost);
    const deltaProfit = currentMtd.profit !== null && previousMtd.profit !== null
        ? pctDelta(currentMtd.profit, previousMtd.profit)
        : null;
    const trendChartData = monthly.slice(-trendRange).map((point) => ({
        label: point.label,
        sales: point.sales,
        cost: point.cost,
        profit: point.profit ?? 0,
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

    // Financial KPIs and chart continue to use the original authoritative sales calculations.
    const combinedPayables = supplierPayables === null && rentalSupplierPayables === null
        ? null : [...(supplierPayables || []), ...(rentalSupplierPayables || [])];
    const supplierBalance = combinedPayables === null ? null : combinedPayables.reduce((total, item) => total + item.balance, 0);
    const supplierTotalsComplete = supplierPayables !== null && rentalSupplierPayables !== null;
    // Show every outstanding sales-inventory and rental-inventory purchase, not only the first five.
    const displayedPayables = (combinedPayables || []).filter(item => item.balance > 0.005).slice().sort((a,b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    const rentalPayableAmount = rentalSupplierPayables?.reduce((sum, row) => sum + row.balance, 0) ?? null;
    const salesPayableAmount = supplierPayables?.reduce((sum, row) => sum + row.balance, 0) ?? null;
    const estimatedBookingCost = Math.max(0, current.cost - current.posCost - current.bookingCost);
    const kpiDetails: Record<OwnerKpiKey, OwnerKpiDetail> = {
        revenue: {
            title: "Total Revenue", amount: current.sales, period: currentMonthLabelForKpi(currentDateTime),
            formula: "Total Revenue = (Quantity Sold × Selling Price) + Completed Booking Sales",
            items: [["Product sales (POS)", current.posSales], ["Completed booking sales", current.bookingSales]],
            description: "For products, multiply the number sold by the selling price. Then add the final price of completed bookings. Each sale is counted only once.",
        },
        cost: {
            title: "Cost of Sales", amount: current.cost, period: currentMonthLabelForKpi(currentDateTime),
            formula: "Cost of Sales = (Quantity Sold × Unit Cost Price) + Booking Costs",
            items: [["Cost of products sold", current.posCost], ["Cost of completed bookings", current.bookingCost], ["Estimated cost of older bookings", estimatedBookingCost]],
            description: current.uncostedSales > 0
                ? `Some completed bookings have no saved cost. Their costs are estimated using a ${(analytics.portfolioCostRatio * 100).toFixed(1)}% cost rate. The estimated part is not an exact recorded cost.`
                : "Multiply each product sold by what the store paid for it. Add the cost of items used in completed bookings.",
        },
        profit: {
            title: "Gross Profit", amount: current.profit ?? 0, period: currentMonthLabelForKpi(currentDateTime),
            formula: "Gross Profit = Total Sales − Cost of Sales",
            items: [["Total Sales", current.sales], ["Minus: Cost of Sales", -current.cost]],
            description: current.uncostedSales > 0
                ? "Money left after subtracting sales costs. Some older booking costs are estimates. Rent, wages, and other expenses are not yet deducted."
                : "Money left after subtracting sales costs. Rent, wages, and other business expenses are not yet deducted.",
        },
        payables: {
            title: "Supplier Payables", amount: supplierBalance, period: `As of ${formatCurrentDashboardDateTime(currentDateTime)}`,
            formula: "Supplier Payables = Purchase Cost − Payments Already Made",
            items: [["Unpaid consumable supply purchases", salesPayableAmount], ["Unpaid rental supply purchases", rentalPayableAmount]],
            description: supplierTotalsComplete
                ? "The amount still owed to suppliers for consumable goods and rental equipment. Payments already made are deducted. Fully paid purchases are not included."
                : "Some supplier records could not be loaded, so this total may not include every unpaid purchase.",
        },
    };
    const pendingManagerRequests = managerRequests === null ? null : managerRequests.filter(item => item.status.toLowerCase() === "pending");
    const currentMonthKey = monthKey(currentDateTime);
    const verifiedAllocation = ownerVerifiedAllocation(allocationData, current.sales, currentMonthKey, current.posSales);
    const allocationReason = readText(toRecord(toRecord(allocationData).bookingRevenueAllocation), ["reason"]);
    const posProductsForPeriod = posSummary.topProducts[consumablePeriod].slice().sort((a,b) => b.sales-a.sales).slice(0,5).map(p => {
        const source = inventoryProducts.find(item => normalizeName(item.name) === normalizeName(p.name));
        return { key: p.key, name: p.name, secondary: source?.category || "—", count: p.units, revenue: p.sales };
    });
    const periodFinish = new Date(currentDateTime.getFullYear(), currentDateTime.getMonth(), currentDateTime.getDate()+1);
    const packagePeriodBegin = getPeriodStart(packagePeriod, currentDateTime);
    const bookingPackageTotals = new Map<string, {key:string; name:string; secondary:string; count:number; revenue:number}>();
    bookings.filter(isRealizedBooking).forEach(booking => {
        const date = parseFlexibleDate(booking.date);
        if (!date || date < packagePeriodBegin || date >= periodFinish) return;
        const name = String(booking.packageName || "").trim();
        if (!name || isCustomDashboardBooking(booking)) return;
        const key = normalizeName(name);
        const old = bookingPackageTotals.get(key) || { key, name, secondary: "Bookings", count: 0, revenue: 0 };
        old.count += 1;
        // Transaction's discounted agreed price, not sum of package inclusion prices.
        old.revenue += getDashboardBookingTotalPrice(booking);
        bookingPackageTotals.set(key, old);
    });
    const bookingPackageRows = topBookingSummary === null
        ? Array.from(bookingPackageTotals.values()).sort((a,b) => b.revenue-a.revenue).slice(0,5)
        : topBookingSummary.filter(item => item.period === packagePeriod).slice().sort((a,b)=>b.revenue-a.revenue)
            .slice(0,5).map(item => ({key:item.key,name:item.name,secondary:"Bookings",count:item.units,revenue:item.revenue}));
    const rentalPeriodBegin = getPeriodStart(rentalPeriod, currentDateTime);
    const rentalProductRows = topRentalProducts === null ? null : topRentalProducts.filter(item => {
        if (item.period) return item.period === rentalPeriod;
        const date = parseFlexibleDate(item.date);
        return Boolean(date && date >= rentalPeriodBegin && date < periodFinish);
    }).slice().sort((a,b)=>b.revenue-a.revenue).slice(0,5).map(item => ({key:item.key,name:item.name,secondary:"Rental",count:item.units,revenue:item.revenue}));

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                        <h1 className="text-[25px] font-bold tracking-[-0.02em] text-[#1A1220]">Owner Dashboard</h1>
                        <p className="mt-1 text-[12px] text-[#7A6A84]">Sales and financial overview across all branches.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{formatCurrentDashboardDateTime(currentDateTime)}</span>
                        <button type="button" disabled={isRefreshing} onClick={() => void loadOwnerDashboard()} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60">
                            <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""}/>{isRefreshing ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>
                </div>
            </header>
            <section aria-busy={!hasLoadedDashboard} className="min-h-[calc(100vh-88px)] bg-[#FFFDF8] px-6 py-5 font-sans">
                {!hasLoadedDashboard ? <OwnerDashboardSkeleton/> : (
                    <div className="mx-auto max-w-none space-y-4">
                        {loadError && <div role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-xs text-[#B42318]">{loadError}</div>}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <OwnerFinancialCard title="Total Revenue" value={peso(current.sales)} delta={deltaSales} note="Sales of products and completed bookings" icon={<BarChart3 size={24}/>} iconTone="purple" onClick={() => setSelectedKpi("revenue")}/>
                            <OwnerFinancialCard title="Cost of Sales" value={peso(current.cost)} delta={deltaCost} inverseDelta note="Products and completed bookings cost" icon={<Wallet size={24}/>} iconTone="orange" onClick={() => setSelectedKpi("cost")}/>
                            <OwnerFinancialCard title="Gross Profit" value={peso(current.profit ?? 0)} delta={deltaProfit} note="Sales minus cost of sales" icon={<TrendingUp size={24}/>} iconTone="green" onClick={() => setSelectedKpi("profit")}/>
                            <OwnerFinancialCard title="Supplier Payables" value={supplierBalance === null ? "—" : peso(supplierBalance)} note={supplierBalance === null ? "Connect supplier payment data" : supplierTotalsComplete ? "Supplier bills still unpaid" : "Some supplier bills could not be loaded"} icon={<FileText size={24}/>} iconTone="red" onClick={() => setSelectedKpi("payables")}/>
                        </div>
                        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-3">
                            <div className="min-w-0 rounded-2xl border border-[#E7DFEC] bg-white p-4 shadow-sm xl:col-span-2">
                                <OwnerPanelTitle title="Sales Performance" subtitle="Monthly realized revenue, cost of sales, and gross profit across all branches" icon={<BarChart3 size={18}/>} action={<>
                                    <select aria-label="Sales performance period" value={trendRange} onChange={e => setTrendRange(Number(e.target.value) as TrendRange)} className="h-8 rounded-lg border border-[#E6DDF0] bg-white px-2.5 text-[11px] font-semibold text-[#5F4E75]"><option value={6}>Last 6 Months</option><option value={12}>Last 12 Months</option></select>
                                    <OwnerExportButton label="Sales Performance" disabled={trendChartData.length===0} onExport={(format) => downloadOwnerReport(format, "owner_sales_performance.csv", ["Month","Total Revenue PHP","Cost of Sales PHP","Gross Profit PHP"], trendChartData.map(p => [p.label,p.sales,p.cost,p.profit]))}/>
                                </>}/>
                                <div className="mt-3"><SalesTrendChart data={trendChartData}/></div>
                                <div className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[10px] font-semibold text-[#5F4E75]">
                                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#6D35D4]"/>Total Revenue</span>
                                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#E66B20]"/>Cost of Sales</span>
                                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#159455]"/>Gross Profit</span>
                                </div>
                            </div>
                            <BranchPerformancePanel rows={branchRows} period={branchPeriod} onPeriodChange={setBranchPeriod} periodLabel={formatPeriodLabel(branchPeriod,currentDateTime)} onExport={(format) => downloadOwnerReport(format, "owner_branch_performance_"+branchPeriod+".csv", ["Branch","Revenue PHP","Period"], branchRows.slice(0,6).map(row => [row.name,row.amount,formatPeriodLabel(branchPeriod,currentDateTime)]))}/>
                        </div>
                        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 xl:h-[440px] xl:grid-cols-[minmax(0,25fr)_minmax(0,40fr)_minmax(0,35fr)]">
                            <OwnerRevenueBreakdown allocation={verifiedAllocation} period={currentMonthLabel} unavailableReason={allocationReason} onExport={(format) => {if (!verifiedAllocation) return; const total = verifiedAllocation.consumable + verifiedAllocation.rental + verifiedAllocation.unallocated; downloadOwnerReport(format, "owner_revenue_breakdown.csv", ["Product Type","Revenue PHP","Percent","Period"], [["Consumable Goods",verifiedAllocation.consumable,total>0?(100*verifiedAllocation.consumable/total).toFixed(1):0,currentMonthLabel],["Rental Goods",verifiedAllocation.rental,total>0?(100*verifiedAllocation.rental/total).toFixed(1):0,currentMonthLabel],...(verifiedAllocation.partial ? [["Unallocated bookings",verifiedAllocation.unallocated,total>0?(100*verifiedAllocation.unallocated/total).toFixed(1):0,currentMonthLabel]] : [])])}}/>
                            <OwnerSupplierPanel rows={displayedPayables} connected={combinedPayables !== null} onViewPurchase={setSelectedPurchase} onExport={(format) => downloadOwnerReport(format, "owner_supplier_payables.csv", ["Purchase ID","Product Type","Amount Due PHP","Due Date","Status"], displayedPayables.map(row => [row.purchaseNumber,row.source === "rental" ? "Rental goods" : "Consumable goods",row.balance,row.dueDate,row.status]))}/>
                            <OwnerManagerRequestsPanel rows={pendingManagerRequests?.slice(0,5) ?? []} connected={pendingManagerRequests !== null} onReview={setSelectedManagerRequest} onExport={(format) => downloadOwnerReport(format, "owner_pending_manager_leave_requests.csv", ["Manager Name","Branch","Leave Type","Date / Date Range","Status"], (pendingManagerRequests ?? []).map(row => [row.manager,row.branch,row.leaveType,row.dateLabel,row.status]))}/>
                        </div>
                        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-3">
                            <OwnerRankingPanel title="Top Consumable Products" subtitle="Best-selling POS products" icon={<Package size={19}/>} onExport={(format) => downloadOwnerReport(format, "owner_top_consumable_products_"+consumablePeriod+".csv", ["Rank","Product","Units Sold","Revenue PHP"], (posProductsForPeriod ?? []).map((row,index) => [index+1,row.name,row.count,row.revenue]))} rows={posProductsForPeriod} countLabel="Units Sold" period={consumablePeriod} onPeriodChange={setConsumablePeriod} onViewAll={() => router.push("/reports")}/>
                            <OwnerRankingPanel title="Top Booking Packages" subtitle="Best-performing packages" icon={<Gift size={19}/>} onExport={(format) => downloadOwnerReport(format, "owner_top_booking_packages_"+packagePeriod+".csv", ["Rank","Package","Bookings","Revenue PHP"], (bookingPackageRows ?? []).map((row,index) => [index+1,row.name,row.count,row.revenue]))} rows={bookingPackageRows} countLabel="Bookings" period={packagePeriod} onPeriodChange={setPackagePeriod} onViewAll={() => router.push("/reports")}/>
                            <OwnerRankingPanel title="Top Rented Products" subtitle="Most rented items" icon={<Armchair size={19}/>} onExport={(format) => downloadOwnerReport(format, "owner_top_rented_products_"+rentalPeriod+".csv", ["Rank","Product","Rentals","Revenue PHP"], (rentalProductRows ?? []).map((row,index) => [index+1,row.name,row.count,row.revenue]))} rows={rentalProductRows} countLabel="Rentals" period={rentalPeriod} onPeriodChange={setRentalPeriod} onViewAll={() => router.push("/reports")}/>
                        </div>
                    </div>
                )}
            </section>
            {selectedKpi && <OwnerKpiDetailModal detail={kpiDetails[selectedKpi]} onClose={() => setSelectedKpi(null)}/>}
            <OwnerRequestModal purchase={selectedPurchase} request={selectedManagerRequest} onClose={() => {setSelectedPurchase(null);setSelectedManagerRequest(null);}}
                               onPurchaseAtModule={() => {setSelectedPurchase(null);router.push("/inventory");}}
                               onReviewAtModule={() => {setSelectedManagerRequest(null);router.push("/branch-managers");}} />
        </>
    );
}


/* ----------------------------------------------------------------------- */
/* Presentational components                                               */
/* ----------------------------------------------------------------------- */

function SalesTrendChart({ data }: { data: { label: string; sales: number; cost: number; profit: number }[] }) {
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

    const maxRaw = Math.max(1, ...data.map((d) => d.sales), ...data.map((d) => d.cost), ...data.map((d) => d.profit));
    const step = niceStep(maxRaw / 5);
    const axisMax = step * 5;
    const ticks = [0, 1, 2, 3, 4, 5].map((i) => step * i);

    const xFor = (index: number) =>
        margin.left + (data.length > 1 ? (index / (data.length - 1)) * innerW : innerW / 2);
    const yFor = (value: number) => margin.top + innerH - (axisMax > 0 ? (value / axisMax) * innerH : 0);

    const salesPoints = data.map((d, index) => ({ x: xFor(index), y: yFor(d.sales) }));
    const costPoints = data.map((d, index) => ({ x: xFor(index), y: yFor(d.cost) }));
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
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Total sales, cost of sales, and gross profit trend chart">
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
                d={linePath(costPoints)}
                fill="none"
                stroke="#E66B20"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="5 4"
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
                <circle key={`sales-${i}`} cx={p.x} cy={p.y} r={4} fill="#6D35D4">
                    <title>{`${data[i].label} — Total Revenue: ${peso(data[i].sales)}`}</title>
                </circle>
            ))}
            {costPoints.map((p, i) => (
                <circle key={`cost-${i}`} cx={p.x} cy={p.y} r={3.5} fill="#E66B20">
                    <title>{`${data[i].label} — Cost of Sales: ${peso(data[i].cost)}`}</title>
                </circle>
            ))}
            {profitPoints.map((p, i) => (
                <circle key={`profit-${i}`} cx={p.x} cy={p.y} r={4} fill="#159455">
                    <title>{`${data[i].label} — Gross Profit: ${peso(data[i].profit)}`}</title>
                </circle>
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
                                    rows, period, onPeriodChange, periodLabel, onExport,
                                }: {
    rows: { key: string; name: string; amount: number }[];
    period: PeriodOption;
    onPeriodChange: (period: PeriodOption) => void;
    periodLabel: string;
    onExport: (format: OwnerExportFormat) => void;
}) {
    const visible = rows.slice(0, 6);
    const highestAmount = Math.max(0, ...visible.map(row => row.amount));
    const branchLabel = (name: string) =>
        String(name || "").replace(/\s+Retail\s+Branch$/i, "").trim() || name;

    return (
        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-[#E9E0EF] bg-white p-4 shadow-sm">
            <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                        <Building2 size={18}/>
                    </span>
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-[#1A1220]">Branch Performance</h3>
                        <p className="truncate text-[11px] text-[#9A8DA8]" title={`Revenue per branch for ${periodLabel}`}>
                            Total sales per branch • {periodLabel}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <select aria-label="Sales by branch period" value={period}
                            onChange={event => onPeriodChange(event.target.value as PeriodOption)}
                            className="h-8 rounded-lg border border-[#E6DDF0] bg-white px-2 text-[10px] font-semibold text-[#5F4E75] shadow-sm">
                        <option value="month">This Month</option>
                        <option value="quarter">This Quarter</option>
                        <option value="year">This Year</option>
                    </select>
                    <OwnerExportButton label="Branch Performance" onExport={onExport} disabled={rows.length === 0}/>
                </div>
            </div>
            {visible.length === 0 ? (
                <div className="flex min-h-[255px] flex-1 items-center justify-center text-center text-[12px] text-[#9A8DA8]">
                    No branch sales recorded for this period yet.
                </div>
            ) : (
                <div className="mt-5 flex min-h-[255px] flex-1 flex-col justify-center gap-4"
                     role="list" aria-label={`Revenue by branch for ${periodLabel}`}>
                    {visible.map(row => {
                        const fraction = highestAmount > 0 ? Math.max(0, row.amount) / highestAmount : 0;
                        return (
                            <div role="listitem" key={row.key} className="min-w-0" title={`${row.name}: ${peso(row.amount)}`}>
                                <div className="mb-1.5 flex min-w-0 items-baseline justify-between gap-3">
                                    <span className="min-w-0 truncate text-[11px] font-semibold text-[#443451]" title={row.name}>
                                        {branchLabel(row.name)}
                                    </span>
                                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#251532]">
                                        {pesoCompact(row.amount)}
                                    </span>
                                </div>
                                <div className="h-3 overflow-hidden rounded-full bg-[#F2EDF8]"
                                     role="meter" aria-label={`${row.name} revenue`} aria-valuemin={0}
                                     aria-valuemax={Math.max(1, highestAmount)} aria-valuenow={Math.max(0, row.amount)}>
                                    <div className="h-full rounded-full bg-gradient-to-r from-[#8D61EE] to-[#632FCE] transition-[width] duration-300"
                                         style={{width: `${Math.min(100, fraction * 100)}%`}}/>
                                </div>
                            </div>
                        );
                    })}
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

/* ----------------------------------------------------------------------- */
/* Financial owner dashboard cards — manager/staff shared visual tokens    */
/* ----------------------------------------------------------------------- */
type OwnerCsvCell = string | number | null | undefined;
type OwnerExportFormat = "pdf" | "xlsx";
type OwnerKpiKey = "revenue" | "cost" | "profit" | "payables";
type OwnerKpiDetail = {
    title: string;
    amount: number | null;
    period: string;
    formula: string;
    items: [string, number | null][];
    description: string;
};
function currentMonthLabelForKpi(value: Date) {
    return value.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
/** Export the existing loaded dataset through the same StockNBook PDF / Excel module as Staff and Manager. */
function downloadOwnerReport(format: OwnerExportFormat, filename: string, headers: string[], rows: OwnerCsvCell[][]) {
    const reportName = filename.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim();
    const table: ExportTable = {
        title: reportName,
        headers,
        rows: rows.map(row => row.map(cell => {
            const value = String(cell ?? "");
            // Protect Excel from formulas embedded in text stored in database records.
            return /^[\s]*[=+@\t\r]/.test(value) || /^[\s]*-(?![0-9]+(?:\.[0-9]+)?$)/.test(value) ? "'" + value : value;
        })),
    };
    const context: ExportContext = {
        storeName: getSavedItem("store_name") || getSavedItem("stocknbook_store_name") || "StockNBook",
        branch: "All Branches",
        dateRange: formatCurrentDashboardDateTime(new Date()),
    };
    const prefix = filename.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    void import("./_shared").then(module => {
        if (format === "pdf") module.exportTableAsPdf(table, context, prefix);
        else module.exportTableAsExcel(table, context, prefix, reportName.slice(0, 31) || "Report");
    }).catch(error => console.error(`Owner ${format.toUpperCase()} export failed:`, error));
}
function OwnerExportButton({label,onExport,disabled=false}:{label:string;onExport:(format:OwnerExportFormat)=>void;disabled?:boolean}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside);
        return () => document.removeEventListener("pointerdown", closeOutside);
    }, [open]);
    return <div ref={rootRef} className="relative z-30 shrink-0" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
        <button type="button" aria-label={`Export ${label}`} aria-haspopup="menu" aria-expanded={open}
                title={disabled ? "Verified data unavailable" : `Export ${label} as PDF or Excel`}
                disabled={disabled} onClick={() => setOpen(prev => !prev)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#6D35D4] transition hover:bg-[#F5F0FF] disabled:cursor-not-allowed disabled:opacity-40">
            <Download size={16} aria-hidden="true" />
        </button>
        {open && !disabled && <div role="menu" aria-label={`Export ${label}`} className="absolute right-0 top-full z-[80] mt-1 w-[130px] rounded-xl border border-[#E7DFEC] bg-white p-1 shadow-lg">
            <button type="button" role="menuitem" onClick={() => {setOpen(false);onExport("pdf");}} className="block w-full rounded-lg px-3 py-2 text-left text-[11px] font-semibold text-[#392648] hover:bg-[#F5F0FF]">Export PDF</button>
            <button type="button" role="menuitem" onClick={() => {setOpen(false);onExport("xlsx");}} className="block w-full rounded-lg px-3 py-2 text-left text-[11px] font-semibold text-[#392648] hover:bg-[#F5F0FF]">Export Excel</button>
        </div>}
    </div>;
}
function OwnerPanelTitle({title,subtitle,icon,action}:{title:string;subtitle:string;icon:React.ReactNode;action?:React.ReactNode}) {
    return <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#6D35D4]">{icon}</span>
            <div className="min-w-0"><h3 className="truncate text-[15px] font-bold text-[#1A1220]" title={title}>{title}</h3><p className="truncate text-[11px] text-[#86778F]" title={subtitle}>{subtitle}</p></div>
        </div>{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>;
}
function OwnerFinancialCard({title,value,delta,note,icon,iconTone,inverseDelta=false,onClick}:{title:string;value:string;delta?:number|null;note:string;icon:React.ReactNode;iconTone:"purple"|"orange"|"green"|"red";inverseDelta?:boolean;onClick:()=>void}) {
    const tones = {purple:"bg-[#F1EBFF] text-[#6D35D4]",orange:"bg-[#FFF0E5] text-[#E66B20]",green:"bg-[#E6F7EE] text-[#159455]",red:"bg-[#FDECEC] text-[#DC3545]"};
    const favorable = delta === null || delta === undefined ? null : inverseDelta ? delta <= 0 : delta >= 0;
    return <button type="button" onClick={onClick} aria-label={`View how ${title} is calculated`}
                   className="flex min-h-[136px] w-full min-w-0 items-center gap-4 rounded-2xl border border-[#E6DDF0] bg-white px-5 py-4 text-left shadow-sm transition hover:border-[#CBB8EC] hover:bg-[#FEFCFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6D35D4]">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${tones[iconTone]}`}>{icon}</span>
        <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-[#4B3E55]">{title}</span>
            <span className="mt-1.5 block break-words text-[clamp(19px,1.7vw,25px)] font-bold leading-tight tracking-[-0.02em] text-[#1A1220]">{value}</span>
            {delta !== null && delta !== undefined && <span className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${favorable ? "text-[#159455]" : "text-[#D92D20]"}`}>
                {delta >= 0 ? <TrendingUp size={13}/> : <TrendingDown size={13}/>}{delta >= 0 ? "+" : ""}{delta.toFixed(1)}% vs last month
            </span>}
            <span className="mt-1 block text-[10px] leading-4 text-[#8A7D92]">{note}</span>
        </span>
    </button>;
}
function OwnerKpiDetailModal({detail,onClose}:{detail:OwnerKpiDetail;onClose:()=>void}) {
    const amountText = (amount:number|null) => amount === null ? "Unavailable" : amount < 0 ? `−${peso(Math.abs(amount))}` : peso(amount);
    return <div role="presentation" className="fixed inset-0 z-[80] flex items-center justify-center bg-[#170B29]/55 p-4" onMouseDown={event => {if(event.target===event.currentTarget)onClose();}}>
        <div role="dialog" aria-modal="true" aria-label={`${detail.title} calculation`} className="w-full max-w-[530px] rounded-2xl border border-[#E7DFEC] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#EEE7F5] px-5 py-4">
                <div><h3 className="text-[17px] font-bold text-[#1A1220]">{detail.title} — Calculation</h3><p className="mt-1 text-[11px] text-[#86778F]">{detail.period}</p></div>
                <button type="button" aria-label="Close calculation" onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-[#766484] hover:bg-[#F6F0FC]">×</button>
            </div>
            <div className="space-y-4 px-5 py-4">
                <div className="rounded-xl bg-[#FAF7FC] p-4"><p className="text-[11px] font-semibold text-[#6D35D4]">Formula</p><p className="mt-1 text-[13px] font-semibold text-[#342140]">{detail.formula}</p></div>
                <div className="space-y-3">{detail.items.map(([name,amount])=><div key={name} className="flex items-start justify-between gap-4 text-[12px]"><span className="text-[#6C5E76]">{name}</span><strong className="text-right text-[#342140]">{amountText(amount)}</strong></div>)}</div>
                <div className="flex items-center justify-between border-t border-[#EEE7F5] pt-3 text-[13px]"><strong className="text-[#342140]">Total</strong><strong className="text-[18px] text-[#1A1220]">{amountText(detail.amount)}</strong></div>
                <p className="rounded-xl border border-[#EEE7F5] bg-[#FFFDF8] px-3 py-3 text-[11px] leading-5 text-[#75677E]">{detail.description}</p>
            </div>
            <div className="flex justify-end border-t border-[#EEE7F5] px-5 py-3"><button type="button" onClick={onClose} className="rounded-lg border border-[#E6DDF0] px-4 py-2 text-[12px] font-semibold text-[#2B174C] hover:bg-[#FAF7FE]">Close</button></div>
        </div>
    </div>;
}
function OwnerRevenueBreakdown({allocation,period,unavailableReason,onExport}:{allocation:OwnerRevenueAllocation|null;period:string;unavailableReason?:string;onExport:(format:OwnerExportFormat)=>void}) {
    const total = allocation ? allocation.consumable + allocation.rental + allocation.unallocated : 0;
    const consumableShare = total > 0 && allocation ? 100 * allocation.consumable / total : 0;
    const rentalShare = total > 0 && allocation ? 100 * allocation.rental / total : 0;
    const donutFill = total > 0
        ? `conic-gradient(#6D35D4 0% ${consumableShare}%, #F59E0B ${consumableShare}% ${consumableShare + rentalShare}%, #E6E0EE ${consumableShare + rentalShare}% 100%)`
        : "#ECE8F3";
    return <div className="flex h-full min-h-[285px] min-w-0 flex-col rounded-2xl border border-[#E7DFEC] bg-white p-4 shadow-sm">
        <OwnerPanelTitle title="Revenue Breakdown" subtitle={`Consumable vs rental • ${period}`} icon={<PieChart size={19}/>} action={<OwnerExportButton label="Revenue Breakdown" onExport={onExport} disabled={!allocation}/>}/>
        {allocation ? <div className="flex flex-1 flex-col items-center justify-center gap-3 pt-3">
            <div className="relative h-[116px] w-[116px] shrink-0 rounded-full" role="img"
                 aria-label={`Consumable ${consumableShare.toFixed(1)}%, rental ${rentalShare.toFixed(1)}%${allocation.partial ? ", not yet allocated " + (100 - consumableShare - rentalShare).toFixed(1) + "%" : ""}`}
                 style={{background:donutFill}}>
                <div className="absolute inset-[23%] flex flex-col items-center justify-center rounded-full bg-white text-center">
                    <span className="text-[14px] font-bold text-[#1A1220]">{pesoCompact(total)}</span>
                    <span className="text-[8px] text-[#86778F]">Revenue</span>
                </div>
            </div>
            <div className="w-full space-y-2 text-[10px]">
                {([
                    {label:"Consumable Goods",amount:allocation.consumable,color:"bg-[#6D35D4]"},
                    {label:"Rental Goods",amount:allocation.rental,color:"bg-[#F59E0B]"},
                    ...(allocation.partial ? [{label:"Unallocated bookings",amount:allocation.unallocated,color:"bg-[#E6E0EE]"}] : []),
                ]).map(item => <div key={item.label} className="flex items-start gap-2">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.color}`}/>
                    <div className="min-w-0 flex-1"><p className="font-semibold text-[#3F3150]">{item.label}</p>
                        <p className="text-[#86778F]">{total > 0 ? (item.amount / total * 100).toFixed(1) : "0.0"}%</p></div>
                    <strong className="break-all text-right text-[10px] text-[#1A1220]">{peso(item.amount)}</strong>
                </div>)}
            </div>
            {allocation.partial && <p className="w-full rounded-lg border border-[#EDE5F3] bg-[#FBF8FE] px-2 py-2 text-[10px] leading-4 text-[#75677E]">
                Partial allocation. {unavailableReason || "Some historical completed bookings need financial reconciliation."} Unallocated income is included in Total Revenue but is not assigned to a product type.
            </p>}
        </div> : <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
            <div className="h-[105px] w-[105px] rounded-full border-[17px] border-[#EEE9F4]" aria-hidden="true"/>
            <p className="text-[11px] font-semibold text-[#4B3E55]">Allocated revenue unavailable</p>
            <p className="text-[10px] leading-4 text-[#86778F]">{unavailableReason || "A verified split of discounted package revenue into consumable and rental goods is required."}</p>
        </div>}
    </div>;
}

function OwnerTableStatus({status}:{status:string}) {
    const normalized=status.toLowerCase();
    const cls=normalized.includes("overdue")||normalized.includes("reject")?"bg-[#FFE7EA] text-[#C52E3B]":normalized === "approved" || normalized === "paid" || normalized === "completed" ? "bg-[#E6F7EE] text-[#13884E]":"bg-[#FFF3D8] text-[#AF6E08]";
    return <span className={`inline-flex max-w-full rounded-lg px-2 py-1 text-[10px] font-semibold ${cls}`}>{status}</span>;
}
function OwnerTableEmpty({connected,empty}:{connected:boolean;empty:string}) {
    return <div className="flex min-h-[150px] items-center justify-center px-4 text-center text-[11px] text-[#86778F]">{connected?empty:"Data source not connected. Link this panel to the corresponding Owner module API."}</div>;
}
function OwnerSupplierPanel({rows,connected,onExport,onViewPurchase}:{rows:OwnerSupplierRow[];connected:boolean;onExport:(format:OwnerExportFormat)=>void;onViewPurchase:(row:OwnerSupplierRow)=>void}) {
    return <div className="flex h-[340px] min-h-0 min-w-0 flex-col overflow-visible rounded-2xl border border-[#E7DFEC] bg-white shadow-sm xl:h-full">
        <div className="px-4 pt-4"><OwnerPanelTitle title="Supplier Payables" subtitle="Upcoming and overdue supplier payments" icon={<FileText size={19}/>} action={<OwnerExportButton label="Supplier Payables" onExport={onExport} disabled={!connected || rows.length===0}/>}/></div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto overscroll-contain">
            {!connected || rows.length===0 ? <OwnerTableEmpty connected={connected} empty="No outstanding supplier payments."/> :
                <table className="w-full min-w-[365px] text-left text-[10px]">
                    <thead className="sticky top-0 z-10 bg-[#FFFCF7] uppercase text-[9px] text-[#806A8C]"><tr>
                        {["Purchase ID","Amount Due","Due Date","Status"].map(v=><th key={v} className="whitespace-nowrap px-2.5 py-2.5 font-semibold">{v}</th>)}
                    </tr></thead>
                    <tbody>{rows.map(row => <tr key={row.id} className="border-t border-[#F1ECF4] text-[#392648]">
                        <td className="whitespace-nowrap px-2.5 py-2"><button type="button" title="View purchase details" onClick={() => onViewPurchase(row)} className="font-semibold text-[#6D35D4] hover:underline focus-visible:underline">{row.purchaseNumber}</button><span className="mt-0.5 block text-[9px] text-[#8A7D92]">{row.branch || "Branch not recorded"}</span></td>
                        <td className="whitespace-nowrap px-2.5 py-2 font-semibold">{peso(row.balance)}</td>
                        <td className="whitespace-nowrap px-2.5 py-2">{ownerDisplayShortDate(row.dueDate)}</td>
                        <td className="px-2.5 py-2"><OwnerTableStatus status={row.status}/></td>
                    </tr>)}</tbody>
                </table>}
        </div>
    </div>;
}
function OwnerManagerRequestsPanel({rows,connected,onExport,onReview}:{rows:OwnerManagerRequest[];connected:boolean;onExport:(format:OwnerExportFormat)=>void;onReview:(row:OwnerManagerRequest)=>void}) {
    return <div className="flex h-[340px] min-h-0 min-w-0 flex-col overflow-visible rounded-2xl border border-[#E7DFEC] bg-white shadow-sm xl:h-full">
        <div className="px-4 pt-4"><OwnerPanelTitle title="Manager Leave Requests" subtitle="Pending branch manager requests" icon={<Users size={19}/>} action={<OwnerExportButton label="Manager Leave Requests" onExport={onExport} disabled={!connected || rows.length===0}/>}/></div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto overscroll-contain">
            {!connected || rows.length===0 ? <OwnerTableEmpty connected={connected} empty="No pending manager leave requests."/> :
                <table className="w-full min-w-[280px] text-left text-[10px]">
                    <thead className="sticky top-0 z-10 bg-[#FFFCF7] uppercase text-[9px] text-[#806A8C]"><tr>
                        {["Manager Name","Branch","Action"].map(v=><th key={v} className="whitespace-nowrap px-2.5 py-2.5 font-semibold">{v}</th>)}
                    </tr></thead>
                    <tbody>{rows.map(row => <tr key={row.id} className="border-t border-[#F1ECF4] text-[#392648]">
                        <td className="whitespace-nowrap px-2.5 py-2 font-semibold">{row.manager}</td>
                        <td className="px-2.5 py-2">{row.branch}</td>
                        <td className="px-2.5 py-2"><button type="button" onClick={() => onReview(row)} className="rounded-lg border border-[#DECEF2] bg-[#F5F0FF] px-2.5 py-1.5 text-[10px] font-semibold text-[#6D35D4] transition hover:bg-[#EEE5FF]">View</button></td>
                    </tr>)}</tbody>
                </table>}
        </div>
    </div>;
}
function OwnerRequestModal({purchase,request,onClose,onReviewAtModule,onPurchaseAtModule}:{purchase:OwnerSupplierRow|null;request:OwnerManagerRequest|null;onClose:()=>void;onReviewAtModule:()=>void;onPurchaseAtModule:()=>void}) {
    if (!purchase && !request) return null;
    return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#170B29]/55 p-4" role="presentation" onMouseDown={event => {if (event.target===event.currentTarget) onClose();}}>
        <div role="dialog" aria-modal="true" aria-label={purchase ? "Supplier purchase details" : "Manager leave request details"} className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#EEE7F5] px-5 py-4">
                <div><h3 className="text-[17px] font-bold text-[#1A1220]">{purchase ? "Purchase Details" : "Review Manager Leave"}</h3><p className="mt-0.5 text-[11px] text-[#86778F]">{purchase ? purchase.purchaseNumber : "Review using the Owner approval workflow"}</p></div>
                <button type="button" onClick={onClose} aria-label="Close details" className="rounded-lg px-2 py-1 text-xl text-[#766484] hover:bg-[#F6F0FC]">×</button>
            </div>
            <div className="space-y-4 px-5 py-4">
                {purchase ? <>
                    <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#FAF7FC] p-4 text-[12px]">
                        {[["Purchase ID",purchase.purchaseNumber],["Supplier",purchase.supplier],["Branch",purchase.branch],["Amount Due",peso(purchase.balance)],["Due Date",ownerDisplayShortDate(purchase.dueDate)],["Status",purchase.status]].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[10px] text-[#86778F]">{label}</p><p className="mt-1 break-words font-semibold text-[#342140]">{value}</p></div>)}
                    </div>
                    {purchase.items ? <div><p className="mb-2 text-[12px] font-bold text-[#342140]">Purchased Items</p><div className="max-h-44 overflow-auto rounded-lg border border-[#F1ECF4]">{purchase.items.map((item,index)=><div key={`${item.name}-${index}`} className="flex justify-between gap-3 border-b border-[#F1ECF4] px-3 py-2 text-[11px]"><span>{item.name}</span><span className="shrink-0">{item.quantity} pcs</span></div>)}</div></div> : <p className="text-[11px] text-[#86778F]">Item-level purchase details were not included in the dashboard response.</p>}
                </> : request ? <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#FAF7FC] p-4 text-[12px]">
                    {[["Manager",request.manager],["Branch",request.branch],["Leave Type",request.leaveType],["Leave Date / Range",request.dateLabel],["Status",request.status],["Reason",request.reason || "Not provided"]].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[10px] text-[#86778F]">{label}</p><p className="mt-1 break-words font-semibold text-[#342140]">{value}</p></div>)}
                </div> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#EEE7F5] px-5 py-3">
                <button type="button" onClick={onClose} className="rounded-lg border border-[#E6DDF0] px-3 py-2 text-[12px] font-semibold text-[#2B174C]">Close</button>
                <button type="button" onClick={purchase ? onPurchaseAtModule : onReviewAtModule} className="rounded-lg bg-[#2B174C] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1B0D31]">{purchase ? "Open Inventory Module" : "Review in Branch Managers"}</button>
            </div>
        </div>
    </div>;
}
type OwnerRankRow = {key:string;name:string;secondary:string;count:number;revenue:number};
function OwnerRankingPanel({title,subtitle,icon,rows,countLabel,period,onPeriodChange,onViewAll,onExport}:{title:string;subtitle:string;icon:React.ReactNode;rows:OwnerRankRow[]|null;countLabel:string;period:PeriodOption;onPeriodChange:(v:PeriodOption)=>void;onViewAll:()=>void;onExport:(format:OwnerExportFormat)=>void}) {
    return <div className="flex min-h-[250px] min-w-0 flex-col overflow-visible rounded-2xl border border-[#E7DFEC] bg-white shadow-sm">
        <div className="px-4 pt-3.5"><OwnerPanelTitle title={title} subtitle={subtitle} icon={icon} action={<><select aria-label={`${title} period`} value={period} onChange={e=>onPeriodChange(e.target.value as PeriodOption)} className="h-8 max-w-[108px] rounded-lg border border-[#E6DDF0] bg-white px-1.5 text-[10px] font-semibold text-[#5F4E75]"><option value="month">This Month</option><option value="quarter">This Quarter</option><option value="year">This Year</option></select><OwnerExportButton label={title} onExport={onExport} disabled={!rows || rows.length===0}/></>}/></div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto">{rows === null?<OwnerTableEmpty connected={false} empty=""/>:rows.length===0?<OwnerTableEmpty connected={true} empty="No revenue recorded for this period."/>:<table className="w-full text-left text-[10px]"><thead className="bg-[#FFFCF7] uppercase text-[9px] text-[#806A8C]"><tr><th className="px-3 py-2">#</th><th className="px-2 py-2">{countLabel==="Bookings"?"Package":"Product"}</th><th className="px-2 py-2 text-right">{countLabel}</th><th className="px-3 py-2 text-right">Revenue</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.key} className="border-t border-[#F1ECF4]"><td className="px-3 py-2 text-[#5A476A]">{i+1}</td><td className="max-w-[185px] px-2 py-2"><span className="block truncate font-semibold text-[#392648]" title={r.name}>{r.name}</span></td><td className="px-2 py-2 text-right">{r.count.toLocaleString("en-PH")}</td><td className="whitespace-nowrap px-3 py-2 text-right font-bold">{peso(r.revenue)}</td></tr>)}</tbody></table>}</div>
        <button type="button" onClick={onViewAll} className="border-t border-[#F1ECF4] px-4 py-2 text-right text-[10px] font-semibold text-[#6D35D4] hover:bg-[#FAF7FE]">View full report</button>
    </div>;
}
