const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hq6na.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Connect MongoDB and load routes
async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("workup");

    // Collections
    const usersCollection = db.collection("users");
    const paymentsCollection = db.collection("payments");
    const transactionsCollection = db.collection("transactions"); // নতুন কালেকশন
    const withdrawalsCollection = db.collection("withdrawals");
    const productsCollection = db.collection("products")
    const userProductsCollection = db.collection("user_products");
    const referralsCollection = db.collection("referrals");

    // Routes
    const userRoutes = require('./routes/users')(usersCollection);
    const paymentRoutes = require('./routes/payments')(paymentsCollection);
    const transactionRoutes = require('./routes/transactions')(transactionsCollection, usersCollection);
    const withdrawalRoutes = require('./routes/withdrawals')(withdrawalsCollection, usersCollection, paymentsCollection);
    const productRoutes = require('./routes/products')(productsCollection, usersCollection, userProductsCollection);
    const dailyIncomeRoutes = require('./routes/dailyIncome')(userProductsCollection, usersCollection);
    const referralRoutes = require('./routes/referrals')(usersCollection, referralsCollection, transactionsCollection);

    app.use('/api/users', userRoutes);
    app.use('/api/payment-methods', paymentRoutes);
    app.use('/api/transactions', transactionRoutes); // নতুন রাউট
    app.use('/api/withdrawals', withdrawalRoutes);
    app.use('/api/products', productRoutes);
    app.use('/api/daily-income', dailyIncomeRoutes);
    app.use('/api/referrals', referralRoutes);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
  }
}

connectDB();

// Root Route
app.get('/', (req, res) => {
  res.send('🚀 Server is running...');
});

// Start Server
app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});