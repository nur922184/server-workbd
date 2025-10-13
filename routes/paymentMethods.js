const { ObjectId } = require('mongodb');

const paymentRoutes = (database) => {
    const router = require('express').Router();
    const paymentMethodsCollection = database.collection("paymentMethods");

    // ✅ CREATE - নতুন পেমেন্ট মেথড যোগ করুন
    router.post('/', async (req, res) => {
        try {
            const {
                userId,
                userEmail,
                displayName,
                paymentMethod,
                phoneNumber,
                status = 'active'
            } = req.body;

            // ভ্যালিডেশন
            if (!userId || !userEmail || !paymentMethod || !phoneNumber) {
                return res.status(400).json({
                    success: false,
                    message: 'সব প্রয়োজনীয় তথ্য প্রদান করুন'
                });
            }

            if (!['bkash', 'nagad'].includes(paymentMethod)) {
                return res.status(400).json({
                    success: false,
                    message: 'সঠিক পেমেন্ট মেথড সিলেক্ট করুন'
                });
            }

            // ফোন নাম্বার ভ্যালিডেশন
            const phoneRegex = /^(?:\+88|88)?01[3-9]\d{8}$/;
            if (!phoneRegex.test(phoneNumber)) {
                return res.status(400).json({
                    success: false,
                    message: 'সঠিক ফোন নাম্বার প্রদান করুন'
                });
            }

            // ফোন নাম্বার ফরম্যাট
            const formattedPhone = phoneNumber.startsWith('+88')
                ? phoneNumber
                : phoneNumber.startsWith('88')
                    ? `+${phoneNumber}`
                    : `+88${phoneNumber}`;

            // একটিভ পেমেন্ট মেথড চেক
            const existingPaymentMethod = await paymentMethodsCollection.findOne({
                userId,
                status: 'active'
            });

            if (existingPaymentMethod) {
                // পুরানো পেমেন্ট মেথড ইনএকটিভ করুন
                await paymentMethodsCollection.updateOne(
                    { _id: existingPaymentMethod._id },
                    {
                        $set: {
                            status: 'inactive',
                            updatedAt: new Date()
                        }
                    }
                );
            }

            // নতুন পেমেন্ট মেথড তৈরি
            const newPaymentMethod = {
                userId,
                userEmail,
                displayName,
                paymentMethod,
                phoneNumber: formattedPhone,
                status,
                isVerified: false,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const result = await paymentMethodsCollection.insertOne(newPaymentMethod);

            res.status(201).json({
                success: true,
                message: 'পেমেন্ট মেথড সফলভাবে সংরক্ষণ করা হয়েছে',
                data: {
                    id: result.insertedId,
                    paymentMethod: newPaymentMethod.paymentMethod,
                    phoneNumber: newPaymentMethod.phoneNumber,
                    status: newPaymentMethod.status,
                    createdAt: newPaymentMethod.createdAt
                }
            });

        } catch (error) {
            console.error('Payment method creation error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড সংরক্ষণ করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ READ - ইউজারের সব পেমেন্ট মেথড
    router.get('/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;

            const paymentMethods = await paymentMethodsCollection.find({
                userId
            }).sort({ createdAt: -1 }).toArray();

            res.json({
                success: true,
                data: paymentMethods
            });

        } catch (error) {
            console.error('Get payment methods error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড লোড করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ READ - ইউজারের একটিভ পেমেন্ট মেথড
    router.get('/user/:userId/active', async (req, res) => {
        try {
            const { userId } = req.params;

            const activePaymentMethod = await paymentMethodsCollection.findOne({
                userId,
                status: 'active'
            });

            if (!activePaymentMethod) {
                return res.status(404).json({
                    success: false,
                    message: 'কোনো একটিভ পেমেন্ট মেথড পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                data: activePaymentMethod
            });

        } catch (error) {
            console.error('Get active payment method error:', error);
            res.status(500).json({
                success: false,
                message: 'একটিভ পেমেন্ট মেথড লোড করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ UPDATE - পেমেন্ট মেথড আপডেট করুন
    router.put('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;

            // Immutable fields remove
            delete updates._id;
            delete updates.userId;
            delete updates.createdAt;

            const result = await paymentMethodsCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        ...updates,
                        updatedAt: new Date()
                    }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'পেমেন্ট মেথড পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: 'পেমেন্ট মেথড আপডেট করা হয়েছে'
            });

        } catch (error) {
            console.error('Update payment method error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড আপডেট করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    // ✅ DELETE - পেমেন্ট মেথড ডিলিট করুন
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;

            const result = await paymentMethodsCollection.updateOne(
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
                    message: 'পেমেন্ট মেথড পাওয়া যায়নি'
                });
            }

            res.json({
                success: true,
                message: 'পেমেন্ট মেথড ডিলিট করা হয়েছে'
            });

        } catch (error) {
            console.error('Delete payment method error:', error);
            res.status(500).json({
                success: false,
                message: 'পেমেন্ট মেথড ডিলিট করতে সমস্যা হয়েছে',
                error: error.message
            });
        }
    });

    return router;
};

module.exports = paymentRoutes;