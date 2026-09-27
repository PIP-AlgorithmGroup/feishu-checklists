export interface ChecklistImage {
  fileId: string | null;
  imageKey: string;
  width: number | null;
  height: number | null;
  size: number | null;
}

export interface ChecklistImageRequest {
  checklistId: string;
  imageKey: string;
}

export interface ChecklistVideo {
  fileId: string | null;
  fileKey: string;
  fileName: string;
  duration: number | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  images: ChecklistImage[];
  videos: ChecklistVideo[];
}

export interface ChecklistDraft {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface CreateChecklistResponse {
  checklist: ChecklistDraft;
  created: boolean;
}

export interface ChecklistMessageBinding {
  checklistId: string;
  openChatId: string;
  openMessageId: string;
}

export interface ConversationNameInput {
  chatId: string;
  name: string;
}

export interface ChecklistRecord extends ChecklistDraft {
  createdAt: string;
  updatedAt: string;
  boundToMessage: boolean;
  conversation: {
    chatId: string;
    name: string | null;
    url: string;
  } | null;
}

export interface ChecklistListResponse {
  items: ChecklistRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export const CHECKLIST_ADMIN_ROLE = 'checklist_admin';

export interface AdminChecklistRecord extends ChecklistRecord {
  createdBy: string | null;
}

export interface AdminChecklistListResponse extends ChecklistListResponse {
  items: AdminChecklistRecord[];
}

export interface AdminChecklistFilters {
  page: number;
  search: string;
  creatorId: string;
  conversation: string;
  status: 'all' | 'active' | 'completed';
}

export interface JsapiSignResponse {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
}

export interface MediaRegistrationInput {
  fileId: string;
  downloadUrl: string;
  mimeType: string;
  fileName?: string;
  duration?: number;
}

export type MediaRegistrationResponse =
  | { type: 'image'; fileId: string; imageKey: string }
  | { type: 'video'; fileId: string; fileKey: string; fileName: string; duration: number };
