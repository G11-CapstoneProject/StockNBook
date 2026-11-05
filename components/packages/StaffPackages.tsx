"use client";

import { Search } from "lucide-react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import { useEffect, useMemo, useState } from "react";
import {
    getToken,
    formatText,
    getSavedPackageAccess,
    getPackageCategory,
    buildPackageSelectableItems,
    PACKAGE_CATEGORY_OPTIONS,
    Card,
    CardHeader,
    PackageCard,
    EmptyState,
    PackageFormModal,
    usePackageForm,
    type PackageAccess,
    type PackageCategory,
    type PackageItem,
    type Product,
} from "./_shared";

function formatCurrentDateTime(value: Date) {
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

export default function StaffPackages() {
    const [branchName, setBranchName] = useState("Branch");
    const [storeId, setStoreId] = useState<number | null>(null);
    const [branchId, setBranchId] = useState<number | null>(null);
    const [packages, setPackages] = useState<PackageItem[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] =
        useState<PackageCategory>("All");
    const [selectedStatus, setSelectedStatus] = useState<"All" | "Active" | "Inactive">("All");
    const [error, setError] = useState("");
    const [packageAccess, setPackageAccess] = useState<PackageAccess>("none");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const canView = packageAccess === "view" || packageAccess === "full";
    const canManage = packageAccess === "full";

    const form = usePackageForm(storeId, branchId, async () => {
        if (branchId) await fetchPackages(branchId);
    });

    const packageProducts = useMemo(
        () => buildPackageSelectableItems(products, branchId),
        [products, branchId]
    );

    async function fetchPackages(branch_id: number) {
        try {
            setLoading(true);

            const res = await fetch("/api/packages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`,
                },
                body: JSON.stringify({ action: "get_packages", branch_id }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Failed to load plans.");
                setPackages([]);
                return;
            }

            setPackages(Array.isArray(data.packages) ? data.packages : []);
            setError("");
        } catch {
            setPackages([]);
            setError("Failed to load plans.");
        } finally {
            setLoading(false);
        }
    }

    async function fetchProducts(store_id: number, branch_id?: number | null) {
        try {
            const res = await fetch("/api/products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`,
                },
                body: JSON.stringify({
                    action: "get_products",
                    store_id,
                    ...(branch_id ? { branch_id } : {}),
                }),
            });

            const data = await res.json();
            setProducts(Array.isArray(data.products) ? data.products : []);
        } catch {
            setProducts([]);
        }
    }

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

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

        const branch = savedBranchId ? Number(savedBranchId) : null;

        setBranchName(savedBranchName);
        setPackageAccess(savedAccess);

        if (savedStoreId) {
            const store = Number(savedStoreId);

            setStoreId(store);

            if (savedAccess === "full") {
                void fetchProducts(store, branch);
            }
        }

        if (branch) {
            setBranchId(branch);

            if (savedAccess === "view" || savedAccess === "full") {
                void fetchPackages(branch);
            } else {
                setLoading(false);
            }
        } else {
            setLoading(false);
            setError("Missing branch_id. Please refresh or log in again.");
        }
    }, []);

    async function handleDelete(id: number) {
        if (!canManage) return;

        const deletedId = await form.handleDelete(id);

        if (deletedId) {
            setPackages((prev) => prev.filter((pkg) => pkg.id !== deletedId));
        }
    }

    const filteredPackages = useMemo(() => {
        const query = search.trim().toLowerCase();

        return packages.filter((pkg) => {
            const matchesSearch =
                !query ||
                pkg.name.toLowerCase().includes(query) ||
                (pkg.description || "").toLowerCase().includes(query) ||
                (pkg.duration || "").toLowerCase().includes(query) ||
                pkg.status.toLowerCase().includes(query);

            const matchesCategory =
                selectedCategory === "All" ||
                getPackageCategory(pkg) === selectedCategory;
            const matchesStatus = selectedStatus === "All" ||
                String(pkg.status || "").toLowerCase() === selectedStatus.toLowerCase();

            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [packages, search, selectedCategory, selectedStatus]);

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <h1 className="text-[25px] font-bold text-[#1A1220]">
                            Packages
                        </h1>

                        <span
                            title={branchName}
                            className="max-w-[220px] truncate rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]"
                        >
                            {branchName}
                        </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime ? formatCurrentDateTime(currentDateTime) : "Loading date..."}
                        </span>
                    </div>
                </div>
            </header>

            <section className="px-6 py-4 font-sans">
                <div className="space-y-3">
                    <Card className="min-h-[420px]">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <CardHeader title="Branch Package List" action={`${filteredPackages.length} packages`} />
                            {canManage && (
                                <button type="button" onClick={form.openAdd}
                                        className="inline-flex h-[38px] items-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]">
                                    + Add Package
                                </button>
                            )}
                        </div>

                        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_210px_180px]">
                            <div className="relative min-w-0">
                                <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search packages..."
                                    className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white px-4 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                                />
                            </div>
                            <select
                                aria-label="Filter packages by category"
                                value={selectedCategory}
                                onChange={(event) => setSelectedCategory(event.target.value as PackageCategory)}
                                className="h-[42px] min-w-0 w-full rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm font-medium text-[#2B174C] outline-none shadow-sm focus:border-[#2B174C]"
                            >
                                {PACKAGE_CATEGORY_OPTIONS.map((category) => (
                                    <option key={category} value={category}>{category === "All" ? "All Categories" : category}</option>
                                ))}
                            </select>
                            <select
                                aria-label="Filter packages by status"
                                value={selectedStatus}
                                onChange={(event) => setSelectedStatus(event.target.value as "All" | "Active" | "Inactive")}
                                className="h-[42px] min-w-0 w-full rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm font-medium text-[#2B174C] outline-none shadow-sm focus:border-[#2B174C]"
                            >
                                <option value="All">All Status</option>
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                        </div>


                        {error && (
                            <div className="mb-3 rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2.5 text-xs font-medium text-[#9B1C1C]">
                                {error}
                            </div>
                        )}

                        {!canView ? (
                            <EmptyState
                                title="No package access."
                                detail="Please contact your manager to update your staff package access."
                            />
                        ) : loading && packages.length === 0 ? (
                            <ModuleSkeleton variant="packages" />
                        ) : filteredPackages.length === 0 ? (
                            <EmptyState
                                title={search || selectedCategory !== "All" || selectedStatus !== "All"
                                    ? "No matching packages."
                                    : canManage ? "No plans yet." : "No plans available."}
                                detail={search || selectedCategory !== "All" || selectedStatus !== "All"
                                    ? "Try different search, category, or status filters."
                                    : canManage
                                        ? "Create your first package using inventory items and discounts."
                                        : "No package setup is currently available for this branch."}
                            />
                        ) : (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {filteredPackages.map((pkg, index) => (
                                    <PackageCard
                                        key={pkg.id}
                                        pkg={{
                                            ...pkg,
                                            name: formatText(pkg.name),
                                            description: formatText(
                                                pkg.description || "No description"
                                            ),
                                            duration: formatText(pkg.duration || "N/A"),
                                            inclusions: (pkg.inclusions || []).map(
                                                (item) => ({
                                                    ...item,
                                                    productName: formatText(
                                                        item.productName
                                                    ),
                                                })
                                            ),
                                        }}
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
                    name={form.name}
                    setName={form.setName}
                    description={form.description}
                    setDescription={form.setDescription}
                    category={form.category}
                    setCategory={form.setCategory}
                    coverImage={form.coverImage}
                    onCoverImageChange={form.handleCoverImageChange}
                    onRemoveCoverImage={form.removeCoverImage}
                    duration={form.duration}
                    setDuration={form.setDuration}
                    status={form.status}
                    setStatus={form.setStatus}
                    discountType={form.discountType}
                    setDiscountType={form.setDiscountType}
                    discountValue={form.discountValue}
                    setDiscountValue={form.setDiscountValue}
                    downPaymentAmount={form.downPaymentAmount}
                    setDownPaymentAmount={form.setDownPaymentAmount}
                    inclusions={form.inclusions}
                    products={packageProducts}
                    storeId={storeId}
                    branchId={branchId}
                    selectedProductId={form.selectedProductId}
                    setSelectedProductId={form.setSelectedProductId}
                    inclusionQty={form.inclusionQty}
                    setInclusionQty={form.setInclusionQty}
                    originalValue={form.originalValue}
                    packagePrice={form.packagePrice}
                    onAddInclusion={() => form.addInclusion(packageProducts)}
                    onAdjustInclusion={form.adjustInclusion}
                    onRemoveInclusion={form.removeInclusion}
                    onSubmit={form.handleSubmit}
                    onClose={() => {
                        form.reset();
                        form.setShowForm(false);
                    }}
                />
            )}
        </>
    );
}