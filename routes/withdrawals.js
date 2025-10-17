// routes/withdrawals.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (withdrawalsCollection, usersCollection, paymentsCollection) => {
    
    // উত্তোলন রিকোয়েস্ট সাবমিট
    router.post('/', async (req, res) => {
        try {
            const {
                userId,
                email,
                paymentMethodId,
                amount,
                status = 'pending'
            } = req.body;

            console.log('Withdrawal request received:', { userId, email, paymentMethodId, amount });

            // ভ্যালিডেশন
            if (!userId || !email || !paymentMethodId || !amount) {
                return res.status(400).json({
                    success: false,
                    message: 'সবগুলো ফিল্ড পূরণ করুন'
                });
            }

            const withdrawalAmount = parseFloat(amount);

            if (withdrawalAmount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'টাকার পরিমাণ ০ এর বেশি হতে হবে'
                });
            }

            if (withdrawalAmount < 200) {
                return res.status(400).json({
                    success: false,
                    message: 'ন্যূনতম ৳200 উত্তোলন করতে হবে'
                });
            }

            // ইউজারের ব্যালেন্স চেক
            const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'ইউজার পাওয়া যায়নি'
                });
            }

            console.log('User balance:', user.balance, 'Withdrawal amount:', withdrawalAmount);

            if (user.balance < withdrawalAmount) {
                return res.status(400).json({
                    success: false,
                    message: 'আপনার ব্যালেন্স পর্যাপ্ত নয়'
                });
            }

            // পেমেন্ট মেথড তথ্য পাওয়া
            const paymentMethod = await paymentsCollection.findOne({
                _id: new ObjectId(paymentMethodId)
            });

            if (!paymentMethod) {
                return res.status(404).json({
                    success: false,
                    message: 'পেমেন্ট মেথড পাওয়া যায়নি'
                });
            }

            // ব্যালেন্স আপডেট (সাথে সাথে কেটে নাও)
            const newBalance = user.balance - withdrawalAmount;
            const updateResult = await usersCollection.updateOne(
                { _id: new ObjectId(userId) },
                { $set: { balance: newBalance } }
            );

            console.log('Balance update result:', updateResult);

            // উত্তোলন রেকর্ড তৈরি
            const withdrawalData = {
                userId: new ObjectId(userId),
                userEmail: email,
                userName: user.displayName || user.firstName + ' ' + user.lastName || 'User',
                paymentMethod: paymentMethod.paymentMethod,
                paymentNumber: paymentMethod.phoneNumber,
                paymentMethodId: new ObjectId(paymentMethodId),
                amount: withdrawalAmount,
                previousBalance: user.balance,
                newBalance: newBalance,
                status: 'pending',
                createdAt: new Date(),
                approvedAt: null,
                approvedBy: null
            };

            const result = await withdrawalsCollection.insertOne(withdrawalData);

            console.log('Withdrawal record created:', result.insertedId);

            res.json({
                success: true,
                message: 'Withdrawal রিকোয়েস্ট সাবমিট হয়েছে!',
                data: {
                    _id: result.insertedId,
                    ...withdrawalData
                }
            });

        } catch (error) {
            console.error('Withdrawal error:', error);
            res.status(500).json({
                success: false,
                message: 'এরর হয়েছে!'
            });
        }
    });

    // উত্তোলন স্ট্যাটাস আপডেট (এডমিন)
    router.patch('/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            const { status, approvedBy } = req.body;

            if (!['pending', 'approved', 'rejected'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'অবৈধ স্ট্যাটাস'
                });
            }

            const withdrawal = await withdrawalsCollection.findOne({ 
                _id: new ObjectId(id) 
            });

            if (!withdrawal) {
                return res.status(404).json({
                    success: false,
                    message: 'উত্তোলন রিকোয়েস্ট পাওয়া যায়নি'
                });
            }

            // যদি rejected হয়, তাহলে ব্যালেন্স ফেরত দিন
            if (status === 'rejected' && withdrawal.status === 'pending') {
                await usersCollection.updateOne(
                    { _id: new ObjectId(withdrawal.userId) },
                    { $inc: { balance: withdrawal.amount } }
                );
                
                console.log(`User ${withdrawal.userId} balance returned: +${withdrawal.amount}`);
            }

            const updateData = {
                status,
                approvedAt: status !== 'pending' ? new Date() : null,
                approvedBy: status !== 'pending' ? approvedBy : null
            };

            await withdrawalsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateData }
            );

            res.json({
                success: true,
                message: `উত্তোলন রিকোয়েস্ট ${status} করা হয়েছে`
            });

        } catch (error) {
            console.error('Update withdrawal status error:', error);
            res.status(500).json({
                success: false,
                message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে'
            });
        }
    });

    // ইউজারের উত্তোলন হিস্ট্রি
    router.get('/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;

            const withdrawals = await withdrawalsCollection
                .find({ userId: new ObjectId(userId) })
                .sort({ createdAt: -1 })
                .toArray();

            res.json({
                success: true,
                data: withdrawals
            });

        } catch (error) {
            console.error('Get withdrawals error:', error);
            res.status(500).json({
                success: false,
                message: 'উত্তোলন হিস্ট্রি লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // সকল উত্তোলন রিকোয়েস্ট (এডমিন)
    router.get('/all', async (req, res) => {
        try {
            const { status, page = 1, limit = 20 } = req.query;
            
            let query = {};
            if (status && status !== 'all') {
                query.status = status;
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);
            
            const withdrawals = await withdrawalsCollection
                .find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .toArray();

            const total = await withdrawalsCollection.countDocuments(query);

            res.json({
                success: true,
                data: withdrawals,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalWithdrawals: total
                }
            });

        } catch (error) {
            console.error('Get all withdrawals error:', error);
            res.status(500).json({
                success: false,
                message: 'উত্তোলন রিকোয়েস্ট লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // Health check
    router.get('/health', (req, res) => {
        res.json({
            success: true,
            message: 'Withdrawals API is working'
        });
    });

    return router;
};