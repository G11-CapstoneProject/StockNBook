"use client";

import {
    ReportsWorkspace,
    type ReportsViewConfig,
} from "./_shared";

export type ManagerReportsProps = {
    assignedBranch: string;
    storeName: string;
};

const MANAGER_REPORTS_VIEW: ReportsViewConfig = {
    showBranchFilter: false,
    showBranchColumn: false,
};

export default function ManagerReports({
                                           assignedBranch,
                                           storeName,
                                       }: ManagerReportsProps) {
    return (
        <ReportsWorkspace
            initialRole="manager"
            assignedBranch={assignedBranch}
            storeName={storeName}
            viewConfig={MANAGER_REPORTS_VIEW}
        />
    );
}
