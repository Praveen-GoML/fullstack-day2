import { useState, useEffect } from 'react';

const API_URL = 'http://localhost:3000';

// Simple helper to decode JWT payload without library dependency
const decodeJwt = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
};

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem('refreshToken') || '');
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); // 'login', 'register', 'dashboard'
  
  const [tasks, setTasks] = useState([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  
  const [toasts, setToasts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Auto-decode token on startup or change
  useEffect(() => {
    if (token) {
      const decoded = decodeJwt(token);
      if (decoded) {
        const isLocal = decoded.clientIp === '::1' || decoded.clientIp === '127.0.0.1' || !decoded.clientIp;
        setUser({
          id: decoded.id,
          username: decoded.username,
          ip: isLocal ? '127.0.0.1 (Localhost)' : decoded.clientIp,
          country: isLocal || decoded.clientCountry === 'UNKNOWN' ? 'Local Development' : decoded.clientCountry
        });
        setView('dashboard');
      } else {
        handleLogoutLocal();
      }
    } else {
      setView('login');
      setUser(null);
    }
  }, [token]);

  // Fetch tasks when user is logged in
  useEffect(() => {
    if (view === 'dashboard' && token) {
      fetchTasks();
    }
  }, [view, token]);

  // Fetch real-time public IPv4 and country from client-side GeoIP API
  useEffect(() => {
    if (view === 'dashboard') {
      fetch('https://api4.ipify.org?format=json')
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Failed to fetch IPv4');
        })
        .then((ipData) => {
          const ipv4 = ipData.ip;
          return fetch(`https://ipapi.co/${ipv4}/json/`)
            .then((res) => {
              if (res.ok) return res.json();
              return { ip: ipv4, country_name: 'Unknown Location' };
            });
        })
        .then((geoData) => {
          setUser((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              ip: geoData.ip || prev.ip,
              country: geoData.country_name || prev.country
            };
          });
        })
        .catch((err) => {
          console.error('Real-time IPv4 GeoIP fetch error:', err);
        });
    }
  }, [view]);

  // Toast helper
  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleLogoutLocal = () => {
    setToken('');
    setRefreshToken('');
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    setView('login');
  };

  // Centralized fetch wrapper with auto token refresh logic
  const authenticatedRequest = async (endpoint, options = {}) => {
    let currentToken = token;
    
    // Add token header
    options.headers = {
      ...options.headers,
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentToken}`
    };

    try {
      let response = await fetch(`${API_URL}${endpoint}`, options);

      // If unauthorized, attempt to refresh token
      if (response.status === 401 && refreshToken) {
        try {
          const refreshRes = await fetch(`${API_URL}/auth/refresh-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: refreshToken })
          });

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            const newAccessToken = refreshData.accessToken;

            // Save new access token
            setToken(newAccessToken);
            localStorage.setItem('token', newAccessToken);

            // Retry original request with new token
            options.headers['Authorization'] = `Bearer ${newAccessToken}`;
            response = await fetch(`${API_URL}${endpoint}`, options);
          } else {
            // Refresh token expired or invalid
            showToast('Session expired. Please log in again.', 'error');
            handleLogoutLocal();
            throw new Error('Unauthorized');
          }
        } catch (refreshErr) {
          handleLogoutLocal();
          throw new Error('Unauthorized');
        }
      }

      return response;
    } catch (err) {
      console.error('Request failed:', err);
      throw err;
    }
  };

  // Auth Operations
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      showToast('Please enter both username and password.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok) {
        setToken(data.token);
        setRefreshToken(data.refreshToken);
        localStorage.setItem('token', data.token);
        localStorage.setItem('refreshToken', data.refreshToken);
        showToast('Successfully logged in!');
        setUsername('');
        setPassword('');
      } else {
        showToast(data.message || 'Invalid username or password', 'error');
      }
    } catch (err) {
      showToast('Cannot connect to authorization server.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regUsername || !regPassword) {
      showToast('Please enter both username and password.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: regUsername, password: regPassword })
      });

      const data = await res.json();

      if (res.ok) {
        showToast('Registration successful! Please log in.');
        setRegUsername('');
        setRegPassword('');
        setView('login');
      } else {
        showToast(data.message || 'Registration failed.', 'error');
      }
    } catch (err) {
      showToast('Cannot connect to authorization server.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (refreshToken) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: refreshToken })
        });
      } catch (err) {
        console.error('Failed to revoke session on server:', err);
      }
    }
    handleLogoutLocal();
    showToast('Logged out successfully.');
  };

  // Task Operations
  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const res = await authenticatedRequest('/tasks');
      if (res.ok) {
        const data = await res.json();
        // Backend tasks have fields: id, title, done
        setTasks(data);
      } else {
        showToast('Failed to fetch tasks.', 'error');
      }
    } catch (err) {
      showToast('Error communicating with tasks server.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      const res = await authenticatedRequest('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: newTaskTitle.trim() })
      });

      if (res.ok) {
        const newTask = await res.json();
        setTasks((prev) => [...prev, newTask]);
        setNewTaskTitle('');
        showToast('Task added successfully!');
      } else {
        showToast('Failed to add task.', 'error');
      }
    } catch (err) {
      showToast('Error sending task to server.', 'error');
    }
  };

  const handleToggleTask = async (id, currentDone) => {
    try {
      const res = await authenticatedRequest(`/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ done: !currentDone })
      });

      if (res.ok) {
        const updatedTask = await res.json();
        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, done: updatedTask.done } : t))
        );
      } else {
        showToast('Failed to update task status.', 'error');
      }
    } catch (err) {
      showToast('Error updating task on server.', 'error');
    }
  };

  const startEditing = (task) => {
    setEditingTaskId(task.id);
    setEditingTaskTitle(task.title);
  };

  const handleSaveTaskTitle = async (id) => {
    if (!editingTaskTitle.trim()) return;

    try {
      const res = await authenticatedRequest(`/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editingTaskTitle.trim() })
      });

      if (res.ok) {
        const updatedTask = await res.json();
        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, title: updatedTask.title } : t))
        );
        setEditingTaskId(null);
        showToast('Task title updated.');
      } else {
        showToast('Failed to update task title.', 'error');
      }
    } catch (err) {
      showToast('Error saving task details.', 'error');
    }
  };

  const handleDeleteTask = async (id) => {
    try {
      const res = await authenticatedRequest(`/tasks/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        showToast('Task deleted successfully.');
      } else {
        showToast('Failed to delete task.', 'error');
      }
    } catch (err) {
      showToast('Error removing task from server.', 'error');
    }
  };

  const completedCount = tasks.filter((t) => t.done).length;
  const completionPercentage = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <>
      {/* Toast Notification Layer */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span>{toast.message}</span>
            <button className="toast-close" onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}>
              &times;
            </button>
          </div>
        ))}
      </div>

      {/* Auth Views: Login */}
      {view === 'login' && (
        <div className="auth-container fade-in">
          <div className="auth-header">
            <h1 className="auth-logo">Taskify</h1>
            <p className="auth-subtitle">Secure task manager with multi-session auth</p>
          </div>
          
          <form onSubmit={handleLoginSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. praveen"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Verifying...' : 'Sign In'}
            </button>
          </form>

          <div className="auth-footer">
            Don't have an account?{' '}
            <span className="auth-link" onClick={() => setView('register')}>
              Create Account
            </span>
          </div>
        </div>
      )}

      {/* Auth Views: Register */}
      {view === 'register' && (
        <div className="auth-container fade-in">
          <div className="auth-header">
            <h1 className="auth-logo">Taskify</h1>
            <p className="auth-subtitle">Create a secure profile</p>
          </div>
          
          <form onSubmit={handleRegisterSubmit}>
            <div className="form-group">
              <label className="form-label">Create Username</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. praveen"
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Create Password</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Registering...' : 'Sign Up'}
            </button>
          </form>

          <div className="auth-footer">
            Already have an account?{' '}
            <span className="auth-link" onClick={() => setView('login')}>
              Sign In
            </span>
          </div>
        </div>
      )}

      {/* Main App View: Dashboard */}
      {view === 'dashboard' && user && (
        <div className="dashboard-container fade-in">
          {/* Header */}
          <header className="top-bar">
            <div className="user-info">
              <h2 className="welcome-msg">Welcome back, {user.username}!</h2>
              <div className="meta-details">
                <div className="meta-item">
                  <span>📍 Country:</span>
                  <strong>{user.country}</strong>
                </div>
                <div className="meta-item">
                  <span>💻 IP:</span>
                  <strong>{user.ip}</strong>
                </div>
              </div>
            </div>
            
            <button className="btn-logout" onClick={handleLogout}>
              Logout
            </button>
          </header>

          {/* Stats Bar */}
          <section className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Total Tasks</span>
              <span className="stat-value">{tasks.length}</span>
            </div>
            
            <div className="stat-card">
              <span className="stat-label">Completed Tasks</span>
              <span className="stat-value">{completedCount}</span>
            </div>

            <div className="stat-card">
              <span className="stat-label">Task Progress</span>
              <span className="stat-value">{completionPercentage}%</span>
              <div className="progress-bar-container">
                <div className="progress-bar" style={{ width: `${completionPercentage}%` }}></div>
              </div>
            </div>
          </section>

          {/* Main Board */}
          <main className="main-board">
            {/* New Task Form */}
            <form onSubmit={handleAddTask} className="task-form">
              <div className="task-input-container">
                <input
                  type="text"
                  className="task-input"
                  placeholder="Enter a new task title..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-add">
                Add Task
              </button>
            </form>

            {/* Tasks List */}
            {isLoading ? (
              <div className="loading-container">
                <div className="spinner"></div>
                <p style={{ color: 'var(--text-secondary)' }}>Loading tasks...</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">📝</span>
                <p>No tasks yet! Add a task above to get started.</p>
              </div>
            ) : (
              <div className="tasks-list">
                {tasks.map((task) => (
                  <div key={task.id} className="task-card">
                    <div className="task-left">
                      <div
                        className={`custom-checkbox ${task.done ? 'checked' : ''}`}
                        onClick={() => handleToggleTask(task.id, task.done)}
                      ></div>
                      
                      <div className="task-content">
                        {editingTaskId === task.id ? (
                          <input
                            type="text"
                            className="task-title-input"
                            value={editingTaskTitle}
                            onChange={(e) => setEditingTaskTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveTaskTitle(task.id);
                              if (e.key === 'Escape') setEditingTaskId(null);
                            }}
                            autoFocus
                          />
                        ) : (
                          <span
                            className={`task-title ${task.done ? 'completed' : ''}`}
                            onDoubleClick={() => !task.done && startEditing(task)}
                          >
                            {task.title}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="task-actions">
                      {editingTaskId === task.id ? (
                        <button
                          className="action-btn action-btn-save"
                          onClick={() => handleSaveTaskTitle(task.id)}
                          title="Save Changes"
                        >
                          💾
                        </button>
                      ) : (
                        <button
                          className="action-btn action-btn-edit"
                          onClick={() => startEditing(task)}
                          disabled={task.done}
                          title={task.done ? "Cannot edit completed task" : "Edit Task"}
                          style={{ opacity: task.done ? 0.3 : 1, cursor: task.done ? 'not-allowed' : 'pointer' }}
                        >
                          ✏️
                        </button>
                      )}
                      
                      <button
                        className="action-btn action-btn-delete"
                        onClick={() => handleDeleteTask(task.id)}
                        title="Delete Task"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      )}
    </>
  );
}

export default App;
