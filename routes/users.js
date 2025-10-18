const express = require("express");
const { ObjectId } = require("mongodb");

module.exports = function (usersCollection) {
  const router = express.Router();

  // ✅ POST - Create User
  router.post("/", async (req, res) => {
    const userData = req.body;

    try {
      const existingUser = await usersCollection.findOne({ email: userData.email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "এই ইমেইল ইতিমধ্যেই ব্যবহার করা হয়েছে",
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
      };

      const result = await usersCollection.insertOne(completeUserData);

      // রেফারেল হ্যান্ডেল
      if (userData.referredBy) {
        const referrer = await usersCollection.findOne({
          referralCode: userData.referredBy,
        });
        if (referrer) {
          await usersCollection.updateOne(
            { _id: referrer._id },
            {
              $inc: {
                totalReferrals: 1,
                totalCommission: 50,
                referralEarnings: 50,
                balance: 50,
              },
              $set: { updatedAt: new Date() },
            }
          );
        }
      }

      res.status(201).json({
        success: true,
        message: "User created successfully",
        insertedId: result.insertedId,
        data: completeUserData,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  });

  // ✅ GET - All Users
  router.get("/", async (req, res) => {
    try {
      const users = await usersCollection.find().toArray();
      res.status(200).json({ success: true, data: users });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // ✅ GET - Get User by Email (⚠️ এইটা উপরে রাখো /:id এর আগে)
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

  // ✅ GET - Get User by ID
  router.get("/:id", async (req, res) => {
    const { id } = req.params;

    try {
      let user;
      if (ObjectId.isValid(id)) {
        user = await usersCollection.findOne({ _id: new ObjectId(id) });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({ success: true, data: user });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // ✅ PUT - Update User by ID
  router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    try {
      updateData.updatedAt = new Date();

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "User updated successfully",
      });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // ✅ DELETE - Delete User
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;

    try {
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "User deleted successfully",
      });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // ✅ Helper Function
  const generateReferralCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  return router;
};
