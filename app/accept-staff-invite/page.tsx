"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    ArrowRight,
    Boxes,
    CalendarDays,
    Check,
    CheckCircle2,
    Eye,
    EyeOff,
    LayoutDashboard,
    Loader2,
    Lock,
    Mail,
    MapPin,
    Package,
    ShieldCheck,
    ShoppingCart,
    Store,
    UserRound,
    X,
} from "lucide-react";
import {
    Suspense,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import LandingPage from "../../components/landing/LandingPage";

type InviteDetails = {
    staff_id: number;
    staff_name: string;
    staff_email: string;
    store_id: number;
    store_name: string;
    branch_id: number;
    branch_name: string;
    role: "staff";
    status: string;
    permissions: Record<string, boolean>;
};

type ActivationResult = InviteDetails & {
    token: string;
    message?: string;
};

type ApiError = {
    error?: string;
    message?: string;
};

const steps = [
    "Invitation",
    "Verify email",
    "Confirm details",
    "Create password",
    "Success",
];

const permissionMeta: Record<
    string,
    { label: string; icon: typeof LayoutDashboard }
> = {
    dashboard: { label: "Dashboard", icon: LayoutDashboard },
    bookings: { label: "Bookings", icon: CalendarDays },
    packages: { label: "Packages", icon: Package },
    packages_manage: { label: "Manage Packages", icon: Boxes },
    inventory: { label: "Inventory", icon: Boxes },
    pos: { label: "Sales / POS", icon: ShoppingCart },
    reports: { label: "Reports", icon: LayoutDashboard },
    staff_management: { label: "Staff Management", icon: UserRound },
    branch_settings: { label: "Branch Settings", icon: Store },
};

function maskEmail(email: string) {
    const [name, domain] = email.split("@");

    if (!name || !domain) return email;

    const visible = name.slice(0, Math.min(3, name.length));
    return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
}

function formatTimer(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function postInviteAction<T>(
    action: string,
    payload: Record<string, unknown>
): Promise<T> {
    const response = await fetch("/api/invite-staff", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            action,
            ...payload,
        }),
    });

    const data = (await response.json()) as T & ApiError;

    if (!response.ok) {
        throw new Error(
            data.error || data.message || "Unable to process this invitation."
        );
    }

    return data;
}

function PermissionChips({ permissions }: { permissions: Record<string, boolean> }) {
    const enabledPermissions = Object.entries(permissions || {}).filter(
        ([, enabled]) => Boolean(enabled)
    );

    if (enabledPermissions.length === 0) {
        return (
            <p className="text-sm text-[#7A6E88]">
                Your access is assigned by your branch manager.
            </p>
        );
    }

    return (
        <div className="flex flex-wrap gap-2.5">
            {enabledPermissions.map(([permission]) => {
                const meta = permissionMeta[permission] || {
                    label: permission,
                    icon: CheckCircle2,
                };
                const Icon = meta.icon;

                return (
                    <div
                        key={permission}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#F2EBFF] px-3.5 py-2 text-sm font-semibold text-[#4A1D96]"
                    >
                        <Icon className="h-4 w-4" />
                        {meta.label}
                    </div>
                );
            })}
        </div>
    );
}

