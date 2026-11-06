"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    CheckCircle2,
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
    Bell, CalendarDays, Download, ArrowUpRight,
    X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type AccessMode = "none" | "view" | "full";
type ReportsAccessMode = "none" | "full";
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
    reports: boolean;
    reports_access: ReportsAccessMode;
    analytics: boolean;
    analytics_access: AccessMode;
    forecasting: boolean;
    forecasting_access: AccessMode;
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

type SubscriptionPlanAccess = {
    name: string;
    hasAnalytics: boolean;
    hasForecasting: boolean;
};

type SubscriptionClientResponse = {
    subscription?: {
        plan?: {
            name?: string | null;
            has_analytics?: boolean;
            has_forecasting?: boolean;
        };
    };
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
    reports: false,
    reports_access: "none",
    analytics: false,
    analytics_access: "none",
    forecasting: false,
    forecasting_access: "none",
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

    const [planAccess, setPlanAccess] = useState<SubscriptionPlanAccess>({
        name: "Current",
        hasAnalytics: false,
        hasForecasting: false,
    });
    const [planAccessLoading, setPlanAccessLoading] = useState(true);

    const [staffName, setStaffName] = useState("");
    const [staffEmail, setStaffEmail] = useState("");
    const [permissions, setPermissions] = useState<StaffPermissions>(defaultPermissions);

    const [loading, setLoading] = useState(false);
    const [pageLoading, setPageLoading] = useState(true);

    const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
    const [employeeRequests, setEmployeeRequests] = useState<SMLeaveRow[]>([]);
    const [requestError, setRequestError] = useState("");
    const [requestLoading, setRequestLoading] = useState(false);
    const [requestStatusFilter, setRequestStatusFilter] = useState("all");
    const [requestTypeFilter, setRequestTypeFilter] = useState("all");
    const [reviewingRequest, setReviewingRequest] = useState<SMLeaveGroup | null>(null);
    const [activeTeamDetail, setActiveTeamDetail] = useState<"attendance" | "requests" | "invites" | null>(null);
    const teamDetailTriggerRef = useRef<HTMLButtonElement | null>(null);
    const teamDetailCloseRef = useRef<HTMLButtonElement | null>(null);
    const openTeamDetail = (detail: "attendance" | "requests" | "invites", trigger: HTMLButtonElement) => {
        teamDetailTriggerRef.current = trigger;
        setActiveTeamDetail(detail);
    };
    const closeTeamDetail = () => {
        setActiveTeamDetail(null);
        window.requestAnimationFrame(() => teamDetailTriggerRef.current?.focus());
    };
    useEffect(() => {
        if (!activeTeamDetail) return;
        teamDetailCloseRef.current?.focus();
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = originalOverflow; };
    }, [activeTeamDetail]);

    const [requestDecisionNote, setRequestDecisionNote] = useState("");
    const [requestDecisionError, setRequestDecisionError] = useState("");
    const [savingDecision, setSavingDecision] = useState(false);
    const [canApproveRequests, setCanApproveRequests] = useState(false);
    // Staff attendance recorded from staff dashboards, returned by the same
    // manager-staff-overview request (branch-scoped on the server).
    const [teamAttendance, setTeamAttendance] = useState<SMAttendanceRow[]>([]);
    const [attendanceSummary, setAttendanceSummary] = useState<SMAttendanceSummary | null>(null);
    const [attendancePeriod, setAttendancePeriod] = useState("today");
    const [attendanceStatusFilter, setAttendanceStatusFilter] = useState("all");
    const [attendanceError, setAttendanceError] = useState("");
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
    const [staffStatusTarget, setStaffStatusTarget] = useState<StaffMember | null>(null);
    const [staffStatusToast, setStaffStatusToast] = useState<{
        kind: "success" | "error";
        title: string;
        message: string;
    } | null>(null);

    const getToken = () => sessionStorage.getItem("token") || "";

    const loadPlanAccess = useCallback(async () => {
        const token = getToken();

        if (!token) {
            setPlanAccessLoading(false);
            return;
        }

        try {
            setPlanAccessLoading(true);

            const res = await fetch("/api/subscription-client", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                },
                cache: "no-store",
            });

            const data = (await res.json()) as SubscriptionClientResponse;

            if (!res.ok) {
                throw new Error("Failed to verify subscription plan.");
            }

            const plan = data.subscription?.plan;

            setPlanAccess({
                name: String(plan?.name || "Current"),
                hasAnalytics: plan?.has_analytics === true,
                hasForecasting: plan?.has_forecasting === true,
            });
        } catch {
            // Fail closed: if the plan cannot be verified, premium permissions
            // stay locked instead of accidentally being grantable.
            setPlanAccess({
                name: "Current",
                hasAnalytics: false,
                hasForecasting: false,
            });
        } finally {
            setPlanAccessLoading(false);
        }
    }, []);

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

            // Independent server-owned grant avoids relying on a JWT/session flag.
            let grants: Record<string, boolean> = {};
            try {
                const grantResponse = await fetch("/api/products", {method:"POST", cache:"no-store",
                    headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
                    body:JSON.stringify({action:"get_staff_receiving_permissions"})});
                const grantData = await grantResponse.json().catch(()=>({}));
                if (grantResponse.ok && Array.isArray(grantData.grants)) {
                    grants = Object.fromEntries(grantData.grants.map((g:{staffId:number;allowed:boolean})=>[String(g.staffId), g.allowed === true]));
                }
            } catch { /* Keep grants fail-closed if the endpoint is unavailable. */ }
            setStaffList(rawStaff.map((item:unknown)=>{
                const staff=normalizeStaffMember(item);
                return {...staff, permissions:{...staff.permissions, inventory_stock_receive:grants[String(staff.id)]===true}};
            }));
            setPendingInvites(rawPending.map(normalizePendingInvite));
        } catch {
            alert("Something went wrong while loading staff.");
        } finally {
            setPageLoading(false);
        }
    }, [router]);

    const loadEmployeeRequests = useCallback(async () => {
        const token = getToken();
        if (!token) return;
        setRequestLoading(true);
        try {
            const res = await fetch("/api/manager-staff-overview", {
                headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success !== true) throw new Error(data.error || "Unable to load employee requests.");
            setEmployeeRequests(Array.isArray(data.leaves) ? data.leaves : []);
            setTeamAttendance(Array.isArray(data.teamAttendance) ? data.teamAttendance : []);
            setAttendanceSummary(data.attendanceSummary && typeof data.attendanceSummary === "object"
                ? data.attendanceSummary as SMAttendanceSummary : null);
            setCanApproveRequests(data.mayReviewLeave === true);
            setRequestError("");
            setAttendanceError("");
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : "Employee requests unavailable.");
            setAttendanceError(error instanceof Error ? error.message : "Staff attendance unavailable.");
        } finally { setRequestLoading(false); }
    }, []);

    const leaveApplications = useMemo(() => smGroupLeaves(employeeRequests), [employeeRequests]);
    const pendingApplications = leaveApplications.filter(request => request.status === "Pending").length;
    const types = useMemo(() => [...new Set(leaveApplications.map(request => request.leaveType))].sort(), [leaveApplications]);
    const filteredApplications = leaveApplications.filter(request =>
        (requestStatusFilter === "all" || request.status.toLowerCase() === requestStatusFilter) &&
        (requestTypeFilter === "all" || request.leaveType === requestTypeFilter));

    const submitReview = async (decision: "Approved" | "Rejected") => {
        if (!reviewingRequest || savingDecision) return;
        setSavingDecision(true); setRequestDecisionError("");
        try {
            const res = await fetch("/api/manager-staff-overview", {
                method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ action: "review_leave", decision,
                    requestIds: reviewingRequest.ids, decisionReason: requestDecisionNote.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success !== true) throw new Error(data.error || "Unable to review request.");
            setReviewingRequest(null); setRequestDecisionNote("");
            await loadEmployeeRequests();
        } catch (error) { setRequestDecisionError(error instanceof Error ? error.message : "Review failed."); }
        finally { setSavingDecision(false); }
    };
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
            .catch(() => setStaffStatusToast({ kind: "error", title: "Export unavailable", message: "Could not export the staff list." }));
    };

    const exportPendingStaffInvitesAsPdf = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                title: "Pending Staff Invitations",
                headers: ["Email", "Invited", "Expires", "Access", "Status"],
                rows: filteredPendingInvites.map(invite => [invite.email, invite.invitedAt,
                    invite.expiresAt, formatPermissions(invite.permissions), "Pending"]),
            }, { storeName: sessionStorage.getItem("store_name") || "StockNBook",
                branch: branchName, dateRange: "Pending invitations" }, "manager_staff_invites"))
            .catch(() => setStaffStatusToast({ kind: "error", title: "Export unavailable", message: "Could not export pending staff invitations." }));
    };

    const exportRequestsAsPdf = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                title: "Employee Leave Requests",
                headers: ["Employee", "Employee ID", "Leave Type", "Date Range", "Status", "Reason"],
                rows: filteredApplications.map(request => [request.employeeName, request.employeeNumber,
                    request.leaveType, smDatesLabel(request), request.status, request.reason]),
            }, { storeName: sessionStorage.getItem("store_name") || "StockNBook", branch: branchName,
                dateRange: "All requests" }, "manager_employee_requests"))
            .catch(() => setRequestError("PDF export could not be completed."));
    };

    // Same presentation rule as the Manager Dashboard Team Attendance panel: show only
    // recorded attendance plus approved leave days. Never invent absence or clock records.
    const attendanceToday = currentDateTime ? smManilaDay(currentDateTime) : "";
    const staffAttendanceRows = useMemo(() => {
        const rows: SMAttendanceRow[] = [...teamAttendance];
        if (!attendanceToday) return rows;
        const recorded = new Set(rows.map(row => `${row.employeeId}:${row.date}`));
        const earliest = smShiftDay(attendanceToday, -90);
        for (const leave of employeeRequests) {
            if (leave.approvalStatus !== "Approved") continue;
            const start = leave.leaveDate;
            const end = leave.leaveEndDate && leave.leaveEndDate >= start ? leave.leaveEndDate : start;
            if (end < earliest || start > attendanceToday) continue;
            let day = start < earliest ? earliest : start;
            const last = end > attendanceToday ? attendanceToday : end;
            for (let index = 0; day <= last && index < 91; index++) {
                const key = `${leave.employeeId}:${day}`;
                if (!recorded.has(key)) {
                    rows.push({ id: -(leave.id * 100 + index + 1), employeeId: leave.employeeId,
                        employeeCode: leave.employeeNumber || null,
                        employeeName: leave.employeeName, date: day, timeIn: null, timeOut: null,
                        hoursWorked: null, status: "On Leave" });
                    recorded.add(key);
                }
                day = smAddDay(day);
            }
        }
        return rows.sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));
    }, [teamAttendance, employeeRequests, attendanceToday]);
    const visibleStaffAttendance = staffAttendanceRows.filter(row =>
        smInPeriod(row.date, attendancePeriod, attendanceToday) &&
        (attendanceStatusFilter === "all" || row.status === attendanceStatusFilter));
    const attendancePeriodLabel = { today: "Today", month: "This Month", previous: "Last Month", all: "Last 90 Days" }[attendancePeriod] || "Today";
    const exportStaffAttendanceAsPdf = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                title: "Staff Attendance",
                headers: ["Employee ID", "Staff Name", "Date", "Time In", "Time Out", "Hours Worked", "Status"],
                rows: visibleStaffAttendance.map(row => [row.employeeCode || "—", row.employeeName,
                    smFormatDate(row.date), smClockTime(row.timeIn), smClockTime(row.timeOut),
                    smHours(row.hoursWorked), row.status]),
            }, { storeName: sessionStorage.getItem("store_name") || "StockNBook", branch: branchName,
                dateRange: attendancePeriodLabel }, "manager_staff_attendance"))
            .catch(() => setAttendanceError("PDF export could not be completed."));
    };

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
        void loadEmployeeRequests();
        void loadPlanAccess();
    }, [router, loadStaff, loadPlanAccess, loadEmployeeRequests]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());
        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!staffStatusToast) return;
        const timer = window.setTimeout(() => setStaffStatusToast(null), 5600);
        return () => window.clearTimeout(timer);
    }, [staffStatusToast]);

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

    const filteredPendingInvites = useMemo(() => {
        const query = staffSearch.trim().toLowerCase();
        if (statusFilter !== "all" && statusFilter !== "pending") return [];

        return pendingInvites.filter((invite) => {
            const searchText = `${invite.email} ${branchName} pending ${formatRoleSummary(invite.permissions)}`.toLowerCase();
            return query ? searchText.includes(query) : true;
        });
    }, [branchName, pendingInvites, staffSearch, statusFilter]);

    const updateFeatureAccess = (
        feature: "pos" | "bookings" | "inventory" | "packages" | "analytics" | "forecasting",
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
        feature: "pos" | "bookings" | "inventory" | "packages" | "analytics" | "forecasting",
        value: AccessMode
    ) => {
        const accessKey = feature === "packages" ? "package_access" : `${feature}_access`;

        setEditPermissions((prev) => ({
            ...prev,
            [feature]: value !== "none",
            [accessKey]: value,
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

            alert(
                emailWasSent
                    ? "Staff invitation created and emailed successfully."
                    : "Staff invitation created successfully, but the email could not be delivered. Copy the backup invite link shown on this page or use Resend later."
            );
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

            // The auth Lambda handles module permissions; the products Lambda
            // persists the narrowly scoped receiving grant after that update.
            const grantResponse = await fetch("/api/products", {method:"POST",cache:"no-store",
                headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
                body:JSON.stringify({action:"set_staff_receiving_permission", staffId:editingStaff.id,
                    allowed:editPermissions.inventory_stock_receive && editPermissions.inventory_access === "full"})});
            const grantResult = await grantResponse.json().catch(()=>({}));
            if (!grantResponse.ok || !grantResult.success) {
                alert(`General permissions were saved, but stock receiving permission was not updated: ${grantResult.error || "server error"}. Please retry.`);
                await loadStaff();
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

    const handleChangeStaffStatus = async (staff: StaffMember) => {
        if (updatingStaffStatusId !== null) return;
        const token = getToken();
        if (!token) {
            router.push("/");
            return;
        }

        const deactivate = staff.status === "Accepted";
        const action = deactivate ? "deactivate_staff" : "reactivate_staff";
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
                setStaffStatusToast({
                    kind: "error",
                    title: deactivate ? "Unable to deactivate access" : "Unable to reactivate access",
                    message: String(data.error || data.message || "Please try again."),
                });
                return;
            }

            setStaffStatusTarget(null);
            await loadStaff();
            setStaffStatusToast({
                kind: "success",
                title: deactivate ? "Staff access deactivated" : "Staff access reactivated",
                message: deactivate
                    ? `${staff.name} can no longer sign in with this staff account. Their employee record and history remain saved.`
                    : `${staff.name} can sign in again using their existing staff account.`,
            });
        } catch {
            setStaffStatusToast({
                kind: "error",
                title: deactivate ? "Unable to deactivate access" : "Unable to reactivate access",
                message: "The request could not be completed. Please try again.",
            });
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
                alert(
                    data.error ||
                    data.message ||
                    "Unable to resend the staff invitation."
                );
                return;
            }

            await loadStaff();
            alert(
                emailWasSent
                    ? `Invitation emailed to ${email}.`
                    : "The staff invitation link was refreshed, but the email could not be delivered. Copy the backup link shown on this page."
            );
        } catch {
            alert("Something went wrong while resending invite.");
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
                                    onClick={() => { void loadStaff(); void loadEmployeeRequests(); }}
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
                                <button type="button" onClick={exportStaffListAsPdf} title="Download staff list as PDF" aria-label="Download staff list as PDF" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#6D35D4] transition hover:bg-[#F7F1FF]">
                                    <Download size={17}/>
                                </button>
                            </div>

                            <div className="border-b border-[#E6DDF0] px-4 py-3 sm:px-5">
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

                                    <div className="flex flex-wrap items-center gap-2.5">
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
                            </div>

                            {pageLoading && staffList.length === 0 ? (
                                <div className="min-h-[180px] xl:min-h-[210px] p-4"><ModuleSkeleton variant="team" /></div>
                            ) : filteredStaff.length === 0 ? (
                                <div className="flex min-h-[180px] xl:min-h-[210px] flex-col items-center justify-center px-4 text-center">
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
                                                                onClick={() => setStaffStatusTarget(staff)}
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

                        {/* Compact navigation preserves the detailed records in their original tables. */}
                        <section aria-label="Team records" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            <button type="button" onClick={(event) => openTeamDetail("attendance", event.currentTarget)}
                                    className="group flex min-w-0 flex-col gap-3 rounded-[18px] border border-[#E6DDF0] bg-white p-4 text-left shadow-sm transition hover:border-[#C9AFE9] hover:bg-[#FFFCF7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6D35D4]">
                                <span className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]"><CalendarDays size={20}/></span><span className="min-w-0"><span className="block text-[16px] font-bold text-[#1A1220]">Staff Attendance</span><span className="block text-xs text-[#7A6A84]">Daily time records and attendance status</span></span></span>
                                <span className="text-xs font-semibold text-[#5F4E75]">{`Present ${attendanceSummary?.present ?? 0} · Not recorded ${attendanceSummary?.notRecorded ?? 0}`}</span>
                                <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-[#6D35D4] group-hover:underline">View Attendance <ArrowUpRight size={15}/></span>
                            </button>
                            <button type="button" onClick={(event) => openTeamDetail("requests", event.currentTarget)}
                                    className="group flex min-w-0 flex-col gap-3 rounded-[18px] border border-[#E6DDF0] bg-white p-4 text-left shadow-sm transition hover:border-[#C9AFE9] hover:bg-[#FFFCF7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6D35D4]">
                                <span className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]"><Bell size={20}/></span><span className="min-w-0"><span className="block text-[16px] font-bold text-[#1A1220]">Employee Requests</span><span className="block text-xs text-[#7A6A84]">Review staff leave and absence requests</span></span></span>
                                <span className="text-xs font-semibold text-[#A56607]">{pendingApplications} pending</span>
                                <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-[#6D35D4] group-hover:underline">View Requests <ArrowUpRight size={15}/></span>
                            </button>
                            <button type="button" onClick={(event) => openTeamDetail("invites", event.currentTarget)}
                                    className="group flex min-w-0 flex-col gap-3 rounded-[18px] border border-[#E6DDF0] bg-white p-4 text-left shadow-sm transition hover:border-[#C9AFE9] hover:bg-[#FFFCF7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6D35D4]">
                                <span className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF6DF] text-[#A56607]"><Clock3 size={20}/></span><span className="min-w-0"><span className="block text-[16px] font-bold text-[#1A1220]">Pending Invites</span><span className="block text-xs text-[#7A6A84]">Staff awaiting account activation</span></span></span>
                                <span className="text-xs font-semibold text-[#A56607]">{pendingInvites.length} pending</span>
                                <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-[#6D35D4] group-hover:underline">View Invites <ArrowUpRight size={15}/></span>
                            </button>
                        </section>

                        {activeTeamDetail && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-5"
                                 onMouseDown={(event) => { if (event.target === event.currentTarget && !reviewingRequest && !savingDecision) closeTeamDetail(); }}
                                 onKeyDown={(event) => { if (event.key === "Escape" && !reviewingRequest && !savingDecision) { event.stopPropagation(); closeTeamDetail(); } }}>
                                <div role="dialog" aria-modal="true" aria-labelledby="staff-team-detail-title"
                                     className="flex max-h-[90vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-[#FFFDF8] shadow-2xl">
                                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E6DDF0] bg-white px-5 py-4">
                                        <h2 id="staff-team-detail-title" className="text-[18px] font-bold text-[#1A1220]">{activeTeamDetail === "attendance" ? "Staff Attendance" : activeTeamDetail === "requests" ? "Employee Requests" : "Pending Invites"}</h2>
                                        <button ref={teamDetailCloseRef} type="button" aria-label="Close details" onClick={closeTeamDetail}
                                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] text-[#806A8C] hover:bg-[#F7F1FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6D35D4]"><X size={19}/></button>
                                    </div>
                                    <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
                                        {activeTeamDetail === "attendance" && (
                                            <section id="staff-attendance" className="scroll-mt-28 overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6DDF0] px-5 py-3">
                                                    <div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]"><CalendarDays size={20}/></span>
                                                        <div><h2 className="text-[18px] font-bold text-[#1A1220]">Staff Attendance</h2><p className="text-xs text-[#7A6A84]">Time In and Time Out recorded by staff of {branchName} from their dashboards.</p></div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <select aria-label="Filter staff attendance by period" value={attendancePeriod} onChange={e => setAttendancePeriod(e.target.value)} className="h-9 rounded-lg border border-[#E6DDF0] bg-white px-2 text-xs text-[#2B174C]"><option value="today">Today</option><option value="month">This Month</option><option value="previous">Last Month</option><option value="all">Last 90 Days</option></select>
                                                        <select aria-label="Filter staff attendance by status" value={attendanceStatusFilter} onChange={e => setAttendanceStatusFilter(e.target.value)} className="h-9 rounded-lg border border-[#E6DDF0] bg-white px-2 text-xs text-[#2B174C]"><option value="all">All Statuses</option><option value="On Duty">On Duty</option><option value="Completed">Completed</option><option value="On Leave">On Leave</option><option value="Absent">Absent</option></select>
                                                        <button type="button" onClick={exportStaffAttendanceAsPdf} title="Export staff attendance to PDF" aria-label="Export staff attendance to PDF" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] text-[#6D35D4] hover:bg-[#F7F1FF]"><Download size={17}/></button>
                                                    </div>
                                                </div>
                                                {attendanceSummary && <div className="flex flex-wrap items-center gap-2 border-b border-[#EEE7F2] bg-[#FFFCF7] px-5 py-2.5 text-xs">
                                                    <span className="mr-1 font-semibold text-[#5F4E75]">Today · {attendanceSummary.total} {attendanceSummary.total === 1 ? "staff member" : "staff members"}</span>
                                                    <SMAttendanceCount label="Present" value={attendanceSummary.present} tone="green"/>
                                                    <SMAttendanceCount label="On Leave" value={attendanceSummary.onLeave} tone="gold"/>
                                                    <SMAttendanceCount label="Absent" value={attendanceSummary.absent} tone="red"/>
                                                    <SMAttendanceCount label="Not Recorded" value={attendanceSummary.notRecorded} tone="gray"/>
                                                </div>}
                                                {attendanceError && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{attendanceError}</p>}
                                                <div className="max-h-[360px] overflow-y-auto overflow-x-hidden overscroll-contain"><table className="w-full min-w-0 table-fixed border-collapse font-sans text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th:not(:first-child)]:text-center [&_td:not(:first-child)]:text-center [&_th:first-child]:text-center [&_td:first-child]:text-left [&_td]:[overflow-wrap:anywhere]"><thead className="sticky top-0 z-10 bg-[#FFFCF8] text-[10px] uppercase text-[#806A8C]"><tr>{["Employee ID", "Staff Name", "Date", "Time In", "Time Out", "Hours Worked", "Status"].map(label => <th className="px-2.5 py-2.5 text-center" key={label}>{label}</th>)}</tr></thead>
                                                    <tbody>{visibleStaffAttendance.map(row => <tr className="border-t border-[#EEE7F2] hover:bg-[#FFFCF7]" key={`${row.employeeId}-${row.id}-${row.date}`}>
                                                        <td className="whitespace-nowrap px-2.5 py-2.5 font-semibold text-[#4E2C66]">{row.employeeCode || "—"}</td>
                                                        <td className="px-2.5 py-2.5 font-semibold text-[#2B174C]">{row.employeeName}</td>
                                                        <td className="whitespace-nowrap px-2.5 py-2.5">{smFormatDate(row.date)}</td>
                                                        <td className="whitespace-nowrap px-2.5 py-2.5">{smClockTime(row.timeIn)}</td>
                                                        <td className="whitespace-nowrap px-2.5 py-2.5">{smClockTime(row.timeOut)}</td>
                                                        <td className="whitespace-nowrap px-2.5 py-2.5">{smHours(row.hoursWorked)}</td>
                                                        <td className="px-2.5 py-2.5"><SMAttendanceBadge status={row.status}/></td>
                                                    </tr>)}{visibleStaffAttendance.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-[#8A7D92]">{requestLoading && teamAttendance.length === 0 ? "Loading staff attendance..." : attendanceStatusFilter !== "all" ? "No attendance records match the selected status." : attendancePeriod === "today" ? "No staff attendance recorded today yet. Time In records from staff dashboards will appear here." : "No staff attendance or approved leave for this period."}</td></tr>}</tbody>
                                                </table></div>
                                                <div className="border-t border-[#EEE7F2] px-4 py-2 text-right text-xs text-[#806A8C]">Showing {visibleStaffAttendance.length} {visibleStaffAttendance.length === 1 ? "record" : "records"} · Hours are shown after Time Out</div>
                                            </section>
                                        )}
                                        {activeTeamDetail === "requests" && (
                                            <section id="employee-requests" className="scroll-mt-28 overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6DDF0] px-5 py-3">
                                                    <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]"><Bell size={20}/></span>
                                                        <div><h2 className="text-[18px] font-bold text-[#1A1220]">Employee Requests</h2><p className="text-xs text-[#7A6A84]">Review staff leave and absence requests for {branchName}.</p></div>
                                                        <span className="rounded-full bg-[#FFF3D8] px-2.5 py-1 text-[10px] font-bold text-[#A56607]">{pendingApplications} pending</span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <select aria-label="Filter leave requests by status" value={requestStatusFilter} onChange={e => setRequestStatusFilter(e.target.value)} className="h-9 rounded-lg border border-[#E6DDF0] px-2 text-xs text-[#2B174C]"><option value="all">All Statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
                                                        <select aria-label="Filter leave requests by type" value={requestTypeFilter} onChange={e => setRequestTypeFilter(e.target.value)} className="h-9 rounded-lg border border-[#E6DDF0] px-2 text-xs text-[#2B174C]"><option value="all">All Leave Types</option>{types.map(type => <option key={type} value={type}>{type}</option>)}</select>
                                                        <button type="button" onClick={exportRequestsAsPdf} title="Export employee requests to PDF" aria-label="Export employee requests to PDF" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] text-[#6D35D4] hover:bg-[#F7F1FF]"><Download size={17}/></button>
                                                    </div>
                                                </div>
                                                {requestError && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{requestError}</p>}
                                                <div className="max-h-[360px] overflow-y-auto overflow-x-hidden overscroll-contain"><table className="w-full min-w-0 table-fixed border-collapse font-sans text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th:not(:first-child)]:text-center [&_td:not(:first-child)]:text-center [&_th:first-child]:text-center [&_td:first-child]:text-left [&_td]:[overflow-wrap:anywhere]"><thead className="sticky top-0 z-10 bg-[#FFFCF8] text-[10px] uppercase text-[#806A8C]"><tr>{["Employee", "Employee ID", "Leave Type", "Date / Range", "Status", "Action"].map(label => <th className="px-2.5 py-2.5 text-center" key={label}>{label}</th>)}</tr></thead>
                                                    <tbody>{filteredApplications.map(request => <tr className="border-t border-[#EEE7F2] hover:bg-[#FFFCF7]" key={request.key}>
                                                        <td className="px-2.5 py-2.5 font-semibold text-[#2B174C]">{request.employeeName}</td><td className="px-2.5 py-2.5">{request.employeeNumber}</td><td className="px-2.5 py-2.5">{request.leaveType}</td><td className="px-2.5 py-2.5">{smDatesLabel(request)}</td>
                                                        <td className="px-2.5 py-2.5"><span className={`text-[11px] font-semibold ${request.status === "Approved" ? "text-green-700" : request.status === "Rejected" ? "text-red-700" : "text-amber-700"}`}>{request.status}</span></td>
                                                        <td className="px-2.5 py-2.5"><button type="button" onClick={() => { setReviewingRequest(request); setRequestDecisionNote(""); setRequestDecisionError(""); }} className="rounded-lg bg-[#F1EBFF] px-3 py-1.5 font-semibold text-[#6D35D4] hover:bg-[#E6DCFF]">Review</button></td>
                                                    </tr>)}{filteredApplications.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-[#8A7D92]">{requestLoading ? "Loading employee requests..." : "No matching leave requests."}</td></tr>}</tbody>
                                                </table></div>
                                                <div className="border-t border-[#EEE7F2] px-4 py-2 text-right text-xs text-[#806A8C]">Showing {filteredApplications.length} of {leaveApplications.length} requests</div>
                                            </section>
                                        )}
                                        {activeTeamDetail === "invites" && (
                                            <section className="overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6DDF0] px-5 py-3">
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

                                                    <div className="flex items-center gap-2">
                                                        <span className="inline-flex items-center rounded-full bg-[#FFF7E8] px-3 py-1.5 text-xs font-semibold text-[#A56607]">
                                                            {filteredPendingInvites.length} pending
                                                        </span>
                                                        <button type="button" onClick={exportPendingStaffInvitesAsPdf} title="Download pending staff invites as PDF" aria-label="Download pending staff invites as PDF" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#6D35D4] transition hover:bg-[#F7F1FF]"><Download size={17}/></button>
                                                    </div>
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
                                                        <div className="max-h-[360px] overflow-y-auto overflow-x-hidden overscroll-contain">
                                                            <div
                                                                className="overflow-hidden rounded-[14px]"
                                                                style={{
                                                                    boxShadow:
                                                                        "inset 0 0 0 1px #EAE2F0",
                                                                }}
                                                            >
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
                                                                    {filteredPendingInvites.map(
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
                                                                                            className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-[#F1EBFF] px-3 text-xs font-semibold text-[#6D35D4] transition hover:bg-[#E6DCFF]"
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
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                    </section>
                </main>

                {staffStatusTarget && (
                    <div
                        className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget && updatingStaffStatusId === null) {
                                setStaffStatusTarget(null);
                            }
                        }}
                    >
                        <div role="alertdialog" aria-modal="true" aria-labelledby="staff-status-title" aria-describedby="staff-status-description"
                             className="w-full max-w-[500px] overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-white shadow-2xl">
                            <div className="flex items-start gap-3 border-b border-[#E9E1EE] px-5 py-5">
                                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${staffStatusTarget.status === "Accepted" ? "bg-[#FDEDED] text-[#C13333]" : "bg-[#E8F7EE] text-[#138342]"}`}>
                                    {staffStatusTarget.status === "Accepted" ? <UserX size={21} /> : <CheckCircle2 size={21} />}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <h2 id="staff-status-title" className="text-lg font-bold text-[#1A1220]">
                                        {staffStatusTarget.status === "Accepted" ? "Deactivate Staff Access" : "Reactivate Staff Access"}
                                    </h2>
                                    <p className="mt-1 text-xs text-[#806A8C]">
                                        {staffStatusTarget.status === "Accepted" ? "Temporarily remove login access without deleting the employee." : "Restore login access for this employee."}
                                    </p>
                                </div>
                                <button type="button" aria-label="Close staff access dialog" disabled={updatingStaffStatusId !== null}
                                        onClick={() => setStaffStatusTarget(null)} className="rounded-lg p-1 text-[#806A8C] hover:bg-[#F7F1FF] disabled:opacity-50">
                                    <X size={19} />
                                </button>
                            </div>
                            <div id="staff-status-description" className="space-y-3 px-5 py-5 text-sm text-[#4F3E5E]">
                                <p>
                                    {staffStatusTarget.status === "Accepted" ? "Deactivate" : "Reactivate"} <strong className="text-[#2B174C]">{staffStatusTarget.name}</strong>&apos;s staff access?
                                </p>
                                <div className="rounded-xl border border-[#E9E1EE] bg-[#FBF8FE] px-4 py-3 text-xs leading-6">
                                    {staffStatusTarget.status === "Accepted"
                                        ? "The employee will not be able to sign in again while inactive. Their name, email, account, attendance, and other existing records remain in the database. You can reactivate access later."
                                        : "The employee can use their existing account again, subject to your store's available staff slots and current permissions. No new invitation is required."}
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 border-t border-[#E9E1EE] px-5 py-4">
                                <button type="button" disabled={updatingStaffStatusId !== null} onClick={() => setStaffStatusTarget(null)}
                                        className="rounded-xl border border-[#DCCFE8] bg-white px-4 py-2.5 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50">
                                    Cancel
                                </button>
                                <button type="button" disabled={updatingStaffStatusId !== null} onClick={() => void handleChangeStaffStatus(staffStatusTarget)}
                                        className={`rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${staffStatusTarget.status === "Accepted" ? "bg-[#A33E20] hover:bg-[#883117]" : "bg-[#138342] hover:bg-[#0D6F34]"}`}>
                                    {updatingStaffStatusId !== null ? "Updating..." : staffStatusTarget.status === "Accepted" ? "Deactivate Access" : "Reactivate Access"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {staffStatusToast && (
                    <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[100] flex w-[min(395px,calc(100vw-40px))] items-start gap-3 rounded-2xl border border-[#E6DDF0] bg-white p-4 shadow-[0_10px_35px_rgba(30,14,47,0.18)]">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${staffStatusToast.kind === "success" ? "bg-[#E8F7EE] text-[#138342]" : "bg-[#FDEDED] text-[#C13333]"}`}>
                            {staffStatusToast.kind === "success" ? <CheckCircle2 size={21} /> : <UserX size={21} />}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-[#1A1220]">{staffStatusToast.title}</p>
                            <p className="mt-1 text-xs leading-5 text-[#806A8C]">{staffStatusToast.message}</p>
                        </div>
                        <button type="button" aria-label="Dismiss staff access notification" onClick={() => setStaffStatusToast(null)}
                                className="rounded-lg p-1 text-[#806A8C] hover:bg-[#F7F1FF]"><X size={16} /></button>
                    </div>
                )}

                {reviewingRequest && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !savingDecision) setReviewingRequest(null); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="staff-leave-review-title" className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-white shadow-2xl">
                        <div className="flex items-start justify-between border-b border-[#E6DDF0] p-5"><div><h2 id="staff-leave-review-title" className="text-lg font-bold text-[#1A1220]">Review Employee Request</h2><p className="text-xs text-[#7A6A84]">Review the reason and dates before deciding.</p></div><button type="button" disabled={savingDecision} onClick={() => setReviewingRequest(null)} className="text-[#7A6A84]" aria-label="Close review"><X size={20}/></button></div>
                        <div className="space-y-4 overflow-y-auto p-5 text-sm">
                            <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#FBF8FE] p-4"><div><span className="text-xs text-[#7A6A84]">Employee</span><p className="font-semibold">{reviewingRequest.employeeName}</p></div><div><span className="text-xs text-[#7A6A84]">Employee ID</span><p className="font-semibold">{reviewingRequest.employeeNumber}</p></div><div><span className="text-xs text-[#7A6A84]">Leave Type</span><p className="font-semibold">{reviewingRequest.leaveType}</p></div><div><span className="text-xs text-[#7A6A84]">Status</span><p className="font-semibold">{reviewingRequest.status}</p></div><div className="col-span-2"><span className="text-xs text-[#7A6A84]">Date / Range</span><p className="font-semibold">{smDatesLabel(reviewingRequest)}</p></div></div>
                            <div><h3 className="text-xs font-bold text-[#5F4E75]">Employee's Reason</h3><p className="mt-1 whitespace-pre-wrap rounded-xl border border-[#E6DDF0] p-3">{reviewingRequest.reason}</p></div>
                            {reviewingRequest.status !== "Pending" && reviewingRequest.decisionReason && <div><h3 className="text-xs font-bold">Decision Reason</h3><p className="mt-1 rounded-xl bg-[#FBF8FE] p-3">{reviewingRequest.decisionReason}</p></div>}
                            {reviewingRequest.status === "Pending" && <div><label htmlFor="staff-decision-note" className="mb-1 block text-xs font-bold text-[#5F4E75]">Decision Note (required when disapproving)</label><textarea id="staff-decision-note" value={requestDecisionNote} onChange={e => setRequestDecisionNote(e.target.value)} rows={3} maxLength={500} className="w-full rounded-xl border border-[#E6DDF0] p-3 outline-none focus:border-[#8058BA]" placeholder="Explain the decision"/></div>}
                            {requestDecisionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{requestDecisionError}</p>}
                            {!canApproveRequests && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Staff Management approval permission is required.</p>}
                        </div>
                        <div className="flex justify-end gap-2 border-t border-[#E6DDF0] p-4"><button type="button" onClick={() => setReviewingRequest(null)} disabled={savingDecision} className="rounded-xl border px-4 py-2 text-xs font-semibold">Close</button>
                            {reviewingRequest.status === "Pending" && canApproveRequests && <><button type="button" disabled={savingDecision || requestDecisionNote.trim().length < 3} onClick={() => void submitReview("Rejected")} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Disapprove</button><button type="button" disabled={savingDecision} onClick={() => void submitReview("Approved")} className="rounded-xl bg-[#2B174C] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingDecision ? "Saving..." : "Approve"}</button></>}
                        </div>
                    </div>
                </div>}

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
                                            <AccessModeRow
                                                label="POS / Sales"
                                                value={permissions.pos_access}
                                                onChange={(value) => updateFeatureAccess("pos", value as AccessMode)}
                                            />
                                            <AccessModeRow
                                                label="Bookings"
                                                value={permissions.bookings_access}
                                                allowView
                                                fullLabel="Standard Confirmation & Operations"
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
                                                allowView={false}
                                                onChange={(value) => updateReportsAccess(value as ReportsAccessMode)}
                                            />
                                            <AccessModeRow
                                                label="Analytics"
                                                value={permissions.analytics_access}
                                                allowView={false}
                                                locked={planAccessLoading || !planAccess.hasAnalytics}
                                                lockText={
                                                    planAccessLoading
                                                        ? "Checking plan..."
                                                        : `Not included in ${planAccess.name} plan`
                                                }
                                                onChange={(value) => updateFeatureAccess("analytics", value as AccessMode)}
                                            />
                                            <AccessModeRow
                                                label="Forecasting"
                                                value={permissions.forecasting_access}
                                                allowView={false}
                                                locked={planAccessLoading || !planAccess.hasForecasting}
                                                lockText={
                                                    planAccessLoading
                                                        ? "Checking plan..."
                                                        : `Not included in ${planAccess.name} plan`
                                                }
                                                onChange={(value) => updateFeatureAccess("forecasting", value as AccessMode)}
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
                                <AccessModeRow
                                    label="POS / Sales"
                                    value={editPermissions.pos_access}
                                    onChange={(value) => updateEditFeatureAccess("pos", value as AccessMode)}
                                />
                                <AccessModeRow
                                    label="Bookings"
                                    value={editPermissions.bookings_access}
                                    allowView
                                    fullLabel="Standard Confirmation & Operations"
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
                                    label="Analytics"
                                    value={editPermissions.analytics_access}
                                    allowView={false}
                                    locked={planAccessLoading || !planAccess.hasAnalytics}
                                    lockText={
                                        planAccessLoading
                                            ? "Checking plan..."
                                            : `Not included in ${planAccess.name} plan`
                                    }
                                    onChange={(value) => updateEditFeatureAccess("analytics", value as AccessMode)}
                                />
                                <AccessModeRow
                                    label="Forecasting"
                                    value={editPermissions.forecasting_access}
                                    allowView={false}
                                    locked={planAccessLoading || !planAccess.hasForecasting}
                                    lockText={
                                        planAccessLoading
                                            ? "Checking plan..."
                                            : `Not included in ${planAccess.name} plan`
                                    }
                                    onChange={(value) => updateEditFeatureAccess("forecasting", value as AccessMode)}
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

    const posAccess = getAccessValue(parsed.pos_access, parsed.pos);
    const bookingsAccess = getBookingAccessValue(parsed.bookings_access, parsed.bookings);
    const inventoryAccess = getAccessValue(parsed.inventory_access, parsed.inventory);
    const packageAccess = getAccessValue(parsed.package_access, parsed.packages);
    const reportsAccess = getReportsAccessValue(parsed.reports_access, parsed.reports);
    const analyticsAccess = getAccessValue(parsed.analytics_access, parsed.analytics);
    const forecastingAccess = getAccessValue(parsed.forecasting_access, parsed.forecasting);

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
        reports: reportsAccess !== "none",
        reports_access: reportsAccess,
        analytics: analyticsAccess !== "none",
        analytics_access: analyticsAccess,
        forecasting: forecastingAccess !== "none",
        forecasting_access: forecastingAccess,
    };
}

function getAccessValue(value: any, legacyBoolean: any): AccessMode {
    if (value === "full" || value === "none") return value;
    if (value === "view") return "full";
    if (legacyBoolean === true) return "full";
    return "none";
}

// Booking read-only must remain read-only; other legacy feature access
// normalization is intentionally left untouched.
function getBookingAccessValue(value: any, legacyBoolean: any): AccessMode {
    if (value === "full" || value === "standard" || value === "confirm_standard") return "full";
    if (value === "view") return "view";
    if (value === "none") return "none";
    return legacyBoolean === true ? "view" : "none";
}

function getReportsAccessValue(value: any, legacyBoolean: any): ReportsAccessMode {
    if (value === "full" || value === "none") return value;
    if (value === "view") return "full";
    if (legacyBoolean === true) return "full";
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
    value: AccessMode | ReportsAccessMode;
    onChange: (value: AccessMode | ReportsAccessMode) => void;
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
                    onChange={(e) => onChange(e.target.value as AccessMode | ReportsAccessMode)}
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
    if (permissions.bookings_access !== "none") list.push(`Bookings: ${permissions.bookings_access === "full" ? "Standard Confirmation & Operations" : "View only"}`);
    if (permissions.inventory_access !== "none") list.push(`Inventory: ${formatAccess(permissions.inventory_access)}`);
    if (permissions.inventory_stock_receive) list.push("Authorized Stock Receiver");
    if (permissions.package_access !== "none") list.push(`Packages: ${formatAccess(permissions.package_access)}`);
    if (permissions.reports_access !== "none") list.push(`Reports: ${formatAccess(permissions.reports_access)}`);
    if (permissions.analytics_access !== "none") list.push(`Analytics: ${formatAccess(permissions.analytics_access)}`);
    if (permissions.forecasting_access !== "none") list.push(`Forecasting: ${formatAccess(permissions.forecasting_access)}`);

    return list.length > 0 ? list.join(", ") : "No access";
}

function formatRoleSummary(permissions: StaffPermissions) {
    const shortLabels: string[] = [];
    if (permissions.pos_access !== "none") shortLabels.push("Sales");
    if (permissions.bookings_access !== "none") shortLabels.push("Bookings");
    if (permissions.inventory_access !== "none") shortLabels.push("Inventory");
    if (permissions.package_access !== "none") shortLabels.push("Packages");
    if (permissions.reports_access !== "none") shortLabels.push("Reports");
    if (permissions.analytics_access !== "none") shortLabels.push("Analytics");
    if (permissions.forecasting_access !== "none") shortLabels.push("Forecasting");
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

// One leave request can span one day or a date range. Legacy daily rows from
// one submission are grouped only when all identifying fields match.
type SMLeaveRow = { id: number; employeeId: number; employeeName: string; employeeNumber: string;
    leaveDate: string; leaveEndDate?: string; leaveType: string; reason: string; approvalStatus: string;
    decisionReason: string | null; createdAt: string };
type SMLeaveGroup = { key: string; ids: number[]; employeeName: string; employeeNumber: string;
    leaveType: string; reason: string; status: string; decisionReason: string | null;
    createdAt: string; start: string; end: string };
function smAddDay(value: string) {
    const date = new Date(value + "T00:00:00Z"); date.setUTCDate(date.getUTCDate()+1);
    return date.toISOString().slice(0, 10);
}
function smGroupLeaves(rows: SMLeaveRow[]): SMLeaveGroup[] {
    const result: SMLeaveGroup[] = [];
    for (const row of [...rows].sort((a,b) => a.employeeId-b.employeeId || a.createdAt.localeCompare(b.createdAt) || a.leaveDate.localeCompare(b.leaveDate))) {
        const end = row.leaveEndDate && row.leaveEndDate >= row.leaveDate ? row.leaveEndDate : row.leaveDate;
        const last = result[result.length - 1];
        if (last && last.employeeNumber === String(row.employeeNumber) && last.createdAt === row.createdAt &&
            last.leaveType === row.leaveType && last.reason === row.reason && last.status === row.approvalStatus &&
            smAddDay(last.end) === row.leaveDate) {
            last.ids.push(row.id); last.end = end;
        } else result.push({ key: String(row.id), ids: [row.id], employeeName: row.employeeName,
            employeeNumber: String(row.employeeNumber), leaveType: row.leaveType, reason: row.reason,
            status: row.approvalStatus, decisionReason: row.decisionReason, createdAt: row.createdAt,
            start: row.leaveDate, end });
    }
    return result.sort((a,b) => Number(b.status === "Pending") - Number(a.status === "Pending") || b.createdAt.localeCompare(a.createdAt));
}
function smFormatDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function smDatesLabel(req: SMLeaveGroup) {
    return req.start === req.end ? smFormatDate(req.start) : `${smFormatDate(req.start)} – ${smFormatDate(req.end)}`;
}

// Staff attendance rows come from stocknbook_staff_attendance via manager-staff-overview.
// hoursWorked is calculated by the server (same SQL as the staff Attendance Log).
type SMAttendanceRow = { id: number; employeeId: number; employeeCode?: string | null; employeeName: string; date: string;
    timeIn: string | null; timeOut: string | null; hoursWorked: number | string | null; status: string };
type SMAttendanceSummary = { total: number; present: number; onLeave: number; absent: number; notRecorded: number };
function smManilaDay(date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (name: string) => parts.find(item => item.type === name)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}
function smShiftDay(value: string, days: number) {
    const date = new Date(value + "T00:00:00Z"); date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function smInPeriod(day: string, period: string, today: string) {
    if (!today) return false;
    if (period === "all") return true;
    if (period === "today") return day === today;
    if (period === "month") return day.slice(0, 7) === today.slice(0, 7);
    if (period === "previous") {
        const [year, month] = today.slice(0, 7).split("-").map(Number);
        return day.slice(0, 7) === new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    }
    return false;
}
function smClockTime(value?: string | null) {
    const match = value?.match(/T(\d{2}):(\d{2})/);
    if (!match) return "—";
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}
function smHours(value?: number | string | null) {
    if (value === undefined || value === null || value === "" || !Number.isFinite(Number(value))) return "—";
    const minutes = Math.max(0, Math.round(Number(value) * 60));
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function SMAttendanceBadge({ status }: { status: string }) {
    const label = String(status || "Not Recorded");
    const classes = label === "On Duty" || label === "Completed" || label === "Present"
        ? "text-[#16834A]"
        : label === "On Leave" ? "text-[#A56607]"
            : label === "Absent" ? "text-[#D52B2B]" : "text-[#806A8C]";
    return <span className={`inline-flex whitespace-nowrap text-[11px] font-semibold ${classes}`}>{label}</span>;
}
function SMAttendanceCount({ label, value, tone }: { label: string; value: number; tone: "green" | "gold" | "red" | "gray" }) {
    const classes = { green: "bg-[#E6F7EE] text-[#16834A]", gold: "bg-[#FFF3D8] text-[#A56607]",
        red: "bg-[#FFF0F0] text-[#D52B2B]", gray: "bg-[#F2EFF5] text-[#806A8C]" }[tone];
    return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${classes}`}>{label}<span className="font-bold">{Number(value) || 0}</span></span>;
}