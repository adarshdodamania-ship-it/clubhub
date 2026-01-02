-- Database Schema for Club Hub (PostgreSQL / Supabase)

-- 1. Clubs Table
CREATE TABLE clubs (
    id SERIAL PRIMARY KEY,
    club_name VARCHAR(255) NOT NULL,
    club_code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    category VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    role VARCHAR(50), -- 'student' or 'club_admin'
    name VARCHAR(255),
    branch VARCHAR(255),
    roll_number VARCHAR(50),
    club_id INTEGER REFERENCES clubs(id),
    admin_requested BOOLEAN DEFAULT FALSE,
    requested_at TIMESTAMP WITH TIME ZONE,
    profile_picture TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE
);

-- 3. Announcements Table
CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    club_id INTEGER REFERENCES clubs(id) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    created_by VARCHAR(255) REFERENCES users(email),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Registration Features
    registration_enabled BOOLEAN DEFAULT FALSE,
    registration_deadline TIMESTAMP WITH TIME ZONE,
    max_registrations INTEGER,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE
);

-- 4. Club Subscriptions Table
CREATE TABLE club_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) NOT NULL,
    club_id INTEGER REFERENCES clubs(id) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, club_id)
);

-- 5. Event Registrations Table (New!)
CREATE TABLE event_registrations (
    id SERIAL PRIMARY KEY,
    announcement_id INTEGER REFERENCES announcements(id) NOT NULL,
    user_id INTEGER REFERENCES users(id) NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'registered', -- 'registered', 'cancelled'
    UNIQUE(announcement_id, user_id)
);

-- Initial Data: Insert a few sample clubs
INSERT INTO clubs (club_name, club_code, description, category) VALUES 
('Coding Club', 'CODE', 'For programming enthusiasts', 'Technical'),
('Robotics Club', 'ROBO', 'Building the future', 'Technical'),
('Music Club', 'MUSIC', 'For the love of music', 'Cultural');
