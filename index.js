require('dotenv').config(); // <--- MUST be first
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');
const postmark = require('postmark');
const crypto = require('crypto');




const app = express();

// -------------------- CORS Setup --------------------
const allowedOrigins = [
    'https://capequad-bookings-production.up.railway.app',
    'https://capeadrenaline.com',
    'https://www.capeadrenaline.com',
    'https://cape-quad-new112.wn.r.appspot.com',
    'http://localhost:4200'
];

const corsOptions = {
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (!allowedOrigins.includes(origin)) {
            return callback(new Error('CORS blocked'), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));

// -------------------- Static --------------------
app.get('', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get("/test", (req, res) => {
    res.send("Server is alive!");
});
const nodemailer = require('nodemailer');


// 2️⃣ Send booking emails endpoint
// Initialize Postmark client
const client = new postmark.ServerClient(process.env.POSTMARK_API_KEY);

// Customer email template
const customerTemplate = `
<h1>Payment Success</h1>
<p>Booking created successfully!</p>
<p>Hi {{fullName}}, your booking for {{totalTickets}} {{bookingUnit}} on {{date}} at {{timeSlot}} has been created successfully with CapeAdrenaline.</p>
<p>We have your contact number as: {{phoneNumber}}</p>
<p>Your tour guide will contact you within an hour from the booking time. Happy touring!</p>
`;

// Admin email template
const adminTemplate = `
<h1>New Booking Alert</h1>
<p>A new booking has been created.</p>
<p>Customer: {{fullName}}</p>
<p>Phone: {{phoneNumber}}</p>
<p>Group size: {{totalTickets}} {{bookingUnit}}</p>
<p>Booking date: {{date}}</p>
<p>Time slot: {{timeSlot}}</p>
<p>Customer email: {{email}}</p>
<p>Transport: {{transport}}</p>
<p>Amount Paid: {{totalCost}}</p>
<p>Activity: {{service}}</p>
`;

const groupActivityCustomerTemplate = `
<h1>Group Activity Request Received</h1>
<p>Hi {{fullName}}, thanks for contacting CapeAdrenaline.</p>
<p>We received your request for {{groupActivityLabel}} and will contact you soon.</p>
`;

const groupActivityAdminTemplate = `
<h1>New Group Activity Request</h1>
<p>Customer: {{fullName}}</p>
<p>Phone: {{phoneNumber}}</p>
<p>Email: {{email}}</p>
<p>Activity type: {{groupActivityLabel}}</p>
<p>Message: {{message}}</p>
`;

function renderTemplate(template, data) {
    return template.replace(/{{(.*?)}}/g, (_, key) => data[key.trim()] || '');
}

function parsePositiveNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBookingDate(value) {
    const bookingDate = new Date(value);
    if (isNaN(bookingDate.getTime())) {
        return null;
    }

    return bookingDate.toISOString().split("T")[0];
}

function normalizeTimeSlot(value) {
    if (!value) {
        return null;
    }

    const match = String(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : null;
}

async function columnExists(tableName, columnName) {
    const [rows] = await db.execute(
        `
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        `,
        [tableName, columnName]
    );

    return Number(rows[0]?.count || 0) > 0;
}

async function ensureBookingColumns() {
    const columns = [
        { name: 'booking_time', definition: 'TIME NULL' },
        { name: 'price_unit', definition: 'VARCHAR(32) NULL' },
        { name: 'max_people_per_slot', definition: 'INT NULL' }
    ];

    for (const column of columns) {
        if (!(await columnExists('bookings', column.name))) {
            await db.execute(`ALTER TABLE bookings ADD COLUMN ${column.name} ${column.definition}`);
        }
    }
}

async function ensurePendingBookingsTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS pending_bookings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            booking_ref VARCHAR(64) NOT NULL UNIQUE,
            checkout_id VARCHAR(128) NULL UNIQUE,
            booking_payload JSON NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            webhook_payload JSON NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL
        )
    `);
}

async function assertSlotCapacity({ service, date, timeSlot, totalTickets, maxPeoplePerSlot }) {
    const formattedDate = normalizeBookingDate(date);
    const normalizedTimeSlot = normalizeTimeSlot(timeSlot);
    const requestedTickets = parsePositiveNumber(totalTickets);
    const slotLimit = parsePositiveNumber(maxPeoplePerSlot);

    if (!service) {
        return { ok: false, status: 400, error: 'Missing service.' };
    }
    if (!formattedDate) {
        return { ok: false, status: 400, error: 'Invalid date format.' };
    }
    if (!normalizedTimeSlot) {
        return { ok: false, status: 400, error: 'Invalid or missing time slot.' };
    }
    if (!requestedTickets) {
        return { ok: false, status: 400, error: 'Invalid totalTickets value.' };
    }
    if (!slotLimit) {
        return { ok: false, status: 400, error: 'Invalid maxPeoplePerSlot value.' };
    }

    await ensureBookingColumns();

    const [rows] = await db.execute(
        `
        SELECT COALESCE(SUM(total_tickets), 0) AS bookedTickets
        FROM bookings
        WHERE service = ?
          AND booking_date = ?
          AND booking_time = ?
        `,
        [service, formattedDate, `${normalizedTimeSlot}:00`]
    );

    const bookedTickets = Number(rows[0]?.bookedTickets || 0);
    if (bookedTickets + requestedTickets > slotLimit) {
        return {
            ok: false,
            status: 409,
            error: 'Selected time slot is no longer available.',
            details: {
                bookedTickets,
                requestedTickets,
                maxPeoplePerSlot: slotLimit,
                remaining: Math.max(slotLimit - bookedTickets, 0)
            }
        };
    }

    return { ok: true, formattedDate, normalizedTimeSlot, requestedTickets, slotLimit };
}

function bookingUnitForPayload(payload) {
    return payload.priceUnit === 'couple' ? 'couple(s)' : 'person(s)';
}

async function sendBookingEmails(booking) {
    const formattedDate = normalizeBookingDate(booking.date) || booking.date;
    const normalizedTimeSlot = normalizeTimeSlot(booking.timeSlot) || booking.timeSlot;
    const bookingUnit = bookingUnitForPayload(booking);

    const customerHtml = renderTemplate(customerTemplate, {
        fullName: booking.fullName,
        phoneNumber: booking.phoneNumber,
        totalTickets: booking.totalTickets,
        date: formattedDate,
        timeSlot: normalizedTimeSlot,
        bookingUnit,
        email: booking.email
    });

    const adminHtml = renderTemplate(adminTemplate, {
        fullName: booking.fullName,
        phoneNumber: booking.phoneNumber,
        totalTickets: booking.totalTickets,
        date: formattedDate,
        timeSlot: normalizedTimeSlot,
        bookingUnit,
        email: booking.email,
        totalCost: booking.totalCost,
        transport: booking.transport || '',
        service: booking.service
    });

    const customerResponse = await client.sendEmail({
        From: 'info@capeadrenaline.com',
        To: booking.email,
        Subject: 'Booking Confirmation',
        HtmlBody: customerHtml
    });

    const adminResponse = await client.sendEmail({
        From: 'info@capeadrenaline.com',
        To: 'info@capeadrenaline.com',
        Subject: 'New Booking Alert',
        HtmlBody: adminHtml
    });

    return { customerResponse, adminResponse };
}

async function createBookingRecord(booking) {
    const required = [
        "fullName", "email", "phoneNumber",
        "service", "totalTickets", "totalCost", "paymentRef", "date", "timeSlot", "maxPeoplePerSlot"
    ];
    const missing = required.filter(f => !booking[f]);
    if (missing.length) {
        return { ok: false, status: 400, error: "Missing required fields", fields: missing };
    }

    const capacity = await assertSlotCapacity(booking);
    if (!capacity.ok) {
        return capacity;
    }

    const [existing] = await db.execute(
        "SELECT id FROM bookings WHERE payment_ref = ? LIMIT 1",
        [booking.paymentRef]
    );
    if (existing.length) {
        return { ok: true, bookingId: existing[0].id, duplicate: true };
    }

    const [result] = await db.query(
        `
      INSERT INTO bookings
      (full_name, email, phone, service, total_tickets, total_cost, transport, payment_ref, booking_date, booking_time, price_unit, max_people_per_slot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
            booking.fullName,
            booking.email,
            booking.phoneNumber,
            booking.service,
            booking.totalTickets,
            booking.totalCost,
            booking.transport || '',
            booking.paymentRef,
            capacity.formattedDate,
            capacity.normalizedTimeSlot,
            booking.priceUnit || 'person',
            capacity.slotLimit
        ]
    );

    return { ok: true, bookingId: result.insertId };
}

