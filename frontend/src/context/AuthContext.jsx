import React, { createContext, useContext, useEffect, useState } from 'react';
import { parseJsonResponse } from '../utils/api';

const AuthContext = createContext();

// Use a relative API base so local dev is proxied by Vite and production uses the same origin.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [networkError, setNetworkError] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      try {
        // Quick connection check to see if the server is offline/down
        const pingRes = await fetch(`${API_BASE}/api/test/ping`);
        if (!pingRes.ok) {
          throw new Error('Ping failed');
        }
      } catch (err) {
        console.error('Server is unreachable', err);
        setNetworkError(true);
        setLoading(false);
        return;
      }

      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const userData = await parseJsonResponse(response);
          setUser(userData);
        } else if (response.status === 401 || response.status === 403) {
          // Token expired or invalid
          logout();
        } else {
          console.warn(`Server returned status ${response.status}. Keeping session.`);
        }
      } catch (err) {
        console.error('Failed to verify token', err);
        // Don't log out if it's a network disconnect error, just keep state
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, [token]);

  const login = async (username, password) => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.detail || 'Login failed');
      }
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('role', data.role);
      setToken(data.access_token);
      
      // Fetch details
      const userRes = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
        },
      });
      if (userRes.ok) {
        const userData = await parseJsonResponse(userRes);
        setUser(userData);
        return userData;
      }
      throw new Error('Could not retrieve user details');
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const register = async (username, password) => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.detail || 'Registration failed');
      }
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, error, login, register, logout, setUser, networkError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
