const { ObjectId } = require('mongodb');

const userRoutes = (database) => {
    const router = require('express').Router();
    const usersCollection = database.collection("users");

    // ✅ CREATE - নতুন ইউজার তৈরি
    router.post('/', async (req, res) => {
        try {
            const userData = req.body;

            // ভ্যালিডেশন
            if (!userData.email || !userData.displayName) {
                return res.status(400).json({
                    success: false,
                    message: 'ইমেইল এবং নাম প্রয়োজন'
                });
            }

            // ইমেইল already exists check
            const existingUser = await usersCollection.findOne({ email: userData.email });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'এই ইমেইল ইতিমধ্যেই ব্যবহার করা হয়েছে'
                });
            }

            // নতুন ইউজার তৈরি
            const newUser = {
                ...userData,
                status: 'active',
                balance: 0,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const result = await usersCollection.insertOne(newUser);

            res.status(201).json({
                success: true,
                message: 'ইউজার সফলভাবে তৈরি হয়েছে',
                data: {
                    id: result.insertedId,
                    email: newUser.email,
                    displayName: newUser.displayName
                }
            });

        } catch (error) {
            console.error('User creation error:', error);
            res.status(500).json({
                success: false,
                message: 'ইউজার তৈরি করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ READ - ইমেইল দিয়ে ইউজার খুঁজুন
    router.get('/email/:email', async (req, res) => {
        try {
            const { email } = req.params;

            const user = await usersCollection.findOne({ email });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'ইউজার পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                data: user
            });

        } catch (error) {
            console.error('Get user by email error:', error);
            res.status(500).json({
                success: false,
                message: 'ইউজার লোড করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ READ - আইডি দিয়ে ইউজার খুঁজুন
    router.get('/:id', async (req, res) => {
        try {
            const { id } = req.params;

            const user = await usersCollection.findOne({ _id: new ObjectId(id) });
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'ইউজার পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                data: user
            });

        } catch (error) {
            console.error('Get user by ID error:', error);
            res.status(500).json({
                success: false,
                message: 'ইউজার লোড করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ UPDATE - ইউজার আপডেট করুন
    router.put('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const updateData = req.body;

            // Immutable fields remove
            delete updateData._id;
            delete updateData.email;
            delete updateData.createdAt;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        ...updateData,
                        updatedAt: new Date()
                    }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'ইউজার পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: 'ইউজার সফলভাবে আপডেট হয়েছে'
            });

        } catch (error) {
            console.error('Update user error:', error);
            res.status(500).json({
                success: false,
                message: 'ইউজার আপডেট করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ DELETE - ইউজার ডিলিট করুন (soft delete)
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        status: 'inactive',
                        updatedAt: new Date()
                    }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'ইউজার পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: 'ইউজার সফলভাবে ডিলিট হয়েছে'
            });

        } catch (error) {
            console.error('Delete user error:', error);
            res.status(500).json({
                success: false,
                message: 'ইউজার ডিলিট করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    return router;
};

module.exports = userRoutes;