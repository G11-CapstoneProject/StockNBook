"use client";

import Image from "next/image";
import { Lora } from "next/font/google";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Store,
    UserRound,
    X,
} from "lucide-react";
// Phone formatting stays inside this existing page/component; no helper file is required.
const MOBILE_PHONE_PLACEHOLDER = "0912 345 6789";
const MOBILE_PHONE_HELP = "Enter an 11-digit Philippine mobile number starting with 09.";

function normalizeMobileNumber(value: string): string {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.startsWith("63")) return `0${digits.slice(2)}`;
    if (digits.length === 10 && digits.startsWith("9")) return `0${digits}`;
    return digits;
}

function isValidMobileNumber(value: string): boolean {
    return /^09\d{9}$/.test(normalizeMobileNumber(value));
}

function formatMobileInput(value: string): string {
    const digits = normalizeMobileNumber(value).slice(0, 11);
    return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 11)]
        .filter(Boolean)
        .join(" ");
}


const lora = Lora({
    subsets: ["latin"],
    weight: ["600", "700"],
    display: "swap",
});

type AuthMode = "login" | "signup";

type PendingSignup = PolicyAcceptance & {
    owner_name: string;
    store_name: string;
    phone: string;
    email: string;
    password: string;
};

type AccessLevel = "none" | "view" | "full";

