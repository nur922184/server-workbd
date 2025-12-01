// routes/dailyIncome.js - আপডেটেড এবং অপ্টিমাইজড ভার্সন
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const cron = require('node-cron');

module.exports = (userProductsCollection, usersCollection, transactionsCollection) => {

  /** 🔹 লক মেকানিজম - একই সাথে multiple execution প্রতিরোধ */
  let isRunning = false;

  /** 🔹 মূল ফাংশন: দৈনিক ইনকাম ডিস্ট্রিবিউশন (24 ঘন্টা পর) */
  const distributeDailyIncome = async () => {
    // ✅ লক চেক - যদি ইতিমধ্যে রান করছে তবে স্কিপ করুন
    if (isRunning) {
      // console.log('⏸️ Daily income distribution is already running, skipping...');
      return { processed: 0, skipped: 0, totalDistributed: 0, reason: 'already_running' };
    }

    isRunning = true;
    // console.log('🔹 Starting daily income distribution (24 hours check)...');

    try {
      const activeProducts = await userProductsCollection.find({
        status: 'active',
        remainingDays: { $gt: 0 }
      }).toArray();

      // console.log(`📊 Found ${activeProducts.length} active products for income distribution`);

      let totalDistributed = 0, processed = 0, skipped = 0;

      for (const p of activeProducts) {
        try {
          const now = new Date();
          const lastPaymentDate = p.lastPaymentDate ? new Date(p.lastPaymentDate) : new Date(p.purchaseDate);

          // ✅ সঠিক সময় গণনা - 24 ঘন্টা পর
          const timeDiff = now.getTime() - lastPaymentDate.getTime();
          const hoursDiff = timeDiff / (1000 * 60 * 60);

          // console.log(`⏰ Product: ${p.productName}, Hours since last payment: ${Math.round(hoursDiff)}`);

          // ✅ 24 ঘন্টা পার হয়নি হলে স্কিপ করুন
          if (hoursDiff < 24) {
            // console.log(`⏳ Skipping ${p.productName} - 24 hours not passed yet (${Math.round(hoursDiff)} hours)`);
            skipped++;
            continue;
          }

          // ✅ একই দিনে একাধিক পেমেন্ট প্রতিরোধ
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (transactionsCollection) {
            const existingPayment = await transactionsCollection.findOne({
              userId: new ObjectId(p.userId),
              productName: p.productName,
              type: 'daily_income',
              date: { $gte: todayStart },
              status: 'success'
            });

            if (existingPayment) {
              // console.log(`⏭️ Already paid today for ${p.productName}, skipping...`);
              skipped++;
              continue;
            }
          }

          const user = await usersCollection.findOne({ _id: new ObjectId(p.userId) });
          if (!user) {
            console.warn(`⚠️ User not found for product ${p._id}`);
            continue;
          }

          const income = p.dailyIncome;
          const newRemaining = p.remainingDays - 1;
          const newStatus = newRemaining <= 0 ? 'completed' : 'active';

          // 1️⃣ ব্যালান্স আপডেট
          await usersCollection.updateOne(
            { _id: new ObjectId(p.userId) },
            { $inc: { balance: income } }
          );

          // 2️⃣ ইউজার প্রোডাক্ট আপডেট - কমপ্লিট প্রোডাক্ট হ্যান্ডলিং
          if (newRemaining <= 0) {
            // console.log(`🎯 Product ${p.productName} completed! Total days: ${p.totalDays}`);

            await userProductsCollection.updateOne(
              { _id: p._id },
              {
                $set: {
                  totalEarned: (p.totalEarned || 0) + income,
                  remainingDays: 0,
                  status: 'completed',
                  lastPaymentDate: now,
                  completedAt: new Date(),
                  updatedAt: new Date()
                }
              }
            );
          } else {
            await userProductsCollection.updateOne(
              { _id: p._id },
              {
                $set: {
                  totalEarned: (p.totalEarned || 0) + income,
                  remainingDays: newRemaining,
                  status: newStatus,
                  lastPaymentDate: now,
                  updatedAt: new Date()
                }
              }
            );
          }

          // 3️⃣ ট্রানজ্যাকশন হিস্টোরি লগ
          if (transactionsCollection) {
            await transactionsCollection.insertOne({
              userId: new ObjectId(p.userId),
              userEmail: user.email,
              type: 'daily_income',
              amount: income,
              productName: p.productName,
              date: now,
              status: 'success',
              description: `দৈনিক আয় - ${p.productName}`,
              metadata: {
                remainingDays: newRemaining,
                productId: p.productId,
                userProductId: p._id
              }
            });
          }

          // console.log(`✅ ৳${income} credited to ${user.email} (${p.productName}) - ${newRemaining} days remaining`);
          totalDistributed += income;
          processed++;

        } catch (err) {
          console.error(`❌ Error processing product ${p._id} for user ${p.userId}:`, err);

          // ✅ এরর লগ ডেটাবেসে সেভ করুন
          if (transactionsCollection) {
            await transactionsCollection.insertOne({
              userId: new ObjectId(p.userId),
              type: 'error',
              amount: 0,
              productName: p.productName,
              date: new Date(),
              status: 'failed',
              description: `Daily income distribution failed: ${err.message}`,
              error: err.message
            });
          }
        }
      }

      // console.log(`🎉 Distribution complete → ${processed} processed, ${skipped} skipped, ৳${totalDistributed} distributed.`);
      return { processed, skipped, totalDistributed };

    } catch (err) {
      console.error('❌ Daily income distribution error:', err);

      // ✅ মেইন এরর লগ
      if (transactionsCollection) {
        await transactionsCollection.insertOne({
          type: 'system_error',
          amount: 0,
          date: new Date(),
          status: 'failed',
          description: `Daily income system error: ${err.message}`,
          error: err.message
        });
      }

      throw err;
    } finally {
      // ✅ লক রিলিজ করুন
      isRunning = false;
    }
  };

  /** 🕛 ক্রন জব: প্রতি 1 ঘন্টায় চেক করবে */
  cron.schedule('0 * * * *', async () => {
    // console.log('⏰ 1-hour check for daily income distribution...');
    await distributeDailyIncome();
  }, {
    scheduled: true,
    timezone: 'Asia/Dhaka'
  });

  // console.log('✅ Daily income cron job scheduled (Every 1 hour)');

  /** 🔹 POST /distribute → ম্যানুয়াল ডিস্ট্রিবিউশন (এডমিন) */
  router.post('/distribute', async (req, res) => {
    try {
      const result = await distributeDailyIncome();

      res.json({
        success: true,
        message: `দৈনিক আয় সফলভাবে ডিস্ট্রিবিউট হয়েছে`,
        data: result
      });
    } catch (err) {
      console.error('Manual distribution error:', err);
      res.status(500).json({
        success: false,
        message: 'দৈনিক আয় ডিস্ট্রিবিউট করতে সমস্যা হয়েছে',
        error: err.message
      });
    }
  });

  /** 🔹 GET /status → কারেন্ট ডিস্ট্রিবিউশন স্ট্যাটাস চেক */
  router.get('/status', async (req, res) => {
    try {
      const activeProducts = await userProductsCollection.find({
        status: 'active',
        remainingDays: { $gt: 0 }
      }).toArray();

      const now = new Date();
      const productsWithStatus = activeProducts.map(p => {
        const lastPaymentDate = p.lastPaymentDate ? new Date(p.lastPaymentDate) : new Date(p.purchaseDate);
        const timeDiff = now.getTime() - lastPaymentDate.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        const canReceivePayment = hoursDiff >= 24;

        return {
          productName: p.productName,
          dailyIncome: p.dailyIncome,
          totalEarned: p.totalEarned || 0,
          remainingDays: p.remainingDays,
          status: p.status,
          purchaseDate: p.purchaseDate,
          lastPaymentDate: p.lastPaymentDate,
          nextPaymentHours: Math.max(0, 24 - hoursDiff),
          canReceivePayment,
          hoursSinceLastPayment: Math.round(hoursDiff * 100) / 100
        };
      });

      const readyForPayment = productsWithStatus.filter(p => p.canReceivePayment);

      res.json({
        success: true,
        data: {
          totalActiveProducts: activeProducts.length,
          readyForPayment: readyForPayment.length,
          isRunning,
          products: productsWithStatus
        }
      });
    } catch (err) {
      console.error('Status check error:', err);
      res.status(500).json({
        success: false,
        message: 'স্ট্যাটাস চেক করতে সমস্যা হয়েছে'
      });
    }
  });

  // ✅ ম্যানুয়ালি টেস্ট করতে এই API কল করুন
  router.post('/test-distribution', async (req, res) => {
    try {
      // console.log('🧪 Test distribution started...');

      const activeProducts = await userProductsCollection.find({
        status: 'active',
        remainingDays: { $gt: 0 }
      }).toArray();

      const testResults = [];

      for (const p of activeProducts) {
        const now = new Date();
        const lastPaymentDate = p.lastPaymentDate ? new Date(p.lastPaymentDate) : new Date(p.purchaseDate);
        const timeDiff = now.getTime() - lastPaymentDate.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);

        testResults.push({
          productName: p.productName,
          user: p.userName,
          lastPayment: lastPaymentDate,
          hoursSinceLastPayment: Math.round(hoursDiff * 100) / 100,
          canReceive: hoursDiff >= 24,
          dailyIncome: p.dailyIncome,
          remainingDays: p.remainingDays
        });
      }

      const eligibleProducts = testResults.filter(p => p.canReceive);

      res.json({
        success: true,
        message: `টেস্ট সম্পন্ন: ${eligibleProducts.length}টি প্রোডাক্ট ইনকাম পাবে`,
        data: {
          totalProducts: activeProducts.length,
          eligibleForPayment: eligibleProducts.length,
          details: testResults
        }
      });

    } catch (err) {
      console.error('Test error:', err);
      res.status(500).json({ success: false, message: 'টেস্ট করতে সমস্যা হয়েছে' });
    }
  });

  /** 🔹 GET /user/:userId → ইউজারের ইনকাম হিস্ট্রি */
  router.get('/user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      if (!ObjectId.isValid(userId))
        return res.status(400).json({ success: false, message: 'Invalid user ID' });

      const products = await userProductsCollection
        .find({ userId: new ObjectId(userId) })
        .sort({ purchaseDate: -1 })
        .toArray();

      const now = new Date();
      const data = products.map(p => {
        const lastPaymentDate = p.lastPaymentDate ? new Date(p.lastPaymentDate) : new Date(p.purchaseDate);
        const timeDiff = now.getTime() - lastPaymentDate.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        const nextPaymentHours = Math.max(0, 24 - hoursDiff);

        return {
          productName: p.productName,
          dailyIncome: p.dailyIncome,
          totalEarned: p.totalEarned || 0,
          remainingDays: p.remainingDays,
          status: p.status,
          purchaseDate: p.purchaseDate,
          lastPaymentDate: p.lastPaymentDate,
          nextPaymentHours: Math.round(nextPaymentHours * 100) / 100,
          canReceivePayment: hoursDiff >= 24,
          hoursSinceLastPayment: Math.round(hoursDiff * 100) / 100,
          totalDays: p.totalDays,
          completedAt: p.completedAt
        };
      });

      // ✅ ট্রানজ্যাকশন হিস্ট্রিও যোগ করুন
      let transactions = [];
      if (transactionsCollection) {
        transactions = await transactionsCollection
          .find({
            userId: new ObjectId(userId),
            type: 'daily_income',
            status: 'success'
          })
          .sort({ date: -1 })
          .limit(50)
          .toArray();
      }

      res.json({
        success: true,
        data: {
          products: data,
          transactions: transactions,
          summary: {
            totalProducts: products.length,
            activeProducts: products.filter(p => p.status === 'active').length,
            completedProducts: products.filter(p => p.status === 'completed').length,
            totalEarned: products.reduce((sum, p) => sum + (p.totalEarned || 0), 0),
            pendingProducts: data.filter(p => p.canReceivePayment).length
          }
        }
      });
    } catch (err) {
      console.error('Get user income error:', err);
      res.status(500).json({
        success: false,
        message: 'আয় তথ্য লোড করতে সমস্যা হয়েছে'
      });
    }
  });

  return router;
};