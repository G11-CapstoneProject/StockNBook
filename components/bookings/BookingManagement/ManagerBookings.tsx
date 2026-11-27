"use client";

import { getNextStatusConfig, getCustomerCustomRequest, getBookingSchedule } from './_shared';
import { useEffect, useMemo, useState } from "react";
import {
    BadgeCheck,
    CalendarDays,
    Hourglass,
    AlertCircle,
    CheckCircle2,
    Download,
    RefreshCw,
    Search,
    X,
} from "lucide-react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import RentalReturnSettlementDialog from "./RentalReturnSettlementDialog";
import {
    Booking,
    FilterType,
    TABS,
    BookingWorkspace,
    PriceModal,
    dateKey,
    formatDate,
    getAmountPaid,
    getBalance,
    getBranchGroupName,
    getManagerBookingTypeLabel,
    getManagerBookingCompositionLabel,
    getBookingTypeDisplay,
    getManagerBookingStatusLabel,
    getManagerPaymentLabel,
    getRequiredDownPayment,
    getSavedBookingAccess,
    getTotalPrice,
    normalizeBooking,
    peso,
} from "./_shared";

type BookingInventoryItem = {
    id: number;
    booking_id?: number;
    source_type?: string;
    product_id?: number;
    variant_id?: number | null;
    product_name: string;
    variant_name?: string | null;
    booked_quantity: number | string;
    reserved_quantity: number | string;
    used_quantity?: number | string;
    restored_quantity?: number | string;
    unit_price?: number | string;
    // Price used for cancellation refunds: discounted if the package / quote has a discount (from the Bookings Lambda).
    refund_unit_price?: number | string;
    refund_price_ratio?: number | string;
    inventory_status?: string;
};

type CancelUsedItem = {
    booking_item_id: number;
    used_quantity: number;
};

type BookingClosureImpact = {
    bookingId:number; status:string; eligibleForReject:boolean; eligibleForCancel:boolean;
    paymentStage:string; agreedPrice:number; requiredDownPayment:number;
    paymentReceived:number; depositCollected:number; depositHeld:number;
    reservedConsumableUnits:number; usedConsumableUnits:number;
    rentalItemLines:number; rentalAllocations:Record<string,number>;
    rentalCancellationBlocked?:boolean;
    requiresFinancialReview:boolean; requiresInventoryReview:boolean;
    refundDecision:string;
    // Cancellation refund (from get_booking_closure_impact)
    bookingRefunded?:number; refundableBookingPayment?:number; suggestedRefund?:number; depositRefundOnCancel?:number;
    usedItemsValue?:number;
};

// What the Manager hands back when cancelling. Saved together with the cancellation.
type CancelRefund = { amount: number; method: string; verified: boolean };

// UI-only feedback for booking actions. This does not change API requests
// or any inventory, approval, or payment business rules.
type BookingToast = {
    id: number;
    kind: "success" | "error";
    title: string;
    description: string;
};

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


// The booking report uses the dashboard renderer; individual PDFs use receipt and package-style layouts.
// All data is obtained from the existing authenticated, branch-scoped booking APIs.
type BookingPdfKind = "transaction" | "billing";
type ManagerBookingExportContext = {
    storeName: string;
    branchName: string;
    branchId: number;
    exportedAt: Date;
};

// Browser-only PDF layouts. The transaction follows the Packages module report;
// open/closed booking billing follows the Sales/POS invoice style.
// Canvas, as in Packages, preserves Unicode customer names and the peso symbol.
type BookingFinancialStatement = {
    booking: {
        id: number; reference: string; name: string; status: string; eventDate?: string;
        storeName?: string; branchName?: string; bookingType?: string; packageName?: string;
        agreedPrice: number | null; downPayment: number; dpDeadline?: string | null;
        bookingPayments: number; bookingRefunded?: number; balance: number;
    };
    packageBase: number; salesSubtotal?: number; rentalSubtotal: number;
    deliveryFee: number; setupFee: number; agreedCharges?: number;
    depositRequired: number; depositCollected: number; depositApplied: number;
    depositRefunded: number; depositHeld: number; claimBalance: number;
    depositWaiverReason?: string | null;
    salesItems?: Array<{ name: string; variantName?: string; quantity: number; unitPrice: number; amount: number }>;
    rentalItems: Array<{ name: string; quantity: number; days: number; dailyRate: number; amount: number }>;
    claims: Array<{ equipmentName?: string; sourceType?: string; quantity: number; reason?: string;
        status: string; amount: number; amountPaid: number; depositApplied: number }>;
    cancellation?: { status: string; reason: string | null; closedAt: string | null; refundMethod: string | null;
        bookingPayments: number; bookingRefunded: number; amountKept: number; depositRefunded: number } | null;
    vat?: { rate: number; taxableCharges: number; vatableSales: number; vatAmount: number } | null;
};
type BookingExportItems = {
    items: Array<{
        product_name: string; variant_name?: string | null; source_type?: string; category?: string;
        booked_quantity: number; reserved_quantity?: number; used_quantity?: number; restored_quantity?: number;
        unit_price?: number; estimated_subtotal?: number; inventory_status?: string; prepared?: boolean; issued?: boolean;
        available_for_booking?: number | null; availability_note?: string | null;
    }>;
    rentalItems: Array<{
        equipment_name: string; quantity: number; start_date?: string; end_date?: string;
        billable_days?: number; daily_rate?: number; agreed_line_total?: number; included_in_package?: boolean;
        allocation_status?: string; returned_quantity?: number; damaged_quantity?: number; missing_quantity?: number;
        available_for_event?: number | null; availability_note?: string | null;
    }>;
};
type BookingReturnReport = {
    equipmentName: string; issuedQuantity: number; allocationStatus: string;
    returnedReceivedUnits?: number | null; inspectionStatus?: string | null; inspectedAt?: string | null;
    inspectedBy?: string | null; receivedBy?: string | null; notes?: string | null;
    damagedUnits?: number; missingUnits?: number;
};
type Identity = { storeName: string; branchName: string; exportedAt: Date };
type Field = [string, unknown];
type TransactionInfo = {
    reference: string; customer: string; status: string; paymentStatus: string;
    booking: Field[]; contact: Field[]; schedule: Field[]; notes: Field[];
};
type Column = { name: string; width: number; align?: "left" | "center" | "right" };
type Cell = string | { name: string; detail?: string };
type TableRow = { group: string } | { cells: Cell[]; emphasis?: boolean };
type SummaryLine = { label: string; value: string; bold?: boolean };
type LayoutOptions = { billing: boolean; title: string; identity: Identity; reference: string; subtitle?: string };