type Permissions = {
    pos: AccessLevel;
    bookings: AccessLevel;
    inventory: AccessLevel;
    packages: AccessLevel;
    staff_management: AccessLevel;
    reports: AccessLevel;
    analytics: AccessLevel;
    forecasting: AccessLevel;
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

// Type only the session values already consumed by saveCommonSession.
type AuthSessionData = {
    token: string;
    store_id?: number | string;
    store_name?: string;
    role?: string;
    manager_id?: number | string;
    manager_name?: string;
    manager_email?: string;
    staff_id?: number | string;
    staff_name?: string;
    staff_email?: string;
    branch_id?: number | string;
    branch_name?: string;
    permissions?: Record<string, unknown>;
};

const defaultPermissions: Permissions = {
    pos: "full",
    bookings: "full",
    inventory: "full",
    packages: "full",
    staff_management: "full",
    reports: "full",
    analytics: "full",
    forecasting: "full",
};

const createEmptyBranch = (): BranchSetup => ({
    branch_name: "",
    contact_number: "",
    address: "",
    manager_name: "",
    manager_email: "",
    manager_mode: "invite",
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
    const [loginError, setLoginError] = useState("");
    const [signupError, setSignupError] = useState("");
    const [loginLockNotice, setLoginLockNotice] = useState<{
        until: number; shownAt: number; lockoutCount: number; recoveryAvailable: boolean;
    } | null>(null);
    const loginEmailRef = useRef("");
    const [loginLockSeconds, setLoginLockSeconds] = useState(0);

    useEffect(() => {
        if (!loginLockNotice) return;
        const update = () => setLoginLockSeconds(Math.max(0, Math.ceil((loginLockNotice.until - Date.now()) / 1000)));
        update();
        const interval = window.setInterval(() => {
            update();
            if (Date.now() >= loginLockNotice.until) window.clearInterval(interval);
        }, 250);
        return () => window.clearInterval(interval);
    }, [loginLockNotice]);
    const [recoveryStage, setRecoveryStage] = useState<"none" | "email" | "otp" | "password" | "success">("none");
    const [recoveryEmail, setRecoveryEmail] = useState("");
    const [recoveryToken, setRecoveryToken] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [newConfirmPassword, setNewConfirmPassword] = useState("");
    const [recoveryError, setRecoveryError] = useState("");
    const [otpResendTimer, setOtpResendTimer] = useState(0);
    const [otpBlocked, setOtpBlocked] = useState(false);

    const [signupStep, setSignupStep] = useState(1);
    // Animation state is independent from the existing login, OTP, and onboarding logic.
    const [isClosing, setIsClosing] = useState(false);
    const closeAnimationTimer = useRef<number | null>(null);
    const formScrollRef = useRef<HTMLDivElement>(null);
    const storefrontRef = useRef<HTMLDivElement>(null);
    const priorSignupStep = useRef(signupStep);
    const lastStepDirection = useRef<"back" | "forward">("forward");
    const stepDirection = signupStep === priorSignupStep.current
        ? lastStepDirection.current
        : signupStep < priorSignupStep.current ? "back" : "forward";
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
    const [otpVerificationSuccess, setOtpVerificationSuccess] = useState(false);
    const [otpVerificationError, setOtpVerificationError] = useState("");
    const [pendingSignup, setPendingSignup] =
        useState<PendingSignup | null>(null);

    const [legalDocument, setLegalDocument] = useState<
        "terms" | "privacy" | null
    >(null);
    const [hasViewedTerms, setHasViewedTerms] = useState(false);
    const [hasViewedPrivacy, setHasViewedPrivacy] = useState(false);
    const [hasAcceptedPolicies, setHasAcceptedPolicies] = useState(false);

    const handleAnimatedClose = useCallback(() => {
        if (isClosing) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            onClose();
            return;
        }
        setIsClosing(true);
        closeAnimationTimer.current = window.setTimeout(onClose, 190);
    }, [isClosing, onClose]);

    useEffect(() => () => {
        if (closeAnimationTimer.current !== null) {
            window.clearTimeout(closeAnimationTimer.current);
        }
    }, []);

    // Keep the new form step in view; retain all entered values and existing validation.
    useEffect(() => {
        if (signupStep !== priorSignupStep.current) {
            lastStepDirection.current = signupStep < priorSignupStep.current ? "back" : "forward";
        }
        priorSignupStep.current = signupStep;
        formScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }, [signupStep, mode]);

    useEffect(() => {
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (otpDialogOpen) {
                if (!otpLoading) setOtpDialogOpen(false);
            } else if (legalDocument) {
                setLegalDocument(null);
            } else if (!loading && !setupLoading) {
                handleAnimatedClose();
            }
        };
        window.addEventListener("keydown", onEscape);
        return () => window.removeEventListener("keydown", onEscape);
    }, [handleAnimatedClose, legalDocument, loading, otpDialogOpen, otpLoading, setupLoading]);

    // Set CSS variables directly: cursor movement never re-renders the form.
    const moveStorefront = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "mouse" || !storefrontRef.current ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = (event.clientX - rect.left) / rect.width - 0.5;
        const dy = (event.clientY - rect.top) / rect.height - 0.5;
        storefrontRef.current.style.transform = `perspective(800px) rotateX(${(-dy * 3).toFixed(2)}deg) rotateY(${(dx * 3).toFixed(2)}deg)`;
    };

    const resetStorefrontTilt = () => {
        storefrontRef.current?.style.removeProperty("transform");
    };

    const passwordChecks = getPasswordChecks(password);
    const newPasswordChecks = getPasswordChecks(newPassword);

    const passwordValid = Object.values(passwordChecks).every(Boolean);

    useEffect(() => {
        if (otpResendTimer <= 0) return;
        const timeout = window.setTimeout(() => setOtpResendTimer(value => Math.max(0, value - 1)), 1000);
        return () => window.clearTimeout(timeout);
    }, [otpDialogOpen, otpResendTimer]);

    useEffect(() => {
        if (otpTimer <= 0) return;

        const timeout = window.setTimeout(() => {
            setOtpTimer((current) => Math.max(0, current - 1));
        }, 1000);

        return () => window.clearTimeout(timeout);
    }, [otpDialogOpen, otpTimer]);

    useEffect(() => {
        if (otpDialogOpen && otpTimer === 0 && !otpVerificationSuccess && !otpLoading) {
            setOtp("");
        }
    }, [otpDialogOpen, otpTimer, otpVerificationSuccess, otpLoading]);

    const saveCommonSession = (data: AuthSessionData) => {
        sessionStorage.clear();
        localStorage.removeItem("token");
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
        setOtpVerificationSuccess(false);
        setOtpVerificationError("");
        setOtpDialogOpen(false);
        setLegalDocument(null);
        setHasViewedTerms(false);
        setHasViewedPrivacy(false);
        setHasAcceptedPolicies(false);
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!email || !password) {
            alert("Please enter your email and password.");
            return;
        }

        if (mode === "signup") {
            setSignupError("");
            if (!ownerName || !storeName || !phone) {
                alert("Please fill in all signup fields.");
                return;
            }

            if (!isValidMobileNumber(phone)) {
                alert("Enter a valid Philippine mobile number (e.g. 0912 345 6789).");
                return;
            }

            if (!passwordValid) {
                setSignupError(!passwordChecks.bytes ? "Your password is too long. Please use a shorter password." : "Create a password that meets all requirements.");
                return;
            }

            if (password !== confirmPassword) {
                setSignupError("Passwords do not match.");
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
                    "Please agree to the Terms of Service and acknowledge the Privacy Policy."
                );
                return;
            }

            if (accountVerified) {
                setSignupStep(2);
                return;
            }
        }

        if (mode === "signup") {
            const signupBody: PendingSignup = {
                ...policyAcceptance("owner", hasViewedTerms, hasViewedPrivacy, hasAcceptedPolicies),
                owner_name: ownerName.trim(),
                store_name: storeName.trim(),
                phone: normalizeMobileNumber(phone),
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
                    setSignupError(data.error || "Failed to send OTP.");
                    return;
                }

                setPendingSignup(signupBody);
                setOtpVerificationSuccess(false);
                setOtpVerificationError("");
                setOtp("");
                setOtpTimer(Number(data.expires_in || 300));
                setOtpResendTimer(Number(data.resend_in || 60));
                setOtpBlocked(false);
                setOtpDialogOpen(true);
            } catch {
                setSignupError("Something went wrong while sending OTP.");
            } finally {
                setLoading(false);
            }

            return;
        }

        setLoginError("");
        const submittedEmail = email.trim().toLowerCase();
        loginEmailRef.current = submittedEmail;
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
                // Do not display the previous account's result after the email has changed.
                if (loginEmailRef.current !== submittedEmail) return;
                if (data.code === "ACCOUNT_LOCKED" && Number(data.retry_after_seconds) > 0) {
                    const seconds = Math.ceil(Number(data.retry_after_seconds));
                    const now = Date.now();
                    setLoginLockSeconds(seconds);
                    setLoginLockNotice({
                        until: now + seconds * 1000,
                        shownAt: now,
                        lockoutCount: Math.max(1, Number(data.lockout_count) || 1),
                        recoveryAvailable: data.password_recovery_available === true,
                    });
                } else {
                    setLoginLockNotice(null);
                    setLoginError(data.error === "Invalid email or password." || data.code === "AUTH_FAILED"
                        ? "Invalid email or password. Try again."
                        : data.error || "Authentication failed.");
                }
                return;
            }

            setLoginLockNotice(null);
            if (data.role === "PLATFORM_ADMIN") {
                sessionStorage.clear();
                localStorage.removeItem("token");
                sessionStorage.setItem("token", data.token);
                sessionStorage.setItem("role", "PLATFORM_ADMIN");
                sessionStorage.setItem("user", JSON.stringify(data.user || {}));
                sessionStorage.setItem("full_name", data.user?.full_name || "Platform Administrator");
                sessionStorage.setItem("isLoggedIn", "true");
                onClose();
                router.replace("/platform-admin/dashboard");
                return;
            }
            saveCommonSession(data);
            onClose();
            router.push("/dashboard");
        } catch {
            if (loginEmailRef.current === submittedEmail) setLoginError("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const resetRecovery = () => {
        setRecoveryStage("none"); setRecoveryEmail(""); setRecoveryToken("");
        setNewPassword(""); setNewConfirmPassword(""); setRecoveryError("");
        setOtpDialogOpen(false); setOtp(""); setOtpBlocked(false); setOtpVerificationError("");
        setOtpResendTimer(0); setOtpTimer(0);
    };
    const startRecovery = () => {
        setRecoveryEmail(email.trim()); setPassword(""); setConfirmPassword(""); setLoginError(""); setLoginLockNotice(null);
        setRecoveryToken(""); setNewPassword(""); setNewConfirmPassword(""); setRecoveryError(""); setRecoveryStage("email");
        setOtpResendTimer(0); setOtpTimer(0);
    };
    const requestRecovery = async (event?: React.FormEvent) => {
        event?.preventDefault();
        if (otpLoading || loading || otpResendTimer > 0) return;
        if (!/^\S+@\S+\.\S+$/.test(recoveryEmail.trim())) { setRecoveryError("Enter a valid email address."); return; }
        setLoading(true); setOtpLoading(true); setRecoveryError(""); setOtpVerificationError("");
        try {
            const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "request_password_reset", email: recoveryEmail }) });
            const data = await response.json();
            if (!response.ok || data.otp_sent !== true) {
                const retryAfter = Number(data.retry_after_seconds);
                if (Number.isFinite(retryAfter) && retryAfter > 0) setOtpResendTimer(Math.ceil(retryAfter));
                if (data.code === "RECOVERY_ACCOUNT_NOT_FOUND") {
                    setRecoveryStage("email"); setOtpDialogOpen(false); setOtp(""); setOtpBlocked(false); setOtpTimer(0);
                } else if (data.code === "RECOVERY_OTP_DELIVERY_FAILED" && recoveryStage === "otp") {
                    // A failed replacement has already invalidated the previous code.
                    setOtp(""); setOtpBlocked(true); setOtpTimer(0);
                }
                throw new Error(data.error || "Unable to request a verification code. Please try again.");
            }
            setRecoveryStage("otp"); setOtp(""); setOtpBlocked(false); setOtpVerificationSuccess(false);
            setOtpTimer(Number(data.expires_in || 300)); setOtpResendTimer(Number(data.resend_in || 60)); setOtpDialogOpen(true);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unable to request a verification code.";
            setRecoveryError(message); setOtpVerificationError(message);
        } finally { setLoading(false); setOtpLoading(false); }
    };
    const submitPasswordReset = async (event: React.FormEvent) => {
        event.preventDefault();
        if (loading) return;
        if (!Object.values(newPasswordChecks).every(Boolean)) {
            setRecoveryError(!newPasswordChecks.bytes ? "Your password is too long. Please use a shorter password." : "Create a password that meets all requirements."); return;
        }
        if (newPassword !== newConfirmPassword) {
            setRecoveryError("Passwords do not match."); return;
        }
        setLoading(true); setRecoveryError("");
        try {
            const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reset_password", email: recoveryEmail, reset_token: recoveryToken, new_password: newPassword, confirm_password: newConfirmPassword }) });
            const data = await response.json();
            if (!response.ok) {
                if (data.code === "RESET_INVALID") { setRecoveryToken(""); setRecoveryStage("email"); }
                throw new Error(data.error || "Password reset failed.");
            }
            sessionStorage.clear(); localStorage.removeItem("token");
            setRecoveryToken(""); setNewPassword(""); setNewConfirmPassword(""); setPassword("");
            setEmail(recoveryEmail); setRecoveryStage("success");
        } catch (err) { setRecoveryError(err instanceof Error ? err.message : "Password reset failed."); }
        finally { setLoading(false); }
    };

    const handleVerifyOtp = async () => {
        if ((!pendingSignup && recoveryStage !== "otp") || otpLoading || otpVerificationSuccess || otpBlocked) return;
        const normalizedOtp = otp.replace(/\D/g, "").slice(0, 6);
        if (!/^\d{6}$/.test(normalizedOtp) || otpTimer <= 0) return;

        setOtpLoading(true);
        setOtpVerificationError("");
        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(recoveryStage === "otp"
                    ? { action: "verify_password_reset_otp", email: recoveryEmail, otp: normalizedOtp }
                    : { action: "verify_signup_otp", ...pendingSignup, otp: normalizedOtp }),
            });
            const data = await response.json();
            if (!response.ok || !(recoveryStage === "otp" ? data.reset_token : data.token)) {
                setOtpVerificationError(data.error || "OTP verification failed. Try again.");
                if (["OTP_ATTEMPTS_EXHAUSTED", "OTP_INVALID"].includes(data.code)) setOtpBlocked(true);
                setOtp("");
                return;
            }
            if (recoveryStage === "otp") {
                setRecoveryToken(data.reset_token);
                setOtpVerificationSuccess(true);
                await new Promise<void>(resolve => window.setTimeout(resolve, 1800));
                setOtpDialogOpen(false); setOtp(""); setRecoveryStage("password");
                return;
            }

            // Only the verified backend response may trigger the success animation.
            saveCommonSession(data);
            setOtpVerificationSuccess(true);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 1800));
            setOtpDialogOpen(false);
            setAccountVerified(true);
            setSignupStep(2);
        } catch {
            setOtpVerificationError("Unable to verify your code. Please try again.");
            setOtp("");
        } finally {
            setOtpLoading(false);
        }
    };

    const handleResendOtp = async () => {
        if (otpResendTimer > 0 || otpLoading) return;
        if (recoveryStage === "otp") { await requestRecovery(); return; }

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
                setOtpVerificationError(data.error || "Failed to resend OTP.");
                if (data.retry_after_seconds) setOtpResendTimer(Number(data.retry_after_seconds));
                return;
            }

            setOtpVerificationSuccess(false);
            setOtpVerificationError("");
            setOtp("");
            setOtpTimer(Number(data.expires_in || 300));
            setOtpResendTimer(Number(data.resend_in || 60));
            setOtpBlocked(false);
        } catch {
            alert("Something went wrong while resending OTP.");
        } finally {
            setOtpLoading(false);
        }
    };

    const handleSwitchMode = () => {
        resetSignupFlow();
        resetRecovery(); setLoginError(""); setLoginLockNotice(null); setSignupError("");
        onSwitch(mode === "login" ? "signup" : "login");
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
                !branch.manager_name.trim() || !branch.manager_email.trim()
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
            manager_name: branch.manager_name.trim(),
            manager_email: branch.manager_email.trim(),
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
            ? recoveryStage === "none" ? "Log in" : recoveryStage === "password" ? "Create new password" : recoveryStage === "success" ? "Password reset successful" : "Forgot password?"
            : setupComplete
                ? "Setup complete"
                : signupStep === 1
                    ? "Create account"
                    : signupStep === 2
                        ? "Set up your first branch"
                        : signupStep === 3
                            ? "Assign managers"
                            : "Review your setup";

    const headerDescription =
        mode === "login"
            ? recoveryStage === "none" ? "Enter your credentials to access your dashboard." : recoveryStage === "password" ? "Choose a new password to secure your account." : recoveryStage === "success" ? "You can now log in using your new password." : "Enter your registered email to recover your account."
            : setupComplete
                ? "Your account, first branch, and manager access are ready."
                : signupStep === 1
                    ? "Enter your business details to get started with StockNBook."
                    : signupStep === 2
                        ? "Start with your first branch. You can add more later after upgrading your plan."
                        : signupStep === 3
                            ? "Choose who will manage each branch and keep the same access controls."
                            : "Check your information before creating your first branch and optional manager access.";

    return (
        <>
            <div className={`snb-auth-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/45 px-2 py-3 font-sans backdrop-blur-sm sm:px-4 sm:py-4 ${isClosing ? "snb-auth-exit" : ""}`}>
                <div role="dialog"
                     aria-modal="true"
                     aria-label={mode === "login" ? "Log in to StockNBook" : "Create a StockNBook account"}
                     className="snb-auth-dialog relative grid max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
                    <button
                        type="button"
                        onClick={handleAnimatedClose}
                        className="absolute right-4 top-4 z-20 rounded-full p-2 text-white/80 transition hover:bg-white/10 md:text-[#7A6E88] md:hover:bg-[#F3EFF8]"
                        aria-label="Close modal"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <div className="snb-auth-brand-panel relative hidden min-h-[680px] overflow-hidden bg-[radial-gradient(circle_at_50%_48%,_#3D2468_0%,_#2D1B4E_52%,_#24143D_100%)] p-10 font-sans text-white md:flex md:flex-col">
                        <div className="pointer-events-none absolute -left-20 top-44 h-48 w-48 rounded-full bg-[#7958A8]/10 blur-3xl" />
                        <div className="pointer-events-none absolute -right-24 bottom-28 h-56 w-56 rounded-full bg-[#C9951A]/10 blur-3xl" />

                        <div className="relative z-10">
                            <div className="snb-auth-brand-logo flex items-center gap-2.5">
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

                            <h2 key={mode} className="snb-auth-brand-heading mt-9 max-w-[370px] font-sans text-[clamp(1.9rem,2.6vw,2.65rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-white">
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

                            <p className="snb-auth-brand-description mt-4 max-w-[370px] font-sans text-[13px] leading-6 text-white/65">
                                Manage your events, bookings, inventory, and team
                                from one clean dashboard.
                            </p>
                        </div>

                        <div className="relative z-10 flex flex-1 items-center justify-center py-6"
                             onPointerMove={moveStorefront} onPointerLeave={resetStorefrontTilt}>
                            <div ref={storefrontRef} className="snb-store-scene relative h-[245px] w-[320px]"
                                 data-step={mode === "signup" ? signupStep : "login"}>

                                <div className="snb-store-halo absolute left-1/2 top-9 h-28 w-44 -translate-x-1/2 rounded-[50%] bg-white/[0.055]" />

                                <Sparkles className="snb-store-sparkle snb-store-sparkle-left absolute left-8 top-20 h-5 w-5 text-[#E4BB56]" />
                                <Sparkles className="snb-store-sparkle snb-store-sparkle-right absolute right-8 top-10 h-3.5 w-3.5 text-[#C9951A]/70" />

                                <div className="snb-store-plant snb-store-plant-left absolute bottom-8 left-4 flex h-20 w-14 items-end justify-center">
                                    <div className="absolute bottom-0 h-14 w-1.5 rounded-full bg-[#765B91]" />
                                    <div className="absolute bottom-9 left-2 h-8 w-4 -rotate-[38deg] rounded-full bg-[#654B84]" />
                                    <div className="absolute bottom-6 right-1 h-8 w-4 rotate-[38deg] rounded-full bg-[#765B91]" />
                                    <div className="absolute bottom-1 h-5 w-10 rounded-b-lg rounded-t-sm bg-[#5A3C78]" />
                                </div>

                                <div className="snb-store-plant snb-store-plant-right absolute bottom-8 right-3 flex h-28 w-20 items-end justify-center">
                                    <div className="absolute bottom-2 h-20 w-1.5 rounded-full bg-[#806799]" />
                                    <div className="absolute bottom-16 left-3 h-10 w-5 -rotate-[42deg] rounded-full bg-[#695185]" />
                                    <div className="absolute bottom-12 right-2 h-12 w-6 rotate-[34deg] rounded-full bg-[#7E6795]" />
                                    <div className="absolute bottom-5 left-6 h-10 w-5 -rotate-[28deg] rounded-full bg-[#5E447B]" />
                                    <div className="absolute bottom-0 h-6 w-12 rounded-b-lg rounded-t-sm bg-[#5A3C78]" />
                                </div>

                                <div className="snb-store-building absolute bottom-10 left-1/2 h-[132px] w-[176px] -translate-x-1/2">
                                    <div className="absolute bottom-0 left-3 right-3 h-[104px] rounded-t-md border border-white/10 bg-[#E8DDF1]/90 shadow-[0_18px_38px_rgba(12,4,24,0.28)]" />

                                    <div className="snb-store-awning absolute left-0 right-0 top-2 h-12 overflow-hidden rounded-t-xl bg-[#6F5294]">
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

                                    <div className="snb-store-door absolute bottom-4 left-1/2 h-[65px] w-12 -translate-x-1/2 rounded-t-sm border-2 border-[#6F5790] bg-[#4B3468]">
                                        <div className="absolute left-1/2 top-4 h-2 w-2 -translate-x-1/2 rounded-full bg-[#C9951A]" />
                                        <div className="absolute bottom-2 left-1/2 h-6 w-7 -translate-x-1/2 rounded-sm bg-[#5F477A]" />
                                    </div>

                                    <div className="snb-store-window absolute bottom-6 left-6 flex h-12 w-11 items-center justify-center rounded-sm border-2 border-[#745B91] bg-[#5E447A] text-[#CDBDDB]">
                                        <Package className="h-5 w-5" />
                                    </div>

                                    <div className="snb-store-window absolute bottom-6 right-6 flex h-12 w-11 items-center justify-center rounded-sm border-2 border-[#745B91] bg-[#5E447A] text-[#CDBDDB]">
                                        <Store className="h-5 w-5" />
                                    </div>
                                </div>

                                <div className={`snb-store-check ${mode === "signup" && setupComplete ? "snb-store-check-complete" : ""} absolute bottom-2 right-8 flex h-[74px] w-[74px] items-center justify-center rounded-full border-[7px] border-[#F8EAC4] bg-[#E5C477] text-white shadow-[0_18px_34px_rgba(13,5,26,0.34)]`}>
                                    <Check className="h-9 w-9 stroke-[3]" />
                                </div>
                                {mode === "signup" && signupStep > 1 && !setupComplete && (
                                    <div key={`store-step-${signupStep}`} className="snb-store-step-accent absolute right-12 top-[85px] flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5C477]/50 bg-[#3D2468] text-[#F5E8C0] shadow-lg"
                                         aria-hidden="true">
                                        {signupStep === 2 ? <MapPin className="h-5 w-5" /> :
                                            signupStep === 3 ? <UserRound className="h-5 w-5" /> :
                                                <ShieldCheck className="h-5 w-5" />}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="snb-auth-brand-tagline relative z-10 border-y border-white/10 py-5 text-center">
                            <p className="font-serif text-xs leading-5 text-white/70">
                                “Mas madali na ang buhay ko.
                                <br />
                                Everything is in one place.”
                            </p>
                        </div>
                    </div>

                    <div ref={formScrollRef} className={`snb-auth-form-panel max-h-[94vh] overflow-y-auto p-6 sm:p-8 md:p-10 ${mode === "login" ? "md:flex md:flex-col md:justify-center" : ""}`}>
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
                            <div key={`${mode}-${signupStep}`} className="snb-auth-heading-enter">
                                <h1 className="pr-10 font-serif text-3xl text-[#1A1220] sm:text-4xl">
                                    {headerTitle}
                                </h1>

                                <p className="mt-2 text-sm leading-6 text-[#7A6E88]">
                                    {headerDescription}
                                </p>
                            </div>
                        )}

                        {mode === "signup" && !setupComplete && (
                            <OnboardingProgress currentStep={signupStep} />
                        )}

                        {mode === "login" && recoveryStage === "none" && (
                            <form className="snb-auth-form-stage mt-8 space-y-5" onSubmit={handleSubmit}>
                                <TextInput
                                    label="Email address"
                                    placeholder="you@yourbusiness.com"
                                    value={email}
                                    onChange={value => {
                                        const normalized = value.trim().toLowerCase();
                                        if (normalized !== email.trim().toLowerCase()) {
                                            setLoginError("");
                                            setLoginLockNotice(null);
                                        }
                                        loginEmailRef.current = normalized;
                                        setEmail(value);
                                    }}
                                    icon={
                                        <Mail className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    key="login-password"
                                    errorMessage={loginLockNotice ? (
                                        <div key={loginLockNotice.shownAt} className="snb-login-lock-notice mt-1.5 text-left text-sm text-red-600">
                                            <p role="status">
                                                {loginLockSeconds > 0 ? (
                                                    <>
                                                        {loginLockNotice.lockoutCount >= 5
                                                            ? "Your account is temporarily locked due to repeated unsuccessful login attempts. "
                                                            : "Your account is temporarily locked. "}
                                                        Try again in <span role="timer" aria-live="off">{String(Math.floor(loginLockSeconds / 60)).padStart(2, "0")}:{String(loginLockSeconds % 60).padStart(2, "0")}</span>.
                                                    </>
                                                ) : "You can try logging in again now."}
                                            </p>
                                            {loginLockSeconds > 0 && loginLockNotice.lockoutCount >= 2 && (
                                                <p className="mt-1">
                                                    {loginLockNotice.recoveryAvailable
                                                        ? loginLockNotice.lockoutCount === 2
                                                            ? "You can also reset your password."
                                                            : "We recommend resetting your password."
                                                        : "Contact your administrator for account recovery."}
                                                </p>
                                            )}
                                            {loginError && <p role="alert" className="mt-1">{loginError}</p>}
                                        </div>
                                    ) : loginError ? <p role="alert" className="mt-1.5 text-left text-sm text-red-600">{loginError}</p> : null}
                                    label="Password"
                                    placeholder="Enter your password"
                                    type="password"
                                    value={password}
                                    onChange={setPassword}
                                    icon={
                                        <Lock className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <div className="flex items-center justify-end text-sm">
                                    <button
                                        type="button"
                                        onClick={startRecovery}
                                        disabled={loading}
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
                                        ? <span role="status" className="snb-auth-loading-text">Logging in...</span>
                                        : "Log in to StockNBook"}
                                </button>
                            </form>
                        )}

                        {mode === "login" && recoveryStage !== "none" && (
                            <div className="snb-auth-form-stage mt-8 space-y-5">
                                {(recoveryStage === "email" || recoveryStage === "otp") && (
                                    <form className="space-y-5" onSubmit={requestRecovery}>
                                        <TextInput label="Email address" placeholder="you@yourbusiness.com" value={recoveryEmail} disabled={loading || otpLoading} onChange={value => { setRecoveryEmail(value); setRecoveryError(""); setOtpVerificationError(""); setOtpResendTimer(0); if (recoveryStage === "otp") { setRecoveryStage("email"); setOtpDialogOpen(false); setOtp(""); setOtpBlocked(false); setOtpTimer(0); } }} icon={<Mail className="h-5 w-5 text-[#7A6E88]" />} errorMessage={recoveryError && <p role="alert" className="mt-1.5 text-sm text-red-600">{recoveryError}</p>} />
                                        <p className="text-sm text-[#7A6E88]">Enter your registered email address to receive a verification code. Platform Administrators should contact their administrator for recovery.</p>
                                        <button type="submit" disabled={loading || otpLoading || otpResendTimer > 0} className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white disabled:opacity-60">{loading ? "Please wait..." : otpResendTimer > 0 ? `Try again in ${otpResendTimer}s` : "Send verification code"}</button>
                                        {recoveryStage === "otp" && <button type="button" onClick={() => setOtpDialogOpen(true)} className="w-full text-sm font-medium text-[#2D1B4E]">Enter verification code</button>}
                                    </form>
                                )}
                                {recoveryStage === "password" && (
                                    <form className="space-y-5" onSubmit={submitPasswordReset}>
                                        <TextInput label="New password" placeholder="Enter new password" type="password" value={newPassword} onChange={setNewPassword} icon={<Lock className="h-5 w-5 text-[#7A6E88]" />} />
                                        <TextInput label="Confirm new password" placeholder="Confirm new password" type="password" value={newConfirmPassword} onChange={setNewConfirmPassword} icon={<Lock className="h-5 w-5 text-[#7A6E88]" />} />
                                        <PasswordRequirements checks={newPasswordChecks} />
                                        <button disabled={loading} type="submit" className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white disabled:opacity-60">{loading ? "Please wait..." : "Reset password"}</button>
                                    </form>
                                )}
                                {recoveryStage === "password" && recoveryError && <p role="alert" className="text-sm text-red-600">{recoveryError}</p>}
                                {recoveryStage === "success" && <div role="status" className="flex items-center gap-3 rounded-xl bg-green-50 px-4 py-3 text-green-800"><CheckCircle2 className="h-6 w-6" /> Your password has been updated.</div>}
                                <button type="button" disabled={loading || otpLoading} onClick={resetRecovery} className="w-full rounded-lg border border-[#DED3EE] px-5 py-3 font-medium text-[#2D1B4E] disabled:opacity-60">Back to login</button>
                            </div>
                        )}

                        {mode === "signup" && signupStep === 1 && !setupComplete && (
                            <form
                                className={`snb-auth-form-stage snb-auth-${stepDirection} mt-6 space-y-4`}
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
                                    placeholder="Maria Santos"
                                    value={ownerName}
                                    onChange={setOwnerName}
                                    disabled={accountVerified}
                                    icon={
                                        <UserRound className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Business name"
                                    placeholder="Santos Events & Party Supply"
                                    value={storeName}
                                    onChange={setStoreName}
                                    disabled={accountVerified}
                                    icon={
                                        <Package className="h-5 w-5 text-[#7A6E88]" />
                                    }
                                />

                                <TextInput
                                    label="Phone number"
                                    placeholder={MOBILE_PHONE_PLACEHOLDER}
                                    type="tel"
                                    helperText={MOBILE_PHONE_HELP}
                                    value={phone}
                                    onChange={(value) => setPhone(formatMobileInput(value))}
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

                                <div className="space-y-4">
                                    <TextInput
                                        key="signup-password"
                                        label="Password"
                                        placeholder="Create a password"
                                        type="password"
                                        value={password}
                                        onChange={(value) => { setPassword(value); setSignupError(""); }}
                                        disabled={accountVerified}
                                        icon={
                                            <Lock className="h-5 w-5 text-[#7A6E88]" />
                                        }
                                    />

                                    <TextInput
                                        key="signup-confirm-password"
                                        label="Confirm password"
                                        placeholder="Repeat your password"
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(value) => { setConfirmPassword(value); setSignupError(""); }}
                                        disabled={accountVerified}
                                        icon={
                                            <Lock className="h-5 w-5 text-[#7A6E88]" />
                                        }
                                    />

                                    <PasswordRequirements checks={passwordChecks} />
                                    {signupError && (
                                        <p role="alert" className="text-sm text-red-600">{signupError}</p>
                                    )}
                                </div>

                                <div className="flex items-start gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={hasAcceptedPolicies}
                                        disabled={
                                            !hasViewedTerms ||
                                            !hasViewedPrivacy ||
                                            loading ||
                                            accountVerified
                                        }
                                        onChange={(event) =>
                                            setHasAcceptedPolicies(
                                                event.target.checked
                                            )
                                        }
                                        aria-label="Agree to the Terms of Service and acknowledge the Privacy Policy"
                                        className="mt-1 h-4 w-4 shrink-0 accent-[#2D1B4E] disabled:cursor-not-allowed"
                                    />

                                    <p
                                        className={
                                            hasViewedTerms &&
                                            hasViewedPrivacy &&
                                            !accountVerified
                                                ? "text-[#7A6E88]"
                                                : "text-[#AAA1B0]"
                                        }
                                    >
                                        I agree to the{" "}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setLegalDocument("terms")
                                            }
                                            className={[
                                                "underline underline-offset-2 transition hover:text-[#5B35A5] focus-visible:outline focus-visible:outline-2",
                                                hasViewedTerms
                                                    ? "text-[#8060AF] font-medium"
                                                    : "text-[#2D1B4E] font-semibold",
                                            ].join(" ")}
                                        >
                                            Terms of Service
                                        </button>{" "}
                                        and acknowledge the{" "}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setLegalDocument("privacy")
                                            }
                                            className={[
                                                "underline underline-offset-2 transition hover:text-[#5B35A5] focus-visible:outline focus-visible:outline-2",
                                                hasViewedPrivacy
                                                    ? "text-[#8060AF] font-medium"
                                                    : "text-[#2D1B4E] font-semibold",
                                            ].join(" ")}
                                        >
                                            Privacy Policy
                                        </button>
                                    </p>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading || !hasViewedTerms || !hasViewedPrivacy || !hasAcceptedPolicies}
                                    className="snb-auth-sticky-primary flex w-full items-center justify-center gap-2 rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white transition hover:bg-[#3D2560] disabled:opacity-60"
                                >
                                    <span className="inline-flex items-center gap-2">
                                        {loading
                                            ? <span role="status" className="snb-auth-loading-text">Creating...</span>
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
                            <div className={`snb-auth-form-stage snb-auth-${stepDirection} mt-6`}>
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


                                            </div>

                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <TextInput
                                                    label="Branch name"
                                                    placeholder="Main Branch"
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
                                                    placeholder={MOBILE_PHONE_PLACEHOLDER}
                                                    type="tel"
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
                                                placeholder="Concepcion Uno, Marikina City"
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

                                <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#EEDFC0] bg-[#FFFAEF] px-4 py-3 text-xs leading-5 text-[#766342]">
                                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#C9951A]" />
                                    <span>
                                        Your first branch is included with the Starter
                                        plan. You can add more branches later from the
                                        Branches page after upgrading to a plan that
                                        supports additional branches.
                                    </span>
                                </div>

                                <div className="snb-auth-sticky-actions mt-6 grid grid-cols-2 gap-3">
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
                            <div className={`snb-auth-form-stage snb-auth-${stepDirection} mt-6 space-y-5`}>
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

                                        <div className="mt-5">
                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <TextInput
                                                    label="Manager name"
                                                    placeholder="Ana Cruz"
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

                                            <div className="mt-1 flex items-start gap-2 rounded-xl border border-[#E7DFE9] bg-[#F8F5FF] px-4 py-3 text-xs leading-5 text-[#5B4A73]">
                                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6A469C]" />
                                                <span>
                                                    Managers get full access to
                                                    every module for this
                                                    branch — Sales/POS,
                                                    Bookings, Inventory,
                                                    Packages, Staff Management,
                                                    Reports, Analytics, and
                                                    Forecasting.
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                <div className="flex items-start gap-2 rounded-xl border border-[#EEDFC0] bg-[#FFFAEF] px-4 py-3 text-xs leading-5 text-[#766342]">
                                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#C9951A]" />
                                    Manager invitation links remain available
                                    after setup.
                                </div>

                                <div className="snb-auth-sticky-actions grid grid-cols-2 gap-3">
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
                            <div className={`snb-auth-form-stage snb-auth-${stepDirection} mt-6`}>
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

                                                            <div className="sm:min-w-[220px]">
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
                                                                        Feature access
                                                                    </p>

                                                                    <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#F7F4FB] px-2.5 py-1.5">
                                                                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#5B35A5]" />
                                                                        <span className="text-[11px] font-bold uppercase tracking-wide text-[#5B35A5]">
                                                                            Manager Access
                                                                        </span>
                                                                    </div>

                                                                    <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-[#6F6577]">
                                                                        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6F45B8]" />
                                                                        The manager invitation link will be emailed automatically after setup.
                                                                    </p>
                                                                </div>
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

                                <div className="snb-auth-sticky-actions mt-6 grid grid-cols-2 gap-3">
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
                                            ? <span role="status" className="snb-auth-loading-text">Creating...</span>
                                            : "Create branch & send invitations"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {mode === "signup" && setupComplete && (
                            <div className="snb-auth-form-stage py-4 text-center sm:py-8">
                                <div className="snb-auth-success-icon mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#F3ECFA]">
                                    <div className="relative">
                                        <PartyPopper className="h-12 w-12 text-[#6F45B8]" />
                                        <CheckCircle2 className="absolute -bottom-2 -right-4 h-10 w-10 rounded-full bg-white text-[#3E9A5F]" />
                                    </div>
                                </div>

                                <h1 className="mt-6 font-serif text-3xl text-[#1A1220] sm:text-4xl">
                                    Your business is ready!
                                </h1>

                                <p className="mt-3 text-sm font-semibold text-[#2D1B4E]">
                                    Your first branch was created successfully.
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
                                            "Create plans and accept bookings",
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
                        {mode === "login" && !setupComplete && (
                            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-[#2D1B4E]">
                                <button type="button" onClick={() => setLegalDocument("terms")} className="underline underline-offset-2 hover:text-[#5B35A5]">Terms of Service</button>
                                <span aria-hidden="true" className="text-[#82768F]">·</span>
                                <button type="button" onClick={() => setLegalDocument("privacy")} className="underline underline-offset-2 hover:text-[#5B35A5]">Privacy Policy</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {legalDocument && (
                <PolicyDialog
                    document={legalDocument}
                    role={mode === "signup" ? "owner" : undefined}
                    onClose={() => setLegalDocument(null)}
                    onReviewed={mode === "signup" ? () => {
                        if (legalDocument === "terms") setHasViewedTerms(true);
                        else setHasViewedPrivacy(true);
                        setLegalDocument(null);
                    } : undefined}
                />
            )}

            {otpDialogOpen && (
                <SignupOtpDialog
                    email={recoveryStage === "otp" ? recoveryEmail : pendingSignup?.email || email}
                    recovery={recoveryStage === "otp"}
                    resendTimer={otpResendTimer}
                    blocked={otpBlocked}
                    otp={otp}
                    setOtp={(value) => { setOtp(value); setOtpVerificationError(""); }}
                    timer={otpTimer}
                    verified={otpVerificationSuccess}
                    error={otpVerificationError}
                    loading={otpLoading}
                    onVerify={handleVerifyOtp}
                    onResend={handleResendOtp}
                    onClose={() => setOtpDialogOpen(false)}
                />
            )}

            {/* Motion lives in this existing file; no new stylesheet or dependency. */}
            <style jsx global>{`
                @keyframes snbLoginNotice { from { opacity: 0; } to { opacity: 1; } }
                @keyframes snbAuthLoadingText { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
                .snb-login-lock-notice { animation: snbLoginNotice .25s ease-out both; }
                .snb-auth-loading-text { animation: snbAuthLoadingText 1.5s ease-in-out infinite; }
                @keyframes snbAuthIn { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes snbAuthOut { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(8px) scale(.985); } }
                @keyframes snbAuthFade { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes snbStoreOpen { from { opacity: 0; filter: blur(2px); } to { opacity: 1; filter: blur(0); } }
                @keyframes snbStoreBuilding { from { opacity: 0; filter: blur(2px); } to { opacity: 1; filter: blur(0); } }
                @keyframes snbOverlayFade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes snbAwningOpen { from { opacity: 0; transform: scaleY(.22); } to { opacity: 1; transform: scaleY(1); } }
                @keyframes snbCheckPop { 0% { opacity: 0; transform: scale(.7); } 75% { opacity: 1; transform: scale(1.075); } 100% { opacity: 1; transform: scale(1); } }
                @keyframes snbSuccessGlow { 0%,100% { box-shadow: 0 18px 34px rgba(13,5,26,.34); } 50% { box-shadow: 0 0 0 10px rgba(229,196,119,.16), 0 18px 38px rgba(13,5,26,.34); } }
                @keyframes snbAccentIn { from { opacity: 0; transform: translateY(8px) scale(.8); } to { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes snbStepForward { from { opacity: 0; transform: translateX(15px); } to { opacity: 1; transform: translateX(0); } }
                @keyframes snbStepBack { from { opacity: 0; transform: translateX(-15px); } to { opacity: 1; transform: translateX(0); } }
                .snb-auth-overlay { animation: snbOverlayFade .23s ease-out both; }
                .snb-auth-dialog { animation: snbAuthIn .4s cubic-bezier(.2,.75,.2,1) both; }
                .snb-auth-overlay.snb-auth-exit { animation: snbOverlayFade .19s ease-in reverse both; }
                .snb-auth-exit .snb-auth-dialog { animation: snbAuthOut .19s ease-in both; }
                .snb-auth-brand-panel { animation: snbAuthFade .38s ease-out .07s both; }
                .snb-auth-brand-logo { animation: snbAuthFade .3s ease-out .08s both; }
                .snb-auth-brand-heading { animation: snbAuthFade .38s ease-out .17s both; }
                .snb-auth-brand-description { animation: snbAuthFade .37s ease-out .25s both; }
                .snb-auth-brand-tagline { animation: snbAuthFade .38s ease-out .63s both; }
                .snb-store-scene {
                    transform: perspective(800px) rotateX(0deg) rotateY(0deg);
                    transition: transform .36s ease-out; animation: snbStoreOpen .62s ease-out .18s both; will-change: transform; }
                .snb-store-halo { opacity: .9; transition: opacity .4s ease; }
                .snb-store-scene:hover .snb-store-halo { opacity: 1; }
                .snb-store-building { animation: snbStoreBuilding .45s ease-out .27s both; }
                .snb-store-awning { transform-origin: center top; animation: snbAwningOpen .45s cubic-bezier(.2,.8,.2,1) .42s both; transition: filter .35s ease; }
                .snb-store-door, .snb-store-window { transition: filter .35s ease, box-shadow .35s ease; }
                .snb-store-scene:hover .snb-store-window { filter: brightness(1.15); }
                .snb-store-scene[data-step="2"] .snb-store-door { filter: brightness(1.16); }
                .snb-store-scene[data-step="3"] .snb-store-window { filter: brightness(1.2); }
                .snb-store-scene[data-step="4"] .snb-store-awning { filter: brightness(1.12); }
                .snb-store-plant-left { animation: snbAuthFade .4s ease-out .51s both; }
                .snb-store-plant-right { animation: snbAuthFade .4s ease-out .59s both; }
                .snb-store-check { animation: snbCheckPop .45s cubic-bezier(.2,.8,.2,1) .64s both; }
                .snb-store-check-complete { animation: snbSuccessGlow .9s ease-out 1; }
                .snb-store-sparkle { animation: snbCheckPop .4s ease-out .72s both; transition: filter .25s ease; }
                .snb-store-scene:hover .snb-store-sparkle { filter: brightness(1.5); }
                .snb-store-step-accent { animation: snbAccentIn .32s ease-out both; }
                .snb-auth-heading-enter { animation: snbAuthFade .32s ease-out both; }
                .snb-auth-form-panel { overscroll-behavior: contain; }
                .snb-auth-form-stage { animation: snbStepForward .36s ease-out both; }
                .snb-auth-form-stage.snb-auth-back { animation-name: snbStepBack; }
                .snb-auth-form-stage > * { animation: snbAuthFade .3s ease-out both; }
                .snb-auth-form-stage > :nth-child(1) { animation-delay: .06s; }
                .snb-auth-form-stage > :nth-child(2) { animation-delay: .10s; }
                .snb-auth-form-stage > :nth-child(3) { animation-delay: .14s; }
                .snb-auth-form-stage > :nth-child(4) { animation-delay: .18s; }
                .snb-auth-form-stage > :nth-child(5) { animation-delay: .22s; }
                .snb-auth-form-stage > :nth-child(6) { animation-delay: .26s; }
                .snb-auth-sticky-actions { position: sticky; bottom: 0; z-index: 5; padding-top: 12px; padding-bottom: 6px; background: rgba(255,255,255,.96); backdrop-filter: blur(8px); border-top: 1px solid #EEE7F2; }
                .snb-auth-sticky-primary { position: sticky; bottom: 0; z-index: 5; box-shadow: 0 0 0 8px rgba(255,255,255,.96); }
                .snb-auth-input > svg { transition: color .22s ease, transform .22s ease; }
                .snb-auth-input:focus-within > svg { color: #6F45B8; transform: scale(1.06); }
                .snb-auth-input:focus-within { transition: border-color .22s ease, box-shadow .22s ease; }
                .snb-auth-success-icon { animation: snbCheckPop .55s cubic-bezier(.2,.8,.2,1) both; }
                .snb-auth-otp-enter { animation: snbAuthIn .35s ease-out both; }
                @media (hover: none), (pointer: coarse) { .snb-store-scene { transform: none !important; } }
                @media (prefers-reduced-motion: reduce) {
                    .snb-auth-overlay, .snb-auth-dialog, .snb-auth-brand-panel, .snb-auth-brand-logo, .snb-auth-brand-heading,
                    .snb-auth-brand-description, .snb-auth-brand-tagline, .snb-store-scene, .snb-store-awning,
                    .snb-store-plant, .snb-store-check, .snb-store-sparkle, .snb-store-step-accent, .snb-auth-heading-enter,
                    .snb-auth-form-stage, .snb-auth-form-stage > *, .snb-auth-success-icon, .snb-auth-otp-enter { animation: none !important; opacity: 1 !important; transform: none; }
                    .snb-store-building, .snb-login-lock-notice, .snb-auth-loading-text { animation: none !important; opacity: 1 !important; }
                    .snb-auth-input > svg { transition: none !important; }
                    .snb-auth-sticky-actions { backdrop-filter: none; }
                }
            `}</style>
        </>
    );
}

function OnboardingProgress({ currentStep }: { currentStep: number }) {
    const steps = [
        { number: 1, label: "Business info" },
        { number: 2, label: "Branch" },
        { number: 3, label: "Managers" },
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
                                        "absolute right-1/2 top-4 h-px w-full transition-colors duration-500",
                                        isComplete || isActive
                                            ? "bg-[#6A469C]"
                                            : "bg-[#DED7E4]",
                                    ].join(" ")}
                                />
                            )}

                            <div
                                className={[
                                    "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition-all duration-500",
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

function SignupOtpDialog({
                             email, otp, setOtp, timer, resendTimer, blocked, recovery, loading, verified, error, onVerify, onResend, onClose,
                         }: {
    email: string;
    otp: string;
    setOtp: (value: string) => void;
    timer: number;
    resendTimer: number;
    blocked: boolean;
    recovery: boolean;
    loading: boolean;
    verified: boolean;
    error: string;
    onVerify: () => void;
    onResend: () => void;
    onClose: () => void;
}) {
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const attemptedOtp = useRef("");
    const isExpired = timer <= 0 || blocked;
    const otpDigits = Array.from({ length: 6 }, (_, index) => otp[index] || "");
    const formattedTimer = `${String(Math.floor(resendTimer / 60)).padStart(2, "0")}:${String(resendTimer % 60).padStart(2, "0")}`;

    useEffect(() => {
        const focus = window.setTimeout(() => inputRefs.current[0]?.focus(), 40);
        return () => window.clearTimeout(focus);
    }, []);

    useEffect(() => {
        if (error && !loading && !verified && !isExpired) inputRefs.current[0]?.focus();
    }, [error, loading, verified, isExpired]);

    useEffect(() => {
        if (!/^\d{6}$/.test(otp)) {
            attemptedOtp.current = "";
            return;
        }
        if (isExpired || loading || verified || attemptedOtp.current === otp) return;
        attemptedOtp.current = otp;
        onVerify();
    }, [otp, isExpired, loading, verified, onVerify]);

    const updateDigit = (index: number, value: string) => {
        if (isExpired || loading || verified) return;
        const digit = value.replace(/\D/g, "").slice(-1);
        const next = otp.padEnd(6, " ").split("");
        next[index] = digit || " ";
        setOtp(next.join("").replace(/ /g, "").slice(0, 6));
        if (digit && index < 5) inputRefs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Backspace") {
            if (otpDigits[index]) {
                updateDigit(index, "");
            } else if (index > 0) {
                inputRefs.current[index - 1]?.focus();
                updateDigit(index - 1, "");
            }
            event.preventDefault();
        }
        if (event.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
        if (event.key === "ArrowRight" && index < 5) inputRefs.current[index + 1]?.focus();
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
        if (isExpired || loading || verified) return;
        event.preventDefault();
        const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (pasted) {
            setOtp(pasted);
            inputRefs.current[Math.min(pasted.length, 6) - 1]?.focus();
        }
    };

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="signup-otp-title" className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#160C27]/65 px-3 py-3 backdrop-blur-md sm:px-4 sm:py-6">
            <div className="snb-auth-otp-enter relative w-full max-w-[430px] overflow-hidden rounded-[28px] border border-white/70 bg-white px-6 pb-7 pt-8 text-center shadow-[0_28px_80px_rgba(22,12,39,0.32)] sm:px-9">
                <button type="button" onClick={onClose} disabled={loading || verified} aria-label="Close OTP verification" className="absolute right-4 top-4 rounded-full p-2 text-[#7A6E88] transition hover:bg-[#F3EFF8] hover:text-[#2D1B4E] disabled:opacity-50"><X className="h-5 w-5" /></button>
                <div className="relative mx-auto flex h-[86px] w-[86px] items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-[#EEE5FF]" /><div className="absolute inset-[11px] rounded-full bg-[#DCCBFF]" />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#2D1B4E] text-white shadow-lg">{verified ? <Check className="snb-otp-success-icon h-8 w-8 text-[#F1C85C]" /> : <Mail className="h-7 w-7" />}</div>
                    <Sparkles className="absolute -right-1 top-1 h-4 w-4 text-[#C9951A]" /><Sparkles className="absolute -left-1 bottom-3 h-3.5 w-3.5 text-[#C9951A]" />
                </div>
                <h2 id="signup-otp-title" className="mt-4 font-serif text-[32px] font-semibold leading-tight text-[#2D1B4E]">{verified ? "Verified Successfully" : "Verify your email"}</h2>
                <p className="mt-2 text-sm leading-6 text-[#7A6E88]">{verified ? "Your email has been verified." : recovery ? "Enter the 6-digit password reset code sent to" : "Enter the 6-digit code sent to"}</p>
                {!verified && <p className="mt-0.5 break-all text-sm font-bold text-[#2D1B4E]">{email}</p>}
                <div className="mt-6 flex justify-center gap-2 sm:gap-3">
                    {otpDigits.map((digit, index) => (
                        <div key={index} className="relative">
                            <input
                                ref={(element) => { inputRefs.current[index] = element; }}
                                value={digit} type="text" inputMode="numeric" pattern="[0-9]*"
                                autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1}
                                disabled={isExpired || loading || verified} aria-label={`OTP digit ${index + 1}`}
                                style={verified ? { animationDelay: `${index * 65}ms` } : undefined}
                                onChange={(event) => updateDigit(index, event.target.value)}
                                onKeyDown={(event) => handleKeyDown(index, event)}
                                onPaste={handlePaste} onFocus={(event) => event.target.select()}
                                className={`snb-otp-digit h-14 w-10 rounded-xl border bg-white text-center text-2xl font-bold text-[#2D1B4E] outline-none transition-all duration-200 sm:w-11 ${verified ? "snb-otp-confirmed border-[#46A36A] bg-[#F0FBF4]" : digit ? "snb-otp-filled border-[#C9951A] bg-[#FFFBF2]" : "border-[#DED3EE]"} focus:border-[#6F45B8] focus:ring-4 focus:ring-[#6F45B8]/15 disabled:opacity-80`}
                            />
                            {index < 5 && <span aria-hidden="true" className={`pointer-events-none absolute -right-2 top-1/2 z-10 h-0.5 w-2 -translate-y-1/2 transition-colors duration-200 ${digit ? "bg-[#C9951A]" : "bg-[#E8DFEF]"}`} />}
                        </div>
                    ))}
                </div>
                {error && <p role="alert" className="mt-3 text-center text-sm font-medium text-red-600">{error}</p>}
                {verified ? (
                    <div role="status" aria-live="polite" className="snb-otp-confirmed-label mt-5 flex items-center justify-center gap-2 font-semibold text-[#318653]"><Check className="h-6 w-6" /> Verified and secure</div>
                ) : (
                    <div role="status" aria-live="polite" className={`mx-auto mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold tabular-nums ${isExpired ? "bg-red-50 text-red-600" : "bg-[#F1E9FF] text-[#6F45B8]"}`}><Clock3 className="h-4 w-4" />{resendTimer > 0 ? `Resend available in ${formattedTimer}` : "Resend available"}</div>
                )}
                {loading && !verified && <p role="status" className="mt-3 text-sm font-medium text-[#6F45B8]">Checking your code...</p>}
                {isExpired && !verified && !error && <p className="mt-3 text-center text-xs text-red-600">This code is no longer usable. Request another when available.</p>}
                <div className="mt-6 flex items-center gap-3"><div className="h-px flex-1 bg-[#EBE4F0]" /><span className="text-xs text-[#7A6E88]">Didn&apos;t receive the code?</span><div className="h-px flex-1 bg-[#EBE4F0]" /></div>
                <button type="button" disabled={loading || verified || resendTimer > 0} onClick={onResend} aria-label="Resend verification code" className="mx-auto mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-[#6F35C5] transition hover:bg-[#F5EFFF] disabled:cursor-not-allowed disabled:text-[#B9AFCA] disabled:hover:bg-transparent"><RefreshCw className={loading && !verified ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Resend</button>
                <div className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-[#FAF8FC] px-4 py-3 text-xs text-[#7A6E88]"><ShieldCheck className="h-4 w-4 shrink-0 text-[#6F45B8]" /><span>For your security, never share this code with anyone.</span></div>
                <style jsx>{`
                    .snb-otp-filled { box-shadow: 0 0 0 2px rgba(201,149,26,.12), 0 0 12px rgba(201,149,26,.14); animation: snbOtpPop .22s ease-out; }
                    .snb-otp-confirmed { box-shadow: 0 0 15px rgba(70,163,106,.26); animation: snbOtpPop .65s ease-out both; }
                    .snb-otp-confirmed-label { animation: snbOtpPop .8s ease-out .2s both; }
                    .snb-otp-success-icon { animation: snbOtpPop .8s cubic-bezier(.2,.8,.2,1) both; }
                    @keyframes snbOtpPop { from { transform: scale(.9); opacity: .55; } to { transform: scale(1); opacity: 1; } }
                    @media (prefers-reduced-motion: reduce) { .snb-otp-filled, .snb-otp-confirmed, .snb-otp-confirmed-label, .snb-otp-success-icon { animation: none; } }
                `}</style>
            </div>
        </div>
    );
}

function getPasswordChecks(password: string) {
    return {
        length: Array.from(password).length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/.test(password),
        bytes: new TextEncoder().encode(password).length <= 72,
    };
}

function PasswordRequirements({ checks }: { checks: ReturnType<typeof getPasswordChecks> }) {
    return (
        <div>
            <p className="text-sm font-semibold text-[#2D1B4E]">Password must include:</p>
            <div className="mt-2 space-y-1.5 text-sm">
                {[
                    [checks.length, "At least 8 characters"],
                    [checks.uppercase, "At least one uppercase letter (A–Z)"],
                    [checks.lowercase, "At least one lowercase letter (a–z)"],
                    [checks.number, "At least one number (0–9)"],
                    [checks.special, "At least one special character (!, @, #, etc.)"],
                ].map(([valid, requirement]) => (
                    <p key={String(requirement)} className={`flex items-center gap-2 ${valid ? "font-medium text-[#168A4A]" : "text-[#7A6E88]"}`}>
                        <CheckCircle2 className={`h-4 w-4 shrink-0 ${valid ? "text-[#1AA05A]" : "text-[#8E8497]"}`} />
                        <span>{String(requirement)}</span>
                    </p>
                ))}
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
                       helperText,
                       errorMessage,
                   }: {
    label: string;
    placeholder: string;
    type?: string;
    value?: string;
    onChange?: (value: string) => void;
    icon?: React.ReactNode;
    disabled?: boolean;
    helperText?: string;
    errorMessage?: React.ReactNode;
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
                    "snb-auth-input flex items-center gap-3 rounded-lg border px-4 py-3 transition",
                    disabled
                        ? "border-[#EEE8F1] bg-[#F7F4F8]"
                        : "border-[#EBE4F0] bg-white focus-within:border-[#2D1B4E] focus-within:ring-4 focus-within:ring-[#2D1B4E]/10",
                ].join(" ")}
            >
                {icon}

                <input
                    type={resolvedType}
                    inputMode={type === "tel" ? "tel" : undefined}
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
                            <Eye className="h-5 w-5" />
                        ) : (
                            <EyeOff className="h-5 w-5" />
                        )}
                    </button>
                )}
            </div>
            {helperText && <p className="mt-1.5 text-xs text-[#7A6E88]">{helperText}</p>}
            {errorMessage}
        </div>
    );
}

