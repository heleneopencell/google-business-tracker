import React, { useState, useEffect } from 'react';

interface Business {
  id: number;
  canonicalBusinessKey: string;
  name: string | null;
  url: string;
  lastCheckedDate: string | null;
  lastCheckedAt: string | null;
  spreadsheetId: string | null;
}

function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newBusinessUrl, setNewBusinessUrl] = useState('');

  useEffect(() => {
    checkStatus();
    loadBusinesses();
  }, []);

  const checkStatus = async () => {
    try {
      const [sessionRes, authRes] = await Promise.all([
        fetch('/api/session/status'),
        fetch('/api/auth/status')
      ]);
      const sessionData = await sessionRes.json();
      const authData = await authRes.json();
      setLoggedIn(sessionData.loggedIn);
      setAuthenticated(authData.authenticated);
    } catch (e) {
      console.error('Failed to check status', e);
    }
  };

  const loadBusinesses = async () => {
    try {
      const res = await fetch('/api/businesses');
      const data = await res.json();
      setBusinesses(data);
    } catch (e) {
      console.error('Failed to load businesses', e);
    }
  };

  const handleOpenLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/session/open-login', { method: 'POST' });
      if (res.ok) {
        setSuccess('Login page opened. Please complete login in the browser window.');
        setTimeout(() => checkStatus(), 2000);
      } else {
        setError('Failed to open login page');
      }
    } catch (e) {
      setError('Failed to open login page');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthenticate = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const data = await res.json();
      window.open(data.url, '_blank');
      setSuccess('Authentication window opened. Please complete authentication.');
      setTimeout(() => checkStatus(), 2000);
    } catch (e) {
      setError('Failed to get authentication URL');
    }
  };

  const handleAddBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newBusinessUrl })
      });

      if (res.ok) {
        const data = await res.json();
        setSuccess(`Business added successfully! ID: ${data.id}`);
        setNewBusinessUrl('');
        loadBusinesses();
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Failed to add business');
      }
    } catch (e) {
      setError('Failed to add business');
    } finally {
      setLoading(false);
    }
  };

  const handleRunCheck = async (id: number) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/businesses/${id}/check`, {
        method: 'POST'
      });

      if (res.ok) {
        setSuccess('Check completed successfully!');
        loadBusinesses();
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Failed to run check');
      }
    } catch (e) {
      setError('Failed to run check');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Google Business Tracker</h1>
        <div className="status">
          <div className={`status-item ${loggedIn ? 'logged-in' : 'logged-out'}`}>
            Google Maps: {loggedIn ? 'Logged In' : 'Logged Out'}
          </div>
          <div className={`status-item ${authenticated ? 'authenticated' : 'not-authenticated'}`}>
            Google Sheets: {authenticated ? 'Authenticated' : 'Not Authenticated'}
          </div>
        </div>
        <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
          {loggedIn === false && (
            <button className="button button-primary" onClick={handleOpenLogin} disabled={loading}>
              Open Login
            </button>
          )}
          {authenticated === false && (
            <button className="button button-primary" onClick={handleAuthenticate} disabled={loading}>
              Authenticate with Google
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <form className="form" onSubmit={handleAddBusiness}>
        <div className="form-group">
          <label htmlFor="url">Google Maps Business URL</label>
          <input
            type="url"
            id="url"
            value={newBusinessUrl}
            onChange={(e) => setNewBusinessUrl(e.target.value)}
            placeholder="https://www.google.com/maps/place/..."
            required
            disabled={loading}
          />
        </div>
        <button type="submit" className="button button-primary" disabled={loading || !loggedIn || !authenticated}>
          Add Business
        </button>
      </form>

      <div className="business-list">
        <h2 style={{ padding: '20px', borderBottom: '1px solid #eee' }}>Businesses</h2>
        {businesses.length === 0 ? (
          <div className="loading">No businesses added yet.</div>
        ) : (
          businesses.map((business) => (
            <div key={business.id} className="business-item">
              <div className="business-info">
                <h3>{business.name || 'Unknown Business'}</h3>
                <p>{business.url}</p>
                <p style={{ fontSize: '12px', color: '#999' }}>
                  Last checked: {business.lastCheckedDate || 'Never'}
                </p>
              </div>
              <div className="business-actions">
                {business.spreadsheetId && (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${business.spreadsheetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="button button-secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    View Sheet
                  </a>
                )}
                <button
                  className="button button-primary"
                  onClick={() => handleRunCheck(business.id)}
                  disabled={loading || !loggedIn || !authenticated}
                >
                  Run Check
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;

