const express = require('express');
const router = express.Router();

module.exports = (paymentsCollection) => {

    // POST - Create new payment method
    router.post('/', async (req, res) => {
        try {
            const paymentData = req.body;

            // Just insert the data
            const result = await paymentsCollection.insertOne(paymentData);

            res.json({
                success: true,
                message: 'Payment method saved',
                insertedId: result.insertedId
            });

        } catch (error) {
            console.error('Payment save error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error'
            });
        }
    });

    // routes/payments.js - GET route যোগ করুন
    router.get('/', async (req, res) => {
        try {
            const payments = await paymentsCollection.find({}).toArray();

            res.json({
                success: true,
                data: payments
            });

        } catch (error) {
            console.error('Error fetching payments:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // User specific payment methods
    router.get('/user/:email', async (req, res) => {
        try {
            const { email } = req.params;

            const payments = await paymentsCollection.find({
                email: email
            }).toArray();

            res.json({
                success: true,
                data: payments
            });
        } catch (error) {
            console.error('Error fetching user payments:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    return router;
};