// Shared legal policies and dialog (kept in this existing source file).
export type PolicyKind = "terms" | "privacy";
export type PolicyRole = "owner" | "manager" | "staff";
// Draft release for local acceptance testing. Freeze this text and set a new
// version (also in lambda-auth/index.js) after formal approval for publication.
export const POLICY_RELEASE = "1.0-draft";
export type PolicyAcceptance = {
    terms_version: string;
    privacy_version: string;
    terms_reviewed: boolean;
    privacy_reviewed: boolean;
    policies_accepted: boolean;
};
export function policyAcceptance(role: PolicyRole, terms: boolean, privacy: boolean, accepted: boolean): PolicyAcceptance {
    return { terms_version: `${POLICY_RELEASE}-${role}`, privacy_version: `${POLICY_RELEASE}-${role}`,
        terms_reviewed: terms, privacy_reviewed: privacy, policies_accepted: accepted };
}
export function isPolicyRole(value: unknown): value is PolicyRole {
    return value === "owner" || value === "manager" || value === "staff";
}
const roleLabels: Record<PolicyRole, string> = { owner: "Business Owner", manager: "Branch Manager", staff: "Staff" };
type Block = string | { heading: string } | { bullets: string[] };
type Section = { title: string; blocks: Block[] };
const section = (title: string, ...blocks: Block[]): Section => ({ title, blocks });
const bullets = (...items: string[]): Block => ({ bullets: items });
const heading = (title: string): Block => ({ heading: title });

