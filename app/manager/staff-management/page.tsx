"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import {
    Building2,
    CheckCircle2,
    ChevronDown,
    Clock3,
    Copy,
    Filter,
    Mail,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Send,
    UserPlus,
    UsersRound,
    UserX,
    X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type AccessMode = "none" | "view" | "full";
type ReportsAccessMode = "none" | "view";
type StaffStatusFilter = "all" | "active" | "inactive" | "pending";

type StaffPermissions = {
    dashboard: boolean;
    pos: boolean;
    pos_access: AccessMode;
    bookings: boolean;
    bookings_access: AccessMode;
    inventory: boolean;
    inventory_access: AccessMode;
    packages: boolean;
    package_access: AccessMode;
    reports: boolean;
    reports_access: ReportsAccessMode;
};

type PendingInvite = {
    id: number | string;
    email: string;
    invitedAt: string;
    expiresAt: string;
    status: "Pending";
    permissions: StaffPermissions;
};

type StaffMember = {
    id: number | string;
    name: string;
    email: string;
    status: "Accepted" | "Inactive";
    permissions: StaffPermissions;
};

const defaultPermissions: StaffPermissions = {
    dashboard: true,
    pos: false,
    pos_access: "none",
    bookings: false,
    bookings_access: "none",
    inventory: false,
    inventory_access: "none",
    packages: false,
    package_access: "none",
    reports: false,
    reports_access: "none",
};

function formatCurrentDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const timeLabel = value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();

    return `${dateLabel} | ${timeLabel}`;
}

