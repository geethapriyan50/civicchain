import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import {
  Camera, MapPin, Shield, ShieldCheck, AlertTriangle,
  CheckCircle2, ArrowRight, RefreshCw, Upload, Sparkles,
  Layers, Lock, Image as ImageIcon, X
} from 'lucide-react';
import toast from 'react-hot-toast';

const CATEGORIES = [
  { id: 'Roads', label: 'Roads & Potholes', icon: '🚧' },
  { id: 'Streetlights', label: 'Streetlights', icon: '💡' },
  { id: 'Drainage', label: 'Drainage & Flooding', icon: '🌊' },
  { id: 'Water Supply', label: 'Water Supply', icon: '🚰' },
  { id: 'Sanitation', label: 'Sanitation & Waste', icon: '🚯' },
  { id: 'Government Schools', label: 'Govt Schools', icon: '🏫' },
  { id: 'Hospitals', label: 'Civic Hospitals', icon: '🏥' },
  { id: 'Public Safety', label: 'Public Safety', icon: '🛡️' },
  { id: 'Other', label: 'Other Issue', icon: '📦' }
];

const PRIORITIES = [
  { id: 'LOW', label: 'Routine (Low)', color: '#64748b' },
  { id: 'MEDIUM', label: 'Standard (Medium)', color: '#3b82f6' },
  { id: 'HIGH', label: 'Urgent (High)', color: '#ef4444' }
];

