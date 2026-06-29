"use client";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    AnalyticsLoadingScreen,
    AnalyticsWorkspace,
} from "./_shared";

export default function ManagerAnalytics() {
    const { user, loading } = useCurrentUser();

    if (loading) {
        return <AnalyticsLoadingScreen />;
    }

    if (!user) {
        return null;
    }

    const currentUser = user as {
        branch_name?: string;
        branchName?: string;
    };

    const assignedBranch =
        currentUser.branch_name ||
        currentUser.branchName ||
        "Assigned Branch";

    return (
        <AnalyticsWorkspace
            role="manager"
            assignedBranch={assignedBranch}
        />
    );
}
