import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { getChecklistImage } from '@/api';
import { Image } from '@/components/ui/image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ChecklistImage } from '@shared/api.interface';

interface ChecklistImagePreviewProps {
  checklistId: string;
  image: ChecklistImage;
  admin: boolean;
  label: string;
}

const imageUrlCache: Map<string, Promise<string>> = new Map();

function imageCacheKey(checklistId: string, imageKey: string, admin: boolean): string {
  return `${admin ? 'admin' : 'owner'}:${checklistId}:${imageKey}`;
}

function loadImageUrl(checklistId: string, imageKey: string, admin: boolean): Promise<string> {
  const key: string = imageCacheKey(checklistId, imageKey, admin);
  const cached: Promise<string> | undefined = imageUrlCache.get(key);
  if (cached) return cached;
  const request: Promise<string> = getChecklistImage({ checklistId, imageKey }, admin)
    .then((blob: Blob) => URL.createObjectURL(blob));
  imageUrlCache.set(key, request);
  request.catch(() => { if (imageUrlCache.get(key) === request) imageUrlCache.delete(key); });
  return request;
}

const ChecklistImagePreview: React.FC<ChecklistImagePreviewProps> = ({ checklistId, image, admin, label }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active: boolean = true;
    setUrl(null); setFailed(false); setErrorMessage(''); setOpen(false);
    void loadImageUrl(checklistId, image.imageKey, admin).then((resource: string) => {
      if (!active) return;
      setUrl(resource);
    }).catch((error: unknown) => {
      if (!active) return;
      setFailed(true);
      setErrorMessage(error instanceof Error ? error.message : '图片读取失败，请重试');
    });
    return () => { active = false; };
  }, [checklistId, image.imageKey, admin, revision]);

  return <>
    <div className="flex size-24 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
      {failed ? <div className="flex flex-col items-center gap-1 px-2 text-center">
          <AlertCircle className="size-5 text-destructive" aria-hidden="true" />
          <span className="text-[11px] leading-tight text-muted-foreground">{errorMessage}</span>
          <Button variant="ghost" size="sm" aria-label={`重新加载${label}`} title="重新加载图片"
            onClick={() => setRevision((value: number) => value + 1)}><RefreshCw />重试</Button>
        </div>
        : url ? <button className="size-full" aria-label={`查看大图：${label}`} title="查看大图" onClick={() => setOpen(true)}>
          <Image src={url} width={96} height={96} alt={label} className="size-full object-cover"
            onError={() => setFailed(true)} />
        </button> : <span role="status" className="text-xs text-muted-foreground">加载中…</span>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-5xl sm:max-w-5xl">
        <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription className="sr-only">清单图片大图</DialogDescription></DialogHeader>
        {url && <Image src={url} alt={label} sizes="(max-width: 640px) 90vw, 80vw"
          className="max-h-[75vh] w-full object-contain" />}
      </DialogContent>
    </Dialog>
  </>;
};

export default ChecklistImagePreview;
