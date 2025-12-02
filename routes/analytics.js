// routes/analytics.js - Comprehensive Analytics API
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (
    usersCollection,
    transactionsCollection, 
    userProductsCollection,
    referralsCollection,
    withdrawalsCollection
) => {

    /** ✅ GET /api/analytics/dashboard → Admin Dashboard Analytics */
    router.get('/dashboard', async (req, res) => {
        try {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            // Parallel database queries for better performance
            const [
                totalUsers,
                activeUsers,
                totalDeposits,
                totalWithdrawals,
                pendingDeposits,
                pendingWithdrawals,
                dailyTransactions,
                monthlyTransactions,
                userProductsStats,
                referralStats,
                topUsers
            ] = await Promise.all([
                // 1. Total Users
                usersCollection.countDocuments(),
                
                // 2. Active Users (last 7 days)
                usersCollection.countDocuments({
                    lastLogin: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                }),
                
                // 3. Total Deposits
                transactionsCollection.aggregate([
                    { $match: { type: 'deposit', status: 'approved' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]).toArray(),
                
                // 4. Total Withdrawals
                withdrawalsCollection.aggregate([
                    { $match: { status: 'approved' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]).toArray(),
                
                // 5. Pending Deposits
                transactionsCollection.aggregate([
                    { $match: { type: 'deposit', status: 'pending' } },
                    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
                ]).toArray(),
                
                // 6. Pending Withdrawals
                withdrawalsCollection.aggregate([
                    { $match: { status: 'pending' } },
                    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }
                ]).toArray(),
                
                // 7. Daily Transactions
                transactionsCollection.aggregate([
                    { 
                        $match: { 
                            date: { $gte: startOfDay },
                            status: 'approved' 
                        } 
                    },
                    { 
                        $group: { 
                            _id: '$type',
                            count: { $sum: 1 },
                            amount: { $sum: '$amount' }
                        } 
                    }
                ]).toArray(),
                
                // 8. Monthly Transactions
                transactionsCollection.aggregate([
                    { 
                        $match: { 
                            date: { $gte: startOfMonth },
                            status: 'approved' 
                        } 
                    },
                    { 
                        $group: { 
                            _id: '$type',
                            count: { $sum: 1 },
                            amount: { $sum: '$amount' }
                        } 
                    }
                ]).toArray(),
                
                // 9. User Products Stats
                userProductsCollection.aggregate([
                    { $match: { status: 'active' } },
                    { 
                        $group: { 
                            _id: null,
                            totalProducts: { $sum: 1 },
                            totalInvestment: { $sum: '$investment' },
                            totalDailyIncome: { $sum: '$dailyIncome' },
                            totalEarned: { $sum: '$totalEarned' }
                        } 
                    }
                ]).toArray(),
                
                // 10. Referral Stats
                referralsCollection.aggregate([
                    { 
                        $group: { 
                            _id: null,
                            totalReferrals: { $sum: 1 },
                            activeReferrals: { 
                                $sum: { 
                                    $cond: [{ $eq: ['$status', 'active'] }, 1, 0] 
                                } 
                            },
                            totalCommissionPaid: { $sum: '$totalEarned' }
                        } 
                    }
                ]).toArray(),
                
                // 11. Top Users by Balance
                usersCollection.find({})
                    .sort({ balance: -1 })
                    .limit(10)
                    .project({ 
                        email: 1, 
                        firstName: 1, 
                        lastName: 1, 
                        balance: 1, 
                        totalDeposit: 1,
                        referralEarnings: 1 
                    })
                    .toArray()
            ]);

            // Process the results
            const analytics = {
                // User Statistics
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    inactive: totalUsers - activeUsers,
                    growthRate: await calculateGrowthRate(usersCollection, 'users')
                },
                
                // Financial Statistics
                financial: {
                    totalDeposits: totalDeposits[0]?.total || 0,
                    totalWithdrawals: totalWithdrawals[0]?.total || 0,
                    netBalance: (totalDeposits[0]?.total || 0) - (totalWithdrawals[0]?.total || 0),
                    pendingDeposits: {
                        count: pendingDeposits[0]?.count || 0,
                        amount: pendingDeposits[0]?.amount || 0
                    },
                    pendingWithdrawals: {
                        count: pendingWithdrawals[0]?.count || 0,
                        amount: pendingWithdrawals[0]?.amount || 0
                    }
                },
                
                // Transaction Statistics
                transactions: {
                    today: {
                        deposits: dailyTransactions.find(t => t._id === 'deposit')?.amount || 0,
                        withdrawals: dailyTransactions.find(t => t._id === 'withdrawal')?.amount || 0,
                        referralBonus: dailyTransactions.find(t => t._id === 'referral_bonus')?.amount || 0
                    },
                    thisMonth: {
                        deposits: monthlyTransactions.find(t => t._id === 'deposit')?.amount || 0,
                        withdrawals: monthlyTransactions.find(t => t._id === 'withdrawal')?.amount || 0,
                        referralBonus: monthlyTransactions.find(t => t._id === 'referral_bonus')?.amount || 0
                    }
                },
                
                // Products Statistics
                products: {
                    activeProducts: userProductsStats[0]?.totalProducts || 0,
                    totalInvestment: userProductsStats[0]?.totalInvestment || 0,
                    totalDailyIncome: userProductsStats[0]?.totalDailyIncome || 0,
                    totalEarned: userProductsStats[0]?.totalEarned || 0
                },
                
                // Referral Statistics
                referrals: {
                    total: referralStats[0]?.totalReferrals || 0,
                    active: referralStats[0]?.activeReferrals || 0,
                    totalCommissionPaid: referralStats[0]?.totalCommissionPaid || 0
                },
                
                // Top Users
                topUsers: topUsers.map(user => ({
                    name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
                    email: user.email,
                    balance: user.balance || 0,
                    totalDeposit: user.totalDeposit || 0,
                    referralEarnings: user.referralEarnings || 0
                })),
                
                // Platform Statistics
                platform: {
                    totalTransactions: await transactionsCollection.countDocuments({ status: 'approved' }),
                    totalReferralTransactions: await transactionsCollection.countDocuments({ 
                        type: 'referral_bonus', 
                        status: 'completed' 
                    }),
                    systemProfit: await calculateSystemProfit(
                        totalDeposits[0]?.total || 0,
                        totalWithdrawals[0]?.total || 0,
                        referralStats[0]?.totalCommissionPaid || 0
                    )
                },
                
                // Recent Activities (last 5)
                recentActivities: await getRecentActivities(transactionsCollection, withdrawalsCollection)
            };

            res.json({
                success: true,
                message: 'Dashboard analytics fetched successfully',
                data: analytics,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Dashboard analytics error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch analytics data' 
            });
        }
    });

    /** ✅ GET /api/analytics/users → Detailed Users Analytics */
    router.get('/users', async (req, res) => {
        try {
            const { startDate, endDate, page = 1, limit = 20 } = req.query;
            
            // Date filter
            const dateFilter = {};
            if (startDate && endDate) {
                dateFilter.createdAt = {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                };
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);

            // Get users with statistics
            const users = await usersCollection.aggregate([
                { $match: dateFilter },
                { $sort: { createdAt: -1 } },
                { $skip: skip },
                { $limit: parseInt(limit) },
                {
                    $lookup: {
                        from: 'transactions',
                        let: { userId: '$_id' },
                        pipeline: [
                            { 
                                $match: { 
                                    $expr: { 
                                        $and: [
                                            { $eq: ['$userId', '$$userId'] },
                                            { $eq: ['$type', 'deposit'] },
                                            { $eq: ['$status', 'approved'] }
                                        ]
                                    }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalDeposit: { $sum: '$amount' },
                                    depositCount: { $sum: 1 }
                                }
                            }
                        ],
                        as: 'depositStats'
                    }
                },
                {
                    $lookup: {
                        from: 'withdrawals',
                        let: { userId: '$_id' },
                        pipeline: [
                            { 
                                $match: { 
                                    $expr: { 
                                        $and: [
                                            { $eq: ['$userId', '$$userId'] },
                                            { $eq: ['$status', 'approved'] }
                                        ]
                                    }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalWithdrawal: { $sum: '$amount' },
                                    withdrawalCount: { $sum: 1 }
                                }
                            }
                        ],
                        as: 'withdrawalStats'
                    }
                },
                {
                    $lookup: {
                        from: 'referrals',
                        let: { userId: '$_id' },
                        pipeline: [
                            { 
                                $match: { 
                                    $expr: { $eq: ['$referrerUserId', '$$userId'] }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalReferrals: { $sum: 1 },
                                    activeReferrals: { 
                                        $sum: { 
                                            $cond: [{ $eq: ['$status', 'active'] }, 1, 0] 
                                        } 
                                    }
                                }
                            }
                        ],
                        as: 'referralStats'
                    }
                },
                {
                    $project: {
                        email: 1,
                        firstName: 1,
                        lastName: 1,
                        phone: 1,
                        balance: 1,
                        totalCommission: 1,
                        referralEarnings: 1,
                        createdAt: 1,
                        lastLogin: 1,
                        status: 1,
                        totalDeposit: { $arrayElemAt: ['$depositStats.totalDeposit', 0] } || 0,
                        depositCount: { $arrayElemAt: ['$depositStats.depositCount', 0] } || 0,
                        totalWithdrawal: { $arrayElemAt: ['$withdrawalStats.totalWithdrawal', 0] } || 0,
                        withdrawalCount: { $arrayElemAt: ['$withdrawalStats.withdrawalCount', 0] } || 0,
                        totalReferrals: { $arrayElemAt: ['$referralStats.totalReferrals', 0] } || 0,
                        activeReferrals: { $arrayElemAt: ['$referralStats.activeReferrals', 0] } || 0
                    }
                }
            ]).toArray();

            const totalUsers = await usersCollection.countDocuments(dateFilter);

            res.json({
                success: true,
                message: 'Users analytics fetched successfully',
                data: users,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalUsers / parseInt(limit)),
                    totalUsers,
                    limit: parseInt(limit)
                }
            });

        } catch (error) {
            console.error('Users analytics error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch users analytics' 
            });
        }
    });

    /** ✅ GET /api/analytics/financial → Financial Reports */
    router.get('/financial', async (req, res) => {
        try {
            const { period = 'monthly', year } = req.query;
            
            let groupByFormat, matchDate = {};
            
            if (year) {
                const startYear = new Date(`${year}-01-01`);
                const endYear = new Date(`${parseInt(year) + 1}-01-01`);
                matchDate.date = { $gte: startYear, $lt: endYear };
            }

            if (period === 'daily') {
                groupByFormat = { $dateToString: { format: "%Y-%m-%d", date: "$date" } };
            } else if (period === 'monthly') {
                groupByFormat = { $dateToString: { format: "%Y-%m", date: "$date" } };
            } else if (period === 'yearly') {
                groupByFormat = { $dateToString: { format: "%Y", date: "$date" } };
            }

            // Deposits Report
            const depositsReport = await transactionsCollection.aggregate([
                { 
                    $match: { 
                        ...matchDate,
                        type: 'deposit', 
                        status: 'approved' 
                    } 
                },
                {
                    $group: {
                        _id: groupByFormat,
                        totalAmount: { $sum: '$amount' },
                        transactionCount: { $sum: 1 },
                        averageAmount: { $avg: '$amount' }
                    }
                },
                { $sort: { _id: 1 } }
            ]).toArray();

            // Withdrawals Report
            const withdrawalsReport = await withdrawalsCollection.aggregate([
                { 
                    $match: { 
                        ...matchDate,
                        status: 'approved' 
                    } 
                },
                {
                    $group: {
                        _id: groupByFormat,
                        totalAmount: { $sum: '$amount' },
                        transactionCount: { $sum: 1 },
                        averageAmount: { $avg: '$amount' }
                    }
                },
                { $sort: { _id: 1 } }
            ]).toArray();

            // Referral Bonuses Report
            const referralReport = await transactionsCollection.aggregate([
                { 
                    $match: { 
                        ...matchDate,
                        type: 'referral_bonus', 
                        status: 'completed' 
                    } 
                },
                {
                    $group: {
                        _id: groupByFormat,
                        totalAmount: { $sum: '$amount' },
                        transactionCount: { $sum: 1 },
                        averageAmount: { $avg: '$amount' }
                    }
                },
                { $sort: { _id: 1 } }
            ]).toArray();

            res.json({
                success: true,
                message: 'Financial report fetched successfully',
                data: {
                    period,
                    year: year || 'all',
                    deposits: depositsReport,
                    withdrawals: withdrawalsReport,
                    referralBonuses: referralReport,
                    summary: {
                        totalDeposits: depositsReport.reduce((sum, item) => sum + item.totalAmount, 0),
                        totalWithdrawals: withdrawalsReport.reduce((sum, item) => sum + item.totalAmount, 0),
                        totalReferralBonuses: referralReport.reduce((sum, item) => sum + item.totalAmount, 0),
                        netFlow: depositsReport.reduce((sum, item) => sum + item.totalAmount, 0) - 
                                withdrawalsReport.reduce((sum, item) => sum + item.totalAmount, 0)
                    }
                }
            });

        } catch (error) {
            console.error('Financial report error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch financial report' 
            });
        }
    });

    /** ✅ GET /api/analytics/products → Products Performance */
    router.get('/products', async (req, res) => {
        try {
            const productsStats = await userProductsCollection.aggregate([
                {
                    $group: {
                        _id: '$productName',
                        totalInvestments: { $sum: '$investment' },
                        totalDailyIncome: { $sum: '$dailyIncome' },
                        totalEarned: { $sum: '$totalEarned' },
                        activeProducts: { 
                            $sum: { 
                                $cond: [{ $eq: ['$status', 'active'] }, 1, 0] 
                            } 
                        },
                        completedProducts: { 
                            $sum: { 
                                $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] 
                            } 
                        },
                        userCount: { $addToSet: '$userId' }
                    }
                },
                {
                    $project: {
                        productName: '$_id',
                        totalInvestments: 1,
                        totalDailyIncome: 1,
                        totalEarned: 1,
                        activeProducts: 1,
                        completedProducts: 1,
                        totalUsers: { $size: '$userCount' },
                        averageInvestment: { $divide: ['$totalInvestments', { $size: '$userCount' }] },
                        roiPercentage: { 
                            $multiply: [
                                { $divide: ['$totalEarned', '$totalInvestments'] },
                                100
                            ]
                        }
                    }
                },
                { $sort: { totalInvestments: -1 } }
            ]).toArray();

            const totalStats = productsStats.reduce((acc, product) => ({
                totalInvestments: acc.totalInvestments + product.totalInvestments,
                totalEarned: acc.totalEarned + product.totalEarned,
                activeProducts: acc.activeProducts + product.activeProducts,
                totalUsers: acc.totalUsers + product.totalUsers
            }), { totalInvestments: 0, totalEarned: 0, activeProducts: 0, totalUsers: 0 });

            res.json({
                success: true,
                message: 'Products performance report fetched successfully',
                data: {
                    products: productsStats,
                    summary: {
                        ...totalStats,
                        overallROI: totalStats.totalInvestments > 0 ? 
                            (totalStats.totalEarned / totalStats.totalInvestments * 100).toFixed(2) : 0
                    }
                }
            });

        } catch (error) {
            console.error('Products analytics error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch products analytics' 
            });
        }
    });

    /** ✅ GET /api/analytics/referrals → Referral Network Analytics */
    router.get('/referrals', async (req, res) => {
        try {
            // Top Referrers
            const topReferrers = await referralsCollection.aggregate([
                {
                    $group: {
                        _id: '$referrerUserId',
                        referrerEmail: { $first: '$referrerEmail' },
                        totalReferrals: { $sum: 1 },
                        activeReferrals: { 
                            $sum: { 
                                $cond: [{ $eq: ['$status', 'active'] }, 1, 0] 
                            } 
                        },
                        totalCommissionEarned: { $sum: '$totalEarned' }
                    }
                },
                { $sort: { totalReferrals: -1 } },
                { $limit: 20 },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'userInfo'
                    }
                },
                {
                    $project: {
                        referrerId: '$_id',
                        referrerEmail: 1,
                        userName: { 
                            $concat: [
                                { $arrayElemAt: ['$userInfo.firstName', 0] } || '',
                                ' ',
                                { $arrayElemAt: ['$userInfo.lastName', 0] } || ''
                            ]
                        },
                        totalReferrals: 1,
                        activeReferrals: 1,
                        totalCommissionEarned: 1,
                        conversionRate: { 
                            $multiply: [
                                { $divide: ['$activeReferrals', '$totalReferrals'] },
                                100
                            ]
                        }
                    }
                }
            ]).toArray();

            // Referral Funnel
            const referralFunnel = await referralsCollection.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalCommission: { $sum: '$totalEarned' }
                    }
                }
            ]).toArray();

            // Commission by Level
            const commissionByLevel = await transactionsCollection.aggregate([
                { 
                    $match: { 
                        type: 'referral_bonus', 
                        status: 'completed' 
                    } 
                },
                {
                    $group: {
                        _id: '$level',
                        totalAmount: { $sum: '$amount' },
                        transactionCount: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]).toArray();

            res.json({
                success: true,
                message: 'Referral analytics fetched successfully',
                data: {
                    topReferrers,
                    referralFunnel,
                    commissionByLevel,
                    summary: {
                        totalReferrals: await referralsCollection.countDocuments(),
                        activeReferrals: await referralsCollection.countDocuments({ status: 'active' }),
                        totalCommissionPaid: await transactionsCollection.aggregate([
                            { $match: { type: 'referral_bonus', status: 'completed' } },
                            { $group: { _id: null, total: { $sum: '$amount' } } }
                        ]).then(result => result[0]?.total || 0)
                    }
                }
            });

        } catch (error) {
            console.error('Referral analytics error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch referral analytics' 
            });
        }
    });

    /** ✅ GET /api/analytics/export → Export Analytics Data */
    router.get('/export', async (req, res) => {
        try {
            const { type, format = 'json' } = req.query;
            
            if (!type) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Export type is required' 
                });
            }

            let data;
            let filename;

            switch (type) {
                case 'users':
                    data = await usersCollection.find({}).toArray();
                    filename = `users_export_${Date.now()}`;
                    break;
                    
                case 'transactions':
                    data = await transactionsCollection.find({}).toArray();
                    filename = `transactions_export_${Date.now()}`;
                    break;
                    
                case 'financial':
                    const [deposits, withdrawals] = await Promise.all([
                        transactionsCollection.find({ type: 'deposit', status: 'approved' }).toArray(),
                        withdrawalsCollection.find({ status: 'approved' }).toArray()
                    ]);
                    data = { deposits, withdrawals };
                    filename = `financial_export_${Date.now()}`;
                    break;
                    
                default:
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Invalid export type' 
                    });
            }

            if (format === 'csv') {
                // Convert to CSV
                const csv = convertToCSV(data);
                res.header('Content-Type', 'text/csv');
                res.attachment(`${filename}.csv`);
                return res.send(csv);
            } else {
                res.json({
                    success: true,
                    message: 'Export successful',
                    data,
                    filename
                });
            }

        } catch (error) {
            console.error('Export error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to export data' 
            });
        }
    });

    // Helper Functions
    async function calculateGrowthRate(collection, type) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const startOfToday = new Date(today.setHours(0, 0, 0, 0));
        const startOfYesterday = new Date(yesterday.setHours(0, 0, 0, 0));
        
        const todayCount = await collection.countDocuments({ 
            createdAt: { $gte: startOfToday } 
        });
        
        const yesterdayCount = await collection.countDocuments({ 
            createdAt: { 
                $gte: startOfYesterday, 
                $lt: startOfToday 
            } 
        });

        if (yesterdayCount === 0) return todayCount > 0 ? 100 : 0;
        
        return ((todayCount - yesterdayCount) / yesterdayCount * 100).toFixed(2);
    }

    async function calculateSystemProfit(totalDeposits, totalWithdrawals, totalCommission) {
        // Simple profit calculation
        return totalDeposits - totalWithdrawals - totalCommission;
    }

    async function getRecentActivities(transactionsCollection, withdrawalsCollection) {
        const recentTransactions = await transactionsCollection.find({})
            .sort({ date: -1 })
            .limit(5)
            .toArray();
            
        const recentWithdrawals = await withdrawalsCollection.find({})
            .sort({ date: -1 })
            .limit(5)
            .toArray();

        return [...recentTransactions, ...recentWithdrawals]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5)
            .map(item => ({
                type: item.type || 'withdrawal',
                amount: item.amount,
                status: item.status,
                date: item.date,
                user: item.userEmail || 'Unknown'
            }));
    }

    function convertToCSV(data) {
        if (!Array.isArray(data) || data.length === 0) return '';
        
        const headers = Object.keys(data[0]);
        const rows = data.map(row => 
            headers.map(header => JSON.stringify(row[header] || '')).join(',')
        );
        
        return [headers.join(','), ...rows].join('\n');
    }

    return router;
};