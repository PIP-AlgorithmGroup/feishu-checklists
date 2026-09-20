import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  ChecklistDraft, CreateChecklistResponse, JsapiSignResponse,
  MediaRegistrationInput, MediaRegistrationResponse,
} from '@shared/api.interface';


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
