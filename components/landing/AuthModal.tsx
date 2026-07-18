"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    CheckCircle2,
    Clock3,
    Eye,
    EyeOff,
    Lock,
    Mail,
    Package,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    X,
} from "lucide-react";

type AuthMode = "login" | "signup";

type PendingSignup = {
    owner_name: string;
    store_name: string;
    phone: string;
    email: string;
    password: string;
};

const PLATFORM_ADMIN_EMAIL = "platformadmin@stocknbook.com";
const PLATFORM_ADMIN_PASSWORD = "Admin@12345";

export default function AuthModal({
                                      mode,
                                      onClose,
                                      onSwitch,
                                      onSignupSuccess,
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
            sessionStorage.setItem(
                "manager_id",
                String(data.manager_id)
            );
            sessionStorage.setItem(
                "manager_name",
                data.manager_name || ""
            );
            sessionStorage.setItem(
                "manager_email",
                data.manager_email || ""
            );
            sessionStorage.setItem(
                "branch_id",
                String(data.branch_id)
            );
            sessionStorage.setItem(
                "branch_name",
                data.branch_name || ""
            );
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
            sessionStorage.setItem(
                "staff_id",
                String(data.staff_id)
            );
            sessionStorage.setItem(
                "staff_name",
                data.staff_name || ""
            );
            sessionStorage.setItem(
                "staff_email",
                data.staff_email || ""
            );
            sessionStorage.setItem(
                "branch_id",
                String(data.branch_id)
            );
            sessionStorage.setItem(
                "branch_name",
                data.branch_name || ""
            );
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

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
        }

        /*
          TEMPORARY FRONTEND-ONLY PLATFORM ADMIN LOGIN.
          It does not call Lambda, RDS, or any backend.
        */
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

            sessionStorage.setItem(
                "token",
                "platform-admin-ui-demo"
            );
            sessionStorage.setItem("role", "PLATFORM_ADMIN");
            sessionStorage.setItem(
                "user",
                JSON.stringify(adminUser)
            );
            sessionStorage.setItem(
                "full_name",
                "Platform Administrator"
            );
            sessionStorage.setItem("isLoggedIn", "true");

            setLoading(true);
            onClose();

            router.replace("/platform-admin/dashboard");
            return;
        }

        if (mode === "signup") {
            const signupBody: PendingSignup = {
                owner_name: ownerName,
                store_name: storeName,
                phone,
                email,
                password,
            };

            setLoading(true);

            try {
                const res = await fetch("/api/auth", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        action: "send_signup_otp",
                        ...signupBody,
                    }),
                });

                const data = await res.json();

                if (!res.ok) {
                    alert(data.error || "Failed to send OTP.");
                    return;
                }

                setPendingSignup(signupBody);
                setOtp("");
                setOtpTimer(Number(data.expires_in || 300));
                setOtpDialogOpen(true);
            } catch {
                alert(
                    "Something went wrong while sending OTP."
                );
            } finally {
                setLoading(false);
            }

            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/auth", {
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

            const data = await res.json();

            if (!res.ok || !data.token) {
                alert(
                    data.error || "Authentication failed."
                );
                return;
            }

            saveCommonSession(data);

            onClose();
            router.push("/dashboard");
        } catch {
            alert(
                "Something went wrong. Please try again."
            );
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (!pendingSignup) {
            alert(
                "Signup details are missing. Please try again."
            );
            setOtpDialogOpen(false);
            return;
        }

        const normalizedOtp = otp
            .replace(/\D/g, "")
            .slice(0, 6);

        if (!/^\d{6}$/.test(normalizedOtp)) {
            alert(
                "Please enter the complete 6-digit OTP."
            );
            return;
        }

        if (otpTimer <= 0) {
            alert(
                "OTP expired. Please resend a new code."
            );
            return;
        }

        setOtpLoading(true);

        try {
            const res = await fetch("/api/auth", {
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

            const data = await res.json();

            if (!res.ok || !data.token) {
                alert(
                    data.error ||
                    "OTP verification failed."
                );
                return;
            }

            saveCommonSession(data);

            setOtpDialogOpen(false);
            onSignupSuccess();
        } catch {
            alert(
                "Something went wrong while verifying OTP."
            );
        } finally {
            setOtpLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (otpTimer > 0 || otpLoading) {
            return;
        }

        if (!pendingSignup) {
            alert(
                "Signup details are missing. Please try again."
            );
            setOtpDialogOpen(false);
            return;
        }

        setOtpLoading(true);

        try {
            const res = await fetch("/api/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: "send_signup_otp",
                    ...pendingSignup,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(
                    data.error || "Failed to resend OTP."
                );
                return;
            }

            setOtp("");
            setOtpTimer(Number(data.expires_in || 300));
        } catch {
            alert(
                "Something went wrong while resending OTP."
            );
        } finally {
            setOtpLoading(false);
        }
    };

    const handleSwitchMode = () => {
        setOtpDialogOpen(false);
        setOtp("");
        setOtpTimer(0);
        setPendingSignup(null);
        setLegalDocument(null);

        onSwitch(
            mode === "login" ? "signup" : "login"
        );
    };

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
                <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/80 transition hover:bg-white/10 md:text-[#7A6E88]"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <div className="hidden bg-[#2D1B4E] p-10 text-white md:flex md:flex-col md:justify-between">
                        <div>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#C9951A]">
                                    <Package className="h-5 w-5" />
                                </div>

                                <span className="text-lg font-semibold">
                                    <span className="text-[#F5E8C0]">
                                        Stock
                                    </span>
                                    NBook
                                </span>
                            </div>

                            <h2 className="mt-14 font-serif text-4xl leading-tight">
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

                            <p className="mt-5 max-w-sm text-sm leading-7 text-white/60">
                                Manage your events, bookings,
                                inventory, and team from one clean
                                dashboard.
                            </p>
                        </div>

                        <p className="border-t border-white/10 pt-6 font-serif text-sm leading-7 text-white/70">
                            “Mas madali na ang buhay ko.
                            Everything is in one place.”
                        </p>
                    </div>

                    <div className="max-h-[90vh] overflow-y-auto p-8 md:p-10">
                        <div className="mb-8 flex items-center gap-3 md:hidden">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2D1B4E] text-[#C9951A]">
                                <Package className="h-5 w-5" />
                            </div>

                            <span className="text-lg font-semibold text-[#2D1B4E]">
                                StockNBook
                            </span>
                        </div>

                        <h1 className="font-serif text-4xl text-[#1A1220]">
                            {mode === "login"
                                ? "Log in"
                                : "Create account"}
                        </h1>

                        <p className="mt-2 text-sm text-[#7A6E88]">
                            {mode === "login"
                                ? "Enter your credentials to access your dashboard."
                                : "Set up your business in under 3 minutes."}
                        </p>

                        <form
                            className="mt-8 space-y-5"
                            onSubmit={handleSubmit}
                        >
                            {mode === "signup" && (
                                <>
                                    <TextInput
                                        label="Owner name"
                                        placeholder="e.g. Maria Santos"
                                        value={ownerName}
                                        onChange={setOwnerName}
                                    />

                                    <TextInput
                                        label="Business name"
                                        placeholder="e.g. Santos Events & Party Supply"
                                        value={storeName}
                                        onChange={setStoreName}
                                        icon={
                                            <Package className="h-5 w-5 text-[#7A6E88]" />
                                        }
                                    />

                                    <TextInput
                                        label="Phone number"
                                        placeholder="9XX XXX XXXX"
                                        value={phone}
                                        onChange={setPhone}
                                    />
                                </>
                            )}

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
                                placeholder={
                                    mode === "login"
                                        ? "Enter your password"
                                        : "Create a password"
                                }
                                type="password"
                                value={password}
                                onChange={setPassword}
                                icon={
                                    <Lock className="h-5 w-5 text-[#7A6E88]" />
                                }
                            />

                            {mode === "signup" && (
                                <TextInput
                                    label="Confirm password"
                                    placeholder="Repeat your password"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={setConfirmPassword}
                                    icon={
                                        <Lock className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />
                            )}

                            {mode === "login" && (
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
                            )}

                            {mode === "signup" && (
                                <div className="rounded-xl border border-[#E8E0EE] bg-[#FBF9FD] p-4">
                                    <p className="text-xs leading-5 text-[#7A6E88]">
                                        View both documents before
                                        the agreement checkbox
                                        becomes available.
                                    </p>

                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setLegalDocument(
                                                    "terms"
                                                )
                                            }
                                            className={[
                                                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition",
                                                hasViewedTerms
                                                    ? "border-[#D7E8CE] bg-[#F4FAF1] text-[#466436]"
                                                    : "border-[#D9D0E2] bg-white text-[#2D1B4E] hover:border-[#C9951A]",
                                            ].join(" ")}
                                        >
                                            <span>
                                                Terms of Service
                                            </span>

                                            {hasViewedTerms && (
                                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                setLegalDocument(
                                                    "privacy"
                                                )
                                            }
                                            className={[
                                                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition",
                                                hasViewedPrivacy
                                                    ? "border-[#D7E8CE] bg-[#F4FAF1] text-[#466436]"
                                                    : "border-[#D9D0E2] bg-white text-[#2D1B4E] hover:border-[#C9951A]",
                                            ].join(" ")}
                                        >
                                            <span>
                                                Privacy Policy
                                            </span>

                                            {hasViewedPrivacy && (
                                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                            )}
                                        </button>
                                    </div>

                                    <label
                                        className={[
                                            "mt-4 flex items-start gap-2 text-sm",
                                            hasViewedTerms &&
                                            hasViewedPrivacy
                                                ? "cursor-pointer text-[#7A6E88]"
                                                : "cursor-not-allowed text-[#AAA1B0]",
                                        ].join(" ")}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={
                                                hasAcceptedPolicies
                                            }
                                            disabled={
                                                !hasViewedTerms ||
                                                !hasViewedPrivacy
                                            }
                                            onChange={(event) =>
                                                setHasAcceptedPolicies(
                                                    event.target
                                                        .checked
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
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white transition hover:bg-[#3D2560] disabled:opacity-60"
                            >
                                {loading
                                    ? "Please wait..."
                                    : mode === "login"
                                        ? "Log in to StockNBook"
                                        : "Create my account"}
                            </button>
                        </form>

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
                    </div>
                </div>
            </div>

            {legalDocument && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-[#160C27]/65 px-4 backdrop-blur-sm"
                    onMouseDown={() =>
                        setLegalDocument(null)
                    }
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="legal-document-title"
                        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl"
                        onMouseDown={(event) =>
                            event.stopPropagation()
                        }
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
                                    {legalDocument ===
                                    "terms"
                                        ? "Terms of Service"
                                        : "Privacy Policy"}
                                </h2>
                            </div>

                            <button
                                type="button"
                                onClick={() =>
                                    setLegalDocument(null)
                                }
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
                                        By creating and using a
                                        StockNBook account, you
                                        agree to provide accurate
                                        registration and business
                                        information and to keep
                                        your login credentials
                                        secure.
                                    </p>

                                    <p>
                                        You are responsible for
                                        the bookings, inventory,
                                        sales, scheduled orders,
                                        customer details, staff
                                        permissions, and other
                                        records entered through
                                        your account.
                                    </p>

                                    <p>
                                        StockNBook is a
                                        business-management and
                                        record-keeping platform.
                                        It does not replace
                                        professional legal, tax,
                                        accounting, or regulatory
                                        advice.
                                    </p>

                                    <p>
                                        Access may be limited or
                                        suspended when the
                                        platform is misused,
                                        security is threatened, or
                                        applicable rules are
                                        violated.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <p>
                                        StockNBook processes
                                        account and business
                                        information needed to
                                        provide login, bookings,
                                        inventory, sales,
                                        scheduled orders, staff
                                        access, reports, and
                                        subscription services.
                                    </p>

                                    <p>
                                        Information should only
                                        be accessed by authorized
                                        account owners, managers,
                                        and staff members
                                        according to their
                                        assigned permissions.
                                    </p>

                                    <p>
                                        Users are responsible for
                                        entering customer and
                                        business information only
                                        when they have an
                                        appropriate reason and
                                        permission to do so.
                                    </p>

                                    <p>
                                        Account and business
                                        information is used to
                                        operate, secure, maintain,
                                        and improve the StockNBook
                                        service.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-[#EBE4F0] px-6 py-5 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() =>
                                    setLegalDocument(null)
                                }
                                className="h-11 rounded-xl border border-[#D4CBDD] bg-white px-5 text-sm font-semibold text-[#2D1B4E] transition hover:bg-[#F8F5FF]"
                            >
                                Close
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (
                                        legalDocument ===
                                        "terms"
                                    ) {
                                        setHasViewedTerms(true);
                                    } else {
                                        setHasViewedPrivacy(
                                            true
                                        );
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
                    email={
                        pendingSignup?.email || email
                    }
                    otp={otp}
                    setOtp={setOtp}
                    timer={otpTimer}
                    loading={otpLoading}
                    onVerify={handleVerifyOtp}
                    onResend={handleResendOtp}
                    onClose={() =>
                        setOtpDialogOpen(false)
                    }
                />
            )}
        </>
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
                   }: {
    label: string;
    placeholder: string;
    type?: string;
    value?: string;
    onChange?: (value: string) => void;
    icon?: React.ReactNode;
}) {
    const [isPasswordVisible, setIsPasswordVisible] =
        useState(false);

    const isPasswordField = type === "password";

    const resolvedType =
        isPasswordField && isPasswordVisible
            ? "text"
            : type;

    return (
        <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>

            <div className="flex items-center gap-3 rounded-lg border border-[#EBE4F0] bg-white px-4 py-3 transition focus-within:border-[#2D1B4E] focus-within:ring-4 focus-within:ring-[#2D1B4E]/10">
                {icon}

                <input
                    type={resolvedType}
                    placeholder={placeholder}
                    value={value}
                    onChange={(event) =>
                        onChange?.(event.target.value)
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#7A6E88]"
                />

                {isPasswordField && (
                    <button
                        type="button"
                        onClick={() =>
                            setIsPasswordVisible(
                                (current) => !current
                            )
                        }
                        aria-label={
                            isPasswordVisible
                                ? `Hide ${label.toLowerCase()}`
                                : `Show ${label.toLowerCase()}`
                        }
                        aria-pressed={
                            isPasswordVisible
                        }
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