function extractYocoEventType(payload) {
    return payload.type || payload.event || payload.eventType || payload.name || '';
}

function isSuccessfulYocoPayment(payload) {
    const eventType = String(extractYocoEventType(payload)).toLowerCase();
    const statusCandidates = [
        payload.status,
        payload.data?.status,
        payload.data?.object?.status,
        payload.payload?.status,
        payload.payload?.paymentStatus
    ].filter(Boolean).map(value => String(value).toLowerCase());

    return eventType.includes('succeed') ||
        eventType.includes('paid') ||
        statusCandidates.some(status => ['succeeded', 'successful', 'paid', 'complete', 'completed'].includes(status));
}

function extractYocoReference(payload) {
    const metadataCandidates = [
        payload.metadata,
        payload.data?.metadata,
        payload.data?.object?.metadata,
        payload.payload?.metadata,
        payload.payload?.checkout?.metadata,
        payload.checkout?.metadata
    ].filter(Boolean);

    for (const metadata of metadataCandidates) {
        if (metadata.bookingRef) {
            return { bookingRef: metadata.bookingRef };
        }
    }

    const checkoutId = payload.checkoutId ||
        payload.checkout?.id ||
        payload.data?.checkoutId ||
        payload.data?.checkout?.id ||
        payload.data?.object?.checkoutId ||
        payload.data?.object?.checkout?.id ||
        payload.payload?.checkoutId ||
        payload.payload?.checkout?.id ||
        payload.id ||
        payload.data?.id ||
        payload.data?.object?.id;

    return checkoutId ? { checkoutId } : {};
}

