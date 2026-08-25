export const COMMUNICATION_CHANNELS = ["email", "whatsapp", "sms", "internal"] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const CONVERSATION_STATUSES = ["open", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

// "delivered"/"bounced"/"complained" are reached only via the Resend delivery-status webhook
// (see apps/api/src/communication/webhooks/) — an async update to a message that was already
// "sent" from the synchronous provider call's point of view.
export const MESSAGE_STATUSES = [
  "queued",
  "sent",
  "failed",
  "delivered",
  "bounced",
  "complained",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface MessageTemplate {
  id: string;
  organizationId: string;
  name: string;
  channel: CommunicationChannel;
  subject?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  organizationId: string;
  contactId: string;
  channel: CommunicationChannel;
  subject?: string;
  status: ConversationStatus;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  organizationId: string;
  conversationId: string;
  direction: MessageDirection;
  to?: string;
  from?: string;
  subject?: string;
  body: string;
  status: MessageStatus;
  providerReference?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}