const W = 595.28, H = 841.89, scale = 2;
const pixelW = Math.round(W * scale), pixelH = Math.round(H * scale);
const margin = 42, right = W - margin, width = W - margin * 2, bottom = H - 54;
const C = {
    cream: "#FDFAF4", white: "#FFFFFF", ink: "#241537", purple: "#2B174C",
    muted: "#806A8C", section: "#4E2C85", border: "#E6DDF0", pale: "#FBF8FF",
    header: "#FAF7FF", branch: "#EDE3FF", table: "#F7F2FC", alt: "#FCFAFF",
    payments: "#F5F0FF", alert: "#FFF6F5", alertBorder: "#F2C4C4", red: "#A33E20",
};
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const present = (value: unknown) => clean(value) || "—";
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const yesNo = (value?: boolean) => value == null ? "—" : value ? "Yes" : "No";
const amount = (value: unknown, billing = false) => value == null || value === "" || !Number.isFinite(Number(value))
    ? "—" : (billing ? "₱" : "PHP ") + Number(value).toLocaleString("en-PH", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const dateTime = (value: Date) => value.toLocaleString("en-PH", {
    timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const displayStatus = (value: unknown) => clean(value).replace(/_/g, " ").replace(/\b\w/g, m=>m.toUpperCase()) || "—";
const join = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join("\n");

class BookingDocument {
    private pages: Uint8Array[] = [];
    private canvas: HTMLCanvasElement | null = null;
    private ctx!: CanvasRenderingContext2D;
    private y = 0;
    private opt: LayoutOptions;

    constructor(opt: LayoutOptions) {
        this.opt = opt;
        this.newPage(false);
    }
    private font(size: number, bold = false) {
        this.ctx.font = `${bold ? 700 : 400} ${size}px Helvetica, Arial, sans-serif`;
    }
    private text(value: unknown, x: number, baseline: number, size = 10, bold = false, color = C.ink,
                 align: CanvasTextAlign = "left", maxWidth?: number) {
        this.font(size, bold);
        this.ctx.fillStyle = color;
        this.ctx.textAlign = align;
        if (maxWidth != null) this.ctx.fillText(clean(value), x, baseline, maxWidth);
        else this.ctx.fillText(clean(value), x, baseline);
        this.ctx.textAlign = "left";
    }
    private box(x: number, y: number, w: number, h: number, fill: string, stroke?: string, radius = 0) {
        this.ctx.fillStyle = fill;
        if (radius > 0) {
            this.ctx.beginPath();
            this.ctx.roundRect(x, y, w, h, radius);
            this.ctx.fill();
            if (stroke) { this.ctx.strokeStyle = stroke; this.ctx.lineWidth = 0.7; this.ctx.stroke(); }
        } else {
            this.ctx.fillRect(x, y, w, h);
            if (stroke) { this.ctx.strokeStyle = stroke; this.ctx.lineWidth = 0.7; this.ctx.strokeRect(x, y, w, h); }
        }
    }
    private rule(y: number, x = margin, end = right, dashed = false, color = C.border, thick = 0.6) {
        this.ctx.strokeStyle = color; this.ctx.lineWidth = thick; this.ctx.setLineDash(dashed ? [2, 2] : []);
        this.ctx.beginPath(); this.ctx.moveTo(x, y); this.ctx.lineTo(end, y); this.ctx.stroke(); this.ctx.setLineDash([]);
    }
    private wrap(value: unknown, w: number, size: number, bold = false): string[] {
        this.font(size, bold);
        const result: string[] = [];
        for (const paragraph of String(value ?? "").replace(/\r/g, "").split("\n")) {
            const words = paragraph.split(/\s+/).filter(Boolean);
            let line = "";
            if (!words.length) { result.push(""); continue; }
            for (const word of words) {
                if (line && this.ctx.measureText(line + " " + word).width <= w) { line += " " + word; continue; }
                if (line) result.push(line);
                line = "";
                for (const character of word) {
                    if (line && this.ctx.measureText(line + character).width > w) { result.push(line); line = ""; }
                    line += character;
                }
            }
            if (line) result.push(line);
        }
        return result.length ? result : [""];
    }
    private savePage() {
        if (!this.canvas) return;
        const bytes = atob(this.canvas.toDataURL("image/jpeg", 0.94).split(",")[1]);
        this.pages.push(Uint8Array.from(bytes, c => c.charCodeAt(0)));
    }
    private newPage(continued: boolean) {
        this.savePage();
        this.canvas = document.createElement("canvas");
        this.canvas.width = pixelW; this.canvas.height = pixelH;
        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("Unable to create PDF rendering surface.");
        this.ctx = ctx; ctx.setTransform(pixelW / W, 0, 0, pixelH / H, 0, 0);
        this.box(0, 0, W, H, C.cream);
        this.box(25, 24, W - 50, H - 48, C.white);
        if (this.opt.billing) {
            // Match the shared Sales/POS invoice: cream frame, purple top rule,
            // centered store/branch, invoice heading and booking reference.
            this.box(25, 24, W - 50, 6, C.purple);
            if (continued) {
                this.text(this.opt.identity.storeName, W / 2, 53, 17, true, C.purple, "center", width);
                this.text("Booking Reference: " + this.opt.reference + " (continued)", W / 2, 75, 11, false, C.muted, "center", width);
                this.rule(90);
                this.y = 105;
                return;
            }
            this.text(this.opt.identity.storeName, W / 2, 57, 23, true, C.purple, "center", width);
            this.text("Branch: " + this.opt.identity.branchName, W / 2, 78, 12, true, C.purple, "center", width);
            this.text(this.opt.subtitle || "Internal booking record", W / 2, 94, 10, false, "#5F4E75", "center", width);
            this.rule(105);
            this.text("BOOKING BILLING", W / 2, 140, 24, true, C.purple, "center", width);
            this.text("Booking Reference: " + this.opt.reference, W / 2, 160, 12, true, C.ink, "center", width);
            this.text("Internal transaction copy", W / 2, 176, 10, false, "#5F4E75", "center", width);
            this.y = 185;
        } else {
            // Same report header, palette and geometry as Packages.
            this.box(25, 24, W - 50, 6, C.purple);
            if (continued) {
                // A compact continuation header leaves room for the remaining details.
                this.text(this.opt.identity.storeName + " · " + this.opt.identity.branchName, W / 2, 48, 11, true, C.purple, "center", width);
                this.text(this.opt.title + " (continued)", W / 2, 69, 15, true, C.purple, "center", width);
                this.text("Booking reference: " + this.opt.reference, W / 2, 85, 9, false, C.muted, "center", width);
                this.rule(94);
                this.y = 104;
                return;
            }
            this.text(this.opt.identity.storeName, W / 2, 58, 21, true, C.purple, "center", width);
            this.text("Branch: " + this.opt.identity.branchName, W / 2, 75, 11.5, true, C.purple, "center", width);
            this.text("Generated: " + dateTime(this.opt.identity.exportedAt), W / 2, 91, 10.2, false, C.muted, "center", width);
            this.rule(103);
            this.text(this.opt.title + (continued ? " (continued)" : ""), W / 2, 131, continued ? 16 : 18, true, C.purple, "center", width);
            this.text("Booking reference: " + this.opt.reference, W / 2, 148, 9, false, C.muted, "center", width);
            this.y = 163;
        }
    }
    private need(h: number) {
        if (this.y + h > bottom) this.newPage(true);
    }
    private section(title: string) {
        if (this.opt.billing) {
            this.text(title.toUpperCase(), margin + 4, this.y + 13, 11, true, C.purple);
            this.y += 21;
        } else {
            this.box(margin, this.y, width, 23, C.pale);
            this.text(title, margin + 10, this.y + 15, 11, true, C.purple);
            this.y += 29;
        }
    }
    // Packages-style cards for transactions; Sales/POS-style field pairs for billing.
    cards(title: string, fields: Field[], billingIdentifiers = false) {
        if (!fields.length) return;
        const columns = billingIdentifiers ? 2 : 3;
        const gap = billingIdentifiers ? 10 : 8;
        const cardWidth = (width - gap * (columns - 1)) / columns;
        if (title) { this.need(75); this.section(title); }
        for (let index = 0; index < fields.length; index += columns) {
            const pair = fields.slice(index, index + columns);
            const prepared = pair.map(([label,value]) => ({label,lines:this.wrap(present(value),cardWidth-20,billingIdentifiers?11:10,!billingIdentifiers)}));
            // Preserve extremely long addresses instead of stretching a card off-page.
            const max = Math.max(...prepared.map(v=>v.lines.length));
            for (let offset = 0; offset < max; offset += 20) {
                const pieces = prepared.map(p=>({...p,lines:p.lines.slice(offset,offset+20)}));
                const lineCount = Math.max(1,...pieces.map(p=>p.lines.length));
                const height = Math.max(34, 22 + lineCount * 12);
                this.need(height + 5);
                pieces.forEach((part,i)=>{
                    if (!part.lines.length) return;
                    const x=margin+i*(cardWidth+gap);
                    if (!billingIdentifiers) this.box(x,this.y,cardWidth,height,C.white,C.border);
                    this.text(part.label + (offset ? " (continued)" : ""),
                        x+10,this.y+12,billingIdentifiers?9:8,true,billingIdentifiers?"#5F4E75":C.muted,"left",cardWidth-20);
                    part.lines.forEach((line,j)=>this.text(line,x+10,this.y+(billingIdentifiers?25:24)+j*12,billingIdentifiers?11:10,!billingIdentifiers,C.ink));
                });
                this.y+=height+(billingIdentifiers?3:5);
            }
        }
        if (billingIdentifiers) { this.y+=4; }
        else this.y+=5;
    }
    notes(title: string, fields: Field[]) {
        const visible=fields.filter(([,v])=>clean(v));
        if (!visible.length) return;
        this.need(60); this.section(title);
        for (const [label,value] of visible) {
            this.need(28);
            this.text(label,margin+8,this.y+11,9,true,C.section); this.y+=16;
            for(const line of this.wrap(value,width-16,9.5)) {
                this.need(14); this.text(line,margin+8,this.y+10,9.5,false,C.ink); this.y+=14;
            }
            this.y+=6;
        }
        this.y+=3;
    }
    paragraph(value: unknown, color = C.muted, centered = false) {
        const lines=this.wrap(value,width-20,8.5);
        if(lines.length <= 5) this.need(lines.length*13);
        for(const line of lines) {
            this.need(13); this.text(line,centered?W/2:margin+10,this.y+10,8.5,false,color,centered?"center":"left");
            this.y+=13;
        }
        this.y+=5;
    }
    table(title: string, columns: Column[], rows: TableRow[]) {
        const total = columns.reduce((n,c)=>n+c.width,0);
        let start=margin;
        const cols=columns.map(c=>{const w=width*c.width/total;const result={...c,x:start,w};start+=w;return result;});
        const headerSize=this.opt.billing?11:8;
        const headerLines=cols.map(c=>this.wrap(this.opt.billing?c.name:c.name.toUpperCase(),c.w-12,headerSize,true));
        const headerHeight=Math.max(this.opt.billing?29:22,10+Math.max(...headerLines.map(v=>v.length))*(headerSize+2));
        const header=()=>{
            this.box(margin,this.y,width,headerHeight,this.opt.billing?"#F9F6FD":C.table,this.opt.billing?undefined:C.border);
            cols.forEach((c,i)=>headerLines[i].forEach((line,j)=>{
                const a=c.align||"left";const x=a==="right"?c.x+c.w-6:a==="center"?c.x+c.w/2:c.x+6;
                this.text(line,x,this.y+(this.opt.billing?19:12)+j*(headerSize+2),headerSize,true,this.opt.billing?C.purple:C.muted,a);
            }));
            this.y+=headerHeight;
            if(this.opt.billing)this.rule(this.y);
        };
        this.need(29+headerHeight+40); this.section(title); header();
        for (const [index,row] of rows.entries()) {
            if ("group" in row) {
                if(this.y+56>bottom){this.newPage(true);this.section(title+" (continued)");header();}
                this.box(margin,this.y,width,18,this.opt.billing?C.white:C.alt,this.opt.billing?undefined:C.border);
                this.text(row.group.toUpperCase(),margin+8,this.y+12,8,true,C.muted);
                this.y+=18; continue;
            }
            const prepared=cols.map((c,i)=>{
                const cell=row.cells[i]??"—";
                const name=typeof cell==="string"?cell:cell.name;
                const detail=typeof cell==="string"?"":cell.detail;
                const strong=row.emphasis||(this.opt.billing?i===cols.length-1:i===0);
                const cellSize=this.opt.billing?10:9;
                return [
                    ...this.wrap(name,c.w-12,cellSize,Boolean(strong)).map(s=>({s,bold:Boolean(strong),color:C.ink,size:cellSize})),
                    ...(detail?this.wrap(detail,c.w-12,8).map(s=>({s,bold:false,color:C.muted,size:8})):[])
                ];
            });
            const lineCount=Math.max(1,...prepared.map(v=>v.length));
            for(let offset=0;offset<lineCount;offset+=26) {
                const slices=prepared.map(v=>v.slice(offset,offset+26));
                const rowHeight=Math.max(26,10+Math.max(...slices.map(v=>v.length))*11);
                if(this.y+rowHeight>bottom){this.newPage(true);this.section(title+" (continued)");header();}
                this.box(margin,this.y,width,rowHeight,this.opt.billing?C.white:row.emphasis?C.pale:index%2===0?C.white:C.alt,this.opt.billing?undefined:C.border);
                cols.forEach((c,i)=>{
                    const a=c.align||"left";const x=a==="right"?c.x+c.w-6:a==="center"?c.x+c.w/2:c.x+6;
                    const lines=slices[i];
                    lines.forEach((line,j)=>this.text(line.s,x,this.y+13+j*11,line.size,line.bold,line.color,a));
                });
                this.y+=rowHeight;
                if(this.opt.billing)this.rule(this.y);
            }
        }
        this.y+=8;
    }
    // Same highlighted total amount band as the Sales/POS invoice.
    invoiceTotal(value: string) {
        this.need(48);
        this.box(margin,this.y,width,38,"#F9F6FD");
        this.rule(this.y);
        this.text("TOTAL AMOUNT",margin+8,this.y+25,15,true,C.purple);
        this.text(value,right-8,this.y+25,19,true,C.purple,"right",width*.59);
        this.y+=45;
    }
    summary(title: string, lines: SummaryLine[], options: {fill?: string; stroke?: string; note?: string; warning?: boolean} = {}) {
        if(!lines.length && !options.note) return;
        const pad=options.fill?10:0;
        const w=width-pad*2;
        const prepared=lines.map(line=>({...line,labels:this.wrap(line.label,w*.68-8,9.5,Boolean(line.bold)),
            values:this.wrap(line.value,w*.32-5,9.5,Boolean(line.bold))}));
        const heights=prepared.map(line=>Math.max(16,Math.max(line.labels.length,line.values.length)*12+4));
        const noteLines=options.note?this.wrap(options.note,w,8.4):[];
        const headingHeight=title?20:0;
        const total=pad*2+headingHeight+heights.reduce((a,b)=>a+b,0)+noteLines.length*12+(noteLines.length?4:0);
        this.need(total+6);
        if(options.fill) this.box(margin,this.y,width,total,options.fill,options.stroke||C.border,7);
        let y=this.y+pad;
        if(title) { this.text(this.opt.billing?title.toUpperCase():title,margin+pad,y+12,10,true,options.warning?C.red:C.section);y+=headingHeight; }
        prepared.forEach((line,i)=>{
            if(line.bold&&i>0)this.rule(y,margin+pad,right-pad,true);
            line.labels.forEach((s,j)=>this.text(s,margin+pad,y+12+j*12,9.5,Boolean(line.bold),line.bold?C.purple:C.muted));
            line.values.forEach((s,j)=>this.text(s,right-pad,y+12+j*12,9.5,Boolean(line.bold),C.ink,"right"));
            y+=heights[i];
        });
        if(noteLines.length){y+=4;noteLines.forEach((s,j)=>this.text(s,margin+pad,y+9+j*12,8.4,false,C.muted));}
        this.y+=total+(this.opt.billing?5:9);
    }
    outstanding(label: string, value: string, note: string) {
        this.need(54);
        this.box(margin,this.y,width,48,C.purple,undefined,7);
        this.text(label.toUpperCase(),margin+12,this.y+16,9,true,"#E5D9FF","left",width*.55);
        this.text(value,right-12,this.y+19,16,true,C.white,"right",width*.35);
        this.text(note,margin+12,this.y+35,8,false,"#E5D9FF","left",width-24);
        this.y+=57;
    }
    finish(): Blob {
        this.savePage();
        // Same image-page PDF assembly as Packages; byte offsets account for JPEG data.
        const encoder=new TextEncoder(), parts: BlobPart[]=[], offsets:number[]=[0];
        let position=0;
        const append=(data:string|Uint8Array)=>{
            const bytes=typeof data==="string"?encoder.encode(data):data;
            const copy=new Uint8Array(new ArrayBuffer(bytes.byteLength));copy.set(bytes);
            parts.push(copy);position+=copy.byteLength;
        };
        const object=(id:number,data:string|Uint8Array,prefix="",suffix="")=>{
            offsets[id]=position;append(`${id} 0 obj\n`);append(prefix);append(data);append(suffix);append("\nendobj\n");
        };
        append("%PDF-1.4\n%----\n");
        object(1,"<< /Type /Catalog /Pages 2 0 R >>");
        const pageIds=this.pages.map((_,i)=>4+i*3);
        object(2,`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
        object(3,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
        this.pages.forEach((bytes,i)=>{
            const pageId=pageIds[i],streamId=pageId+1,imageId=pageId+2;
            const footer=this.opt.billing?`Internal booking record - not a tax invoice | Page ${i+1} of ${this.pages.length}`:`Powered by StockNBook | Page ${i+1} of ${this.pages.length}`;
            const commands=`q ${W} 0 0 ${H} 0 0 cm /Cover Do Q\nq 0.9 0.86 0.94 RG 0.6 w ${margin} 42 m ${right} 42 l S Q\nq 0.373 0.306 0.459 rg BT /F1 8 Tf 1 0 0 1 ${(W/2-footer.length*2.05).toFixed(2)} 26 Tm (${footer}) Tj ET Q\n`;
            object(pageId,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Cover ${imageId} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
            object(streamId,commands,`<< /Length ${encoder.encode(commands).length} >>\nstream\n`,"endstream");
            object(imageId,bytes,`<< /Type /XObject /Subtype /Image /Width ${pixelW} /Height ${pixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,"\nendstream");
        });
        const xref=position,totalObjects=3+this.pages.length*3;
        append(`xref\n0 ${totalObjects+1}\n0000000000 65535 f \n`);
        for(let id=1;id<=totalObjects;id++)append(`${String(offsets[id]).padStart(10,"0")} 00000 n \n`);
        append(`trailer\n<< /Size ${totalObjects+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
        return new Blob(parts,{type:"application/pdf"});
    }
}

function refundMethod(methods: string) {
    const labels:Record<string,string>={gcash:"GCash",bank_transfer:"Bank transfer",cash:"Cash"};
    return methods.split(",").map(m=>m.trim()).filter(Boolean).map(m=>labels[m]||m).join(", ");
}
function closedAt(value: string) {
    const parsed=new Date(value.includes("T")?value:value.replace(" ","T")+"+08:00");
    return Number.isNaN(parsed.getTime())?value:dateTime(parsed);
}
function drawFinancial(doc: BookingDocument, v: BookingFinancialStatement, billing: boolean) {
    // Same calculations, grouping, labels and conditions as BookingFinancialPanel.
    const b=v.booking, agreed=b.agreedPrice==null?null:Number(b.agreedPrice);
    const depositDue=v.cancellation?0:Math.max(0,num(v.depositRequired)-num(v.depositCollected));
    const bookingDue=Math.max(0,num(b.balance)), claimDue=Math.max(0,num(v.claimBalance));
    const charges=v.claims.filter(c=>c.status!=="waived");
    const approvedTotal=charges.reduce((n,c)=>n+Math.max(0,num(c.amount)),0);
    const claimPayments=charges.reduce((n,c)=>n+Math.max(0,num(c.amountPaid)),0);
    const cashCollected=num(b.bookingPayments)+num(v.depositCollected)+claimPayments;
    const bookingRefunded=Math.max(0,num(b.bookingRefunded ?? v.cancellation?.bookingRefunded));
    const netReceived=cashCollected-num(v.depositRefunded)-bookingRefunded;
    const hasDeposit=[v.depositRequired,v.depositCollected,v.depositApplied,v.depositRefunded,v.depositHeld].some(n=>Math.abs(num(n))>0.005);
    const hasCharges=v.claims.length>0||[v.claimBalance,v.depositApplied].some(n=>Math.abs(num(n))>0.005);
    const hasRentals=v.rentalItems.length>0;
    const financialMoves=Math.abs(num(v.depositCollected))>0.005||Math.abs(num(v.depositRefunded))>0.005||Math.abs(claimPayments)>0.005||bookingRefunded>0.005;
    const totalDue=bookingDue+depositDue+claimDue, reconciled=agreed!==null&&totalDue<0.005&&claimDue<0.005;
    const money=(value:unknown)=>amount(Math.max(0,num(value)),false);
    const line=(label:string,value:unknown,bold=false):SummaryLine=>({label,value:money(value),bold});
    if(v.cancellation){
        const c=v.cancellation;
        const lines:SummaryLine[]=[];
        if(c.closedAt)lines.push({label:c.status==="Rejected"?"Rejected on":"Cancelled on",value:closedAt(c.closedAt)});
        if(c.bookingPayments>0.005)lines.push(line("Booking payments received",c.bookingPayments),line("Refunded to customer",c.bookingRefunded),line("Kept by the store",c.amountKept,true));
        if(c.depositRefunded>0.005)lines.push(line("Security deposit refunded",c.depositRefunded));
        if(c.refundMethod)lines.push({label:"Refund method",value:refundMethod(c.refundMethod)});
        const title=c.status==="Rejected"?"Booking request rejected":"Booking cancelled";
        doc.summary(title,lines,{fill:C.alert,stroke:C.alertBorder,warning:true,note:c.bookingPayments<=0.005&&c.depositRefunded<=0.005?"No payment was received, so nothing was refunded.":undefined});
        if(c.reason)doc.notes("Cancellation reason",[["Reason",c.reason]]);
    }
    const rows:TableRow[]=[];
    if(v.packageBase>0)rows.push({cells:[b.packageName?"Package · "+b.packageName:"Package","1",money(v.packageBase),money(v.packageBase)]});
    if(v.salesItems?.length){
        rows.push({group:"Consumable items"});
        for(const i of v.salesItems) rows.push({cells:[i.name+(i.variantName?" ("+i.variantName+")":""),String(i.quantity),money(i.unitPrice),money(i.amount)]});
    }
    if(hasRentals){
        rows.push({group:"Rental items"});
        for(const i of v.rentalItems)rows.push({cells:[{name:i.name,detail:`${i.days} ${i.days===1?"day":"days"} rental`},String(i.quantity),{name:money(i.dailyRate),detail:"per day"},money(i.amount)]});
    }
    if(v.deliveryFee>0||v.setupFee>0)rows.push({group:"Other charges"});
    if(v.deliveryFee>0)rows.push({cells:["Delivery / pickup","1",money(v.deliveryFee),money(v.deliveryFee)]});
    if(v.setupFee>0)rows.push({cells:["Setup","1",money(v.setupFee),money(v.setupFee)]});
    const totalUnits=(v.salesItems||[]).reduce((n,i)=>n+Math.max(0,num(i.quantity)),0)+v.rentalItems.reduce((n,i)=>n+Math.max(0,num(i.quantity)),0);
    const subtotal=num(v.packageBase)+num(v.deliveryFee)+num(v.setupFee)+(v.salesItems||[]).reduce((n,i)=>n+num(i.amount),0)+v.rentalItems.reduce((n,i)=>n+num(i.amount),0);
    if(rows.length){
        if(!billing&&totalUnits>0)rows.push({cells:["Total units needed",String(totalUnits),"",""],emphasis:true});
        if(!billing&&agreed!==null&&Math.abs(subtotal-agreed)>0.005)rows.push({cells:["Itemized subtotal","","",money(subtotal)],emphasis:true});
        doc.table(billing?"Items / services":"Booking charges",[{name:billing?"Item":"Item / service",width:245},{name:"Qty",width:42,align:"center"},{name:billing?"Price":"Unit price",width:110,align:"right"},{name:"Total",width:114,align:"right"}],rows);
    }else doc.paragraph("No itemized charges available.");
    const bookingLines=[line("Final agreed booking price",agreed??0,true),line("Booking payments received",b.bookingPayments),line("Remaining booking balance",bookingDue,true)];
    if(!billing){
        bookingLines.splice(1,0,line("Required down payment",b.downPayment));
        if(b.dpDeadline)bookingLines.splice(2,0,{label:"Down payment deadline",value:b.dpDeadline});
    }
    if(billing){
        const subtotalLines:SummaryLine[]=[line("Itemized subtotal",subtotal)];
        // Only show saved VAT figures; never infer tax registration from a zero amount.
        if(v.vat)subtotalLines.push(line("VATable Sales",v.vat.vatableSales),line("VAT Amount (recorded)",v.vat.vatAmount));
        doc.summary("",subtotalLines);
        doc.invoiceTotal(agreed===null?"Awaiting agreement":money(agreed));
        if(agreed!==null&&Math.abs(subtotal-agreed)>0.02)doc.paragraph("Itemized amounts and agreed booking total differ; review the original booking.");
        const paymentLines:SummaryLine[]=[
            line("Booking Payments",b.bookingPayments),
            {label:"Remaining Booking Balance",value:agreed===null?"Awaiting agreement":money(bookingDue),bold:true},
        ];
        if(!v.cancellation&&num(b.downPayment)>0&&bookingDue>0.005)paymentLines.unshift(line("Required down payment",b.downPayment));
        if(!v.cancellation&&b.dpDeadline&&bookingDue>0.005)paymentLines.splice(1,0,{label:"Down payment deadline",value:b.dpDeadline});
        doc.summary("",paymentLines,{note:agreed===null?"Final price has not yet been agreed.":undefined});
    }else doc.summary("Booking payment details",bookingLines,{note:agreed===null?"Final price has not yet been agreed.":undefined});
    if(!billing&&v.vat)doc.summary("Saved VAT breakdown",[{label:"VAT rate",value:`${v.vat.rate}%`},line("VATable sales",v.vat.vatableSales),line("VAT amount",v.vat.vatAmount),line("Taxable charges",v.vat.taxableCharges)]);
    if(hasDeposit||hasRentals){
        const depositLines=[
            line("Deposit required",v.depositRequired),line("Deposit collected",v.depositCollected),
            line("Deposit used for damage / missing charges",v.depositApplied),
            line("Deposit already refunded to customer",v.depositRefunded),
            line("Deposit still held",v.depositHeld,true),
        ];
        if(depositDue>0.005)depositLines.push(line("Deposit still to collect",depositDue));
        const note=(hasRentals&&!hasDeposit?(b.status.toLowerCase()==="pending review"?"Deposit amount must be reviewed before approval. A zero deposit may be permitted. ":"No refundable security deposit required under the saved booking terms. "):"")
            +"Security deposits are refundable amounts held separately from booking revenue.";
        doc.summary(billing?"Booking billing & deposit settlement":"Refundable security deposit",depositLines,billing?{note}:{fill:C.pale,stroke:"#E8DEF3",note});
        if(!billing&&v.depositWaiverReason)doc.notes("Deposit waiver",[["Reason",v.depositWaiverReason]]);
    }
    if(hasCharges){
        const leader=(c:BookingFinancialStatement["claims"][number])=>/^combined booking-wide charge\b/i.test(clean(c.reason))&&num(c.amount)>0;
        const companion=(c:BookingFinancialStatement["claims"][number])=>/^covered by the same combined booking-wide charge\b/i.test(clean(c.reason));
        const combinedTotal=v.claims.filter(leader).reduce((n,c)=>n+Math.max(0,num(c.amount)),0);
        const claimRows:TableRow[]=v.claims.map(c=>{
            const covered=combinedTotal>0&&(leader(c)||companion(c));
            const detail=join((c.sourceType==="missing"?"Missing":"Damaged")+(c.status==="waived"&&!covered?" · Waived":""),
                !covered&&c.status!=="waived"?`Paid: ${money(c.amountPaid)} · Deposit used: ${money(c.depositApplied)} · Due: ${money(Math.max(0,num(c.amount)-num(c.amountPaid)-num(c.depositApplied)))}`:undefined,
                !billing&&c.reason?c.reason:undefined);
            return {cells:[{name:c.equipmentName||"Equipment",detail},String(c.quantity),covered?"Included":money(c.status==="waived"?0:c.amount)]};
        });
        if(combinedTotal>0)claimRows.push({cells:["Combined charge for all affected equipment","",money(combinedTotal)],emphasis:true});
        if(claimRows.length)doc.table("Damage / missing charges",[{name:"Affected item",width:330},{name:"Qty",width:55,align:"center"},{name:"Charge",width:126,align:"right"}],claimRows);
        else doc.paragraph("No damage or missing-item charges recorded.");
        doc.summary("",[line("Total approved charges",approvedTotal),line("Additional charge payments received",claimPayments),line("Deposit applied to charges",v.depositApplied),line("Outstanding charges",claimDue,true)]);
    }
    if(financialMoves){
        const lines=[line("Booking payments received",b.bookingPayments)];
        if(num(v.depositCollected)>0)lines.push(line("Security deposit collected",v.depositCollected));
        if(claimPayments>0)lines.push(line("Additional charge payments received",claimPayments));
        lines.push(line("Total money collected",cashCollected,true));
        if(num(v.depositRefunded)>0)lines.push(line("Less: deposit refunded",v.depositRefunded));
        if(bookingRefunded>0.005)lines.push(line("Less: booking payment refunded (cancelled)",bookingRefunded));
        lines.push(line("Net cash received",netReceived,true));
        doc.summary("Payment summary",lines,billing?{}:{fill:C.payments});
    }
    if(totalDue>0.005){
        if(billing)doc.summary("",[{label:"Total outstanding from customer",value:agreed===null?"Not set":money(totalDue),bold:true}],
            {fill:"#F9F6FD",note:"Remaining booking balance + unpaid security deposit + unpaid approved charges."});
        else doc.outstanding("Total outstanding from customer",agreed===null?"Not set":money(totalDue),"Remaining booking balance + unpaid security deposit + unpaid approved charges.");
    }
    const note=v.cancellation?(v.cancellation.status==="Rejected"?"This booking request was rejected. No payment is due.":"This booking was cancelled. Refunds are shown in the Cancellation section; no further payment is due."):
        reconciled?(hasRentals?"Booking payment is complete. Rental release, return and any final deposit settlement are tracked separately.":"Booking fully paid."):
            hasRentals?"Check booking payments and any deposit or charge settlement still due. Rental returns are tracked separately.":"Review outstanding booking payments before closing this booking.";
    doc.paragraph(note+(billing?"":" This is a financial record, not a tax invoice."),C.muted,true);
}

function createBookingBillingPdf(v: BookingFinancialStatement, identity: Identity, reference: string, paymentStatus?: string): Blob {
    const b=v.booking;
    const sub="Sales Source: Booking" + (v.vat?" · VAT amount recorded":"");
    const doc=new BookingDocument({billing:true,title:"Booking Billing",identity,reference,subtitle:sub});
    const status=v.cancellation?"Closed":paymentStatus || (b.agreedPrice==null?"Awaiting agreement":num(b.balance)<=0.005?"Fully Paid":num(b.bookingPayments)>0?"Partially Paid":"Unpaid");
    doc.cards("",[["Customer",b.name],["Event Date",b.eventDate],["Booking Status",b.status],["Payment Status",status]],true);
    drawFinancial(doc,v,true);
    return doc.finish();
}

function createBookingTransactionPdf(info: TransactionInfo, v: BookingFinancialStatement, items: BookingExportItems, reports: BookingReturnReport[], identity: Identity): Blob {
    const doc=new BookingDocument({billing:false,title:"Booking Transaction",identity,reference:info.reference});
    doc.cards("Booking information",[["Customer",info.customer],["Booking status",info.status],["Payment status",info.paymentStatus],...info.booking]);
    doc.cards("Customer information",info.contact);
    doc.cards("Schedule",info.schedule);
    doc.notes("Customer requests / notes",info.notes);
    const qty=(value:unknown)=>value==null?"—":String(value);
    const bool=(value:unknown)=>value==null?"—":yesNo(Boolean(value));
    const consumables:TableRow[]=items.items.map(i=>({cells:[
            {name:i.product_name+(i.variant_name?" ("+i.variant_name+")":""),detail:join(
                    [i.source_type?displayStatus(i.source_type):"",i.category||""].filter(Boolean).join(" · "),
                    `Unit price: ${amount(i.unit_price)} · Estimated subtotal: ${amount(i.estimated_subtotal)}`,
                    `Prepared: ${bool(i.prepared)} · Released: ${bool(i.issued)}`,i.availability_note||undefined)},
            qty(i.booked_quantity),qty(i.reserved_quantity),qty(i.used_quantity),qty(i.restored_quantity),
            i.available_for_booking==null?"Not verified":qty(i.available_for_booking),displayStatus(i.inventory_status)]}));
    if(consumables.length){
        doc.table("Consumable items",[{name:"Item / details",width:180},{name:"Qty",width:33,align:"center"},{name:"Reserved",width:56,align:"center"},
            {name:"Issued",width:43,align:"center"},{name:"Restored",width:56,align:"center"},{name:"Available",width:60,align:"center"},{name:"Status",width:83,align:"center"}],consumables);
    }else doc.paragraph("No consumable items in this booking.");
    const rentals:TableRow[]=items.rentalItems.map(i=>({cells:[
            {name:i.equipment_name,detail:join(`${present(i.start_date)} to ${present(i.end_date)} · ${qty(i.billable_days)} day(s)`,
                    `Rate/day: ${amount(i.daily_rate)} · Line total: ${amount(i.agreed_line_total)}`,
                    `Included in package: ${bool(i.included_in_package)}`,i.availability_note||undefined)},
            qty(i.quantity),qty(i.returned_quantity),qty(i.damaged_quantity),qty(i.missing_quantity),
            i.available_for_event==null?"Not verified":qty(i.available_for_event),displayStatus(i.allocation_status)]}));
    if(rentals.length){
        doc.table("Rental items",[{name:"Equipment / details",width:185},{name:"Qty",width:34,align:"center"},{name:"Returned",width:60,align:"center"},
            {name:"Damaged",width:57,align:"center"},{name:"Missing",width:55,align:"center"},{name:"Available",width:58,align:"center"},{name:"Status",width:62,align:"center"}],rentals);
    }else doc.paragraph("No rental items in this booking.");
    if(reports.length){
        doc.table("Return inspection",[{name:"Equipment / staff report",width:215},{name:"Issued",width:48,align:"center"},{name:"Received",width:60,align:"center"},
                {name:"Damaged",width:57,align:"center"},{name:"Missing",width:55,align:"center"},{name:"Inspection",width:76,align:"center"}],
            reports.map(r=>({cells:[{name:r.equipmentName,detail:join("Allocation: "+displayStatus(r.allocationStatus),
                        r.receivedBy?"Received by: "+r.receivedBy:undefined,r.inspectedBy?"Inspected by: "+r.inspectedBy:undefined,
                        r.inspectedAt?"Inspected at: "+r.inspectedAt:undefined,r.notes?"Notes: "+r.notes:undefined)},
                    qty(r.issuedQuantity),qty(r.returnedReceivedUnits),qty(r.damagedUnits),qty(r.missingUnits),displayStatus(r.inspectionStatus)]})));
    }
    drawFinancial(doc,v,false);
    return doc.finish();
}

function downloadBookingPdf(blob: Blob, filename: string) {
    const url=URL.createObjectURL(blob), link=document.createElement("a");
    link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),5000);
}

function safeFilename(value: unknown) {
    return String(value ?? "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 90) || "booking";
}

function pdfBookingText(value: unknown): string {
    // The shared dashboard uses ASCII Helvetica PDF streams. Transliterate accented letters
    // and preserve unsupported characters as code points instead of silently dropping them.
    const text = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .replace(/₱/g, "PHP ").replace(/[–—]/g, "-").replace(/[•·]/g, " / ")
        .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim()
        .replace(/[^\x20-\x7e]/gu, ch => "U+" + ch.codePointAt(0)!.toString(16).toUpperCase());
    return text || "-";
}

function bookingCurrency(value: unknown): string {
    if (value == null || value === "" || !Number.isFinite(Number(value))) return "Not available";
    return "PHP " + Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exportDay(date: Date) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return ["year", "month", "day"].map(key => parts.find(part => part.type === key)?.value || "").join("-");
}

function bookingBranch(booking: Booking, context: ManagerBookingExportContext) {
    const name = getBranchGroupName(booking);
    return name === "Unassigned Branch" || name === "Assigned Branch" ? context.branchName : name;
}

function assertBookingBranch(booking: Booking, context: ManagerBookingExportContext) {
    if (!(context.branchId > 0) || Number(booking.branchId ?? booking.branch_id) !== context.branchId)
        throw new Error("Booking is not in the assigned branch.");
}

async function exportBookingTable(title: string, headers: string[], rows: string[][],
                                  context: ManagerBookingExportContext, dateRange: string, filename: string) {
    const { exportTableAsPdf } = await import("@/components/dashboard/_shared");
    exportTableAsPdf(
        { title, headers, rows: rows.map(row => row.map(pdfBookingText)) },
        { storeName: pdfBookingText(context.storeName), branch: pdfBookingText(context.branchName), dateRange: pdfBookingText(dateRange) },
        filename, { centerColumns: true, currencyNote: true }
    );
}

async function downloadManagerBookingsPdf(bookings: Booking[], context: ManagerBookingExportContext) {
    bookings.forEach(b => assertBookingBranch(b, context));
    const dates = bookings.map(b => dateKey(b.date)).filter(Boolean).sort();
    const dateRange = dates.length
        ? `All bookings | ${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])}`
        : "All booking dates";
    const rows = [...bookings].sort((a,b) =>
        String(b.createdAt || b.created_at || "").localeCompare(String(a.createdAt || a.created_at || "")) || b.id-a.id
    ).map(b => {
        const schedule = getBookingSchedule(b);
        const agreed = b.agreed_price ?? b.agreedPrice;
        return [
            b.bookingReference || b.booking_reference || `#${b.id}`,
            b.name,
            [formatDate(b.date), schedule.handoverShort].filter(Boolean).join(" | "),
            getManagerBookingCompositionLabel(b),
            getManagerPaymentLabel(b),
            getManagerBookingStatusLabel(b.status),
            agreed == null ? "Awaiting agreement" : bookingCurrency(agreed),
        ];
    });
    await exportBookingTable("Booking Report",
        ["Booking Reference", "Customer", "Schedule", "Booking Type", "Payment Status", "Booking Status", "Agreed Price"],
        rows, context, dateRange, `StockNBook_Booking_Report_${safeFilename(context.branchName)}_${exportDay(context.exportedAt)}`);
}

