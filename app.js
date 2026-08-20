const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DATA_FILE = path.join(__dirname, 'data.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = 'yyyyyyyyyyyyyyyyyyyyyyereeeeeeeeeee72yw72y272y72y2y27yw272y272y';

const readTasks = () => {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
};

const writeTasks = (tasks) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf8');
};

const readUsers = () => {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
};

const writeUsers = (users) => {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
};

app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
    }

    const users = readUsers();
    const userExists = users.some(u => u.username === username);

    if (userExists) {
        return res.status(400).json({ message: "User already exists" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
            username,
            password: hashedPassword
        };

        users.push(newUser);
        writeUsers(users);

        res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
    }

    const users = readUsers();
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
    }

    try {
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid username or password" });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        res.status(200).json({ token });
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
        next();
    } catch (err) {
        return res.status(401).json({ message: "Unauthorized" });
    }
};

app.use('/tasks', requireAuth);

app.get('/tasks', (req, res) => {
    const tasks = readTasks();
    res.status(200).json(tasks);
});

app.post('/tasks', (req, res) => {
    const { title } = req.body;

    if (!title) {
        return res.status(400).json({ message: "Title is required" });
    }

    const tasks = readTasks();
    const newTask = {
        id: tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1,
        title: title,
        done: req.body.done !== undefined ? req.body.done : false
    };

    tasks.push(newTask);
    writeTasks(tasks);
    res.status(201).json(newTask);
});

app.put('/tasks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const tasks = readTasks();
    const task = tasks.find(t => t.id === id);

    if (!task) {
        return res.status(404).json({ message: "Task not found" });
    }

    if (req.body.title !== undefined) task.title = req.body.title;
    if (req.body.done !== undefined) task.done = req.body.done;

    writeTasks(tasks);
    res.status(200).json(task);
});

app.delete('/tasks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const tasks = readTasks();
    const index = tasks.findIndex(t => t.id === id);

    if (index === -1) {
        return res.status(404).json({ message: "Task not found" });
    }

    tasks.splice(index, 1);
    writeTasks(tasks);
    res.status(200).json({ message: "Task successfully deleted" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
