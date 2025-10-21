const express = require('express');
const { ObjectId } = require('mongodb');

module.exports = function (usersCollection, referralsCollection) {
  const router = express.Router();

  // ✅ POST - Create User (রেফারেল সিস্টেম WITHOUT immediate bonus)
  router.post('/', async (req, res) => {
    const userData = req.body;

    try {
      const existingUser = await usersCollection.findOne({ email: userData.email });
      if (existingUser) {
        return res.status(400).json({ 
          success: false,
          message: 'এই ইমেইল ইতিমধ্যেই ব্যবহার করা হয়েছে' 
        });
      }

      // ইউনিক রেফারেল কোড জেনারেট
      const referralCode = generateReferralCode();
      
      // সম্পূর্ণ ইউজার ডাটা তৈরি
      const completeUserData = {
        ...userData,
        referralCode: referralCode,
        totalReferrals: 0,
        totalCommission: 0,
        referralEarnings: 0,
        balance: userData.balance || 50, // ডিফল্ট ৫০ টাকা বোনাস
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        referredBy: userData.referredBy || null // শুধু রেফারেল কোড স্টোর
      };

      const result = await usersCollection.insertOne(completeUserData);

      // ✅ নতুন: রেফারেল রেজিস্ট্রেশন (শুধু রেকর্ড তৈরি, বোনাস না দিয়ে)
      if (userData.referredBy) {
        try {
          // রেফারার খুঁজে বের করুন
          const referrer = await usersCollection.findOne({ referralCode: userData.referredBy });
          if (referrer) {
            // রেফারেল রেকর্ড তৈরি (pending status-এ)
            const referralRecord = {
              referrerUserId: referrer._id,
              referrerEmail: referrer.email,
              referredUserId: result.insertedId,
              referredEmail: userData.email,
              level: 1,
              commissionRate: 0.01, // Level 1 rate
              status: 'pending', // ✅ শুধু pending, ডিপোজিট এপ্রুভ হলে active হবে
              registrationDate: new Date(),
              totalEarned: 0,
              commissionHistory: [],
              hasDeposited: false, // ✅ ডিপোজিট করা হয়নি
              depositApproved: false // ✅ ডিপোজিট এপ্রুভ হয়নি
            };

            // referrals collection-এ সেভ করুন
            await referralsCollection.insertOne(referralRecord);

            // ✅ শুধু রেফারেল কাউন্ট আপডেট (বোনাস না দিয়ে)
            await usersCollection.updateOne(
              { _id: referrer._id },
              { 
                $inc: { 
                  totalReferrals: 1 // শুধু কাউন্ট বাড়ানো
                },
                $set: { updatedAt: new Date() }
              }
            );

            console.log(`Referral registered (pending): ${referrer.email} referred ${userData.email}`);
          }
        } catch (referralError) {
          console.error('Referral registration error:', referralError);
          // রেফারেল error হলে ইউজার ক্রিয়েশন stop করবে না
        }
      }

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        insertedId: result.insertedId,
        referralCode: referralCode,
        data: {
          _id: result.insertedId,
          ...completeUserData
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: 'Server error' 
      });
    }
  });

  // ✅ নতুন: ডিপোজিট এপ্রুভ হলে রেফারেল বোনাস প্রসেস
  router.patch('/:id/process-referral-bonus', async (req, res) => {
    const { id } = req.params;
    const { depositAmount } = req.body;

    try {
      // ইউজার খুঁজে বের করুন
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      // রেফারেল তথ্য খুঁজুন
      const referral = await referralsCollection.findOne({
        referredUserId: new ObjectId(id),
        status: 'pending',
        hasDeposited: false
      });

      if (!referral) {
        return res.status(404).json({ 
          success: false,
          message: "No pending referral found" 
        });
      }

      // রেফারেল স্ট্যাটাস active করুন
      await referralsCollection.updateOne(
        { _id: referral._id },
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

      // রেফারারকে ৬০ টাকা বোনাস দিন
      await usersCollection.updateOne(
        { _id: referral.referrerUserId },
        { 
          $inc: { 
            balance: 60,
            totalCommission: 60,
            referralEarnings: 60
          },
          $set: { updatedAt: new Date() }
        }
      );

      // রেফারেলের কমিশন হিস্ট্রি আপডেট
      await referralsCollection.updateOne(
        { _id: referral._id },
        { 
          $inc: { totalEarned: 60 },
          $push: { 
            commissionHistory: {
              type: 'deposit_bonus',
              amount: 60,
              depositAmount: depositAmount,
              date: new Date(),
              status: 'completed'
            }
          } 
        }
      );

      res.status(200).json({
        success: true,
        message: "Referral bonus processed successfully",
        data: {
          referrerId: referral.referrerUserId.toString(),
          bonusAmount: 60,
          referredUser: user.email
        }
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ GET - All users loaded
  router.get('/', async (req, res) => {
    try {
      const users = await usersCollection.find().toArray();
      res.status(200).json({
        success: true,
        data: users
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ GET - Get User by ID
  router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
      let user;
      // Check if ID is a valid ObjectId
      if (ObjectId.isValid(id)) {
        user = await usersCollection.findOne({ _id: new ObjectId(id) });
      }
      
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      res.status(200).json({
        success: true,
        data: user
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });
  

   router.get("/email/:email", async (req, res) => {
    const { email } = req.params;

    try {
      const decodedEmail = decodeURIComponent(email);
      const user = await usersCollection.findOne({ email: decodedEmail });

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found with this email" });
      }

      // 👉 ফ্রন্টএন্ডে useUserProfile ঠিকমতো কাজ করার জন্য নিচের ফরম্যাট দরকার
      res.status(200).json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  });

  // ✅ GET - Get User by Firebase UID
  router.get('/uid/:uid', async (req, res) => {
    const { uid } = req.params;

    try {
      const user = await usersCollection.findOne({ uniqueId: uid });
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: "User not found with this UID" 
        });
      }

      res.status(200).json({
        success: true,
        data: user
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ PUT - Update User by ID
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    try {
      // updatedAt ফিল্ড আপডেট
      updateData.updatedAt = new Date();

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      res.status(200).json({
        success: true,
        message: "User updated successfully"
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ PATCH - Update User Balance
  router.patch('/:id/balance', async (req, res) => {
    const { id } = req.params;
    const { amount, type } = req.body; // type: 'add' or 'subtract'

    try {
      let updateQuery = {};
      
      if (type === 'add') {
        updateQuery = { 
          $inc: { balance: amount },
          $set: { updatedAt: new Date() }
        };
      } else if (type === 'subtract') {
        updateQuery = { 
          $inc: { balance: -amount },
          $set: { updatedAt: new Date() }
        };
      } else {
        return res.status(400).json({ 
          success: false,
          message: "Invalid type. Use 'add' or 'subtract'" 
        });
      }

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        updateQuery
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      res.status(200).json({
        success: true,
        message: `Balance ${type === 'add' ? 'added' : 'subtracted'} successfully`
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ PATCH - Update Referral Stats (উত্তোলনের জন্য)
  router.patch('/:id/referral-stats', async (req, res) => {
    const { id } = req.params;
    const { commission, referrals = 1 } = req.body;

    try {
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { 
          $inc: { 
            totalReferrals: referrals,
            totalCommission: commission,
            referralEarnings: commission,
            balance: commission
          },
          $set: { updatedAt: new Date() }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      res.status(200).json({
        success: true,
        message: "Referral stats updated successfully"
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ DELETE - User delete by ID
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      res.status(200).json({ 
        success: true,
        message: "User deleted successfully" 
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ GET - Get User by Referral Code
  router.get('/referral/:code', async (req, res) => {
    const { code } = req.params;

    try {
      const user = await usersCollection.findOne({ referralCode: code });
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: "User not found with this referral code" 
        });
      }

      res.status(200).json({
        success: true,
        data: {
          _id: user._id,
          displayName: user.displayName,
          email: user.email,
          referralCode: user.referralCode,
          totalReferrals: user.totalReferrals,
          totalCommission: user.totalCommission
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ GET - User Stats
  router.get('/:id/stats', async (req, res) => {
    const { id } = req.params;

    try {
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      const stats = {
        balance: user.balance || 0,
        totalReferrals: user.totalReferrals || 0,
        totalCommission: user.totalCommission || 0,
        referralEarnings: user.referralEarnings || 0,
        isActive: user.isActive || false,
        joinedDate: user.createdAt
      };

      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // ✅ নতুন: রেফারেল তথ্য পাওয়া
  router.get('/:id/referral-info', async (req, res) => {
    const { id } = req.params;

    try {
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      // রেফারেল তথ্য খুঁজুন
      const referrals = await referralsCollection.find({
        $or: [
          { referrerUserId: new ObjectId(id) },
          { referredUserId: new ObjectId(id) }
        ]
      }).toArray();

      const pendingReferrals = referrals.filter(ref => 
        ref.referrerUserId.toString() === id && ref.status === 'pending'
      );

      const activeReferrals = referrals.filter(ref => 
        ref.referrerUserId.toString() === id && ref.status === 'active'
      );

      res.status(200).json({
        success: true,
        data: {
          user: {
            referralCode: user.referralCode,
            totalReferrals: user.totalReferrals,
            totalCommission: user.totalCommission,
            referralEarnings: user.referralEarnings
          },
          referrals: {
            pending: pendingReferrals.length,
            active: activeReferrals.length,
            total: referrals.length
          },
          referralLink: `https://work-up-bd-66b83.web.app/signup/?ref=${user.referralCode}`
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  });

  // রেফারেল কোড জেনারেট ফাংশন
  const generateReferralCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  return router;
};