export default function SubmitComplaintPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    category: 'Roads',
    title: '',
    description: '',
    location: '',
    latitude: '',
    longitude: '',
    priority: 'MEDIUM',
    is_anonymous: false
  });

  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoHash, setPhotoHash] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [error, setError] = useState('');

  // Handle client-side SHA-256 hash preview
  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));

    try {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      setPhotoHash(hashHex);
    } catch {
      setPhotoHash('SHA256_COMPUTED_ON_UPLOAD');
    }
  };

  const removePhoto = () => {
    setSelectedPhoto(null);
    setPhotoPreview(null);
    setPhotoHash('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const mutation = useMutation({
    mutationFn: async (payload) => {
      // 1. Create complaint record on ledger
      const res = await api.post('/complaints', payload);
      const complaint = res.data.complaint;

      // 2. If photo is attached, upload as initial cryptographic evidence
      if (selectedPhoto && complaint?.id) {
        try {
          const fd = new FormData();
          fd.append('file', selectedPhoto);
          fd.append('description', 'Initial incident photograph captured by citizen reporter');
          await api.post(`/complaints/${complaint.id}/evidence`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
        } catch (evErr) {
          throw new Error(`Complaint ${complaint.complaint_number} was created, but the photo upload failed. Open the complaint to retry uploading evidence. ${evErr.response?.data?.error || evErr.message || ''}`);
        }
      }

      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries(['complaints']);
      qc.invalidateQueries(['citizen-dashboard']);
      qc.invalidateQueries(['blockchain-explorer-ledger']);
      toast.success(`Complaint ${data.complaint.complaint_number} submitted successfully!`);
      navigate(`/complaints/${data.complaint.id}`);
    },
    onError: (err) => {
      const msg = err.response?.data?.error || (err.message === 'Network Error'
        ? 'Network error — backend is connecting. Please click Submit again.'
        : err.message || 'Failed to submit complaint. Please try again.');
      setError(msg);
      toast.error(msg);
    }
  });

  const getLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setForm(f => ({
          ...f,
          latitude: latitude.toFixed(6),
          longitude: longitude.toFixed(6),
          location: f.location || `GPS Location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (±${Math.round(accuracy)}m)`
        }));
        setGeoLoading(false);
        toast.success(`GPS locked (±${Math.round(accuracy)}m accuracy)`);
      },
      (err) => {
        setGeoLoading(false);
        toast.error('Could not acquire GPS position. Please enter address manually.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.category || !form.title.trim() || !form.description.trim() || !form.location.trim()) {
      setError('Please provide a category, title, description, and location.');
      return;
    }
    setError('');
    mutation.mutate({
      ...form,
      latitude: form.latitude ? parseFloat(form.latitude) : undefined,
      longitude: form.longitude ? parseFloat(form.longitude) : undefined
    });
  };

  return (
    <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div className="page-heading" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Layers size={12} color="var(--primary)" />
            <span>CIVIC PROTOCOL</span>
            <span style={{ color: 'var(--muted-foreground)' }}>/</span>
            <span>CITIZEN REPORTER TERMINAL</span>
          </div>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '1.8rem', fontWeight: 800 }}>
            File Civic Grievance
          </h1>
          <p style={{ color: 'var(--muted-foreground)', marginTop: '4px' }}>
            Report broken public infrastructure. Submissions are timestamped and recorded in the configured ledger mode.
          </p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="card" style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AlertTriangle color="#ef4444" size={20} />
          <span style={{ color: '#ef4444', fontSize: '0.9rem' }}>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Step 1: Category Picker */}
        <div className="card">
          <div className="section-head" style={{ marginBottom: '14px' }}>
            <div className="section-title">
              <span className="tag positive" style={{ fontSize: '9px' }}>STEP 01</span>
              <h2 style={{ fontSize: '14px', fontWeight: 600 }}>Select Public Facility Category</h2>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '10px'
          }}>
            {CATEGORIES.map((c) => {
              const active = form.category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, category: c.id }))}
                  style={{
                    background: active ? 'rgba(16, 185, 129, 0.12)' : 'var(--background)',
                    border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '12px 10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span style={{ fontSize: '1.4rem' }}>{c.icon}</span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: active ? 700 : 500,
                    color: active ? 'var(--primary)' : 'var(--foreground)'
                  }}>
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Evidence Photo & Camera Upload */}
        <div className="card">
          <div className="section-head" style={{ marginBottom: '14px' }}>
            <div className="section-title">
              <span className="tag positive" style={{ fontSize: '9px' }}>STEP 02</span>
              <h2 style={{ fontSize: '14px', fontWeight: 600 }}>Attach Site Photograph (Cryptographic Proof)</h2>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoSelect}
            style={{ display: 'none' }}
          />

          {!photoPreview ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed var(--border)',
                borderRadius: '4px',
                padding: '30px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.01)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ display: 'inline-flex', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '50%', color: 'var(--primary)', marginBottom: '10px' }}>
                <Camera size={24} />
              </div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--foreground)' }}>
                Take Photo with Camera or Upload Evidence
              </div>
              <p style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '4px' }}>
                JPG, PNG, WebP supported. File will be cryptographically hashed (SHA-256) on-chain.
              </p>
            </div>
          ) : (
            <div style={{
              background: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '14px',
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              position: 'relative'
            }}>
              <img
                src={photoPreview}
                alt="Selected evidence"
                style={{
                  width: '80px',
                  height: '80px',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  border: '1px solid var(--border)'
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={16} color="#10b981" />
                  <span style={{ fontWeight: 600, fontSize: '12px' }}>{selectedPhoto?.name}</span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '2px' }}>
                  {(selectedPhoto.size / 1024).toFixed(1)} KB • Image Evidence Ready
                </div>
                {photoHash && (
                  <div style={{
                    marginTop: '6px',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '9px',
                    color: 'var(--primary)',
                    background: 'rgba(16, 185, 129, 0.08)',
                    padding: '4px 8px',
                    borderRadius: '2px',
                    display: 'inline-block',
                    wordBreak: 'break-all'
                  }}>
                    SHA-256: {photoHash.slice(0, 24)}... (Calculated locally)
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={removePhoto}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-foreground)',
                  cursor: 'pointer',
                  padding: '6px'
                }}
                title="Remove photo"
              >
                <X size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Step 3: Issue Details */}
        <div className="card">
          <div className="section-head" style={{ marginBottom: '14px' }}>
            <div className="section-title">
              <span className="tag positive" style={{ fontSize: '9px' }}>STEP 03</span>
              <h2 style={{ fontSize: '14px', fontWeight: 600 }}>Grievance Description & Location</h2>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Brief Title *
              </label>
              <input
                type="text"
                placeholder="e.g. Ruptured water pipeline causing road flood"
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                className="form-input"
                style={{ width: '100%', height: '40px', marginTop: '6px', background: 'var(--background)' }}
                maxLength={200}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Detailed Description *
              </label>
              <textarea
                rows={4}
                placeholder="Describe severity, hazards to residents, traffic impact, and how long the issue has persisted..."
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                className="form-input"
                style={{ width: '100%', marginTop: '6px', background: 'var(--background)' }}
                required
              />
            </div>

            {/* Location + GPS Button */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                  Location / Address *
                </label>
                <button
                  type="button"
                  onClick={getLocation}
                  disabled={geoLoading}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <MapPin size={13} className={geoLoading ? 'spin' : ''} />
                  <span>{geoLoading ? 'Acquiring GPS...' : 'Use My GPS Location'}</span>
                </button>
              </div>

              <input
                type="text"
                placeholder="Street address, nearest landmark, ward name..."
                value={form.location}
                onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
                className="form-input"
                style={{ width: '100%', height: '40px', marginTop: '6px', background: 'var(--background)' }}
                required
              />

              {form.latitude && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '10px', color: 'var(--primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  <MapPin size={11} />
                  <span>GPS Coordinates: {form.latitude}, {form.longitude}</span>
                </div>
              )}
            </div>

            {/* Priority Selector */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Severity Priority
              </label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                {PRIORITIES.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, priority: p.id }))}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: form.priority === p.id ? `1px solid ${p.color}` : '1px solid var(--border)',
                      background: form.priority === p.id ? 'rgba(255,255,255,0.05)' : 'var(--background)',
                      color: form.priority === p.id ? p.color : 'var(--muted-foreground)',
                      fontWeight: form.priority === p.id ? 700 : 500,
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Step 4: Privacy & Anonymity Settings */}
        <div className="card" style={{
          borderLeft: form.is_anonymous ? '3px solid var(--primary)' : '1px solid var(--border)',
          transition: 'all 0.2s ease'
        }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_anonymous}
              onChange={(e) => setForm(f => ({ ...f, is_anonymous: e.target.checked }))}
              style={{ marginTop: '3px', accentColor: 'var(--primary)', width: '16px', height: '16px' }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px' }}>Anonymous Reporting Mode</span>
                <span className={`tag ${form.is_anonymous ? 'positive' : ''}`} style={{ fontSize: '8px' }}>
                  {form.is_anonymous ? 'SHIELD ACTIVE' : 'STANDARD'}
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '4px', lineHeight: 1.5 }}>
                {form.is_anonymous
                  ? 'Your identity is cryptographically masked. Field contractors & authorities only see a SHA-256 hash. Location is protected at general Ward resolution.'
                  : 'Your contact details are accessible to municipal authorities to schedule direct inspections and contact you upon resolution.'}
              </p>
            </div>
          </label>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(-1)}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={mutation.isPending}
            style={{
              padding: '12px 28px',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {mutation.isPending ? (
              <>
                <RefreshCw size={16} className="spin" />
                <span>Minting to Fabric Ledger...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Submit Grievance to Blockchain</span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