async function fetchBookingExportData(action: string, booking: Booking, context: ManagerBookingExportContext): Promise<Record<string, unknown>> {
    assertBookingBranch(booking, context);
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Please log in before downloading a booking PDF.");
    const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, booking_id: booking.id, branch_id: context.branchId }),
        cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data.error || data.success === false) {
        throw new Error(data.error || data.message || "Unable to load the booking PDF data.");
    }
    return data;
}

async function downloadSelectedBookingPdf(booking: Booking, kind: BookingPdfKind, context: ManagerBookingExportContext) {
    const [financial, itemResult] = await Promise.all([
        fetchBookingExportData("get_booking_financial_statement", booking, context),
        kind === "transaction" ? fetchBookingExportData("get_booking_items", booking, context) : Promise.resolve(null),
    ]);
    const v = financial.statement as BookingFinancialStatement | undefined;
    if (!v?.booking || Number(v.booking.id) !== booking.id || !Array.isArray(v.rentalItems) || !Array.isArray(v.claims))
        throw new Error("Booking financial statement is unavailable or incomplete.");
    const identity = { ...context, storeName: v.booking.storeName?.trim() || context.storeName,
        branchName: v.booking.branchName?.trim() || bookingBranch(booking, context) };
    const reference = v.booking.reference || booking.bookingReference || String(booking.id);
    const suffix = kind === "billing" ? "Billing" : "Booking_Transaction";
    const filename = `StockNBook_${safeFilename(reference)}_${suffix}_${exportDay(context.exportedAt)}.pdf`;
    const paymentStatus = getManagerPaymentLabel({
        ...booking, status:v.booking.status, agreedPrice:v.booking.agreedPrice, agreed_price:v.booking.agreedPrice,
        amountPaid:v.booking.bookingPayments, amount_paid:v.booking.bookingPayments, balance:v.booking.balance,
        requiredDownPayment:v.booking.downPayment, required_down_payment:v.booking.downPayment,
        securityDepositRequired:v.depositRequired, securityDepositCollected:v.depositCollected,
    });
    if (kind === "billing") {
        // Completed bookings are actual POS sales. Use the exact same scoped
        // invoice endpoint and renderer as Sales/POS, including saved addresses
        // and payment/tax information. Earlier bookings are not POS sales yet.
        if (getManagerBookingStatusLabel(v.booking.status) === "Completed" && !v.cancellation) {
            try {
                const {fetchOrderInvoiceDetail,createOrderInvoicePdf} = await import("../../pos/OwnerPOS");
                const detail = await fetchOrderInvoiceDetail(reference,"BOOKING");
                const invoice = createOrderInvoicePdf(detail);
                downloadBookingPdf(invoice,filename);
                return;
            } catch {
                // The independently authorized booking statement is still printable
                // as an internal billing record when a POS invoice is unavailable.
            }
        }
        downloadBookingPdf(createBookingBillingPdf(v, identity,reference,paymentStatus), filename);
        return;
    }
    if (!itemResult || !Array.isArray(itemResult.items) || !Array.isArray(itemResult.rentalItems))
        throw new Error("Booking item records are unavailable.");
    const itemBooking = itemResult.booking as { id?: number; branch_id?: number } | undefined;
    if (!itemBooking || Number(itemBooking.id) !== booking.id || Number(itemBooking.branch_id) !== context.branchId)
        throw new Error("Booking item records do not match the selected booking and branch.");
    const data = itemResult as unknown as BookingExportItems;
    let reports: BookingReturnReport[] = [];
    if (data.rentalItems.length) {
        const returns = await fetchBookingExportData("get_booking_claim_sources", booking, context);
        if (!Array.isArray(returns.returnReports)) throw new Error("Rental return records are unavailable.");
        reports = returns.returnReports as BookingReturnReport[];
    }
    const schedule = getBookingSchedule(booking);
    const info: TransactionInfo = {
        reference, customer:v.booking.name || booking.name, status:getManagerBookingStatusLabel(v.booking.status), paymentStatus,
        booking:[
            ["Type",getManagerBookingCompositionLabel(booking)],
            ["Package",v.booking.packageName || booking.packageName || booking.package_name || booking.package],
            ["Event type",booking.eventType || booking.event_type],
            ["Theme / motif",booking.theme_motif_request || booking.themeMotifRequest || booking.theme],
            ["Created at",booking.createdAt || booking.created_at],
            ["Approval status",booking.approvalStatus],
        ],
        contact:[["Phone",booking.phone],["Email",booking.email],["Facebook / Messenger",booking.facebookName || booking.facebook_name]],
        schedule:[
            ["Event start",formatDate(v.booking.eventDate || booking.date)],
            ["Event end",booking.eventEndDate ? formatDate(booking.eventEndDate) : undefined],
            [schedule.label,schedule.handoverText],
            ...(schedule.returnText ? [["Return",schedule.returnText] as [string,unknown]] : []),
            [booking.handoverMethod === "delivery" ? "Delivery address" : "Venue",booking.venue],
        ],
        notes:[
            ["Custom request",getCustomerCustomRequest(booking) || "None"],
            ["Additional notes",booking.additional_notes || booking.additionalNotes || booking.notes || "None"],
            ["Approval reason",booking.approvalReason],
        ],
    };
    downloadBookingPdf(createBookingTransactionPdf(info,v,data,reports,identity),filename);
}

