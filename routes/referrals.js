// routes/referrals.js - Product Purchase Commission System
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (usersCollection, referralsCollection, transactionsCollection, userProductsCollection, productsCollection, client) => {

    // কমিশন রেট - প্রোডাক্ট প্রাইসের উপর %
    const commissionRates = {
        default: 0.15, // 15% ডিফল্ট কমিশন
        levels: [
            { level: 1, rate: 0.10, minReferrals: 0, title: "Starter", maxDaily: 1000 },
            { level: 2, rate: 0.15, minReferrals: 5, title: "Premium", maxDaily: 2000 },
            { level: 3, rate: 0.20, minReferrals: 15, title: "Elite", maxDaily: 5000 }
        ]
    };

    // Utility: রেফারার স্ট্যাটস
    const getReferrerStats = async (userId, session = null) => {
        const opts = session ? { session } : {};
        
        const totalReferrals = await referralsCollection.countDocuments({
            referrerUserId: userId
        }, opts);

        const activeReferrals = await referralsCollection.countDocuments({
            referrerUserId: userId, 
            status: 'active', 
            hasPurchased: true
        }, opts);

        const totalCommissionAgg = await referralsCollection.aggregate([
            { $match: { referrerUserId: userId } },
            { $group: { _id: null, total: { $sum: "$totalEarned" } } }
        ], opts).toArray();

        return { 
            totalReferrals, 
            activeReferrals, 
            totalCommission: totalCommissionAgg[0]?.total || 0 
        };
    };

    // Utility: আজকের কমিশন
    const getTodayCommission = async (userId, session = null) => {
        const opts = session ? { session } : {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const agg = await transactionsCollection.aggregate([
            { 
                $match: { 
                    userId: new ObjectId(userId), 
                    type: 'referral_commission', 
                    createdAt: { $gte: today }, 
                    status: 'completed' 
                } 
            },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ], opts).toArray();

        return agg[0]?.total || 0;
    };

    // Utility: বর্তমান কমিশন রেট বের করা
    const getCurrentCommissionRate = async (referrerUserId, session = null) => {
        const stats = await getReferrerStats(referrerUserId, session);
        const level = commissionRates.levels.find(l => stats.activeReferrals >= l.minReferrals) || commissionRates.levels[0];
        return level.rate;
    };

    // প্রোডাক্ট ক্রয়ে কমিশন ডিস্ট্রিবিউট
    const distributeProductPurchaseCommission = async (userId, productId, purchaseAmount, transactionId, session) => {
        let currentUserId = userId;
        const commissionHistory = [];

        // শুধুমাত্র LV1 কমিশন (সরাসরি রেফারার)
        const referral = await referralsCollection.findOne({
            referredUserId: currentUserId, 
            status: 'active'
        }, { session });

        if (!referral) {
            return { totalCommission: 0, commissionHistory };
        }
        const referrer = await usersCollection.findOne({ 
            _id: referral.referrerUserId 
        }, { session });

        if (!referrer) {
            return { totalCommission: 0, commissionHistory };
        }

        // বর্তমান কমিশন রেট বের করুন
        const commissionRate = await getCurrentCommissionRate(referral.referrerUserId, session);
        const commission = purchaseAmount * commissionRate;

        // ডেইলি লিমিট চেক
        const todayCommission = await getTodayCommission(referral.referrerUserId, session);
        const currentLevel = commissionRates.levels.find(l => l.rate === commissionRate);
        
        if (todayCommission + commission > currentLevel.maxDaily) {
            console.log('ডেইলি লিমিট exceeded');
            return { totalCommission: 0, commissionHistory };
        }

        // প্রোডাক্ট ডিটেইলস
        const product = await productsCollection.findOne({ _id: new ObjectId(productId) }, { session });

        // রেফারার ব্যালেন্স আপডেট
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

        // ট্রানজেকশন রেকর্ড
        await transactionsCollection.insertOne({
            userId: referral.referrerUserId,
            type: 'referral_commission',
            amount: commission,
            description: `রেফারেল কমিশন - ${product?.name || 'প্রোডাক্ট'} ক্রয় (${referral.referredEmail})`,
            status: 'completed',
            createdAt: new Date(),
            referralId: referral._id,
            productId: new ObjectId(productId),
            purchaseAmount: purchaseAmount,
            commissionRate: commissionRate,
            level: 1
        }, { session });

        // রেফারেল ডকুমেন্ট আপডেট
        await referralsCollection.updateOne(
            { _id: referral._id }, 
            { 
                $inc: { totalEarned: commission },
                $set: { hasPurchased: true, lastPurchaseDate: new Date() },
                $push: { 
                    commissionHistory: {
                        type: 'product_purchase_commission',
                        level: 1,
                        amount: commission,
                        purchaseAmount: purchaseAmount,
                        rate: commissionRate,
                        date: new Date(),
                        transactionId: new ObjectId(transactionId),
                        productId: new ObjectId(productId),
                        productName: product?.name
                    }
                }
            }, 
            { session }
        );

        commissionHistory.push({
            referrerId: referral.referrerUserId.toString(),
            level: 1,
            amount: commission,
            rate: commissionRate
        });

        return { 
            totalCommission: commission, 
            commissionHistory 
        };
    };

    // রেফারেল রেজিস্ট্রেশন
    router.post("/register", async (req, res) => {
        const { userId, referrerCode, userEmail, displayName } = req.body;
        const session = client.startSession();
        
        try {
            await session.withTransaction(async () => {
                const referrer = await usersCollection.findOne({ referralCode: referrerCode });
                if (!referrer) throw new Error("INVALID_REFERRAL_CODE");

                // চেক করুন যদি আগে থেকেই রেফারেল exists
                const existingReferral = await referralsCollection.findOne({
                    referredUserId: new ObjectId(userId)
                });

                if (existingReferral) {
                    throw new Error("USER_ALREADY_REFERRED");
                }

                await referralsCollection.insertOne({
                    referrerUserId: referrer._id,
                    referrerEmail: referrer.email,
                    referredUserId: new ObjectId(userId),
                    referredEmail: userEmail,
                    displayName: displayName,
                    status: "pending",
                    registrationDate: new Date(),
                    totalEarned: 0,
                    commissionHistory: []
                }, { session });

                await usersCollection.updateOne(
                    { _id: referrer._id }, 
                    { $inc: { totalReferrals: 1 } }, 
                    { session }
                );

                res.json({ 
                    success: true, 
                    message: "রেফারেল সফলভাবে রেজিস্টার্ড হয়েছে" 
                });
            });
        } catch (error) {
            console.error('রেফারেল রেজিস্ট্রেশন error:', error);
            res.status(400).json({ 
                success: false, 
                message: error.message === "INVALID_REFERRAL_CODE" 
                    ? "ইনভ্যালিড রেফারেল কোড" 
                    : error.message === "USER_ALREADY_REFERRED"
                    ? "ইউজার ইতিমধ্যেই রেফার্ড হয়েছে"
                    : "রেফারেল রেজিস্ট্রেশনে সমস্যা হয়েছে"
            });
        } finally { 
            await session.endSession(); 
        }
    });

    // প্রোডাক্ট ক্রয়ে কমিশন
    router.post('/on-product-purchase', async (req, res) => {
        const { userId, productId, amount, transactionId } = req.body;
        const session = client.startSession();
        
        try {
            await session.withTransaction(async () => {
                // রেফারেল স্ট্যাটাস আপডেট করুন
                const referral = await referralsCollection.findOne({ 
                    referredUserId: new ObjectId(userId), 
                    status: 'pending' 
                }, { session });

                if (referral) {
                    await referralsCollection.updateOne(
                        { _id: referral._id }, 
                        { 
                            $set: { 
                                status: 'active', 
                                firstPurchaseDate: new Date(),
                                firstPurchaseAmount: amount
                            } 
                        }, 
                        { session }
                    );
                }

                // কমিশন ডিস্ট্রিবিউট করুন
                const result = await distributeProductPurchaseCommission(
                    new ObjectId(userId), 
                    productId, 
                    parseFloat(amount), 
                    transactionId, 
                    session
                );

                res.json({ 
                    success: true, 
                    message: 'প্রোডাক্ট ক্রয় কমিশন সফলভাবে ডিস্ট্রিবিউট হয়েছে', 
                    data: result 
                });
            });
        } catch (error) {
            console.error('প্রোডাক্ট ক্রয় কমিশন error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'প্রোডাক্ট ক্রয় কমিশন ডিস্ট্রিবিউট করতে সমস্যা হয়েছে' 
            });
        } finally { 
            session.endSession(); 
        }
    });

    // ইউজারের রেফারেল তথ্য
    router.get('/user/:userId', async (req, res) => {
        try {
            const userId = new ObjectId(req.params.userId);
            const referrals = await referralsCollection.find({ 
                referrerUserId: userId 
            }).sort({ registrationDate: -1 }).toArray();
            
            const stats = await getReferrerStats(userId);
            const user = await usersCollection.findOne({ _id: userId });
            
            if (!user) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'ইউজার পাওয়া যায়নি' 
                });
            }

            // বর্তমান লেভেল বের করুন
            const currentLevel = commissionRates.levels.find(l => 
                stats.activeReferrals >= l.minReferrals
            ) || commissionRates.levels[0];

            const activeReferrals = referrals.filter(r => r.hasPurchased);
            const pendingReferrals = referrals.filter(r => !r.hasPurchased);

            res.json({
                success: true,
                data: {
                    referrals,
                    activeReferrals,
                    pendingReferrals,
                    stats: { 
                        ...stats, 
                        pendingReferrals: pendingReferrals.length 
                    },
                    currentLevel: currentLevel.level,
                    commissionLevels: commissionRates.levels.map(l => ({
                        ...l,
                        isCurrent: l.level === currentLevel.level,
                        requirements: l.minReferrals === 0 ? 
                            "যেকোনো সংখ্যক রেফারেল" : 
                            `ন্যূনতম ${l.minReferrals}টি সক্রিয় রেফারেল`,
                        maxEarning: `প্রতিদিন সর্বোচ্চ ৳${l.maxDaily.toLocaleString()}`,
                        returnRate: `${(l.rate * 100)}%`
                    })),
                    referralCode: user.referralCode,
                    referralLink: `https://work-up-bd-66b83.web.app/signup/?ref=${user.referralCode}`
                }
            });

        } catch (error) {
            console.error('রেফারেল তথ্য error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'রেফারেল তথ্য লোড করতে সমস্যা হয়েছে' 
            });
        }
    });

    // ইউজারের রেফারেল আয় (গ্রাফ)
    router.get('/user/:userId/earnings', async (req, res) => {
        try {
            const userId = new ObjectId(req.params.userId);
            const days = parseInt(req.query.days) || 30;
            const startDate = new Date(); 
            startDate.setDate(startDate.getDate() - days);

            const earnings = await transactionsCollection.aggregate([
                { 
                    $match: { 
                        userId: userId, 
                        type: 'referral_commission', 
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

            res.json({ success: true, data: earnings });
        } catch (error) {
            console.error('আয়ের তথ্য error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'আয়ের তথ্য লোড করতে সমস্যা হয়েছে' 
            });
        }
    });

    return router;
};