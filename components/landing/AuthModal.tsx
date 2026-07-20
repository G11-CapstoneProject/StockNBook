"use client";

import Image from "next/image";
import { Lora } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowRight,
    Check,
    CheckCircle2,
    ChevronLeft,
    Clock3,
    Copy,
    Eye,
    EyeOff,
    Info,
    Lock,
    Mail,
    MapPin,
    Package,
    PartyPopper,
    Phone,
    Plus,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Store,
    Trash2,
    UserRound,
    Users,
    X,
} from "lucide-react";

const lora = Lora({
    subsets: ["latin"],
    weight: ["600", "700"],
    display: "swap",
});

type AuthMode = "login" | "signup";

type PendingSignup = {
    owner_name: string;
    store_name: string;
    phone: string;
    email: string;
    password: string;
};

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

type ManagerMode = "owner" | "invite";

type BranchSetup = {
    branch_name: string;
    contact_number: string;
    address: string;
    manager_name: string;
    manager_email: string;
    manager_mode: ManagerMode;
    permissions: Permissions;
};

type InviteLink = {
    manager_email: string;
    manager_name: string;
    branch_name: string;
    invite_link: string;
    email_sent?: boolean;
    email_status?: "sent" | "failed" | "pending" | string;
    email_error?: string;
};

type InvitationEmailSummary = {
    requested: number;
    sent: number;
    failed: number;
    backendConfirmed: boolean;
};

const PLATFORM_ADMIN_EMAIL = "platformadmin@stocknbook.com";
const PLATFORM_ADMIN_PASSWORD = "Admin@12345";

