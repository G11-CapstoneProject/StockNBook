"use client";

import { useEffect, useMemo, useState } from "react";
import {
    getToken, peso, formatText,
    Card, CardHeader, PageHeader, PackageCard, EmptyState,
    PackageFormModal, usePackageForm,
    type PackageItem, type Product,
} from "./_shared";

export default function ManagerPackages() {
    const [branchName, setBranchName] = useState("Branch");
    const [storeId, setStoreId] = useState<number | null>(null);
    const [branchId, setBranchId] = useState<number | null>(null);
    const [packages, setPackages] = useState<PackageItem[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [error, setError] = useState("");

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
            sessionStorage.getItem("manager_branch_id");

        setBranchName(savedBranchName);

        if (savedStoreId) {
            const store = Number(savedStoreId);
            const branch = savedBranchId ? Number(savedBranchId) : null;
            setStoreId(store);
            setBranchId(branch);
            fetchProducts(store);
            if (branch) {
                fetchPackages(branch);
            } else {
                setLoading(false);
                setError("Missing branch_id. Please check sessionStorage setup.");
            }
        } else {
            setLoading(false);
        }
    }, []);

    async function fetchPackages(branch_id: number) {
        try {
            const res = await fetch("/api/packages", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ action: "get_packages", branch_id }),
            });
            const data = await res.json();
            setPackages(data.packages || []);
        } catch {
            setPackages([]);
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
                        <button
                            onClick={form.openAdd}
                            className="h-[42px] rounded-[10px] bg-[#2D1B4E] px-5 text-[12px] font-semibold text-white transition hover:bg-[#3D2560]"
                        >
                            + Add package
                        </button>
                    </div>

                    <Card className="min-h-[340px]">
                        <CardHeader title="Branch Package List" action={`${filteredPackages.length} packages`} />

                        {error && (
                            <div className="mb-3 rounded-[9px] border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2 text-[11px] font-medium text-[#9B1C1C]">
                                {error}
                            </div>
                        )}

                        {loading ? (
                            <EmptyState title="Loading packages..." detail="Please wait while packages are being loaded." />
                        ) : filteredPackages.length === 0 ? (
                            <EmptyState title="No packages yet." detail="Create your first package using inventory items and discounts." />
                        ) : (
                            <div className="grid grid-cols-[repeat(auto-fill,180px)] gap-2.5">
                                {filteredPackages.map((pkg, index) => (
                                    <PackageCard
                                        key={pkg.id}
                                        pkg={{ ...pkg, name: formatText(pkg.name), description: formatText(pkg.description || "No description") }}
                                        featured={index === 1}
                                        canManage
                                        onEdit={() => form.openEdit(pkg)}
                                        onDelete={() => handleDelete(pkg.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </section>

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
        </>
    );
}