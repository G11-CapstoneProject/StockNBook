"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";

export default function DashboardExportMenu({
                                                onExportPdf,
                                                onExportXlsx,
                                                onExportDoc,
                                                label,
                                            }: {
    onExportPdf: () => void;
    onExportXlsx: () => void;
    onExportDoc: () => void;
    label: string;
}) {
    const [isOpen, setIsOpen] = useState(false);

    const runExport = (callback: () => void) => {
        callback();
        setIsOpen(false);
    };

    return (
        <div
            className="relative"
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setIsOpen(false);
                }
            }}
        >
            <button
                type="button"
                onClick={() => setIsOpen((current) => !current)}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                aria-label={`Download ${label}`}
                title={`Download ${label}`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6DDF0] bg-[#FAF8FF] text-[#6D35D4] transition hover:bg-[#F3EEFF]"
            >
                <Download size={16} strokeWidth={2} />
            </button>

            {isOpen ? (
                <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+6px)] z-30 w-40 overflow-hidden rounded-xl border border-[#E2D7EA] bg-white p-1.5 shadow-[0_14px_35px_rgba(43,23,76,0.18)]"
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => runExport(onExportPdf)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-[#3C2947] transition hover:bg-[#F6F0FC] hover:text-[#6334D4]"
                    >
                        <FileText size={14} />
                        Export as PDF
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => runExport(onExportXlsx)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-[#3C2947] transition hover:bg-[#F6F0FC] hover:text-[#6334D4]"
                    >
                        <FileSpreadsheet size={14} />
                        Export as XLSX
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => runExport(onExportDoc)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-[#3C2947] transition hover:bg-[#F6F0FC] hover:text-[#6334D4]"
                    >
                        <FileText size={14} />
                        Export as DOC
                    </button>
                </div>
            ) : null}
        </div>
    );
}
