"use client";

import Image from "next/image";
import { Lora } from "next/font/google";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Check,
    CheckCircle2,
    Copy,
    Mail,
    Package,
    Send,
    X,
} from "lucide-react";

import LandingPage from "./LandingPage";

const lora = Lora({
    subsets: ["latin"],
    weight: ["600", "700"],
    display: "swap",
});

const defaultPermissions = {
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

type BranchField =
    | "branch_name"
    | "contact_number"
    | "address"
    | "manager_name"
    | "manager_email";

type InviteLink = {
    manager_email: string;
    manager_name: string;
    branch_name: string;
    invite_link: string;
    email_sent?: boolean;
    email_status?: "sent" | "failed" | "pending" | string;
    email_error?: string;
};

export default function SetupScreen() {
    const router = useRouter();

    const [setupStep, setSetupStep] = useState(1);
    const [branchCount, setBranchCount] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);

    const [branches, setBranches] = useState([
        {
            branch_name: "",
            contact_number: "",
            address: "",
            manager_name: "",
            manager_email: "",
            permissions: { ...defaultPermissions },
        },
    ]);

    const adjustBranches = (delta: number) => {
        setBranchCount((current) => {
            const nextCount = Math.max(1, Math.min(10, current + delta));

            setBranches((prev) => {
                const copy = [...prev];

                while (copy.length < nextCount) {
                    copy.push({
                        branch_name: "",
                        contact_number: "",
                        address: "",
                        manager_name: "",
                        manager_email: "",
                        permissions: { ...defaultPermissions },
                    });
                }

                return copy.slice(0, nextCount);
            });

            return nextCount;
        });
    };

    const updateBranch = (
        index: number,
        field: BranchField,
        value: string
    ) => {
        setBranches((prev) => {
            const copy = [...prev];
            copy[index] = {
                ...copy[index],
                [field]: value,
            };
            return copy;
        });
    };

    const updatePermission = (
        index: number,
        permission: keyof typeof defaultPermissions,
        value: boolean
    ) => {
        setBranches((prev) => {
            const copy = [...prev];

            copy[index] = {
                ...copy[index],
                permissions: {
                    ...copy[index].permissions,
                    [permission]: value,
                },
            };

            return copy;
        });
    };

    const validateSetup = () => {
        const incompleteBranchIndex = branches.findIndex(
            (branch) =>
                !branch.branch_name.trim() ||
                !branch.contact_number.trim() ||
                !branch.address.trim()
        );

        if (incompleteBranchIndex >= 0) {
            alert(
                `Please complete the branch name, contact number, and address for Branch ${
                    incompleteBranchIndex + 1
                }.`
            );
            return false;
        }

        const incompleteManagerIndex = branches.findIndex(
            (branch) =>
                Boolean(branch.manager_name.trim() || branch.manager_email.trim()) &&
                (!branch.manager_name.trim() || !branch.manager_email.trim())
        );

        if (incompleteManagerIndex >= 0) {
            alert(
                `Please complete both the manager name and manager email for Branch ${
                    incompleteManagerIndex + 1
                }.`
            );
            return false;
        }

        return true;
    };

    const handleSendInvitations = async () => {
        if (!validateSetup() || isSubmitting) return;

        const token = sessionStorage.getItem("token");

        if (!token) {
            alert("Your session has expired. Please log in again.");
            return;
        }

        setIsSubmitting(true);

        try {
            const res = await fetch("/api/onboarding", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    branches,
                    send_invitation_emails: true,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(
                    data.error ||
                    data.message ||
                    JSON.stringify(data) ||
                    "Unable to complete the business setup."
                );
                return;
            }

            const returnedInviteLinks: InviteLink[] = Array.isArray(
                data.invite_links
            )
                ? data.invite_links
                : [];

            setInviteLinks(returnedInviteLinks);
            sessionStorage.setItem("role", "owner");

            const sentCount = Number(
                data.invitation_emails_sent ??
                returnedInviteLinks.filter(
                    (invite) =>
                        invite.email_sent === true ||
                        String(invite.email_status || "").toLowerCase() ===
                        "sent"
                ).length
            );

            const failedCount = Number(
                data.invitation_emails_failed ??
                returnedInviteLinks.filter(
                    (invite) =>
                        invite.email_sent === false ||
                        String(invite.email_status || "").toLowerCase() ===
                        "failed"
                ).length
            );

            if (sentCount > 0 && failedCount === 0) {
                alert(
                    `${sentCount} manager invitation email${
                        sentCount === 1 ? " was" : "s were"
                    } sent successfully.`
                );
            } else if (failedCount > 0) {
                alert(
                    `The branches were created, but ${failedCount} invitation email${
                        failedCount === 1 ? "" : "s"
                    } could not be sent. The invitation links remain available below.`
                );
            } else {
                alert("Branches and manager invitation links created!");
            }
        } catch {
            alert("Something went wrong while creating the business setup.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const progressStep = inviteLinks.length > 0 ? 4 : setupStep;

    return (
        <main className="relative min-h-screen overflow-hidden bg-[#F7F4FB] text-[#1A1220]">
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 overflow-hidden"
            >
                <LandingPage onSignupSuccess={() => undefined} />
            </div>

            <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-[#160C27]/58 px-3 py-5 backdrop-blur-[3px] sm:px-5">
                <section
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="business-setup-title"
                    className="relative my-auto w-full max-w-[760px] overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_32px_100px_rgba(22,12,39,0.34)]"
                >
                    <button
                        type="button"
                        onClick={() => router.push("/")}
                        aria-label="Close business setup"
                        className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full text-[#7A6E88] transition hover:bg-[#F3EFF8] hover:text-[#2D1B4E]"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <header className="border-b border-[#EEE7F2] bg-[linear-gradient(135deg,_#FFFFFF_0%,_#FBF8FF_68%,_#F4ECFF_100%)] px-5 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-7">
                        <div className="flex items-center gap-3 pr-12">
                            <Image
                                src="/logo.png"
                                alt="StockNBook logo"
                                width={48}
                                height={48}
                                priority
                                className="h-10 w-10 shrink-0 object-contain"
                            />

                            <span
                                className={`${lora.className} text-xl font-bold tracking-[-0.045em] text-[#2D1B4E]`}
                            >
                                Stock<span className="text-[#D4A126]">N</span>Book
                            </span>
                        </div>

                        <div className="mt-5 pr-10">
                            <h1
                                id="business-setup-title"
                                className="text-2xl font-semibold tracking-[-0.03em] text-[#21172C] sm:text-3xl"
                            >
                                Set up your business
                            </h1>

                            <p className="mt-2 text-sm leading-6 text-[#7A6E88]">
                                Add your branches, assign manager access, and send
                                secure invitation links from one compact dialog.
                            </p>
                        </div>

                        <SetupProgress currentStep={progressStep} />
                    </header>

                    <div className="max-h-[62vh] overflow-y-auto px-5 py-6 sm:px-8 sm:py-7">
                        {setupStep === 1 && inviteLinks.length === 0 && (
                            <div>
                                <div className="rounded-2xl border border-[#E8DFF0] bg-[#FCFAFD] p-5 sm:p-6">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEE8F8] text-[#2D1B4E]">
                                        <Package className="h-6 w-6" />
                                    </div>

                                    <h2 className="mt-5 text-xl font-semibold text-[#21172C]">
                                        Your owner account is ready
                                    </h2>

                                    <p className="mt-2 text-sm leading-6 text-[#7A6E88]">
                                        Continue to add the business branches and
                                        optional manager accounts connected to your
                                        store.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setSetupStep(2)}
                                    className="mt-6 w-full rounded-xl bg-[#2D1B4E] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#3D2560]"
                                >
                                    Continue setup
                                </button>
                            </div>
                        )}

                        {setupStep === 2 && inviteLinks.length === 0 && (
                            <div>
                                <h2 className="text-xl font-semibold text-[#21172C] sm:text-2xl">
                                    How many branches does your business have?
                                </h2>

                                <p className="mt-2 text-sm text-[#7A6E88]">
                                    You can add more branches later from the Branches
                                    module.
                                </p>

                                <div className="mt-6 flex items-center justify-center gap-7 rounded-2xl border border-[#E8DFF0] bg-[#FCFAFD] px-6 py-7">
                                    <button
                                        type="button"
                                        onClick={() => adjustBranches(-1)}
                                        className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#D9D0E2] bg-white text-2xl font-medium text-[#2D1B4E] transition hover:border-[#7A58A5] hover:bg-[#F8F5FF]"
                                    >
                                        −
                                    </button>

                                    <div className="min-w-[120px] text-center">
                                        <div className="text-5xl font-semibold leading-none text-[#2D1B4E]">
                                            {branchCount}
                                        </div>
                                        <div className="mt-2 text-sm text-[#7A6E88]">
                                            {branchCount === 1 ? "branch" : "branches"}
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => adjustBranches(1)}
                                        className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#D9D0E2] bg-white text-2xl font-medium text-[#2D1B4E] transition hover:border-[#7A58A5] hover:bg-[#F8F5FF]"
                                    >
                                        +
                                    </button>
                                </div>

                                <div className="mt-6 grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSetupStep(1)}
                                        className="rounded-xl border border-[#D9D0E2] bg-white px-5 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF]"
                                    >
                                        Back
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setSetupStep(3)}
                                        className="rounded-xl bg-[#2D1B4E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3D2560]"
                                    >
                                        Continue
                                    </button>
                                </div>
                            </div>
                        )}

                        {setupStep === 3 && inviteLinks.length === 0 && (
                            <div>
                                <h2 className="text-xl font-semibold text-[#21172C] sm:text-2xl">
                                    Add branches and managers
                                </h2>

                                <p className="mt-2 text-sm leading-6 text-[#7A6E88]">
                                    Enter each branch location. Manager information is
                                    optional; when provided, the invitation will be
                                    sent to that Gmail address.
                                </p>

                                <div className="mt-6 space-y-5">
                                    {Array.from({ length: branchCount }).map(
                                        (_, index) => (
                                            <div
                                                key={index}
                                                className="rounded-2xl border border-[#E8DFF0] bg-[#FFFCF8] p-5 sm:p-6"
                                            >
                                                <div className="flex items-center justify-between gap-4">
                                                    <h3 className="font-semibold text-[#2D1B4E]">
                                                        Branch {index + 1}
                                                    </h3>

                                                    <span className="rounded-full bg-[#EEE8F8] px-3 py-1 text-[11px] font-semibold text-[#5B3C82]">
                                                        Store location
                                                    </span>
                                                </div>

                                                <div className="mt-5 space-y-4">
                                                    <TextInput
                                                        label="Branch name"
                                                        placeholder="e.g. Main Branch"
                                                        value={
                                                            branches[index]
                                                                ?.branch_name || ""
                                                        }
                                                        onChange={(value) =>
                                                            updateBranch(
                                                                index,
                                                                "branch_name",
                                                                value
                                                            )
                                                        }
                                                    />

                                                    <div className="grid gap-4 sm:grid-cols-2">
                                                        <TextInput
                                                            label="Branch contact number"
                                                            placeholder="09XX XXX XXXX"
                                                            value={
                                                                branches[index]
                                                                    ?.contact_number ||
                                                                ""
                                                            }
                                                            onChange={(value) =>
                                                                updateBranch(
                                                                    index,
                                                                    "contact_number",
                                                                    value
                                                                )
                                                            }
                                                        />

                                                        <TextInput
                                                            label="Branch address"
                                                            placeholder="Full address"
                                                            value={
                                                                branches[index]
                                                                    ?.address || ""
                                                            }
                                                            onChange={(value) =>
                                                                updateBranch(
                                                                    index,
                                                                    "address",
                                                                    value
                                                                )
                                                            }
                                                        />
                                                    </div>

                                                    <div className="border-t border-[#E8DFF0] pt-5">
                                                        <div className="flex items-center gap-2">
                                                            <Mail className="h-4 w-4 text-[#6F45B8]" />
                                                            <h4 className="font-semibold text-[#2D1B4E]">
                                                                Branch manager
                                                            </h4>
                                                        </div>

                                                        <p className="mt-1 text-xs leading-5 text-[#7A6E88]">
                                                            Leave both fields empty if
                                                            you will manage this branch
                                                            yourself.
                                                        </p>

                                                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                                            <TextInput
                                                                label="Manager name"
                                                                placeholder="e.g. Ana Cruz"
                                                                value={
                                                                    branches[index]
                                                                        ?.manager_name ||
                                                                    ""
                                                                }
                                                                onChange={(value) =>
                                                                    updateBranch(
                                                                        index,
                                                                        "manager_name",
                                                                        value
                                                                    )
                                                                }
                                                            />

                                                            <TextInput
                                                                label="Manager email"
                                                                placeholder="manager@gmail.com"
                                                                type="email"
                                                                value={
                                                                    branches[index]
                                                                        ?.manager_email ||
                                                                    ""
                                                                }
                                                                onChange={(value) =>
                                                                    updateBranch(
                                                                        index,
                                                                        "manager_email",
                                                                        value
                                                                    )
                                                                }
                                                                icon={
                                                                    <Mail className="h-4 w-4 text-[#7A6E88]" />
                                                                }
                                                            />
                                                        </div>

                                                        <div className="mt-5">
                                                            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6E88]">
                                                                Feature access
                                                            </p>

                                                            <div className="grid gap-2 sm:grid-cols-2">
                                                                <AccessToggle
                                                                    label="Dashboard"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .dashboard ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "dashboard",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Bookings"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .bookings ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "bookings",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Packages"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .packages ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "packages",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Manage Packages"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .packages_manage ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "packages_manage",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Inventory"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .inventory ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "inventory",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Sales / POS"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .pos || false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "pos",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Reports"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .reports ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "reports",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Staff Management"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .staff_management ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "staff_management",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                                <AccessToggle
                                                                    label="Branch Settings"
                                                                    checked={
                                                                        branches[index]
                                                                            ?.permissions
                                                                            .branch_settings ||
                                                                        false
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            "branch_settings",
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    )}
                                </div>

                                <div className="mt-6 grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSetupStep(2)}
                                        disabled={isSubmitting}
                                        className="rounded-xl border border-[#D9D0E2] bg-white px-5 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF] disabled:opacity-50"
                                    >
                                        Back
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleSendInvitations}
                                        disabled={isSubmitting}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3D2560] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isSubmitting ? (
                                            "Creating setup..."
                                        ) : (
                                            <>
                                                <Send className="h-4 w-4" />
                                                Create & send invitations
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}

                        {inviteLinks.length > 0 && (
                            <div>
                                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#EEF7E9] text-[#3E9A5F]">
                                    <CheckCircle2 className="h-9 w-9" />
                                </div>

                                <h2 className="mt-5 text-center text-2xl font-semibold text-[#21172C]">
                                    Business setup complete
                                </h2>

                                <p className="mt-2 text-center text-sm leading-6 text-[#7A6E88]">
                                    Your branches were created. Invitation delivery
                                    results are shown below.
                                </p>

                                <div className="mt-6 space-y-3">
                                    {inviteLinks.map((invite, index) => {
                                        const status = String(
                                            invite.email_status || ""
                                        ).toLowerCase();
                                        const emailWasSent =
                                            invite.email_sent === true ||
                                            status === "sent";
                                        const emailFailed =
                                            invite.email_sent === false ||
                                            status === "failed";

                                        return (
                                            <div
                                                key={`${invite.manager_email}-${index}`}
                                                className="rounded-2xl border border-[#E8DFF0] bg-[#FCFAFD] p-4"
                                            >
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-[#21172C]">
                                                            {invite.manager_name ||
                                                                "Manager"}{" "}
                                                            — {invite.branch_name}
                                                        </p>
                                                        <p className="mt-1 text-xs text-[#7A6E88]">
                                                            {invite.manager_email}
                                                        </p>
                                                    </div>

                                                    {emailWasSent && (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF7E6] px-3 py-1 text-[11px] font-semibold text-[#3E7A35]">
                                                            <Check className="h-3 w-3" />
                                                            Email sent
                                                        </span>
                                                    )}

                                                    {emailFailed && (
                                                        <span className="rounded-full bg-[#FFF0F0] px-3 py-1 text-[11px] font-semibold text-red-600">
                                                            Email failed
                                                        </span>
                                                    )}

                                                    {!emailWasSent &&
                                                        !emailFailed && (
                                                            <span className="rounded-full bg-[#FFF8E8] px-3 py-1 text-[11px] font-semibold text-[#8C6500]">
                                                                Link created
                                                            </span>
                                                        )}
                                                </div>

                                                {invite.email_error && (
                                                    <p className="mt-3 rounded-lg bg-[#FFF5F5] px-3 py-2 text-xs leading-5 text-red-600">
                                                        {invite.email_error}
                                                    </p>
                                                )}

                                                <div className="mt-3 flex gap-2">
                                                    <input
                                                        readOnly
                                                        value={invite.invite_link}
                                                        className="min-w-0 flex-1 rounded-lg border border-[#E2D9E8] bg-white px-3 py-2 text-xs text-[#7A6E88] outline-none"
                                                    />

                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            await navigator.clipboard.writeText(
                                                                invite.invite_link
                                                            );
                                                            alert(
                                                                "Invite link copied!"
                                                            );
                                                        }}
                                                        className="inline-flex items-center gap-2 rounded-lg bg-[#2D1B4E] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#3D2560]"
                                                    >
                                                        <Copy className="h-3.5 w-3.5" />
                                                        Copy
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={() => router.push("/dashboard")}
                                        className="rounded-xl bg-[#2D1B4E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3D2560]"
                                    >
                                        Go to Dashboard
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => router.push("/branches")}
                                        className="rounded-xl border border-[#8E73A5] bg-white px-5 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF]"
                                    >
                                        View Branches
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

function SetupProgress({ currentStep }: { currentStep: number }) {
    const steps = [
        { number: 1, label: "Setup" },
        { number: 2, label: "Branches" },
        { number: 3, label: "Managers" },
        { number: 4, label: "Complete" },
    ];

    return (
        <div className="mt-6 grid grid-cols-4">
            {steps.map((step, index) => {
                const isComplete = step.number < currentStep;
                const isActive = step.number === currentStep;

                return (
                    <div
                        key={step.number}
                        className="relative flex min-w-0 flex-col items-center text-center"
                    >
                        {index > 0 && (
                            <div
                                className={[
                                    "absolute right-1/2 top-4 h-px w-full",
                                    isComplete || isActive
                                        ? "bg-[#6A469C]"
                                        : "bg-[#DDD5E4]",
                                ].join(" ")}
                            />
                        )}

                        <div
                            className={[
                                "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold",
                                isComplete
                                    ? "border-[#604084] bg-[#604084] text-white"
                                    : isActive
                                        ? "border-[#2D1B4E] bg-[#2D1B4E] text-white shadow-[0_5px_14px_rgba(45,27,78,0.22)]"
                                        : "border-[#DDD5E4] bg-white text-[#7A6E88]",
                            ].join(" ")}
                        >
                            {isComplete ? (
                                <Check className="h-4 w-4" />
                            ) : (
                                step.number
                            )}
                        </div>

                        <span
                            className={[
                                "mt-2 block max-w-[100px] text-[10px] font-medium leading-4 sm:text-xs",
                                isComplete || isActive
                                    ? "text-[#2D1B4E]"
                                    : "text-[#8F8498]",
                            ].join(" ")}
                        >
                            {step.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function AccessToggle({
                          label,
                          checked,
                          onChange,
                      }: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#E7DFE9] bg-white px-4 py-3 text-sm text-[#1A1220] transition hover:border-[#BFAED0]">
            <span>{label}</span>

            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="h-4 w-4 accent-[#2D1B4E]"
            />
        </label>
    );
}

function TextInput({
                       label,
                       placeholder,
                       type = "text",
                       value,
                       onChange,
                       icon,
                   }: {
    label: string;
    placeholder: string;
    type?: string;
    value?: string;
    onChange?: (value: string) => void;
    icon?: React.ReactNode;
}) {
    return (
        <div>
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>

            <div className="flex items-center gap-3 rounded-xl border border-[#E4DCE9] bg-white px-4 py-3 transition focus-within:border-[#6A469C] focus-within:ring-4 focus-within:ring-[#6A469C]/10">
                {icon}

                <input
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(event) => onChange?.(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#21172C] outline-none placeholder:text-[#9B90A4]"
                />
            </div>
        </div>
    );
}