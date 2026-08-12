"use client";

import {
    ReportsWorkspace,
    type ReportsViewConfig,
} from "./_shared";

export type StaffReportsProps = {
    assignedBranch: string;
    storeName: string;
};

const STAFF_REPORTS_VIEW: ReportsViewConfig = {
    showBranchFilter: false,
    showBranchColumn: false,
};

export default function StaffReports({
                                         assignedBranch,
                                         storeName,
                                     }: StaffReportsProps) {
    return (
        <ReportsWorkspace
            initialRole="staff"
            assignedBranch={assignedBranch}
            storeName={storeName}
            viewConfig={STAFF_REPORTS_VIEW}
        />
    );
}
