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
