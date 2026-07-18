"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CalendarDays,
    Check,
    ChevronDown,
    ChevronRight,
    PackageSearch,
    Search,
    TrendingUp,
} from "lucide-react";
import {
    ForecastDetails,
    ForecastEmptyState,
    ForecastErrorState,
    ForecastLoadingState,
    type ForecastTab,
    type LiveForecastProps,
    type SeasonalApiResponse,
    type SeasonalDateRange,
    buildBranchForecasts,
    buildScopedBookingForecast,
    buildScopedForecast,
    formatNumber,
    ProductDemandSummaryCards,
    SummaryCard,
} from "./_shared";

function OwnerForecastScopeSelector({
                                        branches,
                                        selectedBranchId,
                                        onSelectBranch,
                                    }: {
    branches: Array<{ id: number; name: string }>;
    selectedBranchId: number | null;
    onSelectBranch: (branchId: number | null) => void;
}) {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);

    const selectedBranch =
        branches.find((branch) => branch.id === selectedBranchId) ?? null;

    const matchingBranches = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();

        if (!normalizedQuery) {
            return branches;
        }

        return branches.filter((branch) =>
            branch.name.toLowerCase().includes(normalizedQuery)
        );
    }, [branches, query]);

    const inputValue = isOpen
        ? query
        : selectedBranch?.name || "All Branches";

    return (
        <div className="relative w-full lg:w-[320px]">
            <div className="relative">
                <Search
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#806A8C]"
                />

                <input
                    value={inputValue}
                    onFocus={() => {
                        setIsOpen(true);
                        setQuery("");
                    }}
                    onBlur={() => {
                        window.setTimeout(() => {
                            setIsOpen(false);
                            setQuery("");
                        }, 150);
                    }}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setIsOpen(true);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            setIsOpen(false);
                            setQuery("");
                            event.currentTarget.blur();
                        }
                    }}
                    placeholder="Search or select branch..."
                    aria-label="Search or select forecast branch"
                    aria-expanded={isOpen}
                    aria-haspopup="listbox"
                    className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-white px-10 pr-10 text-sm font-semibold text-[#1A1220] outline-none shadow-sm transition placeholder:font-normal placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                />

                <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                        setIsOpen((open) => !open);
                        setQuery("");
                    }}
                    aria-label="Show forecast branch options"
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#2B174C] transition hover:bg-[#F7F1FF]"
                >
                    <ChevronDown
                        size={16}
                        className={
                            isOpen
                                ? "rotate-180 transition-transform"
                                : "transition-transform"
                        }
                    />
                </button>
            </div>

            {isOpen && (
                <div
                    role="listbox"
                    className="absolute z-30 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-lg"
                >
                    <button
                        type="button"
                        role="option"
                        aria-selected={selectedBranchId === null}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            onSelectBranch(null);
                            setIsOpen(false);
                            setQuery("");
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                            selectedBranchId === null
                                ? "bg-[#F0EAFE] font-semibold text-[#2B174C]"
                                : "text-[#1A1220] hover:bg-[#F7F1FF]"
                        }`}
                    >
                        <span>All Branches</span>
                        {selectedBranchId === null && (
                            <Check size={15} className="shrink-0" />
                        )}
                    </button>

                    {matchingBranches.length > 0 ? (
                        matchingBranches.map((branch) => {
                            const isSelected = branch.id === selectedBranchId;

                            return (
                                <button
                                    key={branch.id}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                        onSelectBranch(branch.id);
                                        setIsOpen(false);
                                        setQuery("");
                                    }}
                                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                                        isSelected
                                            ? "bg-[#F0EAFE] font-semibold text-[#2B174C]"
                                            : "text-[#1A1220] hover:bg-[#F7F1FF]"
                                    }`}
                                >
                                    <span className="truncate">{branch.name}</span>
                                    {isSelected && (
                                        <Check size={15} className="shrink-0" />
                                    )}
                                </button>
                            );
                        })
                    ) : (
                        <p className="px-3 py-4 text-sm text-[#7A6A84]">
                            No matching branch found.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function formatOwnerMonthLabel(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""))) {
        return "—";
    }

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
    }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function formatOwnerSeasonalRange(range: SeasonalDateRange) {
    return `${formatOwnerMonthLabel(range.startMonth)} – ${formatOwnerMonthLabel(
        range.endMonth
    )}`;
}

function formatOwnerTrend(value: string) {
    return String(value || "")
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "No trend available";
}