const generalTerms = [
    section("Introduction and Acceptance of Terms",
        "These Terms of Service govern access to and use of StockNBook, a web-based business management platform developed to support party supplies, rental services, and event-related businesses. The platform integrates operational recordkeeping and business administration within the authorized account and subscription scope.",
        "StockNBook provides booking and reservation management, consumable and rental inventory, packages, point-of-sale transactions, workforce account administration, subscription services, analytics, and demand forecasting. Availability of these functions depends on the account role, business and branch assignments, and effective subscription entitlements.",
        "By expressly accepting these Terms when creating or activating an account, the user agrees to the conditions governing authorized use of the platform. Review of the Privacy Policy separately acknowledges the information provided about personal data processing."),
    section("Definitions and Account Eligibility",
        "A business or store is the registered business account; a branch is an operational location associated with that business. A Business Owner administers the business, a Branch Manager oversees authorized branch operations, and a Staff member performs individually authorized duties. Platform Administrators perform separate platform-level administrative functions.",
        "Users must provide accurate, complete, and current account information. Owners must have authority to register and administer the business represented by their account. Managers and Staff must be invited by an authorized business representative. Impersonation, fraudulent registration, and creation of accounts for unauthorized purposes are prohibited."),
    section("Account Security and Authentication",
        "Each user is responsible for protecting their account credentials and exercising reasonable care when accessing business records, particularly on shared computers or networks. StockNBook uses account verification, temporary restrictions after unsuccessful authentication, verification-code controls, and password recovery mechanisms to help protect accounts.",
        "Users must observe the following responsibilities:",
        bullets("Keep passwords, one-time verification codes, and invitation links confidential.", "Use only their individually authorized accounts and log out when finished using shared devices.", "Keep account details accurate and use the authorized recovery process when credentials are lost or compromised.", "Promptly report suspected unauthorized access, suspicious activity, or unauthorized transactions to the appropriate business representative or support contact."),
        "Security restrictions are intended to protect the integrity of accounts and records. They do not grant any user authority to bypass authentication or to access another person's account."),
    section("Role-Based Access and Authorization",
        "Access is governed by role, associated business, branch assignment, account status, authorized permissions, and subscription entitlements. Owners have authorized business-wide access; Managers have applicable Manager capabilities within their assigned branch; Staff have the permissions granted for their duties.",
        "Users must not attempt to access another business or unauthorized branch, elevate privileges, alter authorization controls, or perform actions reserved for other roles. Access may be adjusted or revoked by authorized representatives when responsibilities or account status change. Subscription entitlements remain a separate restriction from role-based authorization."),
    section("Acceptable Use of the Platform",
        "StockNBook must be used for lawful and legitimate business purposes. Users must not knowingly compromise service availability, record integrity, or the confidentiality of information belonging to others.",
        "Prohibited conduct includes:", bullets("Submitting fraudulent transactions, false subscription receipts, or misleading account information.", "Extracting, copying, transferring, or disclosing records without authorization.", "Introducing malicious software, interfering with infrastructure, or deliberately exploiting vulnerabilities.", "Circumventing verification, account restrictions, tenant isolation, or other security controls."),
        "Suspected security weaknesses should be reported through an authorized support channel rather than exploited against live records."),
    section("Accuracy and Integrity of Business Records",
        "Users must exercise reasonable care when creating and updating bookings, inventory quantities, sales, payment information, customer records, and other authorized operational information. Records should reflect actual business activities and applicable approval or settlement procedures.",
        "Errors, shortages, damaged or missing equipment, payment discrepancies, and suspected unauthorized modifications should be reported to the responsible supervisor or Owner. Historical records must not be improperly altered, fabricated, or deleted to conceal losses, mistakes, or misconduct."),
    section("Confidentiality and Data Protection",
        "Personal, customer, employee, financial, and other confidential business information may be used only for legitimate authorized purposes. Users must protect information against unnecessary access, disclosure, copying, or transfer and observe applicable privacy obligations, including Republic Act No. 10173, the Data Privacy Act of 2012.",
        "The registered business remains responsible for determining its authority to collect and use information about its customers and workforce. StockNBook's processing practices are explained in the accompanying Privacy Policy; accepting these Terms does not waive the rights of individuals whose information is processed."),
    section("Business Data and Intellectual Property",
        "As between the platform and the registered business, the business retains its applicable rights over lawfully submitted records and content. The business authorizes processing necessary to provide, support, maintain, and secure the service, subject to applicable service arrangements and data protection requirements.",
        "StockNBook software, branding, application design, and proprietary components remain subject to the intellectual property rights of their lawful owners. Authorized access does not transfer ownership of the software or permit unauthorized redistribution. This provision does not affect statutory rights over personal information."),
    section("Platform Availability and Maintenance",
        "Maintenance, security updates, technical improvements, infrastructure failures, and network interruptions may temporarily affect platform availability. Reasonable care should be exercised in maintaining the service, but uninterrupted operation and complete freedom from errors cannot be guaranteed.",
        "Businesses should maintain appropriate operational procedures, verify important records, and report service problems promptly. Availability limitations do not remove mandatory legal obligations or rights."),
    section("Analytics and Forecasting Limitations",
        "Reports, analytics, and forecasts are decision-support tools derived from available records and calculation methods. Their usefulness depends on record accuracy, reporting periods, and the amount and quality of historical information. Forecasts are estimates rather than guarantees of future demand, revenue, profitability, or other business outcomes.",
        "Users should consider actual business conditions and exercise independent professional judgment. StockNBook does not replace legal, tax, accounting, financial, or regulatory advice."),
    section("Account Suspension and Termination",
        "Account access may be restricted, suspended, or terminated where reasonably necessary to respond to security risks, misuse, loss of business authorization, or applicable legal requirements. Such decisions remain subject to applicable law and relevant business arrangements.",
        "Users whose employment, assignment, or authorization ends must discontinue unauthorized access. Account deactivation does not automatically authorize deletion of historical transactions or personal information required for lawful business, security, or recordkeeping purposes."),
    section("Liability and User Responsibilities",
        "Registered businesses remain responsible for their commercial activities, fulfillment of reservations, delivery and rental arrangements, physical inventory, customer dealings, and the accuracy of information entered by authorized users. StockNBook provides management and recordkeeping functionality; it does not itself fulfill the business's bookings or supply goods to its customers.",
        "Any allocation or limitation of liability is subject to applicable law. Nothing in these Terms excludes obligations, remedies, or protections that cannot lawfully be excluded."),
    section("Policy Updates and Electronic Acceptance",
        "These Terms may be revised to reflect changes in functionality, commercial practices, security requirements, or applicable laws. Material changes should be communicated through appropriate channels, and renewed agreement obtained where required.",
        "Account creation or activation records the applicable document version and acknowledgment time. Confirmation of document review is a statement by the user; it does not prove that every provision was actually read or understood. The applicable version and effective date are identified with the document."),
    section("Governing Law and Contact Information",
        "These Terms are subject to applicable laws of the Republic of the Philippines, without prejudice to mandatory protections or available remedies. Questions about account use, service conditions, or suspected misuse may be directed to the support contact shown on the StockNBook landing page: support@stocknbook.com.",
        "The operator's legal identity, service address, and effective date must be confirmed before these draft Terms are formally published. The listed support address must also be confirmed as an operational contact."),
];

