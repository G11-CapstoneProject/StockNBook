"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Package } from "lucide-react";

function AcceptStaffInviteContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const handleAcceptInvite = async () => {
        if (!token) {
            alert("Missing invitation token.");
            return;
        }

        if (!password || !confirmPassword) {
            alert("Please enter and confirm your password.");
            return;
        }

        if (password !== confirmPassword) {
            alert("Passwords do not match.");
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
                    action: "accept_staff_invite",
                    token,
                    password,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || "Invalid or expired invitation.");
                return;
            }

            alert("Staff account activated successfully!");
            router.push("/");
        } catch (error) {
            alert("Something went wrong.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex min-h-screen items-center justify-center bg-[#FDFAF4] px-6 text-[#1A1220]">
            <div className="w-full max-w-xl rounded-3xl border border-[#EBE4F0] bg-white p-8 shadow-sm">
                <div className="mb-8 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2D1B4E] text-[#C9951A]">
                        <Package className="h-6 w-6" />
                    </div>

                    <span className="text-xl font-semibold">
                        <span className="text-[#2D1B4E]">Stock</span>NBook
                    </span>
                </div>

                <h1 className="font-serif text-5xl text-[#1A1220]">
                    Accept staff invitation
                </h1>

                <p className="mt-3 text-sm leading-6 text-[#7A6E88]">
                    Create your password to activate your staff account.
                </p>

                <div className="mt-8 space-y-5">
                    <Input
                        label="Password"
                        placeholder="Create a password"
                        type="password"
                        value={password}
                        onChange={setPassword}
                    />

                    <Input
                        label="Confirm password"
                        placeholder="Repeat your password"
                        type="password"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                    />

                    <button
                        onClick={handleAcceptInvite}
                        disabled={loading}
                        className="w-full rounded-lg bg-[#2D1B4E] px-5 py-3 font-medium text-white disabled:opacity-60"
                    >
                        {loading ? "Activating..." : "Activate staff account"}
                    </button>
                </div>
            </div>
        </main>
    );
}

function Input({
                   label,
                   placeholder,
                   type = "text",
                   value,
                   onChange,
               }: {
    label: string;
    placeholder: string;
    type?: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <label className="mb-2 block text-sm font-medium text-[#1A1220]">
                {label}
            </label>

            <div className="flex items-center gap-3 rounded-lg border border-[#EBE4F0] bg-white px-4 py-3 transition focus-within:border-[#2D1B4E] focus-within:ring-4 focus-within:ring-[#2D1B4E]/10">
                <Lock className="h-5 w-5 text-[#7A6E88]" />

                <input
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full bg-transparent text-sm outline-none placeholder:text-[#7A6E88]"
                />
            </div>
        </div>
    );
}

export default function AcceptStaffInvitePage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <AcceptStaffInviteContent />
        </Suspense>
    );
}

