// routes/referrals.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (usersCollection, referralsCollection, transactionsCollection) => {
    
    // কমিশন লেভেলস
    const commissionLevels = [
        { level: 1, rate: 0.32, minReferrals: 10, maxDaily: 5000 }, // 32%
        { level: 2, rate: 0.04, minReferrals: 50, maxDaily: 2000 }, // 4%
        { level: 3, rate: 0.01, minReferrals: 200, maxDaily: 1000 }  // 1%
    ];

    // রেফারেল রেজিস্ট্রেশন
    router.post('/register', async (req, res) => {
        try {
            const { userId, referrerCode } = req.body;

            if (!userId || !referrerCode) {
                return res.status(400).json({
                    success: false,
                    message: 'ইউজার আইডি এবং রেফারার কোড প্রয়োজন'
                });
            }

            // রেফারার খুঁজে বের করুন
            const referrer = await usersCollection.findOne({ 
                referralCode: referrerCode 
            });

            if (!referrer) {
                return res.status(404).json({
                    success: false,
                    message: 'ভুল রেফারেল কোড'
                });
            }

            // ইতিমধ্যে রেফার্ড কিনা চেক করুন
            const existingReferral = await referralsCollection.findOne({
                referredUserId: new ObjectId(userId)
            });

            if (existingReferral) {
                return res.status(400).json({
                    success: false,
                    message: 'ইতিমধ্যে রেফার্ড হয়েছেন'
                });
            }

            // রেফারেল রেকর্ড তৈরি
            const referralData = {
                referrerUserId: new ObjectId(referrer._id),
                referrerEmail: referrer.email,
                referredUserId: new ObjectId(userId),
                referredEmail: req.body.email,
                level: 1,
                commissionRate: commissionLevels[0].rate,
                status: 'active',
                registrationDate: new Date(),
                totalEarned: 0
            };

            const result = await referralsCollection.insertOne(referralData);

            // রেফারারের রেফারেল কাউন্ট আপডেট
            await usersCollection.updateOne(
                { _id: new ObjectId(referrer._id) },
                { $inc: { totalReferrals: 1 } }
            );

            res.json({
                success: true,
                message: 'রেফারেল সফলভাবে রেজিস্টার হয়েছে',
                data: {
                    _id: result.insertedId,
                    ...referralData,
                    referrerName: referrer.displayName || referrer.firstName + ' ' + referrer.lastName
                }
            });

        } catch (error) {
            console.error('Referral registration error:', error);
            res.status(500).json({
                success: false,
                message: 'রেফারেল রেজিস্ট্রেশনে সমস্যা হয়েছে'
            });
        }
    });

    // রেফারেল কমিশন ডিস্ট্রিবিউট
    router.post('/distribute-commission', async (req, res) => {
        try {
            const { userId, amount, transactionType } = req.body;

            if (!userId || !amount) {
                return res.status(400).json({
                    success: false,
                    message: 'ইউজার আইডি এবং অ্যামাউন্ট প্রয়োজন'
                });
            }

            const commissionAmount = await distributeCommission(
                new ObjectId(userId), 
                parseFloat(amount), 
                transactionType
            );

            res.json({
                success: true,
                message: 'কমিশন সফলভাবে ডিস্ট্রিবিউট হয়েছে',
                data: {
                    totalCommission: commissionAmount
                }
            });

        } catch (error) {
            console.error('Commission distribution error:', error);
            res.status(500).json({
                success: false,
                message: 'কমিশন ডিস্ট্রিবিউট করতে সমস্যা হয়েছে'
            });
        }
    });

    // কমিশন ডিস্ট্রিবিউট ফাংশন
    const distributeCommission = async (userId, amount, transactionType) => {
        let totalCommission = 0;
        let currentUserId = userId;

        // 3 লেভেল পর্যন্ত কমিশন ডিস্ট্রিবিউট
        for (let level = 1; level <= 3; level++) {
            const commissionLevel = commissionLevels[level - 1];
            
            // বর্তমান ইউজারের রেফারার খুঁজুন
            const referral = await referralsCollection.findOne({
                referredUserId: currentUserId,
                status: 'active'
            });

            if (!referral) break;

            const referrer = await usersCollection.findOne({
                _id: referral.referrerUserId
            });

            if (!referrer) break;

            // রেফারারের যোগ্যতা চেক
            const referrerStats = await getReferrerStats(referral.referrerUserId);
            if (referrerStats.totalReferrals < commissionLevel.minReferrals) {
                currentUserId = referral.referrerUserId;
                continue;
            }

            // কমিশন ক্যালকুলেট
            const commission = amount * commissionLevel.rate;
            
            // ডেইলি লিমিট চেক
            const todayCommission = await getTodayCommission(referral.referrerUserId);
            if (todayCommission + commission > commissionLevel.maxDaily) {
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
                }
            );

            // কমিশন রেকর্ড তৈরি
            const commissionData = {
                referrerUserId: referral.referrerUserId,
                referredUserId: currentUserId,
                level: level,
                commissionRate: commissionLevel.rate,
                amount: commission,
                transactionAmount: amount,
                transactionType: transactionType,
                status: 'completed',
                distributionDate: new Date()
            };

            await referralsCollection.updateOne(
                { _id: referral._id },
                { 
                    $inc: { totalEarned: commission },
                    $push: { commissionHistory: commissionData }
                }
            );

            totalCommission += commission;
            currentUserId = referral.referrerUserId;
        }

        return totalCommission;
    };

    // রেফারারের স্ট্যাটস পাওয়া
    const getReferrerStats = async (userId) => {
        const totalReferrals = await referralsCollection.countDocuments({
            referrerUserId: userId,
            status: 'active'
        });

        const totalCommission = await referralsCollection.aggregate([
            { $match: { referrerUserId: userId } },
            { $group: { _id: null, total: { $sum: "$totalEarned" } } }
        ]).toArray();

        return {
            totalReferrals: totalReferrals,
            totalCommission: totalCommission[0]?.total || 0
        };
    };

    // আজকের কমিশন পাওয়া
    const getTodayCommission = async (userId) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayCommissions = await referralsCollection.aggregate([
            { 
                $match: { 
                    referrerUserId: userId,
                    "commissionHistory.distributionDate": { $gte: today }
                } 
            },
            { $unwind: "$commissionHistory" },
            {
                $match: {
                    "commissionHistory.distributionDate": { $gte: today }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$commissionHistory.amount" }
                }
            }
        ]).toArray();

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

            // কমিশন লেভেল নির্ধারণ
            let currentLevel = 0;
            for (let i = commissionLevels.length - 1; i >= 0; i--) {
                if (stats.totalReferrals >= commissionLevels[i].minReferrals) {
                    currentLevel = i + 1;
                    break;
                }
            }

            res.json({
                success: true,
                data: {
                    referrals: referrals,
                    stats: stats,
                    currentLevel: currentLevel,
                    commissionLevels: commissionLevels,
                    referralCode: user?.referralCode,
                    referralLink: `https://work-up-bd-66b83.web.app/signup/?ref=${user?.referralCode}`
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

    // রেফারেল দ্বারা আয়
    router.get('/user/:userId/earnings', async (req, res) => {
        try {
            const { userId } = req.params;

            const earnings = await referralsCollection.aggregate([
                { $match: { referrerUserId: new ObjectId(userId) } },
                { $unwind: "$commissionHistory" },
                {
                    $group: {
                        _id: {
                            year: { $year: "$commissionHistory.distributionDate" },
                            month: { $month: "$commissionHistory.distributionDate" },
                            day: { $dayOfMonth: "$commissionHistory.distributionDate" }
                        },
                        totalEarnings: { $sum: "$commissionHistory.amount" },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
                { $limit: 30 }
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