function extractYocoPaymentRef(payload, fallback) {
    return payload.paymentId ||
        payload.payment?.id ||
        payload.data?.paymentId ||
        payload.data?.payment?.id ||
        payload.data?.object?.paymentId ||
        payload.data?.object?.payment?.id ||
        payload.payload?.paymentId ||
        payload.payload?.payment?.id ||
        payload.id ||
        payload.data?.id ||
        payload.data?.object?.id ||
        fallback;
}

function timingSafeEqualString(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyYocoWebhook(req) {
    const secret = process.env.YOCO_WEBHOOK_SECRET;
    if (!secret) {
        return true;
    }

    const signature = req.get('webhook-signature') ||
        req.get('x-yoco-signature') ||
        req.get('yoco-signature') ||
        req.get('x-signature');

    if (!signature) {
        return false;
    }

    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const base64Digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    const normalizedSignature = signature.replace(/^sha256=/i, '');

    return timingSafeEqualString(normalizedSignature, digest) ||
        timingSafeEqualString(normalizedSignature, base64Digest);
}

// POST /send/email
app.post('/send/email', async (req, res) => {
    console.log("Body received email:", req.body);
    if (req.body.inquiryType === 'group_activity') {
        const {
            email,
            fullName,
            phoneNumber,
            groupActivityLabel,
            message
        } = req.body;

        if (!email || !fullName || !phoneNumber || !groupActivityLabel) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            const customerResponse = await client.sendEmail({
                From: 'info@capeadrenaline.com',
                To: email,
                Subject: 'Group Activity Request Received',
                HtmlBody: renderTemplate(groupActivityCustomerTemplate, {
                    fullName,
                    groupActivityLabel
                })
            });

            const adminResponse = await client.sendEmail({
                From: 'info@capeadrenaline.com',
                To: 'info@capeadrenaline.com',
                Subject: 'New Group Activity Request',
                HtmlBody: renderTemplate(groupActivityAdminTemplate, {
                    fullName,
                    phoneNumber,
                    email,
                    groupActivityLabel,
                    message: message || 'No message provided'
                })
            });

            return res.json({
                message: 'Group activity emails sent successfully',
                customerResponse,
                adminResponse
            });
        } catch (error) {
            console.error('Group activity email sending error:', error);
            return res.status(500).json({ error: 'Failed to send group activity emails', details: error.message });
        }
    }

    const {
        email,
        fullName,
        phoneNumber,
        totalTickets,
        date,
        timeSlot,
        totalCost,
        transport,
        service,
        priceUnit

    } = req.body;

    if (!email || !fullName || !phoneNumber || !totalTickets || !date || !timeSlot || !totalCost || !service) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const { customerResponse, adminResponse } = await sendBookingEmails({
            email,
            fullName,
            phoneNumber,
            totalTickets,
            date,
            timeSlot,
            totalCost,
            transport,
            service,
            priceUnit
        });

        res.json({
            message: 'Both emails sent successfully',
            customerResponse,
            adminResponse
        });
    } catch (error) {
        console.error('Email sending error:', error);
        res.status(500).json({ error: 'Failed to send emails', details: error.message });
    }
});


