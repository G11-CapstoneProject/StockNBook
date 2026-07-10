const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "stocknbook-secret-key";

function generateSlug(storeName) {
    return storeName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

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

    if (event.httpMethod === "OPTIONS") {
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

        // SIGNUP
        if (action === "signup") {
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

            const storeId = decoded.store_id;
            const { branches = [] } = body;
            const inviteLinks = [];

            if (!branches.length) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "No branches provided" }),
                };
            }

            await connection.beginTransaction();

            try {
                for (const branch of branches) {
                    if (!branch.branch_name) continue;

                    const [branchResult] = await connection.execute(
                        `INSERT INTO branches
                             (store_id, branch_name, contact_number, address)
                         VALUES (?, ?, ?, ?)`,
                        [
                            storeId,
                            branch.branch_name,
                            branch.contact_number || null,
                            branch.address || null,
                        ]
                    );

                    const branchId = branchResult.insertId;

                    if (branch.manager_email) {
                        const inviteToken = jwt.sign(
                            {
                                store_id: storeId,
                                branch_id: branchId,
                                email: branch.manager_email,
                                type: "manager_invite",
                            },
                            JWT_SECRET,
                            { expiresIn: "7d" }
                        );

                        const inviteLink = `http://localhost:3000/accept-invite?token=${inviteToken}`;

                        inviteLinks.push({
                            manager_email: branch.manager_email,
                            manager_name: branch.manager_name || "",
                            branch_name: branch.branch_name,
                            invite_link: inviteLink,
                        });

                        await connection.execute(
                            `INSERT INTO managers
                             (store_id, branch_id, manager_name, manager_email, invite_token, permissions)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                storeId,
                                branchId,
                                branch.manager_name || null,
                                branch.manager_email,
                                inviteToken,
                                JSON.stringify(branch.permissions || {}),
                            ]
                        );
                    }
                }

                await connection.commit();

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: "Onboarding saved successfully",
                        invite_links: inviteLinks,
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

        // ACCEPT MANAGER INVITE
        if (action === "accept_manager_invite") {
            const { invite_token, password } = body;

            if (!invite_token || !password) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing invite token or password" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(invite_token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid or expired invitation" }),
                };
            }

            if (decoded.type !== "manager_invite") {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Invalid invitation type" }),
                };
            }

            const hashed = await bcrypt.hash(password, 10);

            const [result] = await connection.execute(
                `UPDATE managers
                 SET password = ?, status = 'active'
                 WHERE invite_token = ? AND manager_email = ?`,
                [hashed, invite_token, decoded.email]
            );

            if (result.affectedRows === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Invitation not found" }),
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Manager account activated successfully",
                }),
            };
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

        // ACCEPT STAFF INVITE
        if (action === "accept_staff_invite") {
            const { token, password } = body;

            if (!token || !password) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Missing token or password" }),
                };
            }

            let decoded;

            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (err) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: "Invalid or expired invitation" }),
                };
            }

            if (decoded.type !== "staff_invite") {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: "Invalid invitation type" }),
                };
            }

            const [staffRows] = await connection.execute(
                `SELECT id, staff_email, status
                 FROM staff
                 WHERE invite_token = ?
                   AND staff_email = ?
                   AND status = 'pending'
                     LIMIT 1`,
                [token, decoded.email]
            );

            if (staffRows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: "Invalid or expired invitation" }),
                };
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            await connection.execute(
                `UPDATE staff
                 SET password = ?,
                     status = 'active',
                     invite_token = NULL
                 WHERE id = ?`,
                [hashedPassword, staffRows[0].id]
            );

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: "Staff account activated successfully",
                }),
            };
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
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message }),
        };
    } finally {
        if (connection) {
            await connection.end();
        }
    }
};
