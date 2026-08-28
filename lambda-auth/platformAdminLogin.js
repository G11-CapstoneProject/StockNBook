// lambda-auth/platformAdminLogin.js
//
// Copy this file into your existing lambda-auth folder.
// It is a helper file, not a replacement for your current lambda-auth/index.js.
//
// Required npm plans in lambda-auth:
// bcryptjs, jsonwebtoken

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

async function tryPlatformAdminLogin({
                                         connection,
                                         email,
                                         password,
                                     }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const enteredPassword = String(password || "");

    if (!normalizedEmail || !enteredPassword) {
        return null;
    }

    const [rows] = await connection.execute(
        `
            SELECT
                platform_admin_id,
                full_name,
                email,
                password_hash,
                role,
                is_active
            FROM platform_admins
            WHERE email = ?
            LIMIT 1
        `,
        [normalizedEmail]
    );

    const admin = rows[0];

    if (!admin) {
        return null;
    }

    if (!admin.is_active) {
        const error = new Error("Platform Administrator account is inactive.");
        error.statusCode = 403;
        throw error;
    }

    const passwordMatches = await bcrypt.compare(
        enteredPassword,
        admin.password_hash
    );

    if (!passwordMatches) {
        const error = new Error("Invalid email or password.");
        error.statusCode = 401;
        throw error;
    }

    const token = jwt.sign(
        {
            platform_admin_id: admin.platform_admin_id,
            email: admin.email,
            full_name: admin.full_name,
            role: "PLATFORM_ADMIN",
        },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
    );

    return {
        token,
        user: {
            id: admin.platform_admin_id,
            platform_admin_id: admin.platform_admin_id,
            full_name: admin.full_name,
            email: admin.email,
            role: "PLATFORM_ADMIN",
        },
    };
}

module.exports = {
    tryPlatformAdminLogin,
};