import React, { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { authClient, CanRole } from '@lark-apaas/client-toolkit/auth';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, MessageSquare, Plus, RefreshCw, Search } from 'lucide-react';
import { getJsapiSign, listChecklists, listAdminChecklists, saveConversationName } from '@/api';
import { CHECKLIST_ADMIN_ROLE } from '@shared/api.interface';
import type { AdminChecklistFilters } from '@shared/api.interface';
import { UserSelect } from '@/components/business-ui/user-select';
import { UserDisplay } from '@/components/business-ui/user-display';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { configureConversationReader, readPrivateChatName } from '@/utils/feishu-conversations';
import type { ChecklistItem, ChecklistListResponse, ChecklistRecord } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ChecklistImagePreview from './ChecklistImages';

const formatDate = (value: string): string => new Date(value).toLocaleString('zh-CN');
const completedCount = (record: ChecklistRecord): number =>
  record.items.filter((item: ChecklistItem) => item.checked).length;

interface ChecklistManagementProps { admin?: boolean }

const Creator: React.FC<{ record: ChecklistRecord }> = ({ record }) => (
  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
    <span>创建人：</span>{'createdBy' in record && typeof record.createdBy === 'string'
      ? <UserDisplay value={[record.createdBy]} size="small" /> : <span>未记录</span>}
  </div>
);

