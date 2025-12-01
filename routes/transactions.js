const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (transactionsCollection, usersCollection, userProductsCollection, referralsCollection) => {

    /** ✅ Helper Function: পার্সেন্টেজ-ভিত্তিক মাল্টি-লেভেল রেফারেল বোনাস */
    const processPercentageReferralBonus = async (userId, depositAmount, transactionId) => {
        try {
            const bonusResults = [];

            // লেভেল অনুসারে পার্সেন্টেজ কমিশন রেটস
            const levelCommissionRates = {
                1: 25,  // লেভেল 1: 10%
                2: 3,   // লেভেল 2: 5%  
                3: 2    // লেভেল 3: 2%
            };

            // বর্তমান ইউজার খুঁজে বের করা
            const currentUser = await usersCollection.findOne({ _id: new ObjectId(userId) });
            if (!currentUser) {
                return { success: false, message: 'User not found' };
            }

            // লেভেল 1 রেফারেল খুঁজে বের করা
            const level1Referral = await referralsCollection.findOne({
                referredUserId: new ObjectId(userId),
                status: 'pending',
                hasDeposited: false
            });

            if (!level1Referral) {
                return {
                    success: true,
                    message: 'No direct referral found for bonus',
                    data: { bonuses: [] }
                };
            }

            // লেভেল 1 বোনাস প্রসেস (10%)
            const level1Bonus = Math.round(depositAmount * levelCommissionRates[1] / 100);
            await processSingleLevelBonus(level1Referral, 1, level1Bonus, depositAmount, transactionId, levelCommissionRates[1]);
            bonusResults.push({
                level: 1,
                referrerId: level1Referral.referrerUserId,
                referrerEmail: level1Referral.referrerEmail,
                bonusAmount: level1Bonus,
                commissionRate: levelCommissionRates[1],
                relationship: 'direct'
            });

            // লেভেল 2 রেফারেল খুঁজে বের করা
            const level2Referral = await referralsCollection.findOne({
                referredUserId: level1Referral.referrerUserId,
                status: 'active'
            });

            if (level2Referral && level2Referral.hasDeposited) {
                const level2Bonus = Math.round(depositAmount * levelCommissionRates[2] / 100);
                await processSingleLevelBonus(level2Referral, 2, level2Bonus, depositAmount, transactionId, levelCommissionRates[2]);
                bonusResults.push({
                    level: 2,
                    referrerId: level2Referral.referrerUserId,
                    referrerEmail: level2Referral.referrerEmail,
                    bonusAmount: level2Bonus,
                    commissionRate: levelCommissionRates[2],
                    relationship: 'level-2'
                });

                // লেভেল 3 রেফারেল খুঁজে বের করা
                const level3Referral = await referralsCollection.findOne({
                    referredUserId: level2Referral.referrerUserId,
                    status: 'active',
                    hasDeposited: true
                });

                if (level3Referral) {
                    const level3Bonus = Math.round(depositAmount * levelCommissionRates[3] / 100);
                    await processSingleLevelBonus(level3Referral, 3, level3Bonus, depositAmount, transactionId, levelCommissionRates[3]);
                    bonusResults.push({
                        level: 3,
                        referrerId: level3Referral.referrerUserId,
                        referrerEmail: level3Referral.referrerEmail,
                        bonusAmount: level3Bonus,
                        commissionRate: levelCommissionRates[3],
                        relationship: 'level-3'
                    });
                }
            }

            // মূল রেফারেল আপডেট করা
            await referralsCollection.updateOne(
                { _id: level1Referral._id },
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

            return {
                success: true,
                message: `Percentage-based referral bonus processed successfully. ${bonusResults.length} levels paid`,
                data: {
                    bonuses: bonusResults,
                    totalBonus: bonusResults.reduce((sum, bonus) => sum + bonus.bonusAmount, 0)
                }
            };

        } catch (error) {
            console.error('Percentage referral bonus error:', error);
            return { success: false, message: 'Percentage referral bonus processing failed' };
        }
    };



    /** ✅ Helper Function: সিঙ্গেল লেভেল বোনাস প্রসেস */
    const processSingleLevelBonus = async (referral, level, bonusAmount, depositAmount, transactionId, commissionRate) => {
        // রেফারারকে বোনাস প্রদান
        await usersCollection.updateOne(
            { _id: referral.referrerUserId },
            {
                $inc: {
                    balance: bonusAmount,
                    totalCommission: bonusAmount,
                    referralEarnings: bonusAmount,
                    [`level${level}Earnings`]: bonusAmount,
                    totalReferralBonus: bonusAmount
                }
            }
        );

        // বোনাস ট্রানজেকশন রেকর্ড
        await transactionsCollection.insertOne({
            userId: referral.referrerUserId,
            userEmail: referral.referrerEmail,
            userName: `Level ${level} Referral Bonus`,
            amount: bonusAmount,
            type: 'referral_bonus',
            description: `লেভেল ${level} রেফারেল বোনাস - ${commissionRate}% of ৳${depositAmount}`,
            status: 'completed',
            date: new Date(),
            referralId: referral._id,
            level: level,
            commissionRate: commissionRate,
            fromDepositAmount: depositAmount,
            fromTransactionId: transactionId
        });

        // রেফারেলের কমিশন হিস্ট্রি সংরক্ষণ
        await referralsCollection.updateOne(
            { _id: referral._id },
            {
                $inc: {
                    totalEarned: bonusAmount,
                    [`level${level}Commission`]: bonusAmount
                },
                $push: {
                    commissionHistory: {
                        type: `level_${level}_percentage_bonus`,
                        amount: bonusAmount,
                        level: level,
                        commissionRate: commissionRate,
                        depositAmount: depositAmount,
                        date: new Date(),
                        status: 'completed',
                        transactionId: new ObjectId(transactionId)
                    }
                }
            }
        );
    };

    // routes/transactions.js - Deposit রাউট নিশ্চিত করুন

    /** ✅ POST /deposit → নতুন ডিপোজিট রিকোয়েস্ট */
    router.post('/deposit', async (req, res) => {
        try {
            const { userId, userEmail, userName, amount, transactionId, paymentMethod, paymentNumber } = req.body;

            // ভ্যালিডেশন
            if (!userId || !amount || !transactionId || !paymentMethod) {
                return res.status(400).json({ success: false, message: 'সবগুলো ফিল্ড পূরণ করুন' });
            }
            if (parseFloat(amount) <= 0) {
                return res.status(400).json({ success: false, message: 'টাকার পরিমাণ সঠিক নয়' });
            }

            // ডুপ্লিকেট ট্রানজেকশন চেক
            const exists = await transactionsCollection.findOne({ transactionId });
            if (exists) {
                return res.status(400).json({ success: false, message: 'এই ট্রানজেকশন আইডি ইতিমধ্যে ব্যবহার হয়েছে' });
            }

            const newTransaction = {
                userId: new ObjectId(userId),
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

            res.json({
                success: true,
                message: 'ট্রানজেকশন সাবমিট হয়েছে',
                data: {
                    _id: result.insertedId,
                    ...newTransaction
                }
            });

        } catch (error) {
            console.error('Deposit error:', error);
            res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি হয়েছে' });
        }
    });

    /** ✅ PATCH /:id/status → ট্রানজেকশন এপ্রুভ/রিজেক্ট */
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

                // পার্সেন্টেজ-ভিত্তিক রেফারেল বোনাস প্রসেস
                referralBonusResult = await processPercentageReferralBonus(
                    transaction.userId,
                    transaction.amount,
                    id
                );
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

            // বোনাস স্ট্যাটাস মেসেজ তৈরি
            let bonusMessage = '';
            if (referralBonusResult?.success && referralBonusResult.data?.bonuses?.length > 0) {
                const bonusDetails = referralBonusResult.data.bonuses.map(bonus =>
                    `লেভেল ${bonus.level}: ${bonus.commissionRate}% = ৳${bonus.bonusAmount}`
                ).join(', ');

                bonusMessage = ` এবং ${referralBonusResult.data.bonuses.length} লেভেলে মোট ৳${referralBonusResult.data.totalBonus} বোনাস প্রদান করা হয়েছে (${bonusDetails})`;
            }

            res.json({
                success: true,
                message: `ট্রানজেকশন ${status} হয়েছে${bonusMessage}`,
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