// -------------------- Checkout with Yoco --------------------
app.post("/create/checkout", async (req, res) => {
    try {
        const { totalCost } = req.body;

        const capacity = await assertSlotCapacity(req.body);
        if (!capacity.ok) {
            return res.status(capacity.status).send({
                error: capacity.error,
                details: capacity.details
            });
        }

        await ensurePendingBookingsTable();
        const bookingRef = crypto.randomUUID();

        const amountInCents = Math.round(Number(totalCost) * 100);

        const apiUrl = 'https://payments.yoco.com/api/checkouts';

        const requestOrigin = req.get('origin');
        const configuredBaseUrl = process.env.FRONTEND_BASE_URL;
        const derivedBaseUrl =
            !configuredBaseUrl && requestOrigin && allowedOrigins.includes(requestOrigin)
                ? requestOrigin
                : undefined;
        const frontendBaseUrl = (configuredBaseUrl || derivedBaseUrl || '').replace(/\/+$/, '');

        if (!frontendBaseUrl) {
            return res.status(500).send({
                error: 'FRONTEND_BASE_URL not configured',
                details:
                    'Set FRONTEND_BASE_URL on the server, or call this endpoint from an allowed Origin so redirects can be derived safely.'
            });
        }

        const requestData = {
            amount: amountInCents,
            currency: 'ZAR',
            successUrl: `${frontendBaseUrl}/success`,
            failureUrl: `${frontendBaseUrl}/failure`,
            metadata: {
                bookingRef
            }
        };

        console.log("Checkout:", { totalCost, amountInCents });

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`
            },
            body: JSON.stringify(requestData)
        });

        const json = await response.json();

        if (!response.ok) {
            console.error('Yoco error:', json);
            return res.status(400).send({ error: 'Payment failed', details: json });
        }

        await db.execute(
            `
            INSERT INTO pending_bookings
            (booking_ref, checkout_id, booking_payload, status)
            VALUES (?, ?, ?, ?)
            `,
            [
                bookingRef,
                json.id || null,
                JSON.stringify({ ...req.body, bookingRef }),
                'pending'
            ]
        );

        res.send({ data: json });

    } catch (err) {
        console.error('Checkout error:', err);
        res.status(500).send({ error: 'Payment API request failed', details: err.message });
    }
});

// -------------------- Yoco Webhook --------------------
app.post("/webhooks/yoco", async (req, res) => {
    try {
        if (!verifyYocoWebhook(req)) {
            return res.status(401).send({ error: 'Invalid webhook signature' });
        }

        const payload = req.body;
        console.log("Yoco webhook received:", payload);

        if (!isSuccessfulYocoPayment(payload)) {
            return res.json({ message: 'Webhook ignored', eventType: extractYocoEventType(payload) });
        }

        await ensurePendingBookingsTable();
        const { bookingRef, checkoutId } = extractYocoReference(payload);

        let rows;
        if (bookingRef) {
            [rows] = await db.execute(
                "SELECT * FROM pending_bookings WHERE booking_ref = ? LIMIT 1",
                [bookingRef]
            );
        } else if (checkoutId) {
            [rows] = await db.execute(
                "SELECT * FROM pending_bookings WHERE checkout_id = ? LIMIT 1",
                [checkoutId]
            );
        } else {
            return res.status(400).send({ error: 'Webhook did not include a booking reference or checkout id' });
        }

        if (!rows.length) {
            return res.status(404).send({ error: 'Pending booking not found' });
        }

        const pending = rows[0];
        if (pending.status === 'completed') {
            return res.json({ message: 'Booking already completed' });
        }

        const bookingPayload = typeof pending.booking_payload === 'string'
            ? JSON.parse(pending.booking_payload)
            : pending.booking_payload;
        const paymentRef = extractYocoPaymentRef(payload, pending.checkout_id || pending.booking_ref);
        const booking = {
            ...bookingPayload,
            paymentRef
        };

        const bookingResult = await createBookingRecord(booking);
        if (!bookingResult.ok) {
            return res.status(bookingResult.status).send({
                error: bookingResult.error,
                fields: bookingResult.fields,
                details: bookingResult.details
            });
        }

        if (!bookingResult.duplicate) {
            await sendBookingEmails(booking);
        }

        await db.execute(
            `
            UPDATE pending_bookings
            SET status = ?, webhook_payload = ?, completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            ['completed', JSON.stringify(payload), pending.id]
        );

        res.json({
            message: 'Booking completed',
            bookingId: bookingResult.bookingId,
            duplicate: !!bookingResult.duplicate
        });
    } catch (err) {
        console.error('Yoco webhook error:', err);
        res.status(500).send({ error: 'Failed to process Yoco webhook', details: err.message });
    }
});