const roleTerms: Record<PolicyRole, Section[]> = {
    owner: [
        section("Business Registration and Administration", "The Business Owner represents that they have authority to register and administer the business. The Owner is responsible for keeping the business identity, contact details, branch records, and authorized account assignments accurate and for ensuring that the platform is used in accordance with applicable commercial and data protection requirements.", "The Owner is responsible for establishing appropriate business procedures and for reviewing records and decisions affecting the business as a whole."),
        section("Subscription Plans and Payments", "The Owner is responsible for reviewing the fees, available features, resource limits, and billing conditions of the selected plan before submitting payment. Newly registered businesses begin on Starter; Growth and Scale entitlements become effective only after the required verification and approval process.", "A pending or rejected payment does not activate paid entitlements. Without an effective renewal, Growth or Scale reverts to Starter after its paid period ends, under the existing date-based expiration policy. The paid plan remains usable through its expiration date. When a downgrade takes effect, the corresponding plan limitations may restrict further resource creation or paid features without automatically deleting existing business records.", "The Owner must submit genuine payment information and retain appropriate records. The final cancellation, refund, renewal, and any grace-period conditions must be disclosed before paid subscriptions are offered."),
        section("Branch and Manager Administration", "The Owner appoints authorized Managers, maintains valid branch assignments, and oversees the administration of Manager accounts and invitations. Managers receive standard role capabilities within their assigned branch, subject to account status and subscription limitations.", "When an assignment changes or ends, the Owner should promptly update or deactivate access through the authorized account-management process. The Owner must not obtain or share another user's private credentials."),
        section("Business and Financial Records", "The Owner oversees the accuracy and appropriate use of booking, inventory, sales, payment, and other operational records across the registered business. Reports must be independently reviewed before they are used for financial reporting, taxation, or formal accounting purposes.", "The Owner should establish processes for investigating errors and discrepancies, correcting records through authorized procedures, and retaining business records for applicable contractual or legal requirements."),
        section("Customer and Employee Information", "The Owner must ensure that personal information supplied by the business is collected and processed lawfully, with appropriate notice, authorized access, and appropriate safeguards. Where the business determines the purposes and methods of processing, it is responsible for the obligations applicable to a personal information controller.", "The Owner should authorize access only as necessary for legitimate operational responsibilities and arrange appropriate handling of requests from customers and employees."),
        section("Workforce Access and Accountability", "The Owner must exercise reasonable oversight of Manager and Staff access, establish appropriate security awareness and confidentiality procedures, and address suspicious transactions or access promptly. Account restrictions and investigations must respect applicable law and must not be used to conceal business discrepancies.")
    ],
    manager: [
        section("Authorized Branch Assignment", "The Manager is authorized to perform functions for the business and branch identified in the verified invitation and current account assignment. Standard Manager capabilities apply only within that scope and remain subject to account status and the business's subscription entitlements.", "The Manager must not access or administer unauthorized branches or claim privileges reserved for Owners or Platform Administrators. A change in assignment does not authorize continued access to the previous branch."),
        section("Branch Operations and Management", "The Manager oversees authorized booking, inventory, rental, packages, sales, and other operational functions within the assigned branch. Reasonable care must be exercised when approving or preparing reservations, reviewing availability, recording transactions, and carrying out business procedures.", "The Manager should coordinate operational decisions with the Owner where required and report unresolved conflicts or discrepancies promptly."),
        section("Staff Account Administration", "The Manager may invite and administer Staff within the assigned branch according to established business rules. Staff permissions must reflect their legitimate duties rather than convenience or blanket access.", "The Manager must keep assignments current, deactivate access when authorization ends, avoid requesting Staff passwords, and never grant permissions beyond the capabilities available to Staff."),
        section("Transaction Accuracy and Operational Accountability", "The Manager must oversee the accurate recording of authorized transactions and review operational discrepancies within the assigned branch. Booking conflicts, stock shortages, damaged or missing items, and suspicious payment or transaction activity should be reported to the appropriate Owner.", "Records must not be deliberately manipulated to conceal losses, discrepancies, unauthorized transactions, or misconduct."),
        section("Confidentiality and Information Handling", "The Manager may access customer, employee, sales, and inventory information only where necessary for authorized branch responsibilities. Such information must not be disclosed, exported, or transferred to unauthorized individuals or used for unrelated personal purposes.", "The Manager must respect the registered business's applicable privacy arrangements and promptly report suspected disclosure or security incidents."),
        section("Termination of Assignment", "Manager access remains subject to business authorization, branch assignment, account status, subscription limitations, and reasonable platform security measures. When assignment ends or changes, the Manager must stop using information and operations no longer authorized.", "The Manager should cooperate with legitimate audits and security investigations, subject to confidentiality and applicable legal protections.")
    ],
    staff: [
        section("Assigned Duties and Authorized Access", "Staff members may use StockNBook only for legitimate activities associated with their assigned business, branch, and individual module permissions. Authorization is established by the appropriate business representative and does not confer management or platform-level authority.", "Staff must not perform unauthorized operations, access restricted records, bypass permission checks, or modify their own role or access privileges."),
        section("Booking, Inventory and Sales Responsibilities", "Staff must accurately record authorized booking preparation, release and return activities, inventory movements, point-of-sale transactions, and other assigned duties according to available system functions and established procedures.", "Items sold, restocked, released, returned, replaced, damaged, or missing must be recorded appropriately where the Staff member is authorized to do so. Staff must not fabricate transactions or conceal discrepancies."),
        section("Account and Credential Protection", "Staff must use their own authorized account and keep passwords, verification codes, and invitations confidential. Shared accounts and use of another employee's credentials are prohibited.", "If unauthorized account activity is suspected, Staff must promptly notify the appropriate Manager or Owner and follow the authorized recovery or reporting process."),
        section("Customer Information and Confidentiality", "Staff may encounter customer contact details, reservation information, and transaction records while performing their duties. Access to such information is limited to the legitimate purpose for which it was provided.", "Staff must not copy, disclose, distribute, or use information for personal purposes or provide it to unauthorized individuals. Any suspected disclosure must be reported."),
        section("Operational Accuracy and Accountability", "Staff must exercise reasonable care when recording transaction details and maintaining business information. Errors, booking concerns, shortages, payment discrepancies, and irregularities should be reported to the authorized supervisor.", "Actions performed by Staff may be recorded for operational accountability, authorized review, and security. Such records must be handled consistently with the applicable Privacy Policy."),
        section("End of Authorization", "Staff access may be restricted or deactivated when employment, branch assignment, duties, or business authorization changes or ends. Staff must discontinue unauthorized access and protect information obtained during their assignment.", "Deactivation does not automatically erase historical transactions or activity records required for legitimate business or legal purposes.")
    ]
};

