"use client";

import {
    ReportsWorkspace,
    type ReportsViewConfig,
} from "./_shared";

export type OwnerReportsProps = {
    assignedBranch: string;
    storeName: string;
};

const OWNER_REPORTS_VIEW: ReportsViewConfig = {
    showBranchFilter: true,
    showBranchColumn: true,
};

export default function OwnerReports({
                                         assignedBranch,
                                         storeName,
                                     }: OwnerReportsProps) {
    return (
        <ReportsWorkspace
            initialRole="owner"
            assignedBranch={assignedBranch}
            storeName={storeName}
            viewConfig={OWNER_REPORTS_VIEW}
        />
    );
}
