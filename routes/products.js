// routes/products.js - Clean, Secure & Commented Version
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (productsCollection, usersCollection, userProductsCollection) => {

  /** ✅ GET / → সব প্রোডাক্ট পাওয়া */
  router.get('/', async (req, res) => {
    try {
      const products = await productsCollection.find({}).sort({ createdAt: -1 }).toArray();
      res.json({ success: true, data: products });
    } catch (error) {
      console.error('Get products error:', error);
      res.status(500).json({ success: false, message: 'প্রোডাক্ট লোড করতে সমস্যা হয়েছে' });
    }
  });

  /** ✅ GET /user/:userId/check/:productId → ইউজার প্রোডাক্ট কিনেছে কি না */
  router.get('/user/:userId/check/:productId', async (req, res) => {
    try {
      const { userId, productId } = req.params;
      if (!ObjectId.isValid(userId) || !ObjectId.isValid(productId))
        return res.status(400).json({ success: false, message: 'Invalid ID' });

      const userProduct = await userProductsCollection.findOne({
        userId: new ObjectId(userId),
        productId: new ObjectId(productId),
        status: 'active'
      });

      res.json({
        success: true,
        data: { isPurchased: !!userProduct, userProduct }
      });
    } catch (error) {
      console.error('Check product error:', error);
      res.status(500).json({ success: false, message: 'প্রোডাক্ট চেক করতে সমস্যা হয়েছে' });
    }
  });

  /** ✅ POST /purchase → ইউজার প্রোডাক্ট কিনছে */
  router.post('/purchase', async (req, res) => {
    try {
      const { userId, productId, productName, productPrice, dailyIncome, totalDays, returnRate } = req.body;

      if (!userId || !productId || !productPrice)
        return res.status(400).json({ success: false, message: 'সবগুলো ফিল্ড পূরণ করুন' });

      if (!ObjectId.isValid(userId) || !ObjectId.isValid(productId))
        return res.status(400).json({ success: false, message: 'Invalid ID' });

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });

      if (user.balance < productPrice)
        return res.status(400).json({ success: false, message: 'আপনার ব্যালেন্স পর্যাপ্ত নয়' });

      // একবার কিনেছে কিনা চেক
      const purchased = await userProductsCollection.findOne({
        userId: new ObjectId(userId),
        productId: new ObjectId(productId),
        status: 'active'
      });
      if (purchased)
        return res.status(400).json({ success: false, message: 'আপনি ইতিমধ্যে এই প্রোডাক্টটি কিনেছেন' });

      // ব্যালেন্স কমানো
      await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $inc: { balance: -productPrice } }
      );

      // ইউজার প্রোডাক্ট সংরক্ষণ
      const userProductData = {
        userId: new ObjectId(userId),
        userEmail: user.email,
        userName: user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
        productId: new ObjectId(productId),
        productName,
        productPrice,
        dailyIncome,
        totalDays,
        returnRate,
        purchaseDate: new Date(),
        status: 'active',
        totalEarned: 0,
        lastPaymentDate: null,
        remainingDays: totalDays
      };

      const result = await userProductsCollection.insertOne(userProductData);

      res.json({
        success: true,
        message: 'প্রোডাক্ট সফলভাবে কেনা হয়েছে!',
        data: { _id: result.insertedId, ...userProductData }
      });
    } catch (error) {
      console.error('Purchase error:', error);
      res.status(500).json({ success: false, message: 'প্রোডাক্ট কিনতে সমস্যা হয়েছে' });
    }
  });

  /** ✅ GET /user/:userId → নির্দিষ্ট ইউজারের সব প্রোডাক্ট */
  router.get('/user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      if (!ObjectId.isValid(userId))
        return res.status(400).json({ success: false, message: 'Invalid user ID' });

      const userProducts = await userProductsCollection
        .find({ userId: new ObjectId(userId) })
        .sort({ purchaseDate: -1 })
        .toArray();

      res.json({ success: true, data: userProducts });
    } catch (error) {
      console.error('User products error:', error);
      res.status(500).json({ success: false, message: 'প্রোডাক্ট লোড করতে সমস্যা হয়েছে' });
    }
  });

  /** ✅ POST / → নতুন প্রোডাক্ট যোগ (এডমিন) */
  router.post('/', async (req, res) => {
    try {
      const { name, price, image, rate, days, dailyIncome, description, features } = req.body;

      if (!name || !price || !rate || !days || !dailyIncome)
        return res.status(400).json({ success: false, message: 'সবগুলো ফিল্ড পূরণ করুন' });

      const productData = {
        name,
        price: parseFloat(price),
        image: image || 'https://images.pexels.com/photos/691668/pexels-photo-691668.jpeg',
        rate,
        days: parseInt(days),
        dailyIncome: parseFloat(dailyIncome),
        description: description || '',
        features: features || [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await productsCollection.insertOne(productData);
      res.json({ success: true, message: 'প্রোডাক্ট সফলভাবে যোগ হয়েছে', data: { _id: result.insertedId, ...productData } });
    } catch (error) {
      console.error('Add product error:', error);
      res.status(500).json({ success: false, message: 'প্রোডাক্ট যোগ করতে সমস্যা হয়েছে' });
    }
  });

  /** ✅ PUT /:id → প্রোডাক্ট আপডেট */
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: 'Invalid product ID' });

      const { name, price, image, rate, days, dailyIncome, description, features, isActive = true } = req.body;

      if (!name || !price || !rate || !days || !dailyIncome)
        return res.status(400).json({ success: false, message: 'সবগুলো ফিল্ড পূরণ করুন' });

      const updateData = {
        name,
        price: parseFloat(price),
        image: image || 'https://images.pexels.com/photos/691668/pexels-photo-691668.jpeg',
        rate,
        days: parseInt(days),
        dailyIncome: parseFloat(dailyIncome),
        description: description || '',
        features: features || [],
        isActive,
        updatedAt: new Date()
      };

      const result = await productsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
      if (result.modifiedCount === 0)
        return res.status(404).json({ success: false, message: 'প্রোডাক্ট পাওয়া যায়নি' });

      res.json({ success: true, message: 'প্রোডাক্ট সফলভাবে আপডেট হয়েছে', data: updateData });
    } catch (error) {
      console.error('Update product error:', error);
      res.status(500).json({ success: false, message: 'প্রোডাক্ট আপডেট করতে সমস্যা হয়েছে' });
    }
  });

  /** ✅ DELETE /:id → প্রোডাক্ট ডিলিট */
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ success: false, message: 'Invalid ID' });

      const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0)
        return res.status(404).json({ success: false, message: 'প্রোডাক্ট পাওয়া যায়নি' });

      res.json({ success: true, message: 'প্রোডাক্ট সফলভাবে ডিলিট করা হয়েছে' });
    } catch (error) {
      console.error('Delete product error:', error);
      res.status(500).json({ success: false, message: 'প্রোডাক্ট ডিলিট করতে সমস্যা হয়েছে' });
    }
  });

  return router;
};
