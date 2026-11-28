"use client";

import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Building2,
    CheckCircle2,
    AlertCircle,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    UserRoundCheck,
    X,
    XCircle,
} from "lucide-react";


// Consistent Philippine mobile display; preserve existing landline contacts.
function formatBranchContact(value: string): string {
    const raw = String(value ?? "").trim();
    const digits = raw.replace(/\D/g, "");
    const local = digits.startsWith("63") ? `0${digits.slice(2)}` : digits.length === 10 && digits.startsWith("9") ? `0${digits}` : digits;
    if (!/^09\d{0,9}$/.test(local)) return raw;
    return [local.slice(0, 4), local.slice(4, 7), local.slice(7, 11)].filter(Boolean).join(" ");
}

function normalizeBranchContact(value: string): string {
    const formatted = formatBranchContact(value);
    const digits = formatted.replace(/\D/g, "");
    return /^09\d{9}$/.test(digits) ? digits : String(value ?? "").trim();
}

type Permissions = {
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

type Branch = {
    id: number;
    branch_name: string;
    contact_number?: string;
    address?: string;
    manager_name?: string;
    manager_email?: string;
    manager_status?: string;

    // Actual branch operating status returned by the API.
    branch_status?: string;
    status?: string;

    permissions?: Partial<Permissions>;
    staff_count: number;
    revenue: number;
    bookings: number;

    // Supported API field names for branch-level sales totals.
    total_pos_sales?: number | string;
    pos_sales?: number | string;
    pos_revenue?: number | string;
    totalPosSales?: number | string;

    total_booking_sales?: number | string;
    booking_sales?: number | string;
    booking_revenue?: number | string;
    totalBookingSales?: number | string;
};

type BranchStatus = "active" | "inactive";

function getBranchStatus(branch: Branch): BranchStatus {
    const branchStatus = String(
        branch.branch_status || branch.status || ""
    )
        .trim()
        .toLowerCase();

    if (branchStatus === "inactive") return "inactive";
    if (branchStatus === "active") return "active";

    // Existing branches without a saved status remain active by default.
    return "active";
}

function formatCurrency(value: number) {
    const amount = Number(value || 0);

    return `₱${(Number.isFinite(amount) ? amount : 0).toLocaleString(
        "en-PH",
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }
    )}`;
}

function getFirstValidNumber(
    ...values: Array<number | string | null | undefined>
) {
    for (const value of values) {
        if (value === null || value === undefined || value === "") continue;

        const numberValue = Number(value);

        if (Number.isFinite(numberValue)) {
            return numberValue;
        }
    }

    return 0;
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

export default function BranchesPage() {
    const router = useRouter();
    const { toast, setToast, notify, confirmation, confirmAction, resolveConfirmation } = useModuleFeedback();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [addBranchName, setAddBranchName] = useState("");
    const [addContactNumber, setAddContactNumber] = useState("");
    const [addAddress, setAddAddress] = useState("");
    const [addBranchStatus, setAddBranchStatus] = useState<
        "active" | "inactive"
    >("active");
    const [adding, setAdding] = useState(false);

    const [showEditModal, setShowEditModal] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>();
    const [editBranchName, setEditBranchName] = useState("");
    const [editContactNumber, setEditContactNumber] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [editBranchStatus, setEditBranchStatus] = useState<
        BranchStatus
    >("active");
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const deletionInFlight = useRef(false);

    const loadBranches = useCallback(async () => {
        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/branches", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });

            const data = await res.json();

            if (!res.ok) {
                setBranches([]);
                setError(data.error || "Unable to load branches.");
                return;
            }

            setBranches(Array.isArray(data.branches) ? data.branches : []);
        } catch {
            setBranches([]);
            setError("Unable to load branches. Please try again.");
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        void loadBranches();
    }, [loadBranches]);

    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const filteredBranches = useMemo(() => {
        const query = search.trim().toLowerCase();

        if (!query) return branches;

        return branches.filter((branch) => {
            const searchableValue = [
                branch.branch_name,
                branch.manager_name,
                branch.manager_email,
                branch.contact_number,
                branch.address,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return searchableValue.includes(query);
        });
    }, [branches, search]);

    const summary = useMemo(() => {
        const activeBranches = branches.filter(
            (branch) => getBranchStatus(branch) === "active"
        ).length;

        const inactiveBranches = branches.filter(
            (branch) => getBranchStatus(branch) === "inactive"
        ).length;

        const totalStaff = branches.reduce(
            (total, branch) => total + Number(branch.staff_count || 0),
            0
        );

        return {
            totalBranches: branches.length,
            activeBranches,
            inactiveBranches,
            totalStaff,
        };
    }, [branches]);

    const resetAddForm = () => {
        setAddBranchName("");
        setAddContactNumber("");
        setAddAddress("");
        setAddBranchStatus("active");


    };

    const openAddModal = () => {
        resetAddForm();
        setShowAddModal(true);
    };

    const closeAddModal = () => {
        if (adding) return;

        setShowAddModal(false);
        resetAddForm();
    };

    const handleCreateBranch = async () => {
        if (adding || saving || deleting) return;
        if (
            !addBranchName.trim() ||
            !addContactNumber.trim() ||
            !addAddress.trim()
        ) {
            notify("warning", "Missing branch details", "Please complete the branch name, contact number, and address.");
            return;
        }

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        const confirmed = await confirmAction({
            title: "Create branch?",
            message: `Create "${addBranchName.trim()}" as an ${addBranchStatus} branch?`,
            confirmLabel: "Create Branch",
        });
        if (!confirmed) return;

        setAdding(true);

        try {
            const response = await fetch("/api/branches", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    branches: [
                        {
                            branch_name: addBranchName.trim(),
                            contact_number: normalizeBranchContact(addContactNumber),
                            address: addAddress.trim(),
                            status: addBranchStatus,
                            branch_status: addBranchStatus,


                        },
                    ],
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                notify("error", "Unable to create branch", data.error || data.message || "Please try again.");
                return;
            }

            setShowAddModal(false);
            resetAddForm();
            await loadBranches();
            notify("success", "Branch created successfully", `${addBranchName.trim()} was added to your branch directory. Assign a manager in Branch Managers when ready.`);
        } catch {
            notify("error", "Unable to create branch", "Something went wrong. Please try again.");
        } finally {
            setAdding(false);
        }
    };

    const openEditModal = (branch: Branch) => {
        setEditingBranch(branch);
        setEditBranchName(branch.branch_name || "");
        setEditContactNumber(formatBranchContact(branch.contact_number || ""));
        setEditAddress(branch.address || "");
        setEditBranchStatus(getBranchStatus(branch));


        setShowEditModal(true);
    };

    const closeEditModal = () => {
        if (saving) return;

        setShowEditModal(false);
        setEditingBranch(null);
    };

    const handleUpdateBranch = async () => {
        if (!editingBranch || adding || saving || deleting) return;

        if (!editBranchName.trim()) {
            notify("warning", "Branch name required", "Please enter the branch name.");
            return;
        }

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        const confirmed = await confirmAction({
            title: "Save branch changes?",
            message: `Save the updated details for "${editBranchName.trim()}"?${getBranchStatus(editingBranch) !== editBranchStatus ? ` Its operating status will change to ${editBranchStatus}.` : ""}`,
            confirmLabel: "Save Changes",
            danger: getBranchStatus(editingBranch) !== editBranchStatus && editBranchStatus === "inactive",
        });
        if (!confirmed) return;

        setSaving(true);

        try {
            const res = await fetch("/api/branches", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    branch_id: editingBranch.id,
                    branch_name: editBranchName.trim(),
                    contact_number: normalizeBranchContact(editContactNumber),
                    address: editAddress,
                    status: editBranchStatus,
                    branch_status: editBranchStatus,

                }),
            });

            const data = await res.json();

            if (!res.ok) {
                notify("error", "Unable to update branch", data.error || "Please try again.");
                return;
            }

            setShowEditModal(false);
            setEditingBranch(null);
            await loadBranches();
            notify("success", "Branch updated successfully", `Changes to ${editBranchName.trim()} have been saved.`);
        } catch {
            notify("error", "Unable to update branch", "Something went wrong. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteBranch = async (branch: Branch) => {
        if (deletionInFlight.current || adding || saving) return;
        const confirmed = await confirmAction({
            title: "Delete branch?",
            message: `Delete "${branch.branch_name}"? This will also remove its assigned manager and staff accounts. This action cannot be undone.`,
            confirmLabel: "Delete Branch",
            danger: true,
        });

        if (!confirmed) return;

        const token = sessionStorage.getItem("token");

        if (!token) {
            router.push("/");
            return;
        }

        if (deletionInFlight.current) return;
        deletionInFlight.current = true;
        setDeleting(true);
        try {
            const res = await fetch("/api/branches", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ branch_id: branch.id }),
            });

            const data = await res.json();

            if (!res.ok) {
                notify("error", "Unable to delete branch", data.error || "Please try again.");
                return;
            }

            await loadBranches();
            notify("success", "Branch deleted successfully", `${branch.branch_name} was removed from your branch directory.`);
        } catch {
            notify("error", "Unable to delete branch", "Something went wrong. Please try again.");
        } finally {
            deletionInFlight.current = false;
            setDeleting(false);
        }
    };

    return (
        <div
            className="flex min-h-screen font-sans text-[#1A1220]"
            style={{ backgroundColor: "#FDFAF4" }}
        >
            <RoleSidebar />

            <main className="min-w-0 flex-1 overflow-y-auto">
                <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                    <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                        <h1 className="text-[27px] font-bold tracking-[-0.025em] text-[#1A1220]">
                            Branches
                        </h1>

                        <div className="flex items-center gap-2.5">
                            <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                {currentDateTime
                                    ? formatCurrentDateTime(currentDateTime)
                                    : "Loading date..."}
                            </span>

                            <button
                                type="button"
                                onClick={() => void loadBranches()}
                                disabled={loading}
                                aria-label="Refresh branches"
                                title="Refresh branches"
                                className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <RefreshCw
                                    size={16}
                                    className={loading ? "animate-spin" : ""}
                                />
                                Refresh
                            </button>
                        </div>
                    </div>
                </header>

                <section className="space-y-3.5 px-6 py-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <SummaryCard
                            title="Total Branches"
                            value={summary.totalBranches}
                            description="All registered business locations"
                            icon={<Building2 className="h-5 w-5" />}
                            iconClassName="bg-[#F0E8FA] text-[#5B35A5]"
                        />
                        <SummaryCard
                            title="Active Branches"
                            value={summary.activeBranches}
                            description="Branches currently operating"
                            icon={<CheckCircle2 className="h-5 w-5" />}
                            iconClassName="bg-[#EAF7EF] text-[#21844A]"
                        />
                        <SummaryCard
                            title="Inactive Branches"
                            value={summary.inactiveBranches}
                            description="Branches currently inactive"
                            icon={<XCircle className="h-5 w-5" />}
                            iconClassName="bg-[#FFF0F0] text-[#C32F2F]"
                        />
                        <SummaryCard
                            title="Total Staff"
                            value={summary.totalStaff}
                            description="Staff assigned across branches"
                            icon={<UserRoundCheck className="h-5 w-5" />}
                            iconClassName="bg-[#EEF4FF] text-[#3367D6]"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative min-w-[260px] flex-1">
                            <Search
                                size={16}
                                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"
                            />
                            <input
                                value={search}
                                onChange={(event) =>
                                    setSearch(event.target.value)
                                }
                                placeholder="Search branch, manager, address, or contact..."
                                className="h-[48px] w-full rounded-xl border border-[#E6DDF0] bg-white px-4 pl-10 text-sm text-[#1A1220] outline-none shadow-sm placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                            />

                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch("")}
                                    aria-label="Clear branch search"
                                    className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[#806A8C] transition hover:bg-[#F1E9FF] hover:text-[#2B174C]"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={openAddModal}
                            className="inline-flex h-[48px] shrink-0 items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                        >
                            <Plus size={16} />
                            Add branch
                        </button>
                    </div>

                    {error && (
                        <div className="rounded-xl border border-[#F3C4C4] bg-[#FFF2F2] px-3 py-2.5 text-sm font-medium text-[#9B1C1C]">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-5 py-14 text-center text-sm text-[#7A6A84] shadow-sm">
                            Loading branches...
                        </div>
                    ) : branches.length === 0 ? (
                        <EmptyBranches
                            title="No branches added yet."
                            detail="Add your first branch to start assigning managers and staff."
                            actionLabel="Add branch"
                            onAction={openAddModal}
                        />
                    ) : filteredBranches.length === 0 ? (
                        <EmptyBranches
                            title="No matching branches found."
                            detail="Try another branch name, manager, address, or contact number."
                            actionLabel="Clear search"
                            onAction={() => setSearch("")}
                        />
                    ) : (
                        <section className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm">
                            <div className="flex items-center justify-between gap-3 border-b border-[#E6DDF0] px-4 py-3">
                                <div>
                                    <h2 className="text-[18px] font-bold tracking-[-0.015em] text-[#1A1220]">
                                        Branch Directory
                                    </h2>
                                    <p className="mt-1 text-[13px] text-[#7A6A84]">
                                        View branch performance and assigned manager details.
                                    </p>
                                </div>

                                <span className="text-xs font-medium text-[#806A8C]">
                                    {filteredBranches.length}{" "}
                                    {filteredBranches.length === 1
                                        ? "branch"
                                        : "branches"}
                                </span>
                            </div>

                            <div className="grid gap-3 p-3 xl:grid-cols-2">
                                {filteredBranches.map((branch) => (
                                    <BranchCard
                                        key={branch.id}
                                        branch={branch}
                                        onEdit={() => openEditModal(branch)}
                                        onDelete={() =>
                                            void handleDeleteBranch(branch)
                                        }
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </section>
            </main>

            {showAddModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
                    onMouseDown={closeAddModal}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="add-branch-dialog-title"
                        className="max-h-[78vh] w-full max-w-[1120px] overflow-y-auto rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E6DDF0] bg-white px-6 py-5">
                            <div>
                                <h2
                                    id="add-branch-dialog-title"
                                    className="text-[22px] font-bold tracking-[-0.02em] text-[#1A1220]"
                                >
                                    Add Branch
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-[#7A6A84]">
                                    Add a new business location to your store.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={closeAddModal}
                                disabled={adding}
                                aria-label="Close add branch form"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E6DDF0] text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <X size={17} />
                            </button>
                        </div>

                        <div className="space-y-5 px-6 py-5">
                            <div className="rounded-2xl border border-[#E8DFF0] bg-[#FFFDF8] p-5">
                                <div className="mb-4 flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0E8FA] text-[#5B35A5]">
                                        <Building2 className="h-5 w-5" />
                                    </span>

                                    <div>
                                        <h3 className="font-bold text-[#1A1220]">
                                            Branch information
                                        </h3>
                                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                                            Enter the required location details.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <TextInput
                                        label="Branch name"
                                        value={addBranchName}
                                        onChange={setAddBranchName}
                                        placeholder="Main Branch"
                                    />

                                    <TextInput
                                        label="Branch contact number"
                                        value={addContactNumber}
                                        onChange={(value) => setAddContactNumber(formatBranchContact(value))}
                                        placeholder="0912 345 6789"
                                    />
                                </div>

                                <TextInput
                                    label="Address"
                                    value={addAddress}
                                    onChange={setAddAddress}
                                    placeholder="Complete branch address"
                                />

                                <div className="mt-1">
                                    <p className="mb-2 block text-sm font-medium text-[#1A1220]">
                                        Branch status
                                    </p>

                                    <div
                                        className="grid gap-3 sm:grid-cols-2"
                                        role="radiogroup"
                                        aria-label="Branch status"
                                    >
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={
                                                addBranchStatus === "active"
                                            }
                                            onClick={() =>
                                                setAddBranchStatus("active")
                                            }
                                            className={[
                                                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                                addBranchStatus === "active"
                                                    ? "border-[#55B978] bg-[#EDFBF1] ring-2 ring-[#55B978]/10"
                                                    : "border-[#E6DDF0] bg-white hover:border-[#9ED9B3] hover:bg-[#F7FCF8]",
                                            ].join(" ")}
                                        >
                                            <span
                                                className={[
                                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                    addBranchStatus === "active"
                                                        ? "bg-[#DDF6E6] text-[#168344]"
                                                        : "bg-[#F1F4F2] text-[#6F7D74]",
                                                ].join(" ")}
                                            >
                                                <CheckCircle2 className="h-5 w-5" />
                                            </span>

                                            <span>
                                                <span className="block text-sm font-semibold text-[#1A1220]">
                                                    Active
                                                </span>
                                                <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                    The branch is currently operating.
                                                </span>
                                            </span>
                                        </button>

                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={
                                                addBranchStatus === "inactive"
                                            }
                                            onClick={() =>
                                                setAddBranchStatus("inactive")
                                            }
                                            className={[
                                                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                                addBranchStatus === "inactive"
                                                    ? "border-[#E08A8A] bg-[#FFF2F2] ring-2 ring-[#E08A8A]/10"
                                                    : "border-[#E6DDF0] bg-white hover:border-[#E8B4B4] hover:bg-[#FFF8F8]",
                                            ].join(" ")}
                                        >
                                            <span
                                                className={[
                                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                    addBranchStatus === "inactive"
                                                        ? "bg-[#FFE0E0] text-[#C32F2F]"
                                                        : "bg-[#F5F1F1] text-[#857777]",
                                                ].join(" ")}
                                            >
                                                <XCircle className="h-5 w-5" />
                                            </span>

                                            <span>
                                                <span className="block text-sm font-semibold text-[#1A1220]">
                                                    Inactive
                                                </span>
                                                <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                    The branch is temporarily not operating.
                                                </span>
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <p className="text-xs leading-5 text-[#7A6A84]">Assign managers from the Branch Managers module after creating this branch.</p>
                        </div>

                        <div className="sticky bottom-0 flex gap-3 border-t border-[#E6DDF0] bg-white px-6 py-4">
                            <button
                                type="button"
                                onClick={closeAddModal}
                                disabled={adding}
                                className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-5 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void handleCreateBranch()}
                                disabled={adding}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Plus size={16} />
                                {adding ? "Adding branch..." : "Add branch"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showEditModal && editingBranch && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
                    <div className="max-h-[90vh] w-full max-w-[620px] overflow-y-auto rounded-[18px] border border-[#E6DDF0] bg-white shadow-2xl">
                        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E6DDF0] bg-white px-6 py-5">
                            <div>
                                <h2 className="text-[20px] font-bold text-[#1A1220]">
                                    Edit Branch
                                </h2>
                                <p className="mt-1 text-sm text-[#7A6A84]">
                                    Update branch information and operating status.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={closeEditModal}
                                disabled={saving}
                                aria-label="Close edit branch form"
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E6DDF0] text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C] disabled:cursor-not-allowed"
                            >
                                <X size={17} />
                            </button>
                        </div>

                        <div className="space-y-5 px-6 py-5">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <TextInput
                                    label="Branch name"
                                    value={editBranchName}
                                    onChange={setEditBranchName}
                                />
                                <TextInput
                                    label="Branch contact number"
                                    value={editContactNumber}
                                    onChange={(value) => setEditContactNumber(formatBranchContact(value))}
                                />
                            </div>

                            <TextInput
                                label="Address"
                                value={editAddress}
                                onChange={setEditAddress}
                            />

                            <div className="border-t border-[#E6DDF0] pt-5">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#806A8C]">
                                    Branch Status
                                </p>

                                <div
                                    className="grid gap-3 sm:grid-cols-2"
                                    role="radiogroup"
                                    aria-label="Edit branch status"
                                >
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={
                                            editBranchStatus === "active"
                                        }
                                        onClick={() =>
                                            setEditBranchStatus("active")
                                        }
                                        className={[
                                            "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                            editBranchStatus === "active"
                                                ? "border-[#55B978] bg-[#EDFBF1] ring-2 ring-[#55B978]/10"
                                                : "border-[#E6DDF0] bg-white hover:border-[#9ED9B3] hover:bg-[#F7FCF8]",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                editBranchStatus === "active"
                                                    ? "bg-[#DDF6E6] text-[#168344]"
                                                    : "bg-[#F1F4F2] text-[#6F7D74]",
                                            ].join(" ")}
                                        >
                                            <CheckCircle2 className="h-5 w-5" />
                                        </span>

                                        <span>
                                            <span className="block text-sm font-semibold text-[#1A1220]">
                                                Active
                                            </span>
                                            <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                The branch is currently operating.
                                            </span>
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={
                                            editBranchStatus === "inactive"
                                        }
                                        onClick={() =>
                                            setEditBranchStatus("inactive")
                                        }
                                        className={[
                                            "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                                            editBranchStatus === "inactive"
                                                ? "border-[#E08A8A] bg-[#FFF2F2] ring-2 ring-[#E08A8A]/10"
                                                : "border-[#E6DDF0] bg-white hover:border-[#E8B4B4] hover:bg-[#FFF8F8]",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                editBranchStatus === "inactive"
                                                    ? "bg-[#FFE0E0] text-[#C32F2F]"
                                                    : "bg-[#F5F1F1] text-[#857777]",
                                            ].join(" ")}
                                        >
                                            <XCircle className="h-5 w-5" />
                                        </span>

                                        <span>
                                            <span className="block text-sm font-semibold text-[#1A1220]">
                                                Inactive
                                            </span>
                                            <span className="mt-0.5 block text-xs leading-5 text-[#7A6A84]">
                                                The branch is temporarily not operating.
                                            </span>
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="sticky bottom-0 flex gap-3 border-t border-[#E6DDF0] bg-white px-6 py-4">
                            <button
                                type="button"
                                onClick={closeEditModal}
                                disabled={saving}
                                className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-5 py-2.5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={() => void handleUpdateBranch()}
                                disabled={saving}
                                className="flex-1 rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? "Saving..." : "Save changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {confirmation && <ModuleConfirmationDialog confirmation={confirmation} onResolve={resolveConfirmation} />}
            {toast && <ModuleNotification toast={toast} onClose={() => setToast(null)} />}
        </div>
    );
}

function SummaryCard({
                         title,
                         value,
                         description,
                         icon,
                         iconClassName,
                     }: {
    title: string;
    value: number;
    description: string;
    icon: React.ReactNode;
    iconClassName: string;
}) {
    return (
        <div className="min-h-[145px] rounded-[18px] border border-[#E6DDF0] bg-white px-4 py-4 shadow-[0_2px_6px_rgba(45,27,78,0.10)]">
            <div className="flex items-start justify-between gap-3">
                <p className="pt-1 text-[15px] font-medium text-[#1A1220]">
                    {title}
                </p>

                <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
                >
                    {icon}
                </span>
            </div>

            <p className="mt-4 text-[28px] font-bold leading-none tracking-[-0.02em] text-[#1A1220]">
                {value}
            </p>

            <p className="mt-2 text-[12px] leading-5 text-[#8A7A94]">
                {description}
            </p>
        </div>
    );
}

function BranchCard({
                        branch,
                        onEdit,
                        onDelete,
                    }: {
    branch: Branch;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const status = getBranchStatus(branch);

    const totalPosSales = getFirstValidNumber(
        branch.total_pos_sales,
        branch.pos_sales,
        branch.pos_revenue,
        branch.totalPosSales
    );

    const totalBookingSales = getFirstValidNumber(
        branch.total_booking_sales,
        branch.booking_sales,
        branch.booking_revenue,
        branch.totalBookingSales
    );

    const statusStyles: Record<BranchStatus, string> = {
        active: "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]",
        inactive: "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
    };

    const statusText: Record<BranchStatus, string> = {
        active: "Active",
        inactive: "Inactive",
    };

    return (
        <article className="overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#CDB7E1] hover:shadow-md">
            <div className="flex items-start justify-between gap-3 border-b border-[#E6DDF0] px-4 py-3.5">
                <div className="min-w-0">
                    <h3 className="truncate text-[18px] font-bold text-[#1A1220]">
                        {branch.branch_name}
                    </h3>

                    <p className="mt-1 truncate text-[13px] text-[#7A6A84]">
                        Manager: {branch.manager_name || "Not assigned"}
                    </p>
                </div>

                <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyles[status]}`}
                >
                    {statusText[status]}
                </span>
            </div>

            <div className="grid grid-cols-3 divide-x divide-[#EEE7F2] px-2 py-3.5">
                <Metric
                    value={formatCurrency(totalPosSales)}
                    label="Total POS Sales"
                />
                <Metric
                    value={formatCurrency(totalBookingSales)}
                    label="Total Booking Sales"
                />
                <Metric
                    value={Number(branch.staff_count || 0)}
                    label="Total Staff"
                />
            </div>

            <div className="space-y-1.5 border-t border-[#E6DDF0] px-4 py-3">
                <p className="truncate text-[13px] text-[#7A6A84]">
                    <span className="mr-2 font-semibold text-[#281246]">
                        Address
                    </span>
                    {branch.address || "No address provided"}
                </p>

                <p className="truncate text-[13px] text-[#7A6A84]">
                    <span className="mr-2 font-semibold text-[#281246]">
                        Contact
                    </span>
                    {formatBranchContact(branch.contact_number || "") || "No contact number"}
                </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[#E6DDF0] px-4 py-3">
                <button
                    type="button"
                    onClick={onEdit}
                    className="inline-flex h-[36px] items-center gap-1.5 rounded-xl border border-[#E6DDF0] bg-white px-3 text-xs font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                >
                    <Pencil size={13} />
                    Edit
                </button>

                <button
                    type="button"
                    onClick={onDelete}
                    className="inline-flex h-[36px] items-center gap-1.5 rounded-xl bg-[#A33E20] px-3 text-xs font-semibold text-white transition hover:bg-[#883117]"
                >
                    <Trash2 size={13} />
                    Delete
                </button>
            </div>
        </article>
    );
}

function Metric({
                    value,
                    label,
                }: {
    value: string | number;
    label: string;
}) {
    return (
        <div className="min-w-0 px-2 text-center">
            <p
                className="truncate text-[17px] font-bold text-[#1A1220]"
                title={String(value)}
            >
                {value}
            </p>
            <p className="mt-1 text-[11px] font-medium leading-4 text-[#7A6A84] sm:text-xs">
                {label}
            </p>
        </div>
    );
}

function EmptyBranches({
                           title,
                           detail,
                           actionLabel,
                           onAction,
                       }: {
    title: string;
    detail: string;
    actionLabel: string;
    onAction: () => void;
}) {
    return (
        <div className="rounded-[14px] border border-[#E6DDF0] bg-white px-5 py-14 text-center shadow-sm">
            <h2 className="text-[16px] font-bold text-[#1A1220]">{title}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-[#7A6A84]">
                {detail}
            </p>

            <button
                type="button"
                onClick={onAction}
                className="mt-5 inline-flex h-[42px] items-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
            >
                {actionLabel}
            </button>
        </div>
    );
}

function TextInput({
                       label,
                       value,
                       onChange,
                       placeholder = "",
                       type = "text",
                   }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: string;
}) {
    return (
        <div>
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>

            <input
                type={type}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
                className="h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
            />
        </div>
    );
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