function ProgressSteps({ currentStep }: { currentStep: number }) {
    return (
        <div className="mt-6 grid grid-cols-5 gap-1 sm:gap-3">
            {steps.map((label, index) => {
                const stepNumber = index + 1;
                const complete = stepNumber < currentStep || currentStep === 5;
                const active = stepNumber === currentStep && currentStep !== 5;

                return (
                    <div key={label} className="relative flex min-w-0 flex-col items-center">
                        {index > 0 && (
                            <div
                                className={`absolute right-1/2 top-5 h-0.5 w-full -translate-y-1/2 ${
                                    stepNumber <= currentStep
                                        ? "bg-[#5520AE]"
                                        : "bg-[#DDD3EC]"
                                }`}
                            />
                        )}

                        <div
                            className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold transition sm:h-11 sm:w-11 ${
                                complete || active
                                    ? "border-[#5520AE] bg-[#5520AE] text-white"
                                    : "border-[#D8CEE8] bg-white text-[#432570]"
                            }`}
                        >
                            {complete ? <Check className="h-5 w-5" /> : stepNumber}
                        </div>

                        <span
                            className={`mt-2 hidden text-center text-xs font-medium sm:block ${
                                active || complete
                                    ? "text-[#5120A8]"
                                    : "text-[#756A82]"
                            }`}
                        >
                            {label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function DetailGrid({ details }: { details: InviteDetails }) {
    const items = [
        { label: "Store", value: details.store_name, icon: Store },
        { label: "Branch", value: details.branch_name, icon: MapPin },
        { label: "Role", value: "Staff Member", icon: UserRound },
        {
            label: "Invited email",
            value: maskEmail(details.staff_email),
            icon: Mail,
        },
    ];

    return (
        <div className="mt-6 grid gap-3 rounded-2xl border border-[#E3DAEC] bg-white p-4 sm:grid-cols-2 sm:p-5">
            {items.map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex min-w-0 items-center gap-3 rounded-xl p-1">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2EBFF] text-[#5520AE]">
                        <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-[#81758C]">{label}</p>
                        <p className="truncate text-sm font-bold text-[#24133F] sm:text-base">
                            {value}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
}

function AcceptStaffInviteContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const inviteToken = searchParams.get("token") || "";

    const [currentStep, setCurrentStep] = useState(1);
    const [details, setDetails] = useState<InviteDetails | null>(null);
    const [staffName, setStaffName] = useState("");
    const [otp, setOtp] = useState("");
    const [otpTimer, setOtpTimer] = useState(0);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [activation, setActivation] = useState<ActivationResult | null>(null);

    const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

    useEffect(() => {
        let active = true;

        const loadInvitation = async () => {
            if (!inviteToken) {
                setError("The invitation link is missing its secure token.");
                setLoading(false);
                return;
            }

            try {
                const data = await postInviteAction<InviteDetails>(
                    "get_staff_invite",
                    { invite_token: inviteToken }
                );

                if (!active) return;

                setDetails(data);
                setStaffName(data.staff_name || "");
            } catch (loadError) {
                if (!active) return;
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Unable to open the invitation."
                );
            } finally {
                if (active) setLoading(false);
            }
        };

        void loadInvitation();

        return () => {
            active = false;
        };
    }, [inviteToken]);

    useEffect(() => {
        if (currentStep !== 2 || otpTimer <= 0) return;

        const timer = window.setInterval(() => {
            setOtpTimer((value) => Math.max(0, value - 1));
        }, 1000);

        return () => window.clearInterval(timer);
    }, [currentStep, otpTimer]);

    const passwordChecks = useMemo(
        () => ({
            length: password.length >= 8,
            uppercase: /[A-Z]/.test(password),
            number: /\d/.test(password),
            special: /[^A-Za-z0-9]/.test(password),
        }),
        [password]
    );

    const passwordValid = Object.values(passwordChecks).every(Boolean);

    const handleClose = () => {
        router.push("/");
    };

    const sendVerificationCode = async () => {
        setError("");
        setSubmitting(true);

        try {
            const data = await postInviteAction<{ expires_in?: number }>(
                "send_staff_invite_otp",
                { invite_token: inviteToken }
            );

            setOtp("");
            setOtpTimer(Number(data.expires_in || 300));
            setCurrentStep(2);
            window.setTimeout(() => otpRefs.current[0]?.focus(), 50);
        } catch (sendError) {
            setError(
                sendError instanceof Error
                    ? sendError.message
                    : "Unable to send the verification code."
            );
        } finally {
            setSubmitting(false);
        }
    };

    const handleOtpChange = (index: number, value: string) => {
        const digit = value.replace(/\D/g, "").slice(-1);
        const next = otp.padEnd(6, " ").split("");
        next[index] = digit || " ";
        const normalized = next.join("").replace(/ /g, "").slice(0, 6);
        setOtp(normalized);

        if (digit && index < 5) {
            otpRefs.current[index + 1]?.focus();
        }
    };

    const handleOtpKeyDown = (
        index: number,
        event: React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (event.key === "Backspace" && !otp[index] && index > 0) {
            otpRefs.current[index - 1]?.focus();
        }
    };

    const handleOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
        event.preventDefault();
        const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        setOtp(pasted);
        otpRefs.current[Math.min(pasted.length, 5)]?.focus();
    };

    const verifyOtp = async () => {
        if (!/^\d{6}$/.test(otp)) {
            setError("Enter the complete 6-digit verification code.");
            return;
        }

        setError("");
        setSubmitting(true);

        try {
            await postInviteAction("verify_staff_invite_otp", {
                invite_token: inviteToken,
                otp,
            });
            setCurrentStep(3);
        } catch (verifyError) {
            setError(
                verifyError instanceof Error
                    ? verifyError.message
                    : "The verification code is invalid."
            );
        } finally {
            setSubmitting(false);
        }
    };

    const saveStaffDetails = async () => {
        if (!staffName.trim()) {
            setError("Enter your full name before continuing.");
            return;
        }

        setError("");
        setSubmitting(true);

        try {
            const data = await postInviteAction<InviteDetails>(
                "update_staff_invite_details",
                {
                    invite_token: inviteToken,
                    staff_name: staffName.trim(),
                }
            );
            setDetails(data);
            setStaffName(data.staff_name);
            setCurrentStep(4);
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Unable to save your information."
            );
        } finally {
            setSubmitting(false);
        }
    };

    const activateAccount = async () => {
        if (!passwordValid) {
            setError("Create a password that meets all requirements.");
            return;
        }

        if (password !== confirmPassword) {
            setError("The passwords do not match.");
            return;
        }

        if (!acceptedTerms) {
            setError("Agree to the invitation terms and account activation.");
            return;
        }

        setError("");
        setSubmitting(true);

        try {
            const data = await postInviteAction<ActivationResult>(
                "accept_staff_invite",
                {
                    invite_token: inviteToken,
                    staff_name: staffName.trim(),
                    password,
                }
            );

            setActivation(data);
            setDetails(data);
            setCurrentStep(5);

            sessionStorage.setItem("token", data.token);
            sessionStorage.setItem("role", "staff");
            sessionStorage.setItem("staff_id", String(data.staff_id));
            sessionStorage.setItem("staff_name", data.staff_name);
            sessionStorage.setItem("staff_email", data.staff_email);
            sessionStorage.setItem("store_id", String(data.store_id));
            sessionStorage.setItem("store_name", data.store_name);
            sessionStorage.setItem("branch_id", String(data.branch_id));
            sessionStorage.setItem("branch_name", data.branch_name);
            sessionStorage.setItem("permissions", JSON.stringify(data.permissions || {}));
            sessionStorage.setItem("isLoggedIn", "true");
        } catch (activateError) {
            setError(
                activateError instanceof Error
                    ? activateError.message
                    : "Unable to activate your staff account."
            );
        } finally {
            setSubmitting(false);
        }
    };

    const renderBody = () => {
        if (loading) {
            return (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-[#5D4D69]">
                    <Loader2 className="h-9 w-9 animate-spin text-[#5520AE]" />
                    <p className="font-medium">Opening your secure invitation…</p>
                </div>
            );
        }

        if (!details) {
            return (
                <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-600">
                        <X className="h-8 w-8" />
                    </div>
                    <h2 className="mt-5 text-2xl font-bold text-[#24133F]">
                        Invitation unavailable
                    </h2>
                    <p className="mt-2 max-w-md text-sm leading-6 text-[#74687E]">
                        {error || "This invitation is invalid, expired, or already used."}
                    </p>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="mt-6 rounded-xl bg-[#32185B] px-6 py-3 font-semibold text-white"
                    >
                        Return to landing page
                    </button>
                </div>
            );
        }

        if (currentStep === 5) {
            return (
                <div>
                    <div className="text-center">
                        <h1 className="text-3xl font-bold tracking-tight text-[#21113E] sm:text-4xl">
                            You’re all set!
                        </h1>
                        <p className="mt-2 text-sm text-[#665A72] sm:text-base">
                            Your staff account is now active.
                        </p>
                    </div>

                    <ProgressSteps currentStep={5} />

                    <div className="mt-8 flex justify-center">
                        <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-8 border-[#E7DBFF] bg-[#F7F2FF] text-[#5520AE] shadow-[0_16px_45px_rgba(85,32,174,.18)]">
                            <Check className="h-14 w-14" strokeWidth={2.5} />
                        </div>
                    </div>

                    <p className="mt-6 text-center text-base leading-7 text-[#594B65]">
                        You now have access to<br />
                        <strong className="text-[#4D1FA5]">
                            {details.store_name} • {details.branch_name}
                        </strong>{" "}
                        as Staff Member.
                    </p>

                    <div className="mt-7 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-2xl border border-[#E3DAEC] bg-[#FCFAFD] p-5">
                            <h3 className="font-bold text-[#2A1748]">What you can do now</h3>
                            <div className="mt-4 space-y-3 text-sm text-[#4D4058]">
                                <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[#5520AE]" /> Review bookings and schedules</p>
                                <p className="flex items-center gap-2"><Package className="h-4 w-4 text-[#5520AE]" /> Manage packages and inventory</p>
                                <p className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-[#5520AE]" /> Track sales and POS activity</p>
                                <p className="flex items-center gap-2"><LayoutDashboard className="h-4 w-4 text-[#5520AE]" /> Work with your branch dashboard</p>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[#E3DAEC] bg-white p-5">
                            <div className="space-y-4">
                                <div className="flex items-center gap-3"><MapPin className="h-5 w-5 text-[#5520AE]" /><div><p className="text-xs text-[#7D7188]">Branch</p><p className="font-bold text-[#281546]">{details.branch_name}</p></div></div>
                                <div className="flex items-center gap-3"><Store className="h-5 w-5 text-[#5520AE]" /><div><p className="text-xs text-[#7D7188]">Store</p><p className="font-bold text-[#281546]">{details.store_name}</p></div></div>
                                <div className="flex items-center gap-3"><UserRound className="h-5 w-5 text-[#5520AE]" /><div><p className="text-xs text-[#7D7188]">Role</p><p className="font-bold text-[#281546]">Staff Member</p></div></div>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => router.replace("/dashboard")}
                        className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#32185B] to-[#5A1CC8] px-5 py-4 font-bold text-white shadow-lg shadow-purple-200"
                    >
                        <LayoutDashboard className="h-5 w-5" />
                        Go to Dashboard
                        <ArrowRight className="h-5 w-5" />
                    </button>

                    {activation?.message && (
                        <p className="mt-3 text-center text-xs text-[#81758C]">
                            {activation.message}
                        </p>
                    )}
                </div>
            );
        }

        return (
            <div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-[#21113E] sm:text-4xl">
                        Accept invitation
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-[#65596F] sm:text-base">
                        You were invited to join{" "}
                        <strong className="text-[#48208E]">{details.store_name}</strong>
                        {" • "}
                        <strong className="text-[#48208E]">{details.branch_name}</strong>
                        {" "}as Staff Member.
                    </p>
                </div>

                <ProgressSteps currentStep={currentStep} />
                <DetailGrid details={details} />

                {error && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                        {error}
                    </div>
                )}

                {currentStep === 1 && (
                    <div className="mt-6">
                        <div className="flex items-start gap-3 rounded-2xl border border-[#D9C7F5] bg-[#F8F3FF] p-4 text-sm leading-6 text-[#44226F]">
                            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-[#5A22B0]" />
                            <p>
                                Review the invitation details before continuing. You’ll verify your email and create your password in the next steps.
                            </p>
                        </div>

                        <div className="mt-6">
                            <h3 className="text-lg font-bold text-[#291548]">Access you’ll receive</h3>
                            <div className="mt-3">
                                <PermissionChips permissions={details.permissions} />
                            </div>
                        </div>
                    </div>
                )}

                {currentStep === 2 && (
                    <div className="mt-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-[#291548]">Verify your invited email</h3>
                                <p className="mt-1 text-sm leading-6 text-[#6A5E75]">
                                    Enter the 6-digit code sent to {maskEmail(details.staff_email)}.
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={submitting || otpTimer > 0}
                                onClick={sendVerificationCode}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5520AE] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Mail className="h-4 w-4" />
                                Resend code
                            </button>
                        </div>

                        <div className="mt-5 grid grid-cols-6 gap-2 sm:gap-3">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <input
                                    key={index}
                                    ref={(element) => {
                                        otpRefs.current[index] = element;
                                    }}
                                    value={otp[index] || ""}
                                    onChange={(event) => handleOtpChange(index, event.target.value)}
                                    onKeyDown={(event) => handleOtpKeyDown(index, event)}
                                    onPaste={handleOtpPaste}
                                    inputMode="numeric"
                                    maxLength={1}
                                    aria-label={`Verification digit ${index + 1}`}
                                    className="h-12 min-w-0 rounded-xl border border-[#DCD2E8] bg-white text-center text-lg font-bold text-[#2F1752] outline-none transition focus:border-[#5520AE] focus:ring-4 focus:ring-purple-100 sm:h-14 sm:text-xl"
                                />
                            ))}
                        </div>

                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="rounded-full bg-[#F2EBFF] px-3 py-1.5 font-medium text-[#5A2A9E]">
                                Code expires in {formatTimer(otpTimer)}
                            </span>
                            {otpTimer === 0 && (
                                <button type="button" onClick={sendVerificationCode} className="font-semibold text-[#5520AE]">
                                    Send a new code
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {currentStep === 3 && (
                    <div className="mt-6">
                        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                            <p className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" /> Your email has been verified.</p>
                            <p className="mt-1 pl-7">Review the name entered by the branch manager. You may correct it before continuing.</p>
                        </div>

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <label className="block">
                                <span className="text-sm font-semibold text-[#2D194D]">Full name</span>
                                <input
                                    value={staffName}
                                    onChange={(event) => setStaffName(event.target.value)}
                                    className="mt-2 h-12 w-full rounded-xl border border-[#DCD2E8] px-4 text-[#261641] outline-none focus:border-[#5520AE] focus:ring-4 focus:ring-purple-100"
                                />
                            </label>

                            <label className="block">
                                <span className="text-sm font-semibold text-[#2D194D]">Verified email</span>
                                <input
                                    value={details.staff_email}
                                    readOnly
                                    className="mt-2 h-12 w-full rounded-xl border border-[#E3DDEA] bg-[#F7F5F9] px-4 text-[#746A7D]"
                                />
                            </label>
                        </div>

                        <div className="mt-6">
                            <h3 className="text-lg font-bold text-[#291548]">Access you’ll receive</h3>
                            <div className="mt-3"><PermissionChips permissions={details.permissions} /></div>
                        </div>
                    </div>
                )}

                {currentStep === 4 && (
                    <div className="mt-6">
                        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                            <p className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" /> Details confirmed.</p>
                            <p className="mt-1 pl-7">Create a password to activate your staff account.</p>
                        </div>

                        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_250px]">
                            <div className="space-y-4">
                                <label className="block">
                                    <span className="text-sm font-semibold text-[#2D194D]">Password</span>
                                    <div className="relative mt-2">
                                        <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#80748B]" />
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            value={password}
                                            onChange={(event) => setPassword(event.target.value)}
                                            className="h-12 w-full rounded-xl border border-[#DCD2E8] pl-12 pr-12 text-[#261641] outline-none focus:border-[#5520AE] focus:ring-4 focus:ring-purple-100"
                                        />
                                        <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#756A82]">
                                            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </label>

                                <label className="block">
                                    <span className="text-sm font-semibold text-[#2D194D]">Confirm password</span>
                                    <div className="relative mt-2">
                                        <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#80748B]" />
                                        <input
                                            type={showConfirmPassword ? "text" : "password"}
                                            value={confirmPassword}
                                            onChange={(event) => setConfirmPassword(event.target.value)}
                                            className="h-12 w-full rounded-xl border border-[#DCD2E8] pl-12 pr-12 text-[#261641] outline-none focus:border-[#5520AE] focus:ring-4 focus:ring-purple-100"
                                        />
                                        <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#756A82]">
                                            {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </label>

                                <label className="flex cursor-pointer items-start gap-3 text-sm text-[#5C5066]">
                                    <input
                                        type="checkbox"
                                        checked={acceptedTerms}
                                        onChange={(event) => setAcceptedTerms(event.target.checked)}
                                        className="mt-0.5 h-5 w-5 accent-[#5520AE]"
                                    />
                                    <span>I agree to the invitation terms and account activation.</span>
                                </label>
                            </div>

                            <div className="rounded-2xl border border-[#E1D8EC] bg-[#F8F4FF] p-4">
                                <p className="text-sm font-bold text-[#321A59]">Password must include:</p>
                                <div className="mt-3 space-y-2.5 text-sm">
                                    {[
                                        [passwordChecks.length, "At least 8 characters"],
                                        [passwordChecks.uppercase, "One uppercase letter"],
                                        [passwordChecks.number, "One number"],
                                        [passwordChecks.special, "One special character"],
                                    ].map(([valid, label]) => (
                                        <p key={String(label)} className={`flex items-center gap-2 ${valid ? "text-green-700" : "text-[#6B6074]"}`}>
                                            <CheckCircle2 className="h-4 w-4" /> {String(label)}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-7 flex items-center justify-between gap-3 border-t border-[#EEE8F2] pt-5">
                    <button
                        type="button"
                        onClick={() => {
                            setError("");
                            if (currentStep === 1) handleClose();
                            else setCurrentStep((step) => Math.max(1, step - 1));
                        }}
                        disabled={submitting}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#CFC3DE] bg-white px-5 font-semibold text-[#35204F] disabled:opacity-50"
                    >
                        {currentStep === 1 ? <X className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                        {currentStep === 1 ? "Cancel" : "Back"}
                    </button>

                    <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                            if (currentStep === 1) void sendVerificationCode();
                            if (currentStep === 2) void verifyOtp();
                            if (currentStep === 3) void saveStaffDetails();
                            if (currentStep === 4) void activateAccount();
                        }}
                        className="inline-flex h-12 min-w-[180px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#35175F] to-[#5B1BC7] px-6 font-bold text-white shadow-lg shadow-purple-200 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                        {currentStep === 1 && "Continue"}
                        {currentStep === 2 && "Verify & Continue"}
                        {currentStep === 3 && "Save & Continue"}
                        {currentStep === 4 && "Activate account"}
                        {!submitting && <ArrowRight className="h-5 w-5" />}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <main className="relative min-h-screen overflow-hidden bg-[#F7F4FB]">
            <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
                <LandingPage onSignupSuccess={() => undefined} />
            </div>

            <div className="fixed inset-0 z-40 bg-[#160A2A]/38 backdrop-blur-[2px]" />

            <div className="relative z-50 flex min-h-screen items-center justify-center p-3 sm:p-6">
                <section
                    role="dialog"
                    aria-modal="true"
                    aria-label="Accept staff invitation"
                    className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-2xl md:h-[min(760px,94vh)] md:min-h-[680px]"
                >
                    <header className="relative z-20 shrink-0 overflow-hidden border-b border-white/10 bg-[linear-gradient(135deg,_#2D1B4E_0%,_#43206F_52%,_#5A2A91_100%)] px-5 py-4 sm:px-7 lg:px-8">
                        <div className="pointer-events-none absolute -left-16 -top-20 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                        <div className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full bg-[#C9951A]/15 blur-2xl" />

                        <div className="relative mx-auto flex w-full max-w-[820px] items-center justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/25 bg-white/95 p-2 shadow-sm">
                                    <Image
                                        src="/logo.png"
                                        alt="StockNBook"
                                        width={40}
                                        height={40}
                                        className="h-full w-full object-contain"
                                    />
                                </div>

                                <div className="min-w-0">
                                    <span className="block truncate text-xl font-bold tracking-tight text-white sm:text-2xl">
                                        Stock<span className="text-[#F1C85C]">N</span>Book
                                    </span>
                                    <span className="mt-0.5 block text-xs font-medium text-white/65">
                                        Secure staff invitation
                                    </span>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={handleClose}
                                aria-label="Close invitation"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white"
                            >
                                <X className="h-6 w-6" />
                            </button>
                        </div>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                        <div className="mx-auto w-full max-w-[820px] px-5 pb-7 pt-6 sm:px-7 sm:pb-8 lg:px-8">
                            {renderBody()}
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}

export default function AcceptStaffInvitePage() {
    return (
        <Suspense
            fallback={
                <main className="flex min-h-screen items-center justify-center bg-[#F7F4FB]">
                    <Loader2 className="h-9 w-9 animate-spin text-[#5520AE]" />
                </main>
            }
        >
            <AcceptStaffInviteContent />
        </Suspense>
    );
}