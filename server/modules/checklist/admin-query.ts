import type { AdminChecklistFilters } from '../../../shared/api.interface';

export function parseAdminQuery(query: Record<string, unknown>): AdminChecklistFilters {
  if (query.page !== undefined && typeof query.page !== 'string' && typeof query.page !== 'number') {
    throw new Error('页码格式无效');
  }
  const page: number = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
    throw new Error('页码必须是 1-100000 的整数');
  }
  const readText = (key: string, limit: number): string => {
    const value: unknown = query[key];
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > limit) throw new Error('筛选条件格式或长度无效');
    return value.trim();
  };
  const status: string = readText('status', 20) || 'all';
  if (status !== 'all' && status !== 'active' && status !== 'completed') {
    throw new Error('完成状态无效');
  }
  return { page, search: readText('search', 80), creatorId: readText('creatorId', 100),
    conversation: readText('conversation', 200), status };
}
