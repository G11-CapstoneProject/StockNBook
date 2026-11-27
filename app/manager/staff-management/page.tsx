"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    CheckCircle2,
    AlertCircle,
    ChevronDown,
    Clock3,
    Copy,
    Filter,
    Mail,
    LockKeyhole,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Send,
    UserPlus,
    UsersRound,
    UserX,
    Download,
    X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type AccessMode = "none" | "view" | "full";
type StaffStatusFilter = "all" | "active" | "inactive" | "pending";

type StaffPermissions = {
    dashboard: boolean;
    pos: boolean;
    pos_access: AccessMode;
    bookings: boolean;
    bookings_access: AccessMode;
    inventory: boolean;
    inventory_access: AccessMode;
    inventory_stock_receive: boolean;
    packages: boolean;
    package_access: AccessMode;
};

type PendingInvite = {
    id: number | string;
    email: string;
    invitedAt: string;
    expiresAt: string;
    status: "Pending";
    permissions: StaffPermissions;
};

type StaffInviteDelivery = {
    email: string;
    emailSent: boolean;
    emailError: string;
};

type StaffMember = {
    id: number | string;
    employeeCode: string;
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
    inventory_stock_receive: false,
    packages: false,
    package_access: "none",
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
    const { toast, setToast, notify, confirmation, confirmAction, resolveConfirmation } = useModuleFeedback();

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
    const [inviteDelivery, setInviteDelivery] =
        useState<StaffInviteDelivery | null>(null);
    const [showAddDialog, setShowAddDialog] = useState(false);

    const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
    const [editPermissions, setEditPermissions] = useState<StaffPermissions>(defaultPermissions);
    const [savingEdit, setSavingEdit] = useState(false);
    const [updatingStaffStatusId, setUpdatingStaffStatusId] = useState<
        number | string | null
    >(null);
    const [resendingEmail, setResendingEmail] = useState<string | null>(null);
    const resendInFlight = useRef(false);

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
                notify("error", "Unable to load staff", data.error || "Please try again.");
                return;
            }

            const rawStaff = data.staff || data.staff_list || [];
            const rawPending = data.pending_invites || data.pendingInvites || data.invites || [];

            // Staff Management already returns the current DB permission JSON.
            // No secondary Inventory endpoint is needed when editing staff roles.
            setStaffList(rawStaff.map(normalizeStaffMember));
            setPendingInvites(rawPending.map(normalizePendingInvite));
        } catch {
            notify("error", "Unable to load staff", "Something went wrong. Please try again.");
        } finally {
            setPageLoading(false);
        }
    }, [router, notify]);

    const exportStaffListAsPdf = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                    title: "Staff List",
                    headers: ["Employee ID", "Staff", "Email", "Access", "Status"],
                    rows: filteredStaff.map(staff => [staff.employeeCode || "—", staff.name, staff.email,
                        formatRoleSummary(staff.permissions), staff.status === "Accepted" ? "Active" : "Inactive"]),
                }, { storeName: sessionStorage.getItem("store_name") || "StockNBook",
                    branch: branchName, dateRange: statusFilter === "all" ? "All statuses" : statusFilter },
                "manager_staff_list"))
            .catch(() => setToast({ kind: "error", title: "Export unavailable", message: "Could not export the staff list." }));
    };

    const exportPendingStaffInvitesAsPdf = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                title: "Pending Staff Invitations",
                headers: ["Email", "Invited", "Expires", "Access", "Status"],
                rows: pendingInvites.map(invite => [invite.email, invite.invitedAt,
                    invite.expiresAt, formatPermissions(invite.permissions), "Pending"]),
            }, { storeName: sessionStorage.getItem("store_name") || "StockNBook",
                branch: branchName, dateRange: "Pending invitations" }, "manager_staff_invites"))
            .catch(() => setToast({ kind: "error", title: "Export unavailable", message: "Could not export pending staff invitations." }));
    };

    useEffect(() => {
        const token = sessionStorage.getItem("token");
        const role = sessionStorage.getItem("role");

        // Staff Management is part of the Branch Manager role. The backend
        // still verifies the active Manager account and assigned branch on
        // every staff request, so an older session snapshot with a disabled
        // staff_management flag must not block an authorized Manager.
        if (!token || role !== "manager") {
            router.push("/");
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
            const searchText = `${staff.employeeCode} ${staff.name} ${staff.email} ${branchName} ${formatRoleSummary(staff.permissions)}`.toLowerCase();
            const matchesSearch = query ? searchText.includes(query) : true;
            return matchesStatus && matchesSearch;
        });
    }, [branchName, staffList, staffSearch, statusFilter]);


    const updateFeatureAccess = (
        feature: "pos" | "bookings" | "inventory" | "packages",
        value: AccessMode
    ) => {
        const accessKey = feature === "packages" ? "package_access" : `${feature}_access`;

        setPermissions((prev) => ({
            ...prev,
            [feature]: value !== "none",
            [accessKey]: feature === "packages"
                ? (value === "none" ? "none" : "view") : value,
            ...(feature === "inventory" && value !== "full"
                ? { inventory_stock_receive: false } : {}),
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
            [accessKey]: feature === "packages"
                ? (value === "none" ? "none" : "view") : value,
            ...(feature === "inventory" && value !== "full"
                ? { inventory_stock_receive: false } : {}),
        }));
    };

    const clearForm = () => {
        setStaffName("");
        setStaffEmail("");
        setPermissions(defaultPermissions);
    };

    const handleSendInvite = async () => {
        if (loading || savingEdit || updatingStaffStatusId !== null || resendInFlight.current) return;
        if (!staffName.trim() || !staffEmail.trim()) {
            notify("warning", "Missing staff details", "Please enter staff name and email.");
            return;
        }

        const token = sessionStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail.trim())) {
            notify("warning", "Invalid staff email", "Please enter a valid email address.");
            return;
        }
        const confirmed = await confirmAction({
            title: "Send staff invitation?",
            message: `Invite ${staffName.trim()} (${staffEmail.trim()}) to ${branchName} with the selected staff permissions?`,
            confirmLabel: "Send Invitation",
        });
        if (!confirmed) return;

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
                notify("error", "Unable to invite staff", data.error || data.message || "Please try again.");
                return;
            }

            const generatedLink = data.invite_link || data.inviteLink || "";
            const emailWasSent =
                data.email_sent === true ||
                String(data.email_status || "").toLowerCase() === "sent";

            setInviteLink(generatedLink);
            setInviteDelivery({
                email: staffEmail.trim().toLowerCase(),
                emailSent: emailWasSent,
                emailError: String(data.email_error || ""),
            });

            clearForm();
            setShowAddDialog(false);
            await loadStaff();

            if (emailWasSent) {
                notify("success", "Staff invitation sent", `An invitation was emailed to ${staffEmail.trim()}.`);
            } else {
                notify("warning", "Invitation created, email not sent", "Copy the backup invite link shown on this page or use Resend later.");
            }
        } catch {
            notify("error", "Unable to invite staff", "Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleEditStaff = (staff: StaffMember) => {
        setEditingStaff(staff);
        setEditPermissions(normalizePermissions(staff.permissions));
    };

    const handleSaveEdit = async () => {
        if (!editingStaff || savingEdit || loading || updatingStaffStatusId !== null || resendInFlight.current) return;

        const token = getToken();
        if (!token) {
            router.push("/");
            return;
        }

        const confirmed = await confirmAction({
            title: "Update staff access?",
            message: `Save the selected module permissions for ${editingStaff.name}? These changes determine which features the employee can access.`,
            confirmLabel: "Save Changes",
        });
        if (!confirmed) return;

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
                notify("error", "Unable to update staff access", data.error || data.message || "Please try again.");
                return;
            }

            window.dispatchEvent(new Event("stocknbook-permissions-updated"));
            setEditingStaff(null);
            await loadStaff();
            notify("success", "Staff access updated", `Permissions for ${editingStaff.name} have been saved.`);
        } catch {
            notify("error", "Unable to update staff access", "Something went wrong. Please try again.");
        } finally {
            setSavingEdit(false);
        }
    };

    const handleChangeStaffStatus = async (staff: StaffMember) => {
        if (updatingStaffStatusId !== null || loading || savingEdit || resendInFlight.current) return;
        const token = getToken();
        if (!token) {
            router.push("/");
            return;
        }

        const deactivate = staff.status === "Accepted";
        const action = deactivate ? "deactivate_staff" : "reactivate_staff";
        const confirmed = await confirmAction({
            title: deactivate ? "Deactivate staff access?" : "Reactivate staff access?",
            message: deactivate
                ? `Deactivate ${staff.name}'s login access? Their employee account and history remain saved. Access can be restored later.`
                : `Restore login access for ${staff.name}? They can use their existing account, subject to available staff slots and current permissions.`,
            confirmLabel: deactivate ? "Deactivate Access" : "Reactivate Access",
            danger: deactivate,
        });
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
                setToast({
                    kind: "error",
                    title: deactivate ? "Unable to deactivate access" : "Unable to reactivate access",
                    message: String(data.error || data.message || "Please try again."),
                });
                return;
            }

            await loadStaff();
            setToast({
                kind: "success",
                title: deactivate ? "Staff access deactivated" : "Staff access reactivated",
                message: deactivate
                    ? `${staff.name} can no longer sign in with this staff account. Their employee record and history remain saved.`
                    : `${staff.name} can sign in again using their existing staff account.`,
            });
        } catch {
            setToast({
                kind: "error",
                title: deactivate ? "Unable to deactivate access" : "Unable to reactivate access",
                message: "The request could not be completed. Please try again.",
            });
        } finally {
            setUpdatingStaffStatusId(null);
        }
    };

    const handleResendInvite = async (email: string) => {
        if (resendInFlight.current || loading || savingEdit || updatingStaffStatusId !== null) return;
        const token = getToken();
        if (!token) {
            router.push("/");
            return;
        }

        const confirmed = await confirmAction({
            title: "Resend staff invitation?",
            message: `Refresh the invitation link and send an invitation email to ${email}?`,
            confirmLabel: "Resend Invitation",
        });
        if (!confirmed || resendInFlight.current) return;
        resendInFlight.current = true;
        setResendingEmail(email);

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

            const refreshedLink = String(
                data.invite_link || data.inviteLink || ""
            ).trim();

            if (refreshedLink) {
                setInviteLink(refreshedLink);
            }

            const emailWasSent =
                data.email_sent === true ||
                String(data.email_status || "").toLowerCase() === "sent";

            if (refreshedLink) {
                setInviteDelivery({
                    email,
                    emailSent: emailWasSent,
                    emailError: String(data.email_error || ""),
                });
            }

            if (!res.ok) {
                notify("error", "Unable to resend invitation", data.error || data.message || "Please try again.");
                return;
            }

            await loadStaff();
            if (emailWasSent) {
                notify("success", "Staff invitation resent", `Invitation emailed to ${email}.`);
            } else {
                notify("warning", "Invitation refreshed, email not sent", "Copy the backup link shown on this page.");
            }
        } catch {
            notify("error", "Unable to resend invitation", "Something went wrong. Please try again.");
        } finally {
            resendInFlight.current = false;
            setResendingEmail(null);
        }
    };

    return (
        <RequirePermission permission="staff_management">
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
                                    onClick={() => { void loadStaff(); }}
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
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                            <SummaryCard
                                icon={<Clock3 size={25} strokeWidth={2} />}
                                title="Pending Invitations"
                                value={staffSummary.pending}
                                subtitle="Awaiting account activation"
                                tone="amber"
                            />
                        </div>

                        {inviteLink && (
                            <section className="rounded-[18px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                                <div className="flex items-center gap-3">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#3367D6]">
                                    <Mail size={18} />
                                </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                                Latest staff invitation
                                            </h2>
                                            {inviteDelivery && (
                                                <span
                                                    className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                                                        inviteDelivery.emailSent
                                                            ? "bg-[#EDFBF1] text-[#138342]"
                                                            : "bg-[#FFF4E6] text-[#9A5A00]"
                                                    }`}
                                                >
                                                    {inviteDelivery.emailSent
                                                        ? "Email sent"
                                                        : "Email not sent"}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                                            {inviteDelivery
                                                ? inviteDelivery.emailSent
                                                    ? `Invitation email sent to ${inviteDelivery.email}. The backup link is also available below.`
                                                    : `Email could not be delivered to ${inviteDelivery.email}. The invitation link is still valid.`
                                                : "Copy this link and use it to activate the staff account."}
                                        </p>
                                    </div>
                                </div>

                                {inviteDelivery &&
                                    !inviteDelivery.emailSent &&
                                    inviteDelivery.emailError && (
                                        <p className="mt-3 rounded-xl border border-[#F0D9B5] bg-[#FFF9EF] px-3 py-2 text-xs text-[#8A5A11]">
                                            {inviteDelivery.emailError}
                                        </p>
                                    )}

                                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                    <input
                                        readOnly
                                        value={inviteLink}
                                        className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#5F4E75] outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(inviteLink);
                                                notify("success", "Invite link copied", "The staff invitation link was copied to your clipboard.");
                                            } catch {
                                                notify("error", "Unable to copy invite link", "Select and copy the link manually.");
                                            }
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
                            <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]">
                                        <UsersRound size={21} strokeWidth={2} />
                                    </span>
                                    <div className="min-w-0">
                                        <h2 className="text-[18px] font-bold tracking-[-0.015em] text-[#1A1220]">Staff List</h2>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">Staff members assigned to {branchName}.</p>
                                    </div>
                                </div>
                                <div className="flex w-full min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center xl:w-auto xl:flex-1 xl:justify-end">
                                    <div className="relative min-w-0 flex-1 xl:max-w-[520px]">
                                        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                                        <input
                                            value={staffSearch}
                                            onChange={(event) => setStaffSearch(event.target.value)}
                                            placeholder="Search staff name, email, branch, or role..."
                                            aria-label="Search staff"
                                            className="h-[48px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-4 pl-11 pr-11 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                        />
                                        {staffSearch && (
                                            <button type="button" onClick={() => setStaffSearch("")} aria-label="Clear staff search"
                                                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#806A8C] transition hover:bg-[#F1E9FF] hover:text-[#2B174C]">
                                                <X size={15} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                                        <div className="relative">
                                            <Filter size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#2B174C]" />
                                            <select
                                                value={statusFilter}
                                                onChange={(event) => setStatusFilter(event.target.value as StaffStatusFilter)}
                                                aria-label="Filter staff by status"
                                                className="h-[48px] min-w-[150px] appearance-none rounded-xl border border-[#E6DDF0] bg-white pl-10 pr-10 text-sm font-semibold text-[#2B174C] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                            >
                                                <option value="all">All Status</option>
                                                <option value="active">Active</option>
                                                <option value="inactive">Inactive</option>
                                                <option value="pending">Pending</option>
                                            </select>
                                            <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#806A8C]" />
                                        </div>
                                        <button type="button" onClick={exportStaffListAsPdf} title="Download staff list as PDF" aria-label="Download staff list as PDF"
                                                className="inline-flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#6D35D4] shadow-sm transition hover:bg-[#F7F1FF]">
                                            <Download size={17} />
                                        </button>
                                        <button type="button" onClick={() => setShowAddDialog(true)} title="Add a staff member"
                                                className="inline-flex h-[48px] min-w-[140px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]">
                                            <Plus size={18} strokeWidth={2.2} />
                                            Add Staff
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {pageLoading && staffList.length === 0 ? (
                                <div className="p-4"><ModuleSkeleton variant="team" /></div>
                            ) : filteredStaff.length === 0 ? (
                                <div className="flex min-h-[136px] flex-col items-center justify-center px-4 text-center">
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
                                <div>
                                    <div
                                        className="min-h-[180px] xl:min-h-[210px] max-h-[360px] overflow-y-auto overflow-x-hidden overscroll-contain"
                                        role="region" aria-label="Staff list" tabIndex={0}
                                    >
                                        <table className="w-full min-w-0 table-fixed border-collapse font-sans text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th:not(:first-child)]:text-center [&_td:not(:first-child)]:text-center [&_th:first-child]:text-center [&_td:first-child]:text-left [&_td]:[overflow-wrap:anywhere]">
                                            <colgroup><col className="w-[15%]" /><col className="w-[20%]" /><col className="w-[36%]" /><col className="w-[10%]" /><col className="w-[19%]" /></colgroup>
                                            <thead className="sticky top-0 z-10 bg-[#FFFCF8]">
                                            <tr className="border-b border-[#E6DDF0]">
                                                <TableHeader align="center">Employee ID</TableHeader>
                                                <TableHeader>Staff</TableHeader>
                                                <TableHeader>Access</TableHeader>
                                                <TableHeader>Status</TableHeader>
                                                <TableHeader align="center">
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
                                                    <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-[#4E2C66]">
                                                        {staff.employeeCode || "—"}
                                                    </td>

                                                    <td className="px-3 py-2.5">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-bold text-[#1A1220]">
                                                                {staff.name}
                                                            </p>

                                                            <p className="truncate text-xs text-[#7A6A84]">
                                                                {staff.email}
                                                            </p>
                                                        </div>
                                                    </td>

                                                    <td className="px-3 py-2.5">
                                                        <div className="flex flex-wrap justify-center gap-x-2 gap-y-1">
                                                            {formatRoleSummary(staff.permissions)
                                                                .split(" & ")
                                                                .map((access) => (
                                                                    <span
                                                                        key={access}
                                                                        className="text-[11px] font-semibold text-[#6D35D4]"
                                                                    >
                                                                    {access}
                                                                </span>
                                                                ))}
                                                        </div>
                                                    </td>

                                                    <td className="px-3 py-2.5">
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

                                                    <td className="px-3 py-2.5 text-center">
                                                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleEditStaff(staff)}
                                                                className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-[#F1EBFF] px-3 text-xs font-semibold text-[#6D35D4] transition hover:bg-[#E6DCFF]"
                                                            >
                                                                <Pencil size={13} />
                                                                Edit
                                                            </button>

                                                            <button
                                                                type="button"
                                                                disabled={updatingStaffStatusId !== null}
                                                                onClick={() => void handleChangeStaffStatus(staff)}
                                                                className={`inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                                                    staff.status === "Accepted"
                                                                        ? "bg-[#FDEDED] text-[#C13333] hover:bg-[#FADDDD]"
                                                                        : "bg-[#E8F7EE] text-[#138342] hover:bg-[#DDF5E5]"
                                                                }`}
                                                            >
                                                                {staff.status === "Accepted" ? <UserX size={13} /> : <CheckCircle2 size={13} />}
                                                                {updatingStaffStatusId === staff.id
                                                                    ? "Updating..."
                                                                    : staff.status === "Accepted" ? "Deactivate Access" : "Reactivate Access"}
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section aria-label="Pending staff invitations" className="overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF6DF] text-[#A56607]"><Clock3 size={20} /></span>
                                    <div className="min-w-0">
                                        <h2 className="text-[16px] font-bold text-[#1A1220]">Pending Invites</h2>
                                        <p className="text-xs text-[#7A6A84]">Staff awaiting account activation</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5">
                                    <span className="text-xs font-semibold text-[#A56607]">{pendingInvites.length} pending</span>
                                    {pendingInvites.length > 0 && (
                                        <button type="button" onClick={exportPendingStaffInvitesAsPdf} title="Download pending staff invites as PDF" aria-label="Download pending staff invites as PDF"
                                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#6D35D4] transition hover:bg-[#F7F1FF]"><Download size={17} /></button>
                                    )}
                                </div>
                            </div>
                            {pendingInvites.length > 0 && (
                                <div className="border-t border-[#E6DDF0] px-4 py-3">
                                    <div className="max-h-[320px] overflow-auto">
                                        <table className="w-full min-w-0 table-fixed border-collapse font-sans text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th:not(:first-child)]:text-center [&_td:not(:first-child)]:text-center [&_th:first-child]:text-center [&_td:first-child]:text-left [&_td]:[overflow-wrap:anywhere]">
                                            <thead className="bg-[#FFFCF8]">
                                            <tr className="border-b border-[#E6DDF0]">
                                                <TableHeader align="center">Email</TableHeader>
                                                <TableHeader>Invitation</TableHeader>
                                                <TableHeader>Access</TableHeader>
                                                <TableHeader align="center">
                                                    Actions
                                                </TableHeader>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {pendingInvites.map(
                                                (invite) => (
                                                    <tr
                                                        key={invite.id}
                                                        className="border-b border-[#EEE7F2] bg-white last:border-b-0"
                                                    >
                                                        <td className="px-2.5 py-2.5 text-sm font-semibold text-[#1A1220]">
                                                            {invite.email}
                                                        </td>
                                                        <td className="px-2.5 py-2.5 text-xs text-[#7A6A84]">
                                                            Invited {invite.invitedAt}
                                                            <br />
                                                            Expires {invite.expiresAt}
                                                        </td>
                                                        <td className="max-w-[420px] px-2.5 py-2.5 text-xs text-[#806A8C]">
                                                            <p className="truncate">
                                                                {formatPermissions(
                                                                    invite.permissions
                                                                )}
                                                            </p>
                                                        </td>
                                                        <td className="px-2.5 py-2.5 text-center">
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
                                                                    disabled={resendingEmail !== null}
                                                                    className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-[#F1EBFF] px-3 text-xs font-semibold text-[#6D35D4] transition hover:bg-[#E6DCFF] disabled:cursor-not-allowed disabled:opacity-60"
                                                                >
                                                                    <Send size={14} />
                                                                    {resendingEmail === invite.email ? "Sending..." : "Resend"}
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
                                        <p className="mt-1 text-xs text-[#7A6A84]">Choose which modules this staff member can access. Operational booking tasks require Inventory operational access as well; approval and payments stay with the Manager.</p>

                                        <div className="mt-4 space-y-3">
                                            <AccessModeRow
                                                label="POS / Sales"
                                                allowView
                                                fullLabel="Operational access"
                                                value={permissions.pos_access}
                                                onChange={(value) => updateFeatureAccess("pos", value as AccessMode)}
                                            />
                                            <AccessModeRow
                                                label="Bookings"
                                                value={permissions.bookings_access}
                                                allowView
                                                fullLabel="Operational access"
                                                onChange={(value) => updateFeatureAccess("bookings", value as AccessMode)}
                                            />
                                            <AccessModeRow
                                                label="Inventory"
                                                allowView
                                                fullLabel="Operational access"
                                                value={permissions.inventory_access}
                                                onChange={(value) => updateFeatureAccess("inventory", value as AccessMode)}
                                            />
                                            <AccessModeRow
                                                label="Packages"
                                                allowView
                                                allowFull={false}
                                                value={permissions.package_access}
                                                onChange={(value) => updateFeatureAccess("packages", value as AccessMode)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="sticky bottom-0 z-10 grid gap-3 border-t border-[#E6DDF0] bg-white px-6 py-4 sm:grid-cols-2">
                                <button
                                    type="button"
                                    disabled={loading}
                                    onClick={() => {
                                        if (loading) return;
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
                                disabled={savingEdit}
                                onClick={() => { if (!savingEdit) setEditingStaff(null); }}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#7A6A84] transition hover:bg-[#F7F1FF]"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
                            <div className="space-y-3">
                                <AccessModeRow
                                    label="POS / Sales"
                                    allowView
                                    fullLabel="Operational access"
                                    value={editPermissions.pos_access}
                                    onChange={(value) => updateEditFeatureAccess("pos", value as AccessMode)}
                                />
                                <AccessModeRow
                                    label="Bookings"
                                    value={editPermissions.bookings_access}
                                    allowView
                                    fullLabel="Operational access"
                                    onChange={(value) => updateEditFeatureAccess("bookings", value as AccessMode)}
                                />
                                <AccessModeRow
                                    label="Inventory"
                                    allowView
                                    fullLabel="Operational access"
                                    value={editPermissions.inventory_access}
                                    onChange={(value) => updateEditFeatureAccess("inventory", value as AccessMode)}
                                />
                                <AccessModeRow
                                    label="Packages"
                                    allowView
                                    allowFull={false}
                                    value={editPermissions.package_access}
                                    onChange={(value) => updateEditFeatureAccess("packages", value as AccessMode)}
                                />
                            </div>
                        </div>

                        <div className="shrink-0 grid gap-3 border-t border-[#E9E0EF] bg-white px-6 py-4 sm:grid-cols-2">
                            <button
                                type="button"
                                disabled={savingEdit}
                                onClick={() => { if (!savingEdit) setEditingStaff(null); }}
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
                {confirmation && <ModuleConfirmationDialog confirmation={confirmation} onResolve={resolveConfirmation} />}
                {toast && <ModuleNotification toast={toast} onClose={() => setToast(null)} />}
            </div>
        </RequirePermission>
    );
}

function normalizeStaffMember(item: any): StaffMember {
    return {
        id: item.id || item.staff_id || item.user_id || item.email,
        employeeCode: String(item.employee_code || item.employeeCode || ""),
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

    // Preserve the exact stored POS level. View-only must never turn into checkout access.
    const posAccess = getAccessValue(parsed.pos_access, parsed.pos);
    const bookingsAccess = getBookingAccessValue(parsed.bookings_access, parsed.bookings);
    const inventoryAccess = getAccessValue(parsed.inventory_access, parsed.inventory);
    const packageAccess = getReadOnlyAccessValue(parsed.package_access, parsed.packages);
    return {
        // Every staff member gets the dashboard — it's no longer a toggle.
        dashboard: true,
        pos: posAccess !== "none",
        pos_access: posAccess,
        bookings: bookingsAccess !== "none",
        bookings_access: bookingsAccess,
        inventory: inventoryAccess !== "none",
        inventory_access: inventoryAccess,
        inventory_stock_receive: parsed.inventory_stock_receive === true,
        packages: packageAccess !== "none",
        package_access: packageAccess,
    };
}

function getAccessValue(value: any, legacyBoolean: any): AccessMode {
    if (value === "full" || value === "none") return value;
    if (value === "view") return "view";
    if (legacyBoolean === true) return "full";
    return "none";
}

// Staff Booking Operational Access permits only physical fulfillment through
// authorized Inventory actions; previous standard-confirmation is read-only.
function getReadOnlyAccessValue(value: any, legacyBoolean: any): AccessMode {
    if (value === "none") return "none";
    if (["view", "full", "standard", "confirm_standard", "view_only"].includes(value)) return "view";
    return legacyBoolean === true ? "view" : "none";
}

function getBookingAccessValue(value: any, legacyBoolean: any): AccessMode {
    if (value === "full") return "full";
    if (value === "standard" || value === "confirm_standard") return "view";
    return getReadOnlyAccessValue(value, legacyBoolean);
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
    tone: "purple" | "green" | "red" | "amber";
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
        amber: {
            iconBackground: "bg-[#FFF6DF]",
            iconColor: "text-[#A56607]",
            borderColor: "#F2DFC0",
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
                         align = "center",
                     }: {
    children: ReactNode;
    align?: "left" | "center";
}) {
    return (
        <th
            className={`px-2.5 py-2.5 text-[10px] font-semibold uppercase leading-tight tracking-normal text-[#806A8C] ${
                align === "left" ? "text-left" : "text-center"
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

function AccessModeRow({
                           label,
                           value,
                           onChange,
                           allowFull = true,
                           allowView = false,
                           fullLabel = "Full access",
                           locked = false,
                           lockText = "Not included in current plan",
                       }: {
    label: string;
    value: AccessMode;
    onChange: (value: AccessMode) => void;
    allowFull?: boolean;
    allowView?: boolean;
    fullLabel?: string;
    locked?: boolean;
    lockText?: string;
}) {
    return (
        <div
            className={`flex min-h-[58px] items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                locked
                    ? "cursor-not-allowed border-[#E4DCE9] bg-[#F7F4F8]"
                    : "border-[#E6DDF0] bg-[#FFFDF8]"
            }`}
        >
            <div className="flex min-w-0 items-center gap-2">
                <span
                    className={`text-sm font-semibold ${
                        locked ? "text-[#8B7F91]" : "text-[#1A1220]"
                    }`}
                >
                    {label}
                </span>

                {locked && (
                    <LockKeyhole
                        size={15}
                        strokeWidth={2}
                        className="shrink-0 text-[#8B7F91]"
                    />
                )}
            </div>

            {locked ? (
                <div
                    className="inline-flex min-h-[38px] max-w-[240px] cursor-not-allowed items-center gap-2 rounded-xl border border-[#DED5E4] bg-[#EEE9F0] px-3 text-xs font-semibold text-[#76697D]"
                    title={lockText}
                    aria-disabled="true"
                >
                    <LockKeyhole size={14} className="shrink-0" />
                    <span className="truncate">{lockText}</span>
                </div>
            ) : (
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value as AccessMode)}
                    className="h-[38px] min-w-[136px] rounded-xl border border-[#E6DDF0] bg-white px-3 text-xs font-semibold text-[#2B174C] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                >
                    <option value="none">No access</option>
                    {allowView && <option value="view">View only</option>}
                    {allowFull && <option value="full">{fullLabel}</option>}
                </select>
            )}
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
            ? "text-[#138342]"
            : tone === "red"
                ? "text-[#D4443A]"
                : "text-[#A56607]";

    return <span className={`inline-flex text-xs font-semibold ${style}`}>{label}</span>;
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

    if (permissions.pos_access !== "none") list.push(`POS / Sales: ${formatAccess(permissions.pos_access)}`);
    if (permissions.bookings_access !== "none") list.push(`Bookings: ${formatAccess(permissions.bookings_access)}`);
    if (permissions.inventory_access !== "none") list.push(`Inventory: ${formatAccess(permissions.inventory_access)}`);
    if (permissions.inventory_stock_receive) list.push("Authorized Stock Receiver");
    if (permissions.package_access !== "none") list.push(`Packages: ${formatAccess(permissions.package_access)}`);

    return list.length > 0 ? list.join(", ") : "No access";
}

function formatRoleSummary(permissions: StaffPermissions) {
    const shortLabels: string[] = [];
    if (permissions.pos_access !== "none") shortLabels.push("Sales");
    if (permissions.bookings_access !== "none") shortLabels.push("Bookings");
    if (permissions.inventory_access !== "none") shortLabels.push("Inventory");
    if (permissions.package_access !== "none") shortLabels.push("Packages");
    return shortLabels.length > 0 ? shortLabels.join(" & ") : "No access";
}

function formatAccess(value: AccessMode) {
    if (value === "none") return "No access";
    if (value === "view") return "View only";
    return "Operational access";
}

function getInitials(name: string) {
    const cleaned = name.trim();
    if (!cleaned) return "ST";

    const parts = cleaned.split(/\s+/).slice(0, 2);
    return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

// Local UI feedback keeps API operations, permissions and business rules unchanged.
type ModuleToast = {
    kind: "success" | "error" | "warning";
    title: string;
    message: string;
};

type ModuleConfirmation = {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
};

function useModuleFeedback() {
    const [toast, setToast] = useState<ModuleToast | null>(null);
    const [confirmation, setConfirmation] = useState<ModuleConfirmation | null>(null);
    const pendingConfirmation = useRef<((confirmed: boolean) => void) | null>(null);

    const confirmAction = useCallback((details: ModuleConfirmation): Promise<boolean> => {
        if (pendingConfirmation.current) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            pendingConfirmation.current = resolve;
            setConfirmation(details);
        });
    }, []);

    const resolveConfirmation = useCallback((confirmed: boolean) => {
        const resolve = pendingConfirmation.current;
        pendingConfirmation.current = null;
        setConfirmation(null);
        resolve?.(confirmed);
    }, []);

    useEffect(() => () => {
        pendingConfirmation.current?.(false);
        pendingConfirmation.current = null;
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(null), toast.kind === "success" ? 5600 : 10000);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const notify = useCallback((kind: ModuleToast["kind"], title: string, message: unknown) => {
        setToast({ kind, title, message: String(message || "Please try again.") });
    }, []);

    return { toast, setToast, notify, confirmation, confirmAction, resolveConfirmation };
}

function ModuleConfirmationDialog({ confirmation, onResolve }: {
    confirmation: ModuleConfirmation;
    onResolve: (confirmed: boolean) => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        dialog.showModal();
        dialog.querySelector<HTMLButtonElement>("[data-confirm-cancel]")?.focus();
        return () => { if (dialog.open) dialog.close(); };
    }, []);

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="module-confirmation-title"
            aria-describedby="module-confirmation-description"
            onCancel={(event) => { event.preventDefault(); onResolve(false); }}
            onClick={(event) => { if (event.target === event.currentTarget) onResolve(false); }}
            className="fixed inset-0 m-auto max-h-[85vh] w-[min(480px,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-[22px] border border-[#E6DDF0] bg-white p-0 text-[#1A1220] shadow-2xl backdrop:bg-[#120A1F]/45 backdrop:backdrop-blur-sm"
        >
            <div onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start gap-3 border-b border-[#E9E1EE] px-5 py-5">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${confirmation.danger ? "bg-[#FDEDED] text-[#C13333]" : "bg-[#F1EBFF] text-[#6D35D4]"}`}>
                        {confirmation.danger ? <AlertCircle size={22} /> : <CheckCircle2 size={22} />}
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 id="module-confirmation-title" className="text-lg font-bold text-[#1A1220]">{confirmation.title}</h2>
                        <p className="mt-1 text-xs text-[#806A8C]">Please confirm before continuing.</p>
                    </div>
                    <button type="button" aria-label="Close confirmation" onClick={() => onResolve(false)}
                            className="rounded-lg p-1 text-[#806A8C] hover:bg-[#F7F1FF]"><X size={19} /></button>
                </div>
                <p id="module-confirmation-description" className="break-words px-5 py-5 text-sm leading-6 text-[#4F3E5E]">{confirmation.message}</p>
                <div className="flex flex-wrap justify-end gap-2 border-t border-[#E9E1EE] px-5 py-4">
                    <button type="button" data-confirm-cancel onClick={() => onResolve(false)}
                            className="rounded-xl border border-[#DCCFE8] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]">Cancel</button>
                    <button type="button" onClick={() => onResolve(true)}
                            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition ${confirmation.danger ? "bg-[#A33E20] hover:bg-[#883117]" : "bg-[#2B174C] hover:bg-[#1B0D31]"}`}>{confirmation.confirmLabel}</button>
                </div>
            </div>
        </dialog>
    );
}

function ModuleNotification({ toast, onClose }: { toast: ModuleToast; onClose: () => void }) {
    const tone = toast.kind === "success"
        ? { border: "border-[#BCE8CA]", icon: "bg-[#E5F8EC] text-[#23834A]" }
        : toast.kind === "warning"
            ? { border: "border-[#F2D49C]", icon: "bg-[#FFF5DF] text-[#A76C16]" }
            : { border: "border-[#F2C4C4]", icon: "bg-[#FDEDED] text-[#C13333]" };
    return (
        <div role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}
             className={`fixed bottom-5 right-5 z-[140] flex w-[min(360px,calc(100vw-2.5rem))] items-start gap-3 rounded-2xl border ${tone.border} bg-white p-4 shadow-[0_18px_42px_rgba(43,23,76,0.22)]`}>
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone.icon}`}>
                {toast.kind === "success" ? <CheckCircle2 size={20} strokeWidth={2.4} /> : <AlertCircle size={20} strokeWidth={2.4} />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-bold text-[#1A1220]">{toast.title}</p>
                <p className="mt-0.5 max-h-[40vh] overflow-y-auto break-words text-xs leading-5 text-[#6A5D6F]">{toast.message}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Dismiss notification"
                    className="shrink-0 text-lg leading-none text-[#9B8AAA] transition hover:text-[#2B174C]">×</button>
        </div>
    );
}
