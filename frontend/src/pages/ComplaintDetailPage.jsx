import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getApiBaseUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, PriorityBadge, LoadingSpinner, InfoRow } from '../components/ui';
import { Upload, CheckCircle, AlertTriangle, Shield, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const ACTION_CONFIG = {
  REPORTED:             { action: 'register',           label: 'Register Complaint',       roles: ['AUTHORITY','ADMIN'], color: '#6366f1' },
  REGISTERED:           { action: 'assign',             label: 'Assign to Officer',         roles: ['AUTHORITY','ADMIN'], color: '#f59e0b', needsAssign: true },
  ASSIGNED:             { action: 'investigate',         label: 'Start Investigation',       roles: ['INVESTIGATOR','AUTHORITY','ADMIN'], color: '#06b6d4' },
  INVESTIGATING:        { action: 'verify',              label: 'Verify Investigation',      roles: ['VERIFIER','ADMIN'], color: '#3b82f6' },
  VERIFIED:             { action: 'action',              label: 'Mark Action Taken',         roles: ['AUTHORITY','ADMIN'], color: '#a855f7' },
  ACTION_TAKEN:         { action: 'resolve',             label: 'Mark as Resolved',          roles: ['AUTHORITY','INVESTIGATOR','ADMIN'], needsResolution: true, color: '#10b981' },
  RESOLVED:             { action: 'verify-resolution',   label: 'Verify Resolution',         roles: ['VERIFIER','CITIZEN','ADMIN'], color: '#10b981' },
  RESOLUTION_VERIFIED:  { action: 'close',               label: 'Close Complaint',           roles: ['ADMIN','AUTHORITY'], color: '#64748b' },
};

export default function ComplaintDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef();

  const [notes, setNotes] = useState('');
  const [resolutionDetails, setResolutionDetails] = useState('');
  const [verificationDetails, setVerificationDetails] = useState('');
  const [assignOfficerId, setAssignOfficerId] = useState('');
  const [assignDept, setAssignDept] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [rating, setRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['complaint', id],
    queryFn: () => api.get(`/complaints/${id}`).then(r => r.data)
  });

  const { data: histData } = useQuery({
    queryKey: ['complaint-history', id],
    queryFn: () => api.get(`/complaints/${id}/history`).then(r => r.data),
    enabled: showHistory
  });

  const { data: officersData } = useQuery({
    queryKey: ['officers'],
    queryFn: () => api.get('/users/officers').then(r => r.data),
    enabled: ['AUTHORITY','ADMIN'].includes(user.role)
  });

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><LoadingSpinner size={32} /></div>;
  if (error) return <div className="alert alert-error">Failed to load complaint</div>;

  const { complaint, evidence, timeline, feedback } = data || {};
  if (!complaint) return null;

  const actionConfig = ACTION_CONFIG[complaint.status];
  const canAct = actionConfig && actionConfig.roles.includes(user.role);

  const handleAction = async () => {
    if (!actionConfig) return;
    setActionLoading(true);
    try {
      const payload = { notes };
      if (actionConfig.action === 'assign') {
        if (!assignOfficerId || !assignDept) { toast.error('Please select an officer and department'); setActionLoading(false); return; }
        payload.officer_id = assignOfficerId;
        payload.department = assignDept;
      }
      if (actionConfig.needsResolution) payload.resolution_details = resolutionDetails;
      if (actionConfig.action === 'verify') payload.verification_details = verificationDetails;

      await api.put(`/complaints/${id}/${actionConfig.action}`, payload);
      toast.success(`✅ ${actionConfig.label} successful!`);
      qc.invalidateQueries(['complaint', id]);
      qc.invalidateQueries(['complaints']);
      qc.invalidateQueries(['citizen-dashboard']);
      qc.invalidateQueries(['authority-dashboard']);
      qc.invalidateQueries(['admin-dashboard']);
      setNotes(''); setResolutionDetails(''); setVerificationDetails('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) { toast.error('Select a file first'); return; }
    setUploadLoading(true);
    const fd = new FormData();
    fd.append('file', uploadFile);
    if (uploadDesc) fd.append('description', uploadDesc);
    try {
      const { data: ev } = await api.post(`/complaints/${id}/evidence`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success('Evidence uploaded! SHA-256: ' + ev.evidence.sha256_hash.slice(0, 16) + '...');
      qc.invalidateQueries(['complaint', id]);
      setUploadFile(null); setUploadDesc('');
      fileRef.current.value = '';
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };

  const verifyEvidence = async (evidenceId) => {
    try {
      const { data } = await api.get(`/evidence/${evidenceId}/verify`);
      if (data.isIntact) {
        toast.success('✅ Evidence integrity verified — not tampered');
      } else {
        toast.error('❌ Hash mismatch — possible tampering detected!');
      }
    } catch { toast.error('Verification failed'); }
  };

  const handleFeedback = async () => {
    if (!feedbackComment.trim()) {
      toast.error('Please enter a feedback comment');
      return;
    }
    setFeedbackLoading(true);
    try {
      await api.post(`/complaints/${id}/feedback`, { rating, comments: feedbackComment });
      toast.success('Feedback & Rating recorded on the blockchain ledger!');
      qc.invalidateQueries(['complaint', id]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit feedback');
    } finally {
      setFeedbackLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.3rem' }}>{complaint.title}</h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <span className="font-mono" style={{ fontSize: '0.82rem', color: 'var(--accent)' }}>{complaint.complaint_number}</span>
            <StatusBadge status={complaint.status} />
            <PriorityBadge priority={complaint.priority} />
            {complaint.is_anonymous ? <span className="badge" style={{ background: 'rgba(100,116,139,0.15)', color: '#94a3b8' }}>Anonymous</span> : null}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Back</button>
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        {/* Main info */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title">Complaint Details</div>
            <InfoRow label="Category" value={complaint.category} />
            <InfoRow label="Description" value={<span style={{ lineHeight: 1.7, color: 'var(--text-primary)' }}>{complaint.description}</span>} />
            <InfoRow label="Location" value={complaint.location} />
            {complaint.latitude && <InfoRow label="Coordinates" value={<span className="font-mono" style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>{complaint.latitude}, {complaint.longitude}</span>} />}
            {complaint.assigned_department && <InfoRow label="Assigned Department" value={complaint.assigned_department} />}
            {complaint.officer_name && <InfoRow label="Assigned Officer" value={complaint.officer_name} />}
            {complaint.investigator_name && <InfoRow label="Investigator" value={complaint.investigator_name} />}
            {complaint.resolution_details && <InfoRow label="Resolution" value={complaint.resolution_details} />}
            <InfoRow label="Submitted" value={format(new Date(complaint.created_at), 'dd MMM yyyy HH:mm')} />
            <InfoRow label="Last Updated" value={format(new Date(complaint.updated_at), 'dd MMM yyyy HH:mm')} />
            {complaint.blockchain_tx_id && (
              <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 700, marginBottom: 4 }}>⛓ Cryptographic Ledger Transaction</div>
                <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--primary)', wordBreak: 'break-all' }}>{complaint.blockchain_tx_id}</div>
              </div>
            )}
          </div>

          {/* Evidence */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-title">Evidence ({evidence?.length || 0})</div>
            {evidence?.map(ev => (
              <div key={ev.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{ev.original_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {ev.mime_type} • {(ev.file_size / 1024).toFixed(1)} KB • {ev.uploaded_by_name}
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.68rem', color: '#67e8f9', marginTop: 2 }}>
                      SHA256: {ev.sha256_hash?.slice(0, 32)}...
                    </div>
                    {ev.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{ev.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => verifyEvidence(ev.id)} title="Verify integrity">
                      <Shield size={14} /> Verify
                    </button>
                    {ev.mime_type?.startsWith('image/') && (
                      <a href={`${getApiBaseUrl().replace(/\/+$/, '').replace(/\/api$/, '')}/api/evidence/${ev.id}/file`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Upload */}
            <div style={{ marginTop: 16, padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Upload Evidence</div>
              <input ref={fileRef} type="file" onChange={e => setUploadFile(e.target.files[0])} style={{ fontSize: '0.85rem', marginBottom: 8, color: 'var(--text-secondary)' }}
                accept="image/*,video/*,.pdf,.doc,.docx" />
              <input className="form-input" placeholder="Description (optional)" value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} style={{ marginBottom: 8, fontSize: '0.85rem' }} />
              <button className="btn btn-primary btn-sm" onClick={handleUpload} disabled={!uploadFile || uploadLoading}>
                {uploadLoading ? <div className="loading-spinner" style={{width:14,height:14}} /> : <Upload size={14} />}
                {uploadLoading ? 'Uploading...' : 'Upload & Hash'}
              </button>
            </div>
          </div>
        </div>

        {/* Right column: action + timeline */}
        <div>
          {/* Action Panel */}
          {canAct && complaint.status !== 'CLOSED' && (
            <div className="card" style={{ marginBottom: 16, border: `1px solid ${actionConfig.color}30` }}>
              <div className="section-title" style={{ borderBottomColor: `${actionConfig.color}20` }}>
                🔧 Available Action
              </div>
              <div style={{ padding: '10px 14px', background: `${actionConfig.color}10`, borderRadius: 'var(--radius)', marginBottom: 14 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: actionConfig.color }}>{actionConfig.label}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Status: {complaint.status} → {ACTION_CONFIG[complaint.status]?.action?.toUpperCase().replace('-', '_')}
                </div>
              </div>

              {actionConfig.action === 'assign' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Assign Officer</label>
                    <select className="form-input" value={assignOfficerId} onChange={e => setAssignOfficerId(e.target.value)}>
                      <option value="">Select officer</option>
                      {officersData?.officers?.map(o => <option key={o.id} value={o.id}>{o.name} ({o.role})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Department</label>
                    <input className="form-input" placeholder="Department name" value={assignDept} onChange={e => setAssignDept(e.target.value)} />
                  </div>
                </>
              )}

              {actionConfig.action === 'verify' && (
                <div className="form-group">
                  <label className="form-label">Verification Details</label>
                  <textarea className="form-input" rows={3} placeholder="Describe your verification findings..." value={verificationDetails} onChange={e => setVerificationDetails(e.target.value)} />
                </div>
              )}

              {actionConfig.needsResolution && (
                <div className="form-group">
                  <label className="form-label">Resolution Details *</label>
                  <textarea className="form-input" rows={3} placeholder="Describe what actions were taken to resolve..." value={resolutionDetails} onChange={e => setResolutionDetails(e.target.value)} />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Notes (Optional)</label>
                <textarea className="form-input" rows={2} placeholder="Additional notes for the audit trail..." value={notes} onChange={e => setNotes(e.target.value)} />
              </div>

              <button className="btn btn-primary" onClick={handleAction} disabled={actionLoading} style={{ width: '100%', justifyContent: 'center' }}>
                {actionLoading ? <><div className="loading-spinner" style={{width:16,height:16}} /> Processing...</> : `⛓ ${actionConfig.label}`}
              </button>
            </div>
          )}

          {complaint.status === 'CLOSED' && (
            <div className="alert alert-success">✅ This complaint has been closed successfully.</div>
          )}

          {/* Citizen Feedback Display */}
          {feedback && (
            <div className="card" style={{ borderLeft: '4px solid #f59e0b', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fbbf24' }}>
                  Citizen Resolution Feedback
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <span key={star} style={{ color: star <= feedback.rating ? '#f59e0b' : '#475569', fontSize: '1.1rem' }}>
                      ★
                    </span>
                  ))}
                </div>
              </div>
              <p style={{ fontStyle: 'italic', color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '6px 0' }}>
                "{feedback.comments || 'No written comment provided'}"
              </p>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Submitted by Citizen</span>
                <span className="font-mono">TX: {feedback.blockchain_tx_id?.slice(0, 24)}...</span>
              </div>
            </div>
          )}

          {/* Citizen Feedback Submission Form */}
          {!feedback && ['RESOLVED', 'RESOLUTION_VERIFIED', 'CLOSED'].includes(complaint.status) && user.role === 'CITIZEN' && (
            <div className="card" style={{ border: '1px solid rgba(245, 158, 11, 0.3)', marginBottom: 16 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8, color: '#fbbf24' }}>
                ★ Rate Resolution Quality & Service
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                As the citizen who reported this grievance, your feedback will be anchored immutably to the blockchain ledger.
              </p>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Satisfaction Rating:</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setRating(num)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '1.4rem',
                        color: num <= rating ? '#f59e0b' : '#475569',
                        padding: 2
                      }}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b', marginLeft: 6 }}>
                  {rating} of 5 Stars
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Share feedback on repair quality, timeliness, or officer conduct..."
                  value={feedbackComment}
                  onChange={e => setFeedbackComment(e.target.value)}
                />
              </div>

              <button
                className="btn btn-primary"
                onClick={handleFeedback}
                disabled={feedbackLoading}
                style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)' }}
              >
                {feedbackLoading ? <LoadingSpinner size={16} /> : '⛓ Anchor Feedback to Blockchain'}
              </button>
            </div>
          )}

          {/* Timeline */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>Audit Timeline</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowHistory(s => !s)}>
                {showHistory ? 'Show Simple' : '⛓ Show Blockchain Records'}
              </button>
            </div>

            <div className="timeline">
              {timeline?.map((event, i) => (
                <div className="timeline-item" key={event.id}>
                  <div className={`timeline-dot ${i === timeline.length - 1 ? 'active' : ''}`} />
                  <div className="timeline-content">
                    <div className="timeline-date">{format(new Date(event.created_at), 'dd MMM yyyy HH:mm:ss')}</div>
                    <div className="timeline-status">{event.to_status?.replace('_', ' ')}</div>
                    <div className="timeline-actor">by {event.performer_name} ({event.performer_role})</div>
                    {event.notes && <div className="timeline-notes">"{event.notes}"</div>}
                    {event.blockchain_tx_id && event.blockchain_tx_id !== 'PENDING' && (
                      <div className="font-mono" style={{ fontSize: '0.68rem', color: '#67e8f9', marginTop: 6 }}>
                        TX: {event.blockchain_tx_id.slice(0, 50)}...
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {showHistory && histData?.blockchainRecords && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 10, color: '#67e8f9' }}>⛓ Blockchain Records</div>
                {histData.blockchainRecords.map(rec => (
                  <div key={rec.id} className="blockchain-record">
                    <div className="blockchain-record-header">
                      <span className="blockchain-label">{rec.event_type}</span>
                      <span>Block #{rec.block_number}</span>
                    </div>
                    <div>TX: {rec.tx_id}</div>
                    <div>Hash: {rec.payload_hash}</div>
                    <div style={{ opacity: 0.6 }}>{format(new Date(rec.timestamp), 'dd MMM yyyy HH:mm:ss')} [{rec.mode}]</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
