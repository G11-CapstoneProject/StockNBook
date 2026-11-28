"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RoleSidebar from "@/components/sidebar/RoleSidebar";
import { PolicyAccessLinks, isPolicyRole } from "@/components/landing/AuthModal";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import RequirePermission from "@/components/permissions/RequirePermission";
import { QRCodeCanvas } from "qrcode.react";
import { usePOS } from "@/hooks/usePOS";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    Check,
    CheckCircle2,
    Copy,
    Download,
    ExternalLink,
    Link2,
    RefreshCw,
    Save,
    Store,
    ReceiptText,
    AlertTriangle,
    X,
} from "lucide-react";

type BookingBranch = { id: string; name: string; active: boolean };
type SettingsToast = { title: string; message: string; error?: boolean };

function branchBookingLink(origin: string, slug: string, branchName: string) {
    return origin && slug && branchName
        ? `${origin}/book/${encodeURIComponent(slug)}?branch=${encodeURIComponent(branchName)}`
        : "";
}

// Render the poster at print resolution, including Unicode business/branch names.
// The QR itself is embedded separately as a lossless, one-bit PDF image.
function createBookingQrPdf(qrCanvas: HTMLCanvasElement, storeName: string, branchName: string, bookingLink: string): Blob {
    const width = 595;
    const height = 842;
    const qrSize = 272;
    const qrX = (width - qrSize) / 2;
    const qrY = 335;
    const button = { x: 166, y: 705, width: 263, height: 42 };
    const art = document.createElement("canvas");
    const scale = 3;
    art.width = width * scale;
    art.height = height * scale;
    const ctx = art.getContext("2d");
    if (!ctx) throw new Error("Unable to create the booking QR PDF.");
    ctx.scale(scale, scale);

    const roundedRect = (x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    };

    const font = (size: number, weight: number) => { ctx.font = `${weight} ${size}px Arial, "Liberation Sans", "Segoe UI", "Noto Sans", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`; };
    const centerText = (text: string, y: number, size: number, weight: number, color: string) => {
        font(size, weight);
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, width / 2, y);
    };
    // Wrap long names, including unbroken words; fit the entire name to its region.
    const wrap = (text: string, maxWidth: number): string[] => {
        const lines: string[] = [];
        let line = "";
        for (const word of text.trim().split(/\s+/)) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(candidate).width > maxWidth) {
                lines.push(line);
                line = "";
            }
            if (ctx.measureText(word).width > maxWidth) {
                for (const character of Array.from(word)) {
                    if (line && ctx.measureText(line + character).width > maxWidth) {
                        lines.push(line);
                        line = "";
                    }
                    line += character;
                }
            } else {
                line = line ? `${line} ${word}` : word;
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : [""];
    };
    const fitName = (text: string, top: number, boxHeight: number, maxSize: number, color: string, weight: number) => {
        const maxWidth = 460;
        let size = maxSize;
        let lines: string[] = [];
        do {
            font(size, weight);
            lines = wrap(text, maxWidth);
            if (lines.length * size * 1.18 <= boxHeight || size <= 7) break;
            size--;
        } while (true);
        const lineHeight = Math.min(size * 1.18, boxHeight / lines.length);
        const first = top + (boxHeight - lineHeight * (lines.length - 1)) / 2;
        lines.forEach((line, index) => centerText(line, first + index * lineHeight, size, weight, color));
    };

    // White printable page, StockNBook palette, and ample white space.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    roundedRect(36, 36, 523, 770, 16, "#FDFAF4", "#E6DDF0");
    roundedRect(36, 36, 523, 84, 16, "#2B174C");
    ctx.fillStyle = "#2B174C";
    ctx.fillRect(36, 102, 523, 18);
    roundedRect(57, 57, 4, 42, 2, "#D2A735");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    font(23, 700);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("StockNBook", 73, 77);
    ctx.textAlign = "right";
    font(11, 700);
    ctx.fillStyle = "#E7C46A";
    ctx.fillText("ONLINE BOOKING", 535, 77);

    centerText("BOOK WITH US", 146, 12, 700, "#7658A7");
    fitName(storeName, 163, 72, 34, "#1A1220", 700);
    centerText("BRANCH", 255, 11, 700, "#7658A7");
    fitName(branchName, 268, 48, 24, "#2B174C", 700);

    roundedRect(qrX - 13, qrY - 12, qrSize + 26, qrSize + 24, 12, "#FFFFFF", "#E6DDF0");
    // The QR is placed over this white frame by the PDF page's second image.
    centerText("Scan to book online", 650, 25, 700, "#2B174C");
    centerText("Use your phone camera to open this branch's booking page.", 680, 12, 400, "#6A5D6F");
    roundedRect(button.x, button.y, button.width, button.height, 10, "#2B174C");
    centerText("Open booking page", button.y + button.height / 2, 14, 700, "#FFFFFF");
    centerText("Online reservations made easy", 774, 11, 400, "#806A8C");

    const jpeg = Uint8Array.from(atob(art.toDataURL("image/jpeg", 0.97).split(",")[1]), character => character.charCodeAt(0));

    // Embed a lossless QR, rather than JPEG-compressing the code. This keeps
    // its black/white modules and quiet zone intact when printed.
    const qr = document.createElement("canvas");
    qr.width = Math.min(qrCanvas.width, 1024);
    qr.height = Math.min(qrCanvas.height, 1024);
    const qrCtx = qr.getContext("2d", { willReadFrequently: true });
    if (!qrCtx || !qr.width || !qr.height) throw new Error("Booking QR code is not ready.");
    qrCtx.fillStyle = "#FFFFFF";
    qrCtx.fillRect(0, 0, qr.width, qr.height);
    qrCtx.imageSmoothingEnabled = false;
    qrCtx.drawImage(qrCanvas, 0, 0, qr.width, qr.height);
    const pixels = qrCtx.getImageData(0, 0, qr.width, qr.height).data;
    const rowBytes = Math.ceil(qr.width / 8);
    const packed = new Uint8Array(rowBytes * qr.height);
    packed.fill(255);
    for (let y = 0; y < qr.height; y++) {
        for (let x = 0; x < qr.width; x++) {
            const pixel = (y * qr.width + x) * 4;
            if (pixels[pixel] + pixels[pixel + 1] + pixels[pixel + 2] < 384) {
                packed[y * rowBytes + (x >> 3)] &= ~(128 >> (x % 8));
            }
        }
    }
    const hex = "0123456789ABCDEF";
    const qrHex = Array.from(packed, byte => hex[byte >> 4] + hex[byte & 15]).join("") + ">";

    // One-page A4 PDF with exact byte offsets and a clickable booking link.
    // No external PDF library or server endpoint is required.
    const encoder = new TextEncoder();
    const uri = bookingLink.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const pageContent = [
        `q ${width} 0 0 ${height} 0 0 cm /Poster Do Q`,
        `q ${qrSize} 0 0 ${qrSize} ${qrX} ${height - qrY - qrSize} cm /Qr Do Q`,
    ].join("\n");
    const chunks: Uint8Array[] = [];
    const offsets = [0];
    let length = 0;
    const append = (value: string | Uint8Array) => {
        const bytes = typeof value === "string" ? encoder.encode(value) : value;
        chunks.push(bytes);
        length += bytes.length;
    };
    const object = (id: number, content: string, stream?: Uint8Array) => {
        offsets[id] = length;
        append(`${id} 0 obj\n${content}`);
        if (stream) {
            append("\nstream\n");
            append(stream);
            append("\nendstream");
        }
        append("\nendobj\n");
    };
    const qrBytes = encoder.encode(qrHex);
    const contentBytes = encoder.encode(pageContent);
    append("%PDF-1.4\n");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
    object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Poster 4 0 R /Qr 5 0 R >> >> /Contents 6 0 R /Annots [7 0 R] >>`);
    object(4, `<< /Type /XObject /Subtype /Image /Width ${art.width} /Height ${art.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    object(5, `<< /Type /XObject /Subtype /Image /Width ${qr.width} /Height ${qr.height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Interpolate false /Filter /ASCIIHexDecode /Length ${qrBytes.length} >>`, qrBytes);
    object(6, `<< /Length ${contentBytes.length} >>`, contentBytes);
    object(7, `<< /Type /Annot /Subtype /Link /Rect [${button.x} ${height - button.y - button.height} ${button.x + button.width} ${height - button.y}] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`);
    const xref = length;
    append("xref\n0 8\n0000000000 65535 f \n");
    for (let id = 1; id <= 7; id++) append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    append(`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const result = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
        result.set(chunk, position);
        position += chunk.length;
    }
    return new Blob([result.buffer], { type: "application/pdf" });
}

function cleanBusinessName(value: string) {
    return value.trim().replace(/\s+/g, " ");
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

export default function SettingsPage() {
    const { user, refreshUser } = useCurrentUser();
    const [origin, setOrigin] = useState("");
    const [draft, setDraft] = useState<string | null>(null);
    const [pendingName, setPendingName] = useState<string | null>(null);
    const [saveError, setSaveError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [toast, setToast] = useState<SettingsToast | null>(null);
    const [branches, setBranches] = useState<BookingBranch[]>([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [branchesError, setBranchesError] = useState("");
    const [copiedLink, setCopiedLink] = useState("");
    const requestVersion = useRef(0);
    const storeName = user?.store_name || "";
    const storeSlug = user?.store_slug || "";
    const branchName = user?.branch_name || "";
    const isOwner = user?.role === "owner";
    const storeId = user?.store_id;
    const editedName = draft ?? storeName;
    const normalizedName = cleanBusinessName(editedName);
    const closeToast = useCallback(() => setToast(null), []);

    useEffect(() => {
        setOrigin(window.location.origin);
        const updateDateTime = () => setCurrentDateTime(new Date());
        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const loadBranches = useCallback(async () => {
        if (!isOwner || !storeId) return;
        const version = ++requestVersion.current;
        setBranchesLoading(true);
        setBranchesError("");
        try {
            const token = sessionStorage.getItem("token") || localStorage.getItem("token");
            const response = await fetch("/api/branches", {
                headers: { Authorization: `Bearer ${token || ""}` },
                cache: "no-store",
            });
            const data = await response.json();
            if (!response.ok || !Array.isArray(data.branches)) {
                throw new Error(data.error || "Unable to load branches.");
            }
            const unique = new Map<string, BookingBranch>();
            for (const row of data.branches) {
                const id = String(row.id ?? "");
                const name = String(row.branch_name ?? "");
                if (id && name) unique.set(id, {
                    id, name,
                    active: String(row.branch_status ?? row.status ?? "").toLowerCase() === "active",
                });
            }
            if (requestVersion.current === version) setBranches(Array.from(unique.values()));
        } catch (error) {
            if (requestVersion.current !== version) return;
            setBranches([]);
            setBranchesError(error instanceof Error ? error.message : "Unable to load branches.");
        } finally {
            if (requestVersion.current === version) setBranchesLoading(false);
        }
    }, [isOwner, storeId]);

    useEffect(() => {
        setBranches([]);
        if (!isOwner || !storeId) return;
        void loadBranches();
        const onFocus = () => { void loadBranches(); };
        window.addEventListener("focus", onFocus);
        return () => {
            requestVersion.current++;
            window.removeEventListener("focus", onFocus);
        };
    }, [isOwner, storeId, loadBranches]);

    const bookingLink = branchBookingLink(origin, storeSlug, branchName);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await Promise.all([refreshUser(true, true), loadBranches()]);
        } finally {
            setIsRefreshing(false);
        }
    };

    const requestSave = () => {
        if (!isOwner || isSaving || normalizedName === storeName) return;
        setSaveError("");
        if (!normalizedName || normalizedName.length > 180 || !/[\p{L}\p{N}]/u.test(normalizedName)) {
            setSaveError("Enter a business name containing letters or numbers (up to 180 characters).");
            return;
        }
        setPendingName(normalizedName);
    };

    const handleSave = async () => {
        if (!isOwner || !pendingName || isSaving) return;
        const token = sessionStorage.getItem("token") || localStorage.getItem("token");
        if (!token) {
            setSaveError("Please sign in again to save business settings.");
            return;
        }
        setIsSaving(true);
        setSaveError("");
        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: "update_store_profile", store_name: pendingName }),
            });
            const data = await response.json() as { success?: boolean; error?: string; store_name?: string; store_slug?: string };
            if (!response.ok || !data.success || !data.store_name || !data.store_slug) {
                throw new Error(data.error || "Business details could not be saved.");
            }
            // Only publish database-confirmed changes. All other workspaces
            // read the same stores row on their existing current-user refresh.
            sessionStorage.setItem("store_name", data.store_name);
            sessionStorage.setItem("stocknbook_store_name", data.store_name);
            sessionStorage.setItem("business_name", data.store_name);
            sessionStorage.setItem("store_slug", data.store_slug);
            sessionStorage.setItem("slug", data.store_slug);
            setDraft(data.store_name);
            setPendingName(null);
            setToast({ title: "Business name updated successfully", message: "The new name has been saved for all branches and users." });
            window.dispatchEvent(new Event("stocknbook-business-updated"));
            await refreshUser(true, true);
            setDraft(null);
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Failed to save business details.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopy = async (link: string) => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopiedLink(link);
            setToast({ title: "Booking link copied", message: "The link is ready to share with customers." });
        } catch {
            setToast({ title: "Unable to copy link", message: "Select and copy the booking link manually.", error: true });
        }
    };

    useEffect(() => {
        if (!copiedLink) return;
        const timeout = window.setTimeout(() => setCopiedLink(""), 2000);
        return () => window.clearTimeout(timeout);
    }, [copiedLink]);

    const downloadQR = (canvas: HTMLCanvasElement, name: string, link: string) => {
        if (!link || !storeName || !name) return;
        try {
            const pdf = createBookingQrPdf(canvas, storeName, name, link);
            const url = URL.createObjectURL(pdf);
            const anchor = document.createElement("a");
            const safe = (value: string) => value.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "booking";
            anchor.href = url;
            anchor.download = `${safe(storeName)}_${safe(name)}_Booking_QR.pdf`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setToast({ title: "Booking QR downloaded", message: `${name} booking QR PDF is ready to share or print.` });
        } catch (error) {
            console.error("Booking QR PDF export failed:", error);
            setToast({ title: "Unable to download booking QR", message: "Please try again.", error: true });
        }
    };

    const handlePreview = (link: string) => {
        if (link) window.open(link, "_blank", "noopener,noreferrer");
    };

    if (!origin || !user) {
        return (
            <div className="flex min-h-screen bg-[#FDFAF4] font-sans text-[#1A1220]">
                <RoleSidebar />
                <main className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
                    <ModuleSkeleton variant="settings" />
                </main>
            </div>
        );
    }

    return (
        <RequirePermission>
            <div
                className="flex min-h-screen font-sans text-[#1A1220]"
                style={{ backgroundColor: "#FDFAF4" }}
            >
                <RoleSidebar />

                <main className="min-w-0 flex-1 overflow-y-auto">
                    <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 backdrop-blur">
                        <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                            <h1 className="text-[25px] font-bold text-[#1A1220]">
                                Settings
                            </h1>

                            <div className="flex items-center gap-2.5">
                                <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                                    {currentDateTime
                                        ? formatCurrentDateTime(currentDateTime)
                                        : "Loading date..."}
                                </span>

                                <button
                                    type="button"
                                    onClick={handleRefresh}
                                    disabled={isRefreshing}
                                    aria-label="Refresh settings"
                                    title="Refresh settings"
                                    className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <RefreshCw
                                        size={16}
                                        className={
                                            isRefreshing ? "animate-spin" : ""
                                        }
                                    />
                                    Refresh
                                </button>
                            </div>
                        </div>
                    </header>

                    <section className="space-y-4 px-6 py-4">
                        {isOwner ? (
                            <OwnerSettings
                                storeName={editedName}
                                setStoreName={value => { setDraft(value); setSaveError(""); }}
                                isSaving={isSaving}
                                canSave={!!normalizedName && normalizedName !== storeName}
                                error={pendingName ? "" : saveError}
                                onSave={requestSave}
                                branches={branches}
                                branchesLoading={branchesLoading}
                                branchesError={branchesError}
                                linkFor={name => branchBookingLink(origin, storeSlug, name)}
                                copiedLink={copiedLink}
                                onCopy={link => void handleCopy(link)}
                                onPreview={handlePreview}
                                onDownloadQR={downloadQR}
                            />
                        ) : (
                            <BranchSettings
                                storeName={storeName}
                                branchName={branchName}
                                bookingLink={bookingLink}
                                copied={!!bookingLink && copiedLink === bookingLink}
                                onCopy={() => void handleCopy(bookingLink)}
                                onPreview={() => handlePreview(bookingLink)}
                                onDownloadQR={downloadQR}
                            />
                        )}
                        <div className="rounded-2xl border border-[#E9E0EF] bg-white p-5">
                            <h2 className="mb-3 text-sm font-semibold text-[#2D1B4E]">Terms and Privacy</h2>
                            <PolicyAccessLinks role={isPolicyRole(user.role) ? user.role : undefined} branchName={user.branch_name} />
                        </div>
                    </section>
                </main>
                {pendingName !== null && (
                    <BusinessNameConfirmDialog
                        oldName={storeName}
                        newName={pendingName}
                        saving={isSaving}
                        error={saveError}
                        onCancel={() => { if (!isSaving) { setPendingName(null); setSaveError(""); } }}
                        onConfirm={() => void handleSave()}
                    />
                )}
                <SettingsSuccessToast toast={toast} onClose={closeToast} />
            </div>
        </RequirePermission>
    );
}

function OwnerSettings({
                           storeName, setStoreName, isSaving, canSave, error, onSave,
                           branches, branchesLoading, branchesError, linkFor, copiedLink,
                           onCopy, onPreview, onDownloadQR,
                       }: {
    storeName: string;
    setStoreName: (value: string) => void;
    isSaving: boolean;
    canSave: boolean;
    error: string;
    onSave: () => void;
    branches: BookingBranch[];
    branchesLoading: boolean;
    branchesError: string;
    linkFor: (name: string) => string;
    copiedLink: string;
    onCopy: (link: string) => void;
    onPreview: (link: string) => void;
    onDownloadQR: DownloadBookingQR;
}) {
    return (
        <div className="space-y-4">
            <div className="grid items-stretch gap-4 lg:grid-cols-2">
                <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                    <SettingsCardHeading
                        icon={<Store size={18} />}
                        title="Business Information"
                        detail="Update the business name used by all branches, users, and booking pages."
                    />
                    <div className="mt-5 space-y-4">
                        <form onSubmit={event => { event.preventDefault(); onSave(); }} className="space-y-4">
                            <label className="block text-sm font-medium text-[#1A1220]">
                                Business Name
                                <input
                                    type="text"
                                    value={storeName}
                                    maxLength={180}
                                    required
                                    disabled={isSaving}
                                    onChange={event => setStoreName(event.target.value)}
                                    placeholder="Enter your business name"
                                    className="mt-2 h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#1A1220] outline-none placeholder:text-[#9B8AAA] transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10"
                                />
                            </label>
                            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                            <button
                                type="submit"
                                disabled={isSaving || !canSave}
                                className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Save size={16} /> {isSaving ? "Saving..." : "Save Changes"}
                            </button>
                        </form>
                        <p className="text-center text-xs text-[#7A6A84]">
                            Your existing booking links remain unchanged when you rename your business.
                        </p>
                    </div>
                </section>
                <BusinessTaxSettings />
            </div>
            <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                <SettingsCardHeading
                    icon={<Link2 size={18} />}
                    title="Booking Links / QR"
                    detail="Share or print the unique booking link and QR code for each branch."
                />
                <div className="mt-5 space-y-3">
                    {branchesLoading && <p className="text-sm text-[#7A6A84]">Loading branches...</p>}
                    {branchesError && <p role="alert" className="text-sm text-red-600">{branchesError}</p>}
                    {!branchesLoading && !branchesError && !branches.length && (
                        <p className="text-sm text-[#7A6A84]">Create a branch to generate its booking link.</p>
                    )}
                    {branches.map(branch => {
                        const link = branch.active ? linkFor(branch.name) : "";
                        return (
                            <BranchBookingRow
                                key={branch.id}
                                branchName={branch.name}
                                bookingLink={link}
                                active={branch.active}
                                copied={!!link && copiedLink === link}
                                onCopy={() => onCopy(link)}
                                onPreview={() => onPreview(link)}
                                onDownloadQR={onDownloadQR}
                            />
                        );
                    })}
                </div>
            </section>
        </div>
    );
}

type DownloadBookingQR = (canvas: HTMLCanvasElement, branchName: string, bookingLink: string) => void;

// Every branch owns its own QR canvas. Downloading from one row can never use
// the previously selected branch or another row's image.
function BranchBookingRow({ branchName, bookingLink, active, copied, onCopy, onPreview, onDownloadQR }: {
    branchName: string;
    bookingLink: string;
    active: boolean;
    copied: boolean;
    onCopy: () => void;
    onPreview: () => void;
    onDownloadQR: DownloadBookingQR;
}) {
    const qrRef = useRef<HTMLDivElement>(null);
    const handleDownload = () => {
        const canvas = qrRef.current?.querySelector<HTMLCanvasElement>("canvas");
        if (canvas && bookingLink) onDownloadQR(canvas, branchName, bookingLink);
    };
    if (!active) {
        return (
            <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="break-words text-sm font-semibold text-[#1A1220]">{branchName}</h3>
                    <span className="shrink-0 rounded-full bg-[#F3EEF9] px-2.5 py-1 text-xs text-[#7A6A84]">Inactive</span>
                </div>
                <p className="mt-2 text-xs text-[#7A6A84]">This branch is not accepting bookings.</p>
            </div>
        );
    }
    return (
        <div className="grid items-center gap-4 rounded-xl border border-[#E6DDF0] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
            <div className="min-w-0">
                <h3 className="break-words text-[15px] font-semibold text-[#1A1220]">{branchName || "Assigned Branch"}</h3>
                <div className="mt-3 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 py-3">
                    <p className="break-all font-mono text-xs leading-5 text-[#4E2C66]">{bookingLink || "Booking link unavailable."}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={onCopy} disabled={!bookingLink}
                            className="inline-flex h-[38px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50">
                        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy Link"}
                    </button>
                    <button type="button" onClick={onPreview} disabled={!bookingLink}
                            className="inline-flex h-[38px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50">
                        <ExternalLink size={15} /> Preview
                    </button>
                </div>
            </div>
            <div className="flex shrink-0 items-start justify-center gap-2 sm:border-l sm:border-[#E9E0EF] sm:pl-5">
                <div className="flex flex-col items-center gap-1.5">
                    <div ref={qrRef} className="flex h-[142px] w-[142px] items-center justify-center rounded-xl border border-[#E6DDF0] bg-white p-1">
                        {bookingLink
                            ? <QRCodeCanvas value={bookingLink} size={512} level="M" includeMargin style={{ width: 132, height: 132 }} />
                            : <p className="px-2 text-center text-xs text-[#9B8AAA]">QR unavailable</p>}
                    </div>
                    <span className="text-[11px] font-medium text-[#7A6A84]">Scan to book</span>
                </div>
                <button type="button" onClick={handleDownload} disabled={!bookingLink}
                        aria-label={`Download ${branchName} booking QR PDF`}
                        title="Download QR (PDF)"
                        className="inline-flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-lg border border-[#E6DDF0] bg-white text-[#2B174C] transition hover:border-[#C9B7DD] hover:bg-[#F7F1FF] disabled:cursor-not-allowed disabled:opacity-50">
                    <Download size={17} />
                </button>
            </div>
        </div>
    );
}

function BusinessNameConfirmDialog({ oldName, newName, saving, error, onCancel, onConfirm }: {
    oldName: string; newName: string; saving: boolean; error: string;
    onCancel: () => void; onConfirm: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
        return () => { if (dialog?.open) dialog.close(); };
    }, []);
    return (
        <dialog ref={dialogRef} aria-labelledby="business-name-confirm-title"
                onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}
                className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-[#E6DDF0] bg-white p-6 text-[#1A1220] shadow-2xl backdrop:bg-[#1A1220]/50">
            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]"><Store size={20} /></div>
                <div className="min-w-0 flex-1">
                    <h2 id="business-name-confirm-title" className="text-base font-bold">Confirm business name change</h2>
                    <p className="mt-1 text-sm leading-5 text-[#7A6A84]">This updates the name for all branches and users. Existing booking links will still work.</p>
                </div>
                <button type="button" onClick={onCancel} disabled={saving} aria-label="Close confirmation" className="text-[#9B8AAA] hover:text-[#2B174C]"><X size={18} /></button>
            </div>
            <div className="mt-5 space-y-3 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                <div><p className="text-xs text-[#7A6A84]">Current name</p><p className="break-words text-sm">{oldName}</p></div>
                <div><p className="text-xs text-[#7A6A84]">New name</p><p className="break-words text-sm font-semibold text-[#2B174C]">{newName}</p></div>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-3">
                <button type="button" autoFocus onClick={onCancel} disabled={saving} className="h-[42px] rounded-xl border border-[#E6DDF0] text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50">Cancel</button>
                <button type="button" onClick={onConfirm} disabled={saving} className="h-[42px] rounded-xl bg-[#2B174C] text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50">{saving ? "Saving..." : "Confirm"}</button>
            </div>
        </dialog>
    );
}

function SettingsSuccessToast({ toast, onClose }: { toast: SettingsToast | null; onClose: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const closeTimer = window.setTimeout(onClose, 5600);
        return () => window.clearTimeout(closeTimer);
    }, [toast, onClose]);
    if (!toast) return null;
    return (
        <div role={toast.error ? "alert" : "status"} aria-live="polite"
             className={`fixed bottom-5 right-5 z-[140] flex w-[min(360px,calc(100vw-2.5rem))] items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_18px_42px_rgba(43,23,76,0.22)] ${toast.error ? "border-red-200" : "border-[#BCE8CA]"}`}>
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toast.error ? "bg-red-50 text-red-600" : "bg-[#E5F8EC] text-[#23834A]"}`}>
                {toast.error ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} strokeWidth={2.4} />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#1A1220]">{toast.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-[#6A5D6F]">{toast.message}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Dismiss notification" className="shrink-0 text-lg leading-none text-[#9B8AAA] transition hover:text-[#2B174C]">×</button>
        </div>
    );
}

