require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const geoip = require('geoip-lite');
const cors = require('cors');

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
    return ip;
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'yyyyyyyyyyyyyyyyyyyyyyereeeeeeeeeee72yw72y272y72y2y27yw272y272y';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'zzzzzzzzzzzzzzzzzzzzzzereeeeeeeeeee72yw72y272y72y2y27yw272y272y';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/todo_db';

const DATA_FILE = path.join(__dirname, 'data.json');
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(cors());
app.use(express.json());

// Import Models
const User = require('./models/User');
const Task = require('./models/Task');
const RefreshToken = require('./models/RefreshToken');

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB');
        runMigration();
    })
    .catch(err => {
        console.error('Failed to connect to MongoDB:', err);
    });

// Migration logic to import initial data from JSON files if database is empty
const runMigration = async () => {
    try {
        // Migrate Users
        const userCount = await User.countDocuments();
        if (userCount === 0 && fs.existsSync(USERS_FILE)) {
            console.log('Migrating users from users.json to MongoDB...');
            const rawUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            if (Array.isArray(rawUsers) && rawUsers.length > 0) {
                await User.insertMany(rawUsers);
                console.log(`Successfully migrated ${rawUsers.length} users.`);
            }
        }

        // Migrate Tasks
        const taskCount = await Task.countDocuments();
        if (taskCount === 0 && fs.existsSync(DATA_FILE)) {
            console.log('Migrating tasks from data.json to MongoDB...');
            const rawTasks = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (Array.isArray(rawTasks) && rawTasks.length > 0) {
                const parsedTasks = rawTasks.map(t => ({
                    id: t.id,
                    userId: 1, // Default to first user
                    title: t.title,
                    done: t.done === 'true' || t.done === true
                }));
                await Task.insertMany(parsedTasks);
                console.log(`Successfully migrated ${parsedTasks.length} tasks.`);
            }
        }
    } catch (err) {
        console.error('Error during data migration:', err);
    }
};

app.post(['/register', '/auth/register'], async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
    }

    try {
        const userExists = await User.findOne({ username });

        if (userExists) {
            return res.status(400).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const users = await User.find().select('id').lean();
        const nextId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;

        const newUser = new User({
            id: nextId,
            username,
            password: hashedPassword
        });

        await newUser.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post(['/login', '/auth/login'], async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
    }

    try {
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(401).json({ message: "Invalid username or password" });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid username or password" });
        }

        const clientIp = getClientIp(req);
        const geo = geoip.lookup(clientIp);
        const clientCountry = geo ? geo.country : 'UNKNOWN';

        const token = jwt.sign({ id: user.id, username: user.username, clientIp, clientCountry }, JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign({ id: user.id, username: user.username, clientIp, clientCountry }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

        // Save refresh token to DB
        await new RefreshToken({
            token: refreshToken,
            userId: user.id
        }).save();

        res.status(200).json({ token, refreshToken });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post(['/refresh-token', '/auth/refresh-token'], async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ message: "Refresh token is required" });
    }

    try {
        const storedToken = await RefreshToken.findOne({ token });
        if (!storedToken) {
            return res.status(403).json({ message: "Invalid refresh token" });
        }

        jwt.verify(token, JWT_REFRESH_SECRET, async (err, decoded) => {
            if (err) {
                await RefreshToken.deleteOne({ token });
                return res.status(403).json({ message: "Invalid refresh token" });
            }

            // Verify current IP matches the refresh token payload strictly
            const currentIp = getClientIp(req);
            if (decoded.clientIp !== currentIp) {
                // Revoke refresh token on security mismatch
                await RefreshToken.deleteOne({ token });
                return res.status(403).json({ message: "Security Alert: IP address mismatch. Refresh token revoked." });
            }

            const accessToken = jwt.sign({ 
                id: decoded.id, 
                username: decoded.username,
                clientIp: currentIp,
                clientCountry: decoded.clientCountry
            }, JWT_SECRET, { expiresIn: '15m' });
            res.status(200).json({ accessToken });
        });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post(['/logout', '/auth/logout'], async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ message: "Refresh token is required" });
    }

    try {
        await RefreshToken.deleteOne({ token });
        res.status(200).json({ message: "Logged out successfully" });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post(['/revoke', '/auth/revoke'], async (req, res) => {
    const { token, userId } = req.body;

    if (!token && !userId) {
        return res.status(400).json({ message: "Token or userId is required" });
    }

    try {
        if (token) {
            const result = await RefreshToken.deleteOne({ token });
            if (result.deletedCount === 0) {
                return res.status(404).json({ message: "Token not found" });
            }
            return res.status(200).json({ message: "Token revoked successfully" });
        }

        if (userId) {
            const numericUserId = parseInt(userId);
            if (isNaN(numericUserId)) {
                return res.status(400).json({ message: "Invalid userId" });
            }
            await RefreshToken.deleteMany({ userId: numericUserId });
            return res.status(200).json({ message: `All sessions revoked for user ${numericUserId}` });
        }
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});


const requireAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;

        // Perform strict IP address verification to prevent token hijacking
        const currentIp = getClientIp(req);
        if (decoded.clientIp !== currentIp) {
            return res.status(403).json({ message: "Security Alert: IP address mismatch. Session hijacked or network changed." });
        }

        next();
    } catch (err) {
        return res.status(401).json({ message: "Unauthorized" });
    }
};

app.use('/tasks', requireAuth);

app.get('/tasks', async (req, res) => {
    try {
        const tasks = await Task.find({ userId: req.user.id }, { _id: 0, __v: 0 });
        res.status(200).json(tasks);
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/tasks', async (req, res) => {
    const { title } = req.body;

    if (!title) {
        return res.status(400).json({ message: "Title is required" });
    }

    try {
        const tasks = await Task.find().select('id').lean();
        const nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;

        const newTask = new Task({
            id: nextId,
            userId: req.user.id,
            title: title,
            done: req.body.done !== undefined ? req.body.done : false
        });

        await newTask.save();
        res.status(201).json({
            id: newTask.id,
            title: newTask.title,
            done: newTask.done
        });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.put('/tasks/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid task ID" });
    }

    try {
        const task = await Task.findOne({ id, userId: req.user.id });

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        if (req.body.title !== undefined) task.title = req.body.title;
        if (req.body.done !== undefined) task.done = req.body.done;

        await task.save();
        res.status(200).json({
            id: task.id,
            title: task.title,
            done: task.done
        });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.delete('/tasks/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid task ID" });
    }

    try {
        const result = await Task.deleteOne({ id, userId: req.user.id });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        res.status(200).json({ message: "Task successfully deleted" });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
