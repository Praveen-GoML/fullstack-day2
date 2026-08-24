const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    userId: { type: Number, required: true },
    title: { type: String, required: true },
    done: { type: Boolean, default: false }
});

module.exports = mongoose.model('Task', taskSchema);
