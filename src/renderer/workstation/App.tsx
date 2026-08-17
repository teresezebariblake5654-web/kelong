import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { ActivatePage } from './pages/ActivatePage';
import { AccountPage } from './pages/AccountPage';
import { AnomaliesPage } from './pages/AnomaliesPage';
import { ChatPage } from './pages/ChatPage';
import { CleanPage } from './pages/CleanPage';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { LaunchPage } from './pages/LaunchPage';
import { LoginPage } from './pages/LoginPage';
import { MappingPage } from './pages/MappingPage';
import { MaterialDailyClosePage } from './pages/MaterialDailyClosePage';
import { ProductionClosePage } from './pages/productionClose/ProductionClosePage';
import { ProductionWorkflowHomePage } from './pages/production/ProductionWorkflowHomePage';
import { ProductionWorkflowRunPage } from './pages/production/ProductionWorkflowRunPage';
import { HrWorkflowHomePage } from './pages/workflows/HrWorkflowHomePage';
import { HrWorkflowRunPage } from './pages/workflows/HrWorkflowRunPage';
import { FinanceWorkflowHomePage } from './pages/workflows/FinanceWorkflowHomePage';
import { FinanceWorkflowRunPage } from './pages/workflows/FinanceWorkflowRunPage';
import { EcommerceWorkflowHomePage } from './pages/workflows/EcommerceWorkflowHomePage';
import { EcommerceWorkflowRunPage } from './pages/workflows/EcommerceWorkflowRunPage';
import { LogisticsWorkflowHomePage } from './pages/workflows/LogisticsWorkflowHomePage';
import { LogisticsWorkflowRunPage } from './pages/workflows/LogisticsWorkflowRunPage';
import { AdminWorkflowHomePage } from './pages/workflows/AdminWorkflowHomePage';
import { AdminWorkflowRunPage } from './pages/workflows/AdminWorkflowRunPage';
import { ProgressPage } from './pages/ProgressPage';
import { ReportPage } from './pages/ReportPage';
import { RolesPage } from './pages/RolesPage';
import { SheetPage } from './pages/SheetPage';
import { TasksPage } from './pages/TasksPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { DepartmentWorkspacePage } from './pages/DepartmentWorkspacePage';
import { FileLibraryPage } from './pages/FileLibraryPage';
import { QuotaUsagePage } from './pages/QuotaUsagePage';
import { LegalPage } from './pages/LegalPage';
import { FeatureGuard, WorkflowGuard } from './router/guards';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/launch" replace />} />
        <Route path="/launch" element={<LaunchPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="/legal" element={<Navigate to="/legal/terms" replace />} />
        <Route
          path="/activate"
          element={
            <FeatureGuard flag="licenseActivation" featureName="授权激活">
              <ActivatePage />
            </FeatureGuard>
          }
        />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/templates/:departmentCode" element={<DepartmentWorkspacePage />} />
        <Route path="/production/workflows" element={<ProductionWorkflowHomePage />} />
        <Route path="/production/workflows/:workflowId" element={<ProductionWorkflowRunPage />} />
        <Route path="/hr/workflows" element={<HrWorkflowHomePage />} />
        <Route path="/hr/workflows/:workflowId" element={<HrWorkflowRunPage />} />
        <Route path="/finance/workflows" element={<FinanceWorkflowHomePage />} />
        <Route path="/finance/workflows/:workflowId" element={<FinanceWorkflowRunPage />} />
        <Route path="/ecommerce/workflows" element={<EcommerceWorkflowHomePage />} />
        <Route path="/ecommerce/workflows/:workflowId" element={<EcommerceWorkflowRunPage />} />
        <Route path="/logistics/workflows" element={<LogisticsWorkflowHomePage />} />
        <Route path="/logistics/workflows/:workflowId" element={<LogisticsWorkflowRunPage />} />
        <Route path="/admin/workflows" element={<AdminWorkflowHomePage />} />
        <Route path="/admin/workflows/:workflowId" element={<AdminWorkflowRunPage />} />
        <Route path="/production/material-daily-close" element={<MaterialDailyClosePage />} />
        <Route path="/production/close/:taskCode" element={<ProductionClosePage />} />
        <Route path="/templates/production/local" element={<Navigate to="/production/workflows" replace />} />
        <Route path="/templates/hr/local" element={<Navigate to="/hr/workflows" replace />} />
        <Route path="/templates/finance/local" element={<Navigate to="/finance/workflows" replace />} />
        <Route path="/templates/ecommerce/local" element={<Navigate to="/ecommerce/workflows" replace />} />
        <Route path="/templates/logistics/local" element={<Navigate to="/logistics/workflows" replace />} />
        <Route path="/templates/administration/local" element={<Navigate to="/admin/workflows" replace />} />
        <Route path="/templates/admin/local" element={<Navigate to="/admin/workflows" replace />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route
          path="/tasks"
          element={
            <WorkflowGuard step="task">
              <TasksPage />
            </WorkflowGuard>
          }
        />
        <Route
          path="/import"
          element={
            <WorkflowGuard step="import">
              <ImportPage />
            </WorkflowGuard>
          }
        />
        <Route
          path="/sheet"
          element={
            <WorkflowGuard step="sheet">
              <SheetPage />
            </WorkflowGuard>
          }
        />
        <Route
          path="/mapping"
          element={
            <WorkflowGuard step="mapping">
              <MappingPage />
            </WorkflowGuard>
          }
        />
        <Route
          path="/clean"
          element={
            <WorkflowGuard step="clean">
              <CleanPage />
            </WorkflowGuard>
          }
        />
        <Route
          path="/anomalies"
          element={
            <WorkflowGuard step="anomalies">
              <AnomaliesPage />
            </WorkflowGuard>
          }
        />
        <Route
          path="/progress"
          element={
            <WorkflowGuard step="progress">
              <ProgressPage />
            </WorkflowGuard>
          }
        />
        <Route
          path="/report"
          element={
            <WorkflowGuard step="report">
              <ReportPage />
            </WorkflowGuard>
          }
        />
        <Route path="/file-upload" element={<Navigate to="/files" replace />} />
        <Route path="/image-analysis" element={<Navigate to="/files" replace />} />
        <Route path="/files" element={<FileLibraryPage />} />
        <Route path="/wallet" element={<Navigate to="/quota" replace />} />
        <Route path="/quota" element={<QuotaUsagePage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/credits" element={<AccountPage />} />
        <Route path="/account/help" element={<AccountPage />} />
        <Route path="/history" element={<Navigate to="/chat" replace />} />
        <Route path="/settings" element={<Navigate to="/account" replace />} />
        <Route path="/preview" element={<Navigate to="/clean" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Route>
    </Routes>
  );
}
