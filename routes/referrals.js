// routes/referrals.js - Modern DRY Version
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (usersCollection, referralsCollection, transactionsCollection, client) => {

    // কমিশন লেভেলস - উচ্চ কমিশন প্রথমে
    const commissionLevels = [
        { level: 3, rate: 0.32, minReferrals: 10, maxDaily: 5000, title: "Level 3" },
        { level: 2, rate: 0.04, minReferrals: 50, maxDaily: 2000, title: "Level 2" },
        { level: 1, rate: 0.01, minReferrals: 200, maxDaily: 1000, title: "Level 1" }
    ];

    // Utility: রেফারার স্ট্যাটস
    const getReferrerStats = async (userId, session = null) => {
        const opts = session ? { session } : {};
        const activeReferrals = await referralsCollection.countDocuments({
            referrerUserId: userId, status: 'active', hasDeposited: true
        }, opts);

        const totalReferrals = await referralsCollection.countDocuments({
            referrerUserId: userId
        }, opts);

        const totalCommissionAgg = await referralsCollection.aggregate([
            { $match: { referrerUserId: userId } },
            { $group: { _id: null, total: { $sum: "$totalEarned" } } }
        ], opts).toArray();

        return { totalReferrals, activeReferrals, totalCommission: totalCommissionAgg[0]?.total || 0 };
    };

    // Utility: আজকের কমিশন
    const getTodayCommission = async (userId, session = null) => {
        const opts = session ? { session } : {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const agg = await transactionsCollection.aggregate([
            { $match: { userId: new ObjectId(userId), type: { $in: ['referral_bonus','referral_commission'] }, createdAt: { $gte: today }, status: 'completed' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ], opts).toArray();

        return agg[0]?.total || 0;
    };

    // Utility: কমিশন ডিস্ট্রিবিউট (উত্তোলন)
    const distributeWithdrawalCommission = async (userId, amount, transactionId, session) => {
        let totalCommission = 0;
        let currentUserId = userId;

        for (let level = 1; level <= 3; level++) {
            const lvl = commissionLevels.find(l => l.level === level);
            if (!lvl) continue;

            const referral = await referralsCollection.findOne({
                referredUserId: currentUserId, status: 'active', hasDeposited: true
            }, { session });

            if (!referral) break;

            const referrer = await usersCollection.findOne({ _id: referral.referrerUserId }, { session });
            if (!referrer) break;

            const stats = await getReferrerStats(referral.referrerUserId, session);
            if (stats.activeReferrals < lvl.minReferrals) { currentUserId = referral.referrerUserId; continue; }

            const commission = amount * lvl.rate;
            const todayCommission = await getTodayCommission(referral.referrerUserId, session);
            if (todayCommission + commission > lvl.maxDaily || commission < 1) { currentUserId = referral.referrerUserId; continue; }

            // আপডেট ইউজার ব্যালেন্স ও ট্রানজেকশন
            await usersCollection.updateOne({ _id: referral.referrerUserId }, { $inc: { balance: commission, totalCommission: commission } }, { session });
            await transactionsCollection.insertOne({
                userId: referral.referrerUserId, type: 'referral_commission', amount: commission,
                description: `লেভেল ${level} রেফারেল কমিশন - ${referral.referredEmail}`,
                status: 'completed', createdAt: new Date(),
                referralId: referral._id, level, fromUserId: currentUserId, fromWithdrawalAmount: amount
            }, { session });
            await referralsCollection.updateOne({ _id: referral._id }, {
                $inc: { totalEarned: commission },
                $push: { commissionHistory: { type: 'withdrawal_commission', level, amount: commission, withdrawalAmount: amount, rate: lvl.rate, date: new Date(), transactionId: new ObjectId(transactionId), fromUserId: currentUserId } }
            }, { session });

            totalCommission += commission;
            currentUserId = referral.referrerUserId;
        }
        return totalCommission;
    };

    // রেফারেল রেজিস্ট্রেশন
    router.post("/register", async (req, res) => {
        const { userId, referrerCode, userEmail } = req.body;
        const session = client.startSession();
        try {
            await session.withTransaction(async () => {
                const referrer = await usersCollection.findOne({ referralCode: referrerCode });
                if (!referrer) throw new Error("INVALID_REFERRAL_CODE");

                await referralsCollection.insertOne({
                    referrerId: referrer._id, referrerEmail: referrer.email,
                    referredUserId: userId, referredEmail: userEmail,
                    status: "pending", createdAt: new Date()
                }, { session });

                await usersCollection.updateOne({ _id: referrer._id }, { $inc: { totalReferrals: 1 } }, { session });
                res.json({ success: true, message: "Referral registered successfully" });
            });
        } catch (error) {
            console.error(error);
            res.status(400).json({ success: false, message: error.message });
        } finally { await session.endSession(); }
    });

    // ডিপোজিটে রেফারেল বোনাস
    router.post('/on-deposit', async (req, res) => {
        const { userId, amount, transactionId } = req.body;
        const session = client.startSession();
        try {
            await session.withTransaction(async () => {
                const referral = await referralsCollection.findOne({ referredUserId: new ObjectId(userId), status: 'pending' }, { session });
                if (!referral) return res.json({ success: true, message: 'কোন রেফারেল নেই', data: { bonusAmount: 0 } });

                await referralsCollection.updateOne({ _id: referral._id }, { $set: { status: 'active', hasDeposited: true, firstDepositDate: new Date(), firstDepositAmount: amount } }, { session });

                await usersCollection.updateOne({ _id: referral.referrerUserId }, { $inc: { balance: 60, totalCommission: 60 } }, { session });
                await transactionsCollection.insertOne({ userId: referral.referrerUserId, type: 'referral_bonus', amount: 60, description: `রেফারেল ডিপোজিট বোনাস - ${referral.referredEmail}`, status: 'completed', createdAt: new Date(), referralId: referral._id }, { session });
                await referralsCollection.updateOne({ _id: referral._id }, { $inc: { totalEarned: 60 }, $push: { commissionHistory: { type: 'deposit_bonus', amount: 60, depositAmount: amount, date: new Date(), transactionId: new ObjectId(transactionId) } } }, { session });

                res.json({ success: true, message: 'রেফারেল বোনাস সফলভাবে দেওয়া হয়েছে', data: { bonusAmount: 60, referrerId: referral.referrerUserId.toString() } });
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: 'রেফারেল বোনাস দিতে সমস্যা হয়েছে' });
        } finally { session.endSession(); }
    });

    // উত্তোলন কমিশন ডিস্ট্রিবিউট
    router.post('/on-withdrawal', async (req, res) => {
        const { userId, amount, transactionId } = req.body;
        const session = client.startSession();
        try {
            await session.withTransaction(async () => {
                const totalCommission = await distributeWithdrawalCommission(new ObjectId(userId), parseFloat(amount), transactionId, session);
                res.json({ success: true, message: 'উত্তোলন কমিশন সফলভাবে ডিস্ট্রিবিউট হয়েছে', data: { totalCommission } });
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: 'উত্তোলন কমিশন ডিস্ট্রিবিউট করতে সমস্যা হয়েছে' });
        } finally { session.endSession(); }
    });

    // ইউজারের রেফারেল তথ্য
    router.get('/user/:userId', async (req, res) => {
        try {
            const userId = new ObjectId(req.params.userId);
            const referrals = await referralsCollection.find({ referrerUserId: userId }).sort({ registrationDate: -1 }).toArray();
            const stats = await getReferrerStats(userId);
            const user = await usersCollection.findOne({ _id: userId });
            if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });

            let currentLevel = commissionLevels.find(l => stats.activeReferrals >= l.minReferrals)?.level || 1;
            const activeReferrals = referrals.filter(r => r.hasDeposited), pendingReferrals = referrals.filter(r => !r.hasDeposited);

            res.json({
                success: true,
                data: {
                    referrals, activeReferrals, pendingReferrals,
                    stats: { ...stats, pendingReferrals: pendingReferrals.length },
                    currentLevel,
                    commissionLevels: commissionLevels.map(l => ({ ...l, isCurrent: l.level === currentLevel, requirements: `ন্যূনতম ${l.minReferrals}টি সক্রিয় রেফারেল`, maxEarning: `প্রতিদিন সর্বোচ্চ ৳${l.maxDaily.toLocaleString()}` })),
                    referralCode: user.referralCode,
                    referralLink: `https://work-up-bd-66b83.web.app/signup/?ref=${user.referralCode}`
                }
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: 'রেফারেল তথ্য লোড করতে সমস্যা হয়েছে' });
        }
    });

    // ইউজারের রেফারেল আয় (গ্রাফ)
    router.get('/user/:userId/earnings', async (req, res) => {
        try {
            const userId = new ObjectId(req.params.userId);
            const days = parseInt(req.query.days) || 30;
            const startDate = new Date(); startDate.setDate(startDate.getDate() - days);

            const earnings = await transactionsCollection.aggregate([
                { $match: { userId, type: { $in: ['referral_bonus','referral_commission'] }, status: 'completed', createdAt: { $gte: startDate } } },
                { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" }, day: { $dayOfMonth: "$createdAt" } }, totalEarnings: { $sum: "$amount" }, count: { $sum: 1 }, date: { $first: "$createdAt" } } },
                { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
                { $project: { _id: 0, date: { $dateFromParts: { year: "$_id.year", month: "$_id.month", day: "$_id.day" } }, totalEarnings: 1, count: 1 } }
            ]).toArray();

            res.json({ success: true, data: earnings });
        } catch (error) {
            console.error(error);
            res.status(500).json({ success: false, message: 'আয়ের তথ্য লোড করতে সমস্যা হয়েছে' });
        }
    });

    return router;
};
