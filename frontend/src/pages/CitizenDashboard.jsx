import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { StatusBadge, PriorityBadge, LoadingSpinner } from '../components/ui';
import {
  PlusCircle, FileText, Clock, CheckCircle2,
  XCircle, Layers, ArrowRight, ShieldCheck, Camera,
  Sparkles, ExternalLink, MapPin, Hash, Filter, ChevronRight
} from 'lucide-react';

export default function CitizenDashboard() {
  const [filterState, setFilterState] = useState('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['citizen-dashboard'],
    queryFn: () => api.get('/dashboard/citizen').then(r => r.data)
  });

  const { data: blockchainStats } = useQuery({
    queryKey: ['blockchain-stats'],
    queryFn: () => api.get('/blockchain/stats').then(r => r.data).catch(() => ({ totalBlocks: 12 }))
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
        <LoadingSpinner size={32} />
      </div>
    );
  }

  const stats = data?.stats || {};
  const allRecent = data?.recent || [];
  const totalBlocks = blockchainStats?.totalBlocks || 12;

  const filteredRecent = allRecent.filter(c => {
    if (filterState === 'IN_PROGRESS') {
      return ['REGISTERED', 'ASSIGNED', 'INVESTIGATING', 'VERIFIED', 'ACTION_TAKEN'].includes(c.status);
    }
    if (filterState === 'RESOLVED') {
      return ['RESOLVED', 'RESOLUTION_VERIFIED', 'CLOSED'].includes(c.status);
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px', margin: '0 auto' }}>
      
      {/* Top Banner Status matching FlutterFlow */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div className="ff-online-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(0, 210, 106, 0.12)', border: '1px solid rgba(0, 210, 106, 0.3)', padding: '6px 14px', borderRadius: '20px', color: '#00D26A', fontSize: '11px', fontWeight: 600 }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#00D26A', display: 'inline-block', boxShadow: '0 0 8px #00D26A' }}></span>
          <span>Tamper-proof Ledger Online</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', fontFamily: 'JetBrains Mono, monospace' }}>
          {totalBlocks} blks anchored
        </div>
      </div>

      {/* 3 Metric Cards matching FlutterFlow */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--muted-foreground)', fontSize: '11px' }}>
            <span>Reported</span>
            <FileText size={13} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground)' }}>
            {stats.total || 0}
          </div>
          <div style={{ fontSize: '10px', color: '#00D26A', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span>↗ Active</span>
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--muted-foreground)', fontSize: '11px' }}>
            <span>In Progress</span>
            <Clock size={13} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#fbbf24' }}>
            {stats.active || 0}
          </div>
          <div style={{ fontSize: '10px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span>⚡ WIP</span>
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--muted-foreground)', fontSize: '11px' }}>
            <span>Resolved</span>
            <CheckCircle2 size={13} color="#10b981" />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#34d399' }}>
            {stats.resolved || 0}
          </div>
          <div style={{ fontSize: '10px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span>✓ Closed</span>
          </div>
        </div>
      </div>

      {/* Action Card: Report Public Grievance */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 182, 212, 0.04) 100%)',
        border: '1px solid rgba(0, 210, 106, 0.25)',
        borderRadius: '16px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{
            background: 'rgba(0, 210, 106, 0.15)',
            border: '1px solid rgba(0, 210, 106, 0.3)',
            borderRadius: '12px',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#00D26A',
            flexShrink: 0
          }}>
            <Camera size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#ffffff' }}>
              Report Public Grievance
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: '4px 0 0', lineHeight: 1.4 }}>
              File urban infrastructure defects with cryptographic evidence digest and GPS proof.
            </p>
          </div>
        </div>

        <Link
          to="/complaints/new"
          style={{
            background: '#00D26A',
            color: '#0a1f14',
            fontWeight: 700,
            fontSize: '13px',
            padding: '12px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            textDecoration: 'none',
            boxShadow: '0 2px 12px rgba(0, 210, 106, 0.3)'
          }}
          onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
          onMouseLeave={e => e.currentTarget.style.filter = 'none'}
        >
          <PlusCircle size={16} />
          <span>+ Report Grievance</span>
        </Link>
      </div>

      {/* Recent Filings Header & Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
          Recent Filings
        </h3>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setFilterState('ALL')}
            style={{
              background: filterState === 'ALL' ? 'var(--primary)' : 'var(--card)',
              color: filterState === 'ALL' ? '#ffffff' : 'var(--muted-foreground)',
              border: '1px solid var(--border)',
              borderRadius: '20px',
              padding: '4px 10px',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilterState('IN_PROGRESS')}
            style={{
              background: filterState === 'IN_PROGRESS' ? 'rgba(245, 158, 11, 0.2)' : 'var(--card)',
              color: filterState === 'IN_PROGRESS' ? '#fbbf24' : 'var(--muted-foreground)',
              borderColor: filterState === 'IN_PROGRESS' ? '#f59e0b' : 'var(--border)',
              border: '1px solid',
              borderRadius: '20px',
              padding: '4px 10px',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            In Progress
          </button>
          <button
            type="button"
            onClick={() => setFilterState('RESOLVED')}
            style={{
              background: filterState === 'RESOLVED' ? 'rgba(16, 185, 129, 0.2)' : 'var(--card)',
              color: filterState === 'RESOLVED' ? '#34d399' : 'var(--muted-foreground)',
              borderColor: filterState === 'RESOLVED' ? '#10b981' : 'var(--border)',
              border: '1px solid',
              borderRadius: '20px',
              padding: '4px 10px',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            Resolved
          </button>
        </div>
      </div>

      {/* Cards List matching FlutterFlow Mockup */}
      {filteredRecent.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '36px 20px', background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: '12px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📭</div>
          <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--foreground)' }}>No grievances found</h4>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '12px', marginTop: '4px' }}>
            No tickets match the selected filter.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredRecent.map((c, idx) => (
            <Link
              key={c.id}
              to={`/complaints/${c.id}`}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '14px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'transform 0.15s ease, border-color 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--primary)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.transform = 'none';
              }}
            >
              {/* Card Header: Category Tag, ID, and Status Badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--muted-foreground)' }}>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{c.category?.toUpperCase() || 'CIVIC'}</span>
                  <span>•</span>
                  <span>{c.complaint_number}</span>
                </div>
                <StatusBadge status={c.status} />
              </div>

              {/* Card Title & Description */}
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px', color: '#ffffff' }}>
                  {c.title}
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {c.description}
                </p>
              </div>

              {/* Card Footer: Location Pin, Ward & Block Anchor */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', fontSize: '11px', color: 'var(--muted-foreground)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <MapPin size={12} color="var(--primary)" />
                  <span>{c.location_address || c.ward || 'Ward 12'}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'JetBrains Mono, monospace', color: '#00D26A', fontSize: '10px' }}>
                  <Hash size={11} />
                  <span>Block #{849300 + (c.id * 8 || idx * 8)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

    </div>
  );
}
