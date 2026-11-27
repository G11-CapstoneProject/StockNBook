"use client";

import { useEffect, useMemo, useState } from "react";
import {
    ErrorBox,
    stack,
} from "./_planning";
import {
    ForecastDetails,
    ForecastEmptyState,
    ForecastErrorState,
    ForecastLoadingState,
    OwnerBranchPicker,
    ScopeBar,
    type ForecastTab,
    type LiveForecastProps,
    type SeasonalApiResponse,
    type SeasonalDateRange,
    buildBranchForecasts,
    buildScopedBookingForecast,
    buildScopedForecast,
} from "./_shared";

async function requestOwnerScopedSeasonalForecast(
    branchId: number,
    range: SeasonalDateRange
): Promise<SeasonalApiResponse> {
    const token = typeof window !== "undefined" ? sessionStorage.getItem("token") : null;
    if (!token) throw new Error("You are signed out. Please sign in again.");

    const response = await fetch("/api/forecasting", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            action: "get_seasonal_analysis",
            branch_id: branchId,
            seasonalStartMonth: range.startMonth,
            seasonalEndMonth: range.endMonth,
        }),
        cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as SeasonalApiResponse | { error?: string; details?: string };
    if (!response.ok) {
        const errorPayload = payload as { error?: string; details?: string };
        const details = errorPayload.details ? ` ${errorPayload.details}` : "";
        throw new Error(`${errorPayload.error || "Busy months could not be loaded."}${details}`);
    }
    const seasonalPayload = payload as SeasonalApiResponse;
    if (!seasonalPayload.success || !seasonalPayload.seasonal) throw new Error("Busy months could not be loaded.");
    return seasonalPayload;
}

export default function OwnerForecast({
                                          data,
                                          loading,
                                          error,
                                          lastUpdated,
                                          seasonalData,
                                          seasonalLoading,
                                          seasonalError,
                                          seasonalRange,
                                          applySeasonalRange,
                                          bookingData,
                                          bookingLoading,
                                          bookingError,
                                          refresh,
                                      }: LiveForecastProps) {
    const [activeTab, setActiveTab] = useState<ForecastTab>("plan");
    const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
    const branches = useMemo(() => (data ? buildBranchForecasts(data.items) : []), [data]);

    // A selected branch loads its own busy-months pattern; "All branches" uses the store-wide one.
    // State changes only when a response arrives.
    const { startMonth, endMonth } = seasonalRange;
    const seasonalKey = selectedBranchId ? `${selectedBranchId}|${startMonth}|${endMonth}` : "";
    const [branchSeasonal, setBranchSeasonal] = useState<{ key: string; data: SeasonalApiResponse | null; error: string | null }>({ key: "", data: null, error: null });
    useEffect(() => {
        if (!selectedBranchId) return;
        let isCancelled = false;
        requestOwnerScopedSeasonalForecast(selectedBranchId, { startMonth, endMonth })
            .then((scoped) => { if (!isCancelled) setBranchSeasonal({ key: seasonalKey, data: scoped, error: null }); })
            .catch((requestError) => {
                if (!isCancelled) setBranchSeasonal((current) => ({
                    key: seasonalKey,
                    data: current.key.split("|")[0] === String(selectedBranchId) ? current.data : null,
                    error: requestError instanceof Error ? requestError.message : "Busy months could not be loaded.",
                }));
            });
        return () => { isCancelled = true; };
    }, [selectedBranchId, startMonth, endMonth, seasonalKey]);
    // Keep showing the same branch's last result while a new period loads; never another branch's.
    const sameBranch = selectedBranchId !== null && branchSeasonal.key.split("|")[0] === String(selectedBranchId);
    const ownerSeasonalData = sameBranch ? branchSeasonal.data : null;
    const ownerSeasonalLoading = selectedBranchId !== null && branchSeasonal.key !== seasonalKey;
    const ownerSeasonalError = branchSeasonal.key === seasonalKey ? branchSeasonal.error : null;

    if (loading && !data) return <ForecastLoadingState />;
    if (error && !data) return <ForecastErrorState message={error} onRetry={() => void refresh()} />;
    if (!data) return <ForecastEmptyState />;

    const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) ?? null;
    const branchData = selectedBranch ? buildScopedForecast(data, selectedBranch.id) : data;
    const scopedBookingData = selectedBranch ? buildScopedBookingForecast(bookingData, selectedBranch.id) : bookingData;

    const pickBranch = (branchId: number | null) => {
        setSelectedBranchId(branchId);
        if (branchId !== null && activeTab === "inventory") window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <div style={stack()}>
            {error && <ErrorBox message="Showing the last forecast that loaded. The latest update failed." onRetry={() => void refresh()} />}

            <ScopeBar
                title={selectedBranch?.name || "All branches"}
                updated={lastUpdated}
                right={<OwnerBranchPicker branches={branches} selectedBranchId={selectedBranchId} onSelectBranch={pickBranch} />}
            />

            <ForecastDetails
                data={branchData}
                seasonalData={selectedBranch ? ownerSeasonalData : seasonalData}
                seasonalLoading={selectedBranch ? ownerSeasonalLoading : seasonalLoading}
                seasonalError={selectedBranch ? ownerSeasonalError : seasonalError}
                seasonalRange={seasonalRange}
                applySeasonalRange={applySeasonalRange}
                bookingData={scopedBookingData}
                bookingLoading={bookingLoading}
                bookingError={bookingError}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                canViewInventory
                scopeBranchId={selectedBranch?.id ?? null}
                branches={selectedBranch ? undefined : branches}
                onPickBranch={(id) => pickBranch(id)}
            />
        </div>
    );
}
