const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Make sure node-fetch is installed
const path = require('path');

// Your Firestore / config imports
const User = require('./config');
const Booking = require('./config');

const app = express();

// -------------------- CORS Setup --------------------
const allowedOrigins = [
    'https://capequad-bookings-production.up.railway.app',
    'https://cape-quad-new112.wn.r.appspot.com',
    'http://localhost:4200' // for local dev
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true); // allow non-browser requests
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Enable preflight requests
app.options('*', cors());

// -------------------- Middleware --------------------
app.use(express.json());

// -------------------- Routes --------------------

// Serve index.html
app.get('', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Create user
app.post("/user/create", async (req, res) => {
    try {
        const data = req.body;
        await User.add(data);
        res.send({ message: 'User created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to create user' });
    }
});

// -------------------- Checkout with Yoco --------------------
app.post("/create/checkout", async (req, res) => {
    try {
        const data = req.body;

        const apiUrl = 'https://payments.yoco.com/api/checkouts';
        const secretKey = 'sk_test_1721ad63zabA7rJ1acd4262a7bff'; // Use environment variable in production

        const requestData = {
            amount: data.totalCost,
            currency: 'ZAR',
            successUrl: 'https://capequad-bookings-production.up.railway.app/success',
            failureUrl: 'https://capequad-bookings-production.up.railway.app/failure'
        };

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secretKey}`
            },
            body: JSON.stringify(requestData)
        };

        const response = await fetch(apiUrl, options);
        const json = await response.json();

        console.log('Yoco response:', json);
        res.send({ data: json });

    } catch (err) {
        console.error('Checkout error:', err);
        res.status(500).send({ error: 'Payment API request failed', details: err.message });
    }
});

// -------------------- Send email --------------------
app.post("/send/email", async (req, res) => {
    try {
        const body = req.body;
        const postmark = require("postmark");

        const client = new postmark.ServerClient("7c101cb8-3b66-4763-bb09-43b642c9b254");

        await client.sendEmail({
            From: "info@capequad.com",
            To: "tnesara55@gmail.com",
            Subject: "New booking from Cape Quad",
            HtmlBody: `<strong>Hello</strong> Admin.<br><br> You have a new booking from <strong> ${body.fullName} </strong>. <br><br> <strong> Date and Time </strong> : ${body.date}<br> <strong>Email address </strong> : ${body.email}  <br> <strong>Phone number</strong> :  ${body.phoneNumber} <br> <strong>Service</strong>: ${body.service} <br>  <strong>Total tickets </strong>: ${body.totalTickets} <br>  <strong>Total Paid</strong>: ${body.totalCost} <br>  <strong>Transport Included</strong>: ${body.transport} <br>  <strong>Payment ref </strong>: ${body.paymentRef} <br><br> <strong>Cheers</strong> and happy touring 😄`,
            TextBody: "Hello from Cape Quad!",
            MessageStream: "outbound"
        });

        res.send({ message: 'Email sent successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to send email' });
    }
});

// -------------------- Bookings --------------------
app.post("/bookings/create", async (req, res) => {
    try {
        const data = req.body;
        await Booking.add(data);
        res.send({ message: 'Booking created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to create booking' });
    }
});

// Retrieve users
app.get('/retrieve/users', async (req, res) => {
    try {
        const snapshot = await User.get();
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        res.send(list);
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to retrieve users' });
    }
});

// Retrieve bookings
app.get('/retrieve/bookings', async (req, res) => {
    try {
        const snapshot = await Booking.get();
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        res.send(list);
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to retrieve bookings' });
    }
});

// Update user
app.post("/update/user", async (req, res) => {
    try {
        const id = req.body.id;
        delete req.body.id;
        await User.doc(id).update(req.body);
        res.send({ msg: "User updated" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to update user' });
    }
});

// Update booking
app.post("/update/booking", async (req, res) => {
    try {
        const id = req.body.id;
        delete req.body.id;
        await Booking.doc(id).update(req.body);
        res.send({ msg: "Booking updated" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to update booking' });
    }
});

// Delete user
app.post("/delete/user", async (req, res) => {
    try {
        const id = req.body.id;
        await User.doc(id).delete();
        res.send({ msg: "User deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to delete user' });
    }
});

// Delete booking
app.post("/delete/booking", async (req, res) => {
    try {
        const id = req.body.id;
        await Booking.doc(id).delete();
        res.send({ msg: "Booking deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to delete booking' });
    }
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