const ChecklistManagement: React.FC<ChecklistManagementProps> = ({ admin = false }) => {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ChecklistListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [conversation, setConversation] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [status, setStatus] = useState<AdminChecklistFilters['status']>('all');
  const selected: ChecklistRecord | undefined = data?.items.find(
    (record: ChecklistRecord) => record.id === selectedId,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim()); setConversationQuery(conversation.trim()); setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, conversation]);

  useEffect(() => {
    let active: boolean = true;
    setLoading(true);
    setError('');
    setNeedsLogin(false);
    setSelectedId(null);
    const request: Promise<ChecklistListResponse> = admin
      ? listAdminChecklists({ page, search: query, creatorId: creatorId ?? '', conversation: conversationQuery, status })
      : listChecklists(page, query);
    void request.then((result: ChecklistListResponse) => {
      if (!active) return;
      setData(result);
      if (admin) return;
      const tt: FeishuTt | undefined = window.tt;
      const sdk: FeishuH5Sdk | undefined = window.h5sdk;
      const missing: string[] = [...new Set(result.items.flatMap((record: ChecklistRecord) =>
        record.conversation && !record.conversation.name ? [record.conversation.chatId] : []))];
      if (!tt?.getChatInfo || !sdk || !missing.length) return;
      void (async () => {
        await configureConversationReader(sdk, await getJsapiSign(window.location.href.split('#')[0]));
        const names: Map<string, string> = new Map();
        await Promise.all(missing.map(async (chatId: string) => {
          const name: string | null = await readPrivateChatName(tt, chatId);
          if (!name) return;
          names.set(chatId, name);
          try {
            await saveConversationName({ chatId, name });
          } catch (failure) {
            logger.warn('保存私聊名称失败', failure);
          }
        }));
        if (active) setData({ ...result, items: result.items.map((record: ChecklistRecord) => ({
          ...record, conversation: record.conversation ? {
            ...record.conversation, name: names.get(record.conversation.chatId) ?? record.conversation.name,
          } : null,
        })) });
      })().catch((failure: unknown) => logger.warn('补齐私聊名称失败', failure));
    }).catch((failure: unknown) => {
      if (!active) return;
      if (isAxiosError<{ error?: { message?: string } }>(failure)) {
        setNeedsLogin(failure.response?.status === 401);
        setError(failure.response?.data?.error?.message ?? '清单加载失败，请重试。');
      } else setError(failure instanceof Error ? failure.message : '清单加载失败，请重试。');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, query, revision, admin, creatorId, conversationQuery, status]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">{admin ? '全部清单' : '我的清单'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{data ? `${data.total} 份清单` : '检查清单'}</p></div>
        <div className="flex flex-wrap gap-2">
          {admin ? <Button asChild variant="outline"><Link to="/manage"><ClipboardList />我的清单</Link></Button>
            : <><CanRole roles={[CHECKLIST_ADMIN_ROLE]}><Button asChild variant="outline"><Link to="/admin"><ClipboardList />全部清单</Link></Button></CanRole>
              <Button asChild><Link to="/editor"><Plus />新建清单</Link></Button></>}
        </div>
      </header>
      <section aria-label="搜索清单" className="flex items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input className="pl-9" aria-label="搜索清单标题" placeholder="搜索清单标题" maxLength={80}
            value={search} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} />
        </div>
        <Button size="icon" variant="outline" title="刷新清单" aria-label="刷新清单"
          disabled={loading} onClick={() => setRevision((value: number) => value + 1)}><RefreshCw /></Button>
      </section>
      {admin && <section aria-label="管理筛选" className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0"><UserSelect triggerType="search" value={creatorId} placeholder="全部创建人"
          onChange={(value: string | null) => { setCreatorId(value); setPage(1); }} /></div>
        <Input aria-label="所属对话" placeholder="对话名称或 ID" maxLength={200} value={conversation}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setConversation(event.target.value)} />
        <Select value={status} onValueChange={(value: string) => {
          if (value === 'all' || value === 'active' || value === 'completed') { setStatus(value); setPage(1); }
        }}><SelectTrigger className="w-full" aria-label="完成状态"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="active">进行中</SelectItem>
            <SelectItem value="completed">已完成</SelectItem></SelectContent></Select>
      </section>}
      <section aria-label="清单列表" aria-busy={loading} className="border-y">
        {loading ? <p role="status" className="py-16 text-center text-muted-foreground">正在加载清单…</p>
          : error ? <div role="alert" className="space-y-4 py-12 text-center"><p>{error}</p>
            {needsLogin ? <Button onClick={() => authClient.session.redirectToLogin()}>登录</Button>
              : <Button variant="outline" onClick={() => setRevision((value: number) => value + 1)}>重试</Button>}</div>
          : !data?.items.length ? <div className="space-y-3 py-16 text-center text-muted-foreground">
            <ClipboardList className="mx-auto size-8" /><p>{query ? '未找到匹配的清单' : '暂无清单'}</p>
          </div> : data.items.map((record: ChecklistRecord) => {
            const completed: number = completedCount(record);
            return <article key={record.id} className="flex flex-wrap items-center justify-between gap-4 border-b py-5 last:border-b-0">
              <div className="min-w-0 flex-1 basis-56">
                <button className="break-words text-left font-medium hover:underline" onClick={() => setSelectedId(record.id)}>{record.title}</button>
                <p className="mt-2 text-xs text-muted-foreground">更新于 {formatDate(record.updatedAt)}</p>
                {admin && <Creator record={record} />}
                <div className="mt-2 flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
                  <MessageSquare className="mt-0.5 size-4 shrink-0" />
                  {record.conversation ? <a href={record.conversation.url} target="_blank" rel="noreferrer"
                    className="min-w-0 break-words text-primary hover:underline" title="打开所属飞书对话">
                    所属对话：{record.conversation.name ?? `飞书未返回对话名称（${record.conversation.chatId}）`}
                  </a> : <span>尚未记录所属对话</span>}
                </div>
              </div>
              <div className="w-40 shrink-0"><p className="mb-2 text-xs">{completed === record.items.length ? '已完成' : '进行中'} · {completed}/{record.items.length} 项</p>
                <Progress value={record.items.length ? completed / record.items.length * 100 : 100} /></div>
              <Button variant="outline" size="sm" onClick={() => setSelectedId(record.id)}>查看详情</Button>
            </article>;
          })}
      </section>
      {data && !loading && !error && <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>第 {page} 页 / 共 {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span>
        <div className="flex gap-2">
          <Button size="icon" variant="outline" title="上一页" aria-label="上一页" disabled={page === 1}
            onClick={() => setPage((value: number) => value - 1)}><ChevronLeft /></Button>
          <Button size="icon" variant="outline" title="下一页" aria-label="下一页" disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((value: number) => value + 1)}><ChevronRight /></Button>
        </div>
      </footer>}
      <Dialog open={Boolean(selected)} onOpenChange={(open: boolean) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {selected && <><DialogHeader><DialogTitle className="pr-6 break-words">{selected.title}</DialogTitle>
            <DialogDescription>创建于 {formatDate(selected.createdAt)} · {selected.boundToMessage ? '已关联飞书消息' : '尚未关联飞书消息'}</DialogDescription></DialogHeader>
            {admin && <><Creator record={selected} /><p className="text-xs text-muted-foreground">更新于 {formatDate(selected.updatedAt)}</p></>}
            <p className="break-words text-sm">所属对话：{selected.conversation ?
              <a className="text-primary hover:underline" href={selected.conversation.url} target="_blank" rel="noreferrer">
                {selected.conversation.name ?? selected.conversation.chatId}
              </a> : '尚未记录所属对话'}</p>
            <ol className="divide-y">{selected.items.map((item: ChecklistItem, index: number) => <li key={item.id} className="flex gap-3 py-4">
              <CheckCircle2 className={`mt-1 size-5 shrink-0 ${item.checked ? 'text-green-600' : 'text-muted-foreground'}`} aria-label={item.checked ? '已完成' : '未完成'} />
              <div className="min-w-0"><p className="whitespace-pre-wrap break-words text-sm">{index + 1}. {item.text}</p>
                {item.images.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.images.map((image, imageIndex: number) =>
                  <ChecklistImagePreview key={image.imageKey} checklistId={selected.id} image={image} admin={admin}
                    label={`事项 ${index + 1} 图片 ${imageIndex + 1}`} />)}</div>}
                {item.videos.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{item.videos.length} 个视频</p>}</div>
            </li>)}</ol></>}
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default ChecklistManagement;
