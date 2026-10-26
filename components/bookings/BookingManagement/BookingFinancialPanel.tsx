"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Copy, Phone, Mail } from "lucide-react";

type ClaimSource = {id:number;equipmentId:number;equipmentName?:string;quantity:number;reason:string;status?:string;decisionStatus?:string|null};
type Statement = {
    booking:{reference:string;name:string;bookingType:string;packageName:string;status:string;agreedPrice:number|null;downPayment:number;bookingPayments:number;balance:number};
    packageBase:number;salesSubtotal?:number;rentalSubtotal:number;deliveryFee:number;setupFee:number;
    depositRequired:number;depositCollected:number;depositApplied:number;depositRefunded:number;depositHeld:number;
    claimBalance:number;agreedCharges:number;
    rentalItems:{name:string;quantity:number;days:number;dailyRate:number;amount:number}[];
    salesItems?:{name:string;variantName?:string;quantity:number;unitPrice:number;amount:number}[];
    claims:{id:number;sourceType:string;sourceId:number;equipmentName?:string;quantity:number;reason:string;amount:number;amountPaid:number;depositApplied:number;status:string}[];
};
type CustomerReviewCase = {
    profile?:{reviewRequired:number|boolean;identityVerified:number|boolean;reason:string;updatedBy:string;updatedAt:string}|null;
    events:{id:number;eventType:string;notes:string;channel:string;followUpOn:string|null;actorName:string;createdAt:string}[];
    earlierOutstanding:{reference:string;due:number}[];
    contact?:{phone:string;email:string;facebookName:string};
    claimDue:number;latestScheduledFollowUp?:string|null;followUpOverdue?:boolean;bookingStatus:string;identityLookupAvailable:boolean;
};
const money=(n:number)=>`₱${Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

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
        text('BOOKING RECEIPT',left,713,16,true,'0.17 0.09 0.30');
        text('Itemized sales and rental receipt - Not a tax invoice',left,697,8.5,false,'0.45 0.38 0.52');
    };
    const tableHeading=()=>{
        rect(left,y-9,right-left,25,'0.96 0.94 0.99');
        text('ITEM / SERVICE',left+7,y,8,true);
        text('QTY',325,y,8,true);
        text('UNIT RATE',372,y,8,true);
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
    ensure(18);rule();y-=21;
    inItems=false;
    const isAgreed=v.booking.agreedPrice!==null&&Number.isFinite(Number(v.booking.agreedPrice));
    const depositDue=Math.max(0,Number(v.depositRequired)-Number(v.depositCollected));
    summary('Itemized subtotal',pesoPdf(v.agreedCharges));
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
    // Approved charges belong on the receipt only as monetary settlement lines.
    if(Number(v.claimBalance)>0){
        ensure(45);y-=8;rule();y-=16;
        summary('Outstanding approved damage/loss charges',pesoPdf(v.claimBalance),true);
    }
    ensure(69);
    y-=10;
    rect(left,y-49,right-left,62,'0.18 0.10 0.30');
    text('TOTAL TO COLLECT BEFORE RELEASE',left+13,y-6,9,true,'0.87 0.80 0.98');
    const due=isAgreed?pesoPdf(Math.max(0,Number(v.booking.balance))+depositDue):'Awaiting agreement';
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

export default function BookingFinancialPanel({bookingId,branchId,ownerView=false,editable=true}:{bookingId:number;branchId:number;ownerView?:boolean;editable?:boolean}){
    const [statement,setStatement]=useState<Statement|null>(null);
    const [receiptIdentity,setReceiptIdentity]=useState<ReceiptIdentity>({storeName:'',branchName:''});
    const [exporting,setExporting]=useState(false);
    const [viewerRole,setViewerRole]=useState('staff');const [canWrite,setCanWrite]=useState(false);
    const [sources,setSources]=useState<{missing:ClaimSource[];damage:ClaimSource[]}>({missing:[],damage:[]});
    const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
    const [eventType,setEventType]=useState('deposit_received');
    const [amount,setAmount]=useState('');const [claimId,setClaimId]=useState('');
    const [sourceType,setSourceType]=useState('damage');const [sourceId,setSourceId]=useState('');
    const [claimAmount,setClaimAmount]=useState('');const [reason,setReason]=useState('');
    const [customerCase,setCustomerCase]=useState<CustomerReviewCase|null>(null);
    const [caseType,setCaseType]=useState('contact_attempt');const [caseChannel,setCaseChannel]=useState('phone');
    const [caseNotes,setCaseNotes]=useState('');const [caseFollowUp,setCaseFollowUp]=useState('');
    const [identityVerified,setIdentityVerified]=useState(false);
    const [waiveExistingId,setWaiveExistingId]=useState('');
    const [waiveExistingReason,setWaiveExistingReason]=useState('');
    // Backend checks current account role and branch on EVERY action.
    const request=useCallback(async (action:string,additional:Record<string,unknown>={})=>{
        const token=sessionStorage.getItem('token');if(!token)throw new Error('Login required.');
        const res=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
            body:JSON.stringify({action,bookingId,branch_id:branchId||undefined,...additional})});
        const json=await res.json();if(!res.ok||json.error)throw new Error(json.error||'Request failed.');
        return json;
    },[bookingId,branchId]);
    const refresh=useCallback(async()=>{
        try{
            const data=await request('get_booking_financial_statement');setStatement(data.statement);setViewerRole(data.viewerRole||'staff');setCanWrite(!!data.canWrite);
            if(data.statement){
                const names=await resolveReceiptIdentity(data.statement as Statement,branchId);
                setReceiptIdentity(names);
            }else setReceiptIdentity({storeName:'',branchName:''});
            if(!ownerView){const tasks=await request('get_booking_claim_sources');setSources({missing:tasks.missing||[],damage:tasks.damage||[]});}
            if(!ownerView&&data.viewerRole==='manager'){const review=await request('get_customer_review_case');setCustomerCase(review.case||null);}else setCustomerCase(null);
            setError('');
        }catch(e){setError(e instanceof Error?e.message:'Could not load booking statement.');}
    },[request,ownerView,branchId]);
    useEffect(()=>{void refresh();},[refresh]);
    useEffect(()=>{setNotice('');setSourceId('');setClaimAmount('');setReason('');setWaiveExistingId('');setWaiveExistingReason('');},[bookingId]);
    async function exportReceipt(){
        if(exporting)return;
        setExporting(true);setError('');
        try{
            // Download a fresh statement so the PDF reflects the latest recorded payments.
            const data=await request('get_booking_financial_statement');
            if(!data.statement)throw new Error('The booking receipt is unavailable.');
            setStatement(data.statement);
            const names=await resolveReceiptIdentity(data.statement as Statement,branchId);
            setReceiptIdentity(names);
            if(!names.storeName || !names.branchName){
                throw new Error('Store or branch name is unavailable. Verify your store/branch settings before exporting the receipt.');
            }
            downloadBookingReceiptPdf(data.statement as Statement,bookingId,names);
        }catch(e){setError(e instanceof Error?e.message:'Could not download booking receipt.');}
        finally{setExporting(false);}
    }
    async function record(){
        const n=Number(amount);if(!Number.isFinite(n)||n<=0){setError('Enter an amount greater than zero.');return;}
        setBusy(true);setError('');
        try{
            await request('record_booking_financial_event',{eventType,amount:n,
                claimId:['deposit_applied','claim_paid'].includes(eventType)?Number(claimId):undefined,
                requestKey:crypto.randomUUID()});setAmount('');await refresh();
        }catch(e){setError(e instanceof Error?e.message:'Unable to save financial movement.');}finally{setBusy(false);}
    }
    function selectedDecisionSourcePresent(){
        return (sourceType==='damage'?sources.damage:sources.missing).some(item=>
            String(item.id)===sourceId && !item.decisionStatus &&
            (sourceType==='damage'||item.status==='writeoff'));
    }
    async function decideClaim(waive:boolean){
        if(reason.trim().length<10){setError('Document the charge or waiver reason (at least 10 characters).');return;}
        if(!selectedDecisionSourcePresent()){setError('Select one documented equipment incident.');return;}
        if(!waive&&(!Number.isFinite(Number(claimAmount))||Number(claimAmount)<=0)){
            setError('Enter an approved repair/replacement charge greater than zero.');return;
        }
        setBusy(true);setError('');
        try{await request(waive?'waive_booking_claim':'approve_booking_claim',{
            sourceType,sourceId:Number(sourceId),...(waive?{}:{amount:Number(claimAmount)}),reason:reason.trim()});
            setSourceId('');setClaimAmount('');setReason('');await refresh();
            setNotice(waive?'Customer charge waived. The equipment incident and maintenance record remain unchanged.':'Customer charge approved. Record payment or apply an eligible deposit separately.');}
        catch(e){setError(e instanceof Error?e.message:'Unable to record Manager decision.');}finally{setBusy(false);}
    }
    async function manageCustomerCase(action:string,extra:Record<string,unknown>={}) {
        if(caseNotes.trim().length<10){setError('Enter a documented reason or customer contact note (10+ characters).');return;}
        setBusy(true);setError('');
        try {
            await request(action,{notes:caseNotes.trim(),channel:caseChannel,
                followUpOn:caseFollowUp||undefined,...extra});
            setCaseNotes('');setCaseFollowUp('');setIdentityVerified(false);setWaiveExistingId('');
            await refresh();
        } catch(e) {setError(e instanceof Error?e.message:'Unable to save customer case update.');}
        finally {setBusy(false);}
    }
    async function copyCustomerNotice(kind:'issue'|'payment'){
        if(!statement)return;
        const client=statement.booking.name||'Customer';
        const business=receiptIdentity.storeName||'our event rental store';
        const reference=statement.booking.reference;
        let message='';
        if(kind==='issue'){
            const reports=[
                ...sources.damage.filter(c=>!c.decisionStatus).map(c=>`${c.equipmentName||`Equipment #${c.equipmentId}`} — ${c.quantity} damaged`),
                ...sources.missing.filter(c=>!c.decisionStatus).map(c=>`${c.equipmentName||`Equipment #${c.equipmentId}`} — ${c.quantity} missing (${c.status==='writeoff'?'confirmed loss':'under investigation'})`),
            ];
            if(!reports.length){setError('No incident awaiting review for this booking.');return;}
            message=`Hello ${client}, this is ${business} regarding booking ${reference}. During our equipment return check we documented the following: ${reports.join('; ')}. We would like to discuss the return record and give you an opportunity to clarify these findings. No additional charge is being requested by this message. Please contact our store regarding this booking. Thank you.`;
        }else{
            const claims=statement.claims.filter(c=>c.status==='approved'&&c.amount-c.amountPaid-c.depositApplied>0.005);
            if(!claims.length){setError('No outstanding approved equipment claims for this booking.');return;}
            const lines=claims.map(c=>`${c.equipmentName||`Equipment #${c.sourceId}`} (${c.sourceType==='missing'?'missing':'damage'}, ${c.quantity} unit(s)): ${money(Math.max(0,c.amount-c.amountPaid-c.depositApplied))} due`);
            const due=claims.reduce((sum,c)=>sum+Math.max(0,c.amount-c.amountPaid-c.depositApplied),0);
            message=`Hello ${client}, this is ${business} about booking ${reference}. Following our documented equipment return assessment, these approved charges remain outstanding:\n${lines.join('\n')}\nTotal amount due: ${money(due)}. Please contact our store for an itemized explanation, to discuss any concern, or to arrange settlement. Any eligible security deposit already applied is reflected in the balances above. Thank you.`;
        }
        try{
            if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable in this browser.');
            await navigator.clipboard.writeText(message);
            setError('');setNotice('Message copied. Send it through your chosen channel, then separately record the real contact attempt or notice.');
        }catch(e){setError(e instanceof Error?e.message:'Unable to copy the customer message.');}
    }
    async function waiveApprovedUnpaidClaim(){
        const selected=statement?.claims.find(claim=>String(claim.id)===waiveExistingId);
        if(!selected||selected.status!=='approved'||selected.amountPaid>0||selected.depositApplied>0){
            setError('Choose an approved claim without any payment or deposit applied.');return;
        }
        if(waiveExistingReason.trim().length<10){
            setError('Explain why the customer charge is being waived (at least 10 characters).');return;
        }
        if(!window.confirm(`Waive the customer charge for ${selected.equipmentName||'this equipment'}? This records a financial decision; it does not remove the equipment incident.`))return;
        setBusy(true);setError('');
        try{
            await request('waive_unpaid_customer_claim',{claimId:selected.id,notes:waiveExistingReason.trim(),channel:'none'});
            setWaiveExistingId('');setWaiveExistingReason('');await refresh();
            setNotice('Approved charge waived after investigation. The original equipment incident remains recorded.');
        }catch(e){setError(e instanceof Error?e.message:'Unable to waive this claim.');}
        finally{setBusy(false);}
    }
    if(!statement)return <div className="rounded-xl border border-[#E6DDF0] p-3 text-xs text-[#806A8C]">{error||'Loading itemized booking statement…'}</div>;
    const v=statement;
    const undecidedMissing=sources.missing.filter(c=>!c.decisionStatus&&c.status==='writeoff');
    const undecidedDamage=sources.damage.filter(c=>!c.decisionStatus);
    const reviewNeeded=sources.missing.some(c=>c.status==='pending');
    // Missing-item contact starts during investigation, not only after a write-off.
    const issueReports=[...sources.damage.filter(c=>!c.decisionStatus),...sources.missing.filter(c=>!c.decisionStatus)];
    // One combined booking-scoped incident list: never ask the Manager to choose an
    // incident type before they can even see the affected equipment.
    const pendingIncidents = [
        ...undecidedDamage.map(item=>({...item,type:'damage' as const})),
        ...undecidedMissing.map(item=>({...item,type:'missing' as const})),
    ];
    const selectedSource=pendingIncidents.find(item=>item.type===sourceType&&String(item.id)===sourceId)||null;
    const waiverCandidates=v.claims.filter(c=>c.status==='approved'&&c.amountPaid<=0&&c.depositApplied<=0);
    const depositDue=Math.max(0,Number(v.depositRequired)-Number(v.depositCollected));
    const releaseDue=Math.max(0,Number(v.booking.balance))+depositDue;
    const refundableAfterClaims=Math.max(0,Number(v.depositHeld)-Number(v.claimBalance));
    const quoteAgreed=v.booking.agreedPrice!==null && Number.isFinite(Number(v.booking.agreedPrice));
    const hasChargeLines=v.packageBase>0 || (v.salesItems||[]).length>0 || v.rentalItems.length>0 || v.deliveryFee>0 || v.setupFee>0;
    return <section className="mt-4 rounded-xl border border-[#E6DDF0] bg-white p-3 text-xs text-[#2B174C] sm:p-4" onClick={e=>e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
                <h4 className="text-sm font-bold">Booking billing &amp; settlement</h4>
                <p className="mt-1 text-[11px] text-[#806A8C]">Itemized booking receipt and settlement summary</p>
            </div>
            <button type="button" onClick={()=>void exportReceipt()} disabled={exporting} title="Download booking receipt as PDF" aria-label="Download booking receipt as PDF" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#D8CBE7] bg-white text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:cursor-wait disabled:opacity-50"><Download size={17} aria-hidden="true" /></button>
        </div>
        <p className="my-2 text-[#806A8C]">Agreed booking amounts remain separate from refundable deposits and loss/damage claims.</p>
        {notice&&<p role="status" className="mt-2 rounded-lg border border-[#D8E8D8] bg-[#F3FAF3] px-3 py-2 text-[#226B36]">{notice}</p>}
        {error&&<p role="alert" className="mt-2 rounded-lg border border-[#F1D2D2] bg-[#FFF4F4] px-3 py-2 text-[#A32828]">{error}</p>}
        {!ownerView&&editable&&canWrite&&viewerRole==='manager'&&<div className="mt-3 space-y-3 rounded-xl border border-[#E3D8EA] bg-[#FCFAFF] p-3" aria-label="Equipment damage or missing charge decision">
            <div>
                <h5 className="text-sm font-bold text-[#21132E]">Equipment Damage / Missing — Customer Charge Decision</h5>
                <p className="mt-1 text-[#806A8C]">After the equipment is checked, decide whether the customer owes a justified repair/replacement charge or the business will waive it. Repair approval alone does not charge the customer.</p>
            </div>
            {reviewNeeded&&<p className="rounded-lg border border-[#F2DDB4] bg-[#FFF8E9] px-3 py-2 text-[#8A5A00]">Missing items are still being investigated. Confirm the loss in Manager Rental Inventory before deciding on a replacement charge.</p>}
            {(undecidedMissing.length+undecidedDamage.length)===0 ? <div className="rounded-lg border border-[#E8E0EE] bg-white px-3 py-3 text-[#806A8C]">
                {sources.missing.length+sources.damage.length===0?'No booking-linked missing or confirmed damage incidents have been recorded for this booking.':'No equipment incidents are awaiting a charge or waiver decision. See recorded decisions below.'}
            </div> : <>
                <div className="space-y-2" role="group" aria-label="Booking equipment incidents awaiting a charge decision">
                    <p className="font-semibold text-[#21132E]">Select the affected equipment ({pendingIncidents.length} awaiting decision)</p>
                    {pendingIncidents.map(item=>{
                        const isSelected=sourceId===String(item.id)&&sourceType===item.type;
                        return <button type="button" key={`${item.type}-${item.id}`} aria-pressed={isSelected}
                                       onClick={()=>{setSourceType(item.type);setSourceId(String(item.id));setClaimAmount('');setReason('');}}
                                       className={`w-full rounded-xl border px-3 py-3 text-left transition ${isSelected?'border-[#6D46B5] bg-[#F2ECFF]':'border-[#E3D8EA] bg-white hover:bg-[#FAF7FF]'}`}>
                            <span className="flex flex-wrap items-center justify-between gap-2">
                                <strong className="text-[#21132E]">{item.equipmentName||`Equipment #${item.equipmentId}`}</strong>
                                <span className="rounded-full bg-[#F5F0FF] px-2.5 py-1 text-[11px] font-semibold text-[#4E2C66]">
                                    {item.type==='damage'?'Confirmed damage':'Confirmed loss'} · {item.quantity} {item.quantity===1?'unit':'units'}
                                </span>
                            </span>
                            <span className="mt-1 block break-words text-[#806A8C]">{item.reason||'No additional incident notes'} · Report #{item.id}</span>
                            <span className="mt-1 block text-[11px] font-semibold text-[#5330B6]">{isSelected?'Selected for Manager decision':'Select to assess charge or waiver'}</span>
                        </button>;
                    })}
                </div>
                <label className="block font-semibold">Proposed customer charge (₱) — required only when approving
                    <input type="number" min="0.01" step="0.01" value={claimAmount} onChange={e=>setClaimAmount(e.target.value)} placeholder="Actual documented repair/replacement cost" className="mt-1 w-full rounded-lg border border-[#E3D8EA] bg-white p-2 font-normal"/>
                </label>
                <label className="block font-semibold">Reason / evidence for charging or waiving
                    <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Describe the condition, liability assessment, agreement and why the charge applies or is waived (at least 10 characters)" className="mt-1 w-full rounded-lg border border-[#E3D8EA] bg-white p-2 font-normal" rows={3}/>
                </label>
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy||!selectedSource||reason.trim().length<10||!(Number(claimAmount)>0)} onClick={()=>void decideClaim(false)} className="rounded-lg bg-[#2B174C] px-3 py-2 font-semibold text-white disabled:opacity-50">Approve customer charge</button>
                    <button type="button" disabled={busy||!selectedSource||reason.trim().length<10} onClick={()=>void decideClaim(true)} className="rounded-lg border border-[#D8CBE7] bg-white px-3 py-2 font-semibold text-[#2B174C] disabled:opacity-50">Waive — no customer charge</button>
                </div>
                <p className="text-[11px] text-[#806A8C]">A waiver records ₱0 due for this incident. It does not cancel the repair task, replace a missing item, or automatically send a message to the customer.</p>
            </>}
        </div>}
        <div id={`booking-receipt-${bookingId}`} className="mx-auto mt-3 w-full max-w-[740px] overflow-hidden rounded-2xl border border-[#DED3E9] bg-white shadow-sm">
            <header className="border-b border-dashed border-[#D7CBE3] bg-[#FAF7FF] px-4 py-5 text-center sm:px-6">
                <p className="break-words text-[17px] font-extrabold text-[#2B174C]">{receiptIdentity.storeName||'Store name unavailable'}</p>
                <p className="mt-1 rounded-lg bg-[#EDE3FF] px-3 py-1.5 text-[11px] font-bold text-[#48227E]">Branch: {receiptIdentity.branchName||'Branch name unavailable'}</p>
                <h5 className="mt-1 text-[20px] font-extrabold tracking-tight text-[#241537]">BOOKING RECEIPT</h5>
                <p className="mt-1 text-[11px] text-[#806A8C]">Itemized statement · Not a tax invoice</p>
            </header>

            <div className="grid gap-x-4 gap-y-3 border-b border-dashed border-[#D7CBE3] px-4 py-4 sm:grid-cols-2 sm:px-6">
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Booking reference</p><p className="mt-1 break-all text-[12px] font-semibold text-[#241537]">{v.booking.reference||`#${bookingId}`}</p></div>
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Customer</p><p className="mt-1 break-words text-[12px] font-semibold text-[#241537]">{v.booking.name||'—'}</p></div>
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Booking type</p><p className="mt-1 font-medium text-[#241537]">{v.booking.bookingType||'—'}</p></div>
                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8B7C95]">Booking status</p><p className="mt-1 font-semibold text-[#241537]">{v.booking.status||'—'}</p></div>
            </div>

            <div className="px-3 py-4 sm:px-6 sm:py-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <h6 className="text-[12px] font-bold uppercase tracking-wide text-[#241537]">Order details</h6>
                    <span className="text-[10px] font-medium text-[#887B99]">PHP (₱)</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_38px_76px_83px] gap-1.5 border-y border-dashed border-[#DED3E9] bg-[#FCFAFF] px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-[#806A8C] sm:grid-cols-[minmax(0,1fr)_48px_100px_110px] sm:gap-2">
                    <span>Item / service</span><span className="text-center">Qty</span><span className="text-right">Unit rate</span><span className="text-right">Amount</span>
                </div>
                <div className="space-y-0.5 py-1">
                    {v.packageBase>0&&<div className="grid grid-cols-[minmax(0,1fr)_38px_76px_83px] items-start gap-1.5 px-2 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_48px_100px_110px] sm:gap-2">
                        <span className="min-w-0 break-words font-medium">Package base{v.booking.packageName?` · ${v.booking.packageName}`:''}</span><span className="text-center tabular-nums">1</span><span className="text-right tabular-nums">{money(v.packageBase)}</span><strong className="text-right tabular-nums">{money(v.packageBase)}</strong>
                    </div>}
                    {(v.salesItems||[]).length>0&&<p className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5A35A5]">Consumable items</p>}
                    {(v.salesItems||[]).map((item,index)=><div key={`sales-${index}`} className="grid grid-cols-[minmax(0,1fr)_38px_76px_83px] items-start gap-1.5 px-2 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_48px_100px_110px] sm:gap-2">
                        <span className="min-w-0 break-words font-medium text-[#241537]">{item.name}{item.variantName?` (${item.variantName})`:''}</span>
                        <span className="text-center tabular-nums">{item.quantity}</span>
                        <span className="text-right tabular-nums text-[#5F4E75]">{money(item.unitPrice)}</span>
                        <strong className="text-right tabular-nums text-[#241537]">{money(item.amount)}</strong>
                    </div>)}
                    {v.rentalItems.length>0&&<p className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5A35A5]">Rental items</p>}
                    {v.rentalItems.map((item,index)=><div key={`rental-${index}`} className="grid grid-cols-[minmax(0,1fr)_38px_76px_83px] items-start gap-1.5 px-2 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_48px_100px_110px] sm:gap-2">
                        <span className="min-w-0 break-words font-medium text-[#241537]">{item.name}<span className="mt-0.5 block text-[10px] font-normal text-[#806A8C]">{item.days} {Number(item.days)===1?'day':'days'} rental</span></span>
                        <span className="text-center tabular-nums">{item.quantity}</span>
                        <span className="text-right tabular-nums text-[#5F4E75]">{money(item.dailyRate)}<span className="block text-[9px]">/day</span></span>
                        <strong className="text-right tabular-nums text-[#241537]">{money(item.amount)}</strong>
                    </div>)}
                    {(v.deliveryFee>0||v.setupFee>0)&&<p className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5A35A5]">Other charges</p>}
                    {v.deliveryFee>0&&<div className="grid grid-cols-[minmax(0,1fr)_38px_76px_83px] gap-1.5 px-2 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_48px_100px_110px] sm:gap-2"><span>Delivery / pickup</span><span className="text-center">1</span><span className="text-right tabular-nums">{money(v.deliveryFee)}</span><strong className="text-right tabular-nums">{money(v.deliveryFee)}</strong></div>}
                    {v.setupFee>0&&<div className="grid grid-cols-[minmax(0,1fr)_38px_76px_83px] gap-1.5 px-2 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_48px_100px_110px] sm:gap-2"><span>Setup</span><span className="text-center">1</span><span className="text-right tabular-nums">{money(v.setupFee)}</span><strong className="text-right tabular-nums">{money(v.setupFee)}</strong></div>}
                    {!hasChargeLines&&<p className="py-4 text-center text-[11px] text-[#806A8C]">No itemized charges available.</p>}
                </div>
                <div className="space-y-2 border-t border-dashed border-[#DED3E9] px-2 py-3">
                    <div className="flex items-center justify-between gap-3 text-[11px]"><span className="text-[#806A8C]">Itemized charge subtotal</span><strong className="tabular-nums">{money(v.agreedCharges)}</strong></div>
                    <div className="flex items-center justify-between gap-3 text-[12px] font-bold"><span>Final agreed booking price</span><span className="text-right tabular-nums">{quoteAgreed?money(Number(v.booking.agreedPrice)):'Awaiting agreement'}</span></div>
                    <div className="flex items-center justify-between gap-3 text-[11px]"><span className="text-[#806A8C]">Booking payments received</span><strong className="tabular-nums">− {money(v.booking.bookingPayments)}</strong></div>
                    <div className="flex items-center justify-between gap-3 border-t border-[#EFE7F4] pt-2 text-[12px] font-bold"><span>Remaining booking balance</span><span className="text-right tabular-nums">{quoteAgreed?money(v.booking.balance):'Awaiting agreement'}</span></div>
                    <p className="text-[10px] leading-4 text-[#806A8C]">The agreed price is separate from the original itemized estimate.</p>
                </div>

                <div className="mt-3 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] px-3 py-3 sm:px-4">
                    <h6 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#4E2C85]">Refundable security deposit</h6>
                    <div className="space-y-2 text-[11px]">
                        <div className="flex justify-between gap-3"><span>Required deposit</span><strong className="tabular-nums">{money(v.depositRequired)}</strong></div>
                        <div className="flex justify-between gap-3"><span>Deposit collected</span><strong className="tabular-nums">{money(v.depositCollected)}</strong></div>
                        <div className="flex justify-between gap-3 font-semibold"><span>Deposit still due</span><strong className="tabular-nums">{money(depositDue)}</strong></div>
                        <div className="border-t border-dashed border-[#D8CBE7] pt-2">
                            <div className="flex justify-between gap-3"><span>Applied to approved claims</span><strong className="tabular-nums">{money(v.depositApplied)}</strong></div>
                            <div className="mt-2 flex justify-between gap-3"><span>Deposit refunded</span><strong className="tabular-nums">{money(v.depositRefunded)}</strong></div>
                            <div className="mt-2 flex justify-between gap-3 font-semibold"><span>Deposit currently held</span><strong className="tabular-nums">{money(v.depositHeld)}</strong></div>
                            <div className="mt-2 flex justify-between gap-3"><span>Potential refundable amount after unsettled claims</span><strong className="tabular-nums">{money(refundableAfterClaims)}</strong></div>
                        </div>
                    </div>
                </div>

                <div className="mt-4 rounded-xl bg-[#2B174C] px-4 py-4 text-white">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#D9CDED]">Total to collect before release</p>
                    <p className="mt-1 text-[24px] font-extrabold tracking-tight tabular-nums sm:text-[28px]">{quoteAgreed?money(releaseDue):'Awaiting agreement'}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#E6DCF1]">
                        <span>Remaining booking balance + outstanding refundable deposit</span>
                    </div>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-[#806A8C]">The refundable deposit is not a booking sale. It is held separately and settled after rental return and inspection.</p>

                <div className="mt-5 border-t border-dashed border-[#D7CBE3] pt-4">
                    <h6 className="text-[11px] font-bold uppercase tracking-wide text-[#241537]">Damage / loss settlement</h6>
                    {v.claims.length===0?<p className="mt-2 text-[11px] text-[#806A8C]">No approved equipment claims.</p>:<div className="mt-2 space-y-3">
                        {v.claims.map(claim=><div key={claim.id} className="rounded-lg border border-[#EFE7F4] p-2 text-[11px]">
                            <p className="font-semibold">{claim.equipmentName||`Equipment #${claim.sourceId}`} · {claim.sourceType==='missing'?'Missing':'Damage'} · {claim.quantity} {claim.quantity===1?'unit':'units'}</p>
                            <p className="mt-1 break-words text-[#806A8C]">{claim.reason}</p>
                            <div className="mt-1 flex justify-between gap-2"><span>Approved: {money(claim.amount)} · {claim.status}</span><strong className="tabular-nums">Due {money(Math.max(0,claim.amount-claim.amountPaid-claim.depositApplied))}</strong></div>
                        </div>)}
                    </div>}
                    <div className="mt-3 flex justify-between gap-2 border-t border-dashed border-[#DED3E9] pt-2 text-[11px] font-bold"><span>Outstanding customer claims</span><strong className="tabular-nums">{money(v.claimBalance)}</strong></div>
                </div>
                <p className="mt-5 border-t border-dashed border-[#D7CBE3] pt-4 text-center text-[10px] leading-4 text-[#8B7C95]">{receiptIdentity.storeName||'Store name unavailable'} · {receiptIdentity.branchName||'Branch name unavailable'}<br/>For reference only · Not a tax invoice</p>
            </div>
        </div>
        <div className="mt-3 space-y-2 border-t border-[#E9E1EE] pt-3">
            <h5 className="font-bold">Equipment damage / loss charge decisions</h5>
            {v.claims.length===0?<p className="text-[#806A8C]">No equipment-charge or waiver decisions recorded for this booking.</p>:
                v.claims.map(c=>{const due=Math.max(0,c.amount-c.amountPaid-c.depositApplied);return <div key={c.id} className="rounded-lg border border-[#E9E1EE] bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-[#21132E]">{c.equipmentName||`Equipment #${c.sourceId}`} · {c.quantity} {c.quantity===1?'unit':'units'}</strong>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${c.status==='waived'?'bg-[#F1ECF9] text-[#5A3C78]':due>0.005?'bg-[#FFF2D9] text-[#956000]':'bg-[#E6F6EA] text-[#226B36]'}`}>{c.status==='waived'?'Charge waived':due>0.005?'Payment outstanding':'Settled'}</span>
                    </div>
                    <p className="mt-1 text-[#806A8C]">{c.sourceType==='missing'?'Missing equipment':'Damaged equipment'} · Claim #{c.id}</p>
                    <p className="mt-1 break-words text-[#5F4E75]">Decision: {c.reason}</p>
                    {c.status==='waived'?<p className="mt-1 font-semibold">Customer charge: ₱0.00 (waived)</p>:
                        <p className="mt-1">Approved: {money(c.amount)} · Paid: {money(c.amountPaid)} · Deposit applied: {money(c.depositApplied)} · <strong>Due: {money(due)}</strong></p>}
                </div>})}
            <p className="mt-1 font-bold">Outstanding customer claims: {money(v.claimBalance)}</p>
        </div>
        {!ownerView&&editable&&canWrite&&viewerRole==='manager'&&<div className="mt-3 space-y-2 border-t pt-3">
            <h5 className="font-bold">Record deposit or claim payment</h5>
            <select className="w-full rounded-lg border p-2" value={eventType} onChange={e=>setEventType(e.target.value)}>
                <option value="deposit_received">Deposit collected</option>{viewerRole==='manager'&&<option value="deposit_refunded">Deposit refunded (Manager authorization)</option>}
                {viewerRole==='manager'&&<option value="deposit_applied">Apply deposit to approved claim (Manager)</option>}
                <option value="claim_paid">Customer paid approved claim</option>
            </select>
            {['claim_paid','deposit_applied'].includes(eventType)&&<select value={claimId} onChange={e=>setClaimId(e.target.value)} className="w-full rounded-lg border p-2">
                <option value="">Select approved claim</option>{v.claims.filter(c=>c.status==='approved').map(c=><option key={c.id} value={c.id}>{c.equipmentName||`Equipment #${c.sourceId}`} · {c.sourceType==='missing'?'Missing':'Damage'} · {money(c.amount-c.amountPaid-c.depositApplied)} due</option>)}
            </select>}
            <input aria-label="Transaction amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount (₱)" className="w-full rounded-lg border p-2"/>
            <button type="button" disabled={busy} onClick={()=>void record()} className="rounded-lg bg-[#2B174C] px-3 py-2 font-bold text-white disabled:opacity-50">Save transaction</button>
        </div>}

        {!ownerView&&viewerRole==='manager'&&canWrite&&customerCase&&<div className="mt-4 space-y-3 border-t border-[#E9E1EE] pt-4">
            <div>
                <h5 className="font-bold">Customer incident follow-up &amp; future booking review</h5>
                <p className="mt-1 text-[#806A8C]">Managers record contact attempts and decisions here. Saving an activity does not actually send a message or collect money. Flags apply only to this store and must be based on independently verified customer identity.</p>
            </div>
            <div className="rounded-xl border border-[#E3D8EA] bg-[#FCFAFF] p-3" aria-label="Customer contact for equipment incident">
                <h6 className="font-bold text-[#21132E]">Contact customer about damaged or missing equipment</h6>
                <p className="mt-1 text-[#806A8C]">Explain the documented issue first. Charge only after a separate Manager decision; send the message yourself and then record what actually happened below.</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {customerCase.contact?.phone?<a href={`tel:${customerCase.contact.phone.replace(/[^\d+]/g,'')}`} className="inline-flex items-center gap-1 font-semibold text-[#5330B6] hover:underline"><Phone size={13}/>{customerCase.contact.phone}</a>:<span className="text-[#806A8C]">Phone unavailable — see Overview</span>}
                    {customerCase.contact?.email&&<a href={`mailto:${customerCase.contact.email}`} className="inline-flex items-center gap-1 break-all text-[#5330B6] hover:underline"><Mail size={13}/>{customerCase.contact.email}</a>}
                    {customerCase.contact?.facebookName&&<span className="text-[#5F4E75]">Facebook: {customerCase.contact.facebookName}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {issueReports.length>0&&<button type="button" onClick={()=>void copyCustomerNotice('issue')} className="inline-flex items-center gap-2 rounded-lg border border-[#D8CBE7] bg-white px-3 py-2 font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"><Copy size={14}/> Copy issue notice</button>}
                    {v.claims.some(c=>c.status==='approved'&&c.amount-c.amountPaid-c.depositApplied>0.005)&&<button type="button" onClick={()=>void copyCustomerNotice('payment')} className="inline-flex items-center gap-2 rounded-lg border border-[#D8CBE7] bg-white px-3 py-2 font-semibold text-[#2B174C] hover:bg-[#F7F1FF]"><Copy size={14}/> Copy itemized payment request</button>}
                </div>
                {issueReports.length===0&&!v.claims.some(c=>c.status==='approved'&&c.amount-c.amountPaid-c.depositApplied>0.005)&&<p className="mt-2 text-[#806A8C]">No pending equipment decision or unpaid equipment claim on this booking.</p>}
                <p className="mt-2 text-[11px] text-[#806A8C]">Copying is not sending. Use phone, SMS, Messenger or email manually. Choose “Notice actually sent” only after the message was sent, or “Contact attempt” if the customer did not respond.</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F7F1FF] p-3">
                <div><strong>{customerCase.profile?.reviewRequired?'Manager review required':'No active future-booking restriction'}</strong>
                    <p className="text-[#806A8C]">Outstanding charge on this booking: {money(customerCase.claimDue)}</p>
                    {customerCase.followUpOverdue&&<p className="mt-1 font-bold text-[#A85B16]">Follow-up overdue since {customerCase.latestScheduledFollowUp}; Manager action needed.</p>}
                    {customerCase.profile?.reason&&<p className="mt-1 text-[#806A8C]">Most recent review reason: {customerCase.profile.reason}</p>}</div>
            </div>
            {customerCase.earlierOutstanding.length>0&&<div className="rounded-lg border border-[#E9E1EE] p-2">
                <strong>Earlier unpaid claims — same verified customer, this branch</strong>
                {customerCase.earlierOutstanding.map(c=><p key={c.reference} className="mt-1">{c.reference} · {money(c.due)} outstanding</p>)}
            </div>}
            <label className="block font-semibold">Customer contact / decision note
                <textarea rows={2} value={caseNotes} onChange={e=>setCaseNotes(e.target.value)}
                          placeholder="Document customer communication, evidence, decision or reason (minimum 10 characters)"
                          className="mt-1 w-full rounded-lg border border-[#E3D8EA] p-2 font-normal"/>
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
                <label className="block">Activity
                    <select value={caseType} onChange={e=>setCaseType(e.target.value)} className="mt-1 w-full rounded-lg border p-2">
                        <option value="contact_attempt">Contact attempt</option>
                        <option value="notice_recorded">Notice actually sent</option>
                        <option value="customer_response">Customer response</option>
                        <option value="dispute_recorded">Charge disputed</option>
                        <option value="payment_promise">Promise to pay/return</option>
                        <option value="collection_escalation">Collection escalation</option>
                    </select>
                </label>
                <label className="block">Channel
                    <select value={caseChannel} onChange={e=>setCaseChannel(e.target.value)} className="mt-1 w-full rounded-lg border p-2">
                        <option value="phone">Phone</option><option value="sms">SMS</option>
                        <option value="messenger">Messenger</option><option value="email">Email</option>
                        <option value="in_person">In person</option><option value="none">Internal note</option>
                    </select>
                </label>
                <label className="block">Next follow-up date (optional)
                    <input type="date" value={caseFollowUp} onChange={e=>setCaseFollowUp(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/>
                </label>
            </div>
            <button type="button" disabled={busy} onClick={()=>void manageCustomerCase('record_customer_case_event',{eventType:caseType})}
                    className="rounded-lg border border-[#D8CBE7] px-3 py-2 font-semibold disabled:opacity-50">Save customer follow-up</button>
            <div className="space-y-2 rounded-lg border border-[#E3D8EA] p-3">
                <h6 className="font-bold">Future-booking review</h6>
                <p className="text-[#806A8C]">Customers can submit requests, but a verified active flag prevents confirmation until the Manager documents a booking-specific exception. Clear a flag when the concern is resolved or was incorrect.</p>
                <label className="flex items-start gap-2"><input type="checkbox" checked={identityVerified} onChange={e=>setIdentityVerified(e.target.checked)}/>
                    <span>I independently verified the customer controls the contact details, not just matched a name or submitted phone.</span></label>
                <div className="flex flex-wrap gap-2">
                    {!customerCase.profile?.reviewRequired&&<button type="button" disabled={busy||!identityVerified||!customerCase.identityLookupAvailable} onClick={()=>void manageCustomerCase('set_customer_review',{reviewRequired:true,identityVerified:true})} className="rounded-lg border border-[#CBA8E8] px-3 py-2 font-semibold disabled:opacity-50">Require Manager review for future bookings</button>}
                    {Boolean(customerCase.profile?.reviewRequired)&&<>
                        <button type="button" disabled={busy} onClick={()=>void manageCustomerCase('set_customer_review',{reviewRequired:false})} className="rounded-lg border px-3 py-2 font-semibold disabled:opacity-50">Clear customer review restriction</button>
                        {['pending review','awaiting down payment'].includes(customerCase.bookingStatus.toLowerCase())&&<button type="button" disabled={busy} onClick={()=>void manageCustomerCase('authorize_customer_booking_exception')} className="rounded-lg bg-[#2B174C] px-3 py-2 font-semibold text-white disabled:opacity-50">Authorize this booking only</button>}
                    </>}
                </div>
            </div>
            {customerCase.claimDue>0&&<div className="rounded-lg border border-[#E3D8EA] p-3">
                <h6 className="font-bold">Outstanding approved claim</h6>
                <p className="text-[#806A8C]">The customer still owes {money(customerCase.claimDue)}. Refundable deposits must be reconciled separately. Operational closure is not a debt waiver.</p>
                {customerCase.bookingStatus.toLowerCase()==='preparing'&&<button type="button" disabled={busy} onClick={()=>{
                    if(window.confirm('Close physical operations while keeping this customer debt open? Confirm all returns, inspections and incident decisions are finished.'))
                        void manageCustomerCase('close_booking_outstanding_claim');
                }} className="mt-2 rounded-lg border border-[#D8CBE7] px-3 py-2 font-semibold disabled:opacity-50">Close operations — keep claim outstanding</button>}
            </div>}
            {waiverCandidates.length>0&&<div className="space-y-2 rounded-lg border border-[#E3D8EA] bg-[#FCFAFF] p-3">
                <h6 className="font-bold">Correct or waive an already approved unpaid charge</h6>
                <p className="text-[#806A8C]">Use only after a new Manager investigation shows the customer should not be charged. Claims with any recorded payment or applied deposit cannot be waived here; those require an audited refund/correction.</p>
                <label className="block font-semibold">Select equipment and approved charge
                    <select value={waiveExistingId} onChange={e=>setWaiveExistingId(e.target.value)} className="mt-1 w-full rounded-lg border border-[#E3D8EA] bg-white p-2 font-normal">
                        <option value="">Choose an unpaid equipment claim</option>
                        {waiverCandidates.map(c=><option key={c.id} value={c.id}>{c.equipmentName||`Equipment #${c.sourceId}`} · {c.sourceType==='missing'?'Missing':'Damage'} · Claim #{c.id} · {money(c.amount)}</option>)}
                    </select>
                </label>
                <label className="block font-semibold">Reason for reversing the approved charge
                    <textarea value={waiveExistingReason} onChange={e=>setWaiveExistingReason(e.target.value)} rows={2} placeholder="Explain the corrected assessment or why the charge is being waived (minimum 10 characters)" className="mt-1 w-full rounded-lg border border-[#E3D8EA] bg-white p-2 font-normal"/>
                </label>
                <button type="button" disabled={busy||!waiveExistingId||waiveExistingReason.trim().length<10} onClick={()=>void waiveApprovedUnpaidClaim()} className="rounded-lg border border-[#D8CBE7] bg-white px-3 py-2 font-semibold text-[#2B174C] disabled:opacity-50">Waive approved customer charge</button>
            </div>}
            <div className="max-h-48 space-y-2 overflow-y-auto" aria-label="Customer case history">
                <h6 className="font-bold">Recorded case history</h6>
                {customerCase.events.length===0?<p className="text-[#806A8C]">No contact or review history recorded yet.</p>:
                    customerCase.events.map(e=><div key={e.id} className="rounded-lg border border-[#E9E1EE] p-2">
                        <strong>{e.eventType.replaceAll('_',' ')}</strong> · {e.createdAt} · {e.actorName}
                        <p className="text-[#806A8C]">{e.channel}{e.followUpOn?` · Follow-up: ${e.followUpOn}`:''}</p>
                        <p className="mt-1">{e.notes}</p>
                    </div>)}
            </div>
        </div>}

    </section>;
}