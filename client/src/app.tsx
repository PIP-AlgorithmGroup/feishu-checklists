import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import ChecklistPage from './pages/ChecklistPage/ChecklistPage';
import ChecklistManagement from './pages/ChecklistManagement/ChecklistManagement';
import { parseTriggerCode } from './pages/ChecklistPage/checklist-utils';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={parseTriggerCode(window.location.href) ? <ChecklistPage /> : <ChecklistManagement />} />
        <Route path="manage" element={<ChecklistManagement />} />
        <Route path="editor" element={<ChecklistPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