// -------------------- Create User --------------------
app.post("/user/create", async (req, res) => {
    try {
        const { fullName, email, phoneNumber } = req.body;

        await db.execute(
            "INSERT INTO users (full_name, email, phone) VALUES (?, ?, ?)",
            [fullName, email, phoneNumber]
        );

        res.send({ message: 'User created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to create user' });
    }
});

// -------------------- Create Booking --------------------
app.post("/bookings/create", async (req, res) => {
    const b = req.body;

    console.log("Body received:", b);

    // 1️⃣ Validate required fields
    const required = [
        "fullName", "email", "phoneNumber",
        "service", "totalTickets", "totalCost", "paymentRef", "date", "timeSlot", "maxPeoplePerSlot"
    ];
    const missing = required.filter(f => !b[f]);
    if (missing.length) {
        return res.status(400).json({ error: "Missing required fields", fields: missing });
    }

    try {
        const bookingResult = await createBookingRecord(b);
        if (!bookingResult.ok) {
            return res.status(bookingResult.status).json({
                error: bookingResult.error,
                fields: bookingResult.fields,
                details: bookingResult.details
            });
        }

        res.json({
            message: bookingResult.duplicate ? "Booking already exists" : "Booking created successfully",
            bookingId: bookingResult.bookingId,
            duplicate: !!bookingResult.duplicate
        });
    } catch (err) {
        console.error("Booking creation error:", err);
        res.status(500).json({ error: "Failed to create booking", details: err.message });
    }
});

// -------------------- Retrieve Users --------------------
app.get('/retrieve/users', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM users ORDER BY id DESC");
        res.send(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to retrieve users' });
    }
});

// -------------------- Retrieve Bookings --------------------
app.get('/retrieve/bookings', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM bookings ORDER BY id DESC");
        res.send(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to retrieve bookings' });
    }
});

// -------------------- Update User --------------------
app.post("/update/user", async (req, res) => {
    try {
        const { id, fullName, email, phoneNumber } = req.body;

        await db.execute(
            "UPDATE users SET full_name=?, email=?, phone=? WHERE id=?",
            [fullName, email, phoneNumber, id]
        );

        res.send({ msg: "User updated" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to update user' });
    }
});

// -------------------- Update Booking --------------------
app.post("/update/booking", async (req, res) => {
    try {
        const b = req.body;
        const formattedDate = normalizeBookingDate(b.date);
        const normalizedTimeSlot = normalizeTimeSlot(b.timeSlot);

        if (!formattedDate) {
            return res.status(400).send({ error: 'Invalid date format' });
        }
        if (!normalizedTimeSlot) {
            return res.status(400).send({ error: 'Invalid or missing time slot' });
        }

        await ensureBookingColumns();

        await db.execute(`
            UPDATE bookings SET
            full_name=?, email=?, phone=?, service=?, total_tickets=?, 
            total_cost=?, transport=?, payment_ref=?, booking_date=?, booking_time=?, price_unit=?, max_people_per_slot=?
            WHERE id=?
        `, [
            b.fullName, b.email, b.phoneNumber, b.service,
            b.totalTickets, b.totalCost, b.transport,
            b.paymentRef, formattedDate, normalizedTimeSlot,
            b.priceUnit || 'person', parsePositiveNumber(b.maxPeoplePerSlot, null),
            b.id
        ]);

        res.send({ msg: "Booking updated" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to update booking' });
    }
});

// -------------------- Delete User --------------------
app.post("/delete/user", async (req, res) => {
    try {
        await db.execute("DELETE FROM users WHERE id=?", [req.body.id]);
        res.send({ msg: "User deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to delete user' });
    }
});

// -------------------- Delete Booking --------------------
app.post("/delete/booking", async (req, res) => {
    try {
        await db.execute("DELETE FROM bookings WHERE id=?", [req.body.id]);
        res.send({ msg: "Booking deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to delete booking' });
    }
});

// -------------------- Start --------------------
const PORT = process.env.PORT || 3307;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
