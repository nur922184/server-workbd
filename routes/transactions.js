// routes/transactions.js - Updated with referral bonus on approval
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (transactionsCollection, usersCollection, referralsCollection) => {
    
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
                type: 'deposit',
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

    // ✅ রেফারেল বোনাস প্রসেসিং ফাংশন
    const processReferralBonus = async (userId, depositAmount, transactionId) => {
        try {
            // রেফারেল তথ্য খুঁজুন
            const referral = await referralsCollection.findOne({
                referredUserId: new ObjectId(userId),
                status: 'pending', // শুধু pending রেফারেল
                hasDeposited: false // ডিপোজিট করা হয়নি
            });

            if (!referral) {
                console.log('No pending referral found for user:', userId);
                return { success: false, message: 'No pending referral' };
            }

            // রেফারেল স্ট্যাটাস active করুন
            await referralsCollection.updateOne(
                { _id: referral._id },
                { 
                    $set: { 
                        status: 'active',
                        hasDeposited: true,
                        depositApproved: true,
                        firstDepositDate: new Date(),
                        firstDepositAmount: depositAmount
                    } 
                }
            );

            // রেফারারকে ৬০ টাকা বোনাস দিন
            await usersCollection.updateOne(
                { _id: referral.referrerUserId },
                { 
                    $inc: { 
                        balance: 60,
                        totalCommission: 60,
                        referralEarnings: 60
                    } 
                }
            );

            // রেফারেল বোনাস ট্রানজেকশন রেকর্ড
            const bonusTransaction = {
                userId: referral.referrerUserId,
                userEmail: referral.referrerEmail,
                userName: 'Referral Bonus',
                amount: 60,
                type: 'referral_bonus',
                description: `রেফারেল ডিপোজিট বোনাস - ${referral.referredEmail}`,
                status: 'completed',
                date: new Date(),
                referralId: referral._id,
                fromDepositAmount: depositAmount,
                fromTransactionId: transactionId
            };
            await transactionsCollection.insertOne(bonusTransaction);

            // রেফারেলের কমিশন হিস্ট্রি আপডেট
            await referralsCollection.updateOne(
                { _id: referral._id },
                { 
                    $inc: { totalEarned: 60 },
                    $push: { 
                        commissionHistory: {
                            type: 'deposit_bonus',
                            amount: 60,
                            depositAmount: depositAmount,
                            date: new Date(),
                            status: 'completed',
                            transactionId: new ObjectId(transactionId)
                        }
                    } 
                }
            );

            console.log(`Referral bonus processed: ${referral.referrerEmail} received 60 BDT`);

            return { 
                success: true, 
                message: 'Referral bonus processed successfully',
                data: {
                    referrerId: referral.referrerUserId.toString(),
                    referrerEmail: referral.referrerEmail,
                    bonusAmount: 60
                }
            };

        } catch (error) {
            console.error('Referral bonus processing error:', error);
            return { success: false, message: 'Referral bonus processing failed' };
        }
    };

    // ✅ ট্রানজেকশন স্ট্যাটাস আপডেট (এডমিনের জন্য) - Updated with referral bonus
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

            let referralBonusResult = null;

            // ✅ নতুন: যদি approved হয়, তাহলে ইউজারের ব্যালেন্স আপডেট করুন + রেফারেল বোনাস প্রসেস
            if (status === 'approved') {
                const transaction = await transactionsCollection.findOne({ 
                    _id: new ObjectId(id) 
                });

                if (transaction) {
                    // ১. ইউজারের ব্যালেন্স আপডেট
                    await usersCollection.updateOne(
                        { _id: new ObjectId(transaction.userId) },
                        { $inc: { balance: transaction.amount } }
                    );

                    // ২. রেফারেল বোনাস প্রসেস (যদি থাকে)
                    referralBonusResult = await processReferralBonus(
                        transaction.userId, 
                        transaction.amount,
                        id
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

            // ✅ রেস্পন্সে রেফারেল বোনাস ইনফো যোগ করুন
            let responseMessage = `ট্রানজেকশন ${status} করা হয়েছে`;
            
            if (status === 'approved' && referralBonusResult?.success) {
                responseMessage += ` এবং রেফারেল বোনাস (৬০ টাকা) প্রদান করা হয়েছে`;
            }

            res.json({
                success: true,
                message: responseMessage,
                data: {
                    transactionUpdated: true,
                    referralBonus: referralBonusResult
                }
            });

        } catch (error) {
            console.error('Update transaction status error:', error);
            res.status(500).json({
                success: false,
                message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে'
            });
        }
    });

    // ✅ রেফারেল বোনাস স্ট্যাটাস চেক
    router.get('/referral-bonus/:userId', async (req, res) => {
        try {
            const { userId } = req.params;

            const referral = await referralsCollection.findOne({
                referredUserId: new ObjectId(userId),
                status: 'active',
                hasDeposited: true
            });

            if (!referral) {
                return res.json({
                    success: true,
                    data: {
                        hasReferralBonus: false,
                        message: 'কোন রেফারেল বোনাস নেই'
                    }
                });
            }

            // রেফারেল বোনাস ট্রানজেকশন খুঁজুন
            const bonusTransaction = await transactionsCollection.findOne({
                referralId: referral._id,
                type: 'referral_bonus'
            });

            res.json({
                success: true,
                data: {
                    hasReferralBonus: true,
                    referral: {
                        referrerEmail: referral.referrerEmail,
                        firstDepositAmount: referral.firstDepositAmount,
                        firstDepositDate: referral.firstDepositDate,
                        bonusAmount: 60
                    },
                    bonusTransaction: bonusTransaction
                }
            });

        } catch (error) {
            console.error('Check referral bonus error:', error);
            res.status(500).json({
                success: false,
                message: 'রেফারেল বোনাস তথ্য লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // ট্রানজেকশন ডিলিট
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;

            // ✅ প্রথমে ট্রানজেকশন তথ্য নিন (রোলব্যাকের জন্য)
            const transaction = await transactionsCollection.findOne({ 
                _id: new ObjectId(id) 
            });

            if (!transaction) {
                return res.status(404).json({
                    success: false,
                    message: 'ট্রানজেকশন পাওয়া যায়নি'
                });
            }

            // ✅ যদি approved transaction ডিলিট হয়, তাহলে ব্যালেন্স রোলব্যাক করুন
            if (transaction.status === 'approved') {
                await usersCollection.updateOne(
                    { _id: new ObjectId(transaction.userId) },
                    { $inc: { balance: -transaction.amount } }
                );

                // ✅ রেফারেল বোনাসও রোলব্যাক করুন (যদি থাকে)
                const referralBonus = await transactionsCollection.findOne({
                    fromTransactionId: new ObjectId(id),
                    type: 'referral_bonus'
                });

                if (referralBonus) {
                    await usersCollection.updateOne(
                        { _id: new ObjectId(referralBonus.userId) },
                        { $inc: { 
                            balance: -referralBonus.amount,
                            totalCommission: -referralBonus.amount,
                            referralEarnings: -referralBonus.amount
                        } }
                    );

                    // রেফারেল বোনাস ট্রানজেকশন ডিলিট করুন
                    await transactionsCollection.deleteOne({
                        _id: referralBonus._id
                    });

                    // রেফারেল স্ট্যাটাস রিসেট করুন
                    await referralsCollection.updateOne(
                        { _id: referralBonus.referralId },
                        { 
                            $set: { 
                                status: 'pending',
                                hasDeposited: false,
                                depositApproved: false
                            },
                            $inc: { totalEarned: -referralBonus.amount }
                        }
                    );
                }
            }

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