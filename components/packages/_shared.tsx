import { CalendarDays, ChevronDown, ImagePlus, RefreshCw } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

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
    salesPrice?: number;
    sales_price?: number;
    stock?: number;
    hasVariants?: boolean;
    has_variants?: boolean;
    variants?: ProductVariant[];
};

export type PackageSelectableItem = {
    key: string;
    productId: number;
    variantId?: number | null;
    productName: string;
    variantName?: string;
    displayName: string;
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
        <div className={`rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm ${className}`}>
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
    const inclusionCount = (pkg.inclusions || []).length;
    const packageCategory = getPackageCategory(pkg);

    const packageText = `${pkg.name} ${pkg.description || ""}`.toLowerCase();

    const coverImage = pkg.cover_image || (packageText.includes("wedding")
        ? "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=900&q=85"
        : packageText.includes("birthday")
            ? "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=900&q=85"
            : packageText.includes("graduation")
                ? "https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=900&q=85"
                : packageText.includes("christening") || packageText.includes("baby")
                    ? "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=900&q=85"
                    : packageText.includes("corporate")
                        ? "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=85"
                        : "https://images.unsplash.com/photo-1507504031003-b417219a0fde?auto=format&fit=crop&w=900&q=85");

    const discountLabel =
        pkg.discount_type === "percentage"
            ? `${Number(pkg.discount_value || 0)}%`
            : peso(pkg.discount_value || 0);

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
                                <rect x="4" y="7" width="16" height="13" rx="2" />
                                <path d="M4 11h16" />
                                <path d="M9 4v5" />
                                <path d="M15 4v5" />
                            </svg>
                            <span>
                                {inclusionCount}{" "}
                                {inclusionCount === 1 ? "Item" : "Items"}
                            </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-[#7A6A84]">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                            >
                                <circle cx="12" cy="12" r="8.5" />
                                <path d="M12 7.5v4.8l3.1 1.9" />
                            </svg>
                            <span>{pkg.duration || "N/A"}</span>
                        </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-[#EFE7F4] pt-3">
                        <span className="text-xs font-semibold text-[#2B174C] transition group-hover:translate-x-0.5">
                            View details →
                        </span>

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
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${pkg.name} package details`}
                    onClick={() => setShowDetails(false)}
                >
                    <div
                        className="max-h-[90vh] w-full max-w-[620px] overflow-y-auto rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="relative h-[190px] overflow-hidden bg-[#2D1B4E]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={coverImage}
                                alt={`${pkg.name} package cover`}
                                className="h-full w-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#160C27]/80 to-transparent" />

                            <button
                                type="button"
                                onClick={() => setShowDetails(false)}
                                className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 text-base font-semibold text-[#2B174C] shadow-sm hover:bg-white"
                                aria-label="Close package details"
                            >
                                ×
                            </button>

                            <div className="absolute bottom-4 left-5 right-5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/75">
                                    Package details
                                </p>
                                <h2 className="mt-1 text-[24px] font-bold text-white">
                                    {pkg.name}
                                </h2>
                            </div>
                        </div>

                        <div className="p-5">
                            <div className="grid gap-3 sm:grid-cols-2">
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
                                    label="Duration"
                                    value={pkg.duration || "N/A"}
                                />
                                <DetailBox
                                    label="Category"
                                    value={packageCategory}
                                />
                                <DetailBox
                                    label="Included Items"
                                    value={`${inclusionCount} ${
                                        inclusionCount === 1 ? "item" : "items"
                                    }`}
                                />
                            </div>

                            <div className="mt-5">
                                <h3 className="text-sm font-bold text-[#1A1220]">
                                    Description
                                </h3>
                                <p className="mt-1 text-sm leading-6 text-[#7A6A84]">
                                    {pkg.description || "No description provided."}
                                </p>
                            </div>

                            <div className="mt-5">
                                <h3 className="text-sm font-bold text-[#1A1220]">
                                    Package Inclusions
                                </h3>

                                <div className="mt-2 space-y-2">
                                    {inclusionCount === 0 ? (
                                        <p className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7] px-3 py-3 text-sm text-[#7A6A84]">
                                            No inclusions listed.
                                        </p>
                                    ) : (
                                        (pkg.inclusions || []).map((item) => (
                                            <div
                                                key={getInclusionKey(item)}
                                                className="flex items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] px-3 py-2.5"
                                            >
                                                <div>
                                                    <p className="text-sm font-semibold text-[#1A1220]">
                                                        {item.productName}
                                                    </p>
                                                    <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                        {peso(item.unitSalesPrice)} each
                                                    </p>
                                                </div>

                                                <div className="text-right">
                                                    <p className="text-sm font-bold text-[#2B174C]">
                                                        × {item.quantity}
                                                    </p>
                                                    <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                        {peso(item.lineValue)}
                                                    </p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="mt-5 flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => setShowDetails(false)}
                                    className="rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1B0D31]"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
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
        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] px-3 py-2.5">
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
                                     selectedProductId,
                                     setSelectedProductId,
                                     inclusionQty,
                                     setInclusionQty,
                                     originalValue,
                                     packagePrice,
                                     onAddInclusion,
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
    selectedProductId: string;
    setSelectedProductId: (value: string) => void;
    inclusionQty: string;
    setInclusionQty: (value: string) => void;
    originalValue: number;
    packagePrice: number;
    onAddInclusion: () => void;
    onRemoveInclusion: (key: string) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    onClose: () => void;
}) {
    if (!show) return null;

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

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm">
            <div className="max-h-[90vh] w-full max-w-[760px] overflow-y-auto rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-2xl">
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[19px] font-bold text-[#1A1220]">
                            {editingId ? "Edit package" : "Add package"}
                        </h2>

                        <p className="mt-1 text-sm leading-5 text-[#7A6A84]">
                            Build a branch package using inventory products,
                            category, picture, duration, discount rules, and
                            required down payment.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E6DDF0] text-base text-[#7A6A84] hover:bg-[#F7F1FF]"
                        aria-label="Close package form"
                    >
                        ×
                    </button>
                </div>

                <form onSubmit={onSubmit} className="space-y-3">
                    {error && (
                        <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2.5 text-xs font-medium text-[#9B1C1C]">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
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
                    </div>

                    <Field label="Description">
                        <textarea
                            value={description}
                            onChange={(event) =>
                                setDescription(event.target.value)
                            }
                            placeholder="Short package details or notes"
                            className={`${fieldClass} min-h-[82px] resize-none py-2`}
                        />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
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

                        <div>
                            <span className="mb-1 block text-xs font-semibold text-[#806A8C]">
                                Package Picture
                            </span>

                            <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#D9CBE6] bg-[#FFFCF7] px-4 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:border-[#2B174C] hover:bg-[#F7F1FF]">
                                <ImagePlus size={16} />
                                {coverImage ? "Change picture" : "Upload picture"}

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

                            <p className="mt-1 text-[11px] text-[#7A6A84]">
                                JPG, PNG, or WEBP. Maximum file size: 2 MB.
                            </p>
                        </div>
                    </div>

                    {coverImage && (
                        <div className="overflow-hidden rounded-xl border border-[#E6DDF0] bg-[#FFFCF7]">
                            <div className="flex h-52 items-center justify-center bg-[#F7F1FF] p-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={coverImage}
                                    alt="Selected package cover preview"
                                    className="h-full w-full rounded-lg object-contain"
                                />
                            </div>

                            <div className="flex items-center justify-between gap-4 border-t border-[#E6DDF0] px-3 py-2.5">
                                <div>
                                    <p className="text-sm font-semibold text-[#1A1220]">
                                        Package picture selected
                                    </p>
                                    <p className="mt-0.5 text-xs text-[#7A6A84]">
                                        This larger preview is the picture that will be used for the package cover.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={onRemoveCoverImage}
                                    className="shrink-0 text-xs font-semibold text-red-500 hover:underline"
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    )}

                    <Card className="bg-[#FDFAF4]">
                        <CardHeader title="Package Inclusions" />

                        <div className="grid grid-cols-[1.7fr_0.65fr_0.55fr] gap-2">
                            <select
                                value={selectedProductId}
                                onChange={(event) =>
                                    setSelectedProductId(event.target.value)
                                }
                                className={fieldClass}
                            >
                                <option value="">Select product or variant</option>

                                {products.map((product) => (
                                    <option
                                        key={product.key}
                                        value={product.key}
                                        disabled={product.stock <= 0}
                                    >
                                        {product.displayName} — {peso(product.salesPrice)} —{" "}
                                        {product.stock <= 0
                                            ? "Unavailable"
                                            : `Stock: ${product.stock}`}
                                    </option>
                                ))}
                            </select>

                            <input
                                type="number"
                                min="1"
                                value={inclusionQty}
                                onChange={(event) =>
                                    setInclusionQty(event.target.value)
                                }
                                placeholder="Qty"
                                className={fieldClass}
                            />

                            <button
                                type="button"
                                onClick={onAddInclusion}
                                className="rounded-xl bg-[#2B174C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1B0D31]"
                            >
                                Add
                            </button>
                        </div>

                        <div className="mt-3 space-y-2">
                            {inclusions.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-[#E6DDF0] bg-white px-3 py-4 text-center text-xs text-[#7A6A84]">
                                    No inclusions added yet.
                                </p>
                            ) : (
                                inclusions.map((item) => (
                                    <div
                                        key={getInclusionKey(item)}
                                        className="flex items-center justify-between rounded-xl border border-[#E6DDF0] bg-white px-3 py-2.5"
                                    >
                                        <div>
                                            <p className="text-sm font-semibold text-[#1A1220]">
                                                {item.productName} ×{" "}
                                                {item.quantity}
                                            </p>

                                            <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                {peso(item.unitSalesPrice)} each ·{" "}
                                                {peso(item.lineValue)} total
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                onRemoveInclusion(getInclusionKey(item))
                                            }
                                            className="text-xs font-semibold text-red-500 hover:underline"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </Card>

                    <div className="grid grid-cols-4 gap-3">
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

                    <div className="grid grid-cols-4 gap-3 rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] p-3 text-center">
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
        setCoverImage(pkg.cover_image || "");
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
            setError("Please add at least one product inclusion.");
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
        removeInclusion,
        handleSubmit,
        handleDelete,
        reset,
    };
}