function formatOwnerSeasonalTrend(seasonalData: SeasonalApiResponse | null) {
    const seasonal = seasonalData?.seasonal;

    if (!seasonal) {
        return "Loading...";
    }

    if (
        seasonal.recentTrendPercent === null ||
        seasonal.recentTrendPercent === undefined ||
        !Number.isFinite(Number(seasonal.recentTrendPercent))
    ) {
        return formatOwnerTrend(seasonal.recentTrend);
    }

    const percent = Math.round(Number(seasonal.recentTrendPercent));
    return `${percent >= 0 ? "+" : ""}${percent}% · ${formatOwnerTrend(
        seasonal.recentTrend
    )}`;
}

function formatOwnerPeakMonths(seasonalData: SeasonalApiResponse | null) {
    const months = seasonalData?.seasonal?.peakMonths || [];

    if (months.length === 0) {
        return "No peak month yet";
    }

    return months
        .slice(0, 2)
        .map((month) => month.month)
        .join(" and ");
}

async function requestOwnerScopedSeasonalForecast(
    branchId: number,
    range: SeasonalDateRange
): Promise<SeasonalApiResponse> {
    const token =
        typeof window !== "undefined"
            ? sessionStorage.getItem("token")
            : null;

    if (!token) {
        throw new Error("Your login session is missing. Please log in again.");
    }

    const response = await fetch("/api/forecasting", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            action: "get_seasonal_analysis",
            branch_id: branchId,
            seasonalStartMonth: range.startMonth,
            seasonalEndMonth: range.endMonth,
        }),
        cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as
        | SeasonalApiResponse
        | { error?: string; details?: string };

    if (!response.ok) {
        const errorPayload = payload as { error?: string; details?: string };
        const details = errorPayload.details ? ` ${errorPayload.details}` : "";
        throw new Error(
            `${errorPayload.error || "Unable to load branch seasonal data."}${details}`
        );
    }

    const seasonalPayload = payload as SeasonalApiResponse;

    if (!seasonalPayload.success || !seasonalPayload.seasonal) {
        throw new Error(
            "The Seasonal Demand Patterns service returned an invalid response."
        );
    }

    return seasonalPayload;
}

function OwnerSeasonalSummaryCards({
                                       activeScopeLabel,
                                       seasonalData,
                                       seasonalLoading,
                                       seasonalError,
                                       seasonalRange,
                                   }: {
    activeScopeLabel: string;
    seasonalData: SeasonalApiResponse | null;
    seasonalLoading: boolean;
    seasonalError: string | null;
    seasonalRange: SeasonalDateRange;
}) {
    const seasonal = seasonalData?.seasonal;
    const totalUnitsSold = seasonal?.totalUnitsSold ?? 0;
    const averageMonthlyItems =
        seasonal && seasonal.historyMonthsAvailable > 0
            ? Math.round(totalUnitsSold / seasonal.historyMonthsAvailable)
            : 0;

    return (
        <>
            <div className="grid gap-3 md:grid-cols-3">
                <SummaryCard
                    icon={<CalendarDays size={18} />}
                    title="Seasonal Sales Period"
                    value={formatOwnerSeasonalRange(seasonalRange)}
                    detail={`Completed POS item quantities for ${activeScopeLabel}`}
                    tone="purple"
                />
                <SummaryCard
                    icon={<PackageSearch size={18} />}
                    title="Average Monthly Items Sold"
                    value={
                        seasonalLoading && !seasonal
                            ? "Loading..."
                            : `${formatNumber(averageMonthlyItems)} items`
                    }
                    detail="Average item quantity across the selected sales period"
                    tone="green"
                />
                <SummaryCard
                    icon={<TrendingUp size={18} />}
                    title="Recent Seasonal Trend"
                    value={
                        seasonalLoading && !seasonal
                            ? "Loading..."
                            : formatOwnerSeasonalTrend(seasonalData)
                    }
                    detail={`Peak months: ${formatOwnerPeakMonths(seasonalData)}`}
                    tone={seasonalError && !seasonal ? "red" : "gold"}
                />
            </div>

            <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF8FF] px-4 py-3 text-xs leading-5 text-[#6B5B78]">
                <span className="font-semibold text-[#2B174C]">
                    Seasonal Patterns view:
                </span>{" "}
                this section explains monthly POS item quantities, peak months,
                lower-demand months, and seasonal trend for the selected scope.
                Product-level 30-day demand is shown in the Product Demand tab.
                {seasonalError && (
                    <span className="mt-1 block text-[#A56607]">
                        Showing the most recently loaded seasonal values. {seasonalError}
                    </span>
                )}
            </div>
        </>
    );
}


