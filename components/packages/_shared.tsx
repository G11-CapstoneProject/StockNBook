import { CalendarDays, ChevronDown, ImagePlus, Package2, RefreshCw, Search, Truck, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiscountType = "amount" | "percentage";
export type PackageAccess = "none" | "view" | "full";

export type PackageCategory =
    | "All"
    | "Birthday"
    | "Debut"
    | "Anniversary"
    | "Wedding"
    | "Corporate"
    | "Kids Party"
    | "Baby Shower"
    | "Christening"
    | "Graduation"
    | "Other";

export type PackageFormCategory = Exclude<PackageCategory, "All">;

export const PACKAGE_CATEGORY_OPTIONS: PackageCategory[] = [
    "All",
    "Birthday",
    "Debut",
    "Anniversary",
    "Wedding",
    "Corporate",
    "Kids Party",
    "Baby Shower",
    "Christening",
    "Graduation",
    "Other",
];

export type PackageInclusion = {
    itemType?: "consumable" | "rental";
    equipmentId?: number | null;
    inventoryKey: string;
    productId: number;
    variantId?: number | null;
    productName: string;
    variantName?: string;
    quantity: number;
    unitSalesPrice: number;
    lineValue: number;
    availableStock?: number;
};

export type ProductVariant = {
    id: number;
    productId?: number;
    product_id?: number;
    variantValues?: Record<string, string> | string;
    variant_values?: Record<string, string> | string;
    stock: number;
    alertLevel?: number;
    alert_level?: number;
    originalPrice?: number;
    original_price?: number;
    salesPrice?: number;
    sales_price?: number;
};

export type Product = {
    id: number;
    branchId?: number | null;
    branch_id?: number | null;
    name: string;
    category?: string;
    salesPrice?: number;
    sales_price?: number;
    stock?: number;
    hasVariants?: boolean;
    has_variants?: boolean;
    variants?: ProductVariant[];
};

export type PackageSelectableItem = {
    itemType?: "consumable" | "rental";
    equipmentId?: number | null;
    key: string;
    productId: number;
    variantId?: number | null;
    productName: string;
    variantName?: string;
    displayName: string;
    category?: string;
    salesPrice: number;
    stock: number;
    branchId?: number | null;
};

export type PackageItem = {
    id: number;
    store_id?: number;
    branch_id?: number;
    name: string;
    description: string;
    original_value: number;
    discount_type: DiscountType;
    discount_value: number;
    package_price: number;
    down_payment_amount: number;
    duration: string;
    status: "Active" | "Inactive";
    category?: PackageFormCategory;
    cover_image?: string;
    inclusions: PackageInclusion[];
};



// ─── Utils ────────────────────────────────────────────────────────────────────

export function getToken() {
    return (
        sessionStorage.getItem("token") ||
        localStorage.getItem("token") ||
        ""
    );
}

export function peso(n: number) {
    return `₱${Number(n || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export function formatText(value: string) {
    if (!value) return "";
    return value
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export function getPackageCategory(
    pkg: Pick<PackageItem, "name" | "description" | "category">
): PackageFormCategory {
    if (pkg.category) {
        return pkg.category;
    }

    const source = `${pkg.name} ${pkg.description || ""}`.toLowerCase();

    if (source.includes("baby shower")) return "Baby Shower";
    if (source.includes("christening") || source.includes("baptism")) {
        return "Christening";
    }
    if (source.includes("graduation")) return "Graduation";
    if (source.includes("birthday") || source.includes("bday")) {
        return "Birthday";
    }
    if (source.includes("debut")) return "Debut";
    if (source.includes("anniversary")) return "Anniversary";
    if (source.includes("wedding")) return "Wedding";
    if (source.includes("corporate")) return "Corporate";
    if (
        source.includes("kids") ||
        source.includes("kid ") ||
        source.includes("children") ||
        source.includes("child ")
    ) {
        return "Kids Party";
    }

    return "Other";
}

export function getSavedPackageAccess(): PackageAccess {
    try {
        const permissions = JSON.parse(
            sessionStorage.getItem("permissions") ||
            localStorage.getItem("permissions") ||
            "{}"
        );

        const access =
            permissions.package_access ||
            permissions.packages_access ||
            (permissions.packages === true ? "view" : "none");

        if (access === "full") return "full";
        if (access === "view") return "view";
        return "none";
    } catch {
        return "none";
    }
}
function getProductBranchId(product: Product) {
    const rawBranchId = product.branchId ?? product.branch_id ?? null;
    const branchId = Number(rawBranchId);

    return Number.isFinite(branchId) && branchId > 0 ? branchId : null;
}

function parseVariantValues(
    value: ProductVariant["variantValues"] | ProductVariant["variant_values"]
) {
    if (!value) return {};

    if (typeof value === "string") {
        try {
            return JSON.parse(value) as Record<string, string>;
        } catch {
            return {};
        }
    }

    return value;
}

function getVariantName(variant: ProductVariant) {
    const values = parseVariantValues(
        variant.variantValues ?? variant.variant_values
    );

    const label = Object.values(values)
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .join(", ");

    return label || `Variant #${variant.id}`;
}

export function getInclusionKey(item: PackageInclusion) {
    if (item.itemType === "rental" && item.equipmentId) return `rental:${item.equipmentId}`;
    if (item.inventoryKey) return item.inventoryKey;

    return item.variantId
        ? `product:${item.productId}:variant:${item.variantId}`
        : `product:${item.productId}:regular`;
}

export function buildPackageSelectableItems(
    products: Product[],
    selectedBranchId?: number | null
): PackageSelectableItem[] {
    return products.flatMap<PackageSelectableItem>((product): PackageSelectableItem[] => {
        const productBranchId = getProductBranchId(product);

        if (
            selectedBranchId &&
            productBranchId &&
            productBranchId !== selectedBranchId
        ) {
            return [];
        }

        const variants = Array.isArray(product.variants)
            ? product.variants
            : [];

        const hasVariants =
            Boolean(product.hasVariants ?? product.has_variants) &&
            variants.length > 0;

        if (hasVariants) {
            return variants.map<PackageSelectableItem>((variant) => {
                const variantName = getVariantName(variant);
                const salesPrice = Number(
                    variant.salesPrice ??
                    variant.sales_price ??
                    product.salesPrice ??
                    product.sales_price ??
                    0
                );

                return {
                    key: `product:${product.id}:variant:${variant.id}`,
                    productId: product.id,
                    variantId: Number(variant.id),
                    productName: product.name,
                    variantName,
                    displayName: `${product.name} — ${variantName}`,
                    category: product.category,
                    salesPrice,
                    stock: Number(variant.stock || 0),
                    branchId: productBranchId,
                };
            });
        }

        return [
            {
                key: `product:${product.id}:regular`,
                productId: product.id,
                variantId: null,
                productName: product.name,
                variantName: "",
                displayName: product.name,
                category: product.category,
                salesPrice: Number(product.salesPrice ?? product.sales_price ?? 0),
                stock: Number(product.stock || 0),
                branchId: productBranchId,
            },
        ];
    });
}

// ─── Shared fieldClass ────────────────────────────────────────────────────────

export const fieldClass =
    "w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] outline-none shadow-sm transition focus:border-[#2B174C]";

// ─── UI Components ────────────────────────────────────────────────────────────

export function Card({
                         children,
                         className = "",
                     }: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={`rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm ${className}`}>
            {children}
        </div>
    );
}

