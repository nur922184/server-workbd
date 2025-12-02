// routes/withdrawals.js - Optimized & Commented
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

module.exports = (withdrawalsCollection, usersCollection, paymentsCollection) => {


// Submit Withdrawal Request
// ==========================
router.post('/', async (req, res) => {
    try {
        const { userId, email, paymentMethodId, amount } = req.body;

        if (!userId || !email || !paymentMethodId || !amount) {
            return res.status(400).json({ success: false, message: 'সবগুলো ফিল্ড পূরণ করুন' });
        }

        const withdrawalAmount = parseFloat(amount);
        if (withdrawalAmount <= 0 || withdrawalAmount < 200) {
            return res.status(400).json({ success: false, message: 'ন্যূনতম ৳200 উত্তোলন করতে হবে' });
        }

        // Fetch user
        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
        
        // Check balance
        if (user.balance < withdrawalAmount) {
            return res.status(400).json({ success: false, message: 'ব্যালেন্স পর্যাপ্ত নয়' });
        }

        // 5% charge calculation
        const fivePercentCharge = withdrawalAmount * 0.05; // 5% of withdrawal amount
        const totalDeduction = withdrawalAmount + fivePercentCharge; // Actual amount to deduct
        
        // Check if user has enough balance for withdrawal + 5%
        if (user.balance < totalDeduction) {
            return res.status(400).json({ 
                success: false, 
                message: `ব্যালেন্স পর্যাপ্ত নয়। উত্তোলন: ৳${withdrawalAmount} + ৫% চার্জ: ৳${fivePercentCharge.toFixed(2)} = মোট ৳${totalDeduction.toFixed(2)} প্রয়োজন` 
            });
        }

        // Fetch payment method
        const paymentMethod = await paymentsCollection.findOne({ _id: new ObjectId(paymentMethodId) });
        if (!paymentMethod) return res.status(404).json({ success: false, message: 'পেমেন্ট মেথড পাওয়া যায়নি' });

        // Deduct balance (withdrawal amount + 5% charge)
        const newBalance = user.balance - totalDeduction;
        await usersCollection.updateOne(
            { _id: new ObjectId(userId) }, 
            { 
                $set: { balance: newBalance },
                $inc: { total5PercentCharged: fivePercentCharge } // Optional: track total 5% charges
            }
        );

        // Create withdrawal record
        const withdrawalData = {
            userId: new ObjectId(userId),
            userEmail: email,
            userName: user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
            paymentMethod: paymentMethod.paymentMethod,
            paymentNumber: paymentMethod.phoneNumber,
            paymentMethodId: new ObjectId(paymentMethodId),
            amount: withdrawalAmount,
            fivePercentCharge: fivePercentCharge,
            totalDeduction: totalDeduction,
            previousBalance: user.balance,
            newBalance,
            status: 'pending',
            createdAt: new Date(),
            approvedAt: null,
            approvedBy: null
        };

        const result = await withdrawalsCollection.insertOne(withdrawalData);

        res.json({ 
            success: true, 
            message: 'Withdrawal রিকোয়েস্ট সাবমিট হয়েছে! ৫% চার্জ কেটে নেওয়া হয়েছে।', 
            data: { _id: result.insertedId, ...withdrawalData } 
        });

    } catch (error) {
        console.error('Withdrawal submission error:', error);
        res.status(500).json({ success: false, message: 'এরর হয়েছে!' });
    }
});

    // ==========================
    // Update Withdrawal Status (Admin)
    // ==========================
    router.patch('/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            const { status, approvedBy } = req.body;

            if (!['pending', 'approved', 'rejected'].includes(status)) {
                return res.status(400).json({ success: false, message: 'অবৈধ স্ট্যাটাস' });
            }

            const withdrawal = await withdrawalsCollection.findOne({ _id: new ObjectId(id) });
            if (!withdrawal) return res.status(404).json({ success: false, message: 'উত্তোলন রিকোয়েস্ট পাওয়া যায়নি' });

            // If rejected, refund balance
            if (status === 'rejected' && withdrawal.status === 'pending') {
                await usersCollection.updateOne({ _id: new ObjectId(withdrawal.userId) }, { $inc: { balance: withdrawal.amount } });
            }

            // Update withdrawal record
            await withdrawalsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status, approvedAt: status !== 'pending' ? new Date() : null, approvedBy: status !== 'pending' ? approvedBy : null } }
            );

            res.json({ success: true, message: `উত্তোলন রিকোয়েস্ট ${status} করা হয়েছে` });

        } catch (error) {
            console.error('Update withdrawal status error:', error);
            res.status(500).json({ success: false, message: 'স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে' });
        }
    });

    // ==========================
    // User Withdrawal History
    // ==========================
    router.get('/user/:userId', async (req, res) => {
        try {
            const withdrawals = await withdrawalsCollection
                .find({ userId: new ObjectId(req.params.userId) })
                .sort({ createdAt: -1 })
                .toArray();

            res.json({ success: true, data: withdrawals });
        } catch (error) {
            console.error('Get withdrawals error:', error);
            res.status(500).json({ success: false, message: 'উত্তোলন হিস্ট্রি লোড করতে সমস্যা হয়েছে' });
        }
    });

    // ==========================
    // Admin: All Withdrawals with Pagination
    // ==========================
    router.get('/all', async (req, res) => {
        try {
            const { status, page = 1, limit = 20 } = req.query;
            const query = status && status !== 'all' ? { status } : {};

            const skip = (parseInt(page) - 1) * parseInt(limit);
            const withdrawals = await withdrawalsCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).toArray();
            const total = await withdrawalsCollection.countDocuments(query);

            res.json({
                success: true,
                data: withdrawals,
                pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)), totalWithdrawals: total }
            });

        } catch (error) {
            console.error('Get all withdrawals error:', error);
            res.status(500).json({ success: false, message: 'উত্তোলন রিকোয়েস্ট লোড করতে সমস্যা হয়েছে' });
        }
    });

    // ==========================
    // Health Check
    // ==========================
    router.get('/health', (req, res) => res.json({ success: true, message: 'Withdrawals API is working' }));

    return router;
};
