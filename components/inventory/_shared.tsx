/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    RefreshCw,
    Search,
    Store,
    Upload,
} from "lucide-react";
import type { InventoryController } from "@/hooks/useInventory";

export type InventoryRole = "owner" | "manager" | "staff" | "";

export type ProductVariant = {
    id: number;
    productId: number;
    variantValues: Record<string, string>;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    createdAt?: string;
};

export type ProductVariantSave = {
    id?: number;
    variantValues: Record<string, string>;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
};

export type Product = {
    id: number;
    storeId?: number | null;
    branchId?: number | null;
    branchName?: string | null;
    packageId?: number | null;
    packageName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    createdAt?: string;
    hasVariants: boolean;
    variants?: ProductVariant[];
};

export type ProductSaveData = {
    storeId?: number | null;
    branchId?: number | null;
    branchName?: string | null;
    packageId?: number | null;
    packageName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    hasVariants: boolean;
    variants?: ProductVariantSave[];
};

export type Category = {
    id: number;
    categoryName: string;
    description?: string;
};

export type Branch = {
    id: number;
    branchName: string;
};

export type ApiError = {
    error?: string;
};

export type PendingProductSave =
    | {
    mode: "add";
    data: ProductSaveData;
}
    | {
    mode: "edit";
    editingId: number;
    before: Product;
    after: ProductSaveData;
};

type VariantEditorController = InventoryController & {
    variants?: ProductVariantSave[];
    addVariantRow: () => void;
    removeVariantRow: (index: number) => void;
    updateVariantValue: (index: number, key: string, value: string) => void;
    updateVariantField: (
        index: number,
        field: "stock" | "alertLevel" | "originalPrice" | "salesPrice",
        value: string
    ) => void;
};

const SELECTED_BRANCH_ID_STORAGE_KEY = "stocknbook_selected_branch_id";
const SELECTED_BRANCH_NAME_STORAGE_KEY = "stocknbook_selected_branch_name";

const STATUS_STYLE = {
    in: "bg-[#E6F6EA] text-[#226B36]",
    low: "bg-[#FFF4D8] text-[#8A5A00]",
    out: "bg-[#FFE5E5] text-[#9A2424]",
};

export const labelClass = "text-xs font-semibold text-[#5A476A]";

export const fieldClass =
    "w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]";

