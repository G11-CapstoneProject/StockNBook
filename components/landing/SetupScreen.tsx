"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Package } from "lucide-react";

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

export default function SetupScreen() {
    const router = useRouter();

    const [setupStep, setSetupStep] = useState(1);
    const [branchCount, setBranchCount] = useState(1);

    const [inviteLinks, setInviteLinks] = useState<
        {
            manager_email: string;
            manager_name: string;
            branch_name: string;
            invite_link: string;
        }[]
    >([]);

    const [branches, setBranches] = useState([
        {
            branch_name: "",
            contact_number: "",
            address: "",
            manager_name: "",
            manager_email: "",
            permissions: defaultPermissions,
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
                        permissions: defaultPermissions,
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

    const handleSendInvitations = async () => {
        const token = sessionStorage.getItem("token");

        const res = await fetch("/api/onboarding", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                branches,
            }),
        });

        const data = await res.json();

        if (!res.ok) {
            alert(JSON.stringify(data));
            return;
        }

        setInviteLinks(data.invite_links || []);
        alert("Branches and manager invitation links created!");

        sessionStorage.setItem("role", "owner");
    };

    return (
        <main className="min-h-screen bg-[#FDFAF4] text-[#1A1220]">
            <nav className="flex h-16 items-center justify-between border-b border-[#EBE4F0] bg-white px-6 lg:px-10">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2D1B4E] text-[#C9951A]">
                        <Package className="h-5 w-5" />
                    </div>
                    <span className="text-lg font-semibold">
            <span className="text-[#2D1B4E]">Stock</span>NBook
          </span>
                </div>
            </nav>

            <section className="mx-auto flex min-h-[calc(100vh-64px)] max-w-2xl items-center justify-center px-6">
                <div className="w-full rounded-3xl border border-[#EBE4F0] bg-white p-10 shadow-sm">
                    <h1 className="font-serif text-4xl text-[#1A1220]">
                        Business setup
                    </h1>

                    <p className="mt-3 text-sm leading-6 text-[#7A6E88]">
                        Your account has been created. Next, we will set up your branches and managers.
                    </p>

                    {setupStep === 1 && (
                        <button
                            onClick={() => setSetupStep(2)}
                            className="mt-8 w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white"
                        >
                            Continue setup
                        </button>
                    )}

                    {setupStep === 2 && (
                        <div className="mt-8">
                            <h2 className="font-serif text-3xl text-[#1A1220]">
                                How many branches does your business have?
                            </h2>

                            <p className="mt-2 text-sm text-[#7A6E88]">
                                You can always add more branches later.
                            </p>

                            <div className="mt-8 flex items-center justify-center gap-6 rounded-2xl bg-[#FDFAF4] px-6 py-6">
                                <button
                                    onClick={() => adjustBranches(-1)}
                                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#EBE4F0] bg-white text-2xl font-medium text-[#2D1B4E] transition hover:bg-[#EEE8F8]"
                                >
                                    −
                                </button>

                                <div className="min-w-[100px] text-center">
                                    <div className="font-serif text-5xl leading-none text-[#2D1B4E]">
                                        {branchCount}
                                    </div>
                                    <div className="mt-2 text-sm text-[#7A6E88]">branch(es)</div>
                                </div>

                                <button
                                    onClick={() => adjustBranches(1)}
                                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#EBE4F0] bg-white text-2xl font-medium text-[#2D1B4E] transition hover:bg-[#EEE8F8]"
                                >
                                    +
                                </button>
                            </div>

                            <button
                                onClick={() => setSetupStep(3)}
                                className="mt-8 w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white"
                            >
                                Continue
                            </button>
                        </div>
                    )}

                    {setupStep === 3 && (
                        <div className="mt-8">
                            <h2 className="font-serif text-3xl text-[#1A1220]">
                                Tell us about your branches
                            </h2>

                            <p className="mt-2 text-sm text-[#7A6E88]">
                                Add the name, contact number, and address of each branch.
                            </p>

                            <div className="mt-8 space-y-6">
                                {Array.from({ length: branchCount }).map((_, index) => (
                                    <div
                                        key={index}
                                        className="rounded-2xl border border-[#EBE4F0] bg-[#FDFAF4] p-6"
                                    >
                                        <h3 className="mb-5 font-semibold text-[#2D1B4E]">
                                            Branch {index + 1}
                                        </h3>

                                        <div className="space-y-4">
                                            <TextInput
                                                label="Branch name"
                                                placeholder="e.g. Main Branch"
                                                value={branches[index]?.branch_name || ""}
                                                onChange={(value) =>
                                                    updateBranch(index, "branch_name", value)
                                                }
                                            />

                                            <TextInput
                                                label="Branch contact number"
                                                placeholder="09XX XXX XXXX"
                                                value={branches[index]?.contact_number || ""}
                                                onChange={(value) =>
                                                    updateBranch(index, "contact_number", value)
                                                }
                                            />

                                            <TextInput
                                                label="Branch address"
                                                placeholder="Full address of this branch"
                                                value={branches[index]?.address || ""}
                                                onChange={(value) =>
                                                    updateBranch(index, "address", value)
                                                }
                                            />

                                            <div className="border-t border-[#EBE4F0] pt-6">
                                                <h4 className="font-semibold text-[#2D1B4E]">
                                                    Branch manager
                                                </h4>

                                                <p className="mt-1 text-sm text-[#7A6E88]">
                                                    Invite a manager to handle this branch and choose the features they can access.
                                                </p>

                                                <div className="mt-5 space-y-4">
                                                    <TextInput
                                                        label="Manager name"
                                                        placeholder="e.g. Ana Cruz"
                                                        value={branches[index]?.manager_name || ""}
                                                        onChange={(value) =>
                                                            updateBranch(index, "manager_name", value)
                                                        }
                                                    />

                                                    <TextInput
                                                        label="Manager email"
                                                        placeholder="manager@email.com"
                                                        type="email"
                                                        value={branches[index]?.manager_email || ""}
                                                        onChange={(value) =>
                                                            updateBranch(index, "manager_email", value)
                                                        }
                                                        icon={<Mail className="h-5 w-5 text-[#7A6E88]" />}
                                                    />
                                                </div>

                                                <div className="mt-6">
                                                    <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#7A6E88]">
                                                        Feature access
                                                    </p>

                                                    <div className="grid gap-3 sm:grid-cols-2">
                                                        <AccessToggle
                                                            label="Dashboard"
                                                            checked={branches[index]?.permissions.dashboard || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "dashboard", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Bookings"
                                                            checked={branches[index]?.permissions.bookings || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "bookings", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Packages"
                                                            checked={branches[index]?.permissions.packages || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "packages", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Manage Packages"
                                                            checked={branches[index]?.permissions.packages_manage || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "packages_manage", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Inventory"
                                                            checked={branches[index]?.permissions.inventory || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "inventory", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Sales / POS"
                                                            checked={branches[index]?.permissions.pos || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "pos", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Reports"
                                                            checked={branches[index]?.permissions.reports || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "reports", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Staff Management"
                                                            checked={branches[index]?.permissions.staff_management || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "staff_management", checked)
                                                            }
                                                        />

                                                        <AccessToggle
                                                            label="Branch Settings"
                                                            checked={branches[index]?.permissions.branch_settings || false}
                                                            onChange={(checked) =>
                                                                updatePermission(index, "branch_settings", checked)
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-8 flex gap-3">
                                <button
                                    onClick={() => setSetupStep(2)}
                                    className="w-full rounded-lg border border-[#EBE4F0] bg-white px-5 py-3 font-medium text-[#2D1B4E]"
                                >
                                    Back
                                </button>

                                <button
                                    onClick={handleSendInvitations}
                                    className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white"
                                >
                                    Send invitations
                                </button>
                            </div>
                        </div>
                    )}

                    {inviteLinks.length > 0 && (
                        <div className="mt-8 rounded-2xl border border-[#EBE4F0] bg-[#FDFAF4] p-6">
                            <h3 className="font-semibold text-[#2D1B4E]">
                                Manager invitation links
                            </h3>

                            <p className="mt-2 text-sm text-[#7A6E88]">
                                Use these links for testing. Later, these will be sent automatically by email.
                            </p>

                            <div className="mt-5 space-y-4">
                                {inviteLinks.map((invite, index) => (
                                    <div
                                        key={index}
                                        className="rounded-xl border border-[#EBE4F0] bg-white p-4"
                                    >
                                        <p className="text-sm font-semibold text-[#1A1220]">
                                            {invite.manager_name || "Manager"} — {invite.branch_name}
                                        </p>

                                        <p className="mt-1 text-xs text-[#7A6E88]">
                                            {invite.manager_email}
                                        </p>

                                        <div className="mt-3 flex gap-2">
                                            <input
                                                readOnly
                                                value={invite.invite_link}
                                                className="w-full rounded-lg border border-[#EBE4F0] px-3 py-2 text-xs text-[#7A6E88]"
                                            />

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(invite.invite_link);
                                                    alert("Invite link copied!");
                                                }}
                                                className="rounded-lg bg-[#2D1B4E] px-4 py-2 text-xs font-medium text-white"
                                            >
                                                Copy
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button
                                type="button"
                                onClick={() => router.push("/dashboard")}
                                className="mt-6 w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white"
                            >
                                Go to dashboard
                            </button>
                        </div>
                    )}
                </div>
            </section>
        </main>
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
        <label className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm text-[#1A1220]">
            <span>{label}</span>

            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
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
        <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>

            <div className="flex items-center gap-3 rounded-lg border border-[#EBE4F0] bg-white px-4 py-3 transition focus-within:border-[#2D1B4E] focus-within:ring-4 focus-within:ring-[#2D1B4E]/10">
                {icon}

                <input
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange?.(e.target.value)}
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#7A6E88]"
                />
            </div>
        </div>
    );
}



