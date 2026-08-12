"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
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
} from "lucide-react";

type ManagerStatus = "active" | "inactive" | "pending";

type BranchManager = {
    id: number;
    name: string;
    email: string;
    branch: string;
    status: ManagerStatus;
};

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

const defaultManagerPermissions: ManagerPermissions = {
    dashboard: true,
    bookings: true,
    packages: true,
    packages_manage: false,
    inventory: true,
    pos: true,
    reports: false,
    staff_management: false,
    branch_settings: false,
};

const managerPermissionOptions: Array<
    [keyof ManagerPermissions, string]
> = [
    ["dashboard", "Dashboard"],
    ["bookings", "Bookings"],
    ["packages", "Packages"],
    ["packages_manage", "Manage Packages"],
    ["inventory", "Inventory"],
    ["pos", "Sales / POS"],
    ["reports", "Reports"],
    ["staff_management", "Staff Management"],
    ["branch_settings", "Branch Settings"],
];

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

function getManagerInitials(name: string) {
    const parts = name
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (parts.length === 0) return "M";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

export default function BranchManagersPage() {
    const router = useRouter();

    const [managers, setManagers] = useState<BranchManager[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState<number | null>(null);
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

            setShowAddManagerModal(false);
            resetAddManagerForm();

            const emailWasSent =
                data.email_sent === true ||
                String(data.email_status || "")
                    .trim()
                    .toLowerCase() === "sent";

            if (emailWasSent) {
                window.alert(
                    "Manager added successfully. The account activation email was sent."
                );
            } else {
                window.alert(
                    `The manager invitation was created, but the activation email could not be sent.${
                        data.email_error
                            ? ` ${data.email_error}`
                            : ""
                    }`
                );
            }
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

    const updateManagerStatus = async (manager: BranchManager) => {
        const token =
            sessionStorage.getItem("token") || localStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        const willDeactivate = manager.status !== "inactive";

        const confirmed = window.confirm(
            willDeactivate
                ? `Deactivate ${manager.name}? They will no longer be able to access their branch account.`
                : `Reactivate ${manager.name}? They will regain access to their branch account.`
        );

        if (!confirmed) return;

        setUpdatingId(manager.id);
        setError("");

        try {
            const response = await fetch("/api/branch-managers", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: willDeactivate
                        ? "deactivate_manager"
                        : "reactivate_manager",
                    manager_id: manager.id,
                }),
            });

            const rawText = await response.text();

            let data: { error?: string; message?: string } = {};

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
                setError(
                    data.error ||
                    data.message ||
                    `Unable to update manager (HTTP ${response.status}).`
                );
                return;
            }

            setManagers((currentManagers) =>
                currentManagers.map((item) =>
                    item.id === manager.id
                        ? {
                            ...item,
                            status: willDeactivate ? "inactive" : "active",
                        }
                        : item
                )
            );
        } catch (requestError: unknown) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "Unable to update this manager."
            );
        } finally {
            setUpdatingId(null);
        }
    };

    return (
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
                                onClick={() => void loadManagers()}
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
                                {filteredManagers.length}{" "}
                                {filteredManagers.length === 1
                                    ? "manager"
                                    : "managers"}
                            </span>
                        </div>

                        {loading ? (
                            <div className="flex min-h-[180px] items-center justify-center px-4 text-sm text-[#7A6A84]">
                                Loading branch managers...
                            </div>
                        ) : filteredManagers.length === 0 ? (
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
                                        {filteredManagers.map(
                                            (manager) => {
                                                const isUpdating =
                                                    updatingId ===
                                                    manager.id;
                                                const isInactive =
                                                    manager.status ===
                                                    "inactive";

                                                return (
                                                    <tr
                                                        key={manager.id}
                                                        className="border-b border-[#EEE7F2] bg-white last:border-b-0 transition hover:bg-[#FFFCF7]"
                                                    >
                                                        <td className="px-5 py-4">
                                                            <div className="flex min-w-0 items-center gap-3">
                                                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F1EBFF] text-sm font-bold text-[#6D35D4]">
                                                                        {getManagerInitials(
                                                                            manager.name
                                                                        )}
                                                                    </span>

                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-bold text-[#1A1220]">
                                                                        {
                                                                            manager.name
                                                                        }
                                                                    </p>
                                                                    <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-[#7A6A84]">
                                                                        <Mail
                                                                            size={
                                                                                12
                                                                            }
                                                                            className="shrink-0 text-[#806A8C]"
                                                                        />
                                                                        <span className="truncate">
                                                                                {
                                                                                    manager.email
                                                                                }
                                                                            </span>
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </td>

                                                        <td className="px-5 py-4">
                                                            <div className="flex min-w-0 items-center gap-2.5">
                                                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#6D35D4]">
                                                                        <Building2
                                                                            size={
                                                                                17
                                                                            }
                                                                            strokeWidth={
                                                                                2
                                                                            }
                                                                        />
                                                                    </span>

                                                                <span className="truncate text-sm font-semibold text-[#1A1220]">
                                                                        {
                                                                            manager.branch
                                                                        }
                                                                    </span>
                                                            </div>
                                                        </td>

                                                        <td className="px-5 py-4">
                                                                <span
                                                                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${getStatusClass(
                                                                        manager.status
                                                                    )}`}
                                                                >
                                                                    <span
                                                                        className={`h-1.5 w-1.5 rounded-full ${
                                                                            manager.status ===
                                                                            "active"
                                                                                ? "bg-[#138342]"
                                                                                : manager.status ===
                                                                                "inactive"
                                                                                    ? "bg-[#C13333]"
                                                                                    : "bg-[#A56607]"
                                                                        }`}
                                                                    />
                                                                    {getStatusLabel(
                                                                        manager.status
                                                                    )}
                                                                </span>
                                                        </td>

                                                        <td className="px-5 py-4 text-right">
                                                            <button
                                                                type="button"
                                                                disabled={
                                                                    isUpdating
                                                                }
                                                                onClick={() =>
                                                                    void updateManagerStatus(
                                                                        manager
                                                                    )
                                                                }
                                                                className={`inline-flex h-[38px] items-center justify-center rounded-xl px-4 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                                                    isInactive
                                                                        ? "border border-[#D7C7E8] bg-white text-[#2B174C] hover:bg-[#F7F1FF]"
                                                                        : "bg-[#A33E20] text-white hover:bg-[#883117]"
                                                                }`}
                                                            >
                                                                {isUpdating
                                                                    ? "Saving..."
                                                                    : isInactive
                                                                        ? "Reactivate"
                                                                        : "Deactivate"}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            }
                                        )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </section>
                </section>
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
                                                Choose which modules the
                                                manager can access.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {managerPermissionOptions.map(
                                            ([key, label]) => (
                                                <ManagerPermissionToggle
                                                    key={key}
                                                    label={label}
                                                    checked={
                                                        newManagerPermissions[
                                                            key
                                                            ]
                                                    }
                                                    disabled={addingManager}
                                                    onChange={(checked) =>
                                                        setNewManagerPermissions(
                                                            (current) => ({
                                                                ...current,
                                                                [key]: checked,
                                                            })
                                                        )
                                                    }
                                                />
                                            )
                                        )}
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

function ManagerPermissionToggle({
                                     label,
                                     checked,
                                     disabled,
                                     onChange,
                                 }: {
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex min-h-[46px] cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#E8DFF0] bg-[#FFFEFC] px-3.5 py-2.5 transition hover:border-[#CDB9E0] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#2B174C]/10">
            <span className="text-sm font-medium text-[#1A1220]">
                {label}
            </span>

            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) =>
                    onChange(event.target.checked)
                }
                className="h-4 w-4 accent-[#2B174C] disabled:cursor-not-allowed"
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