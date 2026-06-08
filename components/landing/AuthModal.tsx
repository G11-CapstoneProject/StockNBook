"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Package, X } from "lucide-react";

type AuthMode = "login" | "signup";

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
        }

        setLoading(true);

        try {
            const body =
                mode === "login"
                    ? {
                        action: "login",
                        email,
                        password,
                    }
                    : {
                        action: "signup",
                        owner_name: ownerName,
                        store_name: storeName,
                        phone,
                        email,
                        password,
                    };

            const res = await fetch("/api/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || !data.token) {
                alert(data.error || "Authentication failed.");
                return;
            }

            sessionStorage.clear();
            sessionStorage.setItem("token", data.token);
            sessionStorage.setItem("store_id", String(data.store_id));
            sessionStorage.setItem("store_name", data.store_name);
            sessionStorage.setItem("isLoggedIn", "true");
            sessionStorage.setItem("role", data.role || "owner");

            if (mode === "login") {
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

                router.push("/dashboard");
            } else {
                onSignupSuccess();
            }
        } catch (error) {
            alert("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
                <button
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
                <span className="text-[#F5E8C0]">Stock</span>NBook
              </span>
                        </div>

                        <h2 className="mt-14 font-serif text-4xl leading-tight">
                            {mode === "login" ? (
                                <>
                                    Welcome back to your{" "}
                                    <span className="italic text-[#F5E8C0]">business.</span>
                                </>
                            ) : (
                                <>
                                    Start your{" "}
                                    <span className="italic text-[#F5E8C0]">celebration</span>{" "}
                                    business here.
                                </>
                            )}
                        </h2>

                        <p className="mt-5 max-w-sm text-sm leading-7 text-white/60">
                            Manage your events, bookings, inventory, and team from one clean
                            dashboard.
                        </p>
                    </div>

                    <p className="border-t border-white/10 pt-6 font-serif text-sm leading-7 text-white/70">
                        “Mas madali na ang buhay ko. Everything is in one place.”
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
                        {mode === "login" ? "Log in" : "Create account"}
                    </h1>

                    <p className="mt-2 text-sm text-[#7A6E88]">
                        {mode === "login"
                            ? "Enter your credentials to access your dashboard."
                            : "Set up your business in under 3 minutes."}
                    </p>

                    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
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
                                    icon={<Package className="h-5 w-5 text-[#7A6E88]" />}
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
                            icon={<Mail className="h-5 w-5 text-[#7A6E88]" />}
                        />

                        <TextInput
                            label="Password"
                            placeholder={
                                mode === "login" ? "Enter your password" : "Create a password"
                            }
                            type="password"
                            value={password}
                            onChange={setPassword}
                            icon={<Lock className="h-5 w-5 text-[#7A6E88]" />}
                        />

                        {mode === "signup" && (
                            <TextInput
                                label="Confirm password"
                                placeholder="Repeat your password"
                                type="password"
                                value={confirmPassword}
                                onChange={setConfirmPassword}
                                icon={<Lock className="h-5 w-5 text-[#7A6E88]" />}
                            />
                        )}

                        {mode === "login" && (
                            <div className="flex items-center justify-between text-sm">
                                <label className="flex items-center gap-2 text-[#7A6E88]">
                                    <input type="checkbox" />
                                    Remember me
                                </label>
                                <button type="button" className="font-medium text-[#2D1B4E]">
                                    Forgot password?
                                </button>
                            </div>
                        )}

                        {mode === "signup" && (
                            <label className="flex items-start gap-2 text-sm text-[#7A6E88]">
                                <input type="checkbox" className="mt-1" />
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
                            onClick={() => onSwitch(mode === "login" ? "signup" : "login")}
                            className="font-semibold text-[#2D1B4E]"
                        >
                            {mode === "login" ? "Sign up free" : "Log in"}
                        </button>
                    </p>
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