export function CardHeader({
                               title,
                               action,
                           }: {
    title: string;
    action?: string;
}) {
    return (
        <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="whitespace-nowrap text-[16px] font-bold text-[#1A1220]">
                {title}
            </h2>
            {action && (
                <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-[#806A8C]">
                    {action}
                </span>
            )}
        </div>
    );
}

/** Summary tile with the same typography, spacing and icon treatment as POS StatCard. */
export function PackageSummaryCard({
                                       title,
                                       value,
                                       detail,
                                       icon,
                                       iconClassName = "bg-[#F0E9FF] text-[#5A35A5]",
                                   }: {
    title: string;
    value: number;
    detail: string;
    icon: ReactNode;
    iconClassName?: string;
}) {
    return (
        <section className="flex min-h-[128px] items-center gap-4 rounded-[18px] border border-[#E6DDF0] bg-white px-5 py-4 shadow-sm">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${iconClassName}`}>
                {icon}
            </span>
            <div className="min-w-0">
                <h2 className="text-[14px] font-medium text-[#2B174C]">{title}</h2>
                <p className="mt-0.5 text-[26px] font-bold leading-tight text-[#1A1220]">{value}</p>
                <p className="mt-1 text-xs text-[#806A8C]">{detail}</p>
            </div>
        </section>
    );
}

export function Field({
                          label,
                          children,
                      }: {
    label: string;
    children: ReactNode;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[#806A8C]">
                {label}
            </span>
            {children}
        </label>
    );
}

export function SummaryBox({
                               label,
                               value,
                               strong = false,
                           }: {
    label: string;
    value: string;
    strong?: boolean;
}) {
    return (
        <div>
            <p className="text-xs text-[#7A6A84]">{label}</p>
            <p className={`mt-1 text-sm ${strong ? "font-bold text-[#2B174C]" : "font-semibold text-[#1A1220]"}`}>
                {value}
            </p>
        </div>
    );
}

export function EmptyState({
                               title,
                               detail,
                           }: {
    title: string;
    detail: string;
}) {
    return (
        <div className="flex min-h-75 items-center justify-center rounded-[14px] border border-dashed border-[#E6DDF0] bg-white px-4 text-center shadow-sm">
            <div>
                <p className="text-sm font-semibold text-[#1A1220]">{title}</p>
                <p className="mt-1 text-xs leading-5 text-[#7A6A84]">{detail}</p>
            </div>
        </div>
    );
}

export function PageHeader({
                               title,
                               badge,
                           }: {
    title: string;
    badge?: string;
}) {
    const currentMonth = new Date().toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    return (
        <div className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
            <div className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                    <h1 className="text-[25px] font-bold text-[#1A1220]">{title}</h1>
                    {badge && (
                        <span className="rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]">
                            {badge}
                        </span>
                    )}
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
                        type="button"
                        className="inline-flex items-center gap-2 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]"
                        title="Refresh packages"
                    >
                        <RefreshCw size={14} />
                        Refresh
                    </button>
                </div>
            </div>
        </div>
    );
}

function getPackageCoverImage(pkg: PackageItem) {
    if (pkg.cover_image) {
        return pkg.cover_image;
    }

    const packageText = `${pkg.name} ${pkg.description || ""}`.toLowerCase();

    return packageText.includes("wedding")
        ? "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=900&q=85"
        : packageText.includes("birthday")
            ? "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=900&q=85"
            : packageText.includes("graduation")
                ? "https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=900&q=85"
                : packageText.includes("christening") || packageText.includes("baby")
                    ? "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=900&q=85"
                    : packageText.includes("corporate")
                        ? "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=85"
                        : "https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=900&q=85";
}

export function PackageCard({
                                pkg,
                                featured = false,
                                canManage = true,
                                onEdit,
                                onDelete,
                            }: {
    pkg: PackageItem;
    featured?: boolean;
    canManage?: boolean;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const [showDetails, setShowDetails] = useState(false);
    const [showExpandedImage, setShowExpandedImage] = useState(false);
    const inclusionCount = (pkg.inclusions || []).length;
    const packageCategory = getPackageCategory(pkg);

    const coverImage = getPackageCoverImage(pkg);

    const discountLabel =
        pkg.discount_type === "percentage"
            ? `${Number(pkg.discount_value || 0)}%`
            : peso(pkg.discount_value || 0);

    const totalIncludedUnits = (pkg.inclusions || []).reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
    );

    const totalInclusionValue = (pkg.inclusions || []).reduce(
        (sum, item) => sum + Number(item.lineValue || 0),
        0
    );

    const consumableInclusions = (pkg.inclusions || []).filter(
        (item) => item.itemType !== "rental"
    );
    const rentalInclusions = (pkg.inclusions || []).filter(
        (item) => item.itemType === "rental"
    );

    const openDetails = () => setShowDetails(true);

    return (
        <>
            <article
                role="button"
                tabIndex={0}
                aria-label={`View details for ${pkg.name}`}
                onClick={openDetails}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDetails();
                    }
                }}
                className="group cursor-pointer overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#D4C1E7] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B174C] focus-visible:ring-offset-2"
            >
                <div className="h-36 overflow-hidden bg-[#F5EEF6]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={coverImage}
                        alt={`${pkg.name} package cover`}
                        loading="lazy"
                        onError={(event) => {
                            event.currentTarget.style.display = "none";
                        }}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                </div>

                <div
                    className={`px-4 py-4 ${
                        featured
                            ? "bg-[#C9951A] text-white"
                            : "bg-[#2D1B4E] text-white"
                    }`}
                >
                    <div className="min-w-0">
                        <p className="truncate text-[16px] font-semibold leading-5">
                            {pkg.name}
                        </p>

                        <p className="mt-1 text-[22px] font-bold leading-tight">
                            {peso(pkg.package_price)}
                        </p>

                        <p className="mt-1 text-xs leading-none text-white/80">
                            DP: {peso(pkg.down_payment_amount || 0)}
                        </p>
                    </div>
                </div>

                <div className="p-4.5">
                    <p className="line-clamp-2 min-h-11 text-[13px] leading-5 text-[#7A6A84]">
                        {pkg.description || "No description"}
                    </p>

                    <div className="mt-4 flex items-center gap-4 border-t border-[#EFE7F4] pt-3">
                        <div className="flex items-center gap-1.5 text-xs text-[#7A6A84]">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                            >
                                <path d="M4 7.5h7l2 2H20v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5Z" />
                                <path d="M4 7.5V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1.5" />
                            </svg>
                            <span>{packageCategory}</span>
                        </div>

                    </div>

                    <div className="mt-3 flex items-center justify-end border-t border-[#EFE7F4] pt-3">
                        {canManage ? (
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onEdit();
                                    }}
                                    className="text-xs font-semibold text-[#2B174C] hover:underline"
                                >
                                    Edit
                                </button>

                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onDelete();
                                    }}
                                    className="text-xs font-semibold text-red-500 hover:underline"
                                >
                                    Delete
                                </button>
                            </div>
                        ) : (
                            <span className="text-xs font-semibold text-[#7A6A84]">
                                View only
                            </span>
                        )}
                    </div>
                </div>
            </article>

            {showDetails && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${pkg.name} package details`}
                    onClick={() => setShowDetails(false)}
                >
                    <div
                        className="flex max-h-[92vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-[22px] border border-[#E6DDF0] bg-white shadow-[0_24px_80px_rgba(20,10,35,0.28)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="relative shrink-0 overflow-hidden bg-[#2D1B4E]">
                            <button
                                type="button"
                                onClick={() => setShowExpandedImage(true)}
                                className="group/image block h-[210px] sm:h-[230px] w-full cursor-zoom-in overflow-hidden text-left"
                                aria-label="Expand package cover image"
                                title="Click to enlarge image"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={coverImage}
                                    alt={`${pkg.name} package cover`}
                                    className="h-full w-full object-cover transition duration-300 group-hover/image:scale-[1.02]"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#160C27]/85 via-[#160C27]/15 to-transparent" />

                                <span className="absolute right-5 top-5 rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm transition group-hover/image:bg-black/60">
                                    Click image to expand
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowDetails(false)}
                                className="absolute left-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-lg font-semibold text-[#2B174C] shadow-md transition hover:scale-105 hover:bg-white"
                                aria-label="Close package details"
                            >
                                ×
                            </button>

                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 p-6">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
                                    Package details
                                </p>
                                <h2 className="mt-1 max-w-[820px] text-[28px] font-bold leading-tight text-white">
                                    {pkg.name}
                                </h2>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(330px,0.95fr)]">
                                <div className="min-w-0 space-y-5">
                                    <section className="rounded-[18px] border border-[#E6DDF0] bg-white p-4 sm:p-5">
                                        <h3 className="text-sm font-bold text-[#1A1220]">
                                            Package Information
                                        </h3>

                                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                            <DetailBox
                                                label="Package Price"
                                                value={peso(pkg.package_price)}
                                                strong
                                            />
                                            <DetailBox
                                                label="Down Payment"
                                                value={peso(pkg.down_payment_amount || 0)}
                                            />
                                            <DetailBox
                                                label="Original Value"
                                                value={peso(pkg.original_value || 0)}
                                            />
                                            <DetailBox
                                                label="Discount"
                                                value={discountLabel}
                                            />
                                            <DetailBox
                                                label="Category"
                                                value={packageCategory}
                                            />
                                        </div>
                                    </section>

                                    <section className="rounded-[18px] border border-[#EAE1EF] bg-[#FFFCF8] p-4">
                                        <h3 className="text-sm font-bold text-[#1A1220]">
                                            Description
                                        </h3>
                                        <p className="mt-2 text-sm leading-6 text-[#74657D]">
                                            {pkg.description || "No description provided."}
                                        </p>
                                    </section>

                                    <section className="rounded-[18px] border border-[#EAE1EF] bg-white p-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <h3 className="text-sm font-bold text-[#1A1220]">
                                                    Inclusion Summary
                                                </h3>
                                                <p className="mt-1 text-xs text-[#84738D]">
                                                    Quick summary of everything included in this package.
                                                </p>
                                            </div>

                                            <span className="rounded-full bg-[#EFE8F8] px-3 py-1 text-xs font-bold text-[#4E2C66]">
                                                {inclusionCount} {inclusionCount === 1 ? "item" : "items"}
                                            </span>
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-3">
                                            <DetailBox
                                                label="Included Units"
                                                value={`${totalIncludedUnits} units`}
                                            />
                                            <DetailBox
                                                label="Inclusion Value"
                                                value={peso(totalInclusionValue)}
                                                strong
                                            />
                                            {consumableInclusions.length > 0 && (
                                                <DetailBox label="Consumable Goods" value={`${consumableInclusions.length}`} />
                                            )}
                                            {rentalInclusions.length > 0 && (
                                                <DetailBox label="Rental Goods" value={`${rentalInclusions.length}`} />
                                            )}
                                        </div>
                                    </section>
                                </div>

                                <div className="min-w-0">
                                    <section className="rounded-[18px] border border-[#E6DDF0] bg-[#FBF8FD] p-4 sm:p-5">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-bold text-[#1A1220]">Package Inclusions</h3>
                                                <p className="mt-1 text-xs text-[#84738D]">What is included with this package.</p>
                                            </div>
                                            <span className="shrink-0 rounded-full bg-[#EEE5F8] px-3 py-1 text-xs font-bold text-[#4E2C66]">
                                                {inclusionCount} {inclusionCount === 1 ? "item" : "items"}
                                            </span>
                                        </div>

                                        <div className="mt-4 space-y-4">
                                            {inclusionCount === 0 ? (
                                                <p className="rounded-xl border border-dashed border-[#DCCFE6] bg-white px-4 py-8 text-center text-sm text-[#7A6A84]">
                                                    No inclusions listed.
                                                </p>
                                            ) : (
                                                [
                                                    { kind: "consumable", name: "Consumable Goods", items: consumableInclusions },
                                                    { kind: "rental", name: "Rental Goods", items: rentalInclusions },
                                                ].filter((group) => group.items.length > 0).map((group) => (
                                                    <div key={group.kind} className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white">
                                                        <div className="flex items-center justify-between gap-2 border-b border-[#EDE5F3] bg-[#F6F1FB] px-3.5 py-3">
                                                            <div className="flex min-w-0 items-center gap-2 text-[#2B174C]">
                                                                {group.kind === "rental" ? <Truck size={16} /> : <Package2 size={16} />}
                                                                <h4 className="text-[13px] font-bold">{group.name}</h4>
                                                            </div>
                                                            <span className="shrink-0 text-xs font-semibold text-[#705B81]">
                                                                {group.items.length} {group.items.length === 1 ? "item" : "items"}
                                                            </span>
                                                        </div>
                                                        <div className="divide-y divide-[#F0EAF4]">
                                                            {group.items.map((item, index) => (
                                                                <div key={`${getInclusionKey(item)}-${index}`} className="flex items-start justify-between gap-3 px-3.5 py-3">
                                                                    <div className="min-w-0">
                                                                        <p className="break-words text-[13px] font-semibold text-[#1A1220]">{item.productName}</p>
                                                                        {item.variantName && <p className="mt-0.5 text-xs text-[#806F89]">{item.variantName}</p>}
                                                                        <p className="mt-1 text-xs text-[#7A6A84]">
                                                                            {peso(item.unitSalesPrice)} {group.kind === "rental" ? "per unit/day" : "each"}
                                                                        </p>
                                                                    </div>
                                                                    <div className="shrink-0 text-right">
                                                                        <p className="text-[13px] font-bold text-[#2B174C]">× {item.quantity}</p>
                                                                        <p className="mt-1 text-xs font-semibold text-[#70617D]">{peso(item.lineValue)}</p>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#E8DFED] bg-white px-6 py-4">
                            <p className="text-xs text-[#8A7A91]">
                                Click the cover image above to view it in full size.
                            </p>

                            {canManage ? (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowDetails(false);
                                            onEdit();
                                        }}
                                        className="rounded-xl border border-[#DCCFE6] bg-white px-5 py-2.5 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F7F1FF]"
                                    >
                                        Edit
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowDetails(false);
                                            onDelete();
                                        }}
                                        className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600"
                                    >
                                        Delete
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowDetails(false)}
                                    className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                >
                                    Close
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showExpandedImage && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${pkg.name} enlarged cover image`}
                    onClick={() => setShowExpandedImage(false)}
                >
                    <div
                        className="relative flex max-h-[94vh] max-w-[94vw] items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={coverImage}
                            alt={`${pkg.name} enlarged package cover`}
                            className="max-h-[90vh] max-w-[90vw] rounded-[18px] object-contain shadow-2xl"
                        />

                        <button
                            type="button"
                            onClick={() => setShowExpandedImage(false)}
                            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-lg font-semibold text-[#2B174C] shadow-md transition hover:scale-105 hover:bg-white"
                            aria-label="Close enlarged image"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

function DetailBox({
                       label,
                       value,
                       strong = false,
                   }: {
    label: string;
    value: string;
    strong?: boolean;
}) {
    return (
        <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(43,23,76,0.03)]">
            <p className="text-xs font-semibold text-[#806A8C]">{label}</p>
            <p
                className={`mt-1 text-sm ${
                    strong
                        ? "font-bold text-[#2B174C]"
                        : "font-semibold text-[#1A1220]"
                }`}
            >
                {value}
            </p>
        </div>
    );
}

// ─── Package Form Modal ───────────────────────────────────────────────────────


export function PackageFormModal({
                                     show,
                                     editingId,
                                     error,
                                     submitting,
                                     name,
                                     setName,
                                     description,
                                     setDescription,
                                     category,
                                     setCategory,
                                     coverImage,
                                     onCoverImageChange,
                                     onRemoveCoverImage,
                                     duration,
                                     setDuration,
                                     status,
                                     setStatus,
                                     discountType,
                                     setDiscountType,
                                     discountValue,
                                     setDiscountValue,
                                     downPaymentAmount,
                                     setDownPaymentAmount,
                                     inclusions,
                                     products,
                                     storeId,
                                     branchId,
                                     selectedProductId,
                                     setSelectedProductId,
                                     inclusionQty,
                                     setInclusionQty,
                                     originalValue,
                                     packagePrice,
                                     onAddInclusion,
                                     onAdjustInclusion,
                                     onRemoveInclusion,
                                     onSubmit,
                                     onClose,
                                 }: {
    show: boolean;
    editingId: number | null;
    error: string;
    submitting: boolean;
    name: string;
    setName: (value: string) => void;
    description: string;
    setDescription: (value: string) => void;
    category: PackageFormCategory;
    setCategory: (value: PackageFormCategory) => void;
    coverImage: string;
    onCoverImageChange: (file: File | null) => void;
    onRemoveCoverImage: () => void;
    duration: string;
    setDuration: (value: string) => void;
    status: "Active" | "Inactive";
    setStatus: (value: "Active" | "Inactive") => void;
    discountType: DiscountType;
    setDiscountType: (value: DiscountType) => void;
    discountValue: string;
    setDiscountValue: (value: string) => void;
    downPaymentAmount: string;
    setDownPaymentAmount: (value: string) => void;
    inclusions: PackageInclusion[];
    products: PackageSelectableItem[];
    storeId: number | null;
    branchId: number | null;
    selectedProductId: string;
    setSelectedProductId: (value: string) => void;
    inclusionQty: string;
    setInclusionQty: (value: string) => void;
    originalValue: number;
    packagePrice: number;
    onAddInclusion: () => void;
    onAdjustInclusion: (product: PackageSelectableItem, delta: number) => void;
    onRemoveInclusion: (key: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    onClose: () => void;
}) {
    const discountNumber = Number(discountValue || 0);
    const downPaymentInput = Number(downPaymentAmount || 0);
    const isPercentageType = discountType === "percentage";
    const calculatedDownPayment = isPercentageType
        ? packagePrice * (downPaymentInput / 100)
        : downPaymentInput;
    const calculatedDiscount = Math.max(originalValue - packagePrice, 0);
    const selectableCategories = PACKAGE_CATEGORY_OPTIONS.filter(
        (option) => option !== "All"
    ) as PackageFormCategory[];

    const [inclusionSearch, setInclusionSearch] = useState("");
    const [inclusionCategory, setInclusionCategory] = useState("");
    const [goodsTab, setGoodsTab] = useState<"consumable" | "rental">("consumable");
    const [rentalCatalog, setRentalCatalog] = useState<Array<{
        id: number; name: string; category?: string; dailyRate: number; physicallyAvailable: number; bookableToday: number;
    }>>([]);
    const [rentalLoading, setRentalLoading] = useState(false);
    const [rentalError, setRentalError] = useState("");
    const [showFormImagePreview, setShowFormImagePreview] = useState(false);

    useEffect(() => {
        if (!show || !storeId || !branchId) return;
        const controller = new AbortController();
        setRentalLoading(true);
        setRentalError("");
        setRentalCatalog([]);
        void (async () => {
            try {
                // Same branch-scoped rental catalog as the customer booking portal.
                // bookableToday is only a preview, NOT a reservation for an event date.
                const response = await fetch("/api/bookings", {
                    method: "POST", cache: "no-store", signal: controller.signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "get_public_rental_catalog", storeId, branchId }),
                });
                const data = await response.json();
                if (!response.ok || Number(data.branchId) !== branchId) {
                    throw new Error(data.error || "Unable to load rental equipment for this branch.");
                }
                if (!controller.signal.aborted) setRentalCatalog(Array.isArray(data.equipment) ? data.equipment : []);
            } catch (reason) {
                if (!controller.signal.aborted) {
                    setRentalCatalog([]);
                    setRentalError(reason instanceof Error ? reason.message : "Unable to load rental equipment.");
                }
            } finally {
                if (!controller.signal.aborted) setRentalLoading(false);
            }
        })();
        return () => controller.abort();
    }, [show, storeId, branchId]);

    const rentalProducts: PackageSelectableItem[] = rentalCatalog.map((item) => ({
        key: `rental:${item.id}`, itemType: "rental", equipmentId: item.id,
        productId: 0, productName: item.name, displayName: item.name,
        category: item.category || "Other", stock: Math.max(0, Number(item.physicallyAvailable || 0)),
        salesPrice: Number(item.dailyRate || 0),
    }));
    const activeProducts = goodsTab === "rental" ? rentalProducts : products;
    const inclusionCategoryOptions = Array.from(new Set(activeProducts.map((p) =>
        String(p.category || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const filteredInclusionProducts = activeProducts.filter((product) => {
        const query = inclusionSearch.trim().toLowerCase();
        return (!query || [product.displayName, product.productName, product.variantName, product.category]
                .filter(Boolean).join(" ").toLowerCase().includes(query)) &&
            (!inclusionCategory || product.category === inclusionCategory);
    });
    const getSelectedQuantity = (key: string) => inclusions.find((item) => getInclusionKey(item) === key)?.quantity || 0;

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#170D27]/55 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={editingId ? "Edit package" : "Add package"}>
            <div className="max-h-[94vh] w-full max-w-[1360px] overflow-y-auto rounded-[20px] border border-[#E6DDF0] bg-[#FCFAFD] p-4 shadow-2xl sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[19px] font-bold text-[#1A1220]">
                            {editingId ? "Edit package" : "Add package"}
                        </h2>

                        <p className="mt-1 text-sm leading-5 text-[#7A6A84]">
                            Set package details, choose consumable or rental goods, then review pricing and down payment.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#7A6A84] hover:bg-[#F7F1FF]"
                        aria-label="Close package form"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={onSubmit} className="space-y-4">
                    {error && (
                        <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2.5 text-xs font-medium text-[#9B1C1C]">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#E6DDF0] bg-white p-4 md:grid-cols-[minmax(0,1.6fr)_minmax(180px,.7fr)_minmax(180px,.7fr)]">
                        <Field label="Package Name">
                            <input
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="e.g. Birthday Basic Package"
                                className={fieldClass}
                            />
                        </Field>

                        <Field label="Duration">
                            <input
                                value={duration}
                                onChange={(event) =>
                                    setDuration(event.target.value)
                                }
                                placeholder="e.g. 3 hours"
                                className={fieldClass}
                            />
                        </Field>

                        <Field label="Category">
                            <select
                                value={category}
                                onChange={(event) =>
                                    setCategory(
                                        event.target.value as PackageFormCategory
                                    )
                                }
                                className={fieldClass}
                            >
                                {selectableCategories.map((option) => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 rounded-2xl border border-[#E6DDF0] bg-white p-4 md:grid-cols-2">
                        <Field label="Description">
                            <textarea
                                value={description}
                                onChange={(event) =>
                                    setDescription(event.target.value)
                                }
                                placeholder="Short package details or notes"
                                className={`${fieldClass} h-[150px] resize-none py-3`}
                            />
                        </Field>

                        <div className="flex h-full flex-col">
                            <span className="mb-1 block text-xs font-semibold text-[#806A8C]">
                                Package Picture
                            </span>

                            {!coverImage ? (
                                <label className="flex h-[150px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#D9CBE6] bg-[#FFFCF7] px-4 py-3 text-sm font-semibold text-[#2B174C] transition hover:border-[#2B174C] hover:bg-[#F7F1FF]">
                                    <ImagePlus size={18} />
                                    Upload picture

                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        className="sr-only"
                                        onChange={(event) =>
                                            onCoverImageChange(
                                                event.target.files?.[0] || null
                                            )
                                        }
                                    />
                                </label>
                            ) : (
                                <div className="flex h-[150px] items-stretch gap-2">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowFormImagePreview(true)
                                        }
                                        className="group relative min-w-0 flex-1 cursor-zoom-in overflow-hidden rounded-xl border border-[#D9CBE6] bg-[#F7F1FF]"
                                        aria-label="Expand package picture"
                                        title="Click picture to expand"
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={coverImage}
                                            alt="Selected package cover preview"
                                            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                        />

                                        <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                                            Click to expand
                                        </span>
                                    </button>

                                    <div className="flex w-11 shrink-0 flex-col gap-2">
                                        <label
                                            className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-[#D9CBE6] bg-white text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                            title="Replace picture"
                                            aria-label="Replace package picture"
                                        >
                                            <ImagePlus size={16} />

                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp"
                                                className="sr-only"
                                                onChange={(event) =>
                                                    onCoverImageChange(
                                                        event.target.files?.[0] ||
                                                        null
                                                    )
                                                }
                                            />
                                        </label>

                                        <button
                                            type="button"
                                            onClick={onRemoveCoverImage}
                                            className="flex flex-1 items-center justify-center rounded-xl border border-red-200 bg-white text-red-500 transition hover:bg-red-50"
                                            title="Remove picture"
                                            aria-label="Remove package picture"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                className="h-4 w-4"
                                                aria-hidden="true"
                                            >
                                                <path d="M4 7h16" />
                                                <path d="M9 7V4h6v3" />
                                                <path d="M7 7l1 13h8l1-13" />
                                                <path d="M10 11v5M14 11v5" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            )}

                            <p className="mt-1 text-[11px] text-[#7A6A84]">
                                {coverImage
                                    ? "Click the picture to expand. Use the side buttons to replace or remove it."
                                    : "JPG, PNG, or WEBP. Maximum file size: 2 MB."}
                            </p>
                        </div>
                    </div>

                    <Card className="overflow-hidden bg-white !p-0">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EAE1EF] px-4 py-4 sm:px-5">
                            <div>
                                <h3 className="text-[16px] font-bold text-[#1A1220]">Package Inclusions</h3>
                                <p className="mt-1 text-xs text-[#7A6A84]">Choose goods included in this package. Rental equipment is subject to availability on the event dates.</p>
                            </div>
                            <span className="rounded-full bg-[#EFE8F8] px-3 py-1 text-xs font-bold text-[#4E2C66]">{inclusions.length} selected</span>
                        </div>
                        <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(330px,1fr)]">
                            <div className="min-w-0 border-b border-[#EAE1EF] p-4 lg:border-b-0 lg:border-r">
                                <div className="mb-4 flex rounded-xl bg-[#F6F0FC] p-1" role="tablist" aria-label="Inclusion type">
                                    <button type="button" role="tab" aria-selected={goodsTab === "consumable"}
                                            onClick={() => { setGoodsTab("consumable"); setInclusionCategory(""); setInclusionSearch(""); }}
                                            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${goodsTab === "consumable" ? "bg-[#2B174C] text-white shadow-sm" : "text-[#4E2C66] hover:bg-white"}`}>
                                        <Package2 size={16} /> Consumable Goods
                                    </button>
                                    <button type="button" role="tab" aria-selected={goodsTab === "rental"}
                                            onClick={() => { setGoodsTab("rental"); setInclusionCategory(""); setInclusionSearch(""); }}
                                            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${goodsTab === "rental" ? "bg-[#2B174C] text-white shadow-sm" : "text-[#4E2C66] hover:bg-white"}`}>
                                        <Truck size={16} /> Rental Goods
                                    </button>
                                </div>
                                <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                                    <label className="relative block">
                                        <span className="sr-only">Search {goodsTab} items</span>
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                                        <input value={inclusionSearch} onChange={(event) => setInclusionSearch(event.target.value)}
                                               placeholder={goodsTab === "rental" ? "Search rental equipment..." : "Search items or variants..."}
                                               className="h-10 w-full rounded-xl border border-[#E3D8EA] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#2B174C]" />
                                    </label>
                                    <select value={inclusionCategory} onChange={(event) => setInclusionCategory(event.target.value)}
                                            className="h-10 min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs text-[#1A1220] outline-none focus:border-[#2B174C]"
                                            aria-label="Filter inclusion items by category">
                                        <option value="">All Categories</option>
                                        {inclusionCategoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                                    </select>
                                </div>
                                {goodsTab === "rental" && <p className="mb-3 rounded-lg bg-[#F9F5FE] px-3 py-2 text-[11px] leading-5 text-[#644879]">
                                    Rates shown are per unit per day. The package pricing preview counts one day per rental unit; the Units column is physical stock, not future-date availability. Date-specific availability is checked when the customer books. Adding equipment here does not reserve it.
                                </p>}
                                {goodsTab === "rental" && rentalError && <p role="alert" className="mb-2 text-xs text-red-600">{rentalError}</p>}
                                <div className="overflow-hidden rounded-xl border border-[#EAE1EF]">
                                    <div className="grid grid-cols-[minmax(0,1fr)_80px_90px_112px] gap-2 border-b border-[#EAE1EF] bg-[#FBF8FD] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-[#806A8C]">
                                        <span>Product</span><span className="text-center">{goodsTab === "rental" ? "Units" : "Stock"}</span><span className="text-right">{goodsTab === "rental" ? "Rate / day" : "Price"}</span><span className="text-center">Qty</span>
                                    </div>
                                    <div className="max-h-[340px] divide-y divide-[#F1EAF5] overflow-y-auto">
                                        {rentalLoading && goodsTab === "rental" ? <p className="p-6 text-center text-sm text-[#806A8C]">Loading branch rental equipment...</p>
                                            : filteredInclusionProducts.length === 0 ? <p className="p-6 text-center text-sm text-[#806A8C]">No {goodsTab === "rental" ? "rental equipment" : "products"} match the filters.</p>
                                                : filteredInclusionProducts.map((product) => {
                                                    const selectedQty = getSelectedQuantity(product.key);
                                                    return <div key={product.key} className="grid grid-cols-[minmax(0,1fr)_80px_90px_112px] items-center gap-2 px-3 py-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-xs font-semibold text-[#1A1220]" title={product.displayName}>{product.displayName}</p>
                                                            <p className="mt-0.5 truncate text-[11px] text-[#806F89]">{product.category || "Uncategorized"}</p>
                                                        </div>
                                                        <span className={`text-center text-xs font-semibold ${product.stock <= 0 ? "text-red-600" : "text-[#1A1220]"}`}>{product.stock}</span>
                                                        <span className="text-right text-xs font-semibold tabular-nums text-[#1A1220]">{peso(product.salesPrice)}</span>
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button type="button" disabled={selectedQty <= 0} onClick={() => onAdjustInclusion(product, -1)}
                                                                    className="h-8 w-8 rounded-lg border border-[#E6DDF0] text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-30" aria-label={`Decrease ${product.displayName}`}>−</button>
                                                            <span className="min-w-5 text-center text-xs font-bold tabular-nums">{selectedQty}</span>
                                                            <button type="button" disabled={product.stock <= 0 || selectedQty >= product.stock} onClick={() => onAdjustInclusion(product, 1)}
                                                                    className="h-8 w-8 rounded-lg border border-[#E6DDF0] text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-30" aria-label={`Increase ${product.displayName}`}>+</button>
                                                        </div>
                                                    </div>;
                                                })}
                                    </div>
                                </div>
                            </div>
                            <aside className="min-w-0 bg-[#FDFBFF] p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <h4 className="text-sm font-bold text-[#1A1220]">Selected Inclusions</h4>
                                    {inclusions.length > 0 && <button type="button" className="text-xs font-semibold text-red-600 hover:underline"
                                                                      onClick={() => inclusions.forEach((item) => onRemoveInclusion(getInclusionKey(item)))}>Clear all</button>}
                                </div>
                                <div className="max-h-[320px] min-h-[210px] space-y-2 overflow-y-auto">
                                    {inclusions.length === 0 ? <div className="flex min-h-[210px] items-center justify-center rounded-xl border border-dashed border-[#E6DDF0] bg-white p-4 text-center text-xs text-[#A28FAF]">No items added yet. Choose products on the left.</div>
                                        : inclusions.map((item) => {
                                            const key = getInclusionKey(item);
                                            const product = [...products, ...rentalProducts].find((p) => p.key === key);
                                            return <div key={key} className="rounded-xl border border-[#EAE1EF] bg-white px-3 py-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0"><p className="truncate text-xs font-semibold text-[#1A1220]">{item.productName}</p>
                                                        <p className="mt-1 text-[11px] text-[#806F89]">{item.itemType === "rental" ? "Rental · rate per day" : item.variantName || "Consumable"}</p></div>
                                                    <button type="button" onClick={() => onRemoveInclusion(key)} className="text-[#9C829F] hover:text-red-600" aria-label={`Remove ${item.productName}`}><X size={15} /></button>
                                                </div>
                                                <div className="mt-2 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-1">
                                                        <button type="button" disabled={!product} onClick={() => product && onAdjustInclusion(product, -1)} className="h-7 w-7 rounded-lg border border-[#E6DDF0] text-[#2B174C] disabled:opacity-30" aria-label={`Decrease selected ${item.productName}`}>−</button>
                                                        <span className="min-w-5 text-center text-xs font-semibold">{item.quantity}</span>
                                                        <button type="button" disabled={!product || item.quantity >= (product?.stock ?? 0)} onClick={() => product && onAdjustInclusion(product, 1)} className="h-7 w-7 rounded-lg border border-[#E6DDF0] text-[#2B174C] disabled:opacity-30" aria-label={`Increase selected ${item.productName}`}>+</button>
                                                    </div>
                                                    <span className="text-xs font-bold tabular-nums text-[#2B174C]">{peso(item.lineValue)}</span>
                                                </div>
                                            </div>;
                                        })}
                                </div>
                                <div className="mt-3 flex items-center justify-between border-t border-[#EAE1EF] pt-3">
                                    <span className="text-xs font-semibold text-[#806F89]">Original Value</span>
                                    <strong className="text-lg tabular-nums text-[#1A1220]">{peso(originalValue)}</strong>
                                </div>
                                <p className="mt-1 text-[11px] text-[#806F89]">{inclusions.length} item types · {inclusions.reduce((total, item) => total + item.quantity, 0)} units</p>
                            </aside>
                        </div>
                    </Card>

                    <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#E6DDF0] bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Type">
                            <select
                                value={discountType}
                                onChange={(event) => {
                                    setDiscountType(
                                        event.target.value as DiscountType
                                    );
                                    setDiscountValue("");
                                    setDownPaymentAmount("");
                                }}
                                className={fieldClass}
                            >
                                <option value="amount">Amount</option>
                                <option value="percentage">Percentage</option>
                            </select>
                        </Field>

                        <Field
                            label={
                                isPercentageType
                                    ? "Discount (%)"
                                    : "Discount (₱)"
                            }
                        >
                            <input
                                type="number"
                                min="0"
                                max={
                                    isPercentageType
                                        ? 100
                                        : originalValue
                                }
                                value={discountValue}
                                onChange={(event) =>
                                    setDiscountValue(event.target.value)
                                }
                                placeholder={
                                    isPercentageType
                                        ? "e.g. 10"
                                        : "e.g. 500"
                                }
                                className={fieldClass}
                            />
                        </Field>

                        <Field
                            label={
                                isPercentageType
                                    ? "Down Payment (%)"
                                    : "Down Payment (₱)"
                            }
                        >
                            <input
                                type="number"
                                min="0"
                                max={isPercentageType ? 100 : packagePrice}
                                value={downPaymentAmount}
                                onChange={(event) =>
                                    setDownPaymentAmount(event.target.value)
                                }
                                placeholder={
                                    isPercentageType
                                        ? "e.g. 30"
                                        : "e.g. 1000"
                                }
                                className={fieldClass}
                            />
                        </Field>

                        <Field label="Status">
                            <select
                                value={status}
                                onChange={(event) =>
                                    setStatus(
                                        event.target.value as
                                            | "Active"
                                            | "Inactive"
                                    )
                                }
                                className={fieldClass}
                            >
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                        </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-[#E6DDF0] bg-white p-4 text-center lg:grid-cols-4">
                        <SummaryBox
                            label="Original Value"
                            value={peso(originalValue)}
                        />

                        <SummaryBox
                            label="Discount"
                            value={
                                isPercentageType
                                    ? `${discountNumber || 0}% • ${peso(calculatedDiscount)}`
                                    : peso(calculatedDiscount)
                            }
                        />

                        <SummaryBox
                            label="Down Payment"
                            value={
                                isPercentageType
                                    ? `${downPaymentInput || 0}% • ${peso(calculatedDownPayment)}`
                                    : peso(calculatedDownPayment)
                            }
                            strong
                        />

                        <SummaryBox
                            label="Final Price"
                            value={peso(packagePrice)}
                            strong
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-xl bg-[#2B174C] py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"
                    >
                        {submitting
                            ? "Saving..."
                            : editingId
                                ? "Update package"
                                : "Save package"}
                    </button>
                </form>
            </div>

            {showFormImagePreview && coverImage && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Expanded package picture"
                    onClick={() => setShowFormImagePreview(false)}
                >
                    <div
                        className="relative flex max-h-[94vh] max-w-[94vw] items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={coverImage}
                            alt="Expanded package cover"
                            className="max-h-[90vh] max-w-[90vw] rounded-[18px] object-contain shadow-2xl"
                        />

                        <button
                            type="button"
                            onClick={() => setShowFormImagePreview(false)}
                            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-lg font-semibold text-[#2B174C] shadow-md transition hover:scale-105 hover:bg-white"
                            aria-label="Close expanded package picture"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Shared form logic hook ───────────────────────────────────────────────────


export function usePackageForm(
    storeId: number | null,
    branchId: number | null,
    onSuccess: () => Promise<void>
) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState<PackageFormCategory>("Other");
    const [coverImage, setCoverImage] = useState("");
    const [duration, setDuration] = useState("");
    const [status, setStatus] = useState<"Active" | "Inactive">("Active");
    const [discountType, setDiscountType] = useState<DiscountType>("amount");
    const [discountValue, setDiscountValue] = useState("");
    const [downPaymentAmount, setDownPaymentAmount] = useState("");
    const [inclusions, setInclusions] = useState<PackageInclusion[]>([]);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [inclusionQty, setInclusionQty] = useState("");

    const originalValue = inclusions.reduce(
        (sum, item) => sum + item.lineValue,
        0
    );

    const discountNumber = Number(discountValue || 0);

    const computedDiscount =
        discountType === "percentage"
            ? originalValue * (discountNumber / 100)
            : discountNumber;

    const discountAmount = Math.min(computedDiscount, originalValue);
    const packagePrice = Math.max(originalValue - discountAmount, 0);

    const downPaymentInput = Number(downPaymentAmount || 0);
    const downPaymentNumber =
        discountType === "percentage"
            ? packagePrice * (downPaymentInput / 100)
            : downPaymentInput;

    function reset() {
        setName("");
        setDescription("");
        setCategory("Other");
        setCoverImage("");
        setDuration("");
        setStatus("Active");
        setDiscountType("amount");
        setDiscountValue("");
        setDownPaymentAmount("");
        setEditingId(null);
        setInclusions([]);
        setSelectedProductId("");
        setInclusionQty("");
        setError("");
    }

    function openAdd() {
        reset();
        setShowForm(true);
    }

    function openEdit(pkg: PackageItem) {
        setEditingId(pkg.id);
        setName(pkg.name);
        setDescription(pkg.description || "");
        setCategory(pkg.category || getPackageCategory(pkg));
        setCoverImage(getPackageCoverImage(pkg));
        setDuration(pkg.duration || "");
        setStatus(pkg.status);

        const savedDiscountType = pkg.discount_type || "amount";
        const savedPackagePrice = Number(pkg.package_price || 0);
        const savedDownPayment = Number(pkg.down_payment_amount || 0);

        setDiscountType(savedDiscountType);
        setDiscountValue(String(pkg.discount_value || 0));
        setDownPaymentAmount(
            savedDiscountType === "percentage" && savedPackagePrice > 0
                ? String(
                    Math.round(
                        (savedDownPayment / savedPackagePrice) * 10000
                    ) / 100
                )
                : String(savedDownPayment)
        );
        setInclusions(pkg.inclusions || []);
        setError("");
        setShowForm(true);
    }

    function handleCoverImageChange(file: File | null) {
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            setError("Please choose a JPG, PNG, or WEBP image.");
            return;
        }

        const maximumFileSize = 2 * 1024 * 1024;

        if (file.size > maximumFileSize) {
            setError("Picture must be 2 MB or smaller.");
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {
            if (typeof reader.result === "string") {
                setCoverImage(reader.result);
                setError("");
            }
        };

        reader.onerror = () => {
            setError("Unable to read the selected picture.");
        };

        reader.readAsDataURL(file);
    }

    function removeCoverImage() {
        setCoverImage("");
    }

    function addInclusion(products: PackageSelectableItem[]) {
        const product = products.find((p) => p.key === selectedProductId);
        const qty = Number(inclusionQty);

        if (!product || qty <= 0) {
            setError("Please select a product or variant and enter a valid quantity.");
            return;
        }

        const existing = inclusions.find(
            (item) => getInclusionKey(item) === product.key
        );

        const totalQty = (existing?.quantity ?? 0) + qty;

        if (totalQty > product.stock) {
            setError(
                `Only ${product.stock} stock available for ${product.displayName}.`
            );
            return;
        }

        const unitSalesPrice = Number(product.salesPrice || 0);

        if (existing) {
            setInclusions((prev) =>
                prev.map((item) =>
                    getInclusionKey(item) === product.key
                        ? {
                            ...item,
                            quantity: totalQty,
                            unitSalesPrice,
                            lineValue: unitSalesPrice * totalQty,
                            availableStock: product.stock,
                        }
                        : item
                )
            );
        } else {
            setInclusions((prev) => [
                ...prev,
                {
                    inventoryKey: product.key,
                    itemType: product.itemType || "consumable",
                    equipmentId: product.equipmentId ?? null,
                    productId: product.productId,
                    variantId: product.variantId ?? null,
                    productName: product.displayName,
                    variantName: product.variantName,
                    quantity: qty,
                    unitSalesPrice,
                    lineValue: unitSalesPrice * qty,
                    availableStock: product.stock,
                },
            ]);
        }

        setSelectedProductId("");
        setInclusionQty("");
        setError("");
    }

    function adjustInclusion(
        product: PackageSelectableItem,
        delta: number
    ) {
        if (!Number.isFinite(delta) || delta === 0) {
            return;
        }

        setInclusions((previous) => {
            const existing = previous.find(
                (item) =>
                    getInclusionKey(item) === product.key
            );

            const currentQuantity =
                existing?.quantity || 0;

            const nextQuantity =
                currentQuantity + delta;

            if (nextQuantity <= 0) {
                return previous.filter(
                    (item) =>
                        getInclusionKey(item) !== product.key
                );
            }

            if (nextQuantity > product.stock) {
                setError(
                    `Only ${product.stock} stock available for ${product.displayName}.`
                );
                return previous;
            }

            const unitSalesPrice =
                Number(product.salesPrice || 0);

            setError("");

            if (existing) {
                return previous.map((item) =>
                    getInclusionKey(item) === product.key
                        ? {
                            ...item,
                            quantity: nextQuantity,
                            unitSalesPrice,
                            lineValue:
                                unitSalesPrice * nextQuantity,
                            availableStock: product.stock,
                        }
                        : item
                );
            }

            return [
                ...previous,
                {
                    inventoryKey: product.key,
                    itemType: product.itemType || "consumable",
                    equipmentId: product.equipmentId ?? null,
                    productId: product.productId,
                    variantId: product.variantId ?? null,
                    productName: product.displayName,
                    variantName: product.variantName,
                    quantity: nextQuantity,
                    unitSalesPrice,
                    lineValue:
                        unitSalesPrice * nextQuantity,
                    availableStock: product.stock,
                },
            ];
        });
    }

    function removeInclusion(key: string) {
        setInclusions((prev) =>
            prev.filter((item) => getInclusionKey(item) !== key)
        );
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (!storeId) {
            setError("Missing store_id.");
            return;
        }

        if (!branchId) {
            setError("Missing branch_id.");
            return;
        }

        if (!name.trim()) {
            setError("Please enter package name.");
            return;
        }

        if (inclusions.length === 0) {
            setError("Please add at least one consumable or rental inclusion.");
            return;
        }

        if (discountNumber < 0) {
            setError("Discount cannot be negative.");
            return;
        }

        if (discountType === "percentage" && discountNumber > 100) {
            setError("Percentage discount cannot exceed 100%.");
            return;
        }

        if (discountType === "amount" && discountNumber > originalValue) {
            setError("Discount cannot exceed original value.");
            return;
        }

        if (downPaymentInput < 0) {
            setError("Down payment cannot be negative.");
            return;
        }

        if (
            discountType === "percentage" &&
            downPaymentInput > 100
        ) {
            setError("Percentage down payment cannot exceed 100%.");
            return;
        }

        if (
            discountType === "amount" &&
            downPaymentNumber > packagePrice
        ) {
            setError("Down payment cannot exceed final package price.");
            return;
        }

        setSubmitting(true);

        try {
            const res = await fetch("/api/packages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`,
                },
                body: JSON.stringify({
                    action: editingId ? "update_package" : "create_package",
                    ...(editingId && { id: editingId }),
                    store_id: storeId,
                    branch_id: branchId,
                    name: name.trim(),
                    description: description.trim(),
                    category,
                    cover_image: coverImage || null,
                    original_value: originalValue,
                    discount_type: discountType,
                    discount_value: discountNumber,
                    package_price: packagePrice,
                    down_payment_amount: downPaymentNumber,
                    duration: duration.trim() || "N/A",
                    status,
                    inclusions,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Failed to save package.");
                return;
            }

            await onSuccess();
            reset();
            setShowForm(false);
        } catch {
            setError("Failed to save package. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id: number) {
        if (!confirm("Delete this package? This action cannot be undone.")) return;

        if (!branchId) {
            alert("Missing branch_id.");
            return;
        }

        try {
            const res = await fetch("/api/packages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`,
                },
                body: JSON.stringify({
                    action: "delete_package",
                    id,
                    branch_id: branchId,
                }),
            });

            if (!res.ok) {
                alert("Failed to delete package.");
                return;
            }

            return id;
        } catch {
            alert("Failed to delete package.");
        }
    }

    return {
        showForm,
        setShowForm,
        editingId,
        submitting,
        error,
        setError,

        name,
        setName,
        description,
        setDescription,
        category,
        setCategory,
        coverImage,
        handleCoverImageChange,
        removeCoverImage,
        duration,
        setDuration,
        status,
        setStatus,
        discountType,
        setDiscountType,
        discountValue,
        setDiscountValue,
        downPaymentAmount,
        setDownPaymentAmount,
        inclusions,
        selectedProductId,
        setSelectedProductId,
        inclusionQty,
        setInclusionQty,

        originalValue,
        packagePrice,

        openAdd,
        openEdit,
        addInclusion,
        adjustInclusion,
        removeInclusion,
        handleSubmit,
        handleDelete,
        reset,
    };
}