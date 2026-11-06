"use client";

import { Boxes, CheckCircle2, CircleOff, Download, RefreshCw, Search } from "lucide-react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import { useEffect, useMemo, useState } from "react";
import {
    getToken,
    downloadPackagesPdf,
    formatText,
    getPackageCategory,
    buildPackageSelectableItems,
    PACKAGE_CATEGORY_OPTIONS,
    Card,
    PackageCard,
    PackageSummaryCard,
    EmptyState,
    PackageFormModal,
    usePackageForm,
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

export default function ManagerPackages() {
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
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const form = usePackageForm(storeId, branchId, async () => {
        if (branchId) await fetchPackages(branchId);
    });

    const packageProducts = useMemo(
        () => buildPackageSelectableItems(products, branchId),
        [products, branchId]
    );

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
            sessionStorage.getItem("manager_branch_id");

        setBranchName(savedBranchName);

        if (savedStoreId) {
            const store = Number(savedStoreId);
            const branch = savedBranchId ? Number(savedBranchId) : null;

            setStoreId(store);
            setBranchId(branch);

            void fetchProducts(store, branch);

            if (branch) {
                void fetchPackages(branch);
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
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`,
                },
                body: JSON.stringify({ action: "get_packages", branch_id }),
            });

            const data = await res.json();
            setPackages(Array.isArray(data.packages) ? data.packages : []);
        } catch {
            setPackages([]);
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

    async function handleRefresh() {
        setIsRefreshing(true);

        try {
            await Promise.all([
                storeId ? fetchProducts(storeId, branchId) : Promise.resolve(),
                branchId ? fetchPackages(branchId) : Promise.resolve(),
            ]);
        } finally {
            setIsRefreshing(false);
        }
    }

    async function handleDelete(id: number) {
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

    const totalPackages = packages.length;
    const activePackages = packages.filter((pkg) => String(pkg.status || "").toLowerCase() === "active").length;
    const inactivePackages = packages.filter((pkg) => String(pkg.status || "").toLowerCase() === "inactive").length;

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
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            type="button"
                            onClick={() => void handleRefresh()}
                            disabled={isRefreshing}
                            aria-label="Refresh packages"
                            title="Refresh packages"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <RefreshCw
                                size={16}
                                className={isRefreshing ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-6 py-4 font-sans">
                <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                        <PackageSummaryCard title="Total Packages" value={totalPackages}
                                            detail="Packages in your assigned branch"
                                            icon={<Boxes size={20} />} iconClassName="bg-[#F0E9FF] text-[#5A35A5]" />
                        <PackageSummaryCard title="Active Packages" value={activePackages}
                                            detail="Available for customer booking"
                                            icon={<CheckCircle2 size={20} />} iconClassName="bg-[#E7F7ED] text-[#168447]" />
                        <PackageSummaryCard title="Inactive Packages" value={inactivePackages}
                                            detail="Not currently available"
                                            icon={<CircleOff size={20} />} iconClassName="bg-[#FFF1E5] text-[#C9781B]" />
                    </div>

                    <Card className="min-h-[420px]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h2 className="text-[16px] font-bold text-[#1A1220]">Branch Package List</h2>
                            <button
                                type="button"
                                onClick={() => void downloadPackagesPdf(filteredPackages, {
                                    scopeLabel: branchName,
                                    branchNameForPackage: () => branchName,
                                    fileName: `stocknbook-packages-branch-${branchId || "assigned"}.pdf`,
                                }).catch((reason) => alert(reason instanceof Error ? reason.message : "Unable to download package PDF."))}
                                disabled={loading || filteredPackages.length === 0}
                                className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-[#E3D8EA] bg-white text-[#5A35A5] shadow-sm transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                                title="Download all matching branch packages as PDF"
                                aria-label="Download all matching branch packages as PDF"
                            >
                                <Download size={18} />
                            </button>
                        </div>

                        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_190px_160px_170px]">
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
                            <button type="button" onClick={form.openAdd}
                                    className="inline-flex h-[42px] items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]">
                                + Add Package
                            </button>
                        </div>


                        {error && (
                            <div className="mb-3 rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2.5 text-xs font-medium text-[#9B1C1C]">
                                {error}
                            </div>
                        )}

                        {loading && packages.length === 0 ? (
                            <ModuleSkeleton variant="packages" />
                        ) : filteredPackages.length === 0 ? (
                            <EmptyState
                                title={search || selectedCategory !== "All" || selectedStatus !== "All"
                                    ? "No matching packages."
                                    : "No packages yet."}
                                detail={search || selectedCategory !== "All" || selectedStatus !== "All"
                                    ? "Try different search, category, or status filters."
                                    : "Create your first package using inventory items and discounts."}
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
                                        }}
                                        canManage
                                        branchName={branchName}
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
        </>
    );
}