"use client";

import { type ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiscountType = "amount" | "percentage";
export type PackageAccess = "none" | "view" | "full";

export type PackageInclusion = {
    productId: number;
    productName: string;
    quantity: number;
    unitSalesPrice: number;
    lineValue: number;
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
    duration: string;
    status: "Active" | "Inactive";
    inclusions: PackageInclusion[];
};

export type Product = {
    id: number;
    name: string;
    salesPrice: number;
    stock: number;
};

export type BranchFromApi = {
    id: number;
    branch_name: string;
    manager_name?: string;
    manager_status?: string;
};

export type BranchRowData = {
    id: number;
    branch: string;
    manager: string;
    activePackages: number;
    inactivePackages: number;
    lastUpdated: string;
    status: string;
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

// ─── Shared fieldClass ────────────────────────────────────────────────────────

export const fieldClass =
    "h-[40px] w-full rounded-[9px] border border-[#EBE4F0] bg-white px-3 text-[11px] text-[#1A1220] placeholder:text-[#9B8EA8] outline-none transition focus:border-[#2D1B4E]";

// ─── UI Components ────────────────────────────────────────────────────────────

export function Card({
                         children,
                         className = "",
                     }: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={`rounded-[12px] border border-[#EBE4F0] bg-white p-3.5 ${className}`}>
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
            <h2 className="whitespace-nowrap text-[14px] font-medium leading-none text-[#1A1220]">
                {title}
            </h2>
            {action && (
                <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold leading-none text-[#2D1B4E]">
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
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7A6E88]">
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
            <p className="text-[9.5px] text-[#7A6E88]">{label}</p>
            <p className={`mt-0.5 text-[13px] ${strong ? "font-semibold text-[#2D1B4E]" : "font-semibold text-[#1A1220]"}`}>
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
        <div className="flex min-h-[300px] items-center justify-center rounded-[10px] border border-dashed border-[#EBE4F0] bg-[#FDFAF4] px-4 text-center">
            <div>
                <p className="text-[12px] font-semibold text-[#1A1220]">{title}</p>
                <p className="mt-1 text-[10px] leading-4 text-[#7A6E88]">{detail}</p>
            </div>
        </div>
    );
}

export function StatusBadge({ status }: { status: string }) {
    const isPositive =
        status === "Active" || status === "Ready" || status === "active";

    return (
        <span
            className={`shrink-0 rounded-[5px] px-1.5 py-0.5 text-[8.5px] font-semibold ${
                isPositive
                    ? "bg-[#EAF3DE] text-[#27500A]"
                    : "bg-[#E9E1F3] text-[#2D1B4E]"
            }`}
        >
            {status}
        </span>
    );
}

export function PageHeader({
                               title,
                               badge,
                           }: {
    title: string;
    badge: string;
}) {
    return (
        <div className="flex h-[54px] items-center justify-between border-b border-[#EBE4F0] bg-white px-5">
            <div className="flex items-center gap-3">
                <h1 className="text-[18px] font-medium text-[#1A1220]">{title}</h1>
                <span className="rounded-[6px] bg-[#FFFBF0] px-3 py-1 text-[11px] font-medium text-[#633806]">
                    {badge}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <span className="rounded-[7px] border border-[#EBE4F0] bg-white px-4 py-1.5 text-[11px] text-[#7A6E88]">
                    {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </span>
                <button className="flex h-[32px] w-[32px] items-center justify-center rounded-[7px] border border-[#EBE4F0] bg-white text-[12px] text-[#C9951A]">
                    ●
                </button>
                <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#C9951A] text-[12px] font-medium text-white">
                    YS
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
    const shownInclusions = (pkg.inclusions || []).slice(0, 2);
    const moreCount = Math.max((pkg.inclusions || []).length - 2, 0);

    return (
        <div className="overflow-hidden rounded-[10px] border border-[#EBE4F0] bg-white">
            <div className={`px-3 py-2.5 ${featured ? "bg-[#C9951A] text-white" : "bg-[#2D1B4E] text-white"}`}>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-[11.5px] font-semibold leading-4">{pkg.name}</p>
                        <p className="mt-1 text-[15px] font-medium leading-none">{peso(pkg.package_price)}</p>
                    </div>
                    <StatusBadge status={pkg.status} />
                </div>
            </div>

            <div className="px-3 py-2.5">
                <p className="line-clamp-2 min-h-[28px] text-[9.5px] leading-[14px] text-[#7A6E88]">
                    {pkg.description || "No description"}
                </p>

                <div className="mt-2 space-y-0.5">
                    {shownInclusions.length === 0 ? (
                        <p className="text-[9.5px] text-[#7A6E88]">No inclusions listed.</p>
                    ) : (
                        shownInclusions.map((item) => (
                            <p key={item.productId} className="truncate text-[9.5px] leading-[14px] text-[#7A6E88]">
                                {item.productName} × {item.quantity}
                            </p>
                        ))
                    )}
                    {moreCount > 0 && (
                        <p className="text-[9.5px] font-semibold text-[#2D1B4E]">+{moreCount} more</p>
                    )}
                </div>

                <div className="mt-2.5 flex items-center justify-between border-t border-[#F5EEF6] pt-2">
                    <p className="text-[9px] text-[#7A6E88]">{pkg.duration || "N/A"}</p>
                    {canManage ? (
                        <div className="flex gap-2">
                            <button onClick={onEdit} className="text-[9.5px] font-semibold text-[#2D1B4E] hover:underline">
                                Edit
                            </button>
                            <button onClick={onDelete} className="text-[9.5px] font-semibold text-[#9B1C1C] hover:underline">
                                Delete
                            </button>
                        </div>
                    ) : (
                        <p className="text-[9.5px] font-semibold text-[#2D1B4E]">View only</p>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Package Form Modal (shared between Manager + Staff full access) ───────────

export function PackageFormModal({
                                     show,
                                     editingId,
                                     error,
                                     submitting,
                                     name, setName,
                                     description, setDescription,
                                     duration, setDuration,
                                     status, setStatus,
                                     discountType, setDiscountType,
                                     discountValue, setDiscountValue,
                                     inclusions,
                                     products,
                                     selectedProductId, setSelectedProductId,
                                     inclusionQty, setInclusionQty,
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
    name: string; setName: (v: string) => void;
    description: string; setDescription: (v: string) => void;
    duration: string; setDuration: (v: string) => void;
    status: "Active" | "Inactive"; setStatus: (v: "Active" | "Inactive") => void;
    discountType: DiscountType; setDiscountType: (v: DiscountType) => void;
    discountValue: string; setDiscountValue: (v: string) => void;
    inclusions: PackageInclusion[];
    products: Product[];
    selectedProductId: string; setSelectedProductId: (v: string) => void;
    inclusionQty: string; setInclusionQty: (v: string) => void;
    originalValue: number;
    packagePrice: number;
    onAddInclusion: () => void;
    onRemoveInclusion: (id: number) => void;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    onClose: () => void;
}) {
    if (!show) return null;

    const discountNumber = Number(discountValue || 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
            <div className="max-h-[90vh] w-full max-w-[760px] overflow-y-auto rounded-[16px] border border-[#EBE4F0] bg-white p-5 shadow-2xl">
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[18px] font-medium text-[#1A1220]">
                            {editingId ? "Edit package" : "Add package"}
                        </h2>
                        <p className="mt-1 text-[10.5px] leading-4 text-[#7A6E88]">
                            Build a branch package using inventory products, duration, and discount rules.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-[32px] w-[32px] items-center justify-center rounded-[8px] border border-[#EBE4F0] text-[13px] text-[#7A6E88] hover:bg-[#FDFAF4]"
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={onSubmit} className="space-y-3">
                    {error && (
                        <div className="rounded-[9px] border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2 text-[11px] font-medium text-[#9B1C1C]">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Package Name">
                            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Birthday Basic Package" className={fieldClass} />
                        </Field>
                        <Field label="Duration">
                            <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 3 hours" className={fieldClass} />
                        </Field>
                    </div>

                    <Field label="Description">
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Short package details or notes"
                            className={`${fieldClass} min-h-[82px] resize-none py-2`}
                        />
                    </Field>

                    <Card className="bg-[#FDFAF4]">
                        <CardHeader title="Package Inclusions" />
                        <div className="grid grid-cols-[1.7fr_0.65fr_0.55fr] gap-2">
                            <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} className={fieldClass}>
                                <option value="">Select product</option>
                                {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} — {peso(p.salesPrice)} — Stock: {p.stock}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                min="1"
                                value={inclusionQty}
                                onChange={(e) => setInclusionQty(e.target.value)}
                                placeholder="Qty"
                                className={fieldClass}
                            />
                            <button type="button" onClick={onAddInclusion} className="rounded-[8px] bg-[#2D1B4E] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#3D2560]">
                                Add
                            </button>
                        </div>

                        <div className="mt-3 space-y-2">
                            {inclusions.length === 0 ? (
                                <p className="rounded-[9px] border border-dashed border-[#EBE4F0] bg-white px-3 py-4 text-center text-[10px] text-[#7A6E88]">
                                    No inclusions added yet.
                                </p>
                            ) : (
                                inclusions.map((item) => (
                                    <div key={item.productId} className="flex items-center justify-between rounded-[9px] border border-[#F5EEF6] bg-white px-3 py-2">
                                        <div>
                                            <p className="text-[11px] font-semibold text-[#1A1220]">
                                                {item.productName} × {item.quantity}
                                            </p>
                                            <p className="mt-0.5 text-[9.5px] text-[#7A6E88]">
                                                {peso(item.unitSalesPrice)} each · {peso(item.lineValue)} total
                                            </p>
                                        </div>
                                        <button type="button" onClick={() => onRemoveInclusion(item.productId)} className="text-[10px] font-semibold text-[#9B1C1C] hover:underline">
                                            Remove
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </Card>

                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Discount Type">
                            <select value={discountType} onChange={(e) => { setDiscountType(e.target.value as DiscountType); setDiscountValue(""); }} className={fieldClass}>
                                <option value="amount">Amount</option>
                                <option value="percentage">Percentage</option>
                            </select>
                        </Field>
                        <Field label={discountType === "percentage" ? "Discount (%)" : "Discount (₱)"}>
                            <input
                                type="number"
                                min="0"
                                max={discountType === "percentage" ? 100 : originalValue}
                                value={discountValue}
                                onChange={(e) => setDiscountValue(e.target.value)}
                                placeholder={discountType === "percentage" ? "e.g. 10" : "e.g. 500"}
                                className={fieldClass}
                            />
                        </Field>
                        <Field label="Status">
                            <select value={status} onChange={(e) => setStatus(e.target.value as "Active" | "Inactive")} className={fieldClass}>
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                        </Field>
                    </div>

                    <div className="grid grid-cols-3 gap-3 rounded-[12px] border border-[#EBE4F0] bg-[#FDFAF4] p-3 text-center">
                        <SummaryBox label="Original Value" value={peso(originalValue)} />
                        <SummaryBox
                            label="Discount"
                            value={discountType === "percentage" ? `${discountNumber || 0}%` : peso(discountNumber)}
                        />
                        <SummaryBox label="Final Price" value={peso(packagePrice)} strong />
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-[10px] bg-[#2D1B4E] py-2.5 text-[12px] font-semibold text-white transition hover:bg-[#3D2560] disabled:opacity-60"
                    >
                        {submitting ? "Saving..." : editingId ? "Update package" : "Save package"}
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
    const [duration, setDuration] = useState("");
    const [status, setStatus] = useState<"Active" | "Inactive">("Active");
    const [discountType, setDiscountType] = useState<DiscountType>("amount");
    const [discountValue, setDiscountValue] = useState("");
    const [inclusions, setInclusions] = useState<PackageInclusion[]>([]);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [inclusionQty, setInclusionQty] = useState("");

    const { useState: _u } = { useState };

    const originalValue = inclusions.reduce((sum, item) => sum + item.lineValue, 0);
    const discountNumber = Number(discountValue || 0);
    const computedDiscount =
        discountType === "percentage"
            ? originalValue * (discountNumber / 100)
            : discountNumber;
    const discountAmount = Math.min(computedDiscount, originalValue);
    const packagePrice = Math.max(originalValue - discountAmount, 0);

    function reset() {
        setName(""); setDescription(""); setDuration("");
        setStatus("Active"); setDiscountType("amount"); setDiscountValue("");
        setEditingId(null); setInclusions([]);
        setSelectedProductId(""); setInclusionQty(""); setError("");
    }

    function openAdd() { reset(); setShowForm(true); }

    function openEdit(pkg: PackageItem) {
        setEditingId(pkg.id);
        setName(pkg.name);
        setDescription(pkg.description || "");
        setDuration(pkg.duration || "");
        setStatus(pkg.status);
        setDiscountType(pkg.discount_type || "amount");
        setDiscountValue(String(pkg.discount_value || 0));
        setInclusions(pkg.inclusions || []);
        setError("");
        setShowForm(true);
    }

    function addInclusion(products: Product[]) {
        const product = products.find((p) => p.id === Number(selectedProductId));
        const qty = Number(inclusionQty);
        if (!product || qty <= 0) { setError("Please select a product and enter a valid quantity."); return; }

        const existing = inclusions.find((item) => item.productId === product.id);
        const totalQty = (existing?.quantity ?? 0) + qty;
        const unitSalesPrice = Number(product.salesPrice || 0);
        const lineValue = unitSalesPrice * totalQty;

        if (existing) {
            setInclusions((prev) => prev.map((item) => item.productId === product.id ? { ...item, quantity: totalQty, unitSalesPrice, lineValue } : item));
        } else {
            setInclusions((prev) => [...prev, { productId: product.id, productName: product.name, quantity: qty, unitSalesPrice, lineValue: unitSalesPrice * qty }]);
        }
        setSelectedProductId(""); setInclusionQty(""); setError("");
    }

    function removeInclusion(productId: number) {
        setInclusions((prev) => prev.filter((item) => item.productId !== productId));
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!storeId) { setError("Missing store_id."); return; }
        if (!branchId) { setError("Missing branch_id."); return; }
        if (!name.trim()) { setError("Please enter package name."); return; }
        if (inclusions.length === 0) { setError("Please add at least one product inclusion."); return; }
        if (discountNumber < 0) { setError("Discount cannot be negative."); return; }
        if (discountType === "percentage" && discountNumber > 100) { setError("Percentage discount cannot exceed 100%."); return; }
        if (discountType === "amount" && discountNumber > originalValue) { setError("Discount cannot exceed original value."); return; }

        setSubmitting(true);
        try {
            const res = await fetch("/api/packages", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({
                    action: editingId ? "update_package" : "create_package",
                    ...(editingId && { id: editingId }),
                    store_id: storeId, branch_id: branchId,
                    name: name.trim(), description: description.trim(),
                    original_value: originalValue, discount_type: discountType,
                    discount_value: discountNumber, package_price: packagePrice,
                    duration: duration.trim() || "N/A", status, inclusions,
                }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || "Failed to save package."); return; }
            await onSuccess();
            reset(); setShowForm(false);
        } catch {
            setError("Failed to save package. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id: number) {
        if (!confirm("Delete this package? This action cannot be undone.")) return;
        if (!branchId) { alert("Missing branch_id."); return; }
        try {
            const res = await fetch("/api/packages", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ action: "delete_package", id, branch_id: branchId }),
            });
            if (!res.ok) { alert("Failed to delete package."); return; }
            return id;
        } catch {
            alert("Failed to delete package.");
        }
    }

    return {
        // form visibility
        showForm, setShowForm,
        editingId,
        submitting,
        error, setError,
        // fields
        name, setName,
        description, setDescription,
        duration, setDuration,
        status, setStatus,
        discountType, setDiscountType,
        discountValue, setDiscountValue,
        inclusions,
        selectedProductId, setSelectedProductId,
        inclusionQty, setInclusionQty,
        // computed
        originalValue, packagePrice,
        // actions
        openAdd, openEdit, addInclusion, removeInclusion, handleSubmit, handleDelete, reset,
    };
}

// Need to import useState for the hook above
import { useState } from "react";