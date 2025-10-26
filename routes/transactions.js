// routes/transactions.js - Clean & Simplified Version with Referral Bonus System
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (transactionsCollection, usersCollection,userProductsCollection, referralsCollection) => {

    /** ✅ Helper Function: রেফারেল বোনাস প্রসেসিং */
    const processReferralBonus = async (userId, depositAmount, transactionId) => {
        try {
            const referral = await referralsCollection.findOne({
                referredUserId: new ObjectId(userId),
                status: 'pending',
                hasDeposited: false
            });

            if (!referral) return { success: false, message: 'No pending referral found' };

            // রেফারেল আপডেট
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

            // রেফারারকে বোনাস প্রদান (৬০ টাকা)
            const bonusAmount = 60;
            await usersCollection.updateOne(
                { _id: referral.referrerUserId },
                {
                    $inc: {
                        balance: bonusAmount,
                        totalCommission: bonusAmount,
                        referralEarnings: bonusAmount
                    }
                }
            );

            // বোনাস ট্রানজেকশন রেকর্ড
            await transactionsCollection.insertOne({
                userId: referral.referrerUserId,
                userEmail: referral.referrerEmail,
                userName: 'Referral Bonus',
                amount: bonusAmount,
                type: 'referral_bonus',
                description: `রেফারেল ডিপোজিট বোনাস - ${referral.referredEmail}`,
                status: 'completed',
                date: new Date(),
                referralId: referral._id,
                fromDepositAmount: depositAmount,
                fromTransactionId: transactionId
            });

            // রেফারেলের কমিশন হিস্ট্রি সংরক্ষণ
            await referralsCollection.updateOne(
                { _id: referral._id },
                {
                    $inc: { totalEarned: bonusAmount },
                    $push: {
                        commissionHistory: {
                            type: 'deposit_bonus',
                            amount: bonusAmount,
                            depositAmount,
                            date: new Date(),
                            status: 'completed',
                            transactionId: new ObjectId(transactionId)
                        }
                    }
                }
            );

            return {
                success: true,
                message: 'Referral bonus processed successfully',
                data: {
                    referrerId: referral.referrerUserId,
                    referrerEmail: referral.referrerEmail,
                    bonusAmount
                }
            };
        } catch (error) {
            console.error('Referral bonus error:', error);
            return { success: false, message: 'Referral bonus processing failed' };
        }
    };
    router.post('/daily-income-update', async (req, res) => {
        try {
            const today = new Date();
            const activeProducts = await userProductsCollection.find({
                status: 'active',
                remainingDays: { $gt: 0 }
            }).toArray();

            if (activeProducts.length === 0)
                return res.json({ success: true, message: 'আজকে কোনো ইনকাম আপডেটের প্রয়োজন নেই' });

            let updatedCount = 0;

            for (const item of activeProducts) {
                const { _id, userId, dailyIncome, remainingDays, totalEarned } = item;

                // 1️⃣ ইউজার ব্যালান্সে ইনকাম যোগ করা
                await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $inc: { balance: dailyIncome } }
                );

                // 2️⃣ ইউজার প্রোডাক্ট আপডেট করা
                const newRemainingDays = remainingDays - 1;
                await userProductsCollection.updateOne(
                    { _id: _id },
                    {
                        $set: {
                            remainingDays: newRemainingDays,
                            lastPaymentDate: today,
                            totalEarned: totalEarned + dailyIncome,
                            status: newRemainingDays <= 0 ? 'completed' : 'active'
                        }
                    }
                );

                // 3️⃣ ট্রানজ্যাকশন হিস্টোরিতে যোগ করা
                await transactionsCollection.insertOne({
                    userId: new ObjectId(userId),
                    type: 'daily_income',
                    amount: dailyIncome,
                    description: `Daily income credited from product ${item.productName}`,
                    date: today,
                    status: 'success'
                });

                updatedCount++;
            }

            res.json({
                success: true,
                message: `✅ ${updatedCount}টি ইউজারের ডেইলি ইনকাম সফলভাবে আপডেট হয়েছে`,
                date: today
            });

        } catch (error) {
            console.error('Daily income update error:', error);
            res.status(500).json({
                success: false,
                message: 'ডেইলি ইনকাম আপডেট করতে সমস্যা হয়েছে'
            });
        }
    });
    /** ✅ POST /deposit → নতুন ডিপোজিট রিকোয়েস্ট */
    router.post('/deposit', async (req, res) => {
        try {
            const { userId, userEmail, userName, amount, transactionId, paymentMethod, paymentNumber } = req.body;

            if (!userId || !amount || !transactionId || !paymentMethod) {
                return res.status(400).json({ success: false, message: 'সবগুলো ফিল্ড পূরণ করুন' });
            }
            if (parseFloat(amount) <= 0) {
                return res.status(400).json({ success: false, message: 'টাকার পরিমাণ সঠিক নয়' });
            }

            const exists = await transactionsCollection.findOne({ transactionId });
            if (exists) {
                return res.status(400).json({ success: false, message: 'এই ট্রানজেকশন আইডি ইতিমধ্যে ব্যবহার হয়েছে' });
            }

            const newTransaction = {
                userId,
                userEmail,
                userName,
                amount: parseFloat(amount),
                transactionId,
                paymentMethod,
                paymentNumber,
                status: 'pending',
                type: 'deposit',
                date: new Date(),
                approvedAt: null,
                approvedBy: null
            };

            const result = await transactionsCollection.insertOne(newTransaction);
            res.json({ success: true, message: 'ট্রানজেকশন সাবমিট হয়েছে', data: { _id: result.insertedId, ...newTransaction } });
        } catch (error) {
            console.error('Deposit error:', error);
            res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি হয়েছে' });
        }
    });

    /** ✅ PATCH /:id/status → ট্রানজেকশন এপ্রুভ/রিজেক্ট (এডমিনের জন্য) */
    router.patch('/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            const { status, approvedBy } = req.body;

            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid transaction ID' });
            if (!['pending', 'approved', 'rejected'].includes(status))
                return res.status(400).json({ success: false, message: 'Invalid status' });

            const transaction = await transactionsCollection.findOne({ _id: new ObjectId(id) });
            if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });

            let referralBonusResult = null;

            if (status === 'approved') {
                // ইউজারের ব্যালেন্স আপডেট
                await usersCollection.updateOne(
                    { _id: new ObjectId(transaction.userId) },
                    { $inc: { balance: transaction.amount } }
                );

                // রেফারেল বোনাস প্রসেস (যদি প্রযোজ্য)
                referralBonusResult = await processReferralBonus(transaction.userId, transaction.amount, id);
            }

            await transactionsCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status,
                        approvedAt: status !== 'pending' ? new Date() : null,
                        approvedBy: status !== 'pending' ? approvedBy : null
                    }
                }
            );

            res.json({
                success: true,
                message:
                    `ট্রানজেকশন ${status} হয়েছে` +
                    (referralBonusResult?.success ? ' এবং রেফারেল বোনাস (৬০৳) প্রদান করা হয়েছে' : ''),
                data: { referralBonus: referralBonusResult }
            });
        } catch (error) {
            console.error('Status update error:', error);
            res.status(500).json({ success: false, message: 'স্ট্যাটাস আপডেটে সমস্যা হয়েছে' });
        }
    });

    /** ✅ GET /user/:userId → নির্দিষ্ট ইউজারের সব ট্রানজেকশন */
    router.get('/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            const data = await transactionsCollection.find({ userId }).sort({ date: -1 }).toArray();
            res.json({ success: true, data });
        } catch (error) {
            console.error('Get user transactions error:', error);
            res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে' });
        }
    });

    /** ✅ GET /all → সব ট্রানজেকশন (এডমিন) */
    router.get('/all', async (req, res) => {
        try {
            const { status, page = 1, limit = 20 } = req.query;
            const query = status && status !== 'all' ? { status } : {};
            const skip = (parseInt(page) - 1) * parseInt(limit);

            const [transactions, total] = await Promise.all([
                transactionsCollection.find(query).sort({ date: -1 }).skip(skip).limit(parseInt(limit)).toArray(),
                transactionsCollection.countDocuments(query)
            ]);

            res.json({
                success: true,
                data: transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    total
                }
            });
        } catch (error) {
            console.error('Get all error:', error);
            res.status(500).json({ success: false, message: 'লোড করতে সমস্যা হয়েছে' });
        }
    });

    /** ✅ DELETE /:id → ট্রানজেকশন ডিলিট (ব্যালান্স রোলব্যাক সহ) */
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

            const trx = await transactionsCollection.findOne({ _id: new ObjectId(id) });
            if (!trx) return res.status(404).json({ success: false, message: 'Transaction not found' });

            // যদি approved হয় → ব্যালান্স ও বোনাস রোলব্যাক
            if (trx.status === 'approved') {
                await usersCollection.updateOne(
                    { _id: new ObjectId(trx.userId) },
                    { $inc: { balance: -trx.amount } }
                );

                const bonus = await transactionsCollection.findOne({
                    fromTransactionId: new ObjectId(id),
                    type: 'referral_bonus'
                });

                if (bonus) {
                    await usersCollection.updateOne(
                        { _id: new ObjectId(bonus.userId) },
                        {
                            $inc: {
                                balance: -bonus.amount,
                                totalCommission: -bonus.amount,
                                referralEarnings: -bonus.amount
                            }
                        }
                    );

                    await transactionsCollection.deleteOne({ _id: bonus._id });

                    await referralsCollection.updateOne(
                        { _id: bonus.referralId },
                        {
                            $set: { status: 'pending', hasDeposited: false, depositApproved: false },
                            $inc: { totalEarned: -bonus.amount }
                        }
                    );
                }
            }

            await transactionsCollection.deleteOne({ _id: new ObjectId(id) });
            res.json({ success: true, message: 'ট্রানজেকশন ডিলিট হয়েছে' });
        } catch (error) {
            console.error('Delete transaction error:', error);
            res.status(500).json({ success: false, message: 'ডিলিট করতে সমস্যা হয়েছে' });
        }
    });

    return router;
};
