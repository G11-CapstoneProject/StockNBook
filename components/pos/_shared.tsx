import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { CalendarDays, ChevronDown, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export type CartMap = { [key: string]: number };

export type ProductVariant = {
    id: number;
    productId?: number | null;
    name: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
};

export type ProductVariantApiRaw = {
    id?: number | string;
    variantId?: number | string;
    variant_id?: number | string;
    productId?: number | string | null;
    product_id?: number | string | null;

    name?: string | null;
    variantName?: string | null;
    variant_name?: string | null;
    size?: string | null;

    variantValues?: Record<string, string> | string | null;
    variant_values?: Record<string, string> | string | null;
    values?: Record<string, string> | string | null;

    stock?: number | string;
    alertLevel?: number | string;
    alert_level?: number | string;
    originalPrice?: number | string;
    original_price?: number | string;
    salesPrice?: number | string;
    sales_price?: number | string;
};

export type Product = {
    id: number;
    branchId?: number | null;
    branchName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    variants?: ProductVariant[];
};

export type ProductApiRaw = {
    id: number | string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    branchName?: string | null;
    branch_name?: string | null;
    name: string;
    category: string;
    stock?: number | string;
    alertLevel?: number | string;
    alert_level?: number | string;
    originalPrice?: number | string;
    original_price?: number | string;
    salesPrice?: number | string;
    sales_price?: number | string;
    variants?: ProductVariantApiRaw[];
};

export type BuyablePOSItem = {
    key: string;
    productId: number;
    variantId?: number | null;
    branchId?: number | null;
    productName: string;
    variantName?: string | null;
    name: string;
    category: string;
    stock: number;
    alertLevel: number;
    originalPrice: number;
    salesPrice: number;
    isVariant: boolean;
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

export type RawBranch = {
    id?: number | string;
    branch_id?: number | string;
    branchId?: number | string;
    branchName?: string | null;
    branch_name?: string | null;
    name?: string | null;
};

export type ProductsApiResponse = {
    success?: boolean;
    products?: ProductApiRaw[];
    error?: string;
};

export type CategoryApiResponse = {
    success?: boolean;
    categories?: Category[];
    error?: string;
};

export type BranchesApiResponse = {
    branches?: RawBranch[];
    error?: string;
};

export type PosOrdersApiResponse = {
    success?: boolean;
    orders?: ApiOrder[];
    error?: string;
};

export type OrderItem = {
    name: string;
    quantity: number;
};

export type Order = {
    id: string;
    customer: string;
    items: OrderItem[];
    total: number;
    date: string;
    branchId?: number | null;
    branchName?: string | null;
};

export type ApiOrder = {
    orderId: string;
    customerName: string;
    item?: string;
    total?: number;
    orderDate: string;
    createdAt?: string;
    branchId?: number | string | null;
    branch_id?: number | string | null;
    branchName?: string | null;
    branch_name?: string | null;
};

export type CartItem = {
    key: string;
    productId: number;
    variantId?: number | null;
    branchId?: number | null;
    productName: string;
    variantName?: string | null;
    name: string;
    qty: number;
    price: number;
    lineTotal: number;
    stock: number;
    category: string;
    originalPrice: number;
    salesPrice: number;
    alertLevel: number;
    isVariant: boolean;
};

export const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2,
    }).format(Number(n || 0));

function variantValuesToName(
    value?: Record<string, string> | string | null
): string {
    if (!value) return "";

    let parsed: Record<string, string> = {};

    if (typeof value === "string") {
        try {
            const json = JSON.parse(value);
            parsed = typeof json === "object" && json !== null ? json : {};
        } catch {
            return value.trim();
        }
    } else {
        parsed = value;
    }

    return Object.values(parsed)
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(" / ");
}

export const mapVariant = (
    v: ProductVariantApiRaw,
    productId: number
): ProductVariant => {
    const rawId = v.id ?? v.variantId ?? v.variant_id;

    const variantValuesName = variantValuesToName(
        v.variantValues ?? v.variant_values ?? v.values
    );

    const variantName =
        [
            v.name,
            v.variantName,
            v.variant_name,
            v.size,
            variantValuesName,
        ]
            .map((item) => String(item || "").trim())
            .find(Boolean) || "Variant";

    return {
        id: Number(rawId),
        productId: Number(v.productId ?? v.product_id ?? productId),
        name: variantName,
        stock: Number(v.stock ?? 0),
        alertLevel: Number(v.alertLevel ?? v.alert_level ?? 0),
        originalPrice: Number(v.originalPrice ?? v.original_price ?? 0),
        salesPrice: Number(v.salesPrice ?? v.sales_price ?? 0),
    };
};

