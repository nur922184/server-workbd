// routes/payments.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (paymentsCollection) => {
    
    // সকল পেমেন্ট মেথড পাওয়া
    router.get('/', async (req, res) => {
        try {
            const payments = await paymentsCollection.find({}).toArray();
            
            res.json({
                success: true,
                data: payments
            });
        } catch (error) {
            console.error('Get payments error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // নতুন পেমেন্ট মেথড যোগ করা
    router.post('/', async (req, res) => {
        try {
            const {
                userId,
                email,
                paymentMethod,
                phoneNumber
            } = req.body;

            // ভ্যালিডেশন
            if (!userId || !email || !paymentMethod || !phoneNumber) {
                return res.status(400).json({
                    success: false,
                    message: 'সবগুলো ফিল্ড পূরণ করুন'
                });
            }

            // ফোন নম্বর ভ্যালিডেশন
            const phoneRegex = /^01\d{9}$/;
            if (!phoneRegex.test(phoneNumber)) {
                return res.status(400).json({
                    success: false,
                    message: 'সঠিক মোবাইল নম্বর দিন (01 দিয়ে শুরু করে 11 ডিজিট)'
                });
            }

            // একই ইউজারের একই পেমেন্ট মেথড চেক
            const existingPayment = await paymentsCollection.findOne({
                email: email,
                paymentMethod: paymentMethod
            });

            if (existingPayment) {
                return res.status(400).json({
                    success: false,
                    message: `আপনার ${paymentMethod} ইতিমধ্যে সেভ করা আছে`
                });
            }

            // একই ফোন নম্বর চেক (যেকোনো ইউজারের)
            const existingPhone = await paymentsCollection.findOne({
                phoneNumber: phoneNumber,
                paymentMethod: paymentMethod
            });

            if (existingPhone) {
                return res.status(400).json({
                    success: false,
                    message: 'এই ফোন নম্বরটি ইতিমধ্যে ব্যবহার করা হয়েছে'
                });
            }

            // নতুন পেমেন্ট মেথড তৈরি
            const newPayment = {
                userId,
                email,
                paymentMethod,
                phoneNumber,
                accountHolder: '',
                accountType: 'personal',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const result = await paymentsCollection.insertOne(newPayment);

            res.json({
                success: true,
                message: `${paymentMethod} সফলভাবে সেভ হয়েছে!`,
                data: {
                    _id: result.insertedId,
                    ...newPayment
                }
            });

        } catch (error) {
            console.error('Add payment method error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড সেভ করতে সমস্যা হয়েছে'
            });
        }
    });

    // ইউজারের পেমেন্ট মেথড পাওয়া
    router.get('/user/:email', async (req, res) => {
        try {
            const { email } = req.params;

            const payments = await paymentsCollection
                .find({ 
                    email: email,
                    isActive: true 
                })
                .sort({ createdAt: -1 })
                .toArray();

            res.json({
                success: true,
                data: payments
            });

        } catch (error) {
            console.error('Get user payments error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // পেমেন্ট মেথড আপডেট
    router.put('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const updateData = {
                ...req.body,
                updatedAt: new Date()
            };

            const result = await paymentsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateData }
            );

            if (result.modifiedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'পেমেন্ট মেথড পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: 'পেমেন্ট মেথড আপডেট হয়েছে'
            });

        } catch (error) {
            console.error('Update payment method error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড আপডেট করতে সমস্যা হয়েছে'
            });
        }
    });

    // পেমেন্ট মেথড ডিলিট
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;

            const result = await paymentsCollection.deleteOne({
                _id: new ObjectId(id)
            });

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'পেমেন্ট মেথড পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: 'পেমেন্ট মেথড ডিলিট করা হয়েছে'
            });

        } catch (error) {
            console.error('Delete payment method error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড ডিলিট করতে সমস্যা হয়েছে'
            });
        }
    });

    // নির্দিষ্ট পেমেন্ট মেথড পাওয়া
    router.get('/:id', async (req, res) => {
        try {
            const { id } = req.params;

            const payment = await paymentsCollection.findOne({
                _id: new ObjectId(id)
            });

            if (!payment) {
                return res.status(404).json({
                    success: false,
                    message: 'পেমেন্ট মেথড পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                data: payment
            });

        } catch (error) {
            console.error('Get payment method error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    return router;
};