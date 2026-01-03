require('dotenv').config(); // <--- MUST be first
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');
const nodemailer = require('nodemailer');


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


// 1️⃣ Configure transporter (example with Gmail SMTP)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // e.g., your Gmail address
        pass: process.env.EMAIL_PASS  // e.g., app password if using Gmail
    }
});

// 2️⃣ Send booking emails endpoint
app.post("/send/email", async (req, res) => {
    const { fullName, email, phoneNumber, service, totalTickets, date, totalCost, transport, paymentRef } = req.body;

    // Validate required fields
    if (!fullName || !email || !phoneNumber || !service || !totalTickets || !date) {
        return res.status(400).json({ error: "Missing required booking details" });
    }

    // Convert date to readable format
    const bookingDate = new Date(date);
    const formattedDate = bookingDate.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    });

    try {
        // 3️⃣ Email to Admin
        const adminMailOptions = {
            from: `"CapeQuad" <${process.env.EMAIL_USER}>`,
            to: 'tnesara55@gmail.com',
            subject: `New Booking: ${fullName} - ${service}`,
            html: `
        <h3>New Booking Received</h3>
        <p><strong>Name:</strong> ${fullName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phoneNumber}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Tickets:</strong> ${totalTickets}</p>
        <p><strong>Transport:</strong> ${transport || 'N/A'}</p>
        <p><strong>Date:</strong> ${formattedDate}</p>
        <p><strong>Total Cost:</strong> ${totalCost}</p>
        <p><strong>Payment Ref:</strong> ${paymentRef}</p>
      `
        };

        await transporter.sendMail(adminMailOptions);

        // 4️⃣ Email to Client
        const clientMailOptions = {
            from: `"CapeQuad" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Booking Confirmation - ${service}`,
            html: `
        <p>Booking created successfully!</p>
        <p>Hi <strong>${fullName}</strong>,</p>
        <p>Your booking for <strong>${totalTickets} person(s)</strong> on <strong>${formattedDate}</strong> has been created successfully with Cape Quad.</p>
        <p>An email with booking details has been sent to <strong>info@capequad.com</strong>. Your tour guide will contact you within an hour from booking time. Happy touring! 💪</p>
      `
        };

        await transporter.sendMail(clientMailOptions);

        res.json({ message: "Emails sent successfully to admin and client" });

    } catch (err) {
        console.error("Email sending error:", err);
        res.status(500).json({ error: "Failed to send emails", details: err.message });
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
