import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { isAxiosError } from 'axios';
import type {
  ChecklistDraft, ChecklistListResponse, CreateChecklistResponse, JsapiSignResponse,
  MediaRegistrationInput, MediaRegistrationResponse,
  ChecklistMessageBinding,
  ConversationNameInput,
  AdminChecklistFilters, AdminChecklistListResponse, ChecklistImageRequest,
} from '@shared/api.interface';

export async function listChecklists(page: number, search: string): Promise<ChecklistListResponse> {
  const response = await axiosForBackend<ChecklistListResponse>({
    url: '/api/checklist', method: 'GET', params: { page, search },
  });
  return response.data;
}

export async function getChecklistImage(input: ChecklistImageRequest, admin: boolean): Promise<Blob> {
  try {
    const response = await axiosForBackend<Blob>({
      url: admin ? '/api/checklist/admin/image' : '/api/checklist/image',
      method: 'GET', params: input, responseType: 'blob',
    });
    if (response.status === 403) throw new Error('没有查看此图片的权限');
    if (!response.data.type.startsWith('image/')) throw new Error('图片暂时无法读取，请重试');
    return response.data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      throw Object.assign(new Error('没有查看此图片的权限'), { cause: error });
    }
    throw error;
  }
}

export async function listAdminChecklists(filters: AdminChecklistFilters): Promise<AdminChecklistListResponse> {
  try {
    const response = await axiosForBackend<AdminChecklistListResponse>({
      url: '/api/checklist/admin', method: 'GET', params: filters,
    });
    if (response.status === 403) throw new Error('没有清单管理员权限');
    return response.data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      throw Object.assign(new Error('没有清单管理员权限'), { cause: error });
    }
    throw error;
  }
}


export async function getJsapiSign(url: string): Promise<JsapiSignResponse> {
  const response = await axiosForBackend.get<JsapiSignResponse>('/api/checklist/jsapi-sign', {
    params: { url },
  });
  return response.data;
}

export async function registerMedia(
  input: MediaRegistrationInput,
): Promise<MediaRegistrationResponse> {
  const response = await axiosForBackend.post<MediaRegistrationResponse>('/api/checklist/media', input);
  return response.data;
}

export async function createChecklist(
  input: ChecklistDraft,
): Promise<CreateChecklistResponse> {
  const response = await axiosForBackend.post<CreateChecklistResponse>('/api/checklist', input);
  return response.data;
}

export async function bindChecklistMessage(input: ChecklistMessageBinding): Promise<void> {
  await axiosForBackend.post('/api/checklist/message-binding', input);
}

export async function saveConversationName(input: ConversationNameInput): Promise<void> {
  await axiosForBackend.post('/api/checklist/conversation-name', input);
}