const defaultPermissions: Permissions = {
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

const permissionLabels: Array<{
    key: keyof Permissions;
    label: string;
}> = [
    { key: "dashboard", label: "Dashboard" },
    { key: "bookings", label: "Bookings" },
    { key: "packages", label: "Packages" },
    { key: "packages_manage", label: "Manage Packages" },
    { key: "inventory", label: "Inventory" },
    { key: "pos", label: "Sales / POS" },
    { key: "reports", label: "Reports" },
    { key: "staff_management", label: "Staff Management" },
    { key: "branch_settings", label: "Branch Settings" },
];

const createEmptyBranch = (): BranchSetup => ({
    branch_name: "",
    contact_number: "",
    address: "",
    manager_name: "",
    manager_email: "",
    manager_mode: "owner",
    permissions: { ...defaultPermissions },
});

export default function AuthModal({
                                      mode,
                                      onClose,
                                      onSwitch,
                                  }: {
    mode: AuthMode;
    onClose: () => void;
    onSwitch: (mode: AuthMode) => void;
    onSignupSuccess: () => void;
}) {
    const router = useRouter();

    const [ownerName, setOwnerName] = useState("");
    const [storeName, setStoreName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const [signupStep, setSignupStep] = useState(1);
    const [accountVerified, setAccountVerified] = useState(false);
    const [branches, setBranches] = useState<BranchSetup[]>([
        createEmptyBranch(),
    ]);
    const [setupLoading, setSetupLoading] = useState(false);
    const [setupComplete, setSetupComplete] = useState(false);
    const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
    const [invitationEmailSummary, setInvitationEmailSummary] =
        useState<InvitationEmailSummary>({
            requested: 0,
            sent: 0,
            failed: 0,
            backendConfirmed: false,
        });

    const [otpDialogOpen, setOtpDialogOpen] = useState(false);
    const [otp, setOtp] = useState("");
    const [otpTimer, setOtpTimer] = useState(0);
    const [otpLoading, setOtpLoading] = useState(false);
    const [pendingSignup, setPendingSignup] =
        useState<PendingSignup | null>(null);

    const [legalDocument, setLegalDocument] = useState<
        "terms" | "privacy" | null
    >(null);
    const [hasViewedTerms, setHasViewedTerms] = useState(false);
    const [hasViewedPrivacy, setHasViewedPrivacy] = useState(false);
    const [hasAcceptedPolicies, setHasAcceptedPolicies] = useState(false);

    useEffect(() => {
        if (!otpDialogOpen || otpTimer <= 0) return;

        const timeout = window.setTimeout(() => {
            setOtpTimer((current) => Math.max(0, current - 1));
        }, 1000);

        return () => window.clearTimeout(timeout);
    }, [otpDialogOpen, otpTimer]);

    useEffect(() => {
        if (otpDialogOpen && otpTimer === 0) {
            setOtp("");
        }
    }, [otpDialogOpen, otpTimer]);

    const saveCommonSession = (data: any) => {
        sessionStorage.clear();
        sessionStorage.setItem("token", data.token);
        sessionStorage.setItem("store_id", String(data.store_id));
        sessionStorage.setItem("store_name", data.store_name || "");
        sessionStorage.setItem("isLoggedIn", "true");
        sessionStorage.setItem("role", data.role || "owner");

        if (data.role === "manager") {
            sessionStorage.setItem("manager_id", String(data.manager_id));
            sessionStorage.setItem("manager_name", data.manager_name || "");
            sessionStorage.setItem("manager_email", data.manager_email || "");
            sessionStorage.setItem("branch_id", String(data.branch_id));
            sessionStorage.setItem("branch_name", data.branch_name || "");
            sessionStorage.setItem(
                "permissions",
                JSON.stringify(data.permissions || {})
            );
            sessionStorage.setItem(
                "packages_manage",
                String(Boolean(data.permissions?.packages_manage))
            );
        }

        if (data.role === "staff") {
            sessionStorage.setItem("staff_id", String(data.staff_id));
            sessionStorage.setItem("staff_name", data.staff_name || "");
            sessionStorage.setItem("staff_email", data.staff_email || "");
            sessionStorage.setItem("branch_id", String(data.branch_id));
            sessionStorage.setItem("branch_name", data.branch_name || "");
            sessionStorage.setItem(
                "permissions",
                JSON.stringify(data.permissions || {})
            );
            sessionStorage.setItem(
                "packages_manage",
                String(Boolean(data.permissions?.packages_manage))
            );
        }
    };

    const resetSignupFlow = () => {
        setSignupStep(1);
        setAccountVerified(false);
        setBranches([createEmptyBranch()]);
        setSetupComplete(false);
        setInviteLinks([]);
        setInvitationEmailSummary({
            requested: 0,
            sent: 0,
            failed: 0,
            backendConfirmed: false,
        });
        setPendingSignup(null);
        setOtp("");
        setOtpTimer(0);
        setOtpDialogOpen(false);
        setLegalDocument(null);
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!email || !password) {
            alert("Please enter your email and password.");
            return;
        }

        if (mode === "signup") {
            if (!ownerName || !storeName || !phone) {
                alert("Please fill in all signup fields.");
                return;
            }

            if (password !== confirmPassword) {
                alert("Passwords do not match.");
                return;
            }

            if (!hasViewedTerms || !hasViewedPrivacy) {
                alert(
                    "Please view both the Terms of Service and Privacy Policy before continuing."
                );
                return;
            }

            if (!hasAcceptedPolicies) {
                alert(
                    "Please agree to the Terms of Service and Privacy Policy."
                );
                return;
            }

            if (accountVerified) {
                setSignupStep(2);
                return;
            }
        }

        if (
            mode === "login" &&
            email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL &&
            password === PLATFORM_ADMIN_PASSWORD
        ) {
            const adminUser = {
                platform_admin_id: 1,
                full_name: "Platform Administrator",
                email: PLATFORM_ADMIN_EMAIL,
                role: "PLATFORM_ADMIN",
            };

            sessionStorage.clear();
            sessionStorage.setItem("token", "platform-admin-ui-demo");
            sessionStorage.setItem("role", "PLATFORM_ADMIN");
            sessionStorage.setItem("user", JSON.stringify(adminUser));
            sessionStorage.setItem("full_name", "Platform Administrator");
            sessionStorage.setItem("isLoggedIn", "true");

            setLoading(true);
            onClose();
            router.replace("/platform-admin/dashboard");
            return;
        }

        if (mode === "signup") {
            const signupBody: PendingSignup = {
                owner_name: ownerName.trim(),
                store_name: storeName.trim(),
                phone: phone.trim(),
                email: email.trim(),
                password,
            };

            setLoading(true);

            try {
                const response = await fetch("/api/auth", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        action: "send_signup_otp",
                        ...signupBody,
                    }),
                });

                const data = await response.json();

                if (!response.ok) {
                    alert(data.error || "Failed to send OTP.");
                    return;
                }

                setPendingSignup(signupBody);
                setOtp("");
                setOtpTimer(Number(data.expires_in || 300));
                setOtpDialogOpen(true);
            } catch {
                alert("Something went wrong while sending OTP.");
            } finally {
                setLoading(false);
            }

            return;
        }

        setLoading(true);

        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: "login",
                    email,
                    password,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.token) {
                alert(data.error || "Authentication failed.");
                return;
            }

            saveCommonSession(data);
            onClose();
            router.push("/dashboard");
        } catch {
            alert("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (!pendingSignup) {
            alert("Signup details are missing. Please try again.");
            setOtpDialogOpen(false);
            return;
        }

        const normalizedOtp = otp.replace(/\D/g, "").slice(0, 6);

        if (!/^\d{6}$/.test(normalizedOtp)) {
            alert("Please enter the complete 6-digit OTP.");
            return;
        }

        if (otpTimer <= 0) {
            alert("OTP expired. Please resend a new code.");
            return;
        }

        setOtpLoading(true);

        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: "verify_signup_otp",
                    ...pendingSignup,
                    otp: normalizedOtp,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.token) {
                alert(data.error || "OTP verification failed.");
                return;
            }

            saveCommonSession(data);
            setOtpDialogOpen(false);
            setAccountVerified(true);
            setSignupStep(2);
        } catch {
            alert("Something went wrong while verifying OTP.");
        } finally {
            setOtpLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (otpTimer > 0 || otpLoading) return;

        if (!pendingSignup) {
            alert("Signup details are missing. Please try again.");
            setOtpDialogOpen(false);
            return;
        }

        setOtpLoading(true);

        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: "send_signup_otp",
                    ...pendingSignup,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                alert(data.error || "Failed to resend OTP.");
                return;
            }

            setOtp("");
            setOtpTimer(Number(data.expires_in || 300));
        } catch {
            alert("Something went wrong while resending OTP.");
        } finally {
            setOtpLoading(false);
        }
    };

    const handleSwitchMode = () => {
        resetSignupFlow();
        onSwitch(mode === "login" ? "signup" : "login");
    };

    const addBranch = () => {
        setBranches((current) => {
            if (current.length >= 10) {
                alert("You can add up to 10 branches during setup.");
                return current;
            }

            return [...current, createEmptyBranch()];
        });
    };

    const removeBranch = (index: number) => {
        setBranches((current) => {
            if (current.length === 1) {
                alert("At least one branch is required.");
                return current;
            }

            return current.filter((_, branchIndex) => branchIndex !== index);
        });
    };

    const updateBranch = (
        index: number,
        field: keyof Omit<BranchSetup, "permissions" | "manager_mode">,
        value: string
    ) => {
        setBranches((current) =>
            current.map((branch, branchIndex) =>
                branchIndex === index
                    ? {
                        ...branch,
                        [field]: value,
                    }
                    : branch
            )
        );
    };

    const updateManagerMode = (index: number, modeValue: ManagerMode) => {
        setBranches((current) =>
            current.map((branch, branchIndex) =>
                branchIndex === index
                    ? {
                        ...branch,
                        manager_mode: modeValue,
                        manager_name:
                            modeValue === "owner" ? "" : branch.manager_name,
                        manager_email:
                            modeValue === "owner" ? "" : branch.manager_email,
                    }
                    : branch
            )
        );
    };

    const updatePermission = (
        index: number,
        permission: keyof Permissions,
        value: boolean
    ) => {
        setBranches((current) =>
            current.map((branch, branchIndex) =>
                branchIndex === index
                    ? {
                        ...branch,
                        permissions: {
                            ...branch.permissions,
                            [permission]: value,
                        },
                    }
                    : branch
            )
        );
    };

    const continueToManagers = () => {
        const incompleteBranchIndex = branches.findIndex(
            (branch) =>
                !branch.branch_name.trim() ||
                !branch.contact_number.trim() ||
                !branch.address.trim()
        );

        if (incompleteBranchIndex >= 0) {
            alert(
                `Please complete the name, contact number, and address for Branch ${
                    incompleteBranchIndex + 1
                }.`
            );
            return;
        }

        setSignupStep(3);
    };

    const continueToReview = () => {
        const incompleteManagerIndex = branches.findIndex(
            (branch) =>
                branch.manager_mode === "invite" &&
                (!branch.manager_name.trim() || !branch.manager_email.trim())
        );

        if (incompleteManagerIndex >= 0) {
            alert(
                `Please complete the manager name and email for ${
                    branches[incompleteManagerIndex].branch_name ||
                    `Branch ${incompleteManagerIndex + 1}`
                }.`
            );
            return;
        }

        setSignupStep(4);
    };

    const handleCreateBusinessSetup = async () => {
        const token = sessionStorage.getItem("token");

        if (!token) {
            alert("Your session is missing. Please log in and try again.");
            return;
        }

        const payloadBranches = branches.map((branch) => ({
            branch_name: branch.branch_name.trim(),
            contact_number: branch.contact_number.trim(),
            address: branch.address.trim(),
            manager_name:
                branch.manager_mode === "invite"
                    ? branch.manager_name.trim()
                    : "",
            manager_email:
                branch.manager_mode === "invite"
                    ? branch.manager_email.trim()
                    : "",
            permissions: branch.permissions,
        }));

        setSetupLoading(true);

        try {
            const response = await fetch("/api/onboarding", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    branches: payloadBranches,
                    send_invitation_emails: true,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                alert(
                    data.error ||
                    data.message ||
                    JSON.stringify(data) ||
                    "Unable to complete business setup."
                );
                return;
            }

            const returnedInviteLinks: InviteLink[] = Array.isArray(
                data.invite_links
            )
                ? data.invite_links
                : [];

            const requestedEmailCount = payloadBranches.filter(
                (branch) => Boolean(branch.manager_email)
            ).length;

            const linkLevelSentCount = returnedInviteLinks.filter(
                (invite) =>
                    invite.email_sent === true ||
                    String(invite.email_status || "").toLowerCase() === "sent"
            ).length;

            const linkLevelFailedCount = returnedInviteLinks.filter(
                (invite) =>
                    invite.email_sent === false ||
                    String(invite.email_status || "").toLowerCase() === "failed"
            ).length;

            const responseSentCount = Number(
                data.invitation_emails_sent ??
                data.emails_sent ??
                linkLevelSentCount
            );

            const responseFailedCount = Number(
                data.invitation_emails_failed ??
                data.emails_failed ??
                linkLevelFailedCount
            );

            const backendConfirmedEmailDelivery =
                data.invitation_emails_sent !== undefined ||
                data.emails_sent !== undefined ||
                returnedInviteLinks.some(
                    (invite) =>
                        invite.email_sent !== undefined ||
                        invite.email_status !== undefined
                );

            setInviteLinks(returnedInviteLinks);
            setInvitationEmailSummary({
                requested: requestedEmailCount,
                sent: Number.isFinite(responseSentCount)
                    ? responseSentCount
                    : 0,
                failed: Number.isFinite(responseFailedCount)
                    ? responseFailedCount
                    : 0,
                backendConfirmed: backendConfirmedEmailDelivery,
            });

            sessionStorage.setItem("role", "owner");
            setSetupComplete(true);
        } catch {
            alert("Something went wrong while creating your business setup.");
        } finally {
            setSetupLoading(false);
        }
    };

    const handleOpenDashboard = () => {
        onClose();
        router.push("/dashboard");
    };

    const handleOpenBranches = () => {
        onClose();
        router.push("/branches");
    };

    const headerTitle =
        mode === "login"
            ? "Log in"
            : setupComplete
                ? "Setup complete"
                : signupStep === 1
                    ? "Create account"
                    : signupStep === 2
                        ? "Add your branches"
                        : signupStep === 3
                            ? "Assign managers"
                            : "Review your setup";

    const headerDescription =
        mode === "login"
            ? "Enter your credentials to access your dashboard."
            : setupComplete
                ? "Your account, branches, and manager access are ready."
                : signupStep === 1
                    ? "Set up your business in under 3 minutes."
                    : signupStep === 2
                        ? "Add at least one location where your business operates."
                        : signupStep === 3
                            ? "Choose who will manage each branch and keep the same access controls."
                            : "Check your information before creating the branches and invitation links.";

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-3 py-4 font-sans backdrop-blur-sm sm:px-4">
                <div className="relative grid max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-4 top-4 z-20 rounded-full p-2 text-white/80 transition hover:bg-white/10 md:text-[#7A6E88] md:hover:bg-[#F3EFF8]"
                        aria-label="Close modal"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <div className="relative hidden min-h-[680px] overflow-hidden bg-[radial-gradient(circle_at_50%_48%,_#3D2468_0%,_#2D1B4E_52%,_#24143D_100%)] p-10 font-sans text-white md:flex md:flex-col">
                        <div className="pointer-events-none absolute -left-20 top-44 h-48 w-48 rounded-full bg-[#7958A8]/10 blur-3xl" />
                        <div className="pointer-events-none absolute -right-24 bottom-28 h-56 w-56 rounded-full bg-[#C9951A]/10 blur-3xl" />

                        <div className="relative z-10">
                            <div className="flex items-center gap-2.5">
                                <Image
                                    src="/logo.png"
                                    alt="StockNBook logo"
                                    width={52}
                                    height={52}
                                    priority
                                    className="h-9 w-9 shrink-0 object-contain"
                                />

                                <span
                                    className={`${lora.className} truncate text-xl font-bold tracking-[-0.04em] text-white`}
                                >
                                    Stock<span className="text-[#D4A126]">N</span>Book
                                </span>
                            </div>

                            <h2 className="mt-9 max-w-[370px] font-sans text-[clamp(1.9rem,2.6vw,2.65rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-white">
                                {mode === "login" ? (
                                    <>
                                        Welcome back to your{" "}
                                        <span className="italic text-[#F5E8C0]">
                                            business.
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        Start your{" "}
                                        <span className="italic text-[#F5E8C0]">
                                            celebration
                                        </span>{" "}
                                        business here.
                                    </>
                                )}
                            </h2>

                            <p className="mt-4 max-w-[370px] font-sans text-[13px] leading-6 text-white/65">
                                Manage your events, bookings, inventory, and team
                                from one clean dashboard.
                            </p>
                        </div>

                        <div className="relative z-10 flex flex-1 items-center justify-center py-6">
                            <div className="relative h-[245px] w-[320px]">
                                <div className="absolute left-1/2 top-9 h-28 w-44 -translate-x-1/2 rounded-[50%] bg-white/[0.055]" />

                                <Sparkles className="absolute left-8 top-20 h-5 w-5 text-[#E4BB56]" />
                                <Sparkles className="absolute right-8 top-10 h-3.5 w-3.5 text-[#C9951A]/70" />

                                <div className="absolute bottom-8 left-4 flex h-20 w-14 items-end justify-center">
                                    <div className="absolute bottom-0 h-14 w-1.5 rounded-full bg-[#765B91]" />
                                    <div className="absolute bottom-9 left-2 h-8 w-4 -rotate-[38deg] rounded-full bg-[#654B84]" />
                                    <div className="absolute bottom-6 right-1 h-8 w-4 rotate-[38deg] rounded-full bg-[#765B91]" />
                                    <div className="absolute bottom-1 h-5 w-10 rounded-b-lg rounded-t-sm bg-[#5A3C78]" />
                                </div>

                                <div className="absolute bottom-8 right-3 flex h-28 w-20 items-end justify-center">
                                    <div className="absolute bottom-2 h-20 w-1.5 rounded-full bg-[#806799]" />
                                    <div className="absolute bottom-16 left-3 h-10 w-5 -rotate-[42deg] rounded-full bg-[#695185]" />
                                    <div className="absolute bottom-12 right-2 h-12 w-6 rotate-[34deg] rounded-full bg-[#7E6795]" />
                                    <div className="absolute bottom-5 left-6 h-10 w-5 -rotate-[28deg] rounded-full bg-[#5E447B]" />
                                    <div className="absolute bottom-0 h-6 w-12 rounded-b-lg rounded-t-sm bg-[#5A3C78]" />
                                </div>

                                <div className="absolute bottom-10 left-1/2 h-[132px] w-[176px] -translate-x-1/2">
                                    <div className="absolute bottom-0 left-3 right-3 h-[104px] rounded-t-md border border-white/10 bg-[#E8DDF1]/90 shadow-[0_18px_38px_rgba(12,4,24,0.28)]" />

                                    <div className="absolute left-0 right-0 top-2 h-12 overflow-hidden rounded-t-xl bg-[#6F5294]">
                                        <div className="absolute inset-x-0 bottom-0 flex h-7">
                                            {Array.from({ length: 6 }).map((_, index) => (
                                                <span
                                                    key={index}
                                                    className={[
                                                        "h-full flex-1 rounded-b-full",
                                                        index % 2 === 0
                                                            ? "bg-[#F6F0FA]"
                                                            : "bg-[#8B70AA]",
                                                    ].join(" ")}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="absolute bottom-4 left-1/2 h-[65px] w-12 -translate-x-1/2 rounded-t-sm border-2 border-[#6F5790] bg-[#4B3468]">
                                        <div className="absolute left-1/2 top-4 h-2 w-2 -translate-x-1/2 rounded-full bg-[#C9951A]" />
                                        <div className="absolute bottom-2 left-1/2 h-6 w-7 -translate-x-1/2 rounded-sm bg-[#5F477A]" />
                                    </div>

                                    <div className="absolute bottom-6 left-6 flex h-12 w-11 items-center justify-center rounded-sm border-2 border-[#745B91] bg-[#5E447A] text-[#CDBDDB]">
                                        <Package className="h-5 w-5" />
                                    </div>

                                    <div className="absolute bottom-6 right-6 flex h-12 w-11 items-center justify-center rounded-sm border-2 border-[#745B91] bg-[#5E447A] text-[#CDBDDB]">
                                        <Store className="h-5 w-5" />
                                    </div>
                                </div>

                                <div className="absolute bottom-2 right-8 flex h-[74px] w-[74px] items-center justify-center rounded-full border-[7px] border-[#F8EAC4] bg-[#E5C477] text-white shadow-[0_18px_34px_rgba(13,5,26,0.34)]">
                                    <Check className="h-9 w-9 stroke-[3]" />
                                </div>
                            </div>
                        </div>

                        <div className="relative z-10 border-y border-white/10 py-5 text-center">
                            <p className="font-serif text-xs leading-5 text-white/70">
                                “Mas madali na ang buhay ko.
                                <br />
                                Everything is in one place.”
                            </p>
                        </div>
                    </div>

                    <div className="max-h-[94vh] overflow-y-auto p-6 sm:p-8 md:p-10">
                        <div className="mb-7 flex items-center gap-3 md:hidden">
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

                        {!setupComplete && (
                            <>
                                <h1 className="pr-10 font-serif text-3xl text-[#1A1220] sm:text-4xl">
                                    {headerTitle}
                                </h1>

                                <p className="mt-2 text-sm leading-6 text-[#7A6E88]">
                                    {headerDescription}
                                </p>
                            </>
                        )}

                        {mode === "signup" && !setupComplete && (
                            <OnboardingProgress currentStep={signupStep} />
                        )}

                        {mode === "login" && (
                            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                                <TextInput
                                    label="Email address"
                                    placeholder="you@yourbusiness.com"
                                    value={email}
                                    onChange={setEmail}
                                    icon={
                                        <Mail className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Password"
                                    placeholder="Enter your password"
                                    type="password"
                                    value={password}
                                    onChange={setPassword}
                                    icon={
                                        <Lock className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <div className="flex items-center justify-between text-sm">
                                    <label className="flex items-center gap-2 text-[#7A6E88]">
                                        <input type="checkbox" />
                                        Remember me
                                    </label>

                                    <button
                                        type="button"
                                        className="font-medium text-[#2D1B4E]"
                                    >
                                        Forgot password?
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white transition hover:bg-[#3D2560] disabled:opacity-60"
                                >
                                    {loading
                                        ? "Please wait..."
                                        : "Log in to StockNBook"}
                                </button>
                            </form>
                        )}

                        {mode === "signup" && signupStep === 1 && !setupComplete && (
                            <form
                                className="mt-6 space-y-4"
                                onSubmit={handleSubmit}
                            >
                                {accountVerified && (
                                    <div className="flex items-start gap-3 rounded-xl border border-[#DDE8D7] bg-[#F4FAF1] px-4 py-3">
                                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#3B6D11]" />
                                        <p className="text-sm leading-6 text-[#466436]">
                                            Your account is already verified. The
                                            fields below are locked while you finish
                                            business setup.
                                        </p>
                                    </div>
                                )}

                                <TextInput
                                    label="Owner name"
                                    placeholder="e.g. Maria Santos"
                                    value={ownerName}
                                    onChange={setOwnerName}
                                    disabled={accountVerified}
                                    icon={
                                        <UserRound className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Business name"
                                    placeholder="e.g. Santos Events & Party Supply"
                                    value={storeName}
                                    onChange={setStoreName}
                                    disabled={accountVerified}
                                    icon={
                                        <Package className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Phone number"
                                    placeholder="9XX XXX XXXX"
                                    value={phone}
                                    onChange={setPhone}
                                    disabled={accountVerified}
                                    icon={
                                        <Phone className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Email address"
                                    placeholder="you@yourbusiness.com"
                                    value={email}
                                    onChange={setEmail}
                                    disabled={accountVerified}
                                    icon={
                                        <Mail className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Password"
                                    placeholder="Create a password"
                                    type="password"
                                    value={password}
                                    onChange={setPassword}
                                    disabled={accountVerified}
                                    icon={
                                        <Lock className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Confirm password"
                                    placeholder="Repeat your password"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={setConfirmPassword}
                                    disabled={accountVerified}
                                    icon={
                                        <Lock className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <div className="rounded-xl border border-[#E8E0EE] bg-[#FBF9FD] p-4">
                                    <p className="text-xs leading-5 text-[#7A6E88]">
                                        View both documents before the agreement
                                        checkbox becomes available.
                                    </p>

                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <button
                                            type="button"
                                            disabled={accountVerified}
                                            onClick={() =>
                                                setLegalDocument("terms")
                                            }
                                            className={[
                                                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
                                                hasViewedTerms
                                                    ? "border-[#D7E8CE] bg-[#F4FAF1] text-[#466436]"
                                                    : "border-[#D9D0E2] bg-white text-[#2D1B4E] hover:border-[#C9951A]",
                                            ].join(" ")}
                                        >
                                            <span>Terms of Service</span>
                                            {hasViewedTerms && (
                                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            disabled={accountVerified}
                                            onClick={() =>
                                                setLegalDocument("privacy")
                                            }
                                            className={[
                                                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
                                                hasViewedPrivacy
                                                    ? "border-[#D7E8CE] bg-[#F4FAF1] text-[#466436]"
                                                    : "border-[#D9D0E2] bg-white text-[#2D1B4E] hover:border-[#C9951A]",
                                            ].join(" ")}
                                        >
                                            <span>Privacy Policy</span>
                                            {hasViewedPrivacy && (
                                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                            )}
                                        </button>
                                    </div>

                                    <label
                                        className={[
                                            "mt-4 flex items-start gap-2 text-sm",
                                            hasViewedTerms &&
                                            hasViewedPrivacy &&
                                            !accountVerified
                                                ? "cursor-pointer text-[#7A6E88]"
                                                : "cursor-not-allowed text-[#AAA1B0]",
                                        ].join(" ")}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={hasAcceptedPolicies}
                                            disabled={
                                                !hasViewedTerms ||
                                                !hasViewedPrivacy ||
                                                accountVerified
                                            }
                                            onChange={(event) =>
                                                setHasAcceptedPolicies(
                                                    event.target.checked
                                                )
                                            }
                                            className="mt-1 h-4 w-4 accent-[#2D1B4E] disabled:cursor-not-allowed"
                                        />

                                        <span>
                                            I agree to the{" "}
                                            <span className="font-medium text-[#2D1B4E]">
                                                Terms of Service
                                            </span>{" "}
                                            and{" "}
                                            <span className="font-medium text-[#2D1B4E]">
                                                Privacy Policy
                                            </span>
                                        </span>
                                    </label>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white transition hover:bg-[#3D2560] disabled:opacity-60"
                                >
                                    <span>
                                        {loading
                                            ? "Please wait..."
                                            : accountVerified
                                                ? "Continue to branches"
                                                : "Continue"}
                                    </span>

                                    {!loading && (
                                        <ArrowRight className="h-4 w-4" />
                                    )}
                                </button>
                            </form>
                        )}

                        {mode === "signup" && signupStep === 2 && !setupComplete && (
                            <div className="mt-6">
                                <div className="space-y-4">
                                    {branches.map((branch, index) => (
                                        <div
                                            key={index}
                                            className="rounded-2xl border border-[#E9E0D4] bg-[#FFFCF7] p-4 sm:p-5"
                                        >
                                            <div className="mb-4 flex items-center justify-between gap-4">
                                                <h3 className="font-semibold text-[#2D1B4E]">
                                                    Branch {index + 1}
                                                </h3>

                                                {branches.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            removeBranch(index)
                                                        }
                                                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8F4960] transition hover:text-red-600"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                        Remove
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <TextInput
                                                    label="Branch name"
                                                    placeholder="e.g. Main Branch"
                                                    value={branch.branch_name}
                                                    onChange={(value) =>
                                                        updateBranch(
                                                            index,
                                                            "branch_name",
                                                            value
                                                        )
                                                    }
                                                    icon={
                                                        <Package className="h-4 w-4 text-[#7A6E88]" />
                                                    }
                                                />

                                                <TextInput
                                                    label="Contact number"
                                                    placeholder="09XX XXX XXXX"
                                                    value={branch.contact_number}
                                                    onChange={(value) =>
                                                        updateBranch(
                                                            index,
                                                            "contact_number",
                                                            value
                                                        )
                                                    }
                                                    icon={
                                                        <Phone className="h-4 w-4 text-[#7A6E88]" />
                                                    }
                                                />
                                            </div>

                                            <TextInput
                                                label="Address"
                                                placeholder="e.g. Concepcion Uno, Marikina City"
                                                value={branch.address}
                                                onChange={(value) =>
                                                    updateBranch(
                                                        index,
                                                        "address",
                                                        value
                                                    )
                                                }
                                                icon={
                                                    <MapPin className="h-4 w-4 text-[#7A6E88]" />
                                                }
                                            />
                                        </div>
                                    ))}
                                </div>

                                <button
                                    type="button"
                                    onClick={addBranch}
                                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#CFC3D8] bg-white px-4 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:border-[#7B58A8] hover:bg-[#FBF8FD]"
                                >
                                    <Plus className="h-4 w-4" />
                                    Add another branch
                                </button>

                                <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#EEDFC0] bg-[#FFFAEF] px-4 py-3 text-xs leading-5 text-[#766342]">
                                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#C9951A]" />
                                    You can always add more branches later from
                                    the Branches page.
                                </div>

                                <div className="mt-6 grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSignupStep(1)}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#D6CCDE] bg-white px-5 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF]"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Back
                                    </button>

                                    <button
                                        type="button"
                                        onClick={continueToManagers}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3D2560]"
                                    >
                                        Continue
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {mode === "signup" && signupStep === 3 && !setupComplete && (
                            <div className="mt-6 space-y-5">
                                {branches.map((branch, index) => (
                                    <div
                                        key={index}
                                        className="rounded-2xl border border-[#E9E0D4] bg-[#FFFCF7] p-4 sm:p-5"
                                    >
                                        <div>
                                            <h3 className="text-lg font-semibold text-[#1A1220]">
                                                Who will manage{" "}
                                                {branch.branch_name ||
                                                    `Branch ${index + 1}`}
                                                ?
                                            </h3>
                                            <p className="mt-1 text-xs leading-5 text-[#7A6E88]">
                                                You can change the manager and
                                                permissions anytime.
                                            </p>
                                        </div>

                                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    updateManagerMode(
                                                        index,
                                                        "owner"
                                                    )
                                                }
                                                className={[
                                                    "rounded-xl border p-4 text-left transition",
                                                    branch.manager_mode === "owner"
                                                        ? "border-[#6D42A5] bg-[#F8F3FF] ring-2 ring-[#6D42A5]/10"
                                                        : "border-[#E3DBE8] bg-white hover:border-[#BFAED0]",
                                                ].join(" ")}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0E8FA] text-[#5B35A5]">
                                                        <UserRound className="h-4 w-4" />
                                                    </span>
                                                    <div>
                                                        <p className="text-sm font-semibold text-[#1A1220]">
                                                            I will manage this
                                                            branch
                                                        </p>
                                                        <p className="mt-1 text-xs leading-5 text-[#7A6E88]">
                                                            The owner keeps full
                                                            access to this branch.
                                                        </p>
                                                    </div>
                                                </div>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    updateManagerMode(
                                                        index,
                                                        "invite"
                                                    )
                                                }
                                                className={[
                                                    "rounded-xl border p-4 text-left transition",
                                                    branch.manager_mode === "invite"
                                                        ? "border-[#6D42A5] bg-[#F8F3FF] ring-2 ring-[#6D42A5]/10"
                                                        : "border-[#E3DBE8] bg-white hover:border-[#BFAED0]",
                                                ].join(" ")}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0E8FA] text-[#5B35A5]">
                                                        <Users className="h-4 w-4" />
                                                    </span>
                                                    <div>
                                                        <p className="text-sm font-semibold text-[#1A1220]">
                                                            Invite a branch manager
                                                        </p>
                                                        <p className="mt-1 text-xs leading-5 text-[#7A6E88]">
                                                            Keep the existing
                                                            invitation-link flow.
                                                        </p>
                                                    </div>
                                                </div>
                                            </button>
                                        </div>

                                        {branch.manager_mode === "invite" && (
                                            <div className="mt-5">
                                                <div className="grid gap-4 sm:grid-cols-2">
                                                    <TextInput
                                                        label="Manager name"
                                                        placeholder="e.g. Ana Cruz"
                                                        value={branch.manager_name}
                                                        onChange={(value) =>
                                                            updateBranch(
                                                                index,
                                                                "manager_name",
                                                                value
                                                            )
                                                        }
                                                        icon={
                                                            <UserRound className="h-4 w-4 text-[#7A6E88]" />
                                                        }
                                                    />

                                                    <TextInput
                                                        label="Manager email"
                                                        placeholder="manager@email.com"
                                                        type="email"
                                                        value={branch.manager_email}
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

                                                <div className="mt-1">
                                                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6E88]">
                                                        Access level
                                                    </p>

                                                    <div className="grid gap-2 sm:grid-cols-2">
                                                        {permissionLabels.map(
                                                            (permission) => (
                                                                <AccessToggle
                                                                    key={
                                                                        permission.key
                                                                    }
                                                                    label={
                                                                        permission.label
                                                                    }
                                                                    checked={
                                                                        branch
                                                                            .permissions[
                                                                            permission
                                                                                .key
                                                                            ]
                                                                    }
                                                                    onChange={(
                                                                        checked
                                                                    ) =>
                                                                        updatePermission(
                                                                            index,
                                                                            permission.key,
                                                                            checked
                                                                        )
                                                                    }
                                                                />
                                                            )
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                <div className="flex items-start gap-2 rounded-xl border border-[#EEDFC0] bg-[#FFFAEF] px-4 py-3 text-xs leading-5 text-[#766342]">
                                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#C9951A]" />
                                    Manager invitation links and the selected
                                    feature access remain available after setup.
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSignupStep(2)}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#D6CCDE] bg-white px-5 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF]"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Back
                                    </button>

                                    <button
                                        type="button"
                                        onClick={continueToReview}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3D2560]"
                                    >
                                        Continue
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {mode === "signup" && signupStep === 4 && !setupComplete && (
                            <div className="mt-6">
                                <div className="rounded-2xl border border-[#E9E0D4] bg-[#FFFCF7]">
                                    <div className="border-b border-[#E9E0D4] p-4 sm:p-5">
                                        <div className="flex items-center gap-2">
                                            <Package className="h-4 w-4 text-[#C9951A]" />
                                            <h3 className="text-sm font-semibold text-[#2D1B4E]">
                                                Business information
                                            </h3>
                                        </div>

                                        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[130px_1fr]">
                                            <dt className="font-medium text-[#6F6577]">
                                                Owner name
                                            </dt>
                                            <dd className="text-[#1A1220]">
                                                {ownerName}
                                            </dd>

                                            <dt className="font-medium text-[#6F6577]">
                                                Business name
                                            </dt>
                                            <dd className="text-[#1A1220]">
                                                {storeName}
                                            </dd>

                                            <dt className="font-medium text-[#6F6577]">
                                                Phone number
                                            </dt>
                                            <dd className="text-[#1A1220]">
                                                {phone}
                                            </dd>

                                            <dt className="font-medium text-[#6F6577]">
                                                Email address
                                            </dt>
                                            <dd className="break-all text-[#1A1220]">
                                                {email}
                                            </dd>
                                        </dl>
                                    </div>

                                    <div className="p-4 sm:p-5">
                                        <h3 className="text-sm font-semibold text-[#2D1B4E]">
                                            Branches ({branches.length})
                                        </h3>

                                        <div className="mt-4 space-y-3">
                                            {branches.map((branch, index) => {
                                                const enabledPermissions =
                                                    permissionLabels.filter(
                                                        (permission) =>
                                                            branch.permissions[
                                                                permission.key
                                                                ]
                                                    );

                                                return (
                                                    <div
                                                        key={index}
                                                        className="rounded-xl border border-[#E7DFE9] bg-white p-4"
                                                    >
                                                        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                                                            <div>
                                                                <p className="font-semibold text-[#1A1220]">
                                                                    {
                                                                        branch.branch_name
                                                                    }
                                                                </p>

                                                                <div className="mt-2 space-y-1.5 text-xs text-[#6F6577]">
                                                                    <p className="flex items-center gap-2">
                                                                        <Phone className="h-3.5 w-3.5" />
                                                                        {
                                                                            branch.contact_number
                                                                        }
                                                                    </p>
                                                                    <p className="flex items-start gap-2">
                                                                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                                                        {
                                                                            branch.address
                                                                        }
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            <div className="sm:min-w-[170px]">
                                                                {branch.manager_mode ===
                                                                "owner" ? (
                                                                    <span className="inline-flex rounded-full bg-[#EEF7E9] px-3 py-1 text-xs font-semibold text-[#466436]">
                                                                        Managed by
                                                                        owner
                                                                    </span>
                                                                ) : (
                                                                    <>
                                                                        <p className="text-xs font-semibold text-[#1A1220]">
                                                                            {
                                                                                branch.manager_name
                                                                            }
                                                                        </p>
                                                                        <p className="mt-1 break-all text-xs text-[#7A6E88]">
                                                                            {
                                                                                branch.manager_email
                                                                            }
                                                                        </p>
                                                                        <div className="mt-3">
                                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7A6E88]">
                                                                                Enabled features
                                                                            </p>

                                                                            <div className="mt-2 flex max-w-[280px] flex-wrap gap-1.5">
                                                                                {enabledPermissions.map(
                                                                                    (
                                                                                        permission
                                                                                    ) => (
                                                                                        <span
                                                                                            key={
                                                                                                permission.key
                                                                                            }
                                                                                            className="inline-flex items-center gap-1 rounded-full bg-[#F0E8FA] px-2.5 py-1 text-[11px] font-semibold text-[#5B35A5]"
                                                                                        >
                                                                                            <Check className="h-3 w-3" />
                                                                                            {
                                                                                                permission.label
                                                                                            }
                                                                                        </span>
                                                                                    )
                                                                                )}
                                                                            </div>

                                                                            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-[#6F6577]">
                                                                                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6F45B8]" />
                                                                                The manager invitation link will be emailed automatically after setup.
                                                                            </p>
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#EEDFC0] bg-[#FFFAEF] px-4 py-3 text-xs leading-5 text-[#766342]">
                                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#C9951A]" />
                                    Branches will be created, invitation links will
                                    be generated, and the system will request the
                                    onboarding API to email each invited manager
                                    automatically.
                                </div>

                                <div className="mt-6 grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setSignupStep(3)}
                                        disabled={setupLoading}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#D6CCDE] bg-white px-5 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF] disabled:opacity-60"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Back
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleCreateBusinessSetup}
                                        disabled={setupLoading}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D1B4E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3D2560] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {setupLoading
                                            ? "Creating setup..."
                                            : "Create branches & send invitations"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {mode === "signup" && setupComplete && (
                            <div className="py-4 text-center sm:py-8">
                                <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#F3ECFA]">
                                    <div className="relative">
                                        <PartyPopper className="h-12 w-12 text-[#6F45B8]" />
                                        <CheckCircle2 className="absolute -bottom-2 -right-4 h-10 w-10 rounded-full bg-white text-[#3E9A5F]" />
                                    </div>
                                </div>

                                <h1 className="mt-6 font-serif text-3xl text-[#1A1220] sm:text-4xl">
                                    Your business is ready!
                                </h1>

                                <p className="mt-3 text-sm font-semibold text-[#2D1B4E]">
                                    {branches.length}{" "}
                                    {branches.length === 1
                                        ? "branch was"
                                        : "branches were"}{" "}
                                    created successfully.
                                </p>

                                <p className="mt-1 text-sm text-[#7A6E88]">
                                    {invitationEmailSummary.requested === 0
                                        ? "No manager invitation was required."
                                        : invitationEmailSummary.backendConfirmed &&
                                        invitationEmailSummary.sent ===
                                        invitationEmailSummary.requested
                                            ? `${invitationEmailSummary.sent} manager invitation ${
                                                invitationEmailSummary.sent === 1
                                                    ? "email was"
                                                    : "emails were"
                                            } sent automatically.`
                                            : invitationEmailSummary.backendConfirmed
                                                ? `${invitationEmailSummary.sent} of ${invitationEmailSummary.requested} manager invitation emails were sent. The invitation links remain available below as a backup.`
                                                : "Manager invitation links were created. Email delivery is waiting for confirmation from the onboarding API."}
                                </p>

                                <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-[#E9E0D4] bg-[#FFFCF7] p-5 text-left">
                                    <h3 className="text-sm font-semibold text-[#1A1220]">
                                        What&apos;s next?
                                    </h3>

                                    <div className="mt-4 space-y-3 text-sm text-[#5F556A]">
                                        {[
                                            "Add products and manage inventory",
                                            "Create packages and accept bookings",
                                            "Invite staff and start managing your business",
                                        ].map((item) => (
                                            <p
                                                key={item}
                                                className="flex items-start gap-2"
                                            >
                                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3E9A5F]" />
                                                {item}
                                            </p>
                                        ))}
                                    </div>
                                </div>

                                {inviteLinks.length > 0 && (
                                    <div className="mx-auto mt-5 max-w-lg space-y-3 text-left">
                                        <h3 className="text-sm font-semibold text-[#2D1B4E]">
                                            Manager invitation links
                                        </h3>

                                        {inviteLinks.map((invite, index) => (
                                            <div
                                                key={`${invite.manager_email}-${index}`}
                                                className="rounded-xl border border-[#E7DFE9] bg-white p-4"
                                            >
                                                <p className="text-sm font-semibold text-[#1A1220]">
                                                    {invite.manager_name ||
                                                        "Manager"}{" "}
                                                    — {invite.branch_name}
                                                </p>
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    <p className="break-all text-xs text-[#7A6E88]">
                                                        {invite.manager_email}
                                                    </p>

                                                    {(invite.email_sent === true ||
                                                        String(
                                                            invite.email_status ||
                                                            ""
                                                        ).toLowerCase() ===
                                                        "sent") && (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF7E9] px-2 py-1 text-[10px] font-semibold text-[#466436]">
                                                            <Check className="h-3 w-3" />
                                                            Email sent
                                                        </span>
                                                    )}

                                                    {(invite.email_sent === false ||
                                                        String(
                                                            invite.email_status ||
                                                            ""
                                                        ).toLowerCase() ===
                                                        "failed") && (
                                                        <span className="inline-flex rounded-full bg-[#FFF0F0] px-2 py-1 text-[10px] font-semibold text-red-600">
                                                            Email failed
                                                        </span>
                                                    )}
                                                </div>

                                                {invite.email_error && (
                                                    <p className="mt-2 text-xs leading-5 text-red-600">
                                                        {invite.email_error}
                                                    </p>
                                                )}

                                                <div className="mt-3 flex gap-2">
                                                    <input
                                                        readOnly
                                                        value={invite.invite_link}
                                                        className="min-w-0 flex-1 rounded-lg border border-[#EBE4F0] bg-[#FAF8FC] px-3 py-2 text-xs text-[#7A6E88]"
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
                                        ))}
                                    </div>
                                )}

                                <div className="mx-auto mt-6 grid max-w-lg gap-3">
                                    <button
                                        type="button"
                                        onClick={handleOpenDashboard}
                                        className="rounded-xl bg-[#2D1B4E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3D2560]"
                                    >
                                        Go to Dashboard
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleOpenBranches}
                                        className="rounded-xl border border-[#2D1B4E] bg-white px-5 py-3 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF]"
                                    >
                                        View Branches
                                    </button>
                                </div>
                            </div>
                        )}

                        {!setupComplete && (
                            <p className="mt-6 text-center text-sm text-[#7A6E88]">
                                {mode === "login"
                                    ? "Don't have an account?"
                                    : "Already have an account?"}{" "}
                                <button
                                    type="button"
                                    onClick={handleSwitchMode}
                                    className="font-semibold text-[#2D1B4E]"
                                >
                                    {mode === "login"
                                        ? "Sign up free"
                                        : "Log in"}
                                </button>
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {legalDocument && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-[#160C27]/65 px-4 backdrop-blur-sm"
                    onMouseDown={() => setLegalDocument(null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="legal-document-title"
                        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-[#EBE4F0] px-6 py-5">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#C9951A]">
                                    StockNBook
                                </p>

                                <h2
                                    id="legal-document-title"
                                    className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#1A1220]"
                                >
                                    {legalDocument === "terms"
                                        ? "Terms of Service"
                                        : "Privacy Policy"}
                                </h2>
                            </div>

                            <button
                                type="button"
                                onClick={() => setLegalDocument(null)}
                                aria-label="Close legal document"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#7A6E88] transition hover:bg-[#F3EFF8] hover:text-[#2D1B4E]"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="max-h-[55vh] overflow-y-auto px-6 py-5 text-sm leading-7 text-[#6F6577]">
                            {legalDocument === "terms" ? (
                                <div className="space-y-4">
                                    <p>
                                        By creating and using a StockNBook account,
                                        you agree to provide accurate registration
                                        and business information and to keep your
                                        login credentials secure.
                                    </p>

                                    <p>
                                        You are responsible for the bookings,
                                        inventory, sales, scheduled orders, customer
                                        details, staff permissions, and other
                                        records entered through your account.
                                    </p>

                                    <p>
                                        StockNBook is a business-management and
                                        record-keeping platform. It does not replace
                                        professional legal, tax, accounting, or
                                        regulatory advice.
                                    </p>

                                    <p>
                                        Access may be limited or suspended when the
                                        platform is misused, security is threatened,
                                        or applicable rules are violated.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <p>
                                        StockNBook processes account and business
                                        information needed to provide login,
                                        bookings, inventory, sales, scheduled
                                        orders, staff access, reports, and
                                        subscription services.
                                    </p>

                                    <p>
                                        Information should only be accessed by
                                        authorized account owners, managers, and
                                        staff members according to their assigned
                                        permissions.
                                    </p>

                                    <p>
                                        Users are responsible for entering customer
                                        and business information only when they have
                                        an appropriate reason and permission to do
                                        so.
                                    </p>

                                    <p>
                                        Account and business information is used to
                                        operate, secure, maintain, and improve the
                                        StockNBook service.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-[#EBE4F0] px-6 py-5 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setLegalDocument(null)}
                                className="h-11 rounded-xl border border-[#D4CBDD] bg-white px-5 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF]"
                            >
                                Close
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (legalDocument === "terms") {
                                        setHasViewedTerms(true);
                                    } else {
                                        setHasViewedPrivacy(true);
                                    }

                                    setLegalDocument(null);
                                }}
                                className="h-11 rounded-xl bg-[#2D1B4E] px-5 text-sm font-semibold text-white transition hover:bg-[#3D2560]"
                            >
                                I have read this document
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {otpDialogOpen && (
                <SignupOtpDialog
                    email={pendingSignup?.email || email}
                    otp={otp}
                    setOtp={setOtp}
                    timer={otpTimer}
                    loading={otpLoading}
                    onVerify={handleVerifyOtp}
                    onResend={handleResendOtp}
                    onClose={() => setOtpDialogOpen(false)}
                />
            )}
        </>
    );
}

function OnboardingProgress({ currentStep }: { currentStep: number }) {
    const steps = [
        { number: 1, label: "Business info" },
        { number: 2, label: "Branches" },
        { number: 3, label: "Managers (optional)" },
        { number: 4, label: "Review" },
    ];

    return (
        <div className="mt-6 rounded-2xl border border-[#EEE7F2] bg-[#FCFAFD] px-3 py-4 sm:px-5">
            <div className="grid grid-cols-4">
                {steps.map((step, index) => {
                    const isActive = step.number === currentStep;
                    const isComplete = step.number < currentStep;

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
                                            : "bg-[#DED7E4]",
                                    ].join(" ")}
                                />
                            )}

                            <div
                                className={[
                                    "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition",
                                    isActive
                                        ? "border-[#2D1B4E] bg-[#2D1B4E] text-white shadow-[0_5px_14px_rgba(45,27,78,0.22)]"
                                        : isComplete
                                            ? "border-[#6A469C] bg-[#6A469C] text-white"
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
                                    "mt-2 block max-w-[92px] text-[10px] font-medium leading-4 sm:text-[11px]",
                                    isActive || isComplete
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

function SignupOtpDialog({
                             email,
                             otp,
                             setOtp,
                             timer,
                             loading,
                             onVerify,
                             onResend,
                             onClose,
                         }: {
    email: string;
    otp: string;
    setOtp: (value: string) => void;
    timer: number;
    loading: boolean;
    onVerify: () => void;
    onResend: () => void;
    onClose: () => void;
}) {
    const inputRefs =
        useRef<Array<HTMLInputElement | null>>([]);
    const isExpired = timer <= 0;
    const otpDigits = Array.from(
        { length: 6 },
        (_, index) => otp[index] || ""
    );

    useEffect(() => {
        if (!isExpired && !loading) {
            window.setTimeout(() => {
                inputRefs.current[0]?.focus();
            }, 50);
        }
    }, [isExpired, loading]);

    const formattedTimer = `${String(
        Math.floor(timer / 60)
    ).padStart(2, "0")}:${String(timer % 60).padStart(
        2,
        "0"
    )}`;

    const updateDigit = (
        index: number,
        value: string
    ) => {
        if (isExpired || loading) return;

        const digit = value
            .replace(/\D/g, "")
            .slice(-1);
        const nextDigits = [...otpDigits];

        nextDigits[index] = digit;
        setOtp(nextDigits.join("").slice(0, 6));

        if (digit && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleDigitKeyDown = (
        index: number,
        event: React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (event.key === "Backspace") {
            if (otpDigits[index]) {
                const nextDigits = [...otpDigits];
                nextDigits[index] = "";
                setOtp(nextDigits.join(""));
                return;
            }

            if (index > 0) {
                inputRefs.current[index - 1]?.focus();

                const nextDigits = [...otpDigits];
                nextDigits[index - 1] = "";
                setOtp(nextDigits.join(""));
            }
        }

        if (
            event.key === "ArrowLeft" &&
            index > 0
        ) {
            inputRefs.current[index - 1]?.focus();
        }

        if (
            event.key === "ArrowRight" &&
            index < 5
        ) {
            inputRefs.current[index + 1]?.focus();
        }

        if (
            event.key === "Enter" &&
            otp.length === 6 &&
            !isExpired
        ) {
            onVerify();
        }
    };

    const handlePaste = (
        event: React.ClipboardEvent<HTMLInputElement>
    ) => {
        if (isExpired || loading) return;

        event.preventDefault();

        const pastedOtp = event.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, 6);

        if (!pastedOtp) return;

        setOtp(pastedOtp);

        const focusIndex =
            Math.min(pastedOtp.length, 6) - 1;

        inputRefs.current[
            Math.max(0, focusIndex)
            ]?.focus();
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signup-otp-title"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#160C27]/65 px-4 py-6 backdrop-blur-md"
        >
            <div className="relative w-full max-w-[430px] overflow-hidden rounded-[28px] border border-white/70 bg-white px-7 pb-7 pt-8 text-center shadow-[0_28px_80px_rgba(22,12,39,0.32)] sm:px-9">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    aria-label="Close OTP verification"
                    className="absolute right-4 top-4 rounded-full p-2 text-[#7A6E88] transition hover:bg-[#F3EFF8] hover:text-[#2D1B4E] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="relative mx-auto flex h-[86px] w-[86px] items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-[#EEE5FF]" />
                    <div className="absolute inset-[11px] rounded-full bg-[#DCCBFF]" />

                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#2D1B4E] text-white shadow-lg">
                        <Mail className="h-7 w-7" />
                    </div>

                    <Sparkles className="absolute -right-1 top-1 h-4 w-4 text-[#C9951A]" />
                    <Sparkles className="absolute -left-1 bottom-3 h-3.5 w-3.5 text-[#C9951A]" />
                </div>

                <h2
                    id="signup-otp-title"
                    className="mt-4 font-serif text-[32px] font-semibold leading-tight text-[#2D1B4E]"
                >
                    Verify your email
                </h2>

                <p className="mt-2 text-sm leading-6 text-[#7A6E88]">
                    We&apos;ve sent a 6-digit verification
                    code to
                </p>

                <p className="mt-0.5 break-all text-sm font-bold text-[#2D1B4E]">
                    {email}
                </p>

                <div className="mt-6 flex justify-center gap-2 sm:gap-3">
                    {otpDigits.map((digit, index) => (
                        <input
                            key={index}
                            ref={(element) => {
                                inputRefs.current[index] =
                                    element;
                            }}
                            value={digit}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete={
                                index === 0
                                    ? "one-time-code"
                                    : "off"
                            }
                            maxLength={1}
                            disabled={
                                loading || isExpired
                            }
                            aria-label={`OTP digit ${
                                index + 1
                            }`}
                            onChange={(event) =>
                                updateDigit(
                                    index,
                                    event.target.value
                                )
                            }
                            onKeyDown={(event) =>
                                handleDigitKeyDown(
                                    index,
                                    event
                                )
                            }
                            onPaste={handlePaste}
                            onFocus={(event) =>
                                event.target.select()
                            }
                            className={[
                                "h-14 w-11 rounded-xl border bg-white text-center text-2xl font-bold text-[#2D1B4E] outline-none transition sm:w-12",
                                "focus:border-[#6F45B8] focus:ring-4 focus:ring-[#6F45B8]/15",
                                digit
                                    ? "border-[#B99AEF] shadow-sm"
                                    : "border-[#DED3EE]",
                                isExpired
                                    ? "cursor-not-allowed bg-[#F7F4FA] text-[#A79CAF]"
                                    : "",
                            ].join(" ")}
                        />
                    ))}
                </div>

                <div
                    className={[
                        "mx-auto mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
                        isExpired
                            ? "bg-red-50 text-red-600"
                            : "bg-[#F1E9FF] text-[#6F45B8]",
                    ].join(" ")}
                >
                    <Clock3 className="h-4 w-4" />

                    {isExpired ? (
                        <span>Code expired</span>
                    ) : (
                        <span>
                            Code expires in{" "}
                            {formattedTimer}
                        </span>
                    )}
                </div>

                {isExpired && (
                    <p className="mt-3 text-xs leading-5 text-red-600">
                        This OTP is no longer valid. Please
                        resend a new code.
                    </p>
                )}

                <button
                    type="button"
                    disabled={
                        loading ||
                        isExpired ||
                        !/^\d{6}$/.test(otp)
                    }
                    onClick={onVerify}
                    className="mt-6 w-full rounded-xl bg-[#3B1768] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(59,23,104,0.22)] transition hover:bg-[#4B2180] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loading
                        ? "Verifying..."
                        : "Verify Account"}
                </button>

                <div className="mt-6 flex items-center gap-3">
                    <div className="h-px flex-1 bg-[#EBE4F0]" />

                    <span className="text-xs text-[#7A6E88]">
                        Didn&apos;t receive the code?
                    </span>

                    <div className="h-px flex-1 bg-[#EBE4F0]" />
                </div>

                <button
                    type="button"
                    disabled={loading || !isExpired}
                    onClick={onResend}
                    className="mx-auto mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-[#6F35C5] transition hover:bg-[#F5EFFF] disabled:cursor-not-allowed disabled:text-[#B9AFCA] disabled:hover:bg-transparent"
                >
                    <RefreshCw
                        className={[
                            "h-4 w-4",
                            loading ? "animate-spin" : "",
                        ].join(" ")}
                    />

                    {loading
                        ? "Sending..."
                        : isExpired
                            ? "Resend OTP"
                            : `Resend available in ${formattedTimer}`}
                </button>

                <div className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-[#FAF8FC] px-4 py-3 text-xs text-[#7A6E88]">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-[#6F45B8]" />

                    <span>
                        For your security, never share this
                        code with anyone.
                    </span>
                </div>
            </div>
        </div>
    );
}


function TextInput({
                       label,
                       placeholder,
                       type = "text",
                       value,
                       onChange,
                       icon,
                       disabled = false,
                   }: {
    label: string;
    placeholder: string;
    type?: string;
    value?: string;
    onChange?: (value: string) => void;
    icon?: React.ReactNode;
    disabled?: boolean;
}) {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);

    const isPasswordField = type === "password";
    const resolvedType =
        isPasswordField && isPasswordVisible ? "text" : type;

    return (
        <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>

            <div
                className={[
                    "flex items-center gap-3 rounded-lg border px-4 py-3 transition",
                    disabled
                        ? "border-[#EEE8F1] bg-[#F7F4F8]"
                        : "border-[#EBE4F0] bg-white focus-within:border-[#2D1B4E] focus-within:ring-4 focus-within:ring-[#2D1B4E]/10",
                ].join(" ")}
            >
                {icon}

                <input
                    type={resolvedType}
                    placeholder={placeholder}
                    value={value}
                    disabled={disabled}
                    onChange={(event) => onChange?.(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#7A6E88] disabled:cursor-not-allowed disabled:text-[#8F8498]"
                />

                {isPasswordField && !disabled && (
                    <button
                        type="button"
                        onClick={() =>
                            setIsPasswordVisible((current) => !current)
                        }
                        aria-label={
                            isPasswordVisible
                                ? `Hide ${label.toLowerCase()}`
                                : `Show ${label.toLowerCase()}`
                        }
                        aria-pressed={isPasswordVisible}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#7A6E88] transition hover:bg-[#F3EFF8] hover:text-[#2D1B4E]"
                    >
                        {isPasswordVisible ? (
                            <EyeOff className="h-5 w-5" />
                        ) : (
                            <Eye className="h-5 w-5" />
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}