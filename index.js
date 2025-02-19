const express = require('express');
const  cors = require('cors');
const User = require('./config');
const Booking = require('./config');
const app = express();

const path = require(`path`);

app.use(cors());
app.use(express.json());



app.get('', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


app.post("/user/create", async (req, res) => {
    const data = req.body;
    await User.add(data);
    // console.log('user data is ' , data);
    res.send({message: 'User created successfully'});
}
);


app.post("/create/checkout", async (req, res) => {
        const data = req.body;

        // await User.add(data);
        // console.log('user data is ' , data);
        // res.send({message: 'User created successfully'});

        const apiUrl = 'https://payments.yoco.com/api/checkouts';
        const secretKey = 'sk_test_1721ad63zabA7rJ1acd4262a7bff';
        // sk_live_fc9f5c36zabA7rJ357648dc9fcaf
        // https://app-capequad-bookings.web.app/success
        // https://app-capequad-bookings.web.app/failure
        // Replace with your actual secret key
        const requestData = {
        amount:  data.totalCost,
        currency: 'ZAR',
        successUrl:'http://localhost:4200/success',
        failureUrl:'http://localhost:4200/failure'
    };



    const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secretKey}`
        },
        body: JSON.stringify(requestData)
    };

        
    fetch(apiUrl, options)
      .then(response => response.json())
      .then(response => {
        console.log(response);
        res.send({data:response});
      })
      .catch(err => console.error(err));


}
);


app.post("/send/email", async (req, res) => {
    var body = req.body;
    console.log(body);
    var postmark = require("postmark");

    // Send an email:
    var client = new postmark.ServerClient("7c101cb8-3b66-4763-bb09-43b642c9b254");

    client.sendEmail({
    "From": "info@capequad.com",
    "To": "info@capequad.com",
    "Subject": "New booking from Cape Quad",
    "HtmlBody": `<strong>Hello</strong> Admin.<br><br> You have a new booking from <strong> ${body.fullName} </strong>. Find their booking details below : <br><br> <strong> Date and Time </strong> : ${body.date}<br> <strong>Email address </strong> : ${body.email}  <br> <strong>Phone number</strong> :  ${body.phoneNumber} <br> <strong>Service</strong>: ${body.service} <br>  <strong>Total tickets </strong>: ${body.totalTickets} <br>  <strong>Total Paid</strong>: ${body.totalCost} <br>  <strong>Tranport Included</strong>: ${body.transport} <br>  <strong>Payment ref </strong>: ${body.paymentRef} <br><br> <strong>Cheers</strong> and happy touring 😄`,
    "TextBody": "Hello from Cape Quad!",
    "MessageStream": "outbound"
    });

    res.send();
    //save to booking to database

});




app.post("/bookings/create", async (req, res) => {
    const data = req.body; 
    await Booking.add(data);
    // console.log('user data is ' , data);
    res.send({message: 'Booking created successfully'});
}
);


app.get('/retrieve/users', async (req, res) => {
    const snapshot = await User.get();
    const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.send(list);
});


app.get('/retrieve/bookings', async (req, res) => {
    const snapshot = await Booking.get();
    const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.send(list);
});


app.post("/update/user", async (req, res) => {
    const id = req.body.id;
    delete req.body.id;
    const data = req.body;
    await User.doc(id).update(data);
    res.send({ msg: "Updated" });
});


app.post("/update/booking", async (req, res) => {
    const id = req.body.id;
    delete req.body.id;
    const data = req.body;
    await Booking.doc(id).update(data);
    res.send({ msg: "Updated" });
});


app.post("/delete/user", async (req, res) => {
    const id = req.body.id;
    await User.doc(id).delete();
    res.send({ msg: "Deleted" });
});

app.post("/delete/booking", async (req, res) => {
    const id = req.body.id;
    await Booking.doc(id).delete();
    res.send({ msg: "Deleted" });
});

app.listen(0000, () => {
    console.log('Server has started on port 0000');
}
);

