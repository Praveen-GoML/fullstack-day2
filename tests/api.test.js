const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

// Configure test database environment before importing the app
process.env.MONGODB_URI = 'mongodb://localhost:27017/todo_db_test';
process.env.PORT = '0'; // Run on ephemeral port to avoid conflict

const app = require('../app');
const User = require('../models/User');
const Task = require('../models/Task');
const RefreshToken = require('../models/RefreshToken');

let server;
let serverPort;
let baseUrl;

test.before(async () => {
  // Ensure the database connection is established
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  
  // Clear the database collections before starting
  await User.deleteMany({});
  await Task.deleteMany({});
  await RefreshToken.deleteMany({});

  // Start Express listener on ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      serverPort = server.address().port;
      baseUrl = `http://localhost:${serverPort}`;
      resolve();
    });
  });
});

test.after(async () => {
  // Clean up database collections
  await User.deleteMany({});
  await Task.deleteMany({});
  await RefreshToken.deleteMany({});
  
  // Close database connection and Express server
  await mongoose.connection.close();
  await new Promise((resolve) => server.close(resolve));
});

test('API Integration and Authentication Tests', async (t) => {
  const testUserA = { username: 'testuser_a', password: 'password123' };
  const testUserB = { username: 'testuser_b', password: 'password123' };
  
  let tokenA = '';
  let refreshTokenA = '';
  let tokenB = '';
  let taskAId = null;

  await t.test('1. User Registration (Success)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUserA)
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.message, 'User registered successfully');
  });

  await t.test('2. User Registration (Fail: Duplicate)', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUserA)
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.message, 'User already exists');
  });

  await t.test('3. User Login (Success)', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUserA)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.token);
    assert.ok(data.refreshToken);
    tokenA = data.token;
    refreshTokenA = data.refreshToken;
  });

  await t.test('4. User Login (Fail: Invalid Password)', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUserA.username, password: 'wrongpassword' })
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('5. Register & Login User B', async () => {
    // Register User B
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUserB)
    });
    assert.strictEqual(regRes.status, 201);

    // Login User B
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUserB)
    });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    tokenB = loginData.token;
  });

  await t.test('6. Create Task for User A', async () => {
    const res = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ title: 'Task A' })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.title, 'Task A');
    assert.strictEqual(data.done, false);
    assert.ok(data.id);
    taskAId = data.id;
  });

  await t.test('7. List Tasks for User A (Verify Task is visible)', async () => {
    const res = await fetch(`${baseUrl}/tasks`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    const tasks = await res.json();
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.some((t) => t.id === taskAId));
  });

  await t.test('8. List Tasks for User B (Verify Task isolation scoping)', async () => {
    const res = await fetch(`${baseUrl}/tasks`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(res.status, 200);
    const tasks = await res.json();
    assert.ok(Array.isArray(tasks));
    assert.ok(!tasks.some((t) => t.id === taskAId), "User B should not see User A's task");
  });

  await t.test('9. Update Task (Success: Owner)', async () => {
    const res = await fetch(`${baseUrl}/tasks/${taskAId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ done: true, title: 'Task A Updated' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.done, true);
    assert.strictEqual(data.title, 'Task A Updated');
  });

  await t.test('10. Update Task (Fail: Non-Owner isolation)', async () => {
    const res = await fetch(`${baseUrl}/tasks/${taskAId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({ done: false, title: 'Hacked Task' })
    });
    assert.strictEqual(res.status, 404);
  });

  await t.test('11. Delete Task (Fail: Non-Owner isolation)', async () => {
    const res = await fetch(`${baseUrl}/tasks/${taskAId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.strictEqual(res.status, 404);
  });

  await t.test('12. Delete Task (Success: Owner)', async () => {
    const res = await fetch(`${baseUrl}/tasks/${taskAId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
  });
});
