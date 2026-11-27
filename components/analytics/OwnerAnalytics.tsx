"use client";

import { useEffect, useState } from "react";
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

async function fetchBranches(): Promise<AnalyticsBranch[]> {
    const token = getToken();
    const response = await fetch("/api/branches", {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
    });
    if (!response.ok) {
        throw new Error("Unable to load branches.");
    }
    const result = (await response.json()) as BranchesResponse;
    return Array.isArray(result.branches)
        ? result.branches
            .map(normalizeBranch)
            .filter((branch): branch is AnalyticsBranch => branch !== null)
        : [];
}

export default function OwnerAnalytics() {
    const { user, loading } = useCurrentUser();
    // Set only when the branch list arrives (or fails), so the effect never sets state right away.
    const [branchList, setBranchList] = useState<{ loaded: boolean; branches: AnalyticsBranch[] }>({ loaded: false, branches: [] });

    useEffect(() => {
        if (!user) {
            return;
        }
        let cancelled = false;
        fetchBranches()
            .then((branches) => {
                if (!cancelled) setBranchList({ loaded: true, branches });
            })
            .catch((error) => {
                console.warn("Owner Analytics branch loading failed:", error);
                if (!cancelled) setBranchList({ loaded: true, branches: [] });
            });
        return () => {
            cancelled = true;
        };
    }, [user]);

    if (loading) {
        return <AnalyticsLoadingScreen />;
    }

    if (!user) {
        return null;
    }

    return (
        <AnalyticsWorkspace
            role="owner"
            ownerBranches={branchList.branches}
            ownerBranchesLoading={!branchList.loaded}
        />
    );
}
