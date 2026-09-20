import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Plus, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ChecklistDraft, ChecklistImage, ChecklistVideo } from '@shared/api.interface';
import { createChecklist, getJsapiSign, registerMedia } from '@/api';
import { uploadFile } from '@/components/business-ui/api/files/service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { buildCardContent, parseTriggerCode } from './checklist-utils';
import './checklist-page.css';

interface EditorImage extends ChecklistImage { previewUrl: string }
interface EditorVideo extends ChecklistVideo { previewUrl: string }
interface EditorItem {
  id: string; text: string; images: EditorImage[]; videos: EditorVideo[];
  uploading: boolean; progress: number;
}

const newItem = (): EditorItem => ({
  id: crypto.randomUUID(), text: '', images: [], videos: [], uploading: false, progress: 0,
});

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const value = error as { message?: string; response?: { data?: { error?: { message?: string } } } };
    return value.response?.data?.error?.message ?? value.message ?? '操作失败';
  }
  return String(error || '操作失败');
}

async function configureFeishu(): Promise<void> {
  if (!window.h5sdk || !window.tt) throw new Error('请从飞书客户端会话侧栏打开');
  const url: string = window.location.href.split('#')[0];
  const sign = await getJsapiSign(url);
  await new Promise<void>((resolve, reject) => window.h5sdk!.config({
    ...sign,
    jsApiList: ['sendMessageCard'],
    onSuccess: resolve,
    onFail: reject,
  }));
}

async function sendMessageCard(triggerCode: string, cardContent: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => window.tt!.sendMessageCard({
    triggerCode, cardContent, success: () => resolve(), fail: reject,
  }));
}

