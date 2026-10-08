"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import OwnerReports from "@/components/reports/OwnerReports";
import ManagerReports from "@/components/reports/ManagerReports";
import StaffReports from "@/components/reports/StaffReports";
import RequirePermission from "@/components/permissions/RequirePermission";
import { ModulePageSkeleton } from "@/components/loading/ModuleSkeletons";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type UserRole = "owner" | "manager" | "staff";

function readStoredValue(keys: string[]) {
    if (typeof window === "undefined") return "";
    for (const key of keys) {
        const value = sessionStorage.getItem(key) || localStorage.getItem(key) || "";
        if (value.trim()) return value.trim();
    }
    return "";
}

export default function ReportsPage() {
    const { user, loading } = useCurrentUser();
    const currentUser = (user || {}) as Record<string, unknown>;
    const rawRole = String(currentUser.role || "").toLowerCase();
    const role: UserRole = rawRole === "owner" ? "owner" : rawRole === "staff" ? "staff" : "manager";
    const branch = String(
        currentUser.branch_name || currentUser.branchName ||
        readStoredValue(["branch_name", "stocknbook_branch_name", "branchName", "branch", "assignedBranch"]) ||
        "Assigned Branch"
    );
    const storeName = String(
        currentUser.store_name || currentUser.storeName || currentUser.business_name || currentUser.businessName ||
        readStoredValue(["store_name", "stocknbook_store_name", "business_name", "businessName", "store"]) ||
        "Store"
    );
    const workspaceKey = `${role}-${storeName}-${branch}`;

    if (loading) {
        return (
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-x-hidden">
                    <ModulePageSkeleton variant="reports" />
                </main>
            </div>
        );
    }

    if (!user) return null;

    return (
        <RequirePermission permission="reports">
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-x-hidden font-sans">
                    {role === "owner" ? (
                        <OwnerReports key={workspaceKey} assignedBranch={branch} storeName={storeName} />
                    ) : role === "manager" ? (
                        <ManagerReports key={workspaceKey} assignedBranch={branch} storeName={storeName} />
                    ) : (
                        <StaffReports key={workspaceKey} assignedBranch={branch} storeName={storeName} />
                    )}
                </main>
            </div>
        </RequirePermission>
    );
}