import type { JsapiSignResponse } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';

export function readPrivateChatName(tt: FeishuTt, chatId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    const finish = (name: string | null): void => { clearTimeout(timer); resolve(name); };
    try {
      tt.getChatInfo({
        openChatId: chatId, chatType: 0, userType: 0,
        success: (result) => finish(
          result.name?.trim() || result.i18nNames?.zh_cn?.trim() || result.i18nNames?.en_us?.trim() || null,
        ),
        fail: (error: unknown) => {
          logger.warn('读取私聊名称失败', error);
          finish(null);
        },
      });
    } catch (error) {
      logger.warn('读取私聊名称失败', error);
      finish(null);
    }
  });
}

export async function configureConversationReader(sdk: FeishuH5Sdk, sign: JsapiSignResponse): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('飞书私聊信息接口初始化超时')), 5000);
    try {
      sdk.config({
        ...sign, jsApiList: ['sendMessageCard', 'getChatInfo'],
        onSuccess: () => { clearTimeout(timer); resolve(); },
        onFail: (error: unknown) => { clearTimeout(timer); reject(error); },
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