const generalPrivacy = [
    section("Introduction and Scope", "This Privacy Policy explains how personal information is collected, processed, stored, disclosed, and retained in connection with StockNBook's business management services. It applies to account holders and relevant processing of information submitted through the platform.", "The policy is informed by the Data Privacy Act of 2012 (Republic Act No. 10173) and its implementing rules. Processing must observe transparency, legitimate purpose, and proportionality. Customers who use a public booking portal should also receive a notice appropriate to that interaction."),
    section("Personal Information Controller and Processor", "The StockNBook operator determines certain platform-level processing, such as account administration, subscription verification, and security, and may act as a personal information controller for those activities. Registered businesses may act as controllers for customer, workforce, and operational information which they collect and administer; StockNBook may process that information on their behalf.", "These responsibilities depend on who actually determines the purposes and methods of processing. The operator's legal name, address, and designated privacy representative must be confirmed before publication, together with applicable processing arrangements."),
    section("Categories of Personal Information Collected", "The information processed depends on the account role and functions used. Necessary information may be supplied during registration, invitations, recovery, subscription administration, or business operations. Categories include:",
        bullets("Account identity and contact details: full name, email address, telephone number, user identifiers, and account status.", "Business and workforce association: business details, employee identifiers, branch assignments, roles, and permissions.", "Authentication and security information: protected password representations, verification and recovery records, authentication restrictions, and security events.", "Operational information: customer contact and booking details, inventory and sales records containing personal information, and authorized activity records.", "Subscription information: plan selections, payment references, amounts, submitted receipts, and approval records where applicable.", "Agreement information: document versions and acceptance or acknowledgment timestamps."),
        "Users should not submit unrelated personal information or include unnecessary sensitive data in transaction records or uploaded receipts."),
    section("Sources and Methods of Data Collection", "Information may be provided directly through account registration, invitation acceptance, password recovery, profile administration, or use of business functions. An authorized Owner or Manager may submit information needed to create or administer a workforce account. Customers may provide information through appropriate booking functions.", "Operational records and relevant security events may also be generated as users interact with the service. A person submitting information about another individual must have appropriate authority and a lawful basis to do so."),
    section("Purposes of Personal Information Processing", "Personal information is processed to the extent necessary to deliver authorized services, administer accounts, protect business records, and meet applicable contractual and legal obligations. The precise purpose depends on the role, business association, and particular activity.",
        heading("5.1. Account registration and administration"), "Account and invitation details establish account identity and eligibility, manage business and branch association, verify contact information, and administer account access.",
        heading("5.2. Authentication and security"), "Verification, authentication-event information, and account restrictions support secure access, account recovery, and investigation of suspected unauthorized activity.",
        heading("5.3. Authorized business operations"), "Business-controlled information may support the following operations:", bullets("Customer bookings, reservations, rental activities, and related settlements.", "Consumable and rental inventory management and point-of-sale transactions.", "Authorized reporting, analytics, demand forecasting, and operational review.", "Workforce administration, branch assignment, and module permissions."),
        heading("5.4. Billing and service administration"), "Subscription information supports payment verification, access to applicable plan features, renewal administration, and financial records. Information may also support inquiries, technical assistance, and legal obligations.",
        heading("5.5. Further processing"), "Information must not be used for an incompatible purpose without an applicable lawful basis and required additional information or consent."),
    section("Lawful Basis for Processing", "Each controller must identify an appropriate lawful basis for its own processing. Depending on the activity, this may include necessity for a contract, compliance with a legal obligation, legitimate interests assessed against individuals' rights, or valid consent where required. Different conditions apply to sensitive personal information under Philippine law.", "Acknowledging this Policy confirms receipt of information about processing. It is not blanket consent to every activity. Where specific consent is the applicable basis, it must be obtained separately in an appropriate manner, and withdrawal must be handled in accordance with applicable requirements."),
    section("Authorized Access and Information Disclosure", "Access is limited according to account role, business association, branch assignment, operational permissions, account status, and applicable entitlements. Owners may access authorized business-wide records; Managers may access authorized branch records; Staff access is limited to assigned duties.", "Authorized platform personnel may access information as necessary to carry out legitimate support, security, subscription verification, administration, or legal responsibilities. Disclosure must be limited to the purpose for which it is authorized. Information may be disclosed to competent authorities where required or otherwise lawfully permitted."),
    section("Third-Party Providers and Data Transfers", "The service uses technical infrastructure and email delivery to support operation and verification messages. The development system uses Gmail SMTP; Azure hosting is planned but the deployed providers, geographical regions, and processing arrangements must be confirmed before publication.", "Providers should receive only information appropriate for their service and must be subject to applicable contractual, organizational, and technical safeguards. Cross-border processing and disclosure must be assessed against applicable privacy obligations. A final notice must identify actual recipients or recipient categories and relevant storage locations."),
    section("Data Security and Authentication Protection", "StockNBook is designed to apply appropriate technical and organizational measures to reduce unauthorized access, loss, alteration, or disclosure. Implemented application controls include protected password storage, one-time verification codes, unsuccessful authentication restrictions, account recovery, role-based authorization, and business and branch restrictions.", "Access to credentials and security information must be restricted. Production transport security, hosting access controls, protected backups, and incident-response procedures must be verified before deployment. No information system guarantees absolute security. Suspected personal data incidents should be reported promptly and handled in accordance with applicable breach assessment and notification requirements."),
    section("Authentication Sessions and Browser Storage", "The application uses authentication tokens and browser session storage for authenticated account state and authorized functions. Certain browser storage may retain interface or service information as part of normal operation. Users should log out of shared devices and prevent unauthorized access to authenticated sessions.", "The production inventory of cookies, tokens, and other storage technologies must be confirmed and disclosed as applicable. Nonessential tracking, if introduced, must be assessed and disclosed separately rather than assumed to be covered by this notice."),
    section("Security Monitoring and Automated Controls", "Unsuccessful login and verification attempts, temporary account restrictions, and relevant security events may be recorded in support of account protection and investigation. Automated controls may restrict authentication or verification when defined security thresholds are reached.", "A restricted user may use available account-recovery procedures or contact the authorized representative. Where automated processing significantly affects an individual, applicable transparency and data subject rights must be observed. Forecasting provides estimates for business decisions rather than a guarantee of individual outcomes."),
    section("Data Retention and Secure Disposal", "Personal information should be retained only for the period necessary for the disclosed purpose, applicable contractual or legal obligations, legitimate recordkeeping, or resolution of disputes. Account deactivation and subscription expiration do not necessarily require immediate deletion of historical records.", "Verification codes have limited validity, which is distinct from the period for retaining related security records. Account, operational, subscription payment, security-log, verification, and backup records must have an approved retention schedule. The actual periods and disposal arrangements are not yet confirmed and must be specified before publication.", "Information that is no longer necessary and not required to be retained should be securely disposed of or appropriately anonymized in accordance with applicable requirements."),
    section("Rights of Data Subjects", "Subject to applicable conditions and limitations, individuals have rights regarding their personal information under Philippine law. These include:", bullets("Being informed about processing and obtaining access to personal information.", "Requesting correction of inaccurate information and objecting to applicable processing.", "Requesting erasure or blocking, and data portability, where legally applicable.", "Seeking compensation or other lawful remedies and lodging a complaint with the National Privacy Commission."),
        "Requests may require proportionate identity verification to prevent unauthorized disclosure. Where the registered business is the relevant controller, the request may need to be directed to its authorized privacy representative. The acknowledgment of this Policy does not waive these rights."),
    section("Privacy Inquiries, Requests and Complaints", "Privacy requests, questions, complaints, and suspected incidents should be submitted to the applicable controller or designated privacy representative. The landing page lists support@stocknbook.com as the StockNBook support contact; its operation and suitability as a privacy-request channel must be verified.", "Before publication, identify the operator's legal name, mailing address, designated privacy representative or Data Protection Officer where required, and official privacy contact. Individuals may also seek assistance from the National Privacy Commission of the Philippines at https://privacy.gov.ph."),
    section("Changes to the Privacy Policy", "The Privacy Policy may change to reflect changes in actual processing, service functionality, providers, security measures, or applicable requirements. Material changes should be communicated through appropriate channels, with renewed notice, acknowledgment, or consent as required by the relevant processing activity.", "Each published version and its effective date should be preserved so that an account's acknowledgment can be linked to the text presented at the time.")
];

