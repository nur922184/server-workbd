const express = require('express');
const { ObjectId } = require('mongodb');

module.exports = function (usersCollection, referralsCollection) {
  const router = express.Router();

  // 🔹 ইউটিল ফাংশন: রেফারেল কোড জেনারেটর
  const generateReferralCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  // ✅ POST - নতুন ইউজার তৈরি (রেফারেলসহ)
  router.post('/', async (req, res) => {
    const userData = req.body;

    try {
      const existingUser = await usersCollection.findOne({ email: userData.email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'এই ইমেইল ইতিমধ্যেই ব্যবহার করা হয়েছে',
        });
      }

      const referralCode = generateReferralCode();
      const completeUserData = {
        ...userData,
        referralCode,
        totalReferrals: 0,
        totalCommission: 0,
        referralEarnings: 0,
        balance: userData.balance || 50,
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        referredBy: userData.referredBy || null,
      };

      const result = await usersCollection.insertOne(completeUserData);

      // 🔹 রেফারেল থাকলে pending রেফারেল রেকর্ড তৈরি
      if (userData.referredBy) {
        const referrer = await usersCollection.findOne({ referralCode: userData.referredBy });
        if (referrer) {
          await referralsCollection.insertOne({
            referrerUserId: referrer._id,
            referrerEmail: referrer.email,
            referredUserId: result.insertedId,
            referredEmail: userData.email,
            status: 'pending',
            hasDeposited: false,
            depositApproved: false,
            registrationDate: new Date(),
            totalEarned: 0,
            commissionHistory: [],
          });

          await usersCollection.updateOne(
            { _id: referrer._id },
            { $inc: { totalReferrals: 1 }, $set: { updatedAt: new Date() } }
          );
        }
      }

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: { _id: result.insertedId, ...completeUserData },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ PATCH - ডিপোজিট এপ্রুভ হলে রেফারেল বোনাস প্রসেস
  router.patch('/:id/process-referral-bonus', async (req, res) => {
    const { id } = req.params;
    const { depositAmount } = req.body;

    try {
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const referral = await referralsCollection.findOne({
        referredUserId: new ObjectId(id),
        status: 'pending',
      });
      if (!referral)
        return res.status(404).json({ success: false, message: 'No pending referral found' });

      // রেফারেল অ্যাক্টিভ + বোনাস আপডেট
      await referralsCollection.updateOne(
        { _id: referral._id },
        {
          $set: {
            status: 'active',
            hasDeposited: true,
            depositApproved: true,
            firstDepositDate: new Date(),
            firstDepositAmount: depositAmount,
          },
        }
      );

      await usersCollection.updateOne(
        { _id: referral.referrerUserId },
        {
          $inc: { balance: 60, totalCommission: 60, referralEarnings: 60 },
          $set: { updatedAt: new Date() },
        }
      );

      await referralsCollection.updateOne(
        { _id: referral._id },
        {
          $inc: { totalEarned: 60 },
          $push: {
            commissionHistory: {
              type: 'deposit_bonus',
              amount: 60,
              date: new Date(),
              status: 'completed',
            },
          },
        }
      );

      res.status(200).json({
        success: true,
        message: 'Referral bonus processed successfully',
        data: { bonusAmount: 60, referredUser: user.email },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ GET - সব ইউজার
  router.get('/', async (req, res) => {
    try {
      const users = await usersCollection.find().toArray();
      res.status(200).json({ success: true, data: users });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ GET - আইডি দিয়ে ইউজার
  router.get('/:id', async (req, res) => {
    try {
      const user = await usersCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      res.status(200).json({ success: true, data: user });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ GET - ইমেইল দিয়ে ইউজার
  router.get('/email/:email', async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const user = await usersCollection.findOne({ email });
      if (!user)
        return res.status(404).json({ success: false, message: 'User not found with this email' });
      res.status(200).json(user);
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ GET - রেফারেল কোড দিয়ে ইউজার
  router.get('/referral/:code', async (req, res) => {
    try {
      const user = await usersCollection.findOne({ referralCode: req.params.code });
      if (!user)
        return res.status(404).json({ success: false, message: 'User not found with this code' });
      res.status(200).json({
        success: true,
        data: {
          _id: user._id,
          displayName: user.displayName,
          email: user.email,
          referralCode: user.referralCode,
          totalReferrals: user.totalReferrals,
          totalCommission: user.totalCommission,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ PATCH - ইউজার ব্যালান্স আপডেট
  router.patch('/:id/balance', async (req, res) => {
    const { amount, type } = req.body;
    const { id } = req.params;

    try {
      if (!['add', 'subtract'].includes(type)) {
        return res.status(400).json({ success: false, message: "Invalid type (use 'add'/'subtract')" });
      }

      const update = {
        $inc: { balance: type === 'add' ? amount : -amount },
        $set: { updatedAt: new Date() },
      };

      const result = await usersCollection.updateOne({ _id: new ObjectId(id) }, update);
      if (result.matchedCount === 0)
        return res.status(404).json({ success: false, message: 'User not found' });

      res.status(200).json({
        success: true,
        message: `Balance ${type === 'add' ? 'added' : 'subtracted'} successfully`,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ GET - ইউজারের রেফারেল ইনফো
  router.get('/:id/referral-info', async (req, res) => {
    try {
      const id = req.params.id;
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const referrals = await referralsCollection
        .find({ referrerUserId: new ObjectId(id) })
        .toArray();

      const pending = referrals.filter((r) => r.status === 'pending').length;
      const active = referrals.filter((r) => r.status === 'active').length;

      res.status(200).json({
        success: true,
        data: {
          referralCode: user.referralCode,
          totalReferrals: user.totalReferrals,
          totalCommission: user.totalCommission,
          referralEarnings: user.referralEarnings,
          referrals: { pending, active, total: referrals.length },
          referralLink: `https://work-up-bd-66b83.web.app/signup/?ref=${user.referralCode}`,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ✅ DELETE - ইউজার ডিলিট
  router.delete('/:id', async (req, res) => {
    try {
      const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      if (result.deletedCount === 0)
        return res.status(404).json({ success: false, message: 'User not found' });

      res.status(200).json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  return router;
};
