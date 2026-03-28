'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export default function CollaborationPanel({
  tripId,
  trip,
  days,
  activities,
  collaborators = [],
  onlineUsers = [],
  onRefresh,
}) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviting, setInviting] = useState(false);
  const toast = useToast();

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch('/api/collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId,
          email: inviteEmail,
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${inviteEmail} has been invited!`, 'Collaborator Added');
      setInviteEmail('');
      setShowInviteModal(false);
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveCollaborator = async (collaboratorId) => {
    if (!confirm('Remove this collaborator?')) return;
    try {
      await fetch(`/api/collaborators?id=${collaboratorId}`, { method: 'DELETE' });
      toast.success('Collaborator removed');
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleExportPDF = async () => {
    const { exportTripToPDF } = await import('@/lib/exportUtils');
    exportTripToPDF(trip, days, activities);
    toast.success('PDF downloading...', 'Export');
    setShowExportMenu(false);
  };

  const handleExportCalendar = async () => {
    const { exportTripToCalendar } = await import('@/lib/exportUtils');
    exportTripToCalendar(trip, days, activities);
    toast.success('Calendar file downloading...', 'Export');
    setShowExportMenu(false);
  };

  const handleShare = async () => {
    const { generateShareLink } = await import('@/lib/exportUtils');
    const link = generateShareLink(tripId);
    await navigator.clipboard.writeText(link);
    toast.success('Link copied to clipboard!', 'Share');
    setShowExportMenu(false);
  };

  return (
    <>
      <div className="collab-panel">
        {/* Online Users */}
        {onlineUsers.length > 0 && (
          <div className="collab-panel__presence">
            {onlineUsers.slice(0, 5).map((user, i) => (
              <div
                key={user.user_id}
                className="presence-avatar"
                title={user.display_name || user.email}
                style={{
                  zIndex: 5 - i,
                  marginLeft: i > 0 ? '-8px' : 0,
                  background: `hsl(${(user.display_name?.charCodeAt(0) || 0) * 40 % 360}, 60%, 50%)`,
                }}
              >
                {(user.display_name || user.email || 'U')[0].toUpperCase()}
                <span className="presence-avatar__dot" />
              </div>
            ))}
            {onlineUsers.length > 5 && (
              <span className="presence-more">+{onlineUsers.length - 5}</span>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="collab-panel__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowInviteModal(true)}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>}
          >
            Invite
          </Button>

          <div className="export-wrapper">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowExportMenu(!showExportMenu)}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
            >
              Export
            </Button>

            {showExportMenu && (
              <div className="export-menu">
                <button className="export-menu__item" onClick={handleExportPDF}>
                  <span>📄</span> PDF Itinerary
                </button>
                <button className="export-menu__item" onClick={handleExportCalendar}>
                  <span>📅</span> Google Calendar (.ics)
                </button>
                <button className="export-menu__item" onClick={handleShare}>
                  <span>🔗</span> Copy Share Link
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invite Collaborator"
      >
        <div className="invite-form">
          <p className="invite-form__desc">
            Invite someone to plan this trip together. They&apos;ll see real-time changes.
          </p>

          <Input
            label="Email Address"
            type="email"
            placeholder="friend@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
          />

          <div>
            <label className="invite-form__label">Role</label>
            <div className="invite-form__roles">
              <button
                className={`role-btn ${inviteRole === 'editor' ? 'role-btn--selected' : ''}`}
                onClick={() => setInviteRole('editor')}
              >
                <strong>✏️ Editor</strong>
                <span>Can add, edit, and remove activities</span>
              </button>
              <button
                className={`role-btn ${inviteRole === 'viewer' ? 'role-btn--selected' : ''}`}
                onClick={() => setInviteRole('viewer')}
              >
                <strong>👁️ Viewer</strong>
                <span>Can only view the itinerary</span>
              </button>
            </div>
          </div>

          {/* Current collaborators */}
          {collaborators.length > 0 && (
            <div>
              <label className="invite-form__label">Current Collaborators</label>
              <div className="invite-form__list">
                {collaborators.map((c) => (
                  <div key={c.id} className="collab-item">
                    <div className="collab-item__avatar" style={{
                      background: `hsl(${(c.display_name?.charCodeAt(0) || 0) * 40 % 360}, 60%, 50%)`
                    }}>
                      {(c.display_name || c.email || 'U')[0].toUpperCase()}
                    </div>
                    <div className="collab-item__info">
                      <span className="collab-item__name">{c.display_name || c.email}</span>
                      <span className="collab-item__role">{c.role}</span>
                    </div>
                    <button
                      className="collab-item__remove"
                      onClick={() => handleRemoveCollaborator(c.id)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="invite-form__actions">
            <Button variant="ghost" onClick={() => setShowInviteModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleInvite}
              loading={inviting}
              disabled={!inviteEmail.trim() || inviting}
            >
              Send Invite
            </Button>
          </div>
        </div>
      </Modal>

      <style jsx>{`
        .collab-panel {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .collab-panel__presence {
          display: flex;
          align-items: center;
        }

        .presence-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          color: white;
          font-size: 13px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid var(--color-bg);
          position: relative;
          cursor: default;
        }

        .presence-avatar__dot {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22C55E;
          border: 2px solid var(--color-bg);
        }

        .presence-more {
          margin-left: var(--space-1);
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
          font-weight: 600;
        }

        .collab-panel__actions {
          display: flex;
          gap: var(--space-1);
        }

        .export-wrapper {
          position: relative;
        }

        .export-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          min-width: 200px;
          z-index: 50;
          overflow: hidden;
        }

        .export-menu__item {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          width: 100%;
          padding: var(--space-3) var(--space-4);
          border: none;
          background: none;
          font-family: var(--font-body);
          font-size: var(--text-sm);
          color: var(--color-text);
          cursor: pointer;
          transition: background var(--transition-fast);
          text-align: left;
        }

        .export-menu__item:hover {
          background: var(--color-bg-secondary);
        }

        /* Invite Form */
        .invite-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .invite-form__desc {
          font-size: var(--text-sm);
          color: var(--color-text-secondary);
        }

        .invite-form__label {
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-text);
          display: block;
          margin-bottom: var(--space-2);
        }

        .invite-form__roles {
          display: flex;
          gap: var(--space-2);
        }

        .role-btn {
          flex: 1;
          padding: var(--space-3);
          border: 2px solid var(--color-border-light);
          border-radius: var(--radius-md);
          background: var(--color-surface);
          font-family: var(--font-body);
          cursor: pointer;
          text-align: left;
          transition: all var(--transition-fast);
        }

        .role-btn:hover {
          border-color: var(--color-primary-light);
        }

        .role-btn--selected {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.05);
        }

        .role-btn strong {
          display: block;
          font-size: var(--text-sm);
          margin-bottom: 2px;
        }

        .role-btn span {
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
        }

        .invite-form__list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .collab-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
        }

        .collab-item__avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          color: white;
          font-size: 12px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .collab-item__info {
          flex: 1;
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .collab-item__name {
          font-size: var(--text-sm);
          font-weight: 500;
        }

        .collab-item__role {
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
          text-transform: capitalize;
        }

        .collab-item__remove {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: none;
          background: none;
          color: var(--color-text-tertiary);
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .collab-item__remove:hover {
          background: var(--color-error-bg);
          color: var(--color-error);
        }

        .invite-form__actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--space-3);
        }
      `}</style>
    </>
  );
}
