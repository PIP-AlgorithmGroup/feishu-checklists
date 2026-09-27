export interface ChecklistImage {
  fileId: string | null;
  imageKey: string;
  width: number | null;
  height: number | null;
  size: number | null;
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
