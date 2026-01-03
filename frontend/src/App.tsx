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
  const [checkAllLoading, setCheckAllLoading] = useState(false);
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
      
      // If logged in, show success message
      if (sessionData.loggedIn && !loggedIn) {
        setSuccess('Successfully logged in to Google Maps!');
        setTimeout(() => setSuccess(null), 5000);
      }
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
    if (loading) return; // Prevent multiple clicks
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/session/open-login', { method: 'POST' });
      if (res.ok) {
        setSuccess('Browser window opened. Please log in to your Google account in that window. Then click "Refresh Status" to check.');
        // Check status once after a delay, then let user manually refresh
        setTimeout(() => {
          checkStatus();
        }, 10000); // Check once after 10 seconds
      } else {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.details 
          ? `${errorData.error}: ${errorData.details}`
          : (errorData.error || 'Failed to open login page');
        setError(errorMsg);
        console.error('Login error:', errorData);
      }
    } catch (e: any) {
      setError(`Failed to open login page: ${e?.message || 'Network error'}`);
      console.error('Login exception:', e);
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

  const handleRunCheckAll = async () => {
    if (businesses.length === 0) {
      setError('No businesses to check');
      return;
    }

    if (!confirm(`Run checks for all ${businesses.length} businesses? This may take a while.`)) {
      return;
    }

    setCheckAllLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/businesses/check-all', {
        method: 'POST'
      });

      if (res.ok) {
        const data = await res.json();
        if (data.failed === 0) {
          setSuccess(`Successfully checked all ${data.checked} businesses!`);
        } else {
          setSuccess(`Checked ${data.checked} businesses. ${data.failed} failed.`);
          if (data.errors && data.errors.length > 0) {
            const errorDetails = data.errors.map((e: any) => `${e.name || `Business ${e.id}`}: ${e.error}`).join('; ');
            console.error('Check errors:', errorDetails);
          }
        }
        loadBusinesses();
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Failed to run checks');
      }
    } catch (e) {
      setError('Failed to run checks');
    } finally {
      setCheckAllLoading(false);
    }
  };

  const handleDeleteBusiness = async (id: number, name: string | null) => {
    if (!confirm(`Are you sure you want to delete "${name || 'this business'}"? This will remove it from tracking, but the Google Sheet will remain.`)) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/businesses/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setSuccess('Business deleted successfully!');
        loadBusinesses();
      } else {
        const errorData = await res.json();
        setError(errorData.error || 'Failed to delete business');
      }
    } catch (e) {
      setError('Failed to delete business');
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
          {loggedIn !== true && (
            <button className="button button-primary" onClick={handleOpenLogin} disabled={loading}>
              {loggedIn === false ? 'Open Login' : 'Login to Google Maps'}
            </button>
          )}
          {authenticated !== true && (
            <button className="button button-primary" onClick={handleAuthenticate} disabled={loading}>
              Authenticate with Google
            </button>
          )}
          <button className="button button-secondary" onClick={checkStatus} disabled={loading} style={{ marginLeft: 'auto' }}>
            Refresh Status
          </button>
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
        <div style={{ padding: '20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Businesses</h2>
          {businesses.length > 0 && (
            <button
              className="button button-primary"
              onClick={handleRunCheckAll}
              disabled={loading || checkAllLoading || !loggedIn || !authenticated}
              style={{ fontSize: '14px', padding: '8px 16px', opacity: checkAllLoading ? 0.7 : 1 }}
            >
              {checkAllLoading ? `Processing... (${businesses.length})` : `Run Check All (${businesses.length})`}
            </button>
          )}
        </div>
        {checkAllLoading && (
          <div style={{ padding: '15px 20px', background: '#f0f7ff', borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ 
              width: '16px', 
              height: '16px', 
              border: '2px solid #4a90e2', 
              borderTop: '2px solid transparent', 
              borderRadius: '50%', 
              animation: 'spin 1s linear infinite' 
            }}></div>
            <span style={{ color: '#4a90e2', fontWeight: '500' }}>
              Running checks for all businesses... This may take a few minutes.
            </span>
          </div>
        )}
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
                <button
                  className="button button-secondary"
                  onClick={() => handleDeleteBusiness(business.id, business.name)}
                  disabled={loading}
                  style={{ background: '#dc3545', color: 'white' }}
                >
                  Delete
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

