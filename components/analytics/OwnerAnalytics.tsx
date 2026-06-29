"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    AnalyticsLoadingScreen,
    AnalyticsWorkspace,
    type AnalyticsBranch,
} from "./_shared";

type RawBranch = {
    id?: number | string;
    branch_id?: number | string;
    branchId?: number | string;
    branch_name?: string | null;
    branchName?: string | null;
    name?: string | null;
};

type BranchesResponse = {
    branches?: RawBranch[];
};

function getToken() {
    if (typeof window === "undefined") {
        return "";
    }

    return (
        sessionStorage.getItem("token") ||
        localStorage.getItem("token") ||
        ""
    );
}

function normalizeBranch(rawBranch: RawBranch): AnalyticsBranch | null {
    const rawId =
        rawBranch.id ?? rawBranch.branch_id ?? rawBranch.branchId ?? null;

    const id = Number(rawId);
    const name =
        rawBranch.branch_name ??
        rawBranch.branchName ??
        rawBranch.name ??
        "";

    if (!Number.isFinite(id) || id <= 0 || !name.trim()) {
        return null;
    }

    return {
        id,
        name: name.trim(),
    };
}

export default function OwnerAnalytics() {
    const { user, loading } = useCurrentUser();
    const [branches, setBranches] = useState<AnalyticsBranch[]>([]);
    const [branchesLoading, setBranchesLoading] = useState(true);

    const loadBranches = useCallback(async () => {
        try {
            setBranchesLoading(true);

            const token = getToken();
            const response = await fetch("/api/branches", {
                method: "GET",
                headers: token
                    ? { Authorization: `Bearer ${token}` }
                    : {},
                cache: "no-store",
            });

            if (!response.ok) {
                throw new Error("Unable to load branches.");
            }

            const result = (await response.json()) as BranchesResponse;
            const loadedBranches = Array.isArray(result.branches)
                ? result.branches
                    .map(normalizeBranch)
                    .filter(
                        (branch): branch is AnalyticsBranch =>
                            branch !== null
                    )
                : [];

            setBranches(loadedBranches);
        } catch (error) {
            console.warn("Owner Analytics branch loading failed:", error);
            setBranches([]);
        } finally {
            setBranchesLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!user) {
            return;
        }

        void loadBranches();
    }, [loadBranches, user]);

    if (loading) {
        return <AnalyticsLoadingScreen />;
    }

    if (!user) {
        return null;
    }

    return (
        <AnalyticsWorkspace
            role="owner"
            ownerBranches={branches}
            ownerBranchesLoading={branchesLoading}
        />
    );
}
