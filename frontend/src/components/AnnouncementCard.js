// frontend/src/components/AnnouncementCard.js
// CLEAN VERSION - NO CSS IN THIS FILE!

import React, { useState, useEffect } from 'react';

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

export default function AnnouncementCard({ announcement, currentUser }) {
    const [showComments, setShowComments] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [showRegistrations, setShowRegistrations] = useState(false);

    // Registration state
    const [registrationInfo, setRegistrationInfo] = useState(null);
    const [isRegistered, setIsRegistered] = useState(false);
    const [loadingReg, setLoadingReg] = useState(false);
    const [registrations, setRegistrations] = useState([]);

    const token = localStorage.getItem('token');
    const isClubAdmin = currentUser?.role === 'club_admin';
    const isStudent = currentUser?.role === 'student' || currentUser?.role === null;

    useEffect(() => {
        if (announcement.registration_enabled) {
            loadRegistrationInfo();
            if (token && isStudent) {
                checkRegistrationStatus();
            }
        }
    }, [announcement.id]);

    async function loadRegistrationInfo() {
        try {
            const res = await fetch(`${API_BASE}/announcements/${announcement.id}/registration-info`);
            const data = await res.json();
            if (data.ok) {
                setRegistrationInfo(data);
            }
        } catch (err) {
            console.error('Error loading registration info:', err);
        }
    }

    async function checkRegistrationStatus() {
        try {
            const res = await fetch(
                `${API_BASE}/announcements/${announcement.id}/registration-status`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = await res.json();
            if (data.ok) {
                setIsRegistered(data.registered);
            }
        } catch (err) {
            console.error('Error checking registration:', err);
        }
    }

    async function handleRegister() {
        if (!token) {
            alert('Please login to register');
            return;
        }

        setLoadingReg(true);
        try {
            const res = await fetch(
                `${API_BASE}/announcements/${announcement.id}/register`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            const data = await res.json();

            if (res.ok && data.ok) {
                setIsRegistered(true);
                alert('✓ Successfully registered for this event!');
                loadRegistrationInfo();
            } else {
                alert('✗ ' + (data.error || 'Registration failed'));
            }
        } catch (err) {
            console.error('Error registering:', err);
            alert('✗ Failed to register');
        } finally {
            setLoadingReg(false);
        }
    }

    async function handleUnregister() {
        if (!window.confirm('Are you sure you want to cancel your registration?')) return;

        setLoadingReg(true);
        try {
            const res = await fetch(
                `${API_BASE}/announcements/${announcement.id}/unregister`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            const data = await res.json();

            if (res.ok && data.ok) {
                setIsRegistered(false);
                alert('✓ Registration cancelled');
                loadRegistrationInfo();
            } else {
                alert('✗ ' + (data.error || 'Failed to cancel'));
            }
        } catch (err) {
            console.error('Error cancelling registration:', err);
            alert('✗ Failed to cancel');
        } finally {
            setLoadingReg(false);
        }
    }

    async function loadRegistrations() {
        try {
            const res = await fetch(
                `${API_BASE}/announcements/${announcement.id}/registrations`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = await res.json();
            if (data.ok) {
                setRegistrations(data.registrations);
            }
        } catch (err) {
            console.error('Error loading registrations:', err);
        }
    }

    function handleViewRegistrations() {
        if (!showRegistrations) {
            loadRegistrations();
        }
        setShowRegistrations(!showRegistrations);
    }

    async function exportRegistrations() {
        try {
            const res = await fetch(`${API_BASE}/announcements/${announcement.id}/registrations/export`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `registrations-${announcement.id}.csv`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                alert('Failed to export registrations');
            }
        } catch (err) {
            console.error('Error exporting:', err);
            alert('Error exporting registrations');
        }
    }

    const canRegister = registrationInfo &&
        !registrationInfo.is_full &&
        !registrationInfo.deadline_passed;

    return (
        <div className="announcement-card">
            <div className="announcement-header">
                <span className="club-badge">
                    <span>🎯</span>
                    {announcement.club_name || 'Club'}
                </span>
                <div className="announcement-meta">
                    <span>📅 {new Date(announcement.created_at).toLocaleDateString()}</span>
                    <span>🕒 {new Date(announcement.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>

            <h3 className="announcement-title">{announcement.title}</h3>
            <p className="announcement-content">{announcement.content}</p>

            {announcement.image_url && (
                <img
                    src={`${API_BASE}${announcement.image_url}`}
                    alt={announcement.title}
                    className="announcement-image"
                />
            )}

            {/* Registration Section */}
            {announcement.registration_enabled && registrationInfo && (
                <div className="registration-section">
                    <div className="registration-info">
                        <h4 className="registration-title">📝 Event Registration</h4>

                        <div className="registration-stats">
                            <div className="stat-item">
                                <span className="stat-icon">👥</span>
                                <span className="stat-text">
                                    {registrationInfo.current_count}
                                    {registrationInfo.max_registrations ? ` / ${registrationInfo.max_registrations}` : ''}
                                    {' '}registered
                                </span>
                            </div>

                            {registrationInfo.deadline && (
                                <div className="stat-item">
                                    <span className="stat-icon">⏰</span>
                                    <span className="stat-text">
                                        Deadline: {new Date(registrationInfo.deadline).toLocaleString()}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Registration Status Messages */}
                        {registrationInfo.is_full && (
                            <div className="registration-status status-full">
                                ⚠️ Event is full
                            </div>
                        )}

                        {registrationInfo.deadline_passed && (
                            <div className="registration-status status-closed">
                                🔒 Registration closed
                            </div>
                        )}

                        {/* Registration Button for Students */}
                        {isStudent && (
                            <div className="registration-actions">
                                {isRegistered ? (
                                    <div className="registered-badge">
                                        <span>✓</span> You're registered
                                        <button
                                            className="btn-cancel-reg"
                                            onClick={handleUnregister}
                                            disabled={loadingReg}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        className="btn-register"
                                        onClick={handleRegister}
                                        disabled={loadingReg || !canRegister}
                                    >
                                        {loadingReg ? '...' : '📝 Register Now'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Admin View - Removed as requested (moved to Profile only) */}
                </div>
            )}

            {/* Existing Interactions Bar */}
            <div className="interactions-bar">
                <button className="interaction-btn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{announcement.like_count || 0}</span>
                </button>

                <button className="interaction-btn" onClick={() => setShowComments(!showComments)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{announcement.comment_count || 0}</span>
                </button>
            </div>

            {/* Comments Section */}
            {showComments && (
                <div className="comments-section">
                    <div className="comment-input-wrapper">
                        <textarea
                            className="comment-input"
                            placeholder="Write a comment..."
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                        />
                        <button className="btn btn-primary btn-sm">Post</button>
                    </div>

                    <div className="comment-list">
                        <p style={{ textAlign: 'center', color: '#6B7280', padding: '2rem' }}>
                            No comments yet. Be the first to comment!
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}