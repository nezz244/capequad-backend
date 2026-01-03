require('dotenv').config(); // <--- MUST be first
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');



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
    try {
        const b = req.body;

        await db.execute(`
            INSERT INTO bookings
            (full_name, email, phone, service, total_tickets, total_cost, transport, payment_ref, booking_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            b.fullName, b.email, b.phoneNumber, b.service,
            b.totalTickets, b.totalCost, b.transport,
            b.paymentRef, b.date
        ]);

        res.send({ message: 'Booking created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to create booking' });
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
