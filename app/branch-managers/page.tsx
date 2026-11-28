"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import RequirePermission from "@/components/permissions/RequirePermission";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useRouter } from "next/navigation";
import {
    Clock3,
    Download,
    CheckCircle2,
    Filter,
    Mail,
    Plus,
    RefreshCw,
    Search,
    UserCheck,
    UsersRound,
    UserX,
    X,
    XCircle,
} from "lucide-react";

type ManagerStatus = "active" | "inactive" | "pending";

type BranchManager = {
    id: number;
    employeeCode: string;
    name: string;
    email: string;
    phone: string;
    branch: string;
    branchId: number;
    status: ManagerStatus;
};

type BranchOption = {
    id: number;
    name: string;
    managerEmail: string;
    active: boolean;
};

type ManagerActionResult = {
    ok: boolean;
    status: number;
    data: Record<string, unknown>;
};

function formatPersonalMobile(value: string): string {
    const raw = String(value ?? "").trim();
    const digits = raw.replace(/\D/g, "");
    const local = digits.startsWith("63") ? `0${digits.slice(2)}` : digits.length === 10 && digits.startsWith("9") ? `0${digits}` : digits;
    if (!/^09\d{9}$/.test(local)) return raw;
    return [local.slice(0, 4), local.slice(4, 7), local.slice(7, 11)].filter(Boolean).join(" ");
}

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
        employeeCode:
            asText(manager.employee_code) ||
            asText(manager.employeeCode),
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
        phone:
            asText(manager.phone) ||
            asText(manager.manager_phone),
        branch:
            asText(manager.branch) ||
            asText(manager.branch_name) ||
            asText(manager.branchName) ||
            "No branch assigned",
        branchId: asNumber(manager.branch_id ?? manager.branchId),
        status: normalizeStatus(
            manager.status ??
            manager.manager_status ??
            manager.account_status ??
            manager.accountStatus
        ),
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
        return "text-[#138342]";
    }

    if (status === "inactive") {
        return "text-[#C13333]";
    }

    return "text-[#A56607]";
}

