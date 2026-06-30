"use client";

import { RefreshCw, Search } from "lucide-react";
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
    const [error, setError] = useState("");
    const [packageAccess, setPackageAccess] = useState<PackageAccess>("none");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

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
                setError(data.error || "Failed to load packages.");
                setPackages([]);
                return;
            }

            setPackages(Array.isArray(data.packages) ? data.packages : []);
            setError("");
        } catch {
            setPackages([]);
            setError("Failed to load packages.");
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

    async function handleRefresh() {
        setIsRefreshing(true);

        try {
            if (storeId && canManage) {
                await fetchProducts(storeId, branchId);
            }

            if (branchId && canView) {
                await fetchPackages(branchId);
            }
        } finally {
            setIsRefreshing(false);
        }
    }

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

            return matchesSearch && matchesCategory;
        });
    }, [packages, search, selectedCategory]);

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
                    <div className="flex gap-3">
                        <div className="relative flex-1">
                            <Search
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search packages..."
                                className="w-full rounded-xl border border-[#E3D8EA] bg-white px-4 py-2.5 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C]"
                            />
                        </div>

                        {canManage ? (
                            <button
                                onClick={form.openAdd}
                                className="inline-flex items-center rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                            >
                                + Add package
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    if (branchId) void fetchPackages(branchId);
                                }}
                                className="inline-flex items-center rounded-xl border border-[#E6DDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F7F1FF]"
                            >
                                Refresh
                            </button>
                        )}
                    </div>

                    <div className="rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h2 className="text-sm font-bold text-[#1A1220]">
                                Categories
                            </h2>

                            <span className="shrink-0 text-xs font-semibold text-[#806A8C]">
                                {PACKAGE_CATEGORY_OPTIONS.length - 1} categories
                            </span>
                        </div>

                        <div className="overflow-x-auto pb-1">
                            <div className="flex min-w-max gap-2">
                                {PACKAGE_CATEGORY_OPTIONS.map((category) => {
                                    const selected = selectedCategory === category;

                                    return (
                                        <button
                                            key={category}
                                            type="button"
                                            onClick={() => setSelectedCategory(category)}
                                            aria-pressed={selected}
                                            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                                                selected
                                                    ? "bg-[#2B174C] text-white shadow-sm"
                                                    : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]"
                                            }`}
                                        >
                                            {category}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <Card className="min-h-[420px]">
                        <CardHeader
                            title="Branch Package List"
                            action={`${filteredPackages.length} packages`}
                        />

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
                        ) : loading ? (
                            <EmptyState
                                title="Loading packages..."
                                detail="Please wait while packages are being loaded."
                            />
                        ) : filteredPackages.length === 0 ? (
                            <EmptyState
                                title={
                                    canManage
                                        ? "No packages yet."
                                        : "No packages available."
                                }
                                detail={
                                    canManage
                                        ? "Create your first package using inventory items and discounts."
                                        : "No active package setup is currently available for this branch."
                                }
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
                    selectedProductId={form.selectedProductId}
                    setSelectedProductId={form.setSelectedProductId}
                    inclusionQty={form.inclusionQty}
                    setInclusionQty={form.setInclusionQty}
                    originalValue={form.originalValue}
                    packagePrice={form.packagePrice}
                    onAddInclusion={() => form.addInclusion(packageProducts)}
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