export default function ManagerBookings() {
    const canManage = getSavedBookingAccess("manager") === "full";
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [branchName, setBranchName] = useState("Assigned Branch");
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<FilterType>("All");
    const [search, setSearch] = useState("");
    const [approvalOnly, setApprovalOnly] = useState(false);
    const [toast, setToast] = useState<BookingToast | null>(null);

    function showBookingToast(kind: BookingToast["kind"], title: string, description: string) {
        setToast(previous => ({
            id: (previous?.id ?? 0) + 1,
            kind,
            title,
            description,
        }));
    }

    // Retain the existing call sites, but present handled API errors in a
    // dismissible bottom-right toast instead of a full-width page banner.
    function setBookingActionError(message: string) {
        if (!message) {
            setToast(null);
            return;
        }
        const shortage = /insufficient.*(sales\s+)?inventory|not enough (sales\s+)?stock/i.test(message);
        showBookingToast("error", shortage ? "Insufficient consumable items" : "Booking action unsuccessful",
            shortage
                ? "Not enough stock for this booking's consumables. Check stock, then try again."
                : message);
    }

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => {
            setToast(current => current?.id === toast.id ? null : current);
        }, toast.kind === "error" ? 9000 : 5500);
        return () => window.clearTimeout(timer);
    }, [toast]);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [bookingType, setBookingType] = useState("All");
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [bookingsReady, setBookingsReady] = useState(false);
    const [priceModal, setPriceModal] = useState<Booking | null>(null);
    // Rental Return & Final Settlement dialog (opened from "Settle Deposit / Charges").
    const [settlementBooking, setSettlementBooking] = useState<Booking | null>(null);
    // Intentionally in-memory: a fresh page session requires renewed terms review.
    // This is UI sequencing, not a persisted backend approval entitlement.
    const [reviewedBookingIds, setReviewedBookingIds] = useState<number[]>([]);
    const requiresTermsReview = (booking: Booking) => {
        const type = getManagerBookingTypeLabel(booking);
        return type === "Custom" || type === "Rental" ||
            (type === "Package" && Number(booking.rentalItemCount || 0) > 0);
    };
    const [approvalModal, setApprovalModal] = useState<Booking | null>(null);
    const [approvalSaving, setApprovalSaving] = useState(false);
    const [approvalError, setApprovalError] = useState("");
    const [paymentModal, setPaymentModal] = useState<Booking | null>(null);
    const [paymentSaving, setPaymentSaving] = useState(false);
    const [paymentError, setPaymentError] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [cancelModal, setCancelModal] = useState<Booking | null>(null);
    const [cancelItems, setCancelItems] = useState<BookingInventoryItem[]>([]);
    const [cancelUsedQty, setCancelUsedQty] = useState<Record<number, number>>({});
    const [cancelLoading, setCancelLoading] = useState(false);
    const [cancelSubmitting, setCancelSubmitting] = useState(false);
    const [cancelError, setCancelError] = useState("");
    const [closureImpact, setClosureImpact] = useState<BookingClosureImpact | null>(null);

    function getToken() {
        return sessionStorage.getItem("token");
    }

    function getBranchId() {
        return (
            sessionStorage.getItem("branch_id") ||
            sessionStorage.getItem("stocknbook_branch_id") ||
            sessionStorage.getItem("manager_branch_id")
        );
    }

    function getStoreId() {
        return (
            sessionStorage.getItem("store_id") ||
            sessionStorage.getItem("stocknbook_store_id")
        );
    }

    function getSavedBranchName() {
        return (
            sessionStorage.getItem("branch_name") ||
            sessionStorage.getItem("stocknbook_branch_name") ||
            "Assigned Branch"
        );
    }

    function normalizeStatus(status?: string) {
        const value = String(status || "").trim().toLowerCase();

        if (!value || value === "pending" || value === "pending review") {
            return "Pending Review";
        }

        if (
            value === "approved" ||
            value === "awaiting down payment" ||
            value === "waiting down payment" ||
            value === "awaiting payment" ||
            value === "down payment required"
        ) {
            return "Awaiting Down Payment";
        }

        if (value === "confirmed") return "Confirmed";
        if (value === "preparing") return "Preparing";
        if (value === "released") return "Released";
        if (value === "completed") return "Completed";
        if (value === "cancelled" || value === "canceled") return "Cancelled";

        return status || "Pending Review";
    }

    function updateLocalBooking(id: number, updates: Partial<Booking>) {
        setBookings((prev) =>
            prev.map((booking) =>
                booking.id === id
                    ? normalizeBooking(
                        {
                            ...booking,
                            ...updates,
                        },
                        branchName
                    )
                    : booking
            )
        );
    }

    async function loadBookings(): Promise<Booking[]> {
        setLoading(true);
        setBookingsReady(false);

        const token = getToken();
        const storeId = getStoreId();
        const branchId = getBranchId();
        const savedBranchName = getSavedBranchName();

        setBranchName(savedBranchName);

        if (!token || !storeId || !branchId) {
            setBookings([]);
            setLoading(false);
            return [];
        }

        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_booking_page_bookings",
                    store_id: Number(storeId),
                    branch_id: Number(branchId),
                    role: "manager",
                }),
                cache: "no-store",
            });

            // A failed API can return an empty body or non-JSON response.
            // Keep the actual status/error visible rather than logging only {}.
            const rawResponse = await res.text();
            let data: Record<string, unknown> = {};
            try {
                data = rawResponse ? JSON.parse(rawResponse) as Record<string, unknown> : {};
            } catch {
                data = {error: rawResponse.slice(0, 250) || 'Invalid response from Bookings API.'};
            }

            if (!res.ok || data.success === false || !Array.isArray(data.bookings)) {
                const message = typeof data.error === 'string' && data.error.trim()
                    ? data.error
                    : `Couldn't load bookings (error ${res.status}). Try again.`;
                console.error('Bookings load failed:', {status: res.status, message, details: data});
                setBookingActionError(message);
                setBookings([]);
                return [];
            }

            const normalizedBookings = data.bookings.map(
                (booking: Record<string, unknown>) =>
                    normalizeBooking(booking, savedBranchName)
            );

            setBookings(normalizedBookings);
            setBookingsReady(true);
            return normalizedBookings;

        } catch (err) {
            console.error("Bookings load failed:", err);
            setBookings([]);
            return [];
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadBookings();
    }, []);


    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    async function updateStatus(
        id: number,
        newStatus: string,
        price?: number,
        usedItems?: CancelUsedItem[],
        noDpReason?: string,
        cancelReason?: string,
        refund?: CancelRefund
    ): Promise<boolean> {

        const token = getToken();
        const branchId = getBranchId();

        const booking = bookings.find((b) => b.id === id);
        if (!booking) return false;

        const cleanStatus = normalizeStatus(newStatus);
        const oldStatus = normalizeStatus(booking.status);
        if (oldStatus === "Pending Review" &&
            ["Awaiting Down Payment", "Confirmed"].includes(cleanStatus) &&
            requiresTermsReview(booking) && !reviewedBookingIds.includes(id)) {
            setBookingActionError("Set the price and payment terms first.");
            return false;
        }
        if (!["Cancelled","Rejected"].includes(cleanStatus) &&
            !(oldStatus === "Pending Review" && cleanStatus === "Awaiting Down Payment") &&
            !(oldStatus === "Pending Review" && cleanStatus === "Confirmed" &&
                getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10) &&
            !(oldStatus === "Awaiting Down Payment" && cleanStatus === "Confirmed")) {
            setBookingActionError("Staff handles preparation and hand over.");
            return false;
        }
        if (cleanStatus === "Confirmed" && !(oldStatus === "Pending Review" && getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10)) {
            const needed = getRequiredDownPayment(booking) > 0 ? getRequiredDownPayment(booking) : getTotalPrice(booking);
            if (getTotalPrice(booking) <= 0 || getAmountPaid(booking) + 0.005 < needed) {
                setBookingActionError("Record the down payment before confirming.");
                return false;
            }
        }

        // Reject is pre-approval only; cancellation is post-approval and pre-release only.
        if (["Cancelled","Rejected"].includes(cleanStatus)) {
            const currentStatus = normalizeStatus(booking.status);
            if (cleanStatus==="Rejected" && currentStatus!=="Pending Review") {
                setBookingActionError("Only pending, unapproved requests can be rejected.");return false;
            }
            if (cleanStatus==="Cancelled" && !["Awaiting Down Payment","Confirmed","Preparing"].includes(currentStatus)) {
                setBookingActionError("A booking can be cancelled only after approval and before hand over.");return false;
            }
        } else {
            const { nextStatus } = getNextStatusConfig(
                normalizeStatus(booking.status),
                getTotalPrice(booking) > 0 && getAmountPaid(booking) + 0.005 >=
                (getRequiredDownPayment(booking) > 0 ? getRequiredDownPayment(booking) : getTotalPrice(booking))
            );

            if (cleanStatus !== nextStatus && !(oldStatus==="Pending Review" && cleanStatus==="Confirmed" &&
                getRequiredDownPayment(booking)===0 && (noDpReason||"").trim().length>=10)) {
                console.warn(`Cannot jump to ${cleanStatus}. Next valid status is ${nextStatus}`);
                return false;
            }
        }

        const isManagerApproval = normalizeStatus(booking.status) === "Pending Review"
            && cleanStatus === "Awaiting Down Payment" && getRequiredDownPayment(booking) > 0;

        try {
            const body: Record<string, unknown> = {
                action: "update_status",
                booking_id: id,
                status: cleanStatus,
            };

            if (branchId) body.branch_id = Number(branchId);
            if (price !== undefined) body.agreed_price = price;
            if (usedItems) body.used_items = usedItems;
            if (noDpReason) body.noDpReason = noDpReason;
            if (cleanStatus === "Cancelled") {
                body.cancel_reason = (cancelReason || "").trim();
                body.impact_acknowledged = true;
                body.booking_refund_amount = refund?.amount ?? 0;
                body.refund_method = refund?.method || "cash";
                body.refund_verified = refund?.verified === true;
            }
            if (cleanStatus === "Rejected") body.rejection_reason = (cancelReason || "").trim();

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                throw new Error(data.message || data.error || "Failed to update booking status.");
            }

            setBookingActionError("");
            updateLocalBooking(id, {
                status: cleanStatus,
                approvalStatus: ["Awaiting Down Payment","Confirmed"].includes(cleanStatus) && booking.approvalStatus === "pending" ? "approved" : booking.approvalStatus,
            });
            const refundNote = cleanStatus === "Cancelled" && (Number(data.booking_refunded) > 0 || Number(data.deposit_refunded) > 0)
                ? ` Refunded ${peso(Number(data.booking_refunded) || 0)} of the booking payment` +
                `${Number(data.deposit_refunded) > 0 ? ` and the ${peso(Number(data.deposit_refunded))} security deposit` : ""}.`
                : "";
            showBookingToast("success", isManagerApproval ? "Booking approved successfully" : "Booking status updated successfully",
                `${booking.bookingReference || `Booking #${id}`} is now ${getManagerBookingStatusLabel(cleanStatus)}.${refundNote}`);
            return true;
        } catch (err) {
            // Expected API/business-rule failures are already shown in the page alert.
            // Do not log them through console.error: Next.js dev overlay can obscure the UI.
            // Inventory validation and the booking's current status stay unchanged.
            setBookingActionError(err instanceof Error ? err.message : "Booking action failed.");
            return false;
        }
    }

    async function openCancelModal(booking: Booking) {
        const token=getToken();const branchId=getBranchId();
        setCancelModal(booking);setCancelItems([]);setCancelUsedQty({});
        setClosureImpact(null);setCancelError("");setCancelLoading(true);
        try {
            if(!token||!branchId)throw new Error("Booking session or branch is missing.");
            const headers={"Content-Type":"application/json",Authorization:`Bearer ${token}`};
            const payload=(action:string)=>JSON.stringify({action,booking_id:booking.id,branch_id:Number(branchId)});
            const [impactResponse,itemsResponse]=await Promise.all([
                fetch('/api/bookings',{method:'POST',headers,body:payload('get_booking_closure_impact')}),
                fetch('/api/bookings',{method:'POST',headers,body:payload('get_booking_items')})
            ]);
            const [impactData,itemsData]=await Promise.all([impactResponse.json(),itemsResponse.json()]);
            if(!impactResponse.ok||impactData.success===false||!impactData.impact)
                throw new Error(impactData.error||impactData.message||'Could not review cancellation impact.');
            if(!itemsResponse.ok||itemsData.success===false)
                throw new Error(itemsData.error||itemsData.message||'Could not review inventory items.');
            setClosureImpact(impactData.impact as BookingClosureImpact);
            const items:BookingInventoryItem[]=Array.isArray(itemsData.items)?itemsData.items:[];
            setCancelItems(items);
            setCancelUsedQty(Object.fromEntries(items.map(item=>[Number(item.id),Number(item.used_quantity||0)])));
        } catch(err) {
            setCancelError(err instanceof Error?err.message:'Could not review closure.');
        } finally {setCancelLoading(false);}
    }

    async function confirmCancelBooking(reason: string, refund?: CancelRefund) {
        if (!cancelModal) return;

        setCancelSubmitting(true);
        setCancelError("");

        try {
            const usedItems: CancelUsedItem[] = cancelItems.map((item) => {
                const itemId = Number(item.id);
                const reservedQty = Number(item.reserved_quantity || 0);
                const usedQty = Math.max(
                    0,
                    Math.min(Number(cancelUsedQty[itemId] || 0), reservedQty)
                );

                return {
                    booking_item_id: itemId,
                    used_quantity: usedQty,
                };
            });

            if(!closureImpact)throw new Error('Closure impact has not been reviewed.');
            const rejecting=normalizeStatus(cancelModal.status)==='Pending Review';
            const updated = await updateStatus(cancelModal.id, rejecting?'Rejected':'Cancelled',
                undefined, rejecting?undefined:usedItems, undefined, reason, rejecting?undefined:refund);
            if (!updated) throw new Error("Booking cancellation was not completed.");

            setCancelModal(null);
            setCancelItems([]);
            setCancelUsedQty({});
            setClosureImpact(null);
            await loadBookings();
        } catch (err) {
            console.error("Failed to cancel booking:", err);
            setCancelError(err instanceof Error ? err.message : "Couldn't cancel the booking. Check the quantities and try again.");
        } finally {
            setCancelSubmitting(false);
        }
    }

    async function updateCustomPaymentTerms(
        booking: Booking,
        agreedPrice: number,
        requiredDownPayment: number,
        refundableDeposit: number,
        depositWaiverReason: string,
        customConsumablesAgreed?: number,
        pricingAdjustmentReason?: string
    ) {
        const latest = bookings.find(b => b.id === booking.id) ?? booking;
        if (normalizeStatus(latest.status) !== "Pending Review" || latest.approvalStatus === "approved") {
            throw new Error("Price and payment terms can't be changed after approval.");
        }
        const token = getToken();
        const branchId = getBranchId();

        try {
            const body: Record<string, unknown> = {
                action: "update_price",
                booking_id: booking.id,
                agreed_price: agreedPrice,
                required_down_payment: requiredDownPayment,
                // Requires the backend update_price action to persist this value atomically
                // for the selected booking; it must not overwrite the branch-wide policy.
                refundable_deposit: refundableDeposit,
                depositWaiverReason,
                ...(customConsumablesAgreed !== undefined
                    ? {custom_consumables_agreed: customConsumablesAgreed} : {}),
                ...(pricingAdjustmentReason ? {pricing_adjustment_reason: pricingAdjustmentReason} : {}),
            };

            if (branchId) body.branch_id = Number(branchId);

            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || data.success === false || data.error) {
                throw new Error(
                    data.message ||
                    data.error ||
                    "Failed to update custom payment terms."
                );
            }

            // Do not claim success when an older API silently ignores refundable_deposit.
            // The statement reads the persisted booking deposit independently of the quote.
            const verificationResponse = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: "get_booking_financial_statement", booking_id: booking.id,
                    ...(branchId ? { branch_id: Number(branchId) } : {}) }),
            });
            const verification = await verificationResponse.json();
            const savedDeposit = verification.statement?.depositRequired;
            if (!verificationResponse.ok || verification.error || savedDeposit == null ||
                !Number.isFinite(Number(savedDeposit)) || Math.abs(Number(savedDeposit) - refundableDeposit) > 0.005) {
                throw new Error("The security deposit didn't save. Refresh the page and check the terms before approving.");
            }

            const currentPaid = getAmountPaid(booking);
            const newBalance = Math.max(agreedPrice - currentPaid, 0);

            const newPaymentStatus =
                currentPaid >= agreedPrice
                    ? "Fully Paid"
                    : requiredDownPayment > 0 && currentPaid >= requiredDownPayment
                        ? "Down Payment Paid"
                        : currentPaid > 0
                            ? "Partial"
                            : requiredDownPayment === 0 ? "Unpaid" : "Down Payment Required";

            updateLocalBooking(booking.id, {
                agreed_price: agreedPrice,
                agreedPrice: agreedPrice,
                required_down_payment: requiredDownPayment,
                requiredDownPayment: requiredDownPayment,
                refundable_deposit: refundableDeposit,
                refundableDeposit: refundableDeposit,
                balance: newBalance,
                payment_status: newPaymentStatus,
                paymentStatus: newPaymentStatus,
            });
            showBookingToast("success", "Payment terms saved successfully",
                `${booking.bookingReference || `Booking #${booking.id}`} was updated.`);
        } catch (err) {
            console.error("Failed to update custom payment terms:", err);
            setBookingActionError(err instanceof Error ? err.message : "Could not save payment terms.");
            throw err;
        }
    }

    async function handlePriceConfirm(
        agreedPrice: number,
        requiredDownPayment: number,
        refundableDeposit: number,
        depositWaiverReason: string,
        customConsumablesAgreed?: number,
        pricingAdjustmentReason?: string
    ) {
        if (!priceModal) return;
        // Let PriceModal show any API/persistence error without closing the editor.
        await updateCustomPaymentTerms(priceModal, agreedPrice, requiredDownPayment, refundableDeposit, depositWaiverReason, customConsumablesAgreed, pricingAdjustmentReason);
        // Mark reviewed only after both the save API and deposit read-back succeed.
        setReviewedBookingIds(ids => ids.includes(priceModal.id) ? ids : [...ids, priceModal.id]);
        setPriceModal(null);
    }

    // Save the verified booking payment and refundable deposit in one server-side
    // transaction. They remain separate ledgers: a deposit is NOT booking revenue.
    async function saveRecordedPayment(bookingReceivedNow: number, depositReceivedNow: number,
                                       expectedDepositCollected: number) {
        if (!paymentModal || paymentSaving) return;
        const booking = bookings.find(item => item.id === paymentModal.id) ?? paymentModal;
        const total = getTotalPrice(booking);
        const currentPaid = getAmountPaid(booking);
        const remainingCents = Math.max(0, Math.round((total - currentPaid) * 100));
        const bookingCents = Math.round(bookingReceivedNow * 100);
        const depositCents = Math.round(depositReceivedNow * 100);
        if (![bookingReceivedNow, depositReceivedNow, expectedDepositCollected].every(Number.isFinite) ||
            bookingCents < 0 || depositCents < 0 || bookingCents + depositCents <= 0 ||
            bookingCents > remainingCents ||
            Math.abs(bookingReceivedNow * 100 - bookingCents) > 0.001 ||
            Math.abs(depositReceivedNow * 100 - depositCents) > 0.001) {
            setPaymentError("Enter valid amounts (up to 2 decimal places).");
            return;
        }
        const token = getToken();
        if (!token) { setPaymentError("Please sign in again before recording payment."); return; }
        setPaymentSaving(true);
        setPaymentError("");
        try {
            const body: Record<string, unknown> = {
                action: "record_booking_customer_payment_with_deposit",
                booking_id: booking.id,
                bookingPayment: bookingReceivedNow,
                depositPayment: depositReceivedNow,
                expectedBookingPaid: currentPaid,
                expectedDepositCollected,
                requestKey: `BOOKPAY-${booking.id}-${crypto.randomUUID()}`,
            };
            const branchId = getBranchId();
            if (branchId) body.branch_id = Number(branchId);
            const response = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok || result.success === false || result.error) {
                throw new Error(result.error || result.message || "Failed to record customer payment.");
            }
            updateLocalBooking(booking.id, {
                amount_paid: result.amountPaid, amountPaid: result.amountPaid,
                ...(result.bookingStatus ? {status:result.bookingStatus} : {}),
                balance: result.balance, payment_status: result.paymentStatus,
                paymentStatus: result.paymentStatus,
                // Refresh the deposit balance immediately, even for deposit-only receipts.
                securityDepositCollected: result.depositCollected,
            });
            setPaymentModal(null);
            setBookingActionError("");
            // The server transaction is already committed. A refresh failure
            // must not incorrectly tell the Manager that the payment failed.
            try { await loadBookings(); }
            catch (refreshError) { console.error("Payment saved, but booking list refresh failed:", refreshError); }
            if (result.confirmed) {
                showBookingToast("success", "Payment verified — booking confirmed and reserved",
                    `${peso(bookingReceivedNow)} booking payment and ${peso(depositReceivedNow)} security deposit recorded. The items are now reserved.`);
            } else if (result.reservationIssue) {
                showBookingToast("error", "Payment saved — reservation needs attention",
                    `Payment recorded, but the items couldn't be reserved: ${result.reservationIssue}`);
            } else {
                showBookingToast("success", "Customer payment recorded successfully",
                    `${peso(bookingReceivedNow)} booking payment and ${peso(depositReceivedNow)} security deposit recorded. The booking is still waiting for the full down payment.`);
            }
        } catch (error) {
            setPaymentError(error instanceof Error ? error.message : "Unable to record payment.");
        } finally {
            setPaymentSaving(false);
        }
    }

    const filtered = useMemo(() => {
        return bookings
            .filter((booking) => !approvalOnly || (booking.approvalStatus === "pending" && booking.status === "Pending Review"))
            .filter((booking) => filter === "All" || booking.status === filter)
            .filter((booking) => bookingType === "All" || getBookingTypeDisplay(booking) === bookingType)
            .filter((booking) => !dateFrom || dateKey(booking.date) >= dateFrom)
            .filter((booking) => !dateTo || dateKey(booking.date) <= dateTo)
            .filter((booking) => {
                if (!search) return true;

                const query = search.toLowerCase();

                return (
                    booking.name.toLowerCase().includes(query) ||
                    booking.bookingReference?.toLowerCase().includes(query) ||
                    booking.phone?.includes(query) ||
                    booking.facebookName?.toLowerCase().includes(query) ||
                    getBranchGroupName(booking).toLowerCase().includes(query) ||
                    booking.customOrder?.toLowerCase().includes(query) ||
                    booking.custom_order?.toLowerCase().includes(query) ||
                    booking.package?.toLowerCase().includes(query) ||
                    booking.packageName?.toLowerCase().includes(query) ||
                    booking.package_name?.toLowerCase().includes(query) ||
                    booking.eventType?.toLowerCase().includes(query) ||
                    booking.event_type?.toLowerCase().includes(query) ||
                    booking.theme?.toLowerCase().includes(query) ||
                    booking.venue?.toLowerCase().includes(query)
                );
            });
    }, [bookings, filter, dateFrom, dateTo, bookingType, search, approvalOnly]);

    const counts = TABS.reduce((acc, tab) => {
        acc[tab] =
            tab === "All"
                ? bookings.length
                : bookings.filter((booking) => booking.status === tab).length;

        return acc;
    }, {} as Record<string, number>);

    const bookingTypes = ["Package", "Custom"] as const;

    function bookingExportContext(): ManagerBookingExportContext {
        const branchId = Number(getBranchId());
        if (!(branchId > 0) || !getToken()) throw new Error("A valid manager session and assigned branch are required.");
        const storeName = [
            sessionStorage.getItem("store_name"), sessionStorage.getItem("stocknbook_store_name"),
            sessionStorage.getItem("business_name"), sessionStorage.getItem("storeName"),
        ].find(value=>Boolean(value?.trim())) || `Store ${getStoreId() || "Not available"}`;
        const actualBranch = bookings.find(b=>Number(b.branchId ?? b.branch_id)===branchId && b.branchName && b.branchName!=="Assigned Branch")?.branchName;
        return { storeName, branchName: actualBranch || branchName, branchId, exportedAt: new Date() };
    }

    async function exportBookings() {
        if (exporting || loading || !bookingsReady) return;
        setExporting(true);
        try {
            // The report contains the entire assigned-branch list, not just the visible filters.
            await downloadManagerBookingsPdf(bookings, bookingExportContext());
            showBookingToast("success", "Booking report downloaded", `${bookings.length} booking(s) exported as PDF.`);
        } catch (err) {
            setBookingActionError(err instanceof Error ? err.message : "Unable to download booking report.");
        } finally {
            setExporting(false);
        }
    }

    async function exportSelectedBooking(booking: Booking, kind: BookingPdfKind) {
        if (exporting || loading || !bookingsReady) return;
        setExporting(true);
        try {
            await downloadSelectedBookingPdf(booking, kind, bookingExportContext());
            showBookingToast("success", kind === "billing" ? "Billing downloaded" : "Booking transaction downloaded",
                "The PDF was downloaded.");
        } catch (err) {
            setBookingActionError(err instanceof Error ? err.message : "Unable to export booking details.");
        } finally {
            setExporting(false);
        }
    }
    function clearFilters() {
        setSearch(""); setFilter("All"); setApprovalOnly(false);
        setBookingType("All"); setDateFrom(""); setDateTo("");
    }

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <h1 className="text-[25px] font-bold text-[#1A1220]">
                            Bookings
                        </h1>

                        <span
                            title={branchName}
                            className="max-w-[220px] truncate rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]"
                        >
                            {branchName}
                        </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            onClick={() => void loadBookings()}
                            disabled={loading}
                            aria-label="Refresh bookings"
                            title="Refresh bookings"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            type="button"
                        >
                            <RefreshCw
                                size={16}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-4 py-4 sm:px-6">
                {/* Booking overview: operational counts from the current branch, not demo numbers. */}
                <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {([
                        { key: "all", title: "Total Bookings", count: bookings.length, sub: "All recorded bookings", icon: <CalendarDays size={23}/>, tone: "bg-[#F3EBFF] text-[#6C3AD6]" },
                        { key: "confirmed", title: "Confirmed Bookings", count: counts["Confirmed"], sub: "Reserved and ready", icon: <BadgeCheck size={23}/>, tone: "bg-[#EAF7F0] text-[#25865B]" },
                        { key: "actions", title: "Pending Actions", count: counts["Pending Review"] + counts["Awaiting Down Payment"] + counts["Pending Settlement"], sub: "For review or payment", icon: <Hourglass size={23}/>, tone: "bg-[#FFF7E9] text-[#B7832E]" },
                        { key: "month", title: "This Month’s Bookings", count: bookings.filter(b => {
                                const today = currentDateTime ?? new Date();
                                return dateKey(b.date).slice(0,7) === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
                            }).length, sub: (currentDateTime ?? new Date()).toLocaleDateString("en-US", {month:"long",year:"numeric"}), icon: <CalendarDays size={23}/>, tone: "bg-[#F3EBFF] text-[#6C3AD6]" },
                    ] as const).map(metric => (
                        <button key={metric.key} type="button"
                                onClick={() => {setFilter(metric.key === "confirmed" ? "Confirmed" : "All");setApprovalOnly(false);}}
                                title={metric.key === "actions" || metric.key === "month" ? "Show all bookings; use Filters to narrow results" : `Filter: ${metric.title}`}
                                className="flex min-h-[108px] w-full items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-[#B6A1D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]">
                            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${metric.tone}`}>{metric.icon}</span>
                            <span className="min-w-0">
                                <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{metric.title}</span>
                                <span className="mt-1 block text-[24px] font-bold leading-none text-[#25153D]">{metric.count}</span>
                                <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{metric.sub}</span>
                            </span>
                        </button>
                    ))}
                </div>

                {loading && bookings.length === 0 ? <ModuleSkeleton variant="bookings" /> :
                    <BookingWorkspace
                        bookings={filtered} canManage={canManage} managerView
                        listToolbar={<div className="space-y-3 pb-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-[17px] font-bold text-[#25143F]">All Bookings</h2>
                                </div>
                                <button type="button" aria-label="Download all bookings report PDF" title="Download all bookings report PDF"
                                        disabled={loading || exporting || !bookingsReady} onClick={()=>void exportBookings()}
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#D9C9EB] text-[#43217A] hover:bg-[#F3EEFF] disabled:cursor-not-allowed disabled:opacity-50">
                                    <Download size={17}/>
                                </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <label className="relative min-w-[200px] flex-1">
                                    <span className="sr-only">Search bookings</span>
                                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#957CAB]"/>
                                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by customer, reference, or event" className="h-10 w-full rounded-xl border border-[#E4D9EF] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#7648DC] focus:ring-2 focus:ring-[#7648DC]/10" />
                                </label>
                                <button type="button" aria-expanded={showAdvancedFilters} aria-controls="manager-booking-filters" onClick={() => setShowAdvancedFilters(v => !v)}
                                        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#DCCFEB] bg-white px-3 text-xs font-semibold text-[#43217A] hover:bg-[#F7F2FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7648DC]">
                                    {showAdvancedFilters ? "Hide filters" : "Filters"}
                                    {(filter !== "All" || bookingType !== "All" || dateFrom || dateTo || approvalOnly) && <span className="rounded-full bg-[#EFE8FB] px-2 py-0.5 text-[10px]">Active</span>}
                                </button>
                            </div>
                            {filter !== "All" && <p className="text-xs text-[#655478]">Status: {getManagerBookingStatusLabel(filter)}</p>}
                            {showAdvancedFilters && <div id="manager-booking-filters" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-4">
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Booking Type
                                    <select value={bookingType} onChange={e=>setBookingType(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]">
                                        <option value="All">All Types</option>{bookingTypes.map(t=><option key={t} value={t}>{t}</option>)}
                                    </select>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Status
                                    <select value={filter} onChange={e=>{setFilter(e.target.value as FilterType);setApprovalOnly(false);}} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]">
                                        {TABS.map(t=><option key={t} value={t}>{t === "All" ? "All Statuses" : getManagerBookingStatusLabel(t)}</option>)}
                                    </select>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Date From
                                    <input aria-label="Booking date from" type="date" value={dateFrom} max={dateTo || undefined} onChange={e=>setDateFrom(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]"/>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Date To
                                    <input aria-label="Booking date to" type="date" value={dateTo} min={dateFrom || undefined} onChange={e=>setDateTo(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]"/>
                                </label>
                            </div>}
                            {(search || filter !== "All" || approvalOnly || bookingType !== "All" || dateFrom || dateTo) && <div className="flex justify-end"><button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#6335BC] hover:underline">Clear filters</button></div>}
                        </div>}
                        onExportSelected={(booking,kind)=>void exportSelectedBooking(booking,kind)}
                        exportDisabled={exporting || loading || !bookingsReady}
                        reviewedBookingIds={reviewedBookingIds}
                        onUpdateStatus={canManage ? (id, status, price) => {
                            const booking = bookings.find(item => item.id === id);
                            if (status === "Awaiting Down Payment" && booking && normalizeStatus(booking.status) === "Pending Review") {
                                setApprovalError("");
                                setApprovalModal(booking);
                                return;
                            }
                            void updateStatus(id, status, price);
                        } : undefined}
                        onSetPrice={canManage ? b => {
                            if (getManagerBookingTypeLabel(b) === "Package" && Number(b.rentalItemCount || 0) === 0) {
                                setBookingActionError("The package sets the price.");
                                return;
                            }
                            if (normalizeStatus(b.status) !== "Pending Review" || b.approvalStatus === "approved") {
                                setBookingActionError("Price and down payment can't be changed after approval.");
                                return;
                            }
                            // Reopening terms requires saving them again before approval.
                            setReviewedBookingIds(ids => ids.filter(id => id !== b.id));
                            setPriceModal(b);
                        } : undefined}
                        onRecordDownPayment={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onMarkFullyPaid={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onCancelBooking={canManage ? openCancelModal : undefined}
                        onSettleDeposit={canManage ? b => setSettlementBooking(b) : undefined}
                    />}
            </section>

            {approvalModal && canManage && <ApproveBookingModal
                booking={bookings.find(b => b.id === approvalModal.id) ?? approvalModal}
                busy={approvalSaving}
                error={approvalError}
                onClose={() => { if (!approvalSaving) { setApprovalModal(null); setApprovalError(""); } }}
                onApprove={async (noDpReason) => {
                    setApprovalSaving(true);
                    setApprovalError("");
                    try {
                        const chosen=bookings.find(b=>b.id===approvalModal.id)??approvalModal;
                        const noDp=getRequiredDownPayment(chosen)===0;
                        const ok = await updateStatus(approvalModal.id, noDp?"Confirmed":"Awaiting Down Payment",
                            undefined,undefined,noDp?noDpReason:undefined);
                        if (ok) setApprovalModal(null);
                        else setApprovalError("Couldn't approve the booking. Try again.");
                    } finally { setApprovalSaving(false); }
                }}
            />}

            {settlementBooking && canManage && <RentalReturnSettlementDialog
                booking={settlementBooking}
                onClose={() => setSettlementBooking(null)}
                onSaved={async (completed, message) => {
                    setSettlementBooking(null);
                    // The settlement is already saved; a refresh failure must not trigger a retry.
                    try { await loadBookings(); } catch { /* already committed */ }
                    showBookingToast("success", completed ? "Booking settled and completed" : "Settlement recorded", message);
                }}
            />}

            {paymentModal && canManage && <RecordPaymentModal
                booking={bookings.find(b=>b.id === paymentModal.id) ?? paymentModal}
                busy={paymentSaving} error={paymentError}
                onClose={() => {if(!paymentSaving){setPaymentModal(null);setPaymentError("");}}}
                onSave={saveRecordedPayment}
            />}

            {priceModal && canManage && normalizeStatus((bookings.find(b => b.id === priceModal.id) ?? priceModal).status) === "Pending Review" && (
                <PriceModal
                    booking={priceModal}
                    onConfirm={handlePriceConfirm}
                    onClose={() => setPriceModal(null)}
                />
            )}
            {cancelModal && canManage && (
                <CancelInventoryModal
                    booking={cancelModal}
                    impact={closureImpact}
                    items={cancelItems}
                    usedQty={cancelUsedQty}
                    loading={cancelLoading}
                    submitting={cancelSubmitting}
                    error={cancelError}
                    onChangeUsedQty={(itemId, value) =>
                        setCancelUsedQty((prev) => ({
                            ...prev,
                            [itemId]: value,
                        }))
                    }
                    onClose={() => {
                        if (cancelSubmitting) return;
                        setCancelModal(null);
                        setCancelItems([]);
                        setCancelUsedQty({});
                        setClosureImpact(null);
                        setCancelError("");
                    }}
                    onConfirm={confirmCancelBooking}
                />
            )}

            {/* Matches the staff attendance success toast: bottom-right, dismissible,
                and automatically hidden. No changes to booking rules or API payloads. */}
            {toast && (
                <div
                    key={toast.id}
                    role={toast.kind === "error" ? "alert" : "status"}
                    aria-live={toast.kind === "error" ? "assertive" : "polite"}
                    className={`fixed bottom-5 right-5 z-[250] flex w-[400px] max-w-[calc(100vw-2.5rem)] items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_12px_32px_rgba(38,21,63,0.14)] ${
                        toast.kind === "success" ? "border-[#BAE8CC]" : "border-[#F6C9CE]"
                    }`}
                >
                    <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        toast.kind === "success" ? "bg-[#EAF9EF] text-[#119047]" : "bg-[#FFF0F1] text-[#D43C53]"
                    }`}>
                        {toast.kind === "success" ? <CheckCircle2 size={22}/> : <AlertCircle size={22}/>}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold leading-5 text-[#231834]">{toast.title}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-[#7B6A8A]">{toast.description}</p>
                    </div>
                    <button
                        type="button"
                        aria-label="Dismiss notification"
                        onClick={() => setToast(null)}
                        className="-mr-1 -mt-1 rounded-lg p-1.5 text-[#897899] hover:bg-[#F6F1FA] hover:text-[#352044] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6C3AD6]"
                    >
                        <X size={17}/>
                    </button>
                </div>
            )}
        </>
    );
}
// Keep the existing manager approval confirmation, without any deadline requirement.
function ApproveBookingModal({booking, busy, error, onClose, onApprove}: {
    booking: Booking;
    busy: boolean;
    error: string;
    onClose: () => void;
    onApprove: (noDpReason?:string) => Promise<void>;
}) {
    const [agreed, setAgreed] = useState(false);
    const [validation, setValidation] = useState("");
    const [depositRequired, setDepositRequired] = useState<number | null>(null);
    const [depositError, setDepositError] = useState("");
    const [hasRental, setHasRental] = useState<boolean | null>(null);
    const [noDpReason, setNoDpReason] = useState("");
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Login required.");
                const response = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_booking_financial_statement", booking_id: booking.id,
                        branch_id: Number(booking.branchId || booking.branch_id) || undefined }),
                });
                const itemsResponse = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_booking_items", booking_id: booking.id,
                        branch_id: Number(booking.branchId || booking.branch_id) || undefined }),
                });
                const [data, itemsData] = await Promise.all([response.json(), itemsResponse.json()]);
                const deposit = Number(data.statement?.depositRequired);
                if (!response.ok || data.error || data.statement?.depositRequired == null || !Number.isFinite(deposit) ||
                    !itemsResponse.ok || itemsData.error ||
                    !Array.isArray(itemsData.rentalItems) || !Array.isArray(data.statement?.rentalItems))
                    throw new Error(data.error || itemsData.error || "Security deposit or rental items are unavailable.");
                if (!cancelled) {
                    setDepositRequired(Math.max(0, deposit));
                    setHasRental(itemsData.rentalItems.length > 0 || data.statement.rentalItems.length > 0);

                }
            } catch (error) {
                if (!cancelled) setDepositError(error instanceof Error ? error.message : "Unable to read deposit terms.");
            }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id]);
    function submit() {
        if (depositRequired === null) {
            setValidation("Wait for the security deposit to load.");
            return;
        }
        if (hasRental === null) {
            setValidation("Booking rental items must be verified first.");
            return;
        }
        if (getRequiredDownPayment(booking)===0 && noDpReason.trim().length<10){
            setValidation("Explain why no down payment is needed (at least 10 characters)."); return;
        }
        if (!agreed) {
            setValidation("Confirm the customer agreed to these terms.");
            return;
        }
        if (getTotalPrice(booking) <= 0 || getRequiredDownPayment(booking) > getTotalPrice(booking)) {
            setValidation("Set a valid price and a down payment no higher than the price.");
            return;
        }
        setValidation("");
        void onApprove(getRequiredDownPayment(booking)===0?noDpReason.trim():undefined);
    }
    return <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 px-4 py-5">
        <div role="dialog" aria-modal="true" aria-labelledby="approval-title" className="w-full max-w-md rounded-2xl border border-[#E5D8F1] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 id="approval-title" className="text-lg font-bold text-[#24163E]">Approve Booking</h2>
                    <p className="mt-1 text-xs text-[#827394]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
                </div>
                <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-[#806D91] hover:bg-[#F4EFFB]"><X size={19}/></button>
            </div>
            <div className="mt-4 space-y-2 rounded-xl border border-[#EAE0F4] bg-[#FCFAFF] p-3 text-sm">
                <div className="flex justify-between gap-3"><span>Final Agreed Price</span><strong>{peso(getTotalPrice(booking))}</strong></div>
                <div className="flex justify-between gap-3"><span>Required Down Payment</span><strong>{peso(getRequiredDownPayment(booking))}</strong></div>
                {hasRental && <div className="flex justify-between gap-3"><span>Refundable Security Deposit</span><strong>{depositRequired === null ? "Loading…" : peso(depositRequired)}</strong></div>}
                {hasRental && <p className="text-xs text-[#806A8C]">Collected before the equipment is handed over.</p>}
                {depositError && <p role="alert" className="text-xs text-red-600">{depositError}</p>}
            </div>
            {getRequiredDownPayment(booking)===0 && <label className="mt-4 block text-xs font-medium text-[#4F4162]">
                Reason for no down payment (10+ characters)
                <textarea value={noDpReason} onChange={e=>setNoDpReason(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-lg border border-[#E2D6EF] p-2" maxLength={500}/>
                <span className="mt-1 block font-normal text-[#806A8C]">With no down payment, approving confirms the booking right away. Full payment is still due before hand over.</span>
            </label>}
            <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#4F4162]">
                <input type="checkbox" checked={agreed} onChange={e=>{setAgreed(e.target.checked);setValidation("");}} disabled={busy} className="mt-1 accent-[#673DC8]"/>
                <span>The customer agreed to the price, down payment and security deposit.</span>
            </label>
            <p className="mt-3 text-xs leading-5 text-[#816E93]">{getRequiredDownPayment(booking)===0
                ? "Approving confirms the booking and reserves the items. Full payment is still due before hand over."
                : "Approving requests the down payment. Items are reserved once it's paid."} Payment terms are locked after approval.</p>
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{validation || error}</p>}
            <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-[#E2D6EF] px-4 py-2.5 text-sm font-semibold text-[#47246E]">Back</button>
                <button type="button" disabled={busy || !agreed || depositRequired === null || hasRental === null ||
                    (getRequiredDownPayment(booking)===0 && noDpReason.trim().length<10)} onClick={submit} className="rounded-xl bg-[#432078] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Approving..." : getRequiredDownPayment(booking)===0 ? "Approve & Confirm" : "Approve Booking"}</button>
            </div>
        </div>
    </div>;
}

function RecordPaymentModal({booking, busy, error, onClose, onSave}: {
    booking: Booking;
    busy: boolean;
    error: string;
    onClose: () => void;
    onSave: (bookingReceived: number, depositReceived: number, expectedDepositCollected: number) => void | Promise<void>;
}) {
    const balance = getBalance(booking);
    const paid = getAmountPaid(booking);
    const required = getRequiredDownPayment(booking);
    // This is a receipt workflow, not a second terms editor. Use calculated
    // outstanding amounts for one-click recording, with an optional override.
    const remainingDp = Math.max(0, Math.round((required - paid) * 100)) / 100;
    const [paymentChoice, setPaymentChoice] = useState<"dp" | "balance" | "none">(
        remainingDp > 0.005 ? "dp" : balance > 0.005 ? "balance" : "none"
    );
    const [includeDeposit, setIncludeDeposit] = useState(false);
    const [deposit, setDeposit] = useState<{required: number; collected: number; hasRental: boolean} | null>(null);
    const [depositLoading, setDepositLoading] = useState(true);
    const [depositError, setDepositError] = useState("");
    const [verified, setVerified] = useState(false);
    const [validation, setValidation] = useState("");

    // Fetch the actual deposit ledger: deposit balances are not reliably
    // reflected in the booking-list row after an earlier receipt.
    useEffect(() => {
        let cancelled = false;
        setDeposit(null);
        setDepositLoading(true);
        setDepositError("");
        void (async () => {
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Sign in again to view payment details.");
                const response = await fetch("/api/bookings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({action: "get_booking_financial_statement", booking_id: booking.id,
                        branch_id: Number(booking.branchId || booking.branch_id) || undefined}),
                });
                const data = await response.json();
                const statement = data.statement;
                const requiredAmount = Number(statement?.depositRequired);
                const collectedAmount = Number(statement?.depositCollected);
                if (!response.ok || data.error || statement?.depositRequired == null ||
                    statement?.depositCollected == null || !Number.isFinite(requiredAmount) ||
                    !Number.isFinite(collectedAmount) || requiredAmount < 0 || collectedAmount < 0)
                    throw new Error(data.error || "Security deposit amounts are unavailable.");
                if (!Array.isArray(statement?.rentalItems))
                    throw new Error("Couldn't load the rental items. Refresh the page.");
                if (!cancelled) setDeposit({required: requiredAmount, collected: collectedAmount,
                    hasRental: statement.rentalItems.length > 0});
            } catch (cause) {
                if (!cancelled) setDepositError(cause instanceof Error ? cause.message : "Unable to load security deposit.");
            } finally {
                if (!cancelled) setDepositLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id]);

    const cents = (amount: number) => Math.round(amount * 100);
    const bookingDueCents = Math.max(0, cents(balance));
    const depositDueCents = deposit ? Math.max(0, cents(deposit.required) - cents(deposit.collected)) : 0;
    const showRentalDeposit = !!deposit && (deposit.hasRental || deposit.required > 0.005 || deposit.collected > 0.005);
    const remainingDpCents = Math.min(bookingDueCents, Math.max(0, cents(required) - cents(paid)));
    const rawBookingReceived = paymentChoice === "dp" ? remainingDpCents / 100 :
        paymentChoice === "balance" ? bookingDueCents / 100 :
            0;
    const rawDepositReceived = includeDeposit && showRentalDeposit && depositDueCents > 0 ?
        depositDueCents / 100 : 0;
    const bookingReceived = rawBookingReceived;
    const depositReceived = rawDepositReceived;
    const bookingReceivedCents = Number.isFinite(bookingReceived) ? cents(bookingReceived) : NaN;
    const depositReceivedCents = Number.isFinite(depositReceived) ? cents(depositReceived) : NaN;
    const totalReceived = (bookingReceivedCents + depositReceivedCents) / 100;
    const remainingAfter = Math.max(0, bookingDueCents - (Number.isFinite(bookingReceivedCents) ? bookingReceivedCents : 0)) / 100;
    const depositAfter = Math.max(0, depositDueCents - (Number.isFinite(depositReceivedCents) ? depositReceivedCents : 0)) / 100;
    const entryValid = (value: number, limitCents: number) => Number.isFinite(value) && value >= 0 &&
        cents(value) <= limitCents && Math.abs(value * 100 - cents(value)) <= 0.001;
    const amountValid = entryValid(bookingReceived, bookingDueCents) && entryValid(depositReceived, depositDueCents) &&
        bookingReceivedCents + depositReceivedCents > 0 &&
        (paymentChoice !== "dp" || remainingDpCents > 0);
    function choose(choice: "dp" | "balance" | "none") {
        setPaymentChoice(choice);
        setValidation("");
        setVerified(false);
    }
    function save() {
        if (depositLoading || !deposit) {setValidation("Wait for the payment details to load.");return;}
        if (!amountValid) {setValidation("Choose what the customer paid.");return;}
        if (!verified) {setValidation("Tick the box to confirm you received the money.");return;}
        setValidation("");
        void onSave(bookingReceived, depositReceived, deposit.collected);
    }
    const optionClass = (selected: boolean) => `w-full rounded-xl border px-3 py-3 text-left text-sm transition-colors ${selected ?
        "border-[#7140DC] bg-[#F7F1FF] text-[#35165F] ring-1 ring-[#7140DC]" :
        "border-[#E5D8EF] bg-white text-[#49366B] hover:bg-[#FBF9FF]"}`;
    return <div role="presentation" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6">
        <div role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#E7D9F2] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
                <h2 id="payment-modal-title" className="text-lg font-bold text-[#26153F]">Record Payment</h2>
                <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="rounded-lg p-1.5 hover:bg-[#F5F0FC]"><X size={19}/></button>
            </div>
            <p className="mt-1 text-sm text-[#78698D]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
            <div className="mt-4 space-y-2 rounded-xl border border-[#E9E0EF] bg-[#FCFAFF] p-3 text-sm">
                <div className="flex justify-between gap-3"><span>Total price</span><strong>{peso(getTotalPrice(booking))}</strong></div>
                {cents(required) > 0 && <div className="flex items-center justify-between gap-3"><span>Down payment</span>
                    <span className="flex items-center gap-2"><strong>{peso(required)}</strong><PaidBadge paid={paid} due={required}/></span></div>}
                {(cents(required) === 0 ? cents(paid) > 0 : cents(paid) > cents(required)) &&
                    <div className="flex justify-between gap-3"><span>Paid so far</span><strong>{peso(paid)}</strong></div>}
                <div className="flex justify-between gap-3 border-t border-[#E9E0EF] pt-2 font-semibold"><span>Balance</span><strong>{bookingDueCents > 0 ? peso(balance) : "Fully paid"}</strong></div>
                {showRentalDeposit && cents(deposit?.required ?? 0) > 0 && <div className="flex items-center justify-between gap-3"><span>Security deposit</span>
                    <span className="flex items-center gap-2"><strong>{peso(deposit?.required ?? 0)}</strong><PaidBadge paid={deposit?.collected ?? 0} due={deposit?.required ?? 0}/></span></div>}
            </div>
            {depositError && <p role="alert" className="mt-2 text-xs font-medium text-red-700">{depositError} Close and reopen to retry.</p>}
            {bookingDueCents > 0 && <section className="mt-4" aria-label="Choose booking payment received">
                <p className="mb-2 text-sm font-bold text-[#26153F]">What did the customer pay?</p>
                <div className="space-y-2">
                    {remainingDpCents > 0 && <button type="button" className={optionClass(paymentChoice === "dp")} aria-pressed={paymentChoice === "dp"} disabled={busy || depositLoading || !deposit}
                                                     onClick={() => choose("dp")}><span className="flex items-center justify-between gap-2"><span>Down payment</span><strong>{peso(remainingDpCents / 100)}</strong></span></button>}
                    <button type="button" className={optionClass(paymentChoice === "balance")} aria-pressed={paymentChoice === "balance"} disabled={busy || depositLoading || !deposit}
                            onClick={() => choose("balance")}><span className="flex items-center justify-between gap-2"><span>{remainingDpCents > 0 ? "Full balance" : "Remaining balance"}</span><strong>{peso(bookingDueCents / 100)}</strong></span></button>
                    {showRentalDeposit && depositDueCents > 0 && <button type="button" className={optionClass(paymentChoice === "none")} aria-pressed={paymentChoice === "none"} disabled={busy || depositLoading || !deposit}
                                                                         onClick={() => {choose("none");setIncludeDeposit(true);}}>Security deposit only</button>}
                </div>
            </section>}
            {/* Only what still needs paying is shown: a paid deposit needs no section. */}
            {showRentalDeposit && depositDueCents > 0 && <section className="mt-4 border-t border-[#E9E0EF] pt-4" aria-label="Rental security deposit">
                <p className="mb-2 text-sm font-bold text-[#26153F]">Security deposit (refundable)</p>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5D8EF] p-3 text-sm text-[#49366B]">
                    <input type="checkbox" className="mt-0.5 accent-[#673DC8]" checked={includeDeposit} disabled={busy || depositLoading || !deposit}
                           onChange={e => {setIncludeDeposit(e.target.checked);setVerified(false);setValidation("");}}/>
                    <span>Also received the security deposit — <strong>{peso(depositDueCents / 100)}</strong></span>
                </label>
            </section>}
            <div className="mt-4 space-y-1 rounded-xl bg-[#F7F1FF] px-3 py-3 text-sm text-[#57436F]">
                {/* The parts are listed only when the money is split between booking payment and deposit. */}
                {bookingReceivedCents > 0 && depositReceivedCents > 0 && <>
                    <div className="flex justify-between gap-2"><span>Booking payment</span><strong>{peso(bookingReceived)}</strong></div>
                    <div className="flex justify-between gap-2"><span>Security deposit</span><strong>{peso(depositReceived)}</strong></div>
                </>}
                <div className={`flex justify-between gap-2 font-bold ${bookingReceivedCents > 0 && depositReceivedCents > 0 ? "border-t border-[#E0D4EA] pt-2" : ""}`}><span>Total received now</span><strong>{Number.isFinite(totalReceived) ? peso(totalReceived) : "Invalid"}</strong></div>
                {totalReceived > 0 && (remainingAfter > 0 || depositAfter > 0 ? <>
                    {remainingAfter > 0 && <div className="flex justify-between gap-2 text-xs"><span>Balance after this</span><span>{peso(remainingAfter)}</span></div>}
                    {showRentalDeposit && depositAfter > 0 && <div className="flex justify-between gap-2 text-xs"><span>Deposit still due after this</span><span>{peso(depositAfter)}</span></div>}
                </> : <p className="flex items-center gap-1.5 text-xs font-semibold text-[#23834A]"><CheckCircle2 size={14}/> Fully paid after this.</p>)}
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#E8DDF2] bg-[#FCFAFF] p-3 text-xs leading-5 text-[#49376A]">
                <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)} disabled={busy || depositLoading || !deposit || !amountValid} className="mt-0.5 accent-[#6435BC]" />
                <span>I received this money from the customer.</span>
            </label>
            {showRentalDeposit && depositDueCents > 0 && <p className="mt-2 text-xs leading-5 text-[#827393]">The security deposit is kept separately and returned after the equipment comes back.</p>}
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">{validation || error}</p>}
            <div className="mt-5 flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-[#D9C6E9] bg-white px-3 text-sm font-semibold text-[#352353] hover:bg-[#F7F1FF] disabled:opacity-50">Cancel</button>
                <button type="button" disabled={busy || depositLoading || !deposit || !amountValid || !verified} onClick={save} className="min-h-11 flex-1 rounded-xl bg-[#432183] px-3 text-sm font-bold text-white hover:bg-[#30145F] disabled:opacity-50">{busy ? "Saving…" : "Save Payment"}</button></div>
        </div>
    </div>;
}