export default function OwnerForecast({
                                          data,
                                          loading,
                                          error,
                                          seasonalData,
                                          seasonalLoading,
                                          seasonalError,
                                          seasonalRange,
                                          applySeasonalRange,
                                          bookingData,
                                          bookingLoading,
                                          bookingError,
                                      }: LiveForecastProps) {
    const [activeTab, setActiveTab] = useState<ForecastTab>("inventory");
    const [selectedBranchId, setSelectedBranchId] = useState<number | null>(
        null
    );
    const [ownerSeasonalData, setOwnerSeasonalData] =
        useState<SeasonalApiResponse | null>(null);
    const [ownerSeasonalLoading, setOwnerSeasonalLoading] = useState(false);
    const [ownerSeasonalError, setOwnerSeasonalError] = useState<string | null>(
        null
    );

    const branches = useMemo(
        () => (data ? buildBranchForecasts(data.items) : []),
        [data]
    );

    useEffect(() => {
        if (!selectedBranchId) {
            setOwnerSeasonalData(null);
            setOwnerSeasonalLoading(false);
            setOwnerSeasonalError(null);
            return;
        }

        let isCancelled = false;

        const loadBranchSeasonalData = async () => {
            setOwnerSeasonalLoading(true);
            setOwnerSeasonalError(null);

            try {
                const scopedSeasonal = await requestOwnerScopedSeasonalForecast(
                    selectedBranchId,
                    seasonalRange
                );

                if (!isCancelled) {
                    setOwnerSeasonalData(scopedSeasonal);
                }
            } catch (requestError) {
                if (!isCancelled) {
                    setOwnerSeasonalError(
                        requestError instanceof Error
                            ? requestError.message
                            : "Unable to load branch seasonal data."
                    );
                }
            } finally {
                if (!isCancelled) {
                    setOwnerSeasonalLoading(false);
                }
            }
        };

        void loadBranchSeasonalData();

        return () => {
            isCancelled = true;
        };
    }, [selectedBranchId, seasonalRange.startMonth, seasonalRange.endMonth]);

    if (loading && !data) {
        return <ForecastLoadingState />;
    }

    if (error && !data) {
        return <ForecastErrorState message={error} />;
    }

    if (!data) {
        return <ForecastEmptyState />;
    }

    const selectedBranch =
        branches.find((branch) => branch.id === selectedBranchId) ?? null;

    const isAllBranches = selectedBranch === null;

    const branchData = selectedBranch
        ? buildScopedForecast(data, selectedBranch.id)
        : data;

    const scopedBookingData = selectedBranch
        ? buildScopedBookingForecast(bookingData, selectedBranch.id)
        : bookingData;

    const displayedSeasonalData = selectedBranch
        ? ownerSeasonalData
        : seasonalData;
    const displayedSeasonalLoading = selectedBranch
        ? ownerSeasonalLoading
        : seasonalLoading;
    const displayedSeasonalError = selectedBranch
        ? ownerSeasonalError
        : seasonalError;

    const handleApplySeasonalRange = async (range: SeasonalDateRange) => {
        await applySeasonalRange(range);
    };


    const activeScopeLabel =
        selectedBranch?.name || "All Branches";

    const highestDemand = Math.max(
        1,
        ...branches.map((branch) => branch.demand)
    );

    return (
        <div className="space-y-4">
            {error && (
                <div className="rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-3 text-sm text-[#8A5A06]">
                    Showing the most recently loaded forecast. Refresh again to retry
                    the latest request.
                </div>
            )}

            <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                            <TrendingUp size={18} />
                        </div>

                        <div>
                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                Forecasting Scope
                            </h2>
                            <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                                All Branches is the default. Search or select a branch to view its forecast.
                            </p>
                        </div>
                    </div>

                    <OwnerForecastScopeSelector
                        branches={branches}
                        selectedBranchId={selectedBranchId}
                        onSelectBranch={setSelectedBranchId}
                    />
                </div>
            </section>

            {activeTab === "inventory" ? (
                <ProductDemandSummaryCards
                    data={branchData}
                    seasonalData={displayedSeasonalData}
                    seasonalLoading={displayedSeasonalLoading}
                />
            ) : (
                <OwnerSeasonalSummaryCards
                    activeScopeLabel={activeScopeLabel}
                    seasonalData={displayedSeasonalData}
                    seasonalLoading={displayedSeasonalLoading}
                    seasonalError={displayedSeasonalError}
                    seasonalRange={seasonalRange}
                />
            )}

            {isAllBranches && activeTab === "inventory" ? (
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
                    <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-[16px] font-bold text-[#1A1220]">
                                    Customer demand by branch
                                </h2>
                                <p className="mt-1 text-xs text-[#7A6A84]">
                                    Compare projected product demand in the next{" "}
                                    {data.scope.periodDays} days. This chart does not
                                    measure current inventory stock.
                                </p>
                            </div>

                            <span className="shrink-0 text-xs font-semibold text-[#806A8C]">
                                Next {data.scope.periodDays} days
                            </span>
                        </div>

                        <div className="mt-6 space-y-5">
                            {branches.length > 0 ? (
                                branches.map((branch, index) => {
                                    const percent = Math.max(
                                        8,
                                        Math.round(
                                            (branch.demand / highestDemand) * 100
                                        )
                                    );

                                    const barClass =
                                        index === 0
                                            ? "bg-[#2B174C]"
                                            : index === 1
                                                ? "bg-[#9B7EBC]"
                                                : "bg-[#C9951A]";

                                    return (
                                        <button
                                            key={branch.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedBranchId(branch.id);
                                            }}
                                            className="block w-full text-left"
                                        >
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-[#1A1220]">
                                                        {branch.name}
                                                    </p>
                                                    <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                        {formatNumber(
                                                            branch.highDemandItems
                                                        )}{" "}
                                                        high-demand item
                                                        {branch.highDemandItems === 1
                                                            ? ""
                                                            : "s"}{" "}
                                                        · {formatNumber(
                                                        branch.growingItems
                                                    )}{" "}
                                                        rising/new · Top demand:{" "}
                                                        {branch.topItem}
                                                    </p>
                                                </div>

                                                <span className="shrink-0 text-sm font-bold text-[#2B174C]">
                                                    {formatNumber(branch.demand)} units
                                                </span>
                                            </div>

                                            <div className="h-2.5 overflow-hidden rounded-full bg-[#EEE8F8]">
                                                <div
                                                    className={`h-full rounded-full ${barClass}`}
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                        </button>
                                    );
                                })
                            ) : (
                                <p className="text-sm text-[#7A6A84]">
                                    No branch demand data is available yet.
                                </p>
                            )}
                        </div>
                    </section>

                    <section className="overflow-hidden rounded-[14px] border border-[#E6DDF0] bg-white shadow-sm">
                        <div className="border-b border-[#E6DDF0] px-4 py-3.5">
                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                Branch demand summary
                            </h2>
                            <p className="mt-1 text-xs text-[#7A6A84]">
                                Open a branch to view its product trends, seasonal
                                signals, booking demand, and stock planning actions.
                            </p>
                        </div>

                        {branches.length > 0 ? (
                            <div className="divide-y divide-[#EEE7F2]">
                                {branches.map((branch) => (
                                    <button
                                        key={branch.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedBranchId(branch.id);
                                        }}
                                        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-[#FCFAFE]"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-[#1A1220]">
                                                {branch.name}
                                            </p>
                                            <p className="mt-1 truncate text-xs text-[#7A6A84]">
                                                Top demand: {branch.topItem}
                                            </p>
                                            <p className="mt-1 text-xs text-[#806A8C]">
                                                {formatNumber(branch.highDemandItems)}{" "}
                                                high-demand · {formatNumber(
                                                branch.growingItems
                                            )}{" "}
                                                rising/new
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 items-center gap-2">
                                            <span className="text-sm font-bold text-[#2B174C]">
                                                {formatNumber(branch.demand)} units
                                            </span>
                                            <ChevronRight
                                                size={17}
                                                className="text-[#806A8C]"
                                            />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="p-6 text-center text-sm text-[#7A6A84]">
                                No branch forecast summary is available yet.
                            </div>
                        )}
                    </section>
                </div>
            ) : null}

            <ForecastDetails
                data={branchData}
                seasonalData={displayedSeasonalData}
                seasonalLoading={displayedSeasonalLoading}
                seasonalError={displayedSeasonalError}
                seasonalRange={seasonalRange}
                applySeasonalRange={handleApplySeasonalRange}
                bookingData={scopedBookingData}
                bookingLoading={bookingLoading}
                bookingError={bookingError}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                title={
                    isAllBranches
                        ? "All Branches Demand Forecast Details"
                        : `${selectedBranch?.name || "Branch"} Demand Forecast Details`
                }
                subtitle={`Scope: ${activeScopeLabel} · Product Demand uses ${branchData.scope.historyWeeks} weeks of completed POS sales.`}
                canViewInventory
                showProductSummaryCards={false}
            />
        </div>
    );
}