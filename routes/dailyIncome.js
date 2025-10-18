// routes/dailyIncome.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const cron = require('node-cron');

module.exports = (userProductsCollection, usersCollection) => {
    
    // দৈনিক আয় ডিস্ট্রিবিউট ফাংশন
    const distributeDailyIncome = async () => {
        try {
            console.log('🔹 Starting daily income distribution...');
            
            // সকল active user products পাওয়া
            const activeProducts = await userProductsCollection.find({
                status: 'active',
                remainingDays: { $gt: 0 }
            }).toArray();

            console.log(`📊 Found ${activeProducts.length} active products for income distribution`);

            let totalDistributed = 0;
            let processedProducts = 0;

            for (const product of activeProducts) {
                try {
                    // ইউজার পাওয়া
                    const user = await usersCollection.findOne({ 
                        _id: new ObjectId(product.userId) 
                    });

                    if (!user) {
                        console.log(`❌ User not found for product: ${product._id}`);
                        continue;
                    }

                    // দৈনিক আয় ক্যালকুলেট
                    const dailyIncome = product.dailyIncome;
                    
                    // ইউজারের ব্যালেন্স আপডেট
                    const newBalance = user.balance + dailyIncome;
                    await usersCollection.updateOne(
                        { _id: new ObjectId(product.userId) },
                        { $set: { balance: newBalance } }
                    );

                    // প্রোডাক্ট আপডেট
                    const newTotalEarned = product.totalEarned + dailyIncome;
                    const newRemainingDays = product.remainingDays - 1;
                    const newStatus = newRemainingDays === 0 ? 'completed' : 'active';

                    await userProductsCollection.updateOne(
                        { _id: new ObjectId(product._id) },
                        { 
                            $set: { 
                                totalEarned: newTotalEarned,
                                remainingDays: newRemainingDays,
                                status: newStatus,
                                lastPaymentDate: new Date()
                            } 
                        }
                    );

                    totalDistributed += dailyIncome;
                    processedProducts++;

                    console.log(`✅ Distributed ৳${dailyIncome} to ${user.email} for ${product.productName}`);

                } catch (error) {
                    console.error(`❌ Error processing product ${product._id}:`, error);
                }
            }

            console.log(`🎉 Daily income distribution completed!`);
            console.log(`💰 Total distributed: ৳${totalDistributed}`);
            console.log(`📦 Processed products: ${processedProducts}`);

        } catch (error) {
            console.error('❌ Daily income distribution error:', error);
        }
    };

    // ক্রন জব সেটআপ (প্রতিদিন রাত ১২টায় চলবে)
    cron.schedule('0 0 * * *', distributeDailyIncome, {
        scheduled: true,
        timezone: "Asia/Dhaka"
    });

    console.log('✅ Daily income cron job scheduled (12:00 AM Bangladesh time)');

    // ম্যানুয়ালি দৈনিক আয় ডিস্ট্রিবিউট (এডমিনের জন্য)
    router.post('/distribute', async (req, res) => {
        try {
            await distributeDailyIncome();
            
            res.json({
                success: true,
                message: 'দৈনিক আয় সফলভাবে ডিস্ট্রিবিউট হয়েছে'
            });

        } catch (error) {
            console.error('Manual distribution error:', error);
            res.status(500).json({
                success: false,
                message: 'দৈনিক আয় ডিস্ট্রিবিউট করতে সমস্যা হয়েছে'
            });
        }
    });

    // ইউজারের দৈনিক আয় হিস্ট্রি
    router.get('/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;

            const userProducts = await userProductsCollection
                .find({ 
                    userId: new ObjectId(userId),
                    status: 'active'
                })
                .sort({ purchaseDate: -1 })
                .toArray();

            const incomeData = userProducts.map(product => ({
                productName: product.productName,
                dailyIncome: product.dailyIncome,
                totalEarned: product.totalEarned,
                remainingDays: product.remainingDays,
                purchaseDate: product.purchaseDate,
                lastPaymentDate: product.lastPaymentDate
            }));

            res.json({
                success: true,
                data: incomeData
            });

        } catch (error) {
            console.error('Get user income error:', error);
            res.status(500).json({
                success: false,
                message: 'আয় তথ্য লোড করতে সমস্যা হয়েছে'
            });
        }
    });

    return router;
};