// "Paid" when fully paid, "₱X paid" when partly paid, "Not paid" otherwise.
function PaidBadge({paid, due}: {paid: number; due: number}) {
    const paidCents = Math.round(paid * 100), dueCents = Math.round(due * 100);
    const [label, tone] = paidCents >= dueCents ? ["Paid", "bg-[#E7F6EC] text-[#23834A]"] :
        paidCents > 0 ? [`${peso(paid)} paid`, "bg-[#FFF4DC] text-[#926400]"] : ["Not paid", "bg-[#F4EFF8] text-[#6B5A80]"];
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

function normalizeClosureStatus(status:string){return /^(pending review|pending)$/i.test(status)?"Pending Review":status;}

function CancelInventoryModal({
                                  booking,
                                  impact,
                                  items,
                                  usedQty,
                                  loading,
                                  submitting,
                                  error,
                                  onChangeUsedQty,
                                  onClose,
                                  onConfirm,
                              }: {
    booking: Booking;
    impact: BookingClosureImpact | null;
    items: BookingInventoryItem[];
    usedQty: Record<number, number>;
    loading: boolean;
    submitting: boolean;
    error: string;
    onChangeUsedQty: (itemId: number, value: number) => void;
    onClose: () => void;
    onConfirm: (reason: string, refund?: CancelRefund) => void;
}) {
    const [reason, setReason] = useState("");
    const [acknowledged,setAcknowledged] = useState(false);
    // Refund on cancellation: pre-filled with the suggestion, which follows the used quantities
    // until the Manager types their own amount.
    const [refundText, setRefundText] = useState("");
    const [refundTouched, setRefundTouched] = useState(false);
    const [refundMethod, setRefundMethod] = useState("cash");
    const [refundVerified, setRefundVerified] = useState(false);
    const rejecting=normalizeClosureStatus(booking.status)==='Pending Review';
    const reservedItems = items.filter(
        (item) => Number(item.reserved_quantity || 0) > 0
    );

    const hasReservedItems = reservedItems.length > 0;
    const rentalAllocations = impact?.rentalAllocations ?? {};
    const reservedRentals = Number(rentalAllocations.reserved || 0);
    const checkedOutRentals = Number(rentalAllocations.checked_out || 0);
    const returnedRentals = Number(rentalAllocations.returned || 0);
    const rentalCancellationBlocked = Boolean(impact?.rentalCancellationBlocked) ||
        checkedOutRentals > 0 || returnedRentals > 0;
    const hasRentalLines = Number(impact?.rentalItemLines || 0) > 0;
    const refundable = Math.max(0, Number(impact?.refundableBookingPayment ?? 0));
    // Policy: the store keeps the LARGER of the non-refundable down payment or the products already used.
    const downPayment = Math.max(0, Number(impact?.requiredDownPayment ?? 0));
    // Discounted price when the package / quote has a discount, otherwise the normal price.
    const refundPrice = (item: BookingInventoryItem) => Number(item.refund_unit_price ?? item.unit_price ?? 0);
    const normalTotal = reservedItems.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.reserved_quantity || 0), 0);
    const discountedTotal = reservedItems.reduce((sum, item) => sum + refundPrice(item) * Number(item.reserved_quantity || 0), 0);
    const discountPercent = normalTotal > 0 ? Math.round((1 - discountedTotal / normalTotal) * 1000) / 10 : 0;
    const hasDiscount = discountPercent >= 0.1;
    // Same rule as the Lambda: used quantity × the price shown, so the math adds up. When everything is used it is
    // exactly the deal price (no ₱0.01 left over), and never more than the deal price.
    const usedOf = (item: BookingInventoryItem) => Math.max(0, Math.min(Number(usedQty[Number(item.id)] || 0), Number(item.reserved_quantity || 0)));
    const shownUsed = Math.round(reservedItems.reduce((sum, item) => sum + Math.round(usedOf(item) * refundPrice(item) * 100), 0)) / 100;
    const dealTotal = Math.round(reservedItems.reduce((sum, item) =>
        sum + Number(item.reserved_quantity || 0) * Number(item.unit_price || 0) * Number(item.refund_price_ratio ?? 1), 0) * 100) / 100;
    const allUsed = reservedItems.length > 0 && reservedItems.every((item) => usedOf(item) >= Number(item.reserved_quantity || 0));
    const usedValue = allUsed ? dealTotal : Math.min(shownUsed, dealTotal);
    // The store keeps the bigger amount, but never more than what the customer actually paid.
    const keepBasis = Math.max(downPayment, usedValue);
    const keepCapped = keepBasis > refundable + 0.005;
    const storeKeepsSuggested = Math.min(refundable, keepBasis);
    const suggestedRefund = Math.max(0, Math.round((refundable - storeKeepsSuggested) * 100) / 100);
    useEffect(() => {
        if (impact && !refundTouched) setRefundText(String(suggestedRefund));
    }, [impact, refundTouched, suggestedRefund]);
    const depositBack = Math.max(0, Number(impact?.depositRefundOnCancel ?? impact?.depositHeld ?? 0));
    const showRefund = !rejecting && !!impact && (refundable > 0.005 || depositBack > 0.005);
    const refundValue = refundable > 0.005 ? Number(refundText) : 0;
    const refundValid = refundable <= 0.005 || (refundText.trim() !== "" && Number.isFinite(refundValue) && refundValue >= 0 &&
        refundValue <= refundable + 0.005 && Math.abs(refundValue * 100 - Math.round(refundValue * 100)) < 0.001);
    const totalBack = (refundValid ? refundValue : 0) + depositBack;
    const refundReady = !showRefund || (refundValid && (totalBack <= 0.005 || refundVerified));

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 font-sans">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl">
                <div className="border-b border-[#EFE7F4] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#806A8C]">
                        {rejecting?'Reject Booking':'Cancel Booking'}
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-[#1A1220]">
                        {rejecting?'Explain why the request is being rejected':'Review cancellation impact'}
                    </h2>

                    <p className="mt-1 text-sm text-[#7A6A84]">
                        Booking #{booking.id} · {booking.name}
                    </p>
                </div>

                <div className="max-h-[58vh] overflow-y-auto px-5 py-4">
                    {impact && <div className="mb-4 rounded-xl border border-[#E6DDF0] bg-[#FAF8FD] p-4 text-xs text-[#2B174C]">
                        <h3 className="mb-3 text-sm font-bold">{rejecting?'Before rejecting':'Summary'}</h3>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <span>Current status</span><strong className="text-right">{impact.status}</strong>
                            <span>Payment stage</span><strong className="text-right">{impact.paymentStage.replaceAll('_',' ')}</strong>
                            <span>Booking payments received</span><strong className="text-right">{peso(impact.paymentReceived)}</strong>
                            {/* Only the rows that apply to this booking's contents. */}
                            {(hasRentalLines || impact.depositCollected > 0.005) && <>
                                <span>Rental deposit collected</span><strong className="text-right">{peso(impact.depositCollected)}</strong>
                                <span>Security deposit still held</span><strong className="text-right">{peso(impact.depositHeld)}</strong>
                            </>}
                            {items.length > 0 && <>
                                <span>Reserved consumable units</span><strong className="text-right">{impact.reservedConsumableUnits}</strong>
                                <span>Previously used consumables</span><strong className="text-right">{impact.usedConsumableUnits}</strong>
                            </>}
                            {hasRentalLines && <><span>Rental items</span><strong className="text-right">{impact.rentalItemLines}</strong></>}
                        </div>
                        {!rejecting && <p className="mt-3 border-t border-[#E6DDF0] pt-3 leading-5 text-[#655478]">
                            {hasReservedItems ? "Step 1: enter the products already used. Step 2: confirm the refund. Both are saved together with the cancellation." : "The refund below is saved together with the cancellation."} Payment records are kept for history.
                        </p>}
                    </div>}
                    {/* Step 1: products already used. It comes BEFORE the refund because the refund depends on it. */}
                    {loading ? (
                        <div className="mb-4 rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-8 text-center text-sm text-[#806A8C]">
                            Loading booking items...
                        </div>
                    ) : rejecting ? (
                        <p className="mb-4 text-xs text-[#655478]">Not approved yet, so no items need returning.</p>
                    ) : !hasReservedItems ? (
                        <div className="mb-4 rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-4 text-sm text-[#8A5A00]">
                            No reserved consumable inventory was found. {hasRentalLines
                            ? "No consumables to return."
                            : "No consumables to return."}
                        </div>
                    ) : (
                        <section aria-label="Products already used" className="mb-4 overflow-hidden rounded-xl border border-[#D6C4F8] bg-white text-xs text-[#2B174C]">
                            <div className="flex items-start gap-3 border-b border-[#EFE7F4] px-4 py-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2B174C] text-[11px] font-bold text-white">1</span>
                                <div>
                                    <h3 className="text-sm font-bold">Products already used</h3>
                                    <p className="mt-0.5 leading-5 text-[#806A8C]">Enter how many of each product were already used and can't go back to inventory. Leave 0 if nothing was used. The rest returns to inventory.</p>
                                </div>
                            </div>
                            {hasDiscount && <p className="border-b border-[#EFE7F4] bg-[#F5F0FF] px-4 py-2 leading-5 text-[#4D2B85]">
                                {getManagerBookingTypeLabel(booking) === "Package" ? "Package discount" : "Discount"} applied ({discountPercent}% off):
                                used products are valued at the <strong>discounted price</strong> the customer agreed to.</p>}
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-left">
                                    <thead className="bg-[#F7F2FC] text-[10px] font-bold uppercase tracking-wide text-[#6A5582]">
                                    <tr><th className="px-4 py-2">Product</th><th className="px-2 py-2 text-right">Price</th><th className="px-2 py-2 text-center">Booked</th>
                                        <th className="px-2 py-2 text-center">Used</th><th className="px-2 py-2 text-center">Back to inventory</th><th className="px-4 py-2 text-right">Used value</th></tr>
                                    </thead>
                                    <tbody>{reservedItems.map((item) => {
                                        const itemId = Number(item.id);
                                        const reserved = Number(item.reserved_quantity || 0);
                                        const used = Math.max(0, Math.min(Number(usedQty[itemId] || 0), reserved));
                                        const label = item.variant_name ? `${item.product_name} — ${item.variant_name}` : item.product_name;
                                        return <tr key={item.id} className="border-t border-[#EFE7F4]">
                                            <td className="px-4 py-2 font-semibold text-[#1A1220]">{label}</td>
                                            <td className="px-2 py-2 text-right tabular-nums">
                                                {refundPrice(item) < Number(item.unit_price || 0) - 0.005
                                                    ? <><span className="block text-[10px] text-[#75657E] line-through">{peso(Number(item.unit_price || 0))}</span>{peso(refundPrice(item))}</>
                                                    : peso(Number(item.unit_price || 0))}</td>
                                            <td className="px-2 py-2 text-center tabular-nums">{reserved}</td>
                                            <td className="px-2 py-2 text-center">
                                                <input type="number" min={0} max={reserved} value={used} disabled={submitting}
                                                       aria-label={`Used quantity of ${label}`}
                                                       onChange={(event) => onChangeUsedQty(itemId, Math.max(0, Math.min(Number(event.target.value || 0), reserved)))}
                                                       className="h-9 w-20 rounded-lg border border-[#D8CBE7] bg-white px-2 text-center text-sm font-semibold text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-2 focus:ring-[#2B174C]/10 disabled:opacity-60"/>
                                            </td>
                                            <td className="px-2 py-2 text-center font-semibold tabular-nums text-[#138342]">{Math.max(reserved - used, 0)}</td>
                                            <td className="px-4 py-2 text-right font-semibold tabular-nums">{peso(used * refundPrice(item))}</td>
                                        </tr>;
                                    })}</tbody>
                                    <tfoot><tr className="border-t-2 border-[#E6DDF0] bg-[#FBF8FF]">
                                        <td colSpan={5} className="px-4 py-2 text-right font-bold">Products already used</td>
                                        <td className="px-4 py-2 text-right font-bold tabular-nums">{peso(usedValue)}</td>
                                    </tr></tfoot>
                                </table>
                            </div>
                        </section>
                    )}
                    {showRefund && impact && (
                        <section aria-label="Refund on cancellation" className="mb-4 rounded-xl border border-[#D6C4F8] bg-white p-4 text-xs text-[#2B174C]">
                            <div className="flex items-start gap-3">
                                {hasReservedItems && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2B174C] text-[11px] font-bold text-white">2</span>}
                                <div>
                                    <h3 className="text-sm font-bold">Refund to customer</h3>
                                    <p className="mt-0.5 leading-5 text-[#806A8C]">{hasReservedItems
                                        ? <>The store keeps whichever is <strong>bigger</strong>: the down payment ({peso(downPayment)}) or the products already used ({peso(usedValue)}). The rest is refunded.</>
                                        : <>The store keeps the down payment ({peso(downPayment)}). The rest is refunded.</>}</p>
                                </div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                <span>Booking payments received</span><strong className="text-right">{peso(refundable)}</strong>
                                <span>Down payment (non-refundable)</span><strong className="text-right">{peso(downPayment)}</strong>
                                {hasReservedItems && <><span>Products already used (step 1)</span><strong className="text-right">{peso(usedValue)}</strong></>}
                                <span>{keepCapped ? "Store keeps (all payments received)"
                                    : hasReservedItems ? (usedValue > downPayment ? "Store keeps (products used is bigger)" : "Store keeps (down payment is bigger)") : "Store keeps (the down payment)"}</span><strong className="text-right">{peso(storeKeepsSuggested)}</strong>
                                <span className="font-semibold">Suggested refund</span><strong className="text-right">{peso(suggestedRefund)}</strong>
                            </div>
                            {keepCapped && refundable > 0.005 && <p className="mt-2 rounded-lg bg-[#FFF8E8] px-3 py-2 leading-5 text-[#8A5A06]">
                                {hasReservedItems && usedValue > downPayment ? "The products already used" : "The down payment"} ({peso(keepBasis)}) {hasReservedItems && usedValue > downPayment ? "are" : "is"} more
                                than the {peso(refundable)} paid, so the store keeps everything paid and nothing is refunded.
                                The other {peso(keepBasis - refundable)} is not covered by the customer&apos;s payments.</p>}
                            {refundable > 0.005 && <label className="mt-3 block font-semibold text-[#4E2C66]">
                                Booking payment to refund
                                <input type="number" min={0} max={refundable} step="0.01" inputMode="decimal" value={refundText}
                                       disabled={submitting} onChange={e => { setRefundText(e.target.value); setRefundTouched(true); }}
                                       className="mt-1 h-10 w-full rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm font-semibold text-[#1A1220] outline-none focus:border-[#6C3AD6]"/>
                                <span className="mt-1 block font-normal leading-5 text-[#806A8C]">
                                    {hasReservedItems
                                        ? <>Amount paid minus the larger of the down payment or the products already used
                                            {hasRentalLines ? " (rental equipment is not counted: it goes back to stock)" : ""}.</>
                                        : hasRentalLines
                                            ? "Rental equipment is not used up: it goes back to stock and the dates are freed, so the store keeps only the down payment."
                                            : "Nothing has been reserved or used yet, so the store keeps only the down payment."}
                                    {" "}You can change it, for example a full refund if the store cancelled. Maximum {peso(refundable)}.
                                </span>
                                {refundTouched && Number(refundText) !== suggestedRefund && <button type="button" disabled={submitting}
                                                                                                    onClick={() => setRefundTouched(false)}
                                                                                                    className="mt-1 text-xs font-semibold text-[#6335BC] hover:underline">Use suggested refund ({peso(suggestedRefund)})</button>}
                                {!refundValid && <span role="alert" className="mt-1 block font-semibold text-red-700">Enter an amount from ₱0 to {peso(refundable)} (up to two decimals).</span>}
                            </label>}
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#EFE7F4] pt-3">
                                {refundable > 0.005 && <><span>Kept by the store</span><strong className="text-right">{peso(Math.max(0, refundable - (refundValid ? refundValue : 0)))}</strong></>}
                                {depositBack > 0.005 && <><span>Security deposit refunded (automatic)</span><strong className="text-right">{peso(depositBack)}</strong></>}
                                <span className="font-bold">Total to give back</span><strong className="text-right text-[#138342]">{peso(totalBack)}</strong>
                            </div>
                            {totalBack > 0.005 && <>
                                <label className="mt-3 block font-semibold text-[#4E2C66]">Refund method
                                    <select value={refundMethod} onChange={e => setRefundMethod(e.target.value)} disabled={submitting}
                                            className="mt-1 h-10 w-full rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm text-[#1A1220]">
                                        <option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank_transfer">Bank transfer</option>
                                    </select>
                                </label>
                                <label className="mt-3 flex items-start gap-2 leading-5 text-[#4D3A60]">
                                    <input type="checkbox" checked={refundVerified} onChange={e => setRefundVerified(e.target.checked)} disabled={submitting} className="mt-1"/>
                                    I have given {peso(totalBack)} back to the customer.
                                </label>
                            </>}
                        </section>
                    )}
                    {!rejecting && impact && hasRentalLines && (
                        <section aria-label="Rental cancellation impact" className="mb-4 rounded-xl border border-[#D6C4F8] bg-[#FAF8FF] p-4 text-xs text-[#2B174C]">
                            <h3 className="text-sm font-bold">Rental equipment</h3>
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                <span>Reserved equipment</span><strong className="text-right">{reservedRentals}</strong>
                                <span>Handed over</span><strong className="text-right">{checkedOutRentals}</strong>
                                <span>Returned</span><strong className="text-right">{returnedRentals}</strong>
                                <span>After cancelling</span>
                                <strong className="text-right">{rentalCancellationBlocked ? "Can't cancel" : reservedRentals > 0 ? "Equipment is freed" : "Nothing reserved"}</strong>
                            </div>
                            <p className={`mt-3 border-t pt-3 leading-5 ${rentalCancellationBlocked ? "border-red-200 text-red-700" : "border-[#E6DDF0] text-[#655478]"}`}>
                                {rentalCancellationBlocked
                                    ? "The equipment was already handed over, so this booking can't be cancelled. Use the return and settlement steps instead."
                                    : "Cancelling frees the reserved equipment for these dates."}
                            </p>
                        </section>
                    )}
                    <div className="mt-4 space-y-2 rounded-xl border border-[#E6DDF0] bg-white p-4">
                        <label htmlFor="cancel-booking-reason" className="block text-sm font-semibold text-[#2B174C]">{rejecting?'Rejection reason':'Cancellation reason'} <span className="text-red-600">*</span></label>
                        <textarea id="cancel-booking-reason" rows={2} maxLength={500} value={reason}
                                  onChange={event => setReason(event.target.value)} disabled={submitting}
                                  placeholder={rejecting?'Explain why this booking request was declined.':'Explain why the booking is being cancelled.'}
                                  className="w-full rounded-xl border border-[#D8CBE7] p-3 text-sm outline-none focus:border-[#6C3AD6]" />
                        <p className="text-xs text-[#806A8C]">Saved in the booking history.</p>
                        {!rejecting && <label className="flex items-start gap-2 border-t border-[#EFE7F4] pt-3 text-xs leading-5 text-[#4D3A60]">
                            <input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={submitting||loading||!impact} className="mt-1"/>
                            I reviewed the items and the refund above.
                        </label>}
                    </div>
                    {error && (
                        <div className="mt-4 rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-sm font-semibold text-[#C32F2F]">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-[#EFE7F4] bg-[#FFFDF8] px-5 py-4 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:opacity-60"
                    >
                        Back
                    </button>

                    <button
                        type="button"
                        onClick={() => onConfirm(reason.trim(), rejecting ? undefined : {
                            amount: refundable > 0.005 ? Math.round(refundValue * 100) / 100 : 0, method: refundMethod, verified: refundVerified })}
                        disabled={loading || submitting || !impact || reason.trim().length < 5 || (!rejecting&&!acknowledged) || (!rejecting&&!refundReady) || rentalCancellationBlocked || (rejecting?!impact.eligibleForReject:!impact.eligibleForCancel)}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Processing..." : rejecting?"Confirm Rejection":"Confirm Cancellation"}
                    </button>
                </div>
            </div>
        </div>
    );
}