export default function BranchManagersPage() {
    const router = useRouter();

    const [managers, setManagers] = useState<BranchManager[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingManagerId, setUpdatingManagerId] = useState<number | null>(null);
    const [confirmAccessChange, setConfirmAccessChange] = useState<BranchManager | null>(null);

    const [notice, setNotice] = useState<{ title: string; message: string; kind: "success" | "error" | "warning" } | null>(null);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<
        "all" | ManagerStatus
    >("all");
    const [error, setError] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const [resendingManagerId, setResendingManagerId] =
        useState<number | null>(null);

    // Owner manager invitations and branch assignment.
    const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [branchOptionsError, setBranchOptionsError] = useState("");
    const [showAddManager, setShowAddManager] = useState(false);
    const [addName, setAddName] = useState("");
    const [addEmail, setAddEmail] = useState("");
    const [addBranchId, setAddBranchId] = useState(0);
    const [addError, setAddError] = useState("");
    const [addingManager, setAddingManager] = useState(false);
    const addInFlight = useRef(false);
    const availableBranches = branchOptions.filter(branch =>
        branch.active && !branch.managerEmail && !managers.some(manager => manager.branchId === branch.id)
    );
    const [confirmCancelInvite, setConfirmCancelInvite] = useState<BranchManager | null>(null);
    const [cancellingManagerId, setCancellingManagerId] = useState<number | null>(null);

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
                `${manager.employeeCode} ${manager.name} ${manager.email} ${manager.phone} ${formatPersonalMobile(manager.phone)} ${manager.branch} ${getStatusLabel(
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
    const pendingInvites = managers.filter(manager => manager.status === "pending");
    const exportManagerList = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                    title: "Branch Manager List",
                    headers: ["Employee ID", "Manager", "Email", "Phone Number", "Branch", "Status"],
                    rows: listedManagers.map(manager => [manager.employeeCode || "—", manager.name,
                        manager.email, formatPersonalMobile(manager.phone) || "—", manager.branch, getStatusLabel(manager.status)]),
                }, { storeName: sessionStorage.getItem("store_name") || "StockNBook",
                    branch: "All branches", dateRange: statusFilter === "all" ? "All statuses" : getStatusLabel(statusFilter as ManagerStatus) },
                "owner_branch_managers"))
            .catch(() => setNotice({ title: "Export unavailable", message: "Could not export the manager list.", kind: "error" }));
    };

    const exportManagerInvites = () => {
        void import("@/components/dashboard/_shared")
            .then(module => module.exportTableAsPdf({
                title: "Pending Manager Invitations",
                headers: ["Manager", "Email", "Branch", "Status"],
                rows: pendingInvites.map(manager => [manager.name, manager.email, manager.branch, "Pending"]),
            }, { storeName: sessionStorage.getItem("store_name") || "StockNBook",
                branch: "All branches", dateRange: "Pending invitations" }, "owner_manager_invites"))
            .catch(() => setNotice({ title: "Export unavailable", message: "Could not export pending manager invitations.", kind: "error" }));
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

            const emailWasSent =
                data.email_sent === true ||
                String(data.email_status || "").toLowerCase() === "sent";

            setNotice({
                title: emailWasSent ? "Manager invitation resent" : "Invitation email not sent",
                message: emailWasSent
                    ? `Activation email sent to ${manager.email}.`
                    : "Email delivery failed. Please use Resend Invite in Pending Invites to try again.",
                kind: emailWasSent ? "success" : "warning",
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

    const postManagerAction = async (
        action: string,
        payload: Record<string, unknown>,
    ): Promise<ManagerActionResult> => {
        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        if (!token) {
            router.push("/");
            return { ok: false, status: 401, data: { error: "Please sign in again." } };
        }
        const response = await fetch("/api/branch-managers", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action, ...payload }),
        });
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        return { ok: response.ok, status: response.status, data };
    };

    const resultMessage = (data: Record<string, unknown>, fallback: string) =>
        asText(data.error) || asText(data.message) || fallback;

    const loadBranchOptions = async () => {
        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        setBranchesLoading(true);
        setBranchOptions([]);
        setBranchOptionsError("");
        try {
            if (!token) throw new Error("Please sign in again.");
            const response = await fetch("/api/branches", {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !Array.isArray(data.branches)) {
                throw new Error(asText(data.error) || "Unable to load branches.");
            }
            const records: unknown[] = data.branches;
            setBranchOptions(records.map((item) => {
                const branch = item && typeof item === "object" ? (item as RawManager) : {};
                return {
                    id: asNumber(branch.id),
                    name: asText(branch.branch_name) || "Unnamed branch",
                    managerEmail: asText(branch.manager_email).toLowerCase(),
                    active: asText(branch.branch_status ?? branch.status).toLowerCase() === "active",
                };
            }).filter((branch) => branch.id > 0));
        } catch (error) {
            setBranchOptions([]);
            setBranchOptionsError(error instanceof Error ? error.message : "Unable to load branches.");
        } finally {
            setBranchesLoading(false);
        }
    };

    const openAddManager = () => {
        setAddName("");
        setAddEmail("");
        setAddBranchId(0);
        setAddError("");
        setShowAddManager(true);
        void loadBranchOptions();
    };

    const closeAddManager = () => {
        if (!addInFlight.current) setShowAddManager(false);
    };

    const addManager = async () => {
        if (addInFlight.current) return;
        const name = addName.trim();
        const email = addEmail.trim().toLowerCase();
        if (name.length < 2 || name.length > 120) {
            setAddError("Enter a valid manager name.");
            return;
        }
        if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setAddError("Enter a valid manager email address.");
            return;
        }
        if (branchesLoading || !availableBranches.some(branch => branch.id === addBranchId)) {
            setAddError("Select an available active branch.");
            return;
        }
        addInFlight.current = true;
        setAddingManager(true);
        setAddError("");
        try {
            const result = await postManagerAction("add_manager_to_branch", {
                branch_id: addBranchId,
                manager_name: name,
                manager_email: email,
            });
            if (!result.ok) {
                setAddError(resultMessage(result.data, "Unable to add the manager."));
                setAddBranchId(0);
                await loadBranchOptions();
                return;
            }
            setShowAddManager(false);
            await loadManagers();
            const emailWasSent = result.data.email_sent === true ||
                asText(result.data.email_status).toLowerCase() === "sent";
            setNotice({
                title: emailWasSent ? "Manager added successfully" : "Manager added — email not sent",
                message: emailWasSent
                    ? `Invitation email sent to ${email}.`
                    : "The manager invitation is saved. Use Resend Invite in Pending Invites to try sending the email again.",
                kind: emailWasSent ? "success" : "warning",
            });
        } catch (error) {
            setAddError(error instanceof Error ? error.message : "Unable to add the manager.");
        } finally {
            addInFlight.current = false;
            setAddingManager(false);
        }
    };

    const cancelManagerInvite = async (manager: BranchManager) => {
        setCancellingManagerId(manager.id);
        try {
            const result = await postManagerAction("cancel_manager_invite", { manager_id: manager.id });
            if (!result.ok) {
                setNotice({ title: "Unable to cancel invitation", message: resultMessage(result.data, "Please try again."), kind: "error" });
                return;
            }
            setConfirmCancelInvite(null);
            await loadManagers();
            setNotice({ title: "Invitation cancelled", message: resultMessage(result.data, "The invitation link can no longer be used."), kind: "success" });
        } catch (error) {
            setNotice({ title: "Unable to cancel invitation", message: error instanceof Error ? error.message : "Please try again.", kind: "error" });
        } finally {
            setCancellingManagerId(null);
        }
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
                                        void loadManagers();
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
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                            <StatCard
                                title="Pending Invitations"
                                value={pendingInvites.length}
                                subtitle="Awaiting account activation"
                                icon={<Clock3 size={25} strokeWidth={2} />}
                                tone="amber"
                            />
                        </div>

                        {error && (
                            <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-4 py-3 text-sm font-medium text-[#9B1C1C]">
                                {error}
                            </div>
                        )}

                        <section className="overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                            <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]">
                                        <UsersRound size={21} strokeWidth={2} />
                                    </span>
                                    <div className="min-w-0">
                                        <h2 className="text-[18px] font-bold tracking-[-0.015em] text-[#1A1220]">Manager List</h2>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">Managers assigned across all branches.</p>
                                    </div>
                                </div>
                                <div className="flex w-full min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center xl:w-auto xl:flex-1 xl:justify-end">
                                    <div className="relative min-w-0 flex-1 xl:max-w-[520px]">
                                        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]" />
                                        <input
                                            value={search}
                                            onChange={(event) => setSearch(event.target.value)}
                                            placeholder="Search name, email, phone, branch, or status..."
                                            aria-label="Search managers"
                                            className="h-[48px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-4 pl-11 pr-11 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                        />
                                        {search && (
                                            <button type="button" onClick={() => setSearch("")} aria-label="Clear manager search"
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
                                                onChange={(event) => setStatusFilter(event.target.value as "all" | ManagerStatus)}
                                                aria-label="Filter managers by status"
                                                className="h-[48px] min-w-[150px] appearance-none rounded-xl border border-[#E6DDF0] bg-white pl-10 pr-10 text-sm font-semibold text-[#2B174C] outline-none shadow-sm transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                            >
                                                <option value="all">All Status</option>
                                                <option value="active">Active</option>
                                                <option value="inactive">Inactive</option>
                                                <option value="pending">Pending</option>
                                            </select>
                                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#806A8C]">▾</span>
                                        </div>
                                        <button type="button" onClick={exportManagerList} title="Download manager list as PDF" aria-label="Download manager list as PDF"
                                                className="inline-flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] bg-white text-[#6D35D4] shadow-sm transition hover:bg-[#F7F1FF]">
                                            <Download size={17} />
                                        </button>
                                        <button type="button" onClick={openAddManager} title="Add a branch manager"
                                                className="inline-flex h-[48px] min-w-[140px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]">
                                            <Plus size={18} strokeWidth={2.2} />
                                            Add Manager
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {loading && managers.length === 0 ? (
                                <div className="p-4"><ModuleSkeleton variant="team" /></div>
                            ) : listedManagers.length === 0 ? (
                                <div className="flex min-h-[136px] flex-col items-center justify-center px-4 text-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F1EBFF] text-[#6D35D4]">
                                    <UsersRound size={22} />
                                </span>
                                    <p className="mt-3 text-sm font-semibold text-[#1A1220]">
                                        No managers found.
                                    </p>
                                    <p className="mt-1 text-sm text-[#7A6A84]">
                                        Try another manager name, email, phone, branch, or status.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <div
                                        className="max-h-[360px] overflow-y-auto overflow-x-auto overscroll-contain"
                                        role="region" aria-label="Manager list" tabIndex={0}
                                    >
                                        <table className="w-full min-w-[850px] table-fixed border-collapse font-sans text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th:not(:first-child)]:text-center [&_td:not(:first-child)]:text-center [&_th:first-child]:text-left [&_td:first-child]:text-left [&_td]:[overflow-wrap:anywhere]">
                                            <colgroup><col className="w-[15%]" /><col className="w-[25%]" /><col className="w-[15%]" /><col className="w-[17%]" /><col className="w-[10%]" /><col className="w-[18%]" /></colgroup>
                                            <thead className="sticky top-0 z-10 bg-[#FFFCF8]">
                                            <tr className="border-b border-[#E6DDF0]">
                                                <TableHeader align="left">
                                                    Employee ID
                                                </TableHeader>
                                                <TableHeader>
                                                    Manager
                                                </TableHeader>
                                                <TableHeader>
                                                    Phone Number
                                                </TableHeader>
                                                <TableHeader>
                                                    Branch
                                                </TableHeader>
                                                <TableHeader>
                                                    Status
                                                </TableHeader>
                                                <TableHeader align="center">
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
                                                        className="bg-white transition hover:bg-[#FFFCF7]"
                                                    >
                                                        <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-[#4E2C66]">
                                                            {manager.employeeCode || "—"}
                                                        </td>

                                                        <td className="px-3 py-2.5">
                                                            <div className="min-w-0">
                                                                <p className="truncate text-sm font-bold text-[#1A1220]">
                                                                    {manager.name}
                                                                </p>
                                                                <p className="truncate text-xs text-[#7A6A84]">
                                                                    {manager.email}
                                                                </p>
                                                            </div>
                                                        </td>

                                                        <td className="whitespace-nowrap px-3 py-2.5 text-sm text-[#1A1220]">
                                                            {formatPersonalMobile(manager.phone) || "—"}
                                                        </td>

                                                        <td className="px-3 py-2.5">
                                                            <span className="truncate text-sm font-semibold text-[#1A1220]">
                                                                {manager.branch}
                                                            </span>
                                                        </td>

                                                        <td className="px-3 py-2.5">
                                                            <span
                                                                className={`inline-flex text-xs font-semibold ${getStatusClass(manager.status)}`}
                                                            >
                                                                {getStatusLabel(manager.status)}
                                                            </span>
                                                        </td>

                                                        <td className="px-3 py-2.5 text-center">
                                                            <div className="flex flex-wrap items-center justify-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    disabled={isUpdating}
                                                                    onClick={() => setConfirmAccessChange(manager)}
                                                                    className={`inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${manager.status === "inactive"
                                                                        ? "bg-[#E8F7EE] text-[#138342] hover:bg-[#DDF5E5]"
                                                                        : "bg-[#FDEDED] text-[#C13333] hover:bg-[#FADDDD]"}`}
                                                                >
                                                                    {manager.status === "inactive" ? <CheckCircle2 size={13} /> : <UserX size={13} />}
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

                        <section aria-label="Pending manager invitations" className="overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF6DF] text-[#A56607]"><Clock3 size={20} /></span>
                                    <div className="min-w-0">
                                        <h2 className="text-[16px] font-bold text-[#1A1220]">Pending Invites</h2>
                                        <p className="text-xs text-[#7A6A84]">Managers awaiting account activation</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5">
                                    <span className="text-xs font-semibold text-[#A56607]">{pendingInvites.length} pending</span>
                                    {pendingInvites.length > 0 && (
                                        <button type="button" onClick={exportManagerInvites} title="Download pending manager invites as PDF" aria-label="Download pending manager invites as PDF"
                                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#6D35D4] transition hover:bg-[#F7F1FF]"><Download size={17} /></button>
                                    )}
                                </div>
                            </div>
                            {pendingInvites.length > 0 && (
                                <div className="border-t border-[#E6DDF0] px-4 py-3">
                                    <div className="max-h-[320px] overflow-auto">
                                        <table className="w-full min-w-0 table-fixed border-collapse font-sans text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th:not(:first-child)]:text-center [&_td:not(:first-child)]:text-center [&_th:first-child]:text-left [&_td:first-child]:text-left [&_td]:[overflow-wrap:anywhere]">
                                            <thead className="bg-[#FFFCF8] uppercase text-[#806A8C]"><tr>{["Manager", "Email", "Branch", "Status", "Action"].map(label => <th key={label} className="px-2.5 py-2.5">{label}</th>)}</tr></thead>
                                            <tbody>{pendingInvites.map(manager => <tr key={manager.id} className="border-t border-[#EEE7F2]">
                                                <td className="px-2.5 py-2.5 font-semibold text-[#2B174C]">{manager.name}</td>
                                                <td className="px-2.5 py-2.5">{manager.email}</td>
                                                <td className="px-2.5 py-2.5">{manager.branch}</td>
                                                <td className="px-2.5 py-2.5"><span className="font-semibold text-[#A56607]">Pending</span></td>
                                                <td className="px-2.5 py-2.5"><div className="flex flex-wrap items-center justify-center gap-1.5"><button type="button" onClick={() => void resendManagerInvite(manager)} disabled={resendingManagerId === manager.id || cancellingManagerId === manager.id} className="rounded-lg bg-[#F1EBFF] px-3 py-1.5 font-semibold text-[#6D35D4] hover:bg-[#E6DCFF] disabled:opacity-50">{resendingManagerId === manager.id ? "Resending..." : "Resend Invite"}</button><button type="button" onClick={() => setConfirmCancelInvite(manager)} disabled={resendingManagerId === manager.id || cancellingManagerId === manager.id} className="rounded-lg bg-[#FDEDED] px-3 py-1.5 font-semibold text-[#C13333] hover:bg-[#FADDDD] disabled:opacity-50">Cancel</button></div></td>
                                            </tr>)}</tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </section>

                    </section>

                    {confirmAccessChange && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !updatingManagerId) setConfirmAccessChange(null); }}>
                        <div role="dialog" aria-modal="true" aria-labelledby="manager-status-dialog-title" className="w-full max-w-md rounded-[20px] border border-[#E6DDF0] bg-white p-6 shadow-2xl">
                            <div className="flex items-start justify-between gap-4"><div><h2 id="manager-status-dialog-title" className="text-lg font-bold text-[#1A1220]">{confirmAccessChange.status === "inactive" ? "Reactivate Manager Access" : "Deactivate Manager Access"}</h2><p className="mt-2 text-sm leading-6 text-[#7A6A84]">{confirmAccessChange.status === "inactive" ? `Restore ${confirmAccessChange.name}'s login access?` : `Disable ${confirmAccessChange.name}'s login access?`} Their name, account, branch assignment, and employee records will remain saved.</p></div><button type="button" aria-label="Close" disabled={!!updatingManagerId} onClick={() => setConfirmAccessChange(null)}><X size={18}/></button></div>
                            <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={!!updatingManagerId} onClick={() => setConfirmAccessChange(null)} className="rounded-xl border border-[#E6DDF0] px-4 py-2 text-sm font-semibold text-[#2B174C]">Cancel</button><button type="button" disabled={!!updatingManagerId} onClick={() => void updateManagerAccess(confirmAccessChange)} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${confirmAccessChange.status === "inactive" ? "bg-[#138342]" : "bg-[#A33E20]"}`}>{updatingManagerId ? "Updating..." : confirmAccessChange.status === "inactive" ? "Reactivate Access" : "Deactivate Access"}</button></div>
                        </div>
                    </div>}

                    {showAddManager && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget) closeAddManager(); }}>
                        <form role="dialog" aria-modal="true" aria-labelledby="add-manager-title"
                              onSubmit={e => { e.preventDefault(); void addManager(); }}
                              className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[20px] border border-[#E6DDF0] bg-white p-6 shadow-2xl">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EBFF] text-[#6D35D4]"><UsersRound size={21} /></span>
                                    <div>
                                        <h2 id="add-manager-title" className="text-lg font-bold text-[#1A1220]">Add Manager</h2>
                                        <p className="mt-1 text-sm text-[#7A6A84]">Invite a manager and assign them to a branch.</p>
                                    </div>
                                </div>
                                <button type="button" aria-label="Close Add Manager dialog" disabled={addingManager} onClick={closeAddManager}><X size={18} /></button>
                            </div>

                            <div className="mt-5 space-y-4">
                                <div>
                                    <label htmlFor="add-manager-name" className="mb-1.5 block text-sm font-medium text-[#1A1220]">Full name</label>
                                    <input id="add-manager-name" autoComplete="name" required maxLength={120} value={addName} onChange={e => setAddName(e.target.value)} disabled={addingManager} placeholder="Ana Cruz" className="h-[44px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-3.5 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:opacity-60" />
                                </div>
                                <div>
                                    <label htmlFor="add-manager-email" className="mb-1.5 block text-sm font-medium text-[#1A1220]">Email address</label>
                                    <input id="add-manager-email" type="email" autoComplete="email" required maxLength={255} value={addEmail} onChange={e => setAddEmail(e.target.value)} disabled={addingManager} placeholder="manager@email.com" className="h-[44px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-3.5 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:opacity-60" />
                                </div>
                                <div>
                                    <label htmlFor="add-manager-branch" className="mb-1.5 block text-sm font-medium text-[#1A1220]">Assigned branch</label>
                                    <select id="add-manager-branch" required value={addBranchId || ""} onChange={e => setAddBranchId(Number(e.target.value))} disabled={addingManager || branchesLoading || !!branchOptionsError || !availableBranches.length} className="h-[44px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFEFC] px-3.5 text-sm text-[#1A1220] outline-none shadow-sm focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:opacity-60">
                                        <option value="">{branchesLoading ? "Loading branches..." : "Select a branch"}</option>
                                        {availableBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                                    </select>
                                    {branchOptionsError ? (
                                        <p role="alert" className="mt-1 text-xs text-[#C13333]">{branchOptionsError} <button type="button" className="font-semibold underline" onClick={() => void loadBranchOptions()} disabled={addingManager}>Retry</button></p>
                                    ) : !branchesLoading && !availableBranches.length ? (
                                        <p className="mt-1 text-xs text-[#A56607]">No active branches without an assigned manager are available. Create a branch in Branches or cancel a pending invitation if appropriate.</p>
                                    ) : <p className="mt-1 text-xs text-[#7A6A84]">Only active branches without an assigned or pending manager are available.</p>}
                                </div>
                                <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFCF8] p-3.5 text-xs leading-5 text-[#5F4E75]">
                                    <p className="font-semibold text-[#2B174C]">Manager access</p>
                                    <p>Managers automatically receive the Manager role permissions for their assigned branch, subject to your subscription plan. An invitation email will be sent so the manager can activate their account.</p>
                                </div>
                                {addError && <p role="alert" className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2 text-xs font-medium text-[#9B1C1C]">{addError}</p>}
                                <div className="flex gap-3 border-t border-[#E6DDF0] pt-4">
                                    <button type="button" disabled={addingManager} onClick={closeAddManager} className="flex-1 rounded-xl border border-[#E6DDF0] px-4 py-2.5 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50">Cancel</button>
                                    <button type="submit" disabled={addingManager || branchesLoading || !!branchOptionsError || !addName.trim() || !addEmail.trim() || !availableBranches.some(branch => branch.id === addBranchId)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-50"><Plus size={16} />{addingManager ? "Adding..." : "Add Manager"}</button>
                                </div>
                            </div>
                        </form>
                    </div>}

                    {confirmCancelInvite && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !cancellingManagerId) setConfirmCancelInvite(null); }}>
                        <div role="dialog" aria-modal="true" aria-labelledby="cancel-invite-dialog-title" className="w-full max-w-md rounded-[20px] border border-[#E6DDF0] bg-white p-6 shadow-2xl">
                            <div className="flex items-start justify-between gap-4"><div><h2 id="cancel-invite-dialog-title" className="text-lg font-bold text-[#1A1220]">Cancel Manager Invitation</h2><p className="mt-2 text-sm leading-6 text-[#7A6A84]">Cancel the pending invitation for {confirmCancelInvite.name} ({confirmCancelInvite.email})? The invitation link will stop working and {confirmCancelInvite.branch} can be assigned a new manager.</p></div><button type="button" aria-label="Close" disabled={!!cancellingManagerId} onClick={() => setConfirmCancelInvite(null)}><X size={18}/></button></div>
                            <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={!!cancellingManagerId} onClick={() => setConfirmCancelInvite(null)} className="rounded-xl border border-[#E6DDF0] px-4 py-2 text-sm font-semibold text-[#2B174C]">Keep Invitation</button><button type="button" disabled={!!cancellingManagerId} onClick={() => void cancelManagerInvite(confirmCancelInvite)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#A33E20] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><XCircle size={15}/>{cancellingManagerId ? "Cancelling..." : "Cancel Invitation"}</button></div>
                        </div>
                    </div>}

                    {notice && <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[100] flex w-[min(390px,calc(100vw-32px))] items-start gap-3 rounded-[18px] border border-[#E6DDF0] bg-white p-4 shadow-xl">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${notice.kind === "success" ? "bg-[#E8F7EE] text-[#138342]" : notice.kind === "warning" ? "bg-[#FFF6DF] text-[#A56607]" : "bg-[#FDEDED] text-[#C13333]"}`}>{notice.kind === "success" ? <CheckCircle2 size={20}/> : notice.kind === "warning" ? <Mail size={20}/> : <UserX size={20}/>}</span>
                        <div className="flex-1"><p className="text-sm font-bold text-[#1A1220]">{notice.title}</p><p className="mt-1 text-xs text-[#7A6A84]">{notice.message}</p></div><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification" className="text-[#7A6A84]"><X size={16}/></button>
                    </div>}

                </main>
            </div>
        </RequirePermission>
    );
}

type StatTone = "violet" | "green" | "red" | "amber";

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
    amber: {
        iconBackground: "bg-[#FFF6DF]",
        iconColor: "text-[#A56607]",
        borderColor: "#F3E3C2",
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
            className="flex min-h-[132px] items-center gap-3 rounded-[18px] bg-white px-4 py-4"
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