"use client";

import * as React from "react";
import {
    AlertTriangle,
    Building2,
    Check,
    ChevronDown,
    RefreshCw,
    Search,
    X,
} from "lucide-react";
import { useInventoryController } from "@/hooks/useInventory";
import {
    EmptyInventory,
    InventoryDialogs,
    ProductTable,
    type Branch,
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

export default function OwnerInventory() {
    const [refreshKey, setRefreshKey] = React.useState(0);
    const [currentDateTime, setCurrentDateTime] =
        React.useState<Date | null>(null);

    React.useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();

        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const refreshInventoryDetails = React.useCallback(() => {
        /*
         * This remounts only the inventory content and runs
         * useInventoryController again. The browser page itself does not reload.
         */
        setRefreshKey((currentKey) => currentKey + 1);
    }, []);

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <h1 className="text-[25px] font-bold text-[#1A1220]">
                        Inventory
                    </h1>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            type="button"
                            onClick={refreshInventoryDetails}
                            aria-label="Refresh inventory"
                            title="Refresh inventory"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            <RefreshCw size={16} />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <OwnerInventoryContent key={refreshKey} />
        </>
    );
}


type StockAlertFilter = "all" | "low" | "out";

type StockAlertItem = {
    id: string;
    productName: string;
    branchName: string;
    variantName: string;
    stock: number;
    alertLevel: number;
    status: "Low Stock" | "Out of Stock";
};

function getInventoryAlertItems(products: Product[]): StockAlertItem[] {
    return products.flatMap((product) => {
        const variants = Array.isArray(product.variants)
            ? product.variants
            : [];

        if (product.hasVariants && variants.length > 0) {
            return variants
                .map((variant, index) => {
                    const stock = Number(variant.stock || 0);
                    const alertLevel = Number(variant.alertLevel || 0);
                    const variantName =
                        Object.values(variant.variantValues || {})
                            .map((value) => String(value).trim())
                            .filter(Boolean)
                            .join(" / ") || "Variant";

                    return {
                        id: `${product.id}-variant-${index}`,
                        productName: product.name,
                        branchName: product.branchName || "—",
                        variantName,
                        stock,
                        alertLevel,
                        status:
                            stock <= 0 ? "Out of Stock" : "Low Stock",
                    } satisfies StockAlertItem;
                })
                .filter((item) => item.stock <= item.alertLevel);
        }

        const stock = Number(product.stock || 0);
        const alertLevel = Number(product.alertLevel || 0);

        if (stock > alertLevel) {
            return [];
        }

        return [
            {
                id: `${product.id}-regular`,
                productName: product.name,
                branchName: product.branchName || "—",
                variantName: "—",
                stock,
                alertLevel,
                status: stock <= 0 ? "Out of Stock" : "Low Stock",
            },
        ];
    });
}

function getInventoryOverview(products: Product[]) {
    return products.reduce(
        (totals, product) => {
            const variants = Array.isArray(product.variants)
                ? product.variants
                : [];

            const stockItems =
                product.hasVariants && variants.length > 0
                    ? variants.map((variant) => ({
                        stock: Number(variant.stock || 0),
                        alertLevel: Number(variant.alertLevel || 0),
                        salesPrice: Number(variant.salesPrice || 0),
                    }))
                    : [
                        {
                            stock: Number(product.stock || 0),
                            alertLevel: Number(product.alertLevel || 0),
                            salesPrice: Number(product.salesPrice || 0),
                        },
                    ];

            stockItems.forEach((item) => {
                totals.totalStock += item.stock;
                totals.inventoryValue += item.stock * item.salesPrice;

                if (item.stock <= 0) {
                    totals.outOfStock += 1;
                } else if (item.stock <= item.alertLevel) {
                    totals.lowStock += 1;
                }
            });

            return totals;
        },
        {
            totalProducts: products.length,
            totalStock: 0,
            lowStock: 0,
            outOfStock: 0,
            inventoryValue: 0,
        }
    );
}

