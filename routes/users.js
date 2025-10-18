const express = require('express');
const { ObjectId } = require('mongodb');

module.exports = function (usersCollection) {
  const router = express.Router();

  // ✅ POST - Create User (রেফারেল সিস্টেম সহ)
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
        balance: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await usersCollection.insertOne(completeUserData);

      // রেফারেল রেজিস্ট্রেশন (যদি রেফারেল কোড থাকে)
      if (userData.referralCode) {
        try {
          const referralResponse = await fetch('http://localhost:5000/api/referrals/register', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': req.headers.authorization || ''
            },
            body: JSON.stringify({
              userId: result.insertedId.toString(),
              referrerCode: userData.referralCode,
              email: userData.email
            })
          });

          if (referralResponse.ok) {
            const referralResult = await referralResponse.json();
            console.log('Referral registration successful:', referralResult);
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
        referralCode: referralCode
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ 
        success: false,
        message: 'Server error' 
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
      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
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

  // ✅ GET - Get User by Email
  router.get('/email/:email', async (req, res) => {
    const { email } = req.params;

    try {
      const user = await usersCollection.findOne({ email });
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

  // ✅ PATCH - Update Referral Stats
  router.patch('/:id/referral-stats', async (req, res) => {
    const { id } = req.params;
    const { commission } = req.body;

    try {
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { 
          $inc: { 
            totalCommission: commission,
            referralEarnings: commission
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