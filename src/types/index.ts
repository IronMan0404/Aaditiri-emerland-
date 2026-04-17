export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  avatar_url?: string;
  flat_number?: string;
  vehicle_number?: string;
  resident_type?: 'owner' | 'tenant';
  role: 'admin' | 'user';
  created_at: string;
  is_approved: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  image_url?: string;
  created_by: string;
  created_at: string;
  is_pinned: boolean;
  profiles?: { full_name: string };
}

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  image_url?: string;
  created_by: string;
  max_attendees?: number;
  created_at: string;
  profiles?: { full_name: string };
  event_rsvps?: { id: string; user_id: string; status: string }[];
}

export interface Booking {
  id: string;
  user_id: string;
  facility: string;
  date: string;
  time_slot: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  notes?: string;
  created_at: string;
  profiles?: { full_name: string; flat_number?: string };
}

export interface Broadcast {
  id: string;
  title: string;
  message: string;
  created_by: string;
  created_at: string;
  profiles?: { full_name: string };
}

export interface Photo {
  id: string;
  user_id: string;
  url: string;
  caption?: string;
  created_at: string;
  profiles?: { full_name: string; avatar_url?: string };
}

export interface Update {
  id: string;
  title: string;
  content: string;
  category: string;
  created_by: string;
  created_at: string;
  profiles?: { full_name: string };
}