/** Tax registration belongs to the store, and is saved by the existing POS API. */
type TaxRegistration = "NON_VAT" | "VAT_REGISTERED";

function BusinessTaxSettings() {
    // Uses the SAME backend and permissions as the POS checkout.
    const pos = usePOS();
    const [pendingRegistration, setPendingRegistration] = useState<TaxRegistration | null>(null);
    const [savedRegistration, setSavedRegistration] = useState<TaxRegistration | null>(null);
    const [saving, setSaving] = useState(false);
    const [taxToast, setTaxToast] = useState<SettingsToast | null>(null);
    const dismissTaxToast = useCallback(() => setTaxToast(null), []);
    const [dialogError, setDialogError] = useState("");
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Never make a tax decision from sessionStorage; the POS hook reads the store setting.
    const reportedRegistration = pos.ownerRevenue?.taxRegistration;
    const databaseRegistration: TaxRegistration | null = reportedRegistration === "NON_VAT"
        ? "NON_VAT" : reportedRegistration === "VAT_REGISTERED" ? "VAT_REGISTERED" : null;
    const currentRegistration = savedRegistration ?? databaseRegistration;

    // Clear the temporary display value once the POS hook reflects the persisted value.
    useEffect(() => {
        if (savedRegistration && savedRegistration === databaseRegistration) {
            setSavedRegistration(null);
        }
    }, [databaseRegistration, savedRegistration]);

    useEffect(() => {
        if (!pendingRegistration) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        cancelButtonRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            previousFocus?.focus();
        };
    }, [pendingRegistration]);

    const requestTaxChange = (next: TaxRegistration) => {
        if (saving || next === currentRegistration) return;
        setDialogError("");
        setTaxToast(null);
        setPendingRegistration(next);
    };

    const closeDialog = () => {
        if (saving) return;
        setPendingRegistration(null);
        setDialogError("");
    };

    const confirmTaxChange = async () => {
        if (!pendingRegistration || saving) return;
        const next = pendingRegistration;
        setSaving(true);
        setDialogError("");
        setTaxToast(null);

        try {
            // The Lambda verifies that the signed-in account is the owner and
            // persists stores.tax_registration for all its branches.
            const result: unknown = await pos.updateTaxRegistration(next);
            if (result === false) {
                throw new Error("The tax setting could not be saved. Please try again.");
            }

            // Only switch the radio after the backend call has completed successfully.
            setSavedRegistration(next);
            setPendingRegistration(null);
            const label = next === "NON_VAT" ? "Non-VAT Registered" : "VAT Registered (12%)";
            setTaxToast({ title: "Tax settings updated successfully", message: `${label}. Only future POS transactions are affected.` });
            window.dispatchEvent(new Event("stocknbook-business-updated"));

            // Refresh the hook's store-wide tax snapshot. The save is already
            // confirmed at this point; a refresh failure must not imply rollback.
            try {
                await pos.refreshAll();
            } catch (refreshError) {
                console.warn("Saved tax registration; POS refresh was unsuccessful:", refreshError);
            }
        } catch (error) {
            setDialogError(
                error instanceof Error ? error.message : "Unable to save the tax setting. Please try again."
            );
        } finally {
            setSaving(false);
        }
    };

    const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeDialog();
        }
        if (event.key !== "Tab") return;

        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
            'button:not([disabled])'
        );
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const pendingLabel = pendingRegistration === "NON_VAT"
        ? "Non-VAT Registered"
        : "VAT Registered (12%)";

    return (
        <>
            <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                <SettingsCardHeading
                    icon={<ReceiptText size={18} />}
                    title="Business Tax Settings"
                    detail="Configure tax registration for all branches. Only the Owner can change this setting."
                />
                <fieldset className="mt-5 space-y-4" disabled={saving || pendingRegistration !== null || currentRegistration === null}>
                    <legend className="sr-only">Business tax registration</legend>
                    <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-[#1A1220]">
                        <input
                            type="radio"
                            name="taxRegistration"
                            value="NON_VAT"
                            className="h-4 w-4 accent-[#5F3CB0]"
                            checked={currentRegistration === "NON_VAT"}
                            onChange={() => requestTaxChange("NON_VAT")}
                        />
                        Non-VAT Registered
                    </label>
                    <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-[#1A1220]">
                        <input
                            type="radio"
                            name="taxRegistration"
                            value="VAT_REGISTERED"
                            className="h-4 w-4 accent-[#5F3CB0]"
                            checked={currentRegistration === "VAT_REGISTERED"}
                            onChange={() => requestTaxChange("VAT_REGISTERED")}
                        />
                        VAT Registered (12%)
                    </label>
                </fieldset>
                {currentRegistration === null && (
                    <p role="status" className="mt-3 text-xs text-[#806A8C]">
                        {pos.loading ? "Loading saved tax registration..." : "Tax registration could not be verified. Refresh the page before changing it."}
                    </p>
                )}
                <p className="mt-4 text-xs leading-5 text-[#7A6A84]">
                    Listed POS product prices already include VAT when registered. Invoices separate
                    VATable sales and VAT instead of adding another 12% at checkout.
                </p>

            </section>

            <SettingsSuccessToast toast={taxToast} onClose={dismissTaxToast} />
            {pendingRegistration && (
                <div
                    className="fixed inset-0 z-[150] flex items-center justify-center bg-[#180C2B]/55 p-4 backdrop-blur-[2px]"
                >
                    <div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="tax-confirm-title"
                        aria-describedby="tax-confirm-description"
                        onKeyDown={handleDialogKeyDown}
                        className="w-full max-w-[470px] rounded-[20px] border border-[#E6DDF0] bg-white p-6 shadow-[0_20px_60px_rgba(30,12,50,0.25)]"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1E9FF] text-[#5B2FC6]">
                                    <AlertTriangle size={21} strokeWidth={1.8} />
                                </span>
                                <div>
                                    <h2 id="tax-confirm-title" className="text-lg font-bold text-[#1A1220]">
                                        Confirm Tax Registration
                                    </h2>
                                    <p className="mt-0.5 text-xs text-[#806A8C]">
                                        Owner Settings
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label="Close confirmation dialog"
                                onClick={closeDialog}
                                disabled={saving}
                                className="rounded-lg p-1 text-[#806A8C] transition hover:bg-[#F7F1FF] hover:text-[#2B174C] disabled:opacity-50"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <p id="tax-confirm-description" className="mt-5 text-sm leading-6 text-[#5F4E75]">
                            Set this business to <strong className="text-[#1A1220]">{pendingLabel}</strong>?
                            The change will apply to <strong>future POS sales across all branches</strong>.
                            Existing invoices will keep their originally recorded tax information.
                        </p>

                        <div className="mt-4 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] px-4 py-3">
                            <p className="text-xs font-semibold text-[#2B174C]">
                                {pendingRegistration === "NON_VAT"
                                    ? "Future POS sales will show zero VAT."
                                    : "Future POS sales will show a 12% VAT-inclusive breakdown."}
                            </p>
                        </div>

                        {dialogError && (
                            <p role="alert" className="mt-4 text-xs font-medium text-[#B42318]">
                                {dialogError}
                            </p>
                        )}

                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                ref={cancelButtonRef}
                                type="button"
                                onClick={closeDialog}
                                disabled={saving}
                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl border border-[#D8CBE7] bg-white px-5 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B2FC6] disabled:opacity-50 sm:w-auto"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmTaxChange()}
                                disabled={saving}
                                className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-5 text-sm font-semibold text-white transition hover:bg-[#1B0D31] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B2FC6] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                            >
                                {saving ? "Saving..." : "Confirm Change"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function BranchSettings({
                            storeName, branchName, bookingLink, copied, onCopy, onPreview, onDownloadQR,
                        }: {
    storeName: string;
    branchName: string;
    bookingLink: string;
    copied: boolean;
    onCopy: () => void;
    onPreview: () => void;
    onDownloadQR: DownloadBookingQR;
}) {
    return (
        <>
            <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                <SettingsCardHeading
                    icon={<Store size={18} />}
                    title="Business Information"
                    detail="Business details provided by the store owner."
                />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <ReadOnlyField label="Business Name" value={storeName} />
                    <ReadOnlyField label="Assigned Branch" value={branchName || "Assigned Branch"} />
                </div>
            </section>
            <section className="rounded-[14px] border border-[#E6DDF0] bg-white p-5 shadow-sm">
                <SettingsCardHeading
                    icon={<Link2 size={18} />}
                    title="Booking Links / QR"
                    detail="Share your assigned branch’s booking link and QR code."
                />
                <div className="mt-5">
                    <BranchBookingRow
                        branchName={branchName}
                        bookingLink={bookingLink}
                        active={true}
                        copied={copied}
                        onCopy={onCopy}
                        onPreview={onPreview}
                        onDownloadQR={onDownloadQR}
                    />
                </div>
                <details className="mt-4 rounded-xl border border-[#E6DDF0] px-4 py-3">
                    <summary className="cursor-pointer text-sm font-semibold text-[#2B174C]">Sharing Tips</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <TipCard number="01" title="Social Media" detail="Add the booking link to your Facebook page bio or pin it in a post." />
                        <TipCard number="02" title="Direct Messages" detail="Send the link to customers who ask through chat or Messenger." />
                        <TipCard number="03" title="QR Displays" detail="Place the QR code in your store or on printed event materials." />
                        <TipCard number="04" title="Preview First" detail="Open the booking link before sharing to confirm the correct branch." />
                    </div>
                </details>
            </section>
        </>
    );
}

function SettingsCardHeading({
                                 icon,
                                 title,
                                 detail,
                             }: {
    icon: React.ReactNode;
    title: string;
    detail: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFE8F8] text-[#4E2C66]">
                {icon}
            </div>

            <div>
                <h2 className="text-[16px] font-bold text-[#1A1220]">
                    {title}
                </h2>
                <p className="mt-0.5 text-xs leading-5 text-[#7A6A84]">
                    {detail}
                </p>
            </div>
        </div>
    );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="mb-2 text-sm font-medium text-[#1A1220]">{label}</p>
            <div
                title={value}
                className="flex h-[42px] items-center truncate rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm text-[#5F4E75]"
            >
                {value}
            </div>
        </div>
    );
}

function TipCard({
                     number,
                     title,
                     detail,
                 }: {
    number: string;
    title: string;
    detail: string;
}) {
    return (
        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] p-4">
            <span className="text-xs font-bold tracking-[0.12em] text-[#806A8C]">
                {number}
            </span>
            <p className="mt-2 text-sm font-semibold text-[#1A1220]">
                {title}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#7A6A84]">{detail}</p>
        </div>
    );
}