"use client";

import { useCallback, useEffect, useState } from "react";

type Statement = {
    booking:{reference:string;name:string;bookingType:string;packageName:string;status:string;eventDate?:string;agreedPrice:number|null;downPayment:number;bookingPayments:number;balance:number};
    packageBase:number;salesSubtotal?:number;rentalSubtotal:number;deliveryFee:number;setupFee:number;
    depositRequired:number;depositCollected:number;depositApplied:number;depositRefunded:number;depositHeld:number;
    claimBalance:number;agreedCharges:number;
    rentalItems:{name:string;quantity:number;days:number;dailyRate:number;amount:number}[];
    salesItems?:{name:string;variantName?:string;quantity:number;unitPrice:number;amount:number}[];
    claims:{id:number;sourceType:string;sourceId:number;equipmentName?:string;quantity:number;reason:string;amount:number;amountPaid:number;depositApplied:number;status:string}[];
};
const money=(n:number)=>`₱${Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

// A combined customer charge is saved on ONE claim record to prevent double
// billing. The other affected items have zero-value companion records for audit.
// Those companion records are NOT individually waived: they are covered by the
// same booking-wide amount. This also corrects receipts for existing records
// that the legacy Lambda labelled 'waived'.
type ReceiptClaim = Statement['claims'][number];
const isCombinedChargeLeader = (claim:ReceiptClaim) =>
    /^combined booking-wide charge\b/i.test(String(claim.reason||'').trim()) && Number(claim.amount)>0;
const isCombinedChargeCompanion = (claim:ReceiptClaim) =>
    /^covered by the same combined booking-wide charge\b/i.test(String(claim.reason||'').trim());
const combinedReceiptTotal = (claims:ReceiptClaim[]) =>
    claims.filter(isCombinedChargeLeader).reduce((sum,claim)=>sum+Math.max(0,Number(claim.amount)||0),0);
// Do not imply that a single affected item was charged the full combined price.
// The grouped amount is displayed ONCE below the affected-item list.
const isIncludedInCombinedCharge = (claim:ReceiptClaim,claims:ReceiptClaim[]) =>
    combinedReceiptTotal(claims)>0 && (isCombinedChargeLeader(claim)||isCombinedChargeCompanion(claim));


// The receipt must identify the real store and the booking's own branch,
// not the StockNBook platform or another branch in an Owner session.
type ReceiptIdentity = {storeName:string;branchName:string};
const receiptText=(value:unknown)=>typeof value==='string'?value.trim():'';
function receiptField(source:unknown,...names:string[]){
    if(!source||typeof source!=='object')return '';
    const row=source as Record<string,unknown>;
    for(const key of names){const value=receiptText(row[key]);if(value)return value;}
    return '';
}
function receiptStored(keys:string[]){
    for(const key of keys){
        try{const value=receiptText(sessionStorage.getItem(key)||localStorage.getItem(key));if(value)return value;}
        catch{/* Storage can be unavailable in restricted browser contexts. */}
    }
    return '';
}
async function resolveReceiptIdentity(statement:Statement,branchId:number):Promise<ReceiptIdentity>{
    const info=statement as unknown as Record<string,unknown>;
    const booking=statement.booking as unknown as Record<string,unknown>;
    const store=info.store||booking.store;
    const branch=info.branch||booking.branch;
    let storeName=receiptField(booking,'storeName','store_name','businessName','business_name')||
        receiptField(info,'storeName','store_name','businessName','business_name')||
        receiptField(store,'name','store_name','storeName','business_name');
    let branchName=receiptField(booking,'branchName','branch_name')||
        receiptField(info,'branchName','branch_name')||
        receiptField(branch,'name','branch_name','branchName');
    // Use the actual branch ID to avoid an Owner's selected booking receiving the
    // logged-in session's *different* branch name.
    if(branchId>0 && !branchName){
        try{
            const token=sessionStorage.getItem('token');
            if(token){
                const res=await fetch('/api/branches',{headers:{Authorization:`Bearer ${token}`}});
                if(res.ok){
                    const data=await res.json();
                    const rows=Array.isArray(data)?data:Array.isArray(data?.branches)?data.branches:[];
                    const row=rows.find((entry:Record<string,unknown>)=>Number(entry.id??entry.branch_id)===branchId);
                    if(row){
                        branchName=receiptField(row,'branch_name','branchName','name');
                        storeName=storeName||receiptField(row,'storeName','store_name','businessName','business_name')||
                            receiptField(row.store,'name','storeName','store_name');
                    }
                }
            }
        }catch{/* Fall back to a branch-matched session label if present. */}
    }
    const savedStoreName=receiptStored(['store_name','stocknbook_store_name','business_name','storeName']);
    if(!storeName)storeName=savedStoreName;
    if(!branchName && branchId>0){
        const savedBranchId=Number(receiptStored(['branch_id','stocknbook_branch_id','manager_branch_id','staff_branch_id']));
        if(savedBranchId===branchId){
            branchName=receiptStored(['branch_name','stocknbook_branch_name','manager_branch_name','staff_branch_name']);
        }
    }
    return {storeName,branchName};
}



// Browser-only, dependency-free PDF export. This uses the same financial statement as the
// visible receipt and downloads a PDF directly; it never opens the browser print dialog.
function downloadBookingReceiptPdf(statement:Statement,bookingId:number,identity:ReceiptIdentity){
    const v=statement;
    const {storeName,branchName}=identity;
    // A4 portrait (not a screenshot of the dashboard or its Booking Details panel).
    const W=595,H=842,left=42,right=553;
    const pages:string[][]=[];
    let commands:string[]=[];
    let y=0;
    let inItems=true;
    const clean=(value:unknown)=>String(value??'')
        .replace(/₱/g,'PHP ').replace(/[—–−]/g,'-').replace(/[“”]/g,'"')
        .replace(/[’‘]/g,"'").replace(/[·•]/g,'-')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^\x20-\x7E]/g,'?').replace(/\s+/g,' ').trim();
    const esc=(value:unknown)=>clean(value).replace(/[\\()]/g,'\\$&');
    const pesoPdf=(n:number)=>`PHP ${Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const text=(value:unknown,x:number,baseline:number,size=9,bold=false,color='0.16 0.09 0.24')=>{
        commands.push(`${color} rg\nBT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm (${esc(value)}) Tj ET\n`);
    };
    const rightText=(value:unknown,xRight:number,baseline:number,size=9,color='0.16 0.09 0.24')=>{
        const txt=clean(value);
        const x=xRight-txt.length*size*0.6;
        commands.push(`${color} rg\nBT /F3 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm (${esc(txt)}) Tj ET\n`);
    };
    const rect=(x:number,bottom:number,width:number,height:number,color:string)=>{
        commands.push(`${color} rg\n${x} ${bottom.toFixed(2)} ${width} ${height} re f\n`);
    };
    const rule=()=>{commands.push(`0.86 0.82 0.91 RG\n0.5 w ${left} ${y.toFixed(2)} m ${right} ${y.toFixed(2)} l S\n`);};
    const wrap=(value:unknown,maxChars:number)=>{
        const words=clean(value).split(' ');
        const lines:string[]=[];let current='';
        for(const word of words){
            if(!word)continue;
            if(word.length>maxChars){
                if(current){lines.push(current);current='';}
                for(let i=0;i<word.length;i+=maxChars)lines.push(word.slice(i,i+maxChars));
            }else if(!current){current=word;}
            else if((current+' '+word).length<=maxChars)current+=' '+word;
            else {lines.push(current);current=word;}
        }
        if(current)lines.push(current);
        return lines.length?lines:['-'];
    };
    const header=()=>{
        // Prominent business identity; branch is highlighted in a contrasting band.
        rect(34,765,527,54,'0.18 0.10 0.30');
        text('STORE',left+7,802,8,true,'0.84 0.76 0.99');
        const name=clean(storeName);
        const nameSize=name.length>60?11:name.length>44?13:16;
        text(name.slice(0,87),left+7,780,nameSize,true,'1 1 1');
        rect(34,739,527,26,'0.91 0.85 0.99');
        text(`BRANCH: ${clean(branchName).slice(0,88)}`,left+7,748,10,true,'0.25 0.13 0.43');
        text('BOOKING PAYMENT RECEIPT',left,713,16,true,'0.17 0.09 0.30');
        text('Booking payments, refundable deposit and charge settlement - Not a tax invoice',left,697,8,false,'0.45 0.38 0.52');
    };
    const tableHeading=()=>{
        rect(left,y-9,right-left,25,'0.96 0.94 0.99');
        text('ITEM / SERVICE',left+7,y,8,true);
        text('QTY',325,y,8,true);
        text('UNIT PRICE',372,y,8,true);
        text('AMOUNT',500,y,8,true);
        y-=36;
    };
    const newPage=(continued=false)=>{
        commands=[];pages.push(commands);
        header();
        y=670;
        // Only receipt identifiers, not a Booking Details section/status panel.
        text('RECEIPT FOR',left,y,8,true,'0.46 0.39 0.52');
        text('BOOKING REFERENCE',306,y,8,true,'0.46 0.39 0.52');
        y-=16;
        text(clean(v.booking.name||'-').slice(0,51),left,y,10,true);
        text(clean(v.booking.reference||`#${bookingId}`).slice(0,46),306,y,10,true);
        y-=17;rule();y-=20;
        if(continued){
            text('RECEIPT CONTINUED',left,y,9,true,'0.33 0.19 0.60');y-=22;
            if(inItems)tableHeading();
        }else{
            text('ITEMIZED RECEIPT',left,y,10,true,'0.23 0.13 0.38');y-=24;
            tableHeading();
        }
    };
    const ensure=(height:number)=>{if(y-height<66)newPage(true);};
    const itemSection=(heading:string)=>{
        ensure(30);
        text(heading.toUpperCase(),left+7,y,8.5,true,'0.34 0.19 0.59');
        y-=21;
    };
    const itemRow=(name:string,qty:string,rate:string,total:string,detail='')=>{
        const lines=wrap(name,47);
        const height=lines.length*13+(detail?12:0)+9;
        ensure(height);
        lines.forEach((line,i)=>text(line,left+7,y-i*13,8.4,i===0));
        text(qty,329,y,9);
        rightText(rate,444,y,8);
        rightText(total,right-4,y,8.7);
        if(detail)text(detail,left+7,y-lines.length*13,8,false,'0.50 0.43 0.56');
        y-=height;
    };
    const summary=(label:string,value:string,bold=false)=>{
        ensure(20);
        text(label,left+8,y,bold?9.5:9,bold);
        rightText(value,right-4,y,bold?9.5:9);
        y-=19;
    };
    newPage();
    if(v.packageBase>0)itemRow(`Package base${v.booking.packageName?' - '+v.booking.packageName:''}`,'1',pesoPdf(v.packageBase),pesoPdf(v.packageBase));
    if((v.salesItems||[]).length){
        itemSection('Consumable items');
        for(const item of v.salesItems||[])itemRow(`${item.name}${item.variantName?' ('+item.variantName+')':''}`,String(item.quantity),pesoPdf(item.unitPrice),pesoPdf(item.amount));
    }
    if(v.rentalItems.length){
        itemSection('Rental items');
        for(const item of v.rentalItems)itemRow(item.name,String(item.quantity),`${pesoPdf(item.dailyRate)}/day`,pesoPdf(item.amount),`${item.days} ${Number(item.days)===1?'day':'days'} rental`);
    }
    if(v.deliveryFee>0||v.setupFee>0){
        itemSection('Other charges');
        if(v.deliveryFee>0)itemRow('Delivery / pickup','1',pesoPdf(v.deliveryFee),pesoPdf(v.deliveryFee));
        if(v.setupFee>0)itemRow('Setup','1',pesoPdf(v.setupFee),pesoPdf(v.setupFee));
    }
    if(!(v.packageBase>0||(v.salesItems||[]).length||v.rentalItems.length||v.deliveryFee>0||v.setupFee>0)){
        ensure(25);text('No itemized charges available.',left+7,y,9);y-=23;
    }
    // Count only physical booked units. Package-base, delivery and setup are services,
    // not additional physical items, so they do not inflate the total.
    const totalBookedUnits=(v.salesItems||[]).reduce((sum,item)=>sum+Math.max(0,Number(item.quantity)||0),0)
        +v.rentalItems.reduce((sum,item)=>sum+Math.max(0,Number(item.quantity)||0),0);
    const itemizedSubtotal=Number(v.packageBase||0)+Number(v.deliveryFee||0)+Number(v.setupFee||0)
        +(v.salesItems||[]).reduce((sum,item)=>sum+(Number(item.amount)||0),0)
        +v.rentalItems.reduce((sum,item)=>sum+(Number(item.amount)||0),0);
    ensure(23);rule();y-=19;
    summary('TOTAL UNITS NEEDED',String(totalBookedUnits),true);
    inItems=false;
    const isAgreed=v.booking.agreedPrice!==null&&Number.isFinite(Number(v.booking.agreedPrice));
    const depositDue=Math.max(0,Number(v.depositRequired)-Number(v.depositCollected));
    summary('Itemized subtotal',pesoPdf(itemizedSubtotal));
    summary('Final agreed booking price',isAgreed?pesoPdf(Number(v.booking.agreedPrice)):'Awaiting agreement',true);
    summary('Payments received',`- ${pesoPdf(v.booking.bookingPayments)}`);
    summary('Remaining booking balance',isAgreed?pesoPdf(v.booking.balance):'Awaiting agreement',true);
    ensure(35);y-=12;rule();y-=17;
    text('REFUNDABLE SECURITY DEPOSIT',left+8,y,9,true,'0.34 0.19 0.59');y-=23;
    summary('Deposit required',pesoPdf(v.depositRequired));
    summary('Deposit collected',pesoPdf(v.depositCollected));
    summary('Deposit still due',pesoPdf(depositDue),true);
    if(Number(v.depositApplied)>0)summary('Applied to approved damage/loss',pesoPdf(v.depositApplied));
    if(Number(v.depositRefunded)>0)summary('Deposit refunded',pesoPdf(v.depositRefunded));
    summary('Deposit currently held',pesoPdf(v.depositHeld));
    // Payment totals are separate from the agreed itemized booking price.
    // The deposit is a refundable liability, not additional booking revenue.
    const approvedClaims=v.claims.filter(c=>c.status!=='waived');
    const approvedTotal=approvedClaims.reduce((total,c)=>total+Math.max(0,Number(c.amount)||0),0);
    const claimPayments=approvedClaims.reduce((total,c)=>total+Math.max(0,Number(c.amountPaid)||0),0);
    if(v.claims.length){
        ensure(50);y-=8;rule();y-=18;
        text('DAMAGE / MISSING ITEM CHARGES',left+8,y,9,true,'0.34 0.19 0.59');y-=24;
        for(const claim of v.claims){
            const covered=isIncludedInCombinedCharge(claim,v.claims);
            itemRow(`${claim.equipmentName||'Rental equipment'} - ${claim.sourceType==='missing'?'Missing':'Damaged'}${claim.status==='waived'&&!covered?' (Waived)':''}`,
                String(claim.quantity),'-',covered?'Included':pesoPdf(claim.status==='waived'?0:claim.amount));
        }
        // A combined charge covers all listed affected equipment, not only
        // the first claim that holds the amount in the accounting ledger.
        if(combinedReceiptTotal(v.claims)>0)
            summary('Combined charge for affected equipment',pesoPdf(combinedReceiptTotal(v.claims)),true);
    }
    ensure(125);y-=7;rule();y-=20;
    text('PAYMENTS / SETTLEMENT',left+8,y,9,true,'0.34 0.19 0.59');y-=24;
    summary('Booking payments received',pesoPdf(v.booking.bookingPayments));
    summary('Security deposit collected',pesoPdf(v.depositCollected));
    summary('Additional claim payments received',pesoPdf(claimPayments));
    const collected=Number(v.booking.bookingPayments)+Number(v.depositCollected)+claimPayments;
    summary('Total cash collected',pesoPdf(collected),true);
    summary('Deposit refunded to customer',`- ${pesoPdf(v.depositRefunded)}`);
    summary('Net cash received',pesoPdf(collected-Number(v.depositRefunded)),true);
    ensure(105);y-=8;rule();y-=18;
    text('CLAIMS RECONCILIATION',left+8,y,9,true,'0.34 0.19 0.59');y-=24;
    summary('Approved damage/missing charges',pesoPdf(approvedTotal));
    summary('Paid directly against charges',pesoPdf(claimPayments));
    summary('Deposit used for charges',pesoPdf(v.depositApplied));
    summary('Unpaid charges',pesoPdf(v.claimBalance),true);
    summary('Deposit still held',pesoPdf(v.depositHeld));
    ensure(70);y-=10;
    rect(left,y-49,right-left,62,'0.18 0.10 0.30');
    text('TOTAL OUTSTANDING FROM CUSTOMER',left+13,y-6,9,true,'0.87 0.80 0.98');
    const due=isAgreed?pesoPdf(Math.max(0,Number(v.booking.balance))+depositDue+Math.max(0,Number(v.claimBalance))):'Awaiting agreement';
    text(due,left+13,y-33,17,true,'1 1 1');
    y-=72;
    // Keep receipt notes in the reserved bottom margin rather than creating a near-empty extra page.
    text('Refundable security deposits are held separately from booking sales.',left,55,8,false,'0.45 0.38 0.52');
    text('For reference only - Not a tax invoice',left,43,8,false,'0.45 0.38 0.52');
    for(let i=0;i<pages.length;i++){
        pages[i].push(`0.45 0.39 0.51 rg\nBT /F1 8 Tf 1 0 0 1 478 34 Tm (Page ${i+1} of ${pages.length}) Tj ET\n`);
    }
    const objects:string[]=[
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Kids [${pages.map((_,i)=>`${6+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>',
    ];
    pages.forEach((page,i)=>{
        const stream=page.join('');
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7+i*2} 0 R >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    });
    let raw='%PDF-1.4\n';const positions:number[]=[0];
    objects.forEach((object,i)=>{positions.push(raw.length);raw+=`${i+1} 0 obj\n${object}\nendobj\n`;});
    const xref=raw.length;
    raw+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
    for(const position of positions.slice(1))raw+=`${String(position).padStart(10,'0')} 00000 n \n`;
    raw+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const blob=new Blob([raw],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    const safe=(s:string)=>s.replace(/[^A-Za-z0-9_-]+/g,'_').slice(0,64);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download=`${safe(storeName)}_${safe(branchName)}_${safe(v.booking.reference||`Booking_${bookingId}`)}_Receipt.pdf`;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}

/** Download the exact portrait Billing receipt from the booking header's export action. */
export async function downloadBookingReceipt(bookingId:number,branchId:number):Promise<void>{
    const token=sessionStorage.getItem('token');
    if(!token)throw new Error('Login required to download the booking receipt.');
    const res=await fetch('/api/bookings',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({action:'get_booking_financial_statement',bookingId,branch_id:branchId||undefined}),
    });
    const data=await res.json();
    if(!res.ok||data.error||data.success===false||!data.statement)
        throw new Error(data.error||data.message||'Booking receipt is unavailable.');
    const statement=data.statement as Statement;
    const names=await resolveReceiptIdentity(statement,branchId);
    if(!names.storeName||!names.branchName)
        throw new Error('Store or branch name is unavailable. Verify the business details before exporting.');
    downloadBookingReceiptPdf(statement,bookingId,names);
}

// Item, quantity, per-unit price and line total have their own columns.
// Rental prices are daily rates; the existing rental duration stays visible below the name.
function ReceiptItemLine({name,quantity,unitPrice,amount,detail,ratePerDay=false}:{name:string;quantity:number;unitPrice:number;amount:number;detail?:string;ratePerDay?:boolean}){
    return <div className="grid grid-cols-[minmax(0,1fr)_32px_72px_76px] items-start gap-1.5 border-t border-[#F1EDF6] px-2 py-2 text-[10px] sm:grid-cols-[minmax(0,1fr)_44px_92px_92px] sm:gap-2 sm:px-3 sm:text-[11px]">
        <div className="min-w-0 break-words font-medium text-[#25153D]">
            {name}
            {detail&&<p className="mt-0.5 text-[10px] font-normal text-[#806A8C]">{detail}</p>}
        </div>
        <span className="text-center font-semibold tabular-nums text-[#25153D]">{quantity}</span>
        <span className="text-right font-medium tabular-nums text-[#25153D]">{money(unitPrice)}{ratePerDay&&<span className="block text-[9px] font-normal text-[#806A8C]">per day</span>}</span>
        <span className="text-right font-semibold tabular-nums text-[#25153D]">{money(amount)}</span>
    </div>;
}

type BillingReceiptProps={
    bookingId:number;
    branchId:number;
    // Kept for callers in Manager/Owner/Staff views; the Billing tab is always read-only.
    ownerView?:boolean;
    editable?:boolean;
};

export default function BookingFinancialPanel({bookingId,branchId}:BillingReceiptProps){
    const [statement,setStatement]=useState<Statement|null>(null);
    const [receiptIdentity,setReceiptIdentity]=useState<ReceiptIdentity>({storeName:'',branchName:''});
    const [error,setError]=useState('');
    const request=useCallback(async()=>{
        const token=sessionStorage.getItem('token');
        if(!token)throw new Error('Login required to view the booking receipt.');
        const res=await fetch('/api/bookings',{
            method:'POST',
            headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
            body:JSON.stringify({action:'get_booking_financial_statement',bookingId,branch_id:branchId||undefined}),
        });
        const data=await res.json();
        if(!res.ok||data.error||data.success===false||!data.statement)
            throw new Error(data.error||data.message||'Booking receipt is unavailable.');
        return data.statement as Statement;
    },[bookingId,branchId]);
    useEffect(()=>{
        let cancelled=false;
        setStatement(null);
        setReceiptIdentity({storeName:'',branchName:''});
        setError('');
        void (async()=>{
            try{
                const latest=await request();
                const names=await resolveReceiptIdentity(latest,branchId);
                if(!cancelled){setStatement(latest);setReceiptIdentity(names);}
            }catch(e){
                if(!cancelled)setError(e instanceof Error?e.message:'Could not load booking receipt.');
            }
        })();
        return()=>{cancelled=true;};
    },[request,branchId]);
    if(!statement)return <div role={error?'alert':'status'} className="rounded-xl border border-[#E6DDF0] bg-white p-4 text-xs text-[#806A8C]">{error||'Loading booking payment receipt…'}</div>;

    const v=statement;
    const agreedPrice=v.booking.agreedPrice==null?null:Number(v.booking.agreedPrice);
    const depositDue=Math.max(0,Number(v.depositRequired)-Number(v.depositCollected));
    const bookingDue=Math.max(0,Number(v.booking.balance));
    const claimDue=Math.max(0,Number(v.claimBalance));
    const charges=v.claims.filter(c=>c.status!=='waived');
    const approvedTotal=charges.reduce((sum,c)=>sum+Math.max(0,Number(c.amount)||0),0);
    const claimPayments=charges.reduce((sum,c)=>sum+Math.max(0,Number(c.amountPaid)||0),0);
    const cashCollected=Number(v.booking.bookingPayments)+Number(v.depositCollected)+claimPayments;
    const netReceived=cashCollected-Number(v.depositRefunded);
    const totalDue=bookingDue+depositDue+claimDue;
    const fullyReconciled=agreedPrice!==null&&totalDue<0.005&&Number(v.depositHeld)<0.005;
    const format=(value:number)=>money(Math.max(0,value));
    const hasItems=v.packageBase>0||(v.salesItems||[]).length>0||v.rentalItems.length>0||v.deliveryFee>0||v.setupFee>0;
    // Booking units = consumable quantity + rental quantity, not package/service line items.
    const totalBookedUnits=(v.salesItems||[]).reduce((sum,item)=>sum+Math.max(0,Number(item.quantity)||0),0)
        +v.rentalItems.reduce((sum,item)=>sum+Math.max(0,Number(item.quantity)||0),0);
    const itemizedSubtotal=Number(v.packageBase||0)+Number(v.deliveryFee||0)+Number(v.setupFee||0)
        +(v.salesItems||[]).reduce((sum,item)=>sum+(Number(item.amount)||0),0)
        +v.rentalItems.reduce((sum,item)=>sum+(Number(item.amount)||0),0);
    const receiptLine=(label:string,value:number,emphasis=false)=>
        <div key={label} className={`flex items-start justify-between gap-3 ${emphasis?'font-bold text-[#2B174C]':'text-[#6A587A]'}`}>
            <span>{label}</span><span className="shrink-0 tabular-nums text-right text-[#25153D]">{format(value)}</span>
        </div>;
    return <section className="mt-4 rounded-xl border border-[#E6DDF0] bg-white p-3 font-sans text-xs text-[#2B174C] sm:p-4" onClick={e=>e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
            <div>
                <h4 className="text-sm font-bold">Booking Payment Receipt</h4>
                <p className="mt-1 text-[11px] text-[#806A8C]">Read-only record of booking payments, deposits and customer charges</p>
            </div>
        </div>
        {error&&<p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">{error}</p>}
        <div id={`booking-receipt-${bookingId}`} className="mx-auto w-full max-w-[740px] overflow-hidden rounded-2xl border border-[#DED3E9] bg-white shadow-sm">
            <header className="border-b border-dashed border-[#D7CBE3] bg-[#FAF7FF] px-4 py-5 text-center sm:px-6">
                <p className="break-words text-[17px] font-extrabold text-[#2B174C]">{receiptIdentity.storeName||'Store name unavailable'}</p>
                <p className="mt-1 rounded-lg bg-[#EDE3FF] px-3 py-1.5 text-[11px] font-bold text-[#48227E]">Branch: {receiptIdentity.branchName||'Branch name unavailable'}</p>
                <h5 className="mt-3 text-[19px] font-extrabold tracking-tight text-[#241537]">BOOKING PAYMENT RECEIPT</h5>
                <p className="mt-1 text-[10px] text-[#806A8C]">Recorded transactions · Not a tax invoice</p>
            </header>
            <div className="grid gap-x-4 gap-y-3 border-b border-dashed border-[#D7CBE3] px-4 py-4 sm:grid-cols-2 sm:px-6">
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Booking reference</p><p className="mt-1 break-all text-[12px] font-semibold text-[#241537]">{v.booking.reference||`#${bookingId}`}</p></div>
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Customer</p><p className="mt-1 break-words text-[12px] font-semibold text-[#241537]">{v.booking.name||'—'}</p></div>
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Event date</p><p className="mt-1 font-semibold text-[#241537]">{v.booking.eventDate||'—'}</p></div>
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Booking status</p><p className="mt-1 font-semibold text-[#241537]">{v.booking.status||'—'}</p></div>
            </div>
            <div className="space-y-5 px-4 py-5 sm:px-6">
                <section aria-label="Booking charges" className="space-y-2">
                    <h6 className="border-b border-dashed border-[#DDD3E6] pb-2 text-[11px] font-bold uppercase tracking-wider text-[#4E2C85]">Booking charges</h6>
                    {hasItems&&<div className="overflow-hidden rounded-xl border border-[#E8DEF3] bg-white text-[11px]">
                        <div className="grid grid-cols-[minmax(0,1fr)_32px_72px_76px] gap-1.5 bg-[#F7F2FC] px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-[#6A5582] sm:grid-cols-[minmax(0,1fr)_44px_92px_92px] sm:gap-2 sm:px-3">
                            <span>Item / service</span>
                            <span className="text-center">Qty</span>
                            <span className="text-right">Unit price</span>
                            <span className="text-right">Total</span>
                        </div>
                        {v.packageBase>0&&<ReceiptItemLine name={v.booking.packageName?`Package · ${v.booking.packageName}`:'Package'} quantity={1} unitPrice={v.packageBase} amount={v.packageBase}/>}
                        {(v.salesItems||[]).length>0&&<div className="border-t border-[#EFE7F4] bg-[#FCFAFF] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#806A8C]">Consumable items</div>}
                        {(v.salesItems||[]).map((item,i)=><ReceiptItemLine key={`sale-${i}`} name={`${item.name}${item.variantName?` (${item.variantName})`:''}`} quantity={item.quantity} unitPrice={item.unitPrice} amount={item.amount}/>)}
                        {v.rentalItems.length>0&&<div className="border-t border-[#EFE7F4] bg-[#FCFAFF] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#806A8C]">Rental items</div>}
                        {v.rentalItems.map((item,i)=><ReceiptItemLine key={`rental-${i}`} name={item.name} detail={`${item.days} ${Number(item.days)===1?'day':'days'} rental`} quantity={item.quantity} unitPrice={item.dailyRate} amount={item.amount} ratePerDay/>)}
                        {(v.deliveryFee>0||v.setupFee>0)&&<div className="border-t border-[#EFE7F4] bg-[#FCFAFF] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#806A8C]">Other charges</div>}
                        {v.deliveryFee>0&&<ReceiptItemLine name="Delivery / pickup" quantity={1} unitPrice={v.deliveryFee} amount={v.deliveryFee}/>}
                        {v.setupFee>0&&<ReceiptItemLine name="Setup" quantity={1} unitPrice={v.setupFee} amount={v.setupFee}/>}
                        <div className="grid grid-cols-[minmax(0,1fr)_32px_72px_76px] items-center gap-1.5 border-t-2 border-[#E6DDF0] bg-[#FBF8FF] px-2 py-2.5 text-[10px] font-bold text-[#2B174C] sm:grid-cols-[minmax(0,1fr)_44px_92px_92px] sm:gap-2 sm:px-3 sm:text-[11px]">
                            <span>Total units needed</span>
                            <span className="text-center tabular-nums">{totalBookedUnits}</span>
                            <span aria-hidden="true" />
                            <span aria-hidden="true" />
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-[#E6DDF0] bg-[#FBF8FF] px-3 py-2 text-[11px] font-bold text-[#2B174C]">
                            <span>Itemized subtotal</span>
                            <span className="tabular-nums">{money(itemizedSubtotal)}</span>
                        </div>
                    </div>}
                    {receiptLine('Final agreed booking price',agreedPrice??0,true)}
                    {agreedPrice===null&&<p className="text-[10px] text-amber-700">Final price has not yet been agreed.</p>}
                    {receiptLine('Booking payments received',Number(v.booking.bookingPayments))}
                    <div className="border-t border-dashed border-[#DDD3E6] pt-2">{receiptLine('Remaining booking balance',bookingDue,true)}</div>
                </section>
                <section aria-label="Security deposit" className="space-y-2 rounded-xl border border-[#E8DEF3] bg-[#FBF8FF] p-3">
                    <h6 className="text-[11px] font-bold uppercase tracking-wider text-[#4E2C85]">Refundable security deposit</h6>
                    {receiptLine('Deposit required',Number(v.depositRequired))}
                    {receiptLine('Deposit collected',Number(v.depositCollected))}
                    {receiptLine('Deposit used for damage / missing charges',Number(v.depositApplied))}
                    {receiptLine('Deposit already refunded to customer',Number(v.depositRefunded))}
                    <div className="border-t border-dashed border-[#D8CBE7] pt-2">{receiptLine('Deposit still held',Number(v.depositHeld),true)}</div>
                    {depositDue>0.005&&receiptLine('Deposit still to collect',depositDue)}
                    <p className="pt-1 text-[10px] leading-4 text-[#806A8C]">Security deposits are refundable amounts held separately from booking revenue.</p>
                </section>
                <section aria-label="Damage and missing item charges" className="space-y-2">
                    <h6 className="border-b border-dashed border-[#DDD3E6] pb-2 text-[11px] font-bold uppercase tracking-wider text-[#4E2C85]">Damage / missing charges</h6>
                    {v.claims.length===0?<p className="text-[11px] text-[#806A8C]">No damage or missing-item charges recorded.</p>:
                        <div className="overflow-hidden rounded-xl border border-[#E8DEF3] bg-white text-[11px]">
                            <div className="grid grid-cols-[minmax(0,1fr)_50px_85px] gap-2 bg-[#F7F2FC] px-3 py-2 font-bold uppercase tracking-wide text-[#6A5582] sm:grid-cols-[minmax(0,1fr)_64px_100px]">
                                <span>Affected item</span><span className="text-center">Qty</span><span className="text-right">Charge</span>
                            </div>
                            {v.claims.map(claim=>{
                                const covered=isIncludedInCombinedCharge(claim,v.claims);
                                return <div key={claim.id} className="border-t border-[#F1EDF6]">
                                    <div className="grid grid-cols-[minmax(0,1fr)_50px_85px] items-start gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_64px_100px]">
                                        <div className="min-w-0 break-words font-semibold text-[#25153D]">
                                            {claim.equipmentName||`Equipment #${claim.sourceId}`}
                                            <p className="mt-0.5 text-[10px] font-normal text-[#806A8C]">
                                                {claim.sourceType==='missing'?'Missing':'Damaged'}
                                                {claim.status==='waived'&&!covered?' · Waived':''}
                                            </p>
                                        </div>
                                        <span className="text-center font-semibold tabular-nums text-[#25153D]">{claim.quantity}</span>
                                        <span className="text-right font-semibold tabular-nums text-[#25153D]">
                                            {covered?'Included':money(claim.status==='waived'?0:claim.amount)}
                                        </span>
                                    </div>
                                    {!covered&&claim.status!=='waived'&&<div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#F6F1F9] px-3 py-2 text-[10px] text-[#806A8C]">
                                        <span>Paid: {money(claim.amountPaid)}</span><span>Deposit used: {money(claim.depositApplied)}</span>
                                        <span>Due: {money(Math.max(0,claim.amount-claim.amountPaid-claim.depositApplied))}</span>
                                    </div>}
                                </div>;
                            })}
                            {combinedReceiptTotal(v.claims)>0&&<div className="flex items-center justify-between gap-3 border-t-2 border-[#D8CBE7] bg-[#FBF8FF] px-3 py-3 font-bold text-[#2B174C]">
                                <span>Combined charge for all affected equipment</span>
                                <span className="shrink-0 tabular-nums">{money(combinedReceiptTotal(v.claims))}</span>
                            </div>}
                        </div>}
                    {receiptLine('Total approved charges',approvedTotal)}
                    {receiptLine('Additional charge payments received',claimPayments)}
                    {receiptLine('Deposit applied to charges',Number(v.depositApplied))}
                    <div className="border-t border-dashed border-[#DDD3E6] pt-2">{receiptLine('Outstanding charges',claimDue,true)}</div>
                </section>
                <section aria-label="Payment totals" className="space-y-2 rounded-xl bg-[#F5F0FF] p-3">
                    <h6 className="text-[11px] font-bold uppercase tracking-wider text-[#4E2C85]">Payment summary</h6>
                    {receiptLine('Booking payments received',Number(v.booking.bookingPayments))}
                    {receiptLine('Security deposit collected',Number(v.depositCollected))}
                    {receiptLine('Additional charge payments received',claimPayments)}
                    <div className="border-t border-[#DFD1F3] pt-2">{receiptLine('Total money collected',cashCollected,true)}</div>
                    {receiptLine('Less: deposit refunded',Number(v.depositRefunded))}
                    <div className="border-t border-[#DFD1F3] pt-2">{receiptLine('Net cash received',netReceived,true)}</div>
                </section>
                <div className="rounded-xl bg-[#2B174C] px-4 py-4 text-white">
                    <div className="flex items-start justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#E5D9FF]">Total outstanding from customer</span>
                        <span className="text-[19px] font-extrabold tabular-nums">{agreedPrice===null?'Not set':format(totalDue)}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-[#E5D9FF]">Remaining booking balance + unpaid security deposit + unpaid approved charges.</p>
                </div>
                <p className="text-center text-[10px] leading-4 text-[#806A8C]">
                    {fullyReconciled?'Recorded booking payments and deposit are fully reconciled.':
                        'A deposit still held may require refund or application before final settlement.'}
                    <span className="mt-1 block">This is a financial record, not a tax invoice. No payments can be entered from the Billing tab.</span>
                </p>
            </div>
        </div>
    </section>;
}
