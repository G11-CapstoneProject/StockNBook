const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const tls = require("tls");

const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";

const OTP_EXPIRY_SECONDS = 90;
const MANAGER_INVITE_OTP_EXPIRY_SECONDS = 300;
const STAFF_INVITE_OTP_EXPIRY_SECONDS = 300;

const SMTP_USER = "noreplystocknbook@gmail.com";

/*
 * Paste a NEW 16-character Google App Password here.
 * Do not use your normal Gmail password.
 */
const SMTP_PASS =
    "sftp dapx ffxw qqrt"
        .replace(/\s/g, "");

const EMAIL_FROM =
    `"StockNBook No Reply" <${SMTP_USER}>`;

const EMAIL_REPLY_TO = SMTP_USER;

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT_MS = 20000;

const APP_BASE_URL =
    String(
        process.env.APP_BASE_URL ||
        process.env.APP_URL ||
        "http://localhost:3000"
    ).replace(/\/+$/, "");
function generateOtp() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashOtp(otp) {
    return crypto
        .createHash("sha256")
        .update(String(otp))
        .digest("hex");
}

async function ensureSignupOtpsTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS signup_otps (
                                                   id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                                   email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_signup_otps_email (email),
            INDEX idx_signup_otps_lookup (
                                             email,
                                             otp_hash,
                                             used,
                                             expires_at
                                         )
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}


function hashInviteToken(inviteToken) {
    return crypto
        .createHash("sha256")
        .update(String(inviteToken))
        .digest("hex");
}

async function ensureManagerInviteOtpsTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS manager_invite_otps (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            invite_token_hash CHAR(64) NOT NULL,
            email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            verified_at DATETIME NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_manager_invite_otp_email (email),
            INDEX idx_manager_invite_otp_lookup (
                invite_token_hash,
                email,
                used,
                expires_at
            ),
            INDEX idx_manager_invite_otp_verified (
                invite_token_hash,
                email,
                verified_at
            )
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function getManagerInviteRecord(connection, inviteToken) {
    if (!inviteToken) {
        const error = new Error("Missing invitation token.");
        error.statusCode = 400;
        throw error;
    }

    let decoded;

    try {
        decoded = jwt.verify(inviteToken, JWT_SECRET);
    } catch {
        const error = new Error("Invalid or expired invitation.");
        error.statusCode = 401;
        throw error;
    }

    if (decoded.type !== "manager_invite") {
        const error = new Error("Invalid invitation type.");
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await connection.execute(
        `SELECT
             managers.id AS manager_id,
             managers.manager_name,
             managers.manager_email,
             managers.permissions,
             managers.status,
             managers.store_id,
             managers.branch_id,
             branches.branch_name,
             stores.store_name
         FROM managers
         JOIN branches ON managers.branch_id = branches.id
         JOIN stores ON managers.store_id = stores.id
         WHERE managers.invite_token = ?
           AND managers.manager_email = ?
           AND managers.store_id = ?
           AND managers.branch_id = ?
         LIMIT 1`,
        [
            inviteToken,
            String(decoded.email || "").toLowerCase(),
            decoded.store_id,
            decoded.branch_id,
        ]
    );

    if (rows.length === 0) {
        const error = new Error("Invitation not found or already used.");
        error.statusCode = 404;
        throw error;
    }

    const manager = rows[0];

    return {
        decoded,
        manager: {
            manager_id: manager.manager_id,
            manager_name: manager.manager_name || "",
            manager_email: manager.manager_email || "",
            store_id: manager.store_id,
            store_name: manager.store_name || "",
            branch_id: manager.branch_id,
            branch_name: manager.branch_name || "",
            role: "manager",
            status: manager.status || "pending",
            permissions:
                typeof manager.permissions === "string"
                    ? JSON.parse(manager.permissions || "{}")
                    : manager.permissions || {},
        },
    };
}

async function requireVerifiedManagerInvite(connection, inviteToken, email) {
    await ensureManagerInviteOtpsTable(connection);

    const inviteTokenHash = hashInviteToken(inviteToken);
    const [rows] = await connection.execute(
        `SELECT id
         FROM manager_invite_otps
         WHERE invite_token_hash = ?
           AND email = ?
           AND verified_at IS NOT NULL
           AND verified_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
         ORDER BY id DESC
         LIMIT 1`,
        [inviteTokenHash, String(email || "").toLowerCase()]
    );

    if (rows.length === 0) {
        const error = new Error(
            "Verify the invited email before continuing."
        );
        error.statusCode = 403;
        throw error;
    }
}


async function ensureStaffInviteOtpsTable(connection) {
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS staff_invite_otps (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            invite_token_hash CHAR(64) NOT NULL,
            email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            verified_at DATETIME NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_staff_invite_otp_email (email),
            INDEX idx_staff_invite_otp_lookup (
                invite_token_hash,
                email,
                used,
                expires_at
            ),
            INDEX idx_staff_invite_otp_verified (
                invite_token_hash,
                email,
                verified_at
            )
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

async function getStaffInviteRecord(connection, inviteToken) {
    if (!inviteToken) {
        const error = new Error("Missing invitation token.");
        error.statusCode = 400;
        throw error;
    }

    let decoded;

    try {
        decoded = jwt.verify(inviteToken, JWT_SECRET);
    } catch {
        const error = new Error("Invalid or expired invitation.");
        error.statusCode = 401;
        throw error;
    }

    if (decoded.type !== "staff_invite") {
        const error = new Error("Invalid invitation type.");
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await connection.execute(
        `SELECT
             staff.id AS staff_id,
             staff.staff_name,
             staff.staff_email,
             staff.permissions,
             staff.status,
             staff.store_id,
             staff.branch_id,
             staff.manager_id,
             branches.branch_name,
             stores.store_name,
             COALESCE(managers.manager_name, '') AS manager_name
         FROM staff
         JOIN branches ON staff.branch_id = branches.id
         JOIN stores ON staff.store_id = stores.id
         LEFT JOIN managers ON staff.manager_id = managers.id
         WHERE staff.invite_token = ?
           AND staff.staff_email = ?
           AND staff.store_id = ?
           AND staff.branch_id = ?
           AND staff.manager_id = ?
         LIMIT 1`,
        [
            inviteToken,
            String(decoded.email || "").toLowerCase(),
            decoded.store_id,
            decoded.branch_id,
            decoded.manager_id,
        ]
    );

    if (rows.length === 0) {
        const error = new Error("Invitation not found or already used.");
        error.statusCode = 404;
        throw error;
    }

    const staffMember = rows[0];

    return {
        decoded,
        staff: {
            staff_id: staffMember.staff_id,
            staff_name: staffMember.staff_name || "",
            staff_email: staffMember.staff_email || "",
            manager_id: staffMember.manager_id,
            manager_name: staffMember.manager_name || "",
            store_id: staffMember.store_id,
            store_name: staffMember.store_name || "",
            branch_id: staffMember.branch_id,
            branch_name: staffMember.branch_name || "",
            role: "staff",
            status: staffMember.status || "pending",
            permissions:
                typeof staffMember.permissions === "string"
                    ? JSON.parse(staffMember.permissions || "{}")
                    : staffMember.permissions || {},
        },
    };
}

async function requireVerifiedStaffInvite(connection, inviteToken, email) {
    await ensureStaffInviteOtpsTable(connection);

    const inviteTokenHash = hashInviteToken(inviteToken);
    const [rows] = await connection.execute(
        `SELECT id
         FROM staff_invite_otps
         WHERE invite_token_hash = ?
           AND email = ?
           AND verified_at IS NOT NULL
           AND verified_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
         ORDER BY id DESC
         LIMIT 1`,
        [inviteTokenHash, String(email || "").toLowerCase()]
    );

    if (rows.length === 0) {
        const error = new Error(
            "Verify the invited email before continuing."
        );
        error.statusCode = 403;
        throw error;
    }
}

function createSmtpResponseReader(socket) {
    let buffer = "";
    const waiting = [];

    const flush = () => {
        while (waiting.length > 0) {
            const lines = buffer.split(/\r?\n/);
            let responseEnd = -1;

            for (let index = 0; index < lines.length; index += 1) {
                if (/^\d{3} /.test(lines[index])) {
                    responseEnd = index;
                    break;
                }
            }

            if (responseEnd === -1) {
                return;
            }

            const responseLines = lines.slice(0, responseEnd + 1);
            buffer = lines.slice(responseEnd + 1).join("\r\n");

            const finalLine = responseLines[responseLines.length - 1];
            const code = Number(finalLine.slice(0, 3));
            const waiter = waiting.shift();

            waiter.resolve({
                code,
                message: responseLines.join("\n"),
            });
        }
    };

    socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        flush();
    });

    socket.on("error", (error) => {
        while (waiting.length > 0) {
            waiting.shift().reject(error);
        }
    });

    socket.on("close", () => {
        while (waiting.length > 0) {
            waiting.shift().reject(
                new Error("SMTP connection closed unexpectedly.")
            );
        }
    });

    return () =>
        new Promise((resolve, reject) => {
            waiting.push({ resolve, reject });
            flush();
        });
}

async function expectSmtpResponse(readResponse, expectedCodes) {
    const response = await readResponse();

    if (!expectedCodes.includes(response.code)) {
        const error = new Error(
            `Gmail SMTP error ${response.code}: ${response.message}`
        );

        error.code =
            response.code === 535
                ? "GMAIL_AUTH_FAILED"
                : "GMAIL_SMTP_ERROR";

        throw error;
    }

    return response;
}

async function sendSmtpCommand(
    socket,
    readResponse,
    command,
    expectedCodes
) {
    socket.write(`${command}\r\n`);
    return expectSmtpResponse(readResponse, expectedCodes);
}

function buildOtpEmail(toEmail, otp) {
    const html = `
        <div style="font-family: Arial, sans-serif; background:#FDFAF4; padding:24px;">
            <div style="max-width:520px; margin:auto; background:#ffffff; border:1px solid #EBE4F0; border-radius:16px; padding:28px;">
                <h2 style="margin:0; color:#2D1B4E;">StockNBook</h2>

                <p style="margin-top:18px; color:#3F354C;">Hello,</p>

                <p style="color:#3F354C;">
                    Use the verification code below to continue creating your
                    StockNBook account.
                </p>

                <div style="margin:24px 0; padding:18px; text-align:center; background:#F8F5FF; border-radius:12px;">
                    <div style="font-size:32px; font-weight:bold; letter-spacing:6px; color:#2D1B4E;">
                        ${otp}
                    </div>
                </div>

                <p style="color:#7A6E88;">
                    This OTP will expire in <strong>1 minute and 30 seconds</strong>.
                </p>

                <p style="margin-top:24px; color:#7A6E88; font-size:13px;">
                    If you did not request this code, you can safely ignore this
                    email.
                </p>

                <p style="margin-top:24px; color:#2D1B4E; font-weight:bold;">
                    — StockNBook Team
                </p>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `To: ${toEmail}`,
        "Subject: StockNBook Email Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function sanitizeEmailHeader(value) {
    return String(value ?? "")
        .replace(/[\r\n]+/g, " ")
        .trim();
}

function permissionLabel(permission) {
    const labels = {
        dashboard: "Dashboard",
        bookings: "Bookings",
        packages: "Packages",
        packages_manage: "Manage Packages",
        inventory: "Inventory",
        pos: "Sales / POS",
        reports: "Reports",
        staff_management: "Staff Management",
        branch_settings: "Branch Settings",
    };

    return labels[permission] || permission;
}


function buildManagerInviteOtpEmail(toEmail, otp, managerName) {
    const safeName = escapeHtml(managerName || "Manager");
    const safeOtp = escapeHtml(otp);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#F7F4FB;padding:28px 14px;color:#21172C;">
            <div style="max-width:560px;margin:auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:20px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:26px 30px;color:#FFFFFF;">
                    <div style="font-size:22px;font-weight:800;">Stock<span style="color:#D4A126;">N</span>Book</div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">Manager invitation verification</div>
                </div>
                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:25px;color:#21172C;">Verify your invited email</h1>
                    <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeName}</strong>, use the code below to continue accepting your StockNBook manager invitation.
                    </p>
                    <div style="margin:24px 0;padding:20px;text-align:center;border-radius:14px;background:#F3ECFF;">
                        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#4B2380;">${safeOtp}</div>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#7A6E88;">
                        This code expires in 5 minutes. Do not share it with anyone.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook Manager Invitation Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}


function buildStaffInviteOtpEmail(toEmail, otp, staffName) {
    const safeName = escapeHtml(staffName || "Staff member");
    const safeOtp = escapeHtml(otp);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#F7F4FB;padding:28px 14px;color:#21172C;">
            <div style="max-width:560px;margin:auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:20px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:26px 30px;color:#FFFFFF;">
                    <div style="font-size:22px;font-weight:800;">Stock<span style="color:#D4A126;">N</span>Book</div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">Staff invitation verification</div>
                </div>
                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:25px;color:#21172C;">Verify your invited email</h1>
                    <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeName}</strong>, use the code below to continue accepting your StockNBook staff invitation.
                    </p>
                    <div style="margin:24px 0;padding:20px;text-align:center;border-radius:14px;background:#F3ECFF;">
                        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#4B2380;">${safeOtp}</div>
                    </div>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#7A6E88;">
                        This code expires in 5 minutes. Do not share it with anyone.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        "Subject: StockNBook Staff Invitation Verification Code",
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}

function buildManagerInvitationEmail({
                                         toEmail,
                                         managerName,
                                         storeName,
                                         branchName,
                                         inviteLink,
                                         permissions,
                                     }) {
    const safeManagerName = escapeHtml(managerName || "Manager");
    const safeStoreName = escapeHtml(storeName || "StockNBook Store");
    const safeBranchName = escapeHtml(branchName || "Assigned Branch");
    const safeInviteLink = escapeHtml(inviteLink);
    const safeRecipient = escapeHtml(toEmail);

    const enabledPermissions = Object.entries(permissions || {})
        .filter(([, enabled]) => Boolean(enabled))
        .map(([permission]) => permissionLabel(permission));

    const permissionItems =
        enabledPermissions.length > 0
            ? enabledPermissions
                .map(
                    (permission) =>
                        `<span style="display:inline-block;margin:4px 6px 4px 0;padding:7px 10px;border-radius:999px;background:#F1E9FF;color:#4B2380;font-size:12px;font-weight:700;">✓ ${escapeHtml(permission)}</span>`
                )
                .join("")
            : `<span style="color:#7A6E88;font-size:13px;">Your access will be configured by the store owner.</span>`;

    const subject = "StockNBook Manager Invitation";

    const html = `
        <div style="margin:0;background:#F7F4FB;padding:30px 14px;font-family:Arial,Helvetica,sans-serif;color:#21172C;">
            <div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #E7DFEA;border-radius:22px;background:#FFFFFF;box-shadow:0 18px 50px rgba(45,27,78,.12);">
                <div style="background:linear-gradient(135deg,#2D1B4E,#4B2B75);padding:28px 30px;color:#FFFFFF;">
                    <div style="font-size:23px;font-weight:800;letter-spacing:-.6px;">
                        Stock<span style="color:#D4A126;">N</span>Book
                    </div>
                    <div style="margin-top:7px;font-size:13px;color:rgba(255,255,255,.72);">
                        Secure branch manager invitation
                    </div>
                </div>

                <div style="padding:30px;">
                    <h1 style="margin:0;font-size:27px;line-height:1.25;color:#21172C;">
                        You have been invited
                    </h1>

                    <p style="margin:16px 0 0;font-size:15px;line-height:1.75;color:#6F6577;">
                        Hello <strong style="color:#2D1B4E;">${safeManagerName}</strong>,
                        the owner of <strong style="color:#2D1B4E;">${safeStoreName}</strong>
                        invited you to manage the
                        <strong style="color:#2D1B4E;">${safeBranchName}</strong> branch.
                    </p>

                    <div style="margin:24px 0;padding:18px;border:1px solid #E8DFF0;border-radius:16px;background:#FCFAFD;">
                        <table role="presentation" style="width:100%;border-collapse:collapse;">
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Store</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeStoreName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 10px 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Branch</td>
                                <td style="padding:4px 0 10px;color:#2D1B4E;font-size:14px;font-weight:700;">${safeBranchName}</td>
                            </tr>
                            <tr>
                                <td style="padding:4px 10px 0 0;color:#8A7896;font-size:12px;text-transform:uppercase;letter-spacing:.1em;">Role</td>
                                <td style="padding:4px 0 0;color:#2D1B4E;font-size:14px;font-weight:700;">Branch Manager</td>
                            </tr>
                        </table>
                    </div>

                    <div style="margin:0 0 22px;">
                        <div style="margin-bottom:9px;color:#2D1B4E;font-size:13px;font-weight:800;">Access assigned to you</div>
                        <div>${permissionItems}</div>
                    </div>

                    <a href="${safeInviteLink}"
                       style="display:block;border-radius:12px;background:#2D1B4E;padding:15px 20px;text-align:center;font-size:15px;font-weight:800;color:#FFFFFF;text-decoration:none;">
                        Review and accept invitation
                    </a>

                    <p style="margin:20px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        This invitation is intended only for <strong>${safeRecipient}</strong>.
                        Do not forward this email or share the invitation link.
                    </p>

                    <p style="margin:14px 0 0;font-size:12px;line-height:1.65;color:#8A8091;">
                        The invitation expires after 7 days. If you were not expecting this invitation,
                        you may safely ignore this email.
                    </p>
                </div>
            </div>
        </div>
    `;

    const message = [
        `From: ${EMAIL_FROM}`,
        `Reply-To: ${EMAIL_REPLY_TO}`,
        `To: ${sanitizeEmailHeader(toEmail)}`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
    ].join("\r\n");

    return message.replace(/^\./gm, "..");
}

async function sendGmailHtmlEmail(toEmail, rawMessage, logLabel) {
    if (!SMTP_USER || !SMTP_PASS) {
        const configError = new Error(
            "A valid Gmail App Password has not been configured in SMTP_PASS."
        );
        configError.code = "SMTP_NOT_CONFIGURED";
        throw configError;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        const emailError = new Error("Invalid email recipient.");
        emailError.code = "INVALID_RECIPIENT";
        throw emailError;
    }

    const socket = tls.connect({
        host: SMTP_HOST,
        port: SMTP_PORT,
        servername: SMTP_HOST,
        rejectUnauthorized: true,
    });

    socket.setTimeout(SMTP_TIMEOUT_MS);

    const readResponse = createSmtpResponseReader(socket);

    try {
        await new Promise((resolve, reject) => {
            socket.once("secureConnect", resolve);
            socket.once("error", reject);
            socket.once("timeout", () => {
                const timeoutError = new Error(
                    "Lambda could not connect to Gmail SMTP."
                );
                timeoutError.code = "GMAIL_NETWORK_FAILED";
                reject(timeoutError);
            });
        });

        await expectSmtpResponse(readResponse, [220]);

        await sendSmtpCommand(
            socket,
            readResponse,
            "EHLO stocknbook.local",
            [250]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            "AUTH LOGIN",
            [334]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            Buffer.from(SMTP_USER).toString("base64"),
            [334]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            Buffer.from(SMTP_PASS).toString("base64"),
            [235]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            `MAIL FROM:<${SMTP_USER}>`,
            [250]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            `RCPT TO:<${toEmail}>`,
            [250, 251]
        );

        await sendSmtpCommand(
            socket,
            readResponse,
            "DATA",
            [354]
        );

        socket.write(`${rawMessage}\r\n.\r\n`);

        const dataResponse = await expectSmtpResponse(
            readResponse,
            [250]
        );

        socket.write("QUIT\r\n");

        console.log(`[stocknbook-auth] ${logLabel} email accepted:`, {
            to: toEmail,
            smtpResponse: dataResponse.message,
        });

        return {
            accepted: [toEmail],
            response: dataResponse.message,
        };
    } catch (error) {
        console.error(`[stocknbook-auth] ${logLabel} Gmail SMTP error:`, {
            code: error?.code,
            message: error?.message,
        });

        if (
            error?.code === "ETIMEDOUT" ||
            error?.code === "ECONNRESET" ||
            error?.code === "EHOSTUNREACH" ||
            error?.code === "ENETUNREACH"
        ) {
            error.code = "GMAIL_NETWORK_FAILED";
        }

        throw error;
    } finally {
        if (!socket.destroyed) {
            socket.end();
        }
    }
}

async function sendSignupOtpEmail(toEmail, otp) {
    return sendGmailHtmlEmail(
        toEmail,
        buildOtpEmail(toEmail, otp),
        "OTP"
    );
}

async function sendManagerInvitationEmail(invite) {
    return sendGmailHtmlEmail(
        invite.manager_email,
        buildManagerInvitationEmail({
            toEmail: invite.manager_email,
            managerName: invite.manager_name,
            storeName: invite.store_name,
            branchName: invite.branch_name,
            inviteLink: invite.invite_link,
            permissions: invite.permissions,
        }),
        "manager invitation"
    );
}


async function sendManagerInviteOtpEmail(toEmail, otp, managerName) {
    return sendGmailHtmlEmail(
        toEmail,
        buildManagerInviteOtpEmail(toEmail, otp, managerName),
        "manager invitation OTP"
    );
}


async function sendStaffInviteOtpEmail(toEmail, otp, staffName) {
    return sendGmailHtmlEmail(
        toEmail,
        buildStaffInviteOtpEmail(toEmail, otp, staffName),
        "staff invitation OTP"
    );
}

function generateSlug(storeName) {
    return storeName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

/*
 * MySQL connection stored directly in this Lambda code.
 *
 * The previous error said "using password: NO" because
 * password: process.env.DB_PASSWORD was undefined.
 */

const dbConfig = {
    host: "stocknbook-db.ctc4eeuyq62e.ap-southeast-1.rds.amazonaws.com",
    user: "admin",
    password: "2qJivedWDxCQS6TLjjEl",
    database: "stocknbook",
    ssl: { rejectUnauthorized: false },
};

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json",
    };

    const method =
        event?.requestContext?.http?.method ||
        event?.httpMethod;

    if (method === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    let body = {};

    try {
        body = JSON.parse(event.body || "{}");
    } catch (err) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Invalid JSON body" }),
        };
    }

    const { action, store_name, email, password } = body;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        // SEND SIGNUP OTP
        if (action === "send_signup_otp") {
            await ensureSignupOtpsTable(connection);

            const ownerName = String(
                body.owner_name ?? body.ownerName ?? ""
            ).trim();

            const storeName = String(
                body.store_name ?? body.storeName ?? ""
            ).trim();

            const phoneNumber = String(
                body.phone_number ?? body.phoneNumber ?? body.phone ?? ""
            ).trim();

            const emailAddress = String(body.email ?? "").trim().toLowerCase();
            const accountPassword = String(body.password ?? "");

            if (!ownerName || !storeName || !phoneNumber || !emailAddress || !accountPassword) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Owner name, business name, phone number, email, and password are required.",
                    }),
                };
            }

            const phoneDigits = phoneNumber.replace(/\D/g, "");

            if (phoneDigits.length < 10 || phoneDigits.length > 15) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid phone number." }),
                };
            }

            if (!/^\S+@\S+\.\S+$/.test(emailAddress)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid email address." }),
                };
            }

            if (accountPassword.length < 8) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Password must contain at least 8 characters." }),
                };
            }

            const slug = generateSlug(storeName);

            if (!slug) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Business name must contain letters or numbers." }),
                };
            }

            const [phoneColumnRows] = await connection.execute(
                "SHOW COLUMNS FROM stores LIKE 'phone_number'"
            );

            if (phoneColumnRows.length === 0) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: "Database setup is incomplete. Add stores.phone_number before creating new accounts.",
                    }),
                };
            }

            const [existing] = await connection.execute(
                "SELECT id FROM stores WHERE email = ? LIMIT 1",
                [emailAddress]
            );

            if (existing.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Email already exists" }),
                };
            }

            const otp = generateOtp();
            const otpHash = hashOtp(otp);

            await connection.execute(
                `UPDATE signup_otps
                 SET used = 1
                 WHERE email = ?
                   AND used = 0`,
                [emailAddress]
            );

            await connection.execute(
                `INSERT INTO signup_otps
                     (email, otp_hash, expires_at, used)
                 VALUES
                     (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), 0)`,
                [emailAddress, otpHash, OTP_EXPIRY_SECONDS]
            );

            try {
                await sendSignupOtpEmail(emailAddress, otp);
            } catch (emailError) {
                await connection.execute(
                    `UPDATE signup_otps
                     SET used = 1
                     WHERE email = ?
                       AND otp_hash = ?
                       AND used = 0`,
                    [emailAddress, otpHash]
                );

                throw emailError;
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "OTP sent successfully",
                    expires_in: OTP_EXPIRY_SECONDS,
                }),
            };
        }

        // VERIFY SIGNUP OTP AND CREATE OWNER ACCOUNT
        if (action === "verify_signup_otp") {
            await ensureSignupOtpsTable(connection);

            const otp = String(body.otp ?? "").trim();
            const otpEmail = String(body.email ?? "").trim().toLowerCase();

            if (!otp || !otpEmail) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "OTP and email are required." }),
                };
            }

            if (!/^\d{6}$/.test(otp)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "OTP must be exactly 6 digits." }),
                };
            }

            const otpHash = hashOtp(otp);

            // Explicitly invalidate every expired OTP for this email.
            await connection.execute(
                `UPDATE signup_otps
                 SET used = 1
                 WHERE email = ?
                   AND used = 0
                   AND expires_at <= UTC_TIMESTAMP()`,
                [otpEmail]
            );

            // Accept only an unused OTP that has not expired.
            const [otpRows] = await connection.execute(
                `SELECT id
                 FROM signup_otps
                 WHERE email = ?
                   AND otp_hash = ?
                   AND used = 0
                   AND expires_at > UTC_TIMESTAMP()
                 ORDER BY id DESC
                     LIMIT 1`,
                [otpEmail, otpHash]
            );

            if (otpRows.length === 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Invalid or expired OTP." }),
                };
            }

            // Accept both snake_case and camelCase because the Create Account modal
            // may submit either naming style. The current modal submits owner_name
            // and phone, which are both supported here.
            const ownerName = String(
                body.owner_name ?? body.ownerName ?? ""
            ).trim();
            const storeName = String(
                body.store_name ?? body.storeName ?? ""
            ).trim();
            const phoneNumber = String(
                body.phone_number ?? body.phoneNumber ?? body.phone ?? ""
            ).trim();
            const emailAddress = String(body.email ?? "").trim().toLowerCase();
            const accountPassword = String(body.password ?? "");

            if (!ownerName || !storeName || !phoneNumber || !emailAddress || !accountPassword) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Owner name, business name, phone number, email, and password are required.",
                    }),
                };
            }

            const phoneDigits = phoneNumber.replace(/\D/g, "");
            if (phoneDigits.length < 10 || phoneDigits.length > 15) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid phone number." }),
                };
            }

            if (!/^\S+@\S+\.\S+$/.test(emailAddress)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Enter a valid email address." }),
                };
            }

            if (accountPassword.length < 8) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Password must contain at least 8 characters." }),
                };
            }

            const slug = generateSlug(storeName);
            if (!slug) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Business name must contain letters or numbers." }),
                };
            }

            // The migration in database/01_add_phone_number.sql must be run once.
            const [phoneColumnRows] = await connection.execute(
                "SHOW COLUMNS FROM stores LIKE 'phone_number'"
            );

            if (phoneColumnRows.length === 0) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: "Database setup is incomplete. Add stores.phone_number before creating new accounts.",
                    }),
                };
            }

            const [existing] = await connection.execute(
                "SELECT id FROM stores WHERE email = ? LIMIT 1",
                [emailAddress]
            );

            if (existing.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Email already exists" }),
                };
            }

            await connection.execute(
                `UPDATE signup_otps
                 SET used = 1
                 WHERE email = ?
                   AND used = 0`,
                [emailAddress]
            );

            const hashed = await bcrypt.hash(accountPassword, 10);

            const [result] = await connection.execute(
                `INSERT INTO stores
                     (store_name, owner_name, phone_number, email, password, slug)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [storeName, ownerName, phoneNumber, emailAddress, hashed, slug]
            );

            const token = jwt.sign(
                {
                    store_id: result.insertId,
                    email: emailAddress,
                    role: "owner",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    token,
                    role: "owner",
                    store_id: result.insertId,
                    store_name: storeName,
                    owner_name: ownerName,
                    phone_number: phoneNumber,
                }),
            };
        }

        // GET STORE BY SLUG
        if (action === "get_store_by_slug") {
            const { slug } = body;

            if (!slug) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing slug" }),
                };
            }

            const [rows] = await connection.execute(
                `SELECT id, store_name, slug
                 FROM stores
                 WHERE slug = ?
                     LIMIT 1`,
                [slug]
            );

            if (!rows.length) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Store not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ store: rows[0] }),
            };
        }

        // GET PUBLIC BRANCHES BY STORE
        if (action === "get_public_branches") {
            const { storeId } = body;

            if (!storeId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing storeId" }),
                };
            }

            const [branchRows] = await connection.execute(
                `SELECT
                     id,
                     branch_name,
                     contact_number,
                     address
                 FROM branches
                 WHERE store_id = ?
                 ORDER BY branch_name ASC`,
                [Number(storeId)]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    branches: branchRows.map((branch) => ({
                        id: branch.id,
                        branch_name: branch.branch_name,
                        contact_number: branch.contact_number || "",
                        address: branch.address || "",
                        branch_slug: generateSlug(branch.branch_name || ""),
                    })),
                }),
            };
        }
        // SAVE ONBOARDING
        if (action === "save_onboarding") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "owner" || !decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "Only the store owner can complete onboarding",
                    }),
                };
            }

            const storeId = decoded.store_id;
            const { branches = [] } = body;
            const shouldSendInvitationEmails =
                body.send_invitation_emails !== false;

            if (!Array.isArray(branches) || branches.length === 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "No branches provided" }),
                };
            }

            const [storeRows] = await connection.execute(
                `SELECT store_name
                 FROM stores
                 WHERE id = ?
                 LIMIT 1`,
                [storeId]
            );

            if (storeRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Store not found" }),
                };
            }

            const storeName = storeRows[0].store_name || "StockNBook Store";
            const inviteLinks = [];

            await connection.beginTransaction();

            try {
                for (const branch of branches) {
                    const branchName = String(
                        branch.branch_name || ""
                    ).trim();

                    const contactNumber = String(
                        branch.contact_number || ""
                    ).trim();

                    const address = String(
                        branch.address || ""
                    ).trim();

                    const managerName = String(
                        branch.manager_name || ""
                    ).trim();

                    const managerEmail = String(
                        branch.manager_email || ""
                    )
                        .trim()
                        .toLowerCase();

                    if (!branchName) {
                        throw new Error("Every branch must have a branch name.");
                    }

                    if (
                        managerEmail &&
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)
                    ) {
                        throw new Error(
                            `Invalid manager email for ${branchName}.`
                        );
                    }

                    const [branchResult] = await connection.execute(
                        `INSERT INTO branches
                             (store_id, branch_name, contact_number, address)
                         VALUES (?, ?, ?, ?)`,
                        [
                            storeId,
                            branchName,
                            contactNumber || null,
                            address || null,
                        ]
                    );

                    const branchId = branchResult.insertId;

                    if (managerEmail) {
                        const [existingManagerRows] =
                            await connection.execute(
                                `SELECT id
                                 FROM managers
                                 WHERE manager_email = ?
                                   AND store_id = ?
                                 LIMIT 1`,
                                [managerEmail, storeId]
                            );

                        if (existingManagerRows.length > 0) {
                            throw new Error(
                                `${managerEmail} is already assigned as a manager in this store.`
                            );
                        }

                        const inviteToken = jwt.sign(
                            {
                                store_id: storeId,
                                branch_id: branchId,
                                email: managerEmail,
                                type: "manager_invite",
                            },
                            JWT_SECRET,
                            { expiresIn: "7d" }
                        );

                        const inviteLink =
                            `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

                        const permissions = branch.permissions || {};

                        await connection.execute(
                            `INSERT INTO managers
                                 (
                                     store_id,
                                     branch_id,
                                     manager_name,
                                     manager_email,
                                     invite_token,
                                     permissions,
                                     status
                                 )
                             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [
                                storeId,
                                branchId,
                                managerName || null,
                                managerEmail,
                                inviteToken,
                                JSON.stringify(permissions),
                                "pending",
                            ]
                        );

                        inviteLinks.push({
                            manager_email: managerEmail,
                            manager_name: managerName,
                            store_name: storeName,
                            branch_name: branchName,
                            invite_link: inviteLink,
                            permissions,
                            email_sent: false,
                            email_status: "pending",
                            email_error: "",
                        });
                    }
                }

                await connection.commit();
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: err?.message || "Unable to save onboarding",
                    }),
                };
            }

            let invitationEmailsSent = 0;
            let invitationEmailsFailed = 0;

            if (shouldSendInvitationEmails) {
                for (const invite of inviteLinks) {
                    try {
                        await sendManagerInvitationEmail(invite);

                        invite.email_sent = true;
                        invite.email_status = "sent";
                        invite.email_error = "";
                        invitationEmailsSent += 1;
                    } catch (emailError) {
                        invite.email_sent = false;
                        invite.email_status = "failed";
                        invite.email_error =
                            emailError?.message ||
                            "Unable to send the manager invitation email.";
                        invitationEmailsFailed += 1;
                    }
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Onboarding saved successfully",
                    invite_links: inviteLinks,
                    invitation_emails_sent: invitationEmailsSent,
                    invitation_emails_failed: invitationEmailsFailed,
                }),
            };
        }

        // GET MANAGER INVITATION DETAILS
        if (action === "get_manager_invite") {
            try {
                const { manager } = await getManagerInviteRecord(
                    connection,
                    body.invite_token
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(manager),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to load the invitation.",
                    }),
                };
            }
        }

        // SEND MANAGER INVITATION OTP
        if (action === "send_manager_invite_otp") {
            try {
                await ensureManagerInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                if (manager.status !== "pending") {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "This invitation is no longer pending.",
                        }),
                    };
                }

                const otp = generateOtp();
                const otpHash = hashOtp(otp);
                const inviteTokenHash = hashInviteToken(inviteToken);

                await connection.execute(
                    `UPDATE manager_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0`,
                    [inviteTokenHash, manager.manager_email]
                );

                await connection.execute(
                    `INSERT INTO manager_invite_otps
                         (
                             invite_token_hash,
                             email,
                             otp_hash,
                             expires_at,
                             used
                         )
                     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), 0)`,
                    [
                        inviteTokenHash,
                        manager.manager_email,
                        otpHash,
                        MANAGER_INVITE_OTP_EXPIRY_SECONDS,
                    ]
                );

                try {
                    await sendManagerInviteOtpEmail(
                        manager.manager_email,
                        otp,
                        manager.manager_name
                    );
                } catch (emailError) {
                    await connection.execute(
                        `UPDATE manager_invite_otps
                         SET used = 1
                         WHERE invite_token_hash = ?
                           AND email = ?
                           AND otp_hash = ?
                           AND used = 0`,
                        [inviteTokenHash, manager.manager_email, otpHash]
                    );
                    throw emailError;
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Verification code sent successfully.",
                        expires_in: MANAGER_INVITE_OTP_EXPIRY_SECONDS,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to send the verification code.",
                    }),
                };
            }
        }

        // VERIFY MANAGER INVITATION OTP
        if (action === "verify_manager_invite_otp") {
            try {
                await ensureManagerInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const otp = String(body.otp || "").replace(/\D/g, "");
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                if (!/^\d{6}$/.test(otp)) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter the complete 6-digit verification code.",
                        }),
                    };
                }

                const inviteTokenHash = hashInviteToken(inviteToken);
                const otpHash = hashOtp(otp);

                await connection.execute(
                    `UPDATE manager_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0
                       AND expires_at <= UTC_TIMESTAMP()`,
                    [inviteTokenHash, manager.manager_email]
                );

                const [otpRows] = await connection.execute(
                    `SELECT id
                     FROM manager_invite_otps
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND otp_hash = ?
                       AND used = 0
                       AND expires_at > UTC_TIMESTAMP()
                     ORDER BY id DESC
                     LIMIT 1`,
                    [
                        inviteTokenHash,
                        manager.manager_email,
                        otpHash,
                    ]
                );

                if (otpRows.length === 0) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Invalid or expired verification code.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE manager_invite_otps
                     SET used = 1,
                         verified_at = UTC_TIMESTAMP()
                     WHERE id = ?`,
                    [otpRows[0].id]
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Invited email verified successfully.",
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to verify the invitation code.",
                    }),
                };
            }
        }

        // UPDATE MANAGER INVITATION DETAILS
        if (action === "update_manager_invite_details") {
            try {
                const inviteToken = String(body.invite_token || "");
                const managerName = String(body.manager_name || "").trim();
                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedManagerInvite(
                    connection,
                    inviteToken,
                    manager.manager_email
                );

                if (managerName.length < 2 || managerName.length > 120) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter a valid manager name.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE managers
                     SET manager_name = ?
                     WHERE id = ?
                       AND invite_token = ?
                       AND status = 'pending'`,
                    [managerName, manager.manager_id, inviteToken]
                );

                const refreshed = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(refreshed.manager),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to update the manager details.",
                    }),
                };
            }
        }

        // ACCEPT MANAGER INVITE
        if (action === "accept_manager_invite") {
            try {
                const inviteToken = String(body.invite_token || "");
                const accountPassword = String(body.password || "");
                const requestedManagerName = String(
                    body.manager_name || ""
                ).trim();

                const { manager } = await getManagerInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedManagerInvite(
                    connection,
                    inviteToken,
                    manager.manager_email
                );

                const passwordValid =
                    accountPassword.length >= 8 &&
                    /[A-Z]/.test(accountPassword) &&
                    /\d/.test(accountPassword) &&
                    /[^A-Za-z0-9]/.test(accountPassword);

                if (!passwordValid) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error:
                                "Password must contain at least 8 characters, one uppercase letter, one number, and one special character.",
                        }),
                    };
                }

                const finalManagerName =
                    requestedManagerName || manager.manager_name || "Manager";
                const hashedPassword = await bcrypt.hash(
                    accountPassword,
                    10
                );

                const [result] = await connection.execute(
                    `UPDATE managers
                     SET manager_name = ?,
                         password = ?,
                         status = 'active',
                         invite_token = NULL
                     WHERE id = ?
                       AND invite_token = ?
                       AND manager_email = ?
                       AND status = 'pending'`,
                    [
                        finalManagerName,
                        hashedPassword,
                        manager.manager_id,
                        inviteToken,
                        manager.manager_email,
                    ]
                );

                if (result.affectedRows === 0) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Invitation not found or already accepted.",
                        }),
                    };
                }

                const sessionToken = jwt.sign(
                    {
                        manager_id: manager.manager_id,
                        store_id: manager.store_id,
                        branch_id: manager.branch_id,
                        email: manager.manager_email,
                        role: "manager",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Manager account activated successfully.",
                        token: sessionToken,
                        manager_id: manager.manager_id,
                        manager_name: finalManagerName,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        role: "manager",
                        status: "active",
                        permissions: manager.permissions,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to activate the manager account.",
                    }),
                };
            }
        }

        // INVITE STAFF
        if (action === "invite_staff") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only branch-directory can invite staff" }),
                };
            }

            const { staff_name, staff_email, permissions = {} } = body;

            if (!staff_name || !staff_email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing staff name or email" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;

            const [managerRows] = await connection.execute(
                `SELECT permissions
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                typeof managerRows[0].permissions === "string"
                    ? JSON.parse(managerRows[0].permissions || "{}")
                    : managerRows[0].permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to invite staff",
                    }),
                };
            }

            const [existingStaff] = await connection.execute(
                `SELECT id
                 FROM staff
                 WHERE staff_email = ?
                   AND branch_id = ?
                     LIMIT 1`,
                [staff_email, branchId]
            );

            if (existingStaff.length > 0) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: "Staff email already exists in this branch",
                    }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: branchId,
                    manager_id: managerId,
                    email: staff_email,
                    type: "staff_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            await connection.execute(
                `INSERT INTO staff
                 (store_id, branch_id, manager_id, staff_name, staff_email, invite_token, status, permissions)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    storeId,
                    branchId,
                    managerId,
                    staff_name,
                    staff_email,
                    inviteToken,
                    "pending",
                    JSON.stringify(permissions || {}),
                ]
            );

            const inviteLink = `http://localhost:3000/accept-staff-invite?token=${inviteToken}`;

            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({
                    message: "Staff invitation created successfully",
                    invite_link: inviteLink,
                    staff_email,
                    staff_name,
                }),
            };
        }

        // LOGIN
        // LOGIN
        if (action === "login") {
            if (!email || !password) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing email or password" }),
                };
            }

            // 1. Try owner login first
            const [storeRows] = await connection.execute(
                "SELECT * FROM stores WHERE email = ?",
                [email]
            );

            if (storeRows.length > 0) {
                const store = storeRows[0];
                const match = await bcrypt.compare(password, store.password);

                if (!match) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({ error: "Invalid email or password" }),
                    };
                }

                const token = jwt.sign(
                    {
                        store_id: store.id,
                        email: store.email,
                        role: "owner",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "owner",
                        store_id: store.id,
                        owner_name: store.owner_name,
                        store_name: store.store_name,
                    }),
                };
            }

            // 2. Try manager login
            const [managerRows] = await connection.execute(
                `SELECT
                     managers.*,
                     branches.branch_name,
                     stores.store_name
                 FROM managers
                          JOIN branches ON managers.branch_id = branches.id
                          JOIN stores ON managers.store_id = stores.id
                 WHERE managers.manager_email = ?
                   AND managers.status = 'active'
                     LIMIT 1`,
                [email]
            );

            if (managerRows.length > 0) {
                const manager = managerRows[0];

                if (!manager.password) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({
                            error: "Manager invitation has not been accepted yet",
                        }),
                    };
                }

                const managerMatch = await bcrypt.compare(password, manager.password);

                if (!managerMatch) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({ error: "Invalid email or password" }),
                    };
                }

                const token = jwt.sign(
                    {
                        manager_id: manager.id,
                        store_id: manager.store_id,
                        branch_id: manager.branch_id,
                        email: manager.manager_email,
                        role: "manager",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "manager",
                        manager_id: manager.id,
                        manager_name: manager.manager_name,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        permissions:
                            typeof manager.permissions === "string"
                                ? JSON.parse(manager.permissions || "{}")
                                : manager.permissions || {},
                    }),
                };
            }

            // 3. Try staff login
            const [staffRows] = await connection.execute(
                `SELECT
                     staff.*,
                     branches.branch_name,
                     stores.store_name
                 FROM staff
                          JOIN branches ON staff.branch_id = branches.id
                          JOIN stores ON staff.store_id = stores.id
                 WHERE staff.staff_email = ?
                   AND staff.status = 'active'
                     LIMIT 1`,
                [email]
            );

            if (staffRows.length > 0) {
                const staff = staffRows[0];

                if (!staff.password) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({
                            error: "Staff invitation has not been accepted yet",
                        }),
                    };
                }

                const staffMatch = await bcrypt.compare(password, staff.password);

                if (!staffMatch) {
                    return {
                        statusCode: 401,
                        headers,
                        body: JSON.stringify({ error: "Invalid email or password" }),
                    };
                }

                const token = jwt.sign(
                    {
                        staff_id: staff.id,
                        store_id: staff.store_id,
                        branch_id: staff.branch_id,
                        manager_id: staff.manager_id,
                        email: staff.staff_email,
                        role: "staff",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        token,
                        role: "staff",
                        staff_id: staff.id,
                        staff_name: staff.staff_name,
                        staff_email: staff.staff_email,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        permissions:
                            typeof staff.permissions === "string"
                                ? JSON.parse(staff.permissions || "{}")
                                : staff.permissions || {},
                    }),
                };
            }

            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: "Invalid email or password" }),
            };
        }

        // GET STAFF INVITATION DETAILS
        if (action === "get_staff_invite") {
            try {
                const { staff } = await getStaffInviteRecord(
                    connection,
                    body.invite_token
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(staff),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to load the invitation.",
                    }),
                };
            }
        }

        // SEND STAFF INVITATION OTP
        if (action === "send_staff_invite_otp") {
            try {
                await ensureStaffInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                if (staff.status !== "pending") {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "This invitation is no longer pending.",
                        }),
                    };
                }

                const otp = generateOtp();
                const otpHash = hashOtp(otp);
                const inviteTokenHash = hashInviteToken(inviteToken);

                await connection.execute(
                    `UPDATE staff_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0`,
                    [inviteTokenHash, staff.staff_email]
                );

                await connection.execute(
                    `INSERT INTO staff_invite_otps
                         (
                             invite_token_hash,
                             email,
                             otp_hash,
                             expires_at,
                             used
                         )
                     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), 0)`,
                    [
                        inviteTokenHash,
                        staff.staff_email,
                        otpHash,
                        STAFF_INVITE_OTP_EXPIRY_SECONDS,
                    ]
                );

                try {
                    await sendStaffInviteOtpEmail(
                        staff.staff_email,
                        otp,
                        staff.staff_name
                    );
                } catch (emailError) {
                    await connection.execute(
                        `UPDATE staff_invite_otps
                         SET used = 1
                         WHERE invite_token_hash = ?
                           AND email = ?
                           AND otp_hash = ?
                           AND used = 0`,
                        [inviteTokenHash, staff.staff_email, otpHash]
                    );
                    throw emailError;
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Verification code sent successfully.",
                        expires_in: STAFF_INVITE_OTP_EXPIRY_SECONDS,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to send the verification code.",
                    }),
                };
            }
        }

        // VERIFY STAFF INVITATION OTP
        if (action === "verify_staff_invite_otp") {
            try {
                await ensureStaffInviteOtpsTable(connection);

                const inviteToken = String(body.invite_token || "");
                const otp = String(body.otp || "").replace(/\D/g, "");
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                if (!/^\d{6}$/.test(otp)) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter the complete 6-digit verification code.",
                        }),
                    };
                }

                const inviteTokenHash = hashInviteToken(inviteToken);
                const otpHash = hashOtp(otp);

                await connection.execute(
                    `UPDATE staff_invite_otps
                     SET used = 1
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND used = 0
                       AND expires_at <= UTC_TIMESTAMP()`,
                    [inviteTokenHash, staff.staff_email]
                );

                const [otpRows] = await connection.execute(
                    `SELECT id
                     FROM staff_invite_otps
                     WHERE invite_token_hash = ?
                       AND email = ?
                       AND otp_hash = ?
                       AND used = 0
                       AND expires_at > UTC_TIMESTAMP()
                     ORDER BY id DESC
                     LIMIT 1`,
                    [
                        inviteTokenHash,
                        staff.staff_email,
                        otpHash,
                    ]
                );

                if (otpRows.length === 0) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Invalid or expired verification code.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE staff_invite_otps
                     SET used = 1,
                         verified_at = UTC_TIMESTAMP()
                     WHERE id = ?`,
                    [otpRows[0].id]
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Invited email verified successfully.",
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to verify the invitation code.",
                    }),
                };
            }
        }

        // UPDATE STAFF INVITATION DETAILS
        if (action === "update_staff_invite_details") {
            try {
                const inviteToken = String(body.invite_token || "");
                const staffName = String(body.staff_name || "").trim();
                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedStaffInvite(
                    connection,
                    inviteToken,
                    staff.staff_email
                );

                if (staffName.length < 2 || staffName.length > 120) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: "Enter a valid staff name.",
                        }),
                    };
                }

                await connection.execute(
                    `UPDATE staff
                     SET staff_name = ?
                     WHERE id = ?
                       AND invite_token = ?
                       AND status = 'pending'`,
                    [staffName, staff.staff_id, inviteToken]
                );

                const refreshed = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify(refreshed.staff),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to update the staff details.",
                    }),
                };
            }
        }

        // ACCEPT STAFF INVITE
        if (action === "accept_staff_invite") {
            try {
                const inviteToken = String(body.invite_token || "");
                const accountPassword = String(body.password || "");
                const requestedStaffName = String(
                    body.staff_name || ""
                ).trim();

                const { staff } = await getStaffInviteRecord(
                    connection,
                    inviteToken
                );

                await requireVerifiedStaffInvite(
                    connection,
                    inviteToken,
                    staff.staff_email
                );

                const passwordValid =
                    accountPassword.length >= 8 &&
                    /[A-Z]/.test(accountPassword) &&
                    /\d/.test(accountPassword) &&
                    /[^A-Za-z0-9]/.test(accountPassword);

                if (!passwordValid) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error:
                                "Password must contain at least 8 characters, one uppercase letter, one number, and one special character.",
                        }),
                    };
                }

                const finalStaffName =
                    requestedStaffName || staff.staff_name || "Staff";
                const hashedPassword = await bcrypt.hash(
                    accountPassword,
                    10
                );

                const [result] = await connection.execute(
                    `UPDATE staff
                     SET staff_name = ?,
                         password = ?,
                         status = 'active',
                         invite_token = NULL
                     WHERE id = ?
                       AND invite_token = ?
                       AND staff_email = ?
                       AND status = 'pending'`,
                    [
                        finalStaffName,
                        hashedPassword,
                        staff.staff_id,
                        inviteToken,
                        staff.staff_email,
                    ]
                );

                if (result.affectedRows === 0) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            error: "Invitation not found or already accepted.",
                        }),
                    };
                }

                const sessionToken = jwt.sign(
                    {
                        staff_id: staff.staff_id,
                        manager_id: staff.manager_id,
                        store_id: staff.store_id,
                        branch_id: staff.branch_id,
                        email: staff.staff_email,
                        role: "staff",
                    },
                    JWT_SECRET,
                    { expiresIn: "7d" }
                );

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Staff account activated successfully.",
                        token: sessionToken,
                        staff_id: staff.staff_id,
                        staff_name: finalStaffName,
                        staff_email: staff.staff_email,
                        manager_id: staff.manager_id,
                        manager_name: staff.manager_name,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        role: "staff",
                        status: "active",
                        permissions: staff.permissions,
                    }),
                };
            } catch (inviteError) {
                return {
                    statusCode: inviteError?.statusCode || 500,
                    headers,
                    body: JSON.stringify({
                        error:
                            inviteError?.message ||
                            "Unable to activate the staff account.",
                    }),
                };
            }
        }

        // GET STAFF BY MANAGER BRANCH
        if (action === "get_staff") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only managers can view branch staff" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;

            const [managerRows] = await connection.execute(
                `SELECT permissions
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                typeof managerRows[0].permissions === "string"
                    ? JSON.parse(managerRows[0].permissions || "{}")
                    : managerRows[0].permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to view staff",
                    }),
                };
            }

            const [staffRows] = await connection.execute(
                `SELECT
                     id,
                     staff_name,
                     staff_email,
                     status,
                     permissions,
                     invite_token,
                     created_at
                 FROM staff
                 WHERE store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?
                 ORDER BY id DESC`,
                [storeId, branchId, managerId]
            );

            const staff = [];
            const pendingInvites = [];

            for (const row of staffRows) {
                const parsedPermissions =
                    typeof row.permissions === "string"
                        ? JSON.parse(row.permissions || "{}")
                        : row.permissions || {};

                if (row.status === "active") {
                    staff.push({
                        id: row.id,
                        name: row.staff_name || "Unnamed staff",
                        email: row.staff_email || "",
                        status: "Accepted",
                        permissions: parsedPermissions,
                    });
                } else if (row.status === "pending") {
                    pendingInvites.push({
                        id: row.id,
                        email: row.staff_email || "",
                        invitedAt: row.created_at || "Recently",
                        expiresAt: "7 days after invite",
                        status: "Pending",
                        permissions: parsedPermissions,
                    });
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    staff,
                    pending_invites: pendingInvites,
                }),
            };
        }

        // UPDATE STAFF PERMISSIONS
        if (action === "update_staff_permissions") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only managers can update staff access" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const { staff_id, staff_email, permissions = {} } = body;

            if (!staff_id && !staff_email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing staff id or email" }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT permissions
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                typeof managerRows[0].permissions === "string"
                    ? JSON.parse(managerRows[0].permissions || "{}")
                    : managerRows[0].permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to update staff access",
                    }),
                };
            }

            let result;

            if (staff_id) {
                [result] = await connection.execute(
                    `UPDATE staff
                     SET permissions = ?
                     WHERE id = ?
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?`,
                    [
                        JSON.stringify(permissions || {}),
                        staff_id,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            } else {
                [result] = await connection.execute(
                    `UPDATE staff
                     SET permissions = ?
                     WHERE staff_email = ?
                       AND store_id = ?
                       AND branch_id = ?
                       AND manager_id = ?`,
                    [
                        JSON.stringify(permissions || {}),
                        staff_email,
                        storeId,
                        branchId,
                        managerId,
                    ]
                );
            }

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Staff not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Staff permissions updated successfully",
                    staff_updated: result.affectedRows,
                }),
            };
        }

        // RESEND STAFF INVITE
        if (action === "resend_staff_invite") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "manager") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only managers can resend staff invites" }),
                };
            }

            const managerId = decoded.manager_id;
            const storeId = decoded.store_id;
            const branchId = decoded.branch_id;
            const { staff_email } = body;

            if (!staff_email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing staff email" }),
                };
            }

            const [managerRows] = await connection.execute(
                `SELECT permissions
                 FROM managers
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND status = 'active'
                     LIMIT 1`,
                [managerId, storeId, branchId]
            );

            if (managerRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            const managerPermissions =
                typeof managerRows[0].permissions === "string"
                    ? JSON.parse(managerRows[0].permissions || "{}")
                    : managerRows[0].permissions || {};

            if (!managerPermissions.staff_management) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: "You do not have permission to resend staff invites",
                    }),
                };
            }

            const [staffRows] = await connection.execute(
                `SELECT id, staff_name, staff_email, status
                 FROM staff
                 WHERE staff_email = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?
                     LIMIT 1`,
                [staff_email, storeId, branchId, managerId]
            );

            if (staffRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Pending staff invite not found" }),
                };
            }

            const staff = staffRows[0];

            if (staff.status !== "pending") {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "This staff account is already accepted or inactive" }),
                };
            }

            const inviteToken = jwt.sign(
                {
                    store_id: storeId,
                    branch_id: branchId,
                    manager_id: managerId,
                    email: staff.staff_email,
                    type: "staff_invite",
                },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            await connection.execute(
                `UPDATE staff
                 SET invite_token = ?
                 WHERE id = ?
                   AND store_id = ?
                   AND branch_id = ?
                   AND manager_id = ?`,
                [inviteToken, staff.id, storeId, branchId, managerId]
            );

            const inviteLink = `http://localhost:3000/accept-staff-invite?token=${inviteToken}`;

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Staff invite resent successfully",
                    invite_link: inviteLink,
                    staff_email: staff.staff_email,
                    staff_name: staff.staff_name,
                }),
            };
        }

        // GET BRANCH MANAGERS
        if (action === "get_branch_managers") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (!decoded.store_id) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only store owners can view branch managers" }),
                };
            }

            const storeId = decoded.store_id;

            const [managerRows] = await connection.execute(
                `SELECT
                     managers.id,
                     managers.manager_name AS name,
                     managers.manager_email AS email,
                     managers.status,
                     managers.permissions,
                     branches.branch_name AS branch
                 FROM managers
                          JOIN branches ON managers.branch_id = branches.id
                 WHERE managers.store_id = ?
                 ORDER BY branches.branch_name ASC, managers.manager_name ASC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    managers: managerRows.map((manager) => ({
                        id: manager.id,
                        name: manager.name || "Unnamed manager",
                        email: manager.email || "",
                        branch: manager.branch || "No branch assigned",
                        status: manager.status || "pending",
                        permissions:
                            typeof manager.permissions === "string"
                                ? JSON.parse(manager.permissions || "{}")
                                : manager.permissions || {},
                    })),
                }),
            };
        }

        // GET BRANCHES
        if (action === "get_branches") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;

            if (!storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Missing store access" }),
                };
            }

            const [branchRows] = await connection.execute(
                `SELECT
                     branches.id,
                     branches.branch_name,
                     branches.contact_number,
                     branches.address,
                     COALESCE(managers.manager_name, '') AS manager_name,
                     COALESCE(managers.manager_email, '') AS manager_email,
                     COALESCE(managers.status, 'setup_pending') AS manager_status,
                     managers.permissions,
                     COUNT(staff.id) AS staff_count
                 FROM branches
                          LEFT JOIN managers ON managers.branch_id = branches.id
                          LEFT JOIN staff ON staff.branch_id = branches.id
                 WHERE branches.store_id = ?
                 GROUP BY
                     branches.id,
                     branches.branch_name,
                     branches.contact_number,
                     branches.address,
                     managers.manager_name,
                     managers.manager_email,
                     managers.status,
                     managers.permissions
                 ORDER BY branches.id ASC`,
                [storeId]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    branches: branchRows.map((branch) => ({
                        id: branch.id,
                        branch_name: branch.branch_name,
                        contact_number: branch.contact_number || "",
                        address: branch.address || "",
                        manager_name: branch.manager_name || "",
                        manager_email: branch.manager_email || "",
                        manager_status: branch.manager_status || "setup_pending",
                        staff_count: Number(branch.staff_count || 0),
                        revenue: 0,
                        bookings: 0,
                        permissions:
                            typeof branch.permissions === "string"
                                ? JSON.parse(branch.permissions || "{}")
                                : branch.permissions || {},
                    }))
                }),
            };
        }

        // UPDATE BRANCH
        if (action === "update_branch") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;

            if (!storeId) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Missing store access" }),
                };
            }

            const {
                branch_id,
                branch_name,
                contact_number,
                address,
                manager_name,
                manager_email,
                permissions = {},
            } = body;

            if (!branch_id || !branch_name) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing branch id or branch name" }),
                };
            }

            await connection.beginTransaction();

            try {
                const [branchResult] = await connection.execute(
                    `UPDATE branches
                     SET branch_name = ?,
                         contact_number = ?,
                         address = ?
                     WHERE id = ?
                       AND store_id = ?`,
                    [
                        branch_name,
                        contact_number || null,
                        address || null,
                        branch_id,
                        storeId,
                    ]
                );

                if (branchResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Branch not found" }),
                    };
                }

                const [managerResult] = await connection.execute(
                    `UPDATE managers
                     SET manager_name = ?,
                         manager_email = ?,
                         permissions = ?
                     WHERE branch_id = ?
                       AND store_id = ?`,
                    [
                        manager_name || null,
                        manager_email || null,
                        JSON.stringify(permissions || {}),
                        branch_id,
                        storeId,
                    ]
                );

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Branch updated successfully",
                        branch_updated: branchResult.affectedRows,
                        manager_updated: managerResult.affectedRows,
                        saved_permissions: permissions,
                    }),
                };
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: err.message }),
                };
            }
        }

// DELETE BRANCH
        if (action === "delete_branch") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            const storeId = decoded.store_id;
            const { branch_id } = body;

            if (!storeId || !branch_id) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing store or branch id" }),
                };
            }

            await connection.beginTransaction();

            try {
                await connection.execute(
                    `DELETE FROM staff
                     WHERE branch_id = ?
                       AND store_id = ?`,
                    [branch_id, storeId]
                );

                await connection.execute(
                    `DELETE FROM managers
                     WHERE branch_id = ?
                       AND store_id = ?`,
                    [branch_id, storeId]
                );

                const [branchResult] = await connection.execute(
                    `DELETE FROM branches
                     WHERE id = ?
                       AND store_id = ?`,
                    [branch_id, storeId]
                );

                if (branchResult.affectedRows === 0) {
                    await connection.rollback();

                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Branch not found" }),
                    };
                }

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Branch deleted successfully",
                    }),
                };
            } catch (err) {
                await connection.rollback();

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: err.message }),
                };
            }
        }

        // GET CURRENT USER
        if (action === "get_current_user") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role === "owner") {
                const [storeRows] = await connection.execute(
                    `SELECT id, store_name, owner_name, email
                     FROM stores
                     WHERE id = ?
                         LIMIT 1`,
                    [decoded.store_id]
                );

                if (!storeRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Owner store not found" }),
                    };
                }

                const store = storeRows[0];

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "owner",
                        store_id: store.id,
                        store_name: store.store_name,
                        owner_name: store.owner_name,
                        email: store.email,
                    }),
                };
            }

            if (decoded.role === "manager") {
                const [managerRows] = await connection.execute(
                    `SELECT
                         managers.id,
                         managers.manager_name,
                         managers.manager_email,
                         managers.permissions,
                         managers.status,
                         managers.store_id,
                         managers.branch_id,
                         branches.branch_name,
                         stores.store_name
                     FROM managers
                              JOIN branches ON managers.branch_id = branches.id
                              JOIN stores ON managers.store_id = stores.id
                     WHERE managers.id = ?
                       AND managers.store_id = ?
                       AND managers.branch_id = ?
                         LIMIT 1`,
                    [decoded.manager_id, decoded.store_id, decoded.branch_id]
                );

                if (!managerRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Manager not found" }),
                    };
                }

                const manager = managerRows[0];

                if (manager.status !== "active") {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({
                            error: "Account deactivated",
                            code: "ACCOUNT_DEACTIVATED",
                            message:
                                "Your branch manager account has been deactivated. Please contact the store owner if you think this was a mistake.",
                        }),
                    };
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "manager",
                        manager_id: manager.id,
                        manager_name: manager.manager_name,
                        manager_email: manager.manager_email,
                        store_id: manager.store_id,
                        store_name: manager.store_name,
                        branch_id: manager.branch_id,
                        branch_name: manager.branch_name,
                        permissions:
                            typeof manager.permissions === "string"
                                ? JSON.parse(manager.permissions || "{}")
                                : manager.permissions || {},
                    }),
                };
            }

            if (decoded.role === "staff") {
                const [staffRows] = await connection.execute(
                    `SELECT
                         staff.id,
                         staff.staff_name,
                         staff.staff_email,
                         staff.permissions,
                         staff.store_id,
                         staff.branch_id,
                         staff.manager_id,
                         branches.branch_name,
                         stores.store_name
                     FROM staff
                              JOIN branches ON staff.branch_id = branches.id
                              JOIN stores ON staff.store_id = stores.id
                     WHERE staff.id = ?
                       AND staff.store_id = ?
                       AND staff.branch_id = ?
                       AND staff.status = 'active'
                         LIMIT 1`,
                    [decoded.staff_id, decoded.store_id, decoded.branch_id]
                );

                if (!staffRows.length) {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({ error: "Staff not found" }),
                    };
                }

                const staff = staffRows[0];

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        role: "staff",
                        staff_id: staff.id,
                        staff_name: staff.staff_name,
                        staff_email: staff.staff_email,
                        store_id: staff.store_id,
                        store_name: staff.store_name,
                        branch_id: staff.branch_id,
                        branch_name: staff.branch_name,
                        manager_id: staff.manager_id,
                        permissions:
                            typeof staff.permissions === "string"
                                ? JSON.parse(staff.permissions || "{}")
                                : staff.permissions || {},
                    }),
                };
            }

            // DEACTIVATE MANAGER


            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Invalid role" }),
            };
        }
        // DEACTIVATE MANAGER
        if (action === "deactivate_manager") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "owner") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only owners can deactivate managers" }),
                };
            }

            const storeId = decoded.store_id;
            const { manager_id } = body;

            if (!storeId || !manager_id) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing manager id" }),
                };
            }

            const [result] = await connection.execute(
                `UPDATE managers
                 SET status = 'inactive'
                 WHERE id = ?
                   AND store_id = ?`,
                [manager_id, storeId]
            );

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Manager deactivated successfully",
                    manager_updated: result.affectedRows,
                }),
            };
        }
        // REACTIVATE MANAGER
        if (action === "reactivate_manager") {
            const authHeader =
                event.headers?.Authorization || event.headers?.authorization || "";

            const token = authHeader.replace("Bearer ", "");

            if (!token) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Missing token" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid token" }),
                };
            }

            if (decoded.role !== "owner") {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({ error: "Only owners can reactivate managers" }),
                };
            }

            const storeId = decoded.store_id;
            const { manager_id } = body;

            if (!storeId || !manager_id) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing manager id" }),
                };
            }

            const [result] = await connection.execute(
                `UPDATE managers
                 SET status = 'active'
                 WHERE id = ?
                   AND store_id = ?`,
                [manager_id, storeId]
            );

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Manager not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Manager reactivated successfully",
                    manager_updated: result.affectedRows,
                }),
            };
        }

        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Invalid action" }),
        };
    } catch (err) {
        console.error("[stocknbook-auth] Error:", {
            action,
            message: err?.message,
            code: err?.code,
            stack: err?.stack,
        });

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: err?.message || "Internal server error",
                code: err?.code || "UNKNOWN_ERROR",
            }),
        };
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};