export default function ManagerStaffManagementPage() {
    const router = useRouter();

    const [branchName, setBranchName] = useState("Assigned branch");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const [staffName, setStaffName] = useState("");
    const [staffEmail, setStaffEmail] = useState("");
    const [permissions, setPermissions] = useState<StaffPermissions>(defaultPermissions);

    const [loading, setLoading] = useState(false);
    const [pageLoading, setPageLoading] = useState(true);

    const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
    const [staffList, setStaffList] = useState<StaffMember[]>([]);
    const [staffSearch, setStaffSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>("all");

    const [inviteLink, setInviteLink] = useState("");
    const [showAddDialog, setShowAddDialog] = useState(false);

    const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
    const [editPermissions, setEditPermissions] = useState<StaffPermissions>(defaultPermissions);
    const [savingEdit, setSavingEdit] = useState(false);
    const [updatingStaffStatusId, setUpdatingStaffStatusId] = useState<
        number | string | null
    >(null);

    const getToken = () => sessionStorage.getItem("token") || "";

    const loadStaff = useCallback(async () => {
        const token = getToken();

        if (!token) {
            router.push("/");
            return;
        }

        try {
            setPageLoading(true);

            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action: "get_staff" }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || "Failed to load staff.");
                return;
            }

            const rawStaff = data.staff || data.staff_list || [];
            const rawPending = data.pending_invites || data.pendingInvites || data.invites || [];

            setStaffList(rawStaff.map(normalizeStaffMember));
            setPendingInvites(rawPending.map(normalizePendingInvite));
        } catch {
            alert("Something went wrong while loading staff.");
        } finally {
            setPageLoading(false);
        }
    }, [router]);

    useEffect(() => {
        const token = sessionStorage.getItem("token");
        const role = sessionStorage.getItem("role");

        let savedPermissions: Record<string, boolean> = {};

        try {
            savedPermissions = JSON.parse(sessionStorage.getItem("permissions") || "{}");
        } catch {
            savedPermissions = {};
        }

        if (!token || role !== "manager") {
            router.push("/");
            return;
        }

        if (!savedPermissions.staff_management) {
            alert("You do not have access to staff management.");
            router.push("/dashboard");
            return;
        }

        setBranchName(sessionStorage.getItem("branch_name") || "Assigned branch");
        loadStaff();
    }, [router, loadStaff]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());
        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const staffSummary = useMemo(() => {
        const active = staffList.filter((staff) => staff.status === "Accepted").length;
        const inactive = staffList.filter((staff) => staff.status === "Inactive").length;

        return {
            total: staffList.length,
            active,
            inactive,
            pending: pendingInvites.length,
        };
    }, [pendingInvites.length, staffList]);

    const filteredStaff = useMemo(() => {
        const query = staffSearch.trim().toLowerCase();

        return staffList.filter((staff) => {
            const mappedStatus = staff.status === "Accepted" ? "active" : "inactive";
            const matchesStatus = statusFilter === "all" ? true : mappedStatus === statusFilter;
            const searchText = `${staff.name} ${staff.email} ${branchName} ${formatRoleSummary(staff.permissions)}`.toLowerCase();
            const matchesSearch = query ? searchText.includes(query) : true;
            return matchesStatus && matchesSearch;
        });
    }, [branchName, staffList, staffSearch, statusFilter]);

    const filteredPendingInvites = useMemo(() => {
        const query = staffSearch.trim().toLowerCase();
        if (statusFilter !== "all" && statusFilter !== "pending") return [];

        return pendingInvites.filter((invite) => {
            const searchText = `${invite.email} ${branchName} pending ${formatRoleSummary(invite.permissions)}`.toLowerCase();
            return query ? searchText.includes(query) : true;
        });
    }, [branchName, pendingInvites, staffSearch, statusFilter]);

    const updateFeatureAccess = (
        feature: "pos" | "bookings" | "inventory" | "packages",
        value: AccessMode
    ) => {
        const accessKey = feature === "packages" ? "package_access" : `${feature}_access`;

        setPermissions((prev) => ({
            ...prev,
            [feature]: value !== "none",
            [accessKey]: value,
        }));
    };

    const updateReportsAccess = (value: ReportsAccessMode) => {
        setPermissions((prev) => ({
            ...prev,
            reports: value !== "none",
            reports_access: value,
        }));
    };

    const updateEditFeatureAccess = (
        feature: "pos" | "bookings" | "inventory" | "packages",
        value: AccessMode
    ) => {
        const accessKey = feature === "packages" ? "package_access" : `${feature}_access`;

        setEditPermissions((prev) => ({
            ...prev,
            [feature]: value !== "none",
            [accessKey]: value,
        }));
    };

    const updateEditReportsAccess = (value: ReportsAccessMode) => {
        setEditPermissions((prev) => ({
            ...prev,
            reports: value !== "none",
            reports_access: value,
        }));
    };

    const clearForm = () => {
        setStaffName("");
        setStaffEmail("");
        setPermissions(defaultPermissions);
    };

    const handleSendInvite = async () => {
        if (!staffName.trim() || !staffEmail.trim()) {
            alert("Please enter staff name and email.");
            return;
        }

        const token = sessionStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "invite_staff",
                    staff_name: staffName.trim(),
                    staff_email: staffEmail.trim(),
                    permissions,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                alert(data.error || JSON.stringify(data));
                return;
            }

            const generatedLink = data.invite_link || data.inviteLink || "";
            setInviteLink(generatedLink);
            clearForm();
            setShowAddDialog(false);
            await loadStaff();
            alert("Staff invite link created!");
        } catch {
            alert("Something went wrong while creating staff invite.");
        } finally {
            setLoading(false);
        }
    };

    const handleEditStaff = (staff: StaffMember) => {
        setEditingStaff(staff);
        setEditPermissions(normalizePermissions(staff.permissions));
    };

    const handleSaveEdit = async () => {
        if (!editingStaff) return;

        const token = getToken();
        if (!token) {
            router.push("/");
            return;
        }

        setSavingEdit(true);

        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "update_staff_permissions",
                    staff_id: editingStaff.id,
                    staff_email: editingStaff.email,
                    permissions: editPermissions,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                alert(data.error || JSON.stringify(data));
                return;
            }

            window.dispatchEvent(new Event("stocknbook-permissions-updated"));
            setEditingStaff(null);
            await loadStaff();
            alert("Staff access updated!");
        } catch {
            alert("Something went wrong while updating staff access.");
        } finally {
            setSavingEdit(false);
        }
    };

    const handleUpdateStaffStatus = async (staff: StaffMember) => {
        const token = getToken();

        if (!token) {
            router.push("/");
            return;
        }

        const isInactive = staff.status === "Inactive";
        const action = isInactive
            ? "reactivate_staff"
            : "deactivate_staff";
        const actionLabel = isInactive
            ? "reactivate"
            : "deactivate";

        const confirmed = window.confirm(
            `Are you sure you want to ${actionLabel} ${staff.name}'s account?`
        );

        if (!confirmed) return;

        setUpdatingStaffStatusId(staff.id);

        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action,
                    staff_id: staff.id,
                    staff_email: staff.email,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(
                    data.error ||
                    data.message ||
                    `Failed to ${actionLabel} staff account.`
                );
                return;
            }

            await loadStaff();

            alert(
                isInactive
                    ? "Staff account reactivated successfully."
                    : "Staff account deactivated successfully."
            );
        } catch {
            alert(
                `Something went wrong while trying to ${actionLabel} the staff account.`
            );
        } finally {
            setUpdatingStaffStatusId(null);
        }
    };

    const handleResendInvite = async (email: string) => {
        const token = getToken();
        if (!token) {
            router.push("/");
            return;
        }

        try {
            const res = await fetch("/api/staff-management", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "resend_staff_invite",
                    staff_email: email,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                alert(data.error || JSON.stringify(data));
                return;
            }

            await loadStaff();
            alert(`Invite resent to ${email}`);
        } catch {
            alert("Something went wrong while resending invite.");
        }
    };

    return (
        <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-y-auto">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex min-h-[86px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                                <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[#1A1220]">
                                    Staff Management
                                </h1>
                            </div>
                            <p className="mt-1 text-[12px] text-[#7A6A84]">
                                Manage staff members and their access for your branch.
                            </p>
                        </div>

                        <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime ? formatCurrentDateTime(currentDateTime) : "Loading date..."}
                            </span>

                            <button
                                type="button"
                                onClick={() => void loadStaff()}
                                disabled={pageLoading}
                                aria-label="Refresh staff"
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <RefreshCw size={16} className={pageLoading ? "animate-spin" : ""} />
                                Refresh
                            </button>
                        </div>
                    </div>
                </header>

                <section className="space-y-4 px-6 py-5">
                    <div className="grid gap-4 md:grid-cols-3">
                        <SummaryCard
                            icon={<UsersRound size={25} strokeWidth={2} />}
                            title="Total Staff"
                            value={staffSummary.total}
                            subtitle="Across your branch"
                            tone="purple"
                        />
                        <SummaryCard
                            icon={<CheckCircle2 size={25} strokeWidth={2} />}
                            title="Active Staff"
                            value={staffSummary.active}
                            subtitle="Currently active"
                            tone="green"
                        />
                        <SummaryCard
                            icon={<UserX size={25} strokeWidth={2} />}
                            title="Inactive Staff"
                            value={staffSummary.inactive}
                            subtitle="Currently inactive"
                            tone="red"
                        />
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row">
                        <div className="relative min-w-0 flex-1">
                            <Search
                                size={18}
                                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />

                            <input
                                value={staffSearch}
                                onChange={(event) =>
                                    setStaffSearch(event.target.value)
                                }
                                placeholder="Search staff name, email, branch, or role..."
                                className="h-[48px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-4 pl-11 pr-11 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />

                            {staffSearch && (
                                <button
                                    type="button"
                                    onClick={() => setStaffSearch("")}
                                    aria-label="Clear staff search"
                                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#806A8C] transition hover:bg-[#F1E9FF] hover:text-[#2B174C]"
                                >
                                    <X size={15} />
                                </button>
                            )}
                        </div>

                        <div className="flex shrink-0 gap-2.5">
                            <div className="relative">
                                <Filter
                                    size={16}
                                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#2B174C]"
                                />

                                <select
                                    value={statusFilter}
                                    onChange={(event) =>
                                        setStatusFilter(
                                            event.target.value as StaffStatusFilter
                                        )
                                    }
                                    aria-label="Filter staff by status"
                                    className="h-[48px] min-w-[150px] appearance-none rounded-xl border border-[#E6DDF0] bg-white pl-10 pr-10 text-sm font-semibold text-[#2B174C] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                >
                                    <option value="all">All Status</option>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                    <option value="pending">Pending</option>
                                </select>

                                <ChevronDown
                                    size={15}
                                    className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#806A8C]"
                                />
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowAddDialog(true)}
                                title="Add a staff member"
                                className="inline-flex h-[48px] min-w-[158px] items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold shadow-sm transition hover:brightness-110 active:scale-[0.99]"
                                style={{
                                    backgroundColor: "#2B174C",
                                    border: "1px solid #2B174C",
                                    color: "#FFFFFF",
                                    boxShadow:
                                        "0 4px 10px rgba(43, 23, 76, 0.22)",
                                }}
                            >
                                <Plus
                                    size={18}
                                    strokeWidth={2.2}
                                    color="#FFFFFF"
                                />
                                <span style={{ color: "#FFFFFF" }}>
                                        Add Staff
                                    </span>
                            </button>
                        </div>
                    </div>

                    {inviteLink && (
                        <section className="rounded-[18px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#3367D6]">
                                    <Mail size={18} />
                                </span>
                                <div>
                                    <h2 className="text-[16px] font-bold text-[#1A1220]">
                                        Latest invite link
                                    </h2>
                                    <p className="mt-0.5 text-xs text-[#7A6A84]">
                                        Copy this link and use it to activate the staff account.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                <input
                                    readOnly
                                    value={inviteLink}
                                    className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#5F4E75] outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(inviteLink);
                                        alert("Staff invite link copied!");
                                    }}
                                    className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                >
                                    <Copy size={15} />
                                    Copy
                                </button>
                            </div>
                        </section>
                    )}

                    <section className="overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6DDF0] px-5 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]">
                                    <UsersRound size={21} strokeWidth={2} />
                                </span>

                                <div className="min-w-0">
                                    <h2 className="text-[18px] font-bold tracking-[-0.015em] text-[#1A1220]">
                                        Staff List
                                    </h2>
                                    <p className="mt-0.5 text-xs text-[#7A6A84]">
                                        Staff members assigned to {branchName}.
                                    </p>
                                </div>
                            </div>

                            <span className="inline-flex items-center rounded-full bg-[#F5EEFF] px-3 py-1.5 text-xs font-semibold text-[#6D35D4]">
                                {filteredStaff.length}{" "}
                                {filteredStaff.length === 1
                                    ? "staff member"
                                    : "staff members"}
                            </span>
                        </div>

                        {pageLoading ? (
                            <div className="flex min-h-[180px] items-center justify-center px-4 text-sm text-[#7A6A84]">
                                Loading staff...
                            </div>
                        ) : filteredStaff.length === 0 ? (
                            <div className="flex min-h-[180px] flex-col items-center justify-center px-4 text-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                                    <UsersRound size={22} />
                                </span>
                                <p className="mt-3 text-sm font-semibold text-[#1A1220]">
                                    No staff found.
                                </p>
                                <p className="mt-1 text-sm text-[#7A6A84]">
                                    Try another name, email, role, or status.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto p-4">
                                <div
                                    className="overflow-hidden rounded-[14px]"
                                    style={{
                                        boxShadow:
                                            "inset 0 0 0 1px #EAE2F0",
                                    }}
                                >
                                    <table className="w-full min-w-[900px] border-collapse font-sans">
                                        <thead className="bg-[#FBF8FF]">
                                        <tr className="border-b border-[#E6DDF0]">
                                            <TableHeader>Staff</TableHeader>
                                            <TableHeader>Access / Role</TableHeader>
                                            <TableHeader>Status</TableHeader>
                                            <TableHeader align="right">
                                                Actions
                                            </TableHeader>
                                        </tr>
                                        </thead>

                                        <tbody>
                                        {filteredStaff.map((staff) => (
                                            <tr
                                                key={staff.id}
                                                className="border-b border-[#EEE7F2] bg-white last:border-b-0 transition hover:bg-[#FFFCF7]"
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="flex min-w-0 items-center gap-3">
                                                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F1EBFF] text-sm font-bold text-[#6D35D4]">
                                                                {getInitials(staff.name)}
                                                            </span>

                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-bold text-[#1A1220]">
                                                                {staff.name}
                                                            </p>
                                                            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-[#7A6A84]">
                                                                <Mail
                                                                    size={12}
                                                                    className="shrink-0 text-[#806A8C]"
                                                                />
                                                                <span className="truncate">
                                                                        {staff.email}
                                                                    </span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-5 py-4">
                                                    <div className="flex min-w-0 items-center gap-2.5">
                                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                                                                <Building2
                                                                    size={17}
                                                                    strokeWidth={2}
                                                                />
                                                            </span>

                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-semibold text-[#1A1220]">
                                                                {branchName}
                                                            </p>
                                                            <p className="mt-1 max-w-[420px] truncate text-xs text-[#7A6A84]">
                                                                Branch Staff ({formatRoleSummary(
                                                                staff.permissions
                                                            )})
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-5 py-4">
                                                    <StatusBadge
                                                        label={
                                                            staff.status === "Accepted"
                                                                ? "Active"
                                                                : "Inactive"
                                                        }
                                                        tone={
                                                            staff.status === "Accepted"
                                                                ? "green"
                                                                : "red"
                                                        }
                                                    />
                                                </td>

                                                <td className="px-5 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2.5">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleEditStaff(staff)
                                                            }
                                                            className="inline-flex h-[38px] items-center justify-center gap-2 rounded-xl border border-[#D7C7E8] bg-white px-4 text-xs font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#F7F1FF]"
                                                        >
                                                            <Pencil size={14} />
                                                            Edit Access
                                                        </button>

                                                        <button
                                                            type="button"
                                                            disabled={
                                                                updatingStaffStatusId ===
                                                                staff.id
                                                            }
                                                            onClick={() =>
                                                                void handleUpdateStaffStatus(
                                                                    staff
                                                                )
                                                            }
                                                            className={`inline-flex h-[38px] min-w-[104px] items-center justify-center rounded-xl px-4 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                                                staff.status ===
                                                                "Inactive"
                                                                    ? "border border-[#D7C7E8] bg-white text-[#2B174C] hover:bg-[#F7F1FF]"
                                                                    : "bg-[#A33E20] text-white hover:bg-[#883117]"
                                                            }`}
                                                        >
                                                            {updatingStaffStatusId ===
                                                            staff.id
                                                                ? "Saving..."
                                                                : staff.status ===
                                                                "Inactive"
                                                                    ? "Reactivate"
                                                                    : "Deactivate"}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="px-1 pt-4 text-xs text-[#7A6A84]">
                                    Showing {filteredStaff.length} of {staffList.length}{" "}
                                    {staffList.length === 1
                                        ? "staff member"
                                        : "staff members"}
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6DDF0] px-5 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF6DF] text-[#A56607]">
                                    <Clock3 size={20} />
                                </span>
                                <div className="min-w-0">
                                    <h2 className="text-[18px] font-bold text-[#1A1220]">
                                        Pending Invites
                                    </h2>
                                    <p className="mt-0.5 text-xs text-[#7A6A84]">
                                        Invitations waiting to be accepted.
                                    </p>
                                </div>
                            </div>

                            <span className="inline-flex items-center rounded-full bg-[#FFF7E8] px-3 py-1.5 text-xs font-semibold text-[#A56607]">
                                {filteredPendingInvites.length} pending
                            </span>
                        </div>

                        <div className="p-4">
                            {pageLoading ? (
                                <EmptyState text="Loading invites..." />
                            ) : filteredPendingInvites.length === 0 ? (
                                <EmptyState
                                    text={
                                        staffSearch || statusFilter === "pending"
                                            ? "No pending invite matched your filter."
                                            : "No pending invites yet."
                                    }
                                />
                            ) : (
                                <div className="overflow-x-auto">
                                    <div
                                        className="overflow-hidden rounded-[14px]"
                                        style={{
                                            boxShadow:
                                                "inset 0 0 0 1px #EAE2F0",
                                        }}
                                    >
                                        <table className="w-full min-w-[820px] border-collapse font-sans">
                                            <thead className="bg-[#FBF8FF]">
                                            <tr className="border-b border-[#E6DDF0]">
                                                <TableHeader>Email</TableHeader>
                                                <TableHeader>Invitation</TableHeader>
                                                <TableHeader>Access</TableHeader>
                                                <TableHeader align="right">
                                                    Actions
                                                </TableHeader>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {filteredPendingInvites.map(
                                                (invite) => (
                                                    <tr
                                                        key={invite.id}
                                                        className="border-b border-[#EEE7F2] bg-white last:border-b-0"
                                                    >
                                                        <td className="px-5 py-4 text-sm font-semibold text-[#1A1220]">
                                                            {invite.email}
                                                        </td>
                                                        <td className="px-5 py-4 text-xs text-[#7A6A84]">
                                                            Invited {invite.invitedAt}
                                                            <br />
                                                            Expires {invite.expiresAt}
                                                        </td>
                                                        <td className="max-w-[420px] px-5 py-4 text-xs text-[#806A8C]">
                                                            <p className="truncate">
                                                                {formatPermissions(
                                                                    invite.permissions
                                                                )}
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-4 text-right">
                                                            <div className="inline-flex items-center gap-2">
                                                                <StatusBadge
                                                                    label="Pending"
                                                                    tone="gold"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        handleResendInvite(
                                                                            invite.email
                                                                        )
                                                                    }
                                                                    className="inline-flex h-[38px] items-center justify-center gap-2 rounded-xl border border-[#D7C7E8] bg-white px-4 text-xs font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                                                >
                                                                    <Send size={14} />
                                                                    Resend
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                </section>
            </main>

            {showAddDialog && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
                    onMouseDown={() => {
                        if (!loading) {
                            setShowAddDialog(false);
                        }
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="add-staff-dialog-title"
                        className="max-h-[78vh] w-full max-w-[1120px] overflow-y-auto rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl"
                        onMouseDown={(event) =>
                            event.stopPropagation()
                        }
                    >
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E6DDF0] bg-white px-6 py-5">
                            <div>
                                <h2
                                    id="add-staff-dialog-title"
                                    className="text-[22px] font-bold tracking-[-0.02em] text-[#1A1220]"
                                >
                                    Add Staff
                                </h2>
                                <p className="mt-1 text-sm text-[#7A6A84]">
                                    Send an email invite and choose which features this staff member can access.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!loading) {
                                        setShowAddDialog(false);
                                    }
                                }}
                                disabled={loading}
                                aria-label="Close Add Staff dialog"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-5 px-6 py-5">
                            <div className="rounded-[18px] border border-[#E6DDF0] bg-[#FFFEFC] p-5">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                                        <UserPlus size={19} />
                                    </div>
                                    <div>
                                        <h3 className="text-[17px] font-bold text-[#1A1220]">Add a staff member</h3>
                                        <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                                            Access applies to {branchName} only.
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-5 grid gap-4 md:grid-cols-2">
                                    <FormInput
                                        label="Full name"
                                        placeholder="Pedro Ramos"
                                        value={staffName}
                                        onChange={setStaffName}
                                    />
                                    <FormInput
                                        label="Email address"
                                        placeholder="pedro@example.com"
                                        value={staffEmail}
                                        onChange={setStaffEmail}
                                        type="email"
                                    />
                                </div>

                                <div className="mt-5 border-t border-[#E6DDF0] pt-5">
                                    <h3 className="text-[16px] font-bold text-[#1A1220]">Feature access</h3>
                                    <p className="mt-1 text-xs text-[#7A6A84]">Choose which modules this staff member can access.</p>

                                    <div className="mt-4 space-y-3">
                                        <DashboardAccessRow
                                            checked={permissions.dashboard}
                                            onChange={(checked) =>
                                                setPermissions((prev) => ({
                                                    ...prev,
                                                    dashboard: checked,
                                                }))
                                            }
                                        />
                                        <AccessModeRow
                                            label="POS / Sales"
                                            value={permissions.pos_access}
                                            onChange={(value) => updateFeatureAccess("pos", value as AccessMode)}
                                        />
                                        <AccessModeRow
                                            label="Bookings"
                                            value={permissions.bookings_access}
                                            onChange={(value) => updateFeatureAccess("bookings", value as AccessMode)}
                                        />
                                        <AccessModeRow
                                            label="Inventory"
                                            value={permissions.inventory_access}
                                            onChange={(value) => updateFeatureAccess("inventory", value as AccessMode)}
                                        />
                                        <AccessModeRow
                                            label="Packages"
                                            value={permissions.package_access}
                                            onChange={(value) => updateFeatureAccess("packages", value as AccessMode)}
                                        />
                                        <AccessModeRow
                                            label="Reports"
                                            value={permissions.reports_access}
                                            allowFull={false}
                                            onChange={(value) => updateReportsAccess(value as ReportsAccessMode)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="sticky bottom-0 z-10 grid gap-3 border-t border-[#E6DDF0] bg-white px-6 py-4 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => {
                                    clearForm();
                                    setShowAddDialog(false);
                                }}
                                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl border border-[#DCCFE8] bg-white px-5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                            >
                                <RotateCcw size={16} />
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={handleSendInvite}
                                disabled={loading}
                                className="inline-flex h-[44px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Send size={16} />
                                {loading ? "Sending..." : "Send invite"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editingStaff && (
                <ModalShell onClose={() => !savingEdit && setEditingStaff(null)}>
                    <div className="shrink-0 flex items-start justify-between gap-4 border-b border-[#E9E0EF] px-6 py-5">
                        <div>
                            <h2 className="text-[18px] font-bold text-[#1A1220]">Edit staff access</h2>
                            <p className="mt-1 text-sm text-[#7A6A84]">Update permissions for {editingStaff.name}.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEditingStaff(null)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#7A6A84] transition hover:bg-[#F7F1FF]"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
                        <div className="space-y-3">
                            <DashboardAccessRow
                                checked={editPermissions.dashboard}
                                onChange={(checked) =>
                                    setEditPermissions((prev) => ({
                                        ...prev,
                                        dashboard: checked,
                                    }))
                                }
                            />
                            <AccessModeRow
                                label="POS / Sales"
                                value={editPermissions.pos_access}
                                onChange={(value) => updateEditFeatureAccess("pos", value as AccessMode)}
                            />
                            <AccessModeRow
                                label="Bookings"
                                value={editPermissions.bookings_access}
                                onChange={(value) => updateEditFeatureAccess("bookings", value as AccessMode)}
                            />
                            <AccessModeRow
                                label="Inventory"
                                value={editPermissions.inventory_access}
                                onChange={(value) => updateEditFeatureAccess("inventory", value as AccessMode)}
                            />
                            <AccessModeRow
                                label="Packages"
                                value={editPermissions.package_access}
                                onChange={(value) => updateEditFeatureAccess("packages", value as AccessMode)}
                            />
                            <AccessModeRow
                                label="Reports"
                                value={editPermissions.reports_access}
                                allowFull={false}
                                onChange={(value) => updateEditReportsAccess(value as ReportsAccessMode)}
                            />
                        </div>
                    </div>

                    <div className="shrink-0 grid gap-3 border-t border-[#E9E0EF] bg-white px-6 py-4 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setEditingStaff(null)}
                            className="inline-flex h-[44px] items-center justify-center rounded-xl border border-[#DCCFE8] bg-white px-5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveEdit}
                            disabled={savingEdit}
                            className="inline-flex h-[44px] items-center justify-center rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {savingEdit ? "Saving..." : "Save changes"}
                        </button>
                    </div>
                </ModalShell>
            )}
        </div>
    );
}

function normalizeStaffMember(item: any): StaffMember {
    return {
        id: item.id || item.staff_id || item.user_id || item.email,
        name: item.name || item.staff_name || item.full_name || "Unnamed staff",
        email: item.email || item.staff_email || "",
        status: item.status === "Inactive" || item.status === "inactive" ? "Inactive" : "Accepted",
        permissions: normalizePermissions(item.permissions),
    };
}

function normalizePendingInvite(item: any): PendingInvite {
    return {
        id: item.id || item.invite_id || item.staff_email || item.email,
        email: item.email || item.staff_email || "",
        invitedAt: item.invitedAt || item.invited_at || item.created_at || "Recently",
        expiresAt: item.expiresAt || item.expires_at || item.expiration || "Pending",
        status: "Pending",
        permissions: normalizePermissions(item.permissions),
    };
}

function normalizePermissions(raw: any): StaffPermissions {
    let parsed = raw;

    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = {};
        }
    }

    parsed = parsed || {};

    const posAccess = getAccessValue(parsed.pos_access, parsed.pos);
    const bookingsAccess = getAccessValue(parsed.bookings_access, parsed.bookings);
    const inventoryAccess = getAccessValue(parsed.inventory_access, parsed.inventory);
    const packageAccess = getAccessValue(parsed.package_access, parsed.packages);
    const reportsAccess = getReportsAccessValue(parsed.reports_access, parsed.reports);

    return {
        dashboard: Boolean(parsed.dashboard),
        pos: posAccess !== "none",
        pos_access: posAccess,
        bookings: bookingsAccess !== "none",
        bookings_access: bookingsAccess,
        inventory: inventoryAccess !== "none",
        inventory_access: inventoryAccess,
        packages: packageAccess !== "none",
        package_access: packageAccess,
        reports: reportsAccess !== "none",
        reports_access: reportsAccess,
    };
}

function getAccessValue(value: any, legacyBoolean: any): AccessMode {
    if (value === "view" || value === "full" || value === "none") return value;
    if (legacyBoolean === true) return "full";
    return "none";
}

function getReportsAccessValue(value: any, legacyBoolean: any): ReportsAccessMode {
    if (value === "view" || value === "none") return value;
    if (legacyBoolean === true) return "view";
    return "none";
}

function SummaryCard({
                         icon,
                         title,
                         value,
                         subtitle,
                         tone,
                     }: {
    icon: ReactNode;
    title: string;
    value: number;
    subtitle: string;
    tone: "purple" | "green" | "red";
}) {
    const style = {
        purple: {
            iconBackground: "bg-[#F1EBFF]",
            iconColor: "text-[#6D35D4]",
            borderColor: "#DDD0EE",
        },
        green: {
            iconBackground: "bg-[#E8F7EE]",
            iconColor: "text-[#138342]",
            borderColor: "#CFE8D8",
        },
        red: {
            iconBackground: "bg-[#FDEDED]",
            iconColor: "text-[#C13333]",
            borderColor: "#F0D2D2",
        },
    }[tone];

    return (
        <div
            className="flex min-h-[132px] items-center gap-4 rounded-[18px] bg-white px-5 py-5"
            style={{
                boxShadow: `inset 0 0 0 1px ${style.borderColor}, 0 2px 8px rgba(45, 27, 78, 0.06)`,
            }}
        >
            <span
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${style.iconBackground} ${style.iconColor}`}
            >
                {icon}
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#281246]">
                    {title}
                </p>
                <p className="mt-1.5 text-[26px] font-bold leading-none text-[#1A1220]">
                    {value}
                </p>
                <p className="mt-2 text-xs text-[#8A7D92]">
                    {subtitle}
                </p>
            </div>
        </div>
    );
}

function TableHeader({
                         children,
                         align = "left",
                     }: {
    children: ReactNode;
    align?: "left" | "right";
}) {
    return (
        <th
            className={`px-5 py-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#806A8C] ${
                align === "right" ? "text-right" : "text-left"
            }`}
        >
            {children}
        </th>
    );
}

function FormInput({
                       label,
                       placeholder,
                       value,
                       onChange,
                       type = "text",
                   }: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <div>
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">{label}</label>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-[44px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
            />
        </div>
    );
}

function DashboardAccessRow({
                                checked,
                                onChange,
                            }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex min-h-[58px] items-center justify-between rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-3">
            <span className="text-sm font-semibold text-[#1A1220]">Dashboard</span>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative h-[26px] w-[48px] rounded-full transition ${checked ? "bg-[#2B174C]" : "bg-[#D8CBE7]"}`}
            >
                <span
                    className={`absolute top-[3px] h-[20px] w-[20px] rounded-full bg-white transition ${checked ? "left-[25px]" : "left-[3px]"}`}
                />
            </button>
        </div>
    );
}

function AccessModeRow({
                           label,
                           value,
                           onChange,
                           allowFull = true,
                       }: {
    label: string;
    value: AccessMode | ReportsAccessMode;
    onChange: (value: AccessMode | ReportsAccessMode) => void;
    allowFull?: boolean;
}) {
    return (
        <div className="flex min-h-[58px] items-center justify-between rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-3">
            <span className="text-sm font-semibold text-[#1A1220]">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as AccessMode | ReportsAccessMode)}
                className="h-[38px] min-w-[136px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
            >
                <option value="none">No access</option>
                <option value="view">View only</option>
                {allowFull && <option value="full">Full access</option>}
            </select>
        </div>
    );
}

function StatusBadge({
                         label,
                         tone,
                     }: {
    label: string;
    tone: "green" | "gold" | "red";
}) {
    const style =
        tone === "green"
            ? "border border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]"
            : tone === "red"
                ? "border border-[#F1CACA] bg-[#FFF0F0] text-[#D4443A]"
                : "border border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";

    return <span className={`inline-flex rounded-full px-4 py-1.5 text-sm font-semibold ${style}`}>{label}</span>;
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7] px-4 py-6 text-sm text-[#7A6A84]">
            {text}
        </div>
    );
}

