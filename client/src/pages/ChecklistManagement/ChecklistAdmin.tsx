import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth, ROLE_SUBJECT } from '@lark-apaas/client-toolkit/auth';
import { CHECKLIST_ADMIN_ROLE } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import ChecklistManagement from './ChecklistManagement';

const ChecklistAdmin: React.FC = () => {
  const { ability, isLoading } = useAuth();
  if (isLoading) return <p role="status" className="p-8 text-center">正在验证管理员权限…</p>;
  if (!ability.can(CHECKLIST_ADMIN_ROLE, ROLE_SUBJECT)) {
    return <main className="space-y-4 p-8 text-center"><h1 className="text-xl font-semibold">没有清单管理员权限</h1>
      <Button asChild variant="outline"><Link to="/manage">我的清单</Link></Button></main>;
  }
  return <ChecklistManagement admin />;
};

export default ChecklistAdmin;
