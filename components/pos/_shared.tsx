import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { RefreshCw } from "lucide-react";
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
};

export type ApiOrder = {
    orderId: string;
    customerName: string;
    item?: string;
    total?: number;
    orderDate: string;
    createdAt?: string;
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
        <div className="rounded-2xl border border-[#E6DDF0] bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium tracking-[0.08em] text-[#9B8AAA]">
                {label}
            </p>
            <p className="mt-1 font-serif text-xl font-semibold text-[#1A1220]">
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
            className="flex min-h-screen text-[#1A1220]"
            style={{
                backgroundColor: "#FDFAF4",
                fontFamily: "Georgia, 'Times New Roman', serif",
            }}
        >
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-x-hidden">
                <div className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex items-center justify-between px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="font-serif text-[22px] font-semibold text-[#1A1220]">
                                POS / Sales
                            </h1>

                            <span className="rounded-md bg-[#EFE8F8] px-3 py-1 text-xs font-medium text-[#4E2C66]">
                                {isOwner
                                    ? "Sales Overview"
                                    : activeBranchName || "Assigned Branch"}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="rounded-lg border border-[#E6DDF0] bg-white px-4 py-2 text-xs text-[#6A5D6F] shadow-sm">
                                {currentMonth}
                            </div>

                            <button
                                onClick={() => void onRefresh()}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#5F4E75] shadow-sm hover:bg-[#F7F1FF]"
                                title="Refresh"
                                type="button"
                            >
                                <RefreshCw size={15} />
                            </button>

                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2B174C] text-xs font-semibold text-white shadow-sm">
                                {isOwner ? "OW" : role === "staff" ? "ST" : "MG"}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-5 py-5">{children}</div>
            </main>
        </div>
    );
}

export function OrdersTable({
                                title,
                                subtitle,
                                orders,
                                emptyText = "No orders yet.",
                            }: {
    title: string;
    subtitle: string;
    orders: Order[];
    emptyText?: string;
}) {
    return (
        <section className="overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm">
            <div className="border-b border-[#E6DDF0] bg-[#FFFCF7] px-4 py-3">
                <h3 className="font-serif text-base font-semibold text-[#1A1220]">
                    {title}
                </h3>
                <p className="text-xs text-[#8A7A91]">{subtitle}</p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                    <thead>
                    <tr className="border-b border-[#E6DDF0]">
                        <th className="px-4 py-3 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">
                            Order ID
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">
                            Customer
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">
                            Items
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">
                            Total
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-medium tracking-widest text-[#806A8C]">
                            Date
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    {orders.length === 0 ? (
                        <tr>
                            <td
                                colSpan={5}
                                className="px-4 py-10 text-center text-sm text-[#9B8AAA]"
                            >
                                {emptyText}
                            </td>
                        </tr>
                    ) : (
                        orders.map((o) => (
                            <tr
                                key={o.id}
                                className="border-b border-[#EFE7F4] last:border-0"
                            >
                                <td className="px-4 py-3 font-mono text-[11px] font-semibold text-[#5F4E75]">
                                    {o.id}
                                </td>

                                <td className="px-4 py-3 text-[#1A1220]">
                                    {o.customer || "Customer"}
                                </td>

                                <td className="px-4 py-3 text-[#6A5D6F]">
                                    {Array.isArray(o.items) &&
                                    o.items.length > 0 ? (
                                        <div className="space-y-1">
                                            {o.items.map((item, idx) => (
                                                <div
                                                    key={`${item.name}-${idx}`}
                                                >
                                                    {item.name} x
                                                    {item.quantity}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        "—"
                                    )}
                                </td>

                                <td className="px-4 py-3 font-semibold text-[#1A1220]">
                                    {peso(o.total)}
                                </td>

                                <td className="px-4 py-3 text-[#6A5D6F]">
                                    {o.date}
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