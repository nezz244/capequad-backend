require('dotenv').config(); // <--- MUST be first
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');
const postmark = require('postmark');




const app = express();

// -------------------- CORS Setup --------------------
const allowedOrigins = [
    'https://capequad-bookings-production.up.railway.app',
    'https://cape-quad-new112.wn.r.appspot.com',
    'http://localhost:4200'
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (!allowedOrigins.includes(origin)) {
            return callback(new Error('CORS blocked'), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(express.json());

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
<p>Hi {{fullName}}, your booking for {{totalTickets}} person(s) on {{date}} has been created successfully with CapeQuad.</p>
<p>We have your contact number as: {{phoneNumber}}</p>
<p>Your tour guide will contact you within an hour from the booking time. Happy touring!! 💪</p>
`;

// Admin email template
const adminTemplate = `
<h1>New Booking Alert</h1>
<p>A new booking has been created.</p>
<p>Customer: {{fullName}}</p>
<p>Phone: {{phoneNumber}}</p>
<p>People count: {{totalTickets}}</p>
<p>Booking date: {{date}}</p>
<p>Customer email: {{email}}</p>
<p>Transport: {{transport}}</p>
<p>Amount Paid: {{totalCost}}</p>
<p>Activity: {{service}}</p>
`;

function renderTemplate(template, data) {
    return template.replace(/{{(.*?)}}/g, (_, key) => data[key.trim()] || '');
}

// POST /send/email
app.post('/send/email', async (req, res) => {
    const {
        email,
        fullName,
        phoneNumber,
        totalTickets,
        date,
        totalCost,
        transport,
        service

    } = req.body;

    if (!email || !fullName || !phoneNumber || !totalTickets || !date || !totalCost || !transport || !service) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Prepare HTML bodies
        const customerHtml = renderTemplate(customerTemplate, {
            fullName,
            phoneNumber,
            totalTickets,
            date,
            email
        });

        const adminHtml = renderTemplate(adminTemplate, {
            fullName,
            phoneNumber,
            totalTickets,
            date,
            email,
            totalCost,
            transport,
            service
        });

        // Send email to customer
        const customerResponse = await client.sendEmail({
            From: 'info@capequad.com',
            To: email,
            Subject: 'Booking Confirmation ✅',
            HtmlBody: customerHtml
        });

        // Send email to admin
        const adminResponse = await client.sendEmail({
            From: 'info@capequad.com',
            To: 'info@capequad.com',
            Subject: 'New Booking Alert 📝',
            HtmlBody: adminHtml
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

        const apiUrl = 'https://payments.yoco.com/api/checkouts';

        const requestData = {
            amount: totalCost,
            currency: 'ZAR',
            successUrl: 'https://capequad-bookings-production.up.railway.app/success',
            failureUrl: 'https://capequad-bookings-production.up.railway.app/failure'
        };

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

        res.send({ data: json });

    } catch (err) {
        console.error('Checkout error:', err);
        res.status(500).send({ error: 'Payment API request failed', details: err.message });
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
        "service", "totalTickets", "totalCost",
        "transport", "paymentRef", "date"
    ];
    const missing = required.filter(f => !b[f]);
    if (missing.length) {
        return res.status(400).json({ error: "Missing required fields", fields: missing });
    }

    // 2️⃣ Ensure date is in proper format (YYYY-MM-DD)
    const bookingDate = new Date(b.date);
    if (isNaN(bookingDate.getTime())) {
        return res.status(400).json({
            error: "Invalid date format. Use YYYY-MM-DD."
        });
    }
    const formattedDate = bookingDate.toISOString().split("T")[0]; // YYYY-MM-DD

    try {
        // 3️⃣ Insert into database using db.query
        const [result] = await db.query(
            `
      INSERT INTO bookings
      (full_name, email, phone, service, total_tickets, total_cost, transport, payment_ref, booking_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
            [
                b.fullName,
                b.email,
                b.phoneNumber,
                b.service,
                b.totalTickets,
                b.totalCost,
                b.transport,
                b.paymentRef,
                formattedDate // use formatted YYYY-MM-DD
            ]
        );

        res.json({ message: "Booking created successfully", bookingId: result.insertId });
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

        await db.execute(`
            UPDATE bookings SET
            full_name=?, email=?, phone=?, service=?, total_tickets=?, 
            total_cost=?, transport=?, payment_ref=?, booking_date=?
            WHERE id=?
        `, [
            b.fullName, b.email, b.phoneNumber, b.service,
            b.totalTickets, b.totalCost, b.transport,
            b.paymentRef, b.date, b.id
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
