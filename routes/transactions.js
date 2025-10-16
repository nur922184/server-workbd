// routes/transactions.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (transactionsCollection, usersCollection) => {
    
    // ডিপোজিট ট্রানজেকশন সাবমিট
    router.post('/deposit', async (req, res) => {
        try {
            const {
                userId,
                userEmail,
                userName,
                amount,
                transactionId,
                paymentMethod,
                paymentNumber,
                status = 'pending'
            } = req.body;

            // ভ্যালিডেশন
            if (!userId || !amount || !transactionId || !paymentMethod) {
                return res.status(400).json({
                    success: false,
                    message: 'সবগুলো ফিল্ড পূরণ করুন'
                });
            }

            if (parseFloat(amount) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'টাকার পরিমাণ সঠিক নয়'
                });
            }

            // ট্রানজেকশন আইডি already exists কিনা চেক করুন
            const existingTransaction = await transactionsCollection.findOne({
                transactionId: transactionId
            });

            if (existingTransaction) {
                return res.status(400).json({
                    success: false,
                    message: 'এই ট্রানজেকশন আইডি ইতিমধ্যে ব্যবহার হয়েছে'
                });
            }

            // নতুন ট্রানজেকশন তৈরি করুন
            const newTransaction = {
                userId,
                userEmail,
                userName,
                amount: parseFloat(amount),
                transactionId,
                paymentMethod,
                paymentNumber,
                status: 'pending', // pending, approved, rejected
                date: new Date(),
                approvedAt: null,
                approvedBy: null
            };

            // ডাটাবেসে সেভ করুন
            const result = await transactionsCollection.insertOne(newTransaction);

            res.json({
                success: true,
                message: 'ট্রানজেকশন সফলভাবে সাবমিট হয়েছে',
                data: {
                    _id: result.insertedId,
                    ...newTransaction
                }
            });

        } catch (error) {
            console.error('Transaction submission error:', error);
            res.status(500).json({
                success: false,
                message: 'সার্ভার error, আবার চেষ্টা করুন'
            });
        }
    });

    // ইউজারের所有 ট্রানজেকশন পাওয়া
    router.get('/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;

            const transactions = await transactionsCollection
                .find({ userId })
                .sort({ date: -1 })
                .toArray();

            res.json({
                success: true,
                data: transactions
            });

        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json({
                success: false,
                message: 'ট্রানজেকশন লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // সকল ট্রানজেকশন (এডমিনের জন্য)
    router.get('/all', async (req, res) => {
        try {
            const { status, page = 1, limit = 20 } = req.query;
            
            let query = {};
            if (status && status !== 'all') {
                query.status = status;
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);
            
            const transactions = await transactionsCollection
                .find(query)
                .sort({ date: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .toArray();

            const total = await transactionsCollection.countDocuments(query);

            res.json({
                success: true,
                data: transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalTransactions: total
                }
            });

        } catch (error) {
            console.error('Get all transactions error:', error);
            res.status(500).json({
                success: false,
                message: 'ট্রানজেকশন লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // ট্রানজেকশন স্ট্যাটাস আপডেট (এডমিনের জন্য)
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

            const updateData = {
                status,
                approvedAt: status !== 'pending' ? new Date() : null,
                approvedBy: status !== 'pending' ? approvedBy : null
            };

            // যদি approved হয়, তাহলে ইউজারের ব্যালেন্স আপডেট করুন
            if (status === 'approved') {
                const transaction = await transactionsCollection.findOne({ 
                    _id: new ObjectId(id) 
                });

                if (transaction) {
                    await usersCollection.updateOne(
                        { _id: new ObjectId(transaction.userId) },
                        { $inc: { balance: transaction.amount } }
                    );
                }
            }

            const result = await transactionsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updateData }
            );

            if (result.modifiedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'ট্রানজেকশন পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: `ট্রানজেকশন ${status} করা হয়েছে`
            });

        } catch (error) {
            console.error('Update transaction status error:', error);
            res.status(500).json({
                success: false,
                message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে'
            });
        }
    });

    // ট্রানজেকশন ডিলিট
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;

            const result = await transactionsCollection.deleteOne({
                _id: new ObjectId(id)
            });

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'ট্রানজেকশন পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: 'ট্রানজেকশন ডিলিট করা হয়েছে'
            });

        } catch (error) {
            console.error('Delete transaction error:', error);
            res.status(500).json({
                success: false,
                message: 'ট্রানজেকশন ডিলিট করতে সমস্যা হয়েছে'
            });
        }
    });

    return router;
};