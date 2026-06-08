"use client";

import { useEffect, useMemo, useState } from "react";
import {
    getToken, peso, formatText, getSavedPackageAccess,
    Card, CardHeader, PageHeader, PackageCard, EmptyState,
    PackageFormModal, usePackageForm,
    type PackageItem, type Product, type PackageAccess,
} from "./_shared";

export default function StaffPackages() {
    const [branchName, setBranchName] = useState("Branch");
    const [storeId, setStoreId] = useState<number | null>(null);
    const [branchId, setBranchId] = useState<number | null>(null);
    const [packages, setPackages] = useState<PackageItem[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [error, setError] = useState("");
    const [packageAccess, setPackageAccess] = useState<PackageAccess>("none");

    const canView = packageAccess === "view" || packageAccess === "full";
    const canManage = packageAccess === "full";

    const form = usePackageForm(storeId, branchId, async () => {
        if (branchId) await fetchPackages(branchId);
    });

    useEffect(() => {
        const savedBranchName =
            sessionStorage.getItem("branch_name") ||
            sessionStorage.getItem("store_name") ||
            "Branch";
        const savedStoreId = sessionStorage.getItem("store_id");
        const savedBranchId =
            sessionStorage.getItem("branch_id") ||
            sessionStorage.getItem("staff_branch_id") ||
            sessionStorage.getItem("manager_branch_id");
        const savedAccess = getSavedPackageAccess();

        setBranchName(savedBranchName);
        setPackageAccess(savedAccess);

        if (savedStoreId) {
            const store = Number(savedStoreId);
            setStoreId(store);
            if (savedAccess === "full") fetchProducts(store);
        }

        if (savedBranchId) {
            const branch = Number(savedBranchId);
            setBranchId(branch);
            if (savedAccess === "view" || savedAccess === "full") {
                fetchPackages(branch);
            } else {
                setLoading(false);
            }
        } else {
            setLoading(false);
            setError("Missing branch_id. Please refresh or log in again.");
        }
    }, []);

    async function fetchPackages(branch_id: number) {
        try {
            setLoading(true);
            const res = await fetch("/api/packages", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ action: "get_packages", branch_id }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || "Failed to load packages."); setPackages([]); return; }
            setPackages(data.packages || []);
            setError("");
        } catch {
            setPackages([]);
            setError("Failed to load packages.");
        } finally {
            setLoading(false);
        }
    }

    async function fetchProducts(store_id: number) {
        try {
            const res = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ action: "get_products", store_id }),
            });
            const data = await res.json();
            setProducts(data.products || []);
        } catch {
            setProducts([]);
        }
    }

    async function handleDelete(id: number) {
        if (!canManage) return;
        const deletedId = await form.handleDelete(id);
        if (deletedId) setPackages((prev) => prev.filter((pkg) => pkg.id !== deletedId));
    }

    const filteredPackages = useMemo(() => {
        const q = search.trim().toLowerCase();
        return packages.filter(
            (pkg) =>
                pkg.name.toLowerCase().includes(q) ||
                (pkg.description || "").toLowerCase().includes(q) ||
                (pkg.duration || "").toLowerCase().includes(q) ||
                pkg.status.toLowerCase().includes(q)
        );
    }, [packages, search]);

    return (
        <>
            <PageHeader title="Packages" badge={branchName} />

            <section className="p-5">
                <div className="space-y-3">
                    <div className="flex gap-3">
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search packages..."
                            className="h-[42px] flex-1 rounded-[10px] border border-[#EBE4F0] bg-white px-4 text-[12px] text-[#1A1220] placeholder:text-[#9B8EA8] outline-none transition focus:border-[#2D1B4E]"
                        />
                        {canManage ? (
                            <button
                                onClick={form.openAdd}
                                className="h-[42px] rounded-[10px] bg-[#2D1B4E] px-5 text-[12px] font-semibold text-white transition hover:bg-[#3D2560]"
                            >
                                + Add package
                            </button>
                        ) : (
                            <button
                                onClick={() => branchId && fetchPackages(branchId)}
                                className="h-[42px] rounded-[10px] border border-[#EBE4F0] bg-white px-4 text-[12px] font-semibold text-[#2D1B4E] transition hover:bg-[#EEE8F8]"
                            >
                                Refresh
                            </button>
                        )}
                    </div>

                    <Card className="min-h-[340px]">
                        <CardHeader title="Branch Package List" action={`${filteredPackages.length} packages`} />

                        {error && (
                            <div className="mb-3 rounded-[9px] border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2 text-[11px] font-medium text-[#9B1C1C]">
                                {error}
                            </div>
                        )}

                        {!canView ? (
                            <EmptyState title="No package access." detail="Please contact your manager to update your staff package access." />
                        ) : loading ? (
                            <EmptyState title="Loading packages..." detail="Please wait while packages are being loaded." />
                        ) : filteredPackages.length === 0 ? (
                            <EmptyState
                                title={canManage ? "No packages yet." : "No packages available."}
                                detail={canManage ? "Create your first package using inventory items and discounts." : "No active package setup is currently available for this branch."}
                            />
                        ) : (
                            <div className="grid grid-cols-[repeat(auto-fill,180px)] gap-2.5">
                                {filteredPackages.map((pkg, index) => (
                                    <PackageCard
                                        key={pkg.id}
                                        pkg={{
                                            ...pkg,
                                            name: formatText(pkg.name),
                                            description: formatText(pkg.description || "No description"),
                                            duration: formatText(pkg.duration || "N/A"),
                                            inclusions: (pkg.inclusions || []).map((item) => ({
                                                ...item,
                                                productName: formatText(item.productName),
                                            })),
                                        }}
                                        featured={index === 1}
                                        canManage={canManage}
                                        onEdit={() => canManage && form.openEdit(pkg)}
                                        onDelete={() => handleDelete(pkg.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </section>

            {canManage && (
                <PackageFormModal
                    show={form.showForm}
                    editingId={form.editingId}
                    error={form.error}
                    submitting={form.submitting}
                    name={form.name} setName={form.setName}
                    description={form.description} setDescription={form.setDescription}
                    duration={form.duration} setDuration={form.setDuration}
                    status={form.status} setStatus={form.setStatus}
                    discountType={form.discountType} setDiscountType={form.setDiscountType}
                    discountValue={form.discountValue} setDiscountValue={form.setDiscountValue}
                    inclusions={form.inclusions}
                    products={products}
                    selectedProductId={form.selectedProductId} setSelectedProductId={form.setSelectedProductId}
                    inclusionQty={form.inclusionQty} setInclusionQty={form.setInclusionQty}
                    originalValue={form.originalValue}
                    packagePrice={form.packagePrice}
                    onAddInclusion={() => form.addInclusion(products)}
                    onRemoveInclusion={form.removeInclusion}
                    onSubmit={form.handleSubmit}
                    onClose={() => { form.reset(); form.setShowForm(false); }}
                />
            )}
        </>
    );
}