const rolePrivacy: Record<PolicyRole, Section[]> = {
    owner: [
        section("Business Owner Information", "In addition to general account information, the Owner may provide registered business details, contact information, address, branch information, and account administration records. These are processed to establish the business account, verify identity, administer branches and workforce access, and deliver applicable services."),
        section("Subscription and Payment Information", "Subscription selections, payment amounts, references, submitted receipts, approval records, renewal details, and subscription status may be processed for legitimate payment verification, entitlement administration, and financial recordkeeping. Receipt files can contain personal or financial information; access should be restricted to authorized personnel and unnecessary details should not be submitted.", "Records should be retained according to applicable financial, contractual, and legal requirements rather than deleted automatically when a subscription changes."),
        section("Business Administration Activity", "Authorized administration activities may be recorded to support security, investigation of irregularities, accountability, and service operation. These can relate to business or branch administration, Manager assignments, or subscription activity. Relevant records should be accessible only for legitimate purposes."),
        section("Customer and Workforce Information", "The Owner may supply or authorize processing of customer, Manager, and Staff information. Where the business determines processing purposes, the business must maintain appropriate notices, lawful bases, access controls, and procedures for assisting individuals with privacy requests.", "When processing on behalf of the business, StockNBook should follow the applicable service and data processing arrangements and not use business-controlled information for unrelated purposes."),
        section("Information Access and Retention", "Owner account information and related financial or administration records may be retained for legitimate service, financial, operational, and legal purposes. A downgrade does not by itself remove historic records. Owners may submit privacy requests through the relevant controller's designated channel, subject to appropriate identity checks and legal obligations.")
    ],
    manager: [
        section("Manager Account and Assignment Information", "The Manager's name, contact details, employee identifier, account status, associated business, and assigned branch may be supplied by the Manager or an authorized Owner during invitation, activation, account updates, and assignment administration. These data establish identity and the scope of operational authorization."),
        section("Manager Authentication and Security Information", "Protected authentication information, verification and recovery records, unsuccessful login attempts, and account restriction events may be processed to safeguard the Manager account. Such information should be available only for authorized administration, security, support, and legitimate investigations, not to disclose private credentials."),
        section("Branch Management Activity", "Authorized branch activity may be recorded for operational review, transaction accuracy, security, and accountability. This may include booking, inventory, sales, Staff invitations, account administration, and permission assignments. The authorized Owner may review relevant records for legitimate business purposes and subject to privacy obligations."),
        section("Access to Customer and Staff Information", "Managers may access information required for authorized branch duties. This does not authorize unrelated collection, use, disclosure, or transfer of customer and employee data. The relevant business remains responsible for applicable privacy obligations concerning its workforce and customers."),
        section("Changes to Assignment and Account Status", "Changes to role authorization, assigned branch, and account status may result in updates to account information and access privileges. Historical activity and security records may be retained where necessary for lawful accountability, operational, contractual, or legal purposes.", "Managers may submit privacy requests to the appropriate business representative or platform privacy contact depending on who controls the relevant processing.")
    ],
    staff: [
        section("Staff Account and Employment-Related Information", "A Staff account may contain name, contact information, employee identifier, business and branch assignment, associated Manager, account status, and authorized module permissions. This information may be supplied by the employee or an authorized representative to establish identity, administer access, and support legitimate workforce operations."),
        section("Staff Permissions and Account Administration", "Permission and assignment information is used to restrict operations to the Staff member's legitimate duties and to administer activation and deactivation. Authorized Managers and Owners may access relevant account information as necessary for legitimate workforce and security purposes. Access does not authorize unrelated processing."),
        section("Operational and Transaction Activity", "Authorized booking, sale, inventory, and other operational actions may identify the Staff account responsible for the recorded transaction. These records support transaction verification, security, accountability, and investigation of operational discrepancies. Managers and Owners may review relevant information according to their authorized responsibilities and applicable privacy requirements."),
        section("Authentication and Account Protection", "Protected credential information, verification and recovery records, unsuccessful authentication attempts, and account restrictions may be processed to protect Staff accounts and maintain record integrity. These data must not be disclosed to unauthorized individuals or used to obtain a Staff member's private credentials."),
        section("Account Deactivation and Information Rights", "When employment, assignment, or business authorization ends, access may be deactivated. Historical transactions and account-related information may be retained where needed for legitimate recordkeeping, contractual or legal obligations, security, and accountability.", "Staff members retain applicable rights under the Data Privacy Act of 2012. Requests may be submitted to the relevant business privacy representative or StockNBook privacy contact depending on the controller of the information.")
    ]
};

