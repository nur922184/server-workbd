// routes/referrals.js - Fixed version
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (usersCollection, referralsCollection, transactionsCollection, client) => {

    // কমিশন লেভেলস - সঠিক অর্ডারে (উচ্চ কমিশন প্রথমে)
    const commissionLevels = [
        { level: 3, rate: 0.32, minReferrals: 10, maxDaily: 5000, title: "Level 3" },    // 32%
        { level: 2, rate: 0.04, minReferrals: 50, maxDaily: 2000, title: "Level 2" },   // 4%
        { level: 1, rate: 0.01, minReferrals: 200, maxDaily: 1000, title: "Level 1" }   // 1%
    ];

    // রেফারেল রেজিস্ট্রেশন (সাইনআপে - শুধু রেকর্ড তৈরি)
    router.post("/register", async (req, res) => {
        const { userId, referrerCode, userEmail } = req.body;

        const session = await client.startSession();
        try {
            await session.withTransaction(async () => {

                // Referrer ইউজার খুঁজে বের করো
                const referrer = await usersCollection.findOne({ referralCode: referrerCode });
                if (!referrer) {
                    throw new Error("INVALID_REFERRAL_CODE");
                }

                // নতুন referral ডকুমেন্ট তৈরি করো
                const newReferral = {
                    referrerId: referrer._id,
                    referrerEmail: referrer.email,
                    referredUserId: userId,
                    referredEmail: userEmail,
                    status: "pending",
                    createdAt: new Date(),
                };

                // এখানে ডুপ্লিকেট চেক করার দরকার নেই
                await referralsCollection.insertOne(newReferral, { session });

                // রেফারারের totalReferrals বাড়াও
                await usersCollection.updateOne(
                    { _id: referrer._id },
                    { $inc: { totalReferrals: 1 } },
                    { session }
                );

                res.json({
                    success: true,
                    message: "Referral registered successfully",
                });
            });
        } catch (error) {
            console.error("Referral registration error:", error);
            res.status(400).json({ success: false, message: error.message });
        } finally {
            await session.endSession();
        }
    });

    // ডিপোজিট হলে রেফারেল কমিশন ডিস্ট্রিবিউট
    router.post('/on-deposit', async (req, res) => {
        const session = client.startSession();

        try {
            await session.withTransaction(async () => {
                const { userId, amount, transactionId } = req.body;

                if (!userId || !amount) {
                    throw new Error('MISSING_REQUIRED_FIELDS');
                }

                // রেফারেল তথ্য খুঁজুন
                const referral = await referralsCollection.findOne({
                    referredUserId: new ObjectId(userId),
                    status: 'pending' // শুধু pending রেফারেলদের জন্য
                }, { session });

                if (!referral) {
                    // রেফারেল না থাকলে শুধু success রিটার্ন করুন
                    return res.json({
                        success: true,
                        message: 'কোন রেফারেল নেই',
                        data: { bonusAmount: 0 }
                    });
                }

                // রেফারেল স্ট্যাটাস active করুন
                await referralsCollection.updateOne(
                    { _id: referral._id },
                    {
                        $set: {
                            status: 'active',
                            hasDeposited: true,
                            firstDepositDate: new Date(),
                            firstDepositAmount: amount
                        }
                    },
                    { session }
                );

                // রেফারারকে ৬০ টাকা বোনাস দিন (ডিপোজিট বোনাস)
                await usersCollection.updateOne(
                    { _id: referral.referrerUserId },
                    {
                        $inc: {
                            balance: 60,
                            totalCommission: 60
                        }
                    },
                    { session }
                );

                // রেফারেল বোনাস ট্রানজেকশন রেকর্ড
                const bonusTransaction = {
                    userId: referral.referrerUserId,
                    type: 'referral_bonus',
                    amount: 60,
                    description: `রেফারেল ডিপোজিট বোনাস - ${referral.referredEmail}`,
                    status: 'completed',
                    createdAt: new Date(),
                    referralId: referral._id
                };
                await transactionsCollection.insertOne(bonusTransaction, { session });

                // রেফারেলের কমিশন হিস্ট্রি আপডেট
                await referralsCollection.updateOne(
                    { _id: referral._id },
                    {
                        $inc: { totalEarned: 60 },
                        $push: {
                            commissionHistory: {
                                type: 'deposit_bonus',
                                amount: 60,
                                depositAmount: amount,
                                date: new Date(),
                                transactionId: new ObjectId(transactionId)
                            }
                        }
                    },
                    { session }
                );

                res.json({
                    success: true,
                    message: 'রেফারেল বোনাস সফলভাবে দেওয়া হয়েছে',
                    data: {
                        bonusAmount: 60,
                        referrerId: referral.referrerUserId.toString()
                    }
                });
            });

        } catch (error) {
            console.error('Referral deposit bonus error:', error);
            res.status(500).json({
                success: false,
                message: 'রেফারেল বোনাস দিতে সমস্যা হয়েছে'
            });
        } finally {
            session.endSession();
        }
    });

    // উত্তোলনে কমিশন ডিস্ট্রিবিউট (৩ লেভেল)
    router.post('/on-withdrawal', async (req, res) => {
        const session = client.startSession();

        try {
            await session.withTransaction(async () => {
                const { userId, amount, transactionId } = req.body;

                if (!userId || !amount) {
                    throw new Error('MISSING_REQUIRED_FIELDS');
                }

                const totalCommission = await distributeWithdrawalCommission(
                    new ObjectId(userId),
                    parseFloat(amount),
                    transactionId,
                    session
                );

                res.json({
                    success: true,
                    message: 'উত্তোলন কমিশন সফলভাবে ডিস্ট্রিবিউট হয়েছে',
                    data: {
                        totalCommission: totalCommission
                    }
                });
            });

        } catch (error) {
            console.error('Withdrawal commission distribution error:', error);
            res.status(500).json({
                success: false,
                message: 'উত্তোলন কমিশন ডিস্ট্রিবিউট করতে সমস্যা হয়েছে'
            });
        } finally {
            session.endSession();
        }
    });

    // উত্তোলন কমিশন ডিস্ট্রিবিউট ফাংশন
    const distributeWithdrawalCommission = async (userId, amount, transactionId, session) => {
        let totalCommission = 0;
        let currentUserId = userId;

        // ৩ লেভেল পর্যন্ত কমিশন ডিস্ট্রিবিউট
        for (let level = 1; level <= 3; level++) {
            const commissionLevel = commissionLevels.find(l => l.level === level);
            if (!commissionLevel) continue;

            // বর্তমান ইউজারের রেফারার খুঁজুন
            const referral = await referralsCollection.findOne({
                referredUserId: currentUserId,
                status: 'active',
                hasDeposited: true // শুধু ডিপোজিট করা রেফারেল
            }, { session });

            if (!referral) break;

            const referrer = await usersCollection.findOne({
                _id: referral.referrerUserId
            }, { session });

            if (!referrer) break;

            // রেফারারের যোগ্যতা চেক (সক্রিয় রেফারেল সংখ্যা)
            const referrerStats = await getReferrerStats(referral.referrerUserId, session);
            if (referrerStats.activeReferrals < commissionLevel.minReferrals) {
                currentUserId = referral.referrerUserId;
                continue;
            }

            // কমিশন ক্যালকুলেট
            const commission = amount * commissionLevel.rate;

            // ডেইলি লিমিট চেক
            const todayCommission = await getTodayCommission(referral.referrerUserId, session);
            if (todayCommission + commission > commissionLevel.maxDaily) {
                currentUserId = referral.referrerUserId;
                continue;
            }

            // কমিশন ১ টাকার কম হলে skip করুন
            if (commission < 1) {
                currentUserId = referral.referrerUserId;
                continue;
            }

            // রেফারারের ব্যালেন্স আপডেট
            await usersCollection.updateOne(
                { _id: referral.referrerUserId },
                {
                    $inc: {
                        balance: commission,
                        totalCommission: commission
                    }
                },
                { session }
            );

            // কমিশন ট্রানজেকশন রেকর্ড
            const commissionTransaction = {
                userId: referral.referrerUserId,
                type: 'referral_commission',
                amount: commission,
                description: `লেভেল ${level} রেফারেল কমিশন - ${referral.referredEmail}`,
                status: 'completed',
                createdAt: new Date(),
                referralId: referral._id,
                level: level,
                fromUserId: currentUserId,
                fromWithdrawalAmount: amount
            };
            await transactionsCollection.insertOne(commissionTransaction, { session });

            // রেফারেলের কমিশন হিস্ট্রি আপডেট
            await referralsCollection.updateOne(
                { _id: referral._id },
                {
                    $inc: { totalEarned: commission },
                    $push: {
                        commissionHistory: {
                            type: 'withdrawal_commission',
                            level: level,
                            amount: commission,
                            withdrawalAmount: amount,
                            rate: commissionLevel.rate,
                            date: new Date(),
                            transactionId: new ObjectId(transactionId),
                            fromUserId: currentUserId
                        }
                    }
                },
                { session }
            );

            totalCommission += commission;
            currentUserId = referral.referrerUserId;
        }

        return totalCommission;
    };

    // রেফারারের স্ট্যাটস পাওয়া
    const getReferrerStats = async (userId, session = null) => {
        const options = session ? { session } : {};

        // সক্রিয় রেফারেল (ডিপোজিট করা)
        const activeReferrals = await referralsCollection.countDocuments({
            referrerUserId: userId,
            status: 'active',
            hasDeposited: true
        }, options);

        // মোট কমিশন
        const result = await referralsCollection.aggregate([
            { $match: { referrerUserId: userId } },
            { $group: { _id: null, total: { $sum: "$totalEarned" } } }
        ], options).toArray();

        // মোট রেফারেল
        const totalReferrals = await referralsCollection.countDocuments({
            referrerUserId: userId
        }, options);

        return {
            totalReferrals: totalReferrals,
            activeReferrals: activeReferrals,
            totalCommission: result[0]?.total || 0
        };
    };

    // আজকের কমিশন পাওয়া
    const getTodayCommission = async (userId, session = null) => {
        const options = session ? { session } : {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayCommissions = await transactionsCollection.aggregate([
            {
                $match: {
                    userId: new ObjectId(userId),
                    type: { $in: ['referral_bonus', 'referral_commission'] },
                    createdAt: { $gte: today },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$amount" }
                }
            }
        ], options).toArray();

        return todayCommissions[0]?.total || 0;
    };

    // ইউজারের রেফারেল তথ্য পাওয়া
    router.get('/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;

            const referrals = await referralsCollection
                .find({ referrerUserId: new ObjectId(userId) })
                .sort({ registrationDate: -1 })
                .toArray();

            const stats = await getReferrerStats(new ObjectId(userId));
            const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'ইউজার পাওয়া যায়নি'
                });
            }

            // কমিশন লেভেল নির্ধারণ (সক্রিয় রেফারেল based)
            let currentLevel = 1;
            for (let i = 0; i < commissionLevels.length; i++) {
                if (stats.activeReferrals >= commissionLevels[i].minReferrals) {
                    currentLevel = commissionLevels[i].level;
                    break;
                }
            }

            // সক্রিয় রেফারেল (ডিপোজিট করা)
            const activeReferrals = referrals.filter(r => r.hasDeposited === true);
            const pendingReferrals = referrals.filter(r => !r.hasDeposited);

            res.json({
                success: true,
                data: {
                    referrals: referrals,
                    activeReferrals: activeReferrals,
                    pendingReferrals: pendingReferrals,
                    stats: {
                        ...stats,
                        pendingReferrals: pendingReferrals.length
                    },
                    currentLevel: currentLevel,
                    commissionLevels: commissionLevels.map(level => ({
                        ...level,
                        isCurrent: level.level === currentLevel,
                        requirements: `ন্যূনতম ${level.minReferrals}টি সক্রিয় রেফারেল`,
                        maxEarning: `প্রতিদিন সর্বোচ্চ ৳${level.maxDaily.toLocaleString()}`
                    })),
                    referralCode: user.referralCode,
                    referralLink: `https://work-up-bd-66b83.web.app/signup/?ref=${user.referralCode}`
                }
            });

        } catch (error) {
            console.error('Get user referrals error:', error);
            res.status(500).json({
                success: false,
                message: 'রেফারেল তথ্য লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    // রেফারেল দ্বারা আয় (গ্রাফের জন্য)
    router.get('/user/:userId/earnings', async (req, res) => {
        try {
            const { userId } = req.params;
            const { days = 30 } = req.query;

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - parseInt(days));

            const earnings = await transactionsCollection.aggregate([
                {
                    $match: {
                        userId: new ObjectId(userId),
                        type: { $in: ['referral_bonus', 'referral_commission'] },
                        status: 'completed',
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" },
                            day: { $dayOfMonth: "$createdAt" }
                        },
                        totalEarnings: { $sum: "$amount" },
                        count: { $sum: 1 },
                        date: { $first: "$createdAt" }
                    }
                },
                {
                    $sort: {
                        "_id.year": 1,
                        "_id.month": 1,
                        "_id.day": 1
                    }
                },
                {
                    $project: {
                        _id: 0,
                        date: {
                            $dateFromParts: {
                                year: "$_id.year",
                                month: "$_id.month",
                                day: "$_id.day"
                            }
                        },
                        totalEarnings: 1,
                        count: 1
                    }
                }
            ]).toArray();

            res.json({
                success: true,
                data: earnings
            });

        } catch (error) {
            console.error('Get earnings error:', error);
            res.status(500).json({
                success: false,
                message: 'আয়ের তথ্য লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    return router;
};