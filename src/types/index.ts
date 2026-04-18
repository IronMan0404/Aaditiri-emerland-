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
  is_bot?: boolean;
  whatsapp_opt_in?: boolean;
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

export interface BotMessage {
  id: string;
  body: string;
  authored_by: string | null;
  created_at: string;
}

export type WhatsAppStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped_no_phone'
  | 'skipped_opt_out'
  | 'skipped_disabled';

export type VehicleType = 'car' | 'bike' | 'other';

export interface Vehicle {
  id: string;
  user_id: string;
  number: string;
  type: VehicleType;
  created_at: string;
}

export type FamilyRelation = 'spouse' | 'son' | 'daughter' | 'parent' | 'sibling' | 'other';
export type Gender = 'male' | 'female' | 'other';

export interface FamilyMember {
  id: string;
  user_id: string;
  full_name: string;
  relation: FamilyRelation;
  gender?: Gender | null;
  age?: number | null;
  phone?: string | null;
  created_at: string;
}

export type PetSpecies = 'dog' | 'cat' | 'bird' | 'other';

export interface Pet {
  id: string;
  user_id: string;
  name: string;
  species: PetSpecies;
  vaccinated: boolean;
  created_at: string;
}

export interface BotMessageRecipient {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string | null;
  whatsapp_status: WhatsAppStatus | null;
  whatsapp_message_id: string | null;
  whatsapp_error: string | null;
  whatsapp_sent_at: string | null;
  created_at: string;
  bot_messages?: BotMessage;
}
