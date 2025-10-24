// routes/dailyIncome.js - Clean & Optimized Version
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const cron = require('node-cron');

module.exports = (userProductsCollection, usersCollection, transactionsCollection) => {

  /** 🔹 মূল ফাংশন: দৈনিক ইনকাম ডিস্ট্রিবিউশন */
  const distributeDailyIncome = async () => {
    console.log('🔹 Starting daily income distribution...');

    try {
      const activeProducts = await userProductsCollection.find({
        status: 'active',
        remainingDays: { $gt: 0 }
      }).toArray();

      console.log(`📊 Found ${activeProducts.length} active products for income distribution`);

      let totalDistributed = 0, processed = 0;

      for (const p of activeProducts) {
        try {
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

          // 2️⃣ ইউজার প্রোডাক্ট আপডেট
          await userProductsCollection.updateOne(
            { _id: p._id },
            {
              $set: {
                totalEarned: p.totalEarned + income,
                remainingDays: newRemaining,
                status: newStatus,
                lastPaymentDate: new Date()
              }
            }
          );

          // 3️⃣ ট্রানজ্যাকশন হিস্টোরি লগ (optional)
          if (transactionsCollection) {
            await transactionsCollection.insertOne({
              userId: new ObjectId(p.userId),
              type: 'daily_income',
              amount: income,
              productName: p.productName,
              date: new Date(),
              status: 'success'
            });
          }

          console.log(`✅ ৳${income} credited to ${user.email} (${p.productName})`);
          totalDistributed += income;
          processed++;
        } catch (err) {
          console.error(`❌ Error processing product ${p._id}:`, err);
        }
      }

      console.log(`🎉 Distribution complete → ${processed} processed, ৳${totalDistributed} distributed.`);
      return { processed, totalDistributed };

    } catch (err) {
      console.error('❌ Daily income distribution error:', err);
      throw err;
    }
  };

  /** 🕛 ক্রন জব: প্রতিদিন রাত ১২টায় চলবে (Asia/Dhaka টাইমজোনে) */
  cron.schedule('0 0 * * *', async () => {
    await distributeDailyIncome();
  }, {
    scheduled: true,
    timezone: 'Asia/Dhaka'
  });

  console.log('✅ Daily income cron job scheduled (12:00 AM Bangladesh time)');

  /** 🔹 POST /distribute → ম্যানুয়াল ডিস্ট্রিবিউশন (এডমিন) */
  router.post('/distribute', async (req, res) => {
    try {
      const { processed, totalDistributed } = await distributeDailyIncome();
      res.json({
        success: true,
        message: `দৈনিক আয় সফলভাবে ডিস্ট্রিবিউট হয়েছে`,
        data: { processed, totalDistributed }
      });
    } catch (err) {
      console.error('Manual distribution error:', err);
      res.status(500).json({ success: false, message: 'দৈনিক আয় ডিস্ট্রিবিউট করতে সমস্যা হয়েছে' });
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

      const data = products.map(p => ({
        productName: p.productName,
        dailyIncome: p.dailyIncome,
        totalEarned: p.totalEarned,
        remainingDays: p.remainingDays,
        status: p.status,
        purchaseDate: p.purchaseDate,
        lastPaymentDate: p.lastPaymentDate
      }));

      res.json({ success: true, data });
    } catch (err) {
      console.error('Get user income error:', err);
      res.status(500).json({ success: false, message: 'আয় তথ্য লোড করতে সমস্যা হয়েছে' });
    }
  });

  return router;
};
