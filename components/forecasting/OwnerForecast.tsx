"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CalendarDays,
    ChevronRight,
    PackageSearch,
    TrendingUp,
} from "lucide-react";
import {
    BranchForecastSelector,
    ForecastDetails,
    ForecastEmptyState,
    ForecastErrorState,
    ForecastLoadingState,
    type ForecastTab,
    type LiveForecastProps,
    buildBranchForecasts,
    buildScopedBookingForecast,
    buildScopedForecast,
    formatNumber,
    SummaryCard,
} from "./_shared";

type OwnerScope = "overall" | "branch";

function ScopeButton({
                         active,
                         label,
                         onClick,
                     }: {
    active: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`h-[40px] rounded-xl px-4 text-sm font-semibold transition ${
                active
                    ? "bg-[#2B174C] text-white shadow-sm"
                    : "border border-[#E6DDF0] bg-white text-[#5F4E75] hover:bg-[#F7F1FF]"
            }`}
        >
            {label}
        </button>
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
    const [scope, setScope] = useState<OwnerScope>("overall");
    const [activeTab, setActiveTab] = useState<ForecastTab>("inventory");
    const [selectedBranchId, setSelectedBranchId] = useState<number | null>(
        null
    );

    const branches = useMemo(
        () => (data ? buildBranchForecasts(data.items) : []),
        [data]
    );

    useEffect(() => {
        if (
            branches.length > 0 &&
            !branches.some((branch) => branch.id === selectedBranchId)
        ) {
            setSelectedBranchId(branches[0].id);
        }
    }, [branches, selectedBranchId]);

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
        branches.find((branch) => branch.id === selectedBranchId) ||
        branches[0];

    const branchData =
        scope === "branch" && selectedBranch
            ? buildScopedForecast(data, selectedBranch.id)
            : data;

    const scopedBookingData =
        scope === "branch" && selectedBranch
            ? buildScopedBookingForecast(bookingData, selectedBranch.id)
            : bookingData;

    const expectedBookings =
        scopedBookingData?.booking?.expectedBookings ??
        branchData.summary.expectedBookings;

    const highDemandItems =
        branchData.summary.highDemandItems ??
        branchData.items.filter((item) => item.demandLevel === "HIGH").length;

    const activeScopeLabel =
        scope === "overall"
            ? "All branches"
            : selectedBranch?.name || "Selected branch";

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
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                            <TrendingUp size={18} />
                        </div>

                        <div>
                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                Owner Demand Forecast Overview
                            </h2>
                            <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                                Compare projected customer demand across branches, then
                                open a branch to review product demand signals.
                            </p>
                        </div>
                    </div>

                    <span className="inline-flex w-fit rounded-full border border-[#D8CBE7] bg-[#F7F1FF] px-3 py-1.5 text-xs font-semibold text-[#4E2C66]">
                        {formatNumber(branches.length)} active branch
                        {branches.length === 1 ? "" : "es"}
                    </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-[#E6DDF0] pt-4">
                    <ScopeButton
                        active={scope === "overall"}
                        label="Overall Demand"
                        onClick={() => setScope("overall")}
                    />
                    <ScopeButton
                        active={scope === "branch"}
                        label="By Branch"
                        onClick={() => setScope("branch")}
                    />
                </div>
            </section>

            <div className="grid gap-3 md:grid-cols-3">
                <SummaryCard
                    icon={<PackageSearch size={18} />}
                    title={
                        scope === "overall"
                            ? "30-Day Customer Demand"
                            : "30-Day Branch Demand"
                    }
                    value={`${formatNumber(branchData.summary.projectedDemand)} units`}
                    detail={`${activeScopeLabel} · projected from completed POS sales`}
                    tone="purple"
                />
                <SummaryCard
                    icon={<TrendingUp size={18} />}
                    title="High-Demand Products"
                    value={`${formatNumber(highDemandItems)} item${
                        highDemandItems === 1 ? "" : "s"
                    }`}
                    detail="Demand level is ranked by projected demand, not stock quantity"
                    tone="green"
                />
                <SummaryCard
                    icon={<CalendarDays size={18} />}
                    title="Upcoming Booking Demand"
                    value={`${formatNumber(expectedBookings)} booking${
                        expectedBookings === 1 ? "" : "s"
                    }`}
                    detail={`Confirmed or preparing · next ${branchData.scope.periodDays} days`}
                    tone="gold"
                />
            </div>

            {scope === "overall" ? (
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
                                                setScope("branch");
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
                                            setScope("branch");
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
            ) : (
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                Select a branch
                            </h2>
                            <p className="mt-1 text-xs text-[#7A6A84]">
                                Demand Level is calculated within each selected branch,
                                so products are compared with relevant branch inventory.
                            </p>
                        </div>

                        <BranchForecastSelector
                            branches={branches}
                            selectedBranchId={selectedBranch?.id || null}
                            onSelectBranch={setSelectedBranchId}
                        />
                    </div>
                </section>
            )}

            <ForecastDetails
                data={branchData}
                seasonalData={seasonalData}
                seasonalLoading={seasonalLoading}
                seasonalError={seasonalError}
                seasonalRange={seasonalRange}
                applySeasonalRange={applySeasonalRange}
                bookingData={scopedBookingData}
                bookingLoading={bookingLoading}
                bookingError={bookingError}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                title={
                    scope === "overall"
                        ? "Overall Demand Forecast Details"
                        : `${selectedBranch?.name || "Branch"} Demand Forecast Details`
                }
                subtitle={`Scope: ${activeScopeLabel} · Product Demand uses ${branchData.scope.historyWeeks} weeks of completed POS sales.`}
                canViewInventory
            />
        </div>
    );
}