export const mapProduct = (p: ProductApiRaw): Product => {
    const rawBranchId = p.branchId ?? p.branch_id ?? null;
    const productId = Number(p.id);

    return {
        id: productId,
        branchId: rawBranchId ? Number(rawBranchId) : null,
        branchName: p.branchName ?? p.branch_name ?? null,
        name: String(p.name ?? ""),
        category: String(p.category ?? ""),
        stock: Number(p.stock ?? 0),
        alertLevel: Number(p.alertLevel ?? p.alert_level ?? 0),
        originalPrice: Number(p.originalPrice ?? p.original_price ?? 0),
        salesPrice: Number(p.salesPrice ?? p.sales_price ?? 0),
        variants: Array.isArray(p.variants)
            ? p.variants
                .map((variant) => mapVariant(variant, productId))
                .filter((variant) => variant.id && variant.name)
            : [],
    };
};

export const productToBuyableItems = (product: Product): BuyablePOSItem[] => {
    const hasVariants =
        Array.isArray(product.variants) && product.variants.length > 0;

    if (hasVariants) {
        return product.variants!.map((variant) => ({
            key: `${product.id}-${variant.id}`,
            productId: product.id,
            variantId: variant.id,
            branchId: product.branchId,
            productName: product.name,
            variantName: variant.name,
            name: `${product.name}/${variant.name}`,
            category: product.category,
            stock: Number(variant.stock || 0),
            alertLevel: Number(variant.alertLevel || 0),
            originalPrice: Number(variant.originalPrice || 0),
            salesPrice: Number(variant.salesPrice || 0),
            isVariant: true,
        }));
    }

    return [
        {
            key: String(product.id),
            productId: product.id,
            variantId: null,
            branchId: product.branchId,
            productName: product.name,
            variantName: null,
            name: product.name,
            category: product.category,
            stock: Number(product.stock || 0),
            alertLevel: Number(product.alertLevel || 0),
            originalPrice: Number(product.originalPrice || 0),
            salesPrice: Number(product.salesPrice || 0),
            isVariant: false,
        },
    ];
};