async function imageMetadata(file: File): Promise<{ width: number; height: number }> {
  const url: string = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function videoDuration(file: File): Promise<number> {
  const url: string = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('无法读取视频时长'));
    });
    return Math.max(1, Math.round(video.duration * 1000));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressImage(file: File): Promise<File> {
  if (file.size <= 5 * 1024 * 1024) return file;
  if (file.size > 20 * 1024 * 1024) throw new Error('待压缩图片不能超过 20 MB');
  const url: string = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale: number = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.78, 0.68, 0.58]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, quality));
      if (blob && blob.size <= 5 * 1024 * 1024) {
        return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
      }
    }
    throw new Error('图片自动压缩后仍超过 5 MB');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ChecklistPage() {
  const triggerCode = useMemo(() => parseTriggerCode(window.location.href), []);
  const [title, setTitle] = useState('检查清单');
  const [items, setItems] = useState<EditorItem[]>([newItem()]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('正在连接飞书');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!triggerCode) {
      setStatus('请从飞书会话侧栏打开');
      return;
    }
    void configureFeishu().then(() => {
      setConnected(true);
      setStatus('当前会话已连接');
    }).catch((error: unknown) => setStatus(errorMessage(error)));
  }, [triggerCode]);

  const updateItem = (id: string, update: Partial<EditorItem>) =>
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));

  const addItem = (index: number) => setItems((current) => {
    if (current.length >= 50) return current;
    const next = [...current];
    next.splice(index + 1, 0, newItem());
    return next;
  });

  const moveItem = (index: number, offset: number) => setItems((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    return next;
  });

  const removeItem = (index: number) => setItems((current) => {
    if (current.length === 1) return [newItem()];
    return current.filter((_, itemIndex) => itemIndex !== index);
  });

  const uploadMedia = async (item: EditorItem, selected: File[]) => {
    const imageSlots = 3 - item.images.length;
    const videoSlots = 3 - item.videos.length;
    const files = selected.filter((file, index, all) => {
      const previous = all.slice(0, index);
      return file.type === 'video/mp4'
        ? previous.filter((candidate) => candidate.type === 'video/mp4').length < videoSlots
        : ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
          previous.filter((candidate) => candidate.type !== 'video/mp4').length < imageSlots;
    });
    if (!files.length) return;
    updateItem(item.id, { uploading: true, progress: 8 });
    try {
      for (let index = 0; index < files.length; index += 1) {
        const original = files[index];
        if (original.type === 'video/mp4' && original.size > 30 * 1024 * 1024) {
          throw new Error('单个视频不能超过 30 MB');
        }
        const file = original.type === 'video/mp4' ? original : await compressImage(original);
        updateItem(item.id, { progress: 15 + Math.round(index / files.length * 65) });
        const stored = await uploadFile(file);
        const duration = file.type === 'video/mp4' ? await videoDuration(file) : undefined;
        const uploaded = await registerMedia({
          fileId: stored.id, downloadUrl: stored.url, mimeType: file.type,
          fileName: file.name, duration,
        });
        const previewUrl = URL.createObjectURL(file);
        setItems((current) => current.map((candidate) => {
          if (candidate.id !== item.id) return candidate;
          if (uploaded.type === 'video') {
            return { ...candidate, videos: [...candidate.videos, { ...uploaded, previewUrl }] };
          }
          return {
            ...candidate,
            images: [...candidate.images, {
              ...uploaded, ...(file.type === 'video/mp4' ? {} : awaitableMetadataPlaceholder),
              size: file.size, previewUrl,
            } as EditorImage],
          };
        }));
        if (uploaded.type === 'image') {
          const meta = await imageMetadata(file);
          setItems((current) => current.map((candidate) => candidate.id === item.id ? {
            ...candidate,
            images: candidate.images.map((image) => image.fileId === uploaded.fileId ? { ...image, ...meta } : image),
          } : candidate));
        }
      }
      toast.success('媒体已上传');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      updateItem(item.id, { uploading: false, progress: 100 });
    }
  };

  const send = async () => {
    if (!triggerCode || !connected) return;
    const draft: ChecklistDraft = {
      id: crypto.randomUUID(), title: title.trim(),
      items: items.map((item) => ({
        id: item.id, text: item.text.trim(), checked: false,
        images: item.images.map(({ previewUrl: _, ...image }) => image),
        videos: item.videos.map(({ previewUrl: _, ...video }) => video),
      })),
    };
    const cardContent = buildCardContent(draft);
    if (new TextEncoder().encode(JSON.stringify(cardContent)).byteLength > 20 * 1024) {
      toast.error('卡片内容超过 20 KB，请减少内容或媒体');
      return;
    }
    setSending(true);
    setStatus('正在保存并发送');
    try {
      await createChecklist(draft);
      await sendMessageCard(triggerCode, cardContent);
      setStatus('清单已发送');
      toast.success('清单已发送到当前会话');
    } catch (error) {
      setStatus('发送失败');
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const valid = connected && title.trim() && items.every((item) => item.text.trim() && !item.uploading);

  return (
    <main className="checklist-shell">
      <header className="checklist-header">
        <div>
          <h1>检查清单</h1>
          <p className={connected ? 'status-ready' : ''}>{status}</p>
        </div>
        <span className="item-count">{items.length}/50</span>
      </header>

      <section className="editor-section">
        <label htmlFor="checklist-title">标题</label>
        <Input id="checklist-title" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
      </section>

      <section className="items-section" aria-label="清单事项">
        {items.map((item, index) => (
          <article className="checklist-item" key={item.id}>
            <div className="item-number">{index + 1}</div>
            <Textarea
              aria-label={`事项 ${index + 1}`}
              maxLength={500}
              rows={2}
              placeholder="输入事项，Shift + Enter 新增下一项"
              value={item.text}
              onChange={(event) => updateItem(item.id, { text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault();
                  addItem(index);
                }
              }}
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                if (files.length) {
                  event.preventDefault();
                  void uploadMedia(item, files);
                }
              }}
            />
            <div className="item-tools">
              <Button size="icon" variant="ghost" title="上移" disabled={index === 0} onClick={() => moveItem(index, -1)}><ChevronUp /></Button>
              <Button size="icon" variant="ghost" title="下移" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)}><ChevronDown /></Button>
              <label className="media-picker" title="添加图片或视频">
                <ImagePlus aria-hidden="true" />
                <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(event) => {
                  void uploadMedia(item, [...(event.target.files ?? [])]);
                  event.target.value = '';
                }} />
              </label>
              <Button size="icon" variant="ghost" title="删除事项" onClick={() => removeItem(index)}><Trash2 /></Button>
            </div>
            {item.uploading && <Progress className="upload-progress" value={item.progress} />}
            {(item.images.length > 0 || item.videos.length > 0) && (
              <div className="media-grid">
                {item.images.map((image) => <div className="media-preview" key={image.fileId}>
                  <img src={image.previewUrl} alt="已上传图片" />
                  <button title="删除图片" onClick={() => updateItem(item.id, { images: item.images.filter((value) => value !== image) })}><X /></button>
                </div>)}
                {item.videos.map((video) => <div className="media-preview" key={video.fileId}>
                  <video src={video.previewUrl} controls playsInline />
                  <button title="删除视频" onClick={() => updateItem(item.id, { videos: item.videos.filter((value) => value !== video) })}><X /></button>
                </div>)}
              </div>
            )}
          </article>
        ))}
      </section>

      <Button variant="outline" className="add-item" disabled={items.length >= 50} onClick={() => addItem(items.length - 1)}><Plus />添加事项</Button>
      <footer className="send-bar">
        <Button className="send-button" disabled={!valid || sending} onClick={() => void send()}><Send />{sending ? '正在发送' : `发送清单 · ${items.length} 项`}</Button>
      </footer>
    </main>
  );
}

const awaitableMetadataPlaceholder = { width: null, height: null };
