import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogIn, Eye, EyeOff, ShieldCheck, Lock, RefreshCw, CheckCircle2, AlertCircle, ShieldAlert, Cpu } from 'lucide-react';
import toast from 'react-hot-toast';
import { getApiBaseUrl, setApiBaseUrl, testConnection, isNativePlatform } from '../services/api';

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Masked Server connection state
  const [showAdvancedNetwork, setShowAdvancedNetwork] = useState(false);
  const [selectedNode, setSelectedNode] = useState('auto');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [testStatus, setTestStatus] = useState({ loading: false, result: null });

  const { login } = useAuth();
  const navigate = useNavigate();

  // Test connection on mount
  useEffect(() => {
    const runInitialCheck = async () => {
      setTestStatus({ loading: true, result: null });
      const res = await testConnection();
      setTestStatus({ loading: false, result: res });
    };
    runInitialCheck();
  }, []);

  const handleTestConnection = async (url) => {
    setTestStatus({ loading: true, result: null });
    const res = await testConnection(url);
    setTestStatus({ loading: false, result: res });
    if (res.ok) {
      toast.success('Secure connection established');
    } else {
      toast.error('Network node currently unreachable');
    }
  };

  const handleSelectNetworkNode = (nodeType, url) => {
    setSelectedNode(nodeType);
    setApiBaseUrl(url);
    handleTestConnection(url);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Basic client-side sanitization
    const cleanEmail = form.email.trim().toLowerCase();
    const cleanPassword = form.password;

    try {
      const data = await login(cleanEmail, cleanPassword);
      toast.success(`Welcome back, ${data.user.name}!`);
      navigate('/dashboard');
    } catch (err) {
      console.error('Login error');
      if (!err.response) {
        setError('Unable to establish secure connection with CivicChain Gateway. Please check your internet connection or switch network node below.');
      } else {
        setError(err.response?.data?.error || 'Invalid credentials. Please verify your email and password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (email, pw) => setForm({ email, password: pw });

  return (
    <div className="auth-page">
      <div className="auth-card fade-in">
        <div className="auth-logo">
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)', marginBottom: 12 }}>
            <ShieldCheck size={28} color="var(--primary)" />
          </div>
          <h1>CivicChain</h1>
          <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '0.85rem' }}>
            <Lock size={12} /> Privacy-Preserving Civic Grievance Portal
          </p>
        </div>

        {/* Security & Masked Network Status Banner */}
        <div style={{
          marginBottom: 16,
          padding: '10px 14px',
          borderRadius: 10,
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: testStatus.result?.ok
            ? 'rgba(16, 185, 129, 0.08)'
            : (testStatus.loading ? 'rgba(59, 130, 246, 0.08)' : 'rgba(239, 68, 68, 0.08)'),
          border: `1px solid ${
            testStatus.result?.ok
              ? 'rgba(16, 185, 129, 0.25)'
              : (testStatus.loading ? 'rgba(59, 130, 246, 0.25)' : 'rgba(239, 68, 68, 0.25)')
          }`,
          color: testStatus.result?.ok
            ? '#34d399'
            : (testStatus.loading ? '#60a5fa' : '#f87171')
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {testStatus.loading ? (
              <RefreshCw size={14} className="spin" />
            ) : testStatus.result?.ok ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertCircle size={15} />
            )}
            <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>
              {testStatus.loading
                ? 'Connecting to Render Cloud (~20s if waking up)...'
                : testStatus.result?.ok
                ? `Gateway Online (${testStatus.result.latency || 0}ms)`
                : 'Server Sleeping / Tap to Wake'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedNetwork(!showAdvancedNetwork)}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: '0.72rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <Cpu size={12} /> {showAdvancedNetwork ? 'Hide' : 'Server Route'}
          </button>
        </div>

        {/* Masked Network Route Selector */}
        {showAdvancedNetwork && (
          <div style={{
            marginBottom: 20,
            padding: 14,
            borderRadius: 'var(--radius)',
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid var(--border)',
            fontSize: '0.8rem'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)' }}>
              <Lock size={13} color="var(--primary)" /> Gateway Route Options
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => handleSelectNetworkNode('render', 'https://civicchain-8b15.onrender.com/api')}
                style={{
                  background: 'rgba(0, 210, 106, 0.12)',
                  border: '1px solid rgba(0, 210, 106, 0.4)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: '0.78rem',
                  color: '#ffffff',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                ☁️ <strong>Live Render Cloud Gateway (Recommended)</strong><br/>
                <span style={{ color: '#00D26A', fontSize: '0.7rem' }}>https://civicchain-8b15.onrender.com/api</span>
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => handleSelectNetworkNode('local', 'http://192.168.29.19:5000/api')}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px',
                    fontSize: '0.72rem',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  📶 <strong>Local Wi-Fi</strong><br/>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>192.168.x:5000</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTestConnection()}
                  disabled={testStatus.loading}
                  style={{
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: 6,
                    padding: '8px',
                    fontSize: '0.74rem',
                    color: '#60a5fa',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4
                  }}
                >
                  <RefreshCw size={12} className={testStatus.loading ? 'spin' : ''} />
                  Ping Server
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              className="form-input"
              type="email"
              placeholder="name@organization.gov"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
              autoFocus
              maxLength={80}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input"
                type={showPw ? 'text' : 'password'}
                placeholder="Enter account password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                maxLength={64}
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)' }}
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? <><div className="loading-spinner" style={{width:16,height:16}} /> Verifying Identity...</> : <><LogIn size={18} /> Sign In Securely</>}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Don't have an account? <Link to="/register" style={{ color: 'var(--primary-light)', fontWeight: 600 }}>Register Citizen Account</Link>
        </p>

        {/* Quick login shortcuts for authorized roles */}
        <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={11} /> Authorized Role Quick Access
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { role: 'Citizen', email: 'citizen@example.com', pw: 'Citizen@123' },
              { role: 'Authority', email: 'authority@civicchain.gov', pw: 'Authority@123' },
              { role: 'Investigator', email: 'investigator@civicchain.gov', pw: 'Investigator@123' },
              { role: 'Verifier', email: 'verifier@civicchain.gov', pw: 'Verifier@123' },
              { role: 'Admin', email: 'admin@civicchain.gov', pw: 'Admin@123' },
            ].map(({ role, email, pw }) => (
              <button
                key={role}
                type="button"
                onClick={() => quickLogin(email, pw)}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                onMouseOver={e => e.target.style.borderColor = 'rgba(16, 185, 129, 0.4)'}
                onMouseOut={e => e.target.style.borderColor = 'var(--border)'}
              >
                {role}
              </button>
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          🔒 Protected by SHA-256 State Hashing & Hyperledger Fabric
        </div>
      </div>
    </div>
  );
}
