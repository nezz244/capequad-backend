const firebase = require('firebase');
const firebaseConfig = {
  apiKey: "AIzaSyD9G8oaFyJmxdpqR2Su0tYM-YOdcVA9F9E",
  authDomain: "cape-quad-6454d.firebaseapp.com",
  projectId: "cape-quad-6454d",
  storageBucket: "cape-quad-6454d.appspot.com",
  messagingSenderId: "987086203604",
  appId: "1:987086203604:web:881040616d073cd92c2941",
  measurementId: "G-ZJCMB5X2X8"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const User = db.collection('Users');
const Booking = db.collection('Bookings');

module.exports = User;
module.exports = Booking;