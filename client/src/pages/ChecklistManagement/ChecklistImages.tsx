import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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

const ChecklistImagePreview: React.FC<ChecklistImagePreviewProps> = ({ checklistId, image, admin, label }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active: boolean = true;
    let resource: string | null = null;
    setUrl(null); setFailed(false); setOpen(false);
    void getChecklistImage({ checklistId, imageKey: image.imageKey }, admin).then((blob: Blob) => {
      if (!active) return;
      resource = URL.createObjectURL(blob);
      setUrl(resource);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (resource) URL.revokeObjectURL(resource); };
  }, [checklistId, image.imageKey, admin, revision]);

  return <>
    <div className="flex size-24 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
      {failed ? <Button variant="ghost" size="icon" aria-label={`重新加载${label}`} title="重新加载图片"
        onClick={() => setRevision((value: number) => value + 1)}><RefreshCw /></Button>
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