function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex h-[min(88vh,820px)] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-[#E6DDF0] bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

function formatPermissions(permissions: StaffPermissions) {
    const list: string[] = [];

    if (permissions.dashboard) list.push("Dashboard");
    if (permissions.pos_access !== "none") list.push(`POS / Sales: ${formatAccess(permissions.pos_access)}`);
    if (permissions.bookings_access !== "none") list.push(`Bookings: ${formatAccess(permissions.bookings_access)}`);
    if (permissions.inventory_access !== "none") list.push(`Inventory: ${formatAccess(permissions.inventory_access)}`);
    if (permissions.package_access !== "none") list.push(`Packages: ${formatAccess(permissions.package_access)}`);
    if (permissions.reports_access !== "none") list.push(`Reports: ${formatAccess(permissions.reports_access)}`);

    return list.length > 0 ? list.join(", ") : "No access";
}

function formatRoleSummary(permissions: StaffPermissions) {
    const shortLabels: string[] = [];
    if (permissions.dashboard) shortLabels.push("Dashboard");
    if (permissions.pos_access !== "none") shortLabels.push("Sales");
    if (permissions.bookings_access !== "none") shortLabels.push("Bookings");
    if (permissions.inventory_access !== "none") shortLabels.push("Inventory");
    if (permissions.package_access !== "none") shortLabels.push("Packages");
    if (permissions.reports_access !== "none") shortLabels.push("Reports");
    return shortLabels.length > 0 ? shortLabels.join(" & ") : "No access";
}

function formatAccess(value: AccessMode | ReportsAccessMode) {
    if (value === "none") return "No access";
    if (value === "view") return "View only";
    return "Full access";
}

function getInitials(name: string) {
    const cleaned = name.trim();
    if (!cleaned) return "ST";

    const parts = cleaned.split(/\s+/).slice(0, 2);
    return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}