export const readProducts = (): Product[] => {
    try {
        if (typeof window === "undefined") return [];
        const raw = sessionStorage.getItem("stocknbook_inventory_products");
        const parsed = raw ? (JSON.parse(raw) as Product[]) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const readOrders = (): Order[] => {
    try {
        if (typeof window === "undefined") return [];
        const raw = sessionStorage.getItem("stocknbook_orders");
        const parsed = raw ? (JSON.parse(raw) as Order[]) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const readCategories = (): Category[] => {
    try {
        if (typeof window === "undefined") return [];
        const raw = sessionStorage.getItem("stocknbook_categories");
        const parsed = raw ? (JSON.parse(raw) as Category[]) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const readRole = (): string => {
    if (typeof window === "undefined") return "";
    return (sessionStorage.getItem("role") || "").toLowerCase();
};

export const readBranchId = (): string => {
    if (typeof window === "undefined") return "";
    return (
        sessionStorage.getItem("branch_id") ||
        sessionStorage.getItem("stocknbook_branch_id") ||
        ""
    );
};

export const readBranchName = (): string => {
    if (typeof window === "undefined") return "";
    return (
        sessionStorage.getItem("branch_name") ||
        sessionStorage.getItem("stocknbook_branch_name") ||
        ""
    );
};

export function StatCard({
                             label,
                             value,
                         }: {
    label: string;
    value: string | number;
}) {
    return (
        <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold text-[#2B174C]">
                {label}
            </p>

            <p className="mt-1 text-[19px] font-bold leading-tight text-[#1A1220]">
                {value}
            </p>
        </div>
    );
}

export function POSLayout({
                              role,
                              isOwner,
                              activeBranchName,
                              currentMonth,
                              onRefresh,
                              children,
                          }: {
    role: string;
    isOwner: boolean;
    activeBranchName: string;
    currentMonth: string;
    onRefresh: () => void | Promise<void>;
    children: ReactNode;
}) {
    return (
        <div
            className="flex min-h-screen font-sans text-[#1A1220]"
            style={{ backgroundColor: "#FDFAF4" }}
        >
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-x-hidden font-sans">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex items-center justify-between px-6 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-[25px] font-bold text-[#1A1220]">
                                POS / Sales
                            </h1>

                            <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">
                                {isOwner
                                    ? "Sales Overview"
                                    : activeBranchName || "Assigned Branch"}
                            </span>
                        </div>

                        <div className="flex items-center gap-2.5">
                            <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-3.5 py-2.5 text-sm font-semibold text-[#2B174C] shadow-sm hover:bg-[#F7F1FF]"
                            >
                                <CalendarDays size={14} />
                                {currentMonth}
                                <ChevronDown size={13} />
                            </button>

                            <button
                                onClick={() => void onRefresh()}
                                className="inline-flex items-center gap-2 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]"
                                title="Refresh sales"
                                type="button"
                            >
                                <RefreshCw size={14} />
                                Refresh sales
                            </button>
                        </div>
                    </div>
                </header>

                <div className="px-6 py-4">{children}</div>
            </main>
        </div>
    );
}

export function OrdersTable({
                                title,
                                subtitle,
                                orders,
                                emptyText = "No orders yet.",
                                showBranch = false,
                                getBranchName,
                            }: {
    title: string;
    subtitle: string;
    orders: Order[];
    emptyText?: string;
    showBranch?: boolean;
    getBranchName?: (order: Order) => string;
}) {
    return (
        <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
            <div className="border-b border-[#E6DDF0] bg-white px-3 py-3">
                <h3 className="text-[16px] font-bold text-[#1A1220]">
                    {title}
                </h3>

                <p className="mt-0.5 text-xs text-[#7A6A84]">
                    {subtitle}
                </p>
            </div>

            <div className="w-full overflow-x-auto">
                <table
                    className={`w-full table-fixed text-sm ${
                        showBranch ? "min-w-[1080px]" : ""
                    }`}
                >
                    {showBranch && (
                        <colgroup>
                            <col className="w-[19%]" />
                            <col className="w-[13%]" />
                            <col className="w-[14%]" />
                            <col className="w-[25%]" />
                            <col className="w-[14%]" />
                            <col className="w-[15%]" />
                        </colgroup>
                    )}

                    <thead>
                    <tr className="border-b border-[#E6DDF0]">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Order ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Customer
                        </th>
                        {showBranch && (
                            <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                                Branch
                            </th>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Items
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Total
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#806A8C]">
                            Date
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    {orders.length === 0 ? (
                        <tr>
                            <td
                                colSpan={showBranch ? 6 : 5}
                                className="px-4 py-10 text-center text-sm text-[#9B8AAA]"
                            >
                                {emptyText}
                            </td>
                        </tr>
                    ) : (
                        orders.map((order) => (
                            <tr
                                key={order.id}
                                className="border-b border-[#EFE7F4] last:border-0 hover:bg-[#FFFCF7]"
                            >
                                <td className="truncate px-4 py-3 text-xs font-semibold text-[#5F4E75]">
                                    {order.id}
                                </td>

                                <td className="truncate px-4 py-3 text-sm font-semibold text-[#1A1220]">
                                    {order.customer || "Customer"}
                                </td>

                                {showBranch && (
                                    <td className="truncate px-4 py-3 text-sm text-[#7A6A84]">
                                        {getBranchName?.(order) ||
                                            order.branchName ||
                                            "—"}
                                    </td>
                                )}

                                <td className="px-4 py-3 text-sm text-[#7A6A84]">
                                    {Array.isArray(order.items) &&
                                    order.items.length > 0 ? (
                                        <div className="space-y-1">
                                            {order.items.map((item, index) => (
                                                <div
                                                    key={`${item.name}-${index}`}
                                                    className="truncate"
                                                >
                                                    {item.name} × {item.quantity}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        "—"
                                    )}
                                </td>

                                <td className="truncate px-4 py-3 text-sm font-bold text-[#1A1220]">
                                    {peso(order.total)}
                                </td>

                                <td className="truncate px-4 py-3 text-sm text-[#7A6A84]">
                                    {order.date}
                                </td>
                            </tr>
                        ))
                    )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