function PolicySections({ sections, start }: { sections: Section[]; start: number }) {
    return <>{sections.map((item, index) => <section key={item.title} className="snb-policy-section">
        <h3>{start + index}. {item.title}</h3>
        {item.blocks.map((block, i) => typeof block === "string" ? <p key={i}>{block}</p> : "heading" in block
            ? <h4 key={i}>{block.heading}</h4> : <ul key={i}>{block.bullets.map((text, j) => <li key={j}>{text}</li>)}</ul>)}
    </section>)}</>;
}

export function PolicyDialog({ document, role, branchName, onClose, onReviewed }: {
    document: PolicyKind; role?: PolicyRole; branchName?: string; onClose: () => void; onReviewed?: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [hasReachedEnd, setHasReachedEnd] = useState(false);
    const titleId = useId();
    const requiresReview = typeof onReviewed === "function";
    const checkScrollEnd = useCallback(() => {
        const content = contentRef.current;
        if (content && content.clientHeight > 0 &&
            content.scrollHeight - content.clientHeight - content.scrollTop <= 2) {
            setHasReachedEnd(true);
        }
    }, []);
    const isTerms = document === "terms";
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        const previousFocus = globalThis.document.activeElement;
        dialog.showModal();
        contentRef.current?.focus({ preventScroll: true });
        return () => {
            if (dialog.open) dialog.close();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        };
    }, []);
    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;
        setHasReachedEnd(false);
        content.scrollTop = 0;
        const frame = requestAnimationFrame(checkScrollEnd);
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(checkScrollEnd) : null;
        observer?.observe(content);
        return () => {
            cancelAnimationFrame(frame);
            observer?.disconnect();
        };
    }, [document, role, branchName, checkScrollEnd]);
    return <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}
                   onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
                   onClick={event => { if (event.target === event.currentTarget) onClose(); }}
                   className="snb-policy-dialog fixed inset-0 m-auto w-[calc(100%_-_1.5rem)] max-w-[880px] max-h-[85dvh] overflow-hidden rounded-3xl border border-[#EBE4F0] bg-white p-0 text-[#1A1220] shadow-2xl">
        <div className="flex max-h-[85dvh] min-h-0 flex-col">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#EBE4F0] px-6 py-5">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#C9951A]">StockNBook</p>
                    <h2 id={titleId} className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#1A1220] sm:text-[28px]">{isTerms ? "Terms of Service" : "Privacy Policy"}</h2>
                    {role && <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-[#72529B]">
                        <span className="inline-flex items-center gap-1.5"><UserRound aria-hidden="true" className="h-4 w-4" />{roleLabels[role]}</span>
                        {role !== "owner" && branchName && <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="h-4 w-4" />{branchName}</span>}
                    </div>}
                </div>
            </header>
            <div ref={contentRef} tabIndex={0} onScroll={checkScrollEnd} aria-label="Policy document contents" className="snb-policy-document min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8">
                <h2>Part I — {isTerms ? "General Terms and Conditions" : "General Privacy Provisions"}</h2>
                <PolicySections sections={isTerms ? generalTerms : generalPrivacy} start={1} />
                {(role ? [role] : (["owner", "manager", "staff"] as const)).map(r => <div key={r}>
                    <h2>Part II — {roleLabels[r]} {isTerms ? "Terms and Responsibilities" : "Privacy Notice"}</h2>
                    <PolicySections sections={isTerms ? roleTerms[r] : rolePrivacy[r]} start={isTerms ? 15 : 16} />
                </div>)}
            </div>
            <footer className="flex shrink-0 flex-col gap-3 border-t border-[#EBE4F0] px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
                <button type="button" disabled={requiresReview && !hasReachedEnd}
                        onClick={() => { if (!requiresReview || hasReachedEnd) (onReviewed ?? onClose)(); }}
                        className="min-h-11 rounded-xl bg-[#2D1B4E] px-5 py-2 text-sm font-semibold text-white enabled:hover:bg-[#3D2560] disabled:cursor-not-allowed disabled:opacity-50">Continue</button>
            </footer>
        </div>
        <style>{`
            .snb-policy-dialog::backdrop { background: rgba(22,12,39,.65); backdrop-filter: blur(4px); }
            .snb-policy-document { color:#595260; font-size:14px; line-height:1.8; overflow-wrap:anywhere; }
            .snb-policy-document h2 { font-size:18px; font-weight:700; line-height:1.45; color:#2D1B4E; margin:0 0 16px; text-align:left; }
            .snb-policy-document h3 { font-size:16px; font-weight:600; line-height:1.5; color:#1A1220; margin:0 0 12px; text-align:left; }
            .snb-policy-document h4 { font-size:14px; font-weight:600; color:#2D1B4E; margin:12px 0 8px; text-align:left; }
            .snb-policy-document p { text-indent:2.5em; text-align:justify; margin:0 0 16px; }
            .snb-policy-document ul { list-style:disc; padding-left:2.5em; margin:0 0 16px; }
            .snb-policy-document li { text-indent:0; text-align:left; margin-bottom:8px; }
            .snb-policy-document .snb-policy-section { margin-bottom:24px; }
            @media (max-width:600px) { .snb-policy-document p { text-align:left; text-indent:2em; } }
            @media (min-width:640px) { .snb-policy-document { font-size:15px; } }
        `}</style>
    </dialog>;
}

// Read-only policy access: it never changes registration review/acceptance state.
export function PolicyAccessLinks({ role, branchName, light = false }: { role?: PolicyRole; branchName?: string; light?: boolean }) {
    const [active, setActive] = useState<PolicyKind | null>(null);
    return <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-sm">
        <button type="button" onClick={() => setActive("terms")} className={`${light ? "text-white/80 hover:text-[#F1C85C]" : "text-[#2D1B4E] hover:text-[#5B35A5]"} underline underline-offset-2`}>Terms of Service</button>
        <span aria-hidden="true" className={light ? "text-white/50" : "text-[#82768F]"}>·</span>
        <button type="button" onClick={() => setActive("privacy")} className={`${light ? "text-white/80 hover:text-[#F1C85C]" : "text-[#2D1B4E] hover:text-[#5B35A5]"} underline underline-offset-2`}>Privacy Policy</button>
        {active && <PolicyDialog document={active} role={role} branchName={branchName} onClose={() => setActive(null)} />}
    </div>;
}