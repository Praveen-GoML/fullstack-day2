const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now, expires: '1h' }
});

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
