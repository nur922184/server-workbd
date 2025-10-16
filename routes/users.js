const express = require('express');

module.exports = function (usersCollection) {
  const router = express.Router();

  // ✅ POST - Create User
  router.post('/', async (req, res) => {
    const userData = req.body;

    try {
      const existingUser = await usersCollection.findOne({ email: userData.email });
      if (existingUser) {
        return res.status(400).json({ message: 'এই ইমেইল ইতিমধ্যেই ব্যবহার করা হয়েছে' });
      }

      const result = await usersCollection.insertOne(userData);
      res.status(201).json({
        message: 'User created successfully',
        insertedId: result.insertedId
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  });

  // all user loaded 
  router.get('/', async (req, res) => {
    try {
      const users = await usersCollection.find().toArray();
      res.status(200).json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // 🔹 ইউজার delete by ID
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { ObjectId } = require('mongodb');

    try {
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({ message: "User deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });


  // ✅ GET - Get User by Email
  router.get('/email/:email', async (req, res) => {
    const { email } = req.params;

    try {
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });

      res.status(200).json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