function money(value: number | string) {
    const amount = Number(value || 0);

    return `₱${amount.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatNumber(value: number | string) {
    return Number(value || 0).toLocaleString("en-PH");
}

export function normalizeCat(s: string) {
    return s.trim();
}

export function getApiErrorMessage(data: unknown, fallback: string): string {
    if (typeof data === "object" && data !== null && "error" in data) {
        const err = String((data as ApiError).error ?? "").trim();

        if (err.length > 0) {
            return err;
        }
    }

    return fallback;
}

export function getTokenOrAlert(): string | null {
    const token = sessionStorage.getItem("token");

    if (!token) {
        alert("❌ Missing login token. Please login again.");
        return null;
    }

    return token;
}

export async function safeParseResponse<T = unknown>(
    res: Response
): Promise<{ data: T; text: string }> {
    const text = await res.text();

    try {
        return { data: JSON.parse(text) as T, text };
    } catch {
        return {
            data: { error: text || "Non-JSON response from server" } as T,
            text,
        };
    }
}

export function normalizeProductVariant(raw: any): ProductVariant {
    const rawValues = raw.variantValues ?? raw.variant_values ?? {};
    let parsedVariantValues: Record<string, string>;

    try {
        parsedVariantValues =
            typeof rawValues === "string" ? JSON.parse(rawValues) : rawValues ?? {};
    } catch {
        parsedVariantValues = {};
    }

    return {
        id: Number(raw.id),
        productId: Number(raw.productId ?? raw.product_id),
        variantValues: parsedVariantValues,
        stock: Number(raw.stock ?? 0),
        alertLevel: Number(raw.alertLevel ?? raw.alert_level ?? 0),
        originalPrice: Number(raw.originalPrice ?? raw.original_price ?? 0),
        salesPrice: Number(raw.salesPrice ?? raw.sales_price ?? 0),
        createdAt: raw.createdAt ?? raw.created_at ?? "",
    };
}

export function normalizeProduct(raw: any): Product {
    return {
        id: Number(raw.id),
        storeId: raw.storeId ?? raw.store_id ?? null,
        branchId: raw.branchId ?? raw.branch_id ?? null,
        branchName: raw.branchName ?? raw.branch_name ?? null,
        packageId: raw.packageId ?? raw.package_id ?? null,
        packageName: raw.packageName ?? raw.package_name ?? null,
        name: raw.name || "",
        category: raw.category || "",
        stock: Number(raw.stock ?? 0),
        alertLevel: Number(raw.alertLevel ?? raw.alert_level ?? 0),
        originalPrice: Number(raw.originalPrice ?? raw.original_price ?? 0),
        salesPrice: Number(raw.salesPrice ?? raw.sales_price ?? 0),
        createdAt: raw.createdAt ?? raw.created_at ?? "",
        hasVariants: Boolean(raw.hasVariants ?? raw.has_variants ?? false),
        variants: Array.isArray(raw.variants)
            ? raw.variants.map(normalizeProductVariant)
            : [],
    };
}

export function getStatus(p: Product) {
    if (p.stock <= 0) return { label: "Out of Stock", style: STATUS_STYLE.out };
    if (p.stock <= p.alertLevel) return { label: "Low Stock", style: STATUS_STYLE.low };
    return { label: "In Stock", style: STATUS_STYLE.in };
}

export function pillClass(isSelected: boolean) {
    return [
        "rounded-full px-4 py-1.5 text-xs transition",
        isSelected
            ? "bg-[#2B174C] text-white font-bold shadow-sm"
            : "border border-[#E6DDF0] bg-white text-[#6A5D6F] font-medium hover:bg-[#F7F1FF]",
    ].join(" ");
}

function normalizeLookupText(value: unknown) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function rememberSelectedBranch(branch: Branch) {
    if (typeof window === "undefined") return;

    sessionStorage.setItem(SELECTED_BRANCH_ID_STORAGE_KEY, String(branch.id));
    sessionStorage.setItem(SELECTED_BRANCH_NAME_STORAGE_KEY, branch.branchName);
}

function PesoPriceInput({
                            value,
                            onChange,
                        }: {
    value: string | number;
    onChange: (value: string) => void;
}) {
    return (
        <div className="relative w-full">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#806A8C]">
                ₱
            </span>
            <input
                type="number"
                value={value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onChange(e.target.value)
                }
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full rounded-xl border border-[#E3D8EA] bg-white p-3 pl-8 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]"
            />
        </div>
    );
}

function VariantToggle({
                           checked,
                           onChange,
                       }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={[
                "relative inline-flex h-8 w-20 shrink-0 items-center rounded-full transition",
                checked
                    ? "border-2 border-[#2B174C] bg-[#2B174C]"
                    : "border-2 border-[#8A7A91] bg-[#FFFDF8] ring-2 ring-[#EFE8F8]",
            ].join(" ")}
        >
            <span
                className={[
                    "absolute text-[10px] font-bold uppercase tracking-wide transition",
                    checked ? "left-3 text-white" : "right-3 text-[#5A476A]",
                ].join(" ")}
            >
                {checked ? "YES" : "NO"}
            </span>

            <span
                className={[
                    "inline-block h-6 w-6 transform rounded-full shadow-sm transition",
                    checked ? "translate-x-12.5 bg-white" : "translate-x-1 bg-[#8A7A91]",
                ].join(" ")}
            />
        </button>
    );
}

export function StoreIcon() {
    return <Store size={17} className="text-[#5F4E75]" />;
}

export function PageHeader({
                               title,
                               badge,
                               role,
                               onRefresh,
                           }: {
    title: string;
    badge?: string;
    role: InventoryRole;
    onRefresh: () => void;
}) {
    const currentMonth = new Date().toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    const showBranchBadge = Boolean(badge && badge !== "By Branch");

    return (
        <div className="sticky top-0 z-20 font-sans border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
            <div className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                    <h1 className="text-[25px] font-bold text-[#1A1220]">
                        {title}
                    </h1>

                    {showBranchBadge && (
                        <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">
                            {badge}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2.5">
                    <div className="rounded-xl border border-[#E6DDF0] bg-white px-3.5 py-2.5 text-sm text-[#6A5D6F] shadow-sm">
                        {currentMonth}
                    </div>

                    <button
                        type="button"
                        onClick={onRefresh}
                        className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#5F4E75] shadow-sm hover:bg-[#F7F1FF]"
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>

                    <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#2B174C] text-xs font-semibold text-white shadow-sm">
                        {role === "owner" ? "OW" : role === "staff" ? "ST" : "MG"}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function SearchAndActions({
                                     search,
                                     setSearch,
                                     isOwner,
                                     onManageCategories,
                                     onAddProduct,
                                     onUploadFile,
                                 }: {
    search: string;
    setSearch: (value: string) => void;
    isOwner: boolean;
    onManageCategories: () => void;
    onAddProduct: () => void;
    onUploadFile: () => void;
}) {
    return (
        <div className="mb-4 flex flex-col gap-3 font-sans lg:flex-row lg:items-center">
            <div className="relative flex-1">
                <Search
                    size={15}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                />

                <input
                    placeholder={
                        isOwner
                            ? "Search product or category in selected branch..."
                            : "Search product or category"
                    }
                    value={search}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSearch(e.target.value)
                    }
                    className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 pl-10 font-sans text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                />
            </div>

            <button
                type="button"
                onClick={onUploadFile}
                className="flex items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-5 py-3 text-sm font-semibold text-[#2B174C] shadow-sm hover:bg-[#F7F1FF]"
            >
                <Upload size={15} />
                Upload File
            </button>

            <button
                type="button"
                onClick={onManageCategories}
                className="rounded-xl border border-[#E6DDF0] bg-white px-5 py-3 text-sm font-semibold text-[#2B174C] shadow-sm hover:bg-[#F7F1FF]"
            >
                Manage Categories
            </button>

            <button
                type="button"
                onClick={onAddProduct}
                className="rounded-xl bg-[#2B174C] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]"
            >
                + Add Product
            </button>
        </div>
    );
}

type StockSummaryItem = {
    stock: number;
    alertLevel: number;
    salesPrice: number;
};

function getProductStockSummaryItems(products: Product[]): StockSummaryItem[] {
    return products.flatMap((product) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const hasVariants = product.hasVariants && variants.length > 0;

        if (hasVariants) {
            return variants.map((variant) => ({
                stock: Number(variant.stock || 0),
                alertLevel: Number(variant.alertLevel || 0),
                salesPrice: Number(variant.salesPrice || 0),
            }));
        }

        return [
            {
                stock: Number(product.stock || 0),
                alertLevel: Number(product.alertLevel || 0),
                salesPrice: Number(product.salesPrice || 0),
            },
        ];
    });
}

type StockAlertStatus = "Low Stock" | "Out of Stock";

type StockAlertItem = {
    id: string;
    product: Product;
    productName: string;
    variantName: string;
    currentStock: number;
    status: StockAlertStatus;
};

function getVariantName(variant: ProductVariant) {
    const values = Object.values(variant.variantValues || {})
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    return values.length > 0 ? values.join(", ") : "—";
}

function getStockAlertItems(products: Product[]): StockAlertItem[] {
    return products.flatMap((product) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const hasVariants = product.hasVariants && variants.length > 0;

        if (hasVariants) {
            return variants
                .map((variant) => {
                    const currentStock = Number(variant.stock || 0);
                    const alertLevel = Number(variant.alertLevel || 0);

                    const status: StockAlertStatus | null =
                        currentStock <= 0
                            ? "Out of Stock"
                            : currentStock <= alertLevel
                                ? "Low Stock"
                                : null;

                    if (!status) return null;

                    return {
                        id: `${product.id}-${variant.id}`,
                        product,
                        productName: product.name,
                        variantName: getVariantName(variant),
                        currentStock,
                        status,
                    };
                })
                .filter(Boolean) as StockAlertItem[];
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
                product,
                productName: product.name,
                variantName: "—",
                currentStock,
                status,
            },
        ];
    });
}

export function StatCard({
                             label,
                             value,
                         }: {
    label: string;
    value: React.ReactNode;
}) {
    return (
        <div className="min-h-[102px] rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold text-[#2B174C]">{label}</p>

            <div className="mt-1">{value}</div>
        </div>
    );
}

export function CombinedStockCard({
                                      lowStock,
                                      outStock,
                                      onClick,
                                  }: {
    lowStock: number;
    outStock: number;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title="Click to view stock alert details"
            aria-label={`View stock alerts: ${lowStock} low stock and ${outStock} out of stock`}
            className="group min-h-[102px] rounded-[14px] border border-[#E6DDF0] bg-white p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#D9C4EE] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B174C] focus-visible:ring-offset-2"
        >
            <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold text-[#2B174C]">
                    Stock Alerts
                </p>

                <div className="flex items-center gap-1 text-[#2B174C]">
                    <span className="max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[34px] group-hover:opacity-100">
                        View
                    </span>

                    <AlertTriangle
                        size={14}
                        className="text-[#8A5A00] transition-transform duration-200 group-hover:scale-110"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[8px] border border-[#F5D56B] bg-[#FFF8D8] px-2 py-1.5 text-center">
                    <p className="whitespace-nowrap text-[9px] font-semibold leading-none text-[#8A5A00]">
                        Low Stock
                    </p>

                    <p className="mt-1 text-[16px] font-bold leading-none text-[#8A5A00]">
                        {formatNumber(lowStock)}
                    </p>
                </div>

                <div className="rounded-[8px] border border-[#F3A3A3] bg-[#FFE5E5] px-2 py-1.5 text-center">
                    <p className="whitespace-nowrap text-[9px] font-semibold leading-none text-[#9A2424]">
                        Out of Stock
                    </p>

                    <p className="mt-1 text-[16px] font-bold leading-none text-[#9A2424]">
                        {formatNumber(outStock)}
                    </p>
                </div>
            </div>
        </button>
    );
}

function StockAlertsDialog({
                               open,
                               onClose,
                               items,
                               onRestock,
                           }: {
    open: boolean;
    onClose: () => void;
    items: StockAlertItem[];
    onRestock?: (product: Product) => void;
}) {
    const [filter, setFilter] = React.useState<"all" | "low" | "out">("all");

    if (!open) return null;

    const lowCount = items.filter((item) => item.status === "Low Stock").length;
    const outCount = items.filter((item) => item.status === "Out of Stock").length;

    const filteredItems = items.filter((item) => {
        if (filter === "low") return item.status === "Low Stock";
        if (filter === "out") return item.status === "Out of Stock";
        return true;
    });

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
            <div className="w-full max-w-4xl rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFF8D8] text-[#8A5A00]">
                            <AlertTriangle size={20} />
                        </div>

                        <div>
                            <h3 className="text-[19px] font-bold text-[#1A1220]">
                                Restock Alerts
                            </h3>

                            <p className="mt-1 text-sm text-[#6A5D6F]">
                                Low stock and out of stock items that need restocking.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xl text-[#9B8AAA] hover:text-[#1A1220]"
                    >
                        ×
                    </button>
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className={[
                            "rounded-lg px-4 py-2 text-xs font-semibold",
                            filter === "all"
                                ? "bg-[#2B174C] text-white"
                                : "border border-[#E6DDF0] bg-white text-[#6A5D6F] hover:bg-[#F7F1FF]",
                        ].join(" ")}
                    >
                        All
                    </button>

                    <button
                        type="button"
                        onClick={() => setFilter("low")}
                        className={[
                            "rounded-lg px-4 py-2 text-xs font-semibold",
                            filter === "low"
                                ? "bg-[#FFF8D8] text-[#8A5A00] ring-1 ring-[#F5D56B]"
                                : "border border-[#E6DDF0] bg-white text-[#8A5A00] hover:bg-[#FFF8D8]",
                        ].join(" ")}
                    >
                        Low Stock ({formatNumber(lowCount)})
                    </button>

                    <button
                        type="button"
                        onClick={() => setFilter("out")}
                        className={[
                            "rounded-lg px-4 py-2 text-xs font-semibold",
                            filter === "out"
                                ? "bg-[#FFE5E5] text-[#9A2424] ring-1 ring-[#F3A3A3]"
                                : "border border-[#E6DDF0] bg-white text-[#9A2424] hover:bg-[#FFE5E5]",
                        ].join(" ")}
                    >
                        Out of Stock ({formatNumber(outCount)})
                    </button>
                </div>

                <div className="max-h-[420px] overflow-y-auto rounded-xl border border-[#E6DDF0]">
                    <table className="w-full table-fixed text-sm">
                        <colgroup>
                            <col className="w-[34%]" />
                            <col className="w-[30%]" />
                            <col className="w-[18%]" />
                            <col className="w-[18%]" />
                        </colgroup>

                        <thead>
                        <tr className="border-b border-[#E6DDF0] bg-[#FFFCF7]">
                            {["Product", "Variant", "Current Stock", "Action"].map((head) => (
                                <th
                                    key={head}
                                    className={`${head === "Product" ? "text-left" : "text-center"} px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]`}
                                >
                                    {head}
                                </th>
                            ))}
                        </tr>
                        </thead>

                        <tbody>
                        {filteredItems.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-3 py-8 text-center text-sm text-[#9B8AAA]"
                                >
                                    No stock alerts found.
                                </td>
                            </tr>
                        ) : (
                            filteredItems.map((item) => (
                                <tr
                                    key={item.id}
                                    className="border-b border-[#EFE7F4] last:border-0"
                                >
                                    <td className="px-3 py-3 text-left">
                                        <p className="truncate font-semibold text-[#1A1220]">
                                            {item.productName}
                                        </p>

                                        <p
                                            className={[
                                                "mt-0.5 text-[11px] font-semibold",
                                                item.status === "Out of Stock"
                                                    ? "text-[#9A2424]"
                                                    : "text-[#8A5A00]",
                                            ].join(" ")}
                                        >
                                            {item.status}
                                        </p>
                                    </td>

                                    <td className="px-3 py-3 text-center text-[#6A5D6F]">
                                        <span className="block truncate">
                                            {item.variantName}
                                        </span>
                                    </td>

                                    <td
                                        className={[
                                            "px-3 py-3 text-center font-semibold",
                                            item.status === "Out of Stock"
                                                ? "text-[#9A2424]"
                                                : "text-[#8A5A00]",
                                        ].join(" ")}
                                    >
                                        {formatNumber(item.currentStock)}
                                    </td>

                                    <td className="px-3 py-3 text-center">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onClose();
                                                onRestock?.(item.product);
                                            }}
                                            className="rounded-lg border border-[#2B174C] px-3 py-1.5 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"
                                        >
                                            Restock
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export function InventoryStats({
                                   products,
                                   onRestock,
                               }: {
    products: Product[];
    onRestock?: (product: Product) => void;
}) {
    const [showStockAlertsDialog, setShowStockAlertsDialog] = React.useState(false);

    const stockItems = getProductStockSummaryItems(products);
    const alertItems = getStockAlertItems(products);

    const totalProducts = products.length;

    const totalStock = products.reduce((sum, product) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const hasVariants = product.hasVariants && variants.length > 0;

        if (hasVariants) {
            return (
                sum +
                variants.reduce(
                    (variantSum, variant) =>
                        variantSum + Number(variant.stock || 0),
                    0
                )
            );
        }

        return sum + Number(product.stock || 0);
    }, 0);

    const lowStock = alertItems.filter(
        (item) => item.status === "Low Stock"
    ).length;

    const outStock = alertItems.filter(
        (item) => item.status === "Out of Stock"
    ).length;

    const value = stockItems.reduce(
        (sum, item) => sum + item.salesPrice * item.stock,
        0
    );

    return (
        <>
            <div className="mb-3 grid gap-3 lg:grid-cols-4">
                <StatCard
                    label="Products"
                    value={
                        <p className="truncate text-[19px] font-bold leading-tight text-[#1A1220]">
                            {formatNumber(totalProducts)}
                        </p>
                    }
                />

                <StatCard
                    label="Total Stock"
                    value={
                        <p className="truncate text-[19px] font-bold leading-tight text-[#1A1220]">
                            {formatNumber(totalStock)}
                        </p>
                    }
                />

                <CombinedStockCard
                    lowStock={lowStock}
                    outStock={outStock}
                    onClick={() => setShowStockAlertsDialog(true)}
                />

                <StatCard
                    label="Inventory Value"
                    value={
                        <p className="truncate text-[19px] font-bold leading-tight text-[#1A1220]">
                            {money(value)}
                        </p>
                    }
                />
            </div>

            <StockAlertsDialog
                open={showStockAlertsDialog}
                onClose={() => setShowStockAlertsDialog(false)}
                items={alertItems}
                onRestock={onRestock}
            />
        </>
    );
}

export function BranchListItem({
                                   branch,
                                   products,
                                   selected,
                                   onClick,
                               }: {
    branch: Branch;
    products: Product[];
    selected: boolean;
    onClick: () => void;
}) {
    React.useEffect(() => {
        if (selected) {
            rememberSelectedBranch(branch);
        }
    }, [selected, branch]);

    const stockItems = getProductStockSummaryItems(products);
    const low = stockItems.filter(
        (item) => item.stock > 0 && item.stock <= item.alertLevel
    ).length;
    const out = stockItems.filter((item) => item.stock <= 0).length;

    return (
        <button
            type="button"
            onClick={() => {
                rememberSelectedBranch(branch);
                onClick();
            }}
            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                selected
                    ? "border-[#2B174C] bg-[#F7F1FF] shadow-sm"
                    : "border-[#E6DDF0] bg-white hover:bg-[#FFFCF7]"
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[#1A1220]">
                        {branch.branchName}
                    </p>
                    <p className="mt-1 text-xs text-[#8A7A91]">
                        {products.length} product{products.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <div className="rounded-full bg-[#FFFDF8] px-2 py-1 text-[10px] font-semibold text-[#5F4E75]">
                    {products.length}
                </div>
            </div>

            <div className="mt-3 flex gap-2 text-[10px]">
                <span className="rounded-full bg-[#FFF8D8] px-2 py-1 font-semibold text-[#8A5A00]">
                    Low {low}
                </span>
                <span className="rounded-full bg-[#FFE5E5] px-2 py-1 font-semibold text-[#9A2424]">
                    Out {out}
                </span>
            </div>
        </button>
    );
}

export function CategoryPills({
                                  categories,
                                  selectedCategory,
                                  setSelectedCategory,
                              }: {
    categories: string[];
    selectedCategory: string;
    setSelectedCategory: (value: string) => void;
}) {
    return (
        <section className="rounded-2xl border border-[#E6DDF0] bg-white p-4 font-sans shadow-sm">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#1A1220]">Categories</h2>
                <span className="text-xs text-[#9B8AAA]">{categories.length} total</span>
            </div>

            <div className="-mx-1 overflow-x-auto px-1 pb-2">
                <div className="flex w-max min-w-full flex-nowrap gap-2">
                    <button
                        type="button"
                        onClick={() => setSelectedCategory("All")}
                        className={`${pillClass(selectedCategory === "All")} shrink-0 whitespace-nowrap`}
                    >
                        All
                    </button>

                    {categories.map((c: string) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => setSelectedCategory(c)}
                            className={`${pillClass(selectedCategory === c)} shrink-0 whitespace-nowrap`}
                        >
                            {c}
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
}

export function EmptyInventory({ message }: { message: string }) {
    return (
        <div className="flex min-h-55 items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7]">
            <p className="text-sm text-[#9B8AAA]">{message}</p>
        </div>
    );
}

export function ProductTable({
                                 products,
                                 isOwner,
                                 onEdit,
                                 onDelete,
                             }: {
    products: Product[];
    isOwner: boolean;
    onEdit: (p: Product) => void;
    onDelete: (p: Product) => void;
}) {
    const [expandedProductIds, setExpandedProductIds] = React.useState<Record<number, boolean>>({});

    const toggleExpanded = (productId: number) => {
        setExpandedProductIds((prev) => ({
            ...prev,
            [productId]: !prev[productId],
        }));
    };

    const getVariantStatus = (variant: ProductVariant) => {
        if (variant.stock <= 0) return { label: "Out of Stock", style: STATUS_STYLE.out };
        if (variant.stock <= variant.alertLevel) return { label: "Low Stock", style: STATUS_STYLE.low };
        return { label: "In Stock", style: STATUS_STYLE.in };
    };

    const getVariantLabel = (variant: ProductVariant) => {
        const values = Object.values(variant.variantValues || {}).filter(Boolean);
        return values.length > 0 ? values.join(", ") : "Unnamed variant";
    };

    const getVariantAlertCounts = (variants: ProductVariant[]) => {
        const lowStock = variants.filter(
            (variant) =>
                Number(variant.stock || 0) > 0 &&
                Number(variant.stock || 0) <= Number(variant.alertLevel || 0)
        ).length;

        const outStock = variants.filter(
            (variant) => Number(variant.stock || 0) <= 0
        ).length;

        return { lowStock, outStock };
    };

    const getVariantTotalStock = (variants: ProductVariant[]) => {
        return variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
    };

    const getVariantPriceRangeValues = (
        variants: ProductVariant[],
        field: "originalPrice" | "salesPrice"
    ) => {
        const prices = variants
            .map((variant) => Number(variant[field] || 0))
            .filter((price) => Number.isFinite(price));

        if (prices.length === 0) {
            return {
                lowest: 0,
                highest: 0,
                isRange: false,
            };
        }

        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);

        return {
            lowest,
            highest,
            isRange: lowest !== highest,
        };
    };

    const renderPriceRange = (
        variants: ProductVariant[],
        field: "originalPrice" | "salesPrice"
    ) => {
        const { lowest, highest, isRange } = getVariantPriceRangeValues(variants, field);

        if (!isRange) {
            return <span>{money(lowest)}</span>;
        }

        return (
            <span className="whitespace-nowrap">
                {money(lowest)} - {money(highest)}
            </span>
        );
    };

    const getVariantTotalAlert = (variants: ProductVariant[]) => {
        return variants.reduce(
            (sum, variant) => sum + Number(variant.alertLevel || 0),
            0
        );
    };

    const renderProductAlert = (product: Product) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const hasVariants = product.hasVariants && variants.length > 0;

        if (hasVariants) {
            return getVariantTotalAlert(variants);
        }

        return product.alertLevel;
    };

    const renderProductStatus = (product: Product) => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const hasVariants = product.hasVariants && variants.length > 0;

        if (!hasVariants) {
            const status = getStatus(product);

            return (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.style}`}>
                    {status.label}
                </span>
            );
        }

        const { lowStock, outStock } = getVariantAlertCounts(variants);

        if (lowStock === 0 && outStock === 0) {
            return (
                <span className="rounded-full bg-[#E6F6EA] px-2.5 py-1 text-[11px] font-semibold text-[#226B36]">
                    In Stock
                </span>
            );
        }

        return (
            <div className="flex flex-col items-center gap-1">
                {lowStock > 0 && (
                    <span className="rounded-full bg-[#FFF4D8] px-2.5 py-1 text-[11px] font-semibold text-[#8A5A00]">
                        {lowStock} low stock
                    </span>
                )}

                {outStock > 0 && (
                    <span className="rounded-full bg-[#FFE5E5] px-2.5 py-1 text-[11px] font-semibold text-[#9A2424]">
                        {outStock} out of stock
                    </span>
                )}
            </div>
        );
    };

    return (
        <div className="w-full overflow-hidden">
            <table className="w-full table-fixed text-xs sm:text-sm">
                <colgroup>
                    <col className={isOwner ? "w-[19%]" : "w-[23%]"} />
                    {isOwner ? <col className="w-[10%]" /> : null}
                    <col className={isOwner ? "w-[12%]" : "w-[15%]"} />
                    <col className="w-[9%]" />
                    <col className="w-[7%]" />
                    <col className="w-[7%]" />
                    <col className="w-[12%]" />
                    <col className="w-[13%]" />
                    <col className="w-[10%]" />
                    <col className="w-[9%]" />
                </colgroup>
                <thead>
                <tr className="border-b border-[#E6DDF0]">
                    {[
                        "Product",
                        ...(isOwner ? ["Branch"] : []),
                        "Category",
                        "Type",
                        "Stock",
                        "Alert",
                        "Cost Price",
                        "Sales Price",
                        "Status",
                        "Actions",
                    ].map((head: string) => (
                        <th
                            key={head}
                            className={`${head === "Product" ? "text-left" : "text-center"} pb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]`}
                        >
                            {head}
                        </th>
                    ))}
                </tr>
                </thead>

                <tbody>
                {products.map((p: Product) => {
                    const variants = Array.isArray(p.variants) ? p.variants : [];
                    const hasExpandableVariants = p.hasVariants && variants.length > 0;
                    const isExpanded = Boolean(expandedProductIds[p.id]);

                    return (
                        <React.Fragment key={p.id}>
                            <tr
                                onClick={
                                    hasExpandableVariants
                                        ? () => toggleExpanded(p.id)
                                        : undefined
                                }
                                className={`border-b border-[#EFE7F4] transition ${
                                    hasExpandableVariants
                                        ? "cursor-pointer hover:bg-[#FFFCF7]"
                                        : ""
                                } ${isExpanded ? "bg-[#F9F4FF]" : "bg-white"}`}
                            >
                                <td className="py-4 pr-3">
                                    <div className="flex items-start gap-2.5">
                                        {hasExpandableVariants ? (
                                            <ChevronDown
                                                size={14}
                                                className={`mt-1 shrink-0 text-[#2B174C] transition ${
                                                    isExpanded ? "rotate-180" : ""
                                                }`}
                                            />
                                        ) : (
                                            <span className="h-[14px] w-[14px] shrink-0" />
                                        )}

                                        <div>
                                            <p className="font-semibold text-[#1A1220]">
                                                {p.name}
                                            </p>

                                            {hasExpandableVariants && (
                                                <p className="mt-1 text-[11px] font-medium text-[#806A8C]">
                                                    Click to view {variants.length} variant
                                                    {variants.length !== 1 ? "s" : ""}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </td>

                                {isOwner && (
                                    <td className="py-4 text-center text-[#6A5D6F]">
                                        {p.branchName || "Unassigned"}
                                    </td>
                                )}

                                <td className="py-4 text-center text-[#6A5D6F]">
                                    {p.category}
                                </td>

                                <td className="py-4 text-center text-[#6A5D6F]">
                                    {hasExpandableVariants
                                        ? `${variants.length} variant${variants.length !== 1 ? "s" : ""}`
                                        : "Regular"}
                                </td>

                                <td className="py-4 text-center text-[#1A1220]">
                                    {hasExpandableVariants ? getVariantTotalStock(variants) : p.stock}
                                </td>

                                <td className="py-4 text-center text-[#6A5D6F]">
                                    {renderProductAlert(p)}
                                </td>

                                <td className="py-4 text-center text-[#6A5D6F]">
                                    {hasExpandableVariants
                                        ? renderPriceRange(variants, "originalPrice")
                                        : money(p.originalPrice)}
                                </td>

                                <td className="py-4 text-center text-[#1A1220]">
                                    {hasExpandableVariants
                                        ? renderPriceRange(variants, "salesPrice")
                                        : money(p.salesPrice)}
                                </td>

                                <td className="py-4 text-center">
                                    {renderProductStatus(p)}
                                </td>

                                <td className="py-4 text-center">
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onEdit(p);
                                        }}
                                        className="mr-3 text-xs font-semibold text-[#2B174C] hover:underline"
                                    >
                                        Edit
                                    </button>

                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onDelete(p);
                                        }}
                                        className="text-xs font-semibold text-red-500 hover:underline"
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>

                            {hasExpandableVariants && isExpanded && variants.map((variant: ProductVariant, index: number) => {
                                const variantStatus = getVariantStatus(variant);
                                const isFirstVariant = index === 0;
                                const isLastVariant = index === variants.length - 1;

                                return (
                                    <tr
                                        key={variant.id}
                                        className="border-b border-[#EFE7F4] bg-[#FCF9FF]"
                                    >
                                        <td className="py-3 pr-3">
                                            <div className="ml-8 flex items-center gap-3">
                                                <div className="relative flex h-9 w-5 shrink-0 justify-center">
                                                    {!isFirstVariant && (
                                                        <span className="absolute -top-3 h-6 border-l border-dashed border-[#B99DDB]" />
                                                    )}

                                                    {!isLastVariant && (
                                                        <span className="absolute top-5 h-8 border-l border-dashed border-[#B99DDB]" />
                                                    )}

                                                    <span className="relative z-10 mt-3 h-2.5 w-2.5 rounded-full bg-[#9B6BD3]" />
                                                </div>

                                                <p className="text-xs font-semibold text-[#2B174C]">
                                                    {getVariantLabel(variant)}
                                                </p>
                                            </div>
                                        </td>

                                        {isOwner && (
                                            <td className="py-3 text-center text-[#9B8AAA]" />
                                        )}

                                        <td className="py-3 text-center text-[#9B8AAA]">
                                            —
                                        </td>

                                        <td className="py-3 text-center text-[#6A5D6F]">
                                            Variant
                                        </td>

                                        <td className="py-3 text-center text-[#1A1220]">
                                            {variant.stock}
                                        </td>

                                        <td className="py-3 text-center text-[#6A5D6F]">
                                            {variant.alertLevel}
                                        </td>

                                        <td className="py-3 text-center text-[#6A5D6F]">
                                            {money(variant.originalPrice)}
                                        </td>

                                        <td className="py-3 text-center text-[#1A1220]">
                                            {money(variant.salesPrice)}
                                        </td>

                                        <td className="py-3 text-center">
                                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${variantStatus.style}`}>
                                                {variantStatus.label}
                                            </span>
                                        </td>

                                        <td className="py-3 text-center" />
                                    </tr>
                                );
                            })}
                        </React.Fragment>
                    );
                })}
                </tbody>
            </table>
        </div>
    );
}
export function ProductListSection({
                                       title,
                                       products,
                                       isOwner,
                                       emptyMessage,
                                       onEdit,
                                       onDelete,
                                   }: {
    title: string;
    products: Product[];
    isOwner: boolean;
    emptyMessage: string;
    onEdit: (p: Product) => void;
    onDelete: (p: Product) => void;
}) {
    return (
        <section className="rounded-2xl border border-[#E6DDF0] bg-white p-4 font-sans shadow-sm">
            <div className="mb-4">
                <h2 className="text-sm font-semibold text-[#1A1220]">
                    {title}
                </h2>
                <p className="text-xs text-[#9B8AAA]">
                    {products.length} item{products.length !== 1 ? "s" : ""}
                </p>
            </div>

            {products.length === 0 ? (
                <EmptyInventory message={emptyMessage} />
            ) : (
                <ProductTable
                    products={products}
                    isOwner={isOwner}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            )}
        </section>
    );
}

export function BranchInventoryView({
                                        inv,
                                        title,
                                    }: {
    inv: InventoryController;
    title: string;
}) {
    const branches = Array.isArray((inv as any).branches)
        ? ((inv as any).branches as Branch[])
        : [];

    const selectedBranch =
        (inv as any).selectedBranch ??
        branches.find(
            (branch) =>
                branch.id === Number((inv as any).selectedBranchId) ||
                branch.id === Number((inv as any).branchId) ||
                branch.id === Number((inv as any).assignedBranchId) ||
                branch.id === Number((inv as any).productBranchId) ||
                normalizeLookupText(branch.branchName) === normalizeLookupText(title)
        );

    React.useEffect(() => {
        if (selectedBranch) {
            rememberSelectedBranch(selectedBranch);
        }
    }, [selectedBranch]);

    return (
        <div className="space-y-4 font-sans">
            <InventoryStats
                products={inv.baseProducts}
                onRestock={inv.handleEditProduct}
            />

            <SearchAndActions
                search={inv.search}
                setSearch={inv.setSearch}
                isOwner={false}
                onManageCategories={inv.openManageCategories}
                onAddProduct={inv.openAddProduct}
                onUploadFile={inv.openImportDialog}
            />

            <CategoryPills
                categories={inv.categories}
                selectedCategory={inv.selectedCategory}
                setSelectedCategory={inv.setSelectedCategory}
            />

            <ProductListSection
                title={title}
                products={inv.filteredProducts}
                isOwner={false}
                emptyMessage="No products found."
                onEdit={inv.handleEditProduct}
                onDelete={inv.requestDeleteProduct}
            />
        </div>
    );
}


type SuccessToastMessage = {
    title: string;
    message: string;
};

type ProductSuccessAction = "add" | "update";

function SuccessToast({
                          toast,
                          onClose,
                      }: {
    toast: SuccessToastMessage | null;
    onClose: () => void;
}) {
    const [isFadingOut, setIsFadingOut] = React.useState(false);

    React.useEffect(() => {
        if (!toast) {
            setIsFadingOut(false);
            return;
        }

        setIsFadingOut(false);

        const fadeTimer = window.setTimeout(() => {
            setIsFadingOut(true);
        }, 5000);

        const closeTimer = window.setTimeout(() => {
            onClose();
        }, 5600);

        return () => {
            window.clearTimeout(fadeTimer);
            window.clearTimeout(closeTimer);
        };
    }, [toast, onClose]);

    if (!toast) {
        return null;
    }

    return (
        <div
            role="status"
            aria-live="polite"
            className={[
                "fixed bottom-5 right-5 z-[140] flex w-[min(360px,calc(100vw-2.5rem))] items-start gap-3 rounded-2xl border border-[#BCE8CA] bg-white p-4 shadow-[0_18px_42px_rgba(43,23,76,0.22)] transition-all duration-700 ease-out",
                isFadingOut
                    ? "translate-y-3 opacity-0"
                    : "translate-y-0 opacity-100",
            ].join(" ")}
        >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E5F8EC] text-[#23834A]">
                <CheckCircle2 size={20} strokeWidth={2.4} />
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#1A1220]">{toast.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-[#6A5D6F]">{toast.message}</p>
            </div>

            <button
                type="button"
                onClick={onClose}
                aria-label="Dismiss notification"
                className="shrink-0 text-lg leading-none text-[#9B8AAA] transition hover:text-[#2B174C]"
            >
                ×
            </button>
        </div>
    );
}


export function InventoryDialogs({ inv }: { inv: InventoryController }) {
    const [pendingProductSuccess, setPendingProductSuccess] = React.useState<{
        action: ProductSuccessAction;
        name: string;
    } | null>(null);
    const [pendingDeletedProductName, setPendingDeletedProductName] =
        React.useState("");
    const [productToast, setProductToast] =
        React.useState<SuccessToastMessage | null>(null);

    const closeProductToast = React.useCallback(() => {
        setProductToast(null);
    }, []);

    const closeConfirmProductSaveDialog = React.useCallback(() => {
        setPendingProductSuccess(null);
        inv.closeConfirmProductSaveDialog();
    }, [inv]);

    const confirmSaveProduct = React.useCallback(async () => {
        const pendingSave = inv.pendingProductSave;

        if (!pendingSave) {
            return;
        }

        const productName = (
            pendingSave.mode === "edit"
                ? pendingSave.after.name
                : pendingSave.data.name
        ).trim();

        setPendingProductSuccess({
            action: pendingSave.mode === "edit" ? "update" : "add",
            name: productName,
        });

        await inv.confirmSaveProduct();
    }, [inv]);

    const confirmDeleteProduct = React.useCallback(async () => {
        const productName = inv.productToDelete?.name.trim() || "";

        if (!productName) {
            return;
        }

        setPendingDeletedProductName(productName);
        await inv.confirmDeleteProduct();
    }, [inv]);

    React.useEffect(() => {
        if (!pendingProductSuccess || inv.showConfirmProductSaveDialog) {
            return;
        }

        const isUpdate = pendingProductSuccess.action === "update";

        setProductToast({
            title: isUpdate
                ? "Product updated successfully"
                : "Product added successfully",
            message: isUpdate
                ? `“${pendingProductSuccess.name}” was updated in inventory.`
                : `“${pendingProductSuccess.name}” was added to inventory.`,
        });
        setPendingProductSuccess(null);
    }, [inv.showConfirmProductSaveDialog, pendingProductSuccess]);

    React.useEffect(() => {
        if (
            !pendingDeletedProductName ||
            inv.showDeleteProductDialog ||
            inv.productToDelete
        ) {
            return;
        }

        setProductToast({
            title: "Product deleted successfully",
            message: `“${pendingDeletedProductName}” was removed from inventory.`,
        });
        setPendingDeletedProductName("");
    }, [
        inv.productToDelete,
        inv.showDeleteProductDialog,
        pendingDeletedProductName,
    ]);

    const productSaveTitle =
        inv.pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";
    const productSaveButton =
        inv.pendingProductSave?.mode === "edit" ? "Update Product" : "Add Product";

    return (
        <>
            <SuccessToast toast={productToast} onClose={closeProductToast} />
            {inv.showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div
                        className={[
                            "w-full rounded-2xl bg-white p-5 shadow-xl sm:p-6",
                            inv.formMode === "category"
                                ? "h-140 max-h-[88vh] max-w-5xl overflow-hidden"
                                : "max-h-[90vh] max-w-5xl overflow-y-auto",
                        ].join(" ")}
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-[18px] font-bold text-[#1A1220]">
                                {inv.formMode === "category"
                                    ? "Manage Categories"
                                    : inv.editingId
                                        ? "Edit Product"
                                        : "Add Product"}
                            </h2>
                            <button
                                type="button"
                                onClick={() => inv.setShowForm(false)}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <form
                            onSubmit={(e) => {
                                if (inv.formMode === "product") inv.handleSubmitProduct(e);
                                else e.preventDefault();
                            }}
                            className={
                                inv.formMode === "category"
                                    ? "h-[calc(100%-44px)]"
                                    : "space-y-3"
                            }
                        >
                            {inv.formMode === "category" ? (
                                <CategoryForm inv={inv} />
                            ) : (
                                <ProductForm inv={inv} />
                            )}
                        </form>
                    </div>
                </div>
            )}

            {inv.showConfirmProductSaveDialog && inv.pendingProductSave && (
                <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <div className="mb-3 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-[19px] font-bold text-[#1A1220]">
                                    {productSaveTitle}
                                </h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">
                                    Are you sure you want to save this product?
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeConfirmProductSaveDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeConfirmProductSaveDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmSaveProduct()}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                {productSaveButton}
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {inv.showImportDialog && (
                <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-[19px] font-bold text-[#1A1220]">
                                    Upload Inventory File
                                </h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">
                                    Select an Excel or CSV file. Products will not be added yet.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={inv.closeImportDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                inv.setSelectedImportFile(e.target.files?.[0] || null)
                            }
                            className="w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] file:mr-4 file:rounded-lg file:border-0 file:bg-[#2B174C] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                        />

                        {inv.selectedImportFile && (
                            <p className="mt-2 text-xs text-[#6A5D6F]">
                                Selected:{" "}
                                <span className="font-semibold text-[#1A1220]">
                                    {inv.selectedImportFile.name}
                                </span>
                            </p>
                        )}

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={inv.closeImportDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                disabled={inv.isImporting || !inv.selectedImportFile}
                                onClick={() => void inv.importProductsFromExcel()}
                                className="rounded-xl bg-[#2B174C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {inv.isImporting ? "Reading..." : "Preview Import"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {inv.showImportConfirmDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-[19px] font-bold text-[#1A1220]">
                                    Confirm Imported Products
                                </h3>
                                <p className="mt-1 text-sm text-[#6A5D6F]">
                                    Review the products below before adding them to the system.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={inv.closeImportDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-[#E6DDF0]">
                            <table className="w-full min-w-245 text-sm">
                                <thead>
                                <tr className="border-b border-[#E6DDF0] bg-[#FFFCF7]">
                                    {[
                                        "Product",
                                        "Category",
                                        "Stock",
                                        "Alert",
                                        "Original",
                                        "Sales",
                                        "Type",
                                    ].map((head) => (
                                        <th
                                            key={head}
                                            className={`${head === "Product" ? "text-left" : "text-center"} px-1 pb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]`}                                        >
                                            {head}
                                        </th>
                                    ))}
                                </tr>
                                </thead>

                                <tbody>
                                {inv.importPreviewProducts.map((product) => {
                                    const variants = product.variants || [];

                                    return (
                                        <React.Fragment key={product.tempId}>
                                            <tr className="border-b border-[#EFE7F4]">
                                                <td className="px-3 py-4">
                                                    <p className="text-sm font-semibold text-[#1A1220]">
                                                        {product.name || "Unnamed Product"}
                                                    </p>
                                                    {product.hasVariants && (
                                                        <p className="mt-1 text-xs font-medium text-[#806A8C]">
                                                            {variants.length} variant{variants.length !== 1 ? "s" : ""}
                                                        </p>
                                                    )}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#6A5D6F]">
                                                    {product.category || "Uncategorized"}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#1A1220]">
                                                    {Number(product.stock || 0)}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#6A5D6F]">
                                                    {Number(product.alertLevel || 0)}
                                                </td>

                                                <td className="px-3 py-4 text-center text-[#6A5D6F]">
                                                    {money(Number(product.originalPrice || 0))}
                                                </td>

                                                <td className="px-3 py-4 text-center font-semibold text-[#1A1220]">
                                                    {money(Number(product.salesPrice || 0))}
                                                </td>

                                                <td className="px-3 py-4 text-center">
                                                    <span className="rounded-full bg-[#F7F1FF] px-3 py-1 text-xs font-semibold text-[#4E2C66]">
                                                        {product.hasVariants ? "With Variants" : "Regular"}
                                                    </span>
                                                </td>
                                            </tr>

                                            {product.hasVariants && variants.map((variant, variantIndex) => {
                                                const variantName = Object.values(variant.variantValues || {})
                                                    .filter(Boolean)
                                                    .join(" / ") || `Variant ${variantIndex + 1}`;

                                                return (
                                                    <tr
                                                        key={`${product.tempId}-variant-${variantIndex}`}
                                                        className="border-b border-[#EFE7F4] bg-[#FFFCF7] last:border-0"
                                                    >
                                                        <td className="px-3 py-3">
                                                            <div className="ml-6 rounded-xl bg-white px-3 py-2 ring-1 ring-[#E6DDF0]">
                                                                <p className="text-sm font-semibold text-[#2B174C]">
                                                                    {variantName}
                                                                </p>
                                                            </div>
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#9B8AAA]">
                                                            Variant
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#1A1220]">
                                                            {Number(variant.stock || 0)}
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#6A5D6F]">
                                                            {Number(variant.alertLevel || 0)}
                                                        </td>

                                                        <td className="px-3 py-3 text-center text-[#6A5D6F]">
                                                            {money(Number(variant.originalPrice || 0))}
                                                        </td>

                                                        <td className="px-3 py-3 text-center font-semibold text-[#1A1220]">
                                                            {money(Number(variant.salesPrice || 0))}
                                                        </td>

                                                        <td className="px-3 py-3 text-center">
                                                            <span className="rounded-full bg-[#F7F1FF] px-3 py-1 text-xs font-semibold text-[#4E2C66]">
                                                                Variant
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    inv.setShowImportConfirmDialog(false);
                                    inv.setShowImportDialog(true);
                                }}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Back
                            </button>

                            <button
                                type="button"
                                onClick={inv.closeImportDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                disabled={inv.isImporting || inv.importPreviewProducts.length === 0}
                                onClick={() => void inv.confirmImportProducts()}
                                className="rounded-xl bg-[#2B174C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {inv.isImporting ? "Importing..." : "Confirm Import"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {inv.showDeleteProductDialog && inv.productToDelete && (
                <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Delete Product
                        </h3>
                        <p className="mt-1 text-sm text-[#6A5D6F]">
                            Are you sure you want to delete{" "}
                            <span className="font-semibold">
                                {inv.productToDelete.name}
                            </span>
                            ?
                        </p>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={inv.closeDeleteProductDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmDeleteProduct()}
                                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                            >
                                Delete Product
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function CategoryForm({ inv }: { inv: InventoryController }) {
    const [showAddCategoryDialog, setShowAddCategoryDialog] = React.useState(false);
    const [categoryToAdd, setCategoryToAdd] = React.useState("");
    const [pendingAddedCategoryName, setPendingAddedCategoryName] =
        React.useState("");
    const [categoryToast, setCategoryToast] =
        React.useState<SuccessToastMessage | null>(null);

    const closeCategoryToast = React.useCallback(() => {
        setCategoryToast(null);
    }, []);

    React.useEffect(() => {
        if (!pendingAddedCategoryName) {
            return;
        }

        const categoryWasSaved = inv.categories.some(
            (category) =>
                normalizeLookupText(category) ===
                normalizeLookupText(pendingAddedCategoryName)
        );

        if (categoryWasSaved && !inv.category.trim()) {
            setCategoryToast({
                title: "Category added successfully",
                message: `“${pendingAddedCategoryName}” is now available for inventory products.`,
            });
            setPendingAddedCategoryName("");
        }
    }, [inv.categories, inv.category, pendingAddedCategoryName]);

    const [showEditCategoryDialog, setShowEditCategoryDialog] =
        React.useState(false);
    const [showConfirmEditCategoryDialog, setShowConfirmEditCategoryDialog] =
        React.useState(false);

    const [showDeleteCategoryDialog, setShowDeleteCategoryDialog] =
        React.useState(false);
    const [showCannotDeleteCategoryDialog, setShowCannotDeleteCategoryDialog] =
        React.useState(false);

    const [categoryToEdit, setCategoryToEdit] = React.useState("");
    const [editCategoryDraft, setEditCategoryDraft] = React.useState("");

    const [categoryToDelete, setCategoryToDelete] = React.useState("");

    const openEditCategoryDialog = (category: string) => {
        setCategoryToEdit(category);
        setEditCategoryDraft(category);
        setShowEditCategoryDialog(true);
        setShowConfirmEditCategoryDialog(false);
    };

    const closeEditCategoryDialog = () => {
        setShowEditCategoryDialog(false);
        setShowConfirmEditCategoryDialog(false);
        setCategoryToEdit("");
        setEditCategoryDraft("");
    };

    const openConfirmEditCategoryDialog = () => {
        const cleanValue = editCategoryDraft.trim();

        if (!cleanValue) {
            alert("❌ Please enter a category name.");
            return;
        }

        if (cleanValue === categoryToEdit) {
            alert("No changes made.");
            return;
        }

        setShowEditCategoryDialog(false);
        setShowConfirmEditCategoryDialog(true);
    };

    const confirmEditCategory = async () => {
        await inv.updateCategoryNow(categoryToEdit, editCategoryDraft.trim());
        closeEditCategoryDialog();
    };

    const openAddCategoryDialog = () => {
        const cleanValue = inv.category.trim();

        if (!cleanValue) {
            alert("❌ Please enter a category name.");
            return;
        }

        setCategoryToAdd(cleanValue);
        setShowAddCategoryDialog(true);
    };

    const closeAddCategoryDialog = () => {
        setShowAddCategoryDialog(false);
        setCategoryToAdd("");
    };

    const confirmAddCategory = async () => {
        if (!categoryToAdd) return;

        setPendingAddedCategoryName(categoryToAdd);
        await inv.addCategoryNow(categoryToAdd);
        closeAddCategoryDialog();
    };

    const openDeleteCategoryDialog = (category: string) => {
        const hasProducts = inv.products.some((product) => product.category === category);

        setCategoryToDelete(category);

        if (hasProducts) {
            setShowCannotDeleteCategoryDialog(true);
            return;
        }

        setShowDeleteCategoryDialog(true);
    };

    const closeDeleteCategoryDialog = () => {
        setShowDeleteCategoryDialog(false);
        setShowCannotDeleteCategoryDialog(false);
        setCategoryToDelete("");
    };

    const confirmDeleteCategory = async () => {
        if (!categoryToDelete) return;

        await inv.deleteCategoryNow(categoryToDelete);
        closeDeleteCategoryDialog();
    };

    return (
        <>
            <SuccessToast toast={categoryToast} onClose={closeCategoryToast} />

            {showAddCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Add Category
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            Are you sure you want to add{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToAdd}
                            </span>
                            ?
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeAddCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void confirmAddCategory()}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Add Category
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                <div className="flex h-full min-h-0 flex-col rounded-2xl border border-[#E6DDF0] bg-[#FFFCF7] p-4">
                    <div>
                        <p className="text-sm font-semibold text-[#1A1220]">
                            Add New Category
                        </p>
                        <p className="mt-1 text-xs text-[#9B8AAA]">
                            Type a category name, then click Add.
                        </p>
                    </div>

                    <div className="mt-5 space-y-1">
                        <label className={labelClass}>Category Name</label>
                        <input
                            value={inv.category}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                inv.setCategory(e.target.value)
                            }
                            placeholder="Type to search or add new..."
                            className={fieldClass}
                        />
                    </div>

                    <button
                        type="button"
                        onClick={openAddCategoryDialog}
                        className="mt-3 w-full rounded-xl bg-[#2B174C] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                    >
                        Add Category
                    </button>
                </div>

                <div className="flex h-full min-h-0 flex-col rounded-2xl border border-[#E6DDF0] bg-white p-4">
                    <div className="mb-3 shrink-0">
                        <p className="text-sm font-semibold text-[#1A1220]">
                            Existing Categories
                        </p>
                        <p className="text-xs text-[#9B8AAA]">
                            {inv.filteredCategoriesForManage.length} shown
                        </p>
                    </div>

                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
                        {inv.filteredCategoriesForManage.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7] p-4 text-sm text-[#9B8AAA]">
                                No matching categories.
                            </p>
                        ) : (
                            inv.filteredCategoriesForManage.map((c: string) => (
                                <CategoryRow
                                    key={c}
                                    category={c}
                                    onEdit={() => openEditCategoryDialog(c)}
                                    onDelete={() => openDeleteCategoryDialog(c)}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {showEditCategoryDialog && (
                <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-[18px] font-bold text-[#1A1220]">
                                    Edit Category
                                </h3>
                                <p className="mt-1 text-xs text-[#8A7A91]">
                                    Change the category name below.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={closeEditCategoryDialog}
                                className="text-[#9B8AAA] hover:text-[#1A1220]"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-1">
                            <label className={labelClass}>Category Name</label>
                            <input
                                value={editCategoryDraft}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setEditCategoryDraft(e.target.value)
                                }
                                className={fieldClass}
                                autoFocus
                            />
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeEditCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={openConfirmEditCategoryDialog}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showConfirmEditCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Confirm Category Update
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            Are you sure you want to change{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToEdit}
                            </span>{" "}
                            to{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {editCategoryDraft.trim()}
                            </span>
                            ?
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowConfirmEditCategoryDialog(false);
                                    setShowEditCategoryDialog(true);
                                }}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Back
                            </button>

                            <button
                                type="button"
                                onClick={closeEditCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void confirmEditCategory()}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCannotDeleteCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Cannot Delete Category
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            You cannot delete{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToDelete}
                            </span>{" "}
                            because there are products using this category.
                        </p>

                        <p className="mt-2 text-xs text-[#9B8AAA]">
                            Move or edit those products to another category first, then try
                            deleting again.
                        </p>

                        <div className="mt-5 flex justify-end">
                            <button
                                type="button"
                                onClick={closeDeleteCategoryDialog}
                                className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Okay
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteCategoryDialog && (
                <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <h3 className="text-[18px] font-bold text-[#1A1220]">
                            Delete Category
                        </h3>

                        <p className="mt-2 text-sm text-[#6A5D6F]">
                            Are you sure you want to delete{" "}
                            <span className="font-semibold text-[#1A1220]">
                                {categoryToDelete}
                            </span>
                            ?
                        </p>

                        <p className="mt-2 text-xs text-[#9B8AAA]">
                            This action cannot be undone.
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeDeleteCategoryDialog}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void confirmDeleteCategory()}
                                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                            >
                                Delete Category
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function CategoryRow({
                         category,
                         onEdit,
                         onDelete,
                     }: {
    category: string;
    onEdit: () => void;
    onDelete: () => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-xl bg-[#F8F2EA] p-2 text-[#1A1220]">
            <span className="text-sm font-medium">{category}</span>

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onEdit}
                    className="text-xs font-semibold text-[#2B174C] hover:underline"
                >
                    Edit
                </button>

                <button
                    type="button"
                    onClick={onDelete}
                    className="text-xs font-semibold text-red-500 hover:underline"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

function ProductForm({ inv }: { inv: InventoryController }) {
    return (
        <>
            {inv.isOwner && (
                <div className="space-y-1">
                    <label className={labelClass}>Branch</label>
                    <select
                        value={inv.productBranchId}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                            inv.setProductBranchId(e.target.value)
                        }
                        className={fieldClass}
                    >
                        <option value="">Select branch</option>
                        {inv.branches.map((b: Branch) => (
                            <option key={b.id} value={b.id}>
                                {b.branchName}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {inv.isBranchUser && (
                <div className="rounded-xl bg-[#F7F1FF] px-3 py-2 text-xs font-medium text-[#4E2C66]">
                    Branch: {inv.assignedBranchName || "Assigned Branch"}
                </div>
            )}

            <div className="space-y-1">
                <label className={labelClass}>Product Name</label>
                <input
                    value={inv.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        inv.setName(e.target.value)
                    }
                    className={fieldClass}
                />
            </div>

            <div className="space-y-1">
                <label className={labelClass}>Category</label>
                <select
                    value={inv.category}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                        inv.setCategory(e.target.value)
                    }
                    className={fieldClass}
                >
                    <option value="">Select category</option>
                    {inv.categories.map((c: string) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </select>
            </div>

            <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-[#1A1220]">
                            Product Variants
                        </p>
                        <p className="mt-0.5 text-xs text-[#9B8AAA]">
                            Enable if product has different variations like color, size,
                            packaging, etc.
                        </p>
                    </div>

                    {inv.hasVariants && (
                        <span className="rounded-full bg-[#2B174C] px-3 py-1 text-[11px] font-semibold text-white">
                            Enabled
                        </span>
                    )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-[#2B174C]">
                        Product has variants
                    </span>

                    <VariantToggle checked={inv.hasVariants} onChange={inv.setHasVariants} />
                </div>
            </div>

            {inv.hasVariants ? (
                <VariantEditor inv={inv as VariantEditorController} />
            ) : (
                <SimpleProductFields inv={inv} />
            )}

            <button
                type="submit"
                className="w-full rounded-xl bg-[#2B174C] py-3 text-sm font-semibold text-white transition hover:bg-[#1B0D31]"
            >
                Save Product
            </button>
        </>
    );
}

function SimpleProductFields({ inv }: { inv: InventoryController }) {
    return (
        <>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className={labelClass}>Stock</label>
                    <input
                        type="number"
                        value={inv.stock}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            inv.setStock(e.target.value)
                        }
                        className={fieldClass}
                    />
                </div>

                <div className="space-y-1">
                    <label className={labelClass}>Alert Level</label>
                    <input
                        type="number"
                        value={inv.alertLevel}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            inv.setAlertLevel(e.target.value)
                        }
                        className={fieldClass}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className={labelClass}>Original Price</label>
                    <PesoPriceInput
                        value={inv.originalPrice}
                        onChange={(value) => inv.setOriginalPrice(value)}
                    />
                </div>

                <div className="space-y-1">
                    <label className={labelClass}>Sales Price</label>
                    <PesoPriceInput
                        value={inv.salesPrice}
                        onChange={(value) => inv.setSalesPrice(value)}
                    />
                </div>
            </div>
        </>
    );
}

function VariantEditor({ inv }: { inv: VariantEditorController }) {
    const [variantColumnInput, setVariantColumnInput] = React.useState("");
    const [variantColumns, setVariantColumns] = React.useState<string[]>([]);
    const hasAddedInitialRow = React.useRef(false);
    const lastEditorKey = React.useRef<string | null>(null);

    const variants = React.useMemo<ProductVariantSave[]>(() => {
        return Array.isArray(inv.variants) ? inv.variants : [];
    }, [inv.variants]);

    const getColumnsFromVariants = React.useCallback(
        (rows: ProductVariantSave[]) => {
            const columns: string[] = [];

            rows.forEach((variant) => {
                Object.entries(variant.variantValues || {}).forEach(([key, value]) => {
                    const cleanKey = String(key || "").trim();
                    const cleanValue = String(value || "").trim();

                    if (!cleanKey || !cleanValue) return;

                    const alreadyExists = columns.some(
                        (column) => column.toLowerCase() === cleanKey.toLowerCase()
                    );

                    if (!alreadyExists) {
                        columns.push(cleanKey.toLowerCase());
                    }
                });
            });

            return columns;
        },
        []
    );

    const getVariantInputValue = (
        values: Record<string, string> | undefined,
        column: string
    ) => {
        if (!values) return "";

        const directValue = values[column];

        if (directValue !== undefined && directValue !== null) {
            return String(directValue);
        }

        const matchedKey = Object.keys(values).find(
            (key) => key.toLowerCase() === column.toLowerCase()
        );

        return matchedKey ? String(values[matchedKey] || "") : "";
    };

    const variantKeySignature = React.useMemo(
        () =>
            variants
                .map((variant) =>
                    Object.keys(variant.variantValues || {})
                        .map((key) => String(key || "").trim().toLowerCase())
                        .filter(Boolean)
                        .sort((a, b) => a.localeCompare(b))
                        .join("|")
                )
                .join("||"),
        [variants]
    );

    React.useEffect(() => {
        const editorKey = `${inv.editingId ?? "new"}-${
            inv.hasVariants ? "variants" : "simple"
        }`;

        if (lastEditorKey.current !== editorKey) {
            lastEditorKey.current = editorKey;
            hasAddedInitialRow.current = variants.length > 0;

            const inferredColumns = getColumnsFromVariants(variants);
            setVariantColumns(inferredColumns);
            return;
        }

        if (variants.length > 0) {
            const inferredColumns = getColumnsFromVariants(variants);

            if (inferredColumns.length === 0) return;

            setVariantColumns((prev) => {
                const merged = [...prev];

                inferredColumns.forEach((column) => {
                    const alreadyExists = merged.some(
                        (item) => item.toLowerCase() === column.toLowerCase()
                    );

                    if (!alreadyExists) {
                        merged.push(column);
                    }
                });

                return merged;
            });
        }
    }, [
        getColumnsFromVariants,
        inv.editingId,
        inv.hasVariants,
        variantKeySignature,
        variants,
        variants.length,
    ]);

    React.useEffect(() => {
        if (!hasAddedInitialRow.current && variants.length === 0) {
            hasAddedInitialRow.current = true;
            inv.addVariantRow();
        }
    }, [inv, variants.length]);

    const addVariantColumn = () => {
        const nextColumn = variantColumnInput.trim();

        if (!nextColumn) return;

        const normalizedNextColumn = nextColumn.toLowerCase();

        const alreadyExists = variantColumns.some(
            (col) => col.toLowerCase() === normalizedNextColumn
        );

        if (alreadyExists) {
            setVariantColumnInput("");
            return;
        }

        setVariantColumns((prev) => [...prev, normalizedNextColumn]);
        setVariantColumnInput("");
    };

    const removeVariantColumn = (columnToRemove: string) => {
        setVariantColumns((prev) =>
            prev.filter(
                (col) => col.toLowerCase() !== columnToRemove.toLowerCase()
            )
        );

        variants.forEach((_variant, index) => {
            inv.updateVariantValue(index, columnToRemove, "");
        });
    };

    return (
        <div className="rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-sm">
            <div>
                <p className="text-sm font-semibold text-[#1A1220]">
                    Variant Matrix
                </p>
                <p className="text-xs text-[#9B8AAA]">
                    Add columns like Color, Size, Packaging, etc.
                </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px]">
                <input
                    value={variantColumnInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setVariantColumnInput(e.target.value)
                    }
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            addVariantColumn();
                        }
                    }}
                    className={fieldClass}
                    placeholder="Variant column name"
                />

                <button
                    type="button"
                    onClick={addVariantColumn}
                    className="rounded-xl bg-[#2B174C] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                >
                    Add Column
                </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
                <div className="min-w-0 flex-1 overflow-x-auto">
                    <div className="flex w-max gap-2 pb-1">
                        {variantColumns.length === 0 ? (
                            <p className="text-xs font-semibold text-red-500">
                                No variant column yet. Add something like color, size, or packaging.
                            </p>
                        ) : (
                            variantColumns.map((col: string) => (
                                <div
                                    key={col}
                                    className="flex shrink-0 items-center gap-2 rounded-full bg-[#F7F1FF] px-4 py-2 text-xs font-semibold text-[#2B174C]"
                                >
                                    <span>{col}</span>

                                    <button
                                        type="button"
                                        onClick={() => removeVariantColumn(col)}
                                        className="flex h-4 w-4 items-center justify-center rounded-full text-[12px] font-bold text-[#2B174C] hover:bg-[#E6DDF0]"
                                        aria-label={`Remove ${col} column`}
                                        title={`Remove ${col}`}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => inv.addVariantRow()}
                    className="shrink-0 rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"
                >
                    + Add Variant
                </button>
            </div>

            <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-225 text-sm">
                    <thead>
                    <tr className="border-b border-[#E6DDF0]">
                        {variantColumns.map((col: string) => (
                            <th
                                key={col}
                                className="pb-2 pr-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]"
                            >
                                {col}
                            </th>
                        ))}

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Stocks
                        </th>

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Alert
                        </th>

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Original Price
                        </th>

                        <th className="pb-2 pr-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Sales Price
                        </th>

                        <th className="pb-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#806A8C]">
                            Action
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    {variants.map((variant: ProductVariantSave, index: number) => (
                        <tr key={index} className="border-b border-[#EFE7F4]">
                            {variantColumns.map((col: string) => (
                                <td key={col} className="py-2 pr-2">
                                    <input
                                        className={fieldClass}
                                        value={getVariantInputValue(
                                            variant.variantValues,
                                            col
                                        )}
                                        placeholder={`Enter ${col}`}
                                        onChange={(
                                            e: React.ChangeEvent<HTMLInputElement>
                                        ) =>
                                            inv.updateVariantValue(
                                                index,
                                                col,
                                                e.target.value
                                            )
                                        }
                                    />
                                </td>
                            ))}

                            <td className="py-2 pr-2">
                                <input
                                    type="number"
                                    className={fieldClass}
                                    value={variant.stock}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        inv.updateVariantField(
                                            index,
                                            "stock",
                                            e.target.value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-2 pr-2">
                                <input
                                    type="number"
                                    className={fieldClass}
                                    value={variant.alertLevel}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        inv.updateVariantField(
                                            index,
                                            "alertLevel",
                                            e.target.value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-2 pr-2">
                                <PesoPriceInput
                                    value={variant.originalPrice}
                                    onChange={(value) =>
                                        inv.updateVariantField(
                                            index,
                                            "originalPrice",
                                            value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-2 pr-2">
                                <PesoPriceInput
                                    value={variant.salesPrice}
                                    onChange={(value) =>
                                        inv.updateVariantField(
                                            index,
                                            "salesPrice",
                                            value
                                        )
                                    }
                                />
                            </td>

                            <td className="py-2 text-center">
                                <button
                                    type="button"
                                    onClick={() => inv.removeVariantRow(index)}
                                    className="text-xs font-semibold text-red-500 hover:underline"
                                >
                                    Remove
                                </button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}