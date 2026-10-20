"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import {
    Building2,
    Bell,
    Clock3,
    Download,
    CheckCircle2,
    Copy,
    Filter,
    Mail,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    UserCheck,
    UserPlus,
    UsersRound,
    UserX,
    X,
    LockKeyhole,
    ArrowUpRight,
} from "lucide-react";

type ManagerStatus = "active" | "inactive" | "pending";

type BranchManager = {
    id: number;
    name: string;
    email: string;
    branch: string;
    status: ManagerStatus;
};

type ManagerLeaveRow = {
    id: number;
    managerId: number;
    managerName: string;
    branchName: string;
    branchId: number;
    leaveDate: string;
    leaveType: string;
    reason: string;
    approvalStatus: string;
    decisionReason: string | null;
    createdAt: string;
};
type ManagerLeaveGroup = {
    key: string;
    ids: number[];
    managerId: number;
    managerName: string;
    branchName: string;
    leaveType: string;
    reason: string;
    status: string;
    decisionReason: string | null;
    createdAt: string;
    start: string;
    end: string;
};
function dayAfter(value: string) {
    const day = new Date(value + "T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + 1);
    return day.toISOString().slice(0, 10);
}
function groupManagerLeaves(rows: ManagerLeaveRow[]): ManagerLeaveGroup[] {
    const groups: ManagerLeaveGroup[] = [];
    for (const row of [...rows].sort((a, b) => a.managerId - b.managerId ||
        a.createdAt.localeCompare(b.createdAt) || a.leaveDate.localeCompare(b.leaveDate))) {
        const last = groups[groups.length - 1];
        if (last && last.managerId === row.managerId && last.branchName === row.branchName &&
            last.createdAt === row.createdAt && last.leaveType === row.leaveType &&
            last.reason === row.reason && last.status === row.approvalStatus &&
            dayAfter(last.end) === row.leaveDate) {
            last.ids.push(row.id);
            last.end = row.leaveDate;
        } else groups.push({ key: String(row.id), ids: [row.id], managerId: row.managerId,
            managerName: row.managerName, branchName: row.branchName,
            leaveType: row.leaveType, reason: row.reason, status: row.approvalStatus,
            decisionReason: row.decisionReason, createdAt: row.createdAt,
            start: row.leaveDate, end: row.leaveDate });
    }
    return groups.sort((a, b) => Number(b.status === "Pending") - Number(a.status === "Pending") ||
        b.createdAt.localeCompare(a.createdAt));
}
function managerDateLabel(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(value + "T12:00:00Z").toLocaleDateString("en-US",
        { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function managerRangeLabel(group: ManagerLeaveGroup) {
    return group.start === group.end ? managerDateLabel(group.start) :
        `${managerDateLabel(group.start)} – ${managerDateLabel(group.end)}`;
}

type ManagerPermissions = {
    dashboard: boolean;
    bookings: boolean;
    packages: boolean;
    packages_manage: boolean;
    inventory: boolean;
    pos: boolean;
    reports: boolean;
    staff_management: boolean;
    branch_settings: boolean;
};

type AvailableBranch = {
    id: number;
    branchName: string;
    managerName: string;
    managerEmail: string;
    status: "active" | "inactive";
};

type ManagerInviteDelivery = {
    link: string;
    email: string;
    emailSent: boolean;
    emailError: string;
};

const defaultManagerPermissions: ManagerPermissions = {
    dashboard: true,
    bookings: true,
    packages: true,
    packages_manage: true,
    inventory: true,
    pos: true,
    reports: true,
    staff_management: true,
    branch_settings: true,
};

type RawManager = Record<string, unknown>;

function asText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value: unknown): ManagerStatus {
    const status = asText(value).toLowerCase();

    if (status === "active") return "active";
    if (status === "inactive" || status === "disabled") return "inactive";

    return "pending";
}

function normalizeManager(value: unknown): BranchManager {
    const manager =
        value && typeof value === "object" ? (value as RawManager) : {};

    return {
        id: asNumber(
            manager.id ??
            manager.manager_id ??
            manager.managerId ??
            manager.user_id ??
            manager.userId
        ),
        name:
            asText(manager.name) ||
            asText(manager.manager_name) ||
            asText(manager.full_name) ||
            asText(manager.fullName) ||
            "Unnamed manager",
        email:
            asText(manager.email) ||
            asText(manager.manager_email) ||
            "No email provided",
        branch:
            asText(manager.branch) ||
            asText(manager.branch_name) ||
            asText(manager.branchName) ||
            "No branch assigned",
        status: normalizeStatus(
            manager.status ??
            manager.manager_status ??
            manager.account_status ??
            manager.accountStatus
        ),
    };
}

function normalizeAvailableBranch(value: unknown): AvailableBranch {
    const branch =
        value && typeof value === "object"
            ? (value as RawManager)
            : {};

    const rawStatus = (
        asText(branch.branch_status) ||
        asText(branch.status) ||
        "active"
    ).toLowerCase();

    return {
        id: asNumber(
            branch.id ??
            branch.branch_id ??
            branch.branchId
        ),
        branchName:
            asText(branch.branch_name) ||
            asText(branch.branchName) ||
            asText(branch.name) ||
            "Unnamed branch",
        managerName:
            asText(branch.manager_name) ||
            asText(branch.managerName),
        managerEmail:
            asText(branch.manager_email) ||
            asText(branch.managerEmail),
        status: rawStatus === "inactive" ? "inactive" : "active",
    };
}

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

function getStatusLabel(status: ManagerStatus) {
    if (status === "active") return "Active";
    if (status === "inactive") return "Inactive";
    return "Pending";
}

function getStatusClass(status: ManagerStatus) {
    if (status === "active") {
        return "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]";
    }

    if (status === "inactive") {
        return "border-[#F3C6C6] bg-[#FFF1F1] text-[#C13333]";
    }

    return "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]";
}

type SubscriptionPlan = "starter" | "growth" | "scale";

type SubscriptionResponse = {
    subscription?: {
        plan?: {
            name?: string | null;
        };
    };
};

function normalizeSubscriptionPlan(value: unknown): SubscriptionPlan {
    const plan = String(value || "").trim().toLowerCase();

    if (plan.includes("scale")) return "scale";
    if (plan.includes("growth")) return "growth";
    return "starter";
}

function getStoredSubscriptionPlan(): SubscriptionPlan {
    if (typeof window === "undefined") return "starter";

    const keys = [
        "subscription_plan",
        "current_plan",
        "plan",
        "plan_name",
        "planName",
        "store_plan",
    ];

    for (const storage of [sessionStorage, localStorage]) {
        for (const key of keys) {
            const value = storage.getItem(key);
            if (value) return normalizeSubscriptionPlan(value);
        }

        for (const key of ["subscription", "current_subscription", "active_subscription", "subscriptionData"]) {
            const raw = storage.getItem(key);
            if (!raw) continue;
            try {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                const plan = parsed.plan ?? parsed.plan_name ?? parsed.planName ?? parsed.name;
                if (plan) return normalizeSubscriptionPlan(plan);
            } catch {
                // Ignore non-JSON storage values.
            }
        }
    }

    return "starter";
}

function getManagerLimit(plan: SubscriptionPlan) {
    if (plan === "scale") return Number.POSITIVE_INFINITY;
    if (plan === "growth") return 3;
    return 1;
}

export default function BranchManagersPage() {
    const router = useRouter();

    const [managers, setManagers] = useState<BranchManager[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingManagerId, setUpdatingManagerId] = useState<number | null>(null);
    const [confirmAccessChange, setConfirmAccessChange] = useState<BranchManager | null>(null);
    const [managerRequests, setManagerRequests] = useState<ManagerLeaveRow[]>([]);
    const [requestsLoading, setRequestsLoading] = useState(false);
    const [requestsError, setRequestsError] = useState("");
    const [requestsStatusFilter, setRequestsStatusFilter] = useState("all");
    const [requestsTypeFilter, setRequestsTypeFilter] = useState("all");
    const [requestsBranchFilter, setRequestsBranchFilter] = useState("all");
    const [reviewingManagerRequest, setReviewingManagerRequest] = useState<ManagerLeaveGroup | null>(null);
    const [reviewReason, setReviewReason] = useState("");
    const [reviewError, setReviewError] = useState("");
    const [reviewSaving, setReviewSaving] = useState(false);
    const [notice, setNotice] = useState<{ title: string; message: string; kind: "success" | "error" } | null>(null);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<
        "all" | ManagerStatus
    >("all");
    const [error, setError] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const [showAddManagerModal, setShowAddManagerModal] =
        useState(false);
    const [availableBranches, setAvailableBranches] = useState<
        AvailableBranch[]
    >([]);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [addingManager, setAddingManager] = useState(false);
    const [addManagerError, setAddManagerError] = useState("");
    const [selectedBranchId, setSelectedBranchId] = useState("");
    const [newManagerName, setNewManagerName] = useState("");
    const [newManagerEmail, setNewManagerEmail] = useState("");
    const [newManagerPermissions, setNewManagerPermissions] =
        useState<ManagerPermissions>({
            ...defaultManagerPermissions,
        });
    const [showPlanLimitDialog, setShowPlanLimitDialog] = useState(false);
    const [subscriptionPlan, setSubscriptionPlan] = useState<SubscriptionPlan>("starter");
    const [latestManagerInvite, setLatestManagerInvite] =
        useState<ManagerInviteDelivery | null>(null);
    const [resendingManagerId, setResendingManagerId] =
        useState<number | null>(null);

    const loadSubscriptionPlan = useCallback(async () => {
        const token =
            sessionStorage.getItem("token") || localStorage.getItem("token");

        if (!token) {
            setSubscriptionPlan(getStoredSubscriptionPlan());
            return;
        }

        try {
            const response = await fetch("/api/subscription-client", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                },
                cache: "no-store",
            });

            const rawText = await response.text();

            let data: SubscriptionResponse = {};
            try {
                data = rawText ? (JSON.parse(rawText) as SubscriptionResponse) : {};
            } catch {
                data = {};
            }

            if (!response.ok) {
                setSubscriptionPlan(getStoredSubscriptionPlan());
                return;
            }

            const planName = data.subscription?.plan?.name;
            if (planName) {
                const normalized = normalizeSubscriptionPlan(planName);
                setSubscriptionPlan(normalized);
                sessionStorage.setItem("subscription_plan", normalized);
                localStorage.setItem("subscription_plan", normalized);
                return;
            }

            setSubscriptionPlan(getStoredSubscriptionPlan());
        } catch {
            setSubscriptionPlan(getStoredSubscriptionPlan());
        }
    }, []);

    const loadManagers = useCallback(async () => {
        const token =
            sessionStorage.getItem("token") || localStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const response = await fetch("/api/branch-managers", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
            });

            const rawText = await response.text();

            let data: {
                managers?: unknown[];
                branch_managers?: unknown[];
                error?: string;
                message?: string;
            } = {};

            try {
                data = rawText ? JSON.parse(rawText) : {};
            } catch {
                data = {
                    error:
                        rawText ||
                        "The Branch Managers service returned an invalid response.",
                };
            }

            if (!response.ok) {
                setManagers([]);
                setError(
                    data.error ||
                    data.message ||
                    `Unable to load branch managers (HTTP ${response.status}).`
                );
                return;
            }

            const records = Array.isArray(data.managers)
                ? data.managers
                : Array.isArray(data.branch_managers)
                    ? data.branch_managers
                    : [];

            setManagers(
                records
                    .map(normalizeManager)
                    .filter((manager) => manager.id > 0)
            );
        } catch (requestError: unknown) {
            setManagers([]);
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "Unable to load branch managers. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }, [router]);

    const loadManagerRequests = useCallback(async () => {
        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        if (!token) return;
        setRequestsLoading(true);
        try {
            const res = await fetch("/api/branch-managers?view=manager_requests", {
                method: "GET", cache: "no-store",
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success !== true) throw new Error(data.error || "Could not load manager requests.");
            setManagerRequests(Array.isArray(data.requests) ? data.requests : []);
            setRequestsError("");
        } catch (error) {
            setRequestsError(error instanceof Error ? error.message : "Could not load manager requests.");
        } finally { setRequestsLoading(false); }
    }, []);

    useEffect(() => {
        void loadManagerRequests();
    }, [loadManagerRequests]);

    useEffect(() => {
        setSubscriptionPlan(getStoredSubscriptionPlan());
        void loadSubscriptionPlan();
    }, [loadSubscriptionPlan]);

    useEffect(() => {
        void loadManagers();
    }, [loadManagers]);

    useEffect(() => {
        if (!notice) return;
        const timeout = window.setTimeout(() => setNotice(null), 5600);
        return () => window.clearTimeout(timeout);
    }, [notice]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const totals = useMemo(() => {
        const active = managers.filter(
            (manager) => manager.status === "active"
        ).length;

        const inactive = managers.filter(
            (manager) => manager.status === "inactive"
        ).length;

        return {
            total: managers.length,
            active,
            inactive,
        };
    }, [managers]);

    const filteredManagers = useMemo(() => {
        const query = search.trim().toLowerCase();

        return managers.filter((manager) => {
            const matchesSearch =
                !query ||
                `${manager.name} ${manager.email} ${manager.branch} ${getStatusLabel(
                    manager.status
                )}`
                    .toLowerCase()
                    .includes(query);

            const matchesStatus =
                statusFilter === "all" ||
                manager.status === statusFilter;

            return matchesSearch && matchesStatus;
        });
    }, [managers, search, statusFilter]);

    const listedManagers = filteredManagers.filter(manager => manager.status !== "pending");
    const pendingInvites = managers.filter(manager => manager.status === "pending" &&
        (statusFilter === "all" || statusFilter === "pending") &&
        (!search.trim() || `${manager.name} ${manager.email} ${manager.branch}`.toLowerCase().includes(search.trim().toLowerCase())));
    const groupedManagerRequests = useMemo(() => groupManagerLeaves(managerRequests), [managerRequests]);
    const pendingManagerRequests = groupedManagerRequests.filter(item => item.status === "Pending").length;
    const managerLeaveTypes = [...new Set(groupedManagerRequests.map(item => item.leaveType))].sort();
    const managerRequestBranches = [...new Set(groupedManagerRequests.map(item => item.branchName))].sort();
    const filteredManagerRequests = groupedManagerRequests.filter(item =>
        (requestsStatusFilter === "all" || item.status.toLowerCase() === requestsStatusFilter) &&
        (requestsTypeFilter === "all" || item.leaveType === requestsTypeFilter) &&
        (requestsBranchFilter === "all" || item.branchName === requestsBranchFilter));

    const reviewManagerLeave = async (decision: "Approved" | "Rejected") => {
        if (!reviewingManagerRequest || reviewSaving) return;
        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        if (!token) return router.push("/");
        setReviewSaving(true);
        setReviewError("");
        try {
            const res = await fetch("/api/branch-managers", {
                method: "POST", headers: {
                    "Content-Type": "application/json", Authorization: `Bearer ${token}`,
                }, body: JSON.stringify({ action: "review_manager_leave", decision,
                    requestIds: reviewingManagerRequest.ids, decisionReason: reviewReason.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success !== true) throw new Error(data.error || "Could not review manager request.");
            setReviewingManagerRequest(null);
            setReviewReason("");
            setNotice({ title: `Manager request ${decision.toLowerCase()}`,
                message: "The decision has been saved.", kind: "success" });
            await loadManagerRequests();
        } catch (error) {
            setReviewError(error instanceof Error ? error.message : "Review failed.");
        } finally { setReviewSaving(false); }
    };

    const exportManagerRequests = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                title: "Manager Leave Requests",
                headers: ["Manager", "Branch", "Leave Type", "Date / Range", "Status", "Reason"],
                rows: filteredManagerRequests.map(item => [item.managerName, item.branchName,
                    item.leaveType, managerRangeLabel(item), item.status, item.reason]),
            }, { storeName: sessionStorage.getItem("store_name") || "StockNBook",
                branch: "All branches", dateRange: "All requests" }, "owner_manager_requests"))
            .catch(() => setNotice({ title: "Export unavailable", message: "Could not export manager requests.", kind: "error" }));
    };

    const resetAddManagerForm = useCallback(() => {
        setSelectedBranchId("");
        setNewManagerName("");
        setNewManagerEmail("");
        setNewManagerPermissions({
            ...defaultManagerPermissions,
        });
        setAddManagerError("");
    }, []);

    const loadAvailableBranches = useCallback(async () => {
        const token =
            sessionStorage.getItem("token") ||
            localStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setLoadingBranches(true);
        setAddManagerError("");

        try {
            const response = await fetch("/api/branches", {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
            });

            const rawText = await response.text();

            let data: {
                branches?: unknown[];
                error?: string;
                message?: string;
            } = {};

            try {
                data = rawText ? JSON.parse(rawText) : {};
            } catch {
                data = {
                    error:
                        rawText ||
                        "The Branches service returned an invalid response.",
                };
            }

            if (!response.ok) {
                setAvailableBranches([]);
                setAddManagerError(
                    data.error ||
                    data.message ||
                    `Unable to load branches (HTTP ${response.status}).`
                );
                return;
            }

            const normalizedBranches = Array.isArray(data.branches)
                ? data.branches
                    .map(normalizeAvailableBranch)
                    .filter((branch) => branch.id > 0)
                : [];

            setAvailableBranches(
                normalizedBranches.filter(
                    (branch) =>
                        !branch.managerName &&
                        !branch.managerEmail
                )
            );
        } catch (requestError: unknown) {
            setAvailableBranches([]);
            setAddManagerError(
                requestError instanceof Error
                    ? requestError.message
                    : "Unable to load branches without managers."
            );
        } finally {
            setLoadingBranches(false);
        }
    }, [router]);

    const openAddManagerModal = () => {
        const managerLimit = getManagerLimit(subscriptionPlan);

        if (Number.isFinite(managerLimit) && managers.length >= managerLimit) {
            setShowPlanLimitDialog(true);
            return;
        }

        resetAddManagerForm();
        setShowAddManagerModal(true);
        void loadAvailableBranches();
    };

    const closeAddManagerModal = () => {
        if (addingManager) return;

        setShowAddManagerModal(false);
        resetAddManagerForm();
    };

    const handleAddManager = async () => {
        const managerLimit = getManagerLimit(subscriptionPlan);

        if (Number.isFinite(managerLimit) && managers.length >= managerLimit) {
            setShowAddManagerModal(false);
            setShowPlanLimitDialog(true);
            return;
        }

        const token =
            sessionStorage.getItem("token") ||
            localStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        const branchId = Number(selectedBranchId);
        const managerName = newManagerName.trim();
        const managerEmail = newManagerEmail
            .trim()
            .toLowerCase();

        if (!branchId) {
            setAddManagerError(
                "Select the branch where this manager will be assigned."
            );
            return;
        }

        if (!managerName) {
            setAddManagerError("Enter the manager name.");
            return;
        }

        if (
            !managerEmail ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)
        ) {
            setAddManagerError(
                "Enter a valid manager email address."
            );
            return;
        }

        setAddingManager(true);
        setAddManagerError("");

        try {
            const response = await fetch("/api/branch-managers", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "add_manager_to_branch",
                    branch_id: branchId,
                    manager_name: managerName,
                    manager_email: managerEmail,
                    permissions: newManagerPermissions,
                }),
            });

            const rawText = await response.text();

            let data: {
                manager?: unknown;
                error?: string;
                message?: string;
                email_sent?: boolean;
                email_status?: string;
                email_error?: string;
                invite_link?: string;
            } = {};

            try {
                data = rawText ? JSON.parse(rawText) : {};
            } catch {
                data = {
                    error:
                        rawText ||
                        "The Branch Managers service returned an invalid response.",
                };
            }

            if (!response.ok) {
                setAddManagerError(
                    data.error ||
                    data.message ||
                    `Unable to add manager (HTTP ${response.status}).`
                );
                return;
            }

            if (data.manager) {
                const newManager = normalizeManager(data.manager);

                if (newManager.id > 0) {
                    setManagers((currentManagers) => [
                        ...currentManagers.filter(
                            (manager) =>
                                manager.id !== newManager.id
                        ),
                        newManager,
                    ]);
                } else {
                    await loadManagers();
                }
            } else {
                await loadManagers();
            }

            setAvailableBranches((currentBranches) =>
                currentBranches.filter(
                    (branch) => branch.id !== branchId
                )
            );

            const emailWasSent =
                data.email_sent === true ||
                String(data.email_status || "")
                    .trim()
                    .toLowerCase() === "sent";

            const generatedInviteLink = String(data.invite_link || "").trim();
            if (generatedInviteLink) {
                setLatestManagerInvite({
                    link: generatedInviteLink,
                    email: managerEmail,
                    emailSent: emailWasSent,
                    emailError: String(data.email_error || ""),
                });
            }

            setShowAddManagerModal(false);
            resetAddManagerForm();

            const emailWasSentForAlert =
                data.email_sent === true ||
                String(data.email_status || "")
                    .trim()
                    .toLowerCase() === "sent";

            setNotice({
                title: emailWasSentForAlert ? "Manager invitation sent" : "Invitation created",
                message: emailWasSentForAlert
                    ? "The manager activation email was sent successfully."
                    : `The invitation was created, but email delivery failed. ${data.email_error || "Copy the backup invitation link."}`,
                kind: emailWasSentForAlert ? "success" : "error",
            });
        } catch (requestError: unknown) {
            setAddManagerError(
                requestError instanceof Error
                    ? requestError.message
                    : "Unable to add this manager."
            );
        } finally {
            setAddingManager(false);
        }
    };

    const resendManagerInvite = async (manager: BranchManager) => {
        const token =
            sessionStorage.getItem("token") || localStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setResendingManagerId(manager.id);

        try {
            const response = await fetch("/api/branch-managers", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "resend_manager_invite",
                    manager_id: manager.id,
                    manager_email: manager.email,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                setNotice({ title: "Unable to resend invitation",
                    message: data.error || data.message || "Please try again.", kind: "error" });
                return;
            }

            const inviteLink = String(data.invite_link || "").trim();
            const emailWasSent =
                data.email_sent === true ||
                String(data.email_status || "").toLowerCase() === "sent";

            if (inviteLink) {
                setLatestManagerInvite({
                    link: inviteLink,
                    email: manager.email,
                    emailSent: emailWasSent,
                    emailError: String(data.email_error || ""),
                });
            }

            setNotice({
                title: emailWasSent ? "Manager invitation resent" : "Invitation link refreshed",
                message: emailWasSent
                    ? `Activation email sent to ${manager.email}.`
                    : "Email delivery failed. You can copy the backup invitation link.",
                kind: emailWasSent ? "success" : "error",
            });
        } catch (requestError) {
            setNotice({ title: "Unable to resend invitation",
                message: requestError instanceof Error ? requestError.message : "Please try again.",
                kind: "error" });
        } finally {
            setResendingManagerId(null);
        }
    };

    const updateManagerAccess = async (manager: BranchManager) => {
        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        if (!token) return router.push("/");
        const activate = manager.status === "inactive";
        setUpdatingManagerId(manager.id);
        setError("");
        try {
            const response = await fetch("/api/branch-managers", {
                method: "POST", headers: {
                    "Content-Type": "application/json", Authorization: `Bearer ${token}`,
                }, body: JSON.stringify({
                    action: activate ? "reactivate_manager" : "deactivate_manager",
                    manager_id: manager.id,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true) {
                throw new Error(data.error || "Unable to change manager access.");
            }
            setConfirmAccessChange(null);
            await loadManagers();
            setNotice({ title: activate ? "Manager access reactivated" : "Manager access deactivated",
                message: `${manager.name}'s account record has been retained.`, kind: "success" });
        } catch (error) {
            setError(error instanceof Error ? error.message : "Unable to change manager access.");
            setNotice({ title: "Unable to update access", message: error instanceof Error ? error.message : "Try again.", kind: "error" });
        } finally { setUpdatingManagerId(null); }
    };

    return (
        <RequirePermission ownerOnly>
            <div
                className="flex min-h-screen font-sans text-[#1A1220]"
                style={{ backgroundColor: "#FDFAF4" }}
            >
                <RoleSidebar />

                <main className="min-w-0 flex-1 overflow-y-auto font-sans">
                    <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                        <div className="flex min-h-[86px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
                            <div className="min-w-0">
                                <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[#1A1220]">
                                    Branch Managers
                                </h1>
                                <p className="mt-1 text-[12px] text-[#7A6A84]">
                                    Manage branch managers and their access across all branches.
                                </p>
                            </div>

                            <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime
                                    ? formatCurrentDateTime(currentDateTime)
                                    : "Loading date..."}
                            </span>

                                <button
                                    type="button"
                                    onClick={() => {
                                        void loadSubscriptionPlan();
                                        void loadManagers();
                                        void loadManagerRequests();
                                    }}
                                    disabled={loading}
                                    aria-label="Refresh branch managers"
                                    title="Refresh branch managers"
                                    className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <RefreshCw
                                        size={16}
                                        className={loading ? "animate-spin" : ""}
                                    />
                                    {loading ? "Refreshing..." : "Refresh"}
                                </button>
                            </div>
                        </div>
                    </header>

                    <section className="space-y-4 px-6 py-5">
                        <div className="grid gap-4 md:grid-cols-3">
                            <StatCard
                                title="Total Managers"
                                value={totals.total}
                                subtitle="Across all branches"
                                icon={<UsersRound size={25} strokeWidth={2} />}
                                tone="violet"
                            />
                            <StatCard
                                title="Active Managers"
                                value={totals.active}
                                subtitle="Currently active"
                                icon={<UserCheck size={25} strokeWidth={2} />}
                                tone="green"
                            />
                            <StatCard
                                title="Inactive Managers"
                                value={totals.inactive}
                                subtitle="Currently inactive"
                                icon={<UserX size={25} strokeWidth={2} />}
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
                                    value={search}
                                    onChange={(event) =>
                                        setSearch(event.target.value)
                                    }
                                    placeholder="Search manager name, email, branch, or status..."
                                    className="h-[48px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-4 pl-11 pr-11 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                />

                                {search && (
                                    <button
                                        type="button"
                                        onClick={() => setSearch("")}
                                        aria-label="Clear manager search"
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
                                                event.target.value as
                                                    | "all"
                                                    | ManagerStatus
                                            )
                                        }
                                        aria-label="Filter managers by status"
                                        className="h-[48px] min-w-[150px] appearance-none rounded-xl border border-[#E6DDF0] bg-white pl-10 pr-10 text-sm font-semibold text-[#2B174C] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                    >
                                        <option value="all">
                                            All Status
                                        </option>
                                        <option value="active">
                                            Active
                                        </option>
                                        <option value="inactive">
                                            Inactive
                                        </option>
                                        <option value="pending">
                                            Pending
                                        </option>
                                    </select>

                                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#806A8C]">
                                        ▾
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={openAddManagerModal}
                                    title="Add a manager to a branch without an assigned manager"
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
                                        Add Manager
                                    </span>
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-4 py-3 text-sm font-medium text-[#9B1C1C]">
                                {error}
                            </div>
                        )}

                        {latestManagerInvite && (
                            <section className="rounded-[18px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#3367D6]">
                                            <Mail size={18} />
                                        </span>
                                        <div>
                                            <h2 className="text-[16px] font-bold text-[#1A1220]">
                                                Latest manager invitation
                                            </h2>
                                            <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                {latestManagerInvite.emailSent
                                                    ? `Invitation email sent to ${latestManagerInvite.email}.`
                                                    : `Email could not be delivered to ${latestManagerInvite.email}. The invitation is still valid.`}
                                            </p>
                                        </div>
                                    </div>

                                    <span
                                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                                            latestManagerInvite.emailSent
                                                ? "bg-[#EDFBF1] text-[#138342]"
                                                : "bg-[#FFF4E6] text-[#9A5A00]"
                                        }`}
                                    >
                                        {latestManagerInvite.emailSent
                                            ? "Email sent"
                                            : "Email not sent"}
                                    </span>
                                </div>

                                {!latestManagerInvite.emailSent &&
                                    latestManagerInvite.emailError && (
                                        <p className="mt-3 rounded-xl border border-[#F0D9B5] bg-[#FFF9EF] px-3 py-2 text-xs text-[#8A5A11]">
                                            {latestManagerInvite.emailError}
                                        </p>
                                    )}

                                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                    <input
                                        readOnly
                                        value={latestManagerInvite.link}
                                        className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#5F4E75] outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void navigator.clipboard.writeText(
                                                latestManagerInvite.link
                                            );
                                            window.alert(
                                                "Manager invitation link copied!"
                                            );
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
                                            Manager List
                                        </h2>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                                            Managers assigned across all branches.
                                        </p>
                                    </div>
                                </div>

                                <span className="inline-flex items-center rounded-full bg-[#F5EEFF] px-3 py-1.5 text-xs font-semibold text-[#6D35D4]">
                                {listedManagers.length}{" "}
                                    {listedManagers.length === 1
                                        ? "manager"
                                        : "managers"}
                            </span>
                            </div>

                            {loading && managers.length === 0 ? (
                                <div className="p-4"><ModuleSkeleton variant="team" /></div>
                            ) : listedManagers.length === 0 ? (
                                <div className="flex min-h-[180px] flex-col items-center justify-center px-4 text-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                                    <UsersRound size={22} />
                                </span>
                                    <p className="mt-3 text-sm font-semibold text-[#1A1220]">
                                        No managers found.
                                    </p>
                                    <p className="mt-1 text-sm text-[#7A6A84]">
                                        Try another manager name, email, branch, or status.
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
                                        <table className="w-full min-w-[820px] border-collapse font-sans">
                                            <thead className="bg-[#FBF8FF]">
                                            <tr className="border-b border-[#E6DDF0]">
                                                <TableHeader>
                                                    Manager
                                                </TableHeader>
                                                <TableHeader>
                                                    Branch
                                                </TableHeader>
                                                <TableHeader>
                                                    Status
                                                </TableHeader>
                                                <TableHeader align="right">
                                                    Actions
                                                </TableHeader>
                                            </tr>
                                            </thead>

                                            <tbody>
                                            {listedManagers.map((manager) => {
                                                const isUpdating = updatingManagerId === manager.id;

                                                return (
                                                    <tr
                                                        key={manager.id}
                                                        className="border-b border-[#EEE7F2] bg-white last:border-b-0 transition hover:bg-[#FFFCF7]"
                                                    >
                                                        <td className="px-5 py-3">
                                                            <div className="min-w-0">
                                                                <p className="truncate text-sm font-bold text-[#1A1220]">
                                                                    {manager.name}
                                                                </p>
                                                                <p className="truncate text-xs text-[#7A6A84]">
                                                                    {manager.email}
                                                                </p>
                                                            </div>
                                                        </td>

                                                        <td className="px-5 py-3">
                                                            <span className="truncate text-sm font-semibold text-[#1A1220]">
                                                                {manager.branch}
                                                            </span>
                                                        </td>

                                                        <td className="px-5 py-3">
                                                            <span
                                                                className={`inline-flex rounded-full border px-4 py-1.5 text-sm font-semibold ${getStatusClass(manager.status)}`}
                                                            >
                                                                {getStatusLabel(manager.status)}
                                                            </span>
                                                        </td>

                                                        <td className="px-5 py-3 text-right">
                                                            <div className="flex justify-end gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={isUpdating}
                                                                    onClick={() => setConfirmAccessChange(manager)}
                                                                    className={`inline-flex h-[34px] items-center justify-center rounded-lg px-3 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${manager.status === "inactive"
                                                                        ? "border border-[#B7E9C8] bg-[#EDFBF1] text-[#138342] hover:bg-[#DDF5E5]"
                                                                        : "bg-[#A33E20] text-white hover:bg-[#883117]"}`}
                                                                >
                                                                    {isUpdating ? "Updating..." : manager.status === "inactive" ? "Reactivate Access" : "Deactivate Access"}
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section id="manager-requests" className="scroll-mt-28 overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6DDF0] px-5 py-3">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]"><Bell size={20}/></span>
                                    <div><h2 className="text-[18px] font-bold text-[#1A1220]">Manager Requests</h2>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">Review branch manager leave requests across all branches.</p></div>
                                    <span className="rounded-full bg-[#FFF3D8] px-2.5 py-1 text-[10px] font-bold text-[#A56607]">{pendingManagerRequests} pending</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <select aria-label="Filter manager requests by status" value={requestsStatusFilter} onChange={e => setRequestsStatusFilter(e.target.value)} className="h-9 rounded-lg border border-[#E6DDF0] bg-white px-2 text-xs text-[#2B174C]">
                                        <option value="all">All Statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
                                    </select>
                                    <select aria-label="Filter manager requests by branch" value={requestsBranchFilter} onChange={e => setRequestsBranchFilter(e.target.value)} className="h-9 max-w-40 rounded-lg border border-[#E6DDF0] bg-white px-2 text-xs text-[#2B174C]">
                                        <option value="all">All Branches</option>{managerRequestBranches.map(branch => <option key={branch} value={branch}>{branch}</option>)}
                                    </select>
                                    <select aria-label="Filter manager requests by leave type" value={requestsTypeFilter} onChange={e => setRequestsTypeFilter(e.target.value)} className="h-9 rounded-lg border border-[#E6DDF0] bg-white px-2 text-xs text-[#2B174C]">
                                        <option value="all">All Leave Types</option>{managerLeaveTypes.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                    <button type="button" onClick={exportManagerRequests} title="Export manager requests to PDF" aria-label="Export manager requests" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] text-[#6D35D4] hover:bg-[#F7F1FF]"><Download size={17}/></button>
                                </div>
                            </div>
                            {requestsError && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{requestsError}</p>}
                            <div className="max-h-[360px] overflow-auto">
                                <table className="w-full min-w-[870px] text-left text-xs">
                                    <thead className="sticky top-0 z-10 bg-[#FBF8FF] text-[10px] uppercase text-[#806A8C]"><tr>{["Manager", "Branch", "Manager ID", "Leave Type", "Date / Range", "Status", "Action"].map(label => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead>
                                    <tbody>
                                    {filteredManagerRequests.map(item => <tr className="border-t border-[#EEE7F2] hover:bg-[#FFFCF7]" key={item.key}>
                                        <td className="px-4 py-3 font-semibold text-[#2B174C]">{item.managerName}</td>
                                        <td className="px-4 py-3">{item.branchName}</td>
                                        <td className="px-4 py-3">{item.managerId}</td>
                                        <td className="px-4 py-3">{item.leaveType}</td>
                                        <td className="px-4 py-3">{managerRangeLabel(item)}</td>
                                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${item.status === "Approved" ? "bg-green-50 text-green-700" : item.status === "Rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{item.status}</span></td>
                                        <td className="px-4 py-3"><button type="button" onClick={() => { setReviewingManagerRequest(item); setReviewReason(""); setReviewError(""); }} className="rounded-lg border border-[#D7C7E8] bg-[#F7F1FF] px-3 py-1.5 font-semibold text-[#5D2DAB] hover:bg-[#ECE3F8]">Review</button></td>
                                    </tr>)}
                                    {filteredManagerRequests.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-[#8A7D92]">{requestsLoading ? "Loading manager requests..." : requestsError ? "Requests unavailable." : "No manager requests found."}</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                            <div className="border-t border-[#EEE7F2] px-4 py-2 text-right text-xs text-[#806A8C]">Showing {filteredManagerRequests.length} of {groupedManagerRequests.length} requests</div>
                        </section>

                        <section className="overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6DDF0] px-5 py-3">
                                <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FFF6DF] text-[#A56607]"><Clock3 size={20}/></span>
                                    <div><h2 className="text-[18px] font-bold text-[#1A1220]">Pending Invites</h2><p className="mt-0.5 text-xs text-[#7A6A84]">Managers waiting to activate their accounts.</p></div>
                                </div>
                                <span className="rounded-full bg-[#FFF7E8] px-3 py-1.5 text-xs font-semibold text-[#A56607]">{pendingInvites.length} pending</span>
                            </div>
                            <div className="p-4">
                                {loading && managers.length === 0 ? <div className="p-2"><ModuleSkeleton variant="team" /></div> : pendingInvites.length === 0 ?
                                    <div className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7] px-4 py-6 text-sm text-[#7A6A84]">No pending invites yet.</div> :
                                    <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs">
                                        <thead className="bg-[#FBF8FF] uppercase text-[#806A8C]"><tr>{["Manager", "Email", "Branch", "Status", "Action"].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
                                        <tbody>{pendingInvites.map(manager => <tr key={manager.id} className="border-t border-[#EEE7F2]">
                                            <td className="px-4 py-3 font-semibold text-[#2B174C]">{manager.name}</td>
                                            <td className="px-4 py-3">{manager.email}</td>
                                            <td className="px-4 py-3">{manager.branch}</td>
                                            <td className="px-4 py-3"><span className="rounded-full border border-[#F4D79A] bg-[#FFF8E8] px-3 py-1.5 font-semibold text-[#A56607]">Pending</span></td>
                                            <td className="px-4 py-3"><button type="button" onClick={() => void resendManagerInvite(manager)} disabled={resendingManagerId === manager.id} className="rounded-xl border border-[#D7C7E8] bg-white px-3 py-2 font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50">{resendingManagerId === manager.id ? "Resending..." : "Resend Invite"}</button></td>
                                        </tr>)}</tbody>
                                    </table></div>}
                            </div>
                        </section>
                    </section>

                    {reviewingManagerRequest && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !reviewSaving) setReviewingManagerRequest(null); }}>
                        <div role="dialog" aria-modal="true" aria-labelledby="manager-leave-review-title" className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[20px] border border-[#E6DDF0] bg-white shadow-2xl">
                            <div className="flex items-start justify-between border-b border-[#E6DDF0] p-5"><div><h2 id="manager-leave-review-title" className="text-lg font-bold text-[#1A1220]">Review Manager Request</h2><p className="text-xs text-[#7A6A84]">Review the request before making a decision.</p></div><button type="button" disabled={reviewSaving} onClick={() => setReviewingManagerRequest(null)} className="text-[#7A6A84]" aria-label="Close review"><X size={20}/></button></div>
                            <div className="space-y-4 overflow-y-auto p-5 text-sm">
                                <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#FBF8FE] p-4"><div><span className="text-xs text-[#7A6A84]">Manager</span><p className="font-semibold">{reviewingManagerRequest.managerName}</p></div><div><span className="text-xs text-[#7A6A84]">Branch</span><p className="font-semibold">{reviewingManagerRequest.branchName}</p></div><div><span className="text-xs text-[#7A6A84]">Leave Type</span><p className="font-semibold">{reviewingManagerRequest.leaveType}</p></div><div><span className="text-xs text-[#7A6A84]">Status</span><p className="font-semibold">{reviewingManagerRequest.status}</p></div><div className="col-span-2"><span className="text-xs text-[#7A6A84]">Date / Range</span><p className="font-semibold">{managerRangeLabel(reviewingManagerRequest)}</p></div></div>
                                <div><h3 className="text-xs font-bold text-[#5F4E75]">Manager&apos;s Reason</h3><p className="mt-1 whitespace-pre-wrap rounded-xl border border-[#E6DDF0] p-3">{reviewingManagerRequest.reason}</p></div>
                                {reviewingManagerRequest.status !== "Pending" && reviewingManagerRequest.decisionReason && <div><h3 className="text-xs font-bold">Decision Reason</h3><p className="mt-1 rounded-xl bg-[#FBF8FE] p-3">{reviewingManagerRequest.decisionReason}</p></div>}
                                {reviewingManagerRequest.status === "Pending" && <div><label htmlFor="manager-review-note" className="mb-1 block text-xs font-bold text-[#5F4E75]">Decision note (required when disapproving)</label><textarea id="manager-review-note" value={reviewReason} onChange={e => setReviewReason(e.target.value)} rows={3} maxLength={500} className="w-full rounded-xl border border-[#E6DDF0] p-3 outline-none focus:border-[#8058BA]" placeholder="Explain the decision" /></div>}
                                {reviewError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{reviewError}</p>}
                            </div>
                            <div className="flex justify-end gap-2 border-t border-[#E6DDF0] p-4"><button type="button" onClick={() => setReviewingManagerRequest(null)} disabled={reviewSaving} className="rounded-xl border border-[#E6DDF0] px-4 py-2 text-xs font-semibold">Close</button>
                                {reviewingManagerRequest.status === "Pending" && <><button type="button" disabled={reviewSaving || reviewReason.trim().length < 3} onClick={() => void reviewManagerLeave("Rejected")} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Disapprove</button><button type="button" disabled={reviewSaving} onClick={() => void reviewManagerLeave("Approved")} className="rounded-xl bg-[#2B174C] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{reviewSaving ? "Saving..." : "Approve"}</button></>}
                            </div>
                        </div>
                    </div>}

                    {confirmAccessChange && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !updatingManagerId) setConfirmAccessChange(null); }}>
                        <div role="dialog" aria-modal="true" aria-labelledby="manager-status-dialog-title" className="w-full max-w-md rounded-[20px] border border-[#E6DDF0] bg-white p-6 shadow-2xl">
                            <div className="flex items-start justify-between gap-4"><div><h2 id="manager-status-dialog-title" className="text-lg font-bold text-[#1A1220]">{confirmAccessChange.status === "inactive" ? "Reactivate Manager Access" : "Deactivate Manager Access"}</h2><p className="mt-2 text-sm leading-6 text-[#7A6A84]">{confirmAccessChange.status === "inactive" ? `Restore ${confirmAccessChange.name}'s login access?` : `Disable ${confirmAccessChange.name}'s login access?`} Their name, account, branch assignment, and employee records will remain saved.</p></div><button type="button" aria-label="Close" disabled={!!updatingManagerId} onClick={() => setConfirmAccessChange(null)}><X size={18}/></button></div>
                            <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={!!updatingManagerId} onClick={() => setConfirmAccessChange(null)} className="rounded-xl border border-[#E6DDF0] px-4 py-2 text-sm font-semibold text-[#2B174C]">Cancel</button><button type="button" disabled={!!updatingManagerId} onClick={() => void updateManagerAccess(confirmAccessChange)} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${confirmAccessChange.status === "inactive" ? "bg-[#138342]" : "bg-[#A33E20]"}`}>{updatingManagerId ? "Updating..." : confirmAccessChange.status === "inactive" ? "Reactivate Access" : "Deactivate Access"}</button></div>
                        </div>
                    </div>}

                    {notice && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[100] flex w-[min(390px,calc(100vw-32px))] items-start gap-3 rounded-[18px] border border-[#E6DDF0] bg-white p-4 shadow-xl">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${notice.kind === "success" ? "bg-[#E8F7EE] text-[#138342]" : "bg-[#FDEDED] text-[#C13333]"}`}>{notice.kind === "success" ? <CheckCircle2 size={20}/> : <UserX size={20}/>}</span>
                        <div className="flex-1"><p className="text-sm font-bold text-[#1A1220]">{notice.title}</p><p className="mt-1 text-xs text-[#7A6A84]">{notice.message}</p></div><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification" className="text-[#7A6A84]"><X size={16}/></button>
                    </div>}

                    {showPlanLimitDialog && (
                        <PlanLimitDialog
                            title="Staff account limit reached"
                            plan={subscriptionPlan}
                            currentCount={managers.length}
                            limit={getManagerLimit(subscriptionPlan)}
                            onClose={() => setShowPlanLimitDialog(false)}
                            onViewPlans={() => router.push("/subscription")}
                        />
                    )}

                    {showAddManagerModal && (
                        <div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
                            onMouseDown={closeAddManagerModal}
                        >
                            <div
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="add-manager-dialog-title"
                                className="max-h-[78vh] w-full max-w-[1120px] overflow-y-auto rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl"
                                onMouseDown={(event) =>
                                    event.stopPropagation()
                                }
                            >
                                <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E6DDF0] bg-white px-6 py-5">
                                    <div>
                                        <h2
                                            id="add-manager-dialog-title"
                                            className="text-[22px] font-bold tracking-[-0.02em] text-[#1A1220]"
                                        >
                                            Add Manager
                                        </h2>
                                        <p className="mt-1 text-sm text-[#7A6A84]">
                                            Assign a manager to an existing branch
                                            that currently has no manager.
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={closeAddManagerModal}
                                        disabled={addingManager}
                                        aria-label="Close Add Manager dialog"
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="space-y-5 px-6 py-5">
                                    {addManagerError && (
                                        <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-4 py-3 text-sm font-medium text-[#9B1C1C]">
                                            {addManagerError}
                                        </div>
                                    )}

                                    <div className="rounded-2xl border border-[#E8DFF0] bg-[#FFFEFC] p-5">
                                        <div className="mb-4 flex items-center gap-3">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F1E9FF] text-[#6D35D4]">
                                            <Building2
                                                size={20}
                                                strokeWidth={2}
                                            />
                                        </span>

                                            <div>
                                                <h3 className="font-bold text-[#1A1220]">
                                                    Branch assignment
                                                </h3>
                                                <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                    Only branches without an
                                                    assigned manager are shown.
                                                </p>
                                            </div>
                                        </div>

                                        <label
                                            htmlFor="add-manager-branch"
                                            className="mb-2 block text-sm font-semibold text-[#1A1220]"
                                        >
                                            Branch
                                        </label>

                                        <div className="relative">
                                            <select
                                                id="add-manager-branch"
                                                value={selectedBranchId}
                                                disabled={
                                                    loadingBranches ||
                                                    addingManager ||
                                                    availableBranches.length === 0
                                                }
                                                onChange={(event) =>
                                                    setSelectedBranchId(
                                                        event.target.value
                                                    )
                                                }
                                                className="h-[46px] w-full appearance-none rounded-xl border border-[#E6DDF0] bg-white px-3 pr-10 text-sm text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:cursor-not-allowed disabled:bg-[#F7F4F8] disabled:text-[#9B8AAA]"
                                            >
                                                <option value="">
                                                    {loadingBranches
                                                        ? "Loading available branches..."
                                                        : availableBranches.length ===
                                                        0
                                                            ? "No branches without a manager"
                                                            : "Select a branch"}
                                                </option>

                                                {availableBranches.map(
                                                    (branch) => (
                                                        <option
                                                            key={branch.id}
                                                            value={branch.id}
                                                        >
                                                            {branch.branchName} —{" "}
                                                            {branch.status ===
                                                            "inactive"
                                                                ? "Inactive"
                                                                : "Active"}
                                                        </option>
                                                    )
                                                )}
                                            </select>

                                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#806A8C]">
                                            ▾
                                        </span>
                                        </div>

                                        {!loadingBranches &&
                                            availableBranches.length === 0 && (
                                                <p className="mt-3 rounded-xl border border-[#E6D9BA] bg-[#FFFBF0] px-4 py-3 text-xs leading-5 text-[#6F6043]">
                                                    Every branch already has a
                                                    manager. Create another branch
                                                    without a manager before adding
                                                    a new manager here.
                                                </p>
                                            )}
                                    </div>

                                    <div className="rounded-2xl border border-[#E8DFF0] bg-white p-5">
                                        <div className="mb-4 flex items-center gap-3">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF4FF] text-[#3367D6]">
                                            <UserPlus
                                                size={20}
                                                strokeWidth={2}
                                            />
                                        </span>

                                            <div>
                                                <h3 className="font-bold text-[#1A1220]">
                                                    Manager details
                                                </h3>
                                                <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                    Enter the manager who will
                                                    receive the account activation
                                                    invitation.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <ManagerDialogInput
                                                label="Manager name"
                                                value={newManagerName}
                                                onChange={setNewManagerName}
                                                placeholder="e.g. Ana Cruz"
                                                disabled={addingManager}
                                            />

                                            <ManagerDialogInput
                                                label="Manager email"
                                                value={newManagerEmail}
                                                onChange={setNewManagerEmail}
                                                placeholder="manager@email.com"
                                                type="email"
                                                disabled={addingManager}
                                            />
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[#E8DFF0] bg-white p-5">
                                        <div className="mb-4 flex items-center gap-3">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF8EF] text-[#188348]">
                                            <ShieldCheck
                                                size={20}
                                                strokeWidth={2}
                                            />
                                        </span>

                                            <div>
                                                <h3 className="font-bold text-[#1A1220]">
                                                    Manager permissions
                                                </h3>
                                                <p className="mt-0.5 text-xs text-[#7A6A84]">
                                                    Managers automatically get
                                                    full access to all modules.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-start gap-2 rounded-xl border border-[#E8DFF0] bg-[#FBF8FF] px-4 py-3 text-xs leading-5 text-[#5B4A73]">
                                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#188348]" />
                                            <span>
                                            Managers get full access to every
                                            module for this branch —
                                            Dashboard, Bookings, Packages,
                                            Manage Packages, Inventory,
                                            Sales/POS, Reports, Staff
                                            Management, and Branch Settings.
                                        </span>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-[#E6D9BA] bg-[#FFFBF0] px-4 py-3 text-xs leading-5 text-[#6F6043]">
                                        The selected manager will be saved as
                                        Pending, and an account activation email
                                        will be sent automatically. The invitation
                                        expires after 7 days.
                                    </div>
                                </div>

                                <div className="sticky bottom-0 flex gap-3 border-t border-[#E6DDF0] bg-white px-6 py-4">
                                    <button
                                        type="button"
                                        onClick={closeAddManagerModal}
                                        disabled={addingManager}
                                        className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-5 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            void handleAddManager()
                                        }
                                        disabled={
                                            addingManager ||
                                            loadingBranches ||
                                            availableBranches.length === 0
                                        }
                                        className="flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                        style={{
                                            backgroundColor: "#2B174C",
                                            border: "1px solid #2B174C",
                                            boxShadow:
                                                "0 4px 10px rgba(43, 23, 76, 0.18)",
                                        }}
                                    >
                                        <UserPlus size={17} />
                                        {addingManager
                                            ? "Sending invitation..."
                                            : "Add manager"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </RequirePermission>
    );
}

function ManagerDialogInput({
                                label,
                                value,
                                onChange,
                                placeholder = "",
                                type = "text",
                                disabled = false,
                            }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: "text" | "email";
    disabled?: boolean;
}) {
    return (
        <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#1A1220]">
                {label}
            </span>

            <input
                type={type}
                value={value}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(event) =>
                    onChange(event.target.value)
                }
                className="h-[46px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#A796B1] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:cursor-not-allowed disabled:bg-[#F7F4F8]"
            />
        </label>
    );
}

type StatTone = "violet" | "green" | "red";

const statToneStyles: Record<
    StatTone,
    {
        iconBackground: string;
        iconColor: string;
        borderColor: string;
    }
> = {
    violet: {
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
};

function StatCard({
                      title,
                      value,
                      subtitle,
                      icon,
                      tone,
                  }: {
    title: string;
    value: number;
    subtitle: string;
    icon: ReactNode;
    tone: StatTone;
}) {
    const style = statToneStyles[tone];

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

function PlanLimitDialog({
                             title,
                             plan,
                             currentCount,
                             limit,
                             onClose,
                             onViewPlans,
                         }: {
    title: string;
    plan: SubscriptionPlan;
    currentCount: number;
    limit: number;
    onClose: () => void;
    onViewPlans: () => void;
}) {
    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#120A1F]/45 px-4 backdrop-blur-[2px]">
            <div className="w-full max-w-[620px] rounded-[16px] border border-[#E6DDF0] bg-[#FFFCF7] p-8 text-center shadow-[0_24px_60px_rgba(20,10,35,0.22)] sm:p-10">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F1E9FA] text-[#5E32A7]">
                    <LockKeyhole size={28} strokeWidth={1.9} />
                </div>

                <div className="mt-5">
                    <span className="inline-flex items-center rounded-full border border-[#E9DDB8] bg-[#FFF7DF] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8B6B1B]">
                        {planLabel} plan
                    </span>

                    <h2 className="mt-4 text-[24px] font-bold tracking-[-0.02em] text-[#1A1220]">
                        {title}
                    </h2>

                    <p className="mx-auto mt-3 max-w-[500px] text-sm leading-6 text-[#7A6A84]">
                        Your current <span className="font-semibold text-[#4A315E]">{planLabel}</span> plan allows up to{" "}
                        <span className="font-semibold text-[#4A315E]">{Number.isFinite(limit) ? limit : "unlimited"}</span>{" "}
                        {Number.isFinite(limit) ? "staff account" : "staff accounts"}. You are currently using{" "}
                        <span className="font-semibold text-[#4A315E]">{currentCount}</span>.
                    </p>

                    <div className="mx-auto mt-6 max-w-[500px] rounded-xl border border-[#E9E0EF] bg-[#FDFAF4] px-5 py-4 text-left">
                        <p className="text-sm font-semibold text-[#2B174C]">Want to add more?</p>
                        <p className="mt-1 text-xs leading-5 text-[#7A6A84]">
                            Upgrade your store plan to increase your staff account limit.
                        </p>
                    </div>

                    <div className="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
                        <button
                            type="button"
                            onClick={onViewPlans}
                            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            View plans
                            <ArrowUpRight size={15} />
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex h-[42px] items-center justify-center rounded-xl border border-[#E6DDF0] bg-white px-5 text-sm font-semibold text-[#2B174C] shadow-sm transition hover:bg-[#FBF8FF]"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}