function OwnerInventoryContent() {
    const inv = useInventoryController();

    const [isAllBranchesView, setIsAllBranchesView] = React.useState(true);
    const [branchQuery, setBranchQuery] = React.useState("All Branches");
    const [isBranchMenuOpen, setIsBranchMenuOpen] = React.useState(false);
    const [isStockAlertsOpen, setIsStockAlertsOpen] = React.useState(false);
    const [stockAlertFilter, setStockAlertFilter] =
        React.useState<StockAlertFilter>("all");

    const branchSelectorRef = React.useRef<HTMLDivElement>(null);

    const selectedBranch = isAllBranchesView ? null : inv.selectedBranch;

    const matchingBranches = React.useMemo(() => {
        const query = branchQuery.trim().toLowerCase();

        if (!query || query === "all branches") {
            return inv.branches;
        }

        return inv.branches.filter((branch) =>
            branch.branchName.toLowerCase().includes(query)
        );
    }, [branchQuery, inv.branches]);

    const displayedProducts = React.useMemo(
        () => (isAllBranchesView ? inv.products : inv.baseProducts),
        [inv.baseProducts, inv.products, isAllBranchesView]
    );

    const filteredProducts = React.useMemo(() => {
        const query = inv.search.trim().toLowerCase();

        return displayedProducts.filter((product) => {
            const variantText = (product.variants || [])
                .map((variant) =>
                    Object.values(variant.variantValues || {}).join(" ")
                )
                .join(" ")
                .toLowerCase();

            const matchesCategory =
                inv.selectedCategory === "All" ||
                product.category === inv.selectedCategory;

            const matchesSearch =
                !query ||
                product.name.toLowerCase().includes(query) ||
                product.category.toLowerCase().includes(query) ||
                (product.branchName || "").toLowerCase().includes(query) ||
                variantText.includes(query);

            return matchesCategory && matchesSearch;
        });
    }, [
        displayedProducts,
        inv.search,
        inv.selectedCategory,
    ]);

    const inventoryOverview = React.useMemo(
        () => getInventoryOverview(displayedProducts),
        [displayedProducts]
    );

    const stockAlertItems = React.useMemo(
        () => getInventoryAlertItems(displayedProducts),
        [displayedProducts]
    );

    const handleSelectAllBranches = () => {
        setIsAllBranchesView(true);
        inv.setSelectedBranchId("");
        setBranchQuery("All Branches");
        setIsBranchMenuOpen(false);
        inv.setSearch("");
        inv.setSelectedCategory("All");
    };

    const handleSelectBranch = (branch: Branch) => {
        setIsAllBranchesView(false);
        inv.setSelectedBranchId(String(branch.id));
        setBranchQuery(branch.branchName);
        setIsBranchMenuOpen(false);
        inv.setSearch("");
        inv.setSelectedCategory("All");
    };

    React.useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (
                branchSelectorRef.current &&
                !branchSelectorRef.current.contains(event.target as Node)
            ) {
                setIsBranchMenuOpen(false);

                if (isAllBranchesView) {
                    setBranchQuery("All Branches");
                } else if (selectedBranch) {
                    setBranchQuery(selectedBranch.branchName);
                }
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [isAllBranchesView, selectedBranch]);

    const scopeTitle = isAllBranchesView
        ? "All Branches Inventory List"
        : `${selectedBranch?.branchName || "Branch"} Inventory List`;

    const scopeDetail = isAllBranchesView
        ? "Inventory details available across all branches."
        : "Inventory details available in the selected branch.";

    return (
        <>
            <section className="px-6 py-4 font-sans">
                <div className="space-y-3">
                    <InventoryOverviewCards
                        overview={inventoryOverview}
                        onViewAlerts={() => {
                            setStockAlertFilter("all");
                            setIsStockAlertsOpen(true);
                        }}
                    />

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_290px]">
                        <div className="relative">
                            <Search
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                value={inv.search}
                                onChange={(event) =>
                                    inv.setSearch(event.target.value)
                                }
                                placeholder="Search products..."
                                className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white px-4 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />
                        </div>

                        <div ref={branchSelectorRef} className="relative">
                            <Building2
                                size={15}
                                className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                value={branchQuery}
                                onFocus={() => {
                                    setIsBranchMenuOpen(true);

                                    if (
                                        branchQuery === "All Branches" ||
                                        branchQuery === selectedBranch?.branchName
                                    ) {
                                        setBranchQuery("");
                                    }
                                }}
                                onChange={(event) => {
                                    setBranchQuery(event.target.value);
                                    setIsBranchMenuOpen(true);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                        setIsBranchMenuOpen(false);
                                        event.currentTarget.blur();
                                    }
                                }}
                                placeholder="Search or select branch..."
                                className="h-[42px] w-full rounded-xl border border-[#E3D8EA] bg-white px-10 pr-10 text-sm font-semibold text-[#1A1220] outline-none shadow-sm placeholder:font-normal placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                role="combobox"
                                aria-expanded={isBranchMenuOpen}
                                aria-controls="owner-inventory-branch-options"
                                aria-autocomplete="list"
                            />

                            <button
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    setIsBranchMenuOpen((isOpen) => !isOpen);
                                    setBranchQuery("");
                                }}
                                className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-[#2B174C]"
                                aria-label="Show branch choices"
                            >
                                <ChevronDown
                                    size={14}
                                    className={`transition ${
                                        isBranchMenuOpen ? "rotate-180" : ""
                                    }`}
                                />
                            </button>

                            {isBranchMenuOpen && (
                                <div
                                    id="owner-inventory-branch-options"
                                    className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[#D8CBE7] bg-white py-1 shadow-lg"
                                    role="listbox"
                                >
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={isAllBranchesView}
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onClick={handleSelectAllBranches}
                                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition ${
                                            isAllBranchesView
                                                ? "bg-[#F1E9FF] font-semibold text-[#2B174C]"
                                                : "text-[#1A1220] hover:bg-[#F7F1FF]"
                                        }`}
                                    >
                                        <span>All Branches</span>
                                        {isAllBranchesView && (
                                            <Check
                                                size={15}
                                                className="shrink-0"
                                            />
                                        )}
                                    </button>

                                    {matchingBranches.length === 0 ? (
                                        <p className="px-4 py-3 text-sm text-[#7A6A84]">
                                            No matching branch found.
                                        </p>
                                    ) : (
                                        matchingBranches.map((branch) => {
                                            const isSelected =
                                                !isAllBranchesView &&
                                                String(branch.id) ===
                                                inv.selectedBranchId;

                                            return (
                                                <button
                                                    key={branch.id}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={isSelected}
                                                    onMouseDown={(event) =>
                                                        event.preventDefault()
                                                    }
                                                    onClick={() =>
                                                        handleSelectBranch(
                                                            branch
                                                        )
                                                    }
                                                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition ${
                                                        isSelected
                                                            ? "bg-[#F1E9FF] font-semibold text-[#2B174C]"
                                                            : "text-[#1A1220] hover:bg-[#F7F1FF]"
                                                    }`}
                                                >
                                                    <span className="truncate">
                                                        {branch.branchName}
                                                    </span>

                                                    {isSelected && (
                                                        <Check
                                                            size={15}
                                                            className="shrink-0"
                                                        />
                                                    )}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <h2 className="text-sm font-bold text-[#1A1220]">
                                Categories
                            </h2>

                            <span className="text-xs font-semibold text-[#806A8C]">
                                {inv.categories.length} categories
                            </span>
                        </div>

                        <div className="overflow-x-auto pb-1">
                            <div className="flex min-w-max gap-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        inv.setSelectedCategory("All")
                                    }
                                    className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                                        inv.selectedCategory === "All"
                                            ? "bg-[#2B174C] text-white shadow-sm"
                                            : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]"
                                    }`}
                                >
                                    All
                                </button>

                                {inv.categories.map((category) => {
                                    const selected =
                                        inv.selectedCategory === category;

                                    return (
                                        <button
                                            key={category}
                                            type="button"
                                            onClick={() =>
                                                inv.setSelectedCategory(
                                                    category
                                                )
                                            }
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
                    </section>

                    <section className="min-h-[440px] rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
                        <div className="mb-3 flex flex-col gap-3 border-b border-[#E6DDF0] pb-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <h2 className="text-[16px] font-bold text-[#1A1220]">
                                    {scopeTitle}
                                </h2>

                                <p className="mt-0.5 text-xs text-[#7A6A84]">
                                    {scopeDetail}
                                </p>
                            </div>

                            <span className="shrink-0 text-xs font-semibold text-[#806A8C]">
                                {filteredProducts.length} product
                                {filteredProducts.length !== 1 ? "s" : ""}
                            </span>
                        </div>

                        {filteredProducts.length === 0 ? (
                            <EmptyInventory
                                message={
                                    inv.search ||
                                    inv.selectedCategory !== "All"
                                        ? "No products found for the current search or category."
                                        : isAllBranchesView
                                            ? "No products found across all branches."
                                            : "No products found for this branch."
                                }
                            />
                        ) : (
                            <div className="overflow-x-auto [&_table]:w-full [&_table]:table-fixed [&_table_col:last-child]:hidden [&_table_th:last-child]:hidden [&_table_td:last-child]:hidden [&_table_th:nth-child(1)]:w-[20%] [&_table_th:nth-child(2)]:w-[11%] [&_table_th:nth-child(3)]:w-[10%] [&_table_th:nth-child(4)]:w-[9%] [&_table_th:nth-child(5)]:w-[7%] [&_table_th:nth-child(6)]:w-[7%] [&_table_th:nth-child(7)]:w-[13%] [&_table_th:nth-child(8)]:w-[13%] [&_table_th:nth-child(9)]:w-[10%] [&_table_td]:align-middle">
                                <ProductTable
                                    products={filteredProducts}
                                    isOwner
                                    onEdit={() => undefined}
                                    onDelete={() => undefined}
                                />
                            </div>
                        )}
                    </section>
                </div>
            </section>

            {isStockAlertsOpen && (
                <OwnerStockAlertsModal
                    items={stockAlertItems}
                    activeFilter={stockAlertFilter}
                    onChangeFilter={setStockAlertFilter}
                    onClose={() => setIsStockAlertsOpen(false)}
                />
            )}

            <InventoryDialogs inv={inv} />
        </>
    );
}

function InventoryOverviewCards({
                                    overview,
                                    onViewAlerts,
                                }: {
    overview: {
        totalProducts: number;
        totalStock: number;
        lowStock: number;
        outOfStock: number;
        inventoryValue: number;
    };
    onViewAlerts: () => void;
}) {
    const formatNumber = (value: number) =>
        value.toLocaleString("en-PH", {
            maximumFractionDigits: 0,
        });

    const formatPeso = (value: number) =>
        value.toLocaleString("en-PH", {
            style: "currency",
            currency: "PHP",
        });

    return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InventoryMetricCard
                label="Products"
                value={formatNumber(overview.totalProducts)}
            />

            <InventoryMetricCard
                label="Total Stock"
                value={formatNumber(overview.totalStock)}
            />

            <button
                type="button"
                onClick={onViewAlerts}
                title="View stock alert details"
                aria-label="View stock alert details"
                className="min-h-[102px] rounded-[14px] border border-[#E6DDF0] bg-white p-3 text-left shadow-sm transition hover:border-[#CDB9E1] hover:shadow-md focus:outline-none focus:ring-4 focus:ring-[#2B174C]/10"
            >
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#1A1220]">
                        Stock Alerts
                    </p>

                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2B174C]">
                        View
                        <AlertTriangle
                            size={15}
                            className="text-[#A56607]"
                            aria-hidden="true"
                        />
                    </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-[#F4D79A] bg-[#FFF8D8] px-2 py-1.5 text-center">
                        <p className="text-[10px] font-semibold text-[#A56607]">
                            Low Stock
                        </p>
                        <p className="mt-0.5 text-[18px] font-bold leading-none text-[#A56607]">
                            {formatNumber(overview.lowStock)}
                        </p>
                    </div>

                    <div className="rounded-lg border border-[#F2C4C4] bg-[#FFF0F0] px-2 py-1.5 text-center">
                        <p className="text-[10px] font-semibold text-[#C32F2F]">
                            Out of Stock
                        </p>
                        <p className="mt-0.5 text-[18px] font-bold leading-none text-[#C32F2F]">
                            {formatNumber(overview.outOfStock)}
                        </p>
                    </div>
                </div>
            </button>

            <InventoryMetricCard
                label="Inventory Value"
                value={formatPeso(overview.inventoryValue)}
                compact
            />
        </div>
    );
}

function OwnerStockAlertsModal({
                                   items,
                                   activeFilter,
                                   onChangeFilter,
                                   onClose,
                               }: {
    items: StockAlertItem[];
    activeFilter: StockAlertFilter;
    onChangeFilter: (filter: StockAlertFilter) => void;
    onClose: () => void;
}) {
    const lowStockCount = items.filter(
        (item) => item.status === "Low Stock"
    ).length;
    const outOfStockCount = items.filter(
        (item) => item.status === "Out of Stock"
    ).length;

    const visibleItems =
        activeFilter === "low"
            ? items.filter((item) => item.status === "Low Stock")
            : activeFilter === "out"
                ? items.filter((item) => item.status === "Out of Stock")
                : items;

    const tabClass = (active: boolean, tone: "all" | "low" | "out") => {
        if (tone === "low") {
            return active
                ? "border-[#F4D06B] bg-[#FFF8D8] text-[#A56607]"
                : "border-[#E6DDF0] bg-white text-[#A56607] hover:bg-[#FFF8E8]";
        }

        if (tone === "out") {
            return active
                ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
                : "border-[#E6DDF0] bg-white text-[#C32F2F] hover:bg-[#FFF5F5]";
        }

        return active
            ? "border-[#2B174C] bg-[#2B174C] text-white"
            : "border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]";
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="owner-stock-alerts-title"
                className="w-full max-w-5xl overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4 border-b border-[#E6DDF0] px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF8D8] text-[#A56607]">
                            <AlertTriangle size={19} />
                        </div>

                        <div>
                            <h2
                                id="owner-stock-alerts-title"
                                className="text-[20px] font-bold text-[#1A1220]"
                            >
                                Stock Alerts
                            </h2>
                            <p className="mt-1 text-sm text-[#7A6A84]">
                                Low-stock and out-of-stock items for the current inventory view.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close stock alerts"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C]"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex flex-col gap-3 border-b border-[#E6DDF0] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => onChangeFilter("all")}
                            className={`h-[36px] rounded-xl border px-3 text-xs font-semibold transition ${tabClass(
                                activeFilter === "all",
                                "all"
                            )}`}
                        >
                            All ({items.length})
                        </button>

                        <button
                            type="button"
                            onClick={() => onChangeFilter("low")}
                            className={`h-[36px] rounded-xl border px-3 text-xs font-semibold transition ${tabClass(
                                activeFilter === "low",
                                "low"
                            )}`}
                        >
                            Low Stock ({lowStockCount})
                        </button>

                        <button
                            type="button"
                            onClick={() => onChangeFilter("out")}
                            className={`h-[36px] rounded-xl border px-3 text-xs font-semibold transition ${tabClass(
                                activeFilter === "out",
                                "out"
                            )}`}
                        >
                            Out of Stock ({outOfStockCount})
                        </button>
                    </div>

                    <span className="text-xs font-semibold text-[#806A8C]">
                        View only
                    </span>
                </div>

                <div className="max-h-[430px] overflow-auto">
                    <table className="w-full min-w-[820px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#FFFCF7]">
                        <tr className="border-b border-[#E6DDF0]">
                            <StockAlertHeader>Product</StockAlertHeader>
                            <StockAlertHeader>Branch</StockAlertHeader>
                            <StockAlertHeader>Variant</StockAlertHeader>
                            <StockAlertHeader>Current Stock</StockAlertHeader>
                            <StockAlertHeader>Alert Level</StockAlertHeader>
                            <StockAlertHeader>Status</StockAlertHeader>
                        </tr>
                        </thead>
                        <tbody>
                        {visibleItems.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={6}
                                    className="px-4 py-12 text-center text-sm text-[#7A6A84]"
                                >
                                    No stock alerts found for this filter.
                                </td>
                            </tr>
                        ) : (
                            visibleItems.map((item) => (
                                <tr
                                    key={item.id}
                                    className="border-b border-[#EEE7F2] last:border-b-0"
                                >
                                    <StockAlertCell strong>
                                        <div>
                                            <p>{item.productName}</p>
                                            <p
                                                className={`mt-1 text-xs font-semibold ${
                                                    item.status === "Out of Stock"
                                                        ? "text-[#C32F2F]"
                                                        : "text-[#A56607]"
                                                }`}
                                            >
                                                {item.status}
                                            </p>
                                        </div>
                                    </StockAlertCell>
                                    <StockAlertCell>{item.branchName}</StockAlertCell>
                                    <StockAlertCell>{item.variantName}</StockAlertCell>
                                    <StockAlertCell>
                                            <span
                                                className={`font-semibold ${
                                                    item.status === "Out of Stock"
                                                        ? "text-[#C32F2F]"
                                                        : "text-[#A56607]"
                                                }`}
                                            >
                                                {item.stock}
                                            </span>
                                    </StockAlertCell>
                                    <StockAlertCell>{item.alertLevel}</StockAlertCell>
                                    <StockAlertCell>
                                            <span
                                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                                    item.status === "Out of Stock"
                                                        ? "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]"
                                                        : "border-[#F4D79A] bg-[#FFF8D8] text-[#A56607]"
                                                }`}
                                            >
                                                {item.status}
                                            </span>
                                    </StockAlertCell>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-[#E6DDF0] bg-[#FFFDF8] px-5 py-3 text-xs leading-5 text-[#7A6A84]">
                    Owner accounts can review stock alerts here. Restocking and inventory changes are managed by authorized branch users.
                </div>
            </div>
        </div>
    );
}

function StockAlertHeader({ children }: { children: React.ReactNode }) {
    return (
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#806A8C]">
            {children}
        </th>
    );
}

function StockAlertCell({
                            children,
                            strong = false,
                        }: {
    children: React.ReactNode;
    strong?: boolean;
}) {
    return (
        <td
            className={`px-4 py-3 text-sm ${
                strong ? "font-semibold text-[#1A1220]" : "text-[#5F4E75]"
            }`}
        >
            {children}
        </td>
    );
}

function InventoryMetricCard({
                                 label,
                                 value,
                                 compact = false,
                             }: {
    label: string;
    value: string;
    compact?: boolean;
}) {
    return (
        <div className="min-h-[102px] rounded-[14px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-[#1A1220]">{label}</p>

            <p
                className={`mt-1.5 font-bold leading-none text-[#1A1220] ${
                    compact ? "text-[22px]" : "text-[24px]"
                }`}
            >
                {value}
            </p>
        </div>
    );
}
